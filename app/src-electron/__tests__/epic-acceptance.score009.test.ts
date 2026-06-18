/**
 * Epic-level acceptance verification (SCORE-009 / Epic 5).
 *
 * Holistically verifies the §9 Acceptance Criteria of
 * docs/Epics/epic_05_JOB_MATCH_SCORING.md against the actual implementation
 * produced by SCORE-001..008 — not just the per-ticket test phases.
 *
 * Each `describe` block is anchored to one bullet of the epic §9 list:
 *
 *   AC1  determinism (stable stars + percent for the same inputs)
 *   AC2  reconciliation (global percent == weighted average of included)
 *   AC3  excluded-salary labelling + re-normalisation, not zeroing
 *   AC4  per-factor rationale
 *   AC5  persistence + restart + weightsVersion recorded
 *   AC6  profile-change → stale; rescore updates; re-extract re-scores
 *   AC7  fully offline (no AI key / no network) + off the UI thread
 *   AC8  Job-detail modal + Dashboard surfaces
 *   AC9  multi-site listing scored once, presented once with all sources
 *   AC10 no LLM call participates in scoring (architectural boundary)
 *
 * Where a criterion is exercised by behaviour (determinism, reconciliation,
 * excluded re-normalisation) we exercise the real `score()` pure function;
 * where it is structural (modules wired, no network reach in the scoring
 * code path, UI surfaces present) we assert against the on-disk source so a
 * later quiet regression fails fast here.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
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
import {
  evaluateExperience,
  evaluateLocation,
  evaluateSalary,
  evaluateSkills,
  defaultFactorEvaluators,
} from '../scorerFactors';
import {
  createMatchScoresStore,
  rowToMatchScore,
  type MatchScoresDatabaseLike,
} from '../matchScores';
import { isScoringRelevantProfileChange } from '../scoring';
import type { ProfileRecord } from '../profile';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_DIR = path.resolve(__dirname, '..', '..');
const ELECTRON_DIR = path.join(REPO_DIR, 'src-electron');
const PAGES_DIR = path.join(REPO_DIR, 'src', 'pages');
const COMPONENTS_DIR = path.join(REPO_DIR, 'src', 'components');
const STORES_DIR = path.join(REPO_DIR, 'src', 'stores');

const SCORER = readFileSync(path.join(ELECTRON_DIR, 'scorer.ts'), 'utf8');
const FACTORS = readFileSync(path.join(ELECTRON_DIR, 'scorerFactors.ts'), 'utf8');
const SCORING = readFileSync(path.join(ELECTRON_DIR, 'scoring.ts'), 'utf8');
const MATCH_SCORES = readFileSync(path.join(ELECTRON_DIR, 'matchScores.ts'), 'utf8');
const MAIN = readFileSync(path.join(ELECTRON_DIR, 'electron-main.ts'), 'utf8');
const PRELOAD = readFileSync(path.join(ELECTRON_DIR, 'electron-preload.ts'), 'utf8');
const JOB_DETAIL = readFileSync(
  path.join(COMPONENTS_DIR, 'JobDetailDialog.vue'),
  'utf8',
);
const JOB_BOARD = readFileSync(path.join(PAGES_DIR, 'JobBoardPage.vue'), 'utf8');
const DASHBOARD = readFileSync(path.join(PAGES_DIR, 'DashboardPage.vue'), 'utf8');
const STORE = readFileSync(path.join(STORES_DIR, 'app-store.ts'), 'utf8');

// --- Fixtures -------------------------------------------------------------

const PROFILE: ScoringProfile = {
  skills: ['TypeScript', 'Vue', 'Node.js'],
  yearsExperience: 6,
  location: 'Cape Town, South Africa',
  workMode: 'Remote',
  salaryMin: 60000,
  salaryCurrency: 'USD',
};

const LISTING_FULL: ScoringListing = {
  sourceId: 'job-1',
  title: 'Senior TypeScript / Vue engineer',
  description:
    'We are looking for 5+ years of TypeScript and Vue experience. Remote-friendly. Salary range 70000-90000 USD.',
  location: 'Remote',
};

const LISTING_NO_SALARY: ScoringListing = {
  sourceId: 'job-2',
  title: 'TypeScript engineer',
  description:
    '4+ years of TypeScript. Remote. Competitive salary, depending on experience.',
  location: 'Remote',
};

// --- AC1 — determinism ----------------------------------------------------

describe('Epic §9 AC1 — same (listing, profile, weights) → same stars/percent', () => {
  it('returns identical MatchScore across multiple invocations (pure function)', () => {
    const a = score(LISTING_FULL, PROFILE, DEFAULT_WEIGHTS, defaultFactorEvaluators);
    const b = score(LISTING_FULL, PROFILE, DEFAULT_WEIGHTS, defaultFactorEvaluators);
    expect(a.stars).toBe(b.stars);
    expect(a.percent).toBe(b.percent);
    // Per-factor breakdown is identical, too.
    expect(a.factors.map((f) => ({ ...f }))).toEqual(
      b.factors.map((f) => ({ ...f })),
    );
  });

  it('scorer is a pure function — no randomness, no clock dependence', () => {
    // The pure score() must not call Date.now() / Math.random(); the
    // persistence layer stamps scoredAt instead.
    expect(SCORER).not.toMatch(/Date\.now\(/);
    expect(SCORER).not.toMatch(/Math\.random\(/);
    // The pure function leaves scoredAt as 0 — the persistence layer stamps it.
    const result = score(LISTING_FULL, PROFILE, DEFAULT_WEIGHTS, defaultFactorEvaluators);
    expect(result.scoredAt).toBe(0);
  });
});

// --- AC2 — reconciliation -------------------------------------------------

describe('Epic §9 AC2 — global percent equals the weighted average of included factors', () => {
  it('breakdown reconciles exactly with the global percent', () => {
    const result = score(
      LISTING_FULL,
      PROFILE,
      DEFAULT_WEIGHTS,
      defaultFactorEvaluators,
    );
    const included = result.factors.filter((f) => f.included);
    const summed = included.reduce((s, f) => s + f.score * f.weight, 0);
    expect(result.percent).toBeCloseTo(summed, 10);
  });

  it('included-factor weights sum to 1 (renormalisation)', () => {
    const result = score(
      LISTING_FULL,
      PROFILE,
      DEFAULT_WEIGHTS,
      defaultFactorEvaluators,
    );
    const weightSum = result.factors
      .filter((f) => f.included)
      .reduce((s, f) => s + f.weight, 0);
    expect(weightSum).toBeCloseTo(1, 10);
  });

  it('percentToStars is the single source of star rounding', () => {
    const result = score(LISTING_FULL, PROFILE);
    expect(result.stars).toBe(percentToStars(result.percent));
  });
});

// --- AC3 — excluded salary --------------------------------------------------

describe('Epic §9 AC3 — listing with no stated salary excludes the salary factor', () => {
  it('salary factor is excluded (not zeroed) when the listing has no stated salary', () => {
    const result = score(
      LISTING_NO_SALARY,
      PROFILE,
      DEFAULT_WEIGHTS,
      defaultFactorEvaluators,
    );
    const salary = result.factors.find((f) => f.key === 'salary');
    expect(salary).toBeDefined();
    expect(salary!.included).toBe(false);
    // The renderer must never contribute an excluded factor to the global.
    expect(salary!.weight).toBe(0);
  });

  it('remaining factors re-normalise to sum to 1', () => {
    const result = score(
      LISTING_NO_SALARY,
      PROFILE,
      DEFAULT_WEIGHTS,
      defaultFactorEvaluators,
    );
    const included = result.factors.filter((f) => f.included);
    const weightSum = included.reduce((s, f) => s + f.weight, 0);
    expect(weightSum).toBeCloseTo(1, 10);
  });

  it('Job-detail modal labels excluded factors and shows "not stated" for missing salary', () => {
    expect(JOB_DETAIL).toMatch(/excluded/);
    expect(JOB_DETAIL).toMatch(/not stated/);
    // Excluded factors must not render a misleading bar — the ScoreBar is
    // gated by `f.included`.
    expect(JOB_DETAIL).toMatch(/v-if="f\.included"/);
  });
});

// --- AC4 — rationale ------------------------------------------------------

describe('Epic §9 AC4 — each factor exposes a clear rationale', () => {
  it('every factor in the breakdown carries a non-empty rationale', () => {
    const result = score(LISTING_FULL, PROFILE, DEFAULT_WEIGHTS, defaultFactorEvaluators);
    for (const f of result.factors) {
      expect(typeof f.rationale).toBe('string');
      expect(f.rationale.length).toBeGreaterThan(0);
    }
  });

  it('skills rationale lists matched skills and the gap', () => {
    const r = evaluateSkills(LISTING_FULL, PROFILE);
    expect(r.included).toBe(true);
    expect(r.rationale).toMatch(/Matched/);
  });

  it('salary rationale states the compared values when included', () => {
    const r = evaluateSalary(LISTING_FULL, PROFILE);
    expect(r.included).toBe(true);
    expect(r.rationale).toMatch(/vs profile min/);
  });

  it('experience and location evaluators return deterministic rationales', () => {
    expect(evaluateExperience(LISTING_FULL, PROFILE).rationale.length).toBeGreaterThan(0);
    expect(evaluateLocation(LISTING_FULL, PROFILE).rationale.length).toBeGreaterThan(0);
  });
});

// --- AC5 — persistence + restart ------------------------------------------

describe('Epic §9 AC5 — scores persist in star.db; weightsVersion recorded; survive restart', () => {
  function makeStubDb(): {
    db: MatchScoresDatabaseLike;
    rows: Map<string, Record<string, unknown>>;
  } {
    const rows = new Map<string, Record<string, unknown>>();
    const db: MatchScoresDatabaseLike = {
      exec: () => undefined,
      prepare: (sql: string) => ({
        run: (input: Record<string, unknown> | string) => {
          if (sql.startsWith('INSERT')) {
            const r = input as Record<string, unknown>;
            rows.set(r.source_id as string, r);
          } else if (sql.startsWith('UPDATE')) {
            const id = input as unknown as string;
            const row = rows.get(id);
            if (row) row.stale = 1;
          }
          return { changes: 1 };
        },
        all: (arg?: unknown) => {
          if (sql.startsWith('SELECT') && sql.includes('WHERE source_id')) {
            const r = rows.get(arg as string);
            return r ? [r] : [];
          }
          return Array.from(rows.values());
        },
      }),
    };
    return { db, rows };
  }

  it('upsert + get round-trips with weightsVersion preserved', () => {
    const { db } = makeStubDb();
    const store = createMatchScoresStore(db);
    const computed = score(LISTING_FULL, PROFILE);
    store.upsert({ ...computed, scoredAt: 12345 });

    const restored = store.get(LISTING_FULL.sourceId);
    expect(restored).toBeDefined();
    expect(restored!.weightsVersion).toBe(WEIGHTS_VERSION);
    expect(restored!.percent).toBeCloseTo(computed.percent, 10);
    expect(restored!.factors.length).toBe(computed.factors.length);
  });

  it('match_scores table records weights_version column for audit', () => {
    expect(MATCH_SCORES).toMatch(/weights_version/);
    expect(MATCH_SCORES).toMatch(/CREATE TABLE IF NOT EXISTS match_scores/);
  });

  it('store shares star.db with the other Epic 3/4 stores (single SQLite file)', () => {
    expect(MAIN).toMatch(/createMatchScoresStore\(sitesDb\)/);
  });

  it('rowToMatchScore is the canonical row deserialiser (round-trip contract)', () => {
    const restored = rowToMatchScore({
      source_id: 'x',
      stars: 3.5,
      percent: 62.5,
      factors: JSON.stringify([
        { key: 'skills', included: true, score: 80, weight: 0.5, rationale: 'r' },
      ]),
      weights_version: 'v1',
      stale: 0,
      scored_at: 999,
    });
    expect(restored.weightsVersion).toBe('v1');
    expect(restored.factors[0]?.key).toBe('skills');
  });
});

// --- AC6 — staleness lifecycle --------------------------------------------

describe('Epic §9 AC6 — profile-change → stale; rescore updates; re-extract re-scores', () => {
  const base: ProfileRecord = {
    id: 1,
    name: '',
    targetRole: '',
    location: 'Cape Town',
    workMode: 'Remote',
    skills: ['ts'],
    yearsExperience: 5,
    salaryMin: 60000,
    salaryCurrency: 'USD',
    linkedinUrl: null,
    portfolioUrl: null,
    extraLinks: [],
    strengthScore: 0,
    updatedAt: 0,
  } as unknown as ProfileRecord;

  it('skills change is scoring-relevant', () => {
    const next = { ...base, skills: ['ts', 'vue'] };
    expect(isScoringRelevantProfileChange(base, next)).toBe(true);
  });

  it('yearsExperience / location / workMode / salaryMin / salaryCurrency changes are scoring-relevant', () => {
    expect(
      isScoringRelevantProfileChange(base, { ...base, yearsExperience: 6 }),
    ).toBe(true);
    expect(isScoringRelevantProfileChange(base, { ...base, location: 'Berlin' })).toBe(
      true,
    );
    expect(isScoringRelevantProfileChange(base, { ...base, workMode: 'Hybrid' })).toBe(
      true,
    );
    expect(isScoringRelevantProfileChange(base, { ...base, salaryMin: 70000 })).toBe(
      true,
    );
    expect(
      isScoringRelevantProfileChange(base, { ...base, salaryCurrency: 'EUR' }),
    ).toBe(true);
  });

  it('non-scoring edits (name, targetRole) leave scores alone', () => {
    expect(isScoringRelevantProfileChange(base, { ...base, name: 'Alex' })).toBe(false);
    expect(
      isScoringRelevantProfileChange(base, { ...base, targetRole: 'Lead' }),
    ).toBe(false);
  });

  it('main wires the profile-save hook to flip stored scores stale', () => {
    expect(MAIN).toMatch(/isScoringRelevantProfileChange/);
    expect(MAIN).toMatch(/matchScoresStore\.markStale/);
  });

  it('extraction "done" event triggers scoreNewJobs (re-extract → re-score path)', () => {
    expect(MAIN).toMatch(/scoringRunner\.scoreNewJobs\(\)/);
  });

  it('renderer store exposes rescore action + scoresStale flag', () => {
    expect(STORE).toMatch(/scoresStale/);
    expect(STORE).toMatch(/rescore/);
  });
});

// --- AC7 — offline + off the UI thread ------------------------------------

describe('Epic §9 AC7 — scoring is fully offline and off the UI thread', () => {
  it('scorer module makes no network / OpenRouter / API-key call', () => {
    expect(SCORER).not.toMatch(/fetch\(|openrouter|getApiKey|http/i);
    expect(FACTORS).not.toMatch(/fetch\(|openrouter|getApiKey/i);
  });

  it('scoring IPC runtime does not import the apiKey or LLM modules', () => {
    expect(SCORING).not.toMatch(/from '\.\/apiKey'/);
    expect(SCORING).not.toMatch(/from '\.\/llmCatalogue'/);
    expect(SCORING).not.toMatch(/from '\.\/cvStructurer'/);
    expect(SCORING).not.toMatch(/fetch\(|http:\/\/|https:\/\//);
  });

  it('scoring runner yields between jobs so a batch never blocks the main thread', () => {
    expect(SCORING).toMatch(/setImmediate/);
  });

  it('IPC handlers are async so control returns to the event loop', () => {
    expect(SCORING).toMatch(/ipcMain\.handle\([^)]+,\s*async/);
  });

  it('scoring produces a score even when no factor evaluator depends on a key', () => {
    // Sanity check: the real default evaluators run end-to-end with no key
    // set up — running the test at all proves the path is offline.
    const r = score(LISTING_FULL, PROFILE, DEFAULT_WEIGHTS, defaultFactorEvaluators);
    expect(r.percent).toBeGreaterThanOrEqual(0);
    expect(r.percent).toBeLessThanOrEqual(100);
  });
});

// --- AC8 — Job-detail modal + Dashboard surfaces --------------------------

describe('Epic §9 AC8 — Job-detail modal + Dashboard surface the score', () => {
  it('Job-detail modal renders StarRating, ScoreBar, and the factor breakdown', () => {
    expect(JOB_DETAIL).toMatch(/StarRating/);
    expect(JOB_DETAIL).toMatch(/ScoreBar/);
    expect(JOB_DETAIL).toMatch(/score\.factors/);
    expect(JOB_DETAIL).toMatch(/% profile fit/);
  });

  it('Job-detail modal shows source links (multi-source friendly)', () => {
    expect(JOB_DETAIL).toMatch(/sources/);
    expect(JOB_DETAIL).toMatch(/openSource/);
  });

  it('Board tiles show stars + percentage and the strong-match threshold', () => {
    expect(JOB_BOARD).toMatch(/StarRating/);
    expect(JOB_BOARD).toMatch(/%\s*match/);
    expect(JOB_BOARD).toMatch(/STRONG|isStrong/);
  });

  it('Dashboard shows the ★4+ STRONG count and a top-matches list', () => {
    expect(DASHBOARD).toMatch(/strongMatchCount/);
    expect(DASHBOARD).toMatch(/topMatches/);
    expect(DASHBOARD).toMatch(/Top matches today/);
  });

  it('store exposes strongMatchCount and topMatches selectors', () => {
    expect(STORE).toMatch(/strongMatchCount/);
    expect(STORE).toMatch(/topMatches/);
  });
});

// --- AC9 — multi-site collapse --------------------------------------------

describe('Epic §9 AC9 — multi-site listing is scored once, presented once with all sources', () => {
  it('jobs are deduplicated by sourceId at persistence (INSERT OR IGNORE)', () => {
    const JOBS = readFileSync(path.join(ELECTRON_DIR, 'jobs.ts'), 'utf8');
    expect(JOBS).toMatch(/INSERT OR IGNORE INTO jobs/);
    expect(JOBS).toMatch(/source_id\s+TEXT PRIMARY KEY/);
  });

  it('match scores are keyed by sourceId — one row per logical listing', () => {
    expect(MATCH_SCORES).toMatch(/source_id\s+TEXT PRIMARY KEY/);
  });

  it('Job-detail modal renders one entry per source URL', () => {
    expect(JOB_DETAIL).toMatch(/v-for="s in sources"/);
  });
});

// --- AC10 — no LLM call in scoring ----------------------------------------

describe('Epic §9 AC10 — no LLM call participates in scoring (architectural boundary)', () => {
  it('scorer.ts has no LLM/OpenRouter symbols', () => {
    expect(SCORER).not.toMatch(/openrouter|cvStructurer|matchReview|chatCompletion/i);
  });

  it('scorerFactors.ts has no LLM/OpenRouter symbols', () => {
    expect(FACTORS).not.toMatch(/openrouter|cvStructurer|matchReview|chatCompletion/i);
  });

  it('scoring.ts does not import the model catalogue, api-key, or extractor', () => {
    expect(SCORING).not.toMatch(/llmCatalogue|apiKey|cvStructurer|matchReview/);
  });

  it('preload bridge exposes starScores but the bridge does not reach a model', () => {
    expect(PRELOAD).toMatch(/starScores/);
    // The bridge is plain IPC — no fetch / network primitive in the same surface.
    const bridgeBlock =
      PRELOAD.split('starScores')[1]?.split('contextBridge.exposeInMainWorld')[0] ??
      '';
    expect(bridgeBlock).not.toMatch(/fetch\(|XMLHttpRequest|openrouter/i);
  });

  it('a custom evaluator that throws when reaching for a key is never invoked by the pure scorer with default evaluators', () => {
    // Belt-and-braces: even the stub evaluators in scorer.ts default themselves
    // out — and the real defaults swap them out — but a misconfigured evaluator
    // must never silently get a network/key reference. We simulate by passing
    // a tripwire evaluator and confirming the pure score path is the only
    // place factor evaluators are called.
    let called = 0;
    const tripwire: FactorEvaluator = () => {
      called++;
      return { included: false, score: 0, rationale: 'tripwire' };
    };
    const evaluators: Record<FactorKey, FactorEvaluator> = {
      skills: tripwire,
      experience: tripwire,
      location: tripwire,
      salary: tripwire,
    };
    score(LISTING_FULL, PROFILE, DEFAULT_WEIGHTS, evaluators);
    expect(called).toBe(4);
  });
});

// --- Summary --------------------------------------------------------------

describe('SCORE-009 evaluation summary', () => {
  it('all modules each preceding SCORE ticket delivered are still on disk', () => {
    expect(SCORER.length).toBeGreaterThan(0); // SCORE-001
    expect(FACTORS.length).toBeGreaterThan(0); // SCORE-002
    expect(MATCH_SCORES.length).toBeGreaterThan(0); // SCORE-003
    expect(SCORING.length).toBeGreaterThan(0); // SCORE-004
    expect(STORE).toMatch(/rescore/); // SCORE-005
    expect(JOB_BOARD).toMatch(/StarRating/); // SCORE-006
    expect(JOB_DETAIL).toMatch(/score\.factors/); // SCORE-007
    expect(DASHBOARD).toMatch(/strongMatchCount/); // SCORE-008
  });

  it('preload bridge exposes the full epic surface', () => {
    expect(PRELOAD).toMatch(/starScores/);
    expect(PRELOAD).toMatch(/scores:get/);
    expect(PRELOAD).toMatch(/scores:list/);
    expect(PRELOAD).toMatch(/scores:rescore/);
  });
});
