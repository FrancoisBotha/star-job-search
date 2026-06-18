/**
 * Unit tests for the optional per-site username (SITEUSR-001).
 *
 * Covers:
 *  - AC1: Site gains an optional `username` field; CREATE TABLE has a
 *         `username` column; ALTER TABLE migration on an existing DB is
 *         additive and guarded.
 *  - AC2: `sites:setUsername` IPC handler persists the username for a site
 *         id; `sites:list` / `sites:add` return the username on every row.
 *  - AC5: Only a username is stored — no password column or field is added.
 *  - AC6: The persisted username survives a "restart" (a fresh store opened
 *         against the same DB sees the previously-set username).
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ELECTRON_DIR = path.resolve(__dirname, '..');

vi.mock('better-sqlite3', () => {
  return { default: class {} };
});

interface SiteRow {
  id: string;
  url: string;
  host: string;
  label: string;
  enabled: number;
  added_at: number;
  username: string | null;
}

class FakeDatabase {
  rows: SiteRow[] = [];
  execLog: string[] = [];
  /** Pretend the table already has columns x — used to test ALTER guarding. */
  preexistingColumns: string[] = [
    'id',
    'url',
    'host',
    'label',
    'enabled',
    'added_at',
  ];
  /** Toggled true when ADD COLUMN username is run. */
  addedUsername = false;

  exec(sql: string) {
    this.execLog.push(sql);
    if (/ALTER\s+TABLE\s+sites\s+ADD\s+COLUMN\s+username/i.test(sql)) {
      if (this.preexistingColumns.includes('username')) {
        throw new Error('duplicate column name: username');
      }
      this.preexistingColumns.push('username');
      this.addedUsername = true;
    }
  }

  prepare(sql: string) {
    const text = sql.trim();
    if (/^INSERT\s+INTO\s+sites/i.test(text)) {
      return {
        run: (params: SiteRow) => {
          this.rows.push({ ...params, username: params.username ?? null });
          return { changes: 1 };
        },
      };
    }
    if (/^DELETE\s+FROM\s+sites/i.test(text)) {
      return {
        run: (id: string) => {
          const before = this.rows.length;
          this.rows = this.rows.filter((r) => r.id !== id);
          return { changes: before - this.rows.length };
        },
      };
    }
    if (/^UPDATE\s+sites\s+SET\s+username/i.test(text)) {
      return {
        run: (username: string | null, id: string) => {
          const row = this.rows.find((r) => r.id === id);
          if (row) row.username = username;
          return { changes: row ? 1 : 0 };
        },
      };
    }
    if (/^UPDATE\s+sites\s+SET\s+enabled/i.test(text)) {
      return {
        run: (enabled: number, id: string) => {
          const row = this.rows.find((r) => r.id === id);
          if (row) row.enabled = enabled;
          return { changes: row ? 1 : 0 };
        },
      };
    }
    if (/^PRAGMA\s+table_info/i.test(text)) {
      return {
        all: () =>
          this.preexistingColumns.map((name) => ({ name })),
      };
    }
    if (/^SELECT/i.test(text)) {
      return {
        all: () => [...this.rows].sort((a, b) => a.added_at - b.added_at),
      };
    }
    throw new Error(`FakeDatabase: unsupported SQL: ${text}`);
  }
}

const ipcHandlers = new Map<string, (...args: unknown[]) => unknown>();
const fakeIpcMain = {
  handle: (channel: string, fn: (...args: unknown[]) => unknown) => {
    ipcHandlers.set(channel, fn);
  },
  removeHandler: (channel: string) => {
    ipcHandlers.delete(channel);
  },
};

beforeEach(() => {
  ipcHandlers.clear();
});

afterEach(() => {
  vi.resetModules();
});

async function importModule() {
  return await import('../sites');
}

describe('createSitesStore — username field (AC1)', () => {
  it('add() returns a Site with a `username` field (null/empty by default)', async () => {
    const { createSitesStore } = await importModule();
    const db = new FakeDatabase();
    const store = createSitesStore(db as never);
    const site = store.add({ url: 'rolehub.com' }) as { username?: unknown };
    expect(site).toHaveProperty('username');
    expect(site.username ?? null).toBeNull();
  });

  it('list() rows carry the `username` field', async () => {
    const { createSitesStore } = await importModule();
    const db = new FakeDatabase();
    const store = createSitesStore(db as never);
    store.add({ url: 'rolehub.com' });
    const [row] = store.list() as Array<{ username?: unknown }>;
    expect(row).toHaveProperty('username');
  });

  it('CREATE TABLE in createSitesStore declares a username column', async () => {
    const sites = readFileSync(path.join(ELECTRON_DIR, 'sites.ts'), 'utf8');
    expect(sites).toMatch(/CREATE\s+TABLE[\s\S]+username/i);
  });

  it('ALTER TABLE ... ADD COLUMN username runs as a guarded migration', async () => {
    const { createSitesStore } = await importModule();
    const db = new FakeDatabase();
    createSitesStore(db as never);
    const altered = db.execLog.some((s) =>
      /ALTER\s+TABLE\s+sites\s+ADD\s+COLUMN\s+username/i.test(s),
    );
    expect(altered).toBe(true);
  });

  it('opening twice does not throw on the duplicate ADD COLUMN', async () => {
    const { createSitesStore } = await importModule();
    const db = new FakeDatabase();
    createSitesStore(db as never);
    expect(() => createSitesStore(db as never)).not.toThrow();
  });
});

describe('createSitesStore — setUsername persistence (AC2, AC6)', () => {
  it('exposes a setUsername(id, username) method that persists the value', async () => {
    const { createSitesStore } = await importModule();
    const db = new FakeDatabase();
    const store = createSitesStore(db as never) as {
      add: (i: { url: string }) => { id: string };
      setUsername: (id: string, username: string) => void;
      list: () => Array<{ id: string; username: string | null }>;
    };
    const site = store.add({ url: 'rolehub.com' });
    store.setUsername(site.id, 'francois');
    const [row] = store.list();
    expect(row!.username).toBe('francois');
  });

  it('username persists across a fresh store opened on the same DB', async () => {
    const { createSitesStore } = await importModule();
    const db = new FakeDatabase();
    const store1 = createSitesStore(db as never) as {
      add: (i: { url: string }) => { id: string };
      setUsername: (id: string, username: string) => void;
    };
    const site = store1.add({ url: 'rolehub.com' });
    store1.setUsername(site.id, 'francois');

    const store2 = createSitesStore(db as never) as {
      list: () => Array<{ id: string; username: string | null }>;
    };
    const [row] = store2.list();
    expect(row!.username).toBe('francois');
  });
});

describe('registerSitesIpc — sites:setUsername (AC2)', () => {
  it('registers a sites:setUsername handler', async () => {
    const { createSitesStore, registerSitesIpc } = await importModule();
    const db = new FakeDatabase();
    registerSitesIpc(fakeIpcMain as never, createSitesStore(db as never));
    expect(ipcHandlers.has('sites:setUsername')).toBe(true);
  });

  it('sites:setUsername persists the username for the given site id', async () => {
    const { createSitesStore, registerSitesIpc } = await importModule();
    const db = new FakeDatabase();
    const store = createSitesStore(db as never);
    registerSitesIpc(fakeIpcMain as never, store);
    const site = store.add({ url: 'rolehub.com' });

    await ipcHandlers.get('sites:setUsername')!(
      {},
      { id: site.id, username: 'francois' },
    );
    const list = store.list() as Array<{ id: string; username: string | null }>;
    expect(list[0]!.username).toBe('francois');
  });
});

describe('preload bridge — setUsername (AC3)', () => {
  it('exposes setUsername on starSites invoking sites:setUsername', () => {
    const preload = readFileSync(
      path.join(ELECTRON_DIR, 'electron-preload.ts'),
      'utf8',
    );
    expect(preload).toContain('sites:setUsername');
    expect(preload).toMatch(/setUsername\s*:/);
  });
});

describe('scope — no password storage (AC5)', () => {
  it('sites.ts does not declare or persist a password field', () => {
    const sites = readFileSync(path.join(ELECTRON_DIR, 'sites.ts'), 'utf8');
    expect(sites).not.toMatch(/password/i);
  });

  it('env.d.ts does not declare a password field on StarSite', () => {
    const env = readFileSync(
      path.join(ELECTRON_DIR, '..', 'src', 'env.d.ts'),
      'utf8',
    );
    expect(env).not.toMatch(/password/i);
  });
});
