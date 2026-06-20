/**
 * Unit tests for the eval-reports persistence module (EVAL-002 / Epic 14).
 *
 * Covers acceptance criteria:
 *  - AC1: a new `eval_reports` table keyed by source_id stores the A/C/D/G/H
 *         narrative + researched sources + legitimacy verdict + verification
 *         note + provenance (model_slug, generated_at) + stale flag —
 *         and NO score / number / percent / star / rating column.
 *         (Block B is referenced from `match_reviews` — never duplicated here.)
 *  - AC2: get / upsert / markStale mirror the Epic 6 match_reviews store.
 *  - AC3: persisted reports survive a "restart" (a second store opened over
 *         the same DB sees the previously upserted row).
 *  - AC4: markStale flips stale=true WITHOUT deleting the narrative; a
 *         regenerate (upsert) clears the stale flag.
 *  - AC5: NO score column / field by construction (Epic 6 hard boundary —
 *         the evaluation path never surfaces a number alongside the
 *         deterministic stars).
 *  - AC6: this store NEVER references `match_scores`, and never duplicates
 *         the Block B columns owned by `match_reviews` (no `requirements`,
 *         `gaps`, `strengths`, `keywords`, `summary` columns here).
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { PersistedEvalReport } from '../evalReports';

// Avoid pulling in the native binding during tests — same pattern as the
// matchReviews / matchScores / sites / jobs stores.
vi.mock('better-sqlite3', () => {
  return { default: class {} };
});

// --- Minimal in-memory fake of the better-sqlite3 surface we use -----------

interface EvalReportRow {
  source_id: string;
  block_a: string;
  block_c: string;
  block_d: string;
  block_g: string;
  block_h: string;
  sources: string; // JSON
  legitimacy_verdict: string;
  verification_note: string;
  model_slug: string | null;
  generated_at: number;
  stale: number;
}

class FakeDatabase {
  rows: EvalReportRow[] = [];
  execLog: string[] = [];
  prepareLog: string[] = [];

  exec(sql: string) {
    this.execLog.push(sql);
  }
  prepare(sql: string) {
    const text = sql.trim();
    this.prepareLog.push(text);

    if (/^INSERT\s+OR\s+REPLACE\s+INTO\s+eval_reports/i.test(text)) {
      return {
        run: (params: EvalReportRow) => {
          const idx = this.rows.findIndex((r) => r.source_id === params.source_id);
          if (idx >= 0) this.rows.splice(idx, 1);
          this.rows.push({ ...params });
          return { changes: 1 };
        },
      };
    }
    if (/^UPDATE\s+eval_reports\s+SET\s+stale/i.test(text)) {
      return {
        run: (sourceId: string) => {
          const row = this.rows.find((r) => r.source_id === sourceId);
          if (!row) return { changes: 0 };
          row.stale = 1;
          return { changes: 1 };
        },
      };
    }
    if (/^SELECT[\s\S]+FROM\s+eval_reports\s+WHERE\s+source_id/i.test(text)) {
      return {
        all: (sourceId: string) => this.rows.filter((r) => r.source_id === sourceId),
      };
    }
    if (/^DELETE\s+FROM\s+eval_reports\s+WHERE\s+source_id/i.test(text)) {
      return {
        run: (sourceId: string) => {
          const idx = this.rows.findIndex((r) => r.source_id === sourceId);
          if (idx < 0) return { changes: 0 };
          this.rows.splice(idx, 1);
          return { changes: 1 };
        },
      };
    }
    if (/^DELETE\s+FROM\s+eval_reports/i.test(text)) {
      return {
        run: () => {
          const n = this.rows.length;
          this.rows = [];
          return { changes: n };
        },
      };
    }
    throw new Error(`FakeDatabase: unsupported SQL: ${text}`);
  }
}

async function importModule() {
  return await import('../evalReports');
}

afterEach(() => {
  vi.resetModules();
});

// --- fixtures --------------------------------------------------------------

function makeReport(
  overrides: Partial<PersistedEvalReport> = {},
): PersistedEvalReport {
  return {
    sourceId: 'job-1',
    blockA: 'Block A narrative — role fit context.',
    blockC: 'Block C narrative — comp + level.',
    blockD: 'Block D narrative — risks & open questions.',
    blockG: 'Block G narrative — growth signals.',
    blockH: 'Block H narrative — application strategy.',
    sources: [
      { title: 'Company About page', url: 'https://example.com/about' },
      { title: 'Glassdoor profile', url: 'https://glassdoor.com/example' },
    ],
    legitimacyVerdict: 'legitimate',
    verificationNote: 'Confirmed against company website and LinkedIn page.',
    modelSlug: 'openrouter/anthropic/claude-3.5-sonnet',
    generatedAt: 1_700_000_000_000,
    stale: false,
    ...overrides,
  };
}

// --- AC1 + AC5: schema has narrative + provenance + stale, NO score column -

describe('eval_reports table schema (AC1, AC5)', () => {
  it('creates an `eval_reports` table keyed by source_id with NO score/number column', async () => {
    const { createEvalReportsStore } = await importModule();
    const db = new FakeDatabase();
    createEvalReportsStore(db as never);

    const createSql = db.execLog.find((s) => /CREATE\s+TABLE/i.test(s));
    expect(createSql).toBeDefined();
    expect(createSql!).toMatch(/eval_reports/i);
    expect(createSql!).toMatch(/source_id\s+TEXT\s+PRIMARY\s+KEY/i);

    // A/C/D/G/H narrative columns are present — B is intentionally absent
    // (Block B is referenced from match_reviews, never duplicated here).
    expect(createSql!).toMatch(/block_a/i);
    expect(createSql!).toMatch(/block_c/i);
    expect(createSql!).toMatch(/block_d/i);
    expect(createSql!).toMatch(/block_g/i);
    expect(createSql!).toMatch(/block_h/i);

    // Researched sources + legitimacy verdict + verification note + stale.
    expect(createSql!).toMatch(/sources/i);
    expect(createSql!).toMatch(/legitimacy_verdict/i);
    expect(createSql!).toMatch(/verification_note/i);

    // Provenance.
    expect(createSql!).toMatch(/model_slug/i);
    expect(createSql!).toMatch(/generated_at/i);
    expect(createSql!).toMatch(/stale/i);

    // HARD BOUNDARY: no score / number / percent / stars / rating column.
    expect(createSql!).not.toMatch(/\bscore\b/i);
    expect(createSql!).not.toMatch(/\bpercent\b/i);
    expect(createSql!).not.toMatch(/\bstars\b/i);
    expect(createSql!).not.toMatch(/\brating\b/i);
  });

  it('does NOT duplicate Block B columns owned by match_reviews (AC6)', async () => {
    const { createEvalReportsStore } = await importModule();
    const db = new FakeDatabase();
    createEvalReportsStore(db as never);

    const createSql = db.execLog.find((s) => /CREATE\s+TABLE/i.test(s));
    expect(createSql).toBeDefined();
    // Block B fields live in `match_reviews` — never re-stored here.
    expect(createSql!).not.toMatch(/\bblock_b\b/i);
    expect(createSql!).not.toMatch(/\brequirements\b/i);
    expect(createSql!).not.toMatch(/\bgaps\b/i);
    expect(createSql!).not.toMatch(/\bstrengths\b/i);
    expect(createSql!).not.toMatch(/\bkeywords\b/i);
    expect(createSql!).not.toMatch(/\bsummary\b/i);
  });
});

// --- AC2: get / upsert / markStale contract --------------------------------

describe('createEvalReportsStore — get / upsert / markStale (AC2)', () => {
  it('upsert persists an EvalReport retrievable by sourceId via get()', async () => {
    const { createEvalReportsStore } = await importModule();
    const db = new FakeDatabase();
    const store = createEvalReportsStore(db as never);

    const report = makeReport();
    store.upsert(report);

    const got = store.get('job-1');
    expect(got).toBeDefined();
    expect(got!.sourceId).toBe('job-1');
    expect(got!.blockA).toBe(report.blockA);
    expect(got!.blockC).toBe(report.blockC);
    expect(got!.blockD).toBe(report.blockD);
    expect(got!.blockG).toBe(report.blockG);
    expect(got!.blockH).toBe(report.blockH);
    expect(got!.sources).toEqual(report.sources);
    expect(got!.legitimacyVerdict).toBe('legitimate');
    expect(got!.verificationNote).toBe(report.verificationNote);
    expect(got!.modelSlug).toBe('openrouter/anthropic/claude-3.5-sonnet');
    expect(got!.generatedAt).toBe(1_700_000_000_000);
    expect(got!.stale).toBe(false);
  });

  it('get returns undefined for an unknown sourceId', async () => {
    const { createEvalReportsStore } = await importModule();
    const db = new FakeDatabase();
    const store = createEvalReportsStore(db as never);
    expect(store.get('does-not-exist')).toBeUndefined();
  });

  it('upsert on an existing sourceId replaces the prior row (no duplicates)', async () => {
    const { createEvalReportsStore } = await importModule();
    const db = new FakeDatabase();
    const store = createEvalReportsStore(db as never);

    store.upsert(makeReport({ blockA: 'first' }));
    store.upsert(makeReport({ blockA: 'second' }));

    expect(db.rows).toHaveLength(1);
    expect(store.get('job-1')!.blockA).toBe('second');
  });

  it('exposes the three-op contract: get, upsert, markStale', async () => {
    const { createEvalReportsStore } = await importModule();
    const db = new FakeDatabase();
    const store = createEvalReportsStore(db as never);

    expect(typeof store.get).toBe('function');
    expect(typeof store.upsert).toBe('function');
    expect(typeof store.markStale).toBe('function');
  });
});

// --- AC3: restart durability -----------------------------------------------

describe('restart durability (AC3)', () => {
  it('a second store opened on the same DB sees the previously upserted row', async () => {
    const { createEvalReportsStore } = await importModule();
    const db = new FakeDatabase();

    const store1 = createEvalReportsStore(db as never);
    store1.upsert(
      makeReport({ sourceId: 'survives', blockA: 'before restart', modelSlug: 'm/x' }),
    );

    // Simulate a restart — fresh store, same DB handle (same on-disk file).
    const store2 = createEvalReportsStore(db as never);
    const got = store2.get('survives');
    expect(got).toBeDefined();
    expect(got!.blockA).toBe('before restart');
    expect(got!.modelSlug).toBe('m/x');
    expect(got!.sources.length).toBeGreaterThan(0);
  });
});

// --- AC4: markStale preserves the cached narrative --------------------------

describe('markStale preserves the cached narrative (AC4)', () => {
  it('markStale(sourceId) sets stale=true without deleting the narrative', async () => {
    const { createEvalReportsStore } = await importModule();
    const db = new FakeDatabase();
    const store = createEvalReportsStore(db as never);

    store.upsert(makeReport({ sourceId: 'job-1', blockA: 'the prior narrative' }));
    store.markStale('job-1');

    const got = store.get('job-1');
    expect(got).toBeDefined();
    expect(got!.stale).toBe(true);
    expect(got!.blockA).toBe('the prior narrative');
    expect(got!.blockC.length).toBeGreaterThan(0);
    expect(got!.blockD.length).toBeGreaterThan(0);
    expect(got!.blockG.length).toBeGreaterThan(0);
    expect(got!.blockH.length).toBeGreaterThan(0);
    expect(got!.sources.length).toBeGreaterThan(0);
    expect(got!.legitimacyVerdict.length).toBeGreaterThan(0);
    expect(got!.verificationNote.length).toBeGreaterThan(0);
    expect(got!.modelSlug).toBeDefined();
    expect(got!.generatedAt).toBeDefined();
  });

  it('markStale is a no-op for an unknown sourceId (does not throw)', async () => {
    const { createEvalReportsStore } = await importModule();
    const db = new FakeDatabase();
    const store = createEvalReportsStore(db as never);
    expect(() => store.markStale('nope')).not.toThrow();
  });

  it('a regenerate (upsert after markStale) clears the stale flag', async () => {
    const { createEvalReportsStore } = await importModule();
    const db = new FakeDatabase();
    const store = createEvalReportsStore(db as never);

    store.upsert(makeReport({ sourceId: 'job-1' }));
    store.markStale('job-1');
    expect(store.get('job-1')!.stale).toBe(true);

    store.upsert(makeReport({ sourceId: 'job-1', blockA: 'regenerated' }));
    const got = store.get('job-1')!;
    expect(got.stale).toBe(false);
    expect(got.blockA).toBe('regenerated');
  });
});

// --- AC5 / AC6: NO score, never touch match_scores --------------------------

describe('no score & no cross-store reads (AC5, AC6)', () => {
  it('the module never references match_scores in any SQL statement', async () => {
    const { createEvalReportsStore } = await importModule();
    const db = new FakeDatabase();
    const store = createEvalReportsStore(db as never);

    store.upsert(makeReport());
    store.get('job-1');
    store.markStale('job-1');

    for (const sql of db.execLog) {
      expect(sql).not.toMatch(/match_scores/i);
    }
    for (const sql of db.prepareLog) {
      expect(sql).not.toMatch(/match_scores/i);
    }
  });

  it('the EvalReport surface carries no numeric / score / star / percent field', async () => {
    const { createEvalReportsStore } = await importModule();
    const db = new FakeDatabase();
    const store = createEvalReportsStore(db as never);

    store.upsert(makeReport());
    const got = store.get('job-1')! as unknown as Record<string, unknown>;
    expect(got).not.toHaveProperty('score');
    expect(got).not.toHaveProperty('stars');
    expect(got).not.toHaveProperty('percent');
    expect(got).not.toHaveProperty('rating');
  });
});
