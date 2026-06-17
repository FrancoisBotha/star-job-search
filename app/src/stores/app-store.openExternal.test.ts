/**
 * Unit tests for the app-store.openExternal action (JOBDET-001 AC4).
 *
 * Covers:
 *  - calls window.starShell.openExternal with the URL when the bridge is present
 *  - no-ops gracefully when the bridge is absent (browser SPA build),
 *    matching the hydrateSites / openJob pattern
 *  - distinct from openJob, which uses the starBoard / view:open bridge
 */
import { setActivePinia, createPinia } from 'pinia';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useAppStore } from './app-store';

beforeEach(() => {
  setActivePinia(createPinia());
});

afterEach(() => {
  delete (globalThis as { window?: unknown }).window;
});

describe('app-store.openExternal (JOBDET-001 AC4)', () => {
  it('calls window.starShell.openExternal with the URL', async () => {
    const openExternal = vi.fn(async (_url: string) => ({ ok: true as const }));
    (globalThis as { window?: unknown }).window = { starShell: { openExternal } };
    const store = useAppStore();
    await store.openExternal('https://example.com/jobs/123');
    expect(openExternal).toHaveBeenCalledWith('https://example.com/jobs/123');
  });

  it('no-ops gracefully when window is undefined (browser SPA build)', async () => {
    const store = useAppStore();
    await expect(store.openExternal('https://example.com/x')).resolves.toBeUndefined();
  });

  it('no-ops gracefully when window.starShell is undefined', async () => {
    (globalThis as { window?: unknown }).window = {};
    const store = useAppStore();
    await expect(store.openExternal('https://example.com/x')).resolves.toBeUndefined();
  });

  it('does NOT call the starBoard bridge (distinct from openJob / view:open)', async () => {
    const openExternal = vi.fn(async () => ({ ok: true as const }));
    const boardOpen = vi.fn(async () => ({ ok: true as const }));
    (globalThis as { window?: unknown }).window = {
      starShell: { openExternal },
      starBoard: { list: vi.fn(), setStatus: vi.fn(), open: boardOpen },
    };
    const store = useAppStore();
    await store.openExternal('https://example.com/jobs/123');
    expect(boardOpen).not.toHaveBeenCalled();
    expect(openExternal).toHaveBeenCalledTimes(1);
  });
});
