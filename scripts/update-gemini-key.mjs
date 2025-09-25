#!/usr/bin/env node

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const [, , newKey] = process.argv;

if (!newKey) {
  console.error('Usage: node scripts/update-gemini-key.mjs <GEMINI_API_KEY>');
  process.exit(1);
}

const envPath = resolve(process.cwd(), '.env.local');

if (!existsSync(envPath)) {
  console.error(`.env.local not found at ${envPath}`);
  process.exit(1);
}

const original = readFileSync(envPath, 'utf8');
const keyLine = `GEMINI_API_KEY=${newKey}`;
const pattern = /^GEMINI_API_KEY=.*$/m;
let updated;

if (pattern.test(original)) {
  updated = original.replace(pattern, keyLine);
} else {
  updated = original.trimEnd();
  updated = updated.length > 0 ? `${updated}\n${keyLine}\n` : `${keyLine}\n`;
}

writeFileSync(envPath, updated, 'utf8');
console.log('Updated GEMINI_API_KEY in .env.local');
