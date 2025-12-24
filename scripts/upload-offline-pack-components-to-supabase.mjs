#!/usr/bin/env node
/**
 * Upload component-based offline pack assets to Supabase Storage:
 * - manifest.json -> <bucket>/<prefix>/manifest.json
 * - component zips -> <bucket>/<prefix>/components/*.zip
 * - model file -> <bucket>/<prefix>/resources/models/model-8b-q4.gguf
 *
 * Then rewrites manifest.json URLs to their public URLs and re-uploads it.
 *
 * Usage:
 *   SUPABASE_URL="https://<project-ref>.supabase.co" \
 *   SUPABASE_SERVICE_ROLE_KEY="..." \
 *   node scripts/upload-offline-pack-components-to-supabase.mjs \
 *     --bucket offline-packs \
 *     --prefix v1 \
 *     --dir release-assets/offline-pack-components \
 *     --overwrite
 */

import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';

function parseArgs(argv) {
  const args = { bucket: '', prefix: '', dir: '', overwrite: false };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--bucket') args.bucket = argv[++i] || '';
    else if (a === '--prefix') args.prefix = (argv[++i] || '').replace(/^\/+|\/+$/g, '');
    else if (a === '--dir') args.dir = argv[++i] || '';
    else if (a === '--overwrite' || a === '--upsert') args.overwrite = true;
  }
  return args;
}

function must(v, name) {
  if (!v) throw new Error(`Missing ${name}`);
  return v;
}

function joinObjectPath(...parts) {
  return parts.filter(Boolean).join('/').replace(/\/+/g, '/');
}

async function uploadObject({ supabaseUrl, key, bucket, objectPath, filePath, contentType, overwrite }) {
  const endpoint = `${supabaseUrl}/storage/v1/object/${encodeURIComponent(bucket)}/${objectPath
    .split('/')
    .map(encodeURIComponent)
    .join('/')}`;

  const stat = fs.statSync(filePath);
  if (!stat.isFile()) throw new Error(`Not a file: ${filePath}`);

  const res = await fetch(endpoint, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${key}`,
      apikey: key,
      'Content-Type': contentType,
      ...(overwrite ? { 'x-upsert': 'true' } : {})
    },
    body: fs.createReadStream(filePath),
    duplex: 'half'
  });

  const text = await res.text();
  if (!res.ok) {
    throw new Error(`Upload failed for ${objectPath} (${res.status}): ${text}`);
  }
}

function publicUrl(supabaseUrl, bucket, objectPath) {
  return `${supabaseUrl}/storage/v1/object/public/${bucket}/${objectPath}`;
}

function getProjectRefFromSupabaseUrl(supabaseUrl) {
  const u = new URL(supabaseUrl);
  const host = u.hostname; // <ref>.supabase.co
  const ref = host.split('.')[0];
  if (!ref) throw new Error(`Could not parse project ref from SUPABASE_URL host: ${host}`);
  return ref;
}

function getTusEndpointFromSupabaseUrl(supabaseUrl) {
  // Recommended by Supabase docs for best performance:
  // https://<project-ref>.storage.supabase.co/storage/v1/upload/resumable
  const ref = getProjectRefFromSupabaseUrl(supabaseUrl);
  return `https://${ref}.storage.supabase.co/storage/v1/upload/resumable`;
}

async function uploadObjectTusResumable({ supabaseUrl, key, bucket, objectPath, filePath, contentType, overwrite }) {
  // Lazy import so this script can still run without tus-js-client for small uploads.
  let tusMod;
  try {
    tusMod = await import('tus-js-client');
  } catch (e) {
    throw new Error(
      `Missing dependency tus-js-client. Install it first: npm i -D tus-js-client. Original error: ${e?.message || String(e)}`
    );
  }
  const tus = tusMod.default || tusMod;

  const stat = fs.statSync(filePath);
  const endpoint = getTusEndpointFromSupabaseUrl(supabaseUrl);

  console.log(`Resumable upload (TUS) -> ${bucket}/${objectPath} (${stat.size} bytes)`);
  console.log(`Endpoint: ${endpoint}`);

  return await new Promise((resolve, reject) => {
    const fileStream = fs.createReadStream(filePath);
    const upload = new tus.Upload(fileStream, {
      endpoint,
      uploadSize: stat.size,
      retryDelays: [0, 3000, 5000, 10000, 20000],
      headers: {
        authorization: `Bearer ${key}`,
        apikey: key,
        ...(overwrite ? { 'x-upsert': 'true' } : {})
      },
      uploadDataDuringCreation: true,
      removeFingerprintOnSuccess: true,
      metadata: {
        bucketName: bucket,
        objectName: objectPath,
        contentType: contentType || 'application/octet-stream',
        cacheControl: '3600'
      },
      chunkSize: 6 * 1024 * 1024, // Supabase requirement (currently)
      onError: (err) => reject(err),
      onProgress: (bytesUploaded, bytesTotal) => {
        const pct = bytesTotal ? ((bytesUploaded / bytesTotal) * 100).toFixed(2) : '0';
        process.stdout.write(`\rUploaded ${bytesUploaded}/${bytesTotal} bytes (${pct}%)`);
      },
      onSuccess: () => {
        process.stdout.write('\n');
        resolve();
      }
    });

    // Note: without a persistent urlStorage, uploads will still retry and continue within this run,
    // but will not resume across script restarts.
    upload.start();
  });
}

async function main() {
  const { bucket, prefix, dir, overwrite } = parseArgs(process.argv);
  const supabaseUrlRaw = must(process.env.SUPABASE_URL, 'SUPABASE_URL');
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_ROLE;
  must(key, 'SUPABASE_SERVICE_ROLE_KEY (or SUPABASE_SERVICE_ROLE)');
  must(bucket, '--bucket');
  must(prefix, '--prefix (e.g. v1)');
  must(dir, '--dir (e.g. release-assets/offline-pack-components)');

  const supabaseUrl = supabaseUrlRaw.endsWith('/') ? supabaseUrlRaw.slice(0, -1) : supabaseUrlRaw;
  const repoRoot = path.resolve(process.cwd());
  const baseDir = path.isAbsolute(dir) ? dir : path.join(repoRoot, dir);

  const manifestPath = path.join(baseDir, 'manifest.json');
  if (!fs.existsSync(manifestPath)) throw new Error(`Manifest not found: ${manifestPath}`);

  const manifest = JSON.parse(await fsp.readFile(manifestPath, 'utf8'));

  // 1) Upload model
  const modelFile = path.join(baseDir, 'resources', 'models', 'model-8b-q4.gguf');
  if (!fs.existsSync(modelFile)) throw new Error(`Model file not found: ${modelFile}`);
  const modelObject = joinObjectPath(prefix, 'resources', 'models', 'model-8b-q4.gguf');
  console.log(`Uploading model -> ${modelObject}`);
  const modelStat = fs.statSync(modelFile);
  if (modelStat.size > 25 * 1024 * 1024) {
    // Use resumable upload for large files (recommended by Supabase; avoids mid-stream disconnects).
    await uploadObjectTusResumable({
      supabaseUrl,
      key,
      bucket,
      objectPath: modelObject,
      filePath: modelFile,
      contentType: 'application/octet-stream',
      overwrite
    });
  } else {
    await uploadObject({
      supabaseUrl,
      key,
      bucket,
      objectPath: modelObject,
      filePath: modelFile,
      contentType: 'application/octet-stream',
      overwrite
    });
  }
  const modelUrl = publicUrl(supabaseUrl, bucket, modelObject);

  // 2) Upload component zips
  const componentsDir = path.join(baseDir, 'components');
  const componentFiles = fs.existsSync(componentsDir)
    ? (await fsp.readdir(componentsDir)).filter((n) => n.toLowerCase().endsWith('.zip'))
    : [];

  const componentUrlByName = new Map();
  for (const name of componentFiles) {
    const full = path.join(componentsDir, name);
    const objectPath = joinObjectPath(prefix, 'components', name);
    console.log(`Uploading component -> ${objectPath}`);
    await uploadObject({
      supabaseUrl,
      key,
      bucket,
      objectPath,
      filePath: full,
      contentType: 'application/zip',
      overwrite
    });
    componentUrlByName.set(name, publicUrl(supabaseUrl, bucket, objectPath));
  }

  // 3) Fill in manifest URLs
  if (manifest?.components?.common?.length) {
    for (const c of manifest.components.common) {
      if (c?.name === 'model-8b-q4') {
        c.url = modelUrl;
      }
    }
  }
  if (manifest?.components?.platform) {
    for (const key of Object.keys(manifest.components.platform)) {
      const arr = manifest.components.platform[key] || [];
      for (const c of arr) {
        if (!c || c.type !== 'zip') continue;
        // Map `llama-<platform>.zip`
        const expectedZip = `llama-${key}.zip`;
        if (componentUrlByName.has(expectedZip)) {
          c.url = componentUrlByName.get(expectedZip);
        }
      }
    }
  }

  // 4) Upload manifest.json (rewritten)
  const manifestObject = joinObjectPath(prefix, 'manifest.json');
  const rewrittenManifestPath = path.join(baseDir, 'manifest.rewritten.json');
  await fsp.writeFile(rewrittenManifestPath, JSON.stringify(manifest, null, 2), 'utf8');

  console.log(`Uploading manifest -> ${manifestObject}`);
  await uploadObject({
    supabaseUrl,
    key,
    bucket,
    objectPath: manifestObject,
    filePath: rewrittenManifestPath,
    contentType: 'application/json',
    overwrite
  });

  const manifestPublic = publicUrl(supabaseUrl, bucket, manifestObject);
  console.log('Upload OK.');
  console.log('Public manifest URL (put this in the app default if desired):');
  console.log(manifestPublic);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});


