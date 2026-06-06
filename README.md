# leon_api

This is the root workspace for the LEON IndexTTS2 Tavo integration.

## Layout

- `vllm/`: vLLM quality version.
- `fast6g/`: double-accelerated 6 GB friendly version.
- `static/`: shared Tavo injected frontend (`tavo.js`, runtime parts, test page).
- `launcher/`: shared Windows launcher source and assets.
- `scripts/`: shared start scripts used by the launcher.
- `dev_workspace/`: Codex handoff docs, smoke tests, screenshots, and historical notes.
- `packages/`: local archives/backups only; not committed.

## Entry Points

- User launcher: `LEON-Launcher.exe` from this root folder.
- Launcher script source: `launcher/LEON-Launcher.ps1`.
- vLLM API script: `scripts/start-vllm-api.bat`.
- fast6g API script: `scripts/start-fast6g-api.bat`.

The launcher selects one backend version at startup. `static/`, `launcher/`, and `scripts/` are shared by both versions.

## Tavo Script

The app does not require a public domain. For same-LAN phone testing, use:

```html
<script src="http://<LAN-IP>:9880/static/tavo.js?v=20260606-live-audio-v6"></script>
```

For a public tunnel, configure the tunnel/reverse proxy outside this repository and replace only the script host.
The only runtime code that should depend on the script host is `static/tavo.js`, which uses its own loaded script origin as the API origin.

## Development Notes

- Active collaboration state lives in `dev_workspace/docs/`.
- Tavo frontend changes must follow the local `tavo` Codex skill.
- Do not commit model weights, runtime folders, generated audio cache, logs, package archives, or local Git backups.
- Startup options are selected in the launcher: backend version (`vllm` / `fast6g`), Qwen emotion, and vLLM GPU memory ratio (`0.18` default or `0.11` conservative).
