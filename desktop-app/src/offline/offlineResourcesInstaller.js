const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { spawn } = require('node:child_process');
const { app } = require('electron');
const https = require('node:https');

// Public URL to the offline pack zip (contains a top-level `resources/` folder).
// Can be overridden by setting OFFLINE_PACK_PUBLIC_URL at runtime.
const DEFAULT_OFFLINE_PACK_URL =
  'https://jnowuefcdsuphbvnozic.supabase.co/storage/v1/object/public/offline-packs/v1/offline-pack-generated.zip';

// Optional: manifest URL used for versioning + incremental component updates.
const DEFAULT_OFFLINE_PACK_MANIFEST_URL =
  'https://jnowuefcdsuphbvnozic.supabase.co/storage/v1/object/public/offline-packs/v1/manifest.json';

function getOfflinePackUrl() {
  return process.env.OFFLINE_PACK_PUBLIC_URL || DEFAULT_OFFLINE_PACK_URL;
}

function getOfflinePackManifestUrl() {
  return process.env.OFFLINE_PACK_MANIFEST_URL || DEFAULT_OFFLINE_PACK_MANIFEST_URL;
}

function getUserOfflineResourcesDir() {
  // Store outside the app bundle so it survives auto-updates and stays writable.
  return path.join(app.getPath('userData'), 'offline-resources');
}

function getInstalledManifestPath(baseDir) {
  return path.join(baseDir, '.offline-pack.manifest.json');
}

function getExpectedPaths(baseDir) {
  const platformKey = process.platform === 'darwin'
    ? (process.arch === 'arm64' ? 'mac-arm64' : 'mac-x64')
    : (process.platform === 'win32' ? 'win-x64' : `${process.platform}-${process.arch}`);

  const llamaBin = process.platform === 'win32' ? 'llama.exe' : 'llama';
  const ocrBin = process.platform === 'win32' ? 'ocrmypdf.exe' : 'ocrmypdf';

  return {
    baseDir,
    modelPath: path.join(baseDir, 'models', 'model-8b-q4.gguf'),
    llamaPath: path.join(baseDir, 'llama', platformKey, llamaBin),
    ocrMyPdfPath: path.join(baseDir, 'tools', 'ocr', platformKey, ocrBin)
  };
}

async function readJsonFile(filePath) {
  const raw = await fsp.readFile(filePath, 'utf8');
  return JSON.parse(raw);
}

async function writeJsonFile(filePath, data) {
  await fsp.mkdir(path.dirname(filePath), { recursive: true });
  await fsp.writeFile(filePath, JSON.stringify(data, null, 2), 'utf8');
}

async function getOfflineResourcesStatus() {
  const baseDir = getUserOfflineResourcesDir();
  const expected = getExpectedPaths(baseDir);

  const missing = [];
  if (!fs.existsSync(expected.modelPath)) missing.push(expected.modelPath);
  if (!fs.existsSync(expected.llamaPath)) missing.push(expected.llamaPath);

  let installedManifest = null;
  try {
    const manifestPath = getInstalledManifestPath(baseDir);
    if (fs.existsSync(manifestPath)) {
      installedManifest = await readJsonFile(manifestPath);
    }
  } catch {
    // ignore
  }

  return {
    installed: missing.length === 0,
    missing,
    baseDir,
    url: getOfflinePackUrl(),
    manifestUrl: getOfflinePackManifestUrl(),
    installedPackVersion: installedManifest?.version || null
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

function getWindowsPowerShellExe() {
  // Prefer built-in Windows PowerShell (present on essentially all Windows installs).
  const systemRoot = process.env.SystemRoot || 'C:\\Windows';
  const full = path.join(systemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
  if (fs.existsSync(full)) {
    return full;
  }
  // Fallback to PATH lookup.
  return 'powershell.exe';
}

function psQuote(value) {
  // Single-quote for PowerShell; escape single quotes by doubling them.
  return `'${String(value).replace(/'/g, "''")}'`;
}

function buildWindowsDownloadWithProgressCommand(url, destPath) {
  const uri = psQuote(url);
  const out = psQuote(destPath);
  // Stream download so we can compute progress + ETA without relying on PowerShell 7.
  return [
    "$ErrorActionPreference='Stop'",
    `$uri=${uri}`,
    `$out=${out}`,
    '$req=[System.Net.HttpWebRequest]::Create($uri)',
    "$req.Method='GET'",
    '$resp=$req.GetResponse()',
    '$total=$resp.ContentLength',
    '$stream=$resp.GetResponseStream()',
    '$fs=[System.IO.File]::Open($out,[System.IO.FileMode]::Create)',
    '$buffer=New-Object byte[] 65536',
    '$readTotal=0',
    '$sw=[System.Diagnostics.Stopwatch]::StartNew()',
    'try {',
    '  while(($read=$stream.Read($buffer,0,$buffer.Length)) -gt 0) {',
    '    $fs.Write($buffer,0,$read)',
    '    $readTotal += $read',
    '    if($total -gt 0) {',
    '      $pct=[math]::Floor(($readTotal/$total)*100)',
    '      $speed= if($sw.Elapsed.TotalSeconds -gt 0) { $readTotal / $sw.Elapsed.TotalSeconds } else { 0 }',
    '      $remaining=$total-$readTotal',
    '      $eta= if($speed -gt 0) { [math]::Round($remaining/$speed) } else { 0 }',
    "      $status=('{0}% ({1:N1} MB / {2:N1} MB) ETA {3}s' -f $pct, ($readTotal/1MB), ($total/1MB), $eta)",
    "      Write-Progress -Activity 'Downloading Offline Pack' -Status $status -PercentComplete $pct",
    '    } else {',
    "      Write-Progress -Activity 'Downloading Offline Pack' -Status ('Downloaded {0:N1} MB' -f ($readTotal/1MB))",
    '    }',
    '  }',
    '} finally {',
    "  Write-Progress -Activity 'Downloading Offline Pack' -Completed",
    '  if($fs) { $fs.Close() }',
    '  if($stream) { $stream.Close() }',
    '  if($resp) { $resp.Close() }',
    '}'
  ].join('; ');
}

async function runWindowsPowerShell(command) {
  const ps = getWindowsPowerShellExe();
  await run(ps, ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', command]);
}

function httpGetFollow(url, maxRedirects = 5) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, (res) => {
      const code = res.statusCode || 0;
      const loc = res.headers.location;
      if (code >= 300 && code < 400 && loc && maxRedirects > 0) {
        res.resume();
        const next = loc.startsWith('http') ? loc : new URL(loc, url).toString();
        return resolve(httpGetFollow(next, maxRedirects - 1));
      }
      if (code < 200 || code >= 300) {
        const err = new Error(`Download failed: HTTP ${code}`);
        res.resume();
        return reject(err);
      }
      resolve({ res });
    });
    req.on('error', reject);
  });
}

async function downloadToFileNode(url, destPath, onProgress) {
  await fsp.mkdir(path.dirname(destPath), { recursive: true });
  const { res } = await httpGetFollow(url);
  const total = Number(res.headers['content-length'] || 0) || 0;
  const out = fs.createWriteStream(destPath);
  let downloaded = 0;
  await new Promise((resolve, reject) => {
    res.on('data', (chunk) => {
      downloaded += chunk.length;
      if (typeof onProgress === 'function' && total > 0) {
        try {
          onProgress({ downloadedBytes: downloaded, totalBytes: total, percent: (downloaded / total) * 100 });
        } catch {
          // ignore
        }
      }
    });
    res.pipe(out);
    out.on('finish', resolve);
    out.on('error', reject);
    res.on('error', reject);
  });
}

async function downloadToFile(url, destPath, opts = {}) {
  await fsp.mkdir(path.dirname(destPath), { recursive: true });
  const { onProgress } = opts;

  // Prefer Node streaming so we can surface progress in-app. Fall back to platform tools if needed.
  try {
    await downloadToFileNode(url, destPath, onProgress);
    return;
  } catch {
    // ignore and fall back
  }

  if (process.platform === 'win32') {
    await runWindowsPowerShell(buildWindowsDownloadWithProgressCommand(url, destPath));
    return;
  }
  await run('curl', ['-L', '--fail', '--retry', '5', '--retry-delay', '2', '-o', destPath, url]);
}

async function extractZip(zipPath, destDir) {
  await fsp.mkdir(destDir, { recursive: true });
  if (process.platform === 'win32') {
    await runWindowsPowerShell(`Expand-Archive -Force -Path "${zipPath}" -DestinationPath "${destDir}"`);
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

async function installOfflineResourcesFromZip(zipPath) {
  if (!zipPath || typeof zipPath !== 'string') {
    throw new Error('Invalid zip path.');
  }
  if (!fs.existsSync(zipPath)) {
    throw new Error(`Offline pack zip not found: ${zipPath}`);
  }

  const tmpBase = await fsp.mkdtemp(path.join(os.tmpdir(), 'offline-pack-'));
  const extractDir = path.join(tmpBase, 'extract');

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

async function fetchJson(url) {
  const { res } = await httpGetFollow(url);
  const chunks = [];
  await new Promise((resolve, reject) => {
    res.on('data', (c) => chunks.push(c));
    res.on('end', resolve);
    res.on('error', reject);
  });
  const text = Buffer.concat(chunks).toString('utf8');
  return JSON.parse(text);
}

function getPlatformKey() {
  return process.platform === 'darwin'
    ? (process.arch === 'arm64' ? 'mac-arm64' : 'mac-x64')
    : (process.platform === 'win32' ? 'win-x64' : `${process.platform}-${process.arch}`);
}

function pickComponentPackage(component) {
  if (!component || typeof component !== 'object') return null;
  if (component.platforms && typeof component.platforms === 'object') {
    return component.platforms[getPlatformKey()] || null;
  }
  return component;
}

async function checkOfflinePackUpdates() {
  const status = await getOfflineResourcesStatus();
  let remote = null;
  try {
    remote = await fetchJson(status.manifestUrl);
  } catch (e) {
    return { ok: false, message: `Failed to fetch offline pack manifest: ${e?.message || String(e)}` };
  }

  const installedManifestPath = getInstalledManifestPath(status.baseDir);
  let installed = null;
  try {
    if (fs.existsSync(installedManifestPath)) installed = await readJsonFile(installedManifestPath);
  } catch {
    // ignore
  }

  const remoteVersion = remote?.version || null;
  const installedVersion = installed?.version || status.installedPackVersion || null;

  const components = remote?.components && typeof remote.components === 'object' ? remote.components : {};
  const installedComponents = installed?.components && typeof installed.components === 'object' ? installed.components : {};

  const toUpdate = [];
  for (const [name, comp] of Object.entries(components)) {
    const pkg = pickComponentPackage(comp);
    if (!pkg?.url) continue;
    const targetVersion = pkg.version || comp.version || remoteVersion || null;
    const haveVersion = installedComponents?.[name]?.version || null;
    if (!haveVersion || (targetVersion && haveVersion !== targetVersion)) {
      toUpdate.push({ name, url: pkg.url, version: targetVersion });
    }
  }

  const updateAvailable = !!remoteVersion && remoteVersion !== installedVersion;
  return {
    ok: true,
    installedVersion,
    remoteVersion,
    updateAvailable,
    toUpdate,
    manifestUrl: status.manifestUrl
  };
}

async function applyExtractedResources(extractDir, destDir) {
  const extractedResources = path.join(extractDir, 'resources');
  if (!fs.existsSync(extractedResources)) {
    throw new Error('Offline component zip must contain a top-level resources/ folder.');
  }
  await fsp.mkdir(destDir, { recursive: true });
  await fsp.cp(extractedResources, destDir, { recursive: true, force: true });

  // Ensure mac binaries are executable if present
  if (process.platform !== 'win32') {
    const maybeLlama = getExpectedPaths(destDir).llamaPath;
    try {
      await fsp.chmod(maybeLlama, 0o755);
    } catch {
      // ignore
    }
    const maybeOcr = getExpectedPaths(destDir).ocrMyPdfPath;
    try {
      if (fs.existsSync(maybeOcr)) {
        await fsp.chmod(maybeOcr, 0o755);
      }
    } catch {
      // ignore
    }
  }
}

async function updateOfflineResources(opts = {}) {
  const { onStatus } = opts;
  const emit = (payload) => {
    if (typeof onStatus === 'function') {
      try {
        onStatus(payload);
      } catch {
        // ignore
      }
    }
  };

  const check = await checkOfflinePackUpdates();
  if (!check.ok) return check;
  if (!check.updateAvailable && (!check.toUpdate || check.toUpdate.length === 0)) {
    return { ok: true, message: 'Offline pack is up to date.', ...check };
  }

  const baseDir = getUserOfflineResourcesDir();
  await fsp.mkdir(baseDir, { recursive: true });
  const tmpBase = await fsp.mkdtemp(path.join(os.tmpdir(), 'offline-pack-update-'));

  const items = check.toUpdate || [];
  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    emit({ status: 'downloading', component: item.name, index: i + 1, total: items.length, percent: 0 });
    const zipPath = path.join(tmpBase, `${item.name}.zip`);
    await downloadToFile(item.url, zipPath, {
      onProgress: (p) => emit({ status: 'downloading', component: item.name, index: i + 1, total: items.length, percent: p.percent })
    });
    emit({ status: 'extracting', component: item.name, index: i + 1, total: items.length, percent: 100 });
    const extractDir = path.join(tmpBase, `extract-${item.name}`);
    await extractZip(zipPath, extractDir);
    await applyExtractedResources(extractDir, baseDir);
  }

  // Persist installed manifest snapshot
  const installedManifest = {
    version: check.remoteVersion,
    installedAt: new Date().toISOString(),
    components: Object.fromEntries(items.map((x) => [x.name, { version: x.version, url: x.url }]))
  };
  await writeJsonFile(getInstalledManifestPath(baseDir), installedManifest);

  emit({ status: 'done', percent: 100 });
  return { ok: true, ...await checkOfflinePackUpdates() };
}

module.exports = {
  DEFAULT_OFFLINE_PACK_URL,
  DEFAULT_OFFLINE_PACK_MANIFEST_URL,
  getOfflinePackUrl,
  getOfflinePackManifestUrl,
  getUserOfflineResourcesDir,
  getOfflineResourcesStatus,
  installOfflineResources,
  installOfflineResourcesFromZip,
  checkOfflinePackUpdates,
  updateOfflineResources
};


