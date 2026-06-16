/**
 * Unit tests for LLM-006: Preferred-models picker dialog + Settings wiring.
 *
 * Acceptance criteria:
 *  AC1: New PreferredModelsPickerDialog.vue with search, filter pills
 *       (All / Preferred / SOTA / Free), sort (Featured / Newest / A->Z /
 *       Cost / Context), multi-select up to 5, "Limit of 5 reached" hint,
 *       plus loading / error-by-code / empty states.
 *  AC2: SettingsPage.vue replaces the mock q-select with a preferred list
 *       (name + set-default + remove) and a "Select models..." button that
 *       opens the dialog. The button is disabled until a key is saved.
 *  AC3: Selecting/deselecting and setting a default persist immediately via
 *       the store/bridges.
 *  AC4: Dialog reuses the q-dialog visual system used by the About dialog;
 *       no new design tokens are introduced.
 *
 * Mirrors the regex-scan precedent of SettingsPage.llm005.test.ts.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { setActivePinia, createPinia } from 'pinia';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useAppStore } from '../stores/app-store';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SETTINGS = readFileSync(path.join(__dirname, 'SettingsPage.vue'), 'utf8');
const DIALOG = readFileSync(
  path.join(__dirname, '..', 'components', 'PreferredModelsPickerDialog.vue'),
  'utf8',
);

describe('PreferredModelsPickerDialog — surface (AC1)', () => {
  it('uses a q-dialog root', () => {
    expect(DIALOG).toMatch(/<q-dialog/);
  });

  it('provides a search input', () => {
    expect(DIALOG).toMatch(/v-model="search"|v-model="query"/);
  });

  it('exposes the four filter pills (All / Preferred / SOTA / Free)', () => {
    expect(DIALOG).toMatch(/All/);
    expect(DIALOG).toMatch(/Preferred/);
    expect(DIALOG).toMatch(/SOTA/);
    expect(DIALOG).toMatch(/Free/);
  });

  it('exposes the five sort options (Featured / Newest / A->Z / Cost / Context)', () => {
    expect(DIALOG).toMatch(/Featured/);
    expect(DIALOG).toMatch(/Newest/);
    expect(DIALOG).toMatch(/A->Z|A→Z|A-Z/);
    expect(DIALOG).toMatch(/Cost/);
    expect(DIALOG).toMatch(/Context/);
  });

  it('enforces a multi-select cap of 5 with a hint', () => {
    expect(DIALOG).toMatch(/Limit of 5 reached/);
    expect(DIALOG).toMatch(/\b5\b/);
  });

  it('renders loading / empty / error-by-code states', () => {
    expect(DIALOG).toMatch(/modelsLoading|loading/i);
    expect(DIALOG).toMatch(/NO_API_KEY/);
    expect(DIALOG).toMatch(/AUTH_ERROR/);
    expect(DIALOG).toMatch(/RATE_LIMITED/);
    expect(DIALOG).toMatch(/NETWORK_ERROR/);
    expect(DIALOG).toMatch(/empty|no models/i);
  });
});

describe('PreferredModelsPickerDialog — persistence wiring (AC3)', () => {
  it('persists toggles via the store actions, not local state', () => {
    expect(DIALOG).toMatch(/addPreferredModel\(/);
    expect(DIALOG).toMatch(/removePreferredModel\(/);
  });

  it('hydrates the catalogue + preferred list on open', () => {
    expect(DIALOG).toMatch(/listModels\(\)/);
    expect(DIALOG).toMatch(/hydratePreferredModels\(\)/);
  });
});

describe('PreferredModelsPickerDialog — Studio visual system (AC4)', () => {
  it('does not introduce a new design-token variable', () => {
    // The dialog should reuse existing CSS custom properties (var(--…)),
    // not declare new ones via :root { --new-token: … }.
    expect(DIALOG).not.toMatch(/:root\s*\{[^}]*--/);
  });
});

describe('SettingsPage — preferred list replaces mock q-select (AC2)', () => {
  it('removes the legacy hard-coded `models` array of slugs', () => {
    // The legacy mock used a const models = ['anthropic/...','openai/...'] string list.
    expect(SETTINGS).not.toMatch(/const\s+models\s*=\s*\[\s*'anthropic\/claude-3\.5-sonnet'/);
  });

  it('renders the preferredModels list from the store', () => {
    expect(SETTINGS).toMatch(/store\.preferredModels|preferredModels/);
  });

  it('exposes set-default and remove actions on each row', () => {
    expect(SETTINGS).toMatch(/setDefaultPreferredModel\(/);
    expect(SETTINGS).toMatch(/removePreferredModel\(/);
  });

  it('opens the picker dialog via a "Select models" button', () => {
    expect(SETTINGS).toMatch(/Select models/);
    expect(SETTINGS).toMatch(/PreferredModelsPickerDialog/);
  });

  it('disables the picker button until an API key is saved', () => {
    expect(SETTINGS).toMatch(/:disable=".*apiKeyStatus\.present|!store\.apiKeyStatus\.present/);
  });

  it('hydrates the preferred-models list on mount', () => {
    expect(SETTINGS).toMatch(/hydratePreferredModels\(\)/);
  });
});

interface ModelInfo {
  id: string;
  name: string;
  contextLength: number;
  pricing: { prompt: string; completion: string };
  created: number;
}

interface PreferredModel {
  slug: string;
  isDefault: boolean;
  position: number;
}

function installBridges(opts: {
  models?: () => Promise<
    | { ok: true; models: ModelInfo[] }
    | { ok: false; code: string; message: string }
  >;
  preferred?: {
    list?: () => Promise<PreferredModel[]>;
    add?: (slug: string) => Promise<
      | { ok: true; models: PreferredModel[] }
      | { ok: false; code: string; message: string }
    >;
    remove?: (slug: string) => Promise<PreferredModel[]>;
    setDefault?: (slug: string) => Promise<PreferredModel[]>;
  };
}) {
  const w: Record<string, unknown> = {};
  if (opts.models) w.starModels = { list: opts.models };
  if (opts.preferred) w.starPreferredModels = opts.preferred;
  (globalThis as { window?: unknown }).window = w;
}

beforeEach(() => {
  setActivePinia(createPinia());
});

afterEach(() => {
  delete (globalThis as { window?: unknown }).window;
});

describe('app-store — preferred-models round-trip (AC3)', () => {
  it('add + remove + setDefault all delegate to the bridge and refresh state', async () => {
    const LIST: PreferredModel[] = [
      { slug: 'anthropic/claude-3.5-sonnet', isDefault: true, position: 0 },
    ];
    const add = vi.fn(async (_s: string) => ({ ok: true as const, models: LIST }));
    const remove = vi.fn(async (_s: string) => [] as PreferredModel[]);
    const setDefault = vi.fn(async (_s: string) => LIST);
    installBridges({ preferred: { add, remove, setDefault } });
    const store = useAppStore();

    const r = await store.addPreferredModel('anthropic/claude-3.5-sonnet');
    expect(r.ok).toBe(true);
    expect(store.preferredModels).toEqual(LIST);

    await store.removePreferredModel('anthropic/claude-3.5-sonnet');
    expect(remove).toHaveBeenCalledWith('anthropic/claude-3.5-sonnet');
    expect(store.preferredModels).toEqual([]);

    await store.setDefaultPreferredModel('anthropic/claude-3.5-sonnet');
    expect(setDefault).toHaveBeenCalledWith('anthropic/claude-3.5-sonnet');
    expect(store.preferredModels).toEqual(LIST);
  });
});
