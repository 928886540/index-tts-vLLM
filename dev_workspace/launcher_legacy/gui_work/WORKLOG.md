# Worklog

## 2026-06-05 Launcher GPU Residue / Double-Start / Log Jitter

User report:

- Closing the LEON launcher left GPU memory almost full.
- User explicitly required no double-starting.
- Later screenshot showed the launcher home UI looked rough and the backend log view jittered because progress output kept repainting.

Confirmed runtime evidence before fix:

- GPU was near full with two project runtime Python processes.
- Main API process listened on port `9880` with command `indextts2_api.py -a 0.0.0.0 -p 9880 --cuda_kernel --fp16 --no_qwen_emo`.
- Child process was a Python `multiprocessing-fork` worker.
- Stopping the project API process tree released GPU memory.

Code changes:

- `../LEON启动器.ps1`
  - Adds a launcher named mutex for real runs; smoke mode skips the mutex to avoid popping a "launcher already open" dialog during automated checks.
  - Tracks API startup state and ignores repeated start clicks while startup is active.
  - Refuses to start if port `9880` is owned by a non-project process.
  - Starts the API BAT hidden and sets `LEON_LAUNCHER_NO_PAUSE=1`.
  - Stops the project API process tree on launcher close only if this launcher initiated startup.
  - Filters ANSI/control characters and tqdm/progress redraw lines from the visible home log.
  - Skips log repaint when visible text is unchanged.
  - Uses a dark read-only `RichTextBox` for logs.
  - Moves the banner to the right side and owner-draws tabs to reduce the default WinForms look.
- `../../../tools/restart_indextts_api.ps1`
  - Adds `Local\LEON.IndexTTS2.ApiRestart.<port>` mutex so concurrent low-level starts wait for `/health` instead of launching a second backend.
- `../../../go-API-VLLM-NoQwen.bat`
  - Skips `pause` when `LEON_LAUNCHER_NO_PAUSE` is set. This file is ignored by git via `*.bat`, so remember it is a local packaging file.

Validation done:

- PowerShell parser OK for `LEON启动器.ps1`.
- `LEON_LAUNCHER_SMOKE_TEST=1` launcher smoke OK without opening the real launcher or starting API.
- PowerShell parser OK for `tools/restart_indextts_api.ps1`.
- `git diff --check` clean except normal LF-to-CRLF warnings.

Remaining manual validation:

- Open the real `LEON启动器.exe` once and confirm the home page no longer has white native tab blocks or text rectangles over the banner.
- Start service from the launcher, confirm duplicate clicks do not create a second backend startup.
- Close that same launcher and confirm `nvidia-smi` no longer shows `indextts2runtime\python.exe` compute processes.
- Confirm the visible home log hides tqdm rows like `100%|...| 16/16 [...]` and does not jitter while backend log tail refreshes.

## 2026-06-05 Launcher UI Follow-up

Scope:

- Keep temporary GUI work inside this folder.
- Do not write new GUI handoff notes into `Leon_api/docs/`.
- Do not open the real launcher window during validation.
- Do not start the API while validating UI.
- Do not generate or store temporary image assets on `C:\`.

Code changes:

- `../LEON启动器.ps1`
  - Centralized the launcher header background drawing through `Draw-LauncherHeaderBackdrop`.
  - Real WinForms painting and off-screen screenshot painting now use the same header renderer.
  - If the existing banner is too vertical for the top header, the launcher skips it and draws a restrained local waveform/GPU-grid placeholder instead of stretching the old image.
  - Fixed the home log page dock order so the `刷新日志` / `手动预热` toolbar is visible and the log box starts below it.
  - Main start button now treats a running project API as a restart request: stop the old project API process tree first, wait for port `9880` to release, then start a new service.
  - If port `9880` is held by a non-project service, startup still refuses instead of killing unknown processes.
  - API process-tree shutdown now tries `taskkill /T /F` first so Windows child processes are not left on GPU when CIM child-process lookup is unavailable.
  - When command-line process inspection is unavailable, the launcher can identify the local LEON API by checking `/health` plus project-specific endpoints before treating the listener as restartable.

Validation:

- PowerShell parser OK.
- `LEON_LAUNCHER_SMOKE_TEST=1` OK; no real launcher window and no API start.
- `LEON_LAUNCHER_SCREENSHOT=...\gui_work\leon_launcher_ui_after_17.png` OK.
- Latest visual evidence: `leon_launcher_ui_after_17.png`.
- `gpt-image-2` CLI command dry-run OK with `--no-augment`; no real image API call was made.
- Fresh GPU snapshot still showed an already-running project API on port `9880` with GPU compute Python PIDs, but this validation run did not start or kill it.

Image generation state:

- User requested a new horizontal banner generated with `gpt-image-2`.
- Current `OPENAI_API_KEY` environment variable is missing, so no real image API call was made.
- Prompt and command are recorded in `banner_prompt_gpt_image_2.md`; the prompt-only source is `banner_prompt_gpt_image_2.txt`.
- Existing `../leon-launcher-banner-avatar-ai.png` is `1672x941` (about `1.78:1`), so it is not used as a shallow top header until replaced by a proper wide image.
