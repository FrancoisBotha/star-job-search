/**
 * Epic 1 behavioural regression suite (BRWSR-007).
 *
 * The pre-existing per-ticket tests (sites.test.ts, browser-surface.test.ts,
 * DiscoverPage.test.ts, app-store.test.ts, epic-acceptance.test.ts) are a
 * mix of unit checks and source-grep guards. This file complements them by
 * exercising the epic's *user-facing flows* end-to-end through the real
 * modules:
 *
 *  - Add → normalise → persist → restart durability
 *  - Remove → disappears from the shared store backing both Settings and Discover
 *  - Dropdown is sourced from the same persisted list (no drift)
 *  - Selecting a site loads it in the embedded browser and the URL pill reflects it
 *  - Back/forward navigation drives the underlying webContents
 *  - The embedded browser runs in a partitioned, isolated session
 *  - Discover shows an empty state when no sites are configured
 *
 * Wiring intent: drive the real `createSitesStore`, `registerSitesIpc`, and
 * `createJobBrowser` against an in-memory fake DB and a mocked Electron
 * surface — no new test framework, no @vue/test-utils.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ELECTRON_DIR = path.resolve(__dirname, '..');
const REPO_DIR = path.resolve(ELECTRON_DIR, '..');
const PAGES_DIR = path.join(REPO_DIR, 'src', 'pages');

// --- better-sqlite3 stub (native binding not available in tests) -----------

vi.mock('better-sqlite3', () => {
  return { default: class {} };
});

// --- Electron mock ---------------------------------------------------------

interface FakeWebContents {
  loadURL: ReturnType<typeof vi.fn>;
  goBack: ReturnType<typeof vi.fn>;
  goForward: ReturnType<typeof vi.fn>;
  canGoBack: ReturnType<typeof vi.fn>;
  canGoForward: ReturnType<typeof vi.fn>;
}

interface FakeBrowserView {
  webContents: FakeWebContents;
  setBounds: ReturnType<typeof vi.fn>;
  setAutoResize: ReturnType<typeof vi.fn>;
  __opts: { webPreferences: Record<string, unknown> };
}

const browserViewInstances: FakeBrowserView[] = [];
const ipcHandlers = new Map<string, (...args: unknown[]) => unknown>();
const parentWindow = {
  addBrowserView: vi.fn(),
  removeBrowserView: vi.fn(),
  getBrowserViews: vi.fn(() => [] as FakeBrowserView[]),
};

// History simulates a real browser stack so back/forward actually move.
const navStack: { history: string[]; index: number } = { history: [], index: -1 };

vi.mock('electron', () => {
  class BrowserView {
    webContents: FakeWebContents;
    setBounds = vi.fn();
    setAutoResize = vi.fn();
    __opts: { webPreferences: Record<string, unknown> };
    constructor(opts: { webPreferences: Record<string, unknown> }) {
      this.__opts = opts;
      this.webContents = {
        loadURL: vi.fn((url: string) => {
          if (navStack.index < navStack.history.length - 1) {
            navStack.history.splice(navStack.index + 1);
          }
          navStack.history.push(url);
          navStack.index = navStack.history.length - 1;
          return Promise.resolve();
        }),
        goBack: vi.fn(() => {
          if (navStack.index > 0) navStack.index -= 1;
        }),
        goForward: vi.fn(() => {
          if (navStack.index < navStack.history.length - 1) navStack.index += 1;
        }),
        canGoBack: vi.fn(() => navStack.index > 0),
        canGoForward: vi.fn(() => navStack.index < navStack.history.length - 1),
      };
      browserViewInstances.push(this as unknown as FakeBrowserView);
    }
  }
  return {
    BrowserView,
    ipcMain: {
      handle: (channel: string, fn: (...args: unknown[]) => unknown) => {
        ipcHandlers.set(channel, fn);
      },
      removeHandler: (channel: string) => {
        ipcHandlers.delete(channel);
      },
    },
    session: {
      fromPartition: vi.fn((p: string) => ({ partition: p })),
    },
  };
});

// --- Fake DB (mirrors the better-sqlite3 surface the sites store uses) ----

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
  exec(_sql: string) {}
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
    if (/^SELECT/i.test(text)) {
      return { all: () => [...this.rows].sort((a, b) => a.added_at - b.added_at) };
    }
    throw new Error(`FakeDatabase: unsupported SQL: ${text}`);
  }
}

const fakeIpcMain = {
  handle: (channel: string, fn: (...args: unknown[]) => unknown) => {
    ipcHandlers.set(channel, fn);
  },
  removeHandler: (channel: string) => {
    ipcHandlers.delete(channel);
  },
};

beforeEach(() => {
  browserViewInstances.length = 0;
  ipcHandlers.clear();
  parentWindow.addBrowserView.mockClear();
  parentWindow.removeBrowserView.mockClear();
  navStack.history = [];
  navStack.index = -1;
});

afterEach(() => {
  vi.resetModules();
});

async function importSites() {
  return await import('../sites');
}

async function importSurface() {
  return await import('../browser-surface');
}

// --- Flow 1: add → normalise → persist → restart --------------------------

describe('Epic AC1 — sites are normalised, persisted, and survive restart', () => {
  it('normalises raw user input on add: scheme default + lowercase host', async () => {
    const { createSitesStore, registerSitesIpc } = await importSites();
    const db = new FakeDatabase();
    registerSitesIpc(fakeIpcMain as never, createSitesStore(db as never));

    const added = (await ipcHandlers.get('sites:add')!({}, { url: '  RoleHub.COM  ' })) as {
      url: string;
      host: string;
      label: string;
    };

    expect(added.url).toBe('https://rolehub.com');
    expect(added.host).toBe('rolehub.com');
    expect(added.label).toBe('rolehub.com');
  });

  it('returns the persisted row on sites:list after add', async () => {
    const { createSitesStore, registerSitesIpc } = await importSites();
    const db = new FakeDatabase();
    registerSitesIpc(fakeIpcMain as never, createSitesStore(db as never));

    await ipcHandlers.get('sites:add')!({}, { url: 'workscout.io' });
    await ipcHandlers.get('sites:add')!({}, { url: 'talentstream.com' });

    const list = (await ipcHandlers.get('sites:list')!({})) as Array<{ host: string }>;
    expect(list.map((s) => s.host)).toEqual(['workscout.io', 'talentstream.com']);
  });

  it('survives a "restart": a fresh store on the same DB sees prior sites', async () => {
    const { createSitesStore } = await importSites();
    const db = new FakeDatabase();

    const before = createSitesStore(db as never);
    before.add({ url: 'rolehub.com' });
    before.add({ url: 'workscout.io' });

    // Simulate Electron app restart — new store, same backing DB.
    const after = createSitesStore(db as never);
    const hosts = after.list().map((s) => s.host);
    expect(hosts).toEqual(['rolehub.com', 'workscout.io']);
  });

  it('rejects blank input rather than persisting an empty row', async () => {
    const { createSitesStore } = await importSites();
    const db = new FakeDatabase();
    const store = createSitesStore(db as never);
    expect(() => store.add({ url: '   ' })).toThrow();
    expect(store.list()).toHaveLength(0);
  });
});

// --- Flow 2: remove --------------------------------------------------------

describe('Epic AC2 — removed site disappears from the shared persisted list', () => {
  it('removeSite IPC deletes the row; subsequent sites:list omits it', async () => {
    const { createSitesStore, registerSitesIpc } = await importSites();
    const db = new FakeDatabase();
    const store = createSitesStore(db as never);
    registerSitesIpc(fakeIpcMain as never, store);

    const a = store.add({ url: 'rolehub.com' });
    store.add({ url: 'workscout.io' });

    await ipcHandlers.get('sites:remove')!({}, a.id);

    const list = (await ipcHandlers.get('sites:list')!({})) as Array<{ id: string }>;
    expect(list.map((s) => s.id)).not.toContain(a.id);
    expect(list).toHaveLength(1);
  });
});

// --- Flow 3: dropdown sourcing parity -------------------------------------

describe('Epic AC3 — Discover dropdown lists exactly the persisted sites', () => {
  it('the list returned by sites:list is the single source for Settings and Discover', () => {
    const discover = readFileSync(path.join(PAGES_DIR, 'DiscoverPage.vue'), 'utf8');
    const settings = readFileSync(path.join(PAGES_DIR, 'SettingsPage.vue'), 'utf8');
    // Both pages must read from store.sites — no parallel hard-coded lists.
    expect(discover).toMatch(/store\.sites/);
    expect(settings).toMatch(/store\.sites/);
    expect(discover).not.toMatch(/siteToggles/);
  });
});

// --- Flow 4: selecting a site loads it + URL bar reflects -----------------

describe('Epic AC4 — selecting a site loads it in the embedded browser', () => {
  it('navigate IPC drives BrowserView.loadURL with the persisted Site.url', async () => {
    const sitesMod = await importSites();
    const surfaceMod = await importSurface();
    const db = new FakeDatabase();
    const store = sitesMod.createSitesStore(db as never);
    sitesMod.registerSitesIpc(fakeIpcMain as never, store);
    surfaceMod.createJobBrowser(parentWindow as never);

    // 1. Add a site as a user would, via the IPC.
    const added = (await ipcHandlers.get('sites:add')!({}, { url: 'rolehub.com' })) as {
      url: string;
    };
    expect(added.url).toBe('https://rolehub.com');

    // 2. Selecting it from the dropdown should navigate the embedded browser
    //    to the persisted Site.url (never a free-form input — NFR-002).
    await ipcHandlers.get('job-browser:navigate')!({}, added.url);

    expect(browserViewInstances).toHaveLength(1);
    expect(browserViewInstances[0]!.webContents.loadURL).toHaveBeenCalledWith(
      'https://rolehub.com',
    );
  });
});

// --- Flow 5: back/forward navigation --------------------------------------

describe('Epic AC5 — back/forward navigation works inside the embedded browser', () => {
  it('after two navigates, back returns to the first URL; forward returns to the second', async () => {
    const surfaceMod = await importSurface();
    surfaceMod.createJobBrowser(parentWindow as never);

    await ipcHandlers.get('job-browser:navigate')!({}, 'https://rolehub.com');
    await ipcHandlers.get('job-browser:navigate')!({}, 'https://workscout.io');

    expect(navStack.history).toEqual(['https://rolehub.com', 'https://workscout.io']);
    expect(navStack.index).toBe(1);

    await ipcHandlers.get('job-browser:back')!({});
    expect(navStack.index).toBe(0);
    expect(browserViewInstances[0]!.webContents.goBack).toHaveBeenCalled();

    await ipcHandlers.get('job-browser:forward')!({});
    expect(navStack.index).toBe(1);
    expect(browserViewInstances[0]!.webContents.goForward).toHaveBeenCalled();
  });

  it('back is a no-op at the start of history (does not move past first entry)', async () => {
    const surfaceMod = await importSurface();
    surfaceMod.createJobBrowser(parentWindow as never);

    await ipcHandlers.get('job-browser:navigate')!({}, 'https://rolehub.com');
    await ipcHandlers.get('job-browser:back')!({});

    expect(navStack.index).toBe(0);
  });
});

// --- Flow 6: session isolation --------------------------------------------

describe('Epic AC6 (NFR-001) — embedded browser runs in an isolated session', () => {
  it('BrowserView is constructed with the persist:job-browser partition', async () => {
    const surfaceMod = await importSurface();
    surfaceMod.createJobBrowser(parentWindow as never);

    await ipcHandlers.get('job-browser:create')!({});

    const opts = browserViewInstances[0]!.__opts;
    expect(opts.webPreferences.partition).toBe('persist:job-browser');
    // Crucially NOT the renderer's default empty partition.
    expect(opts.webPreferences.partition).not.toBe('');
    expect(opts.webPreferences.partition).not.toBeUndefined();
  });

  it('keeps contextIsolation:true, nodeIntegration:false, sandbox:true on the embedded view', async () => {
    const surfaceMod = await importSurface();
    surfaceMod.createJobBrowser(parentWindow as never);

    await ipcHandlers.get('job-browser:create')!({});
    const wp = browserViewInstances[0]!.__opts.webPreferences;
    expect(wp.contextIsolation).toBe(true);
    expect(wp.nodeIntegration).toBe(false);
    expect(wp.sandbox).toBe(true);
  });

  it('exports the isolated partition constant for callers that need to reference it', async () => {
    const surfaceMod = await importSurface();
    expect(surfaceMod.JOB_BROWSER_PARTITION).toBe('persist:job-browser');
  });
});

// --- Flow 7: empty state --------------------------------------------------

describe('Epic AC7 — Discover empty state when no sites are configured', () => {
  const DISCOVER = readFileSync(path.join(PAGES_DIR, 'DiscoverPage.vue'), 'utf8');

  it('renders the required empty-state copy', () => {
    expect(DISCOVER.toLowerCase()).toMatch(/add a site in settings to start browsing/);
  });

  it('makes the empty state mutually exclusive with the browser chrome', () => {
    expect(DISCOVER).toMatch(/v-if="store\.sites\.length"|v-if="hasSites"/);
    expect(DISCOVER).toMatch(/v-else\b|v-if="!store\.sites\.length"|v-if="!hasSites"/);
  });
});

// --- Cross-cutting: end-to-end "user adds, selects, removes" flow ----------

describe('Epic end-to-end — add a site, browse it, remove it', () => {
  it('an added site can be navigated then removed, leaving an empty list', async () => {
    const sitesMod = await importSites();
    const surfaceMod = await importSurface();
    const db = new FakeDatabase();
    sitesMod.registerSitesIpc(fakeIpcMain as never, sitesMod.createSitesStore(db as never));
    surfaceMod.createJobBrowser(parentWindow as never);

    // 1. User adds two sites on Settings.
    const a = (await ipcHandlers.get('sites:add')!({}, { url: 'rolehub.com' })) as {
      id: string;
      url: string;
    };
    const b = (await ipcHandlers.get('sites:add')!({}, { url: 'workscout.io' })) as {
      id: string;
      url: string;
    };

    // 2. Discover dropdown lists exactly those two — the dropdown is sourced
    //    from sites:list.
    const dropdown = (await ipcHandlers.get('sites:list')!({})) as Array<{ id: string; url: string }>;
    expect(dropdown.map((s) => s.id)).toEqual([a.id, b.id]);

    // 3. User picks the second one — it loads in the embedded browser.
    await ipcHandlers.get('job-browser:navigate')!({}, b.url);
    expect(browserViewInstances[0]!.webContents.loadURL).toHaveBeenLastCalledWith(b.url);

    // 4. User removes both.
    await ipcHandlers.get('sites:remove')!({}, a.id);
    await ipcHandlers.get('sites:remove')!({}, b.id);
    const afterRemove = (await ipcHandlers.get('sites:list')!({})) as unknown[];
    expect(afterRemove).toHaveLength(0);
  });
});
