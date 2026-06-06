# Agent State

Updated: 2026-06-05

## Current Goal

Keep IndexTTS2 as the Tavo mainline and harden the injected player without copying GPT-SoVITS engine behavior into this project.

This repository is now the likely mainline again because GPT-SoVITS proved unreliable for long Tavo dialogue: it can output long silence, miss text, or fail segments even when the HTTP request succeeds. IndexTTS2 has higher resource cost, but it is the better candidate for stable Tavo long dialogue.

## Current Project Shape

Repository root:

- `indextts2_api.py`: FastAPI service entry, default port `9880`.
- `static/tavo.js`: Tavo injected player script.
- `indextts/`: inference, vLLM integration, voice library, snapshot cache, profile store, LLM proxy.
- `prompts/library/`: local voice/reference library.
- `outputs/cache/`: runtime cache for generated audio and metadata.
- `Leon_api/`: collaboration area, tests, screenshots, handoff docs, and this active docs workspace.

The older `Leon_api/handoff_docs/` files are still useful context, but ongoing work should update `Leon_api/docs/` first.

## Latest Investigation Snapshot: RTF and Home Player UI

Updated: 2026-06-05

RTF evidence from the latest real cache files:

- `54e4954a5312c5f90d62c329ee198424be3aec4b`: 14 segments, audio `109.319s`, `rtf=5.418`, `wall_rtf=5.47`, `lock_wait_s=0`, `total_wall_s=597.947`, `s2mel_s=504.206`, `gpt_gen_s=76.226`, `bigvgan_s=8.191`, `first_pcm_s=34.266`.
- `c69e43eb5bcd4544cfe22631822ddb1eaf91b17d`: 15 segments, audio `120.573s`, `rtf=6.051`, `wall_rtf=7.548`, `lock_wait_s=180.455`, `s2mel_s=634.267`.
- `nvidia-smi` at 14:17 showed RTX 3060 memory `11876MiB / 12288MiB` with API PID `21012` and multiprocessing child PID `31712`; `8188` was empty.
- Later read-only checks at 16:23 showed GPU memory down to about `1072MiB / 12288MiB`, no compute Python process, and no listener on `9880` or `8188`.

Conclusion: the previous live-card status bug caused a visible "fake stuck" path, but the newest cache metrics also show real backend slowness. For the latest no-wait sample, S2Mel/diffusion dominates the wall time. The slow-run evidence comes from completed cache metadata and the earlier near-full-VRAM snapshot, not from the current idle/offline machine state.

Home player UI changes now in code:

- Removed visible 10-second rewind/forward buttons from the player home controls.
- Kept avatar, role name/status, `L`/`D` playback mode, and settings on one header row.
- Playback mode is a direct single-letter toggle: `L` means LIVE, `D` means落盘/后台生成.
- Moved delete into the subtitle panel near the old page-counter position.
- Moved the page counter into the subtitle panel top-right with `pointer-events:none`.
- Made the music/add button the same size as the main play button.
- Kept the role hint/status under the title as a single-line ellipsis after freeing header space.
- Widened the settings button slightly.
- Made the live exit button circular and play-sized.
- Fixed the LIVE play-click path so a waiting/live card checks cache/status instead of immediately flipping to `已暂停`.

Current cache-busted Tavo URL:

```html
<script src="https://index-tts.928886540.xyz/static/tavo.js?v=20260606-live-audio-v6"></script>
```

Current validation for this `L`/`D` follow-up:

- Static JS syntax checks and `git diff --check` should be run after any final doc edit.
- Full Playwright/Tavo smoke was not run in this follow-up because `9880` was not listening.
- Do not claim current GPU saturation unless a fresh `nvidia-smi` during generation shows it again.

## Latest Fix Snapshot: Normal/AI Modes, Live/Generate Jobs, Backend-Owned Parse

Updated: 2026-06-05

`static/tavo.js` is now a light Tavo regex entry. It mounts only a lazy card at first paint, then loads `static/tavo.runtime.js` on user interaction. The runtime reads `static/tavo.runtime.manifest.json`, fetches the 16 files under `static/tavo.runtime.parts/`, concatenates them in order, and executes the original IndexTTS2 runtime closure.

Completed in code:

- Preserved a single Tavo script URL while splitting the runtime into manifest-driven parts.
- Added `static/tavo.ui.skin.default.css` and `static/tavo.assets/narrator.png` as borrowed UI/asset patterns only.
- Added `reuseLlmParse` config and UI toggle; normal Tavo intelligent generation no longer calls `/parse_text` from the WebView. It submits original text, voice mapping, LLM config, and Tavo context to `/tts_dialogue_stream_job`; the backend job owns LLM parse, parse reuse, status, and errors.
- Replaced user-facing `单音色/多音色` with `普通模式/AI模式`. 普通模式 sends raw text plus default/旁白/对白 voices to the backend deterministic splitter with `parse_mode=normal`; AI模式 sends `parse_mode=ai` and LLM config to backend-owned parsing.
- Added the player `L`/`D` quick switch. `L` keeps the transient LIVE card; `D` creates a background落盘 job, persists the pending cache key, polls `/tts_dialogue_job_status/{cache_key}`, and restores it after re-entering the message.
- Deleting pending/live tracks now aborts frontend job creation/stream readers, calls backend DELETE when a cache key exists, removes pending Tavo storage, and the backend reports `cancelled` instead of turning cancellation into a failed LLM/TTS job.
- Added a human-readable cache index. The stable API files remain `outputs/cache/{cache_key}.wav/json`; each saved cache also writes one primary-role entry under `outputs/cache/by_role/<主角色>/<timestamp>_<cache_key>.wav/json` for manual backtracking.
- Kept IndexTTS2 business rules in the runtime parts: saved/cache audio still uses native `<audio>`, live/pending tracks stay transient, and LLM role ownership stays with the LLM output.
- Updated Playwright smoke to assert the lazy entry does not load runtime parts, request `/voices`, or create TTS jobs before user interaction.

Verified:

```powershell
node --check static\tavo.js
node --check static\tavo.runtime.js
node --check Leon_api\dev_tools\test_tavo_widget_playwright.js
python -m py_compile indextts2_api.py indextts\infer_vllm_v2.py indextts\gpt\model_vllm_v2.py
D:\apiWorkSpace\index-tts2-vLLM\indextts2runtime\python.exe Leon_api\dev_tools\test_snapshot_cache_readable.py
node Leon_api\dev_tools\test_tavo_widget_playwright.js
```

Playwright result: initial lazy card had `/voices=0`, job requests `0`, runtime manifest/parts `0`; clicking settings loaded one manifest and 16 runtime parts; opening the voice picker then requested `/voices` once. The smoke also checks settings labels `普通模式/AI模式`, default `LIVE` toggle, compact close buttons, centered settings/picker layers, backend-owned AI parse errors, and normal-mode `生成` cancellation.

The same Playwright script also runs a mocked intelligent-mode check. It aborts `/parse_text` as a forbidden path, intercepts `/tts_dialogue_stream_job`, `/tts_dialogue_job_status/*`, and `/cache_audio/*`, generates twice for the same message after a re-mount, and verifies `parseCount=0`, `jobCount=2`. It also asserts the job body contains `text`, `voices`, `llm_endpoint`, `llm_model`, `reuse_llm_parse`, `user_name`, `character_name`, and generation parameters.

Screenshots saved for layout evidence:

- `Leon_api/screenshots/tavo_loader_settings_desktop.png`
- `Leon_api/screenshots/tavo_loader_settings_mobile.png`

Tavo regex cache-busting URL should be updated to:

```html
<script src="https://index-tts.928886540.xyz/static/tavo.js?v=20260606-live-audio-v6"></script>
```

## Latest Packaging Snapshot: LEON Launcher

Updated: 2026-06-05

Created a local Windows launcher workspace under `Leon_api/环境检查/`.

Files:

- `LEON启动器.exe`: user-facing double-click entry. It is a small C# WinExe bootstrapper that loads the WinForms PowerShell launcher from the same folder and bypasses `.ps1` file association issues.
- `LEON启动器.bootstrap.cs`: maintainable source for rebuilding `LEON启动器.exe` with the built-in .NET Framework `csc.exe`.
- `leon-launcher.ico`: launcher icon generated from the provided avatar and embedded into the EXE.
- `一键环境检查和启动.bat`: backup entry only.
- `LEON启动器.ps1`: WinForms launcher with first-open environment check, manual check/repair, service start/stop, backend log view, voice list refresh, normal-mode multi-voice test, and Tavo setup instructions.
- `README.md`: short usage notes for the launcher folder.
- `leon-avatar.jpeg`: copied avatar source used as launcher asset input.
- `leon-launcher-banner-avatar-ai.png`: generated launcher banner using the provided avatar.

Important behavior:

- Mandatory startup method: use `Leon_api\环境检查\LEON启动器.exe` as the user/Codex entry for startup and restart workflows. Do not directly run `go-API-VLLM-NoQwen.bat` from Codex unless the user explicitly asks for low-level troubleshooting.
- The launcher must not auto-start the backend when opened. It performs environment checks and waits for the user to click the launcher start button.
- Internally, the launcher start button calls the confirmed root BAT: `go-API-VLLM-NoQwen.bat`. Treat that BAT as an implementation detail, not the operator entry. `一键环境检查和启动.bat` is backup only.
- Checks include administrator status, Chinese path, `indextts2runtime\python.exe`, NVIDIA driver, CUDA Toolkit / `nvcc`, MSVC `cl.exe`, runtime-aware SVML compatibility, Torch CUDA / vLLM / FastAPI / ninja imports, `patch_vllm` registration, required checkpoint files, voice library count, API port `9880`, and startup BAT presence.
- One-click repair can copy the bundled `svml_dispmd.dll` into the project runtime only when import logs indicate SVML/LLVM/DLL load trouble, launch `winget` installs for Visual Studio Build Tools and NVIDIA CUDA Toolkit, and install `ninja` into the project runtime.
- Voice testing uses `/voices`, `/tts_dialogue_stream_job`, `/tts_dialogue_job_status/{cache_key}`, and `/cache_audio/{cache_key}` with `parse_mode=normal`.
- Tavo instructions use the current cache-busted script URL: `https://index-tts.928886540.xyz/static/tavo.js?v=20260606-live-audio-v6`.
- No image API key or OpenAI-compatible key is written into launcher files or docs.
- `LEON启动器.ps1` is UTF-8 with BOM so Windows PowerShell 5.1 can parse Chinese text directly.

Verified:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -Command '$errs=$null; $tokens=$null; [System.Management.Automation.Language.Parser]::ParseFile("D:\apiWorkSpace\index-tts2-vLLM\Leon_api\环境检查\LEON启动器.ps1",[ref]$tokens,[ref]$errs) | Out-Null; if($errs){ exit 1 }'
$env:LEON_LAUNCHER_SMOKE_TEST='1'; powershell.exe -NoProfile -ExecutionPolicy Bypass -Command '$env:LEON_LAUNCHER_SCRIPT="D:\apiWorkSpace\index-tts2-vLLM\Leon_api\环境检查\LEON启动器.ps1"; $p=$env:LEON_LAUNCHER_SCRIPT; $utf8=New-Object System.Text.UTF8Encoding($false); $code=[System.IO.File]::ReadAllText($p,$utf8); Set-Location "D:\apiWorkSpace\index-tts2-vLLM\Leon_api\环境检查"; Invoke-Expression $code'
$env:LEON_LAUNCHER_SMOKE_TEST='1'; $p = Start-Process -FilePath "D:\apiWorkSpace\index-tts2-vLLM\Leon_api\环境检查\LEON启动器.exe" -WorkingDirectory "D:\apiWorkSpace\index-tts2-vLLM\Leon_api\环境检查" -Wait -PassThru; $p.ExitCode
```

The generated EXE SHA256 is `ACA06C44076D29694EBE9DE0D6AFAEA6FD98F2EEF82EB354AA63BDC5C2794416`.

## Known Runtime Situation

- User disabled the Windows scheduled task named `auto start`, which had been relaunching ComfyUI.
- Port `8188` was confirmed empty after killing the ComfyUI Python process.
- NVIDIA RTX 3060 has 12 GB VRAM. After ComfyUI was stopped, the machine still had about 4.3 GB GPU memory in use.
- A Python process on `127.0.0.1:9881` was present and was not killed because it looked like a TTS/model service, not ComfyUI.
- API port `9880` is the expected IndexTTS2 / Leon adapter port in this project.

## Active Direction

1. Make IndexTTS2 the default Tavo TTS mainline again.
2. Keep GPU use controlled: one heavy TTS inference at a time, avoid competing with ComfyUI/LLM/SD workloads, keep FP16/CUDA kernel defaults.
3. Preserve the Tavo player lessons already learned: job status, cache snapshots, history persistence, failed-state clarity, and real regression guards.
4. Use `docs/BUGS.md` and `docs/REGRESSION.md` as the shared memory for failures before making code changes.

## Previous Fix Snapshot: Tavo Live Card Boundary

Updated: 2026-06-05

`static/tavo.js` now has the GPT-SoVITS-style live special card flow adapted for IndexTTS2, but saved playback intentionally stays on IndexTTS2's native `<audio>` path.

Completed in code:

- `BUG-007`: live dialogue streams no longer default to native `<audio>` playback, and `start_s > 0` live stream URLs are blocked from native `<audio>`. Live jobs wait/poll for `/cache_audio/<cache_key>` unless explicitly opted in with script flags `webAudioLive=1`, `nativeLive=1`, or `elementLive=1`.
- `BUG-008`: removed the frontend "unquoted text must become narrator" role override. LLM owns segment role assignment; frontend only normalizes aliases/placeholders and maps roles to voices.
- `BUG-009`: pending/live tracks are transient, hidden from saved history count and Tavo persistence. Live card shows only play/pause plus live exit. Exit checks job status once; if `done`, the card converts to saved, otherwise it calls `DELETE /tts_dialogue_stream_job/<cache_key>` and removes the transient card.
- Saved/cache audio still uses native `<audio>` with `/cache_audio/<cache_key>` or offline object URL. Do not replace this with GPT-SoVITS-style saved WebAudio; the user specifically warned that GPT-SoVITS background playback is poor and must not be copied into IndexTTS2 saved playback.

Verified:

```powershell
node --check static\tavo.js
node --check Leon_api\dev_tools\test_tavo_widget_playwright.js
git diff --check
node Leon_api\dev_tools\test_tavo_widget_playwright.js
```

Playwright smoke result was OK: initial mount made `0` voice requests and `0` job requests, role rows rendered, picker loaded on demand, and `consoleCount` was `0`.

Still required:

- Real Tavo/iOS validation for live exit, live-to-saved conversion, saved background/lock-screen playback, and history count after re-entering a message.
- Tavo regex cache-busting URL was:

```html
<script src="https://index-tts.928886540.xyz/static/tavo.js?v=20260605-live-card"></script>
```

## Recently Imported Documentation Workflow

Created active docs:

- `docs/AGENT_STATE.md`
- `docs/ARCHITECTURE.md`
- `docs/DECISIONS.md`
- `docs/BUGS.md`
- `docs/TODO.md`
- `docs/REGRESSION.md`

Created `Leon_api/AGENTS.md` so future agents entering this directory read the active docs before work.

`Leon_api/README.md` should stay short and point to these docs. Detailed bug state belongs in `docs/`, not in the README body.

## Worktree Caution

Before editing code, run:

```powershell
git -C D:\apiWorkSpace\index-tts2-vLLM status --short
```

At the time this docs workflow was added, the worktree already had many unrelated audio asset deletions/additions and generated test WAV/JSON files. Do not revert them unless the user explicitly asks. Avoid sweeping cleanup commits that mix documentation, audio assets, and runtime code.

## Current High-Risk Areas

- Tavo injected player and persistence in `static/tavo.js`.
- `indextts2_api.py` live job / snapshot cache behavior.
- vLLM sampling parameter pass-through in `indextts/gpt/model_vllm_v2.py` and `indextts/infer_vllm_v2.py`.
- GPU/VRAM pressure causing RTF spikes.
- Mobile WebView audio behavior: streaming, saved audio replay, background playback, MediaSession, and cache seek.

## Verification Habit

Lightweight checks before handoff:

```powershell
node --check static\tavo.js
node --check Leon_api\dev_tools\test_tavo_widget_playwright.js
python -m py_compile indextts2_api.py indextts\infer_vllm_v2.py indextts\gpt\model_vllm_v2.py
git diff --check
```

Runtime checks when service is expected to be running:

```powershell
curl.exe --noproxy "*" -s http://127.0.0.1:9880/health
curl.exe --noproxy "*" -s http://127.0.0.1:9880/voices
curl.exe --noproxy "*" -I http://127.0.0.1:9880/static/tavo.js
```

Real Tavo validation remains required for playback, storage, message identity, AR injection, and mobile audio behavior.

## Latest Fix Snapshot: Tavo LIVE Status / Layout Follow-up

Updated: 2026-06-05

User reported that LIVE mode showed no exit button, appeared stuck on the second segment, could show mismatched text after switching back, and the card jumped in height. User later clarified that clicking play showed the audio had already landed on disk.

Fixes now in code:

- `.idx-live-exit` is no longer hidden by the live-active CSS selector that hides normal history controls.
- Foreground LIVE polling updates `segments_meta` by content signature, not only when the list grows.
- Foreground LIVE polling can confirm `/cache_audio/{cache_key}` with `HEAD` and switch to saved if the file is already readable but `job_status` lags. This fallback is disabled for failed/cancelled/background-generate jobs.
- Player card/control height is stabilized to reduce pending/live/saved layout jumps.
- Settings order is now: `文本模式`, `合成质量`, voice mapping, `播放 / 离线`.
- Cache-busted Tavo URL is now `https://index-tts.928886540.xyz/static/tavo.js?v=20260606-live-audio-v6`.

RTF evidence from recent real cache metadata:

- `54e4954a5312c5f90d62c329ee198424be3aec4b`: 14/14 segments, audio `109.319s`, `rtf=5.418`.
- `c69e43eb5bcd4544cfe22631822ddb1eaf91b17d`: 15/15 segments, audio `120.573s`, `rtf=6.051`.
- `nvidia-smi` at 13:57 showed RTX 3060 memory `11867MiB / 12288MiB` with two project runtime Python processes: API PID `21012` and multiprocessing child PID `31712`. This points to real GPU memory pressure in addition to the frontend stuck-state bug.

Verified after that earlier live-status follow-up, while the local API was available:

```powershell
node --check static\tavo.js
node --check static\tavo.runtime.js
node --check Leon_api\dev_tools\test_tavo_widget_playwright.js
git diff --check
node Leon_api\dev_tools\test_tavo_widget_playwright.js
```

Playwright now asserts `liveExitDisplay="flex"`, `cardMinHeight="360px"`, settings order, no frontend `/parse_text`, normal generate cancellation, and voice picker behavior.
