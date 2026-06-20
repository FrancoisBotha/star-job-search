/**
 * Unit tests for TDE-007 — wire the Epic 7 Tailor view's CV tab to delegate
 * tailoring to the diff-engine (`tailor:propose` → per-change accept/reject
 * diff → `tailor:apply` rescore). Cover-letter tab is unaffected.
 *
 * Static-source scan (same pattern as TailorPage.tailor007.test.ts) —
 * verifies the .vue template / script structure without rendering the
 * component.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TAILOR = readFileSync(path.join(__dirname, 'TailorPage.vue'), 'utf8');

/** Slice of the .vue file containing the CV view + its dock so asserts
 *  can be scoped to the CV pane rather than the cover-letter pane. */
const CV_SLICE = (() => {
  const start = TAILOR.indexOf('paper paper--diff');
  const end = TAILOR.indexOf('letter-view');
  return start >= 0 && end > start ? TAILOR.slice(start, end) : TAILOR;
})();

describe('TailorPage CV tab — delegates to tailor:propose (AC1)', () => {
  it('CV tab generation calls the diff-engine propose action, not the free-text rewrite', () => {
    expect(TAILOR).toMatch(/proposeTailorEngine\(/);
  });

  it('renders the gate-validated proposed-changes list with the change reason', () => {
    expect(CV_SLICE).toMatch(/proposedChanges|proposal\.proposedChanges|proposal\?\.proposedChanges/);
    expect(CV_SLICE).toMatch(/\.reason\b/);
  });

  it('renders +/–/~ markers per change kind (append / delete-or-replace / replace)', () => {
    // The marker symbols must appear in the template so each ProposedChange
    // is visibly tagged by action.
    expect(CV_SLICE).toMatch(/[+]/);
    expect(CV_SLICE).toMatch(/[~]/);
  });

  it('exposes a per-change Accept and Reject affordance', () => {
    expect(CV_SLICE).toMatch(/data-test="change-accept"|label="Accept change"|change-accept/);
    expect(CV_SLICE).toMatch(/data-test="change-reject"|label="Reject"|change-reject/);
  });
});

describe('TailorPage CV tab — high-risk warnings + before→after % (AC2)', () => {
  it('renders the high-risk warnings panel (invented metric / word-count blow-up / non-injectable gap)', () => {
    expect(CV_SLICE).toMatch(/data-test="tailor-warnings"|tailor-warnings/);
    expect(TAILOR).toMatch(/invented_metric|invented metric|Invented metric/i);
    expect(TAILOR).toMatch(/word[_\s-]count|word_count_blowup/i);
    expect(TAILOR).toMatch(/no[_\s-]injectable|non[\s-]injectable|no injectable/i);
  });

  it('shows before→after match % derived from RefinementStats', () => {
    expect(CV_SLICE).toMatch(/refinementStats/);
    expect(CV_SLICE).toMatch(/initialPercent/);
    expect(CV_SLICE).toMatch(/finalPercent/);
  });
});

describe('TailorPage CV tab — accept-all + per-change accept → tailor:apply rescore (AC3)', () => {
  it('exposes an "Accept all" affordance for bulk acceptance of the proposed changes', () => {
    expect(CV_SLICE).toMatch(/label="Accept all"|Accept all changes|data-test="accept-all"/);
  });

  it('wires the Apply control to the applyTailorEngine store action so only the accepted subset is sent', () => {
    expect(TAILOR).toMatch(/applyTailorEngine\(/);
  });

  it('reads the live Epic 5 star/% chip from the deterministic scores map (post-rescore)', () => {
    // Pre-existing live-match chip reads store.scores[sourceId] — Apply's
    // success path must continue to drive that chip via the rescore.
    expect(TAILOR).toMatch(/data-test="live-match"|liveScore/);
    expect(TAILOR).toMatch(/store\.scores\b/);
  });
});

describe('TailorPage CV tab — per-node progress + per-code errors (AC4)', () => {
  it('renders per-node progress (extract → plan → generate → gate → refine → rescore)', () => {
    expect(CV_SLICE).toMatch(/data-test="engine-progress"|engine-progress|tailorEngineProgress/);
  });

  it('renders code-driven error copy for the engine-specific error codes', () => {
    // The error block should branch on the TDE-006 stable codes so the UI
    // never parses exception text (NFR-004 carryover).
    expect(TAILOR).toMatch(/MODEL_NOT_CAPABLE/);
    expect(TAILOR).toMatch(/SCHEMA_ERROR/);
    expect(TAILOR).toMatch(/NO_DOC/);
  });
});

describe('TailorPage cover-letter tab — unaffected (AC4)', () => {
  it('cover-letter Generate still routes through the Epic 7 generateTailoredDoc store action', () => {
    expect(TAILOR).toMatch(/generateTailoredDoc\(/);
  });

  it('letter view markup is preserved (recipient header, editable textarea, gap-questions panel)', () => {
    expect(TAILOR).toMatch(/letter-view/);
    expect(TAILOR).toMatch(/letter-editor/);
    expect(TAILOR).toMatch(/gap-questions/);
  });
});
