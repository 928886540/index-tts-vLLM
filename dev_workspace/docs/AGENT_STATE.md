# Agent State

Updated: 2026-06-08

This is the active handoff summary. Full historical state was archived on 2026-06-07:

- `dev_workspace/docs/archive/AGENT_STATE_ARCHIVE_20260607.md`

Read the archive only when investigating old decisions, benchmark history, or fixed regressions.

## Current Goal

Keep LEON IndexTTS2 as the Tavo mainline with stable local startup, explicit role mapping, durable Tavo storage, and predictable LIVE/saved playback.

## Terminology

- `后端` / backend: API layer only, mainly `vllm/indextts2_api.py`, `fast6g/indextts2_api.py`, routes, job/cache/status, and API-side helpers.
- `前端` / frontend: Tavo injected UI/scripts, mainly `static/tavo.js`, `static/tavo.runtime.js`, runtime parts, Tavo storage, and playback lifecycle.
- `TTS服务`: IndexTTS / IndexTTS2 inference/model pipeline.
- `启动器`: `LEON-Launcher.exe`, `launcher/`, and `scripts/`.

Use these boundaries when reporting bugs or fixes.

## Current Tavo Version

Cache-busted script:

```html
<script src="http://<LAN-IP>:9880/static/tavo.js?v=20260608-mp3-cache-v48"></script>
```

Current code state:

- `static/tavo.js`, `static/tavo.runtime.js`, `static/tavo.runtime.manifest.json`, root `README.md`, and `dev_workspace/README.md` use `20260608-mp3-cache-v48`.
- `ttsDebug=1` now keeps debug output in the Tavo console/server tail only. The in-page debug overlay is opt-in with `debugPanel=1`, so normal native-audio testing does not cover the player controls.
- Root `README.md` is now the project introduction with README images. `dev_workspace/README.md` is the active working README for Codex repository work.
- Root `AGENTS.md` was moved into `dev_workspace/AGENTS.md`; start new Codex sessions in `dev_workspace` for the shortest working context.
- Tavo settings/config read `tavo.get` first; `localStorage` is fallback only.
- `tavo.set` failures surface as "设置保存失败".
- Saved tracks and pending jobs prefer `tavo.get`; deletion writes through `tavo.set`.
- Offline audio bytes now use Tavo chat-scoped `tavo.file` storage. The default user-facing file key is `indextts-<cacheKey>.mp3`; legacy `indextts-<cacheKey>.wav` remains readable/deletable for older snapshots and regression assets. Saved track metadata still uses `tavo.set`.
- If a saved Tavo offline file exists but `tavo.file.url()` is not playable as an `<audio>` source in the current WebView, the player retries with `tavo.file.load(..., { encoding: "dataUrl" })` and a local `blob:` URL before falling back to online `/cache_audio`.
- Deleting a saved/cache card now checks and deletes the matching Tavo chat-scoped offline file before clearing saved history metadata; if Tavo file deletion fails, the card is kept for retry.
- Main play button only plays/pauses current audio. The music-note button creates new audio.
- Empty player disables play and keeps music-note enabled.
- AI mode does not submit `voices.default`; explicit role mappings are required.
- AI mode with no explicit mapping shows "音色未设置" / mapping error instead of falling back to a default voice.
- Avatar-side status is only the configured/current voice label; LLM/TTS/LIVE progress uses a transparent one-line hint floating near the seek/time area. During LIVE playback, synthesis progress uses completed/audio-current wording such as `已生成 8/10 段 · 正在播第 7/10 段`; noisy connection/buffer micro-states are filtered/throttled. The top header shows `LIVE`/`DISK`, page counter, then settings; the lyric panel toolbar keeps delete only.
- Settings keeps `复用 LLM 拆段` and `保存离线音频` as label-only switches. The old explanatory subtext is removed.
- Submit/LLM progress copy is short and phase-based: `准备分析文本`, `任务已提交，等待分析文本`, `正在分析文本`, `等待合成`, `已生成 X/Y 段`. The old per-second submit timers and `AI x/y` / bare `合成 x/y` style are not user-facing.
- vLLM and fast6g expose FIFO visibility for the existing single TTS lock; queued LIVE jobs show `前面还有 X 个 TTS 任务` in the transparent progress hint instead of only showing elapsed waiting.
- LIVE controls keep the main play/pause button at the same position as saved-history playback; the live-exit button occupies the music-note position while previous/next only reserve invisible layout space. This remains true when cache落盘 but MP3/WebAudio LIVE output is already audible.
- Lazy snapshot open/play and runtime play/generate gestures no longer pre-prime WebAudio or a silent native `<audio>` unlock. They only record a recent gesture timestamp for explicit WebAudio suspend/recovery decisions; the default MP3 path relies on the real `<audio>` play call.
- The loader shell shows a small loading bar while the runtime opens, and its history counter is refreshed from the same Tavo/local track snapshot as the lazy card.
- Toggling `LIVE`/`DISK` updates only playback mode chrome and does not overwrite the current speaker-owned title/avatar while audio is active.
- Default LIVE now uses native `<audio src="/tts_dialogue_stream_job/<cache_key>/mp3">` MP3 streaming. It is the main Tavo path because native audio can continue through normal app/background switching better than WebAudio in the mobile WebView.
- Completed cache now defaults to MP3 and remains the saved-history/offline playback path and final fallback if LIVE is unsupported or interrupted. WAV is retained only for explicit diagnostics/regression/legacy compatibility, such as `debug_save_wav=1` or `nativeLive=1` segment checks.
- LIVE WebAudio remains available only as an explicit diagnostic/legacy path with `webAudioLive=1`, `pcmLive=1`, or `chunkedLive=1`. Its old page-hide temporary suspend still applies only to that WebAudio/raw-stream path.
- LIVE WebAudio starts with a slightly larger PCM prebuffer, pulls larger PCM chunks, lowers the poll wait, and flushes small pending PCM tails sooner to reduce short stalls at segment boundaries.
- LIVE WebAudio pause now keeps the local AudioContext/PCM controller alive and keeps polling the same cache key in the background; play resumes that local queue first instead of reconnecting or creating a new backend job. If local resume fails, it falls back to same-key `start_s` recovery.
- LIVE WebAudio page-hide audio interruption records the resume second, keeps the same key/pending card/cache polling, and waits for a foreground user gesture before reconnecting.
- Default MP3 LIVE is not page-hide suspended by the frontend; `visibilitychange` should not show “暂挂/点播放继续”, clear the stream, or delete the job.
- LIVE background suspend resume seconds are monotonic for explicit WebAudio: foreground play uses the latest visible/WebAudio LIVE progress (`liveResumeSec` / `lastLiveProgressSec`) ahead of stale `lastStalledSec`, so a later segment does not resume from an old buffering point.
- Restored LIVE pending tracks keep resume seconds and reconnect the same key with `start_s`, without a new POST.
- Fresh non-cached LIVE jobs now persist a chat-scoped pending card immediately after the API backend returns `cacheKey`. If the Tavo WebView dies before cache落盘, remount restores the same visible LIVE card and continues cache polling; explicit LIVE exit/delete clears that pending card and remote job/cache.
- Explicit WebAudio LIVE uses same-key live PCM polling before cache落盘. Frontend PCM output now prefers an AudioWorklet queue, then ScriptProcessor, then BufferSource scheduling. No default silent audio/WebAudio prewarm is issued; explicit WebAudio creates/resumes its AudioContext when that diagnostic path actually starts. If WebAudio device startup fails, the same LIVE key can switch to MP3 native live before cache落盘 instead of waiting for saved audio.
- `nativeLive=1` now forces LIVE playback through a native `<audio>` segment queue: `/tts_dialogue_stream_job/<cache_key>/segment/<idx>` returns finite WAV segments as they become ready.
- `mp3Live=1` remains an explicit alias for the default MP3 live route; `nativeLive=1` keeps the finite WAV segment queue for diagnostics.
- vLLM and fast6g both expose `/segment/<idx>` and `/mp3`; invalid cache keys on those new routes now return JSON 404 instead of leaking `snapshot_cache` `ValueError` as a 500.
- MP3 live stream chunks are cast to `bytes` before `StreamingResponse` yields them. This is required because this runtime's `lameenc` returns `bytearray`, which Starlette treats as text-like and otherwise raises `AttributeError: 'bytearray' object has no attribute 'encode'`.
- If LIVE is already audible when the cache file lands, the frontend keeps the current LIVE output and does not steal playback into saved `<audio>`; native saved `<audio>` handoff is reserved for explicit saved fallback or interrupted/not-yet-audible streams.
- When live MP3 reaches `ended` before `/cache_audio` is confirmed ready, the progress hint stays visible as "MP3 实时流已结束 / 等待完整音频保存" and is no longer overwritten by stale `LIVE 合成 x/y` text.
- Loading spinner has fixed SVG transform origin to reduce wobble.
- Native `<audio>` seeking/seeked debug logs are quiet by default; use `debugSeek=1` only when diagnosing seek behavior.
- Group chat speaker avatars now use the current Tavo chat `chat.characters` list as a display-only role/avatar map. Matching is exact role name plus lowercase key fallback; it does not auto-add group characters to AI voice mappings or `roles_hint`.

## Latest Validation

Passed on 2026-06-08:

```powershell
python -m py_compile vllm\indextts\snapshot_cache.py fast6g\indextts\snapshot_cache.py vllm\indextts2_api.py fast6g\indextts2_api.py fast6g\indextts\infer_v2.py
node --check static\tavo.js
node --check static\tavo.runtime.js
node --check dev_workspace\dev_tools\test_tavo_widget_playwright.js
$manifest = Get-Content -Raw static\tavo.runtime.manifest.json | ConvertFrom-Json; $code = "(async function(){`n"; foreach ($m in $manifest.modules) { $code += (Get-Content -Raw (Join-Path static $m.file)) + "`n" }; $code += "`n})();"; $code | node --check -
node dev_workspace\dev_tools\test_tavo_widget_playwright.js
git diff --check
```

`git diff --check` only reported Windows LF-to-CRLF warnings, not whitespace errors.

After `20260608-mp3-cache-v47`, the same frontend/backend syntax checks and Playwright smoke passed again. The smoke now asserts default LIVE / `mp3Live=1` use only `live-mp3` `<audio>.play()`, `nativeLive=1` uses only `live-segment` `<audio>.play()`, explicit WebAudio background suspend reports `unlockPlays=0`, live-MP3-ended-before-cache keeps the waiting-for-final-cache state, and offline save writes `indextts-<cacheKey>.mp3` as `data:audio/mpeg;base64,...`.

After `20260608-mp3-cache-v48`, frontend syntax/manifest/smoke passed again. The smoke now additionally asserts:

- setting panel no longer shows the verbose `复用 LLM 拆段` / `保存离线音频` explanatory copy;
- LIVE progress exposes generated-complete count plus current playback segment, e.g. `已生成 1/3 段 · 正在播第 1/3 段`;
- ambiguous `AI x/y` or bare `合成 x/y` progress copy must not appear.

Additional LIVE route validation on vLLM after restart:

- Restarted vLLM with `--vllm_gpu_memory_utilization 0.15`; current API PID `27908`, vLLM worker PID `28356`; `/health` reports `version=vllm`, `vllm_gpu_memory_utilization=0.15`, and `vllm_enforce_eager=true`.
- Fresh stderr `logs/vllm/api_restart_stable_20260608_111701_try1.err` has no `No available memory for the cache blocks`, `Error in memory profiling`, `EngineCore failed`, `bytearray`, or ASGI traceback after the MP3 fix.
- Invalid route probes now return 404 JSON for both `/tts_dialogue_stream_job/test-missing/mp3` and `/tts_dialogue_stream_job/test-missing/segment/0`.
- Playwright smoke confirms default LIVE and `mp3Live=1` submit one job then use `/mp3` with sourceKind `live-mp3`; `nativeLive=1` submits one job then uses `/segment/0` with sourceKind `live-segment`.
- Runtime cache check after the restart confirms existing dual-format cache key `c972ddb0526f0da4aeb30bc8948f8ddd9e15acb1` now serves default `/cache_audio/<key>` as `200 audio/mpeg`, `X-IndexTTS-Audio-Format: mp3`, `Content-Length: 167183`; explicit `?format=wav` serves `200 audio/wav`, `X-IndexTTS-Audio-Format: wav`, `Content-Length: 457884`.
- Fresh short normal-mode job `18f1f764dcec7f1bda2564ba38e293aa5e0d5965` generated only `vllm/outputs/cache/18f1f764dcec7f1bda2564ba38e293aa5e0d5965.mp3` plus JSON; `/cache_audio/<key>` returns `200 audio/mpeg`, `X-IndexTTS-Audio-Format: mp3`, `Content-Length: 47647`. Its readable cache entry is `vllm/outputs/cache/by_role/旁白/20260608-111958-756_18f1f764dcec7f1bda2564ba38e293aa5e0d5965.mp3`.

RTF/live-route smoke, vLLM `0.15`, voice `400个火爆音色/短剧解说`, normal mode, balanced, 64 Chinese chars, `diffusion_steps=14`, `prompt_audio_seconds=10`, `segment_tokens=60`, `first_tokens=18`, `interval_ms=50`, after warmup:

| mode | endpoint proof | first endpoint audio | audio | wall | RTF | first PCM | gpt/s2mel/bigvgan | peak GPU |
| --- | --- | ---: | ---: | ---: | ---: | ---: | --- | ---: |
| `nativeLive=1` segment WAV | `/segment/0..4` all `200 audio/wav`; first segment `169672 B`, `3.846s` | `6.035s` | `10.359s` | `15.015s` | `1.449` | `3.982s` | `6.720s / 6.611s / 0.440s` | `9872 MiB` |
| `mp3Live=1` true MP3 stream | `/mp3` `200 audio/mpeg`, `128 kbps`, `167183 B` | `3.270s` | `10.382s` | `14.121s` | `1.360` | `3.205s` | `6.691s / 6.511s / 0.352s` | `9868 MiB` |

Conclusion: the new playback transport does not materially increase TTS service RTF in this short sample. The MP3 path started delivering playable bytes earlier than segment WAV because it can emit as soon as live PCM exists, while segment WAV waits for a complete finite segment.

Additional evidence for the latest no-sound reports:

- Cache WAV `vllm/outputs/cache/a161f65daed31387d94bb5f5a0772b238830598c.wav` is non-silent: about `170.837s`, `22050 Hz`, mono 16-bit, RMS around `-14.08 dB`.
- User console showed `/pcm` chunks with non-zero `peak/rms`, so PCM was arriving and not silent. A later `Failed to start the audio device` happened after switching chat/app and should be treated as an output-session interruption, not proof that PCM data is bad.
- Local `/pcm` smoke confirmed non-silent PCM on vLLM: first PCM around 3.7s, `sample_rate=22050`, `peak=0.928`, `rms=0.292`. It also exposed a header bug where `X-IndexTTS-Live-Done=1` could be returned before the client drained `X-IndexTTS-PCM-Total`; current code fixes backend done semantics and frontend keeps pulling if `next < total`.
- After v21 changes, vLLM was restarted from old PID `29652` to new PID `10792`; `/health` is OK with `vllm_gpu_memory_utilization=0.15`. Fresh `/pcm` smoke key `7297fa757ba5ec1a21e137408937ceebddd51719` was deleted after test; first PCM arrived around `1.927s`, chunk `75264 bytes`, `peak=0.928436`, `rms=0.351856`, and `done=1` had `next=total=75264`.
- Playwright smoke confirms progress now lives as a transparent one-line `.idx-card` floating hint above the lyric panel; top controls read `LIVE -> page counter -> settings`; delete stays in the sticky `.idx-subtitle .idx-sub-toolbar`; toggling `LIVE`/`DISK` during playback keeps the active speaker title/avatar; group chat role `李瓶儿` uses the matching `chat.characters` avatar without adding that role to `voices` or `roles_hint`; default MP3 LIVE stays on `live-mp3` after page hide without frontend suspend; explicit WebAudio LIVE background suspend with stale `lastStalledSec=7` and latest LIVE progress `17s` resumes the same key with `start_s=17.000`; LIVE pending durable smoke creates a pending card, remounts the same key without a new POST, and clears pending on explicit LIVE exit; offline playback smoke verifies a failed `tavo.file.url()` audio path retries through `tavo.file.load` as an `offline-blob` without hitting `/cache_audio`; card height remains `450px`.
- Boundary conclusion: the TTS service/API backend generated audible audio; the main remaining risk is frontend/mobile LIVE playback/output. Current default uses native MP3 live; explicit WebAudio still polls same-key PCM through queued output for diagnostics/regression.

Still needs real Tavo/mobile validation:

- settings save/reopen through real `tavo.set`;
- AI missing-role mapping error UI;
- LIVE first-audio/no-sound behavior on phone;
- restored pending LIVE resume after app re-entry;
- LIVE pending card recovery after lock-screen/WebView death before cache落盘;
- Default MP3 LIVE background/app-switch should continue through native audio and must not show the WebAudio “暂挂/点播放继续” path. Explicit WebAudio background suspend should not loop rebuilds, delete the job, or make audible unlock chirps.
- saved/cache native `<audio>` MP3 background and lock-screen behavior.
- offline saved MP3 playback through real Tavo `tavo.file.url` and `tavo.file.load` fallback on phone.
- saved/cache card delete should remove the matching Tavo MP3 offline file first, also check legacy WAV, and keep the card if delete fails.
- avatar-side status only shows the voice label during AI LIVE generation.
- LIVE cache落盘 while audio is already playing should not show a loading handoff or restart through saved `<audio>`.
- top header `LIVE/DISK + page counter + settings` layout and LIVE/DISK speaker header stability should be checked in the real Tavo WebView.
- group chat playback should show the matched speaker avatar from `chat.characters` while leaving unmapped group roles out of voice mappings.

## Active Bugs

Read `dev_workspace/docs/BUGS.md` first. It now contains only active/recent bugs and archive pointers.

Current high-priority validation:

- BUG-026: settings persistence through `tavo.set`.
- BUG-046: play button semantics, delete cleanup, restored LIVE same-key resume.
- BUG-047: AI role mapping without default fallback.
- BUG-048: LIVE MP3/native playback and native cache handoff.
- BUG-049: avatar-side voice label, seek-area progress hint, and spinner stability.
- BUG-050: visible TTS queue-ahead status while jobs wait on the single TTS lock.
- BUG-051: LIVE/DISK top layout and speaker header mismatch guard.
- BUG-052: group chat role avatar map, display-only without auto-expanding voices.
- BUG-053: LIVE pending card durability across lock-screen/WebView death.
- BUG-054: offline saved MP3 file-url playback fallback through `tavo.file.load`.
- BUG-055: explicit WebAudio app background interruption should temporarily suspend instead of auto-recovering without user gesture; default MP3 must not be suspended by page hide.
- BUG-044 / BUG-045: launcher visual/log validation.

## Active Direction

1. Preserve Tavo frontend lessons: durable storage, explicit role mapping, clear failed state, and saved history protection.
2. Keep LIVE and saved playback as separate states: LIVE uses same-key stream recovery; saved/cache audio uses native `<audio>`.
3. Avoid broad backend or TTS service changes unless user reports a backend/TTS-specific failure.
4. Keep GPU usage controlled: one heavy TTS job at a time and avoid ComfyUI/SD contention during generation.
5. Prefer real Tavo/emulator validation after frontend changes; Playwright is a smoke guard only.

## Known Runtime Situation

- API port `9880` is the expected LEON IndexTTS2 API port.
- Launcher entry is `D:\apiWorkSpace\leon_api\LEON-Launcher.exe`.
- The launcher must not auto-start the backend on open.
- vLLM ratio guidance from previous benchmark: `0.11` safer for long sessions; `0.15` speed sweet spot when other GPU workloads are off; avoid `0.20+` unless architecture changes.

## Worktree Caution

The worktree may be dirty. Do not revert user changes or unrelated generated assets. Before editing:

```powershell
git -C D:\apiWorkSpace\leon_api status --short
```

## Common Checks

For Tavo frontend changes:

```powershell
node --check static\tavo.js
node --check static\tavo.runtime.js
node --check dev_workspace\dev_tools\test_tavo_widget_playwright.js
node dev_workspace\dev_tools\test_tavo_widget_playwright.js
git diff --check
```

For API backend syntax changes:

```powershell
python -m py_compile vllm\indextts2_api.py fast6g\indextts2_api.py
```

For running API health:

```powershell
curl.exe --noproxy "*" -s http://127.0.0.1:9880/health
curl.exe --noproxy "*" -s http://127.0.0.1:9880/voices
curl.exe --noproxy "*" -I http://127.0.0.1:9880/static/tavo.js
```
