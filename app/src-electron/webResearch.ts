/**
 * Shared web-research capability (EVAL-001 / Epic 14 — Job Evaluation Report).
 *
 * Drives a single browser surface (the embedded Epic 1 view or the Epic 3
 * hidden crawler, in the partitioned `persist:job-browser` session) to run
 * a search and fetch result pages. No external HTTP API, no extra API key —
 * the same surface that already powers Discover + Extract is reused so the
 * cookies/storage live in one isolated session.
 *
 * Public contract is two functions: `search(query)` and `fetchUrl(url)`.
 * Both return a discriminated `{ ok }` result. Callers never receive raw
 * page HTML — only `text` (innerText) + `sources` (the URLs visited /
 * extracted from) so a downstream LLM can cite them.
 *
 * Two gates run BEFORE any browser navigation:
 *   1. `webResearchEnabled` (default OFF, local-only) — when off, callers
 *      get `{ ok: false, code: 'research_disabled' }`. Nothing is fetched.
 *   2. One-time disclosure — the first call when the disclosure has not
 *      been acknowledged returns `{ ok: false, code: 'disclosure_required' }`.
 *      The UI is expected to surface the disclosure copy and call
 *      `acknowledgeDisclosure()` before retrying.
 *
 * Anti-bot / CAPTCHA challenges are NOT bypassed. If the page text or HTML
 * matches a challenge marker, the call resolves with `{ ok: true,
 * uncertain: true, reason: '…' }` and an empty result set so the caller can
 * fall back to other surfaces (e.g. cached data, a different query) and
 * report "uncertain" to the user.
 *
 * All extracted text is run through the existing prompt-injection
 * sanitizer — fetched web content is UNTRUSTED data, not instructions.
 */
import { sanitizeForPrompt } from './promptSanitizer';

/**
 * Minimal browser surface this module needs. Intentionally narrower than
 * the Epic 3 `BrowserSurface` so callers can adapt either a foreground
 * WebContents or the hidden crawler with a thin shim.
 */
export interface WebResearchBrowserSurface {
  navigate(url: string): Promise<void>;
  /** EXTR-014 readiness wait — resolves once the navigation has settled. */
  waitForReady(): Promise<void>;
  /** EXTR-014/018 selector wait — used to gate result extraction in tests. */
  waitForSelector?(
    selector: string,
    opts?: { timeoutMs?: number },
  ): Promise<boolean>;
  /** Returns the rendered `innerText` of `selector` (default body). */
  getText(selector?: string): Promise<string>;
  /** Returns the `outerHTML` of `selector` (default body). Used to parse
   *  search-engine result links. */
  getOuterHtml(selector?: string): Promise<string>;
  /** Current URL of the surface (used as the cited source for fetchUrl). */
  currentUrl?(): string;
}

export interface WebResearchDeps {
  /** Resolves the browser surface to drive. Lazily invoked so disabled
   *  callers never allocate one. */
  getSurface: () => Promise<WebResearchBrowserSurface>;
  isEnabled: () => boolean;
  isDisclosureAcknowledged: () => boolean;
  acknowledgeDisclosure: () => void;
  setEnabled: (v: boolean) => void;
}

export interface WebResearchResultItem {
  url: string;
  title: string;
  snippet: string;
}

export type WebSearchResult =
  | {
      ok: true;
      query: string;
      results: WebResearchResultItem[];
      sources: string[];
      uncertain?: boolean;
      reason?: string;
    }
  | {
      ok: false;
      code: 'research_disabled' | 'disclosure_required' | 'search_failed';
      error: string;
    };

export type WebFetchResult =
  | {
      ok: true;
      text: string;
      sources: string[];
      redactionCount: number;
      uncertain?: boolean;
      reason?: string;
    }
  | {
      ok: false;
      code: 'research_disabled' | 'disclosure_required' | 'fetch_failed';
      error: string;
    };

export interface WebResearch {
  search(query: string): Promise<WebSearchResult>;
  fetchUrl(url: string): Promise<WebFetchResult>;
  isEnabled(): boolean;
  setEnabled(v: boolean): void;
  isDisclosureAcknowledged(): boolean;
  acknowledgeDisclosure(): void;
}

/** Output cap — keeps any single fetched page from blowing up a downstream
 *  LLM call. ~32k chars ≈ 8k tokens of plain English. */
export const WEB_RESEARCH_TEXT_MAX = 32_000;

/**
 * Anti-bot / CAPTCHA marker catalogue. The set is intentionally
 * conservative — we'd rather over-flag a "verify you are human" prompt and
 * fall back than silently scrape a challenge page. Markers are compiled
 * case-insensitively against the rendered text + HTML.
 */
const CHALLENGE_MARKERS: RegExp[] = [
  /\bcaptcha\b/i,
  /\banti[- ]?bot\b/i,
  /\bare\s+you\s+a\s+(?:human|robot)\b/i,
  /\bverify\s+you\s+are\s+(?:a\s+)?human\b/i,
  /\bcomplete\s+(?:the\s+|this\s+)?(?:security\s+)?challenge\b/i,
  /\bcloudflare\b.*(?:checking|verify)/i,
];

function detectChallenge(textOrHtml: string): string | null {
  for (const re of CHALLENGE_MARKERS) {
    const m = textOrHtml.match(re);
    if (m) return m[0];
  }
  return null;
}

/** DuckDuckGo HTML endpoint — no JS required, returns plain `<a class="result__a">`
 *  anchors which we parse out below. Using the HTML variant keeps the
 *  embedded browser from needing to execute the standard SERP's heavy JS. */
function searchEngineUrl(query: string): string {
  return `https://duckduckgo.com/html/?q=${encodeURIComponent(query)}`;
}

interface ParsedAnchor {
  url: string;
  title: string;
}

function parseSearchAnchors(html: string): ParsedAnchor[] {
  const out: ParsedAnchor[] = [];
  // Match either DuckDuckGo's `class="result__a"` anchors or, as a fall-back
  // for engines that change markup, any anchor whose class contains "result".
  const anchorRe =
    /<a\b[^>]*class="[^"]*result[^"]*"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi;
  let match: RegExpExecArray | null;
  const seen = new Set<string>();
  while ((match = anchorRe.exec(html)) !== null) {
    const href = decodeHtml(match[1] ?? '').trim();
    const title = stripTags(match[2] ?? '').trim();
    if (!href || seen.has(href)) continue;
    if (!/^https?:\/\//i.test(href)) continue;
    seen.add(href);
    out.push({ url: href, title });
    if (out.length >= 10) break;
  }
  return out;
}

function stripTags(s: string): string {
  return s.replace(/<[^>]+>/g, '');
}

function decodeHtml(s: string): string {
  return s
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

function trim(text: string): { text: string; truncated: boolean } {
  if (text.length <= WEB_RESEARCH_TEXT_MAX) return { text, truncated: false };
  return { text: text.slice(0, WEB_RESEARCH_TEXT_MAX), truncated: true };
}

export function createWebResearch(deps: WebResearchDeps): WebResearch {
  const gate = ():
    | { ok: false; code: 'research_disabled' | 'disclosure_required'; error: string }
    | null => {
    if (!deps.isEnabled()) {
      return {
        ok: false,
        code: 'research_disabled',
        error:
          'Web research is disabled. Enable it under Settings → Web research (local-only) to allow this call.',
      };
    }
    if (!deps.isDisclosureAcknowledged()) {
      return {
        ok: false,
        code: 'disclosure_required',
        error:
          'Web research has not been disclosed to the user yet. The UI must show the disclosure and call acknowledgeDisclosure() before retrying.',
      };
    }
    return null;
  };

  async function search(query: string): Promise<WebSearchResult> {
    const blocked = gate();
    if (blocked) return blocked;

    const q = (query ?? '').trim();
    if (!q) {
      return {
        ok: false,
        code: 'search_failed',
        error: 'search() requires a non-empty query string.',
      };
    }

    const url = searchEngineUrl(q);
    let surface: WebResearchBrowserSurface;
    try {
      surface = await deps.getSurface();
    } catch (err) {
      return {
        ok: false,
        code: 'search_failed',
        error: err instanceof Error ? err.message : String(err),
      };
    }

    try {
      await surface.navigate(url);
      await surface.waitForReady();
      const html = await surface.getOuterHtml('body');
      const text = await surface.getText('body');

      const challenge = detectChallenge(text) ?? detectChallenge(html);
      if (challenge) {
        return {
          ok: true,
          query: q,
          results: [],
          sources: [],
          uncertain: true,
          reason: `anti-bot challenge detected (matched: "${challenge}") — did not bypass`,
        };
      }

      const anchors = parseSearchAnchors(html);
      const results: WebResearchResultItem[] = anchors.map((a) => ({
        url: a.url,
        title: a.title || a.url,
        snippet: '',
      }));

      return {
        ok: true,
        query: q,
        results,
        sources: results.map((r) => r.url),
      };
    } catch (err) {
      return {
        ok: false,
        code: 'search_failed',
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }

  async function fetchUrl(target: string): Promise<WebFetchResult> {
    const blocked = gate();
    if (blocked) return blocked;

    const u = (target ?? '').trim();
    if (!u || !/^https?:\/\//i.test(u)) {
      return {
        ok: false,
        code: 'fetch_failed',
        error: 'fetchUrl() requires an absolute http(s) URL.',
      };
    }

    let surface: WebResearchBrowserSurface;
    try {
      surface = await deps.getSurface();
    } catch (err) {
      return {
        ok: false,
        code: 'fetch_failed',
        error: err instanceof Error ? err.message : String(err),
      };
    }

    try {
      await surface.navigate(u);
      await surface.waitForReady();
      const text = await surface.getText('body');
      const html = await surface.getOuterHtml('body');

      const challenge = detectChallenge(text) ?? detectChallenge(html);
      if (challenge) {
        return {
          ok: true,
          text: '',
          sources: [],
          redactionCount: 0,
          uncertain: true,
          reason: `anti-bot challenge detected (matched: "${challenge}") — did not bypass`,
        };
      }

      const cleaned = (text ?? '').replace(/\s+/g, ' ').trim();
      // AC4: fetched web content is untrusted — run it through the same
      // injection redactor the Epic 3/6/7/9 prompts use, so any "ignore
      // previous instructions" smuggled in a blog post becomes [redacted]
      // before a downstream prompt ever sees it.
      const sanitized = sanitizeForPrompt(cleaned);
      const { text: capped } = trim(sanitized.sanitized);

      const sourceUrl =
        (typeof surface.currentUrl === 'function' && surface.currentUrl()) || u;

      return {
        ok: true,
        text: capped,
        sources: [sourceUrl],
        redactionCount: sanitized.redactionCount,
      };
    } catch (err) {
      return {
        ok: false,
        code: 'fetch_failed',
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }

  return {
    search,
    fetchUrl,
    isEnabled: () => deps.isEnabled(),
    setEnabled: (v: boolean) => deps.setEnabled(v),
    isDisclosureAcknowledged: () => deps.isDisclosureAcknowledged(),
    acknowledgeDisclosure: () => deps.acknowledgeDisclosure(),
  };
}

/**
 * Disclosure copy shown to the user before the first web call. Exported so
 * the renderer-side disclosure dialog and the unit tests stay in sync with
 * the engineering-level guarantee (local-only, partitioned session, no
 * extra API key, content treated as untrusted).
 */
export const WEB_RESEARCH_DISCLOSURE = `Star can run web searches and fetch public pages to research a job (employer, salary band, role context). Research runs in the same partitioned browser session as Discover — locally on your machine — and does not use an extra API key or send your CV anywhere. Web content is treated as untrusted data and never as instructions. You can turn web research off at any time under Settings → Web research.`;
