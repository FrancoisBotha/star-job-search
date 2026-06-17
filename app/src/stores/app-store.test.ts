/**
 * Unit tests for the Settings Job-sites wiring in the app store (BRWSR-003).
 *
 * Covers:
 *  - AC1: store.sites/siteDraft/addSite/removeSite are backed by persistence
 *  - AC2: hydrateSites() pulls the persisted list from main via sites:list
 *  - AC3: addSite() persists via sites:add (URL is normalised in main)
 *  - AC4: removeSite() persists via sites:remove
 *  - AC5: after a "restart" (fresh pinia + same persisted rows), the Settings
 *         card reflects the persisted sites
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { setActivePinia, createPinia } from 'pinia';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useAppStore } from './app-store';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SRC_DIR = path.resolve(__dirname, '..');

interface FakeSite {
  id: string;
  url: string;
  host: string;
  label: string;
  enabled: boolean;
  addedAt: number;
}

function installStarSites(initial: FakeSite[] = []) {
  const rows: FakeSite[] = [...initial];
  let nextId = rows.length + 1;
  const bridge = {
    list: vi.fn(async () => rows.map((r) => ({ ...r }))),
    add: vi.fn(async ({ url, label }: { url: string; label?: string }) => {
      const trimmed = url.trim();
      const withScheme = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
      const parsed = new URL(withScheme);
      const host = parsed.host.toLowerCase();
      let normalisedUrl = parsed.toString();
      if ((parsed.pathname === '/' || parsed.pathname === '') && normalisedUrl.endsWith('/')) {
        normalisedUrl = normalisedUrl.slice(0, -1);
      }
      const site: FakeSite = {
        id: `id-${nextId++}`,
        url: normalisedUrl,
        host,
        label: label?.trim() || host,
        enabled: true,
        addedAt: nextId,
      };
      rows.push(site);
      return { ...site };
    }),
    remove: vi.fn(async (id: string) => {
      const i = rows.findIndex((r) => r.id === id);
      if (i >= 0) rows.splice(i, 1);
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

describe('app-store sites — initial state (AC1)', () => {
  it('starts with an empty sites list (no hard-coded in-memory entries)', () => {
    installStarSites();
    const store = useAppStore();
    expect(store.sites).toEqual([]);
  });
});

describe('app-store.hydrateSites (AC2)', () => {
  it('calls window.starSites.list and populates store.sites', async () => {
    const { bridge } = installStarSites([
      {
        id: 'a',
        url: 'https://rolehub.com',
        host: 'rolehub.com',
        label: 'rolehub.com',
        enabled: true,
        addedAt: 1,
      },
    ]);
    const store = useAppStore();
    await store.hydrateSites();

    expect(bridge.list).toHaveBeenCalledTimes(1);
    expect(store.sites).toHaveLength(1);
    expect(store.sites[0]!.host).toBe('rolehub.com');
  });
});

describe('app-store.addSite (AC3)', () => {
  it('persists the draft via sites:add, appends the returned site, clears the draft', async () => {
    const { bridge } = installStarSites();
    const store = useAppStore();
    store.siteDraft = '  rolehub.com  ';

    await store.addSite();

    expect(bridge.add).toHaveBeenCalledTimes(1);
    expect(bridge.add).toHaveBeenCalledWith({ url: '  rolehub.com  ' });
    expect(store.sites).toHaveLength(1);
    expect(store.sites[0]!.host).toBe('rolehub.com');
    expect(store.sites[0]!.url).toBe('https://rolehub.com');
    expect(store.siteDraft).toBe('');
  });

  it('does nothing when the draft is blank', async () => {
    const { bridge } = installStarSites();
    const store = useAppStore();
    store.siteDraft = '   ';

    await store.addSite();

    expect(bridge.add).not.toHaveBeenCalled();
    expect(store.sites).toHaveLength(0);
  });
});

describe('app-store.removeSite (AC4)', () => {
  it('calls sites:remove with the site id and removes it from state', async () => {
    const { bridge } = installStarSites([
      { id: 'a', url: 'https://rolehub.com', host: 'rolehub.com', label: 'rolehub.com', enabled: true, addedAt: 1 },
      { id: 'b', url: 'https://workscout.io', host: 'workscout.io', label: 'workscout.io', enabled: true, addedAt: 2 },
    ]);
    const store = useAppStore();
    await store.hydrateSites();

    await store.removeSite('a');

    expect(bridge.remove).toHaveBeenCalledWith('a');
    expect(store.sites.map((s) => s.id)).toEqual(['b']);
  });
});

describe('app-store sites — restart durability (AC5)', () => {
  it('after a fresh pinia, hydrateSites reflects what is persisted', async () => {
    installStarSites([
      { id: 'a', url: 'https://rolehub.com', host: 'rolehub.com', label: 'rolehub.com', enabled: true, addedAt: 1 },
      { id: 'b', url: 'https://workscout.io', host: 'workscout.io', label: 'workscout.io', enabled: true, addedAt: 2 },
    ]);

    setActivePinia(createPinia());
    const store = useAppStore();
    expect(store.sites).toEqual([]);
    await store.hydrateSites();
    expect(store.sites.map((s) => s.host)).toEqual(['rolehub.com', 'workscout.io']);
  });
});

describe('Settings page wiring (AC1, AC3, AC4, AC6)', () => {
  const settings = readFileSync(
    path.join(SRC_DIR, 'pages', 'SettingsPage.vue'),
    'utf8',
  );

  it('renders site.host (object form), not a raw string', () => {
    // The card must show a property of the persisted Site, not the old
    // string form. Accept any of host/url/label as the displayed field.
    expect(settings).toMatch(/site\.(host|url|label)/);
  });

  it('calls removeSite with the site id, not an index', () => {
    expect(settings).toMatch(/removeSite\(\s*site\.id\s*\)/);
  });

  it('introduces no new design tokens, colours, or components (AC6)', () => {
    // AC6: Studio visual system unchanged. This guards against palette DRIFT,
    // not page growth — later epics legitimately expanded SettingsPage (e.g.
    // the Epic 2 LLM-integration UI), so the same Studio colours now appear
    // more often. What must NOT change is the SET of distinct colour literals.
    const hexColours = (settings.match(/#[0-9a-fA-F]{3,8}\b/g) ?? []).map((c) =>
      c.toLowerCase(),
    );
    const distinct = new Set(hexColours);
    // The stable Studio palette used here: terracotta accent, white, dark
    // text, muted, olive-green. A 6th distinct literal means a new colour crept
    // in and should be reviewed (or moved to a var(--…) token).
    expect(distinct.size).toBeLessThanOrEqual(5);
  });
});
