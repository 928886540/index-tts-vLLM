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

## Latest Fix Snapshot: Normal/AI Modes, Live/Generate Jobs, Backend-Owned Parse

Updated: 2026-06-05

`static/tavo.js` is now a light Tavo regex entry. It mounts only a lazy card at first paint, then loads `static/tavo.runtime.js` on user interaction. The runtime reads `static/tavo.runtime.manifest.json`, fetches the 16 files under `static/tavo.runtime.parts/`, concatenates them in order, and executes the original IndexTTS2 runtime closure.

Completed in code:

- Preserved a single Tavo script URL while splitting the runtime into manifest-driven parts.
- Added `static/tavo.ui.skin.default.css` and `static/tavo.assets/narrator.png` as borrowed UI/asset patterns only.
- Added `reuseLlmParse` config and UI toggle; normal Tavo intelligent generation no longer calls `/parse_text` from the WebView. It submits original text, voice mapping, LLM config, and Tavo context to `/tts_dialogue_stream_job`; the backend job owns LLM parse, parse reuse, status, and errors.
- Replaced user-facing `单音色/多音色` with `普通模式/AI模式`. 普通模式 sends raw text plus default/旁白/对白 voices to the backend deterministic splitter with `parse_mode=normal`; AI模式 sends `parse_mode=ai` and LLM config to backend-owned parsing.
- Added the player `LIVE/生成` quick switch. LIVE keeps the transient streaming card; 生成 creates a background job, persists the pending cache key, polls `/tts_dialogue_job_status/{cache_key}`, and restores it after re-entering the message.
- Deleting pending/live tracks now aborts frontend job creation/stream readers, calls backend DELETE when a cache key exists, removes pending Tavo storage, and the backend reports `cancelled` instead of turning cancellation into a failed LLM/TTS job.
- Kept IndexTTS2 business rules in the runtime parts: saved/cache audio still uses native `<audio>`, live/pending tracks stay transient, and LLM role ownership stays with the LLM output.
- Updated Playwright smoke to assert the lazy entry does not load runtime parts, request `/voices`, or create TTS jobs before user interaction.

Verified:

```powershell
node --check static\tavo.js
node --check static\tavo.runtime.js
node --check Leon_api\dev_tools\test_tavo_widget_playwright.js
python -m py_compile indextts2_api.py indextts\infer_vllm_v2.py indextts\gpt\model_vllm_v2.py
node Leon_api\dev_tools\test_tavo_widget_playwright.js
```

Playwright result: initial lazy card had `/voices=0`, job requests `0`, runtime manifest/parts `0`; clicking settings loaded one manifest and 16 runtime parts; opening the voice picker then requested `/voices` once. The smoke also checks settings labels `普通模式/AI模式`, default `LIVE` toggle, compact close buttons, centered settings/picker layers, backend-owned AI parse errors, and normal-mode `生成` cancellation.

The same Playwright script also runs a mocked intelligent-mode check. It aborts `/parse_text` as a forbidden path, intercepts `/tts_dialogue_stream_job`, `/tts_dialogue_job_status/*`, and `/cache_audio/*`, generates twice for the same message after a re-mount, and verifies `parseCount=0`, `jobCount=2`. It also asserts the job body contains `text`, `voices`, `llm_endpoint`, `llm_model`, `reuse_llm_parse`, `user_name`, `character_name`, and generation parameters.

Screenshots saved for layout evidence:

- `Leon_api/screenshots/tavo_loader_settings_desktop.png`
- `Leon_api/screenshots/tavo_loader_settings_mobile.png`

Tavo regex cache-busting URL should be updated to:

```html
<script src="https://index-tts.928886540.xyz/static/tavo.js?v=20260605-normal-generate-v1"></script>
```

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
