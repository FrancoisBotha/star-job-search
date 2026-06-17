/**
 * Preferred-models persistence module (LLM-003).
 *
 * Owns the user's short list of preferred OpenRouter model slugs and which
 * one is the default. Backed by SQLite on the shared `star.db` opened in
 * `electron-main.ts` (same handle used by the sites store).
 *
 * Invariants enforced by this layer:
 *  - At most 5 rows.
 *  - When the list is non-empty, exactly one row has `is_default = 1`.
 *  - The first model added becomes the default automatically.
 *  - Removing the default promotes the earliest remaining row by position.
 *
 * Renderer talks to this module via the preload-bridge channels:
 *   preferredModels:list | preferredModels:add | preferredModels:remove |
 *   preferredModels:setDefault
 */
import type { IpcMain } from 'electron';

export const MAX_PREFERRED_MODELS = 5;

export interface PreferredModel {
  slug: string;
  isDefault: boolean;
  position: number;
}

export type PreferredModelsAddErrorCode = 'EMPTY_SLUG' | 'DUPLICATE' | 'LIMIT_REACHED';

export type PreferredModelsAddResult =
  | { ok: true; models: PreferredModel[] }
  | { ok: false; code: PreferredModelsAddErrorCode; message: string };

// Minimal slice of better-sqlite3 we actually use; mirrors the sites store
// so the same database handle can be passed to both.
export interface PreferredModelsDatabaseLike {
  exec(sql: string): unknown;
  prepare(sql: string): {
    run(...args: unknown[]): unknown;
    all?(...args: unknown[]): unknown[];
  };
}

export interface PreferredModelsStore {
  list(): PreferredModel[];
  add(slug: string): PreferredModelsAddResult;
  remove(slug: string): PreferredModel[];
  setDefault(slug: string): PreferredModel[];
}

const CREATE_TABLE_SQL = `
  CREATE TABLE IF NOT EXISTS preferred_models (
    slug       TEXT PRIMARY KEY,
    is_default INTEGER NOT NULL DEFAULT 0,
    position   INTEGER NOT NULL
  )
`;

interface PrefRow {
  slug: string;
  is_default: number;
  position: number;
}

function rowToModel(row: PrefRow): PreferredModel {
  return {
    slug: row.slug,
    isDefault: row.is_default !== 0,
    position: row.position,
  };
}

export function createPreferredModelsStore(
  db: PreferredModelsDatabaseLike,
): PreferredModelsStore {
  db.exec(CREATE_TABLE_SQL);

  const listStmt = db.prepare(
    'SELECT slug, is_default, position FROM preferred_models ORDER BY position ASC',
  );
  const insertStmt = db.prepare(
    'INSERT INTO preferred_models (slug, is_default, position) VALUES (@slug, @is_default, @position)',
  );
  const deleteStmt = db.prepare('DELETE FROM preferred_models WHERE slug = ?');
  const clearDefaultsStmt = db.prepare(
    'UPDATE preferred_models SET is_default = 0 WHERE is_default = 1',
  );
  const setDefaultStmt = db.prepare(
    'UPDATE preferred_models SET is_default = 1 WHERE slug = ?',
  );

  function readRows(): PrefRow[] {
    return (listStmt.all?.() ?? []) as PrefRow[];
  }

  function list(): PreferredModel[] {
    return readRows().map(rowToModel);
  }

  return {
    list,
    add(rawSlug: string): PreferredModelsAddResult {
      const slug = (rawSlug ?? '').trim();
      if (!slug) {
        return { ok: false, code: 'EMPTY_SLUG', message: 'Model slug is required' };
      }
      const rows = readRows();
      if (rows.length >= MAX_PREFERRED_MODELS) {
        return {
          ok: false,
          code: 'LIMIT_REACHED',
          message: `At most ${MAX_PREFERRED_MODELS} preferred models can be stored`,
        };
      }
      if (rows.some((r) => r.slug === slug)) {
        return { ok: false, code: 'DUPLICATE', message: `Model "${slug}" is already in the list` };
      }
      const nextPosition = rows.reduce((max, r) => Math.max(max, r.position), -1) + 1;
      const isFirst = rows.length === 0;
      insertStmt.run({
        slug,
        is_default: isFirst ? 1 : 0,
        position: nextPosition,
      });
      return { ok: true, models: list() };
    },
    remove(slug: string): PreferredModel[] {
      const rows = readRows();
      const target = rows.find((r) => r.slug === slug);
      if (!target) return list();
      deleteStmt.run(slug);
      if (target.is_default !== 0) {
        const remaining = readRows();
        if (remaining.length > 0) {
          const earliest = remaining.reduce((a, b) => (a.position <= b.position ? a : b));
          setDefaultStmt.run(earliest.slug);
        }
      }
      return list();
    },
    setDefault(slug: string): PreferredModel[] {
      const rows = readRows();
      if (!rows.some((r) => r.slug === slug)) return list();
      clearDefaultsStmt.run();
      setDefaultStmt.run(slug);
      return list();
    },
  };
}

/**
 * Register the `preferredModels:list|add|remove|setDefault` IPC handlers.
 * Each returns the updated `PreferredModel[]` list on success; `add` returns
 * a tagged union so the renderer can branch on typed validation errors
 * (EMPTY_SLUG / DUPLICATE / LIMIT_REACHED) without losing the .code over IPC.
 */
export function registerPreferredModelsIpc(
  ipcMain: IpcMain,
  store: PreferredModelsStore,
): void {
  ipcMain.handle('preferredModels:list', async () => store.list());
  ipcMain.handle('preferredModels:add', async (_event, slug: string) => store.add(slug));
  ipcMain.handle('preferredModels:remove', async (_event, slug: string) => store.remove(slug));
  ipcMain.handle('preferredModels:setDefault', async (_event, slug: string) =>
    store.setDefault(slug),
  );
}
