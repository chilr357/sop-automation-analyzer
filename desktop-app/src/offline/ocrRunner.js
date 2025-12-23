const os = require('node:os');
const path = require('node:path');
const fsp = require('node:fs/promises');
const { spawn } = require('node:child_process');
const { getUserOfflineResourcesDir, getExpectedPaths } = require('./offlineResourcesInstaller');

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
  // Prefer bundled OCR tool (if included in offline resources)
  try {
    const baseDir = getUserOfflineResourcesDir();
    const expected = getExpectedPaths(baseDir);
    if (expected?.ocrMyPdfPath) {
      const resBundled = await run(expected.ocrMyPdfPath, ['--version']);
      if (resBundled.code === 0) return true;
    }
  } catch {
    // ignore
  }
  const res = await run('ocrmypdf', ['--version']);
  return res.code === 0;
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

  // Prefer bundled OCR tool if present.
  let cmd = 'ocrmypdf';
  try {
    const baseDir = getUserOfflineResourcesDir();
    const expected = getExpectedPaths(baseDir);
    if (expected?.ocrMyPdfPath) {
      const test = await run(expected.ocrMyPdfPath, ['--version'], { windowsHide: true });
      if (test.code === 0) cmd = expected.ocrMyPdfPath;
    }
  } catch {
    // ignore
  }

  const res = await run(cmd, args, { windowsHide: true });
  if (res.code === 0) return outputPdfPath;
  return null;
}

module.exports = { ocrToSearchablePdfBestEffort, hasOcrMyPdf };


