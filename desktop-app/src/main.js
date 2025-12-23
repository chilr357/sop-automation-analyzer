const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { app, BrowserWindow, dialog, ipcMain } = require('electron');
const { autoUpdater } = require('electron-updater');
const log = require('electron-log');
const { analyzePdfAtPath } = require('./offline/offlineAnalyzer');
const {
  getOfflineResourcesStatus,
  installOfflineResources,
  installOfflineResourcesFromZip,
  checkOfflinePackUpdate,
  updateOfflineResources
} = require('./offline/offlineResourcesInstaller');
const { hasOcrMyPdf } = require('./offline/ocrRunner');

if (require('electron-squirrel-startup')) {
  app.quit();
}

const isDev = process.env.NODE_ENV === 'development';
let mainWindow;
let shouldQuit = false;
let updateIntervalHandle = null;

const initAutoUpdater = () => {
  // electron-updater requires the app-update.yml produced by electron-builder.
  // Guard in dev so we don't spam errors when running against the Vite dev server.
  if (isDev) {
    return;
  }

  const sendUpdateStatus = (payload) => {
    try {
      mainWindow?.webContents.send('update:status', payload);
    } catch {
      // ignore
    }
  };

  log.transports.file.level = 'info';
  autoUpdater.logger = log;
  autoUpdater.autoDownload = true;

  autoUpdater.on('checking-for-update', () => {
    sendUpdateStatus({ status: 'checking' });
  });

  autoUpdater.on('error', (err) => {
    log.error('autoUpdater error', err);
    sendUpdateStatus({ status: 'error', message: err?.message || String(err) });
  });

  autoUpdater.on('update-available', () => {
    log.info('Update available');
    sendUpdateStatus({ status: 'available' });
  });

  autoUpdater.on('update-not-available', () => {
    sendUpdateStatus({ status: 'not-available' });
  });

  autoUpdater.on('download-progress', (progress) => {
    sendUpdateStatus({
      status: 'downloading',
      percent: progress?.percent,
      bytesPerSecond: progress?.bytesPerSecond
    });
  });

  autoUpdater.on('update-downloaded', async () => {
    log.info('Update downloaded');
    sendUpdateStatus({ status: 'downloaded' });

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

  // Auto-check on launch + periodically (production only).
  const check = async () => {
    try {
      await autoUpdater.checkForUpdatesAndNotify();
    } catch (e) {
      log.error('autoUpdater check failed', e);
      sendUpdateStatus({ status: 'error', message: e?.message || String(e) });
    }
  };

  // Initial check shortly after app start.
  setTimeout(check, 5_000);

  // Periodic checks (every 6 hours).
  if (!updateIntervalHandle) {
    updateIntervalHandle = setInterval(check, 6 * 60 * 60 * 1000);
  }
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
    try {
      mainWindow?.webContents.send('update:status', { status: 'checking' });
    } catch {
      // ignore
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

  ipcMain.handle('offline:checkUpdate', async () => {
    return await checkOfflinePackUpdate();
  });

  ipcMain.handle('offline:update', async () => {
    const send = (payload) => {
      try {
        mainWindow?.webContents.send('offline:updateStatus', payload);
      } catch {
        // ignore
      }
    };
    send({ status: 'checking' });
    const res = await updateOfflineResources({
      onProgress: (p) => send({ ...p })
    });
    return res;
  });

  ipcMain.handle('offline:installFromZip', async (_event, zipPath) => {
    const result = await installOfflineResourcesFromZip(zipPath);
    return result;
  });

  ipcMain.handle('offline:ocrToolsStatus', async () => {
    const installUrl = 'https://ocrmypdf.readthedocs.io/en/latest/installation.html';
    try {
      const available = await hasOcrMyPdf();
      return { ok: true, available, installUrl };
    } catch (e) {
      return { ok: false, available: false, installUrl, message: e instanceof Error ? e.message : String(e) };
    }
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

  ipcMain.handle('dialog:pickOfflinePackZip', async () => {
    if (!mainWindow) {
      return null;
    }

    const result = await dialog.showOpenDialog(mainWindow, {
      title: 'Select Offline Pack Zip',
      properties: ['openFile'],
      filters: [{ name: 'Offline Pack (zip)', extensions: ['zip'] }]
    });

    if (result.canceled || result.filePaths.length === 0) {
      return null;
    }

    return result.filePaths[0];
  });

  ipcMain.handle('analysis:analyzePdfPaths', async (_event, filePaths) => {
    if (!Array.isArray(filePaths)) {
      throw new Error('Invalid request: filePaths must be an array of strings.');
    }

    const send = (payload) => {
      try {
        mainWindow?.webContents.send('analysis:progress', payload);
      } catch {
        // ignore
      }
    };

    const total = filePaths.length || 1;
    const out = [];

    for (let i = 0; i < filePaths.length; i++) {
      const filePath = filePaths[i];
      if (typeof filePath !== 'string' || filePath.length === 0) {
        out.push({ ok: false, filePath: String(filePath), error: 'Invalid file path.' });
        continue;
      }

      send({ status: 'starting', filePath, fileIndex: i + 1, fileCount: total, percent: Math.round((i / total) * 100) });

      try {
        const report = await analyzePdfAtPath(filePath, {
          onProgress: (p) => {
            const filePct = typeof p?.percent === 'number' ? p.percent : 0;
            const overall = ((i + filePct / 100) / total) * 100;
            send({
              status: 'progress',
              filePath,
              fileIndex: i + 1,
              fileCount: total,
              stage: p?.stage,
              message: p?.message,
              percent: Math.max(0, Math.min(99, Math.round(overall))),
              filePercent: Math.max(0, Math.min(100, Math.round(filePct))),
              tokens: p?.tokens,
              targetTokens: p?.targetTokens
            });
          }
        });
        out.push({ ok: true, filePath, report });
      } catch (e) {
        const message = e instanceof Error ? e.message : 'An unexpected error occurred.';
        out.push({ ok: false, filePath, error: message });
      }
    }

    send({ status: 'done', percent: 100 });
    return out;
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
