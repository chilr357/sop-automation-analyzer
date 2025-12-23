# Offline resources

This folder is reserved for **fully-offline** desktop analysis resources:

- **Model**: `desktop-app/resources/models/model-8b-q4.gguf`
- **llama.cpp binary**:
  - Windows: `desktop-app/resources/llama/win-x64/llama.exe` (or `llama-cli.exe`)
  - macOS Intel: `desktop-app/resources/llama/mac-x64/llama` (or `llama-cli`)
  - macOS Apple Silicon: `desktop-app/resources/llama/mac-arm64/llama` (or `llama-cli`)

These files are intentionally **gitignored** (they can be multiple GB).

The Electron main process looks for these paths at runtime and will show a clear error if they are missing.




