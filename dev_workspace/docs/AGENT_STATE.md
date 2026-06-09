# Agent State

Updated: 2026-06-09

This is the active handoff summary. Full historical state was archived on 2026-06-07:

- `dev_workspace/docs/archive/AGENT_STATE_ARCHIVE_20260607.md`

Read the archive only when investigating old decisions, benchmark history, or fixed regressions.

## Restart Handoff 2026-06-09

Latest pushed commits on `master`:

- `98cb188` / `origin/master`: launcher tuning console first slice. Adds profile schema v2, source profiles under `config/profiles/*.json`, active runtime snapshot `config/profiles/active.json`, Tavo active-profile fetch, README rewrite with launcher screenshot, and removes stale generated launcher poster assets.
- `574576a` / `origin/master`: LLM proxy user-agent fix for both vLLM and fast6g. Real OpenAI-compatible gateway test showed direct `grok-4.1` worked, but backend-owned LLM parse was blocked by Cloudflare 1010 when urllib used the default Python user-agent.
- `9d29a49` / `origin/master`: shared voice library moved to root `prompts/library`, fast6g gained missing `profile_store.py` / `voice_library.py`, and vLLM warmup/library paths were adjusted for split packaging.

Working tree update after the launcher/Tavo profile pass:

- Profile schema is now v3. `quality.modes` carries the Tavo-facing Chinese labels, `quality.defaultMode` selects the default, and `quality.presets.live` / `quality.presets.generate` hold the per-mode LIVE and DISK parameters.
- Profile schema v3 now also carries explicit `styles` voice-cavity entries in `config/profiles/*.json` and `config/profiles/active.json`.
- Tavo no longer treats non-`custom` quality params as code-owned defaults. It fetches `/profiles/active` on load and immediately before generation; missing/invalid active profile, missing mode, or missing preset surfaces `Profile 配置错误` and blocks the generation POST.
- Runtime tuning config must not silently fall back to hidden code defaults. Missing active profile, missing `styles`, unknown style IDs, invalid style params, unavailable style refs, or invalid LLM style output should raise a clear `Profile 配置错误` / `LLM 输出错误`.
- `custom` remains the only Tavo-local temporary parameter mode.
- Launcher tuning UI is now a profile list plus editor: list cards show avatar initial, name, active/default info, enable/test/edit/copy/delete actions, and drag ordering. The editor uses one quality-mode dropdown for LIVE/DISK params, exposes profile `styles` voice-cavity CRUD, and keeps the LLM prompt box below the style section.
- Latest launcher validation passed with temp exe compile/smoke and root `LEON-Launcher.exe` compile/smoke. Root `LEON-Launcher.exe` was overwritten successfully after closing the old launcher UI process.

Runtime state after validation:

- Temporary `fast6g` lifecycle test service was stopped with `/control?command=exit`; no Codex-started API service should be left running on `9880`.
- No API keys were committed or documented. The authorized local key was read only from `D:\apiWorkSpace\cpa\config.yaml` during the real LLM smoke.
- Generated lifecycle cache remains local under `fast6g/outputs/cache/` for evidence; do not commit generated cache/audio.

Real lifecycle result:

- Started `fast6g` with `LEON_ACTIVE_PROFILE_PATH=config/profiles/active.json`.
- `/health`, `/profiles/active`, `/voices`, and `/static/tavo.js` were OK.
- Direct liangjie `grok-4.1` `/chat/completions` smoke returned `200 OK`.
- Backend-owned AI dialogue job `bc3845c69e36ddedd6a4c828c677c463204357be` completed: `llm_stage=done`, `segments_done=4/4`, `audio_duration_s=4.817`, `total_wall_s=13.564`, `rtf=2.816`.
- `/cache_audio/bc3845c69e36ddedd6a4c828c677c463204357be` returned `200 audio/mpeg`, `X-IndexTTS-Audio-Format: mp3`, `Content-Length: 78158`.

Current voice-control reality:

- "声控" currently means backend-owned LLM parse outputs per-segment control fields, not a separate launcher UI page yet.
- The active profile `llmPrompt` contains placeholders such as `{{style_rules}}`, `{{emotion_rules}}`, and `{{output_contract}}`. The API backend renders those placeholders at runtime before sending the prompt to LLM.
- LLM may output `style`, `style_alpha`, `emo_vec`, and `emo_alpha` per segment. The API backend validates them against active profile `styles`, resolves style reference audio, and sends the resulting controls into the TTS service.
- `qwen_emo` is intentionally forced off on the launcher path. The mainline is LLM-provided `style/emo_vec`, not QwenEmotion.
- The style catalog/reference-audio mapping is now externalized into profile JSON for runtime use. Code-owned defaults are seed/migration data only; they are not runtime fallback.

Next best task:

- Add role-level style policy editing later: role default style, allowed/disabled styles, and stage curves. The current launcher slice edits the shared style catalog itself.
- Keep Tavo lightweight: it should select mode/d档位 and trigger generation; the launcher owns profile creation/copy/edit/apply and style catalog editing.

## Current Goal

Keep LEON IndexTTS2 as the Tavo mainline with stable local startup, explicit role mapping, durable Tavo storage, and predictable LIVE/saved playback.

State model source of truth:

- `dev_workspace/docs/LOGIC.md` is now the canonical LEON/Tavo generation, playback, storage, LIVE page exit, saved/offline playback, and LLM reuse logic document.
- Global Codex skill `C:\Users\Administrator\.codex\skills\leon-api` was created and validated. Future LEON/Tavo playback or generation work should use it, then read `docs/LOGIC.md`.
- Product terminology is strict: there is no "live card"; there are ordinary audio cards and a LIVE page/mode. Card generation state, live page state, and playback source state must remain separate.

## Terminology

- `后端` / backend: API layer only, mainly `vllm/indextts2_api.py`, `fast6g/indextts2_api.py`, routes, job/cache/status, and API-side helpers.
- `前端` / frontend: Tavo injected UI/scripts, mainly `static/tavo.js`, `static/tavo.runtime.js`, runtime parts, Tavo storage, and playback lifecycle.
- `TTS服务`: IndexTTS / IndexTTS2 inference/model pipeline.
- `启动器`: `LEON-Launcher.exe`, `launcher/`, and `scripts/`.

Use these boundaries when reporting bugs or fixes.

## Current Tavo Version

Cache-busted script:

```html
<script src="http://<LAN-IP>:9880/static/tavo.js?v=20260609-mp3-cache-v63"></script>
```

Current code state:

- Root `README.md`, `dev_workspace/README.md`, and `dev_workspace/AGENTS.md` now point Tavo playback/generation work to `dev_workspace/docs/LOGIC.md`.
- `static/tavo.js`, `static/tavo.runtime.js`, `static/tavo.runtime.manifest.json`, root `README.md`, and `dev_workspace/README.md` use `20260609-mp3-cache-v63`.
- Launcher tuning first slice now uses profile schema v3: `config/profiles/*.json` are editable source profiles, `config/profiles/active.json` is the applied runtime snapshot, `quality.presets.live/generate` stores parameters for every Tavo quality mode, and `styles` stores voice-cavity defaults/ref audio. The launcher editor can now edit style id, label, enabled flag, ref, `style_alpha`, `emo_alpha`, `emo_vec`, and description. Saving writes the selected profile; applying writes `active.json`; backend startup receives `LEON_ACTIVE_PROFILE_PATH` pointing at the active snapshot.
- Tavo generation now reads `/profiles/active` at config load and again immediately before generation. Tavo only stores/selects the quality mode name; request parameters are taken from active profile `quality.presets.live[mode]` or `quality.presets.generate[mode]`. Profile `llmPrompt` is submitted as `parse_system_prompt` and rendered by the API backend as a template with runtime role/user/style placeholders.
- vLLM and fast6g LLM proxy requests now send a stable LEON user-agent. This fixes real OpenAI-compatible gateways that reject urllib's default Python user-agent with Cloudflare 1010 while direct keyed requests succeed.
- `ttsDebug=1` now keeps debug output in the Tavo console/server tail only. The in-page debug overlay is opt-in with `debugPanel=1`, so normal native-audio testing does not cover the player controls.
- Root `README.md` is now the project introduction with README images. `dev_workspace/README.md` is the active working README for Codex repository work.
- Root `AGENTS.md` was moved into `dev_workspace/AGENTS.md`; start new Codex sessions in `dev_workspace` for the shortest working context.
- Tavo settings/config read `tavo.get` first; `localStorage` is fallback only.
- `tavo.set` failures surface as "设置保存失败".
- Saved tracks and pending jobs prefer `tavo.get`; deletion writes through `tavo.set`.
- Offline audio bytes now use Tavo chat-scoped `tavo.file` storage. The default user-facing file key is `indextts-<cacheKey>.mp3`; legacy `indextts-<cacheKey>.wav` remains readable/deletable for older snapshots and regression assets. Saved track metadata still uses `tavo.set`.
- If a saved Tavo offline file exists but `tavo.file.url()` is not playable as an `<audio>` source in the current WebView, the player retries with `tavo.file.load(..., { encoding: "dataUrl" })` and a local `blob:` URL before falling back to online `/cache_audio`. Historical stable builds used `encoding: "dataUrl"` here; Tavo docs expose `utf8` / `dataUrl` / `base64`, not `byte`. Current code keeps `dataUrl` first and uses `base64` only as a fallback.
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
- Lazy snapshot open/play and runtime play/generate gestures no longer pre-prime WebAudio or a silent native `<audio>` unlock. The default MP3 path relies on the real `<audio>` play call.
- The loader shell shows a small loading bar while the runtime opens, and its history counter is refreshed from the same Tavo/local track snapshot as the lazy card.
- Toggling `LIVE`/`DISK` updates only playback mode chrome and does not overwrite the current speaker-owned title/avatar while audio is active.
- Default LIVE now uses native `<audio src="/tts_dialogue_stream_job/<cache_key>/mp3">` MP3 streaming. It is the main Tavo path because native audio can continue through normal app/background switching better than WebAudio in the mobile WebView.
- Completed cache now defaults to MP3 and remains the saved-history/offline playback path and final fallback if LIVE is unsupported or interrupted. WAV is retained only for explicit diagnostics/regression/legacy compatibility, such as `debug_save_wav=1` or `nativeLive=1` segment checks.
- LIVE WebAudio remains available only as an explicit diagnostic/legacy path with `webAudioLive=1`, `pcmLive=1`, or `chunkedLive=1`. Page-hide/visibility events no longer auto-suspend it; only an explicit user pause should pause playback.
- LIVE WebAudio starts with a slightly larger PCM prebuffer, pulls larger PCM chunks, lowers the poll wait, and flushes small pending PCM tails sooner to reduce short stalls at segment boundaries.
- LIVE WebAudio pause now keeps the local AudioContext/PCM controller alive and keeps polling the same cache key in the background; play resumes that local queue first instead of reconnecting or creating a new backend job. If local resume fails, it falls back to same-key `start_s` recovery.
- Default MP3 LIVE and explicit WebAudio LIVE are not page-hide suspended by the frontend; `visibilitychange` / `pagehide` should not show “暂挂/点播放继续”, set `pausedByUser`, clear the stream, or delete the job.
- Automatic LIVE recoverable/interrupted states no longer write `pausedByUser`; only the player pause button writes user-pause state.
- LIVE same-key recovery still keeps resume seconds monotonic: manual seek/resume/recovery uses the latest visible/WebAudio LIVE progress (`liveResumeSec` / `lastLiveProgressSec`) ahead of stale `lastStalledSec`.
- Restored LIVE pending tracks keep resume seconds and reconnect the same key with `start_s`, without a new POST.
- Fresh non-cached LIVE jobs now persist a chat-scoped pending card immediately after the API backend returns `cacheKey`. If the Tavo WebView dies before cache落盘, remount restores the same visible LIVE card and continues cache polling; explicit LIVE exit/delete clears that pending card and remote job/cache.
- Explicit WebAudio LIVE uses same-key live PCM polling before cache落盘. Frontend PCM output now prefers an AudioWorklet queue, then ScriptProcessor, then BufferSource scheduling. No default silent audio/WebAudio prewarm is issued; explicit WebAudio creates/resumes its AudioContext when that diagnostic path actually starts. If WebAudio device startup fails, the same LIVE key can switch to MP3 native live before cache落盘 instead of waiting for saved audio.
- `nativeLive=1` now forces LIVE playback through a native `<audio>` segment queue: `/tts_dialogue_stream_job/<cache_key>/segment/<idx>` returns finite WAV segments as they become ready.
- `mp3Live=1` remains an explicit alias for the default MP3 live route; `nativeLive=1` keeps the finite WAV segment queue for diagnostics.
- vLLM and fast6g both expose `/segment/<idx>` and `/mp3`; invalid cache keys on those new routes now return JSON 404 instead of leaking `snapshot_cache` `ValueError` as a 500.
- MP3 live stream chunks are cast to `bytes` before `StreamingResponse` yields them. This is required because this runtime's `lameenc` returns `bytearray`, which Starlette treats as text-like and otherwise raises `AttributeError: 'bytearray' object has no attribute 'encode'`.
- If LIVE is already audible when the cache file lands, the frontend keeps the current LIVE output and does not steal playback into saved `<audio>`; native saved `<audio>` handoff is reserved for explicit saved fallback or interrupted/not-yet-audible streams.
- When live MP3 reaches `ended` before `/cache_audio` is confirmed ready, the progress hint stays visible as "MP3 实时流已结束 / 等待完整音频保存". The hint is released as soon as the same live MP3 starts playing again or the track becomes saved, so weak-network recovery does not leave stale ended copy on screen.
- Saved/cache MP3 seeking always uses the native saved `<audio>` element. Once a card is saved, progress-bar drag must not reconnect `/tts_dialogue_stream_job/<cache_key>/mp3?start_s=...` or restart from zero.
- LIVE progress seeking is disabled until the frontend has a reliable total duration from `duration_s`, `metrics.audio_duration_s`, or segment timing. The progress meter no longer invents a `position + 5s` duration for LIVE, so dragging an unknown-duration LIVE stream cannot turn into a bogus `/mp3?start_s=0`.
- Native LIVE MP3 `pause` / `stalled` / `timeupdate` records resume seconds through monotonic LIVE progress helpers. A live `<audio>.currentTime` value that resets or is relative to the current MP3 stream no longer overwrites the absolute LIVE resume second.
- Loading spinner has fixed SVG transform origin to reduce wobble.
- Native `<audio>` seeking/seeked debug logs are quiet by default; use `debugSeek=1` only when diagnosing seek behavior.
- Group chat speaker avatars now use the current Tavo chat `chat.characters` list as a display-only role/avatar map. Matching is exact role name plus lowercase key fallback; it does not auto-add group characters to AI voice mappings or `roles_hint`.
- vLLM and fast6g now expose backend LLM parse progress in live job metrics: reuse check, waiting for LLM, normalizing, done/failed, elapsed seconds, model, endpoint host, timeout, max tokens, cached flag, and segment count. `/tts_dialogue_job_status/{cache_key}` refreshes `llm_elapsed_s` while the LLM call is still blocking.
- Tavo progress now translates LLM metrics into short frontend copy: `检查分段复用`, `等待 LLM 返回 Ns`, `整理分段结果`, and `分段已就绪，等待合成`; it no longer shows first-audio waiting copy while backend-owned LLM parsing is still running.
- When `复用 LLM 拆段` was requested but the parse cache missed, the frontend status says `复用未命中，等待 LLM 返回 Ns` instead of making it look like the reuse option was ignored.
- Saved tracks and LIVE pending jobs are message-scoped by `msgid` only: `indextts_tracks_<messageId>` and `indextts_pending_jobs_<messageId>`. One Tavo message is the large persistent player object; every generated audio card stores independent `trackIndex` / `trackId` / `cacheKey`. Message text is not a persistence key, so editing the body does not break history or LIVE recovery. Explicit LIVE exit deletes only the unfinished pending card; once the cache has landed, the card remains saved.
- Lazy card left play button now uses existing saved/pending history when present; when the current bubble has no history it opens runtime and triggers the music-note generation path for that bubble. Clicking the lazy card body still only opens the player/settings shell without creating a job.
- Explicit LIVE exit is now confirm-then-commit. The frontend first checks cache/status, then calls `DELETE /tts_dialogue_stream_job/<key>?preserve_completed=1`; if the API backend reports `preserved`/`done`/`saving`, the card is kept or promoted to saved history. Only a confirmed unfinished cancellation plus successful pending/history write removes the pending card. Cancellation or Tavo persistence failure keeps the card visible for retry.
- Same-key saved evidence wins over stale pending records, but a distinct active LIVE pending card under the same message is selected by default when the runtime opens. Snapshot open should land on the active LIVE page/card instead of requiring next/previous. Saved/history selection and loader snapshots start from 0 by default to avoid cross-card progress inheritance.
- Selecting a `live` / `pending` track with a `cacheKey` now checks `/tts_dialogue_job_status` and `/cache_audio` before playback. `status=done` / `serverState=done` are treated as saved evidence, pending storage is cleared after promotion, and `setTrackState(live/pending)` cannot demote a track that already has saved evidence.
- Native/System MediaSession controls on default LIVE MP3 now operate the current `<audio>` element directly. Pause/play/seek must not reconnect `/mp3?start_s=...`, mark the task as `pausedByUser`, clear streams, POST a new job, or DELETE the backend job.
- Saved/cache MP3 seek now remounts the saved `/cache_audio` source if the element still contains stale LIVE source/dataset, writes `audio.currentTime`, and immediately refreshes the highlighted lyric row. Saved-track audio errors caused by an old LIVE URL switch back to cache audio instead of failing the history card.
- Offline `blob:` playback rejection is treated as a WebView playback-source problem, not as a history-card failure. If `offline-blob audio.play()` returns `NotSupportedError` / "The operation is not supported", the saved card switches to its complete online `/cache_audio/<cacheKey>` source and remains normal saved playback.
- Saved/history seek while audio is already playing keeps the button/track state as playing, updates the real complete-audio `currentTime`, immediately syncs subtitles, and does not hand that seek position to next/previous cards.
- LIVE cache落盘 while native live MP3 is already playing keeps that current live `<audio>` source and continues progress/subtitle timing; it only marks the ordinary card saved and does not steal playback into `/cache_audio` or reset the player to 0.
- LIVE restored from pending storage ignores stale `lastElementSec`; only LIVE-owned resume fields (`liveResumeSec`, `lastLiveProgressSec`, `lastWebAudioSec`) can reconnect a non-zero LIVE offset. A dirty pending card with `lastElementSec=7` and no trusted LIVE resume opens at `00:00`, requests `/mp3` without `start_s=7`, and keeps lyrics on the first LIVE line.
- The lazy card/loader snapshot no longer displays or propagates saved/pending `lastElementSec`; unopened cards show clean zero progress until the selected card's own playback starts.

## Latest Validation

Passed on 2026-06-09:

```powershell
C:\Windows\Microsoft.NET\Framework64\v4.0.30319\csc.exe /nologo /target:winexe /platform:anycpu /optimize+ /out:LEON-Launcher.profile-smoke.exe /win32icon:launcher\leon-launcher.ico /r:System.dll /r:System.Core.dll /r:System.Drawing.dll /r:System.Windows.Forms.dll /r:System.Web.Extensions.dll /r:System.Management.dll launcher\LeonNativeLauncher.cs
$env:LEON_LAUNCHER_SMOKE_TEST='1'; $p = Start-Process -FilePath "D:\apiWorkSpace\leon_api\LEON-Launcher.profile-smoke.exe" -WorkingDirectory "D:\apiWorkSpace\leon_api" -Wait -PassThru; $p.ExitCode
node --check static\tavo.js
node --check static\tavo.runtime.js
node --check dev_workspace\dev_tools\test_tavo_widget_playwright.js
$manifest = Get-Content -Raw static\tavo.runtime.manifest.json | ConvertFrom-Json; $code = "(async function(){`n"; foreach ($m in $manifest.modules) { $code += (Get-Content -Raw (Join-Path static $m.file)) + "`n" }; $code += "`n})();"; $code | node --check -
node dev_workspace\dev_tools\test_tavo_widget_playwright.js
git diff --check
python C:\Users\Administrator\.codex\skills\.system\skill-creator\scripts\quick_validate.py C:\Users\Administrator\.codex\skills\leon-api
```

After `20260609-mp3-cache-v63`, launcher/frontend validation additionally asserts:

- launcher source compiles to a temporary smoke exe and exits with code `0` under `LEON_LAUNCHER_SMOKE_TEST=1`;
- root `LEON-Launcher.exe` was overwritten successfully and exits with code `0` under `LEON_LAUNCHER_SMOKE_TEST=1`;
- active profile tuning smoke fetches `/profiles/active` for both LIVE and DISK/generate, keeps the Tavo-selected `balanced` mode, uses `quality.presets.live.balanced` / `quality.presets.generate.balanced` request fields, and submits profile `llmPrompt` as `parse_system_prompt`.

Real lifecycle validation on 2026-06-09:

- Started `fast6g` on port `9880` with `LEON_ACTIVE_PROFILE_PATH=config/profiles/active.json`; `/health` returned `version=fast6g` and `llm_parse=true`.
- `/profiles/active` returned schema v2; `/voices` and `/static/tavo.js` were reachable.
- Direct OpenAI-compatible smoke against liangjie `grok-4.1` returned `200 OK`.
- Backend-owned AI dialogue job `bc3845c69e36ddedd6a4c828c677c463204357be` used `grok-4.1`, active profile `fast` LIVE params, and voice `400个火爆音色/短剧解说`; `llm_stage=done`, `segments_done=4/4`, `audio_duration_s=4.817`, `total_wall_s=13.564`, `rtf=2.816`.
- `/cache_audio/bc3845c69e36ddedd6a4c828c677c463204357be` returned `200 audio/mpeg`, `X-IndexTTS-Audio-Format: mp3`, `Content-Length: 78158`; cache JSON/MP3 and readable `by_role/用户/...` entries landed under `fast6g/outputs/cache`.

After `20260609-mp3-cache-v61`, Playwright smoke additionally asserts:

- LIVE cache-ready keeps the current `live-mp3` element/source while marking the ordinary card saved, and progress plus lyrics continue moving;
- snapshot open with saved + active pending under one message defaults to the active LIVE card (`2/2`) so explicit LIVE exit can run immediately;
- saved-card seek/play state only trusts the selected card's own complete-audio source, and previous/next saved selection starts from 0;
- dirty active LIVE pending with stale `lastElementSec=7` opens at `00:00`, plays `/mp3` without `start_s=7`, keeps the first LIVE lyric active, and the lazy card does not show inherited `00:07` progress before runtime opens;
- the custom generation-params smoke mocks `/profiles/active` so a running local profile cannot overwrite the test's custom quality settings.

`git diff --check` reported only Windows LF-to-CRLF warnings, not whitespace errors. `leon-api` skill validation returned `Skill is valid!`.

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

Additional documentation/skill validation:

```powershell
python C:\Users\Administrator\.codex\skills\.system\skill-creator\scripts\quick_validate.py C:\Users\Administrator\.codex\skills\leon-api
```

Result: `Skill is valid!`

After `20260608-mp3-cache-v47`, the same frontend/backend syntax checks and Playwright smoke passed again. The smoke asserts default LIVE / `mp3Live=1` use only `live-mp3` `<audio>.play()`, `nativeLive=1` uses only `live-segment` `<audio>.play()`, live-MP3-ended-before-cache keeps the waiting-for-final-cache state, and offline save writes `indextts-<cacheKey>.mp3` as `data:audio/mpeg;base64,...`.

After `20260608-mp3-cache-v48`, frontend syntax/manifest/smoke passed again. The smoke now additionally asserts:

- setting panel no longer shows the verbose `复用 LLM 拆段` / `保存离线音频` explanatory copy;
- LIVE progress exposes generated-complete count plus current playback segment, e.g. `已生成 1/3 段 · 正在播第 1/3 段`;
- ambiguous `AI x/y` or bare `合成 x/y` progress copy must not appear.

After `20260608-mp3-cache-v49`, frontend/backend syntax checks and Playwright smoke passed again. The smoke now additionally asserts:

- vLLM and fast6g expose fresh LLM metrics while backend-owned LLM parsing is blocking;
- empty lazy play generates the current bubble instead of opening an inert empty player.

After `20260608-mp3-cache-v50`, frontend syntax, manifest concat syntax, `git diff --check`, and Playwright smoke passed again. The smoke now additionally asserts:

- LIVE pending is saved only under the `msgid` pending key, with `trackIndex` / `trackId` identifying the audio card inside that message object;
- editing the message text before script remount does not break recovery of the same LIVE card/key;
- explicit unfinished LIVE exit clears only the pending card and keeps existing saved cards under the same message object.

After `20260608-mp3-cache-v51`, frontend syntax, manifest concat syntax, `git diff --check`, and Playwright smoke passed again. The smoke now additionally asserts:

- default MP3 and explicit WebAudio LIVE are not auto-suspended by `visibilitychange` / `pagehide`; the track stays playing, keeps the same job/key, does not set `pausedByUser` / `livePageSuspended`, and does not show “暂挂/点播放继续” copy;
- weak-network live MP3 ended-before-cache copy is cleared when live MP3 starts playing again or when the track becomes saved;
- saved/cache MP3 progress dragging keeps the saved `<audio src="/cache_audio/<key>">`, updates `audio.currentTime`, and does not reconnect `/tts_dialogue_stream_job/<key>/mp3?start_s=...`.

After `20260608-mp3-cache-v52`, frontend syntax, manifest concat syntax, and Playwright smoke passed again. The code now removes the old page-hide suspend helper path entirely: lifecycle events only record hidden time for diagnostics, automatic recoverable/interrupted LIVE states do not write `pausedByUser`, and non-user retryable states use `idle/可重试` instead of pretending to be user-paused.

After `20260608-mp3-cache-v53`, frontend code now preserves the native LIVE MP3 absolute resume second before system/player pause can reset the `<audio>` element. `trackResumeSec()` uses the best stored LIVE progress while paused, native `audio.pause` stores the current live offset as a guard, and MediaSession pause/play resumes the same key with `start_s` instead of reconnecting from 0. Playwright smoke covers system media pause at 6s, system media play, and explicit seekto on the same live MP3 key.

After `20260608-mp3-cache-v54`, frontend/backend syntax checks and Playwright smoke passed again. The smoke now additionally asserts explicit LIVE exit uses `preserve_completed=1`; preserved/done cache is converted to saved history and pending is cleared without `/cache` deletion; DELETE 500 keeps the LIVE pending card visible and retryable; remount defaults to saved history when saved and pending coexist; saved MP3 seek stays on `/cache_audio`; restored WebAudio LIVE pending reconnects with the persisted non-zero `start_s`.

After `20260608-mp3-cache-v55`, frontend syntax, manifest concat syntax, and Playwright smoke passed again. The smoke now additionally asserts unknown-duration LIVE MP3 keeps the seek slider disabled and never emits `/mp3?start_s=...`; stale `pending/live` records whose status is `done` are promoted to saved history, pending is cleared, playback uses `/cache_audio`, and the card no longer shows LIVE exit or LLM/generating copy.

After `20260608-mp3-cache-v56`, frontend syntax, manifest concat syntax, and Playwright smoke passed again. The smoke now additionally asserts MediaSession play/pause/seek controls keep using the same native `live-mp3` audio element without `/mp3?start_s=...`, and saved MP3 seek survives stale LIVE element pollution: final source is `/cache_audio`, `audio.currentTime=5`, seek value is `500`, highlighted lyric is `第二句。`, and no new LIVE request is emitted.

After `20260608-mp3-cache-v58`, frontend syntax, manifest concat syntax, `git diff --check`, and Playwright smoke passed again. The smoke now additionally asserts:

- offline playback reads Tavo files with `tavo.file.load(..., { encoding: "dataUrl" })` first and does not call `base64` when `dataUrl` succeeds;
- `offline-blob audio.play()` unsupported automatically switches to complete online saved `/cache_audio/<cacheKey>` instead of waiting for a second user click;
- saved MP3 seek keeps `audioKind=saved`, `audio.currentTime=5`, seek value `500`, highlighted lyric `第二句。`, and button/track state `playing`;
- clicking the play button after that seek pauses normally, and next/previous card selection starts from that card's own progress instead of inheriting the previous card's seek position.

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
- Playwright smoke confirms progress now lives as a transparent one-line `.idx-card` floating hint above the lyric panel; top controls read `LIVE -> page counter -> settings`; delete stays in the sticky `.idx-subtitle .idx-sub-toolbar`; toggling `LIVE`/`DISK` during playback keeps the active speaker title/avatar; group chat role `李瓶儿` uses the matching `chat.characters` avatar without adding that role to `voices` or `roles_hint`; default MP3 LIVE stays on `live-mp3` after page hide without frontend suspend; explicit WebAudio LIVE also ignores `visibilitychange` / `pagehide` auto-suspend and keeps the same key/job naturally playing; saved MP3 seek uses native `<audio>.currentTime` without LIVE reconnect; LIVE pending durable smoke creates a second card under the message-id object, survives message text edits/remount without a new POST, and clears only the unfinished pending card on explicit LIVE exit; offline playback smoke verifies a failed `tavo.file.url()` audio path retries through `tavo.file.load` as an `offline-blob` without hitting `/cache_audio`; card height remains `450px`.
- Boundary conclusion: the TTS service/API backend generated audible audio; the main remaining risk is frontend/mobile LIVE playback/output. Current default uses native MP3 live; explicit WebAudio still polls same-key PCM through queued output for diagnostics/regression.

Still needs real Tavo/mobile validation:

- settings save/reopen through real `tavo.set`;
- AI missing-role mapping error UI;
- LIVE first-audio/no-sound behavior on phone;
- restored pending LIVE resume after app re-entry;
- LIVE pending card recovery after lock-screen/WebView death before cache落盘;
- Default MP3 LIVE and explicit WebAudio LIVE background/app-switch should continue naturally when the host allows audio; frontend must not show “暂挂/点播放继续”, set `pausedByUser`, clear streams, or delete the job for lifecycle events.
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
- BUG-055: page-hide/visibility must not auto-suspend any LIVE playback; system/player pause is a user pause and must resume from the preserved LIVE second, not 0.
- BUG-057: explicit LIVE exit atomicity across API backend cancellation, cache落盘, and Tavo pending/history storage.
- BUG-058 / BUG-059 / BUG-060: saved seek/source ownership, active LIVE snapshot recovery, cache-ready LIVE handoff, and dirty `lastElementSec` isolation must stay separated from saved/history playback.
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
