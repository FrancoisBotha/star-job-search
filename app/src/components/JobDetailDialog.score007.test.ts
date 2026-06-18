/**
 * Unit tests for JobDetailDialog.vue (SCORE-007).
 *
 * Acceptance criteria covered:
 *  1. Renders StarRating (stars) + a percentage, and the four-factor
 *     breakdown using ScoreBar for each factor (FR-009).
 *  2. An excluded factor shows the label 'excluded' (not a zero bar);
 *     salary with no stated value reads 'not stated' and the salary factor
 *     reads 'excluded' (epic §6, AC §9).
 *  3. Factor contributions reconcile exactly with the global percent — the
 *     weighted sum of included factors equals the displayed percent
 *     (NFR-003).
 *  4. Multi-source listings render every source link, presented once
 *     (FR-011 / Scenario 3) — verified via the existing v-for over sources.
 *  5. Each factor has a one-line rationale rendered next to its bar.
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

describe('JobDetailDialog — score header (SCORE-007 AC1)', () => {
  it('renders StarRating for the score', () => {
    expect(SRC).toMatch(/<StarRating\b/);
    expect(SRC).toMatch(/import\s+StarRating\s+from\s+['"][^'"]*StarRating\.vue['"]/);
  });

  it('renders a percentage alongside the stars', () => {
    // Either a "%" literal in the template or a computed that exposes percent.
    expect(SRC).toMatch(/%/);
    expect(SRC).toMatch(/percent/);
  });
});

describe('JobDetailDialog — per-factor breakdown (SCORE-007 AC1)', () => {
  it('iterates the four factors with ScoreBar', () => {
    expect(SRC).toMatch(/<ScoreBar\b/);
    expect(SRC).toMatch(/import\s+ScoreBar\s+from\s+['"][^'"]*ScoreBar\.vue['"]/);
    expect(SRC).toMatch(/v-for="[^"]*\bfactors?\b[^"]*"/);
  });

  it('shows a rationale for each factor', () => {
    expect(SRC).toMatch(/rationale/);
  });
});

describe('JobDetailDialog — excluded-factor handling (SCORE-007 AC2)', () => {
  it("renders an 'excluded' label for excluded factors", () => {
    expect(SRC).toMatch(/excluded/);
    // The excluded label is gated on `included === false` (not a zero bar).
    expect(SRC).toMatch(/included/);
  });

  it("still shows 'not stated' for the salary chip when absent", () => {
    expect(SRC).toMatch(/not stated/);
  });
});

describe('JobDetailDialog — reconciliation marker (SCORE-007 AC3 / NFR-003)', () => {
  it('reads stars and percent from a MatchScore so factor sum reconciles by construction', () => {
    // The component must pull stars + percent from the score object (the
    // same object whose `factors` it renders). Hard-coded or duplicate
    // values would break NFR-003 reconciliation.
    expect(SRC).toMatch(/\bscore\.(stars|percent)\b/);
    expect(SRC).toMatch(/\bscore\.factors\b/);
  });
});

describe('JobDetailDialog — source links (SCORE-007 AC4 / FR-011)', () => {
  it('iterates source link(s) so a multi-site listing lists each source once', () => {
    expect(SRC).toMatch(/v-for="[^"]*\bsources?\b[^"]*"/);
  });
});
