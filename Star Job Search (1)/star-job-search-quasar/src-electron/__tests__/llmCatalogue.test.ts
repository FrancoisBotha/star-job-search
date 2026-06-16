/**
 * Unit tests for the OpenRouter model catalogue module (LLM-002).
 *
 * Covers:
 *  - AC1: Fetches GET https://openrouter.ai/api/v1/models with Authorization: Bearer <key>
 *  - AC2: Returns typed ModelInfo[] (id, name, contextLength, pricing, created)
 *  - AC3: Stable error codes (NO_API_KEY, AUTH_ERROR, RATE_LIMITED, NETWORK_ERROR,
 *         HTTP_ERROR, BAD_RESPONSE)
 *  - AC4: IPC llm:listModels registered; concurrent/repeat calls de-duplicated/cached
 *  - AC5: Preload exposes window.starModels.list(); env.d.ts has matching type
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ELECTRON_DIR = path.resolve(__dirname, '..');
const SRC_DIR = path.resolve(ELECTRON_DIR, '../src');

const OPENROUTER_URL = 'https://openrouter.ai/api/v1/models';

const SAMPLE_RESPONSE = {
  data: [
    {
      id: 'openai/gpt-4o',
      name: 'GPT-4o',
      context_length: 128000,
      pricing: { prompt: '0.0000025', completion: '0.00001' },
      created: 1715558400,
    },
    {
      id: 'anthropic/claude-3-opus',
      name: 'Claude 3 Opus',
      context_length: 200000,
      pricing: { prompt: '0.000015', completion: '0.000075' },
      created: 1709251200,
    },
  ],
};

function mockResponse(body: unknown, init: { status?: number } = {}) {
  const status = init.status ?? 200;
  return {
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(body),
    text: () => Promise.resolve(typeof body === 'string' ? body : JSON.stringify(body)),
  } as unknown as Response;
}

const ipcHandlers = new Map<string, (...args: unknown[]) => unknown>();
const fakeIpcMain = {
  handle: (channel: string, fn: (...args: unknown[]) => unknown) => {
    ipcHandlers.set(channel, fn);
  },
  removeHandler: (channel: string) => {
    ipcHandlers.delete(channel);
  },
};

beforeEach(() => {
  ipcHandlers.clear();
});

afterEach(() => {
  vi.resetModules();
});

async function importModule() {
  return await import('../llmCatalogue');
}

describe('createLlmCatalogue.listModels — happy path (AC1, AC2)', () => {
  it('AC1: GETs https://openrouter.ai/api/v1/models with Authorization: Bearer <key>', async () => {
    const { createLlmCatalogue } = await importModule();
    const fetchSpy = vi.fn().mockResolvedValue(mockResponse(SAMPLE_RESPONSE));
    const cat = createLlmCatalogue({
      getApiKey: () => 'sk-or-v1-rawsecret1234',
      fetch: fetchSpy as unknown as typeof fetch,
    });

    await cat.listModels();

    expect(fetchSpy).toHaveBeenCalledOnce();
    const [url, init] = fetchSpy.mock.calls[0]!;
    expect(url).toBe(OPENROUTER_URL);
    expect((init as RequestInit).method ?? 'GET').toBe('GET');
    const headers = (init as { headers: Record<string, string> }).headers;
    expect(headers.Authorization ?? headers.authorization).toBe('Bearer sk-or-v1-rawsecret1234');
  });

  it('AC2: returns typed ModelInfo[] (id, name, contextLength, pricing.prompt/completion, created)', async () => {
    const { createLlmCatalogue } = await importModule();
    const cat = createLlmCatalogue({
      getApiKey: () => 'sk-or-v1-rawsecret1234',
      fetch: vi.fn().mockResolvedValue(mockResponse(SAMPLE_RESPONSE)) as unknown as typeof fetch,
    });

    const models = await cat.listModels();
    expect(models).toHaveLength(2);
    expect(models[0]).toEqual({
      id: 'openai/gpt-4o',
      name: 'GPT-4o',
      contextLength: 128000,
      pricing: { prompt: '0.0000025', completion: '0.00001' },
      created: 1715558400,
    });
    expect(models[1]!.id).toBe('anthropic/claude-3-opus');
  });
});

describe('createLlmCatalogue.listModels — stable error codes (AC3)', () => {
  it('NO_API_KEY when no key is saved', async () => {
    const { createLlmCatalogue, LlmCatalogueError } = await importModule();
    const fetchSpy = vi.fn();
    const cat = createLlmCatalogue({
      getApiKey: () => null,
      fetch: fetchSpy as unknown as typeof fetch,
    });

    await expect(cat.listModels()).rejects.toBeInstanceOf(LlmCatalogueError);
    await expect(cat.listModels()).rejects.toMatchObject({ code: 'NO_API_KEY' });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('NO_API_KEY when key is empty/whitespace', async () => {
    const { createLlmCatalogue } = await importModule();
    const cat = createLlmCatalogue({
      getApiKey: () => '   ',
      fetch: vi.fn() as unknown as typeof fetch,
    });
    await expect(cat.listModels()).rejects.toMatchObject({ code: 'NO_API_KEY' });
  });

  it('AUTH_ERROR on HTTP 401', async () => {
    const { createLlmCatalogue } = await importModule();
    const cat = createLlmCatalogue({
      getApiKey: () => 'sk-or-v1-rawsecret1234',
      fetch: vi.fn().mockResolvedValue(mockResponse('Unauthorized', { status: 401 })) as unknown as typeof fetch,
    });
    await expect(cat.listModels()).rejects.toMatchObject({ code: 'AUTH_ERROR' });
  });

  it('AUTH_ERROR on HTTP 403', async () => {
    const { createLlmCatalogue } = await importModule();
    const cat = createLlmCatalogue({
      getApiKey: () => 'sk-or-v1-rawsecret1234',
      fetch: vi.fn().mockResolvedValue(mockResponse('Forbidden', { status: 403 })) as unknown as typeof fetch,
    });
    await expect(cat.listModels()).rejects.toMatchObject({ code: 'AUTH_ERROR' });
  });

  it('RATE_LIMITED on HTTP 429', async () => {
    const { createLlmCatalogue } = await importModule();
    const cat = createLlmCatalogue({
      getApiKey: () => 'sk-or-v1-rawsecret1234',
      fetch: vi.fn().mockResolvedValue(mockResponse('rate limited', { status: 429 })) as unknown as typeof fetch,
    });
    await expect(cat.listModels()).rejects.toMatchObject({ code: 'RATE_LIMITED' });
  });

  it('NETWORK_ERROR when fetch throws (DNS / offline / TypeError)', async () => {
    const { createLlmCatalogue } = await importModule();
    const cat = createLlmCatalogue({
      getApiKey: () => 'sk-or-v1-rawsecret1234',
      fetch: vi.fn().mockRejectedValue(new TypeError('fetch failed')) as unknown as typeof fetch,
    });
    await expect(cat.listModels()).rejects.toMatchObject({ code: 'NETWORK_ERROR' });
  });

  it('HTTP_ERROR on other non-2xx (e.g. 500)', async () => {
    const { createLlmCatalogue } = await importModule();
    const cat = createLlmCatalogue({
      getApiKey: () => 'sk-or-v1-rawsecret1234',
      fetch: vi.fn().mockResolvedValue(mockResponse('boom', { status: 500 })) as unknown as typeof fetch,
    });
    await expect(cat.listModels()).rejects.toMatchObject({ code: 'HTTP_ERROR' });
  });

  it('BAD_RESPONSE when payload is not parseable as { data: [...] }', async () => {
    const { createLlmCatalogue } = await importModule();
    const cat = createLlmCatalogue({
      getApiKey: () => 'sk-or-v1-rawsecret1234',
      fetch: vi.fn().mockResolvedValue(mockResponse({ unexpected: true })) as unknown as typeof fetch,
    });
    await expect(cat.listModels()).rejects.toMatchObject({ code: 'BAD_RESPONSE' });
  });

  it('BAD_RESPONSE when JSON parse fails', async () => {
    const { createLlmCatalogue } = await importModule();
    const badResponse = {
      ok: true,
      status: 200,
      json: () => Promise.reject(new SyntaxError('bad json')),
      text: () => Promise.resolve('not json'),
    } as unknown as Response;
    const cat = createLlmCatalogue({
      getApiKey: () => 'sk-or-v1-rawsecret1234',
      fetch: vi.fn().mockResolvedValue(badResponse) as unknown as typeof fetch,
    });
    await expect(cat.listModels()).rejects.toMatchObject({ code: 'BAD_RESPONSE' });
  });
});

describe('createLlmCatalogue.listModels — dedup / cache (AC4)', () => {
  it('de-duplicates concurrent in-flight calls into a single fetch', async () => {
    const { createLlmCatalogue } = await importModule();
    let resolveFetch!: (r: Response) => void;
    const fetchSpy = vi.fn().mockImplementation(
      () =>
        new Promise<Response>((res) => {
          resolveFetch = res;
        }),
    );
    const cat = createLlmCatalogue({
      getApiKey: () => 'sk-or-v1-rawsecret1234',
      fetch: fetchSpy as unknown as typeof fetch,
    });

    const p1 = cat.listModels();
    const p2 = cat.listModels();
    const p3 = cat.listModels();
    resolveFetch(mockResponse(SAMPLE_RESPONSE));
    const [r1, r2, r3] = await Promise.all([p1, p2, p3]);

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(r1).toEqual(r2);
    expect(r2).toEqual(r3);
  });

  it('caches a successful result so subsequent calls do not refetch', async () => {
    const { createLlmCatalogue } = await importModule();
    const fetchSpy = vi.fn().mockResolvedValue(mockResponse(SAMPLE_RESPONSE));
    const cat = createLlmCatalogue({
      getApiKey: () => 'sk-or-v1-rawsecret1234',
      fetch: fetchSpy as unknown as typeof fetch,
    });

    await cat.listModels();
    await cat.listModels();
    await cat.listModels();
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it('failures are not cached — the next call retries', async () => {
    const { createLlmCatalogue } = await importModule();
    const fetchSpy = vi
      .fn()
      .mockResolvedValueOnce(mockResponse('boom', { status: 500 }))
      .mockResolvedValueOnce(mockResponse(SAMPLE_RESPONSE));
    const cat = createLlmCatalogue({
      getApiKey: () => 'sk-or-v1-rawsecret1234',
      fetch: fetchSpy as unknown as typeof fetch,
    });

    await expect(cat.listModels()).rejects.toMatchObject({ code: 'HTTP_ERROR' });
    const models = await cat.listModels();
    expect(models).toHaveLength(2);
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });

  it('invalidate() forces the next call to refetch', async () => {
    const { createLlmCatalogue } = await importModule();
    const fetchSpy = vi.fn().mockResolvedValue(mockResponse(SAMPLE_RESPONSE));
    const cat = createLlmCatalogue({
      getApiKey: () => 'sk-or-v1-rawsecret1234',
      fetch: fetchSpy as unknown as typeof fetch,
    });

    await cat.listModels();
    cat.invalidate();
    await cat.listModels();
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });
});

describe('registerLlmCatalogueIpc — IPC channel (AC4)', () => {
  it('registers the llm:listModels handler', async () => {
    const { createLlmCatalogue, registerLlmCatalogueIpc } = await importModule();
    const cat = createLlmCatalogue({
      getApiKey: () => 'sk-or-v1-rawsecret1234',
      fetch: vi.fn().mockResolvedValue(mockResponse(SAMPLE_RESPONSE)) as unknown as typeof fetch,
    });
    registerLlmCatalogueIpc(fakeIpcMain as never, cat);
    expect(ipcHandlers.has('llm:listModels')).toBe(true);
  });

  it('llm:listModels returns { ok: true, models } on success', async () => {
    const { createLlmCatalogue, registerLlmCatalogueIpc } = await importModule();
    const cat = createLlmCatalogue({
      getApiKey: () => 'sk-or-v1-rawsecret1234',
      fetch: vi.fn().mockResolvedValue(mockResponse(SAMPLE_RESPONSE)) as unknown as typeof fetch,
    });
    registerLlmCatalogueIpc(fakeIpcMain as never, cat);

    const result = (await ipcHandlers.get('llm:listModels')!({})) as {
      ok: true;
      models: unknown[];
    };
    expect(result.ok).toBe(true);
    expect(result.models).toHaveLength(2);
  });

  it('llm:listModels returns { ok: false, code, message } with a stable code on failure', async () => {
    const { createLlmCatalogue, registerLlmCatalogueIpc } = await importModule();
    const cat = createLlmCatalogue({
      getApiKey: () => null,
      fetch: vi.fn() as unknown as typeof fetch,
    });
    registerLlmCatalogueIpc(fakeIpcMain as never, cat);

    const result = (await ipcHandlers.get('llm:listModels')!({})) as {
      ok: false;
      code: string;
      message: string;
    };
    expect(result.ok).toBe(false);
    expect(result.code).toBe('NO_API_KEY');
    expect(typeof result.message).toBe('string');
  });

  it('repeat IPC invocations do not refetch (catalogue is cached)', async () => {
    const { createLlmCatalogue, registerLlmCatalogueIpc } = await importModule();
    const fetchSpy = vi.fn().mockResolvedValue(mockResponse(SAMPLE_RESPONSE));
    const cat = createLlmCatalogue({
      getApiKey: () => 'sk-or-v1-rawsecret1234',
      fetch: fetchSpy as unknown as typeof fetch,
    });
    registerLlmCatalogueIpc(fakeIpcMain as never, cat);

    await ipcHandlers.get('llm:listModels')!({});
    await ipcHandlers.get('llm:listModels')!({});
    await ipcHandlers.get('llm:listModels')!({});
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });
});

describe('main process wiring (AC4)', () => {
  it('createWindow registers the llm:listModels IPC handler', () => {
    const main = readFileSync(path.join(ELECTRON_DIR, 'electron-main.ts'), 'utf8');
    expect(main).toMatch(/registerLlmCatalogueIpc/);
    const createWindowBlock = main.split('function createWindow')[1] ?? '';
    expect(createWindowBlock).toMatch(/registerLlmCatalogueIpc/);
  });
});

describe('preload bridge (AC5)', () => {
  it('exposes window.starModels with list()', () => {
    const preload = readFileSync(path.join(ELECTRON_DIR, 'electron-preload.ts'), 'utf8');
    expect(preload).toMatch(/exposeInMainWorld\(\s*['"]starModels['"]/);
    expect(preload).toContain('llm:listModels');
  });

  it('env.d.ts declares a matching Window.starModels type', () => {
    const envDts = readFileSync(path.join(SRC_DIR, 'env.d.ts'), 'utf8');
    expect(envDts).toMatch(/starModels\??:/);
    expect(envDts).toMatch(/list\s*:/);
  });
});
