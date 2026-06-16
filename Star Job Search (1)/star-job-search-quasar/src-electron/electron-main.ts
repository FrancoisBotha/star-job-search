/**
 * Electron main process (used only when running `quasar dev -m electron`).
 * Opens the app in a frameless 1320×880 window — the design's native size —
 * with its own in-app title bar and window controls (see MainLayout.vue).
 */
import { app, BrowserWindow, Menu, ipcMain, safeStorage } from 'electron';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createJobBrowser } from './browser-surface';
import { createSitesStore, openSitesDatabase, registerSitesIpc } from './sites';
import { createApiKeyStore, registerApiKeyIpc } from './apiKey';
import { createLlmCatalogue, registerLlmCatalogueIpc } from './llmCatalogue';

const currentDir = fileURLToPath(new URL('.', import.meta.url));

// A focused single-window app — drop Electron's auto-generated
// File/Edit/View/Window menu bar so it doesn't read as a generic shell.
Menu.setApplicationMenu(null);

// Expose the renderer's DevTools protocol during development only.
if (process.env.DEV) {
  app.commandLine.appendSwitch('remote-debugging-port', '9222');
}

let mainWindow: BrowserWindow | undefined;

function createWindow() {
  mainWindow = new BrowserWindow({
    icon: path.resolve(currentDir, 'icons/icon.png'),
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
  createJobBrowser(mainWindow);

  // Wire the persisted job-sites store + IPC. The DB file lives under the
  // OS-standard userData dir so it survives app restarts (FR-002).
  const sitesDb = openSitesDatabase(path.join(app.getPath('userData'), 'star.db'));
  registerSitesIpc(ipcMain, createSitesStore(sitesDb));

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

void app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
  if (mainWindow === undefined) createWindow();
});
