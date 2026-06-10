# LEON Launcher Tauri

Independent Tauri 2 launcher prototype for LEON. It does not replace the tracked WinForms launcher yet.

## Current Status

- Frontend: Vanilla HTML/CSS/JS with Vite.
- Backend: Tauri 2 Rust commands in `src-tauri/src/main.rs`.
- Root test artifact: `D:\apiWorkSpace\leon_api\LEON-Launcher-Tauri.exe`.
- Existing WinForms launcher remains `D:\apiWorkSpace\leon_api\LEON-Launcher.exe`.

Implemented:

- Profile list from `config/profiles/*.json`, excluding `active.json`.
- Profile apply writes `config/profiles/active.json` with `appliedAt` and `appliedFrom`.
- Profile copy/delete, schema v3 preflight, and a basic editor for source profiles.
- Service start through `scripts/start-vllm-api.bat` or `scripts/start-fast6g-api.bat`.
- Service stop through `GET http://127.0.0.1:9880/control?command=exit`.
- Health polling through `GET http://127.0.0.1:9880/health`.
- Basic environment display and `logs/<version>/` latest-tail polling.
- Warmup button that calls `POST /warmup` only when the API is already running.
- `LEON_LAUNCHER_SMOKE_TEST=1` no-window smoke path.

Not done:

- Real GUI manual smoke.
- Full WinForms parity.
- Profile creation wizard, drag ordering, keyboard shortcuts, and log file watcher.
- Real `/warmup` validation in this migration pass.

## Commands

Run from `D:\apiWorkSpace\leon_api`:

```powershell
node --check launcher-tauri\src\scripts\app.js
node --check launcher-tauri\src\scripts\mock-api.js
npm --prefix launcher-tauri run frontend:build

$env:RUSTUP_HOME='D:\Rust\.rustup'
$env:CARGO_HOME='D:\Rust\.cargo'
$env:Path='D:\Rust\.cargo\bin;' + $env:Path
cargo fmt --manifest-path launcher-tauri\src-tauri\Cargo.toml --check
cargo check --manifest-path launcher-tauri\src-tauri\Cargo.toml
cargo build --release --manifest-path launcher-tauri\src-tauri\Cargo.toml

Copy-Item launcher-tauri\src-tauri\target\release\leon-launcher-tauri.exe LEON-Launcher-Tauri.exe -Force
$env:LEON_LAUNCHER_SMOKE_TEST='1'
Start-Process -FilePath D:\apiWorkSpace\leon_api\LEON-Launcher-Tauri.exe -WorkingDirectory D:\apiWorkSpace\leon_api -Wait -PassThru
```

For a full installer build:

```powershell
npm --prefix launcher-tauri run build
```

## Notes

- `dist/`, `node_modules/`, and `src-tauri/target/` are generated and ignored.
- `package-lock.json` and `src-tauri/Cargo.lock` are kept for reproducible launcher builds.
- Active migration notes live in `dev_workspace/docs/TAURI_MIGRATION_PLAN.md` and `dev_workspace/docs/TAURI_BUILD_LOG.md`.
