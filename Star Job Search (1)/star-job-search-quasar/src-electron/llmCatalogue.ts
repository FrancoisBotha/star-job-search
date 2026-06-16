/**
 * OpenRouter model catalogue module (LLM-002).
 *
 * Fetches `GET https://openrouter.ai/api/v1/models` from the main process,
 * authenticating with the user's saved OpenRouter API key (decrypted by the
 * apiKey module from LLM-001 — the raw key never crosses the IPC boundary).
 *
 * Failures surface as `LlmCatalogueError` with a stable `code` so the
 * renderer can map them to UX strings without parsing error messages:
 *   NO_API_KEY | AUTH_ERROR | RATE_LIMITED | NETWORK_ERROR | HTTP_ERROR | BAD_RESPONSE
 *
 * Successful results are cached and concurrent calls share a single in-flight
 * request, so the Settings dialog reopening does not refetch needlessly.
 */
import type { IpcMain } from 'electron';

export const OPENROUTER_MODELS_URL = 'https://openrouter.ai/api/v1/models';

export interface ModelInfo {
  id: string;
  name: string;
  contextLength: number;
  pricing: {
    prompt: string;
    completion: string;
  };
  created: number;
}

export type LlmCatalogueErrorCode =
  | 'NO_API_KEY'
  | 'AUTH_ERROR'
  | 'RATE_LIMITED'
  | 'NETWORK_ERROR'
  | 'HTTP_ERROR'
  | 'BAD_RESPONSE';

export class LlmCatalogueError extends Error {
  readonly code: LlmCatalogueErrorCode;
  constructor(code: LlmCatalogueErrorCode, message?: string) {
    super(message ?? code);
    this.name = 'LlmCatalogueError';
    this.code = code;
  }
}

export interface LlmCatalogueOptions {
  /** Returns the decrypted OpenRouter API key from the main-process store, or null. */
  getApiKey: () => string | null;
  /** Override for tests; defaults to the global `fetch`. */
  fetch?: typeof fetch;
}

export interface LlmCatalogue {
  listModels(): Promise<ModelInfo[]>;
  /** Drops the cached catalogue so the next call refetches. */
  invalidate(): void;
}

interface RawModel {
  id?: unknown;
  name?: unknown;
  context_length?: unknown;
  pricing?: { prompt?: unknown; completion?: unknown } | null;
  created?: unknown;
}

function parseModels(payload: unknown): ModelInfo[] {
  if (!payload || typeof payload !== 'object' || !Array.isArray((payload as { data?: unknown }).data)) {
    throw new LlmCatalogueError('BAD_RESPONSE', 'OpenRouter response missing "data" array');
  }
  const out: ModelInfo[] = [];
  for (const raw of (payload as { data: RawModel[] }).data) {
    if (!raw || typeof raw !== 'object') continue;
    const id = typeof raw.id === 'string' ? raw.id : null;
    if (!id) continue;
    const name = typeof raw.name === 'string' ? raw.name : id;
    const contextLength = typeof raw.context_length === 'number' ? raw.context_length : 0;
    const created = typeof raw.created === 'number' ? raw.created : 0;
    const pricing = raw.pricing ?? {};
    out.push({
      id,
      name,
      contextLength,
      pricing: {
        prompt: typeof pricing.prompt === 'string' ? pricing.prompt : '',
        completion: typeof pricing.completion === 'string' ? pricing.completion : '',
      },
      created,
    });
  }
  return out;
}

export function createLlmCatalogue(opts: LlmCatalogueOptions): LlmCatalogue {
  const { getApiKey } = opts;
  const doFetch: typeof fetch = opts.fetch ?? (globalThis.fetch as typeof fetch);

  let cached: ModelInfo[] | null = null;
  let inFlight: Promise<ModelInfo[]> | null = null;

  async function fetchModels(): Promise<ModelInfo[]> {
    const key = (getApiKey() ?? '').trim();
    if (!key) {
      throw new LlmCatalogueError('NO_API_KEY', 'No OpenRouter API key is saved');
    }

    let response: Response;
    try {
      response = await doFetch(OPENROUTER_MODELS_URL, {
        method: 'GET',
        headers: { Authorization: `Bearer ${key}` },
      });
    } catch (err) {
      throw new LlmCatalogueError(
        'NETWORK_ERROR',
        err instanceof Error ? err.message : 'Network error contacting OpenRouter',
      );
    }

    if (!response.ok) {
      const status = response.status;
      if (status === 401 || status === 403) {
        throw new LlmCatalogueError('AUTH_ERROR', `OpenRouter rejected the API key (HTTP ${status})`);
      }
      if (status === 429) {
        throw new LlmCatalogueError('RATE_LIMITED', 'OpenRouter rate-limited the catalogue request');
      }
      throw new LlmCatalogueError('HTTP_ERROR', `OpenRouter returned HTTP ${status}`);
    }

    let payload: unknown;
    try {
      payload = await response.json();
    } catch (err) {
      throw new LlmCatalogueError(
        'BAD_RESPONSE',
        err instanceof Error ? err.message : 'OpenRouter response was not valid JSON',
      );
    }

    return parseModels(payload);
  }

  return {
    async listModels(): Promise<ModelInfo[]> {
      if (cached) return cached;
      if (inFlight) return inFlight;
      inFlight = fetchModels()
        .then((models) => {
          cached = models;
          return models;
        })
        .finally(() => {
          inFlight = null;
        });
      return inFlight;
    },
    invalidate(): void {
      cached = null;
    },
  };
}

export interface ListModelsResult {
  ok: true;
  models: ModelInfo[];
}

export interface ListModelsError {
  ok: false;
  code: LlmCatalogueErrorCode;
  message: string;
}

/**
 * Register the `llm:listModels` IPC handler.
 *
 * The handler returns a tagged-union result so the renderer can branch on
 * the stable `code` without parsing exception messages: success returns
 * `{ ok: true, models }`, failure returns `{ ok: false, code, message }`.
 */
export function registerLlmCatalogueIpc(ipcMain: IpcMain, catalogue: LlmCatalogue): void {
  ipcMain.handle('llm:listModels', async (): Promise<ListModelsResult | ListModelsError> => {
    try {
      const models = await catalogue.listModels();
      return { ok: true, models };
    } catch (err) {
      if (err instanceof LlmCatalogueError) {
        return { ok: false, code: err.code, message: err.message };
      }
      return {
        ok: false,
        code: 'HTTP_ERROR',
        message: err instanceof Error ? err.message : 'Unknown error fetching model catalogue',
      };
    }
  });
}
