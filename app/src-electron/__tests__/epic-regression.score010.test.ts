/**
 * Epic 5 (Job Match Scoring) behavioural regression suite — SCORE-010.
 *
 * The per-ticket tests (`scorer.test.ts`, `scorerFactors.test.ts`,
 * `matchScores.test.ts`, `scoring.test.ts`) cover modules in isolation, and
 * `epic-acceptance.score009.test.ts` largely grep-checks the §9 acceptance
 * criteria against the on-disk source. This file complements both by
 * exercising the epic's KEY USER-FACING BEHAVIOURS end-to-end through the
 * REAL modules — the real `score()` pure function, the real factor
 * evaluators, the real `createMatchScoresStore`, and the real
 * `createScoringRunner` — driven by realistic fixtures and a faithful
 * in-memory `star.db` (the same pattern the rest of this project's epic
 * regression suites use; the native `better-sqlite3` binding is not
 * available in the Vitest Node env).
 *
 *   §1 Deterministic scoring — identical inputs → identical output
 *   §2 Exact reconciliation — percent == Σ(score * weight) for included
 *   §3 Excluded-factor re-normalisation — never zeroed
 *   §4 Free-text salary + years parser edges
 *   §5 Persistence + restart — survives reopening the same star.db bytes
 *   §6 Stale / rescore lifecycle — markStale → mode='stale' picks them up
 *   §7 Fully-offline scoring — no network / OpenRouter / API-key reach
 *   §8 Multi-site collapse — sourceId-keyed dedup in jobs + match_scores
 *   §9 Golden fixture — pin a known (job + profile) → expected score
 *
 * Per the SCORE-010 ticket: realistic fixtures, real scorer, no mocking of
 * things with real implementations. Only the native SQLite binding is faked
 * (an environment constraint, not a behavioural shortcut) — every store and
 * scorer code path is the real one.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// The match-scores / jobs stores delegate to `better-sqlite3` only via the
// small `prepare` / `exec` slice declared on `*DatabaseLike`. The native
// binding isn't built for the Vitest Node env, so we stub it and inject a
// faithful in-memory fake so the REAL store logic runs end-to-end.
vi.mock('better-sqlite3', () => ({ default: class {} }));

import {
  DEFAULT_WEIGHTS,
  WEIGHTS_VERSION,
  percentToStars,
  score,
  type MatchFactor,
  type MatchScore,
  type ScoringListing,
  type ScoringProfile,
} from '../scorer';
import {
  defaultFactorEvaluators,
  evaluateExperience,
  evaluateSalary,
  evaluateSkills,
} from '../scorerFactors';
import {
  createMatchScoresStore,
  type MatchScoresDatabaseLike,
} from '../matchScores';
import type { JobRecord, JobsDatabaseLike, JobsStore } from '../jobs';
import { createJobsStore } from '../jobs';
import { createScoringRunner, type ScoringProgressEvent } from '../scoring';
import type { ProfileRecord } from '../profile';

// ---------------------------------------------------------------------------
// In-memory fake star.db. Backs both the match-scores store and the jobs
// store (the same shared SQLite file the real app uses). Implements only the
// SQL surface those stores actually issue, so the REAL store code paths
// (statement preparation, parameter binding, row decoding) run unchanged.
// ---------------------------------------------------------------------------

interface MatchScoreRow {
  source_id: string;
  stars: number;
  percent: number;
  factors: string;
  weights_version: string;
  stale: number;
  scored_at: number;
}

interface JobRow {
  source_id: string;
  hostname: string;
  url: string;
  title: string | null;
  company: string | null;
  location: string | null;
  description: string | null;
  posted_at: number | null;
  fetched_at: number;
  status: string;
}

class InMemoryStarDb implements MatchScoresDatabaseLike, JobsDatabaseLike {
  scoreRows: MatchScoreRow[] = [];
  jobRows: JobRow[] = [];
  siteProfileRows: Array<{
    hostname: string;
    id_regex: string | null;
    selectors: string | null;
    learned_at: number;
  }> = [];

  exec(_sql: string): void {
    /* CREATE TABLE IF NOT EXISTS — no-op for the fake. */
  }

  prepare(sql: string) {
    const text = sql.trim();

    // --- match_scores ---------------------------------------------------
    if (/^INSERT\s+OR\s+REPLACE\s+INTO\s+match_scores/i.test(text)) {
      return {
        run: (params: MatchScoreRow) => {
          const idx = this.scoreRows.findIndex(
            (r) => r.source_id === params.source_id,
          );
          if (idx >= 0) this.scoreRows.splice(idx, 1);
          this.scoreRows.push({ ...params });
          return { changes: 1 };
        },
      };
    }
    if (/^UPDATE\s+match_scores\s+SET\s+stale/i.test(text)) {
      return {
        run: (sourceId: string) => {
          const row = this.scoreRows.find((r) => r.source_id === sourceId);
          if (!row) return { changes: 0 };
          row.stale = 1;
          return { changes: 1 };
        },
      };
    }
    if (/^SELECT[\s\S]+FROM\s+match_scores\s+WHERE\s+source_id/i.test(text)) {
      return {
        run: () => ({ changes: 0 }),
        all: (sourceId: string) =>
          this.scoreRows.filter((r) => r.source_id === sourceId),
      };
    }
    if (/^SELECT[\s\S]+FROM\s+match_scores/i.test(text)) {
      return {
        run: () => ({ changes: 0 }),
        all: () =>
          [...this.scoreRows].sort((a, b) =>
            a.source_id.localeCompare(b.source_id),
          ),
      };
    }

    // --- jobs -----------------------------------------------------------
    if (/^INSERT\s+OR\s+IGNORE\s+INTO\s+jobs/i.test(text)) {
      return {
        run: (params: JobRow) => {
          if (this.jobRows.some((r) => r.source_id === params.source_id)) {
            return { changes: 0 };
          }
          this.jobRows.push({ ...params });
          return { changes: 1 };
        },
      };
    }
    if (/^UPDATE\s+jobs\s+SET\s+status/i.test(text)) {
      return {
        run: (status: string, sourceId: string) => {
          const row = this.jobRows.find((r) => r.source_id === sourceId);
          if (!row) return { changes: 0 };
          row.status = status;
          return { changes: 1 };
        },
      };
    }
    if (/^SELECT\s+source_id\s+FROM\s+jobs/i.test(text)) {
      return {
        run: () => ({ changes: 0 }),
        all: () => this.jobRows.map((r) => ({ source_id: r.source_id })),
      };
    }
    if (/^SELECT[\s\S]+FROM\s+jobs/i.test(text)) {
      return {
        run: () => ({ changes: 0 }),
        all: () =>
          [...this.jobRows].sort((a, b) => b.fetched_at - a.fetched_at),
      };
    }

    // --- site_profiles --------------------------------------------------
    if (/^INSERT\s+OR\s+REPLACE\s+INTO\s+site_profiles/i.test(text)) {
      return {
        run: (params: {
          hostname: string;
          id_regex: string | null;
          selectors: string | null;
          learned_at: number;
        }) => {
          const idx = this.siteProfileRows.findIndex(
            (r) => r.hostname === params.hostname,
          );
          if (idx >= 0) this.siteProfileRows.splice(idx, 1);
          this.siteProfileRows.push({ ...params });
          return { changes: 1 };
        },
      };
    }
    if (/^SELECT[\s\S]+FROM\s+site_profiles/i.test(text)) {
      return {
        run: () => ({ changes: 0 }),
        all: (hostname: string) =>
          this.siteProfileRows.filter((r) => r.hostname === hostname),
      };
    }

    throw new Error(`InMemoryStarDb: unsupported SQL: ${text}`);
  }

  /** Snapshot the persisted bytes so a "restart" can rehydrate a fresh
   *  store wrapping the same data — mirrors the Electron close+relaunch
   *  lifecycle without needing the real native binding. */
  snapshot(): {
    scoreRows: MatchScoreRow[];
    jobRows: JobRow[];
    siteProfileRows: Array<{
      hostname: string;
      id_regex: string | null;
      selectors: string | null;
      learned_at: number;
    }>;
  } {
    return {
      scoreRows: this.scoreRows.map((r) => ({ ...r })),
      jobRows: this.jobRows.map((r) => ({ ...r })),
      siteProfileRows: this.siteProfileRows.map((r) => ({ ...r })),
    };
  }

  restore(snap: ReturnType<InMemoryStarDb['snapshot']>): void {
    this.scoreRows = snap.scoreRows.map((r) => ({ ...r }));
    this.jobRows = snap.jobRows.map((r) => ({ ...r }));
    this.siteProfileRows = snap.siteProfileRows.map((r) => ({ ...r }));
  }
}

let db: InMemoryStarDb;

beforeEach(() => {
  db = new InMemoryStarDb();
});

afterEach(() => {
  vi.resetModules();
});

// ---------------------------------------------------------------------------
// Realistic fixtures (no mocks; these are the same shape that flow through
// production after extraction + profile save).
// ---------------------------------------------------------------------------

const PROFILE: ScoringProfile = {
  skills: ['TypeScript', 'Vue', 'Node.js', 'Python'],
  yearsExperience: 6,
  location: 'Cape Town, South Africa',
  workMode: 'Remote',
  salaryMin: 60000,
  salaryCurrency: 'USD',
};

const LISTING_FULL: ScoringListing = {
  sourceId: 'job-full',
  title: 'Senior TypeScript Engineer',
  description:
    'We are looking for 5+ years of TypeScript and Vue experience. Remote-friendly. Salary range 70000-90000 USD.',
  location: 'Remote',
};

const LISTING_NO_SALARY: ScoringListing = {
  sourceId: 'job-no-salary',
  title: 'TypeScript Engineer',
  description:
    'Looking for 4+ years of TypeScript. Remote. Competitive salary, depending on experience.',
  location: 'Remote',
};

// ---------------------------------------------------------------------------
// §1 — Deterministic scoring
// ---------------------------------------------------------------------------

describe('SCORE-010 §1 — deterministic scoring (same inputs → same output)', () => {
  it('identical (listing, profile, weights) produce byte-identical MatchScore', () => {
    const a = score(LISTING_FULL, PROFILE, DEFAULT_WEIGHTS, defaultFactorEvaluators);
    const b = score(LISTING_FULL, PROFILE, DEFAULT_WEIGHTS, defaultFactorEvaluators);
    expect(a).toEqual(b);
  });

  it('the pure function is clock-free — scoredAt is left as 0', () => {
    const r = score(LISTING_FULL, PROFILE);
    expect(r.scoredAt).toBe(0);
  });

  it('weightsVersion is stamped from the supplied weight set', () => {
    const r = score(LISTING_FULL, PROFILE, DEFAULT_WEIGHTS, defaultFactorEvaluators);
    expect(r.weightsVersion).toBe(WEIGHTS_VERSION);
  });
});

// ---------------------------------------------------------------------------
// §2 — Exact reconciliation
// ---------------------------------------------------------------------------

describe('SCORE-010 §2 — exact reconciliation (percent == weighted average)', () => {
  it('global percent equals Σ(score * weight) over the included factors', () => {
    const r = score(LISTING_FULL, PROFILE, DEFAULT_WEIGHTS, defaultFactorEvaluators);
    const included = r.factors.filter((f) => f.included);
    const summed = included.reduce((s, f) => s + f.score * f.weight, 0);
    expect(r.percent).toBeCloseTo(summed, 10);
  });

  it('included-factor weights sum to 1 (renormalised over the included set)', () => {
    const r = score(LISTING_FULL, PROFILE, DEFAULT_WEIGHTS, defaultFactorEvaluators);
    const weightSum = r.factors
      .filter((f) => f.included)
      .reduce((s, f) => s + f.weight, 0);
    expect(weightSum).toBeCloseTo(1, 10);
  });

  it('stars are derived from percent via percentToStars — never disagree on screen', () => {
    const r = score(LISTING_FULL, PROFILE, DEFAULT_WEIGHTS, defaultFactorEvaluators);
    expect(r.stars).toBe(percentToStars(r.percent));
  });
});

// ---------------------------------------------------------------------------
// §3 — Excluded-factor re-normalisation (never zeroed)
// ---------------------------------------------------------------------------

describe('SCORE-010 §3 — excluded factors re-normalise; absent factors are never zeroed', () => {
  it('a listing with no stated salary leaves the salary factor excluded with weight 0', () => {
    const r = score(LISTING_NO_SALARY, PROFILE, DEFAULT_WEIGHTS, defaultFactorEvaluators);
    const salary = r.factors.find((f) => f.key === 'salary')!;
    expect(salary.included).toBe(false);
    expect(salary.weight).toBe(0);
  });

  it('remaining factor weights re-normalise so they STILL sum to 1', () => {
    const r = score(LISTING_NO_SALARY, PROFILE, DEFAULT_WEIGHTS, defaultFactorEvaluators);
    const sum = r.factors
      .filter((f) => f.included)
      .reduce((s, f) => s + f.weight, 0);
    expect(sum).toBeCloseTo(1, 10);
  });

  it('excluding a factor does NOT pull the global percent toward 0', () => {
    // The "salary excluded" run must score higher than a hypothetical "salary
    // scored as 0" run for the same other factors. That's the whole point of
    // excluding instead of zeroing.
    const excluded = score(
      LISTING_NO_SALARY,
      PROFILE,
      DEFAULT_WEIGHTS,
      defaultFactorEvaluators,
    );
    const otherIncluded = excluded.factors.filter(
      (f) => f.included && f.key !== 'salary',
    );
    const includedAvg = otherIncluded.reduce((s, f) => s + f.score * f.weight, 0);
    // The re-normalised average of the OTHER three == the global percent.
    expect(excluded.percent).toBeCloseTo(includedAvg, 10);
    // The naive "salary=0" alternative would be strictly lower whenever the
    // other factors score > 0 (which the realistic fixture guarantees).
    const naiveZeroedAvg =
      includedAvg * (1 - DEFAULT_WEIGHTS.weights.salary); // salary=0 contributes nothing
    expect(excluded.percent).toBeGreaterThan(naiveZeroedAvg);
  });

  it('a profile with no salaryMin also excludes the salary factor (never scored 0)', () => {
    const noTarget: ScoringProfile = { ...PROFILE, salaryMin: null };
    const r = score(LISTING_FULL, noTarget, DEFAULT_WEIGHTS, defaultFactorEvaluators);
    const salary = r.factors.find((f) => f.key === 'salary')!;
    expect(salary.included).toBe(false);
    expect(salary.weight).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// §4 — Free-text salary + years parser edges
// ---------------------------------------------------------------------------

describe('SCORE-010 §4 — free-text salary + years parser edges', () => {
  function listingWith(text: string): ScoringListing {
    return { sourceId: 's', title: '', description: text, location: '' };
  }

  it('salary parser recognises the k-suffix range form ($100k-$150k)', () => {
    const r = evaluateSalary(listingWith('Compensation: $100k-$150k'), PROFILE);
    expect(r.included).toBe(true);
  });

  it('salary parser recognises the comma-thousands range ($100,000 - $150,000)', () => {
    const r = evaluateSalary(
      listingWith('Salary: $100,000 - $150,000 depending on experience'),
      PROFILE,
    );
    expect(r.included).toBe(true);
  });

  it('salary parser recognises ZAR R-prefixed k ranges (R500k - R700k)', () => {
    const profileZAR: ScoringProfile = {
      ...PROFILE,
      salaryMin: 400000,
      salaryCurrency: 'ZAR',
    };
    const r = evaluateSalary(
      listingWith('Package: R500k - R700k per annum.'),
      profileZAR,
    );
    expect(r.included).toBe(true);
  });

  it('salary parser excludes vague mentions (e.g. "competitive salary")', () => {
    const r = evaluateSalary(
      listingWith('Competitive salary, depending on experience.'),
      PROFILE,
    );
    expect(r.included).toBe(false);
  });

  it('salary parser excludes when the listing only says "depending on experience"', () => {
    const r = evaluateSalary(
      listingWith('Salary commensurate with experience.'),
      PROFILE,
    );
    expect(r.included).toBe(false);
  });

  it('years parser handles "5+ years experience"', () => {
    const r = evaluateExperience(
      listingWith('Must have 5+ years experience with distributed systems.'),
      PROFILE,
    );
    expect(r.included).toBe(true);
    expect(r.rationale).toMatch(/listing 5y/);
  });

  it('years parser handles range form "3-5 years"', () => {
    const r = evaluateExperience(
      listingWith('3-5 years of professional experience required.'),
      PROFILE,
    );
    expect(r.included).toBe(true);
    expect(r.rationale).toMatch(/listing 3y/);
  });

  it('years parser handles "at least N years"', () => {
    const r = evaluateExperience(
      listingWith('Requires at least 7 years working with backend systems.'),
      PROFILE,
    );
    expect(r.included).toBe(true);
    expect(r.rationale).toMatch(/listing 7y/);
  });

  it('years parser falls back to seniority words when no explicit years stated', () => {
    const r = evaluateExperience(
      listingWith('Senior Engineer role on the platform team.'),
      PROFILE,
    );
    expect(r.included).toBe(true);
    expect(r.rationale).toMatch(/senior/);
  });

  it('years parser excludes when neither years nor seniority can be inferred', () => {
    const r = evaluateExperience(
      listingWith('Work with a small team to deliver great products.'),
      PROFILE,
    );
    expect(r.included).toBe(false);
  });

  it('skills parser uses the alias map (k8s ↔ Kubernetes, js ↔ JavaScript)', () => {
    const aliasProfile: ScoringProfile = {
      ...PROFILE,
      skills: ['Kubernetes', 'JavaScript'],
    };
    const r = evaluateSkills(
      listingWith('Experience with k8s and js required.'),
      aliasProfile,
    );
    expect(r.included).toBe(true);
    expect(r.score).toBe(100);
  });
});

// ---------------------------------------------------------------------------
// §5 — Persistence + restart (round-trip through the in-memory star.db)
// ---------------------------------------------------------------------------

describe('SCORE-010 §5 — match_scores persistence survives a restart', () => {
  it('upsert → snapshot → reload preserves every field of the MatchScore', () => {
    const store1 = createMatchScoresStore(db);
    const computed = score(LISTING_FULL, PROFILE);
    const persisted: MatchScore = { ...computed, scoredAt: 1_700_000_000_000 };
    store1.upsert(persisted);

    // Simulate Electron close + relaunch: a fresh DB handle wrapping the same
    // persisted bytes, and a fresh store on top of it.
    const snap = db.snapshot();
    const db2 = new InMemoryStarDb();
    db2.restore(snap);
    const store2 = createMatchScoresStore(db2);

    const restored = store2.get(LISTING_FULL.sourceId);
    expect(restored).toBeDefined();
    expect(restored!.percent).toBeCloseTo(computed.percent, 10);
    expect(restored!.stars).toBeCloseTo(computed.stars, 10);
    expect(restored!.weightsVersion).toBe(WEIGHTS_VERSION);
    expect(restored!.scoredAt).toBe(1_700_000_000_000);
    expect(restored!.stale).toBe(false);
    // Factor breakdown round-trips identically (JSON column decode).
    expect(restored!.factors.length).toBe(computed.factors.length);
    for (let i = 0; i < restored!.factors.length; i++) {
      const a = restored!.factors[i]!;
      const b = computed.factors[i]!;
      expect(a.key).toBe(b.key);
      expect(a.included).toBe(b.included);
      expect(a.score).toBeCloseTo(b.score, 10);
      expect(a.weight).toBeCloseTo(b.weight, 10);
      expect(a.rationale).toBe(b.rationale);
    }
  });
});

// ---------------------------------------------------------------------------
// §6 — Stale / rescore lifecycle
// ---------------------------------------------------------------------------

describe('SCORE-010 §6 — stale / rescore lifecycle', () => {
  function profileRecord(): ProfileRecord {
    return {
      name: '',
      targetRole: '',
      yearsExperience: PROFILE.yearsExperience,
      location: PROFILE.location,
      workMode: PROFILE.workMode,
      salaryMin: PROFILE.salaryMin,
      salaryCurrency: PROFILE.salaryCurrency,
      linkedinUrl: '',
      links: [],
      skills: [...PROFILE.skills],
      strengthScore: 0,
      updatedAt: 0,
    };
  }

  function seedJobs(jobs: JobsStore): void {
    const realistic: JobRecord[] = [
      {
        sourceId: LISTING_FULL.sourceId,
        hostname: 'jobs.example.com',
        url: 'https://jobs.example.com/full',
        title: LISTING_FULL.title!,
        company: 'Acme',
        location: LISTING_FULL.location!,
        description: LISTING_FULL.description!,
        postedAt: null,
        fetchedAt: 1,
        status: 'new',
      },
      {
        sourceId: LISTING_NO_SALARY.sourceId,
        hostname: 'jobs.example.com',
        url: 'https://jobs.example.com/no-salary',
        title: LISTING_NO_SALARY.title!,
        company: 'Initech',
        location: LISTING_NO_SALARY.location!,
        description: LISTING_NO_SALARY.description!,
        postedAt: null,
        fetchedAt: 2,
        status: 'new',
      },
    ];
    jobs.upsertJobs(realistic);
  }

  it('markStale flips the stale flag without deleting the prior score; rescore replaces it', async () => {
    const scores = createMatchScoresStore(db);
    const jobs = createJobsStore(db);
    seedJobs(jobs);

    const progress: ScoringProgressEvent[] = [];
    const runner = createScoringRunner({
      scoresStore: scores,
      jobsStore: jobs,
      getProfile: () => profileRecord(),
      now: () => 1_111,
      emitProgress: (e) => progress.push(e),
    });

    // First pass — unscored → scored.
    const first = await runner.rescore('unscored');
    expect(first.scored).toBe(2);
    const beforeStale = scores.get(LISTING_FULL.sourceId)!;
    expect(beforeStale.stale).toBe(false);
    expect(beforeStale.scoredAt).toBe(1_111);

    // Mark one stale; the row stays in place — the user keeps seeing the
    // old score in the UI while a re-score runs in the background (FR-005).
    scores.markStale(LISTING_FULL.sourceId);
    const midway = scores.get(LISTING_FULL.sourceId)!;
    expect(midway.stale).toBe(true);
    expect(midway.percent).toBeCloseTo(beforeStale.percent, 10);

    // Re-score mode='stale' picks up the stale row (and would also pick up
    // unscored rows — but everything is scored here).
    const second = await runner.rescore('stale');
    expect(second.scored).toBe(1);
    const after = scores.get(LISTING_FULL.sourceId)!;
    expect(after.stale).toBe(false);
    expect(after.percent).toBeCloseTo(beforeStale.percent, 10);
  });

  it('progress is reported as start → per-job → done', async () => {
    const scores = createMatchScoresStore(db);
    const jobs = createJobsStore(db);
    seedJobs(jobs);

    const progress: ScoringProgressEvent[] = [];
    const runner = createScoringRunner({
      scoresStore: scores,
      jobsStore: jobs,
      getProfile: () => profileRecord(),
      now: () => 1,
      emitProgress: (e) => progress.push(e),
    });

    await runner.rescore('all');
    expect(progress[0]?.phase).toBe('start');
    expect(progress[progress.length - 1]?.phase).toBe('done');
    const perJob = progress.filter((p) => p.phase === 'progress');
    expect(perJob.length).toBe(2);
    // The per-job events carry the sourceId that was just scored.
    expect(perJob.every((p) => typeof p.sourceId === 'string')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// §7 — Fully-offline scoring (architectural boundary)
// ---------------------------------------------------------------------------

describe('SCORE-010 §7 — scoring works with no key, no network', () => {
  it('the real scoring runner produces scores with no apiKey / catalogue / network dep', async () => {
    const scores = createMatchScoresStore(db);
    const jobs = createJobsStore(db);
    jobs.upsertJobs([
      {
        sourceId: LISTING_FULL.sourceId,
        hostname: 'jobs.example.com',
        url: 'https://jobs.example.com/full',
        title: LISTING_FULL.title!,
        company: 'Acme',
        location: LISTING_FULL.location!,
        description: LISTING_FULL.description!,
        postedAt: null,
        fetchedAt: 1,
        status: 'new',
      },
    ]);

    // The deps interface intentionally exposes ONLY jobs, profile, scores —
    // nothing model/key/network-related. Constructing the runner without any
    // OpenRouter / apiKey / catalogue dep proves the offline boundary.
    const runner = createScoringRunner({
      scoresStore: scores,
      jobsStore: jobs,
      getProfile: () => ({
        name: '',
        targetRole: '',
        yearsExperience: PROFILE.yearsExperience,
        location: PROFILE.location,
        workMode: PROFILE.workMode,
        salaryMin: PROFILE.salaryMin,
        salaryCurrency: PROFILE.salaryCurrency,
        linkedinUrl: '',
        links: [],
        skills: [...PROFILE.skills],
        strengthScore: 0,
        updatedAt: 0,
      }),
      now: () => 0,
      emitProgress: () => undefined,
    });

    // Trip-wire global `fetch` for the duration of this run: if any code
    // path under the scorer reaches the network, the test fails loudly.
    const originalFetch = (globalThis as { fetch?: unknown }).fetch;
    (globalThis as { fetch?: unknown }).fetch = () => {
      throw new Error('scoring must not reach the network');
    };
    try {
      const result = await runner.rescore('all');
      expect(result.scored).toBe(1);
    } finally {
      (globalThis as { fetch?: unknown }).fetch = originalFetch;
    }

    const stored = scores.get(LISTING_FULL.sourceId)!;
    expect(stored.weightsVersion).toBe(WEIGHTS_VERSION);
  });
});

// ---------------------------------------------------------------------------
// §8 — Multi-site collapse (sourceId-keyed dedup)
// ---------------------------------------------------------------------------

describe('SCORE-010 §8 — multi-site listing is scored once', () => {
  it('two extractions of the same sourceId merge to one job row and one score row', async () => {
    const scores = createMatchScoresStore(db);
    const jobs = createJobsStore(db);

    // The same logical job, posted on two sites — the dedup key is the
    // sourceId (Epic 3 contract). Both inserts target sourceId 'logical-1'.
    jobs.upsertJobs([
      {
        sourceId: 'logical-1',
        hostname: 'site-a.example.com',
        url: 'https://site-a.example.com/job/1',
        title: 'Senior TypeScript Engineer',
        company: 'Acme',
        location: 'Remote',
        description: '5+ years TypeScript. Remote.',
        postedAt: null,
        fetchedAt: 1,
        status: 'new',
      },
    ]);
    jobs.upsertJobs([
      {
        sourceId: 'logical-1',
        hostname: 'site-b.example.com',
        url: 'https://site-b.example.com/openings/1',
        title: 'Senior TypeScript Engineer',
        company: 'Acme',
        location: 'Remote',
        description: '5+ years TypeScript. Remote.',
        postedAt: null,
        fetchedAt: 2,
        status: 'new',
      },
    ]);

    expect(jobs.listJobs().length).toBe(1);

    const runner = createScoringRunner({
      scoresStore: scores,
      jobsStore: jobs,
      getProfile: () => ({
        name: '',
        targetRole: '',
        yearsExperience: PROFILE.yearsExperience,
        location: PROFILE.location,
        workMode: PROFILE.workMode,
        salaryMin: PROFILE.salaryMin,
        salaryCurrency: PROFILE.salaryCurrency,
        linkedinUrl: '',
        links: [],
        skills: [...PROFILE.skills],
        strengthScore: 0,
        updatedAt: 0,
      }),
      now: () => 0,
      emitProgress: () => undefined,
    });
    await runner.rescore('all');

    expect(scores.list().length).toBe(1);
    expect(scores.get('logical-1')).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// §9 — Golden fixture: pin (job + profile) → expected stars/percent/breakdown
//
// This is the explicit anti-drift guard called out in SCORE-010 AC3 and Epic
// 5 §13 #9. If the percent → stars mapping, factor evaluator rules, or
// default weights drift in the future, THIS test fails and forces an
// intentional refresh of the golden values (and a WEIGHTS_VERSION bump).
// ---------------------------------------------------------------------------

describe('SCORE-010 §9 — golden fixture (no silent drift in the score mapping)', () => {
  const GOLDEN_LISTING: ScoringListing = LISTING_FULL;
  const GOLDEN_PROFILE: ScoringProfile = PROFILE;

  // Derivation (kept in the test so a future reader can re-check by eye):
  //   skills       50 (matched 2/4: TypeScript + Vue; gap: Node.js + Python)
  //   experience  100 (profile 6y >= listing 5y from "looking for 5+ years")
  //   location    100 (workMode Remote == listing Remote; remote drops the
  //                    location constraint, so loc score = 100, mode = 100)
  //   salary      100 (listing 70000-90000 USD; profile min 60000 → min >= target)
  //   weights      40 / 25 / 20 / 15  (default v1)
  //   percent  = 0.4*50 + 0.25*100 + 0.20*100 + 0.15*100 = 20 + 25 + 20 + 15 = 80
  //   stars    = 1 + (80/100)*4 = 4.2
  const EXPECTED = {
    percent: 80,
    stars: 4.2,
    weightsVersion: 'v1',
    factors: {
      skills: { included: true, score: 50, weight: 0.4 },
      experience: { included: true, score: 100, weight: 0.25 },
      location: { included: true, score: 100, weight: 0.2 },
      salary: { included: true, score: 100, weight: 0.15 },
    } as Record<MatchFactor['key'], { included: boolean; score: number; weight: number }>,
  };

  it('pins the global percent and stars for the golden fixture', () => {
    const r = score(
      GOLDEN_LISTING,
      GOLDEN_PROFILE,
      DEFAULT_WEIGHTS,
      defaultFactorEvaluators,
    );
    expect(r.percent).toBeCloseTo(EXPECTED.percent, 10);
    expect(r.stars).toBeCloseTo(EXPECTED.stars, 10);
    expect(r.weightsVersion).toBe(EXPECTED.weightsVersion);
  });

  it('pins each per-factor included/score/weight for the golden fixture', () => {
    const r = score(
      GOLDEN_LISTING,
      GOLDEN_PROFILE,
      DEFAULT_WEIGHTS,
      defaultFactorEvaluators,
    );
    for (const f of r.factors) {
      const exp = EXPECTED.factors[f.key];
      expect(f.included, `factor ${f.key} included`).toBe(exp.included);
      expect(f.score, `factor ${f.key} score`).toBeCloseTo(exp.score, 10);
      expect(f.weight, `factor ${f.key} weight`).toBeCloseTo(exp.weight, 10);
      expect(f.rationale.length).toBeGreaterThan(0);
    }
  });

  it('golden fixture round-trips through persistence unchanged', () => {
    const store = createMatchScoresStore(db);
    const computed = score(
      GOLDEN_LISTING,
      GOLDEN_PROFILE,
      DEFAULT_WEIGHTS,
      defaultFactorEvaluators,
    );
    store.upsert({ ...computed, scoredAt: 42 });
    const restored = store.get(GOLDEN_LISTING.sourceId)!;
    expect(restored.percent).toBeCloseTo(EXPECTED.percent, 10);
    expect(restored.stars).toBeCloseTo(EXPECTED.stars, 10);
    expect(restored.weightsVersion).toBe(EXPECTED.weightsVersion);
  });
});
