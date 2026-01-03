const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { spawn } = require('node:child_process');
const { app } = require('electron');
const https = require('node:https');
const http = require('node:http');
const { URL } = require('node:url');

// Public URL to the offline pack zip (contains a top-level `resources/` folder).
// Can be overridden by setting OFFLINE_PACK_PUBLIC_URL at runtime.
const DEFAULT_OFFLINE_PACK_URL =
  'https://jnowuefcdsuphbvnozic.supabase.co/storage/v1/object/public/offline-packs/v1/offline-pack-generated.zip';

// Optional: manifest URL for component-based updates (download only what changed).
// Can be overridden by setting OFFLINE_PACK_MANIFEST_PUBLIC_URL at runtime.
// Expected format: JSON describing version + component URLs.
const DEFAULT_OFFLINE_PACK_MANIFEST_URL =
  'https://jnowuefcdsuphbvnozic.supabase.co/storage/v1/object/public/offline-packs/v1/manifest.json';

function getOfflinePackUrl() {
  return process.env.OFFLINE_PACK_PUBLIC_URL || DEFAULT_OFFLINE_PACK_URL;
}

function getOfflinePackManifestUrl() {
  return process.env.OFFLINE_PACK_MANIFEST_PUBLIC_URL || DEFAULT_OFFLINE_PACK_MANIFEST_URL;
}

function getUserOfflineResourcesDir() {
  // Store outside the app bundle so it survives auto-updates and stays writable.
  return path.join(app.getPath('userData'), 'offline-resources');
}

function getLocalManifestPath(baseDir) {
  return path.join(baseDir, '.offline-pack.json');
}

function getExpectedPaths(baseDir) {
  const platformKey = process.platform === 'darwin'
    ? (process.arch === 'arm64' ? 'mac-arm64' : 'mac-x64')
    : (process.platform === 'win32' ? 'win-x64' : `${process.platform}-${process.arch}`);

  const llamaBin = process.platform === 'win32' ? 'llama.exe' : 'llama';
  const ocrDir = path.join(baseDir, 'ocr', platformKey);

  return {
    baseDir,
    modelPath: path.join(baseDir, 'models', 'model-8b-q4.gguf'),
    llamaPath: path.join(baseDir, 'llama', platformKey, llamaBin),
    // OCR tool (bundled in the offline pack for production use)
    ocrMyPdfPath: process.platform === 'win32'
      ? path.join(ocrDir, 'ocrmypdf.exe')
      : path.join(ocrDir, 'ocrmypdf'),
    // Portable Python-based OCR runtime (preferred for Windows packs we build)
    ocrPythonPath: process.platform === 'win32'
      ? path.join(ocrDir, 'python', 'python.exe')
      : path.join(ocrDir, 'python', 'bin', 'python3'),
    // Dependencies expected to be bundled for the portable OCR pack
    tesseractPath: process.platform === 'win32'
      ? path.join(ocrDir, 'tesseract', 'tesseract.exe')
      : path.join(ocrDir, 'tesseract', 'bin', 'tesseract'),
    ghostscriptPath: process.platform === 'win32'
      ? path.join(ocrDir, 'ghostscript', 'bin', 'gswin64c.exe')
      : path.join(ocrDir, 'ghostscript', 'bin', 'gs')
  };
}

async function getOfflineResourcesStatus() {
  const baseDir = getUserOfflineResourcesDir();
  const expected = getExpectedPaths(baseDir);

  const missing = [];
  if (!fs.existsSync(expected.modelPath)) missing.push(expected.modelPath);
  if (!fs.existsSync(expected.llamaPath)) missing.push(expected.llamaPath);

  // OCR is considered part of the production offline pack (most PDFs require OCR).
  const hasOcrEntrypoint = fs.existsSync(expected.ocrMyPdfPath) || fs.existsSync(expected.ocrPythonPath);
  const hasOcrDeps = fs.existsSync(expected.tesseractPath) && fs.existsSync(expected.ghostscriptPath);
  const ocrAvailable = hasOcrEntrypoint && hasOcrDeps;
  if (!ocrAvailable) {
    if (!hasOcrEntrypoint) {
      missing.push(expected.ocrMyPdfPath);
      missing.push(expected.ocrPythonPath);
    }
    if (!fs.existsSync(expected.tesseractPath)) missing.push(expected.tesseractPath);
    if (!fs.existsSync(expected.ghostscriptPath)) missing.push(expected.ghostscriptPath);
  }

  let localManifest = null;
  try {
    const text = await fsp.readFile(getLocalManifestPath(baseDir), 'utf8');
    localManifest = JSON.parse(text);
  } catch {
    // ignore
  }

  return {
    installed: missing.length === 0,
    missing,
    baseDir,
    url: getOfflinePackUrl(),
    manifestUrl: getOfflinePackManifestUrl(),
    installedPackVersion: localManifest?.version || null,
    ocrAvailable
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

async function downloadToFile(url, destPath) {
  await fsp.mkdir(path.dirname(destPath), { recursive: true });

  // Prefer in-process streaming download so we can surface progress to the UI.
  // Fallback: PowerShell/curl if needed.
  try {
    await downloadToFileNode(url, destPath);
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

function downloadToFileNode(urlString, destPath, { onProgress } = {}) {
  return new Promise((resolve, reject) => {
    const url = new URL(urlString);
    const proto = url.protocol === 'https:' ? https : http;

    const doRequest = (currentUrl, redirectsLeft) => {
      const req = proto.get(currentUrl, (res) => {
        // Handle redirects
        if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          if (redirectsLeft <= 0) {
            reject(new Error('Too many redirects while downloading.'));
            return;
          }
          const next = new URL(res.headers.location, currentUrl).toString();
          res.resume();
          doRequest(next, redirectsLeft - 1);
          return;
        }
        if (res.statusCode !== 200) {
          reject(new Error(`Download failed with status ${res.statusCode}`));
          res.resume();
          return;
        }

        const total = Number(res.headers['content-length'] || 0);
        let received = 0;
        const file = fs.createWriteStream(destPath);

        res.on('data', (chunk) => {
          received += chunk.length;
          if (onProgress) {
            try {
              const percent = total ? (received / total) * 100 : undefined;
              onProgress({ receivedBytes: received, totalBytes: total || undefined, percent });
            } catch {
              // ignore
            }
          }
        });

        res.pipe(file);
        file.on('finish', () => file.close(() => resolve()));
        file.on('error', (err) => reject(err));
      });
      req.on('error', reject);
    };

    doRequest(urlString, 5);
  });
}

async function fetchJson(url) {
  const tmpBase = await fsp.mkdtemp(path.join(os.tmpdir(), 'offline-manifest-'));
  const tmpPath = path.join(tmpBase, 'manifest.json');
  await downloadToFileNode(url, tmpPath);
  const text = await fsp.readFile(tmpPath, 'utf8');
  return JSON.parse(text);
}

async function headUrl(urlString) {
  const u = new URL(urlString);
  const proto = u.protocol === 'http:' ? http : https;
  return await new Promise((resolve, reject) => {
    const req = proto.request(
      {
        method: 'HEAD',
        protocol: u.protocol,
        hostname: u.hostname,
        port: u.port || undefined,
        path: u.pathname + u.search,
        headers: { 'User-Agent': 'sop-automation-analyzer' }
      },
      (res) => {
        const statusCode = res.statusCode || 0;
        res.resume();
        if (statusCode >= 200 && statusCode < 300) {
          resolve({
            statusCode,
            etag: res.headers.etag ? String(res.headers.etag) : null,
            lastModified: res.headers['last-modified'] ? String(res.headers['last-modified']) : null,
            contentLength: res.headers['content-length'] ? Number(res.headers['content-length']) : null
          });
          return;
        }
        reject(new Error(`HEAD ${urlString} failed: HTTP ${statusCode}`));
      }
    );
    req.on('error', reject);
    req.end();
  });
}

function getPlatformKey() {
  return process.platform === 'darwin'
    ? (process.arch === 'arm64' ? 'mac-arm64' : 'mac-x64')
    : (process.platform === 'win32' ? 'win-x64' : `${process.platform}-${process.arch}`);
}

async function checkOfflinePackUpdate() {
  const status = await getOfflineResourcesStatus();
  const baseDir = status.baseDir;

  let remote = null;
  try {
    remote = await fetchJson(status.manifestUrl);
  } catch {
    // If no manifest is available, fall back to "full zip" checks using ETag/Last-Modified.
    try {
      const remoteZip = await headUrl(status.url);
      let localManifest = null;
      try {
        const text = await fsp.readFile(getLocalManifestPath(baseDir), 'utf8');
        localManifest = JSON.parse(text);
      } catch {
        // ignore
      }
      const localEtag = localManifest?.zip?.etag || null;
      const installedVersion = status.installedPackVersion || localEtag || null;
      const latestVersion = remoteZip.etag || remoteZip.lastModified || null;
      const needsUpdate = !status.installed || !localEtag || (!!remoteZip.etag && localEtag !== remoteZip.etag);
      return {
        ok: true,
        message: 'Offline pack manifest not available. Using full-zip update checks (ETag/Last-Modified).',
        installedVersion,
        latestVersion,
        needsUpdate,
        componentsToUpdate: []
      };
    } catch {
      return {
        ok: false,
        message: 'Offline pack manifest not available. Falling back to full zip downloads.',
        installedVersion: status.installedPackVersion,
        latestVersion: null,
        needsUpdate: !status.installed,
        componentsToUpdate: []
      };
    }
  }

  const localVersion = status.installedPackVersion;
  const latestVersion = remote?.version || null;
  const needsUpdate = !status.installed || (latestVersion && localVersion !== latestVersion);

  // Determine which components need update (best effort).
  const platformKey = getPlatformKey();
  const components = [
    ...(remote?.components?.common || []),
    ...((remote?.components?.platform && remote.components.platform[platformKey]) || [])
  ].filter(Boolean);

  let localManifest = null;
  try {
    const text = await fsp.readFile(getLocalManifestPath(baseDir), 'utf8');
    localManifest = JSON.parse(text);
  } catch {
    // ignore
  }

  const localComponents = localManifest?.components || {};
  const componentsToUpdate = components
    .filter((c) => c && c.name && c.url && c.path)
    .filter((c) => {
      const prev = localComponents[c.name];
      return !prev || prev.url !== c.url || prev.sha256 !== c.sha256 || prev.version !== c.version;
    })
    .map((c) => c.name);

  return {
    ok: true,
    installedVersion: localVersion,
    latestVersion,
    needsUpdate,
    componentsToUpdate
  };
}

async function writeLocalManifest(baseDir, remoteManifest, componentsInstalled, zipMeta) {
  const out = {
    version: remoteManifest?.version || null,
    updatedAt: new Date().toISOString(),
    components: componentsInstalled || {},
    zip: zipMeta || null
  };
  await fsp.mkdir(baseDir, { recursive: true });
  await fsp.writeFile(getLocalManifestPath(baseDir), JSON.stringify(out, null, 2), 'utf8');
}

async function installOfflineResourcesLegacyZip({ onProgress, remoteManifest } = {}) {
  const status = await getOfflineResourcesStatus();
  const url = status.url;

  if (onProgress) onProgress({ status: 'downloading', message: 'Downloading offline pack…', percent: 0 });

  let zipMeta = null;
  try {
    zipMeta = await headUrl(url);
  } catch {
    // ignore
  }

  const tmpBase = await fsp.mkdtemp(path.join(os.tmpdir(), 'offline-pack-'));
  const zipPath = path.join(tmpBase, 'offline-pack.zip');
  const extractDir = path.join(tmpBase, 'extract');

  await downloadToFile(url, zipPath);

  if (onProgress) onProgress({ status: 'installing', message: 'Installing offline pack…', percent: 90 });
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
    const maybeOcr = getExpectedPaths(userDir).ocrMyPdfPath;
    try {
      if (fs.existsSync(maybeOcr)) await fsp.chmod(maybeOcr, 0o755);
    } catch {
      // ignore
    }
  }

  // Persist metadata for future update checks (manifest version if known + zip ETag)
  try {
    await writeLocalManifest(userDir, remoteManifest || null, {}, zipMeta);
  } catch {
    // ignore
  }

  if (onProgress) onProgress({ status: 'done', percent: 100 });
  return await getOfflineResourcesStatus();
}

async function updateOfflineResources({ onProgress, onlyComponents, force } = {}) {
  const status = await getOfflineResourcesStatus();
  const baseDir = status.baseDir;

  let remote = null;
  try {
    remote = await fetchJson(status.manifestUrl);
  } catch {
    // No manifest: do a full zip reinstall (this is the only safe option without per-component URLs).
    const res = await installOfflineResourcesLegacyZip({ onProgress, remoteManifest: null });
    return { ...res, updated: true, latestVersion: null, message: 'Offline pack manifest not available; re-downloaded full pack.' };
  }
  const platformKey = getPlatformKey();
  const components = [
    ...(remote?.components?.common || []),
    ...((remote?.components?.platform && remote.components.platform[platformKey]) || [])
  ].filter(Boolean);

  // If the manifest doesn't define components, fall back to the full zip path.
  if (!components.length) {
    const res = await installOfflineResourcesLegacyZip({ onProgress, remoteManifest: remote });
    return { ...res, updated: true, latestVersion: remote?.version || null, message: 'Offline pack manifest did not define components; re-downloaded full pack.' };
  }

  // Load prior local component state so we can skip unchanged downloads.
  let localManifest = null;
  try {
    const text = await fsp.readFile(getLocalManifestPath(baseDir), 'utf8');
    localManifest = JSON.parse(text);
  } catch {
    // ignore
  }
  const prevComponents = localManifest?.components || {};

  const shouldInstall = (c) => {
    if (!c || !c.name) return false;
    const prev = prevComponents[c.name];
    // install if never installed, or metadata changed
    return !prev || prev.url !== c.url || prev.sha256 !== c.sha256 || prev.version !== c.version;
  };

  // Support "install only selected components" (e.g., OCR Tools Pack) while skipping unchanged by default.
  const onlyNames = Array.isArray(onlyComponents) ? onlyComponents : null;
  const forceInstall = !!force;
  const targetComponents = components
    .filter((c) => c && c.name && c.url && c.path)
    .filter((c) => (onlyNames ? onlyNames.includes(c.name) : true))
    .filter((c) => (forceInstall ? true : shouldInstall(c)));

  if (onlyNames && targetComponents.length === 0) {
    return { ...status, updated: false, latestVersion: remote?.version || null, message: 'Requested component(s) are not present in the current manifest, or already installed.' };
  }
  if (!onlyNames && targetComponents.length === 0) {
    // Nothing to do.
    await writeLocalManifest(baseDir, remote, prevComponents, null);
    return { ...status, updated: false, latestVersion: remote?.version || null, message: 'Offline pack is already up to date.' };
  }

  const tmpBase = await fsp.mkdtemp(path.join(os.tmpdir(), 'offline-components-'));
  const componentsInstalled = {};

  let done = 0;
  const total = targetComponents.length;

  for (const c of targetComponents) {
    done++;
    const basePercent = ((done - 1) / total) * 100;
    if (onProgress) {
      onProgress({ status: 'downloading', component: c.name, message: `Downloading ${c.name}…`, percent: basePercent });
    }

    if (c.type === 'zip') {
      const zipPath = path.join(tmpBase, `${c.name}.zip`);
      await downloadToFileNode(c.url, zipPath, {
        onProgress: (p) => {
          if (!onProgress) return;
          const within = typeof p.percent === 'number' ? (p.percent / 100) * (100 / total) : 0;
          onProgress({ status: 'downloading', component: c.name, percent: Math.min(99, basePercent + within) });
        }
      });
      if (onProgress) onProgress({ status: 'installing', component: c.name, message: `Installing ${c.name}…`, percent: basePercent });
      const extractTo = c.extractTo || '';
      await extractZip(zipPath, path.join(baseDir, extractTo));
    } else {
      const outPath = path.join(baseDir, c.path);
      await downloadToFileNode(c.url, outPath, {
        onProgress: (p) => {
          if (!onProgress) return;
          const within = typeof p.percent === 'number' ? (p.percent / 100) * (100 / total) : 0;
          onProgress({ status: 'downloading', component: c.name, percent: Math.min(99, basePercent + within) });
        }
      });
    }

    // Track what we installed.
    componentsInstalled[c.name] = {
      name: c.name,
      url: c.url,
      path: c.path,
      type: c.type || 'file',
      version: c.version || null,
      sha256: c.sha256 || null
    };
  }

  // Ensure mac binaries are executable if present
  if (process.platform !== 'win32') {
    const maybeLlama = getExpectedPaths(baseDir).llamaPath;
    try {
      await fsp.chmod(maybeLlama, 0o755);
    } catch {
      // ignore
    }
    const maybeOcr = getExpectedPaths(baseDir).ocrMyPdfPath;
    try {
      if (fs.existsSync(maybeOcr)) await fsp.chmod(maybeOcr, 0o755);
    } catch {
      // ignore
    }
  }

  // Merge previous component metadata with newly installed ones.
  const mergedComponents = { ...(prevComponents || {}), ...(componentsInstalled || {}) };
  await writeLocalManifest(baseDir, remote, mergedComponents, null);
  if (onProgress) onProgress({ status: 'done', percent: 100 });

  const newStatus = await getOfflineResourcesStatus();
  return { ...newStatus, updated: true, latestVersion: remote?.version || null };
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

  // Prefer manifest-based install when available so we can avoid re-downloading unchanged pieces later.
  try {
    return await updateOfflineResources({});
  } catch {
    // ignore and fall back to legacy zip install
  }
  return await installOfflineResourcesLegacyZip({});
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

module.exports = {
  DEFAULT_OFFLINE_PACK_URL,
  DEFAULT_OFFLINE_PACK_MANIFEST_URL,
  getOfflinePackUrl,
  getOfflinePackManifestUrl,
  getUserOfflineResourcesDir,
  getExpectedPaths,
  getOfflineResourcesStatus,
  checkOfflinePackUpdate,
  updateOfflineResources,
  installOfflineResources,
  installOfflineResourcesFromZip
};


