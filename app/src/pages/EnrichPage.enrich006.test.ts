/**
 * Unit tests for ENRICH-006 — CV Enrichment screen + sidebar + route.
 *
 * Static-source checks mirroring EvalReportPage.eval006.test.ts. The
 * EnrichPage is a 3-step Analyze → Questions → Review flow that reuses the
 * Epic 9 / TDE-005 diff UI from the Tailor view's CV tab for Step 3.
 *
 * AC1 — Sidebar 'CV Enrichment' item in SETUP group + '/enrich' route +
 *       window.starEnrich bridge wiring through the app store.
 * AC2 — Step 1 Analyze: weak items list, each with a reason.
 * AC3 — Step 2 Questions: 2–6 metric-discovery questions with answer inputs
 *       and an explicit skip / 'I don't have that number' option.
 * AC4 — Step 3 Review: proposed enriched bullets as accept/reject diff vs the
 *       current CV with provenance labels; Apply shows 'CV updated (v{n})'.
 * AC5 — Empty/disabled states: no-CV and no-key disable the feature with a
 *       clear reason.
 * AC6 — Loading + error states for each of the four async steps
 *       (analyze / questions / propose / apply).
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PAGE = readFileSync(path.join(__dirname, 'EnrichPage.vue'), 'utf8');
const ROUTES = readFileSync(
  path.join(__dirname, '..', 'router', 'routes.ts'),
  'utf8',
);
const LAYOUT = readFileSync(
  path.join(__dirname, '..', 'layouts', 'MainLayout.vue'),
  'utf8',
);
const STORE = readFileSync(
  path.join(__dirname, '..', 'stores', 'app-store.ts'),
  'utf8',
);

describe('ENRICH-006 AC1 — sidebar + route + bridge wiring', () => {
  it('registers a /enrich route bound to EnrichPage.vue', () => {
    expect(ROUTES).toMatch(/name:\s*['"]enrich['"]/);
    expect(ROUTES).toMatch(/EnrichPage\.vue/);
    expect(ROUTES).toMatch(/path:\s*['"]enrich['"]/);
  });

  it('adds the CV Enrichment sidebar item in the SETUP group', () => {
    expect(LAYOUT).toMatch(/CV Enrichment/);
    expect(LAYOUT).toMatch(/name:\s*['"]enrich['"]/);
    // setupNav holds the item alongside profile/help/settings.
    expect(LAYOUT).toMatch(/setupNav/);
  });

  it('wires the window.starEnrich bridge through the app store', () => {
    expect(STORE).toMatch(/window\.starEnrich/);
    expect(STORE).toMatch(/analyzeEnrichment/);
    expect(STORE).toMatch(/generateEnrichmentQuestions/);
    expect(STORE).toMatch(/proposeEnrichment/);
    expect(STORE).toMatch(/applyEnrichment/);
  });

  it('renders a screen title for the enrich route in the title bar', () => {
    expect(LAYOUT).toMatch(/enrich:/);
  });
});

describe('ENRICH-006 AC2 — Step 1 Analyze surfaces weak items + reasons', () => {
  it('renders a step indicator showing Analyze · Questions · Review', () => {
    expect(PAGE).toMatch(/data-test="enrich-stepper"/);
    expect(PAGE).toMatch(/Analyze/);
    expect(PAGE).toMatch(/Questions/);
    expect(PAGE).toMatch(/Review/);
  });

  it('lists each weak bullet candidate with its reason', () => {
    expect(PAGE).toMatch(/data-test="enrich-weak-list"/);
    expect(PAGE).toMatch(/data-test="enrich-weak-item"/);
    // Each row binds to the candidate's reason field.
    expect(PAGE).toMatch(/\.reason/);
    expect(PAGE).toMatch(/\.text/);
  });
});

describe('ENRICH-006 AC3 — Step 2 Questions with skip / no-number affordance', () => {
  it('renders each question with an answer input', () => {
    expect(PAGE).toMatch(/data-test="enrich-question"/);
    expect(PAGE).toMatch(/data-test="enrich-answer-input"/);
  });

  it("exposes an explicit skip / 'I don't have that number' option per question", () => {
    expect(PAGE).toMatch(/data-test="enrich-skip"/);
    expect(PAGE).toMatch(/don't have that number|don&#39;t have that number|no number/i);
  });

  it('mentions that skipped bullets are minimally reworded and never invented', () => {
    expect(PAGE).toMatch(/minimally reworded|never invent|won't invent/i);
  });
});

describe('ENRICH-006 AC4 — Step 3 Review accept/reject diff + Apply', () => {
  it('renders the proposed-changes diff list reusing the Epic 9 marker pattern', () => {
    expect(PAGE).toMatch(/data-test="enrich-proposal"/);
    expect(PAGE).toMatch(/data-test="enrich-proposed-change"/);
    // Reuses the +/~/– marker legend from the TDE-007 CV tab (Epic 9 §8).
    expect(PAGE).toMatch(/\+\s*add/);
    expect(PAGE).toMatch(/~\s*replace/);
  });

  it('exposes Accept / Reject controls per change and an Apply button', () => {
    expect(PAGE).toMatch(/data-test="enrich-change-accept"/);
    expect(PAGE).toMatch(/data-test="enrich-change-reject"/);
    expect(PAGE).toMatch(/data-test="enrich-apply"/);
  });

  it('renders provenance labels (from your answer / minimal reword)', () => {
    expect(PAGE).toMatch(/data-test="enrich-provenance"/);
    expect(PAGE).toMatch(/provenance/);
  });

  it("shows 'CV updated (v{n})' after Apply succeeds", () => {
    expect(PAGE).toMatch(/data-test="enrich-applied"/);
    expect(PAGE).toMatch(/CV updated/);
    // Binds to the new CV version number.
    expect(PAGE).toMatch(/v\{\{|version/);
  });
});

describe('ENRICH-006 AC5 — empty/disabled states for no-CV and no-key', () => {
  it('renders a no-CV disabled state with a clear reason', () => {
    expect(PAGE).toMatch(/data-test="enrich-no-cv"/);
    expect(PAGE).toMatch(/Upload a CV|No CV/i);
  });

  it('renders a no-key disabled state with a clear reason', () => {
    expect(PAGE).toMatch(/data-test="enrich-no-key"/);
    expect(PAGE).toMatch(/OpenRouter|API key/);
  });
});

describe('ENRICH-006 AC6 — loading + error states for each async step', () => {
  it('renders a loading state for each of the four async steps', () => {
    expect(PAGE).toMatch(/data-test="enrich-analyze-loading"/);
    expect(PAGE).toMatch(/data-test="enrich-questions-loading"/);
    expect(PAGE).toMatch(/data-test="enrich-propose-loading"/);
    expect(PAGE).toMatch(/data-test="enrich-apply-loading"/);
  });

  it('renders code-driven error copy off the StarEnrichErrorCode union', () => {
    expect(PAGE).toMatch(/data-test="enrich-error"/);
    for (const code of [
      'NO_API_KEY',
      'NO_DEFAULT_MODEL',
      'NO_CV',
      'MODEL_NOT_CAPABLE',
      'RATE_LIMITED',
      'NETWORK',
      'LLM_ERROR',
    ]) {
      const re = new RegExp(code);
      expect(PAGE).toMatch(re);
    }
  });
});
