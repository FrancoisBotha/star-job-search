/**
 * Unit tests for SettingsPage OpenRouter API key wiring (LLM-005).
 *
 * Acceptance criteria:
 *  AC1: The OpenRouter API key row saves a typed key, shows the masked status
 *       when a key is present, and can clear it, all via the app-store /
 *       window.starApiKey bridge.
 *  AC2: Test connection performs a real validation (catalogue fetch from
 *       LLM-002) and shows a connected state on success or a specific message
 *       per error code (no key / auth / rate-limited / network).
 *  AC3: The raw key is never rendered back from storage; Show/Hide toggles
 *       only the in-progress input the user typed.
 *  AC4: The mock SAMPLE_API_KEY usage is gone from the page.
 *
 * Mirrors the regex-scan precedent of DiscoverPage / HelpPage tests, plus
 * a couple of pinia store-level tests for the new testConnection action.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { setActivePinia, createPinia } from 'pinia';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useAppStore } from '../stores/app-store';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SETTINGS = readFileSync(path.join(__dirname, 'SettingsPage.vue'), 'utf8');

describe('SettingsPage — OpenRouter key (AC1)', () => {
  it('binds an input to a local in-progress key ref (not the store)', () => {
    // The page must have a typed-key input bound to a local ref (e.g. keyInput / keyDraft).
    expect(SETTINGS).toMatch(/v-model="(keyDraft|keyInput|draftKey|typedKey)"/);
    // The local ref is declared in <script setup>.
    expect(SETTINGS).toMatch(/const\s+(keyDraft|keyInput|draftKey|typedKey)\s*=\s*ref\(/);
  });

  it('exposes Save and Clear actions wired to the store', () => {
    expect(SETTINGS).toMatch(/store\.saveApiKey\(/);
    expect(SETTINGS).toMatch(/store\.clearApiKey\(/);
  });

  it('shows the masked status string from apiKeyStatus when a key is present', () => {
    // The page must read apiKeyStatus.masked / apiKeyStatus.present.
    expect(SETTINGS).toMatch(/apiKeyStatus\.(masked|present)/);
  });

  it('hydrates the api-key status on mount', () => {
    expect(SETTINGS).toMatch(/hydrateApiKeyStatus\(\)/);
  });
});

describe('SettingsPage — Show/Hide toggles only the typed input (AC3)', () => {
  it('Show/Hide toggle binds to a local visibility ref, not the persisted key', () => {
    // The toggle now flips the input's type between password and text via a local ref.
    expect(SETTINGS).toMatch(/type="(text|password)"|:type=/);
    // The in-progress visibility ref must be local; not toggleKey/keyVisible on the store.
    expect(SETTINGS).not.toMatch(/store\.toggleKey\(/);
  });

  it('does not echo a raw key out of storage', () => {
    // The page must not bind an input v-model to store.apiKey or apiKeyStatus.masked.
    expect(SETTINGS).not.toMatch(/v-model="store\.apiKey"/);
    expect(SETTINGS).not.toMatch(/v-model="store\.apiKeyStatus/);
  });
});

describe('SettingsPage — Test connection wiring (AC2)', () => {
  it('calls a store-level testConnection action (not a local stub)', () => {
    expect(SETTINGS).toMatch(/store\.testConnection\(/);
  });

  it('surfaces specific messages per error code', () => {
    // The page must render branches keyed by the catalogue error codes
    // from LLM-002 (NO_API_KEY / AUTH / RATE_LIMITED / NETWORK).
    expect(SETTINGS).toMatch(/NO_API_KEY/);
    expect(SETTINGS).toMatch(/AUTH/);
    expect(SETTINGS).toMatch(/RATE_LIMITED/);
    expect(SETTINGS).toMatch(/NETWORK/);
  });

  it('shows a "Connected" state on success', () => {
    expect(SETTINGS).toMatch(/Connected/);
  });
});

describe('SettingsPage — Mock SAMPLE_API_KEY removed (AC4)', () => {
  it('does not import SAMPLE_API_KEY', () => {
    expect(SETTINGS).not.toMatch(/SAMPLE_API_KEY/);
  });

  it('does not render the mock placeholder bullets-string from the legacy store getter', () => {
    // The legacy keyDisplay getter rendered a fake "sk-or-v1-••••…" string.
    // The new page must not lean on that placeholder.
    expect(SETTINGS).not.toMatch(/keyDisplay/);
  });
});

interface ModelInfo {
  id: string;
  name: string;
  contextLength: number;
  pricing: { prompt: string; completion: string };
  created: number;
}

function installModelsBridge(
  list: () => Promise<
    | { ok: true; models: ModelInfo[] }
    | { ok: false; code: string; message: string }
  >,
) {
  (globalThis as { window?: unknown }).window = { starModels: { list } };
}

beforeEach(() => {
  setActivePinia(createPinia());
});

afterEach(() => {
  delete (globalThis as { window?: unknown }).window;
});

describe('app-store.testConnection (AC2)', () => {
  it('marks connectionStatus = "ok" and stores the model count on success', async () => {
    const list = vi.fn(async () => ({
      ok: true as const,
      models: [
        {
          id: 'a/b',
          name: 'B',
          contextLength: 128000,
          pricing: { prompt: '0.000001', completion: '0.000002' },
          created: 1,
        },
      ],
    }));
    installModelsBridge(list);
    const store = useAppStore();
    await store.testConnection();
    expect(list).toHaveBeenCalled();
    expect(store.connectionStatus).toBe('ok');
    expect(store.connectionModelCount).toBe(1);
    expect(store.connectionError).toBeNull();
  });

  it('captures the tagged-union error code on failure (NO_API_KEY)', async () => {
    const list = vi.fn(async () => ({
      ok: false as const,
      code: 'NO_API_KEY' as const,
      message: 'no key configured',
    }));
    installModelsBridge(list);
    const store = useAppStore();
    await store.testConnection();
    expect(store.connectionStatus).toBe('error');
    expect(store.connectionError).toEqual({
      code: 'NO_API_KEY',
      message: 'no key configured',
    });
  });

  it('captures AUTH / RATE_LIMITED / NETWORK error codes verbatim', async () => {
    for (const code of ['AUTH', 'RATE_LIMITED', 'NETWORK'] as const) {
      const list = vi.fn(async () => ({
        ok: false as const,
        code,
        message: `${code} message`,
      }));
      installModelsBridge(list);
      const store = useAppStore();
      await store.testConnection();
      expect(store.connectionStatus).toBe('error');
      expect(store.connectionError?.code).toBe(code);
    }
  });

  it('toggles connectionStatus = "testing" while in flight', async () => {
    let resolve!: (
      v:
        | { ok: true; models: ModelInfo[] }
        | { ok: false; code: string; message: string },
    ) => void;
    const list = vi.fn(
      () =>
        new Promise<
          | { ok: true; models: ModelInfo[] }
          | { ok: false; code: string; message: string }
        >((r) => {
          resolve = r;
        }),
    );
    installModelsBridge(list);
    const store = useAppStore();
    const inFlight = store.testConnection();
    expect(store.connectionStatus).toBe('testing');
    resolve({ ok: true, models: [] });
    await inFlight;
    expect(store.connectionStatus).toBe('ok');
  });
});
