/**
 * Unit tests for the match-reviews persistence module (AIREV-002).
 *
 * Covers acceptance criteria:
 *  - AC1: new `match_reviews` table in star.db keyed by sourceId, storing the
 *         narrative blob + provenance (modelSlug, generatedAt) + stale flag,
 *         with NO score / number / percent / star column by construction.
 *  - AC2: createMatchReviewsStore exposes get(sourceId), upsert(review), and
 *         markStale(sourceId) — mirroring the sites.ts / matchScores.ts pattern.
 *  - AC3: a persisted review survives an app restart (FR-004) — a second
 *         store opened on the same DB sees the previously upserted row,
 *         including the narrative blob and provenance.
 *  - AC4: markStale sets the stale flag without deleting the cached narrative,
 *         so the prior review is still viewable with a regenerate affordance.
 *  - AC5: this store is strictly separate from Epic 5's match_scores table —
 *         the module only touches `match_reviews`, never `match_scores`
 *         (NFR-001 — never joined into a single rating).
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { PersistedMatchReview } from '../matchReviews';

// Avoid pulling in the native binding during tests — same pattern as sites/jobs/scores.
vi.mock('better-sqlite3', () => {
  return { default: class {} };
});

// --- Minimal in-memory fake of the better-sqlite3 surface we use -----------

interface MatchReviewRow {
  source_id: string;
  archetype: string | null;
  requirements: string; // JSON
  gaps: string; // JSON
  strengths: string; // JSON
  keywords: string; // JSON
  summary: string;
  model_slug: string | null;
  generated_at: number;
  stale: number;
}

class FakeDatabase {
  rows: MatchReviewRow[] = [];
  // Capture every SQL statement so tests can assert on schema shape.
  execLog: string[] = [];
  prepareLog: string[] = [];

  exec(sql: string) {
    this.execLog.push(sql);
  }
  prepare(sql: string) {
    const text = sql.trim();
    this.prepareLog.push(text);

    if (/^INSERT\s+OR\s+REPLACE\s+INTO\s+match_reviews/i.test(text)) {
      return {
        run: (params: MatchReviewRow) => {
          const idx = this.rows.findIndex((r) => r.source_id === params.source_id);
          if (idx >= 0) this.rows.splice(idx, 1);
          this.rows.push({ ...params });
          return { changes: 1 };
        },
      };
    }
    if (/^UPDATE\s+match_reviews\s+SET\s+stale/i.test(text)) {
      return {
        run: (sourceId: string) => {
          const row = this.rows.find((r) => r.source_id === sourceId);
          if (!row) return { changes: 0 };
          row.stale = 1;
          return { changes: 1 };
        },
      };
    }
    if (/^SELECT[\s\S]+FROM\s+match_reviews\s+WHERE\s+source_id/i.test(text)) {
      return {
        all: (sourceId: string) => this.rows.filter((r) => r.source_id === sourceId),
      };
    }
    if (/^SELECT[\s\S]+FROM\s+match_reviews/i.test(text)) {
      return {
        all: () => [...this.rows].sort((a, b) => a.source_id.localeCompare(b.source_id)),
      };
    }
    throw new Error(`FakeDatabase: unsupported SQL: ${text}`);
  }
}

async function importModule() {
  return await import('../matchReviews');
}

afterEach(() => {
  vi.resetModules();
});

// --- fixtures --------------------------------------------------------------

function makeReview(
  overrides: Partial<PersistedMatchReview> = {},
): PersistedMatchReview {
  return {
    sourceId: 'job-1',
    archetype: 'platform',
    requirements: [
      { requirement: '5y backend', evidence: '6y at Acme', met: true },
      { requirement: 'Kubernetes', evidence: null, met: false },
    ],
    gaps: [
      { text: 'No k8s prod experience', severity: 'nice_to_have', mitigation: 'Take a course' },
    ],
    strengths: ['Deep distributed systems background'],
    keywords: ['kubernetes', 'observability'],
    summary: 'Strong fit on backend; missing k8s prod experience.',
    modelSlug: 'openrouter/anthropic/claude-3.5-sonnet',
    generatedAt: 1_700_000_000_000,
    stale: false,
    ...overrides,
  };
}

// --- AC1: schema has narrative + provenance + stale, NO score column -------

describe('match_reviews table schema (AC1)', () => {
  it('creates a `match_reviews` table keyed by source_id with NO score/number column', async () => {
    const { createMatchReviewsStore } = await importModule();
    const db = new FakeDatabase();
    createMatchReviewsStore(db as never);

    const createSql = db.execLog.find((s) => /CREATE\s+TABLE/i.test(s));
    expect(createSql).toBeDefined();
    expect(createSql!).toMatch(/match_reviews/i);
    expect(createSql!).toMatch(/source_id\s+TEXT\s+PRIMARY\s+KEY/i);

    // Narrative + provenance + stale columns are present.
    expect(createSql!).toMatch(/requirements/i);
    expect(createSql!).toMatch(/gaps/i);
    expect(createSql!).toMatch(/strengths/i);
    expect(createSql!).toMatch(/keywords/i);
    expect(createSql!).toMatch(/summary/i);
    expect(createSql!).toMatch(/archetype/i);
    expect(createSql!).toMatch(/model_slug/i);
    expect(createSql!).toMatch(/generated_at/i);
    expect(createSql!).toMatch(/stale/i);

    // HARD BOUNDARY: no score / number / percent / stars column.
    expect(createSql!).not.toMatch(/\bscore\b/i);
    expect(createSql!).not.toMatch(/\bpercent\b/i);
    expect(createSql!).not.toMatch(/\bstars\b/i);
    expect(createSql!).not.toMatch(/\brating\b/i);
  });
});

// --- AC2: get / upsert / markStale contract --------------------------------

describe('createMatchReviewsStore — get / upsert / markStale (AC2)', () => {
  it('upsert persists a MatchReview retrievable by sourceId via get()', async () => {
    const { createMatchReviewsStore } = await importModule();
    const db = new FakeDatabase();
    const store = createMatchReviewsStore(db as never);

    const review = makeReview();
    store.upsert(review);

    const got = store.get('job-1');
    expect(got).toBeDefined();
    expect(got!.sourceId).toBe('job-1');
    expect(got!.summary).toBe(review.summary);
    expect(got!.archetype).toBe('platform');
    expect(got!.requirements).toEqual(review.requirements);
    expect(got!.gaps).toEqual(review.gaps);
    expect(got!.strengths).toEqual(review.strengths);
    expect(got!.keywords).toEqual(review.keywords);
    expect(got!.modelSlug).toBe('openrouter/anthropic/claude-3.5-sonnet');
    expect(got!.generatedAt).toBe(1_700_000_000_000);
    expect(got!.stale).toBe(false);
  });

  it('get returns undefined for an unknown sourceId', async () => {
    const { createMatchReviewsStore } = await importModule();
    const db = new FakeDatabase();
    const store = createMatchReviewsStore(db as never);
    expect(store.get('does-not-exist')).toBeUndefined();
  });

  it('upsert on an existing sourceId replaces the prior row (no duplicates)', async () => {
    const { createMatchReviewsStore } = await importModule();
    const db = new FakeDatabase();
    const store = createMatchReviewsStore(db as never);

    store.upsert(makeReview({ summary: 'first' }));
    store.upsert(makeReview({ summary: 'second' }));

    expect(db.rows).toHaveLength(1);
    expect(store.get('job-1')!.summary).toBe('second');
  });

  it('exposes exactly the three-op contract: get, upsert, markStale', async () => {
    const { createMatchReviewsStore } = await importModule();
    const db = new FakeDatabase();
    const store = createMatchReviewsStore(db as never);

    expect(typeof store.get).toBe('function');
    expect(typeof store.upsert).toBe('function');
    expect(typeof store.markStale).toBe('function');
  });
});

// --- AC3: restart durability (FR-004) --------------------------------------

describe('restart durability (AC3 / FR-004)', () => {
  it('a second store opened on the same DB sees the previously upserted row', async () => {
    const { createMatchReviewsStore } = await importModule();
    const db = new FakeDatabase();

    const store1 = createMatchReviewsStore(db as never);
    store1.upsert(
      makeReview({ sourceId: 'survives', summary: 'before restart', modelSlug: 'm/x' }),
    );

    // Simulate a restart — fresh store, same DB handle (same on-disk file).
    const store2 = createMatchReviewsStore(db as never);
    const got = store2.get('survives');
    expect(got).toBeDefined();
    expect(got!.summary).toBe('before restart');
    expect(got!.modelSlug).toBe('m/x');
    expect(got!.requirements.length).toBeGreaterThan(0);
  });
});

// --- AC4: markStale preserves the cached narrative --------------------------

describe('markStale preserves the cached narrative (AC4)', () => {
  it('markStale(sourceId) sets stale=true without deleting the narrative blob', async () => {
    const { createMatchReviewsStore } = await importModule();
    const db = new FakeDatabase();
    const store = createMatchReviewsStore(db as never);

    store.upsert(makeReview({ sourceId: 'job-1', summary: 'the prior review' }));
    store.markStale('job-1');

    const got = store.get('job-1');
    expect(got).toBeDefined();
    expect(got!.stale).toBe(true);
    // Prior narrative is preserved — markStale does NOT clear it. The UI can
    // still render the cached review alongside a "regenerate" affordance.
    expect(got!.summary).toBe('the prior review');
    expect(got!.requirements.length).toBeGreaterThan(0);
    expect(got!.gaps.length).toBeGreaterThan(0);
    expect(got!.strengths.length).toBeGreaterThan(0);
    expect(got!.keywords.length).toBeGreaterThan(0);
    expect(got!.modelSlug).toBeDefined();
    expect(got!.generatedAt).toBeDefined();
  });

  it('markStale is a no-op for an unknown sourceId (does not throw)', async () => {
    const { createMatchReviewsStore } = await importModule();
    const db = new FakeDatabase();
    const store = createMatchReviewsStore(db as never);
    expect(() => store.markStale('nope')).not.toThrow();
  });

  it('a regenerate (upsert after markStale) clears the stale flag', async () => {
    const { createMatchReviewsStore } = await importModule();
    const db = new FakeDatabase();
    const store = createMatchReviewsStore(db as never);

    store.upsert(makeReview({ sourceId: 'job-1' }));
    store.markStale('job-1');
    expect(store.get('job-1')!.stale).toBe(true);

    store.upsert(makeReview({ sourceId: 'job-1', summary: 'regenerated' }));
    const got = store.get('job-1')!;
    expect(got.stale).toBe(false);
    expect(got.summary).toBe('regenerated');
  });
});

// --- AC5: strictly separate from match_scores (NFR-001) --------------------

describe('strictly separate from match_scores (AC5 / NFR-001)', () => {
  it('the module never references the match_scores table in any SQL statement', async () => {
    const { createMatchReviewsStore } = await importModule();
    const db = new FakeDatabase();
    const store = createMatchReviewsStore(db as never);

    store.upsert(makeReview());
    store.get('job-1');
    store.markStale('job-1');

    for (const sql of db.execLog) {
      expect(sql).not.toMatch(/match_scores/i);
    }
    for (const sql of db.prepareLog) {
      expect(sql).not.toMatch(/match_scores/i);
    }
  });

  it('the MatchReview surface carries no numeric / score / star / percent field', async () => {
    const { createMatchReviewsStore } = await importModule();
    const db = new FakeDatabase();
    const store = createMatchReviewsStore(db as never);

    store.upsert(makeReview());
    const got = store.get('job-1')! as unknown as Record<string, unknown>;
    expect(got).not.toHaveProperty('score');
    expect(got).not.toHaveProperty('stars');
    expect(got).not.toHaveProperty('percent');
    expect(got).not.toHaveProperty('rating');
  });
});
