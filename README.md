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

Current cache-busted script URL:

```html
<script src="https://index-tts.928886540.xyz/static/tavo.js?v=20260606-live-audio-v6"></script>
```

Local LAN variant:

```html
<script src="http://192.168.8.100:9880/static/tavo.js?v=20260606-live-audio-v6"></script>
```

## Development Notes

- Active collaboration state lives in `dev_workspace/docs/`.
- Tavo frontend changes must follow the local `tavo` Codex skill.
- Do not commit model weights, runtime folders, generated audio cache, logs, package archives, or local Git backups.
