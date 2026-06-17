/**
 * Unit tests for the deterministic scorer core (SCORE-001).
 *
 * These tests pin the contract of the pure `score(listing, profile, weights)`
 * function and its supporting helpers (the percent->stars mapping, the
 * default weights + version, the factor framework's re-normalisation rule).
 *
 * Acceptance-criteria coverage:
 *  - AC1/AC7 — `score()` is a pure function (no DB / IPC / network / clock /
 *    randomness) and is deterministic across repeated calls.
 *  - AC2     — MatchScore / MatchFactor shapes follow Epic 5 §7 (key,
 *    included, score, weight, rationale, stars, percent, factors[],
 *    weightsVersion, stale, scoredAt).
 *  - AC3     — Excluded factors (`included === false`) are dropped from the
 *    weighted average; the remaining weights re-normalise to sum to 1 and
 *    no excluded factor is silently scored as zero (FR-003).
 *  - AC4     — The global percent equals the weighted average of the
 *    INCLUDED factors using the normalised weights — reconciles exactly.
 *  - AC5     — A single `percentToStars()` is the only source of star
 *    rounding (0% -> 1, 100% -> 5, fractional allowed in between).
 *  - AC6     — A default weights set and a stable `WEIGHTS_VERSION` string
 *    are exported.
 *  - AC8     — Determinism is unit-tested via repeated calls returning
 *    structurally-identical output.
 */
import { describe, expect, it } from 'vitest';

import {
  DEFAULT_WEIGHTS,
  WEIGHTS_VERSION,
  percentToStars,
  score,
  type FactorEvaluator,
  type FactorKey,
  type ScoringListing,
  type ScoringProfile,
} from '../scorer';

// --- minimal test fixtures -------------------------------------------------

const LISTING: ScoringListing = {
  sourceId: 'job-1',
  title: 'Senior Engineer',
  description: 'Build things.',
  location: 'Remote',
};

const PROFILE: ScoringProfile = {
  skills: ['typescript', 'vue'],
  yearsExperience: 5,
  location: 'Cape Town',
  workMode: 'Remote',
  salaryMin: 0,
  salaryCurrency: 'ZAR',
};

/** Tiny evaluator factory that returns a fixed evaluation — used to drive
 *  the framework deterministically in tests without depending on any real
 *  factor logic (those evaluators are SCORE-002). */
const fixed =
  (included: boolean, score: number, rationale = ''): FactorEvaluator =>
  () => ({ included, score, rationale });

const allEvals = (
  skillsE: FactorEvaluator,
  expE: FactorEvaluator,
  locE: FactorEvaluator,
  salE: FactorEvaluator,
): Record<FactorKey, FactorEvaluator> => ({
  skills: skillsE,
  experience: expE,
  location: locE,
  salary: salE,
});

// --- AC6: default weights + stable version ---------------------------------

describe('default weights and version', () => {
  it('exports a stable WEIGHTS_VERSION string', () => {
    expect(typeof WEIGHTS_VERSION).toBe('string');
    expect(WEIGHTS_VERSION.length).toBeGreaterThan(0);
  });

  it('exports a default weights set covering the four Epic 5 factors', () => {
    const keys = Object.keys(DEFAULT_WEIGHTS.weights).sort();
    expect(keys).toEqual(['experience', 'location', 'salary', 'skills']);
  });

  it('default weights sum to 1', () => {
    const sum = (Object.values(DEFAULT_WEIGHTS.weights) as number[]).reduce(
      (a, b) => a + b,
      0,
    );
    expect(sum).toBeCloseTo(1, 10);
  });

  it('DEFAULT_WEIGHTS.version matches WEIGHTS_VERSION', () => {
    expect(DEFAULT_WEIGHTS.version).toBe(WEIGHTS_VERSION);
  });
});

// --- AC5: percent -> stars mapping ----------------------------------------

describe('percentToStars', () => {
  it('maps 0% to 1 star (lower bound)', () => {
    expect(percentToStars(0)).toBeCloseTo(1, 10);
  });

  it('maps 100% to 5 stars (upper bound)', () => {
    expect(percentToStars(100)).toBeCloseTo(5, 10);
  });

  it('maps 50% to 3 stars (midpoint)', () => {
    expect(percentToStars(50)).toBeCloseTo(3, 10);
  });

  it('allows fractional stars in between', () => {
    expect(percentToStars(75)).toBeCloseTo(4, 10);
    expect(percentToStars(25)).toBeCloseTo(2, 10);
  });

  it('clamps out-of-range percents to the 1..5 range', () => {
    expect(percentToStars(-10)).toBe(1);
    expect(percentToStars(150)).toBe(5);
  });
});

// --- AC2 / AC4: shape + exact reconciliation ------------------------------

describe('score() shape and reconciliation', () => {
  it('returns a MatchScore with the Epic 5 §7 shape', () => {
    const result = score(
      LISTING,
      PROFILE,
      DEFAULT_WEIGHTS,
      allEvals(fixed(true, 80), fixed(true, 60), fixed(true, 40), fixed(true, 100)),
    );
    expect(result.sourceId).toBe('job-1');
    expect(typeof result.percent).toBe('number');
    expect(typeof result.stars).toBe('number');
    expect(result.weightsVersion).toBe(DEFAULT_WEIGHTS.version);
    expect(result.stale).toBe(false);
    expect(result.scoredAt).toBe(0); // pure function: clock-free, caller stamps
    expect(Array.isArray(result.factors)).toBe(true);
    expect(result.factors).toHaveLength(4);
    for (const f of result.factors) {
      expect(f).toHaveProperty('key');
      expect(f).toHaveProperty('included');
      expect(f).toHaveProperty('score');
      expect(f).toHaveProperty('weight');
      expect(f).toHaveProperty('rationale');
    }
  });

  it('global percent equals the weighted average of included factors', () => {
    const result = score(
      LISTING,
      PROFILE,
      DEFAULT_WEIGHTS,
      allEvals(fixed(true, 80), fixed(true, 60), fixed(true, 40), fixed(true, 100)),
    );
    const reconciled = result.factors
      .filter((f) => f.included)
      .reduce((sum, f) => sum + f.score * f.weight, 0);
    expect(result.percent).toBeCloseTo(reconciled, 10);
  });

  it('included factors weights sum to 1 (normalised)', () => {
    const result = score(
      LISTING,
      PROFILE,
      DEFAULT_WEIGHTS,
      allEvals(fixed(true, 80), fixed(true, 60), fixed(true, 40), fixed(true, 100)),
    );
    const sum = result.factors
      .filter((f) => f.included)
      .reduce((s, f) => s + f.weight, 0);
    expect(sum).toBeCloseTo(1, 10);
  });

  it('stars come from percentToStars(percent) — the single source of truth', () => {
    const result = score(
      LISTING,
      PROFILE,
      DEFAULT_WEIGHTS,
      allEvals(fixed(true, 80), fixed(true, 60), fixed(true, 40), fixed(true, 100)),
    );
    expect(result.stars).toBeCloseTo(percentToStars(result.percent), 10);
  });
});

// --- AC3: excluded factors do not score as zero; remainder re-normalises --

describe('excluded factor handling (FR-003)', () => {
  it('drops excluded factors from the weighted average', () => {
    // Salary excluded — only skills/experience/location contribute.
    const result = score(
      LISTING,
      PROFILE,
      DEFAULT_WEIGHTS,
      allEvals(
        fixed(true, 80),
        fixed(true, 60),
        fixed(true, 40),
        fixed(false, 0, 'not stated'),
      ),
    );
    const salary = result.factors.find((f) => f.key === 'salary');
    expect(salary?.included).toBe(false);
    expect(salary?.weight).toBe(0); // excluded factor contributes nothing
  });

  it('re-normalises the remaining weights to sum to exactly 1', () => {
    const result = score(
      LISTING,
      PROFILE,
      DEFAULT_WEIGHTS,
      allEvals(
        fixed(true, 80),
        fixed(true, 60),
        fixed(true, 40),
        fixed(false, 0, 'not stated'),
      ),
    );
    const sum = result.factors
      .filter((f) => f.included)
      .reduce((s, f) => s + f.weight, 0);
    expect(sum).toBeCloseTo(1, 10);
  });

  it('never silently scores an excluded factor as zero in the global percent', () => {
    // If excluded factors were treated as 0 with their original weight, the
    // percent would drop sharply. Re-normalisation keeps it at the weighted
    // average of the included factors only.
    const skills = 100;
    const result = score(
      LISTING,
      PROFILE,
      DEFAULT_WEIGHTS,
      allEvals(
        fixed(true, skills),
        fixed(false, 0),
        fixed(false, 0),
        fixed(false, 0),
      ),
    );
    // Only skills included — its normalised weight is 1, so the percent is
    // exactly its sub-score. If excluded factors were zeroed, the percent
    // would be skills * w_skills (e.g. 40) — much lower than 100.
    expect(result.percent).toBeCloseTo(skills, 10);
  });

  it('reconciles exactly with the displayed factor contributions', () => {
    const result = score(
      LISTING,
      PROFILE,
      DEFAULT_WEIGHTS,
      allEvals(
        fixed(true, 90),
        fixed(false, 0, 'unknown'),
        fixed(true, 50),
        fixed(true, 70),
      ),
    );
    const reconciled = result.factors
      .filter((f) => f.included)
      .reduce((sum, f) => sum + f.score * f.weight, 0);
    expect(result.percent).toBeCloseTo(reconciled, 10);
  });
});

// --- AC1 / AC7 / AC8: determinism + purity --------------------------------

describe('determinism (AC1, AC7, AC8)', () => {
  it('identical inputs yield identical output across repeated calls', () => {
    const evals = allEvals(
      fixed(true, 80, 'a'),
      fixed(true, 60, 'b'),
      fixed(true, 40, 'c'),
      fixed(true, 100, 'd'),
    );
    const a = score(LISTING, PROFILE, DEFAULT_WEIGHTS, evals);
    const b = score(LISTING, PROFILE, DEFAULT_WEIGHTS, evals);
    expect(a).toEqual(b);
  });

  it('does not depend on the system clock (scoredAt is 0)', () => {
    const result = score(
      LISTING,
      PROFILE,
      DEFAULT_WEIGHTS,
      allEvals(fixed(true, 50), fixed(true, 50), fixed(true, 50), fixed(true, 50)),
    );
    expect(result.scoredAt).toBe(0);
  });
});
