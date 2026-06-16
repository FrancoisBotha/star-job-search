/**
 * Unit tests for the embedded job-browser surface (BRWSR-001).
 *
 * The module under test wires Electron `BrowserView` + IPC into a controller
 * with create / navigate / back / forward / show / set-bounds channels and
 * runs the surface in a session isolated from the app renderer.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ELECTRON_DIR = path.resolve(__dirname, '..');

// --- Mock electron --------------------------------------------------------

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
  __opts: unknown;
}

const browserViewInstances: FakeBrowserView[] = [];
const ipcHandlers = new Map<string, (...args: unknown[]) => unknown>();

const parentWindow = {
  addBrowserView: vi.fn(),
  removeBrowserView: vi.fn(),
  getBrowserViews: vi.fn(() => [] as FakeBrowserView[]),
};

vi.mock('electron', () => {
  class BrowserView {
    webContents: FakeWebContents;
    setBounds = vi.fn();
    setAutoResize = vi.fn();
    __opts: unknown;
    constructor(opts: unknown) {
      this.__opts = opts;
      this.webContents = {
        loadURL: vi.fn(() => Promise.resolve()),
        goBack: vi.fn(),
        goForward: vi.fn(),
        canGoBack: vi.fn(() => true),
        canGoForward: vi.fn(() => true),
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

beforeEach(() => {
  browserViewInstances.length = 0;
  ipcHandlers.clear();
  parentWindow.addBrowserView.mockClear();
  parentWindow.removeBrowserView.mockClear();
});

afterEach(() => {
  vi.resetModules();
});

async function importModule() {
  return await import('../browser-surface');
}

// --- Tests ----------------------------------------------------------------

describe('createJobBrowser — embedded browser surface', () => {
  it('AC1: navigate channel loads an external URL into the embedded view', async () => {
    const mod = await importModule();
    mod.createJobBrowser(parentWindow as never);

    const navigate = ipcHandlers.get('job-browser:navigate');
    expect(navigate).toBeTypeOf('function');
    await navigate!({}, 'https://example.com/jobs');

    expect(browserViewInstances).toHaveLength(1);
    expect(browserViewInstances[0]!.webContents.loadURL).toHaveBeenCalledWith(
      'https://example.com/jobs',
    );
  });

  it('AC2: BrowserView uses a partitioned session isolated from the app renderer', async () => {
    const mod = await importModule();
    mod.createJobBrowser(parentWindow as never);

    await ipcHandlers.get('job-browser:create')!({});

    expect(mod.JOB_BROWSER_PARTITION).toBe('persist:job-browser');
    const opts = browserViewInstances[0]!.__opts as { webPreferences: { partition: string } };
    expect(opts.webPreferences.partition).toBe('persist:job-browser');
    // The partition must NOT be the renderer's default session.
    expect(opts.webPreferences.partition).not.toBe('');
  });

  it('AC3 (NFR-001): app renderer keeps contextIsolation:true and nodeIntegration:false', () => {
    const main = readFileSync(path.join(ELECTRON_DIR, 'electron-main.ts'), 'utf8');
    expect(main).toMatch(/contextIsolation:\s*true/);
    // nodeIntegration defaults to false; ensure we never flipped it on.
    expect(main).not.toMatch(/nodeIntegration:\s*true/);
    // The embedded BrowserView must also keep these flags.
    const surface = readFileSync(path.join(ELECTRON_DIR, 'browser-surface.ts'), 'utf8');
    expect(surface).toMatch(/contextIsolation:\s*true/);
    expect(surface).toMatch(/nodeIntegration:\s*false/);
  });

  it('AC4: preload-bridge channels exist for create, navigate, back, forward, show, set-bounds', async () => {
    const mod = await importModule();
    mod.createJobBrowser(parentWindow as never);

    for (const channel of [
      'job-browser:create',
      'job-browser:navigate',
      'job-browser:back',
      'job-browser:forward',
      'job-browser:show',
      'job-browser:set-bounds',
    ]) {
      expect(ipcHandlers.has(channel), `missing handler for ${channel}`).toBe(true);
    }
  });

  it('AC4: back/forward/show/set-bounds drive the underlying webContents/view', async () => {
    const mod = await importModule();
    mod.createJobBrowser(parentWindow as never);

    await ipcHandlers.get('job-browser:create')!({});
    const view = browserViewInstances[0]!;

    await ipcHandlers.get('job-browser:back')!({});
    expect(view.webContents.goBack).toHaveBeenCalled();

    await ipcHandlers.get('job-browser:forward')!({});
    expect(view.webContents.goForward).toHaveBeenCalled();

    await ipcHandlers.get('job-browser:show')!({}, true);
    expect(parentWindow.addBrowserView).toHaveBeenCalledWith(view);

    await ipcHandlers.get('job-browser:show')!({}, false);
    expect(parentWindow.removeBrowserView).toHaveBeenCalledWith(view);

    await ipcHandlers.get('job-browser:set-bounds')!({}, {
      x: 10, y: 20, width: 800, height: 600,
    });
    expect(view.setBounds).toHaveBeenCalledWith({ x: 10, y: 20, width: 800, height: 600 });
  });

  it('AC5: preload extends the starWindow bridge with a starBrowser bridge via contextBridge', () => {
    const preload = readFileSync(path.join(ELECTRON_DIR, 'electron-preload.ts'), 'utf8');
    // The existing starWindow bridge must still be present.
    expect(preload).toMatch(/exposeInMainWorld\(\s*['"]starWindow['"]/);
    // A new starBrowser bridge must also be exposed.
    expect(preload).toMatch(/exposeInMainWorld\(\s*['"]starBrowser['"]/);
    // The starBrowser bridge must call invoke with the embedded-browser channels.
    for (const channel of [
      'job-browser:create',
      'job-browser:navigate',
      'job-browser:back',
      'job-browser:forward',
      'job-browser:show',
      'job-browser:set-bounds',
    ]) {
      expect(preload, `preload missing channel ${channel}`).toContain(channel);
    }
  });

  it('AC6 (NFR-003): navigate returns a promise so the main UI thread is not blocked', async () => {
    const mod = await importModule();
    mod.createJobBrowser(parentWindow as never);

    const result = ipcHandlers.get('job-browser:navigate')!({}, 'https://example.com');
    // Must be thenable — loadURL is async; the handler must not synchronously wait.
    expect(typeof (result as Promise<unknown>).then).toBe('function');
    await result;
  });

  it('AC7: no scraping / extraction / scheduling code is introduced', () => {
    const surface = readFileSync(path.join(ELECTRON_DIR, 'browser-surface.ts'), 'utf8');
    const preload = readFileSync(path.join(ELECTRON_DIR, 'electron-preload.ts'), 'utf8');
    const forbidden = [
      /executeJavaScript/i,
      /insertCSS/i,
      /scrape/i,
      /extract(?!or)/i,
      /setInterval/,
      /cron/i,
      /schedule/i,
    ];
    for (const pat of forbidden) {
      expect(surface, `browser-surface.ts contains forbidden pattern ${pat}`).not.toMatch(pat);
      expect(preload, `electron-preload.ts contains forbidden pattern ${pat}`).not.toMatch(pat);
    }
  });
});
