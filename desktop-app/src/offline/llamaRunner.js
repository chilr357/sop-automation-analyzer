const fs = require('node:fs');
const fsp = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');

function isPackaged() {
  // Electron sets this in main/preload contexts.
  return !!process.resourcesPath && !process.resourcesPath.includes('node_modules');
}

function getResourcesBase() {
  // We keep offline resources under `desktop-app/resources/` in dev,
  // and under `<resourcesPath>/resources/` in packaged builds via Forge extraResource.
  if (process.resourcesPath && process.env.NODE_ENV === 'production') {
    return path.join(process.resourcesPath, 'resources');
  }
  return path.resolve(__dirname, '..', '..', 'resources');
}

function getPlatformKey() {
  if (process.platform === 'darwin') {
    if (process.arch === 'arm64') return 'mac-arm64';
    return 'mac-x64';
  }
  if (process.platform === 'win32') {
    return 'win-x64';
  }
  return `${process.platform}-${process.arch}`;
}

function findLlamaBinary(resourcesBase) {
  const platformKey = getPlatformKey();
  const binDir = path.join(resourcesBase, 'llama', platformKey);
  const candidates = process.platform === 'win32'
    ? ['llama.exe', 'llama-cli.exe', 'main.exe']
    : ['llama', 'llama-cli', 'main'];

  for (const name of candidates) {
    const full = path.join(binDir, name);
    if (fs.existsSync(full)) {
      return full;
    }
  }
  return null;
}

function getModelPath(resourcesBase) {
  // Expected location. Users can replace with their chosen 8B GGUF.
  return path.join(resourcesBase, 'models', 'model-8b-q4.gguf');
}

function extractJsonObject(text) {
  const first = text.indexOf('{');
  const last = text.lastIndexOf('}');
  if (first === -1 || last === -1 || last <= first) {
    throw new Error('Model output did not contain a JSON object.');
  }
  return text.slice(first, last + 1);
}

async function runLlamaCli({ prompt }) {
  const resourcesBase = getResourcesBase();
  const llamaBin = findLlamaBinary(resourcesBase);
  const modelPath = getModelPath(resourcesBase);

  if (!llamaBin) {
    throw new Error(
      `Offline analysis is not configured: missing llama.cpp binary. Expected under: ${path.join(resourcesBase, 'llama', getPlatformKey())}`
    );
  }
  if (!fs.existsSync(modelPath)) {
    throw new Error(
      `Offline analysis is not configured: missing GGUF model. Expected at: ${modelPath}`
    );
  }

  // Avoid command-line length issues (especially on Windows) by writing the prompt to a temp file.
  const promptFile = await fsp.mkdtemp(path.join(os.tmpdir(), 'sop-analyzer-'));
  const promptPath = path.join(promptFile, 'prompt.txt');
  await fsp.writeFile(promptPath, prompt, 'utf8');

  // NOTE: llama.cpp CLIs differ by build. We aim for common flags used by `llama-cli` / `main`.
  const args = [
    '-m', modelPath,
    '-f', promptPath,
    '--ctx-size', '8192',
    '--n-predict', '4096',
    '--temp', '0.2',
    '--top-p', '0.9',
    '--repeat-penalty', '1.1',
    '--no-display-prompt'
  ];

  return await new Promise((resolve, reject) => {
    const child = spawn(llamaBin, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';

    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString('utf8');
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString('utf8');
    });

    child.on('error', (err) => reject(err));
    child.on('close', (code) => {
      if (code === 0) {
        return resolve(stdout);
      }
      reject(new Error(`llama.cpp exited with code ${code}. ${stderr}`.trim()));
    });
  });
}

async function runLlamaJson({ prompt }) {
  const raw = await runLlamaCli({ prompt });
  const jsonText = extractJsonObject(raw);
  const data = JSON.parse(jsonText);
  return data;
}

module.exports = { runLlamaJson, getResourcesBase, getPlatformKey, getModelPath };


