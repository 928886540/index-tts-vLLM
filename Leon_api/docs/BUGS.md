# Bugs

## Format

```text
## BUG-000: title

Status:
Reported:
Repro:
Evidence:
Hypothesis:
Root cause:
Fix:
Guard:
Notes:
```

## Process Rules

- When the user reports a new bug, add or update an entry here before changing code.
- If root cause is not confirmed, mark it as `open, investigating`.
- Keep evidence separate from hypothesis.
- Before fixing a bug, read this file and avoid duplicate or conflicting fixes.
- When the bug is fixed, record the actual root cause, the code/files changed, and the regression guard.
- If a fixed bug returns, update the same entry and add a stricter guard in `docs/REGRESSION.md`.

## BUG-001: IndexTTS2 resource pressure can make RTF spike

Status: open, accepted product risk

Reported: 2026-06-05

Repro: User noted that IndexTTS has high resource usage and RTF rises badly unless enough GPU/SM/shared-memory headroom is available.

Evidence: Local machine is an RTX 3060 12 GB. ComfyUI on port `8188` had to be stopped before returning to IndexTTS work. `nvidia-smi` showed about 4.3 GB GPU memory in use after ComfyUI was killed, with other Python model services still present.

Hypothesis: RTF spikes when IndexTTS2 competes for dedicated VRAM, spills into shared GPU memory, or runs while other heavy GPU workloads are loaded.

Root cause: resource contention / VRAM pressure, not a Tavo frontend bug.

Fix: pending operational and code hardening. Keep ComfyUI disabled while tuning IndexTTS2; prefer FP16/CUDA kernel; keep TTS heavy concurrency at 1; expose RTF and GPU/resource notes in regression.

Guard: Before serious TTS tests, verify `8188` is not listening and check `nvidia-smi`. During a test, record RTF, audio duration, total elapsed time, and whether other compute Python processes were active.

Notes: This is the main tradeoff versus GPT-SoVITS: IndexTTS2 is more stable/quality-oriented but heavier.

## BUG-002: ComfyUI auto-start can occupy port 8188 and GPU memory

Status: mitigated manually, needs future startup hygiene

Reported: 2026-06-05

Repro: User asked to kill ComfyUI on port `8188`, then clarified it was started by a scheduled task named `auto start`.

Evidence: `netstat` showed `0.0.0.0:8188 LISTENING` owned by Python PID `24644`. The process was stopped. User later disabled the `auto start` scheduled task. Follow-up `netstat` showed no `8188` listener.

Root cause: Windows scheduled task was relaunching ComfyUI.

Fix: User disabled the task. Codex stopped the active `8188` Python process.

Guard: Before IndexTTS2 performance testing, run:

```powershell
cmd.exe /c netstat -ano | findstr ":8188"
nvidia-smi
```

`8188` should be empty unless the user intentionally runs ComfyUI.

## BUG-003: Historical Tavo track count and persistence can desync

Status: open, carried risk from prior Tavo player work

Reported: inherited from recent GPT-SoVITS Tavo work, relevant to IndexTTS2 player too

Repro: In the GPT-SoVITS Tavo player, snapshot/lazy cards could display the wrong history audio count, and failed/pending tracks could interfere with persisted history.

Evidence: The IndexTTS2 player also relies on Tavo storage and saved track metadata. Any player rewrite or engine switch can reintroduce the same class of bug.

Hypothesis: Count desync usually comes from one of these:

- runtime and lazy shell use different message IDs;
- `tavo.get` runs before Tavo API is ready and count is never refreshed;
- failed/live tracks are included or excluded inconsistently;
- save path writes an empty array and erases existing history;
- no event tells lazy snapshot cards that saved history changed.

Root cause: pending in this repository.

Fix: pending. Do not copy GPT-SoVITS code blindly; inspect current `static/tavo.js` implementation first.

Guard: After any persistence change, verify current full player count, lazy snapshot count, and re-entered message count all match. Failed jobs must not clear saved history.

## BUG-004: Failed or missing audio must not be played as a valid source

Status: open, carried risk from prior Tavo player work

Reported: inherited from recent GPT-SoVITS Tavo work, relevant to IndexTTS2 player too

Repro: A failed backend job can leave the frontend holding a stream URL; if the player feeds an error response or missing cache into `<audio>`, the user sees `MEDIA_ERR_SRC_NOT_SUPPORTED` / code 4 instead of the real server failure.

Evidence: User experienced this class of issue in the GPT-SoVITS player. IndexTTS2 has similar endpoints and track state concepts, so the guard should be part of this project too.

Hypothesis: Track state and playable URL selection are not strict enough around `failed`, `missing`, or deleted jobs.

Root cause: pending in this repository.

Fix: pending. Inspect `static/tavo.js` before changing.

Guard: A failed track should show a stable failed state, stop polling/streaming/subtitles, and never hand its stream URL to `<audio>` as a playable source. Saved history must remain intact.

## BUG-005: LLM parse / role mapping can route dialogue to the wrong voice

Status: open, known high-risk area

Reported: inherited from earlier IndexTTS2 handoff notes

Repro: Historical notes mention role mapping and LLM post-processing issues: default role rows, `旁白` / `用户` / current character mapping, role rename migration, and quote/narration classification.

Evidence: `Leon_api/README.md` lists several recently handled role mapping rules and warns that Tavo frontend / role mapping changes must use the `tavo` skill.

Root cause: role identity across Tavo message context, LLM output, frontend mapping, and backend voice map can drift if treated as plain strings without normalization rules.

Fix: historical fixes exist in current code; pending re-audit before further changes.

Guard: For any role/LLM change, test at least `旁白`, `用户`, and one named character. Backend `segments_meta` must expose actual voice used, and the frontend should display actual segment voice when available.

## BUG-006: Mobile WebView streaming and saved playback can diverge

Status: open, needs real Tavo validation

Reported: inherited from prior handoff notes and current product direction

Repro: iOS/Tavo WebView may reject chunked WAV in `<audio>`, suspend Web Audio in background, interrupt fetch readers, or fail to resume after app switches.

Evidence: The project already contains Web Audio streaming logic and Playwright/Tavo test notes. Prior GPT-SoVITS work showed mobile audio bugs are often host-lifecycle issues, not just WAV formatting.

Root cause: pending per current IndexTTS2 runtime.

Fix: pending; do not solve using a mock browser alone.

Guard: Validate in real Tavo / emulator after any audio lifecycle change. Saved/cache audio should be seekable and replayable. Live streaming should either play reliably or degrade to saved-cache completion with clear UI.

## BUG-007: Live dialogue stream with `start_s` can trigger Tavo audio code=4

Status: fixed in code, needs real Tavo validation

Reported: 2026-06-05

Repro: During a long IndexTTS2 dialogue job, Tavo logged `audio error code=4 src=https://index-tts.928886540.xyz/tts_dialogue_stream_job/<cache_key>?start_s=60.219`.

Evidence: `static/tavo.js` can route live tracks through native `<audio>` via `startElementAudioFrom()`. When seeking/resuming a live dialogue track, it appends `start_s` to `/tts_dialogue_stream_job/{cache_key}` and assigns that URL to `audio.src`. The backend returns chunked WAV for live jobs and only returns a complete seekable WAV after `/cache_audio/{cache_key}` is ready.

Hypothesis: iOS/Tavo WebView rejects chunked live WAV, especially when opened from a mid-stream `start_s` URL, and reports `MEDIA_ERR_SRC_NOT_SUPPORTED` / code 4. This is a frontend playback policy bug, not evidence that the generated cache audio is invalid.

Root cause: live and saved playback shared the same element-audio path. A live dialogue track could be resumed or selected through `startElementAudioFrom()`, producing `/tts_dialogue_stream_job/{cache_key}?start_s=...` and assigning that chunked live WAV URL to native `<audio>`. That is especially fragile in Tavo/iOS WebView and can surface as `MEDIA_ERR_SRC_NOT_SUPPORTED` / code 4.

Fix: `static/tavo.js` now refuses native live playback by default, and never uses native live playback for `start_s > 0`. Live jobs wait/poll for `/cache_audio/{cache_key}` unless the script URL explicitly opts in with `webAudioLive=1`, `nativeLive=1`, or `elementLive=1`. Native audio code=4 on a live stream now falls back to waiting for saved cache audio instead of poisoning the audio element or deleting history.

Guard: A running dialogue track resumed/seeking at `start_s > 0` must not set `<audio src=/tts_dialogue_stream_job/...?...start_s=...>`. It must continue polling until cache audio is playable, then switch to saved native `<audio src=/cache_audio/...>` playback.

## BUG-008: Frontend post-process overrides LLM role ownership

Status: fixed in code, needs real Tavo validation

Reported: 2026-06-05

Repro: Tavo debug log showed `无引号正文强制归旁白: role=<character> -> 旁白 ...` even though the LLM had already returned a character role for that segment.

Evidence: `static/tavo.js` post-processes LLM segments by locating each segment in source text, checking quote depth, and force-changing non-`旁白` roles outside quotes to `旁白`.

Hypothesis: The frontend is crossing the ownership boundary. The LLM should decide segment ownership; the frontend should only normalize aliases and map roles to voices.

Root cause: the frontend post-processor crossed the ownership boundary after the LLM had already selected `role`. It searched source text, checked quote depth, and force-changed non-`旁白` roles outside quote marks to `旁白`, so frontend heuristic could override LLM intent.

Fix: `static/tavo.js` no longer performs the quote-depth role override. It preserves the LLM role and only normalizes aliases/placeholders such as `narrator -> 旁白`, `你/user/User/<Tavo user name> -> 用户`, and `角色/current character -> currentCharacterName`, then applies style and voice mapping.

Guard: If the LLM returns a non-`旁白` role for text without balanced quote marks, the frontend must preserve that role and submit it to the backend voice map unchanged except for alias normalization.

## BUG-009: Live stream track uses normal history-card controls

Status: fixed in code, needs real Tavo validation

Reported: 2026-06-05

Repro: During IndexTTS2 live dialogue generation, the card exposes normal history controls such as previous/next, seek, delete, and saved-audio replay behavior while the backend job is still running.

Evidence: `static/tavo.js` uses the same `generatedTracks` card and controls for `pending`/`live`/`saved` states. Live tracks can be persisted with a `cacheKey`, counted as history, selected like saved tracks, and routed through normal seek/play branches. User requested the GPT-SoVITS-style live special card: play/pause plus exit only, kill job on exit, and switch to a normal card only after audio is saved.

Hypothesis: The root issue is state-boundary leakage: live jobs, saved history, and failed/deleted tracks share one UI/control model. Per-error workarounds cannot cover every WebView/audio edge case.

Root cause: state-boundary leakage. `pending`/`live`/`saved` tracks shared one history-card model, so live jobs could be counted/persisted as history, exposed to previous/next/seek/delete, and routed through saved-audio playback branches before a stable cache existed.

Fix: `static/tavo.js` now treats live/pending tracks as transient. Tavo persistence and history counts include saved/cache-ready tracks only. During live state, normal history controls are hidden, seek is disabled, and the card exposes only play/pause plus live exit. Live exit checks job status once; if the job is already `done` it converts to saved, otherwise it calls `DELETE /tts_dialogue_stream_job/{cache_key}` and removes the transient card without touching saved history. Saved playback stays on the existing native `<audio>` cache path to preserve background/lock-screen behavior.

Guard: Live track regression must verify: only play/pause and exit are visible; prev/next/seek/delete/add do not act on live tracks; exit cancels the backend job and removes the transient card without changing saved history count; `done` status converts to a normal saved card with native `<audio>` playback.

## BUG-010: Tavo settings panel is too long and LLM parse reuse is not exposed clearly

Status: fixed in code, needs real Tavo validation

Reported: 2026-06-05

Repro: User reported that the current IndexTTS2 Tavo settings page is too long, and asked to copy the GPT-SoVITS settings-page style plus expose LLM reuse behavior.

Evidence: Current `static/tavo.js` is a large monolithic injected script. The GPT-SoVITS reference project has a lighter loader/runtime split, compact settings sections, `reuseLlmParse` field handling, and a narrator background asset under `static/tavo.assets/narrator.png`.

Hypothesis: Settings UX is hard to scan because unrelated controls are shown in one long surface. LLM parse reuse either is missing or not surfaced as a clear setting/status, so intelligent mode can re-call `/parse_text` unnecessarily or feel like it ignores previous parsed segments.

Root cause: the injected player had grown into one monolithic startup path. Mounting the full runtime made the entry heavier than necessary, and settings mixed generation, voice, LLM, role, and playback controls in one long surface. LLM parse reuse also was not represented as a first-class config field/toggle.

Fix: `static/tavo.js` is now a light lazy entry that defers the full IndexTTS2 runtime until play/open/settings. The runtime moved into `static/tavo.runtime.js`, `static/tavo.runtime.manifest.json`, and 16 `static/tavo.runtime.parts/*.js` fragments. The settings UI now loads a compact skin, exposes `reuseLlmParse`, and uses `static/tavo.assets/narrator.png` for narrator subtitle avatars. After BUG-012, LLM parse reuse is backend-owned: the frontend sends text and LLM config with the dialogue job and does not pre-call `/parse_text`.

Guard: Playwright smoke must confirm initial lazy mount has `.idx-lazy-card`, no `.idx-card`, zero `/voices`, zero TTS job requests, and zero runtime manifest/part fetches. After clicking settings it must load one manifest and all runtime parts, open the compact panel, keep subtitle height fixed, avoid horizontal overflow, and request `/voices` only when the voice picker opens. Intelligent-mode smoke must assert frontend `/parse_text` requests stay at `0` and backend job bodies carry text, LLM config, voice map, and Tavo context.

## BUG-011: Tavo AR loader UI and LLM error wording regressions

Status: fixed in code, needs real Tavo validation

Reported: 2026-06-05

Repro: User reported five Tavo AR frontend issues after the loader split: `/parse_text` network error copy is too technical and does not clearly separate LLM/backend/Tavo AR failures; settings panel opens in the wrong place instead of following the player; lazy snapshot card still shows a settings button; settings close button styling looks odd; voice picker page height is slightly too short for the 10/12-item grid.

Evidence: Example console/debug text says `LLM 解析代理 /parse_text 请求没有到达后端` with raw `about:srcdoc`, script URL, endpoint, and generic network causes. Current CSS positions `.idx-panel` and `.idx-picker` from fixed `--idx-layer-left/top` defaults, so the panel can appear at viewport top-left. `static/tavo.js` lazy card renders `[data-role="lazy-gear"]`.

Hypothesis: The split copied the reference layer-position model too literally for this IndexTTS2 Tavo AR surface. For Tavo AR, body-fixed dialogs still need to derive their layer rect from the current player card. The error formatter also exposes implementation details before the actual user-facing classification.

Root cause: the loader split left three UI/runtime mismatches in the IndexTTS2 Tavo AR surface. First, `/parse_text` fetch failures were formatted as raw transport/debug output before saying what failed, so a Tavo AR browser-to-backend failure looked like an LLM error. Second, the settings and voice dialogs were moved to `document.body` to escape Tavo transform clipping, but their fixed-position CSS still used default viewport coordinates instead of recalculating from the current player card. Third, the lazy shell kept reference-skin snapshot settings affordances and old compact-button defaults after the full settings entry moved into the runtime.

Fix: `static/tavo.runtime.parts/00_base_context.js` and `30_llm_parse.js` now classify legacy `/parse_text` failures as: Tavo AR/browser did not reach IndexTTS, IndexTTS backend returned an HTTP failure, or IndexTTS returned non-JSON content. Technical URL/browser details are moved under a `技术细节` block. `40_mount_shell.js`, `54_voice_picker.js`, and `62_events_boot.js` now position body-mounted settings/picker dialogs from the current `.idx-card` before opening and on resize. `static/tavo.js` no longer renders a lazy snapshot settings button, `static/tavo.ui.skin.default.css` and fallback CSS style close buttons as compact 32px icon buttons, and the voice picker height is increased. Cache busting was bumped again for BUG-012 to `20260605-job-parse-v1`, and the runtime skin style id remains `indextts-tavo-player-v5`.

Guard: `/parse_text` network failure must say this is Tavo AR/browser not reaching IndexTTS, not an LLM model error. HTTP failures from `/parse_text` must say IndexTTS was reached and include backend/LLM detail. Settings should open aligned with the current player card on desktop/mobile. Lazy snapshot should have no settings button. Close buttons should be compact icon buttons. Voice picker should have enough height for one page of voice cards without feeling cramped. Playwright smoke now asserts no `[data-role="lazy-gear"]`, panel/card rect alignment, close button size, and picker height.

## BUG-012: Tavo intelligent mode frontend calls /parse_text before creating backend job

Status: fixed in code, needs real Tavo validation

Reported: 2026-06-05

Repro: In Tavo AR intelligent mode, the injected frontend calls `POST /parse_text` first. If that browser-to-backend request fails, the user sees a frontend-side `/parse_text` transport error before any `POST /tts_dialogue_stream_job` job exists.

Evidence: User reported a Tavo AR debug/error string saying `LLM 解析代理 /parse_text 请求没有到达后端` with request URL `https://index-tts.928886540.xyz/parse_text`, current page `about:srcdoc`, script source `static/tavo.js`, and LLM endpoint `http://127.0.0.1:8317/v1`. User clarified that LLM parse success/failure should be controlled by the backend after job creation, and the frontend should only submit source text, voice mapping, LLM config, and generation parameters once to get a job id/cache key.

Hypothesis: The loader split added frontend LLM parse reuse as a product optimization, but it kept LLM parse ownership in the Tavo WebView. That is the wrong boundary for Tavo AR because the browser fetch to `/parse_text` can fail before the backend owns the job. It also duplicates backend validation and makes backend/LLM/Tavo transport failures harder to classify.

Root cause: the loader split put LLM parse ownership in the Tavo WebView. `static/tavo.runtime.parts/60_generate_flow.js` called the frontend `parseWithOptionalReuse()` helper before creating a `/tts_dialogue_stream_job`, because `indextts2_api.py` required `segments` for `TTS_Dialogue_Request`. That made the browser perform a pre-job `/parse_text` request and turned Tavo/browser transport failures into frontend LLM errors before the backend owned the job.

Fix: `TTS_Dialogue_Request` now accepts either legacy `segments` or raw `text` plus LLM config. For text-only requests, `/tts_dialogue_stream_job` creates the live job/cache id immediately, then `_run_dialogue_inference_to_job()` runs backend-owned LLM parsing before entering the TTS lock. Job metrics expose `phase/message` such as `llm_parse`, `tts_queue`, `tts`, `llm_parse_failed`, and `done`; LLM failures surface through `/tts_dialogue_job_status/{cache_key}`. `static/tavo.runtime.parts/60_generate_flow.js` no longer calls `parseWithOptionalReuse()` in normal ai8 mode. It submits original `text`, `voices`, `llm_endpoint`, `llm_model`, `llm_api_key`, `reuse_llm_parse`, Tavo `user_name`/`character_name`, `roles_hint`, and generation parameters in one job request. Frontend track `segments` start empty and are filled later from backend `segments_meta`.

Guard: Playwright intelligent-mode smoke now aborts `/parse_text` as a forbidden frontend path and asserts frontend `/parse_text` request count is `0`, job creation count is `2`, and the job body contains `text`, `voices`, LLM config, context names, role hints, and generation parameters. A separate smoke simulates `metrics.phase=llm_parse_failed` from `GET /tts_dialogue_job_status/{cache_key}` and verifies the UI shows the backend LLM failure instead of a pre-job frontend network error.
