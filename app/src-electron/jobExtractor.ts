/**
 * LangGraph job extractor (EXTR-004).
 *
 * Wires a small StateGraph that drives the embedded browser through a
 * standard job-board harvest:
 *
 *   init -> discover -> enumerate -> (paginate -> enumerate)* -> dedup
 *        -> extractDetails -> persist
 *
 * Responsibilities by node:
 *   - init             open the search URL, seed run state.
 *   - discover         reuse a cached SiteProfile if we have one; otherwise
 *                      ask the LLM (withStructuredOutput, SelectorSchema)
 *                      for the card/link/next selectors and cache them.
 *   - enumerate        plain code: browser_query_all over the cards,
 *                      derive sourceIds, accumulate per-run candidates.
 *   - paginate         plain code: click the next selector, bump page.
 *   - dedup            plain code: subtract store.knownSourceIds() from
 *                      the run candidates BEFORE any detail fetch.
 *   - extractDetails   sequentially open each NEW posting, pull body text,
 *                      structure via the LLM (JobSchema), falling back to
 *                      a stub title pulled from the card text if the LLM
 *                      call throws.
 *   - persist          upsert via the JobsStore and report final counts.
 *
 * The LLM is only consulted for tasks the agent is good at (selector
 * discovery + per-posting structuring). Enumerate / paginate / dedup are
 * deterministic plain code so re-runs are reproducible and cheap.
 */
import { z } from 'zod';
import { StateGraph, END } from '@langchain/langgraph';
import type { JobsStore, JobRecord } from './jobs';
import { deriveSourceId } from './jobs';

// --- Schemas exposed for AC2 + AC4 ----------------------------------------

export const SelectorSchema = z.object({
  cardSelector: z.string(),
  linkSelector: z.string(),
  nextSelector: z.string().nullable().optional(),
});
export type SelectorSet = z.infer<typeof SelectorSchema>;

export const JobSchema = z.object({
  title: z.string(),
  company: z.string().nullable().optional(),
  location: z.string().nullable().optional(),
  description: z.string().nullable().optional(),
  // EXTR-013: salary string as stated on the posting (e.g. "£70k–£90k").
  // Null when the posting states none — the extraction prompt forbids
  // fabricating a salary from inferred bands / market rates / etc.
  salary: z.string().nullable().optional(),
});
export type StructuredJob = z.infer<typeof JobSchema>;

// --- Dep shapes ------------------------------------------------------------

export interface BrowserSurface {
  navigate(url: string): Promise<void>;
  queryAll(opts: {
    selector: string;
    linkSelector?: string;
    limit?: number;
  }): Promise<Array<{ text: string; href: string; html: string }>>;
  getText(selector?: string): Promise<string>;
  click(selector: string): Promise<void>;
  getOuterHtml?(selector?: string): Promise<string>;
  /** EXTR-014: resolve once the navigated page has FINISHED loading
   *  (`did-finish-load` / `did-stop-loading` / `document.readyState === 'complete'`).
   *  Optional so the test-doubles and old MCP-only surfaces still satisfy
   *  the contract; when absent the extractor proceeds without an explicit
   *  load barrier. */
  waitForReady?(): Promise<void>;
  /** EXTR-014: poll for the given selector until at least one matching
   *  element exists or the timeout elapses, returning `true` if found. Used
   *  to give JS-rendered listing boards (Seek, Indeed, …) time to populate
   *  their job cards before enumeration. */
  waitForSelector?(
    selector: string,
    opts?: { timeoutMs?: number },
  ): Promise<boolean>;
}

export interface StructuredLlm {
  withStructuredOutput<T extends z.ZodTypeAny>(
    schema: T,
    opts?: { name?: string },
  ): { invoke(input: string | unknown): Promise<z.infer<T>> };
}

export type ProgressEvent =
  | { phase: 'discover'; hostname: string; cached: boolean }
  | { phase: 'enumerate'; page: number; foundOnPage: number; totalFound: number }
  | { phase: 'dedup'; newCount: number; skipped: number; total: number }
  | { phase: 'extract'; current: number; total: number; sourceId: string }
  | { phase: 'persist'; imported: number; skipped: number; total: number; pages: number }
  | { phase: 'done'; imported: number; skipped: number; total: number; pages: number }
  | {
      phase: 'error';
      // EXTR-018 extended the original captcha/failure pair with two FR-SCAN-010
      // graceful-stop kinds: `gated` (login wall / authenticated interstitial)
      // and `unsupported` (selector-learning + relearn both yielded zero, so
      // the board can't be automated — we stop instead of hanging on
      // 'Discovering listing…').
      kind: 'captcha' | 'failure' | 'gated' | 'unsupported';
      message: string;
      imported: number;
      skipped: number;
      total: number;
      pages: number;
    };

export interface JobExtractorDeps {
  store: JobsStore;
  browser: BrowserSurface;
  llm: StructuredLlm;
  onProgress?: (e: ProgressEvent) => void;
  pageCap?: number;
  /** Pause between navigations and page-clicks. Defaults to 250ms (EXTR-005). */
  throttleMs?: number;
  /** EXTR-018: per-call ceiling on a selector-learning LLM invocation. If the
   *  invocation hasn't resolved by then we abort the run rather than hang on
   *  'Discovering listing…'. Defaults to 30 000 ms. */
  discoverTimeoutMs?: number;
  /** Sleep implementation — injectable for tests. */
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
}

export interface ExtractorInput {
  searchUrl: string;
}

export interface ExtractorResult {
  imported: number;
  skipped: number;
  total: number;
  pages: number;
}

interface Candidate {
  sourceId: string;
  url: string;
  text: string;
}

interface ExtractorState {
  searchUrl: string;
  hostname: string;
  selectors: SelectorSet | null;
  /** True when `selectors` came from a cached SiteProfile rather than a fresh
   *  LLM discovery. Used to trigger a one-shot re-learn if the cached
   *  selectors enumerate nothing (e.g. they were learned from a different
   *  page such as the site homepage). */
  profileFromCache: boolean;
  /** True once we've already re-learned this run, so we don't loop. */
  relearned: boolean;
  page: number;
  pageCap: number;
  candidates: Candidate[];
  seenIds: Set<string>;
  lastAdded: number;
  paginationStopped: boolean;
  newCandidates: Candidate[];
  extracted: JobRecord[];
  result: ExtractorResult;
}

const DEFAULT_PAGE_CAP = 5;
const DEFAULT_THROTTLE_MS = 250;
// EXTR-018: max time we wait for a single selector-learning LLM call. Picked
// well above a normal structured-output round-trip so honest slow responses
// still complete, but small enough that a wedged provider doesn't leave the
// Discover UI stuck on 'Discovering listing…'.
const DEFAULT_DISCOVER_TIMEOUT_MS = 30_000;

// EXTR-005: CAPTCHA / bot-challenge markers. We pattern-match against the
// page body. False positives are preferred over false negatives — the run
// aborts loudly and lets the user solve the challenge manually rather than
// attempting any kind of bypass (NFR-004, FR-009).
const CAPTCHA_MARKERS: readonly string[] = [
  'recaptcha',
  'g-recaptcha',
  'hcaptcha',
  'h-captcha',
  'cf-challenge',
  'cf-turnstile',
  'turnstile',
  'cloudflare',
  'verify you are human',
  'are you a robot',
  'are you a human',
  'unusual traffic',
  'bot detection',
  'press and hold',
  'i am not a robot',
  'security check',
];

// EXTR-018 / FR-SCAN-010: login-wall + authenticated-gate detection. Listed
// separately from CAPTCHA so the terminal error event can carry an honest kind
// — a board that needs sign-in is a different remediation than a CAPTCHA
// challenge (the user can usually swap to a public board).
const GATED_MARKERS: readonly string[] = [
  'sign in to continue',
  'please sign in',
  'sign in to view',
  'log in to continue',
  'please log in',
  'log in to view',
  'login required',
  'login to continue',
  'must be signed in',
  'must be logged in',
  'you need to sign in',
  'you need to log in',
  'authentication required',
  'access denied',
];

function looksLikeCaptcha(text: string | null | undefined): boolean {
  if (!text) return false;
  const lower = text.toLowerCase();
  for (const m of CAPTCHA_MARKERS) {
    if (lower.includes(m)) return true;
  }
  return false;
}

function looksLikeGated(text: string | null | undefined): boolean {
  if (!text) return false;
  const lower = text.toLowerCase();
  for (const m of GATED_MARKERS) {
    if (lower.includes(m)) return true;
  }
  return false;
}

class CaptchaError extends Error {
  readonly kind = 'captcha' as const;
  constructor(message = 'CAPTCHA or bot challenge detected — extraction halted') {
    super(message);
    this.name = 'CaptchaError';
  }
}

// EXTR-018: the board is sitting behind a login wall / authenticated-gate.
// Per FR-SCAN-010 we stop the run cleanly — never attempt to authenticate or
// otherwise bypass the gate.
class GatedBoardError extends Error {
  readonly kind = 'gated' as const;
  constructor(message = 'Login or authentication required — extraction halted') {
    super(message);
    this.name = 'GatedBoardError';
  }
}

// EXTR-018: selector-learning + the relearn fallback both produced zero usable
// cards, or the learning LLM call exceeded `discoverTimeoutMs`. Either way the
// board can't be automated — stop with a terminal state instead of hanging.
class UnsupportedBoardError extends Error {
  readonly kind = 'unsupported' as const;
  constructor(
    message = 'Could not learn usable selectors for this board — extraction halted',
  ) {
    super(message);
    this.name = 'UnsupportedBoardError';
  }
}

const defaultSleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

// EXTR-018: race a selector-learning LLM call against a hard ceiling so a
// wedged structured-output round-trip can't hang the run. A zero/negative
// timeout disables the bound — convenient for tests that stub the LLM.
async function withDiscoverTimeout<T>(p: Promise<T>, timeoutMs: number): Promise<T> {
  if (!timeoutMs || timeoutMs <= 0) return p;
  let timer: ReturnType<typeof setTimeout> | null = null;
  try {
    return await new Promise<T>((resolve, reject) => {
      timer = setTimeout(
        () =>
          reject(
            new UnsupportedBoardError(
              `Selector discovery timed out after ${timeoutMs}ms — extraction halted`,
            ),
          ),
        timeoutMs,
      );
      p.then(resolve, reject);
    });
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function deriveStubFromCardText(text: string): { title: string; company?: string } {
  const trimmed = text.trim().replace(/\s+/g, ' ');
  if (!trimmed) return { title: '(untitled posting)' };
  // Many boards format card text as "Title • Company • Location" or similar.
  const parts = trimmed.split(/[••|\-–—]/).map((p) => p.trim()).filter(Boolean);
  if (parts.length >= 2) {
    return { title: parts[0]!.slice(0, 200), company: parts[1]!.slice(0, 200) };
  }
  return { title: trimmed.slice(0, 200) };
}

export function createJobExtractor(deps: JobExtractorDeps): {
  run(input: ExtractorInput): Promise<ExtractorResult>;
} {
  const {
    store,
    browser,
    llm,
    onProgress,
    pageCap = DEFAULT_PAGE_CAP,
    throttleMs = DEFAULT_THROTTLE_MS,
    discoverTimeoutMs = DEFAULT_DISCOVER_TIMEOUT_MS,
    sleep = defaultSleep,
    now = () => Date.now(),
  } = deps;

  const emit = (e: ProgressEvent) => {
    if (onProgress) onProgress(e);
  };

  // Closure-scoped run telemetry — survives a node throwing so the catch
  // handler in run() can persist already-extracted jobs (AC3) and surface a
  // partial result.
  interface RunTelemetry {
    extracted: JobRecord[];
    persistedCount: number;
    persisted: boolean;
    skipped: number;
    total: number;
    pages: number;
    hostname: string;
  }
  let tele: RunTelemetry = {
    extracted: [],
    persistedCount: 0,
    persisted: false,
    skipped: 0,
    total: 0,
    pages: 1,
    hostname: '',
  };

  const throttle = async () => {
    if (throttleMs > 0) await sleep(throttleMs);
  };

  const assertNoBlocker = async (where: string): Promise<void> => {
    let body = '';
    try {
      body = await browser.getText('body');
    } catch {
      body = '';
    }
    // EXTR-018: gated check runs alongside the existing captcha check so a
    // login-walled board produces a distinct terminal kind. Captcha takes
    // priority when both match (the markers can overlap on Cloudflare-style
    // interstitials).
    if (looksLikeCaptcha(body)) {
      throw new CaptchaError(
        `CAPTCHA or bot challenge detected on ${where} — extraction halted`,
      );
    }
    if (looksLikeGated(body)) {
      throw new GatedBoardError(
        `Login or authentication required on ${where} — extraction halted`,
      );
    }
  };

  async function initNode(state: ExtractorState): Promise<Partial<ExtractorState>> {
    await browser.navigate(state.searchUrl);
    // EXTR-014 AC2: wait for the navigated page to FINISH loading before we
    // capture HTML for selector-learning or attempt enumeration. Otherwise a
    // mid-load DOM sample reaches the LLM and the run reports "no listings"
    // even when jobs are present on the rendered page.
    if (browser.waitForReady) {
      try {
        await browser.waitForReady();
      } catch {
        // A readiness wait failure should NOT abort the run — a fully-loaded
        // page may have raced through readiness before the listener attached.
      }
    }
    await throttle();
    let hostname = '';
    try {
      hostname = new URL(state.searchUrl).hostname.toLowerCase();
    } catch {
      hostname = '';
    }
    tele.hostname = hostname;
    // AC1: halt before enumerate if the board is gating us with a challenge.
    await assertNoBlocker('search page');
    return { hostname };
  }

  /** Ask the LLM for the page's selectors and persist them as the site's
   *  profile (overwriting any stale cached one). Used by both the initial
   *  discovery and the re-learn fallback. */
  async function learnSelectors(hostname: string): Promise<SelectorSet> {
    const sample = browser.getOuterHtml
      ? await browser.getOuterHtml('body').catch(() => '')
      : await browser.getText('body').catch(() => '');
    const structured = llm.withStructuredOutput(SelectorSchema, { name: 'SelectorSet' });
    // EXTR-018 AC1: bound the LLM call so a wedged provider can't strand the
    // Discover UI on 'Discovering listing…'. The timeout flips the run into a
    // terminal 'unsupported' state via the run() catch.
    const invoked = structured.invoke(
      `Inspect this job-board listing page (host=${hostname}).
Return CSS selectors that identify:
  - cardSelector:  every job-posting card on the page
  - linkSelector:  the link element inside a card pointing at the posting detail
  - nextSelector:  the "next page" control (or null if pagination is infinite-scroll / absent)
HTML sample:
${(sample ?? '').slice(0, 12000)}`,
    );
    const result = await withDiscoverTimeout(invoked, discoverTimeoutMs);

    const selectorsObj: Record<string, string> = {
      cardSelector: result.cardSelector,
      linkSelector: result.linkSelector,
    };
    if (result.nextSelector) selectorsObj.nextSelector = result.nextSelector;
    store.saveSiteProfile({
      hostname,
      selectors: selectorsObj,
      learnedAt: now(),
    });
    return { ...result, nextSelector: result.nextSelector ?? null };
  }

  async function discoverNode(state: ExtractorState): Promise<Partial<ExtractorState>> {
    const cached = store.getSiteProfile(state.hostname);
    if (
      cached &&
      cached.selectors &&
      typeof cached.selectors.cardSelector === 'string' &&
      typeof cached.selectors.linkSelector === 'string'
    ) {
      const selectors: SelectorSet = {
        cardSelector: cached.selectors.cardSelector,
        linkSelector: cached.selectors.linkSelector,
        nextSelector: cached.selectors.nextSelector ?? null,
      };
      emit({ phase: 'discover', hostname: state.hostname, cached: true });
      return { selectors, profileFromCache: true };
    }

    const selectors = await learnSelectors(state.hostname);
    emit({ phase: 'discover', hostname: state.hostname, cached: false });
    return { selectors, profileFromCache: false };
  }

  /** Cached selectors enumerated nothing — they were probably learned from a
   *  different page (e.g. the site homepage). Re-learn from the page we're
   *  actually on, replacing the stale profile, and try enumerate once more. */
  async function relearnNode(state: ExtractorState): Promise<Partial<ExtractorState>> {
    const selectors = await learnSelectors(state.hostname);
    emit({ phase: 'discover', hostname: state.hostname, cached: false });
    return { selectors, profileFromCache: false, relearned: true };
  }

  async function enumerateNode(state: ExtractorState): Promise<Partial<ExtractorState>> {
    const sel = state.selectors!;
    // EXTR-014 AC3: SPA boards (Seek, Indeed) render their job cards via
    // client-side JS after `did-finish-load` fires. Poll until at least one
    // card matches the selector — or the timeout elapses — so the enumerate
    // step doesn't snapshot a still-loading DOM and conclude zero listings.
    if (browser.waitForSelector) {
      try {
        await browser.waitForSelector(sel.cardSelector);
      } catch {
        // Treat a polling error as "page never settled" — fall through to
        // queryAll which will report zero and let routeAfterEnumerate decide
        // whether to relearn.
      }
    }
    const rows = await browser.queryAll({
      selector: sel.cardSelector,
      linkSelector: sel.linkSelector,
    });
    const candidates = [...state.candidates];
    const seen = new Set(state.seenIds);
    let added = 0;
    for (const row of rows) {
      if (!row.href) continue;
      const id = deriveSourceId(row.href, state.hostname);
      if (seen.has(id)) continue;
      seen.add(id);
      candidates.push({ sourceId: id, url: row.href, text: row.text });
      added++;
    }
    emit({
      phase: 'enumerate',
      page: state.page,
      foundOnPage: added,
      totalFound: candidates.length,
    });
    // EXTR-018 AC1: if even the relearn fallback enumerated nothing, the board
    // can't be automated — stop with a terminal error instead of looping back
    // to relearn or wedging the UI on 'Discovering listing…'.
    if (added === 0 && state.relearned) {
      throw new UnsupportedBoardError();
    }
    return { candidates, seenIds: seen, lastAdded: added };
  }

  async function paginateNode(state: ExtractorState): Promise<Partial<ExtractorState>> {
    const next = state.selectors?.nextSelector;
    if (!next) return { paginationStopped: true };
    try {
      await browser.click(next);
    } catch {
      return { paginationStopped: true };
    }
    await throttle();
    tele.pages = state.page + 1;
    return { page: state.page + 1 };
  }

  function routeAfterEnumerate(state: ExtractorState): 'paginate' | 'dedup' | 'relearn' {
    // EXTR-014 AC4: when enumerate finds nothing on the first page, retry
    // selector-learning ONCE before concluding "no listings". This protects
    // against both stale cached selectors AND a freshly-learned selector
    // sample drawn from a still-rendering DOM — a single bad sample can't
    // end the run in a false zero.
    if (state.lastAdded === 0 && state.page === 1 && !state.relearned) {
      return 'relearn';
    }
    const next = state.selectors?.nextSelector;
    if (!next) return 'dedup';
    if (state.paginationStopped) return 'dedup';
    if (state.page >= state.pageCap) return 'dedup';
    if (state.lastAdded === 0) return 'dedup';
    return 'paginate';
  }

  async function dedupNode(state: ExtractorState): Promise<Partial<ExtractorState>> {
    const known = store.knownSourceIds();
    const fresh: Candidate[] = [];
    let skipped = 0;
    for (const c of state.candidates) {
      if (known.has(c.sourceId)) {
        skipped++;
        continue;
      }
      fresh.push(c);
    }
    emit({
      phase: 'dedup',
      newCount: fresh.length,
      skipped,
      total: state.candidates.length,
    });
    tele.skipped = skipped;
    tele.total = state.candidates.length;
    tele.pages = state.page;
    return {
      newCandidates: fresh,
      result: {
        imported: 0,
        skipped,
        total: state.candidates.length,
        pages: state.page,
      },
    };
  }

  async function extractDetailsNode(
    state: ExtractorState,
  ): Promise<Partial<ExtractorState>> {
    const fetchedAt = now();
    const extracted: JobRecord[] = [];
    const total = state.newCandidates.length;
    let i = 0;
    for (const cand of state.newCandidates) {
      i++;
      emit({ phase: 'extract', current: i, total, sourceId: cand.sourceId });

      // Detail navigation is the most likely place for a hard failure or a
      // bot challenge to surface. We keep navigate + captcha-check OUTSIDE
      // the LLM try/catch so those failures abort the run (AC1, AC3) rather
      // than being papered over with a stub.
      await browser.navigate(cand.url);
      await throttle();
      let body = '';
      try {
        body = await browser.getText('body');
      } catch {
        body = '';
      }
      if (looksLikeCaptcha(body)) {
        throw new CaptchaError(
          `CAPTCHA or bot challenge detected on detail page ${cand.url} — extraction halted`,
        );
      }
      if (looksLikeGated(body)) {
        throw new GatedBoardError(
          `Login or authentication required on detail page ${cand.url} — extraction halted`,
        );
      }

      let title = '';
      let company: string | null = null;
      let location: string | null = null;
      let description: string | null = null;
      let salary: string | null = null;
      try {
        const structured = llm.withStructuredOutput(JobSchema, { name: 'JobSchema' });
        const job = await structured.invoke(
          `Extract the job posting fields from the page below. Posting URL: ${cand.url}.
Return: title, company, location, description (cleaned plain text), salary.

Rules for the salary field (EXTR-013):
  - Copy the salary EXACTLY AS STATED on the posting (verbatim), preserving the
    currency symbol, range delimiter, and any units (e.g. "£70k–£90k",
    "$120,000 - $150,000 per year", "€50k OTE").
  - If the posting does NOT state a salary, return null. Do NOT fabricate,
    estimate, infer from market rates, or fill in a guess. Null is the
    correct answer when no salary is stated.

BODY:
${(body ?? '').slice(0, 16000)}`,
        );
        title = job.title;
        company = job.company ?? null;
        location = job.location ?? null;
        description = job.description ?? null;
        salary = job.salary ?? null;
      } catch {
        // Stub fallback — derive what we can from the card text we kept in
        // enumerate. Lets the user still see the posting in the list even if
        // the per-detail extraction blew up.
        const stub = deriveStubFromCardText(cand.text);
        title = stub.title;
        company = stub.company ?? null;
      }
      const record: JobRecord = {
        sourceId: cand.sourceId,
        hostname: state.hostname,
        url: cand.url,
        title,
        company,
        location,
        description,
        salary,
        fetchedAt,
      };
      extracted.push(record);
      tele.extracted.push(record);
      // AC3: persist each posting as it's structured, so a later crash does
      // not roll back what we've already captured. INSERT OR IGNORE makes
      // the subsequent batch upsert in persistNode idempotent.
      const inserted = store.upsertJobs([record]);
      tele.persistedCount += inserted;
    }
    return { extracted };
  }

  async function persistNode(state: ExtractorState): Promise<Partial<ExtractorState>> {
    // AC3: extractDetails already persisted each posting as it was structured.
    // We re-upsert here defensively — INSERT OR IGNORE makes it idempotent —
    // and credit the count from the incremental path so the final result is
    // accurate even when this node would otherwise see no new rows.
    const extraInserted = store.upsertJobs(state.extracted);
    const imported = tele.persistedCount + extraInserted;
    tele.persisted = true;
    const result: ExtractorResult = {
      imported,
      skipped: state.result.skipped,
      total: state.result.total,
      pages: state.page,
    };
    emit({ phase: 'persist', ...result });
    emit({ phase: 'done', ...result });
    return { result };
  }

  // ---- Build the graph ----------------------------------------------------

  const graph = new StateGraph<ExtractorState>({
    channels: {
      searchUrl: null,
      hostname: null,
      selectors: null,
      profileFromCache: null,
      relearned: null,
      page: null,
      pageCap: null,
      candidates: null,
      seenIds: null,
      lastAdded: null,
      paginationStopped: null,
      newCandidates: null,
      extracted: null,
      result: null,
    },
  } as unknown as never)
    .addNode('init', initNode)
    .addNode('discover', discoverNode)
    .addNode('relearn', relearnNode)
    .addNode('enumerate', enumerateNode)
    .addNode('paginate', paginateNode)
    .addNode('dedup', dedupNode)
    .addNode('extractDetails', extractDetailsNode)
    .addNode('persist', persistNode)
    .addEdge('__start__' as never, 'init' as never)
    .addEdge('init' as never, 'discover' as never)
    .addEdge('discover' as never, 'enumerate' as never)
    .addConditionalEdges(
      'enumerate' as never,
      routeAfterEnumerate as never,
      { paginate: 'paginate', dedup: 'dedup', relearn: 'relearn' } as never,
    )
    .addEdge('relearn' as never, 'enumerate' as never)
    .addEdge('paginate' as never, 'enumerate' as never)
    .addEdge('dedup' as never, 'extractDetails' as never)
    .addEdge('extractDetails' as never, 'persist' as never)
    .addEdge('persist' as never, END as never);

  const compiled = graph.compile();

  return {
    async run(input: ExtractorInput): Promise<ExtractorResult> {
      // Reset run-level telemetry so a re-used extractor doesn't bleed state.
      tele = {
        extracted: [],
        persistedCount: 0,
        persisted: false,
        skipped: 0,
        total: 0,
        pages: 1,
        hostname: '',
      };
      const initialState: ExtractorState = {
        searchUrl: input.searchUrl,
        hostname: '',
        selectors: null,
        profileFromCache: false,
        relearned: false,
        page: 1,
        pageCap,
        candidates: [],
        seenIds: new Set(),
        lastAdded: 0,
        paginationStopped: false,
        newCandidates: [],
        extracted: [],
        result: { imported: 0, skipped: 0, total: 0, pages: 0 },
      };
      try {
        const final = (await compiled.invoke(initialState)) as ExtractorState;
        return final.result;
      } catch (err) {
        // AC1 + AC3: surface failure cleanly. Jobs already extracted have
        // already been persisted incrementally inside extractDetailsNode, so
        // the board is never left in a partial / corrupted state.
        // EXTR-018: pick the most specific terminal kind so the renderer can
        // show an actionable message (FR-SCAN-010 graceful-stop).
        const kind: 'captcha' | 'failure' | 'gated' | 'unsupported' =
          err instanceof CaptchaError
            ? 'captcha'
            : err instanceof GatedBoardError
              ? 'gated'
              : err instanceof UnsupportedBoardError
                ? 'unsupported'
                : 'failure';
        const message = err instanceof Error ? err.message : String(err);
        const result: ExtractorResult = {
          imported: tele.persistedCount,
          skipped: tele.skipped,
          total: tele.total,
          pages: tele.pages,
        };
        emit({ phase: 'error', kind, message, ...result });
        return result;
      }
    },
  };
}
