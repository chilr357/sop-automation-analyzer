const os = require('node:os');
const path = require('node:path');
const fsp = require('node:fs/promises');
const fs = require('node:fs');
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
    const ocrDir = path.dirname(expected.ocrMyPdfPath);

    // 1) Native bundled ocrmypdf(.exe)
    if (expected?.ocrMyPdfPath && fs.existsSync(expected.ocrMyPdfPath)) {
      const resBundled = await run(expected.ocrMyPdfPath, ['--version']);
      if (resBundled.code === 0) return true;
    }

    // 2) Portable Python bundle fallback:
    //    offline-resources/ocr/<platform>/python/python.exe -m ocrmypdf
    const pythonExe = process.platform === 'win32'
      ? path.join(ocrDir, 'python', 'python.exe')
      : path.join(ocrDir, 'python', 'bin', 'python3');
    if (fs.existsSync(pythonExe)) {
      const env = buildPortableOcrEnv(ocrDir);
      const resPy = await run(pythonExe, ['-m', 'ocrmypdf', '--version'], { env, windowsHide: true });
      if (resPy.code === 0) return true;
    }
  } catch {
    // ignore
  }
  const res = await run('ocrmypdf', ['--version']);
  return res.code === 0;
}

function buildPortableOcrEnv(ocrDir) {
  const env = { ...process.env };
  const pathParts = [];

  // Provide bundled deps first so OCRmyPDF finds them without system install.
  if (process.platform === 'win32') {
    pathParts.push(
      ocrDir,
      path.join(ocrDir, 'python'),
      path.join(ocrDir, 'tesseract'),
      path.join(ocrDir, 'ghostscript', 'bin')
    );
    // Tesseract language data (English-only in our pack)
    env.TESSDATA_PREFIX = path.join(ocrDir, 'tesseract', 'tessdata');
  } else {
    pathParts.push(
      ocrDir,
      path.join(ocrDir, 'python', 'bin'),
      path.join(ocrDir, 'tesseract', 'bin'),
      path.join(ocrDir, 'ghostscript', 'bin')
    );
    env.TESSDATA_PREFIX = path.join(ocrDir, 'tesseract', 'share', 'tessdata');
    // Minimal hints for dynamic libs if we end up bundling dylibs under ocrDir/lib
    env.DYLD_FALLBACK_LIBRARY_PATH = [path.join(ocrDir, 'lib'), env.DYLD_FALLBACK_LIBRARY_PATH].filter(Boolean).join(':');
  }

  env.PATH = [...pathParts, env.PATH].filter(Boolean).join(path.delimiter);
  return env;
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
  let cmdArgsPrefix = [];
  let envOverride = null;
  try {
    const baseDir = getUserOfflineResourcesDir();
    const expected = getExpectedPaths(baseDir);
    const ocrDir = path.dirname(expected.ocrMyPdfPath);

    if (expected?.ocrMyPdfPath && fs.existsSync(expected.ocrMyPdfPath)) {
      const test = await run(expected.ocrMyPdfPath, ['--version'], { windowsHide: true });
      if (test.code === 0) {
        cmd = expected.ocrMyPdfPath;
        envOverride = buildPortableOcrEnv(ocrDir);
      }
    } else {
      // Portable Python bundle fallback
      const pythonExe = process.platform === 'win32'
        ? path.join(ocrDir, 'python', 'python.exe')
        : path.join(ocrDir, 'python', 'bin', 'python3');
      if (fs.existsSync(pythonExe)) {
        const test = await run(pythonExe, ['-m', 'ocrmypdf', '--version'], { windowsHide: true, env: buildPortableOcrEnv(ocrDir) });
        if (test.code === 0) {
          cmd = pythonExe;
          cmdArgsPrefix = ['-m', 'ocrmypdf'];
          envOverride = buildPortableOcrEnv(ocrDir);
        }
      }
    }
  } catch {
    // ignore
  }

  const res = await run(cmd, [...cmdArgsPrefix, ...args], { windowsHide: true, env: envOverride || process.env });
  if (res.code === 0) return outputPdfPath;
  return null;
}

module.exports = { ocrToSearchablePdfBestEffort, hasOcrMyPdf };


