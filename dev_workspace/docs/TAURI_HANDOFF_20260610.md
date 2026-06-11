# Tauri Launcher Handoff - 2026-06-10

This is the urgent handoff for the LEON Tauri launcher migration.

## Current Worktree

- Work root: `D:\apiWorkSpace\leon_api`
- Active docs root: `D:\apiWorkSpace\leon_api\dev_workspace`
- New Tauri project: `launcher-tauri/`
- Existing WinForms launcher was not intentionally modified.
- Preserve existing user-side dirty deletion:
  - `D config/profiles/leon-default-copy.json`

## Current Tauri Artifact State

- Root exe path: `D:\apiWorkSpace\leon_api\LEON-Launcher-Tauri.exe`
- Release exe path: `launcher-tauri/src-tauri/target/release/leon-launcher-tauri.exe`
- Last observed release exe:
  - size: `3,681,280 bytes`
  - timestamp: `2026/6/10 02:36:57`
- Important: after the latest log-filter UI change, `npm --prefix launcher-tauri run frontend:build`, `cargo fmt --check`, and `cargo check` passed, but `cargo build --release` was interrupted by the user before completion. Treat the root exe as not revalidated for the latest log-filter UI until release build/copy/smoke are rerun.

## Implemented Tauri Functionality

- Rust backend is centralized in `launcher-tauri/src-tauri/src/main.rs`.
- Commands currently include:
  - `get_profiles`, `get_profile`, `create_profile`, `save_profile`, `apply_profile`
  - `copy_profile`, `delete_profile`, `validate_profile`
  - `start_service`, `stop_service`, `warmup_service`, `health_check`, `get_service_status`
  - `get_environment`, `get_log_snapshot`
- Profile flow:
  - lists `config/profiles/*.json` and excludes `active.json`;
  - apply writes `config/profiles/active.json` with `appliedAt` / `appliedFrom`;
  - save writes only the selected source profile and strips runtime fields;
  - create clones `leon-default.json` first, then `active.json`, into `leon-new-profile*.json`;
  - delete blocks deletion of the active profile source.
- Profile editor:
  - edits name, description, default mode, `llmPrompt`;
  - edits current default mode's LIVE and DISK core quality fields:
    `diffusion_steps`, `prompt_audio_seconds`, `segment_tokens`, `first_tokens`, `s2mel_cfg_rate`;
  - edits existing style `label`, `ref`, `style_alpha`, `emo_alpha`;
  - keeps full JSON escape hatch.
- Service flow:
  - start calls `scripts/start-vllm-api.bat` or `scripts/start-fast6g-api.bat`;
  - sets `LEON_ACTIVE_PROFILE_PATH=config/profiles/active.json`, `LEON_LAUNCHER_VERSION`, `LEON_ENABLE_QWEN_EMO=0`, UTF-8 env;
  - vLLM start sets `INDEXTTS_VLLM_GPU_MEMORY_UTILIZATION` and `LEON_ENABLE_MSVC=1`;
  - stop first calls `GET http://127.0.0.1:9880/control?command=exit`;
  - warmup calls `POST /warmup` only after `/health` is reachable and never auto-starts API.
- Logs:
  - logs page polls latest `logs/<version>/` tail every 5 seconds only while active;
  - latest change adds level filter, search, visible count, search-term highlight, stronger warning/error styling.
- Shortcuts:
  - `Ctrl+R` refreshes current page;
  - `Ctrl+L` clears logs;
  - input/select/textarea/contenteditable focus is respected.

## Latest Validation Done

Passed after latest log-filter UI change:

```powershell
node --check launcher-tauri\src\scripts\app.js
node --check launcher-tauri\src\scripts\mock-api.js
npm --prefix launcher-tauri run frontend:build
$env:RUSTUP_HOME='D:\Rust\.rustup'; $env:CARGO_HOME='D:\Rust\.cargo'; $env:Path='D:\Rust\.cargo\bin;' + $env:Path; cargo fmt --manifest-path launcher-tauri\src-tauri\Cargo.toml --check
$env:RUSTUP_HOME='D:\Rust\.rustup'; $env:CARGO_HOME='D:\Rust\.cargo'; $env:Path='D:\Rust\.cargo\bin;' + $env:Path; cargo check --manifest-path launcher-tauri\src-tauri\Cargo.toml
```

Vite output after latest build:

- `dist/index.html`: `16.24 kB`
- `dist/assets/index-BLucUzJX.css`: `14.74 kB`
- `dist/assets/index-BtLC2hHC.js`: `27.32 kB`

Not completed after latest UI change:

```powershell
$env:RUSTUP_HOME='D:\Rust\.rustup'; $env:CARGO_HOME='D:\Rust\.cargo'; $env:Path='D:\Rust\.cargo\bin;' + $env:Path; cargo build --release --manifest-path launcher-tauri\src-tauri\Cargo.toml
Copy-Item launcher-tauri\src-tauri\target\release\leon-launcher-tauri.exe LEON-Launcher-Tauri.exe -Force
$env:LEON_LAUNCHER_SMOKE_TEST='1'; Start-Process -FilePath D:\apiWorkSpace\leon_api\LEON-Launcher-Tauri.exe -WorkingDirectory D:\apiWorkSpace\leon_api -Wait -PassThru
git diff --check
```

Notes:

- First Vite build failed under restricted sandbox with `EPERM` writing `launcher-tauri/vite.config.js.timestamp-*.mjs`; rerun with approval passed.
- First Rust env command failed because `$env:*` was nested through an outer PowerShell command string and expanded incorrectly; direct PowerShell syntax passed.
- Do not run Vite frontend build in parallel with Cargo checks/builds. Vite clears `dist/`, and Tauri can see transient stale asset hashes.

## Latest Code Changes

Touched Tauri frontend files:

- `launcher-tauri/src/index.html`
  - added `log-level-filter`, `log-search`, `log-visible-count`.
- `launcher-tauri/src/scripts/app.js`
  - added in-memory `logEntries`;
  - added `replaceLogs`, `renderLogEntries`, `logEntryMatches`, `highlightQuery`;
  - expanded `logLevelForLine` detection for `fatal`, `panic`, `exception`, `retry`;
  - log rendering now supports filter/search/count and escapes HTML before highlighting.
- `launcher-tauri/src/styles/components.css`
  - added log search/count styles;
  - warning/error/success rows have stronger background;
  - search matches use `<mark>`.

## Next Agent Should Do First

1. Finish release validation in order:

```powershell
npm --prefix launcher-tauri run frontend:build
$env:RUSTUP_HOME='D:\Rust\.rustup'; $env:CARGO_HOME='D:\Rust\.cargo'; $env:Path='D:\Rust\.cargo\bin;' + $env:Path; cargo fmt --manifest-path launcher-tauri\src-tauri\Cargo.toml --check
$env:RUSTUP_HOME='D:\Rust\.rustup'; $env:CARGO_HOME='D:\Rust\.cargo'; $env:Path='D:\Rust\.cargo\bin;' + $env:Path; cargo check --manifest-path launcher-tauri\src-tauri\Cargo.toml
$env:RUSTUP_HOME='D:\Rust\.rustup'; $env:CARGO_HOME='D:\Rust\.cargo'; $env:Path='D:\Rust\.cargo\bin;' + $env:Path; cargo build --release --manifest-path launcher-tauri\src-tauri\Cargo.toml
Copy-Item launcher-tauri\src-tauri\target\release\leon-launcher-tauri.exe LEON-Launcher-Tauri.exe -Force
$env:LEON_LAUNCHER_SMOKE_TEST='1'; Start-Process -FilePath D:\apiWorkSpace\leon_api\LEON-Launcher-Tauri.exe -WorkingDirectory D:\apiWorkSpace\leon_api -Wait -PassThru
git diff --check
```

2. Then update docs with final release/smoke result:
   - `dev_workspace/docs/TAURI_BUILD_LOG.md`
   - `dev_workspace/docs/AGENT_STATE.md`
   - `dev_workspace/docs/REGRESSION.md`
   - `launcher-tauri/README.md`
   - `launcher-tauri/src-tauri/README.md`

3. Still avoid:
   - starting/restarting LEON API unless user explicitly approves;
   - long TTS generation;
   - touching Tavo frontend without the `tavo` skill;
   - restoring or deleting `config/profiles/leon-default-copy.json`.
