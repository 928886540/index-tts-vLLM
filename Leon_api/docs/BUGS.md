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

Evidence: Local machine is an RTX 3060 12 GB. ComfyUI on port `8188` had to be stopped before returning to IndexTTS work. `nvidia-smi` showed about 4.3 GB GPU memory in use after ComfyUI was killed, with other Python model services still present. Latest cache evidence on 2026-06-05: `54e4954a5312c5f90d62c329ee198424be3aec4b` produced 14 segments / 109.319s audio with `rtf=5.418`, `wall_rtf=5.47`, `lock_wait_s=0`, `total_wall_s=597.947`, and `s2mel_s=504.206`; `c69e43eb5bcd4544cfe22631822ddb1eaf91b17d` produced 15 segments / 120.573s audio with `rtf=6.051`, `wall_rtf=7.548`, and `lock_wait_s=180.455`. `nvidia-smi` at 14:17 showed `11876MiB / 12288MiB` in use with API PID `21012` and multiprocessing child PID `31712`; port `8188` was empty. A later read-only snapshot at 16:15 showed GPU memory down to `1106MiB / 12288MiB`, no compute Python process, `8188` not listening, and `9880` not listening; that means the slow RTF evidence is from completed cache metadata, not from a currently running saturated GPU process.

Hypothesis: RTF spikes when IndexTTS2 competes for dedicated VRAM, spills into shared GPU memory, or runs while other heavy GPU workloads are loaded.

Root cause: resource contention / VRAM pressure, with latest evidence pointing at the S2Mel/diffusion stage as the main inference-time bottleneck. The frontend live-card bug could make this look worse, but the latest cache metrics show real backend RTF regression too.

Fix: pending operational and code hardening. Keep ComfyUI disabled while tuning IndexTTS2; prefer FP16/CUDA kernel; keep TTS heavy concurrency at 1; expose RTF and GPU/resource notes in regression.

Guard: Before serious TTS tests, verify `8188` is not listening and check `nvidia-smi`. During a test, record RTF, audio duration, total elapsed time, and whether other compute Python processes were active.

Notes: This is the main tradeoff versus GPT-SoVITS: IndexTTS2 is more stable/quality-oriented but heavier.

## BUG-020: Tavo home player controls and status layout are cramped

Status: fixed in code, needs real Tavo validation

Reported: 2026-06-05

Repro: User reported that the player home screen should not show 10-second rewind/forward buttons; the delete button should move out of the main control row to the old page-counter position; the page counter should float at the top-right of the lyric/subtitle area; the music/add button should sit in the main control row and match the play button size; the hint under the role name is too cramped; and the top-right settings button should be slightly wider.

Evidence: `static/tavo.runtime.parts/40_mount_shell.js` rendered `rewind10` and `forward10` buttons in the home controls, kept delete as a same-row control, and placed `[data-role="counter"]` in the top header. CSS constrained `.idx-info` with large right padding and kept `.idx-status` single-line/marquee style.

Root cause: The previous control layout kept every secondary action in one row and used the header as a dense status/control strip. That left the role hint/status line too narrow and made delete/page count compete with playback controls.

Fix: `static/tavo.runtime.parts/40_mount_shell.js` removes the visible 10-second skip buttons from the home row, moves delete into the subtitle panel, moves the page counter into the subtitle panel top-right, and keeps add/music beside play. `static/tavo.ui.skin.default.css` and the fallback style in `05_style_config.js` make add/music the same size as play, float the counter with `pointer-events:none`, widen the settings button slightly, and keep the role status as a single-line ellipsis after the header space was freed. Cache busting is bumped to `20260605-ld-live-v1`.

Guard: Playwright should assert there are no `[data-role="rewind10"]` / `[data-role="forward10"]` home buttons, add/music and play share dimensions, delete lives inside `.idx-subtitle`, the counter lives inside `.idx-subtitle` at the top-right without intercepting taps, the subtitle container does not mask/fade those floating controls, and `.idx-status` stays single-line ellipsis.

Follow-up bug found during project audit: after moving delete/counter into `.idx-subtitle`, the old subtitle `mask-image` also faded the floating controls. Fixed in `static/tavo.ui.skin.default.css` and fallback `05_style_config.js` by disabling the subtitle mask for this layout, and added a Playwright guard for `maskImage === none`.

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

## BUG-013: Tavo dialogs, normal mode, and job lifecycle need tighter ownership

Status: fixed in code, needs real Tavo validation

Reported: 2026-06-05

Repro: User reported that settings and voice picker close buttons should match, both dialogs should open centered instead of jumping to an awkward scroll position, LLM analysis must be immediately cancelable, disk cache should not wait for stream playback to finish, mode labels should be `普通模式` / `AI模式`, normal mode should support default/narrator/dialogue voices without LLM, and the player needs an `L`/`D` quick switch.

Evidence: Current Tavo runtime had separate settings/picker close markup, settings/picker positioning derived mostly from player top, frontend generation used `single` / `ai8` labels, normal mode used the single-voice endpoint only, and frontend had no AbortController around the dialogue job creation request. Backend dialogue jobs already saved cache after inference, independent from GET readers, but cancelled LLM parse could still report as failed after the blocking LLM call returned.

Hypothesis: This was mostly product boundary cleanup. Normal mode should be backend-owned lightweight segmentation, not a complex Tavo-side parser. AI mode should remain backend LLM-owned. Deleting a live/pending card should mark the backend job cancelled and remove the UI immediately, including while LLM parsing has not produced audio yet.

Root cause: The runtime still treated "simple" and "multi-role" generation as two older UI/business paths (`single` vs `ai8`). That kept text parsing, voice mapping, pending card controls, and cancellation ownership split between frontend and backend instead of making `/tts_dialogue_stream_job` the single job boundary.

Fix: `static/tavo.runtime.parts/*` now normalizes modes to `normal` / `ai`, adds `playbackMode` (`live` / `generate`), and keeps the player entry light. Normal mode submits raw text, `parse_mode=normal`, and a `{default, 旁白, 对白}` voice map to the backend; AI mode submits `parse_mode=ai` and LLM config. `indextts2_api.py` now has backend deterministic normal segmentation, cancellable dialogue job states, and delayed GC that cannot remove a newer same-key job. Pending generate jobs are persisted per Tavo message and removed on done/failed/cancelled/delete.

Guard: Settings and picker close buttons use the same compact style and open centered near the player without scroll jumps. Normal mode submits raw text plus default/narrator/dialogue voice map to `/tts_dialogue_stream_job` with `parse_mode=normal`, and does not require LLM config. AI mode still submits `parse_mode=ai` and never pre-calls `/parse_text`. Deleting a pending/live card aborts the frontend job request if still in flight, calls backend DELETE when a cache key exists, removes the card immediately, and backend status reports cancelled rather than failed. `L`/`D` quick switch changes job body behavior: live creates a streaming live card, generate creates a background job that waits for `/cache_audio` and remains recoverable from cache later. Playwright now asserts normal generate/cancel makes `0` `/parse_text` calls, `0` stream GETs, one status poll, one DELETE, and clears pending storage.

## BUG-014: cache audio files need human-readable role folders and timestamp names

Status: fixed in code, needs real generation validation

Reported: 2026-06-05

Repro: User wants generated audio cache files to be easier to inspect and backtrack outside the Tavo UI.

Evidence: Current snapshot cache stores files as `outputs/cache/{sha1}.wav` and `{sha1}.json`, which is stable for API lookup but hard to browse manually.

Hypothesis: Keep the original SHA1 cache key as the API identity, but add a human-readable storage/index layer grouped by role or character. File names should start with a timestamp, include the original key, and sort by timestamp so old generations are easy to review.

Root cause: Current cache design optimizes deterministic lookup, not manual audit/history browsing.

Fix: `indextts/snapshot_cache.py` now keeps the legacy root cache files (`outputs/cache/{key}.wav` and `{key}.json`) as the API identity for `/cache_audio/{key}`, then creates one readable role-indexed entry under `outputs/cache/by_role/<主角色>/<timestamp>_<key>.wav` plus matching JSON metadata. The primary role is chosen from metadata by preferring non-generic roles over `旁白` / `对白` / `default`, then by segment frequency. The audio entry uses an NTFS hardlink when possible and falls back to copy. Cache hits sync hit metadata into the readable JSON, and delete/prune remove the readable entry with the root cache.

Guard: Different primary roles/characters should get separate folders. The original cache key must remain in the filename/metadata. Sorting filenames by name descending should put the newest timestamp first. API lookup by original key must still work through `/cache_audio/{key}` and must not depend on the readable folder.

## BUG-015: Tavo header controls and normal-mode voice UI are visually inconsistent

Status: fixed in code, needs real Tavo validation

Reported: 2026-06-05

Repro: User showed the player header where `0/0`, `LIVE`, and the settings icon use different visual weights, sizes, and colors. User also showed the 普通模式音色 section, where default/narrator/dialogue voice buttons are plain stacked buttons instead of matching the role voice mapping rows.

Evidence: `static/tavo.ui.skin.default.css` and `static/tavo.runtime.parts/05_style_config.js` style `.idx-card-counter`, `.idx-playback-toggle`, and `.idx-gear` separately. `static/tavo.runtime.parts/40_mount_shell.js` renders normal-mode voices as three standalone `.idx-voice-btn` buttons, unlike AI role mapping rows.

Hypothesis: The normal/generate feature added new controls with one-off styling instead of reusing the existing player token and role-row components.

Root cause: The LIVE/generate quick switch and normal-mode voice controls were added with one-off UI surfaces. The header controls did not share one sizing/alignment rule, and normal mode used standalone picker buttons instead of the existing role-row layout. The first fix also made 默认/旁白/对话 all look equally selectable, but the intended model is that 默认音色 is the locked base voice and only 旁白/对话 are configurable overrides.

Fix: `static/tavo.runtime.parts/40_mount_shell.js` now renders 普通模式音色 as three role-style rows. 默认 is a locked display-only row (`default-voice-label`), while 旁白 and 对话 are the only voice picker buttons. `50_settings_fields.js` updates those labels without reading normal rows into the AI role list. `54_voice_picker.js` ignores the read-only default row and scopes role-row events to `[data-role="roles-list"]`. Header styles in `static/tavo.ui.skin.default.css` and fallback CSS keep only the `L`/`D` playback toggle and settings button in the top row. Cache busting is bumped to `20260605-ld-live-v1`.

Guard: Player header controls should share the same top, height, glass background, border weight, and icon scale. Normal-mode voice settings must use role-row layout with `默认/旁白/对话`; 默认 must be display-only and not expose `[data-role="default-voice-btn"]`, while 旁白 and 对话 expose picker buttons. Normal-mode rows must not be saved into AI role mappings.

## BUG-016: Launcher SVML check can warn even when the runtime works

Status: fixed, needs launcher smoke validation on another clean machine

Reported: 2026-06-05

Repro: User noted that the project has already been running, so a launcher warning that `svml_dispmd.dll` is missing is misleading. If the current runtime can import and run vLLM/Torch, then the environment either does not need the standalone DLL on that path or resolves the dependency through another route.

Evidence: `where.exe svml_dispmd.dll` and `ctypes.WinDLL('svml_dispmd.dll')` both fail on the current machine, and the only project copy is the bundled fallback under `Leon_api/LLVM ERROR报错解决/`. Despite that, `indextts2runtime\python.exe` can import `torch 2.7.1+cu128`, `vllm 0.10.3.dev0`, `triton 3.3.1`, `llvmlite 0.44.0`, and `numba 0.61.2`. The live API on `127.0.0.1:9880` reports healthy, the running process loads both BigVGAN CUDA extension modules, and `dumpbin /DEPENDENTS` shows no `svml_dispmd.dll` dependency for the active BigVGAN `.pyd`, `llvmlite.dll`, `numba` runtime, or `triton` runtime.

Hypothesis: The launcher over-reported optional Intel SVML compatibility risk as if it were a direct missing dependency. The better check should prefer runtime evidence: search the project runtime DLL paths, then run the same Python import probe used for Torch/vLLM checks, and only warn strongly when vLLM/Torch import fails with SVML/LLVM/DLL evidence.

Root cause: The original launcher check treated global DLL absence (`System32` / PATH) as a warning by itself. That does not match the real backend chain, where Torch/vLLM/BigVGAN CUDA can run without a standalone globally loadable `svml_dispmd.dll` on this machine.

Fix: `LEON启动器.ps1` now uses a runtime-aware probe. If the project runtime can import Torch and vLLM, the SVML compatibility row is OK even when the standalone DLL is absent globally. One-click repair only copies the bundled DLL into the project runtime when the import probe output indicates SVML, LLVM, or DLL load failure. The row label was also changed to `Intel SVML 兼容兜底` to avoid presenting it as a mandatory core dependency.

Guard: A machine where `indextts2runtime\python.exe` can import `torch` and `vllm` should not show the SVML row as missing just because `svml_dispmd.dll` is absent from `System32` or global PATH. If import fails and the error mentions `svml_dispmd.dll`, LLVM, or DLL load failure, the launcher should surface that as a real repair target.

## BUG-017: Launcher taskbar icon and startup action are unclear

Status: fixed in launcher, needs visual confirmation on the real desktop

Reported: 2026-06-05

Repro: User opened `LEON启动器.exe` and saw a PowerShell icon in the taskbar. User also asked that the launcher should not feel like it starts automatically on open, and should provide a large start button in the lower-left corner.

Evidence: The EXE is a C# bootstrapper that launches the PowerShell WinForms script. The PowerShell form did not explicitly set a form icon or AppUserModelID, so Windows can show/group it as a PowerShell window. The left sidebar also had a normal-sized `启动服务` button mixed with other utility actions.

Hypothesis: The launcher needs to set its own form/taskbar identity inside the PowerShell-hosted WinForms process, and the service start action needs to be visually separated as the primary manual action.

Root cause: `LEON启动器.exe` is a small bootstrapper that starts the PowerShell-hosted WinForms UI. The EXE file has an icon, but the actual taskbar window belongs to the PowerShell process unless the form sets its own icon/taskbar identity. The service start button was also just one normal sidebar button, so it did not read as the explicit manual primary action.

Fix: `LEON启动器.ps1` now sets `SetCurrentProcessExplicitAppUserModelID("LEON.IndexTTS2.Launcher")` when available and assigns `leon-launcher.ico` to the WinForms `Form.Icon`. The small sidebar `启动服务` entry was removed and replaced with a large lower-left `启动 LEON 服务` button. Opening the launcher still runs environment detection only; backend startup remains tied to clicking the large start button.

Guard: Opening the launcher should show the LEON icon in the taskbar/Alt-Tab where Windows honors the WinForms icon, should run only environment detection automatically, and should require the user to click a large lower-left `启动 LEON 服务` button before starting the backend.

## BUG-018: Launcher home should show logs and startup should warm the model

Status: fixed in code, warmup requires next API restart to become active

Reported: 2026-06-05

Repro: User asked for console/backend logs to appear in the center area by default, with a home button to return to logs after visiting other functions. User also asked whether first startup preheats the model, because the first generation can stall on model/kernel warmup.

Evidence: The launcher had a small bottom launcher-log area and a separate `后台日志` tab, so the default center page was environment checks rather than logs. Backend `/health` only returns `{"status":"ok"}` and does not call `tts_pipeline.infer()`, so it proves liveness/model load but does not pre-run vLLM/Torch/BigVGAN inference kernels.

Root cause: Launcher logs and backend logs were split across a small bottom area and a non-default tab. API startup initialized `IndexTTS2`, but no tiny inference was run after startup, leaving first-use CUDA/vLLM/BigVGAN overhead for the first real user generation.

Fix: `LEON启动器.ps1` now uses the center first tab as `首页日志`, writes launcher logs there, pulls `/server_log/tail` when the API is available, and adds a sidebar `首页 / 日志` button. `indextts2_api.py` adds `GET/POST /warmup`; `POST /warmup` runs one very short inference under `tts_stream_lock` using a voice-library sample and fast settings. The launcher calls warmup only after the user clicks `启动 LEON 服务` and the API becomes ready; opening the launcher still does not start or warm the backend automatically.

Guard: Opening the launcher should default to the center log view. Switching to environment, voice, or Tavo pages should not hide the ability to return via `首页 / 日志`. Startup should call `/warmup` only after the API reports ready from a user-triggered service start, and `/warmup` should be guarded by `tts_stream_lock` so it does not race real generation.

## BUG-019: Launcher should expose the existing Gradio WebUI

Status: fixed in launcher, needs real desktop/browser validation

Reported: 2026-06-05

Repro: User asked to combine the existing project WebUI into the launcher instead of making the launcher a disconnected shell.

Evidence: The repository already has root `webui.py` and `go-webui-VLLM-NoQwen.bat`. `webui.py` is a Gradio UI with default `--port 7860`, and the existing BAT starts it with `indextts2runtime\python.exe webui.py --host 127.0.0.1 --fp16 --cuda_kernel --no_qwen_emo`.

Root cause: The launcher only covered API startup, environment checks, logs, voice test, and Tavo notes. It did not expose the existing Gradio WebUI path, so users had to know about the separate BAT manually.

Fix: `LEON启动器.ps1` now has a `WebUI` sidebar/page. It detects `http://127.0.0.1:7860`, can call `go-webui-VLLM-NoQwen.bat`, polls for readiness, offers a browser-open button, and attempts an embedded WinForms `WebBrowser` view. Because Gradio compatibility inside the legacy WebBrowser control can vary, browser-open remains the reliable path.

Guard: Opening the launcher must not auto-start WebUI. Clicking `启动 WebUI` should use the existing BAT and poll port `7860`; `浏览器打开` should open `http://127.0.0.1:7860`; embedded view is optional and should fail gracefully.

## BUG-019: Tavo live controls, stuck status, restore text, and settings layout regressions

Status: fixed in code, needs real Tavo validation

Reported: 2026-06-05

Repro: User ran Tavo in LIVE mode and reported that the live card did not show an exit button, first audio took too long, the second segment stayed stuck, switching back showed mismatched text/subtitles, settings/voice picker had an odd blue focus frame with non-rounded edges, and normal/AI voice mapping should appear directly under the quality tier because users care about it more. User later clarified that clicking play showed the audio had already landed on disk, so the backend/cache path was done while the frontend still looked stuck.

Evidence: User provided four Tavo screenshots from QQ cache paths and described the runtime state as LIVE mode. Current regression already says live tracks should expose only play/pause plus live exit, and settings/picker focus/open styling should be compact and aligned. Playwright reproduced the CSS condition: `.idx-card[data-live-active="1"]` previously hid `.idx-live-exit` together with other secondary controls.

Hypothesis: The latest header/UI cleanup hid the live exit control while the track was pending/live, and status polling could lag behind actual cache availability.

Root cause: Three frontend regressions overlapped. First, the live-active CSS rule hid every control except the main play button with `!important`, and the live exit button matched that hidden selector too. Second, the live status poll only converted the card when `job_status.state` became `done`; if the cache file was already readable but status lagged, the UI stayed stuck until the user clicked play and forced another check. Third, segment metadata was only copied into the track when the new list was longer, so same-length corrected `segments_meta` could update visible subtitle polling but leave the track object stale for switch/re-enter paths.

Fix: `static/tavo.ui.skin.default.css` now excludes `.idx-live-exit` from the live-active hidden-control selector and keeps a stable player/control minimum height. `static/tavo.runtime.parts/48_track_history.js` updates segment metadata by signature and, for foreground LIVE cards only, confirms `/cache_audio/{key}` with `HEAD` so a readable cache converts to saved even if status is lagging. The fallback skin in `05_style_config.js` and subtitle poll in `52_subtitle_media.js` were kept consistent. Settings order in `40_mount_shell.js` now puts normal/AI voice mapping directly under quality. Playwright smoke now asserts live exit visibility, card min height, and settings order.

Guard: In LIVE mode, pending/live cards must always show an immediate exit/cancel button and no normal history controls. Status polling must update live segment metadata without mixing text from another message/track, and re-entering a message must bind pending jobs by stable message id plus cache key. Settings and picker focus outlines should use the same rounded radius as the component. The voice mapping section should render directly below quality tier settings. The player card height should remain stable while status/subtitle/control states change.

## BUG-022: Tavo home header and LIVE play click regressions

Status: fixed in code, needs real Tavo validation

Reported: 2026-06-05

Repro: User screenshot shows the avatar/name/status dropped below the top-right LIVE/settings controls. User clarified that avatar, role name/status, and the two top buttons should share one row; the visible `LIVE` text pill should become a small single-letter control; `L` means LIVE and `D` means落盘/后台生成; the role hint can stay single-line when that space is freed; the live exit button should be a circular button with the same size as play; and clicking play during live streaming currently appears to do nothing.

Evidence: Current CSS adds top padding to `.idx-top`, keeps `.idx-status` in two-line clamp mode, renders `.idx-playback-toggle` as a wide text pill, and styles `.idx-live-exit` as a wide rectangular button. In the live play path, click handling can fall through into a wait-for-saved-cache branch without an immediate clear state change, so the user can perceive the play button as unresponsive while the backend is still running or already saving.

Hypothesis: The previous home layout fix over-allocated header space for delete/LIVE/settings and pushed identity text into a second row. LIVE-mode playback also needs an explicit foreground wait/resume state and visible feedback instead of silently reusing the saved-cache fallback.

Root cause: The top row still carried too much width because playback mode was rendered as a text pill and delete competed with identity controls. The live play click also treated a waiting LIVE card with `play.dataset.state === "loading"` as a pause request, so the same click could set loading feedback and then immediately flip the card to `已暂停`.

Fix: `40_mount_shell.js` renders the playback mode as a single-letter `L` / `D` button and keeps delete inside the subtitle panel next to the floating counter. `50_settings_fields.js`, `10_tracks_icons.js`, and `62_events_boot.js` sync the direct `L`/`D` toggle without a dropdown. `static/tavo.ui.skin.default.css` and fallback CSS keep avatar/name/status plus the two top buttons on one row, make status single-line ellipsis, and make live exit circular/play-sized. `62_events_boot.js` no longer pauses a live card just because the play button is already in `loading`; clicking a pending/live card now shows checking/waiting feedback and lets `generate(false)` check `/cache_audio` / `/tts_dialogue_job_status`.

Guard: Playwright should assert the identity row and the two top buttons are aligned, the playback mode control is icon-sized and shows only `L` or `D`, no playback dropdown exists, the role status is single-line ellipsis, the live exit control is circular and play-sized, and clicking play on a pending/live card immediately enters a visible wait/check state without creating a second job or immediately showing `已暂停`.

Audit note: the first Playwright guard for live-exit size accidentally removed `data-live-active` after forcing `.idx-hidden`, so it could measure the hidden live-exit button as `0x0` and fail even when production CSS was correct. The test now keeps `data-live-active=1` while measuring the forced visible button.
