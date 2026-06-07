# LEON Codex Workspace

This is the active working README for Codex sessions in `D:\apiWorkSpace\leon_api`.

Use this file for repository work, debugging, planning, validation, and handoff. The root `README.md` is now the project introduction only.

## Project Summary

LEON is a local IndexTTS2 + Tavo integration. It provides:

- a Tavo injected voice player in `static/`;
- an API backend in `vllm/` or `fast6g/`;
- a Windows launcher in `LEON-Launcher.exe`, `launcher/`, and `scripts/`;
- active collaboration state in `dev_workspace/docs/`.

## Boundaries

- `后端` / backend: the HTTP API layer, mainly `vllm/indextts2_api.py`, `fast6g/indextts2_api.py`, routes, job/cache/status, and API helpers.
- `前端` / frontend: Tavo injected UI/scripts, mainly `static/tavo.js`, `static/tavo.runtime.js`, runtime parts, Tavo storage, and playback behavior.
- `TTS服务`: the IndexTTS / IndexTTS2 inference and synthesis pipeline.
- `启动器`: `LEON-Launcher.exe`, `launcher/`, and startup scripts.

Keep those terms separate when diagnosing bugs.

## Layout

- `..\vllm\`: vLLM quality backend.
- `..\fast6g\`: double-accelerated 6 GB friendly backend.
- `..\static\`: shared Tavo frontend.
- `..\launcher\`: launcher source and assets.
- `..\scripts\`: shared startup scripts.
- `docs\`: active state, bugs, decisions, TODOs, and regression checklist.
- `dev_tools\`: local smoke and Playwright test utilities.
- `handoff_docs\`, `launcher_legacy\`, `optimization_plan\`, `code_snapshot\`, `screenshots\`: historical or support material.

## Active Docs

Read these for normal repo work:

- `AGENTS.md`: rules for this collaboration area.
- `docs/AGENT_STATE.md`: current state and latest validation.
- `docs/BUGS.md`: active/recent bug ledger.
- `docs/REGRESSION.md`: validation checklist before handoff.

Read only when relevant:

- `docs/ARCHITECTURE.md`: component boundaries, APIs, cache/job model, launcher layout, shared file placement.
- `docs/DECISIONS.md`: accepted/deprecated project decisions.
- `docs/TODO.md`: planning and reprioritization.
- `docs/archive/*`: old fixed bugs, snapshots, benchmarks, and historical handoff only.

## Startup

Use the root launcher:

```text
D:\apiWorkSpace\leon_api\LEON-Launcher.exe
```

The launcher selects `vllm` or `fast6g`, then starts the selected backend through shared scripts. It must not auto-start the backend on open.

## Tavo Script

The app does not require a public domain. Same-LAN testing can use:

```html
<script src="http://<LAN-IP>:9880/static/tavo.js?v=20260607-tavo-file-v31"></script>
```

For public tunnel usage, configure the tunnel/reverse proxy outside this repository and replace only the script host. The program should not detect, store, or require a public domain.

## Common Checks

From `D:\apiWorkSpace\leon_api`:

```powershell
node --check static\tavo.js
node --check static\tavo.runtime.js
node --check dev_workspace\dev_tools\test_tavo_widget_playwright.js
node dev_workspace\dev_tools\test_tavo_widget_playwright.js
git diff --check
```

For API backend syntax changes:

```powershell
python -m py_compile vllm\indextts2_api.py fast6g\indextts2_api.py fast6g\indextts\infer_v2.py
```

The Playwright runner stays in `%TEMP%\idx-playwright-runner`; do not install `node_modules` in this repository.

## Working Rules

- Check `git status --short` before editing.
- Preserve unrelated dirty work. At the time this README was reorganized, launcher-related files may be dirty from another Codex session.
- Tavo frontend changes must follow the local `tavo` skill.
- User-reported bugs are implementation/debugging tasks first; do not only add ledger entries.
- Do not commit model weights, runtime folders, generated audio cache, logs, package archives, local Git backups, IDE caches, or `__pycache__`.
- Do not create new Chinese-named paths.
