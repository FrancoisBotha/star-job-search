/**
 * Deterministic match scorer core (SCORE-001 / Epic 5 §3, §7).
 *
 * Exports a PURE `score(listing, profile, weights, evaluators)` function that
 * returns a `MatchScore` from a `(listing, profile, weights)` triple. The
 * function has no DB, IPC, network, clock, or randomness dependence — the
 * same inputs always produce the same output (NFR-001).
 *
 * This module ships the factor framework, the percent->stars mapping, the
 * default weights set and the stable `WEIGHTS_VERSION`. The four concrete
 * factor evaluators (skills / experience / location / salary) land in a
 * follow-up ticket (SCORE-002) and are passed in here. The default
 * evaluator map ships factors as `included: false` stubs so the framework is
 * usable in isolation — real evaluators replace them in SCORE-002.
 *
 * Reconciliation rule (FR-002, FR-003, NFR-001): the global `percent` is the
 * weighted average of the INCLUDED factors, after re-normalising their
 * weights to sum to 1. Excluded factors carry `weight: 0` in the returned
 * breakdown so the renderer can render them as "excluded" without ever
 * showing them as a zero-scored contribution.
 *
 * `percentToStars()` is the single source of star rounding so the rendered
 * stars and percentage can never visually disagree.
 */

// --- Shapes (Epic 5 §7) ----------------------------------------------------

/** The four Epic 5 factor keys. */
export type FactorKey = 'skills' | 'experience' | 'location' | 'salary';

export interface MatchFactor {
  key: FactorKey;
  /** False when the factor cannot be evaluated (e.g. no stated salary). */
  included: boolean;
  /** 0-100 sub-score. Meaningless when `included === false`. */
  score: number;
  /** The normalised weight applied to this factor in the global average.
   *  Excluded factors carry 0 so they never contribute. */
  weight: number;
  /** Deterministic, human-readable "why" string. */
  rationale: string;
}

export interface MatchScore {
  sourceId: string;
  /** 1-5 stars, fractional allowed for display. */
  stars: number;
  /** 0-100 weighted match. */
  percent: number;
  factors: MatchFactor[];
  /** Which weight set produced this — recorded for reproducibility. */
  weightsVersion: string;
  /** Set by the persistence layer when the profile changes / job re-extracts. */
  stale: boolean;
  /** Provenance only — NOT an input to the score. The pure function leaves
   *  this 0; the persistence layer stamps it on write. */
  scoredAt: number;
}

// --- Inputs ---------------------------------------------------------------

/** Minimal listing slice the scorer needs. Mirrors the relevant subset of
 *  `JobRecord` from `jobs.ts` — kept local so the scorer stays decoupled. */
export interface ScoringListing {
  sourceId: string;
  title?: string | null;
  description?: string | null;
  location?: string | null;
}

/** Minimal profile slice the scorer needs. Mirrors the relevant subset of
 *  `ProfileRecord` from `profile.ts`. */
export interface ScoringProfile {
  skills: string[];
  yearsExperience: number | null;
  location: string;
  workMode: 'Remote' | 'Hybrid' | 'On-site';
  salaryMin: number | null;
  salaryCurrency: string;
}

// --- Weights --------------------------------------------------------------

/** Stable string identifying the default weight set. Persisted alongside
 *  each `MatchScore` so a score can be reproduced/audited even after the
 *  defaults change. Bumped whenever DEFAULT_WEIGHTS changes meaningfully. */
export const WEIGHTS_VERSION = 'v1';

export interface ScorerWeights {
  version: string;
  weights: Record<FactorKey, number>;
}

export const DEFAULT_WEIGHTS: ScorerWeights = {
  version: WEIGHTS_VERSION,
  weights: {
    skills: 0.4,
    experience: 0.25,
    location: 0.2,
    salary: 0.15,
  },
};

// --- Factor framework -----------------------------------------------------

/** A factor evaluator returns the per-factor verdict for one listing+profile
 *  pair. Pure: no DB / IPC / network / clock / randomness. */
export interface FactorEvaluation {
  included: boolean;
  score: number;
  rationale: string;
}

export type FactorEvaluator = (
  listing: ScoringListing,
  profile: ScoringProfile,
) => FactorEvaluation;

/** Stub evaluator — marks the factor as not-yet-implemented so the framework
 *  can run before SCORE-002 wires up the real four. Excluded factors do not
 *  contribute to the global percent (FR-003). */
const stub =
  (key: FactorKey): FactorEvaluator =>
  () => ({
    included: false,
    score: 0,
    rationale: `${key} evaluator not yet implemented`,
  });

export const DEFAULT_EVALUATORS: Record<FactorKey, FactorEvaluator> = {
  skills: stub('skills'),
  experience: stub('experience'),
  location: stub('location'),
  salary: stub('salary'),
};

// --- Percent -> stars (single source of star rounding) --------------------

/** Linearly maps a 0-100 percent onto the 1-5 star range (fractional
 *  allowed). 0% -> 1 star, 100% -> 5 stars. Clamped to the bounds so an
 *  out-of-range percent can never render as 0 or 6 stars. This is the ONLY
 *  function that rounds percent to stars — keep it that way so the stars
 *  and the percentage on screen never disagree (Epic 5 §10 risk). */
export function percentToStars(percent: number): number {
  const clamped = Math.max(0, Math.min(100, percent));
  return 1 + (clamped / 100) * 4;
}

// --- Score ----------------------------------------------------------------

const FACTOR_KEYS: readonly FactorKey[] = [
  'skills',
  'experience',
  'location',
  'salary',
];

/**
 * Compute the deterministic match score for a listing+profile pair.
 *
 * - Runs each factor evaluator.
 * - Drops excluded factors and re-normalises the remaining weights to sum
 *   to 1 (FR-003). Excluded factors land in `factors[]` with `weight: 0`
 *   so they render as "excluded", never as a zero-scored contribution.
 * - The global `percent` is the weighted average of the INCLUDED factors
 *   using the normalised weights — reconciles exactly with the displayed
 *   bars (FR-002, NFR-001).
 * - `stars` is `percentToStars(percent)` — the single source of rounding.
 * - `scoredAt` is left as 0; the persistence layer stamps it (the pure
 *   function must not call the clock).
 */
export function score(
  listing: ScoringListing,
  profile: ScoringProfile,
  weights: ScorerWeights = DEFAULT_WEIGHTS,
  evaluators: Record<FactorKey, FactorEvaluator> = DEFAULT_EVALUATORS,
): MatchScore {
  // 1. Evaluate every factor.
  const evaluated = FACTOR_KEYS.map((key) => {
    const evaluation = evaluators[key](listing, profile);
    const rawWeight = weights.weights[key] ?? 0;
    return { key, evaluation, rawWeight };
  });

  // 2. Sum the raw weights of the INCLUDED factors so we can re-normalise.
  const includedWeightSum = evaluated
    .filter((e) => e.evaluation.included)
    .reduce((sum, e) => sum + e.rawWeight, 0);

  // 3. Build the breakdown. Excluded factors carry weight 0 (they cannot
  //    contribute); included factors carry their re-normalised weight.
  const factors: MatchFactor[] = evaluated.map(({ key, evaluation, rawWeight }) => {
    const weight =
      evaluation.included && includedWeightSum > 0
        ? rawWeight / includedWeightSum
        : 0;
    return {
      key,
      included: evaluation.included,
      score: evaluation.score,
      weight,
      rationale: evaluation.rationale,
    };
  });

  // 4. Global percent = weighted average of the included factors. When no
  //    factor is included the score is undefined; we return 0 so the UI can
  //    still render the breakdown rather than crashing.
  const percent =
    includedWeightSum > 0
      ? factors
          .filter((f) => f.included)
          .reduce((sum, f) => sum + f.score * f.weight, 0)
      : 0;

  return {
    sourceId: listing.sourceId,
    stars: percentToStars(percent),
    percent,
    factors,
    weightsVersion: weights.version,
    stale: false,
    scoredAt: 0,
  };
}
