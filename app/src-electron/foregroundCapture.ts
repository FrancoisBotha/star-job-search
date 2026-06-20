/**
 * Foreground-view capture helper (XJOB-001 / Epic 11 — Extract this job).
 *
 * Reads the FOREGROUND embedded-browser webContents — the tab the user is
 * actively viewing — and returns its rendered `document.body.innerText`
 * (preferring a main/detail content region when one exists, falling back to
 * `<body>`), plus the current URL. This helper is a strict READ surface: it
 * never navigates, clicks, types, injects styles, or dispatches events on
 * the page. The hidden Epic 3 crawler webContents is OUT OF SCOPE here —
 * Epic 11 is "extract the job the user is looking at", so we resolve the
 * visible target only.
 *
 * Output is trimmed to a sane upper bound (CAPTURE_TEXT_MAX) so a runaway
 * job page can't blow up a single LLM call downstream.
 */
import type { WebContents } from 'electron';

/**
 * Region selectors tried, in order, before falling back to `<body>`. The
 * order is "most specific job-detail container first" → "generic main
 * landmarks last". The first non-empty hit wins.
 */
export const FOREGROUND_REGION_SELECTORS: readonly string[] = [
  '[data-job-description]',
  '[data-testid*="job-description" i]',
  '[data-automation-id*="jobDetails" i]',
  '#job-details',
  '#jobDescriptionText',
  '.job-description',
  '.jobsearch-JobComponent',
  'article',
  'main',
  '[role="main"]',
];

/**
 * Upper bound on returned text length. Sized to comfortably fit inside a
 * single OpenRouter completion alongside the system prompt and structured
 * schema; ~32k chars is roughly 8k tokens of plain English.
 */
export const CAPTURE_TEXT_MAX = 32_000;

export type ForegroundCaptureResult =
  | {
      ok: true;
      url: string;
      text: string;
      region: string;
      truncated: boolean;
    }
  | {
      ok: false;
      code: 'NO_VIEW' | 'CAPTURE_FAILED';
      error: string;
    };

export interface ForegroundCaptureDeps {
  /** Resolves the currently visible (foreground) board view, or undefined. */
  getVisibleTarget: () => WebContents | undefined;
}

function trim(text: string): { text: string; truncated: boolean } {
  if (text.length <= CAPTURE_TEXT_MAX) return { text, truncated: false };
  return { text: text.slice(0, CAPTURE_TEXT_MAX), truncated: true };
}

/**
 * Capture the foreground view's rendered text and current URL.
 *
 * Resolves cleanly with `{ ok: false, code: 'NO_VIEW' }` when no board view
 * is active — callers can surface a plain "open a job posting first"
 * message without try/catch.
 */
export async function captureForegroundView(
  deps: ForegroundCaptureDeps,
): Promise<ForegroundCaptureResult> {
  const wc = deps.getVisibleTarget();
  if (!wc) {
    return {
      ok: false,
      code: 'NO_VIEW',
      error:
        'No active board view to capture from. Open a job posting in the Discover browser first.',
    };
  }

  let url = '';
  try {
    url = wc.getURL();
  } catch {
    url = '';
  }

  // STAR_FG_REGION marker keeps this script identifiable in transcripts /
  // tests and distinguishes it from the body fallback below.
  const selectors = JSON.stringify(FOREGROUND_REGION_SELECTORS);
  const regionCode = `/* STAR_FG_REGION */ (() => {
    const sels = ${selectors};
    for (const s of sels) {
      const el = document.querySelector(s);
      if (!el) continue;
      const txt = (el.innerText || el.textContent || '').trim();
      if (txt) return { sel: s, text: txt };
    }
    return null;
  })()`;

  let region = 'body';
  let raw = '';

  try {
    const hit = (await wc.executeJavaScript(regionCode)) as
      | { sel: string; text: string }
      | null;
    if (hit && typeof hit.text === 'string' && hit.text.length > 0) {
      region = hit.sel;
      raw = hit.text;
    } else {
      const bodyCode = `(() => {
        const b = document.body;
        return b ? (b.innerText || b.textContent || '') : '';
      })()`;
      raw = ((await wc.executeJavaScript(bodyCode)) as string) ?? '';
    }
  } catch (err) {
    return {
      ok: false,
      code: 'CAPTURE_FAILED',
      error: err instanceof Error ? err.message : String(err),
    };
  }

  const { text, truncated } = trim(String(raw));
  return { ok: true, url, text, region, truncated };
}
