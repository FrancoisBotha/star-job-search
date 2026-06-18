/**
 * Unit tests for JobDetailDialog.vue — AI Match Review section (AIREV-005).
 *
 * Mirrors the regex-scan precedent used by the other JobDetailDialog tests
 * in this repo (no @vue/test-utils). Asserts the AI Match Review section
 * structure, badging, state branches, and the strict "no number/star/percent"
 * boundary against the AI narrative (Epic 6 hard rule / NFR-001).
 *
 * Acceptance criteria covered:
 *  1. An "AI Match Review" section appears in the Job-detail modal,
 *     beneath/beside the deterministic breakdown and visually distinct from
 *     the Epic 5 stars (FR-006).
 *  2. Empty state shows a Generate review control; generated state renders
 *     the structured narrative (summary, requirements→evidence with met /
 *     not found, gaps with severity + mitigation, strengths, keywords).
 *  3. The section is unmistakably badged AI + "advisory" with provenance
 *     "AI review · {model} · {date}"; the AI narrative renders no star,
 *     number, or percentage from the AI (NFR-001).
 *  4. Stale state shows "may be out of date — regenerate"; a regenerate
 *     affordance is always available once a review is cached.
 *  5. States covered: loading spinner during generation; specific messages
 *     for NO_API_KEY / LLM_ERROR / MODEL_NOT_CAPABLE / RATE_LIMITED.
 *  6. The deterministic Epic 5 stars remain visually dominant; the AI
 *     section never reads or renders score/percent from the AI review.
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

describe('JobDetailDialog — AI Match Review section (AIREV-005 AC1 / FR-006)', () => {
  it('renders an "AI Match Review" section heading in the dialog', () => {
    expect(SRC).toMatch(/AI Match Review/);
  });

  it('reads the cached review from the app-store by sourceId (reuses AIREV-004 state)', () => {
    expect(SRC).toMatch(/store\.reviews\[/);
  });

  it('keeps the deterministic Epic 5 score block (StarRating + ScoreBar) present', () => {
    // The AI section must be additive — the deterministic stars remain.
    expect(SRC).toMatch(/<StarRating\b/);
    expect(SRC).toMatch(/<ScoreBar\b/);
  });
});

describe('JobDetailDialog — empty-state Generate control (AIREV-005 AC2)', () => {
  it('exposes a Generate review control wired to store.generateReview', () => {
    expect(SRC).toMatch(/Generate review|Generate Review/i);
    expect(SRC).toMatch(/store\.generateReview\(/);
  });

  it('gates the first send behind the Epic 4 "what is sent" disclosure', () => {
    // The disclosure flag must be consulted in the template / handler before
    // the bridge is invoked — the Onboarding CV review screen flag is reused.
    expect(SRC).toMatch(/reviewDisclosureAcknowledged|acknowledgeReviewDisclosure/);
  });
});

describe('JobDetailDialog — narrative render (AIREV-005 AC2)', () => {
  it('renders the one-line fit summary (words only)', () => {
    expect(SRC).toMatch(/review\.summary|summary/);
  });

  it('iterates requirements with evidence and met / not found labels', () => {
    expect(SRC).toMatch(/v-for="[^"]*\brequirements?\b[^"]*"/);
    expect(SRC).toMatch(/\bevidence\b/);
    expect(SRC).toMatch(/not found/i);
    expect(SRC).toMatch(/\bmet\b/i);
  });

  it('iterates gaps with severity (blocker / nice-to-have) and mitigation', () => {
    expect(SRC).toMatch(/v-for="[^"]*\bgaps?\b[^"]*"/);
    expect(SRC).toMatch(/blocker/i);
    expect(SRC).toMatch(/nice[- ]to[- ]have/i);
    expect(SRC).toMatch(/mitigation/);
  });

  it('iterates strengths and keywords', () => {
    expect(SRC).toMatch(/v-for="[^"]*\bstrengths?\b[^"]*"/);
    expect(SRC).toMatch(/v-for="[^"]*\bkeywords?\b[^"]*"/);
  });
});

describe('JobDetailDialog — AI / advisory badging + provenance (AIREV-005 AC3 / NFR-001)', () => {
  it('renders an unmistakable AI badge + the word "advisory"', () => {
    expect(SRC).toMatch(/\bAI\b/);
    expect(SRC).toMatch(/advisory/i);
  });

  it('renders provenance "AI review · {model} · {date}" using the cached modelSlug + generatedAt', () => {
    expect(SRC).toMatch(/AI review/i);
    expect(SRC).toMatch(/modelSlug/);
    expect(SRC).toMatch(/generatedAt/);
  });

  it('never reads score/percent/stars from the AI review object (NFR-001 hard boundary)', () => {
    // Permitted: score.stars / score.percent (deterministic Epic 5 block).
    // Forbidden: review.score / review.stars / review.percent — those fields
    // do not exist on StarMatchReview by construction and must not be added.
    expect(SRC).not.toMatch(/review\.score\b/);
    expect(SRC).not.toMatch(/review\.stars\b/);
    expect(SRC).not.toMatch(/review\.percent\b/);
  });
});

describe('JobDetailDialog — stale + regenerate (AIREV-005 AC4)', () => {
  it('shows "may be out of date — regenerate" when the cached review is stale', () => {
    expect(SRC).toMatch(/may be out of date/i);
  });

  it('always exposes a regenerate affordance once a review is cached', () => {
    expect(SRC).toMatch(/[Rr]egenerate/);
  });
});

describe('JobDetailDialog — loading + per-code error states (AIREV-005 AC5)', () => {
  it('renders a loading spinner / loading state while the generate call is in flight', () => {
    // q-spinner / "Generating" / a loading branch on the reviewState.
    expect(SRC).toMatch(/q-spinner|Generating|loading/i);
  });

  it('renders specific messages keyed by the stable error code (NO_API_KEY / MODEL_NOT_CAPABLE / LLM_ERROR / RATE_LIMITED)', () => {
    expect(SRC).toMatch(/NO_API_KEY/);
    expect(SRC).toMatch(/MODEL_NOT_CAPABLE/);
    expect(SRC).toMatch(/LLM_ERROR/);
    expect(SRC).toMatch(/RATE_LIMITED|rate[- ]limited/i);
  });

  it('reads the per-job generate state via the AIREV-004 selector', () => {
    expect(SRC).toMatch(/reviewGenerateStateFor|reviewStates\[/);
  });
});

describe('JobDetailDialog — deterministic stars remain authoritative (AIREV-005 AC6)', () => {
  it('keeps the Epic 5 score breakdown header and per-factor breakdown intact', () => {
    expect(SRC).toMatch(/Score breakdown/);
    expect(SRC).toMatch(/score\.factors/);
    expect(SRC).toMatch(/score\.stars/);
    expect(SRC).toMatch(/score\.percent/);
  });
});
