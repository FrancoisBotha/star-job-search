/**
 * Unit tests for the Jobs persistence module (EXTR-003).
 *
 * Covers acceptance criteria:
 *  - AC1: jobs (PK sourceId) and site_profiles (PK hostname) tables created on
 *         star.db; JobRecord / SiteProfile fields match the data model.
 *  - AC2: deriveSourceId reproduces the documented patterns — LinkedIn
 *         currentJobId, Indeed jk, Greenhouse gh_jid, generic id/jobId,
 *         long-numeric path fallback, then path.
 *  - AC3: store ops — knownSourceIds, upsertJobs (insert-if-absent, returns
 *         count inserted, leaves existing rows + user-set status untouched),
 *         listJobs newest-first with status/excludeStatus filters,
 *         setStatus, getSiteProfile, saveSiteProfile.
 *  - AC4: state survives a restart (new store on same DB sees prior rows),
 *         and the store is unit-testable via a Database-like seam (no native
 *         binding required — mirrors sites.ts).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('better-sqlite3', () => {
  return { default: class {} };
});

// --- Minimal in-memory fake of the better-sqlite3 surface we use -----------

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

class FakeDatabase {
  jobs: JobRow[] = [];
  profiles: SiteProfileRow[] = [];
  exec(_sql: string) {
    // CREATE TABLE — no-op for the fake.
  }
  prepare(sql: string) {
    const text = sql.trim();
    if (/^INSERT\s+OR\s+IGNORE\s+INTO\s+jobs/i.test(text)) {
      return {
        run: (params: JobRow) => {
          if (this.jobs.some((j) => j.source_id === params.source_id)) {
            return { changes: 0 };
          }
          this.jobs.push({ ...params });
          return { changes: 1 };
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
      return {
        all: () => this.jobs.map((j) => ({ source_id: j.source_id })),
      };
    }
    if (/^SELECT[\s\S]+FROM\s+jobs/i.test(text)) {
      return {
        all: () => [...this.jobs].sort((a, b) => b.fetched_at - a.fetched_at),
      };
    }
    if (/^INSERT\s+INTO\s+site_profiles/i.test(text) || /^INSERT\s+OR\s+REPLACE\s+INTO\s+site_profiles/i.test(text)) {
      return {
        run: (params: SiteProfileRow) => {
          const existingIdx = this.profiles.findIndex((p) => p.hostname === params.hostname);
          if (existingIdx >= 0) this.profiles.splice(existingIdx, 1);
          this.profiles.push({ ...params });
          return { changes: 1 };
        },
      };
    }
    if (/^SELECT[\s\S]+FROM\s+site_profiles\s+WHERE\s+hostname/i.test(text)) {
      return {
        all: (hostname: string) => this.profiles.filter((p) => p.hostname === hostname),
      };
    }
    throw new Error(`FakeDatabase: unsupported SQL: ${text}`);
  }
}

beforeEach(() => {
  // fresh isolation per test
});

afterEach(() => {
  vi.resetModules();
});

async function importModule() {
  return await import('../jobs');
}

// --- deriveSourceId (AC2) --------------------------------------------------

describe('deriveSourceId — documented patterns (AC2)', () => {
  it('LinkedIn: returns the currentJobId query param', async () => {
    const { deriveSourceId } = await importModule();
    const id = deriveSourceId(
      'https://www.linkedin.com/jobs/search/?currentJobId=4011223344&keywords=engineer',
      'www.linkedin.com',
    );
    expect(id).toBe('4011223344');
  });

  it('Indeed: returns the jk query param', async () => {
    const { deriveSourceId } = await importModule();
    const id = deriveSourceId(
      'https://www.indeed.com/viewjob?jk=abc123def&q=node',
      'www.indeed.com',
    );
    expect(id).toBe('abc123def');
  });

  it('Greenhouse: returns the gh_jid query param', async () => {
    const { deriveSourceId } = await importModule();
    const id = deriveSourceId(
      'https://boards.greenhouse.io/acme/jobs/5557777?gh_jid=5557777',
      'boards.greenhouse.io',
    );
    expect(id).toBe('5557777');
  });

  it('generic site: returns the id query param when present', async () => {
    const { deriveSourceId } = await importModule();
    const id = deriveSourceId('https://jobs.example.com/view?id=xyz-42', 'jobs.example.com');
    expect(id).toBe('xyz-42');
  });

  it('generic site: falls back to jobId query param', async () => {
    const { deriveSourceId } = await importModule();
    const id = deriveSourceId('https://jobs.example.com/view?jobId=p-99', 'jobs.example.com');
    expect(id).toBe('p-99');
  });

  it('long-numeric path fallback: pulls a long digit run from the path', async () => {
    const { deriveSourceId } = await importModule();
    const id = deriveSourceId(
      'https://careers.example.com/jobs/987654321/software-engineer',
      'careers.example.com',
    );
    expect(id).toBe('987654321');
  });

  it('path fallback: returns the pathname when nothing else matches', async () => {
    const { deriveSourceId } = await importModule();
    const id = deriveSourceId(
      'https://careers.example.com/role/staff-engineer',
      'careers.example.com',
    );
    expect(id).toBe('/role/staff-engineer');
  });

  it('idRegex override: when provided, its first capture group wins', async () => {
    const { deriveSourceId } = await importModule();
    const id = deriveSourceId(
      'https://jobs.example.com/posting/req-XYZ-42/details',
      'jobs.example.com',
      /\/posting\/(req-[^/]+)/,
    );
    expect(id).toBe('req-XYZ-42');
  });
});

// --- Jobs store: schema + ops (AC1, AC3, AC4) ------------------------------

describe('createJobsStore — upsert + dedup (AC3)', () => {
  it('upsertJobs inserts new rows and returns the count inserted', async () => {
    const { createJobsStore } = await importModule();
    const db = new FakeDatabase();
    const store = createJobsStore(db as never);

    const inserted = store.upsertJobs([
      { sourceId: 'a', hostname: 'x.com', url: 'https://x.com/a', title: 'A', fetchedAt: 100 },
      { sourceId: 'b', hostname: 'x.com', url: 'https://x.com/b', title: 'B', fetchedAt: 200 },
    ]);
    expect(inserted).toBe(2);
    expect(store.listJobs()).toHaveLength(2);
  });

  it('upsertJobs leaves existing rows (and their user-set status) untouched', async () => {
    const { createJobsStore } = await importModule();
    const db = new FakeDatabase();
    const store = createJobsStore(db as never);

    store.upsertJobs([
      { sourceId: 'a', hostname: 'x.com', url: 'https://x.com/a', title: 'A', fetchedAt: 100 },
    ]);
    store.setStatus('a', 'starred');

    const inserted = store.upsertJobs([
      // attempt to overwrite the title and clobber status — must be ignored
      { sourceId: 'a', hostname: 'x.com', url: 'https://x.com/a', title: 'OVERWRITE', fetchedAt: 999, status: 'new' },
      { sourceId: 'c', hostname: 'x.com', url: 'https://x.com/c', title: 'C', fetchedAt: 300 },
    ]);
    expect(inserted).toBe(1);

    const all = store.listJobs();
    const a = all.find((j) => j.sourceId === 'a')!;
    expect(a.title).toBe('A');
    expect(a.status).toBe('starred');
  });

  it('knownSourceIds returns a Set of every persisted sourceId', async () => {
    const { createJobsStore } = await importModule();
    const db = new FakeDatabase();
    const store = createJobsStore(db as never);
    store.upsertJobs([
      { sourceId: 'a', hostname: 'x.com', url: 'https://x.com/a', fetchedAt: 100 },
      { sourceId: 'b', hostname: 'x.com', url: 'https://x.com/b', fetchedAt: 200 },
    ]);

    const ids = store.knownSourceIds();
    expect(ids).toBeInstanceOf(Set);
    expect(ids.has('a')).toBe(true);
    expect(ids.has('b')).toBe(true);
    expect(ids.has('missing')).toBe(false);
  });
});

describe('createJobsStore — listing & status (AC3)', () => {
  it('listJobs returns rows newest-first by fetchedAt', async () => {
    const { createJobsStore } = await importModule();
    const db = new FakeDatabase();
    const store = createJobsStore(db as never);
    store.upsertJobs([
      { sourceId: 'old', hostname: 'x.com', url: 'https://x.com/old', fetchedAt: 100 },
      { sourceId: 'new', hostname: 'x.com', url: 'https://x.com/new', fetchedAt: 300 },
      { sourceId: 'mid', hostname: 'x.com', url: 'https://x.com/mid', fetchedAt: 200 },
    ]);
    const rows = store.listJobs();
    expect(rows.map((j) => j.sourceId)).toEqual(['new', 'mid', 'old']);
  });

  it('listJobs filters by status', async () => {
    const { createJobsStore } = await importModule();
    const db = new FakeDatabase();
    const store = createJobsStore(db as never);
    store.upsertJobs([
      { sourceId: 'a', hostname: 'x.com', url: 'https://x.com/a', fetchedAt: 100 },
      { sourceId: 'b', hostname: 'x.com', url: 'https://x.com/b', fetchedAt: 200 },
    ]);
    store.setStatus('a', 'starred');
    const starred = store.listJobs({ status: 'starred' });
    expect(starred.map((j) => j.sourceId)).toEqual(['a']);
  });

  it('listJobs filters by excludeStatus', async () => {
    const { createJobsStore } = await importModule();
    const db = new FakeDatabase();
    const store = createJobsStore(db as never);
    store.upsertJobs([
      { sourceId: 'a', hostname: 'x.com', url: 'https://x.com/a', fetchedAt: 100 },
      { sourceId: 'b', hostname: 'x.com', url: 'https://x.com/b', fetchedAt: 200 },
    ]);
    store.setStatus('a', 'rejected');
    const visible = store.listJobs({ excludeStatus: 'rejected' });
    expect(visible.map((j) => j.sourceId)).toEqual(['b']);
  });

  it('setStatus updates the row identified by sourceId', async () => {
    const { createJobsStore } = await importModule();
    const db = new FakeDatabase();
    const store = createJobsStore(db as never);
    store.upsertJobs([
      { sourceId: 'a', hostname: 'x.com', url: 'https://x.com/a', fetchedAt: 100 },
    ]);
    store.setStatus('a', 'applied');
    expect(store.listJobs()[0]!.status).toBe('applied');
  });
});

describe('createJobsStore — site_profiles (AC1, AC3)', () => {
  it('saveSiteProfile + getSiteProfile round-trip a profile by hostname', async () => {
    const { createJobsStore } = await importModule();
    const db = new FakeDatabase();
    const store = createJobsStore(db as never);

    expect(store.getSiteProfile('jobs.example.com')).toBeUndefined();

    store.saveSiteProfile({
      hostname: 'jobs.example.com',
      idRegex: '\\/posting\\/(req-[^/]+)',
      selectors: { title: 'h1' },
      learnedAt: 500,
    });
    const got = store.getSiteProfile('jobs.example.com');
    expect(got).toBeDefined();
    expect(got!.hostname).toBe('jobs.example.com');
    expect(got!.idRegex).toBe('\\/posting\\/(req-[^/]+)');
    expect(got!.selectors).toEqual({ title: 'h1' });
    expect(got!.learnedAt).toBe(500);
  });

  it('saveSiteProfile overwrites an existing profile for the same hostname', async () => {
    const { createJobsStore } = await importModule();
    const db = new FakeDatabase();
    const store = createJobsStore(db as never);
    store.saveSiteProfile({ hostname: 'jobs.example.com', learnedAt: 100 });
    store.saveSiteProfile({
      hostname: 'jobs.example.com',
      idRegex: 'X',
      learnedAt: 200,
    });
    const got = store.getSiteProfile('jobs.example.com')!;
    expect(got.idRegex).toBe('X');
    expect(got.learnedAt).toBe(200);
  });
});

describe('createJobsStore — restart durability (AC4)', () => {
  it('a second store opened on the same DB sees previously-saved jobs and profiles', async () => {
    const { createJobsStore } = await importModule();
    const db = new FakeDatabase();

    const store1 = createJobsStore(db as never);
    store1.upsertJobs([
      { sourceId: 'a', hostname: 'x.com', url: 'https://x.com/a', fetchedAt: 100 },
    ]);
    store1.setStatus('a', 'starred');
    store1.saveSiteProfile({ hostname: 'x.com', learnedAt: 100 });

    const store2 = createJobsStore(db as never);
    expect(store2.listJobs().map((j) => j.sourceId)).toEqual(['a']);
    expect(store2.listJobs()[0]!.status).toBe('starred');
    expect(store2.getSiteProfile('x.com')).toBeDefined();
  });
});
