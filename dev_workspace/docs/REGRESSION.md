# Regression

Active regression checklist. Full historical checklist was archived on 2026-06-07:

- `dev_workspace/docs/archive/REGRESSION_ARCHIVE_20260607.md`

Read the archive only when reviving older launcher, benchmark, or Tavo edge-case work.

## Basic Checks

Run checks relevant to touched files:

```powershell
node --check static\tavo.js
node --check static\tavo.runtime.js
node --check dev_workspace\dev_tools\test_tavo_widget_playwright.js
git diff --check
```

For backend edits:

```powershell
python -m py_compile vllm\indextts2_api.py fast6g\indextts2_api.py fast6g\indextts\infer_v2.py
```

For runtime health when the API should be running:

```powershell
curl.exe --noproxy "*" -s http://127.0.0.1:9880/health
curl.exe --noproxy "*" -s http://127.0.0.1:9880/voices
curl.exe --noproxy "*" -I http://127.0.0.1:9880/static/tavo.js
```

## Tavo Script Guard

After changing Tavo frontend files:

1. Bump the Tavo script query/version in `static/tavo.js`, `static/tavo.runtime.js`, `static/tavo.runtime.manifest.json`, and docs.
2. Confirm first paint creates only `.idx-lazy-card`: no runtime manifest, runtime parts, `/voices`, or TTS jobs before user interaction.
3. Confirm opening runtime loads one manifest and all 16 runtime parts.
4. Confirm opening settings does not request `/voices` or create a TTS job.
5. Run:

```powershell
node dev_workspace\dev_tools\test_tavo_widget_playwright.js
```

Current smoke must prove:

- empty player disables the main play button and keeps the music-note generate button enabled;
- main play never creates a generation POST;
- music-note is the only new-audio generation entry;
- settings and picker render without double focus outline;
- settings order is mode buttons, quality, voice mapping, playback/offline;
- normal mode shows only `旁白` and `对白`;
- AI role mapping does not include normal dialogue rows and does not submit `voices.default`;
- Default LIVE starts one generation POST then native `<audio>` GETs `/tts_dialogue_stream_job/<cache_key>/mp3` with sourceKind `live-mp3`;
- Explicit `webAudioLive=1` starts one generation POST then same-key `/pcm` stream GET for legacy WebAudio regression;
- `nativeLive=1` starts one generation POST, then uses `/tts_dialogue_stream_job/<cache_key>/segment/0` through native `<audio>` with sourceKind `live-segment`; it must not poll `/pcm` or `/mp3` before cache落盘.
- `mp3Live=1` remains an explicit alias for the default MP3 route: one generation POST, then `/tts_dialogue_stream_job/<cache_key>/mp3` through native `<audio>` with sourceKind `live-mp3`; it must not poll `/pcm` or `/segment/<idx>` before cache落盘.
- same-key LIVE recovery never POSTs another job or DELETEs the job;
- page-hide/background must keep the current LIVE output naturally running for default MP3 and explicit WebAudio, not show “暂挂/点播放继续”, not set `pausedByUser` / `livePageSuspended`, not clear streams, not POST a new job, and not DELETE the backend job;
- foreground visibility return must not require a resume click or `start_s` reconnect; only the user pressing the player/system media pause button may enter paused state;
- system/lock-screen MediaSession play/pause/seek on default LIVE MP3 must operate the same native `<audio>` element. It must not reconnect `/mp3?start_s=...`, POST a new job, DELETE the job, set `pausedByUser`, or clear LIVE/saved state;
- unknown-duration LIVE MP3 must keep the seek slider disabled and must not convert slider position into `/mp3?start_s=...`; only reliable `duration_s`, `metrics.audio_duration_s`, or segment timing may enable LIVE seeking;
- restored LIVE pending jobs from `tavo.get` reconnect same key with `start_s`;
- non-cached LIVE jobs write a chat-scoped pending card immediately after `cacheKey`; remounting the message restores that same key without a new POST, and explicit LIVE exit/delete must use `preserve_completed=1`;
- stale `pending/live` records with a `cacheKey` must refresh `/tts_dialogue_job_status` and/or `/cache_audio` before select/play; `state=done`, `status=done`, or `serverState=done` must promote to saved history, clear pending, and play `/cache_audio` instead of re-entering LIVE;
- saved/cache MP3 seek must stay on the saved native `<audio>` source even if the element still has stale `live-mp3` dataset/source from an old stream. Dragging the progress bar must set `audio.currentTime`, update the seek value, immediately sync the highlighted lyric row, and make no new LIVE GET or `/mp3?start_s=...` request;
- saved/cache MP3 seek while the track is playing must keep the main button and track state as playing. The next play-button click should pause, not be required to catch up to the real audio state;
- previous/next saved-card selection must start from the selected card's own clean initial position; current v61 behavior intentionally starts saved-card switches from 0 to avoid first-load progress inheritance;
- dirty restored LIVE pending cards must not inherit saved/offline `lastElementSec`. If a pending LIVE record has `lastElementSec=7` but no trusted LIVE resume fields, runtime open must show `00:00`, play `/tts_dialogue_stream_job/<key>/mp3` without `start_s=7`, and keep the first LIVE lyric active;
- lazy/loader snapshots must not display or propagate `lastElementSec` from saved or pending records before the runtime opens. Unopened cards start from clean zero progress;
- if a saved card's seek/play path is active, "currently playing" must only be inferred from that card's own complete-audio source (`offline-blob` or `/cache_audio`), not from an unrelated or stale LIVE `<audio>` source;
- LIVE pending jobs must be stored only under `indextts_pending_jobs_<messageId>` and must not create `indextts_pending_jobs_text_<正文hash>`; saved and pending cards under the same message object use `trackIndex` / `trackId` / `cacheKey` to distinguish cards, message body edits must not break remount recovery, and explicit unfinished LIVE exit/delete should clear only the pending card while keeping saved cards;
- explicit LIVE exit must be confirm-then-commit: if the API backend reports `preserved=true`, `state=done`, or `state=saving`, keep/promote the card as saved history and clear pending only after saved history persists; if backend DELETE or Tavo pending/history write fails, keep the LIVE pending card visible and retryable;
- explicit LIVE exit must not call `/cache/<key>` directly in the guarded path; the API backend owns whether unfinished remote job/cache can be cancelled, while saved/saving cache is protected by `preserve_completed=1`;
- when saved and a distinct active LIVE pending card coexist on remount, snapshot/runtime open should default to the active LIVE pending card so the user can resume or explicitly exit it immediately. Same-key saved evidence still wins over stale pending and must not re-enter LIVE;
- on an empty lazy card, the left play button should generate/play the current bubble through the normal music-note path, while clicking the lazy card body should only open the runtime shell/player without creating a job;
- offline saved audio should first use Tavo chat file storage. New saves must fetch complete `/cache_audio/<cacheKey>`, convert the Blob to a dataUrl, and write `tavo.file.save(name, dataUrl, { scope: "chat", encoding: "dataUrl" })`. New saves must default to `indextts-<cacheKey>.mp3`; legacy `indextts-<cacheKey>.wav` remains readable/deletable. If the `tavo.file.url()` path fails as an `<audio>` source, retry `tavo.file.load(..., { encoding: "dataUrl" })` as a local `blob:` before falling back to online `/cache_audio`; `dataUrl` is the first read path, `base64` is fallback only, and there is no `byte` encoding path;
- if `offline-blob audio.play()` is rejected as unsupported, saved playback must automatically switch to complete online `/cache_audio/<cacheKey>` and stay in saved playback. It must not stop at "please click again", re-enter LIVE, or request `/tts_dialogue_stream_job/...`;
- avatar-side header status keeps only stable voice labels or "音色未设置";
- transient generation/playback progress appears in a one-line transparent hint floating above the lyric panel near the seek/time area, not in the avatar-side status or lyric toolbar;
- floating progress can combine completed synthesis progress with current playback segment, such as `已生成 8/10 段 · 正在播第 7/10 段`, and must not rapidly cycle through connection/buffer micro-states;
- LIVE controls keep play/pause at the saved-audio play button position and put live-exit at the music-note position;
- top controls read left-to-right as `LIVE`/`DISK`, page counter, settings; the page counter stays outside `.idx-subtitle`;
- toggling `LIVE`/`DISK` during LIVE playback must not reset the active speaker title/avatar/voice label;
- group chat speaker avatars use the matching `chat.characters` role avatar, while unmapped group roles are not auto-added to `voices` or AI `roles_hint`;
- lazy snapshot open/play and runtime play/generate gestures must not prewarm WebAudio or a separate silent native audio element; they may only record a recent gesture timestamp for explicit WebAudio recovery;
- loader shell shows a loading bar and refreshes the history counter from Tavo/local saved tracks;
- lyric panel can show planned `segments_plan` lines before all `segments_meta` timing is complete;
- the lyric toolbar stays inside `.idx-subtitle`, remains sticky while lyrics scroll, and keeps the delete control in place.
- loading spinner keeps a stable center/size and must not visibly wobble.

## Tavo Storage Guard

- Runtime config, character voice config, saved tracks, and pending jobs read `tavo.get` before local fallback.
- Writes use `tavo.set`; `localStorage` is compatibility fallback only.
- A failed `tavo.set` must surface as "设置保存失败" and must not show a false success.
- Deleting the final audio must clear `currentCacheKey`, element audio source/dataset, WebAudio state, pending storage, and persisted history.
- LIVE generation must create durable pending storage as soon as the API backend returns `cacheKey`; WebView death/lock-screen remount must restore a visible same-key card that keeps cache polling.
- Explicit LIVE exit/delete is the only normal cleanup path for an unfinished LIVE pending card; passive page unload, app backgrounding, or playback interruption must not remove it.
- Explicit LIVE exit/delete removes an unfinished pending card only after backend cancellation and Tavo pending/history writes are both confirmed. If the job is already saving/done, it must be preserved as saved history; if cancellation or local persistence fails, keep the card for retry and surface the failure.
- `tavo.file.exists()` plus `tavo.file.url()` is not enough proof that an audio element can play the file path. On local file-path playback error, the frontend should use `tavo.file.load(..., { encoding: "dataUrl" })` to read the file and play a `blob:` URL before marking offline failed. Tavo's documented file encodings are `utf8`, `dataUrl`, and `base64`; do not invent a `byte` encoding.
- If a local offline `blob:` URL is created but native `audio.play()` rejects it as unsupported, the frontend should switch to the complete online `/cache_audio/<cacheKey>` saved source automatically.
- Deleting a saved/cache card must synchronously check and delete the matching Tavo chat MP3 file (`indextts-<cacheKey>.mp3`) plus legacy WAV candidate (`indextts-<cacheKey>.wav`) before removing persisted history. If `tavo.file.delete` fails, keep the card so the user can retry instead of leaking an offline file.
- Live/pending/failed tracks are not saved history. Saved history count changes only after a cache-ready/saved track exists.

## Role / Voice Guard

- Normal mode submits `voices.default` and `voices.旁白` when narrator is configured.
- Blank normal `对白` is omitted and inherits narrator/default on the backend.
- Explicit normal `对白` submits `对白`, `对话`, `台词`, and `dialogue` aliases with the same voice.
- AI mode requires explicit mappings for `旁白`, `用户`, current Tavo character, and custom roles.
- AI mode must not submit `voices.default` or display `cfg.defaultVoice` as the current role voice.
- AI mode with no explicit mapping must show a clear mapping error before creating a job, and the player header should show "音色未设置" rather than any default voice.
- Frontend must not force unquoted LLM segments back to `旁白`; role ownership belongs to the LLM/backend parse result.
- Current Tavo `chat.characters` may be used for display-only avatar lookup by exact role name. It must not auto-expand voice mappings, AI `roles_hint`, or required voice rows.

## LIVE Playback Guard

- LIVE and saved playback are separate states.
- Default LIVE must prefer native MP3 `/tts_dialogue_stream_job/{cache_key}/mp3` before the final MP3 cache is saved.
- Explicit `webAudioLive=1` must prefer same-key `/tts_dialogue_stream_job/{cache_key}/pcm` polling before the final MP3 cache is saved; chunked/debug WAV is compatibility fallback only.
- `/pcm` chunk headers must only send `X-IndexTTS-Live-Done=1` when `X-IndexTTS-PCM-Next-Offset >= X-IndexTTS-PCM-Total`; frontend should keep polling if a stale/old backend sends premature done.
- PCM playback should prefer AudioWorklet queued output, then ScriptProcessor, then BufferSource scheduling. Real Tavo logs should show which output path is active.
- Default MP3 and `mp3Live=1` / `nativeLive=1` paths should only call `play()` on the real live/saved audio element, not on a silent unlock element.
- Explicit WebAudio should create/resume AudioContext only when the explicit WebAudio/PCM path actually starts; a normal music-note generate gesture must not force-create or force-close a prewarmed AudioContext.
- LIVE pending/restored tracks keep `playbackMode=live`, `state=live`, and last resume seconds.
- A fresh LIVE job must also be persisted to pending storage immediately after `cacheKey`, not only after user pauses or after DISK/background mode; this is the lock-screen/WebView-death recovery anchor.
- LIVE pause/resume keeps the active output alive when possible; default MP3 uses native `<audio>`, while explicit WebAudio keeps the local PCM queue alive when the controller is still valid. If explicit WebAudio local resume fails, fallback may reconnect `/tts_dialogue_stream_job/<cache_key>?start_s=<last_second>`, but must not create a new POST.
- App background/page-hide/visibility events must not pause or suspend any LIVE output. They may record a timestamp for diagnostics only; they must not stop polling, switch output, clear the current audio, write `pausedByUser`, or wait for a foreground gesture.
- The recorded LIVE resume second must stay monotonic for manual seek/resume and real recovery. If stale buffering state says `lastStalledSec=7` but the latest LIVE progress is `17s`, manual resume/recovery must prefer `17s`, not jump back to 7.
- Native LIVE MP3 pause must store `liveElementOffsetSec + audio.currentTime` before pause/reload can zero the element. While paused, `trackResumeSec()` must prefer stored live progress over the current element time.
- Native LIVE MP3 `timeupdate` / `stalled` / `pause` must not overwrite absolute LIVE progress with a zero or stream-relative element time after reconnect; resume seconds should be monotonic except for explicit user seek.
- Repeated WebAudio underrun returns to idle/resumable state and keeps cache polling alive; it must not force saved-cache autoplay or leave a permanent spinner.
- If explicit WebAudio output/device startup fails while LIVE is active, switch to same-key MP3/native live with `start_s` before waiting for saved `/cache_audio`.
- Opt-in `nativeLive=1` should play finite WAV segments from `/tts_dialogue_stream_job/{cache_key}/segment/{idx}`. The segment endpoint should return `404 segment not ready` until the requested segment is ready, then `200 audio/wav` with `X-IndexTTS-Segment-*` headers.
- Default LIVE and opt-in `mp3Live=1` should play `/tts_dialogue_stream_job/{cache_key}/mp3` as `200 audio/mpeg`. The MP3 route must yield real `bytes`, not `bytearray`, so Starlette does not raise `AttributeError: 'bytearray' object has no attribute 'encode'`.
- `/tts_dialogue_stream_job/{bad_key}/segment/0` and `/tts_dialogue_stream_job/{bad_key}/mp3` should return JSON 404 for invalid cache keys, not 500.
- `GET /cache_audio/{cache_key}` and `HEAD /cache_audio/{cache_key}` should default to the completed MP3 cache with `audio/mpeg` and `X-IndexTTS-Audio-Format: mp3`; `?format=wav` should only be used for explicit debug/regression/legacy WAV checks.
- User-facing copy must not say "实时生成跟不上" or "手动续播".
- Completed cache handoff must stop WebAudio before mounting native saved `<audio>` only when LIVE never became audible, was interrupted, or entered explicit saved-cache fallback; stable/audible LIVE should not be stolen just because cache landed.
- Cache落盘 must not steal an already audible LIVE stream into saved `<audio>` or show a fresh loading handoff just because a transient stalled/buffering flag was recorded.
- Cache落盘 while native `live-mp3` is already owned by the current track must keep that live source playing and continue progress/subtitle updates; saved `/cache_audio` mounting is reserved for explicit fallback, user seek, replay, or non-audible/interrupted streams.
- Short buffering after LIVE playback starts must not immediately reset the main button to idle or show "还没收到实时音频".
- LIVE PCM playback should keep enough prebuffer, pull sufficiently large chunks, and flush small pending PCM tails before the queue runs dry to reduce audible 0.xs stalls at segment boundaries.
- If cache audio becomes ready while LIVE never became audible, was interrupted, or entered explicit saved-cache fallback, the frontend may force native saved `<audio>` handoff so the user gets audible playback.
- Saved/cache audio uses native `<audio>` with default MP3 `/cache_audio/<cache_key>` or offline MP3/blob. WAV remains only for debug/regression/legacy fallback.

## LLM / Status Guard

- Tavo frontend must not call `/parse_text` in normal AI generation.
- Frontend submits one `/tts_dialogue_stream_job` body containing text, parse mode, voices, LLM config, Tavo user/character context, role hints, and generation parameters.
- Backend-owned status/error should surface through `/tts_dialogue_job_status/{cache_key}`.
- UI should translate raw backend phases into clear text, such as LLM call, role/emotion analysis, waiting first audio, or synthesizing segment x/y.
- During backend-owned LLM parsing, `/tts_dialogue_job_status/{cache_key}` should expose `llm_stage` and fresh `llm_elapsed_s`; the frontend should show `检查分段复用`, `等待 LLM 返回 Ns`, or `整理分段结果`, not first-audio waiting copy.
- If `复用 LLM 拆段` is requested but no parse cache is hit, user-facing copy should say `复用未命中，等待 LLM 返回 Ns` so it is clear the option was checked but missed.
- When a live job is waiting on the single TTS lock, `/tts_dialogue_job_status/{cache_key}` should include queue metrics and the Tavo progress hint should say `前面还有 X 个 TTS 任务` or `下一个开始`.
- LIVE synthesis status should include current playback segment when known, and should be throttled enough that users can read it.
- Do not expose raw internal copy like "文本已拆分" as the main user-facing status.
- Native `<audio>` `seeking` / `seeked` logs should be hidden unless the script URL explicitly enables `debugSeek=1`.
- AI LIVE should not label backend-owned LLM/TTS phases as the wrong mode; mode-specific status should say whether it is checking/reusing LLM parse, waiting first audio, or synthesizing.

## Launcher Guard

For root `LEON-Launcher.exe` and `launcher/LeonNativeLauncher.cs`:

- Opening launcher must not start the API backend.
- Primary start/stop button must show immediate `启动中...` / `停止中...` feedback and ignore repeat clicks.
- Visible logs should hide launcher self-check `/health` and `/server_log/tail` spam.
- Startup/diagnostic logs should strip ANSI/mojibake/banner noise.
- Launcher startup should use root `LEON-Launcher.exe`, not ad-hoc backend BAT files, unless explicitly debugging low-level startup.
- Environment detection must show and persist separate rows for `vllm` and `fast6g`: vLLM checks CUDA Toolkit / MSVC / SVML / vLLM plugin; fast6g checks 6G runtime packages and `DeepSpeed 6G 加速`.
- Runtime package detection must parse the explicit `LEON_IMPORT_PROBE_JSON=` marker and tolerate colored stdout warnings from packages such as `modelscope` or `deepspeed`.
- Starting the service must not require a completed environment check; environment detection is a manual diagnostic page, and startup/runtime errors should surface through launcher logs.
- One-click repair lives inside the environment detection page and only repairs rows present for the currently selected version.
- Health checks, backend log refresh, startup waiting, warmup, and process scans must stay off the UI thread.
- Closing the launcher or pressing stop must request `/control?command=exit`, then clean port `9880`, launcher wrapper processes, and LEON runtime Python parent/child processes.
- API calls should use absolute `http://127.0.0.1:9880/...` URLs and short timeouts where appropriate, so local polling cannot freeze the UI.

## Resource Guard

Before long generation or benchmarks:

```powershell
cmd.exe /c netstat -ano | findstr ":8188"
nvidia-smi
```

- Avoid running ComfyUI/SD at the same time as long TTS.
- Keep one heavy TTS inference at a time, and keep all heavy TTS paths on the shared queue wrapper so queue-ahead status remains accurate.
- For current RTX 3060 12 GB vLLM setup: `0.11` is safer; `0.15` is the speed preset when other GPU workloads are off; avoid `0.20+` unless revalidated.

## Secret Scan

Before commit or sharing docs:

```powershell
rg -n "sk-[A-Za-z0-9]{8,}" dev_workspace static vllm fast6g README.md
rg -n "api[_-]?key|Authorization|Bearer" dev_workspace/docs static vllm fast6g
```
