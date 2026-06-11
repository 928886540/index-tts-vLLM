# AGENTS.md

Codex rules for `D:\apiWorkSpace\leon_api\dev_workspace`.

This is the nearest project AGENTS file for normal Codex work. The root `AGENTS.md` was moved here so a new Codex can start directly in `dev_workspace`.

## Required Reading

If the user only asks to read or summarize `README.md`, treat it as a lightweight context request: read this directory's `README.md` and answer what the project is for. Do not load the full docs set unless the user also asks to edit, debug, validate, commit, or plan repository work.

Before doing repository work here, read the short active context:

1. `C:\Users\Administrator\.codex\AGENTS.md`
2. `C:\Users\Administrator\.codex\instruction.md`
3. this `AGENTS.md`
4. `README.md`
5. `docs/LOGIC.md`
6. `docs/AGENT_STATE.md`
7. `docs/BUGS.md`

Read the other active docs only when relevant:

- `docs/ARCHITECTURE.md`: component boundaries, APIs, cache/job model, launcher layout, or shared file placement.
- `docs/LOGIC.md`: source of truth for Tavo generation/playback/storage state, LIVE page exit, saved/offline playback, and LLM reuse.
- `docs/DECISIONS.md`: accepted/deprecated project decisions.
- `docs/TODO.md`: planning or reprioritization.
- `docs/REGRESSION.md`: before handing off code changes that need validation.
- `docs/archive/*`: older fixed bugs, old snapshots, benchmark history, or historical handoff only.

If a child directory later adds another `AGENTS.md`, read the nearest applicable file before editing files under that directory.

## User Preferences

These preferences are merged from `C:\Users\Administrator\AGENTS.md` and apply to this workspace and its subdirectories:

- Default language: Chinese / 简体中文.
- Address the user naturally as `bro`, `哥们`, or `兄弟` when it fits the tone.
- Tone: direct, concise, practical, and a little more lively than the default CLI style.
- Use light emoji naturally when it improves readability, but keep output readable in a terminal. Do not use kaomoji or childish emoticons. Do not overuse emoji.
- Avoid sounding dry, overly formal, or template-driven.

## Project Boundaries

- `..\vllm\` is the vLLM API backend version directory.
- `..\fast6g\` is the double-accelerated 6 GB friendly API backend version directory.
- `..\static\` is shared Tavo frontend code.
- `..\launcher-tauri\` and `..\scripts\` are shared startup tooling.
- `dev_workspace\` is collaboration state, docs, local smoke tests, screenshots, and historical notes.

Do not move shared files back under `vllm/`. Do not create new Chinese-named paths.

## Terminology Boundary

Use these names consistently:

- Backend / API backend / `后端`: the HTTP API layer, mainly `vllm/indextts2_api.py`, `fast6g/indextts2_api.py`, and API helpers such as `indextts/llm_proxy.py`.
- Frontend / `前端`: the Tavo injected player/UI/scripts, mainly `static/tavo.js`, `static/tavo.runtime.js`, `static/tavo.runtime.parts/*`, and Tavo storage/UI behavior.
- TTS service / `TTS服务`: the IndexTTS / IndexTTS2 inference/model pipeline and synthesis engine. Do not call this "backend" when discussing project bugs or architecture.
- Launcher / `启动器`: `LEON-Launcher-Tauri.exe`, `launcher-tauri/`, and `scripts/` startup tooling.

When analyzing bugs, state which boundary is involved. For example: "frontend submits role mapping", "API backend exposes job status", and "TTS service synthesizes audio".

## Tavo Rule

For any change touching Tavo frontend, injected JavaScript, Advanced Rendering, regex loading, `tavo.get` / `tavo.set`, chat/message APIs, role/persona behavior, `static/tavo.js`, or Tavo persistence, load and follow the local `tavo` skill first:

```text
C:\Users\Administrator\.codex\skills\tavo\SKILL.md
```

Do not treat the injected Tavo surface as a normal web app until the AR lifecycle and storage behavior are accounted for.

## Startup Rule

Use the root launcher for service startup/restart workflows:

```text
D:\apiWorkSpace\leon_api\LEON-Launcher-Tauri.exe
```

The launcher must not auto-start the backend on open. The user selects `vllm` or `fast6g` and manually starts the service.

## Documentation Workflow

`dev_workspace/docs/` is the active handoff workspace. Active docs should stay concise. `dev_workspace/docs/archive/` and `dev_workspace/handoff_docs/` are historical context and should only be read when the active docs are not enough or when tracing older decisions.

When the user reports a new bug:

1. Treat it as an implementation/debugging task first, not as a documentation task.
2. Check existing bug entries only to avoid duplicate or stale fixes.
3. Diagnose and change the relevant code path before spending time on documentation.
4. Update `docs/BUGS.md` only when a concise active ledger entry or post-fix handoff note is useful.
5. After fixing, record root cause, fix, and guard without pasting raw user reports.
6. Add or tighten regression steps in `docs/REGRESSION.md` when the behavior needs future protection.

For long tasks, update `docs/AGENT_STATE.md` after each stable milestone. If context is low or the user asks to record context, stop feature work and update `docs/AGENT_STATE.md`, `docs/TODO.md`, `docs/BUGS.md`, and `docs/REGRESSION.md` as needed.

## Debugging and Coding Style

- Prioritize root-cause analysis over defensive coding.
- Before changing code, state the main cause hypothesis and the evidence.
- If the root cause is still uncertain, say so directly instead of presenting guesses as facts.
- Do not add fallback logic, retry logic, broad exception swallowing, or compatibility branches unless the user explicitly asks for a workaround.
- Prefer minimal, targeted fixes that make the real failure easier to observe.
- If a change is only a workaround, label it clearly as a workaround rather than a real fix.
- Keep changes small and easy to diff.
- Expose failures clearly when useful; do not hide bugs behind silent handling.
- When multiple fixes are possible, prefer the one that helps future debugging.
- User-facing profile/tuning configuration must not silently fall back to hidden code defaults. Missing profile fields, unknown style IDs, unavailable voice/style refs, invalid parameters, or failed active-profile reads must raise a clear configuration error in the API/launcher/Tavo surface. Default values are allowed only when creating or migrating an explicit profile file the user can inspect.

## Engineering Rules

- This is a local IndexTTS2 + Tavo integration workspace, not a hosted SaaS service.
- `dev_workspace/` is documentation, smoke tests, screenshots, and historical handoff material.
- Production runtime code lives in `vllm/`, `fast6g/`, shared `static/`, shared `launcher-tauri/`, and shared `scripts/`.
- Do not move shared files back under `vllm/`.
- Do not create new Chinese-named paths.
- Do not delete or reorganize `prompts/`, `prompts/library/`, or reference audio assets unless the user explicitly asks.
- Do not run long TTS generation, batch audio tests, or restart the API while the user may be actively using it unless they asked for it or approved it.
- Prefer root-cause analysis over broad fallback behavior. If adding a workaround, label it as a workaround.
- Do not hide configuration errors. Missing voice mappings, unavailable model services, invalid parameters, or failed cache reads should surface clear errors and logs.

## Git Scope

Commit source, scripts, docs, tests, and small shared assets. Do not commit runtime environments, model weights, generated audio, cache outputs, logs, package archives, local Git backups, IDE caches, or `__pycache__`.

## Verification Baseline

Common lightweight checks from `D:\apiWorkSpace\leon_api`:

```powershell
node --check static\tavo.js
node --check static\tavo.runtime.js
node --check dev_workspace\dev_tools\test_tavo_widget_playwright.js
python -m py_compile vllm\indextts2_api.py fast6g\indextts2_api.py fast6g\indextts\infer_v2.py
```

Use the real Tavo app / emulator for final validation. Mock pages only prove syntax and basic smoke behavior.
