const { contextBridge, ipcRenderer, shell } = require('electron');

contextBridge.exposeInMainWorld('desktopAPI', {
  getAppInfo: async () => ({
    name: await ipcRenderer.invoke('app:getName'),
    version: await ipcRenderer.invoke('app:getVersion')
  }),
  getStartUrl: () => ipcRenderer.invoke('app:getStartUrl'),
  openExternal: (url) => {
    if (!url || typeof url !== 'string') {
      return;
    }
    shell.openExternal(url);
  }
});
