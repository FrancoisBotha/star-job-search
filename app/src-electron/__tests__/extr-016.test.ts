/**
 * EXTR-016 — Single-job permanent delete end-to-end.
 *
 * Covers the ticket's acceptance criteria from the main-process side:
 *
 *  AC1: JobsStore.delete(sourceId) removes the job row; MatchScoresStore.delete
 *       and MatchReviewsStore.delete remove the corresponding score/review row
 *       — no orphans remain.
 *  AC2: extraction.ts registers a `board:delete` IPC handler that calls
 *       store.delete + deleteRelated, returning a tagged result
 *       `{ ok: true, deleted }`. electron-preload exposes
 *       `starBoard.delete(sourceId)`; electron-main wires deleteRelatedOne.
 *  AC6: deletion persists across a "restart" — a fresh store on the same DB
 *       sees the job + score + review gone.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('better-sqlite3', () => ({ default: class {} }));

// --- Minimal in-memory fakes -----------------------------------------------

interface JobRow {
  source_id: string;
  hostname: string;
  url: string;
  title: string | null;
  company: string | null;
  location: string | null;
  description: string | null;
  salary: string | null;
  posted_at: number | null;
  fetched_at: number;
  status: string;
}

class FakeJobsDb {
  jobs: JobRow[] = [];
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
    if (/^DELETE\s+FROM\s+jobs\s+WHERE\s+source_id/i.test(text)) {
      return {
        run: (sourceId: string) => {
          const idx = this.jobs.findIndex((j) => j.source_id === sourceId);
          if (idx < 0) return { changes: 0 };
          this.jobs.splice(idx, 1);
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
      return { run: () => ({ changes: 1 }) };
    }
    if (/^SELECT[\s\S]+FROM\s+site_profiles/i.test(text)) {
      return { all: () => [] };
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
    if (/^DELETE\s+FROM\s+match_scores\s+WHERE\s+source_id/i.test(text)) {
      return {
        run: (sourceId: string) => {
          const idx = this.rows.findIndex((r) => r.source_id === sourceId);
          if (idx < 0) return { changes: 0 };
          this.rows.splice(idx, 1);
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
    if (/^DELETE\s+FROM\s+match_reviews\s+WHERE\s+source_id/i.test(text)) {
      return {
        run: (sourceId: string) => {
          const idx = this.rows.findIndex((r) => r.source_id === sourceId);
          if (idx < 0) return { changes: 0 };
          this.rows.splice(idx, 1);
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

// --- AC1 — single-job delete on each store ---------------------------------

describe('EXTR-016 AC1 — JobsStore.delete(sourceId) removes just the targeted row', () => {
  it('removes the targeted job and leaves the rest intact', async () => {
    const { createJobsStore } = await import('../jobs');
    const db = new FakeJobsDb();
    const store = createJobsStore(db as never);
    store.upsertJobs([
      { sourceId: 'a', hostname: 'x.com', url: 'https://x.com/a', fetchedAt: 100 },
      { sourceId: 'b', hostname: 'x.com', url: 'https://x.com/b', fetchedAt: 200 },
    ]);

    store.delete('a');

    const remaining = store.listJobs();
    expect(remaining.map((j) => j.sourceId)).toEqual(['b']);
    expect(store.knownSourceIds().has('a')).toBe(false);
  });
});

describe('EXTR-016 AC1 — MatchScoresStore.delete(sourceId)', () => {
  it('removes the matching score row and leaves the rest intact', async () => {
    const { createMatchScoresStore } = await import('../matchScores');
    const db = new FakeScoresDb();
    const store = createMatchScoresStore(db as never);
    store.upsert({
      sourceId: 'a', stars: 4, percent: 80, factors: [],
      weightsVersion: 'v1', stale: false, scoredAt: 1,
    });
    store.upsert({
      sourceId: 'b', stars: 3, percent: 60, factors: [],
      weightsVersion: 'v1', stale: false, scoredAt: 2,
    });

    store.delete('a');

    expect(store.get('a')).toBeUndefined();
    expect(store.get('b')).toBeDefined();
    expect(store.list()).toHaveLength(1);
  });
});

describe('EXTR-016 AC1 — MatchReviewsStore.delete(sourceId)', () => {
  it('removes the matching review row and leaves the rest intact', async () => {
    const { createMatchReviewsStore } = await import('../matchReviews');
    const db = new FakeReviewsDb();
    const store = createMatchReviewsStore(db as never);
    store.upsert({
      sourceId: 'a', requirements: [], gaps: [], strengths: [],
      keywords: [], summary: 's', generatedAt: 1,
    });
    store.upsert({
      sourceId: 'b', requirements: [], gaps: [], strengths: [],
      keywords: [], summary: 's', generatedAt: 2,
    });

    store.delete('a');

    expect(store.get('a')).toBeUndefined();
    expect(store.get('b')).toBeDefined();
  });
});

// --- AC2 — IPC + preload + main wiring (source-grep, like extr-012) -------

describe('EXTR-016 AC2 — board:delete IPC handler + cascade wiring', () => {
  it('extraction.ts registers a board:delete handler and threads a deleteRelatedOne hook', async () => {
    const { readFileSync } = await import('node:fs');
    const path = await import('node:path');
    const { fileURLToPath } = await import('node:url');
    const here = path.dirname(fileURLToPath(import.meta.url));
    const src = readFileSync(path.resolve(here, '..', 'extraction.ts'), 'utf8');
    expect(src).toMatch(/ipcMain\.handle\(\s*['"]board:delete['"]/);
    expect(src).toMatch(/deps\.store\.delete\(/);
    expect(src).toMatch(/deps\.deleteRelatedOne/);
  });

  it('electron-preload.ts exposes starBoard.delete over board:delete', async () => {
    const { readFileSync } = await import('node:fs');
    const path = await import('node:path');
    const { fileURLToPath } = await import('node:url');
    const here = path.dirname(fileURLToPath(import.meta.url));
    const preload = readFileSync(path.resolve(here, '..', 'electron-preload.ts'), 'utf8');
    expect(preload).toMatch(/delete:\s*\([^)]*\)\s*=>\s*ipcRenderer\.invoke\(\s*['"]board:delete['"]/);
  });

  it('electron-main.ts wires deleteRelatedOne to cascade score + review for one sourceId', async () => {
    const { readFileSync } = await import('node:fs');
    const path = await import('node:path');
    const { fileURLToPath } = await import('node:url');
    const here = path.dirname(fileURLToPath(import.meta.url));
    const main = readFileSync(path.resolve(here, '..', 'electron-main.ts'), 'utf8');
    expect(main).toMatch(/deleteRelatedOne/);
    expect(main).toMatch(/matchScoresStore\.delete\(/);
    expect(main).toMatch(/matchReviewsStore\.delete\(/);
  });

  it('env.d.ts declares StarBoardApi.delete(sourceId) with the tagged result shape', async () => {
    const { readFileSync } = await import('node:fs');
    const path = await import('node:path');
    const { fileURLToPath } = await import('node:url');
    const here = path.dirname(fileURLToPath(import.meta.url));
    const envD = readFileSync(path.resolve(here, '..', '..', 'src', 'env.d.ts'), 'utf8');
    expect(envD).toMatch(/delete\s*:\s*\(sourceId:\s*string\)\s*=>\s*Promise<\{\s*ok:\s*true;\s*deleted/);
  });
});

// --- AC6 — deletion persists across an app "restart" ---------------------

describe('EXTR-016 AC6 — single-job delete persists across restart', () => {
  it('a fresh store opened on the same DB sees the job + score + review gone', async () => {
    const { createJobsStore } = await import('../jobs');
    const { createMatchScoresStore } = await import('../matchScores');
    const { createMatchReviewsStore } = await import('../matchReviews');

    const jobsDb = new FakeJobsDb();
    const scoresDb = new FakeScoresDb();
    const reviewsDb = new FakeReviewsDb();

    const jobs1 = createJobsStore(jobsDb as never);
    const scores1 = createMatchScoresStore(scoresDb as never);
    const reviews1 = createMatchReviewsStore(reviewsDb as never);

    jobs1.upsertJobs([
      { sourceId: 'gone', hostname: 'x.com', url: 'https://x.com/gone', fetchedAt: 100 },
      { sourceId: 'keep', hostname: 'x.com', url: 'https://x.com/keep', fetchedAt: 200 },
    ]);
    scores1.upsert({
      sourceId: 'gone', stars: 4, percent: 80, factors: [],
      weightsVersion: 'v1', stale: false, scoredAt: 1,
    });
    reviews1.upsert({
      sourceId: 'gone', requirements: [], gaps: [], strengths: [],
      keywords: [], summary: 's', generatedAt: 1,
    });

    jobs1.delete('gone');
    scores1.delete('gone');
    reviews1.delete('gone');

    // Simulate restart — fresh stores, same DBs.
    const jobs2 = createJobsStore(jobsDb as never);
    const scores2 = createMatchScoresStore(scoresDb as never);
    const reviews2 = createMatchReviewsStore(reviewsDb as never);

    expect(jobs2.listJobs().map((j) => j.sourceId)).toEqual(['keep']);
    expect(scores2.get('gone')).toBeUndefined();
    expect(reviews2.get('gone')).toBeUndefined();
  });
});
