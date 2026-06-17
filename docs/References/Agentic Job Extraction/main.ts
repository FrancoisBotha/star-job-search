// main.ts -- Electron main process
//
// Layout: a left UI panel (board.html) + an embedded browser on the right.
// The MCP browser tools act on the "active target": normally the visible view,
// but the extraction flow retargets them to a hidden crawler window.

import { app, BrowserWindow, WebContentsView } from 'electron';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { startMcpHttpServer } from './mcp-browser-server.js';
import { registerExtractionTools } from './extraction-tools.js';
import { registerJobAgentIpc } from './app-integration.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ASSETS = path.join(__dirname, '..', 'src'); // dev: assets live in src/ (preload.cjs, renderer/)
const MCP_PORT = Number(process.env.MCP_PORT ?? 3100);
const PANEL_WIDTH = 380;

let mainWindow: BrowserWindow | null = null;
let listingView: WebContentsView | null = null;

// The MCP browser tools resolve this each call. Default = visible view; the extractor
// temporarily swaps it to a hidden crawler window.
let activeTarget: Electron.WebContents | null = null;
const getActiveTarget = (): Electron.WebContents => {
  const t = activeTarget ?? listingView?.webContents;
  if (!t) throw new Error('No active browser target yet');
  return t;
};
const setActiveTarget = (wc: Electron.WebContents) => {
  activeTarget = wc;
};

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1480,
    height: 900,
    title: 'Job Co-pilot',
    webPreferences: { preload: path.join(ASSETS, 'preload.cjs') },
  });
  mainWindow.loadFile(path.join(ASSETS, 'renderer', 'board.html'));

  // Embedded browser on the right; the left strip shows board.html underneath.
  listingView = new WebContentsView();
  mainWindow.contentView.addChildView(listingView);
  activeTarget = listingView.webContents;

  const layout = (): void => {
    if (!mainWindow || !listingView) return;
    const { width, height } = mainWindow.getContentBounds();
    listingView.setBounds({ x: PANEL_WIDTH, y: 0, width: Math.max(0, width - PANEL_WIDTH), height });
  };
  layout();
  mainWindow.on('resize', layout);

  // Start page — the user navigates to their job board, logs in, and filters from here.
  void listingView.webContents.loadURL('https://duckduckgo.com');

  mainWindow.on('closed', () => {
    mainWindow = null;
    listingView = null;
  });
}

app.whenReady().then(async () => {
  createWindow();

  await startMcpHttpServer({
    getWebContents: getActiveTarget,
    port: MCP_PORT,
    registerExtra: (server) => registerExtractionTools(server, getActiveTarget),
  });

  registerJobAgentIpc({
    getVisibleWebContents: () => {
      if (!listingView) throw new Error('No listing view');
      return listingView.webContents;
    },
    setActiveTarget,
    mcpUrl: `http://127.0.0.1:${MCP_PORT}/mcp`,
  });

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
