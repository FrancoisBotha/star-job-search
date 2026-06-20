/**
 * Unit tests for the XJOB-003 AC3 `source` provenance field on the jobs store.
 *
 * Verifies:
 *  - Default is 'crawl' when no source is set on the JobRecord.
 *  - 'manual' provenance round-trips through upsert + list.
 *  - The ALTER TABLE migration is guarded (idempotent — a "duplicate column
 *    name" error is swallowed; other errors bubble).
 */
import { describe, expect, it, vi } from 'vitest';

vi.mock('better-sqlite3', () => ({ default: class {} }));

interface Row {
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
  source: string;
}

class FakeDb {
  rows: Row[] = [];
  execs: string[] = [];
  exec(sql: string) {
    this.execs.push(sql);
  }
  prepare(sql: string) {
    if (/^INSERT\s+OR\s+IGNORE\s+INTO\s+jobs/i.test(sql)) {
      return {
        run: (params: Row) => {
          if (this.rows.some((r) => r.source_id === params.source_id)) {
            return { changes: 0 };
          }
          this.rows.push({ ...params });
          return { changes: 1 };
        },
      };
    }
    if (/^SELECT\s+source_id\s+FROM\s+jobs/i.test(sql)) {
      return { all: () => this.rows.map((r) => ({ source_id: r.source_id })) };
    }
    if (/^SELECT[\s\S]+FROM\s+jobs/i.test(sql)) {
      return { all: () => this.rows.slice() };
    }
    if (/site_profiles/i.test(sql)) {
      return { all: () => [], run: () => ({ changes: 0 }) };
    }
    return { run: () => ({ changes: 0 }), all: () => [] };
  }
}

describe('jobs store — source provenance (XJOB-003 AC3)', () => {
  it('defaults source to "crawl" when none is supplied on the JobRecord', async () => {
    const { createJobsStore } = await import('../jobs');
    const db = new FakeDb();
    const store = createJobsStore(db as never);
    store.upsertJobs([
      {
        sourceId: 'a',
        hostname: 'x.com',
        url: 'https://x.com/a',
        title: 'A',
        fetchedAt: 1,
      },
    ]);
    const [row] = store.listJobs();
    expect(row?.source).toBe('crawl');
  });

  it('persists source="manual" through upsert + listJobs', async () => {
    const { createJobsStore } = await import('../jobs');
    const db = new FakeDb();
    const store = createJobsStore(db as never);
    store.upsertJobs([
      {
        sourceId: 'm',
        hostname: 'x.com',
        url: 'https://x.com/m',
        title: 'M',
        fetchedAt: 2,
        source: 'manual',
      },
    ]);
    const [row] = store.listJobs();
    expect(row?.source).toBe('manual');
  });

  it('issues an ALTER TABLE to add the source column on existing DBs (guarded migration)', async () => {
    const { createJobsStore } = await import('../jobs');
    const db = new FakeDb();
    createJobsStore(db as never);
    expect(
      db.execs.some((s) => /ALTER\s+TABLE\s+jobs\s+ADD\s+COLUMN\s+source/i.test(s)),
    ).toBe(true);
  });

  it('swallows the "duplicate column name" error from a prior migration (idempotent)', async () => {
    const { createJobsStore } = await import('../jobs');
    class ExistingDb extends FakeDb {
      override exec(sql: string) {
        super.exec(sql);
        if (/ALTER\s+TABLE\s+jobs\s+ADD\s+COLUMN\s+source/i.test(sql)) {
          throw new Error('duplicate column name: source');
        }
      }
    }
    const db = new ExistingDb();
    expect(() => createJobsStore(db as never)).not.toThrow();
  });
});
