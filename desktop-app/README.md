# Digital Process Automation Analyzer Desktop Wrapper

This directory contains an Electron Forge configuration that packages the Digital Process Automation Analyzer web application as a Windows desktop executable.

## Prerequisites

- Node.js 18+
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

3. Create a distributable installer:

```bash
npm run make
```

- The Windows installer and portable ZIP reside in `desktop-app/out/make/`.

### Scripts

- `npm start` – launches Electron in development mode.
- `npm run package` – creates a packaged app without installer.
- `npm run make` – builds the installer and portable zip.
- `npm run copy-assets` – copies `../dist` into `assets/`.

### Customization

- Place your icon files in `desktop-app/assets/icon.ico` and `desktop-app/assets/icon.png`.
- Update `forge.config.js` with manufacturer metadata.
- Modify `src/main.js` to add tray menus, auto-launch, or update mechanisms.

### Notes

- The renderer iframe uses `sandbox="allow-same-origin allow-scripts"` to keep the surface secure.
- `preload.js` exposes a minimal, safe bridge via `desktopAPI`.
- When `NODE_ENV` is production, the app loads the packaged `index.html` from `assets/`.
- Ensure all environment variables required by the web app are inlined during the Vite build.

