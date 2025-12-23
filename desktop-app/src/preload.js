const { contextBridge, ipcRenderer, shell } = require('electron');

contextBridge.exposeInMainWorld('desktopAPI', {
  getAppInfo: async () => ({
    name: await ipcRenderer.invoke('app:getName'),
    version: await ipcRenderer.invoke('app:getVersion')
  }),
  getStartUrl: () => ipcRenderer.invoke('app:getStartUrl'),
  pickPdfFiles: () => ipcRenderer.invoke('dialog:pickPdfFiles'),
  analyzePdfPaths: (filePaths) => ipcRenderer.invoke('analysis:analyzePdfPaths', filePaths),
  onAnalysisProgress: (callback) => {
    if (typeof callback !== 'function') return () => {};
    const handler = (_event, payload) => {
      try {
        callback(payload);
      } catch {
        // ignore
      }
    };
    ipcRenderer.on('analysis:progress', handler);
    return () => ipcRenderer.removeListener('analysis:progress', handler);
  },
  pathToFileUrl: (filePath) => ipcRenderer.invoke('util:pathToFileUrl', filePath),
  checkForUpdates: () => ipcRenderer.invoke('update:check'),
  quitAndInstallUpdate: () => ipcRenderer.invoke('update:quitAndInstall'),
  onUpdateStatus: (callback) => {
    if (typeof callback !== 'function') return () => {};
    const handler = (_event, payload) => {
      try {
        callback(payload);
      } catch {
        // ignore
      }
    };
    ipcRenderer.on('update:status', handler);
    return () => ipcRenderer.removeListener('update:status', handler);
  },
  getOfflineResourcesStatus: () => ipcRenderer.invoke('offline:status'),
  installOfflineResources: () => ipcRenderer.invoke('offline:install'),
  checkOfflinePackUpdates: () => ipcRenderer.invoke('offline:updateCheck'),
  installOfflinePackUpdate: () => ipcRenderer.invoke('offline:updateInstall'),
  onOfflinePackUpdateStatus: (callback) => {
    if (typeof callback !== 'function') return () => {};
    const handler = (_event, payload) => {
      try {
        callback(payload);
      } catch {
        // ignore
      }
    };
    ipcRenderer.on('offline:updateStatus', handler);
    return () => ipcRenderer.removeListener('offline:updateStatus', handler);
  },
  pickOfflinePackZip: () => ipcRenderer.invoke('dialog:pickOfflinePackZip'),
  installOfflineResourcesFromZip: (zipPath) => ipcRenderer.invoke('offline:installFromZip', zipPath),
  openExternal: (url) => {
    if (!url || typeof url !== 'string') {
      return;
    }
    shell.openExternal(url);
  }
});
