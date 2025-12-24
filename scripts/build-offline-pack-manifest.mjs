#!/usr/bin/env node
/**
 * Build a component-based offline pack manifest + component archives for Supabase.
 *
 * Output:
 *   release-assets/offline-pack-components/
 *     manifest.json
 *     components/
 *       llama-win-x64.zip
 *       llama-mac-arm64.zip
 *       llama-mac-x64.zip (optional if present)
 *     resources/
 *       models/model-8b-q4.gguf   (hardlink/copy)
 *
 * The manifest format matches what the desktop app expects in:
 *   desktop-app/src/offline/offlineResourcesInstaller.js
 *
 * Usage:
 *   node scripts/build-offline-pack-manifest.mjs --version v1 --out release-assets/offline-pack-components
 */

import crypto from 'node:crypto';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';

const repoRoot = path.resolve(process.cwd());
const resourcesDir = path.join(repoRoot, 'desktop-app', 'resources');

function parseArgs(argv) {
  const args = { versionPrefix: 'v1', outDir: 'release-assets/offline-pack-components' };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--version' || a === '--prefix') args.versionPrefix = argv[++i] || 'v1';
    else if (a === '--out') args.outDir = argv[++i] || args.outDir;
  }
  return args;
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

async function sha256File(filePath) {
  const hash = crypto.createHash('sha256');
  const stream = fs.createReadStream(filePath);
  await new Promise((resolve, reject) => {
    stream.on('data', (d) => hash.update(d));
    stream.on('end', resolve);
    stream.on('error', reject);
  });
  return hash.digest('hex');
}

async function ensureDir(p) {
  await fsp.mkdir(p, { recursive: true });
}

async function zipDirContents({ cwd, relPath, outZip }) {
  await ensureDir(path.dirname(outZip));
  if (fs.existsSync(outZip)) await fsp.rm(outZip);

  // Prefer system zip (mac/linux). On Windows, use PowerShell Compress-Archive.
  if (process.platform === 'win32') {
    // zip a folder by path (requires absolute/quoted)
    const abs = path.join(cwd, relPath);
    await run('powershell.exe', [
      '-NoProfile',
      '-ExecutionPolicy', 'Bypass',
      '-Command',
      `Compress-Archive -Force -Path "${abs}\\*" -DestinationPath "${outZip}"`
    ]);
    return;
  }

  // zip the *contents* of relPath so extraction lands at the expected location
  await run('zip', ['-r', '-q', outZip, '.'], { cwd: path.join(cwd, relPath) });
}

async function copyOrLink(src, dest) {
  await ensureDir(path.dirname(dest));
  if (fs.existsSync(dest)) await fsp.rm(dest);
  try {
    await fsp.link(src, dest);
  } catch {
    await fsp.copyFile(src, dest);
  }
}

async function main() {
  const { versionPrefix, outDir } = parseArgs(process.argv);
  const outAbs = path.isAbsolute(outDir) ? outDir : path.join(repoRoot, outDir);
  const componentsDir = path.join(outAbs, 'components');
  const outResourcesDir = path.join(outAbs, 'resources');

  if (!fs.existsSync(resourcesDir)) {
    throw new Error(`Missing desktop resources dir: ${resourcesDir}`);
  }

  const modelSrc = path.join(resourcesDir, 'models', 'model-8b-q4.gguf');
  if (!fs.existsSync(modelSrc)) {
    throw new Error(
      `Model not found at ${modelSrc}. Put your GGUF at desktop-app/resources/models/model-8b-q4.gguf before building the manifest.`
    );
  }

  // Build component zips for llama per platform (if present)
  const llamaPlatforms = [
    { key: 'win-x64', rel: path.join('llama', 'win-x64'), out: 'llama-win-x64.zip' },
    { key: 'mac-arm64', rel: path.join('llama', 'mac-arm64'), out: 'llama-mac-arm64.zip' },
    { key: 'mac-x64', rel: path.join('llama', 'mac-x64'), out: 'llama-mac-x64.zip' }
  ];

  const platformComponents = {};
  for (const p of llamaPlatforms) {
    const abs = path.join(resourcesDir, p.rel);
    if (!fs.existsSync(abs)) {
      // mac-x64 is optional; others might be missing if you don't ship that platform yet.
      continue;
    }
    const outZip = path.join(componentsDir, p.out);
    console.log(`Creating ${outZip} from ${abs}`);
    await zipDirContents({ cwd: resourcesDir, relPath: p.rel, outZip });
    const sha = await sha256File(outZip);
    platformComponents[p.key] = platformComponents[p.key] || [];
    platformComponents[p.key].push({
      name: `llama-${p.key}`,
      type: 'zip',
      // URL is filled in by the upload script (or you can set it manually).
      url: '',
      // Extract into baseDir/llama/<platformKey>/...
      extractTo: path.join('llama', p.key),
      // path is required by the app schema; for zip components we keep it informational.
      path: path.join('llama', p.key),
      version: null,
      sha256: sha
    });
  }

  // Copy/link the model into the output resources folder for upload
  const modelOut = path.join(outResourcesDir, 'models', 'model-8b-q4.gguf');
  await copyOrLink(modelSrc, modelOut);
  const modelSha = await sha256File(modelOut);

  const manifest = {
    version: `${versionPrefix}-${new Date().toISOString().replace(/[:.]/g, '-')}`,
    components: {
      common: [
        {
          name: 'model-8b-q4',
          type: 'file',
          url: '',
          path: path.join('models', 'model-8b-q4.gguf'),
          version: null,
          sha256: modelSha
        }
      ],
      platform: platformComponents
    }
  };

  await ensureDir(outAbs);
  const manifestPath = path.join(outAbs, 'manifest.json');
  await fsp.writeFile(manifestPath, JSON.stringify(manifest, null, 2), 'utf8');

  console.log('Built offline pack components at:');
  console.log(outAbs);
  console.log('Next: upload manifest.json + components + model to Supabase and fill in URLs in manifest.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});


