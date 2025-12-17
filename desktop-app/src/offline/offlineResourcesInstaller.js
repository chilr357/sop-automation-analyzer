const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { spawn } = require('node:child_process');
const { app } = require('electron');

// Public URL to the offline pack zip (contains a top-level `resources/` folder).
// Can be overridden by setting OFFLINE_PACK_PUBLIC_URL at runtime.
const DEFAULT_OFFLINE_PACK_URL =
  'https://jnowuefcdsuphbvnozic.supabase.co/storage/v1/object/public/offline-packs/v1/offline-pack-generated.zip';

function getOfflinePackUrl() {
  return process.env.OFFLINE_PACK_PUBLIC_URL || DEFAULT_OFFLINE_PACK_URL;
}

function getUserOfflineResourcesDir() {
  // Store outside the app bundle so it survives auto-updates and stays writable.
  return path.join(app.getPath('userData'), 'offline-resources');
}

function getExpectedPaths(baseDir) {
  const platformKey = process.platform === 'darwin'
    ? (process.arch === 'arm64' ? 'mac-arm64' : 'mac-x64')
    : (process.platform === 'win32' ? 'win-x64' : `${process.platform}-${process.arch}`);

  const llamaBin = process.platform === 'win32' ? 'llama.exe' : 'llama';

  return {
    baseDir,
    modelPath: path.join(baseDir, 'models', 'model-8b-q4.gguf'),
    llamaPath: path.join(baseDir, 'llama', platformKey, llamaBin)
  };
}

async function getOfflineResourcesStatus() {
  const baseDir = getUserOfflineResourcesDir();
  const expected = getExpectedPaths(baseDir);

  const missing = [];
  if (!fs.existsSync(expected.modelPath)) missing.push(expected.modelPath);
  if (!fs.existsSync(expected.llamaPath)) missing.push(expected.llamaPath);

  return {
    installed: missing.length === 0,
    missing,
    baseDir,
    url: getOfflinePackUrl()
  };
}

function run(cmd, args, opts = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { stdio: 'inherit', ...opts });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) return resolve();
      reject(new Error(`${cmd} exited with code ${code}`));
    });
  });
}

async function downloadToFile(url, destPath) {
  await fsp.mkdir(path.dirname(destPath), { recursive: true });

  // Use curl on macOS/Linux; on Windows, use PowerShell for reliability.
  if (process.platform === 'win32') {
    await run('pwsh', [
      '-NoProfile',
      '-Command',
      `Invoke-WebRequest -Uri "${url}" -OutFile "${destPath}"`
    ]);
  } else {
    await run('curl', ['-L', '--fail', '--retry', '5', '--retry-delay', '2', '-o', destPath, url]);
  }
}

async function extractZip(zipPath, destDir) {
  await fsp.mkdir(destDir, { recursive: true });
  if (process.platform === 'win32') {
    await run('pwsh', [
      '-NoProfile',
      '-Command',
      `Expand-Archive -Force -Path "${zipPath}" -DestinationPath "${destDir}"`
    ]);
    return;
  }
  await run('unzip', ['-q', '-o', zipPath, '-d', destDir]);
}

async function installOfflineResources() {
  const status = await getOfflineResourcesStatus();
  if (status.installed) {
    return status;
  }

  const url = status.url;
  const tmpBase = await fsp.mkdtemp(path.join(os.tmpdir(), 'offline-pack-'));
  const zipPath = path.join(tmpBase, 'offline-pack.zip');
  const extractDir = path.join(tmpBase, 'extract');

  await downloadToFile(url, zipPath);
  await extractZip(zipPath, extractDir);

  const extractedResources = path.join(extractDir, 'resources');
  if (!fs.existsSync(extractedResources)) {
    throw new Error('Offline pack zip must contain a top-level resources/ folder.');
  }

  const userDir = getUserOfflineResourcesDir();
  await fsp.rm(userDir, { recursive: true, force: true });
  await fsp.mkdir(userDir, { recursive: true });

  // Copy extracted resources/* -> userDir/*
  await fsp.cp(extractedResources, userDir, { recursive: true });

  // Ensure mac binaries are executable if present
  if (process.platform !== 'win32') {
    const maybeLlama = getExpectedPaths(userDir).llamaPath;
    try {
      await fsp.chmod(maybeLlama, 0o755);
    } catch {
      // ignore
    }
  }

  return await getOfflineResourcesStatus();
}

module.exports = {
  DEFAULT_OFFLINE_PACK_URL,
  getOfflinePackUrl,
  getUserOfflineResourcesDir,
  getOfflineResourcesStatus,
  installOfflineResources
};


