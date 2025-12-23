const os = require('node:os');
const path = require('node:path');
const fsp = require('node:fs/promises');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
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

function getPlatformKey() {
  if (process.platform === 'darwin') {
    if (process.arch === 'arm64') return 'mac-arm64';
    return 'mac-x64';
  }
  if (process.platform === 'win32') return 'win-x64';
  return `${process.platform}-${process.arch}`;
}

function findBundledOcrMyPdf() {
  try {
    const base = getUserOfflineResourcesDir();
    const platformKey = getPlatformKey();
    const bin = process.platform === 'win32' ? 'ocrmypdf.exe' : 'ocrmypdf';
    const candidate = path.join(base, 'tools', 'ocr', platformKey, bin);
    if (fs.existsSync(candidate)) return candidate;
  } catch {
    // ignore
  }
  return null;
}

async function resolveOcrMyPdfCommand() {
  const bundled = findBundledOcrMyPdf();
  if (bundled) {
    const res = await run(bundled, ['--version'], { windowsHide: true });
    if (res.code === 0) return bundled;
  }
  const res = await run('ocrmypdf', ['--version'], { windowsHide: true });
  if (res.code === 0) return 'ocrmypdf';
  return null;
}

async function hasOcrMyPdf() {
  const cmd = await resolveOcrMyPdfCommand();
  return !!cmd;
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
  const cmd = await resolveOcrMyPdfCommand();
  if (!cmd) return null;

  const tmpDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'sop-analyzer-ocr-'));
  const outputPdfPath = path.join(tmpDir, 'ocr.pdf');

  const args = [
    '--skip-text',
    '--optimize', '0',
    '--output-type', 'pdf',
    inputPdfPath,
    outputPdfPath
  ];

  const res = await run(cmd, args, { windowsHide: true });
  if (res.code === 0) return outputPdfPath;
  return null;
}

module.exports = { ocrToSearchablePdfBestEffort, hasOcrMyPdf, findBundledOcrMyPdf };


