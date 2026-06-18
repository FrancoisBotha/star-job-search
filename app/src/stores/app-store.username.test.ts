/**
 * Unit tests for the app-store `setSiteUsername` action (SITEUSR-001 AC4).
 *
 * Covers:
 *  - The action calls window.starSites.setUsername(id, username)
 *  - The action mirrors the value into local state.sites
 */
import { setActivePinia, createPinia } from 'pinia';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useAppStore } from './app-store';

interface FakeSite {
  id: string;
  url: string;
  host: string;
  label: string;
  enabled: boolean;
  addedAt: number;
  username: string | null;
}

function installStarSites(initial: FakeSite[]) {
  const rows: FakeSite[] = [...initial];
  const bridge = {
    list: vi.fn(async () => rows.map((r) => ({ ...r }))),
    add: vi.fn(),
    remove: vi.fn(),
    setEnabled: vi.fn(),
    setUsername: vi.fn(async (id: string, username: string) => {
      const row = rows.find((r) => r.id === id);
      if (row) row.username = username;
    }),
  };
  (globalThis as { window?: unknown }).window = { starSites: bridge };
  return { bridge, rows };
}

beforeEach(() => {
  setActivePinia(createPinia());
});

afterEach(() => {
  delete (globalThis as { window?: unknown }).window;
});

describe('app-store.setSiteUsername (SITEUSR-001 AC4)', () => {
  it('calls window.starSites.setUsername and mirrors the value into state.sites', async () => {
    const { bridge } = installStarSites([
      {
        id: 'a',
        url: 'https://rolehub.com',
        host: 'rolehub.com',
        label: 'rolehub.com',
        enabled: true,
        addedAt: 1,
        username: null,
      },
    ]);
    const store = useAppStore();
    await store.hydrateSites();
    await store.setSiteUsername('a', 'francois');

    expect(bridge.setUsername).toHaveBeenCalledWith('a', 'francois');
    expect(store.sites[0]!.username).toBe('francois');
  });

  it('no-ops gracefully when the bridge is absent (browser SPA build)', async () => {
    const store = useAppStore();
    store.sites = [
      {
        id: 'a',
        url: 'https://rolehub.com',
        host: 'rolehub.com',
        label: 'rolehub.com',
        enabled: true,
        addedAt: 1,
        username: null,
      } as never,
    ];
    await expect(store.setSiteUsername('a', 'francois')).resolves.toBeUndefined();
  });
});
