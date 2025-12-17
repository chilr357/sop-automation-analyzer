# Digital Process Automation Analyzer Desktop App

This directory contains the Electron desktop application for the Digital Process Automation Analyzer.

It includes:
- An Electron shell that loads the bundled React SPA (`../dist` copied into `desktop-app/assets`)
- Offline analysis scaffolding (PDF text extraction + llama.cpp runner) via IPC
- **Auto-updates** using `electron-updater` backed by **GitHub Releases** (requires electron-builder artifacts)

## Prerequisites

- Node.js 20+ (CI uses Node 22)
- npm 10+
- The Vite web app is built via `npm run build` in the project root.

## Getting Started

1. Install dependencies:

```bash
cd desktop-app
npm install
```

2. During development, run the web app dev server from the project root:

```bash
npm run dev
```

3. Start the Electron shell (in another terminal):

```bash
cd desktop-app
npm start
```

The Electron window will load `http://localhost:5173` when `NODE_ENV=development`.

## Packaging for Distribution

1. Build the web app assets:

```bash
npm run build
```

This generates `dist/` in the project root.

2. Copy the Vite build output into the Electron assets folder:

```bash
cd desktop-app
npm run copy-assets
```

3. Create distributables (electron-builder):

```bash
npm run dist
```

Artifacts are written to `desktop-app/out-builder/`.

### Auto-updater (GitHub Releases)

The app checks GitHub Releases for updates using `electron-updater`.

- On launch (production builds), the app calls `autoUpdater.checkForUpdatesAndNotify()`
- When an update is downloaded, the app prompts to restart and install

#### macOS signing note (important)

For **seamless** macOS auto-updates, the app should be **code signed** (and ideally notarized).
This repo currently disables signing in CI by default (`CSC_IDENTITY_AUTO_DISCOVERY=false`).
When you’re ready, add code-signing secrets and enable signing so updates install smoothly on macOS.

### Scripts

- `npm start` – launches Electron in development mode.
- `npm run copy-assets` – copies `../dist` into `assets/`.
- `npm run dist` – builds distributables with electron-builder.
- `npm run dist:ci` – builds distributables without publishing.
- `npm run dist:publish` – builds and publishes to GitHub Releases (requires `GH_TOKEN`).

### Customization

- Provide icon files if you want branded installers/icons (electron-builder uses the default icon if none are set).
- Modify `src/main.js` to adjust update UX, tray menus, etc.

### Notes

- `preload.js` exposes a minimal, safe bridge via `desktopAPI`.
- When `NODE_ENV` is production, the app loads the packaged `index.html` from `assets/`.
- Ensure all environment variables required by the web app are inlined during the Vite build.

