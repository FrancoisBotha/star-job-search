/**
 * Unit tests for the extraction IPC runtime (EXTR-006).
 *
 * Covers acceptance criteria:
 *  - AC1: ai:extract reads the current listing URL from the visible Discover
 *         browser, ensures a hidden crawler, setActiveTarget(crawler) for the
 *         run, runs the extractor, and ALWAYS restores the active target to
 *         the visible view in finally.
 *  - AC2: extract:progress events stream during the run; ai:extract returns
 *         { ok: true, summary } or { ok: false, error }.
 *  - AC3: board:list (with status filter), board:setStatus, and view:open
 *         IPC channels are registered and behave per spec.
 *  - AC4: clear error when no API key, no default model, or the model is not
 *         function-calling capable.
 *  - AC5: preload exposes window.starExtract (+ onProgress) and
 *         window.starBoard (list/setStatus/open); env.d.ts declares the
 *         matching Window types.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ELECTRON_DIR = path.resolve(__dirname, '..');
const SRC_DIR = path.resolve(ELECTRON_DIR, '..', 'src');

vi.mock('better-sqlite3', () => ({ default: class {} }));

// --- Fakes ----------------------------------------------------------------

const ipcHandlers = new Map<string, (...args: unknown[]) => unknown>();
const fakeIpcMain = {
  handle: (channel: string, fn: (...args: unknown[]) => unknown) => {
    ipcHandlers.set(channel, fn);
  },
  removeHandler: (channel: string) => {
    ipcHandlers.delete(channel);
  },
};

interface FakeStore {
  listJobs: ReturnType<typeof vi.fn>;
  setStatus: ReturnType<typeof vi.fn>;
  knownSourceIds?: () => Set<string>;
  upsertJobs?: () => number;
  getSiteProfile?: () => undefined;
  saveSiteProfile?: () => void;
}

function makeStore(): FakeStore {
  return {
    listJobs: vi.fn(() => [{ sourceId: 's1', status: 'new' }]),
    setStatus: vi.fn(),
  };
}

beforeEach(() => {
  ipcHandlers.clear();
});

afterEach(() => {
  vi.resetModules();
});

async function importModule() {
  return await import('../extraction');
}

interface ActiveTargetLog {
  setCalls: Array<unknown>;
}

function makeDeps(overrides: Partial<{
  visibleUrl: string;
  apiKey: string | null;
  model: string | null;
  buildExtractorImpl: (input: unknown) => Promise<{ run: (i: unknown) => Promise<unknown> }>;
  ensureCrawler: () => Promise<unknown>;
  visibleNavigate: (url: string) => Promise<void>;
  store: FakeStore;
}> = {}) {
  const store = overrides.store ?? makeStore();
  const visibleWebContents = {
    getURL: () => overrides.visibleUrl ?? 'https://example.com/jobs?q=swe',
  };
  const crawler = overrides.ensureCrawler
    ? undefined
    : { __crawler: true };
  const setCalls: unknown[] = [];
  const progress: unknown[] = [];
  const deps = {
    store: store as unknown,
    getVisibleTarget: () => (overrides.visibleUrl === '__missing__' ? undefined : visibleWebContents),
    setActiveTarget: (wc: unknown) => {
      setCalls.push(wc);
    },
    ensureCrawler: overrides.ensureCrawler ?? (async () => crawler),
    visibleNavigate: overrides.visibleNavigate ?? vi.fn(async (_url: string) => {}),
    getApiKey: () => (overrides.apiKey === undefined ? 'sk-or-xxxxx' : overrides.apiKey),
    getDefaultModel: () =>
      overrides.model === undefined ? 'anthropic/claude-3.5-sonnet' : overrides.model,
    buildExtractor:
      overrides.buildExtractorImpl ??
      (async () => ({
        run: async () => ({ imported: 3, skipped: 1, total: 4, pages: 1 }),
      })),
    emitProgress: (e: unknown) => {
      progress.push(e);
    },
  };
  return { deps, setCalls, progress, crawler, visibleWebContents, store };
}

// --- Tests ----------------------------------------------------------------

describe('registerExtractionIpc — channel registration (AC3, AC5)', () => {
  it('registers ai:extract, board:list, board:setStatus, view:open', async () => {
    const { registerExtractionIpc } = await importModule();
    const { deps } = makeDeps();
    registerExtractionIpc(fakeIpcMain as never, deps as never);
    for (const ch of ['ai:extract', 'board:list', 'board:setStatus', 'view:open']) {
      expect(ipcHandlers.has(ch), `missing handler ${ch}`).toBe(true);
    }
  });
});

describe('ai:extract — happy path (AC1, AC2)', () => {
  it('switches active target to the crawler, runs, returns { ok, summary }, and restores in finally', async () => {
    const { registerExtractionIpc } = await importModule();
    const buildSpy = vi.fn(async (_input: unknown) => ({
      run: async () => ({ imported: 5, skipped: 2, total: 7, pages: 3 }),
    }));
    const { deps, setCalls, crawler } = makeDeps({ buildExtractorImpl: buildSpy });
    registerExtractionIpc(fakeIpcMain as never, deps as never);

    const handler = ipcHandlers.get('ai:extract')!;
    const result = (await handler({})) as { ok: boolean; summary?: unknown };
    expect(result.ok).toBe(true);
    expect(result.summary).toEqual({ imported: 5, skipped: 2, total: 7, pages: 3 });

    // First setActiveTarget gets the crawler; the final one restores the visible
    // view (passes undefined so getActiveTarget() falls back to the default).
    expect(setCalls.length).toBeGreaterThanOrEqual(2);
    expect(setCalls[0]).toBe(crawler);
    expect(setCalls[setCalls.length - 1]).toBe(undefined);

    expect(buildSpy).toHaveBeenCalledTimes(1);
    const arg = (buildSpy.mock.calls[0]![0] ?? {}) as {
      apiKey: string;
      model: string;
      crawler: unknown;
    };
    expect(arg.apiKey).toBe('sk-or-xxxxx');
    expect(arg.model).toBe('anthropic/claude-3.5-sonnet');
    expect(arg.crawler).toBe(crawler);
  });

  it('streams extract:progress events via emitProgress while the run executes', async () => {
    const { registerExtractionIpc } = await importModule();
    const events = [
      { phase: 'discover', hostname: 'example.com', cached: false },
      { phase: 'done', imported: 1, skipped: 0, total: 1, pages: 1 },
    ];
    const buildSpy = async (input: unknown) => {
      const i = input as { onProgress: (e: unknown) => void };
      return {
        run: async () => {
          for (const e of events) i.onProgress(e);
          return { imported: 1, skipped: 0, total: 1, pages: 1 };
        },
      };
    };
    const { deps, progress } = makeDeps({ buildExtractorImpl: buildSpy });
    registerExtractionIpc(fakeIpcMain as never, deps as never);
    await ipcHandlers.get('ai:extract')!({});
    expect(progress).toEqual(events);
  });
});

describe('ai:extract — error paths (AC1, AC2, AC4)', () => {
  it('restores the active target even when the extractor throws', async () => {
    const { registerExtractionIpc } = await importModule();
    const buildSpy = async () => ({
      run: async () => {
        throw new Error('boom');
      },
    });
    const { deps, setCalls, crawler } = makeDeps({ buildExtractorImpl: buildSpy });
    registerExtractionIpc(fakeIpcMain as never, deps as never);
    const result = (await ipcHandlers.get('ai:extract')!({})) as {
      ok: boolean;
      error?: string;
    };
    expect(result.ok).toBe(false);
    expect(result.error).toBe('boom');
    expect(setCalls[0]).toBe(crawler);
    expect(setCalls[setCalls.length - 1]).toBe(undefined);
  });

  it('returns a clear error when no API key is configured (AC4)', async () => {
    const { registerExtractionIpc } = await importModule();
    const { deps } = makeDeps({ apiKey: null });
    registerExtractionIpc(fakeIpcMain as never, deps as never);
    const result = (await ipcHandlers.get('ai:extract')!({})) as { ok: boolean; error?: string };
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/OpenRouter API key/i);
  });

  it('returns a clear error when no default model is configured (AC4)', async () => {
    const { registerExtractionIpc } = await importModule();
    const { deps } = makeDeps({ model: null });
    registerExtractionIpc(fakeIpcMain as never, deps as never);
    const result = (await ipcHandlers.get('ai:extract')!({})) as { ok: boolean; error?: string };
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/default model/i);
  });

  it('maps a function-calling rejection into a clear renderer-facing message (AC4)', async () => {
    const { registerExtractionIpc } = await importModule();
    const { deps } = makeDeps({
      buildExtractorImpl: async () => ({
        run: async () => {
          throw new Error('This model does not support tools / function calling');
        },
      }),
    });
    registerExtractionIpc(fakeIpcMain as never, deps as never);
    const result = (await ipcHandlers.get('ai:extract')!({})) as { ok: boolean; error?: string };
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/function calling/i);
    expect(result.error).toMatch(/Preferred models/i);
  });

  it('returns a clear error when the visible browser has not loaded a listing URL', async () => {
    const { registerExtractionIpc } = await importModule();
    const { deps } = makeDeps({ visibleUrl: '' });
    registerExtractionIpc(fakeIpcMain as never, deps as never);
    const result = (await ipcHandlers.get('ai:extract')!({})) as { ok: boolean; error?: string };
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/Discover/i);
  });
});

describe('board:list / board:setStatus / view:open (AC3)', () => {
  it('board:list passes the status filter through to the store', async () => {
    const { registerExtractionIpc } = await importModule();
    const { deps, store } = makeDeps();
    registerExtractionIpc(fakeIpcMain as never, deps as never);
    const rows = (await ipcHandlers.get('board:list')!({}, { status: 'saved' })) as unknown[];
    expect(rows).toEqual([{ sourceId: 's1', status: 'new' }]);
    expect(store.listJobs).toHaveBeenCalledWith({ status: 'saved' });
  });

  it('board:setStatus updates the store and returns { ok: true }', async () => {
    const { registerExtractionIpc } = await importModule();
    const { deps, store } = makeDeps();
    registerExtractionIpc(fakeIpcMain as never, deps as never);
    const result = (await ipcHandlers.get('board:setStatus')!({}, {
      sourceId: 'abc',
      status: 'applied',
    })) as { ok: boolean };
    expect(result).toEqual({ ok: true });
    expect(store.setStatus).toHaveBeenCalledWith('abc', 'applied');
  });

  it('view:open navigates the visible Discover browser', async () => {
    const { registerExtractionIpc } = await importModule();
    const navigate = vi.fn(async (_url: string) => {});
    const { deps } = makeDeps({ visibleNavigate: navigate });
    registerExtractionIpc(fakeIpcMain as never, deps as never);
    await ipcHandlers.get('view:open')!({}, 'https://example.com/jobs/123');
    expect(navigate).toHaveBeenCalledWith('https://example.com/jobs/123');
  });
});

describe('preload + env.d.ts (AC5)', () => {
  it('preload registers starExtract (extract + onProgress) and starBoard (list/setStatus/open)', () => {
    const preload = readFileSync(
      path.join(ELECTRON_DIR, 'electron-preload.ts'),
      'utf8',
    );
    expect(preload).toMatch(/exposeInMainWorld\(\s*['"]starExtract['"]/);
    expect(preload).toMatch(/['"]ai:extract['"]/);
    expect(preload).toMatch(/['"]extract:progress['"]/);
    expect(preload).toMatch(/exposeInMainWorld\(\s*['"]starBoard['"]/);
    expect(preload).toMatch(/['"]board:list['"]/);
    expect(preload).toMatch(/['"]board:setStatus['"]/);
    expect(preload).toMatch(/['"]view:open['"]/);
  });

  it('env.d.ts declares Window.starExtract and Window.starBoard with the right shapes', () => {
    const env = readFileSync(path.join(SRC_DIR, 'env.d.ts'), 'utf8');
    expect(env).toMatch(/starExtract\??:/);
    expect(env).toMatch(/starBoard\??:/);
    expect(env).toMatch(/onProgress/);
    expect(env).toMatch(/setStatus/);
  });
});
