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
  const ocrmypdfBin = process.platform === 'win32' ? 'ocrmypdf.exe' : 'ocrmypdf';

  return {
    baseDir,
    modelPath: path.join(baseDir, 'models', 'model-8b-q4.gguf'),
    llamaPath: path.join(baseDir, 'llama', platformKey, llamaBin),
    // Optional: bundled OCR tool. Not required for "installed" status.
    ocrmypdfPath: path.join(baseDir, 'tools', 'ocr', platformKey, ocrmypdfBin)
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
    url: getOfflinePackUrl(),
    ocrAvailable: fs.existsSync(expected.ocrmypdfPath)
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

  // Use curl on macOS/Linux; on Windows, use Windows PowerShell (pwsh is not always installed).
  if (process.platform === 'win32') {
    await runWindowsPowerShell(buildWindowsDownloadWithProgressCommand(url, destPath));
  } else {
    await run('curl', ['-L', '--fail', '--retry', '5', '--retry-delay', '2', '-o', destPath, url]);
  }
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

module.exports = {
  DEFAULT_OFFLINE_PACK_URL,
  getOfflinePackUrl,
  getUserOfflineResourcesDir,
  getOfflineResourcesStatus,
  installOfflineResources,
  installOfflineResourcesFromZip
};


