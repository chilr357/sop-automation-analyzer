const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const https = require('node:https');
const crypto = require('node:crypto');
const { getUserOfflineResourcesDir } = require('./offlineResourcesInstaller');

// Manifest approach (delta updates):
// - Host a JSON manifest in Supabase public storage
// - Each file referenced by the manifest is also publicly accessible
//
// Manifest shape:
// {
//   "version": "2025-12-23.1",
//   "baseUrl": "https://.../storage/v1/object/public/offline-packs/v1/resources",
//   "files": [{ "path": "models/model-8b-q4.gguf", "sha256": "...", "size": 123 }]
// }
const DEFAULT_OFFLINE_PACK_MANIFEST_URL =
  'https://jnowuefcdsuphbvnozic.supabase.co/storage/v1/object/public/offline-packs/v1/manifest.json';

function getOfflinePackManifestUrl() {
  return process.env.OFFLINE_PACK_MANIFEST_PUBLIC_URL || DEFAULT_OFFLINE_PACK_MANIFEST_URL;
}

function httpGetBuffer(url) {
  return new Promise((resolve, reject) => {
    https.get(url, (res) => {
      if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        return resolve(httpGetBuffer(res.headers.location));
      }
      if (res.statusCode !== 200) {
        return reject(new Error(`HTTP ${res.statusCode} for ${url}`));
      }
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve(Buffer.concat(chunks)));
    }).on('error', reject);
  });
}

async function fetchRemoteManifest() {
  const url = getOfflinePackManifestUrl();
  const buf = await httpGetBuffer(url);
  const json = JSON.parse(buf.toString('utf8'));
  if (!json || typeof json !== 'object' || !json.version || !json.baseUrl || !Array.isArray(json.files)) {
    throw new Error('Invalid offline pack manifest format.');
  }
  return { url, manifest: json };
}

async function readLocalManifest(baseDir) {
  const p = path.join(baseDir, 'manifest.json');
  try {
    const raw = await fsp.readFile(p, 'utf8');
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

async function sha256File(filePath) {
  return await new Promise((resolve, reject) => {
    const h = crypto.createHash('sha256');
    const stream = fs.createReadStream(filePath);
    stream.on('data', (c) => h.update(c));
    stream.on('error', reject);
    stream.on('end', () => resolve(h.digest('hex')));
  });
}

async function checkOfflinePackUpdates() {
  const baseDir = getUserOfflineResourcesDir();
  const local = await readLocalManifest(baseDir);

  // If not installed, updater still works (it will download everything).
  const { url, manifest: remote } = await fetchRemoteManifest();

  const localVersion = local?.version || null;
  const remoteVersion = remote.version;

  // Determine which files are missing or changed.
  const toUpdate = [];
  for (const f of remote.files) {
    if (!f?.path || !f?.sha256) continue;
    const dest = path.join(baseDir, f.path);
    if (!fs.existsSync(dest)) {
      toUpdate.push({ ...f, dest });
      continue;
    }
    try {
      const digest = await sha256File(dest);
      if (digest !== f.sha256) {
        toUpdate.push({ ...f, dest });
      }
    } catch {
      toUpdate.push({ ...f, dest });
    }
  }

  return {
    ok: true,
    baseDir,
    manifestUrl: url,
    localVersion,
    remoteVersion,
    updateAvailable: toUpdate.length > 0 || localVersion !== remoteVersion,
    filesToUpdate: toUpdate.map((x) => ({ path: x.path, size: x.size || null }))
  };
}

function downloadToFileWithProgress(url, destPath, onProgress) {
  return new Promise((resolve, reject) => {
    const dir = path.dirname(destPath);
    fs.mkdirSync(dir, { recursive: true });

    https.get(url, (res) => {
      if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        return resolve(downloadToFileWithProgress(res.headers.location, destPath, onProgress));
      }
      if (res.statusCode !== 200) {
        return reject(new Error(`HTTP ${res.statusCode} for ${url}`));
      }
      const total = Number(res.headers['content-length'] || 0);
      let received = 0;
      const file = fs.createWriteStream(destPath);
      res.on('data', (chunk) => {
        received += chunk.length;
        onProgress?.({ receivedBytes: received, totalBytes: total || undefined });
      });
      res.pipe(file);
      file.on('finish', () => file.close(() => resolve()));
      file.on('error', reject);
    }).on('error', reject);
  });
}

async function applyOfflinePackUpdate({ onStatus } = {}) {
  const baseDir = getUserOfflineResourcesDir();
  const local = await readLocalManifest(baseDir);
  const { manifest: remote } = await fetchRemoteManifest();

  // Build list of files to download (missing or changed)
  const tasks = [];
  for (const f of remote.files) {
    if (!f?.path || !f?.sha256) continue;
    const dest = path.join(baseDir, f.path);
    let needs = true;
    if (fs.existsSync(dest)) {
      try {
        const digest = await sha256File(dest);
        needs = digest !== f.sha256;
      } catch {
        needs = true;
      }
    }
    if (needs) tasks.push({ ...f, dest });
  }

  const totalBytes = tasks.reduce((sum, t) => sum + (t.size || 0), 0) || undefined;
  let doneBytes = 0;

  onStatus?.({ status: 'downloading', percent: 0 });
  await fsp.mkdir(baseDir, { recursive: true });

  for (let i = 0; i < tasks.length; i++) {
    const t = tasks[i];
    const url = `${remote.baseUrl.replace(/\/$/, '')}/${t.path.replace(/^\//, '')}`;
    const fileBaseDone = doneBytes;

    onStatus?.({ status: 'file', filePath: t.path, index: i + 1, totalFiles: tasks.length });
    await downloadToFileWithProgress(url, t.dest, ({ receivedBytes, totalBytes: fileTotal }) => {
      const current = fileBaseDone + receivedBytes;
      const denom = totalBytes || (fileTotal ? fileBaseDone + fileTotal : undefined);
      const pct = denom ? Math.min(99, Math.floor((current / denom) * 100)) : undefined;
      onStatus?.({ status: 'downloading', percent: pct, receivedBytes: current, totalBytes: denom });
    });

    // Verify hash
    const digest = await sha256File(t.dest);
    if (digest !== t.sha256) {
      throw new Error(`Offline pack update failed integrity check for ${t.path}`);
    }
    doneBytes += (t.size || 0);
  }

  // Write manifest.json locally so future checks work.
  await fsp.writeFile(path.join(baseDir, 'manifest.json'), JSON.stringify(remote, null, 2), 'utf8');

  onStatus?.({ status: 'done', percent: 100, localVersion: local?.version || null, remoteVersion: remote.version });
  return { ok: true, baseDir, version: remote.version };
}

module.exports = { getOfflinePackManifestUrl, checkOfflinePackUpdates, applyOfflinePackUpdate };


