const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { app, BrowserWindow, dialog, ipcMain } = require('electron');
const { analyzePdfAtPath } = require('./offline/offlineAnalyzer');

if (require('electron-squirrel-startup')) {
  app.quit();
}

const isDev = process.env.NODE_ENV === 'development';
let mainWindow;
let shouldQuit = false;

const getStartUrl = () => {
  if (isDev) {
    return process.env.ELECTRON_START_URL || 'http://localhost:5173';
  }
  const assetPath = path.join(__dirname, '..', 'assets', 'index.html');
  return pathToFileURL(assetPath).toString();
};

const createWindow = () => {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 800,
    minHeight: 600,
    title: 'Digital Process Automation Analyzer',
    show: false,
    icon: path.join(__dirname, '..', 'assets', 'icon.ico'),
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });

  mainWindow.center();

  // Load the React SPA directly (dev server in development, local file:// in production).
  // This allows the preload bridge APIs to be available to the app without an iframe wrapper.
  mainWindow.loadURL(getStartUrl());

  mainWindow.once('ready-to-show', () => {
    mainWindow?.show();
    if (isDev) {
      mainWindow.webContents.openDevTools({ mode: 'detach' });
    }
  });

  mainWindow.on('close', (event) => {
    if (shouldQuit) {
      return;
    }

    event.preventDefault();
    const choice = dialog.showMessageBoxSync(mainWindow, {
      type: 'question',
      buttons: ['Cancel', 'Quit'],
      defaultId: 1,
      cancelId: 0,
      title: 'Confirm Exit',
      message: 'Are you sure you want to exit the Digital Process Automation Analyzer?'
    });

    if (choice === 1) {
      shouldQuit = true;
      mainWindow.close();
    }
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
};

app.on('ready', () => {
  createWindow();

  ipcMain.handle('app:getVersion', () => app.getVersion());
  ipcMain.handle('app:getName', () => app.getName());
  ipcMain.handle('app:getStartUrl', () => getStartUrl());

  ipcMain.handle('util:pathToFileUrl', (_event, filePath) => {
    if (!filePath || typeof filePath !== 'string') {
      return null;
    }
    return pathToFileURL(filePath).toString();
  });

  ipcMain.handle('dialog:pickPdfFiles', async () => {
    if (!mainWindow) {
      return [];
    }

    const result = await dialog.showOpenDialog(mainWindow, {
      title: 'Select SOP PDFs',
      properties: ['openFile', 'multiSelections'],
      filters: [{ name: 'PDF Documents', extensions: ['pdf'] }]
    });

    if (result.canceled) {
      return [];
    }

    return result.filePaths.map((p) => ({
      path: p,
      name: path.basename(p),
      url: pathToFileURL(p).toString()
    }));
  });

  ipcMain.handle('analysis:analyzePdfPaths', async (_event, filePaths) => {
    if (!Array.isArray(filePaths)) {
      throw new Error('Invalid request: filePaths must be an array of strings.');
    }

    const results = await Promise.allSettled(
      filePaths.map(async (filePath) => {
        if (typeof filePath !== 'string' || filePath.length === 0) {
          throw new Error('Invalid file path.');
        }
        const report = await analyzePdfAtPath(filePath);
        return { filePath, report };
      })
    );

    return results.map((r, index) => {
      const filePath = filePaths[index];
      if (r.status === 'fulfilled') {
        return { ok: true, filePath, report: r.value.report };
      }
      const message = r.reason instanceof Error ? r.reason.message : 'An unexpected error occurred.';
      return { ok: false, filePath, error: message };
    });
  });

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
