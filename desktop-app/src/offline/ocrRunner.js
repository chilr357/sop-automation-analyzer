const os = require('node:os');
const path = require('node:path');
const fsp = require('node:fs/promises');
const fs = require('node:fs');
const { spawn } = require('node:child_process');
const { getUserOfflineResourcesDir } = require('./offlineResourcesInstaller');

function run(cmd, args, opts = {}) {
  return new Promise((resolve) => {
    const child = spawn(cmd, args, { ...opts, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (c) => (stdout += c.toString('utf8')));
    child.stderr.on('data', (c) => (stderr += c.toString('utf8')));
    child.on('close', (code) => resolve({ code, stdout, stderr }));
    child.on('error', () => resolve({ code: -1, stdout, stderr }));
  });
}

async function hasOcrMyPdf() {
  const resolved = resolveBundledOrSystemOcrMyPdf();
  if (!resolved) return false;
  const res = await run(resolved, ['--version'], { windowsHide: true });
  return res.code === 0;
}

function getResourcesBase() {
  // Preferred: userData-installed offline resources (survives auto-updates, writable).
  try {
    const userDir = getUserOfflineResourcesDir();
    if (userDir && fs.existsSync(userDir)) return userDir;
  } catch {
    // ignore
  }

  // Packaged builds: `<resourcesPath>/resources/` (when present)
  if (process.resourcesPath) {
    return path.join(process.resourcesPath, 'resources');
  }
  return path.resolve(__dirname, '..', '..', 'resources');
}

function getPlatformKey() {
  if (process.platform === 'darwin') {
    return process.arch === 'arm64' ? 'mac-arm64' : 'mac-x64';
  }
  if (process.platform === 'win32') return 'win-x64';
  return `${process.platform}-${process.arch}`;
}

function resolveBundledOrSystemOcrMyPdf() {
  // If the offline pack includes OCR tooling, prefer that.
  const resourcesBase = getResourcesBase();
  const platformKey = getPlatformKey();
  const binDir = path.join(resourcesBase, 'tools', 'ocr', platformKey);
  const candidates = process.platform === 'win32'
    ? ['ocrmypdf.exe', 'ocrmypdf.cmd', 'ocrmypdf.bat']
    : ['ocrmypdf'];
  for (const c of candidates) {
    const p = path.join(binDir, c);
    if (fs.existsSync(p)) return p;
  }
  // Fallback to PATH lookup.
  return 'ocrmypdf';
}

/**
 * Attempts to OCR a PDF into a temporary *searchable* PDF using `ocrmypdf` if available.
 * Returns the output PDF path on success, or null if `ocrmypdf` isn't installed or OCR fails.
 *
 * Notes:
 * - We use `--skip-text` so OCR only runs when the PDF lacks a text layer (fastest and safest).
 * - This is intentionally "best effort": we don't want hard dependency bloat inside the installer.
 */
async function ocrToSearchablePdfBestEffort(inputPdfPath) {
  const resolved = resolveBundledOrSystemOcrMyPdf();
  if (!resolved) return null;
  const ok = await hasOcrMyPdf();
  if (!ok) return null;

  const tmpDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'sop-analyzer-ocr-'));
  const outputPdfPath = path.join(tmpDir, 'ocr.pdf');

  const args = [
    '--skip-text',
    '--optimize', '0',
    '--output-type', 'pdf',
    inputPdfPath,
    outputPdfPath
  ];

  const res = await run(resolved, args, { windowsHide: true });
  if (res.code === 0) return outputPdfPath;
  return null;
}

module.exports = { ocrToSearchablePdfBestEffort, hasOcrMyPdf };


