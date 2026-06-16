/**
 * Extraction runtime + IPC wiring (EXTR-006).
 *
 * Bridges the renderer's "Run AI Extraction" action to the LangGraph
 * extractor (EXTR-004) driven against a HIDDEN crawler webContents that
 * shares the Discover browser's partitioned session. The visible Discover
 * view is never repurposed for the run — we don't want the user to watch
 * the page being scrolled / paginated underneath them.
 *
 * IPC channels registered:
 *   ai:extract       — kicks off a run on the URL currently loaded in the
 *                      visible (Discover) browser. Returns
 *                      `{ ok: true, summary }` or `{ ok: false, error }`.
 *   board:list       — list job postings, optional status filter.
 *   board:setStatus  — flip a job posting's status (Saved / Applied / Hidden).
 *   view:open        — navigate the visible (Discover) browser to a URL.
 *
 * Progress events stream to the renderer via `extract:progress`.
 *
 * The OpenRouter client (ChatOpenAI pointed at https://openrouter.ai/api/v1)
 * and the MCP client (MultiServerMCPClient bound to the in-process MCP
 * browser server) are built lazily inside `buildDefaultExtractor`. The IPC
 * layer above is dependency-injected so the same orchestration can be unit
 * tested without dragging the langchain runtime into the test environment.
 */
import type { IpcMain, WebContents } from 'electron';
import {
  createJobExtractor,
  type BrowserSurface,
  type ProgressEvent,
  type StructuredLlm,
} from './jobExtractor';
import type { JobsStore, ListJobsFilter } from './jobs';

export interface ExtractRunSummary {
  imported: number;
  skipped: number;
  total: number;
  pages: number;
}

export type ExtractRunResult =
  | { ok: true; summary: ExtractRunSummary }
  | { ok: false; error: string };

export interface BuildExtractorInput {
  apiKey: string;
  model: string;
  crawler: WebContents;
  store: JobsStore;
  onProgress: (e: ProgressEvent) => void;
}

export interface BuiltExtractor {
  run(input: { searchUrl: string }): Promise<ExtractRunSummary>;
}

export interface ExtractionRuntimeDeps {
  store: JobsStore;
  /** Returns the visible (Discover) browser's webContents, or undefined if it has not been created yet. */
  getVisibleTarget: () => WebContents | undefined;
  /** Override the active MCP-tool target. `undefined` restores the default (the visible Discover view). */
  setActiveTarget: (wc: WebContents | undefined) => void;
  /** Lazily create the hidden crawler webContents (sharing the Discover partition). Reused across runs. */
  ensureCrawler: () => Promise<WebContents>;
  /** Navigate the visible (Discover) browser. Used by the `view:open` channel. */
  visibleNavigate: (url: string) => Promise<void>;
  /** Returns the decrypted OpenRouter API key, or null. */
  getApiKey: () => string | null;
  /** Returns the default OpenRouter model slug (LLM-003), or null. */
  getDefaultModel: () => string | null;
  /** Build the extractor (LLM + MCP client + BrowserSurface). Injectable for tests. */
  buildExtractor: (input: BuildExtractorInput) => Promise<BuiltExtractor>;
  /** Forward a progress event to the renderer (e.g. via webContents.send('extract:progress', e)). */
  emitProgress: (e: ProgressEvent) => void;
}

const FUNCTION_CALLING_HINTS = /(tool|function[- ]calling|function call|does not support|tools? are not supported|no tools)/i;

export function registerExtractionIpc(
  ipcMain: IpcMain,
  deps: ExtractionRuntimeDeps,
): void {
  ipcMain.handle('ai:extract', async (): Promise<ExtractRunResult> => {
    const visible = deps.getVisibleTarget();
    if (!visible) {
      return {
        ok: false,
        error: 'No active Discover browser to extract from. Open a job-site listing first.',
      };
    }
    let searchUrl = '';
    try {
      searchUrl = visible.getURL();
    } catch {
      searchUrl = '';
    }
    if (!searchUrl) {
      return { ok: false, error: 'The Discover browser has not loaded a listing URL yet.' };
    }
    const apiKey = (deps.getApiKey() ?? '').trim();
    if (!apiKey) {
      return {
        ok: false,
        error:
          'No OpenRouter API key configured. Add one under Settings → Connect an AI provider.',
      };
    }
    const model = (deps.getDefaultModel() ?? '').trim();
    if (!model) {
      return {
        ok: false,
        error:
          'No default model configured. Pick a default under Settings → Preferred models.',
      };
    }

    // AC1: switch tool calls to the hidden crawler for the duration of the
    // run, and ALWAYS restore the visible view in finally — even on error.
    const crawler = await deps.ensureCrawler();
    deps.setActiveTarget(crawler);
    try {
      const extractor = await deps.buildExtractor({
        apiKey,
        model,
        crawler,
        store: deps.store,
        onProgress: (e: ProgressEvent) => deps.emitProgress(e),
      });
      const summary = await extractor.run({ searchUrl });
      return { ok: true, summary };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (FUNCTION_CALLING_HINTS.test(message)) {
        return {
          ok: false,
          error:
            `Model "${model}" does not appear to support function calling. ` +
            'Pick a function-calling capable model under Settings → Preferred models.',
        };
      }
      return { ok: false, error: message };
    } finally {
      deps.setActiveTarget(undefined);
    }
  });

  ipcMain.handle('board:list', async (_event, filter?: ListJobsFilter) =>
    deps.store.listJobs(filter),
  );

  ipcMain.handle(
    'board:setStatus',
    async (_event, input: { sourceId: string; status: string }) => {
      if (!input || typeof input.sourceId !== 'string' || typeof input.status !== 'string') {
        throw new Error('board:setStatus expects { sourceId, status }');
      }
      deps.store.setStatus(input.sourceId, input.status);
      return { ok: true };
    },
  );

  ipcMain.handle('view:open', async (_event, url: string) => {
    if (typeof url !== 'string' || !url) {
      throw new Error('view:open expects a non-empty URL string');
    }
    await deps.visibleNavigate(url);
    return { ok: true };
  });
}

/**
 * BrowserSurface adapter that drives an Electron WebContents directly via
 * executeJavaScript — same JS the MCP tools use, but in-process. Used by
 * `buildDefaultExtractor` so the extractor can navigate the hidden crawler
 * without the MCP HTTP round-trip on the hot path.
 */
export function createWebContentsBrowserSurface(wc: WebContents): BrowserSurface {
  return {
    async navigate(url: string): Promise<void> {
      await wc.loadURL(url);
    },
    async queryAll({ selector, linkSelector, limit }) {
      const sel = JSON.stringify(selector);
      const linkSel = JSON.stringify(linkSelector ?? 'a');
      const lim = Math.max(1, Math.min(limit ?? 200, 5000));
      const code = `(() => {
        const out = [];
        const nodes = document.querySelectorAll(${sel});
        for (let i = 0; i < nodes.length && i < ${lim}; i++) {
          const el = nodes[i];
          const link = el.matches(${linkSel}) ? el : el.querySelector(${linkSel});
          out.push({
            text: (el.innerText || el.textContent || '').trim(),
            href: link && link.href ? link.href : '',
            html: el.outerHTML || '',
          });
        }
        return out;
      })()`;
      const rows = (await wc.executeJavaScript(code)) as Array<{
        text: string;
        href: string;
        html: string;
      }>;
      return rows ?? [];
    },
    async getText(selector?: string): Promise<string> {
      const sel = JSON.stringify(selector ?? 'body');
      const code = `(() => {
        const el = document.querySelector(${sel});
        return el ? (el.innerText || el.textContent || '') : '';
      })()`;
      const text = (await wc.executeJavaScript(code)) as string;
      return String(text ?? '');
    },
    async click(selector: string): Promise<void> {
      const sel = JSON.stringify(selector);
      const code = `(() => {
        const el = document.querySelector(${sel});
        if (!el) throw new Error('selector not found: ' + ${sel});
        el.click();
        return true;
      })()`;
      await wc.executeJavaScript(code);
    },
    async getOuterHtml(selector?: string): Promise<string> {
      const sel = JSON.stringify(selector ?? 'body');
      const code = `(() => {
        const el = document.querySelector(${sel});
        return el ? (el.outerHTML || '') : '';
      })()`;
      const html = (await wc.executeJavaScript(code)) as string;
      return String(html ?? '');
    },
  };
}

/**
 * Build the production extractor: ChatOpenAI pointed at OpenRouter (AC4),
 * a MultiServerMCPClient bound to the in-process MCP browser server (AC4),
 * and the EXTR-004 LangGraph extractor wired to a webContents-backed
 * BrowserSurface targeting the hidden crawler.
 *
 * Throws a `MODEL_NOT_FUNCTION_CALLING`-shaped error if the configured model
 * rejects withStructuredOutput at run time — the IPC layer maps that into a
 * clear renderer-facing message.
 */
export async function buildDefaultExtractor(
  input: BuildExtractorInput & { mcpUrl?: string },
): Promise<BuiltExtractor> {
  const { ChatOpenAI } = (await import('@langchain/openai')) as typeof import('@langchain/openai');
  // @langchain/mcp-adapters is only needed for the client; we don't actually
  // need its tools on the hot path (the BrowserSurface drives the crawler
  // directly), but AC4 requires the client to be constructed alongside the
  // LLM so a future graph can hand it to a tool-calling agent.
  let mcpClient: { close?: () => Promise<void> } | undefined;
  try {
    if (input.mcpUrl) {
      const adapters = (await import('@langchain/mcp-adapters')) as {
        MultiServerMCPClient: new (cfg: unknown) => { close?: () => Promise<void> };
      };
      mcpClient = new adapters.MultiServerMCPClient({
        mcpServers: {
          browser: { url: input.mcpUrl, transport: 'http' },
        },
      });
    }
  } catch {
    // MCP client construction failing must not abort the run — the extractor
    // doesn't depend on the MCP tools on the hot path. Log-and-continue.
    mcpClient = undefined;
  }

  const llm = new ChatOpenAI({
    model: input.model,
    apiKey: input.apiKey,
    configuration: { baseURL: 'https://openrouter.ai/api/v1' },
    temperature: 0,
  }) as unknown as StructuredLlm;

  const browser = createWebContentsBrowserSurface(input.crawler);
  const extractor = createJobExtractor({
    store: input.store,
    browser,
    llm,
    onProgress: input.onProgress,
  });

  return {
    async run(runInput) {
      try {
        return await extractor.run(runInput);
      } finally {
        try {
          await mcpClient?.close?.();
        } catch {
          /* swallow — best-effort cleanup */
        }
      }
    },
  };
}
