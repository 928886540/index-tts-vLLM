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

## Terminology

- `后端` / backend: the API backend layer (`vllm/indextts2_api.py`, `fast6g/indextts2_api.py`, HTTP routes, job/cache/status).
- `前端` / frontend: Tavo injected scripts and UI (`static/tavo.js`, runtime parts, Tavo storage/playback behavior).
- `TTS服务`: the IndexTTS / IndexTTS2 inference and synthesis pipeline. This is not called "backend" in this project.
- `启动器`: `LEON-Launcher.exe`, `launcher/`, and startup scripts.

## Tavo Script

The app does not require a public domain. For same-LAN phone testing, use:

```html
<script src="http://<LAN-IP>:9880/static/tavo.js?v=20260607-ai-live-v23"></script>
```

For a public tunnel, configure the tunnel/reverse proxy outside this repository and replace only the script host.
The only runtime code that should depend on the script host is `static/tavo.js`, which uses its own loaded script origin as the API origin.

## Communication Style

- Default to Simplified Chinese, direct and practical. Call the user `bro` when it fits the flow. 🙂
- Keep handoffs human: say what changed, what evidence was checked, what still needs validation, and the next useful move.
- Emojis are welcome when they make the note easier to scan, but keep commands, logs, API paths, and errors precise.
- Do not bury the result under templates. If something is risky, slow, or only partially verified, say it plainly. 👍

## Development Notes

- Active collaboration state lives in `dev_workspace/docs/`.
- A request to "read README" is only a lightweight project overview request. Read/summarize this file; load `AGENTS.md` and active docs only when code changes, debugging, validation, commits, or planning are needed.
- Tavo frontend changes must follow the local `tavo` Codex skill.
- A user-reported bug is an action item, not just a ledger entry. Diagnose and fix the relevant code path first; update `dev_workspace/docs/BUGS.md` only as a concise tracking/fix note when it helps handoff.
- Do not stop after only writing a bug entry. Do not paste raw user reports into docs; summarize boundary, evidence, fix, and regression guard.
- Do not commit model weights, runtime folders, generated audio cache, logs, package archives, or local Git backups.
- Startup options are selected in the launcher: backend version (`vllm` / `fast6g`) and vLLM GPU memory ratio (`0.15` default or `0.11` conservative). Qwen emotion is deprecated for the launcher path; AI mode should use LLM-selected style/emotion parameters instead.
