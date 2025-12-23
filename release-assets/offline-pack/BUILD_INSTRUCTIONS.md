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




