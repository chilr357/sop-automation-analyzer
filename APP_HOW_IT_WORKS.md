# Digital Process Automation Analyzer — How the App Works

## Overview

This project is a **desktop app (Electron) that embeds a React 19 + TypeScript single‑page app**.

- **What it does**: lets users upload one or more **SOP PDFs**, sends each PDF to **Google Gemini (gemini-2.5-flash)** with a strict **system prompt** and **JSON response schema**, and renders a structured **automation opportunities report** per document.
- **Two layers**:
  - **Web app (React + Vite)** in the repo root.
  - **Desktop wrapper (Electron + Electron Forge)** in `desktop-app/` that packages and runs the web app locally.

## User flow (what someone sees)

### 1) Launch (Desktop)

- Electron opens a window titled **“Digital Process Automation Analyzer”**.
- The Electron shell UI (in `desktop-app/src/index.html`) shows:
  - App title + version
  - Buttons: **Reload**, **Open in Browser**
  - An `<iframe>` that loads the React SPA

### 2) Upload SOP PDFs

- The React app renders a header + the upload widget (`components/FileUpload.tsx`).
- The upload widget supports:
  - Click to select files
  - Drag/drop files
  - **PDF only** (non‑PDF drops trigger an alert)
  - A list of selected files with per‑file remove buttons
  - A single **Analyze** button that runs analysis for all selected PDFs

### 3) Analyze (AI call)

- When the user clicks Analyze:
  - The app clears prior results/errors and shows a loading spinner.
  - Each file is analyzed **in parallel**; failures don’t block other files.

### 4) View results

- Results render as a **tabbed view** (one tab per uploaded PDF).
- Each report shows:
  - **Executive Summary** cards (manual touchpoints, automation potential, time savings, etc.)
  - An **Automation Opportunities Matrix** table including:
    - SOP reference (clickable link opens the PDF at `#page=<pageNumber>`)
    - Current manual process
    - Proposed automation solution
    - Complexity + ROI + timeline
  - **Implementation Roadmap** phases
  - **Current State Analysis** (bottlenecks and data flow)

### 5) Errors and cleanup

- If one or more files fail, an error panel lists each file and its message.
- The app revokes created object URLs when replacing reports / unmounting (avoids memory leaks).

## Core frontend (React) architecture

### Entry point

- `index.tsx` mounts `<App />` into `#root`.

### App-level orchestration

- `App.tsx` owns top-level state:
  - `analysisReports[]`: one report per successfully analyzed file
  - `errors[]`: failures by filename
  - `isLoading`: shows loading indicator and disables Analyze
- It calls `analyzeSOP(file)` for each selected PDF using `Promise.allSettled`.

### UI components

- `components/FileUpload.tsx`: drag/drop + file picker + file list + Analyze button
- `components/ResultsDisplay.tsx`: tabs + report rendering + matrix table
- `components/IconComponents.tsx`: SVG icons used by the UI

### Styling

- Tailwind is used via CDN configuration in `index.html` (root).

## AI integration details (Gemini)

### Prompt and strict JSON output

- `constants.ts` defines:
  - `SYSTEM_PROMPT`: pharma/manufacturing optimization persona and instructions (cGMP, compliance, automation categories, step/page references, etc.)
  - `RESPONSE_SCHEMA`: a strict schema (OpenAPI-style) that Gemini must follow
- `types.ts` defines `AnalysisReport` and related TypeScript types matching the schema.

### How `analyzeSOP` works

- Implemented in `services/geminiService.ts`:
  - Requires `process.env.API_KEY` (throws if missing).
  - Reads the PDF with `FileReader.readAsDataURL`, extracts base64.
  - Calls `@google/genai`:
    - `model: "gemini-2.5-flash"`
    - `contents.parts`: `{ text: SYSTEM_PROMPT }` + the PDF as `inlineData`
    - `config.responseMimeType = "application/json"`
    - `config.responseSchema = RESPONSE_SCHEMA`
  - Parses `response.text` as JSON into an `AnalysisReport`.
  - Rejects with a friendly error message on failure.

## Desktop (Electron) architecture

### Main process: window + IPC

- `desktop-app/src/main.js`:
  - Creates the `BrowserWindow` with:
    - `contextIsolation: true`
    - `nodeIntegration: false`
    - `sandbox: true`
    - `preload: desktop-app/src/preload.js`
  - Loads `desktop-app/src/index.html` (the shell page).
  - Supplies IPC handlers for:
    - app name/version
    - the embedded app start URL (dev server or packaged file URL)
  - Adds a **Confirm Exit** dialog on close.

### Preload bridge

- `desktop-app/src/preload.js` exposes `window.desktopAPI` via `contextBridge`:
  - `getAppInfo()`
  - `getStartUrl()`
  - `openExternal(url)`

### Renderer shell: iframe host

- `desktop-app/src/renderer.js`:
  - On DOMContentLoaded:
    - Reads app version via `desktopAPI`
    - Fetches the start URL
    - Sets the iframe `src`
    - Wires Reload / Open in Browser buttons
  - Shows an error banner if the embedded web app can’t be loaded.

## Build & packaging (what gets shipped)

- Root web app builds with Vite into `dist/`.
- `desktop-app/scripts/copy-assets.js` copies the built web assets into `desktop-app/assets/`.
- Electron Forge packages/signs/notarizes and produces DMG/ZIP outputs (see `ARCHITECTURE.md`).

## One-sentence summary

**A signed/notarized Electron desktop wrapper loads a local React SPA; the SPA uploads SOP PDFs, sends them to Gemini with a strict prompt + JSON schema, and renders a tabbed dashboard of automation opportunities, roadmap, and current-state insights per document.**




