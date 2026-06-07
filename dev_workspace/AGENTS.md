# AGENTS.md

Codex handoff rules for `D:\apiWorkSpace\leon_api\dev_workspace`.

## Required Reading

If the user only asks to read or summarize `README.md`, treat it as a lightweight context request: read `README.md` and answer what the project is for. Do not load the full docs set unless the user also asks to edit, debug, validate, commit, or plan repository work.

Before doing repository work here, read these files in order:

1. `..\AGENTS.md`
2. `README.md`
3. `docs/AGENT_STATE.md`
4. `docs/BUGS.md`

Read the other active docs only when relevant:

- `docs/ARCHITECTURE.md`: component boundaries, APIs, cache/job model, launcher layout, or shared file placement.
- `docs/DECISIONS.md`: accepted/deprecated project decisions.
- `docs/TODO.md`: planning or reprioritization.
- `docs/REGRESSION.md`: before handing off code changes that need validation.
- `docs/archive/*`: older fixed bugs, old snapshots, benchmark history, or historical handoff only.

Also read the machine-level rules:

- `C:\Users\Administrator\.codex\AGENTS.md`
- `C:\Users\Administrator\.codex\instruction.md`

If any parent or child workspace later adds another `AGENTS.md`, read the nearest applicable file before editing files under that directory.

## Tavo Rule

For any change touching Tavo frontend, injected JavaScript, Advanced Rendering, regex loading, `tavo.get` / `tavo.set`, chat/message APIs, role/persona behavior, `static/tavo.js`, or Tavo persistence, load and follow the local `tavo` skill first:

`C:\Users\Administrator\.codex\skills\tavo\SKILL.md`

Do not treat the injected Tavo surface as a normal web app until the AR lifecycle and storage behavior are accounted for.

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

## Engineering Rules

- This is a local IndexTTS2 + Tavo integration workspace, not a hosted SaaS service.
- `dev_workspace/` is documentation, smoke tests, screenshots, and historical handoff material.
- Production runtime code lives in `vllm/`, `fast6g/`, shared `static/`, shared `launcher/`, and shared `scripts/`.
- Do not move shared files back under `vllm/`.
- Do not create new Chinese-named paths.
- Do not delete or reorganize `prompts/`, `prompts/library/`, or reference audio assets unless the user explicitly asks.
- Do not run long TTS generation, batch audio tests, or restart the API while the user may be actively using it unless they asked for it or approved it.
- Prefer root-cause analysis over broad fallback behavior. If adding a workaround, label it as a workaround.
- Do not hide configuration errors. Missing voice mappings, unavailable model services, invalid parameters, or failed cache reads should surface clear errors and logs.

## Verification Baseline

Common lightweight checks from `D:\apiWorkSpace\leon_api`:

```powershell
node --check static\tavo.js
node --check static\tavo.runtime.js
node --check dev_workspace\dev_tools\test_tavo_widget_playwright.js
python -m py_compile vllm\indextts2_api.py fast6g\indextts2_api.py fast6g\indextts\infer_v2.py
```

Use the real Tavo app / emulator for final validation. Mock pages only prove syntax and basic smoke behavior.
