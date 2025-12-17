#!/usr/bin/env node

/**
 * Fetch offline-analysis resources (model + llama binaries) and lay them out under:
 *   desktop-app/resources/models/model-8b-q4.gguf
 *   desktop-app/resources/llama/win-x64/llama.exe
 *   desktop-app/resources/llama/mac-arm64/llama
 *   desktop-app/resources/llama/mac-x64/llama
 *
 * Then optionally produces a zip containing a top-level `resources/` folder
 * suitable for CI's OFFLINE_PACK_URL.
 *
 * Usage:
 *   node scripts/fetch-offline-resources.mjs --config scripts/offline-resources.config.json --zip
 *
 * Notes:
 * - This script does NOT pick a model for you; you provide direct URLs.
 * - Large downloads can take a long time (multi-GB).
 */

import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { spawn } from 'node:child_process';

const repoRoot = path.resolve(process.cwd());
const desktopResourcesDir = path.join(repoRoot, 'desktop-app', 'resources');
const tmpDir = path.join(repoRoot, 'release-assets', 'tmp-downloads');
const outZip = path.join(repoRoot, 'release-assets', 'offline-pack-generated.zip');

function parseArgs(argv) {
  const args = { config: '', zip: false };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--config') {
      args.config = argv[++i] || '';
    } else if (a === '--zip') {
      args.zip = true;
    }
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

  // If already downloaded, skip (useful for multi-GB models).
  try {
    const st = await fsp.stat(destPath);
    if (st.isFile() && st.size > 0) {
      console.log(`Already exists, skipping download: ${destPath} (${st.size} bytes)`);
      return;
    }
  } catch {
    // ignore
  }

  // Prefer curl for robust large-file downloads + redirects.
  // Windows runners have curl; macOS has curl.
  await run('curl', ['-L', '--fail', '--retry', '5', '--retry-delay', '2', '-o', destPath, url]);
}

async function unzipTo(zipPath, destDir) {
  await ensureDir(destDir);

  if (process.platform === 'win32') {
    // Use PowerShell Expand-Archive
    await run('pwsh', [
      '-NoProfile',
      '-Command',
      `Expand-Archive -Force -Path "${zipPath}" -DestinationPath "${destDir}"`
    ]);
    return;
  }

  await run('unzip', ['-q', '-o', zipPath, '-d', destDir]);
}

async function findBinary(extractedDir, nameHints) {
  // Walk a small-ish extracted tree and find the first matching name.
  const queue = [extractedDir];
  while (queue.length) {
    const dir = queue.pop();
    const entries = await fsp.readdir(dir, { withFileTypes: true });
    for (const e of entries) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) {
        queue.push(full);
      } else if (e.isFile()) {
        if (nameHints.includes(e.name)) {
          return full;
        }
      }
    }
  }
  return null;
}

async function copyFile(src, dest) {
  await ensureDir(path.dirname(dest));
  await fsp.copyFile(src, dest);
}

async function chmodIfNeeded(p) {
  if (process.platform !== 'win32') {
    await fsp.chmod(p, 0o755);
  }
}

async function buildOfflinePackZip() {
  // CI expects a zip with a top-level `resources/` folder.
  // We zip `desktop-app/resources` as `resources/`.
  const zipWorkDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'offline-pack-'));
  const resourcesCopy = path.join(zipWorkDir, 'resources');
  await fsp.cp(desktopResourcesDir, resourcesCopy, { recursive: true });

  if (fs.existsSync(outZip)) {
    await fsp.rm(outZip);
  }

  // Create zip: use `zip` on mac/linux and PowerShell Compress-Archive on Windows
  if (process.platform === 'win32') {
    await run('pwsh', [
      '-NoProfile',
      '-Command',
      `Compress-Archive -Force -Path "${resourcesCopy}" -DestinationPath "${outZip}"`
    ]);
  } else {
    await run('zip', ['-r', '-q', outZip, 'resources'], { cwd: zipWorkDir });
  }
}

async function main() {
  const args = parseArgs(process.argv);
  if (!args.config) {
    console.error('Missing --config. Example: --config scripts/offline-resources.config.json');
    process.exit(1);
  }

  const configPath = path.isAbsolute(args.config) ? args.config : path.join(repoRoot, args.config);
  const raw = await fsp.readFile(configPath, 'utf8');
  const cfg = JSON.parse(raw);

  await ensureDir(tmpDir);
  await ensureDir(desktopResourcesDir);

  // 1) Model
  if (!cfg?.model?.url) {
    console.error('Config missing model.url');
    process.exit(1);
  }
  const modelFilename = cfg.model.filename || 'model-8b-q4.gguf';
  const modelDest = path.join(desktopResourcesDir, 'models', modelFilename);
  console.log(`Downloading model -> ${modelDest}`);
  await downloadFile(cfg.model.url, modelDest);

  // 2) llama binaries (URLs can point to the binary directly OR a zip containing it)
  const targets = [
    { key: 'windows', destDir: path.join(desktopResourcesDir, 'llama', 'win-x64'), ext: '.exe' },
    { key: 'macArm64', destDir: path.join(desktopResourcesDir, 'llama', 'mac-arm64'), ext: '' },
    { key: 'macX64', destDir: path.join(desktopResourcesDir, 'llama', 'mac-x64'), ext: '' }
  ];

  for (const t of targets) {
    const entry = cfg?.llama?.[t.key];
    if (!entry?.url) {
      console.log(`Skipping llama ${t.key}: no url set`);
      continue;
    }

    const nameHints = entry.binaryNameHints || (t.ext ? ['llama.exe', 'llama-cli.exe', 'main.exe'] : ['llama', 'llama-cli', 'main']);
    const url = entry.url;
    const isZip = url.toLowerCase().endsWith('.zip');
    const tmpPath = path.join(tmpDir, `llama-${t.key}${isZip ? '.zip' : t.ext || ''}`);

    console.log(`Downloading llama ${t.key} -> ${tmpPath}`);
    await downloadFile(url, tmpPath);

    let binSrc = tmpPath;
    if (isZip) {
      const extracted = path.join(tmpDir, `extract-${t.key}`);
      await fsp.rm(extracted, { recursive: true, force: true });
      await unzipTo(tmpPath, extracted);
      const found = await findBinary(extracted, nameHints);
      if (!found) {
        throw new Error(`Could not find llama binary in ${tmpPath}. Looked for: ${nameHints.join(', ')}`);
      }
      binSrc = found;
    }

    const binName = t.ext ? 'llama.exe' : 'llama';
    const binDest = path.join(t.destDir, binName);
    console.log(`Installing llama ${t.key} -> ${binDest}`);
    await copyFile(binSrc, binDest);
    await chmodIfNeeded(binDest);
  }

  console.log('Offline resources installed under desktop-app/resources/');

  if (args.zip) {
    console.log(`Creating offline pack zip -> ${outZip}`);
    await buildOfflinePackZip();
    console.log('Done.');
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});


