/**
 * Sites persistence module (BRWSR-002).
 *
 * Owns the on-disk store of user-saved job sites that the Discover dropdown
 * and Settings page hydrate from. Backed by SQLite via `better-sqlite3` in
 * the main process — the Architecture's chosen single source of truth for
 * local data.
 *
 * Persisted fields: `id, url, host, label, enabled, addedAt` and the optional
 * per-site `username` (SITEUSR-001). The deferred PRD §8 fields belong to the
 * per-site adapter epic and are deliberately absent (scope boundary — see the
 * epic spec).
 *
 * Renderer talks to this module via the preload-bridge channels:
 *   sites:list | sites:add | sites:remove | sites:setEnabled | sites:setUsername
 */
import { randomUUID } from 'node:crypto';
import Database from 'better-sqlite3';
import type { IpcMain } from 'electron';

export interface Site {
  id: string;
  url: string;
  host: string;
  label: string;
  enabled: boolean;
  addedAt: number;
  /** Optional per-site username (SITEUSR-001). Null when never set. */
  username: string | null;
}

export interface NormalisedSiteInput {
  url: string;
  host: string;
}

export interface AddSiteInput {
  url: string;
  label?: string;
}

// Minimal slice of the better-sqlite3 surface we actually use — keeps the
// store unit-testable with a lightweight fake and avoids coupling the
// store's contract to the native binding.
export interface SitesDatabaseLike {
  exec(sql: string): unknown;
  prepare(sql: string): {
    run(...args: unknown[]): unknown;
    all?(...args: unknown[]): unknown[];
  };
}

export interface SitesStore {
  list(): Site[];
  add(input: AddSiteInput): Site;
  remove(id: string): void;
  /** Toggle whether a site is active (shown as a tab on Discover). */
  setEnabled(id: string, enabled: boolean): void;
  /** Persist the optional per-site username (SITEUSR-001). */
  setUsername(id: string, username: string | null): void;
}

/**
 * Normalise a user-entered site URL.
 *
 * - Trims surrounding whitespace.
 * - Defaults the scheme to `https://` when none is supplied.
 * - Derives the lowercased host from the parsed URL.
 *
 * Throws if the input is blank or cannot be parsed as a URL.
 */
export function normaliseSiteInput(raw: string): NormalisedSiteInput {
  const trimmed = (raw ?? '').trim();
  if (!trimmed) {
    throw new Error('Site URL is required');
  }
  const withScheme = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  let parsed: URL;
  try {
    parsed = new URL(withScheme);
  } catch {
    throw new Error(`Invalid site URL: ${raw}`);
  }
  const host = parsed.host.toLowerCase();
  // Re-serialise without a trailing slash on bare-host inputs so the stored
  // URL stays close to what the user typed.
  let url = parsed.toString();
  if ((parsed.pathname === '/' || parsed.pathname === '') && url.endsWith('/')) {
    url = url.slice(0, -1);
  }
  return { url, host };
}

const CREATE_TABLE_SQL = `
  CREATE TABLE IF NOT EXISTS sites (
    id        TEXT PRIMARY KEY,
    url       TEXT NOT NULL,
    host      TEXT NOT NULL,
    label     TEXT NOT NULL,
    enabled   INTEGER NOT NULL DEFAULT 1,
    added_at  INTEGER NOT NULL,
    username  TEXT
  )
`;

interface SiteRow {
  id: string;
  url: string;
  host: string;
  label: string;
  enabled: number;
  added_at: number;
  username: string | null;
}

function rowToSite(row: SiteRow): Site {
  return {
    id: row.id,
    url: row.url,
    host: row.host,
    label: row.label,
    enabled: row.enabled !== 0,
    addedAt: row.added_at,
    username: row.username ?? null,
  };
}

/**
 * Additive migration for the optional `username` column (SITEUSR-001).
 *
 * The CREATE TABLE above declares the column for fresh databases. Pre-existing
 * databases created before SITEUSR-001 still load — we try an ALTER TABLE ...
 * ADD COLUMN and swallow the duplicate-column error SQLite raises when the
 * column already exists, leaving the data intact.
 */
function migrateAddUsernameColumn(db: SitesDatabaseLike): void {
  try {
    db.exec('ALTER TABLE sites ADD COLUMN username TEXT');
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (!/duplicate column name/i.test(message)) {
      throw err;
    }
  }
}

export function createSitesStore(db: SitesDatabaseLike): SitesStore {
  db.exec(CREATE_TABLE_SQL);
  migrateAddUsernameColumn(db);

  const listStmt = db.prepare(
    'SELECT id, url, host, label, enabled, added_at, username FROM sites ORDER BY added_at ASC',
  );
  const insertStmt = db.prepare(
    'INSERT INTO sites (id, url, host, label, enabled, added_at, username) VALUES (@id, @url, @host, @label, @enabled, @added_at, @username)',
  );
  const deleteStmt = db.prepare('DELETE FROM sites WHERE id = ?');
  const setEnabledStmt = db.prepare('UPDATE sites SET enabled = ? WHERE id = ?');
  const setUsernameStmt = db.prepare('UPDATE sites SET username = ? WHERE id = ?');

  return {
    list(): Site[] {
      const rows = (listStmt.all?.() ?? []) as SiteRow[];
      return rows.map(rowToSite);
    },
    add(input: AddSiteInput): Site {
      const { url, host } = normaliseSiteInput(input.url);
      const site: Site = {
        id: randomUUID(),
        url,
        host,
        label: input.label?.trim() || host,
        enabled: true,
        addedAt: Date.now(),
        username: null,
      };
      insertStmt.run({
        id: site.id,
        url: site.url,
        host: site.host,
        label: site.label,
        enabled: site.enabled ? 1 : 0,
        added_at: site.addedAt,
        username: site.username,
      });
      return site;
    },
    remove(id: string): void {
      deleteStmt.run(id);
    },
    setEnabled(id: string, enabled: boolean): void {
      setEnabledStmt.run(enabled ? 1 : 0, id);
    },
    setUsername(id: string, username: string | null): void {
      const value = typeof username === 'string' ? username : null;
      setUsernameStmt.run(value, id);
    },
  };
}

/**
 * Open a SQLite database file backing the Sites store. Wraps `better-sqlite3`
 * so callers don't have to import it directly; the dependency stays a main-
 * process concern.
 */
export function openSitesDatabase(filepath: string): SitesDatabaseLike {
  return new Database(filepath) as unknown as SitesDatabaseLike;
}

/**
 * Register the `sites:list`, `sites:add`, `sites:remove`, `sites:setEnabled`,
 * and `sites:setUsername` IPC handlers.
 *
 * Each handler is `async`, so even though `better-sqlite3` itself is
 * synchronous, the IPC call returns control to the event loop immediately
 * and the renderer's UI thread is never blocked (NFR-003).
 */
export function registerSitesIpc(ipcMain: IpcMain, store: SitesStore): void {
  ipcMain.handle('sites:list', async () => store.list());
  ipcMain.handle('sites:add', async (_event, input: AddSiteInput) => store.add(input));
  ipcMain.handle('sites:remove', async (_event, id: string) => {
    store.remove(id);
  });
  ipcMain.handle(
    'sites:setEnabled',
    async (_event, input: { id: string; enabled: boolean }) => {
      store.setEnabled(input.id, input.enabled);
    },
  );
  ipcMain.handle(
    'sites:setUsername',
    async (_event, input: { id: string; username: string | null }) => {
      store.setUsername(input.id, input.username ?? null);
    },
  );
}
