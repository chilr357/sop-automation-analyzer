#!/usr/bin/env node
/**
 * Build a *portable* Windows OCR Tools Pack for this project (English-only).
 *
 * Output folder (for inclusion in offline pack):
 *   desktop-app/resources/ocr/win-x64/
 *     python/            (Python embeddable + pip-installed ocrmypdf)
 *     tesseract/         (tesseract.exe + tessdata/eng.traineddata)
 *     ghostscript/bin/   (gswin64c.exe)
 *
 * IMPORTANT:
 * - This script is intended to be run on Windows (so we can run the installers/extractors).
 * - Ghostscript is AGPL; ensure you comply with AGPL terms when distributing.
 *
 * Usage (PowerShell):
 *   node scripts/build-ocr-tools-pack-win.mjs
 *
 * Optional overrides:
 *   --pythonEmbedUrl <url>
 *   --tesseractInstallerUrl <url>
 *   --ghostscriptInstallerUrl <url>
 *   --ocrmypdfVersion <version>
 */

import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { spawn } from 'node:child_process';

const repoRoot = path.resolve(process.cwd());
const outDir = path.join(repoRoot, 'desktop-app', 'resources', 'ocr', 'win-x64');
const tmpDir = path.join(repoRoot, 'release-assets', 'tmp-downloads');

function parseArgs(argv) {
  const args = {
    pythonEmbedUrl: 'https://www.python.org/ftp/python/3.11.9/python-3.11.9-embed-amd64.zip',
    getPipUrl: 'https://bootstrap.pypa.io/get-pip.py',
    // NOTE: These URLs may change over time; adjust if needed.
    // Tesseract (UB Mannheim) and Ghostscript (Artifex) are commonly distributed as installers.
    tesseractInstallerUrl: 'https://digi.bib.uni-mannheim.de/tesseract/tesseract-ocr-w64-setup-v5.2.0.20220712.exe',
    // Use Ghostscript installer (contains gswin64c.exe). The "ghostpcl-*.zip" archive is NOT Ghostscript.
    ghostscriptInstallerUrl: 'https://github.com/ArtifexSoftware/ghostpdl-downloads/releases/download/gs9550/gs9550w64.exe',
    ocrmypdfVersion: '16.6.0'
  };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--pythonEmbedUrl') args.pythonEmbedUrl = argv[++i] || args.pythonEmbedUrl;
    else if (a === '--tesseractInstallerUrl') args.tesseractInstallerUrl = argv[++i] || '';
    else if (a === '--ghostscriptInstallerUrl') args.ghostscriptInstallerUrl = argv[++i] || '';
    else if (a === '--ocrmypdfVersion') args.ocrmypdfVersion = argv[++i] || args.ocrmypdfVersion;
  }
  return args;
}

function run(cmd, cmdArgs, opts = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, cmdArgs, { stdio: 'inherit', ...opts });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) return resolve();
      reject(new Error(`${cmd} exited with code ${code}`));
    });
  });
}

async function ensureDir(p) {
  await fsp.mkdir(p, { recursive: true });
}

async function download(url, dest) {
  await ensureDir(path.dirname(dest));
  await run('powershell.exe', [
    '-NoProfile',
    '-ExecutionPolicy', 'Bypass',
    '-Command',
    `$ErrorActionPreference='Stop'; iwr -UseBasicParsing -Uri "${url}" -OutFile "${dest}"`
  ]);
}

async function unzip(zipPath, destDir) {
  await ensureDir(destDir);
  await run('powershell.exe', [
    '-NoProfile',
    '-ExecutionPolicy', 'Bypass',
    '-Command',
    `Expand-Archive -Force -Path "${zipPath}" -DestinationPath "${destDir}"`
  ]);
}

async function writePythonPth(pythonDir) {
  // For python 3.11 embeddable: python311._pth controls sys.path; ensure site-packages is included.
  const pth = path.join(pythonDir, 'python311._pth');
  if (!fs.existsSync(pth)) return;
  const lines = (await fsp.readFile(pth, 'utf8')).split(/\r?\n/).filter(Boolean);
  const out = [];
  // Keep existing relative paths, but ensure site-packages is present and enable import site.
  for (const l of lines) {
    if (l.trim() === '#import site') continue;
    if (l.trim() === 'import site') continue;
    out.push(l);
  }
  if (!out.includes('site-packages')) out.push('site-packages');
  out.push('import site');
  await fsp.writeFile(pth, out.join('\r\n') + '\r\n', 'utf8');
}

async function exists(p) {
  try {
    const st = await fsp.stat(p);
    return !!st;
  } catch {
    return false;
  }
}

async function pruneTessdataToEnglish(tesseractDir) {
  // UB Mannheim layout typically includes: <dir>/tessdata/*.traineddata
  const tessdata = path.join(tesseractDir, 'tessdata');
  if (!(await exists(tessdata))) return;
  const keep = new Set(['eng.traineddata', 'osd.traineddata']);
  const files = await fsp.readdir(tessdata).catch(() => []);
  for (const f of files) {
    if (f.toLowerCase().endsWith('.traineddata') && !keep.has(f)) {
      await fsp.rm(path.join(tessdata, f), { force: true });
    }
  }
}

async function main() {
  if (process.platform !== 'win32') {
    throw new Error('This script must be run on Windows.');
  }
  const args = parseArgs(process.argv);
  await ensureDir(tmpDir);

  // Clean output
  await fsp.rm(outDir, { recursive: true, force: true });
  await ensureDir(outDir);

  // 1) Python embeddable + pip + OCRmyPDF
  const pythonZip = path.join(tmpDir, 'python-embed-amd64.zip');
  const getPip = path.join(tmpDir, 'get-pip.py');
  const pythonDir = path.join(outDir, 'python');
  const sitePackages = path.join(pythonDir, 'site-packages');

  console.log('Downloading Python embeddable zip...');
  await download(args.pythonEmbedUrl, pythonZip);
  console.log('Extracting Python...');
  await unzip(pythonZip, pythonDir);
  await ensureDir(sitePackages);
  await writePythonPth(pythonDir);

  console.log('Downloading get-pip.py...');
  await download(args.getPipUrl, getPip);

  const pythonExe = path.join(pythonDir, 'python.exe');
  console.log('Installing pip into embeddable Python...');
  await run(pythonExe, [getPip, '--no-warn-script-location']);

  console.log(`Installing OCRmyPDF==${args.ocrmypdfVersion} into site-packages...`);
  await run(pythonExe, ['-m', 'pip', 'install', '--no-cache-dir', `ocrmypdf==${args.ocrmypdfVersion}`, '--target', sitePackages]);

  // 2) Tesseract + English tessdata (installer-based)
  const tesseractExe = path.join(tmpDir, 'tesseract-setup.exe');
  const tesseractDir = path.join(outDir, 'tesseract');
  console.log('Downloading Tesseract installer...');
  await download(args.tesseractInstallerUrl, tesseractExe);
  await ensureDir(tesseractDir);
  // UB Mannheim installer is typically Inno Setup; this should install into a user-writable directory without admin.
  await run(tesseractExe, [
    '/VERYSILENT',
    '/SUPPRESSMSGBOXES',
    '/NORESTART',
    `/DIR=${tesseractDir}`
  ]);
  await pruneTessdataToEnglish(tesseractDir);

  // 3) Ghostscript (installer-based)
  const gsExe = path.join(tmpDir, 'ghostscript-setup.exe');
  const gsDir = path.join(outDir, 'ghostscript');
  console.log('Downloading Ghostscript installer...');
  await download(args.ghostscriptInstallerUrl, gsExe);
  await ensureDir(gsDir);
  // Ghostscript installer supports silent mode; install into local directory.
  // Most Artifex releases are NSIS (/S) and accept /D= for directory.
  try {
    await run(gsExe, ['/S', `/D=${gsDir}`]);
  } catch {
    await run(gsExe, [
      '/VERYSILENT',
      '/SUPPRESSMSGBOXES',
      '/NORESTART',
      `/DIR=${gsDir}`
    ]);
  }

  console.log('Done. Output folder:');
  console.log(outDir);
  console.log('Next: run scripts/build-offline-pack-manifest.mjs to generate ocr-win-x64.zip and upload components to Supabase.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});


