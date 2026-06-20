/**
 * Unit tests for EVAL-006 — Eval report view.
 *
 * Covers:
 *  AC1 — header (Epic 5 stars/% + archetype + legitimacy chip + verification
 *        line + provenance) and collapsible Blocks A–H.
 *  AC2 — Block B reuses the Epic 6 AI Match Review; D renders comp table +
 *        sources list; G renders signal table + confidence; E/F/H are launch
 *        CTAs (Tailor / Interview-Prep / Cover-letter-apply).
 *  AC3 — stale banner + Regenerate; Markdown Export; per-code error/loading
 *        states.
 *  AC4 — no LLM number is shown anywhere; advisory badging is distinct from
 *        deterministic stars.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PAGE = readFileSync(path.join(__dirname, 'EvalReportPage.vue'), 'utf8');
const ROUTES = readFileSync(
  path.join(__dirname, '..', 'router', 'routes.ts'),
  'utf8',
);
const STARRED = readFileSync(path.join(__dirname, 'StarredPage.vue'), 'utf8');

describe('EvalReportPage — AC1 header + collapsible Blocks A–H', () => {
  it('renders the deterministic Epic 5 StarRating (the only numeric rating)', () => {
    expect(PAGE).toMatch(/import\s+StarRating/);
    expect(PAGE).toMatch(/<StarRating\b/);
  });

  it('renders a legitimacy chip bound to the persisted verdict', () => {
    expect(PAGE).toMatch(/legitimacyVerdict/);
    expect(PAGE).toMatch(/eval-legitimacy-chip/);
  });

  it('renders a verification line bound to the persisted note', () => {
    expect(PAGE).toMatch(/verificationNote/);
    expect(PAGE).toMatch(/eval-verification-line/);
  });

  it('shows provenance (model slug + generated date)', () => {
    expect(PAGE).toMatch(/eval-provenance/);
    expect(PAGE).toMatch(/modelSlug/);
    expect(PAGE).toMatch(/generatedAt/);
  });

  it('renders an archetype line in the header', () => {
    expect(PAGE).toMatch(/archetype/i);
  });

  it('declares collapsible sections A through H', () => {
    for (const code of ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H']) {
      const re = new RegExp(`data-block="${code}"`);
      expect(PAGE).toMatch(re);
    }
    // Sections are collapsible — q-expansion-item or a v-bound :model/open state.
    expect(PAGE).toMatch(/q-expansion-item|collaps/i);
  });

  it('registers an /eval route for the report view', () => {
    expect(ROUTES).toMatch(/name:\s*['"]eval['"]/);
    expect(ROUTES).toMatch(/EvalReportPage\.vue/);
  });

  it('starred-tile click on Eval navigates to the new route', () => {
    expect(STARRED).toMatch(/name:\s*['"]eval['"]/);
  });
});

describe('EvalReportPage — AC2 block content', () => {
  it('Block B reuses the Epic 6 AI Match Review (requirements/gaps/strengths)', () => {
    expect(PAGE).toMatch(/data-block="B"/);
    // Reused review fields from StarMatchReview.
    expect(PAGE).toMatch(/requirements/);
    expect(PAGE).toMatch(/gaps/);
    expect(PAGE).toMatch(/strengths/);
  });

  it('Block D renders a comp table and a sources list', () => {
    expect(PAGE).toMatch(/eval-comp-table/);
    expect(PAGE).toMatch(/eval-d-sources/);
    // Comp table compares stated vs expectation.
    expect(PAGE).toMatch(/statedCompensation|Stated/);
    expect(PAGE).toMatch(/compensationExpectation|Expectation/);
  });

  it('Block G renders a signal table + confidence', () => {
    expect(PAGE).toMatch(/eval-signal-table/);
    expect(PAGE).toMatch(/confidence/i);
  });

  it('Blocks E, F, H are launch CTAs (Tailor, Interview-Prep, Cover-letter-apply)', () => {
    expect(PAGE).toMatch(/data-cta="tailor"/);
    expect(PAGE).toMatch(/data-cta="interview-prep"/);
    expect(PAGE).toMatch(/data-cta="cover-letter-apply"/);
  });
});

describe('EvalReportPage — AC3 stale + Regenerate + Export + states', () => {
  it('renders a stale banner gated on the persisted stale flag', () => {
    expect(PAGE).toMatch(/eval-stale-banner/);
    expect(PAGE).toMatch(/isEvalReportStale|report\.stale/);
  });

  it('exposes a Regenerate button that calls generateEval', () => {
    expect(PAGE).toMatch(/Regenerate/);
    expect(PAGE).toMatch(/generateEval\(/);
  });

  it('exposes an Export (Markdown) action that composes the report', () => {
    expect(PAGE).toMatch(/eval-export-md/);
    expect(PAGE).toMatch(/Markdown/);
  });

  it('renders per-code error states off the StarEvalErrorCode union', () => {
    for (const code of [
      'NO_API_KEY',
      'MODEL_NOT_CAPABLE',
      'RATE_LIMITED',
      'NETWORK',
      'NO_SCORE',
    ]) {
      const re = new RegExp(code);
      expect(PAGE).toMatch(re);
    }
  });

  it('renders a loading state while the orchestrator is in flight', () => {
    expect(PAGE).toMatch(/eval-loading/);
    expect(PAGE).toMatch(/'loading'/);
  });
});

describe('EvalReportPage — AC4 no LLM number, advisory ≠ deterministic', () => {
  it('uses score.percent / score.stars (deterministic) but never a numeric field on the eval report', () => {
    // Deterministic rating is allowed.
    expect(PAGE).toMatch(/score\.stars/);
    // EvalReport has no numeric fields by construction — none of these may
    // appear in the page template/script.
    expect(PAGE).not.toMatch(/report\.(percent|score|rating|stars)/);
  });

  it('renders an "AI · advisory" badge distinct from the deterministic stars', () => {
    expect(PAGE).toMatch(/eval-advisory-badge/);
    expect(PAGE).toMatch(/advisory/i);
  });
});
