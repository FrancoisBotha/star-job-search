/**
 * Unit tests for TAILOR-007 (Cover-letter tab) — the cover-letter view
 * renders a generated letter grounded in the candidate's real CV and the
 * JD's role + company, exposes the letter as a fully editable in-place
 * field, surfaces material gaps (domain, start date, seniority, language)
 * as confirm-with-the-user questions rather than silently papering over
 * them, supports Copy + Export as plain text AND Markdown, has no
 * submission affordance, and reuses the Studio visual system + the
 * provenance/advisory badging from the CV tab without introducing new
 * design tokens.
 *
 * Static-source scan (same pattern as TailorPage.tailor006.test.ts) —
 * verifies the .vue template / script structure without rendering the
 * component.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TAILOR = readFileSync(path.join(__dirname, 'TailorPage.vue'), 'utf8');

/** Slice of the .vue file containing the cover-letter view + its dock so
 *  asserts can be scoped to the letter pane rather than the CV pane. */
const COVER_SLICE = (() => {
  const start = TAILOR.indexOf('letter-view');
  // The slice extends to the end of the template — the dock for the
  // cover-letter tab lives below the canvas pane in the same template.
  return start >= 0 ? TAILOR.slice(start) : '';
})();

describe('TailorPage cover-letter tab — generated letter grounded in real CV + JD (AC1)', () => {
  it('renders a dedicated cover-letter view bound to the persisted draft', () => {
    expect(TAILOR).toMatch(/letter-view/);
    expect(TAILOR).toMatch(/cover-letter/);
  });

  it('shows the JD company + title context near the letter so it is clear who/what it targets', () => {
    // The letter view exposes the recipient (company + title) so the
    // reader can see the JD context the draft was tailored to.
    expect(TAILOR).toMatch(/letter-(?:to|company|title)|jobCompany|jobTitle/);
  });
});

describe('TailorPage cover-letter tab — fully editable in-place (AC2)', () => {
  it('renders an editable element (textarea or contenteditable) bound to the draft content', () => {
    expect(COVER_SLICE).toMatch(/<textarea\b|contenteditable=/);
  });

  it('writes edits back into the cached draft via v-model on the editable element', () => {
    expect(COVER_SLICE).toMatch(/v-model[^=]*="\s*letterContent\s*"|v-model="letterContent"/);
  });
});

describe('TailorPage cover-letter tab — material gaps surfaced as questions (AC3)', () => {
  it('renders a dedicated "Open questions" / gap-questions panel for material gaps', () => {
    expect(TAILOR).toMatch(/gap-questions|Open questions|Confirm these gaps/);
  });

  it('explicitly mentions the FR-011 gap categories (domain, start date, seniority, language) in the panel', () => {
    const lower = TAILOR.toLowerCase();
    expect(lower).toMatch(/domain/);
    expect(lower).toMatch(/start date/);
    expect(lower).toMatch(/seniority/);
    expect(lower).toMatch(/language/);
  });

  it('exposes a per-question Confirm and Not applicable affordance — user answers, not silent acceptance', () => {
    expect(TAILOR).toMatch(/label="Confirm"|Confirm answer/);
    expect(TAILOR).toMatch(/Not applicable|N\/A|label="Skip"/);
  });
});

describe('TailorPage cover-letter tab — grounding + no-fabrication badging (AC4)', () => {
  it('reuses the provenance "AI draft · advisory" badge from the CV tab on the cover-letter pane', () => {
    expect(COVER_SLICE).toMatch(/AI draft/);
    expect(COVER_SLICE).toMatch(/advisory/);
  });

  it('keeps the modelSlug + base CV version surfaced on the cover-letter pane', () => {
    expect(COVER_SLICE).toMatch(/modelSlug/);
    expect(COVER_SLICE).toMatch(/built from CV/);
  });
});

describe('TailorPage cover-letter tab — Copy + Export-as-text/Markdown, no submission (AC5)', () => {
  it('renders Copy + Export-as-text + Export-as-Markdown controls', () => {
    expect(TAILOR).toMatch(/label="Copy"/);
    expect(TAILOR).toMatch(/Export text|Export plain text|label="Export text"/);
    expect(TAILOR).toMatch(/Export Markdown|label="Export Markdown"/);
  });

  it('has no submit / apply / send affordance anywhere (FR-015)', () => {
    expect(TAILOR).not.toMatch(/label="Apply"/);
    expect(TAILOR).not.toMatch(/label="Submit"/);
    expect(TAILOR).not.toMatch(/label="Send"/);
  });
});

describe('TailorPage cover-letter tab — Studio visual system reuse, no new tokens (AC6)', () => {
  it('reuses existing CSS variables (var(--...)) rather than declaring new design tokens', () => {
    expect(TAILOR).toMatch(/var\(--/);
    // No `--star-letter-*` or similar new custom-property declarations
    // introduced specifically for the letter pane.
    expect(TAILOR).not.toMatch(/--star-letter-/);
  });
});
