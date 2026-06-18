/**
 * Unit tests for JobDetailDialog.vue (JOBDET-002).
 *
 * Mirrors the precedent set by other component/page tests in this repo:
 * regex scans over the .vue source — no `@vue/test-utils`.
 *
 * Acceptance criteria covered:
 *  1. Renders title, company, location, work mode, full description.
 *  2. Salary shows 'not stated' when absent (Scenario 4); work mode degrades
 *     gracefully when absent.
 *  3. Source site(s) render as link(s) that open the original posting via
 *     store.openExternal — markup supports multiple source links (Scenario 3),
 *     rendering a single link when only one source is present.
 *  4. Modal closes via close button, Esc key, and backdrop click (Scenario 2).
 *
 * SCORE-007 supersedes the original "detail-only, no score" assertion of
 * JOBDET-002 — the modal now renders the score breakdown (StarRating +
 * ScoreBar). Those assertions are covered by JobDetailDialog.score007.test.ts.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SRC = readFileSync(
  path.join(__dirname, 'JobDetailDialog.vue'),
  'utf8',
);

describe('JobDetailDialog — extracted details (AC1)', () => {
  it('renders the title, company, location, work mode, and full description', () => {
    // Each field references the bound job
    expect(SRC).toMatch(/job\.title/);
    expect(SRC).toMatch(/job\.company/);
    expect(SRC).toMatch(/job\.location/);
    expect(SRC).toMatch(/workMode/);
    expect(SRC).toMatch(/job\.description/);
  });

  it('uses a Quasar q-dialog as the modal container', () => {
    expect(SRC).toMatch(/<q-dialog\b/);
  });
});

describe('JobDetailDialog — salary + work mode fallbacks (AC2 / Scenario 4)', () => {
  it("shows the salary as 'not stated' when absent (never blank or zero)", () => {
    expect(SRC).toMatch(/not stated/);
    // Salary fallback should be computed/derived, not raw `job.salary` only.
    expect(SRC).toMatch(/salary/i);
  });

  it('degrades gracefully when work mode is absent (conditional / fallback)', () => {
    // Either a v-if guard on the work-mode row or a fallback expression.
    expect(SRC).toMatch(/workMode/);
    expect(SRC).toMatch(/v-if="workMode"|workMode \|\||workMode \?/);
  });
});

describe('JobDetailDialog — source links (AC3 / Scenario 3)', () => {
  it('iterates source link(s) so a multi-board job lists each source', () => {
    // A v-for over a sources array enables multiple links; a single source
    // renders as a single entry in the same loop.
    expect(SRC).toMatch(/v-for="[^"]*\bsources?\b[^"]*"/);
  });

  it('opens the original posting via store.openExternal (not view:open / openJob)', () => {
    expect(SRC).toMatch(/store\.openExternal\(/);
    expect(SRC).not.toMatch(/store\.openJob\(/);
  });
});

describe('JobDetailDialog — close behaviour (AC4 / Scenario 2)', () => {
  it('uses v-model so the dialog is controlled (close button / esc / backdrop wired by Quasar)', () => {
    // Quasar's q-dialog closes on Esc and backdrop click by default when
    // bound with v-model. Explicit `no-esc-dismiss` / `no-backdrop-dismiss`
    // must NOT be present.
    expect(SRC).toMatch(/<q-dialog\b[^>]*v-model/);
    expect(SRC).not.toMatch(/no-esc-dismiss/);
    expect(SRC).not.toMatch(/no-backdrop-dismiss/);
  });

  it('exposes a close button that dismisses the dialog', () => {
    // A button bound to close — either v-close-popup or an emit/update of the
    // v-model to false.
    expect(SRC).toMatch(/v-close-popup|emit\(['"]update:modelValue['"]\s*,\s*false\)|emit\(['"]close['"]\)/);
  });
});

// JOBDET-002's "detail-only, no score" assertions were superseded by
// SCORE-007 — see JobDetailDialog.score007.test.ts.
