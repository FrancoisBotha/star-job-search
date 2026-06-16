/**
 * Electron preload. Exposes safe, typed bridges to the renderer.
 * `starWindow` drives the custom (frameless) title-bar controls.
 * `starBrowser` drives the embedded job-site browser surface (BRWSR-001).
 * `starSites` drives the persisted job-sites list (BRWSR-002).
 * Future bridges (CV file picking, backup-folder selection, secure key
 * storage) belong here too.
 */
import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('starWindow', {
  minimize: () => ipcRenderer.send('window:minimize'),
  toggleMaximize: () => ipcRenderer.send('window:toggle-maximize'),
  close: () => ipcRenderer.send('window:close'),
  onMaximizedChange: (cb: (maximized: boolean) => void) => {
    ipcRenderer.on('window:maximized', (_event, maximized: boolean) => cb(maximized));
  },
});

interface JobBrowserBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

contextBridge.exposeInMainWorld('starBrowser', {
  create: () => ipcRenderer.invoke('job-browser:create'),
  navigate: (url: string) => ipcRenderer.invoke('job-browser:navigate', url),
  back: () => ipcRenderer.invoke('job-browser:back'),
  forward: () => ipcRenderer.invoke('job-browser:forward'),
  show: (visible: boolean) => ipcRenderer.invoke('job-browser:show', visible),
  setBounds: (bounds: JobBrowserBounds) =>
    ipcRenderer.invoke('job-browser:set-bounds', bounds),
});

interface AddSiteInput {
  url: string;
  label?: string;
}

contextBridge.exposeInMainWorld('starSites', {
  list: () => ipcRenderer.invoke('sites:list'),
  add: (input: AddSiteInput) => ipcRenderer.invoke('sites:add', input),
  remove: (id: string) => ipcRenderer.invoke('sites:remove', id),
});
