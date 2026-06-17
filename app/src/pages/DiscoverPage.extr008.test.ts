/**
 * Unit tests for the Discover page AI Extract action + live progress
 * (EXTR-008).
 *
 * The page must:
 *  - AC1: render an "AI Extract" button inside the existing browser chrome
 *    that triggers the app-store's extract action against the currently
 *    loaded listing.
 *  - AC2: render a live progress line that surfaces phase updates
 *    ("Found N jobs", "Extracted x/y") and a final summary
 *    ("Imported X of Y listed"); on failure it surfaces an error state.
 *  - AC3: the AI Extract button is disabled while a run is in flight
 *    (bound to `store.isExtracting`) and re-enabled when it finishes.
 *  - AC4: styling reuses the existing Studio system — no new tokens or
 *    Quasar components introduced; the button sits inside `.chrome`.
 *
 * Following the precedent set by DiscoverPage.test.ts and
 * DiscoverPage.brwsr005.test.ts: regex scans of the .vue source file.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DISCOVER = readFileSync(
  path.join(__dirname, 'DiscoverPage.vue'),
  'utf8',
);

describe('DiscoverPage — AI Extract button (EXTR-008 AC1)', () => {
  it('renders an "AI Extract" button inside the existing browser chrome', () => {
    // The button must live inside the .chrome row that already hosts the
    // back/forward chevrons and URL pill — not as a separate panel.
    expect(DISCOVER).toMatch(/class="chrome"[\s\S]*AI Extract[\s\S]*<\/section>/);
    // The label "AI Extract" must appear verbatim.
    expect(DISCOVER).toMatch(/AI Extract/);
  });

  it('wires the AI Extract button click to the store extract action', () => {
    // The click handler must drive the store action that owns the run
    // (triggerExtract) — not a hand-rolled call to window.starExtract.
    expect(DISCOVER).toMatch(/triggerExtract\(\)/);
    // And the handler must be bound to a button via @click.
    expect(DISCOVER).toMatch(/<button[^>]*@click[^>]*>[\s\S]*?AI Extract[\s\S]*?<\/button>/);
  });

  it('subscribes to live progress events on mount and unsubscribes on unmount', () => {
    // The page must opt into the extract:progress stream so the progress
    // line updates as events arrive, and clean up to avoid stray handlers.
    expect(DISCOVER).toMatch(/subscribeExtractProgress\(\)/);
    expect(DISCOVER).toMatch(/unsubscribeExtractProgress\(\)/);
  });
});

describe('DiscoverPage — live progress line (EXTR-008 AC2)', () => {
  it('renders a progress region driven by the store extractProgress snapshot', () => {
    // The progress line must be reactive to the store's extractProgress
    // (or its derived message) — not a static placeholder.
    expect(DISCOVER).toMatch(/extractProgress/);
    // It must be conditionally rendered so an idle page does not show it.
    expect(DISCOVER).toMatch(/v-if="(?:store\.)?(?:isExtracting|extractProgress|progressMessage|extractError)/);
  });

  it('formats the "Found N jobs" phase update', () => {
    // Either via a literal template or a computed/helper, the page must
    // emit the "Found … jobs" copy when surfacing the discover/dedup phase.
    expect(DISCOVER).toMatch(/Found\s+\$\{[^}]+\}\s+jobs|Found\s+\{\{[^}]+\}\}\s+jobs|`Found \$\{[^}]+\} jobs`/);
  });

  it('formats the "Extracted x/y" phase update', () => {
    expect(DISCOVER).toMatch(/Extracted\s+\$\{[^}]+\}\s*\/\s*\$\{[^}]+\}|Extracted\s+\{\{[^}]+\}\}/);
  });

  it('formats the final "Imported X of Y listed" summary', () => {
    expect(DISCOVER).toMatch(/Imported\s+\$\{[^}]+\}\s+of\s+\$\{[^}]+\}\s+listed|Imported\s+\{\{[^}]+\}\}\s+of\s+\{\{[^}]+\}\}\s+listed/);
  });

  it('shows an error state when the run fails', () => {
    // The page must render an error message bound to store.extractError
    // (separately from loadError, which is reserved for navigation failures).
    expect(DISCOVER).toMatch(/extractError/);
    expect(DISCOVER).toMatch(/role="alert"|class="[^"]*error/);
  });
});

describe('DiscoverPage — disabled-while-running (EXTR-008 AC3)', () => {
  it('binds the AI Extract button :disabled to store.isExtracting', () => {
    // The button must reflect the in-flight state so it cannot be clicked
    // twice in a row.
    expect(DISCOVER).toMatch(/<button[^>]*:disabled="(?:store\.)?isExtracting"[^>]*>[\s\S]*?AI Extract/);
  });
});

describe('DiscoverPage — Studio visual system (EXTR-008 AC4)', () => {
  it('reuses existing Studio CSS variables (no new colour tokens introduced)', () => {
    // The progress + button styling must lean on var(--…) tokens that the
    // page already uses — no new colour literals.
    expect(DISCOVER).toMatch(/var\(--/);
  });

  it('does not introduce new Quasar components beyond the existing q-select', () => {
    expect(DISCOVER).not.toMatch(/<q-btn\b/);
    expect(DISCOVER).not.toMatch(/<q-spinner\b/);
    expect(DISCOVER).not.toMatch(/<q-banner\b/);
    expect(DISCOVER).not.toMatch(/<q-linear-progress\b/);
    expect(DISCOVER).not.toMatch(/<q-card\b/);
  });
});
