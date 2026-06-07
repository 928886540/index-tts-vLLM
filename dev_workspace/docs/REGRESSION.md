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
- LIVE starts one generation POST then same-key stream GET;
- same-key LIVE recovery never POSTs another job or DELETEs the job;
- restored LIVE pending jobs from `tavo.get` reconnect same key with `start_s`;
- avatar-side header status keeps only stable voice labels or "音色未设置";
- transient generation/playback progress appears in a one-line transparent hint floating above the lyric panel near the seek/time area, not in the avatar-side status or lyric toolbar;
- floating progress can combine synthesis progress with current playback segment, such as `AI 合成 13/36 · 播第 3/36 段`, and must not rapidly cycle through connection/buffer micro-states;
- LIVE controls keep play/pause at the saved-audio play button position and put live-exit at the music-note position;
- LIVE page counter remains on the right side of the subtitle toolbar when delete is hidden;
- lazy snapshot open/play gestures pre-prime WebAudio/native audio before runtime loading, and the resolved `tavo.message.current().id` is synced back to the loader click closure/pre-primed owner;
- loader shell shows a loading bar and refreshes the history counter from Tavo/local saved tracks;
- lyric panel can show planned `segments_plan` lines before all `segments_meta` timing is complete;
- the lyric toolbar stays inside `.idx-subtitle`, remains sticky while lyrics scroll, and keeps delete/page counter in place.
- loading spinner keeps a stable center/size and must not visibly wobble.

## Tavo Storage Guard

- Runtime config, character voice config, saved tracks, and pending jobs read `tavo.get` before local fallback.
- Writes use `tavo.set`; `localStorage` is compatibility fallback only.
- A failed `tavo.set` must surface as "设置保存失败" and must not show a false success.
- Deleting the final audio must clear `currentCacheKey`, element audio source/dataset, WebAudio state, pending storage, and persisted history.
- Live/pending/failed tracks are not saved history. Saved history count changes only after a cache-ready/saved track exists.

## Role / Voice Guard

- Normal mode submits `voices.default` and `voices.旁白` when narrator is configured.
- Blank normal `对白` is omitted and inherits narrator/default on the backend.
- Explicit normal `对白` submits `对白`, `对话`, `台词`, and `dialogue` aliases with the same voice.
- AI mode requires explicit mappings for `旁白`, `用户`, current Tavo character, and custom roles.
- AI mode must not submit `voices.default` or display `cfg.defaultVoice` as the current role voice.
- AI mode with no explicit mapping must show a clear mapping error before creating a job, and the player header should show "音色未设置" rather than any default voice.
- Frontend must not force unquoted LLM segments back to `旁白`; role ownership belongs to the LLM/backend parse result.

## LIVE Playback Guard

- LIVE and saved playback are separate states.
- LIVE WebAudio must prefer same-key `/tts_dialogue_stream_job/{cache_key}/pcm` polling before the final WAV cache is saved; chunked WAV is compatibility fallback only.
- `/pcm` chunk headers must only send `X-IndexTTS-Live-Done=1` when `X-IndexTTS-PCM-Next-Offset >= X-IndexTTS-PCM-Total`; frontend should keep polling if a stale/old backend sends premature done.
- PCM playback should prefer AudioWorklet queued output, then ScriptProcessor, then BufferSource scheduling. Real Tavo logs should show which output path is active.
- User play/generate gestures should prime both WebAudio and native `<audio>` output, so a later same-key native live fallback can start without waiting for final cache.
- The music-note generate gesture must not force-close a recently pre-primed AudioContext unless it is explicitly retrying a stuck live/pending track.
- LIVE pending/restored tracks keep `playbackMode=live`, `state=live`, and last resume seconds.
- LIVE pause/resume reconnects `/tts_dialogue_stream_job/<cache_key>?start_s=<last_second>` without a new POST.
- Repeated WebAudio underrun returns to idle/resumable state and keeps cache polling alive; it must not force saved-cache autoplay or leave a permanent spinner.
- If WebAudio output/device startup fails while LIVE is active, switch to same-key native live `<audio>` with `start_s` before waiting for saved `/cache_audio`.
- User-facing copy must not say "实时生成跟不上" or "手动续播".
- Completed cache handoff must stop WebAudio before mounting native saved `<audio>` only when LIVE never became audible, was interrupted, or entered explicit saved-cache fallback; stable/audible LIVE should not be stolen just because cache landed.
- Cache落盘 must not steal an already audible LIVE stream into saved `<audio>` or show a fresh loading handoff just because a transient stalled/buffering flag was recorded.
- Short buffering after LIVE playback starts must not immediately reset the main button to idle or show "还没收到实时音频".
- LIVE PCM playback should keep enough prebuffer to reduce audible 0.xs stalls when the next segment is still being synthesized.
- If cache audio becomes ready while LIVE never became audible, was interrupted, or entered explicit saved-cache fallback, the frontend may force native saved `<audio>` handoff so the user gets audible playback.
- Saved/cache audio uses native `<audio>` with `/cache_audio/<cache_key>` or offline blob.

## LLM / Status Guard

- Tavo frontend must not call `/parse_text` in normal AI generation.
- Frontend submits one `/tts_dialogue_stream_job` body containing text, parse mode, voices, LLM config, Tavo user/character context, role hints, and generation parameters.
- Backend-owned status/error should surface through `/tts_dialogue_job_status/{cache_key}`.
- UI should translate raw backend phases into clear text, such as LLM call, role/emotion analysis, waiting first audio, or synthesizing segment x/y.
- LIVE synthesis status should include current playback segment when known, and should be throttled enough that users can read it.
- Do not expose raw internal copy like "文本已拆分" as the main user-facing status.
- Native `<audio>` `seeking` / `seeked` logs should be hidden unless the script URL explicitly enables `debugSeek=1`.
- AI LIVE should not label backend-owned LLM/TTS phases as the wrong mode; mode-specific status should say whether it is checking/reusing LLM parse, waiting first audio, or synthesizing.

## Launcher Guard

For `launcher/LEON-Launcher.ps1`:

- Opening launcher must not start the API backend.
- Primary start/stop button must show immediate `启动中...` / `停止中...` feedback and ignore repeat clicks.
- Visible logs should hide launcher self-check `/health` and `/server_log/tail` spam.
- Startup/diagnostic logs should strip ANSI/mojibake/banner noise.
- Launcher startup should use root `LEON-Launcher.exe`, not ad-hoc backend BAT files, unless explicitly debugging low-level startup.

## Resource Guard

Before long generation or benchmarks:

```powershell
cmd.exe /c netstat -ano | findstr ":8188"
nvidia-smi
```

- Avoid running ComfyUI/SD at the same time as long TTS.
- Keep one heavy TTS inference at a time.
- For current RTX 3060 12 GB vLLM setup: `0.11` is safer; `0.15` is the speed preset when other GPU workloads are off; avoid `0.20+` unless revalidated.

## Secret Scan

Before commit or sharing docs:

```powershell
rg -n "sk-[A-Za-z0-9]{8,}" dev_workspace static vllm fast6g README.md
rg -n "api[_-]?key|Authorization|Bearer" dev_workspace/docs static vllm fast6g
```
