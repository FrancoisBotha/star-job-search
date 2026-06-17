/**
 * Sites persistence module (BRWSR-002).
 *
 * Owns the on-disk store of user-saved job sites that the Discover dropdown
 * and Settings page hydrate from. Backed by SQLite via `better-sqlite3` in
 * the main process — the Architecture's chosen single source of truth for
 * local data.
 *
 * Only the MVP1 fields are persisted here: `id, url, host, label, enabled,
 * addedAt`. The deferred PRD §8 fields belong to the per-site adapter epic
 * and are deliberately absent (scope boundary — see the epic spec).
 *
 * Renderer talks to this module via the preload-bridge channels:
 *   sites:list | sites:add | sites:remove
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
    added_at  INTEGER NOT NULL
  )
`;

interface SiteRow {
  id: string;
  url: string;
  host: string;
  label: string;
  enabled: number;
  added_at: number;
}

function rowToSite(row: SiteRow): Site {
  return {
    id: row.id,
    url: row.url,
    host: row.host,
    label: row.label,
    enabled: row.enabled !== 0,
    addedAt: row.added_at,
  };
}

export function createSitesStore(db: SitesDatabaseLike): SitesStore {
  db.exec(CREATE_TABLE_SQL);

  const listStmt = db.prepare(
    'SELECT id, url, host, label, enabled, added_at FROM sites ORDER BY added_at ASC',
  );
  const insertStmt = db.prepare(
    'INSERT INTO sites (id, url, host, label, enabled, added_at) VALUES (@id, @url, @host, @label, @enabled, @added_at)',
  );
  const deleteStmt = db.prepare('DELETE FROM sites WHERE id = ?');
  const setEnabledStmt = db.prepare('UPDATE sites SET enabled = ? WHERE id = ?');

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
      };
      insertStmt.run({
        id: site.id,
        url: site.url,
        host: site.host,
        label: site.label,
        enabled: site.enabled ? 1 : 0,
        added_at: site.addedAt,
      });
      return site;
    },
    remove(id: string): void {
      deleteStmt.run(id);
    },
    setEnabled(id: string, enabled: boolean): void {
      setEnabledStmt.run(enabled ? 1 : 0, id);
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
 * Register the `sites:list`, `sites:add`, `sites:remove` IPC handlers.
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
}
