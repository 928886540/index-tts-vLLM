# AGENTS.md

Codex rules for `D:\apiWorkSpace\leon_api`.

## Required Reading

Before repository work here, read:

1. `C:\Users\Administrator\.codex\AGENTS.md`
2. `C:\Users\Administrator\.codex\instruction.md`
3. this `AGENTS.md`
4. `README.md`
5. `dev_workspace\AGENTS.md`
6. `dev_workspace\docs\AGENT_STATE.md`
7. `dev_workspace\docs\ARCHITECTURE.md`
8. `dev_workspace\docs\DECISIONS.md`
9. `dev_workspace\docs\BUGS.md`
10. `dev_workspace\docs\TODO.md`
11. `dev_workspace\docs\REGRESSION.md`

If a child directory later adds another `AGENTS.md`, read the nearest applicable file before editing files under that directory.

## Project Boundaries

- `vllm/` is the vLLM API backend version directory.
- `fast6g/` is the double-accelerated 6 GB friendly API backend version directory.
- `static/` is shared Tavo frontend code.
- `launcher/` and `scripts/` are shared startup tooling.
- `dev_workspace/` is collaboration state, docs, local smoke tests, screenshots, and historical notes.

Do not move shared files back under `vllm/`. Do not create new Chinese-named paths.

## Terminology Boundary

Use these names consistently:

- Backend / API backend / `后端`: the HTTP API layer, mainly `vllm/indextts2_api.py`, `fast6g/indextts2_api.py`, and API helpers such as `indextts/llm_proxy.py`.
- Frontend / `前端`: the Tavo injected player/UI/scripts, mainly `static/tavo.js`, `static/tavo.runtime.js`, `static/tavo.runtime.parts/*`, and Tavo storage/UI behavior.
- TTS service / `TTS服务`: the IndexTTS / IndexTTS2 inference/model pipeline and synthesis engine. Do not call this "backend" when discussing project bugs or architecture.
- Launcher / `启动器`: `LEON-Launcher.exe`, `launcher/`, and `scripts/` startup tooling.

When analyzing bugs, state which boundary is involved. For example: "frontend submits role mapping", "API backend exposes job status", and "TTS service synthesizes audio".

## Tavo Rule

For any change touching Tavo frontend, injected JavaScript, Advanced Rendering, regex loading, `tavo.get` / `tavo.set`, chat/message APIs, role/persona behavior, `static/tavo.js`, or Tavo persistence, load and follow:

`C:\Users\Administrator\.codex\skills\tavo\SKILL.md`

## Startup Rule

Use the root launcher for service startup/restart workflows:

```text
D:\apiWorkSpace\leon_api\LEON-Launcher.exe
```

The launcher must not auto-start the backend on open. The user selects `vllm` or `fast6g` and manually starts the service.

## Git Scope

Commit source, scripts, docs, tests, and small shared assets. Do not commit runtime environments, model weights, generated audio, cache outputs, logs, package archives, local Git backups, IDE caches, or `__pycache__`.
