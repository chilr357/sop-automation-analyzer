#!/usr/bin/env node
/**
 * Fetch a prebuilt portable OCR Tools Pack (per platform) and install it into:
 *   desktop-app/resources/ocr/win-x64/...
 *   desktop-app/resources/ocr/mac-arm64/...
 *   desktop-app/resources/ocr/mac-x64/...
 *
 * This script intentionally expects a *bundle zip* you provide (because OCRmyPDF is not a single binary
 * and Windows/mac packaging varies a lot). The bundle should include the runnable entrypoint:
 * - Windows: ocrmypdf.exe
 * - macOS: ocrmypdf
 *
 * Usage:
 *   node scripts/fetch-ocr-tools.mjs --config scripts/ocr-tools.config.json
 */

import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { spawn } from 'node:child_process';

const repoRoot = path.resolve(process.cwd());
const desktopResourcesDir = path.join(repoRoot, 'desktop-app', 'resources');
const tmpDir = path.join(repoRoot, 'release-assets', 'tmp-downloads');

function parseArgs(argv) {
  const args = { config: '' };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--config') args.config = argv[++i] || '';
  }
  return args;
}

async function ensureDir(p) {
  await fsp.mkdir(p, { recursive: true });
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

async function downloadFile(url, destPath) {
  await ensureDir(path.dirname(destPath));
  // Prefer curl for redirects/retries.
  await run('curl', ['-L', '--fail', '--retry', '5', '--retry-delay', '2', '-o', destPath, url]);
}

async function unzipTo(zipPath, destDir) {
  await ensureDir(destDir);
  if (process.platform === 'win32') {
    await run('powershell.exe', [
      '-NoProfile',
      '-ExecutionPolicy', 'Bypass',
      '-Command',
      `Expand-Archive -Force -Path "${zipPath}" -DestinationPath "${destDir}"`
    ]);
    return;
  }
  await run('unzip', ['-q', '-o', zipPath, '-d', destDir]);
}

async function findFileByNames(rootDir, nameHints) {
  const queue = [rootDir];
  while (queue.length) {
    const dir = queue.pop();
    const entries = await fsp.readdir(dir, { withFileTypes: true });
    for (const e of entries) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) queue.push(full);
      else if (e.isFile() && nameHints.includes(e.name)) return full;
    }
  }
  return null;
}

async function copyDirContents(srcDir, destDir) {
  await ensureDir(destDir);
  await fsp.cp(srcDir, destDir, { recursive: true });
}

async function chmodIfNeeded(p) {
  if (process.platform !== 'win32') {
    try {
      await fsp.chmod(p, 0o755);
    } catch {
      // ignore
    }
  }
}

async function main() {
  const args = parseArgs(process.argv);
  if (!args.config) {
    console.error('Missing --config. Example: --config scripts/ocr-tools.config.json');
    process.exit(1);
  }

  const configPath = path.isAbsolute(args.config) ? args.config : path.join(repoRoot, args.config);
  const raw = await fsp.readFile(configPath, 'utf8');
  const cfg = JSON.parse(raw);

  await ensureDir(tmpDir);
  await ensureDir(desktopResourcesDir);

  const targets = [
    { key: 'windows', platformKey: 'win-x64', defaultNameHints: ['ocrmypdf.exe'] },
    { key: 'macArm64', platformKey: 'mac-arm64', defaultNameHints: ['ocrmypdf'] },
    { key: 'macX64', platformKey: 'mac-x64', defaultNameHints: ['ocrmypdf'] }
  ];

  for (const t of targets) {
    const entry = cfg?.ocr?.[t.key];
    if (!entry?.url) {
      console.log(`Skipping OCR ${t.key}: no url set`);
      continue;
    }

    const url = entry.url;
    if (!url.toLowerCase().endsWith('.zip')) {
      throw new Error(`OCR ${t.key} URL must be a .zip for now. Got: ${url}`);
    }

    const nameHints = entry.binaryNameHints || t.defaultNameHints;
    const zipPath = path.join(tmpDir, `ocr-${t.platformKey}.zip`);
    const extracted = path.join(tmpDir, `extract-ocr-${t.platformKey}-${Date.now()}`);

    console.log(`Downloading OCR bundle ${t.key} -> ${zipPath}`);
    await downloadFile(url, zipPath);

    console.log(`Extracting -> ${extracted}`);
    await unzipTo(zipPath, extracted);

    const found = await findFileByNames(extracted, nameHints);
    if (!found) {
      throw new Error(`Could not find OCR entrypoint in bundle for ${t.key}. Looked for: ${nameHints.join(', ')}`);
    }

    const bundleRoot = path.dirname(found);
    const destDir = path.join(desktopResourcesDir, 'ocr', t.platformKey);
    console.log(`Installing OCR bundle -> ${destDir}`);
    await fsp.rm(destDir, { recursive: true, force: true });
    await copyDirContents(bundleRoot, destDir);

    // Ensure expected entrypoint exists at root of destDir
    const expectedName = t.platformKey === 'win-x64' ? 'ocrmypdf.exe' : 'ocrmypdf';
    const expectedPath = path.join(destDir, expectedName);
    if (!fs.existsSync(expectedPath)) {
      // If the binary wasn't at the root, copy it there.
      await fsp.copyFile(found, expectedPath);
    }
    await chmodIfNeeded(expectedPath);

    console.log(`OK: ${expectedPath}`);
  }

  console.log('OCR tools installed under desktop-app/resources/ocr/');
  console.log('Next: run scripts/build-offline-pack-manifest.mjs to generate ocr-*.zip components and upload to Supabase.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});


