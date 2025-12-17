#!/usr/bin/env node

/**
 * Upload the generated offline pack zip to a public Supabase Storage bucket.
 *
 * Usage:
 *   SUPABASE_URL="https://<project-ref>.supabase.co" \
 *   SUPABASE_SERVICE_ROLE_KEY="..." \
 *   node scripts/upload-offline-pack-to-supabase.mjs \
 *     --bucket offline-packs \
 *     --object v1/offline-pack-generated.zip \
 *     --file release-assets/offline-pack-generated.zip
 */

import fs from 'node:fs';
import path from 'node:path';

function parseArgs(argv) {
  const args = { bucket: '', object: '', file: '' };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--bucket') args.bucket = argv[++i] || '';
    else if (a === '--object') args.object = argv[++i] || '';
    else if (a === '--file') args.file = argv[++i] || '';
  }
  return args;
}

async function main() {
  const { bucket, object, file } = parseArgs(process.argv);
  const supabaseUrl = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl) throw new Error('Missing SUPABASE_URL (e.g. https://<project-ref>.supabase.co)');
  if (!key) throw new Error('Missing SUPABASE_SERVICE_ROLE_KEY (do not commit this)');
  if (!bucket) throw new Error('Missing --bucket');
  if (!object) throw new Error('Missing --object (e.g. v1/offline-pack-generated.zip)');
  if (!file) throw new Error('Missing --file');

  const absFile = path.isAbsolute(file) ? file : path.resolve(process.cwd(), file);
  const stat = fs.statSync(absFile);
  if (!stat.isFile()) throw new Error(`Not a file: ${absFile}`);

  const endpoint = `${supabaseUrl.replace(/\\/$/, '')}/storage/v1/object/${encodeURIComponent(bucket)}/${object
    .split('/')
    .map(encodeURIComponent)
    .join('/')}`;

  console.log(`Uploading ${absFile} (${stat.size} bytes) -> ${endpoint}`);

  const res = await fetch(endpoint, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${key}`,
      apikey: key,
      'Content-Type': 'application/zip'
    },
    // Stream the file to avoid loading multi-GB into memory
    body: fs.createReadStream(absFile),
    // Required by Node fetch when streaming request bodies
    duplex: 'half'
  });

  const text = await res.text();
  if (!res.ok) {
    throw new Error(`Upload failed (${res.status}): ${text}`);
  }

  console.log('Upload OK.');
  console.log('Public URL (if bucket is public):');
  console.log(`${supabaseUrl.replace(/\\/$/, '')}/storage/v1/object/public/${bucket}/${object}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});


