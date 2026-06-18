/**
 * Unit tests for the match-scores persistence module (SCORE-003).
 *
 * Covers acceptance criteria:
 *  - AC1: match_scores table is created on star.db, keyed by source_id, with
 *         factors persisted (JSON column) alongside the other star.db tables.
 *  - AC2: createMatchScoresStore exposes get(sourceId), list(), upsert(MatchScore)
 *         and markStale(...) — the four-op contract mirroring sites.ts.
 *  - AC3: each persisted row records the weightsVersion used so a score is
 *         reproducible/auditable (FR-005).
 *  - AC4: scores survive an app restart (a second store opened on the same DB
 *         sees the previously upserted row, including weightsVersion).
 *  - AC5: markStale sets stale=true for the affected sourceId(s) WITHOUT
 *         deleting the prior score, leaving the percent / factors intact.
 *  - AC6: the persisted shape round-trips through the canonical deserialiser
 *         used by the renderer/store contract (factor array, MatchFactor
 *         shape, stale flag, weightsVersion, scoredAt all preserved).
 *  - AC7: upsert acts as INSERT-OR-REPLACE — re-upserting the same sourceId
 *         updates the row, does not duplicate it; list() returns all rows.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { MatchScore } from '../scorer';

// Avoid pulling in the native binding during tests — same pattern as sites/jobs.
vi.mock('better-sqlite3', () => {
  return { default: class {} };
});

// --- Minimal in-memory fake of the better-sqlite3 surface we use -----------

interface MatchScoreRow {
  source_id: string;
  stars: number;
  percent: number;
  factors: string; // JSON
  weights_version: string;
  stale: number;
  scored_at: number;
}

class FakeDatabase {
  rows: MatchScoreRow[] = [];
  exec(_sql: string) {
    // CREATE TABLE — no-op for the fake.
  }
  prepare(sql: string) {
    const text = sql.trim();
    if (/^INSERT\s+OR\s+REPLACE\s+INTO\s+match_scores/i.test(text)) {
      return {
        run: (params: MatchScoreRow) => {
          const idx = this.rows.findIndex((r) => r.source_id === params.source_id);
          if (idx >= 0) this.rows.splice(idx, 1);
          this.rows.push({ ...params });
          return { changes: 1 };
        },
      };
    }
    if (/^UPDATE\s+match_scores\s+SET\s+stale/i.test(text)) {
      return {
        run: (sourceId: string) => {
          const row = this.rows.find((r) => r.source_id === sourceId);
          if (!row) return { changes: 0 };
          row.stale = 1;
          return { changes: 1 };
        },
      };
    }
    if (/^SELECT[\s\S]+FROM\s+match_scores\s+WHERE\s+source_id/i.test(text)) {
      return {
        all: (sourceId: string) => this.rows.filter((r) => r.source_id === sourceId),
      };
    }
    if (/^SELECT[\s\S]+FROM\s+match_scores/i.test(text)) {
      return {
        all: () => [...this.rows].sort((a, b) => a.source_id.localeCompare(b.source_id)),
      };
    }
    throw new Error(`FakeDatabase: unsupported SQL: ${text}`);
  }
}

async function importModule() {
  return await import('../matchScores');
}

beforeEach(() => {
  // nothing.
});

afterEach(() => {
  vi.resetModules();
});

// --- fixtures --------------------------------------------------------------

function makeScore(overrides: Partial<MatchScore> = {}): MatchScore {
  return {
    sourceId: 'job-1',
    stars: 4.2,
    percent: 80,
    factors: [
      { key: 'skills', included: true, score: 90, weight: 0.5, rationale: 'matched 9/10' },
      { key: 'experience', included: true, score: 70, weight: 0.3, rationale: '5y >= 3y' },
      { key: 'location', included: true, score: 80, weight: 0.2, rationale: 'remote ok' },
      { key: 'salary', included: false, score: 0, weight: 0, rationale: 'not stated' },
    ],
    weightsVersion: 'v1',
    stale: false,
    scoredAt: 1_700_000_000_000,
    ...overrides,
  };
}

// --- AC2 / AC7: upsert / get / list ----------------------------------------

describe('createMatchScoresStore — upsert / get / list (AC2, AC7)', () => {
  it('upsert persists a MatchScore retrievable by sourceId via get()', async () => {
    const { createMatchScoresStore } = await importModule();
    const db = new FakeDatabase();
    const store = createMatchScoresStore(db as never);

    const ms = makeScore();
    store.upsert(ms);

    const got = store.get('job-1');
    expect(got).toBeDefined();
    expect(got!.sourceId).toBe('job-1');
    expect(got!.stars).toBeCloseTo(4.2, 10);
    expect(got!.percent).toBeCloseTo(80, 10);
    expect(got!.weightsVersion).toBe('v1');
    expect(got!.stale).toBe(false);
    expect(got!.scoredAt).toBe(1_700_000_000_000);
  });

  it('get returns undefined for an unknown sourceId', async () => {
    const { createMatchScoresStore } = await importModule();
    const db = new FakeDatabase();
    const store = createMatchScoresStore(db as never);
    expect(store.get('does-not-exist')).toBeUndefined();
  });

  it('upsert on an existing sourceId replaces the prior row (no duplicates)', async () => {
    const { createMatchScoresStore } = await importModule();
    const db = new FakeDatabase();
    const store = createMatchScoresStore(db as never);

    store.upsert(makeScore({ percent: 50, stars: 3 }));
    store.upsert(makeScore({ percent: 90, stars: 4.6 }));

    expect(store.list()).toHaveLength(1);
    expect(store.get('job-1')!.percent).toBeCloseTo(90, 10);
    expect(store.get('job-1')!.stars).toBeCloseTo(4.6, 10);
  });

  it('list returns every persisted MatchScore', async () => {
    const { createMatchScoresStore } = await importModule();
    const db = new FakeDatabase();
    const store = createMatchScoresStore(db as never);

    store.upsert(makeScore({ sourceId: 'job-1' }));
    store.upsert(makeScore({ sourceId: 'job-2', percent: 40, stars: 2.6 }));
    store.upsert(makeScore({ sourceId: 'job-3', percent: 100, stars: 5 }));

    const all = store.list();
    expect(all).toHaveLength(3);
    expect(all.map((s) => s.sourceId).sort()).toEqual(['job-1', 'job-2', 'job-3']);
  });
});

// --- AC3 / AC6: weightsVersion + canonical round-trip ----------------------

describe('weightsVersion + canonical round-trip (AC3, AC6)', () => {
  it('persists and returns the weightsVersion used so the score is auditable', async () => {
    const { createMatchScoresStore } = await importModule();
    const db = new FakeDatabase();
    const store = createMatchScoresStore(db as never);

    store.upsert(makeScore({ sourceId: 'v1-job', weightsVersion: 'v1' }));
    store.upsert(makeScore({ sourceId: 'v2-job', weightsVersion: 'v2-experimental' }));

    expect(store.get('v1-job')!.weightsVersion).toBe('v1');
    expect(store.get('v2-job')!.weightsVersion).toBe('v2-experimental');
  });

  it('round-trips factors[] through the canonical deserialiser intact', async () => {
    const { createMatchScoresStore } = await importModule();
    const db = new FakeDatabase();
    const store = createMatchScoresStore(db as never);

    const ms = makeScore();
    store.upsert(ms);

    const got = store.get('job-1')!;
    expect(got.factors).toEqual(ms.factors);
    // Excluded-factor labelling survives.
    const salary = got.factors.find((f) => f.key === 'salary')!;
    expect(salary.included).toBe(false);
    expect(salary.weight).toBe(0);
    expect(salary.rationale).toBe('not stated');
  });

  it('the canonical deserialiser is exported and converts a raw row to MatchScore', async () => {
    const mod = await importModule();
    // The store must expose a row-to-MatchScore deserialiser for the IPC layer
    // and renderer-side contract to share. Accept either named export.
    const deserialise =
      (mod as Record<string, unknown>).rowToMatchScore ??
      (mod as Record<string, unknown>).deserialiseMatchScoreRow;
    expect(typeof deserialise).toBe('function');

    const raw = {
      source_id: 'job-x',
      stars: 3.5,
      percent: 62.5,
      factors: JSON.stringify([
        { key: 'skills', included: true, score: 60, weight: 1, rationale: 'ok' },
      ]),
      weights_version: 'v1',
      stale: 1,
      scored_at: 42,
    };
    const result = (deserialise as (row: unknown) => MatchScore)(raw);
    expect(result.sourceId).toBe('job-x');
    expect(result.stars).toBeCloseTo(3.5, 10);
    expect(result.percent).toBeCloseTo(62.5, 10);
    expect(result.weightsVersion).toBe('v1');
    expect(result.stale).toBe(true);
    expect(result.scoredAt).toBe(42);
    expect(result.factors).toEqual([
      { key: 'skills', included: true, score: 60, weight: 1, rationale: 'ok' },
    ]);
  });
});

// --- AC4: restart durability ----------------------------------------------

describe('restart durability (AC4)', () => {
  it('a second store opened on the same DB sees the previously upserted row', async () => {
    const { createMatchScoresStore } = await importModule();
    const db = new FakeDatabase();

    const store1 = createMatchScoresStore(db as never);
    store1.upsert(
      makeScore({ sourceId: 'survives', percent: 73, weightsVersion: 'v1' }),
    );

    // Simulate a restart — fresh store, same DB handle (same on-disk file).
    const store2 = createMatchScoresStore(db as never);
    const got = store2.get('survives');
    expect(got).toBeDefined();
    expect(got!.percent).toBeCloseTo(73, 10);
    expect(got!.weightsVersion).toBe('v1');
  });
});

// --- AC5: markStale --------------------------------------------------------

describe('markStale (AC5)', () => {
  it('markStale(sourceId) sets stale=true without deleting the row', async () => {
    const { createMatchScoresStore } = await importModule();
    const db = new FakeDatabase();
    const store = createMatchScoresStore(db as never);

    store.upsert(makeScore({ sourceId: 'job-1', percent: 80 }));
    store.markStale('job-1');

    const got = store.get('job-1');
    expect(got).toBeDefined();
    expect(got!.stale).toBe(true);
    // Prior score is preserved — markStale does NOT clear it.
    expect(got!.percent).toBeCloseTo(80, 10);
    expect(got!.factors.length).toBeGreaterThan(0);
  });

  it('markStale accepts an array of sourceIds and marks each', async () => {
    const { createMatchScoresStore } = await importModule();
    const db = new FakeDatabase();
    const store = createMatchScoresStore(db as never);

    store.upsert(makeScore({ sourceId: 'a' }));
    store.upsert(makeScore({ sourceId: 'b' }));
    store.upsert(makeScore({ sourceId: 'c' }));

    store.markStale(['a', 'c']);

    expect(store.get('a')!.stale).toBe(true);
    expect(store.get('b')!.stale).toBe(false);
    expect(store.get('c')!.stale).toBe(true);
  });

  it('markStale is a no-op for an unknown sourceId (does not throw)', async () => {
    const { createMatchScoresStore } = await importModule();
    const db = new FakeDatabase();
    const store = createMatchScoresStore(db as never);
    expect(() => store.markStale('nope')).not.toThrow();
    expect(store.list()).toHaveLength(0);
  });
});
