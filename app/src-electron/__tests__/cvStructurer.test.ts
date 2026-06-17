/**
 * Unit tests for the CV LLM-structuring module (CVPROF-004).
 *
 * Covers the ticket acceptance criteria:
 *  - AC1: structures CV text into profile fields via a single OpenRouter
 *         chat-completions call with JSON-schema structured output (FR-003)
 *  - AC2: reuses Epic 2's saved API key + selected default model; NO_API_KEY /
 *         NO_DEFAULT_MODEL when either is missing (FR-011)
 *  - AC3: result exposes parsedFields + per-field/overall confidence (FR-004)
 *  - AC4: surfaces MODEL_NO_STRUCTURED_OUTPUT when the selected model rejects
 *         the structured-output request (epic §10)
 *  - AC5: only outbound path is OpenRouter's /chat/completions on the existing
 *         egress; no new endpoint is opened (NFR-002)
 *  - AC6: parse / LLM failures surface stable retryable error codes so the
 *         frontend can offer retry / different file / manual entry; the call
 *         is single-shot (FR-005, NFR-004)
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ELECTRON_DIR = path.resolve(__dirname, '..');
const SRC_DIR = path.resolve(ELECTRON_DIR, '../src');

const OPENROUTER_CHAT_URL = 'https://openrouter.ai/api/v1/chat/completions';

const SAMPLE_PARSED = {
  name: 'Alex Morgan',
  contact: { email: 'alex@example.com', phone: '+1 555 0100' },
  targetRole: 'Senior Frontend Engineer',
  skills: ['TypeScript', 'Vue', 'Node.js'],
  employmentHistory: [
    { company: 'Acme', role: 'Senior FE', startDate: '2021-03', endDate: null, summary: 'Led design system.' },
  ],
  education: [
    { school: 'State Uni', qualification: 'BSc CS', startDate: '2014', endDate: '2018' },
  ],
  totalYearsExperience: 8,
  location: 'Berlin, DE',
  confidence: {
    overall: 0.82,
    perField: { name: 0.95, targetRole: 0.7, skills: 0.9, location: 0.85 },
  },
};

function mockResponse(body: unknown, init: { status?: number } = {}) {
  const status = init.status ?? 200;
  return {
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(body),
    text: () =>
      Promise.resolve(typeof body === 'string' ? body : JSON.stringify(body)),
  } as unknown as Response;
}

function chatResponse(payload: unknown): Response {
  return mockResponse({
    choices: [{ message: { content: JSON.stringify(payload) } }],
  });
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
  return await import('../cvStructurer');
}

describe('createCvStructurer.structure — happy path (AC1, AC3, AC5)', () => {
  it('AC1+AC5: POSTs to https://openrouter.ai/api/v1/chat/completions with the default model and Bearer key', async () => {
    const { createCvStructurer } = await importModule();
    const fetchSpy = vi.fn().mockResolvedValue(chatResponse(SAMPLE_PARSED));
    const structurer = createCvStructurer({
      getApiKey: () => 'sk-or-v1-rawsecret1234',
      getDefaultModel: () => 'openai/gpt-4o-mini',
      fetch: fetchSpy as unknown as typeof fetch,
    });

    await structurer.structure('John Doe — Senior FE — Berlin');

    expect(fetchSpy).toHaveBeenCalledOnce();
    const [url, init] = fetchSpy.mock.calls[0]!;
    expect(url).toBe(OPENROUTER_CHAT_URL);
    expect((init as RequestInit).method).toBe('POST');
    const headers = (init as { headers: Record<string, string> }).headers;
    expect(headers.Authorization ?? headers.authorization).toBe(
      'Bearer sk-or-v1-rawsecret1234',
    );
    const body = JSON.parse((init as { body: string }).body) as {
      model: string;
      response_format: { type: string; json_schema?: unknown };
      messages: Array<{ role: string; content: string }>;
    };
    expect(body.model).toBe('openai/gpt-4o-mini');
    expect(body.response_format.type).toBe('json_schema');
    expect(body.response_format.json_schema).toBeTruthy();
    expect(body.messages.length).toBeGreaterThan(0);
    expect(body.messages.some((m) => m.content.includes('John Doe'))).toBe(true);
  });

  it('AC3: returns parsedFields + per-field & overall confidence', async () => {
    const { createCvStructurer } = await importModule();
    const structurer = createCvStructurer({
      getApiKey: () => 'sk-or-v1-rawsecret1234',
      getDefaultModel: () => 'openai/gpt-4o-mini',
      fetch: vi
        .fn()
        .mockResolvedValue(chatResponse(SAMPLE_PARSED)) as unknown as typeof fetch,
    });

    const result = await structurer.structure('full CV text…');
    expect(result.parsedFields).toBeTruthy();
    expect((result.parsedFields as { name: string }).name).toBe('Alex Morgan');
    expect((result.parsedFields as { skills: string[] }).skills).toEqual([
      'TypeScript',
      'Vue',
      'Node.js',
    ]);
    expect(result.confidence.overall).toBeCloseTo(0.82);
    expect(result.confidence.perField).toMatchObject({
      name: 0.95,
      targetRole: 0.7,
    });
  });

  it('AC1: only one outbound fetch is made (single-shot)', async () => {
    const { createCvStructurer } = await importModule();
    const fetchSpy = vi.fn().mockResolvedValue(chatResponse(SAMPLE_PARSED));
    const structurer = createCvStructurer({
      getApiKey: () => 'sk-or-v1-rawsecret1234',
      getDefaultModel: () => 'openai/gpt-4o-mini',
      fetch: fetchSpy as unknown as typeof fetch,
    });
    await structurer.structure('cv text');
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });
});

describe('createCvStructurer.structure — stable error codes (AC2, AC4, AC6)', () => {
  it('AC2: NO_API_KEY when no key is saved (structuring unavailable, not silent failure)', async () => {
    const { createCvStructurer, CvStructuringError } = await importModule();
    const fetchSpy = vi.fn();
    const structurer = createCvStructurer({
      getApiKey: () => null,
      getDefaultModel: () => 'openai/gpt-4o-mini',
      fetch: fetchSpy as unknown as typeof fetch,
    });
    await expect(structurer.structure('text')).rejects.toBeInstanceOf(
      CvStructuringError,
    );
    await expect(structurer.structure('text')).rejects.toMatchObject({
      code: 'NO_API_KEY',
    });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('AC2: NO_DEFAULT_MODEL when no default model is selected', async () => {
    const { createCvStructurer } = await importModule();
    const structurer = createCvStructurer({
      getApiKey: () => 'sk-or-v1-rawsecret1234',
      getDefaultModel: () => null,
      fetch: vi.fn() as unknown as typeof fetch,
    });
    await expect(structurer.structure('text')).rejects.toMatchObject({
      code: 'NO_DEFAULT_MODEL',
    });
  });

  it('EMPTY_TEXT when called with empty text', async () => {
    const { createCvStructurer } = await importModule();
    const structurer = createCvStructurer({
      getApiKey: () => 'sk-or-v1-rawsecret1234',
      getDefaultModel: () => 'openai/gpt-4o-mini',
      fetch: vi.fn() as unknown as typeof fetch,
    });
    await expect(structurer.structure('   ')).rejects.toMatchObject({
      code: 'EMPTY_TEXT',
    });
  });

  it('AUTH_ERROR on HTTP 401', async () => {
    const { createCvStructurer } = await importModule();
    const structurer = createCvStructurer({
      getApiKey: () => 'sk-or-v1-rawsecret1234',
      getDefaultModel: () => 'openai/gpt-4o-mini',
      fetch: vi
        .fn()
        .mockResolvedValue(
          mockResponse('Unauthorized', { status: 401 }),
        ) as unknown as typeof fetch,
    });
    await expect(structurer.structure('text')).rejects.toMatchObject({
      code: 'AUTH_ERROR',
    });
  });

  it('RATE_LIMITED on HTTP 429', async () => {
    const { createCvStructurer } = await importModule();
    const structurer = createCvStructurer({
      getApiKey: () => 'sk-or-v1-rawsecret1234',
      getDefaultModel: () => 'openai/gpt-4o-mini',
      fetch: vi
        .fn()
        .mockResolvedValue(
          mockResponse('rate limited', { status: 429 }),
        ) as unknown as typeof fetch,
    });
    await expect(structurer.structure('text')).rejects.toMatchObject({
      code: 'RATE_LIMITED',
    });
  });

  it('NETWORK_ERROR when fetch throws (degrades gracefully — AC6)', async () => {
    const { createCvStructurer } = await importModule();
    const structurer = createCvStructurer({
      getApiKey: () => 'sk-or-v1-rawsecret1234',
      getDefaultModel: () => 'openai/gpt-4o-mini',
      fetch: vi
        .fn()
        .mockRejectedValue(new TypeError('fetch failed')) as unknown as typeof fetch,
    });
    await expect(structurer.structure('text')).rejects.toMatchObject({
      code: 'NETWORK_ERROR',
    });
  });

  it('AC4: MODEL_NO_STRUCTURED_OUTPUT on HTTP 400 mentioning response_format / json_schema', async () => {
    const { createCvStructurer } = await importModule();
    const errBody = {
      error: {
        message:
          "This model does not support the 'response_format' json_schema parameter.",
      },
    };
    const structurer = createCvStructurer({
      getApiKey: () => 'sk-or-v1-rawsecret1234',
      getDefaultModel: () => 'some/unsupported-model',
      fetch: vi
        .fn()
        .mockResolvedValue(mockResponse(errBody, { status: 400 })) as unknown as typeof fetch,
    });
    await expect(structurer.structure('text')).rejects.toMatchObject({
      code: 'MODEL_NO_STRUCTURED_OUTPUT',
    });
  });

  it('HTTP_ERROR on other non-2xx (e.g. 500)', async () => {
    const { createCvStructurer } = await importModule();
    const structurer = createCvStructurer({
      getApiKey: () => 'sk-or-v1-rawsecret1234',
      getDefaultModel: () => 'openai/gpt-4o-mini',
      fetch: vi
        .fn()
        .mockResolvedValue(mockResponse('boom', { status: 500 })) as unknown as typeof fetch,
    });
    await expect(structurer.structure('text')).rejects.toMatchObject({
      code: 'HTTP_ERROR',
    });
  });

  it('BAD_RESPONSE when the choices payload is malformed', async () => {
    const { createCvStructurer } = await importModule();
    const structurer = createCvStructurer({
      getApiKey: () => 'sk-or-v1-rawsecret1234',
      getDefaultModel: () => 'openai/gpt-4o-mini',
      fetch: vi
        .fn()
        .mockResolvedValue(mockResponse({ no_choices: true })) as unknown as typeof fetch,
    });
    await expect(structurer.structure('text')).rejects.toMatchObject({
      code: 'BAD_RESPONSE',
    });
  });

  it('PARSE_ERROR when the model returns non-JSON content', async () => {
    const { createCvStructurer } = await importModule();
    const structurer = createCvStructurer({
      getApiKey: () => 'sk-or-v1-rawsecret1234',
      getDefaultModel: () => 'openai/gpt-4o-mini',
      fetch: vi.fn().mockResolvedValue(
        mockResponse({
          choices: [{ message: { content: 'totally not json' } }],
        }),
      ) as unknown as typeof fetch,
    });
    await expect(structurer.structure('text')).rejects.toMatchObject({
      code: 'PARSE_ERROR',
    });
  });
});

describe('registerCvStructuringIpc — IPC channel (AC1)', () => {
  it('registers the cv:structure handler', async () => {
    const { createCvStructurer, registerCvStructuringIpc } = await importModule();
    const structurer = createCvStructurer({
      getApiKey: () => 'sk-or-v1-rawsecret1234',
      getDefaultModel: () => 'openai/gpt-4o-mini',
      fetch: vi
        .fn()
        .mockResolvedValue(chatResponse(SAMPLE_PARSED)) as unknown as typeof fetch,
    });
    registerCvStructuringIpc(fakeIpcMain as never, structurer);
    expect(ipcHandlers.has('cv:structure')).toBe(true);
  });

  it('cv:structure returns { ok: true, parsedFields, confidence } on success', async () => {
    const { createCvStructurer, registerCvStructuringIpc } = await importModule();
    const structurer = createCvStructurer({
      getApiKey: () => 'sk-or-v1-rawsecret1234',
      getDefaultModel: () => 'openai/gpt-4o-mini',
      fetch: vi
        .fn()
        .mockResolvedValue(chatResponse(SAMPLE_PARSED)) as unknown as typeof fetch,
    });
    registerCvStructuringIpc(fakeIpcMain as never, structurer);
    const result = (await ipcHandlers.get('cv:structure')!({}, 'cv text')) as {
      ok: true;
      parsedFields: Record<string, unknown>;
      confidence: { overall: number; perField: Record<string, number> };
    };
    expect(result.ok).toBe(true);
    expect(result.parsedFields).toBeTruthy();
    expect(result.confidence.overall).toBeCloseTo(0.82);
  });

  it('cv:structure returns { ok: false, code, message } with stable codes on failure (AC6)', async () => {
    const { createCvStructurer, registerCvStructuringIpc } = await importModule();
    const structurer = createCvStructurer({
      getApiKey: () => null,
      getDefaultModel: () => null,
      fetch: vi.fn() as unknown as typeof fetch,
    });
    registerCvStructuringIpc(fakeIpcMain as never, structurer);
    const result = (await ipcHandlers.get('cv:structure')!({}, 'text')) as {
      ok: false;
      code: string;
      message: string;
    };
    expect(result.ok).toBe(false);
    expect(result.code).toBe('NO_API_KEY');
    expect(typeof result.message).toBe('string');
  });
});

describe('main process wiring', () => {
  it('createWindow registers the cv:structure IPC handler', () => {
    const main = readFileSync(
      path.join(ELECTRON_DIR, 'electron-main.ts'),
      'utf8',
    );
    expect(main).toMatch(/registerCvStructuringIpc/);
    const createWindowBlock = main.split('function createWindow')[1] ?? '';
    expect(createWindowBlock).toMatch(/registerCvStructuringIpc/);
  });

  it('main wires the structurer with apiKeyStore.getRawKey + preferredModels default', () => {
    const main = readFileSync(
      path.join(ELECTRON_DIR, 'electron-main.ts'),
      'utf8',
    );
    expect(main).toMatch(/createCvStructurer/);
    // The structurer must reuse Epic 2's existing key + model selection (AC2).
    expect(main).toMatch(/getApiKey:\s*\(\)\s*=>\s*apiKeyStore\.getRawKey/);
  });
});

describe('preload bridge', () => {
  it('exposes window.starCvStructurer with structure()', () => {
    const preload = readFileSync(
      path.join(ELECTRON_DIR, 'electron-preload.ts'),
      'utf8',
    );
    expect(preload).toMatch(/exposeInMainWorld\(\s*['"]starCvStructurer['"]/);
    expect(preload).toContain('cv:structure');
  });

  it('env.d.ts declares a matching Window.starCvStructurer type', () => {
    const envDts = readFileSync(path.join(SRC_DIR, 'env.d.ts'), 'utf8');
    expect(envDts).toMatch(/starCvStructurer\??:/);
    expect(envDts).toMatch(/structure\s*:/);
  });
});
