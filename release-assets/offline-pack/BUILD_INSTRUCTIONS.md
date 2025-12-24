# Offline Pack — build instructions

To ship **offline analysis** inside the installer, the desktop build must include:

- `resources/models/model-8b-q4.gguf`
- `resources/llama/win-x64/llama.exe` (Windows)
- `resources/llama/mac-arm64/llama` (macOS Apple Silicon)
- `resources/llama/mac-x64/llama` (macOS Intel, optional)

## Local build

1. Put your model/binaries into `desktop-app/resources/` using the paths above.
2. Build web assets:

```bash
cd ..
npm run build
```

3. Copy web assets into desktop:

```bash
cd desktop-app
npm run copy-assets
```

4. Build installer artifacts:

```bash
npm run dist
```

Artifacts will appear in `desktop-app/out-builder/`.

## CI build (GitHub Actions)

The workflow can optionally download an “offline pack zip” at build time.

- Create a zip that contains a **top-level `resources/` folder** (exactly like `release-assets/offline-pack/resources/`).
- Upload that zip somewhere accessible to GitHub Actions.
- Add a repo secret:
  - `OFFLINE_PACK_URL` = the download URL to that zip

When set, CI will download it and bundle those files into the installers.

## Supabase “delta updates” (download only what changed)

The desktop app supports **component-based** offline pack updates via a Supabase-hosted `manifest.json`.

### 1) Build component zips + manifest.json

First, make sure your offline resources exist locally (model + llama binaries) under:

- `desktop-app/resources/models/model-8b-q4.gguf`
- `desktop-app/resources/llama/win-x64/*`
- `desktop-app/resources/llama/mac-arm64/*`
- `desktop-app/resources/llama/mac-x64/*` (optional)

Then build the component artifacts:

```bash
node scripts/build-offline-pack-manifest.mjs --version v1 --out release-assets/offline-pack-components
```

### Optional: include a portable “OCR Tools Pack”

If you have a prebuilt portable OCR bundle zip per platform, you can download/install it into:

- `desktop-app/resources/ocr/win-x64/` (must include `ocrmypdf.exe`)
- `desktop-app/resources/ocr/mac-arm64/` (must include `ocrmypdf`)
- `desktop-app/resources/ocr/mac-x64/` (optional)

1) Copy `scripts/ocr-tools.config.example.json` to `scripts/ocr-tools.config.json` and paste your bundle URLs.
2) Run:

```bash
node scripts/fetch-ocr-tools.mjs --config scripts/ocr-tools.config.json
```

Then re-run `build-offline-pack-manifest.mjs` so it produces `ocr-*.zip` components automatically.

### 2) Upload to Supabase Storage (public bucket)

This uploads:
- model file (only re-downloaded when it changes)
- llama zips per platform (only re-downloaded when they change)
- `manifest.json` to drive updates

```bash
npm i

SUPABASE_URL="https://<project-ref>.supabase.co" \
SUPABASE_SERVICE_ROLE_KEY="..." \
node scripts/upload-offline-pack-components-to-supabase.mjs \
  --bucket offline-packs \
  --prefix v1 \
  --dir release-assets/offline-pack-components \
  --overwrite
```

The app’s default manifest URL is:
- `.../storage/v1/object/public/offline-packs/v1/manifest.json`

If you want to use a different prefix (e.g. `v2`), set `OFFLINE_PACK_MANIFEST_PUBLIC_URL` at runtime or ship a new desktop build with an updated default.




