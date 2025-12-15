const { contextBridge, ipcRenderer, shell } = require('electron');

contextBridge.exposeInMainWorld('desktopAPI', {
  getAppInfo: async () => ({
    name: await ipcRenderer.invoke('app:getName'),
    version: await ipcRenderer.invoke('app:getVersion')
  }),
  getStartUrl: () => ipcRenderer.invoke('app:getStartUrl'),
  pickPdfFiles: () => ipcRenderer.invoke('dialog:pickPdfFiles'),
  analyzePdfPaths: (filePaths) => ipcRenderer.invoke('analysis:analyzePdfPaths', filePaths),
  pathToFileUrl: (filePath) => ipcRenderer.invoke('util:pathToFileUrl', filePath),
  openExternal: (url) => {
    if (!url || typeof url !== 'string') {
      return;
    }
    shell.openExternal(url);
  }
});
