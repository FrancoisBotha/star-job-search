/**
 * Unit tests for the LLM-004 app-store wiring: API key status, model catalogue,
 * preferred models, and graceful no-op when the preload bridges are absent.
 */
import { setActivePinia, createPinia } from 'pinia';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useAppStore } from './app-store';

interface ApiKeyStatus {
  present: boolean;
  masked: string | null;
}

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
  apiKey?: Partial<{
    save: (key: string) => Promise<ApiKeyStatus>;
    getStatus: () => Promise<ApiKeyStatus>;
    clear: () => Promise<void>;
  }>;
  models?: {
    list: () => Promise<
      | { ok: true; models: ModelInfo[] }
      | { ok: false; code: string; message: string }
    >;
  };
  preferred?: {
    list?: () => Promise<PreferredModel[]>;
    add?: (slug: string) => Promise<
      | { ok: true; models: PreferredModel[] }
      | { ok: false; code: string; message: string }
    >;
    remove?: (slug: string) => Promise<PreferredModel[]>;
    setDefault?: (slug: string) => Promise<PreferredModel[]>;
  };
} = {}) {
  const w: Record<string, unknown> = {};
  if (opts.apiKey) w.starApiKey = opts.apiKey;
  if (opts.models) w.starModels = opts.models;
  if (opts.preferred) w.starPreferredModels = opts.preferred;
  (globalThis as { window?: unknown }).window = w;
  return w;
}

beforeEach(() => {
  setActivePinia(createPinia());
});

afterEach(() => {
  delete (globalThis as { window?: unknown }).window;
});

describe('app-store — API key (AC1)', () => {
  it('hydrateApiKeyStatus calls starApiKey.getStatus and stores the masked payload', async () => {
    const getStatus = vi.fn(async () => ({ present: true, masked: '••••abcd' }));
    installBridges({ apiKey: { getStatus } });
    const store = useAppStore();
    await store.hydrateApiKeyStatus();
    expect(getStatus).toHaveBeenCalledTimes(1);
    expect(store.apiKeyStatus).toEqual({ present: true, masked: '••••abcd' });
  });

  it('saveApiKey calls starApiKey.save and updates apiKeyStatus', async () => {
    const save = vi.fn(async (_k: string) => ({ present: true, masked: '••••wxyz' }));
    installBridges({ apiKey: { save } });
    const store = useAppStore();
    await store.saveApiKey('sk-or-v1-secret');
    expect(save).toHaveBeenCalledWith('sk-or-v1-secret');
    expect(store.apiKeyStatus).toEqual({ present: true, masked: '••••wxyz' });
  });

  it('clearApiKey calls starApiKey.clear and resets apiKeyStatus to absent', async () => {
    const clear = vi.fn(async () => {});
    installBridges({ apiKey: { clear } });
    const store = useAppStore();
    store.apiKeyStatus = { present: true, masked: '••••abcd' };
    await store.clearApiKey();
    expect(clear).toHaveBeenCalledTimes(1);
    expect(store.apiKeyStatus).toEqual({ present: false, masked: null });
  });
});

describe('app-store — model catalogue (AC1, AC2)', () => {
  const SAMPLE_MODELS: ModelInfo[] = [
    {
      id: 'anthropic/claude-3.5-sonnet',
      name: 'Claude 3.5 Sonnet',
      contextLength: 200000,
      pricing: { prompt: '0.000003', completion: '0.000015' },
      created: 1,
    },
    {
      id: 'openai/gpt-4o',
      name: 'GPT-4o',
      contextLength: 128000,
      pricing: { prompt: '0.000005', completion: '0.000015' },
      created: 2,
    },
  ];

  it('listModels toggles modelsLoading and stores enriched rows on success', async () => {
    let resolveList!: (
      v: { ok: true; models: ModelInfo[] } | { ok: false; code: string; message: string },
    ) => void;
    const list = vi.fn(
      () =>
        new Promise<
          | { ok: true; models: ModelInfo[] }
          | { ok: false; code: string; message: string }
        >((r) => {
          resolveList = r;
        }),
    );
    installBridges({ models: { list } });
    const store = useAppStore();

    const inFlight = store.listModels();
    expect(store.modelsLoading).toBe(true);
    expect(store.modelsLoaded).toBe(false);
    resolveList({ ok: true, models: SAMPLE_MODELS });
    await inFlight;

    expect(store.modelsLoading).toBe(false);
    expect(store.modelsLoaded).toBe(true);
    expect(store.modelsError).toBeNull();
    expect(store.models).toHaveLength(2);
    expect(store.models[0]!.vendor).toBe('anthropic');
    expect(store.models[0]!.contextLengthFormatted).toBe('200K');
    expect(store.models[0]!.priceFormatted).toMatch(/per 1M tokens/);
    expect(store.models[0]!.orderIndex).toBe(0);
  });

  it('listModels surfaces the tagged-union error code in modelsError', async () => {
    const list = vi.fn(async () => ({ ok: false as const, code: 'NO_API_KEY', message: 'no key' }));
    installBridges({ models: { list } });
    const store = useAppStore();
    await store.listModels();

    expect(store.modelsError).toEqual({ code: 'NO_API_KEY', message: 'no key' });
    expect(store.modelsLoaded).toBe(false);
    expect(store.modelsLoading).toBe(false);
    expect(store.models).toEqual([]);
  });
});

describe('app-store — preferred models (AC1)', () => {
  const LIST: PreferredModel[] = [
    { slug: 'anthropic/claude-3.5-sonnet', isDefault: true, position: 0 },
    { slug: 'openai/gpt-4o', isDefault: false, position: 1 },
  ];

  it('hydratePreferredModels calls starPreferredModels.list and stores the result', async () => {
    const list = vi.fn(async () => LIST);
    installBridges({ preferred: { list } });
    const store = useAppStore();
    await store.hydratePreferredModels();
    expect(list).toHaveBeenCalledTimes(1);
    expect(store.preferredModels).toEqual(LIST);
  });

  it('addPreferredModel persists via the bridge and updates state on success', async () => {
    const add = vi.fn(async (_s: string) => ({ ok: true as const, models: LIST }));
    installBridges({ preferred: { add } });
    const store = useAppStore();
    const result = await store.addPreferredModel('anthropic/claude-3.5-sonnet');
    expect(add).toHaveBeenCalledWith('anthropic/claude-3.5-sonnet');
    expect(result).toEqual({ ok: true, models: LIST });
    expect(store.preferredModels).toEqual(LIST);
  });

  it('addPreferredModel preserves the tagged-union error on failure', async () => {
    const add = vi.fn(async (_s: string) => ({
      ok: false as const,
      code: 'DUPLICATE' as const,
      message: 'dup',
    }));
    installBridges({ preferred: { add } });
    const store = useAppStore();
    const result = await store.addPreferredModel('anthropic/claude-3.5-sonnet');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe('DUPLICATE');
    }
    // State must not be mutated by a failed add.
    expect(store.preferredModels).toEqual([]);
  });

  it('removePreferredModel calls the bridge and refreshes state', async () => {
    const remove = vi.fn(async (_s: string) => [LIST[1]!] as PreferredModel[]);
    installBridges({ preferred: { remove } });
    const store = useAppStore();
    store.preferredModels = [...LIST];
    await store.removePreferredModel('anthropic/claude-3.5-sonnet');
    expect(remove).toHaveBeenCalledWith('anthropic/claude-3.5-sonnet');
    expect(store.preferredModels).toEqual([LIST[1]]);
  });

  it('setDefaultPreferredModel calls the bridge and refreshes state', async () => {
    const setDefault = vi.fn(async (_s: string) => [
      { ...LIST[0]!, isDefault: false },
      { ...LIST[1]!, isDefault: true },
    ]);
    installBridges({ preferred: { setDefault } });
    const store = useAppStore();
    await store.setDefaultPreferredModel('openai/gpt-4o');
    expect(setDefault).toHaveBeenCalledWith('openai/gpt-4o');
    expect(store.preferredModels[1]!.isDefault).toBe(true);
  });
});

describe('app-store — bridge-absent graceful no-op (AC4)', () => {
  beforeEach(() => {
    delete (globalThis as { window?: unknown }).window;
  });

  it('hydrateApiKeyStatus no-ops without window', async () => {
    const store = useAppStore();
    await expect(store.hydrateApiKeyStatus()).resolves.toBeUndefined();
    expect(store.apiKeyStatus).toEqual({ present: false, masked: null });
  });

  it('saveApiKey no-ops when starApiKey is absent', async () => {
    (globalThis as { window?: unknown }).window = {};
    const store = useAppStore();
    await expect(store.saveApiKey('sk-or-v1-x')).resolves.toBeUndefined();
  });

  it('listModels no-ops when starModels is absent', async () => {
    (globalThis as { window?: unknown }).window = {};
    const store = useAppStore();
    await store.listModels();
    expect(store.modelsLoading).toBe(false);
    expect(store.models).toEqual([]);
    expect(store.modelsLoaded).toBe(false);
  });

  it('hydratePreferredModels no-ops when starPreferredModels is absent', async () => {
    (globalThis as { window?: unknown }).window = {};
    const store = useAppStore();
    await expect(store.hydratePreferredModels()).resolves.toBeUndefined();
    expect(store.preferredModels).toEqual([]);
  });

  it('addPreferredModel returns an ok-false result without throwing when bridge is absent', async () => {
    (globalThis as { window?: unknown }).window = {};
    const store = useAppStore();
    const result = await store.addPreferredModel('anthropic/claude-3.5-sonnet');
    expect(result.ok).toBe(false);
  });
});

describe('app-store — legacy mock state superseded (AC3)', () => {
  it('does not pull the hard-coded SAMPLE_API_KEY into store state on creation', () => {
    installBridges();
    const store = useAppStore();
    // The old mock seeded `apiKey` with `sk-or-v1-3a9f…`. After LLM-004 the
    // store must not boot with that constant — apiKeyStatus is the canonical
    // surface and is absent until hydrateApiKeyStatus runs.
    expect(store.apiKeyStatus).toEqual({ present: false, masked: null });
  });

  it('still exposes a Starred-page-compatible visibleMatches getter (AC3)', () => {
    installBridges();
    const store = useAppStore();
    // The Starred page reads visibleMatches; supersession of the API key
    // mock must not break unrelated consumers.
    expect(Array.isArray(store.visibleMatches)).toBe(true);
  });

  it('still exposes sites state for the Settings/Discover wiring (AC3)', () => {
    installBridges();
    const store = useAppStore();
    expect(store.sites).toEqual([]);
    expect(typeof store.addSite).toBe('function');
    expect(typeof store.hydrateSites).toBe('function');
  });
});
