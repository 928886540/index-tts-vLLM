# LEON Tauri Rust Backend

The current Rust backend is intentionally small and lives in `src/main.rs`.

## Commands Exposed To The Frontend

- `get_profiles`
- `get_profile`
- `save_profile`
- `apply_profile`
- `copy_profile`
- `delete_profile`
- `validate_profile`
- `start_service`
- `stop_service`
- `warmup_service`
- `health_check`
- `get_service_status`
- `get_environment`
- `get_log_snapshot`

## Runtime Contract

- The LEON root is discovered from `LEON_ROOT`, current directory ancestors, executable ancestors, or build manifest ancestors. A valid root contains `config/profiles` and `scripts`.
- Source profiles are `config/profiles/*.json`; `active.json` is the runtime snapshot and is excluded from the source profile list.
- Saving a profile writes only the selected source profile and removes runtime-only `appliedAt` / `appliedFrom`.
- Applying a profile writes `config/profiles/active.json` and records `appliedFrom`.
- Service start uses `scripts/start-vllm-api.bat` or `scripts/start-fast6g-api.bat`.
- Service stop requests `GET http://127.0.0.1:9880/control?command=exit`.
- Warmup calls `POST http://127.0.0.1:9880/warmup` only after `/health` is reachable.

## Validation

From `D:\apiWorkSpace\leon_api`:

```powershell
$env:RUSTUP_HOME='D:\Rust\.rustup'
$env:CARGO_HOME='D:\Rust\.cargo'
$env:Path='D:\Rust\.cargo\bin;' + $env:Path

cargo fmt --manifest-path launcher-tauri\src-tauri\Cargo.toml --check
cargo check --manifest-path launcher-tauri\src-tauri\Cargo.toml
cargo build --release --manifest-path launcher-tauri\src-tauri\Cargo.toml
```

No-window smoke:

```powershell
$env:LEON_LAUNCHER_SMOKE_TEST='1'
Start-Process -FilePath D:\apiWorkSpace\leon_api\LEON-Launcher-Tauri.exe -WorkingDirectory D:\apiWorkSpace\leon_api -Wait -PassThru
```
