#!/usr/bin/env node

/**
 * electron-builder (and some packagers) can choke when optionalDependencies are listed
 * but their platform-specific packages are not installed (common with @napi-rs/canvas).
 *
 * Workaround: ensure placeholder directories exist for each optional dep so packagers
 * don't fail on missing paths during dependency walking.
 */

const fs = require('node:fs');
const path = require('node:path');

function ensureDir(p) {
  fs.mkdirSync(p, { recursive: true });
}

function writeJson(p, obj) {
  fs.writeFileSync(p, JSON.stringify(obj, null, 2), 'utf8');
}

function main() {
  let canvasPkgPath;
  try {
    canvasPkgPath = require.resolve('@napi-rs/canvas/package.json');
  } catch {
    return;
  }

  const canvasPkg = JSON.parse(fs.readFileSync(canvasPkgPath, 'utf8'));
  const optional = canvasPkg.optionalDependencies || {};
  const optionalNames = Object.keys(optional);
  if (optionalNames.length === 0) {
    return;
  }

  // canvasPkgPath: <project>/node_modules/@napi-rs/canvas/package.json
  // We want <project>/node_modules
  const nodeModulesDir = path.resolve(path.dirname(canvasPkgPath), '..', '..');

  for (const depName of optionalNames) {
    const depDir = path.join(nodeModulesDir, depName);
    if (fs.existsSync(depDir)) {
      continue;
    }

    ensureDir(depDir);
    const pkgJsonPath = path.join(depDir, 'package.json');
    if (!fs.existsSync(pkgJsonPath)) {
      writeJson(pkgJsonPath, {
        name: depName,
        version: '0.0.0-placeholder',
        description: 'Placeholder package to satisfy packagers. Not used at runtime.'
      });
    }
  }
}

main();


