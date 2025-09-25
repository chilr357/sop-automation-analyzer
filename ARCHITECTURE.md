## SOP Automation Analyzer – Technical Architecture (Updated)

Version: 2.0  
Date: September 25, 2025

### Executive Summary
SOP Automation Analyzer is now a desktop application built with Electron that embeds a React 19 + TypeScript SPA for analyzing SOP PDFs using Google Gemini (gemini-2.5-flash via `@google/genai`). The React app is bundled by Vite and loaded locally by Electron. Packaging, signing, and notarization produce a notarized, universal macOS app and DMG for distribution.

### Core Stack
- UI: React 19, TypeScript, Tailwind CSS (CDN)
- AI Service: Google Gemini via `@google/genai`
- Build: Vite for web assets; Electron Forge for desktop packaging
- Desktop: Electron (Main/Preload/Renderer)
- Distribution: ZIP and DMG; notarized Developer ID; universal (x86_64 + arm64)

### Architectural Goals
- Maintainability via modular components (`components/*`) and a service layer (`services/geminiService.ts`).
- Responsive UX with async workflows and clear loading/error states.
- Security improved for desktop distribution via code signing and notarization; note that direct API access still exists in renderer.
- Performance via local bundling and universal binary.

### Frontend (Renderer) Architecture
- Components: `FileUpload`, `ResultsDisplay`, `IconComponents`, rooted in `App.tsx`.
- State: React hooks in `App.tsx` (global) and local component state where appropriate.
- Styling: Tailwind via CDN configured in `index.html`.
- Service Layer: `services/geminiService.ts` encapsulates Gemini calls with strict JSON schema and a domain SYSTEM prompt.

### Electron Architecture
- Main Process (`desktop-app/src/main.js`): creates `BrowserWindow`, loads local assets from `desktop-app/assets`.
- Preload (`desktop-app/src/preload.js`): bridges safe APIs to the renderer via `contextBridge`.
- Renderer: the bundled React SPA served from the local app resources.

### Data Flow
1. User selects/drops PDFs in `FileUpload` → passes `File[]` to `App.tsx`.
2. `App.tsx` sets `isLoading` and calls `analyzeSOP` for each file concurrently (`Promise.allSettled`).
3. `geminiService.ts` reads the file (Base64), constructs `generateContent` with SYSTEM prompt + PDF part, enforces `responseMimeType: application/json` and `RESPONSE_SCHEMA`.
4. Gemini returns JSON → parsed to typed object → `App.tsx` aggregates into `analysisReports` and errors → `ResultsDisplay` renders tabs/sections.

### Build & Packaging Pipeline
- Vite build in `sop-automation-analyzer` → emits `dist/` web assets.
- `desktop-app/scripts/copy-assets.js` clears and copies into `desktop-app/assets/`.
- Electron Forge `package`/`make`:
  - Makers: `@electron-forge/maker-zip` (darwin), `@electron-forge/maker-dmg`.
  - Signing: `osxSign` with entitlements (`entitlements.mac.plist`, `entitlements.mac.inherit.plist`, hardened runtime).
  - Notarization: `osxNotarize` via Apple Notarytool with API key (env-configured).
  - Universal binary: `--arch=universal` stitches x64 + arm64.
  - Outputs: `.app`, `.zip`, `.dmg` under `desktop-app/out/` and `out/make/`.

### Configuration Files
- `desktop-app/forge.config.js`: zip + dmg makers, osxSign, osxNotarize, universal builds.
- Entitlements: `desktop-app/entitlements/entitlements.mac.plist`, `entitlements.mac.inherit.plist`.
- Notarization uses env: `MAC_SIGN`, `MAC_NOTARIZE`, `MAC_CODESIGN_IDENTITY`, `APPLE_API_KEY_PATH`, `APPLE_API_KEY_ID`, `APPLE_API_ISSUER`, `APPLE_TEAM_ID`.

### Security Considerations
- Desktop distribution is signed and notarized to pass Gatekeeper.
- The renderer invokes Gemini directly; keys are provided via environment and process at build/run time. For a future web deployment, implement a Backend‑for‑Frontend (BFF) to protect secrets and add caching/rate limits.

### Future Improvements
- Optional BFF for request proxying, caching, cost controls.
- Web Worker for large PDF processing to keep UI thread responsive.
- Streaming responses if supported to progressively render analysis.
- CI (GitHub Actions) to build, sign, notarize, and attach DMG/ZIP to Releases.

### Diagrams

#### Runtime
```mermaid
flowchart TD
    U[User] -->|Drag/drop PDFs| R

    subgraph macOS Device
      subgraph "Electron Main Process"
        M[main.js]\ncreates BrowserWindow
        P[preload.js\ncontextBridge]
      end

      subgraph "Electron Renderer (React SPA)"
        R[React 19 + TS + Tailwind (CDN)\nFileUpload / ResultsDisplay]
        S[services/geminiService.ts\n@google/genai SDK]
      end

      A[(desktop-app/assets\nVite-bundled web app)]
    end

    M -->|loads file:// assets from| A
    M --> P
    P --> R

    R -->|FileReader: read + base64 PDF| S
    S -->|HTTPS JSON schema request| G[(Google Gemini 2.5‑flash API)]
    G -->|JSON report| R
    R -->|Render tabs/sections| U
```

#### Build & Packaging
```mermaid
flowchart LR
  V[Vite build (sop-automation-analyzer)] --> D[dist/]
  D --> C[desktop-app/scripts/copy-assets.js]
  C --> A[(desktop-app/assets)]
  A --> F[Electron Forge package/make\nosxSign + osxNotarize (entitlements)\narch=universal]
  F --> UApp[.app (darwin-universal)]
  F --> DMG[.dmg (darwin-universal)]
  F --> ZIP[.zip (darwin-universal)]
```


