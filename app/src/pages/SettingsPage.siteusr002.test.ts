/**
 * Unit tests for SITEUSR-002 — per-site username input on the Settings
 * Job-sites list.
 *
 * Acceptance criteria:
 *  AC1: Each row in the Settings Job-sites list shows an editable free-text
 *       username field alongside the existing host / enabled / remove
 *       controls.
 *  AC2: Entering a username and saving calls `store.setSiteUsername` and the
 *       saved value is shown next to that site.
 *  AC3: The field is optional — a site with no username renders an empty /
 *       placeholder input and saves nothing harmful.
 *  AC4: The saved username re-appears after navigating away and back, and
 *       after an app restart (via `hydrateSites`).
 *
 * Mirrors the regex-scan precedent of SettingsPage.llm005 / llm006 tests,
 * plus a pinia store-level round-trip for the hydrate path (AC4).
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { setActivePinia, createPinia } from 'pinia';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useAppStore } from '../stores/app-store';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SETTINGS = readFileSync(path.join(__dirname, 'SettingsPage.vue'), 'utf8');

describe('SettingsPage — per-site username input (AC1)', () => {
  it('renders a q-input bound to the site.username on each row', () => {
    // The row should expose the username via a q-input whose model reflects
    // the persisted value (with a null-safe fallback to '').
    expect(SETTINGS).toMatch(/site\.username/);
    // The input must live alongside the existing host / toggle / remove
    // controls — i.e. inside the v-for over store.sites.
    expect(SETTINGS).toMatch(/v-for="site in store\.sites"/);
  });

  it('persists edits via store.setSiteUsername(site.id, …)', () => {
    expect(SETTINGS).toMatch(/store\.setSiteUsername\(/);
  });
});

describe('SettingsPage — optional field (AC3)', () => {
  it('renders a placeholder for the username input', () => {
    // The placeholder text confirms the field is optional / free-text.
    expect(SETTINGS).toMatch(/placeholder="[^"]*username[^"]*"/i);
  });
});

describe('SettingsPage — restart hydration (AC4)', () => {
  it('calls store.hydrateSites() on mount', () => {
    expect(SETTINGS).toMatch(/hydrateSites\(\)/);
  });
});

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
  const rows: FakeSite[] = initial.map((r) => ({ ...r }));
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

describe('app-store — site username persists across hydrate (AC4)', () => {
  it('round-trips a username: setSiteUsername → list → username present on hydrate', async () => {
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

    // Simulate "navigate away and back" — re-hydrate, expect the value to
    // re-appear in store.sites because the fake bridge persisted it.
    store.sites = [];
    await store.hydrateSites();
    expect(store.sites[0]!.username).toBe('francois');
  });
});
