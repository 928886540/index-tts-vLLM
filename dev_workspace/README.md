# dev_workspace

`dev_workspace/` is the Codex collaboration and handoff area for `D:\apiWorkSpace\leon_api`.

It is not a backend version. Runtime code belongs in:

- `..\vllm\`: vLLM quality version.
- `..\fast6g\`: double-accelerated 6 GB friendly version.
- `..\static\`: shared Tavo frontend.
- `..\launcher\` and `..\scripts\`: shared startup tooling.

## Current Active Docs

- `AGENTS.md`: rules for this collaboration area.
- `docs/AGENT_STATE.md`: current progress, runtime notes, and handoff context.
- `docs/ARCHITECTURE.md`: current layout and runtime boundaries.
- `docs/DECISIONS.md`: accepted product and engineering decisions.
- `docs/BUGS.md`: concise bug ledger; diagnose and fix code first, then update this file only when it helps handoff/regression tracking.
- `docs/TODO.md`: prioritized next work.
- `docs/REGRESSION.md`: validation checklist.

Historical handoffs are under `handoff_docs/` and old experiments are under `launcher_legacy/`, `optimization_plan/`, `code_snapshot/`, and `screenshots/`.

## Startup

Use the root launcher:

```text
D:\apiWorkSpace\leon_api\LEON-Launcher.exe
```

The launcher selects `vllm` or `fast6g`, then starts the selected backend through shared scripts.

## Tavo Script

The app does not require a public domain. Same-LAN testing can use:

```html
<script src="http://<LAN-IP>:9880/static/tavo.js?v=20260607-ai-live-v21"></script>
```

For public tunnel usage, configure the tunnel/reverse proxy outside this repository and replace only the script host. The program should not detect, store, or require a public domain.

## Fixed Tavo Test Path

From `D:\apiWorkSpace\leon_api`:

```powershell
node --check static\tavo.js
node --check static\tavo.runtime.js
node --check dev_workspace\dev_tools\test_tavo_widget_playwright.js
node dev_workspace\dev_tools\test_tavo_widget_playwright.js
```

The Playwright runner stays in `%TEMP%\idx-playwright-runner`; do not install `node_modules` in this repository.
