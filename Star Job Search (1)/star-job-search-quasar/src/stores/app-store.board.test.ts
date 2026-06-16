/**
 * Unit tests for the EXTR-007 app-store wiring: job board state + actions,
 * extract trigger, progress subscription, and graceful no-op when the
 * preload bridges (starBoard / starExtract) are absent.
 */
import { setActivePinia, createPinia } from 'pinia';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useAppStore } from './app-store';
import type { JobRecord } from 'src/types/models';

interface BoardListFilter {
  status?: string;
  excludeStatus?: string;
}

type ProgressCb = (e: Record<string, unknown>) => void;

function installBridges(opts: {
  board?: {
    list?: (filter?: BoardListFilter) => Promise<JobRecord[]>;
    setStatus?: (input: { sourceId: string; status: string }) => Promise<{ ok: true }>;
    open?: (url: string) => Promise<{ ok: true }>;
  };
  extract?: {
    extract?: () =>
      | Promise<{ ok: true; summary: { imported: number; skipped: number; total: number; pages: number } }>
      | Promise<{ ok: false; error: string }>;
    onProgress?: (cb: ProgressCb) => () => void;
  };
} = {}) {
  const w: Record<string, unknown> = {};
  if (opts.board) w.starBoard = opts.board;
  if (opts.extract) w.starExtract = opts.extract;
  (globalThis as { window?: unknown }).window = w;
  return w;
}

beforeEach(() => {
  setActivePinia(createPinia());
});

afterEach(() => {
  delete (globalThis as { window?: unknown }).window;
});

const SAMPLE_JOB: JobRecord = {
  sourceId: 'j1',
  hostname: 'example.com',
  url: 'https://example.com/jobs/j1',
  title: 'Engineer',
  company: 'Acme',
  location: 'Remote',
  description: null,
  postedAt: null,
  fetchedAt: 1000,
  status: 'new',
};

describe('app-store — listJobs (AC1)', () => {
  it('calls window.starBoard.list with filter and populates store.jobs', async () => {
    const list = vi.fn(async (_f?: BoardListFilter) => [SAMPLE_JOB]);
    installBridges({ board: { list } });
    const store = useAppStore();
    await store.listJobs({ excludeStatus: 'not_interested' });
    expect(list).toHaveBeenCalledWith({ excludeStatus: 'not_interested' });
    expect(store.jobs).toHaveLength(1);
    expect(store.jobs[0]!.sourceId).toBe('j1');
  });

  it('no-ops gracefully when starBoard is absent', async () => {
    (globalThis as { window?: unknown }).window = {};
    const store = useAppStore();
    await expect(store.listJobs()).resolves.toBeUndefined();
    expect(store.jobs).toEqual([]);
  });
});

describe('app-store — setJobStatus (AC1)', () => {
  it('calls starBoard.setStatus and updates the local cache', async () => {
    const setStatus = vi.fn(async (_in: { sourceId: string; status: string }) =>
      ({ ok: true } as const),
    );
    const list = vi.fn(async () => [SAMPLE_JOB]);
    installBridges({ board: { list, setStatus } });
    const store = useAppStore();
    await store.listJobs();
    await store.setJobStatus({ sourceId: 'j1', status: 'seen' });
    expect(setStatus).toHaveBeenCalledWith({ sourceId: 'j1', status: 'seen' });
    expect(store.jobs[0]!.status).toBe('seen');
  });

  it('no-ops gracefully when starBoard is absent', async () => {
    (globalThis as { window?: unknown }).window = {};
    const store = useAppStore();
    await expect(
      store.setJobStatus({ sourceId: 'x', status: 'not_interested' }),
    ).resolves.toBeUndefined();
  });
});

describe('app-store — openJob (AC1)', () => {
  it('calls starBoard.open with the url', async () => {
    const open = vi.fn(async (_u: string) => ({ ok: true } as const));
    installBridges({ board: { open } });
    const store = useAppStore();
    await store.openJob('https://example.com/jobs/j1');
    expect(open).toHaveBeenCalledWith('https://example.com/jobs/j1');
  });

  it('no-ops gracefully when starBoard is absent', async () => {
    (globalThis as { window?: unknown }).window = {};
    const store = useAppStore();
    await expect(store.openJob('https://x')).resolves.toBeUndefined();
  });
});

describe('app-store — triggerExtract (AC1)', () => {
  it('sets isExtracting true during the call and clears extractError on success', async () => {
    let resolveRun: (v: { ok: true; summary: { imported: number; skipped: number; total: number; pages: number } }) => void = () => {};
    const extract = vi.fn(
      () =>
        new Promise<{ ok: true; summary: { imported: number; skipped: number; total: number; pages: number } }>(
          (resolve) => {
            resolveRun = resolve;
          },
        ),
    );
    installBridges({ extract: { extract } });
    const store = useAppStore();

    const p = store.triggerExtract();
    expect(store.isExtracting).toBe(true);
    resolveRun({ ok: true, summary: { imported: 3, skipped: 1, total: 4, pages: 1 } });
    const result = await p;

    expect(extract).toHaveBeenCalledTimes(1);
    expect(store.isExtracting).toBe(false);
    expect(store.extractError).toBeNull();
    expect(result).toEqual({ ok: true, summary: { imported: 3, skipped: 1, total: 4, pages: 1 } });
  });

  it('reflects an error result and clears isExtracting', async () => {
    const extract = vi.fn(async () => ({ ok: false as const, error: 'boom' }));
    installBridges({ extract: { extract } });
    const store = useAppStore();
    const result = await store.triggerExtract();
    expect(store.isExtracting).toBe(false);
    expect(store.extractError).toBe('boom');
    expect(result).toEqual({ ok: false, error: 'boom' });
  });

  it('no-ops gracefully when starExtract is absent', async () => {
    (globalThis as { window?: unknown }).window = {};
    const store = useAppStore();
    const result = await store.triggerExtract();
    expect(result).toBeUndefined();
    expect(store.isExtracting).toBe(false);
  });
});

describe('app-store — extract progress subscription (AC2)', () => {
  it('subscribes via starExtract.onProgress and reflects events in store state', () => {
    let capturedCb: ProgressCb | null = null;
    const unsubscribe = vi.fn();
    const onProgress = vi.fn((cb: ProgressCb) => {
      capturedCb = cb;
      return unsubscribe;
    });
    installBridges({ extract: { onProgress } });
    const store = useAppStore();
    store.subscribeExtractProgress();

    expect(onProgress).toHaveBeenCalledTimes(1);
    expect(capturedCb).not.toBeNull();

    capturedCb!({ phase: 'extract', current: 2, total: 5, sourceId: 'j2' });
    expect(store.extractProgress).not.toBeNull();
    expect(store.extractProgress!.phase).toBe('extract');
    expect(store.extractProgress!.done).toBe(2);
    expect(store.extractProgress!.total).toBe(5);
    expect(store.isExtracting).toBe(true);

    capturedCb!({ phase: 'done', imported: 3, skipped: 1, total: 4, pages: 1 });
    expect(store.isExtracting).toBe(false);
  });

  it('unsubscribeExtractProgress calls the returned cleanup function', () => {
    const unsubscribe = vi.fn();
    const onProgress = vi.fn((_cb: ProgressCb) => unsubscribe);
    installBridges({ extract: { onProgress } });
    const store = useAppStore();
    store.subscribeExtractProgress();
    store.unsubscribeExtractProgress();
    expect(unsubscribe).toHaveBeenCalledTimes(1);
  });

  it('no-ops gracefully when starExtract is absent', () => {
    (globalThis as { window?: unknown }).window = {};
    const store = useAppStore();
    expect(() => store.subscribeExtractProgress()).not.toThrow();
    expect(() => store.unsubscribeExtractProgress()).not.toThrow();
  });
});

describe('renderer-side JobRecord/JobStatus types (AC3)', () => {
  it('JobRecord matches the main-process shape (compile-time check via assignment)', () => {
    const job: JobRecord = { ...SAMPLE_JOB };
    expect(job.sourceId).toBe('j1');
    expect(job.hostname).toBe('example.com');
  });
});
