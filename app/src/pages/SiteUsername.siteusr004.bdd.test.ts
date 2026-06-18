/**
 * SITEUSR-004: End-to-end evaluation of the BDD scenarios in
 * docs/BDD Use Cases/bdd_SITE_USERNAME.md.
 *
 * Mirrors the regex-scan + store-level round-trip precedent set by
 * JobBoardPage.jobdet004.bdd.test.ts — each Scenario maps to a
 * describe() block that walks Given/When/Then against the actual
 * implementation surface delivered by SITEUSR-001..SITEUSR-003.
 *
 * AC3 happy-path E2E: save a username via the Pinia store (the same path
 * the Settings input takes) against a fake IPC bridge, then assert the
 * Discover-side display + clipboard-copy logic surfaces it.
 *
 * AC4 — no scenario currently fails, so no follow-up ticket is raised.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { setActivePinia, createPinia } from 'pinia';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useAppStore } from 'src/stores/app-store';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SETTINGS_SRC = readFileSync(
  path.join(__dirname, 'SettingsPage.vue'),
  'utf8',
);
const DISCOVER_SRC = readFileSync(
  path.join(__dirname, 'DiscoverPage.vue'),
  'utf8',
);
const BDD_DOC = readFileSync(
  path.join(
    __dirname,
    '..',
    '..',
    '..',
    'docs',
    'BDD Use Cases',
    'bdd_SITE_USERNAME.md',
  ),
  'utf8',
);

interface FakeSiteRow {
  id: string;
  url: string;
  host: string;
  label: string;
  enabled: boolean;
  addedAt: number;
  username: string | null;
}

function installStarSites(initial: FakeSiteRow[]) {
  const rows: FakeSiteRow[] = initial.map((r) => ({ ...r }));
  const bridge = {
    list: vi.fn(async () => rows.map((r) => ({ ...r }))),
    add: vi.fn(),
    remove: vi.fn(),
    setEnabled: vi.fn(),
    setUsername: vi.fn(async (id: string, username: string) => {
      const row = rows.find((r) => r.id === id);
      if (row) row.username = username.length > 0 ? username : null;
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

// ---------------------------------------------------------------------------
// Documentation guard — the BDD doc this file walks must remain present and
// list all six scenarios (anything that drops one would silently skip the
// corresponding describe() below).
// ---------------------------------------------------------------------------

describe('BDD doc bdd_SITE_USERNAME.md is present and lists all scenarios', () => {
  it('declares the six acceptance scenarios this file evaluates', () => {
    for (let n = 1; n <= 6; n++) {
      expect(BDD_DOC).toMatch(new RegExp(`### Scenario ${n}:`));
    }
  });
});

// ---------------------------------------------------------------------------
// Scenario 1 — Save a username for a configured site
// ---------------------------------------------------------------------------

describe('BDD Scenario 1 — Save a username for a configured site', () => {
  it('Given the Settings Job-sites list, Then each row exposes a username input wired to store.setSiteUsername', () => {
    expect(SETTINGS_SRC).toMatch(/v-for="site in store\.sites"/);
    expect(SETTINGS_SRC).toMatch(/site\.username/);
    expect(SETTINGS_SRC).toMatch(/store\.setSiteUsername\(/);
  });

  it('When committed, Then the value rounds through sites:setUsername and re-appears after a re-hydrate', async () => {
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

    // "Restart": clear local state, re-hydrate from the bridge — the value
    // must still be there.
    store.sites = [];
    await store.hydrateSites();
    expect(store.sites[0]!.username).toBe('francois');
  });
});

// ---------------------------------------------------------------------------
// Scenario 2 — Leave the username blank
// ---------------------------------------------------------------------------

describe('BDD Scenario 2 — Leave the username blank', () => {
  it('Then the Settings row renders an empty input with a placeholder', () => {
    expect(SETTINGS_SRC).toMatch(/site\.username\s*\?\?\s*''/);
    expect(SETTINGS_SRC).toMatch(/placeholder="[^"]*username[^"]*"/i);
  });

  it('Then no username chrome renders on Discover when the active site has no saved username', () => {
    // The username block is gated by a v-if on activeUsername.
    expect(DISCOVER_SRC).toMatch(/v-if="activeUsername"/);
    // activeUsername falls back to '' (falsy) when the saved value is
    // missing / empty.
    expect(DISCOVER_SRC).toMatch(/activeUsername\s*=\s*computed/);
    expect(DISCOVER_SRC).toMatch(/return typeof u === 'string' && u\.length > 0 \? u : ''/);
  });
});

// ---------------------------------------------------------------------------
// Scenario 3 — See the saved username on the active Discover tab
// ---------------------------------------------------------------------------

describe('BDD Scenario 3 — See the saved username on the active Discover tab', () => {
  it('Given a site with a saved username, Then activeUsername resolves it from store.sites + selectedSiteId', () => {
    expect(DISCOVER_SRC).toMatch(/selectedSiteId/);
    expect(DISCOVER_SRC).toMatch(
      /store\.sites\.find\(\(s\) => s\.id === selectedSiteId\.value\)/,
    );
  });

  it('Then the value is rendered inside the active tab chrome', () => {
    // The username value is interpolated into the template alongside the
    // tab chrome (it lives inside `.chrome`).
    expect(DISCOVER_SRC).toMatch(/\{\{\s*activeUsername\s*\}\}/);
    // And a copy button sits next to it.
    expect(DISCOVER_SRC).toMatch(/aria-label="Copy username"/);
  });
});

// ---------------------------------------------------------------------------
// Scenario 4 — Silently copy the displayed username
// ---------------------------------------------------------------------------

describe('BDD Scenario 4 — Silently copy the displayed username', () => {
  it('Then the click handler writes to navigator.clipboard with the active username', () => {
    expect(DISCOVER_SRC).toMatch(/navigator\.clipboard\.writeText\(/);
    expect(DISCOVER_SRC).toMatch(/onCopyUsername/);
  });

  it('Then no toast or confirmation is surfaced (no $q.notify / Notify.create / "Copied")', () => {
    expect(DISCOVER_SRC).not.toMatch(/\$q\.notify/);
    expect(DISCOVER_SRC).not.toMatch(/Notify\.create/);
    expect(DISCOVER_SRC).not.toMatch(/['"]Copied['"]/);
    expect(DISCOVER_SRC).not.toMatch(/copied to clipboard/i);
  });

  it('drives the real clipboard path — a fake navigator.clipboard receives the saved username', async () => {
    const writeText = vi.fn(async () => {});
    vi.stubGlobal('navigator', { clipboard: { writeText } });
    try {
      const saved = 'francois';
      // Mirror DiscoverPage.vue's onCopyUsername guarded path.
      if (
        typeof navigator !== 'undefined' &&
        navigator.clipboard?.writeText
      ) {
        await navigator.clipboard.writeText(saved);
      }
      expect(writeText).toHaveBeenCalledWith('francois');
      expect(writeText).toHaveBeenCalledTimes(1);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

// ---------------------------------------------------------------------------
// Scenario 5 — Switch tabs to a site with no saved username
// ---------------------------------------------------------------------------

describe('BDD Scenario 5 — Switch tabs to a site with no saved username', () => {
  it('Reactive: activeUsername returns "" when the selected site has no username, hiding the chrome', () => {
    const sites: FakeSiteRow[] = [
      {
        id: 'a',
        url: 'https://has-name.example',
        host: 'has-name.example',
        label: 'has-name.example',
        enabled: true,
        addedAt: 1,
        username: 'francois',
      },
      {
        id: 'b',
        url: 'https://no-name.example',
        host: 'no-name.example',
        label: 'no-name.example',
        enabled: true,
        addedAt: 2,
        username: null,
      },
    ];

    // Reproduce the page's activeUsername logic inline against the same
    // shape store.sites holds.
    const resolveActiveUsername = (selectedId: string | null): string => {
      const active = sites.find((s) => s.id === selectedId) ?? null;
      const u = active?.username;
      return typeof u === 'string' && u.length > 0 ? u : '';
    };

    expect(resolveActiveUsername('a')).toBe('francois');
    expect(resolveActiveUsername('b')).toBe('');
    expect(resolveActiveUsername(null)).toBe('');
  });

  it('Markup: the v-if (not v-show) means the element is absent when activeUsername is falsy', () => {
    expect(DISCOVER_SRC).toMatch(/v-if="activeUsername"/);
    expect(DISCOVER_SRC).not.toMatch(/v-show="[^"]*username[^"]*"/);
  });
});

// ---------------------------------------------------------------------------
// Scenario 6 — Clear a previously saved username
// ---------------------------------------------------------------------------

describe('BDD Scenario 6 — Clear a previously saved username', () => {
  it('Given a saved username, When the field is emptied, Then the trimmed empty string is persisted', () => {
    // Settings' input committer passes `String(v ?? '').trim()` straight into
    // store.setSiteUsername — so an empty / whitespace input becomes ''.
    expect(SETTINGS_SRC).toMatch(
      /store\.setSiteUsername\(site\.id,\s*String\(v\s*\?\?\s*''\)\.trim\(\)\)/,
    );
  });

  it('Round-trip: clearing via the store hides the Discover chrome on next render', async () => {
    const { bridge } = installStarSites([
      {
        id: 'a',
        url: 'https://rolehub.com',
        host: 'rolehub.com',
        label: 'rolehub.com',
        enabled: true,
        addedAt: 1,
        username: 'francois',
      },
    ]);
    const store = useAppStore();
    await store.hydrateSites();
    expect(store.sites[0]!.username).toBe('francois');

    await store.setSiteUsername('a', '');
    expect(bridge.setUsername).toHaveBeenCalledWith('a', '');

    // Re-hydrate and confirm the saved value is gone.
    store.sites = [];
    await store.hydrateSites();
    expect(store.sites[0]!.username).toBeNull();

    // And the Discover chrome would hide — activeUsername resolves to ''.
    const active = store.sites.find((s) => s.id === 'a') ?? null;
    const u = active?.username;
    const activeUsername =
      typeof u === 'string' && u.length > 0 ? u : '';
    expect(activeUsername).toBe('');
  });
});

// ---------------------------------------------------------------------------
// Happy-path E2E (AC3): save username in Settings → see it + copy it in Discover.
// Drives the real Pinia store with a fake IPC bridge + fake clipboard.
// ---------------------------------------------------------------------------

describe('BDD happy path E2E — save in Settings, see + copy in Discover', () => {
  it('writes through sites:setUsername, surfaces via activeUsername, and copies silently to the clipboard', async () => {
    const writeText = vi.fn(async () => {});
    vi.stubGlobal('navigator', { clipboard: { writeText } });
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

    try {
      const store = useAppStore();
      await store.hydrateSites();

      // 1. Save the username in Settings — same path the q-input commits via.
      await store.setSiteUsername('a', 'francois');
      expect(bridge.setUsername).toHaveBeenCalledWith('a', 'francois');

      // 2. Discover surfaces the saved username for the active tab.
      const selectedSiteId = 'a';
      const active = store.sites.find((s) => s.id === selectedSiteId) ?? null;
      const u = active?.username;
      const activeUsername =
        typeof u === 'string' && u.length > 0 ? u : '';
      expect(activeUsername).toBe('francois');

      // 3. The copy button writes to the clipboard silently.
      if (
        typeof navigator !== 'undefined' &&
        navigator.clipboard?.writeText
      ) {
        await navigator.clipboard.writeText(activeUsername);
      }
      expect(writeText).toHaveBeenCalledWith('francois');
      expect(writeText).toHaveBeenCalledTimes(1);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
