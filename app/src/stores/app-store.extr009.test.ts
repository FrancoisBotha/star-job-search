/**
 * Unit tests for EXTR-009: back the board view with the real store and wire
 * Open / Not-interested / Restore.
 *
 * Covers:
 *  - AC1: visibleJobs lists imported jobs newest-first, hiding `not_interested`
 *         by default, and notInterestedCount drives the "Restore N hidden"
 *         affordance.
 *  - AC2: setJobStatus + openJob round-trip through the starBoard bridge.
 *  - AC3: `not_interested` jobs remain in the persisted set so dedup keeps
 *         them out of future imports; restoreNotInterested flips them back to
 *         `new`.
 *  - AC4: the board view (JobBoardPage — the board moved here from StarredPage
 *         in a later epic) no longer reads the mock MATCHES / visibleMatches /
 *         dismissed feed; it renders from store.visibleJobs.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { setActivePinia, createPinia } from 'pinia';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useAppStore } from './app-store';
import type { JobRecord } from 'src/types/models';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SRC_DIR = path.resolve(__dirname, '..');

interface BoardListFilter {
  status?: string;
  excludeStatus?: string;
}

function installBoardBridge(rows: JobRecord[]) {
  const list = vi.fn(async (_f?: BoardListFilter) => rows.map((r) => ({ ...r })));
  const setStatus = vi.fn(
    async (input: { sourceId: string; status: string }) => {
      const row = rows.find((r) => r.sourceId === input.sourceId);
      if (row) row.status = input.status;
      return { ok: true } as const;
    },
  );
  const open = vi.fn(async (_u: string) => ({ ok: true } as const));
  (globalThis as { window?: unknown }).window = {
    starBoard: { list, setStatus, open },
  };
  return { list, setStatus, open, rows };
}

function job(
  sourceId: string,
  fetchedAt: number,
  status: string = 'new',
  extra: Partial<JobRecord> = {},
): JobRecord {
  return {
    sourceId,
    hostname: 'example.com',
    url: `https://example.com/jobs/${sourceId}`,
    title: `Job ${sourceId}`,
    company: 'Acme',
    location: 'Remote',
    description: null,
    postedAt: null,
    fetchedAt,
    status,
    ...extra,
  };
}

beforeEach(() => {
  setActivePinia(createPinia());
});

afterEach(() => {
  delete (globalThis as { window?: unknown }).window;
});

describe('app-store — visibleJobs (AC1)', () => {
  it('lists imported jobs newest-first and hides not_interested by default', async () => {
    installBoardBridge([
      job('a', 100, 'new'),
      job('b', 300, 'new'),
      job('c', 200, 'not_interested'),
      job('d', 250, 'seen'),
    ]);
    const store = useAppStore();
    await store.listJobs();
    const ids = store.visibleJobs.map((j) => j.sourceId);
    expect(ids).toEqual(['b', 'd', 'a']);
  });

  it('notInterestedCount counts jobs hidden by status', async () => {
    installBoardBridge([
      job('a', 1, 'not_interested'),
      job('b', 2, 'new'),
      job('c', 3, 'not_interested'),
    ]);
    const store = useAppStore();
    await store.listJobs();
    expect(store.notInterestedCount).toBe(2);
  });
});

describe('app-store — actions wired for the board view (AC2)', () => {
  it('setJobStatus("not_interested") hides the job from visibleJobs', async () => {
    const { setStatus } = installBoardBridge([
      job('a', 100, 'new'),
      job('b', 200, 'new'),
    ]);
    const store = useAppStore();
    await store.listJobs();
    await store.setJobStatus({ sourceId: 'a', status: 'not_interested' });
    expect(setStatus).toHaveBeenCalledWith({ sourceId: 'a', status: 'not_interested' });
    expect(store.visibleJobs.map((j) => j.sourceId)).toEqual(['b']);
    expect(store.notInterestedCount).toBe(1);
  });

  it('openJob calls the starBoard.open bridge with the job url', async () => {
    const { open } = installBoardBridge([job('a', 100)]);
    const store = useAppStore();
    await store.openJob('https://example.com/jobs/a');
    expect(open).toHaveBeenCalledWith('https://example.com/jobs/a');
  });
});

describe('app-store — restoreNotInterested (AC3)', () => {
  it('flips every not_interested job back to new and clears the hidden count', async () => {
    const { setStatus } = installBoardBridge([
      job('a', 100, 'not_interested'),
      job('b', 200, 'new'),
      job('c', 300, 'not_interested'),
    ]);
    const store = useAppStore();
    await store.listJobs();
    expect(store.notInterestedCount).toBe(2);

    await store.restoreNotInterested();

    expect(setStatus).toHaveBeenCalledWith({ sourceId: 'a', status: 'new' });
    expect(setStatus).toHaveBeenCalledWith({ sourceId: 'c', status: 'new' });
    expect(store.notInterestedCount).toBe(0);
    expect(store.visibleJobs.map((j) => j.sourceId).sort()).toEqual(['a', 'b', 'c']);
  });

  it('no-ops gracefully when starBoard is absent', async () => {
    (globalThis as { window?: unknown }).window = {};
    const store = useAppStore();
    await expect(store.restoreNotInterested()).resolves.toBeUndefined();
  });
});

describe('jobs dedup keeps not_interested out of future imports (AC3)', () => {
  it('knownSourceIds includes not_interested rows so upsertJobs ignores them', async () => {
    vi.resetModules();
    vi.doMock('better-sqlite3', () => ({ default: class {} }));
    interface Row {
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
    class FakeDb {
      rows: Row[] = [];
      exec() {}
      prepare(sql: string) {
        const t = sql.trim();
        if (/^INSERT\s+OR\s+IGNORE\s+INTO\s+jobs/i.test(t)) {
          return {
            run: (p: Row) => {
              if (this.rows.some((r) => r.source_id === p.source_id)) {
                return { changes: 0 };
              }
              this.rows.push({ ...p });
              return { changes: 1 };
            },
          };
        }
        if (/^UPDATE\s+jobs\s+SET\s+status/i.test(t)) {
          return {
            run: (status: string, sourceId: string) => {
              const r = this.rows.find((x) => x.source_id === sourceId);
              if (r) r.status = status;
              return { changes: r ? 1 : 0 };
            },
          };
        }
        if (/^SELECT\s+source_id\s+FROM\s+jobs/i.test(t)) {
          return { all: () => this.rows.map((r) => ({ source_id: r.source_id })) };
        }
        if (/^SELECT[\s\S]+FROM\s+jobs/i.test(t)) {
          return {
            all: () => [...this.rows].sort((a, b) => b.fetched_at - a.fetched_at),
          };
        }
        if (/site_profiles/i.test(t)) {
          return { run: () => ({ changes: 0 }), all: () => [] };
        }
        throw new Error(`unsupported SQL: ${t}`);
      }
    }
    const { createJobsStore } = await import('../../src-electron/jobs');
    const db = new FakeDb();
    const store = createJobsStore(db as never);
    store.upsertJobs([
      { sourceId: 'a', hostname: 'x.com', url: 'https://x.com/a', fetchedAt: 100 },
    ]);
    store.setStatus('a', 'not_interested');

    const inserted = store.upsertJobs([
      { sourceId: 'a', hostname: 'x.com', url: 'https://x.com/a', fetchedAt: 999 },
      { sourceId: 'b', hostname: 'x.com', url: 'https://x.com/b', fetchedAt: 200 },
    ]);
    expect(inserted).toBe(1);
    expect(store.knownSourceIds().has('a')).toBe(true);
    expect(store.listJobs().find((j) => j.sourceId === 'a')!.status).toBe(
      'not_interested',
    );
  });
});

describe('JobBoardPage — board wiring (AC1, AC2, AC4)', () => {
  const PAGE = readFileSync(path.join(SRC_DIR, 'pages', 'JobBoardPage.vue'), 'utf8');

  it('renders from store.visibleJobs, not the mock MATCHES feed', () => {
    expect(PAGE).toMatch(/store\.visibleJobs/);
    expect(PAGE).not.toMatch(/visibleMatches/);
    expect(PAGE).not.toMatch(/\bMATCHES\b/);
    expect(PAGE).not.toMatch(/dismissMatch\(/);
    expect(PAGE).not.toMatch(/dismissedCount/);
    expect(PAGE).not.toMatch(/resetDismissed\(/);
  });

  it('shows a "Restore N hidden" affordance driven by notInterestedCount', () => {
    expect(PAGE).toMatch(/notInterestedCount/);
    expect(PAGE).toMatch(/Restore .*hidden/);
    expect(PAGE).toMatch(/restoreNotInterested\(/);
  });

  it('Open navigates the embedded browser via openJob (view:open)', () => {
    expect(PAGE).toMatch(/openJob\(/);
  });

  it('Not interested marks the job not_interested via setJobStatus', () => {
    expect(PAGE).toMatch(/setJobStatus\(/);
    expect(PAGE).toMatch(/not_interested/);
  });

  it('hydrates the board on mount via listJobs', () => {
    expect(PAGE).toMatch(/listJobs\(/);
  });
});
