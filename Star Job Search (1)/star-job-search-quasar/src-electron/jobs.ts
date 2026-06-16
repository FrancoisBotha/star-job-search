/**
 * Jobs persistence module (EXTR-003).
 *
 * Owns the on-disk store of extracted job postings and the per-site profiles
 * that capture what we have learned about each board. Backed by SQLite via
 * `better-sqlite3` on the shared `star.db` opened in `electron-main.ts` — the
 * same handle used by the sites and preferred-models stores.
 *
 * Two tables:
 *  - `jobs`          keyed by `source_id` (dedup key derived from the URL)
 *  - `site_profiles` keyed by `hostname`
 *
 * `upsertJobs` uses INSERT OR IGNORE so a re-extraction of an already-known
 * posting cannot clobber a user-set status (Saved / Applied / etc.).
 */
import Database from 'better-sqlite3';

export interface JobRecord {
  sourceId: string;
  hostname: string;
  url: string;
  title?: string | null;
  company?: string | null;
  location?: string | null;
  description?: string | null;
  postedAt?: number | null;
  fetchedAt: number;
  status?: string;
}

export interface SiteProfile {
  hostname: string;
  idRegex?: string | null;
  selectors?: Record<string, string> | null;
  learnedAt: number;
}

// Minimal slice of the better-sqlite3 surface we actually use — keeps the
// store unit-testable with a lightweight fake and avoids coupling the
// store's contract to the native binding. Mirrors sites.ts (AC4).
export interface JobsDatabaseLike {
  exec(sql: string): unknown;
  prepare(sql: string): {
    run(...args: unknown[]): unknown;
    all?(...args: unknown[]): unknown[];
  };
}

export interface ListJobsFilter {
  status?: string;
  excludeStatus?: string;
}

export interface JobsStore {
  knownSourceIds(): Set<string>;
  upsertJobs(jobs: JobRecord[]): number;
  listJobs(filter?: ListJobsFilter): JobRecord[];
  setStatus(sourceId: string, status: string): void;
  getSiteProfile(hostname: string): SiteProfile | undefined;
  saveSiteProfile(profile: SiteProfile): void;
}

/**
 * Derive a stable per-posting dedup key from a job-posting URL.
 *
 * Patterns, tried in order:
 *  1. Caller-supplied idRegex — its first capture group wins (lets a learned
 *     SiteProfile override the heuristics for a specific board).
 *  2. Host-specific query params: LinkedIn `currentJobId`, Indeed `jk`,
 *     Greenhouse `gh_jid`.
 *  3. Generic `id` then `jobId` query params.
 *  4. Long-numeric path segment (>= 6 digits) — common pattern for ATSes
 *     that mount the posting at /jobs/<numericId>/<slug>.
 *  5. Pathname fallback so the returned id is always a string.
 */
export function deriveSourceId(
  url: string,
  hostname: string,
  idRegex?: RegExp,
): string {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return url;
  }

  if (idRegex) {
    const m = idRegex.exec(url);
    if (m && m[1]) return m[1];
  }

  const host = (hostname || parsed.hostname || '').toLowerCase();
  const qp = parsed.searchParams;

  if (host.includes('linkedin')) {
    const v = qp.get('currentJobId');
    if (v) return v;
  }
  if (host.includes('indeed')) {
    const v = qp.get('jk');
    if (v) return v;
  }
  if (host.includes('greenhouse')) {
    const v = qp.get('gh_jid');
    if (v) return v;
  }

  const generic = qp.get('id') ?? qp.get('jobId');
  if (generic) return generic;

  const longNum = parsed.pathname.match(/(\d{6,})/);
  if (longNum && longNum[1]) return longNum[1];

  return parsed.pathname;
}

const CREATE_JOBS_TABLE_SQL = `
  CREATE TABLE IF NOT EXISTS jobs (
    source_id   TEXT PRIMARY KEY,
    hostname    TEXT NOT NULL,
    url         TEXT NOT NULL,
    title       TEXT,
    company     TEXT,
    location    TEXT,
    description TEXT,
    posted_at   INTEGER,
    fetched_at  INTEGER NOT NULL,
    status      TEXT NOT NULL DEFAULT 'new'
  )
`;

const CREATE_SITE_PROFILES_TABLE_SQL = `
  CREATE TABLE IF NOT EXISTS site_profiles (
    hostname   TEXT PRIMARY KEY,
    id_regex   TEXT,
    selectors  TEXT,
    learned_at INTEGER NOT NULL
  )
`;

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

function rowToJob(row: JobRow): JobRecord {
  return {
    sourceId: row.source_id,
    hostname: row.hostname,
    url: row.url,
    title: row.title,
    company: row.company,
    location: row.location,
    description: row.description,
    postedAt: row.posted_at,
    fetchedAt: row.fetched_at,
    status: row.status,
  };
}

function rowToProfile(row: SiteProfileRow): SiteProfile {
  let selectors: Record<string, string> | null = null;
  if (row.selectors) {
    try {
      selectors = JSON.parse(row.selectors) as Record<string, string>;
    } catch {
      selectors = null;
    }
  }
  return {
    hostname: row.hostname,
    idRegex: row.id_regex,
    selectors,
    learnedAt: row.learned_at,
  };
}

export function createJobsStore(db: JobsDatabaseLike): JobsStore {
  db.exec(CREATE_JOBS_TABLE_SQL);
  db.exec(CREATE_SITE_PROFILES_TABLE_SQL);

  const knownStmt = db.prepare('SELECT source_id FROM jobs');
  const insertStmt = db.prepare(
    'INSERT OR IGNORE INTO jobs (source_id, hostname, url, title, company, location, description, posted_at, fetched_at, status) VALUES (@source_id, @hostname, @url, @title, @company, @location, @description, @posted_at, @fetched_at, @status)',
  );
  const listStmt = db.prepare(
    'SELECT source_id, hostname, url, title, company, location, description, posted_at, fetched_at, status FROM jobs ORDER BY fetched_at DESC',
  );
  const setStatusStmt = db.prepare('UPDATE jobs SET status = ? WHERE source_id = ?');
  const getProfileStmt = db.prepare(
    'SELECT hostname, id_regex, selectors, learned_at FROM site_profiles WHERE hostname = ?',
  );
  const saveProfileStmt = db.prepare(
    'INSERT OR REPLACE INTO site_profiles (hostname, id_regex, selectors, learned_at) VALUES (@hostname, @id_regex, @selectors, @learned_at)',
  );

  return {
    knownSourceIds(): Set<string> {
      const rows = (knownStmt.all?.() ?? []) as Array<{ source_id: string }>;
      return new Set(rows.map((r) => r.source_id));
    },
    upsertJobs(jobs: JobRecord[]): number {
      let inserted = 0;
      for (const job of jobs) {
        const result = insertStmt.run({
          source_id: job.sourceId,
          hostname: job.hostname,
          url: job.url,
          title: job.title ?? null,
          company: job.company ?? null,
          location: job.location ?? null,
          description: job.description ?? null,
          posted_at: job.postedAt ?? null,
          fetched_at: job.fetchedAt,
          status: job.status ?? 'new',
        }) as { changes?: number } | undefined;
        if (result && result.changes && result.changes > 0) inserted++;
      }
      return inserted;
    },
    listJobs(filter?: ListJobsFilter): JobRecord[] {
      const rows = (listStmt.all?.() ?? []) as JobRow[];
      const jobs = rows.map(rowToJob);
      if (filter?.status !== undefined) {
        return jobs.filter((j) => j.status === filter.status);
      }
      if (filter?.excludeStatus !== undefined) {
        return jobs.filter((j) => j.status !== filter.excludeStatus);
      }
      return jobs;
    },
    setStatus(sourceId: string, status: string): void {
      setStatusStmt.run(status, sourceId);
    },
    getSiteProfile(hostname: string): SiteProfile | undefined {
      const rows = (getProfileStmt.all?.(hostname) ?? []) as SiteProfileRow[];
      const row = rows[0];
      return row ? rowToProfile(row) : undefined;
    },
    saveSiteProfile(profile: SiteProfile): void {
      saveProfileStmt.run({
        hostname: profile.hostname,
        id_regex: profile.idRegex ?? null,
        selectors: profile.selectors ? JSON.stringify(profile.selectors) : null,
        learned_at: profile.learnedAt,
      });
    },
  };
}

/**
 * Open a SQLite database file backing the Jobs store. Wraps `better-sqlite3`
 * so callers don't have to import it directly. The same `star.db` file is
 * shared across the sites, preferred-models, and jobs stores.
 */
export function openJobsDatabase(filepath: string): JobsDatabaseLike {
  return new Database(filepath) as unknown as JobsDatabaseLike;
}
