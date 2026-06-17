// app-integration.ts
//
// Wires the renderer to the extraction graph and the job board.
// The "AI Extract" button triggers ai:extract, which crawls in a HIDDEN window that
// shares the user's logged-in session, then points the MCP browser tools at that window
// for the duration so the user's visible view is never disturbed.

import { ipcMain, BrowserWindow, type WebContents } from 'electron';
import { MultiServerMCPClient } from '@langchain/mcp-adapters';
import { ChatOpenAI } from '@langchain/openai';
import { createJobExtractor, type ExtractorDeps } from './extraction-graph.js';
import * as store from './job-board-store.js';

export function registerJobAgentIpc(opts: {
  getVisibleWebContents: () => WebContents;
  setActiveTarget: (wc: WebContents) => void; // points the MCP tools at a webContents
  mcpUrl: string;
}): void {
  let crawler: BrowserWindow | null = null;
  let ready: Promise<{ tools: ExtractorDeps['tools']; llm: ExtractorDeps['llm'] }> | null = null;

  // A hidden window on the default session => same cookies => the user's login carries over.
  function getCrawler(): BrowserWindow {
    if (crawler && !crawler.isDestroyed()) return crawler;
    crawler = new BrowserWindow({ show: false, width: 1280, height: 900 });
    return crawler;
  }

  async function buildDeps() {
    const client = new MultiServerMCPClient({
      mcpServers: { browser: { transport: 'http', url: opts.mcpUrl } },
    });
    const toolList = await client.getTools();
    const tools = Object.fromEntries(toolList.map((t: any) => [t.name, t])) as ExtractorDeps['tools'];
    const llm = new ChatOpenAI({
      model: process.env.AGENT_MODEL ?? 'anthropic/claude-3.5-sonnet', // tool-calling + vision capable
      apiKey: process.env.OPENROUTER_API_KEY,
      temperature: 0,
      configuration: { baseURL: 'https://openrouter.ai/api/v1' },
    }) as unknown as ExtractorDeps['llm'];
    return { tools, llm };
  }

  ipcMain.handle('ai:extract', async (event) => {
    const startUrl = opts.getVisibleWebContents().getURL(); // the listing the user filtered
    if (!ready) ready = buildDeps();
    const { tools, llm } = await ready;

    const onProgress = (p: unknown) => event.sender.send('extract:progress', p);
    const crawlerWin = getCrawler();
    opts.setActiveTarget(crawlerWin.webContents); // MCP tools now drive the hidden crawler
    try {
      const extractor = createJobExtractor({ tools, llm, store, onProgress, maxPages: 20 });
      const summary = await extractor.extract(startUrl);
      return { ok: true, summary };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      onProgress({ phase: 'error', message });
      return { ok: false, error: message };
    } finally {
      opts.setActiveTarget(opts.getVisibleWebContents()); // restore tools to the visible view
    }
  });

  // Job board IPC used by the renderer.
  ipcMain.handle('board:list', (_e, filter?: { status?: store.JobStatus; excludeStatus?: store.JobStatus }) =>
    store.listJobs(filter),
  );
  ipcMain.handle('board:setStatus', (_e, arg: { sourceId: string; status: store.JobStatus }) =>
    store.setStatus(arg.sourceId, arg.status),
  );
  // Open a job in the visible embedded browser (e.g. clicking a card in the board).
  ipcMain.handle('view:open', (_e, url: string) => {
    void opts.getVisibleWebContents().loadURL(url);
  });
}
