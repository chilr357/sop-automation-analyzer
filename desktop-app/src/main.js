const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { app, BrowserWindow, dialog, ipcMain } = require('electron');
const { autoUpdater } = require('electron-updater');
const log = require('electron-log');
const { analyzePdfAtPath } = require('./offline/offlineAnalyzer');
const { getOfflineResourcesStatus, installOfflineResources } = require('./offline/offlineResourcesInstaller');

if (require('electron-squirrel-startup')) {
  app.quit();
}

const isDev = process.env.NODE_ENV === 'development';
let mainWindow;
let shouldQuit = false;

const initAutoUpdater = () => {
  // electron-updater requires the app-update.yml produced by electron-builder.
  // Guard in dev so we don't spam errors when running against the Vite dev server.
  if (isDev) {
    return;
  }

  log.transports.file.level = 'info';
  autoUpdater.logger = log;
  autoUpdater.autoDownload = true;

  autoUpdater.on('error', (err) => {
    log.error('autoUpdater error', err);
  });

  autoUpdater.on('update-available', () => {
    log.info('Update available');
    mainWindow?.webContents.send('update:status', { status: 'available' });
  });

  autoUpdater.on('download-progress', (progress) => {
    mainWindow?.webContents.send('update:status', {
      status: 'downloading',
      percent: progress?.percent,
      bytesPerSecond: progress?.bytesPerSecond
    });
  });

  autoUpdater.on('update-downloaded', async () => {
    log.info('Update downloaded');
    mainWindow?.webContents.send('update:status', { status: 'downloaded' });

    if (!mainWindow) {
      autoUpdater.quitAndInstall();
      return;
    }

    const choice = await dialog.showMessageBox(mainWindow, {
      type: 'info',
      buttons: ['Restart now', 'Later'],
      defaultId: 0,
      cancelId: 1,
      title: 'Update ready',
      message: 'An update has been downloaded. Restart now to install it?'
    });

    if (choice.response === 0) {
      autoUpdater.quitAndInstall();
    }
  });
};

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
  initAutoUpdater();

  ipcMain.handle('app:getVersion', () => app.getVersion());
  ipcMain.handle('app:getName', () => app.getName());
  ipcMain.handle('app:getStartUrl', () => getStartUrl());
  ipcMain.handle('update:check', async () => {
    if (isDev) {
      return { ok: false, message: 'Updates are disabled in development.' };
    }
    const result = await autoUpdater.checkForUpdates();
    return { ok: true, result };
  });
  ipcMain.handle('update:quitAndInstall', async () => {
    if (isDev) {
      return { ok: false, message: 'Updates are disabled in development.' };
    }
    autoUpdater.quitAndInstall();
    return { ok: true };
  });

  ipcMain.handle('offline:status', async () => {
    return await getOfflineResourcesStatus();
  });

  ipcMain.handle('offline:install', async () => {
    const result = await installOfflineResources();
    return result;
  });

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
