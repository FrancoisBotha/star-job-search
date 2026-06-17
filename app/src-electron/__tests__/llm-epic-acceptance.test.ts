/**
 * LLM epic acceptance bundle (LLM-007).
 *
 * Consolidates the contract-level guarantees of the OpenRouter Key & Model
 * Selection epic into a single fail-fast suite so a future regression in any
 * one of these areas trips a clearly-named test:
 *
 *  - apiKey: masking, blank-key rejection, safeStorage-unavailable
 *  - llmCatalogue: stable error codes NO_API_KEY / AUTH_ERROR / RATE_LIMITED /
 *                  NETWORK_ERROR / BAD_RESPONSE via a fake fetch
 *  - preferredModels: max-5 limit, exactly-one-default, default promotion on
 *                     removal, DUPLICATE / LIMIT_REACHED error codes — driven
 *                     through the Database-like seam
 *
 * Mirrors the BRWSR-006 epic-acceptance.test.ts pattern: each `describe` is
 * anchored to one LLM-007 acceptance criterion.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

import { createApiKeyStore, maskKey, type ApiKeyFsLike, type SafeStorageLike } from '../apiKey';
import {
  createLlmCatalogue,
  LlmCatalogueError,
  OPENROUTER_MODELS_URL,
} from '../llmCatalogue';
import {
  createPreferredModelsStore,
  MAX_PREFERRED_MODELS,
  type PreferredModelsDatabaseLike,
} from '../preferredModels';

afterEach(() => {
  vi.restoreAllMocks();
});

// --- Test doubles -----------------------------------------------------------

class InMemoryFs implements ApiKeyFsLike {
  files = new Map<string, Buffer>();
  existsSync(p: string) {
    return this.files.has(p);
  }
  readFileSync(p: string): Buffer {
    const b = this.files.get(p);
    if (!b) throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
    return b;
  }
  writeFileSync(p: string, data: Buffer | string) {
    this.files.set(p, Buffer.isBuffer(data) ? data : Buffer.from(data));
  }
  unlinkSync(p: string) {
    this.files.delete(p);
  }
  mkdirSync(_p: string, _opts?: { recursive?: boolean }) {
    /* no-op */
  }
}

function makeSafeStorage(available = true): SafeStorageLike & { available: boolean } {
  return {
    available,
    isEncryptionAvailable() {
      return this.available;
    },
    encryptString(s: string) {
      return Buffer.from('ENC:' + Buffer.from(s, 'utf8').toString('base64'), 'utf8');
    },
    decryptString(b: Buffer) {
      const raw = b.toString('utf8');
      if (!raw.startsWith('ENC:')) throw new Error('bad blob');
      return Buffer.from(raw.slice(4), 'base64').toString('utf8');
    },
  };
}

function mockHttp(body: unknown, init: { status?: number } = {}): Response {
  const status = init.status ?? 200;
  return {
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(body),
    text: () =>
      Promise.resolve(typeof body === 'string' ? body : JSON.stringify(body)),
  } as unknown as Response;
}

const CATALOGUE_BODY = {
  data: [
    {
      id: 'openai/gpt-4o',
      name: 'GPT-4o',
      context_length: 128000,
      pricing: { prompt: '0.0000025', completion: '0.00001' },
      created: 1715558400,
    },
  ],
};

interface PrefRow {
  slug: string;
  is_default: number;
  position: number;
}

class FakePreferredModelsDb implements PreferredModelsDatabaseLike {
  rows: PrefRow[] = [];
  exec(_sql: string) {
    /* CREATE TABLE — no-op for the fake */
  }
  prepare(sql: string) {
    const text = sql.trim();
    if (/^INSERT\s+INTO\s+preferred_models/i.test(text)) {
      return {
        run: (params: PrefRow) => {
          this.rows.push({ ...params });
          return { changes: 1 };
        },
      };
    }
    if (/^DELETE\s+FROM\s+preferred_models/i.test(text)) {
      return {
        run: (slug: string) => {
          const before = this.rows.length;
          this.rows = this.rows.filter((r) => r.slug !== slug);
          return { changes: before - this.rows.length };
        },
      };
    }
    if (/^UPDATE\s+preferred_models\s+SET\s+is_default\s*=\s*0/i.test(text)) {
      return {
        run: () => {
          let changes = 0;
          for (const r of this.rows) {
            if (r.is_default !== 0) {
              r.is_default = 0;
              changes++;
            }
          }
          return { changes };
        },
      };
    }
    if (/^UPDATE\s+preferred_models\s+SET\s+is_default\s*=\s*1/i.test(text)) {
      return {
        run: (slug: string) => {
          const row = this.rows.find((r) => r.slug === slug);
          if (!row) return { changes: 0 };
          row.is_default = 1;
          return { changes: 1 };
        },
      };
    }
    if (/^SELECT/i.test(text)) {
      return {
        run: () => ({ changes: 0 }),
        all: () => [...this.rows].sort((a, b) => a.position - b.position),
      };
    }
    throw new Error(`FakePreferredModelsDb: unsupported SQL: ${text}`);
  }
}

// --- LLM-007 AC1 — apiKey -------------------------------------------------

describe('LLM-007 AC1 — apiKey: masking, blank-key rejection, safeStorage-unavailable', () => {
  const FILE_PATH = '/userData/openrouter-key.bin';

  it('masking: maskKey returns dots + the last 4 chars only', () => {
    const raw = 'sk-or-v1-aaaaaaaaaa1234';
    const masked = maskKey(raw);
    expect(masked.length).toBe(raw.length);
    expect(masked.endsWith('1234')).toBe(true);
    expect(masked.startsWith('•')).toBe(true);
    expect(masked).not.toContain('aaaa');
  });

  it('blank-key rejection: save throws and never writes the file', () => {
    const fs = new InMemoryFs();
    const store = createApiKeyStore({
      safeStorage: makeSafeStorage(true),
      fs,
      filePath: FILE_PATH,
    });
    for (const blank of ['', '   ', '\t\n']) {
      expect(() => store.save(blank)).toThrow();
    }
    expect(fs.existsSync(FILE_PATH)).toBe(false);
  });

  it('safeStorage-unavailable: save throws with a clear error and writes no plaintext', () => {
    const fs = new InMemoryFs();
    const safeStorage = makeSafeStorage(false);
    const encryptSpy = vi.spyOn(safeStorage, 'encryptString');
    const store = createApiKeyStore({ safeStorage, fs, filePath: FILE_PATH });

    expect(() => store.save('sk-or-v1-rawsecret9999')).toThrow(/encryption/i);
    expect(encryptSpy).not.toHaveBeenCalled();
    expect(fs.existsSync(FILE_PATH)).toBe(false);
  });
});

// --- LLM-007 AC2 — llmCatalogue error-code mapping -----------------------

describe('LLM-007 AC2 — llmCatalogue error-code mapping via a fake fetch', () => {
  function makeCat(getKey: () => string | null, fetchImpl: (...args: unknown[]) => unknown) {
    return createLlmCatalogue({
      getApiKey: getKey,
      fetch: fetchImpl as unknown as typeof fetch,
    });
  }

  it('NO_API_KEY: fetch is never called when no key is available', async () => {
    const fetchSpy = vi.fn();
    const cat = makeCat(() => null, fetchSpy);
    await expect(cat.listModels()).rejects.toBeInstanceOf(LlmCatalogueError);
    await expect(cat.listModels()).rejects.toMatchObject({ code: 'NO_API_KEY' });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('AUTH_ERROR: maps HTTP 401 to AUTH_ERROR', async () => {
    const fetchSpy = vi.fn().mockResolvedValue(mockHttp('Unauthorized', { status: 401 }));
    const cat = makeCat(() => 'sk', fetchSpy);
    await expect(cat.listModels()).rejects.toMatchObject({ code: 'AUTH_ERROR' });
    const [url, init] = fetchSpy.mock.calls[0]!;
    expect(url).toBe(OPENROUTER_MODELS_URL);
    const headers = (init as { headers: Record<string, string> }).headers;
    expect(headers.Authorization ?? headers.authorization).toBe('Bearer sk');
  });

  it('RATE_LIMITED: maps HTTP 429 to RATE_LIMITED', async () => {
    const cat = makeCat(
      () => 'sk',
      vi.fn().mockResolvedValue(mockHttp('slow down', { status: 429 })),
    );
    await expect(cat.listModels()).rejects.toMatchObject({ code: 'RATE_LIMITED' });
  });

  it('NETWORK_ERROR: maps a thrown fetch (TypeError / offline) to NETWORK_ERROR', async () => {
    const cat = makeCat(() => 'sk', vi.fn().mockRejectedValue(new TypeError('fetch failed')));
    await expect(cat.listModels()).rejects.toMatchObject({ code: 'NETWORK_ERROR' });
  });

  it('BAD_RESPONSE: maps an unparseable body shape to BAD_RESPONSE', async () => {
    const cat = makeCat(
      () => 'sk',
      vi.fn().mockResolvedValue(mockHttp({ not: 'what we expect' })),
    );
    await expect(cat.listModels()).rejects.toMatchObject({ code: 'BAD_RESPONSE' });
  });

  it('happy path still returns typed ModelInfo[] when fetch resolves with a valid body', async () => {
    const cat = makeCat(() => 'sk', vi.fn().mockResolvedValue(mockHttp(CATALOGUE_BODY)));
    const models = await cat.listModels();
    expect(models).toHaveLength(1);
    expect(models[0]!.id).toBe('openai/gpt-4o');
  });
});

// --- LLM-007 AC3 — preferredModels invariants ----------------------------

describe('LLM-007 AC3 — preferredModels invariants via the Database-like seam', () => {
  it('max-5 limit: a sixth add returns LIMIT_REACHED and the list stays at 5', () => {
    const store = createPreferredModelsStore(new FakePreferredModelsDb());
    for (let i = 0; i < MAX_PREFERRED_MODELS; i++) {
      const r = store.add(`vendor/m${i}`);
      expect(r.ok).toBe(true);
    }
    const sixth = store.add('vendor/overflow');
    expect(sixth.ok).toBe(false);
    if (sixth.ok) return;
    expect(sixth.code).toBe('LIMIT_REACHED');
    expect(store.list()).toHaveLength(MAX_PREFERRED_MODELS);
  });

  it('exactly-one-default: across a sequence of add/setDefault calls, exactly one row is default', () => {
    const store = createPreferredModelsStore(new FakePreferredModelsDb());
    store.add('vendor/a');
    store.add('vendor/b');
    store.add('vendor/c');
    let list = store.list();
    expect(list.filter((m) => m.isDefault)).toHaveLength(1);

    list = store.setDefault('vendor/c');
    const defaults = list.filter((m) => m.isDefault);
    expect(defaults).toHaveLength(1);
    expect(defaults[0]!.slug).toBe('vendor/c');
  });

  it('default promotion on removal: removing the default promotes the earliest remaining by position', () => {
    const store = createPreferredModelsStore(new FakePreferredModelsDb());
    store.add('vendor/a'); // becomes default
    store.add('vendor/b');
    store.add('vendor/c');
    const updated = store.remove('vendor/a');
    expect(updated.map((m) => m.slug)).toEqual(['vendor/b', 'vendor/c']);
    const defaults = updated.filter((m) => m.isDefault);
    expect(defaults).toHaveLength(1);
    expect(defaults[0]!.slug).toBe('vendor/b');
  });

  it('DUPLICATE: re-adding an existing slug returns the DUPLICATE error code', () => {
    const store = createPreferredModelsStore(new FakePreferredModelsDb());
    expect(store.add('vendor/a').ok).toBe(true);
    const r = store.add('vendor/a');
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.code).toBe('DUPLICATE');
  });

  it('first model added becomes default automatically (exactly-one-default seed condition)', () => {
    const store = createPreferredModelsStore(new FakePreferredModelsDb());
    const r = store.add('vendor/seed');
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.models).toHaveLength(1);
    expect(r.models[0]!.isDefault).toBe(true);
  });
});
