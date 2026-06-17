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
  setEnabled: (id: string, enabled: boolean) =>
    ipcRenderer.invoke('sites:setEnabled', { id, enabled }),
});

// Singleton Profile bridge (CVPROF-001). `get` returns the persisted Profile
// (or an empty default on first run); `save` upserts the edited fields and
// returns the updated Profile.
contextBridge.exposeInMainWorld('starProfile', {
  get: () => ipcRenderer.invoke('profile:get'),
  save: (input: unknown) => ipcRenderer.invoke('profile:save', input),
});

// Versioned CV bridge (CVPROF-003). `upload` copies the picked file under
// userData, extracts its text off-thread, and persists the new versioned CV
// record; `list` returns all versions for a profile (newest first); `get`
// loads a single version by id.
interface CvUploadInput {
  filePath: string;
  fileName: string;
  mime: 'pdf' | 'docx';
  profileId?: string;
}

contextBridge.exposeInMainWorld('starCv', {
  upload: (input: CvUploadInput) => ipcRenderer.invoke('cv:upload', input),
  list: (profileId?: string) => ipcRenderer.invoke('cv:list', profileId),
  get: (id: string) => ipcRenderer.invoke('cv:get', id),
});

// OpenRouter API key bridge (LLM-001). The raw key never crosses this
// boundary — save/getStatus return only { present, masked }.
contextBridge.exposeInMainWorld('starApiKey', {
  save: (rawKey: string) => ipcRenderer.invoke('apiKey:save', rawKey),
  getStatus: () => ipcRenderer.invoke('apiKey:getStatus'),
  clear: () => ipcRenderer.invoke('apiKey:clear'),
});

// OpenRouter model catalogue bridge (LLM-002). Returns a tagged-union result
// so the renderer can branch on the stable error code (NO_API_KEY / AUTH_ERROR
// / RATE_LIMITED / NETWORK_ERROR / HTTP_ERROR / BAD_RESPONSE).
contextBridge.exposeInMainWorld('starModels', {
  list: () => ipcRenderer.invoke('llm:listModels'),
});

// Preferred-models bridge (LLM-003). Each call returns the updated
// PreferredModel[] list; `add` returns a tagged union so the renderer can
// branch on EMPTY_SLUG / DUPLICATE / LIMIT_REACHED without losing the code.
contextBridge.exposeInMainWorld('starPreferredModels', {
  list: () => ipcRenderer.invoke('preferredModels:list'),
  add: (slug: string) => ipcRenderer.invoke('preferredModels:add', slug),
  remove: (slug: string) => ipcRenderer.invoke('preferredModels:remove', slug),
  setDefault: (slug: string) => ipcRenderer.invoke('preferredModels:setDefault', slug),
});

// Agentic extraction bridge (EXTR-006). `extract` kicks off an extraction
// run against whatever the visible Discover browser is currently showing
// and resolves to a tagged-union result. `onProgress` subscribes to
// `extract:progress` events streamed by the main process during the run.
interface ExtractProgressEvent {
  phase: string;
  [key: string]: unknown;
}

contextBridge.exposeInMainWorld('starExtract', {
  extract: () => ipcRenderer.invoke('ai:extract'),
  onProgress: (cb: (event: ExtractProgressEvent) => void) => {
    const listener = (_event: unknown, evt: ExtractProgressEvent) => cb(evt);
    ipcRenderer.on('extract:progress', listener);
    return () => ipcRenderer.removeListener('extract:progress', listener);
  },
});

// Job-board bridge (EXTR-006). `list` reads persisted jobs (optional status
// filter), `setStatus` flips a posting's status, `open` navigates the
// embedded Discover browser to a URL (used by job-detail click-throughs).
interface BoardListFilter {
  status?: string;
  excludeStatus?: string;
}

contextBridge.exposeInMainWorld('starBoard', {
  list: (filter?: BoardListFilter) => ipcRenderer.invoke('board:list', filter),
  setStatus: (input: { sourceId: string; status: string }) =>
    ipcRenderer.invoke('board:setStatus', input),
  open: (url: string) => ipcRenderer.invoke('view:open', url),
});
