#!/usr/bin/env node

const path = require('node:path');
const fs = require('fs-extra');

const projectRoot = path.resolve(__dirname, '..', '..');
const desktopRoot = path.resolve(__dirname, '..');
const sourceDir = path.join(projectRoot, 'dist');
const targetDir = path.join(desktopRoot, 'assets');

async function main() {
  if (!fs.existsSync(sourceDir)) {
    console.error('✖ The Vite build output was not found. Run `npm run build` in the project root first.');
    process.exit(1);
  }

  await fs.ensureDir(targetDir);
  await fs.emptyDir(targetDir);

  await fs.copy(sourceDir, targetDir, {
    filter: (src) => !src.endsWith('.map')
  });

  console.log('✔ Copied Vite build assets into desktop-app/assets');
}

main().catch((error) => {
  console.error('Failed to copy build assets:', error);
  process.exit(1);
});
