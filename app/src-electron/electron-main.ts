/**
 * Electron main process (used only when running `quasar dev -m electron`).
 * Opens the app in a frameless 1320×880 window — the design's native size —
 * with its own in-app title bar and window controls (see MainLayout.vue).
 */
import { app, BrowserWindow, Menu, ipcMain, safeStorage, type WebContents } from 'electron';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createJobBrowser, JOB_BROWSER_PARTITION } from './browser-surface';
import { createSitesStore, openSitesDatabase, registerSitesIpc } from './sites';
import { createProfileStore, registerProfileIpc } from './profile';
import { createApiKeyStore, registerApiKeyIpc } from './apiKey';
import { createLlmCatalogue, registerLlmCatalogueIpc } from './llmCatalogue';
import { createPreferredModelsStore, registerPreferredModelsIpc } from './preferredModels';
import { startMcpBrowserServer, type RunningMcpBrowserServer } from './mcp-browser-server';
import { createJobsStore } from './jobs';
import { buildDefaultExtractor, registerExtractionIpc } from './extraction';

const currentDir = fileURLToPath(new URL('.', import.meta.url));

// A focused single-window app — drop Electron's auto-generated
// File/Edit/View/Window menu bar so it doesn't read as a generic shell.
Menu.setApplicationMenu(null);

// Windows: give the app its own taskbar identity so it groups on its own and
// shows the Star icon instead of electron.exe's default.
if (process.platform === 'win32') app.setAppUserModelId('com.starjobsearch.app');

// Expose the renderer's DevTools protocol during development only.
if (process.env.DEV) {
  app.commandLine.appendSwitch('remote-debugging-port', '9222');
}

let mainWindow: BrowserWindow | undefined;

// Active-target seam (EXTR-001). Tool calls into the in-process MCP browser
// server resolve their target via getActiveTarget() so a later ticket can
// retarget to a hidden crawler webContents without changing tool definitions.
let jobBrowser: ReturnType<typeof createJobBrowser> | undefined;
let activeTargetOverride: WebContents | undefined;
let mcpBrowserServer: RunningMcpBrowserServer | undefined;
let crawlerWindow: BrowserWindow | undefined;

export function getActiveTarget(): WebContents | undefined {
  // Default: the Discover-tab embedded browser. Override wins when set.
  return activeTargetOverride ?? jobBrowser?.view?.webContents;
}

export function setActiveTarget(wc: WebContents | undefined): void {
  activeTargetOverride = wc;
}

function createWindow() {
  // Windows taskbar/title use the multi-res .ico; png elsewhere. In dev the
  // icons aren't copied next to the compiled main, so resolve them from the
  // src-electron source; a packaged build has them beside the main process.
  const iconName = process.platform === 'win32' ? 'icon.ico' : 'icon.png';
  const iconPath = process.env.DEV
    ? path.resolve(currentDir, '..', '..', 'src-electron', 'icons', iconName)
    : path.resolve(currentDir, 'icons', iconName);

  mainWindow = new BrowserWindow({
    icon: iconPath,
    width: 1320,
    height: 880,
    minWidth: 1000,
    minHeight: 700,
    useContentSize: true,
    // Frameless: the renderer paints the title bar and window controls,
    // so the chrome matches the app's design on every platform.
    frame: false,
    backgroundColor: '#f3f1ea',
    webPreferences: {
      contextIsolation: true,
      preload: path.resolve(
        currentDir,
        path.join(
          process.env.QUASAR_ELECTRON_PRELOAD_FOLDER!,
          'electron-preload' + process.env.QUASAR_ELECTRON_PRELOAD_EXTENSION,
        ),
      ),
    },
  });

  if (process.env.DEV) {
    void mainWindow.loadURL(process.env.APP_URL!);
  } else {
    void mainWindow.loadFile('index.html');
  }

  // Wire the embedded job-site browser surface (partitioned session,
  // preload-bridge channels). See src-electron/browser-surface.ts.
  jobBrowser = createJobBrowser(mainWindow);

  // Wire the persisted job-sites store + IPC. The DB file lives under the
  // OS-standard userData dir so it survives app restarts (FR-002).
  const sitesDb = openSitesDatabase(path.join(app.getPath('userData'), 'star.db'));
  registerSitesIpc(ipcMain, createSitesStore(sitesDb));

  // Wire the singleton Profile store + IPC (CVPROF-001). Reuses the shared
  // star.db handle; the store creates its own `profile` table on first run.
  registerProfileIpc(ipcMain, createProfileStore(sitesDb));

  // Wire the preferred-models store + IPC (LLM-003). Shares the star.db
  // handle opened above; the store creates its own `preferred_models` table
  // on first run and enforces the max-5 / single-default invariants.
  registerPreferredModelsIpc(ipcMain, createPreferredModelsStore(sitesDb));

  // Wire the OpenRouter API key store + IPC (LLM-001). The key is encrypted
  // with safeStorage and the blob lives next to the SQLite DB under userData.
  const apiKeyStore = createApiKeyStore({
    safeStorage,
    filePath: path.join(app.getPath('userData'), 'openrouter-key.bin'),
  });
  registerApiKeyIpc(ipcMain, apiKeyStore);

  // Wire the OpenRouter model catalogue + IPC (LLM-002). The catalogue reads
  // the decrypted key from the apiKey store, caches successful results, and
  // de-duplicates concurrent calls so reopening Settings doesn't refetch.
  const llmCatalogue = createLlmCatalogue({
    getApiKey: () => apiKeyStore.getRawKey(),
  });
  registerLlmCatalogueIpc(ipcMain, llmCatalogue);

  // Wire the agentic extraction runtime + IPC (EXTR-006). The jobs store is
  // backed by the same star.db handle used by sites / preferred-models. The
  // runtime drives a HIDDEN crawler webContents that shares the Discover
  // browser's partitioned session, so cookies / consent state carry over
  // without forcing the user to watch the page being scraped underneath
  // them. The active-target seam from EXTR-001 is used to retarget MCP tool
  // calls to the crawler for the duration of the run.
  const jobsStore = createJobsStore(sitesDb);
  const preferredModelsForExtraction = createPreferredModelsStore(sitesDb);
  const preloadPath = path.resolve(
    currentDir,
    path.join(
      process.env.QUASAR_ELECTRON_PRELOAD_FOLDER!,
      'electron-preload' + process.env.QUASAR_ELECTRON_PRELOAD_EXTENSION,
    ),
  );
  const ensureCrawler = async (): Promise<WebContents> => {
    if (crawlerWindow && !crawlerWindow.isDestroyed()) {
      return crawlerWindow.webContents;
    }
    crawlerWindow = new BrowserWindow({
      show: false,
      width: 1280,
      height: 900,
      webPreferences: {
        partition: JOB_BROWSER_PARTITION,
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        preload: preloadPath,
      },
    });
    crawlerWindow.on('closed', () => {
      crawlerWindow = undefined;
    });
    return crawlerWindow.webContents;
  };

  registerExtractionIpc(ipcMain, {
    store: jobsStore,
    getVisibleTarget: () => jobBrowser?.view?.webContents,
    setActiveTarget,
    ensureCrawler,
    visibleNavigate: async (url: string) => {
      const wc = jobBrowser?.view?.webContents;
      if (!wc) throw new Error('Discover browser is not initialised yet');
      await wc.loadURL(url);
    },
    getApiKey: () => apiKeyStore.getRawKey(),
    getDefaultModel: () => {
      const models = preferredModelsForExtraction.list();
      const def = models.find((m) => m.isDefault);
      return def?.slug ?? null;
    },
    buildExtractor: (input) =>
      buildDefaultExtractor({
        ...input,
        mcpUrl: mcpBrowserServer?.url,
      }),
    emitProgress: (e) => {
      mainWindow?.webContents.send('extract:progress', e);
    },
  });

  // Keep the renderer's maximize control in sync with the real window state.
  const emitMaximized = () =>
    mainWindow?.webContents.send('window:maximized', mainWindow.isMaximized());
  mainWindow.on('maximize', emitMaximized);
  mainWindow.on('unmaximize', emitMaximized);

  mainWindow.on('closed', () => {
    mainWindow = undefined;
  });
}

// Window-control IPC, driven by the in-app title bar.
ipcMain.on('window:minimize', () => mainWindow?.minimize());
ipcMain.on('window:toggle-maximize', () => {
  if (!mainWindow) return;
  if (mainWindow.isMaximized()) mainWindow.unmaximize();
  else mainWindow.maximize();
});
ipcMain.on('window:close', () => mainWindow?.close());

void app.whenReady().then(async () => {
  createWindow();
  // EXTR-001: bring up the in-process MCP browser server. Failure here must
  // never crash the app — startMcpBrowserServer catches and logs internally,
  // and we keep the optional return so close() can run on shutdown.
  mcpBrowserServer = await startMcpBrowserServer({ getActiveTarget });
});

app.on('will-quit', () => {
  void mcpBrowserServer?.close();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
  if (mainWindow === undefined) createWindow();
});
