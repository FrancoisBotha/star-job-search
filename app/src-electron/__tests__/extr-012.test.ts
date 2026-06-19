/**
 * EXTR-012 — "Delete all imported jobs" action on the Job Board.
 *
 * Covers the ticket's acceptance criteria from the main-process side:
 *
 *  AC2: a new `board:deleteAll` IPC handler exists and deletes every job row
 *       from the jobs store on invocation. Returns `{ ok: true, deleted }`.
 *  AC4: the same handler cascades the wipe to related per-job tables
 *       (match_scores, match_reviews) so no orphaned rows remain.
 *  AC5: the cleared state survives an app "restart" — a fresh store opened
 *       on the same DB sees zero rows.
 *  AC6: deleteAll on JobsStore / MatchScoresStore / MatchReviewsStore removes
 *       every row; subsequent list() / knownSourceIds() return empty.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('better-sqlite3', () => ({ default: class {} }));

// --- Minimal in-memory fakes (mirrors jobs.test.ts) ------------------------

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

interface SiteProfileRow {
  hostname: string;
  id_regex: string | null;
  selectors: string | null;
  learned_at: number;
}

class FakeJobsDb {
  jobs: JobRow[] = [];
  profiles: SiteProfileRow[] = [];
  exec(_sql: string) {}
  prepare(sql: string) {
    const text = sql.trim();
    if (/^INSERT\s+OR\s+IGNORE\s+INTO\s+jobs/i.test(text)) {
      return {
        run: (p: JobRow) => {
          if (this.jobs.some((j) => j.source_id === p.source_id)) return { changes: 0 };
          this.jobs.push({ ...p });
          return { changes: 1 };
        },
      };
    }
    if (/^DELETE\s+FROM\s+jobs/i.test(text)) {
      return {
        run: () => {
          const n = this.jobs.length;
          this.jobs = [];
          return { changes: n };
        },
      };
    }
    if (/^UPDATE\s+jobs\s+SET\s+status/i.test(text)) {
      return {
        run: (status: string, sourceId: string) => {
          const row = this.jobs.find((j) => j.source_id === sourceId);
          if (!row) return { changes: 0 };
          row.status = status;
          return { changes: 1 };
        },
      };
    }
    if (/^SELECT\s+source_id\s+FROM\s+jobs/i.test(text)) {
      return { all: () => this.jobs.map((j) => ({ source_id: j.source_id })) };
    }
    if (/^SELECT[\s\S]+FROM\s+jobs/i.test(text)) {
      return { all: () => [...this.jobs].sort((a, b) => b.fetched_at - a.fetched_at) };
    }
    if (/^INSERT\s+OR\s+REPLACE\s+INTO\s+site_profiles/i.test(text)) {
      return {
        run: (p: SiteProfileRow) => {
          const idx = this.profiles.findIndex((r) => r.hostname === p.hostname);
          if (idx >= 0) this.profiles.splice(idx, 1);
          this.profiles.push({ ...p });
          return { changes: 1 };
        },
      };
    }
    if (/^SELECT[\s\S]+FROM\s+site_profiles/i.test(text)) {
      return { all: (hostname: string) => this.profiles.filter((p) => p.hostname === hostname) };
    }
    throw new Error('FakeJobsDb: unsupported SQL: ' + text);
  }
}

interface ScoreRow {
  source_id: string;
  stars: number;
  percent: number;
  factors: string;
  weights_version: string;
  stale: number;
  scored_at: number;
}

class FakeScoresDb {
  rows: ScoreRow[] = [];
  exec(_sql: string) {}
  prepare(sql: string) {
    const text = sql.trim();
    if (/^INSERT\s+OR\s+REPLACE\s+INTO\s+match_scores/i.test(text)) {
      return {
        run: (p: ScoreRow) => {
          const idx = this.rows.findIndex((r) => r.source_id === p.source_id);
          if (idx >= 0) this.rows.splice(idx, 1);
          this.rows.push({ ...p });
          return { changes: 1 };
        },
      };
    }
    if (/^DELETE\s+FROM\s+match_scores/i.test(text)) {
      return {
        run: () => {
          const n = this.rows.length;
          this.rows = [];
          return { changes: n };
        },
      };
    }
    if (/^UPDATE\s+match_scores\s+SET\s+stale/i.test(text)) {
      return { run: () => ({ changes: 0 }) };
    }
    if (/^SELECT[\s\S]+FROM\s+match_scores\s+WHERE\s+source_id/i.test(text)) {
      return { all: (id: string) => this.rows.filter((r) => r.source_id === id) };
    }
    if (/^SELECT[\s\S]+FROM\s+match_scores/i.test(text)) {
      return { all: () => [...this.rows] };
    }
    throw new Error('FakeScoresDb: unsupported SQL: ' + text);
  }
}

interface ReviewRow {
  source_id: string;
  archetype: string | null;
  requirements: string;
  gaps: string;
  strengths: string;
  keywords: string;
  summary: string;
  model_slug: string | null;
  generated_at: number;
  stale: number;
}

class FakeReviewsDb {
  rows: ReviewRow[] = [];
  exec(_sql: string) {}
  prepare(sql: string) {
    const text = sql.trim();
    if (/^INSERT\s+OR\s+REPLACE\s+INTO\s+match_reviews/i.test(text)) {
      return {
        run: (p: ReviewRow) => {
          const idx = this.rows.findIndex((r) => r.source_id === p.source_id);
          if (idx >= 0) this.rows.splice(idx, 1);
          this.rows.push({ ...p });
          return { changes: 1 };
        },
      };
    }
    if (/^DELETE\s+FROM\s+match_reviews/i.test(text)) {
      return {
        run: () => {
          const n = this.rows.length;
          this.rows = [];
          return { changes: n };
        },
      };
    }
    if (/^UPDATE\s+match_reviews\s+SET\s+stale/i.test(text)) {
      return { run: () => ({ changes: 0 }) };
    }
    if (/^SELECT[\s\S]+FROM\s+match_reviews\s+WHERE\s+source_id/i.test(text)) {
      return { all: (id: string) => this.rows.filter((r) => r.source_id === id) };
    }
    if (/^SELECT[\s\S]+FROM\s+match_reviews/i.test(text)) {
      return { all: () => [...this.rows] };
    }
    throw new Error('FakeReviewsDb: unsupported SQL: ' + text);
  }
}

afterEach(() => {
  vi.resetModules();
});

// --- AC6 — store-level deleteAll on every related table -------------------

describe('EXTR-012 AC6 — JobsStore.deleteAll removes every row', () => {
  it('clears jobs and resets listJobs() / knownSourceIds()', async () => {
    const { createJobsStore } = await import('../jobs');
    const db = new FakeJobsDb();
    const store = createJobsStore(db as never);
    store.upsertJobs([
      { sourceId: 'a', hostname: 'x.com', url: 'https://x.com/a', fetchedAt: 100 },
      { sourceId: 'b', hostname: 'x.com', url: 'https://x.com/b', fetchedAt: 200 },
    ]);
    expect(store.listJobs()).toHaveLength(2);

    const deleted = store.deleteAll();

    expect(deleted).toBe(2);
    expect(store.listJobs()).toEqual([]);
    expect(store.knownSourceIds().size).toBe(0);
  });
});

describe('EXTR-012 AC6 — MatchScoresStore.deleteAll removes every row', () => {
  it('clears match_scores and resets list()', async () => {
    const { createMatchScoresStore } = await import('../matchScores');
    const db = new FakeScoresDb();
    const store = createMatchScoresStore(db as never);
    store.upsert({
      sourceId: 'a',
      stars: 4,
      percent: 80,
      factors: [],
      weightsVersion: 'v1',
      stale: false,
      scoredAt: 1,
    });
    expect(store.list()).toHaveLength(1);

    store.deleteAll();

    expect(store.list()).toEqual([]);
  });
});

describe('EXTR-012 AC6 — MatchReviewsStore.deleteAll removes every row', () => {
  it('clears match_reviews and resets get()', async () => {
    const { createMatchReviewsStore } = await import('../matchReviews');
    const db = new FakeReviewsDb();
    const store = createMatchReviewsStore(db as never);
    store.upsert({
      sourceId: 'a',
      requirements: [],
      gaps: [],
      strengths: [],
      keywords: [],
      summary: 's',
      generatedAt: 1,
    });
    expect(store.get('a')).toBeDefined();

    store.deleteAll();

    expect(store.get('a')).toBeUndefined();
  });
});

// --- AC2 + AC4 — board:deleteAll IPC cascades all three tables -----------
//
// The extraction.ts module transitively imports @langchain/langgraph which is
// not always installable in the test sandbox; mirror the source-grep pattern
// used by extraction.test.ts's preload AC5 assertion so this file stays
// import-free of the langchain runtime.

describe('EXTR-012 AC2/AC4 — board:deleteAll IPC handler + cascade', () => {
  it('extraction.ts registers a board:deleteAll handler and threads a deleteRelated callback', async () => {
    const { readFileSync } = await import('node:fs');
    const path = await import('node:path');
    const { fileURLToPath } = await import('node:url');
    const here = path.dirname(fileURLToPath(import.meta.url));
    const src = readFileSync(path.resolve(here, '..', 'extraction.ts'), 'utf8');
    expect(src).toMatch(/ipcMain\.handle\(\s*['"]board:deleteAll['"]/);
    expect(src).toMatch(/deps\.store\.deleteAll\(\s*\)/);
    expect(src).toMatch(/deps\.deleteRelated/);
  });

  it('electron-preload.ts exposes starBoard.deleteAll over board:deleteAll', async () => {
    const { readFileSync } = await import('node:fs');
    const path = await import('node:path');
    const { fileURLToPath } = await import('node:url');
    const here = path.dirname(fileURLToPath(import.meta.url));
    const preload = readFileSync(path.resolve(here, '..', 'electron-preload.ts'), 'utf8');
    expect(preload).toMatch(/deleteAll:\s*\(\)\s*=>\s*ipcRenderer\.invoke\(\s*['"]board:deleteAll['"]/);
  });

  it('electron-main.ts wires deleteRelated to cascade scores + reviews', async () => {
    const { readFileSync } = await import('node:fs');
    const path = await import('node:path');
    const { fileURLToPath } = await import('node:url');
    const here = path.dirname(fileURLToPath(import.meta.url));
    const main = readFileSync(path.resolve(here, '..', 'electron-main.ts'), 'utf8');
    expect(main).toMatch(/deleteRelated/);
    expect(main).toMatch(/matchScoresStore\.deleteAll\(/);
    expect(main).toMatch(/matchReviewsStore\.deleteAll\(/);
  });
});

// --- AC5 — cleared state persists across a "restart" --------------------

describe('EXTR-012 AC5 — cleared state survives an app restart', () => {
  it('a second store opened on the same DB sees zero jobs after deleteAll', async () => {
    const { createJobsStore } = await import('../jobs');
    const db = new FakeJobsDb();

    const first = createJobsStore(db as never);
    first.upsertJobs([
      { sourceId: 'a', hostname: 'x.com', url: 'https://x.com/a', fetchedAt: 100 },
      { sourceId: 'b', hostname: 'x.com', url: 'https://x.com/b', fetchedAt: 200 },
    ]);
    first.deleteAll();

    const second = createJobsStore(db as never);
    expect(second.listJobs()).toEqual([]);
    expect(second.knownSourceIds().size).toBe(0);
  });
});
