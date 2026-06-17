// preload.cjs  (CommonJS on purpose — avoids ESM-preload caveats)
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('jobAgent', {
  extract: () => ipcRenderer.invoke('ai:extract'),
  listJobs: (filter) => ipcRenderer.invoke('board:list', filter),
  setStatus: (sourceId, status) => ipcRenderer.invoke('board:setStatus', { sourceId, status }),
  open: (url) => ipcRenderer.invoke('view:open', url),
  onProgress: (cb) => {
    const handler = (_event, payload) => cb(payload);
    ipcRenderer.on('extract:progress', handler);
    return () => ipcRenderer.removeListener('extract:progress', handler);
  },
});
