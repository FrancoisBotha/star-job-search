/**
 * EXTR-018 — Store handles terminal extract-stop events (gated / unsupported).
 *
 * AC3: when the extractor emits a terminal `error` event of kind 'gated' or
 * 'unsupported', the store clears `isExtracting` and exposes a clear,
 * actionable message via `extractError` — distinct from the
 * 'No job listings found' empty state shown for an ok-but-empty run.
 * AC4: a subsequent triggerExtract() runs cleanly with extractError reset.
 */
import { setActivePinia, createPinia } from 'pinia';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useAppStore } from './app-store';

type ProgressCb = (e: Record<string, unknown>) => void;

const GATED_MESSAGE =
  "This board needs login or isn't supported for automated scanning — try a public board like Seek or Indeed.";

function installExtractBridge(opts: {
  onProgress?: (cb: ProgressCb) => () => void;
  extract?: () => Promise<{ ok: true; summary: { imported: number; skipped: number; total: number; pages: number } } | { ok: false; error: string }>;
}) {
  const w: Record<string, unknown> = { starExtract: opts };
  (globalThis as { window?: unknown }).window = w;
}

beforeEach(() => setActivePinia(createPinia()));
afterEach(() => delete (globalThis as { window?: unknown }).window);

describe('EXTR-018 — terminal stop events in store', () => {
  it('sets a clear gated/unsupported message and clears isExtracting on error kind=gated', () => {
    let cb: ProgressCb = () => {};
    installExtractBridge({ onProgress: (fn) => { cb = fn; return () => {}; } });
    const store = useAppStore();
    store.subscribeExtractProgress();

    cb({ phase: 'discover', hostname: 'gated.example.com', cached: false });
    expect(store.isExtracting).toBe(true);

    cb({
      phase: 'error',
      kind: 'gated',
      message: 'login wall detected',
      imported: 0,
      skipped: 0,
      total: 0,
      pages: 1,
    });

    expect(store.isExtracting).toBe(false);
    expect(store.extractError).toBe(GATED_MESSAGE);
  });

  it('sets the same actionable message for error kind=unsupported (un-learnable board)', () => {
    let cb: ProgressCb = () => {};
    installExtractBridge({ onProgress: (fn) => { cb = fn; return () => {}; } });
    const store = useAppStore();
    store.subscribeExtractProgress();

    cb({
      phase: 'error',
      kind: 'unsupported',
      message: 'could not learn selectors',
      imported: 0,
      skipped: 0,
      total: 0,
      pages: 1,
    });

    expect(store.isExtracting).toBe(false);
    expect(store.extractError).toBe(GATED_MESSAGE);
  });

  it('AC4: a subsequent triggerExtract clears extractError so the run starts cleanly', async () => {
    let cb: ProgressCb = () => {};
    const extract = vi.fn(async () => ({
      ok: true as const,
      summary: { imported: 0, skipped: 0, total: 0, pages: 1 },
    }));
    installExtractBridge({ onProgress: (fn) => { cb = fn; return () => {}; }, extract });
    const store = useAppStore();
    store.subscribeExtractProgress();

    // First run ends gated.
    cb({ phase: 'error', kind: 'gated', message: 'x', imported: 0, skipped: 0, total: 0, pages: 1 });
    expect(store.extractError).toBe(GATED_MESSAGE);
    expect(store.isExtracting).toBe(false);

    // Second run starts cleanly.
    const p = store.triggerExtract();
    expect(store.isExtracting).toBe(true);
    expect(store.extractError).toBeNull();
    await p;
    expect(store.isExtracting).toBe(false);
  });
});
