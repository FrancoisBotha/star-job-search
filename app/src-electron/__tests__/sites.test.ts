/**
 * Unit tests for the Sites persistence module (BRWSR-002).
 *
 * Covers:
 *  - AC1: Site entity persisted with required fields
 *  - AC2: IPC channels for list / add / remove
 *  - AC3: URL normalisation on add (scheme defaulting, trimming, host derivation)
 *  - AC4: Sites survive an app restart (state lives in the DB, not in memory)
 *  - AC5: Removing a site deletes it from persistence
 *  - AC6: IPC handlers return promises so the renderer is never blocked
 *  - AC7: Deferred PRD §8 fields (searchUrlTemplate, adapterId, ratePolicy) are
 *         not persisted; no JobListing/MatchScore work is introduced.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ELECTRON_DIR = path.resolve(__dirname, '..');

// Mock 'better-sqlite3' so tests do not require the native binding.
vi.mock('better-sqlite3', () => {
  return { default: class {} };
});

// --- Fake in-memory database mimicking the small better-sqlite3 surface ---

interface SiteRow {
  id: string;
  url: string;
  host: string;
  label: string;
  enabled: number;
  added_at: number;
}

class FakeDatabase {
  rows: SiteRow[] = [];
  exec(_sql: string) {
    // CREATE TABLE statements — nothing to do for the fake.
  }
  prepare(sql: string) {
    const text = sql.trim();
    if (/^INSERT\s+INTO\s+sites/i.test(text)) {
      return {
        run: (params: SiteRow) => {
          this.rows.push({ ...params });
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
    if (/^UPDATE\s+sites\s+SET\s+enabled/i.test(text)) {
      return {
        run: (enabled: number, id: string) => {
          const row = this.rows.find((r) => r.id === id);
          if (row) row.enabled = enabled;
          return { changes: row ? 1 : 0 };
        },
      };
    }
    if (/^SELECT/i.test(text)) {
      return {
        all: () =>
          [...this.rows].sort((a, b) => a.added_at - b.added_at),
      };
    }
    throw new Error(`FakeDatabase: unsupported SQL: ${text}`);
  }
}

// --- IPC mock --------------------------------------------------------------

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

// --- Tests -----------------------------------------------------------------

describe('normaliseSiteInput — URL normalisation (AC3)', () => {
  it('defaults the scheme to https when none is provided', async () => {
    const { normaliseSiteInput } = await importModule();
    const result = normaliseSiteInput('rolehub.com');
    expect(result.url).toBe('https://rolehub.com');
    expect(result.host).toBe('rolehub.com');
  });

  it('trims surrounding whitespace before normalising', async () => {
    const { normaliseSiteInput } = await importModule();
    const result = normaliseSiteInput('   https://workscout.io/jobs  ');
    expect(result.url).toBe('https://workscout.io/jobs');
    expect(result.host).toBe('workscout.io');
  });

  it('derives the host (lowercased) from the URL', async () => {
    const { normaliseSiteInput } = await importModule();
    const result = normaliseSiteInput('HTTPS://Talentstream.COM/Search');
    expect(result.host).toBe('talentstream.com');
  });

  it('rejects empty input', async () => {
    const { normaliseSiteInput } = await importModule();
    expect(() => normaliseSiteInput('   ')).toThrow();
  });
});

describe('createSitesStore — persistence (AC1, AC5, AC7)', () => {
  it('AC1: add() persists a Site with id, url, host, label, enabled, addedAt', async () => {
    const { createSitesStore } = await importModule();
    const db = new FakeDatabase();
    const store = createSitesStore(db as never);

    const site = store.add({ url: 'rolehub.com' });

    expect(site.id).toBeTypeOf('string');
    expect(site.id.length).toBeGreaterThan(0);
    expect(site.url).toBe('https://rolehub.com');
    expect(site.host).toBe('rolehub.com');
    expect(site.label).toBe('rolehub.com');
    expect(site.enabled).toBe(true);
    expect(site.addedAt).toBeTypeOf('number');

    expect(store.list()).toHaveLength(1);
    expect(store.list()[0]!.url).toBe('https://rolehub.com');
  });

  it('AC1: an explicit label is preserved on add', async () => {
    const { createSitesStore } = await importModule();
    const db = new FakeDatabase();
    const store = createSitesStore(db as never);

    const site = store.add({ url: 'workscout.io', label: 'Work Scout' });
    expect(site.label).toBe('Work Scout');
  });

  it('AC5: remove() deletes a Site from persistence', async () => {
    const { createSitesStore } = await importModule();
    const db = new FakeDatabase();
    const store = createSitesStore(db as never);

    const a = store.add({ url: 'rolehub.com' });
    const b = store.add({ url: 'workscout.io' });
    expect(store.list()).toHaveLength(2);

    store.remove(a.id);
    const remaining = store.list();
    expect(remaining).toHaveLength(1);
    expect(remaining[0]!.id).toBe(b.id);
  });

  it('AC7: persisted Site does NOT include deferred PRD §8 fields', async () => {
    const { createSitesStore } = await importModule();
    const db = new FakeDatabase();
    const store = createSitesStore(db as never);
    const site = store.add({ url: 'rolehub.com' });

    for (const deferred of ['searchUrlTemplate', 'adapterId', 'ratePolicy']) {
      expect(site).not.toHaveProperty(deferred);
    }
  });
});

describe('createSitesStore — restart durability (AC4)', () => {
  it('a second store opened on the same DB sees previously-added sites', async () => {
    const { createSitesStore } = await importModule();
    const db = new FakeDatabase();

    const store1 = createSitesStore(db as never);
    store1.add({ url: 'rolehub.com' });
    store1.add({ url: 'workscout.io' });

    // Simulate a restart: open a brand-new store against the same DB.
    const store2 = createSitesStore(db as never);
    const sites = store2.list();
    expect(sites.map((s) => s.host)).toEqual(['rolehub.com', 'workscout.io']);
  });
});

describe('registerSitesIpc — IPC channels (AC2, AC6)', () => {
  it('AC2: registers sites:list, sites:add, sites:remove handlers', async () => {
    const { createSitesStore, registerSitesIpc } = await importModule();
    const db = new FakeDatabase();
    registerSitesIpc(fakeIpcMain as never, createSitesStore(db as never));

    for (const channel of ['sites:list', 'sites:add', 'sites:remove']) {
      expect(ipcHandlers.has(channel), `missing handler for ${channel}`).toBe(true);
    }
  });

  it('AC2 + AC3: sites:add normalises the URL before persisting', async () => {
    const { createSitesStore, registerSitesIpc } = await importModule();
    const db = new FakeDatabase();
    const store = createSitesStore(db as never);
    registerSitesIpc(fakeIpcMain as never, store);

    const added = (await ipcHandlers.get('sites:add')!({}, { url: '  TalentStream.com  ' })) as {
      url: string;
      host: string;
    };
    expect(added.url).toBe('https://talentstream.com');
    expect(added.host).toBe('talentstream.com');
  });

  it('AC2: sites:list returns the persisted sites', async () => {
    const { createSitesStore, registerSitesIpc } = await importModule();
    const db = new FakeDatabase();
    const store = createSitesStore(db as never);
    store.add({ url: 'rolehub.com' });
    registerSitesIpc(fakeIpcMain as never, store);

    const list = (await ipcHandlers.get('sites:list')!({})) as Array<{ host: string }>;
    expect(list).toHaveLength(1);
    expect(list[0]!.host).toBe('rolehub.com');
  });

  it('AC2 + AC5: sites:remove deletes the requested site', async () => {
    const { createSitesStore, registerSitesIpc } = await importModule();
    const db = new FakeDatabase();
    const store = createSitesStore(db as never);
    const site = store.add({ url: 'rolehub.com' });
    registerSitesIpc(fakeIpcMain as never, store);

    await ipcHandlers.get('sites:remove')!({}, site.id);
    expect(store.list()).toHaveLength(0);
  });

  it('AC6 (NFR-003): IPC handlers return promises — never block the main UI thread', async () => {
    const { createSitesStore, registerSitesIpc } = await importModule();
    const db = new FakeDatabase();
    registerSitesIpc(fakeIpcMain as never, createSitesStore(db as never));

    for (const channel of ['sites:list', 'sites:add', 'sites:remove']) {
      const args: unknown[] =
        channel === 'sites:add'
          ? [{}, { url: 'example.com' }]
          : channel === 'sites:remove'
            ? [{}, 'nonexistent-id']
            : [{}];
      const result = ipcHandlers.get(channel)!(...args);
      expect(
        typeof (result as Promise<unknown>).then,
        `${channel} must return a thenable`,
      ).toBe('function');
      await result;
    }
  });
});

describe('preload bridge (AC2)', () => {
  it('exposes a starSites bridge invoking sites:list / sites:add / sites:remove', () => {
    const preload = readFileSync(
      path.join(ELECTRON_DIR, 'electron-preload.ts'),
      'utf8',
    );
    expect(preload).toMatch(/exposeInMainWorld\(\s*['"]starSites['"]/);
    for (const channel of ['sites:list', 'sites:add', 'sites:remove']) {
      expect(preload, `preload missing channel ${channel}`).toContain(channel);
    }
  });
});

describe('scope boundary (AC7)', () => {
  it('sites.ts introduces no JobListing/MatchScore/scoring/scraping code', () => {
    const sites = readFileSync(path.join(ELECTRON_DIR, 'sites.ts'), 'utf8');
    for (const forbidden of [
      /JobListing/,
      /MatchScore/,
      /MatchFactor/,
      /scrape/i,
      /extract(?!or)/i,
      /scoring/i,
      /searchUrlTemplate/,
      /adapterId/,
      /ratePolicy/,
    ]) {
      expect(sites, `sites.ts contains forbidden pattern ${forbidden}`).not.toMatch(forbidden);
    }
  });
});
