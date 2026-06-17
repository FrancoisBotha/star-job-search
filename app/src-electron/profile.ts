/**
 * Profile persistence module (CVPROF-001).
 *
 * Owns the user's single editable Profile — the source of truth the later
 * scoring epic reads. Backed by SQLite via `better-sqlite3` on the shared
 * `star.db` opened in `electron-main.ts` (the same handle the sites,
 * preferred-models, and jobs stores use).
 *
 * The Profile is a SINGLETON: exactly one row ever exists per install, keyed
 * by a fixed id and written with INSERT OR REPLACE so a save can never create
 * a duplicate. `profile:get` returns the persisted Profile (or a sensible
 * empty default on first run); `profile:save` upserts edits and bumps
 * `updatedAt`.
 *
 * This module only PERSISTS `strengthScore` — the strength rubric and the
 * minimum-scorable gate are computed in the frontend tickets (CVPROF-001 AC6).
 *
 * Renderer talks to this module via the preload-bridge channels:
 *   profile:get | profile:save
 */
import Database from 'better-sqlite3';

export type WorkMode = 'Remote' | 'Hybrid' | 'On-site';

const WORK_MODES: readonly WorkMode[] = ['Remote', 'Hybrid', 'On-site'];

export interface ProfileRecord {
  name: string;
  targetRole: string;
  yearsExperience: number | null;
  location: string;
  workMode: WorkMode;
  salaryMin: number | null;
  salaryCurrency: string;
  linkedinUrl: string;
  links: string[];
  skills: string[];
  strengthScore: number;
  updatedAt: number;
}

/** Editable fields the renderer may send to `profile:save`; all optional so
 *  partial edits merge onto the persisted Profile. `updatedAt` is owned by
 *  this module and ignored if supplied. */
export type ProfileInput = Partial<Omit<ProfileRecord, 'updatedAt'>>;

// Minimal slice of the better-sqlite3 surface we use — keeps the store
// unit-testable with a lightweight fake and avoids coupling the contract to
// the native binding. Mirrors sites.ts / jobs.ts.
export interface ProfileDatabaseLike {
  exec(sql: string): unknown;
  prepare(sql: string): {
    run(...args: unknown[]): unknown;
    all?(...args: unknown[]): unknown[];
  };
}

export interface ProfileStore {
  get(): ProfileRecord;
  save(input: ProfileInput): ProfileRecord;
}

// Fixed primary key — there is only ever one Profile row.
const SINGLETON_ID = 'singleton';

const CREATE_TABLE_SQL = `
  CREATE TABLE IF NOT EXISTS profile (
    id               TEXT PRIMARY KEY,
    name             TEXT,
    target_role      TEXT,
    years_experience INTEGER,
    location         TEXT,
    work_mode        TEXT NOT NULL DEFAULT 'Remote',
    salary_min       INTEGER,
    salary_currency  TEXT,
    linkedin_url     TEXT,
    links            TEXT,
    skills           TEXT,
    strength_score   INTEGER NOT NULL DEFAULT 0,
    updated_at       INTEGER NOT NULL
  )
`;

interface ProfileRow {
  id: string;
  name: string | null;
  target_role: string | null;
  years_experience: number | null;
  location: string | null;
  work_mode: string | null;
  salary_min: number | null;
  salary_currency: string | null;
  linkedin_url: string | null;
  links: string | null;
  skills: string | null;
  strength_score: number | null;
  updated_at: number;
}

function coerceWorkMode(value: unknown): WorkMode {
  return WORK_MODES.includes(value as WorkMode) ? (value as WorkMode) : 'Remote';
}

function parseStringArray(raw: string | null): string[] {
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === 'string') : [];
  } catch {
    return [];
  }
}

/** The Profile shown before the user has saved anything (CVPROF-001 AC4). */
function emptyProfile(): ProfileRecord {
  return {
    name: '',
    targetRole: '',
    yearsExperience: null,
    location: '',
    workMode: 'Remote',
    salaryMin: null,
    salaryCurrency: '',
    linkedinUrl: '',
    links: [],
    skills: [],
    strengthScore: 0,
    updatedAt: 0,
  };
}

function rowToProfile(row: ProfileRow): ProfileRecord {
  return {
    name: row.name ?? '',
    targetRole: row.target_role ?? '',
    yearsExperience: row.years_experience,
    location: row.location ?? '',
    workMode: coerceWorkMode(row.work_mode),
    salaryMin: row.salary_min,
    salaryCurrency: row.salary_currency ?? '',
    linkedinUrl: row.linkedin_url ?? '',
    links: parseStringArray(row.links),
    skills: parseStringArray(row.skills),
    strengthScore: row.strength_score ?? 0,
    updatedAt: row.updated_at,
  };
}

export function createProfileStore(db: ProfileDatabaseLike): ProfileStore {
  db.exec(CREATE_TABLE_SQL);

  const selectStmt = db.prepare('SELECT * FROM profile WHERE id = ?');
  const upsertStmt = db.prepare(
    `INSERT OR REPLACE INTO profile (
       id, name, target_role, years_experience, location, work_mode,
       salary_min, salary_currency, linkedin_url, links, skills,
       strength_score, updated_at
     ) VALUES (
       @id, @name, @target_role, @years_experience, @location, @work_mode,
       @salary_min, @salary_currency, @linkedin_url, @links, @skills,
       @strength_score, @updated_at
     )`,
  );

  function readRow(): ProfileRecord | null {
    const rows = (selectStmt.all?.(SINGLETON_ID) ?? []) as ProfileRow[];
    const row = rows[0];
    return row ? rowToProfile(row) : null;
  }

  return {
    get(): ProfileRecord {
      return readRow() ?? emptyProfile();
    },
    save(input: ProfileInput): ProfileRecord {
      // Merge the incoming edits onto whatever is currently persisted so a
      // partial save never wipes fields the renderer didn't send.
      const current = readRow() ?? emptyProfile();
      const next: ProfileRecord = {
        name: input.name ?? current.name,
        targetRole: input.targetRole ?? current.targetRole,
        yearsExperience:
          input.yearsExperience !== undefined ? input.yearsExperience : current.yearsExperience,
        location: input.location ?? current.location,
        workMode: input.workMode !== undefined ? coerceWorkMode(input.workMode) : current.workMode,
        salaryMin: input.salaryMin !== undefined ? input.salaryMin : current.salaryMin,
        salaryCurrency: input.salaryCurrency ?? current.salaryCurrency,
        linkedinUrl: input.linkedinUrl ?? current.linkedinUrl,
        links: input.links ?? current.links,
        skills: input.skills ?? current.skills,
        strengthScore: input.strengthScore !== undefined ? input.strengthScore : current.strengthScore,
        updatedAt: Date.now(),
      };
      upsertStmt.run({
        id: SINGLETON_ID,
        name: next.name,
        target_role: next.targetRole,
        years_experience: next.yearsExperience,
        location: next.location,
        work_mode: next.workMode,
        salary_min: next.salaryMin,
        salary_currency: next.salaryCurrency,
        linkedin_url: next.linkedinUrl,
        links: JSON.stringify(next.links),
        skills: JSON.stringify(next.skills),
        strength_score: next.strengthScore,
        updated_at: next.updatedAt,
      });
      return next;
    },
  };
}

/**
 * Open a SQLite database file backing the Profile store. Wraps `better-sqlite3`
 * so callers don't have to import it directly; in practice the same `star.db`
 * handle opened for the sites store is reused.
 */
export function openProfileDatabase(filepath: string): ProfileDatabaseLike {
  return new Database(filepath) as unknown as ProfileDatabaseLike;
}

/**
 * Register the `profile:get` and `profile:save` IPC handlers.
 *
 * Each handler is `async` so even though `better-sqlite3` is synchronous the
 * IPC call yields to the event loop and the renderer UI thread is never
 * blocked (mirrors registerSitesIpc).
 */
export function registerProfileIpc(
  ipcMain: import('electron').IpcMain,
  store: ProfileStore,
): void {
  ipcMain.handle('profile:get', async () => store.get());
  ipcMain.handle('profile:save', async (_event, input: ProfileInput) => store.save(input ?? {}));
}
