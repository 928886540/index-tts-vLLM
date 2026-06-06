# AGENTS.md

Codex handoff rules for `D:\apiWorkSpace\leon_api\dev_workspace`.

## Required Reading

Before doing repository work here, read these files in order:

1. `..\AGENTS.md`
2. `README.md`
3. `docs/AGENT_STATE.md`
4. `docs/ARCHITECTURE.md`
5. `docs/DECISIONS.md`
6. `docs/BUGS.md`
7. `docs/TODO.md`
8. `docs/REGRESSION.md`

Also read the machine-level rules:

- `C:\Users\Administrator\.codex\AGENTS.md`
- `C:\Users\Administrator\.codex\instruction.md`

If any parent or child workspace later adds another `AGENTS.md`, read the nearest applicable file before editing files under that directory.

## Tavo Rule

For any change touching Tavo frontend, injected JavaScript, Advanced Rendering, regex loading, `tavo.get` / `tavo.set`, chat/message APIs, role/persona behavior, `static/tavo.js`, or Tavo persistence, load and follow the local `tavo` skill first:

`C:\Users\Administrator\.codex\skills\tavo\SKILL.md`

Do not treat the injected Tavo surface as a normal web app until the AR lifecycle and storage behavior are accounted for.

## Documentation Workflow

`dev_workspace/docs/` is the active handoff workspace. `dev_workspace/handoff_docs/` remains historical context and should only be read when the active docs are not enough or when tracing older decisions.

When the user reports a new bug:

1. Add or update an entry in `docs/BUGS.md` before changing code.
2. Separate confirmed evidence from hypotheses.
3. Check existing bug entries to avoid duplicate fixes.
4. After fixing, record root cause, fix, and guard.
5. Add or tighten regression steps in `docs/REGRESSION.md`.

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
