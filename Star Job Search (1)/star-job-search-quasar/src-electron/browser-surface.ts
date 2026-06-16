/**
 * Embedded job-site browser surface (BRWSR-001).
 *
 * Hosts an Electron BrowserView inside the app window so the user can view
 * public job sites without leaving Star. The view runs in a **partitioned
 * session** (`persist:job-browser`) so its cookies, storage, and JS are
 * isolated from the app renderer's default session — site state cannot reach
 * app data (NFR-001).
 *
 * Renderer talks to this surface via the preload-bridge channels:
 *   job-browser:create | navigate | back | forward | show | set-bounds
 */
import { BrowserView, type BrowserWindow, ipcMain } from 'electron';

export const JOB_BROWSER_PARTITION = 'persist:job-browser';

export interface JobBrowserBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

export function createJobBrowser(parent: BrowserWindow) {
  let view: BrowserView | undefined;
  let attached = false;

  const ensureView = (): BrowserView => {
    if (view) return view;
    view = new BrowserView({
      webPreferences: {
        partition: JOB_BROWSER_PARTITION,
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
      },
    });
    return view;
  };

  ipcMain.handle('job-browser:create', () => {
    ensureView();
    return true;
  });

  // loadURL is async — returning the promise keeps the main UI thread free
  // while the network fetch and render happen on the view's own pipeline
  // (NFR-003).
  ipcMain.handle('job-browser:navigate', (_event, url: string) => {
    return ensureView().webContents.loadURL(url);
  });

  ipcMain.handle('job-browser:back', () => {
    const wc = ensureView().webContents;
    if (wc.canGoBack()) wc.goBack();
  });

  ipcMain.handle('job-browser:forward', () => {
    const wc = ensureView().webContents;
    if (wc.canGoForward()) wc.goForward();
  });

  ipcMain.handle('job-browser:show', (_event, show: boolean) => {
    const v = ensureView();
    if (show && !attached) {
      parent.addBrowserView(v);
      attached = true;
    } else if (!show && attached) {
      parent.removeBrowserView(v);
      attached = false;
    }
  });

  ipcMain.handle('job-browser:set-bounds', (_event, bounds: JobBrowserBounds) => {
    ensureView().setBounds(bounds);
  });

  return {
    get view() {
      return view;
    },
    partition: JOB_BROWSER_PARTITION,
  };
}
