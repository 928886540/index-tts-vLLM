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

## BUG-043: LIVE header progress text can fight the current voice label and subtitles can stay on the first generated segment

Status: fixed in code, needs real Tavo validation

Reported: 2026-06-07

Repro: Start LIVE streaming in Tavo. While audio is audible, the avatar-side status line can be overwritten by transient backend progress such as "正在合成音频" / "后端正在合成", fighting the current voice/role label. In the lyric panel, only the first generated sentence can be visible while later audio continues to play and the progress display appears stuck.

Evidence: User reported the avatar-right text was still showing generation notices over the current voice name, and that LIVE playback had sound but only the first lyric/progress appeared. Code audit found `setStatus()` accepted every transient progress writer. WebAudio progress also clamped the current second to `trackDurationHintSec(track)`, which during LIVE can equal only the first completed `segments_meta` duration. Backend status exposed only completed `segments_meta`, so the frontend had no planned later lyrics until each segment finished.

Hypothesis: confirmed.

Root cause: Header status and playback identity shared one text field with no transient-progress gate. LIVE progress treated partial status metadata as final duration. The status API did not expose full planned segment text after normal/AI parsing, so frontend subtitles could not render later planned lines before synthesis reached them.

Fix: `static/tavo.runtime.parts/40_mount_shell.js` now suppresses transient progress text in the avatar-side status and falls back to the stable current track label. `static/tavo.runtime.parts/42_playback_header.js`, `46_track_state.js`, and `62_events_boot.js` no longer clamp LIVE playback time to partial known duration and use a separate meter duration for live progress. `vllm/indextts2_api.py` and `fast6g/indextts2_api.py` now expose `segments_plan` and live `duration_s` through job status. `static/tavo.runtime.parts/52_subtitle_media.js` merges `segments_plan` with completed `segments_meta`, rendering planned later lyrics immediately and then calibrating timings as real metadata arrives.

Guard: During LIVE, header status must not contain transient phrases such as `等待音频`, `后端处理中`, `后端正在合成`, `正在连接音频`, or `网络缓冲中` while a track exists; it should show the current stable voice/role label instead. If status returns only the first completed `segments_meta` but also returns full `segments_plan`, the lyric panel must show later planned lines and WebAudio current time/progress must keep moving beyond the first segment duration.

## BUG-042: Restored LIVE playback can resume from the beginning instead of the last WebAudio second

Status: fixed in code, needs real Tavo validation

Reported: 2026-06-07 audit after user reported LIVE pause/resume can return to the start.

Repro: A LIVE card has already played or stalled at a non-zero WebAudio second, then the stream is paused/recovered or the Tavo message is re-entered from pending job storage. Press play again.

Evidence: Code audit found `playTrackViaWebAudio()` accepted `startOffsetSec` but fetched the raw `/tts_dialogue_stream_job/<cache_key>` URL instead of `?start_s=<sec>`. Pending job persistence also did not save `lastWebAudioSec`, and `restoreTrackFromPending()` restored live pending jobs as `state="pending"`, which prevented the default WebAudio LIVE path from being selected.

Hypothesis: confirmed.

Root cause: Resume seconds were tracked only in frontend UI state. They were not consistently included in the backend stream request or persisted through Tavo re-render/re-entry. Restored LIVE cards also lost their live state boundary.

Fix: `static/tavo.runtime.parts/46_track_state.js` now requests `liveStreamPlaybackUrlForTrack(track, startOffsetSec)` for WebAudio LIVE, so resumed requests include `start_s`. `static/tavo.runtime.parts/25_web_audio_stream.js` separates the playback timeline offset from local PCM skipping, avoiding double-skipping when the backend already starts the stream at `start_s`. `static/tavo.runtime.parts/48_track_history.js` persists/restores `lastWebAudioSec`, `lastElementSec`, and `lastStalledSec`, and restores live pending jobs as `state="live"` while keeping D-mode jobs pending/background.

Guard: Manual LIVE resume and restored pending LIVE resume must GET the same `/tts_dialogue_stream_job/<cache_key>?start_s=<last_second>` without another POST or DELETE. Playwright `liveResumeStartOffset` now simulates a pending LIVE card at `2.75s` and asserts the stream GET contains `start_s=2.750`.

## BUG-041: Tavo message body can prefer DOM chrome over clean API content

Status: fixed in code, needs real Tavo validation

Reported: 2026-06-07 audit while checking normal-mode cleaner regressions.

Repro: In the Tavo/test rendered message, `tavo.message.current().content` contains the actual story text, but the surrounding DOM also contains role name, assistant/message metadata, or test/control text. Generate normal/AI audio.

Evidence: Code audit found `currentMessageContext()` selected `domText` before `apiText` whenever the API content did not contain tags. In the mock page this could include `assistant message mock`; in real Tavo the same pattern can leak message chrome if DOM fallback sees sender/header text.

Hypothesis: confirmed.

Root cause: DOM fallback was intended for dirty AR/HTML cases, but it was prioritized over authoritative Tavo API message content even when the API text was already clean.

Fix: `static/tavo.runtime.parts/05_style_config.js` now prefers cleaned `tavo.message.current().content` whenever it contains useful text, and uses DOM text only as fallback.

Guard: Submitted job `body.text` must not include message chrome such as `assistant message mock`, page labels, role headers, or player UI. Playwright `normalExplicitDialogueMapping` now asserts API content wins over DOM chrome.

## BUG-040: Tavo normal mode can read tag/internal content as spoken text

Status: fixed in code, needs real Tavo validation

Reported: 2026-06-07

Repro: In Tavo normal mode, generate from a rendered message that contains AR/HTML/script/style/player markup or other tagged content. The frontend-cleaned `text` can include text from tags or injected UI instead of only the visible story/message body.

Evidence: User reported "普通模式的js清洗正文不太对，把很多标签里的东西读了出来." Code evidence: `currentMessageContext()` prefers `tavo.message.current().content` when available and only strips `<script>` blocks plus the script marker before submitting `messageText`. DOM fallback removes only `.idx-tts`, `.idx-card`, `.idx-panel`, `.idx-global-gear`, and `script`, so style/template/hidden AR/player fragments can leak.

Hypothesis: confirmed.

Root cause: The frontend mixed raw Tavo message content and rendered DOM text without a shared sanitizer. Raw content can contain HTML/AR markup, while cloned DOM text can include hidden/injected controls unless known noisy nodes are removed first. The backend normal splitter had a weaker sanitizer, so even a future frontend miss could leak tag text into generated audio.

Fix: `static/tavo.runtime.parts/05_style_config.js` now runs raw/API content and DOM fallback through a shared TTS cleaner: multi-pass HTML/entity decode, tag block removal including contents, residual tag cleanup, Tavo script marker removal, injected UI/control node removal, emoji/symbol removal, and visible-text fallback. `vllm/indextts2_api.py` and `fast6g/indextts2_api.py` apply the same stricter normal-mode body sanitizer before deterministic quote splitting. Normal parse cache versions were bumped to `20260607-normal-v2` / `20260607-fast6g-normal-v2`.

Guard: Spoken `text` submitted to `/tts_dialogue_stream_job` in normal mode must not contain `<script>`, `<style>`, `<template>`, injected player UI, hidden AR blocks, raw HTML tags, emoji, or button/control labels from the Tavo player. Playwright `normalExplicitDialogueMapping` now submits a dirty message containing `<think>`, `<div>`, encoded `<style>`, and emoji, and asserts the request body keeps only readable story/dialogue text.

## BUG-039: Normal mode voice mapping should be narrator/dialogue with dialogue blank inheriting narrator

Status: fixed in code, needs real Tavo validation

Reported: 2026-06-07

Repro: Open normal mode settings. The UI currently exposes `默认/旁白/对话`, and code fills missing `对白` with the default voice. This makes dialogue always explicitly inherited and also keeps a redundant default row.

Evidence: User clarified normal mode should have only `旁白` and `对白`; `对白` should inherit only when it is not written/configured. Code evidence: `readFields()` writes `旁白` and `对白` into `cfg.roleVoiceList` when `cfg.defaultVoice` exists, and `normalModeVoicesMap()` uses default fallback for both.

Hypothesis: confirmed.

Root cause: Normal mode used the old `defaultVoice` row as a visible role and persisted implicit fallback into `cfg.roleVoiceList`. That blurred "blank inherits" with "explicitly mapped", and created an unnecessary third/default slot. Dialogue aliases such as `对白` / `对话` / `台词` / `dialogue` were also not handled as one canonical role end to end, so explicit user configuration could be lost or overwritten by fallback/default data.

Fix: Normal-mode UI now shows only two rows: `旁白` and `对白`. `旁白` writes `cfg.defaultVoice`; blank `对白` is not submitted and inherits narrator/default on the backend. When `对白` is explicitly configured, the frontend submits `对白`, `对话`, `台词`, and `dialogue` aliases with the same user-selected voice. Frontend role normalization canonicalizes dialogue aliases to `对白`, AI role mapping filters normal-only dialogue rows, and old positional fallback no longer copies a dialogue voice into the `用户` slot. Both backends normalize dialogue aliases to `对白`; duplicate/empty aliases can no longer overwrite a non-empty explicit mapping.

Guard: Normal mode settings should show fixed `旁白` and `对白` rows only. `旁白` is the default voice. `对白` should be omitted from the submitted/stored voice map unless the user explicitly chooses a separate voice; when omitted, backend fallback inherits `旁白/default`. If the user explicitly configures any dialogue alias to any voice name, request `voices` must carry that voice under all dialogue aliases and the backend must resolve the generated `对白` segment to that path. Playwright now tests a mixed legacy list with empty `dialogue`, non-empty `对话`, and empty `对白` to prove empty aliases do not override the explicit voice.

## BUG-038: LIVE stream recovery can exhaust into saved fallback and block manual resume

Status: fixed in code, needs real Tavo validation

Reported: 2026-06-07

Repro: In LIVE mode, if WebAudio stream recovery fails several times, the frontend enters a saved-cache fallback path and can keep the card loading/waiting instead of letting the user pause and request the same stream again.

Evidence: User clarified the product rule: stream failures must not remove manual control. The user must be able to pause/recover at any time. Only explicit live exit should stop/delete the task/audio. Auto落盘 continues as backend behavior, but it should not replace the user's ability to reconnect the same `cache_key`.

Hypothesis: confirmed. Code evidence: `playTrackViaWebAudio()` has a fixed `maxRecoveryAttempts`; after exhaustion it calls `waitForSameJobSavedFallback()` / `waitForSavedLiveTrack()`, sets `playSavedWhenReady`, and waits for `/cache_audio`.

Root cause: Recovery treated "same-job stream currently unstable" as "give up realtime and wait for saved audio." That is a useful safety fallback, but it violates the product's LIVE-first control model because user play can become a passive wait rather than a same-key stream reconnect.

Fix: `static/tavo.runtime.parts/46_track_state.js` now routes exhausted same-job WebAudio recovery into `markLiveStreamResumable()` instead of forcing saved-cache autoplay. It stops the current WebAudio reader, preserves resume seconds, returns the play button to idle, keeps background cache polling alive, and leaves the same `cache_key` ready for manual replay. Manual play reconnects `GET /tts_dialogue_stream_job/<same_cache_key>` without a second `POST` and without `DELETE`.

Guard: LIVE failures may stop the current WebAudio reader and keep polling cache in the background, but the play button must return to an idle/resumable state and reconnect `GET /tts_dialogue_stream_job/<same_cache_key>?start_s=...` on demand. No extra `POST` is allowed. No saved-cache autoplay is forced by recovery exhaustion. No `DELETE` is allowed unless the user presses live exit/delete. Playwright `liveResumableAfterFailures` covers this behavior.

## BUG-037: Generation settings need preset/custom parameter UI

Status: fixed in code, needs real Tavo validation

Reported: 2026-06-07

Repro: Tavo settings only expose a coarse quality tier and a few hidden/default sampling values, even though the backend already accepts direct generation overrides such as `diffusion_steps`, `prompt_audio_seconds`, `segment_tokens`, `first_tokens`, and `s2mel_cfg_rate`.

Evidence: User asked to keep selectable档位 but also expose adjustable custom parameters. Code evidence: frontend calls `generationQualityOverrides(cfg.qualityMode)` and submits hard-coded preset overrides; backend request models already accept the same fields.

Hypothesis: confirmed.

Root cause: The frontend collapsed generation controls to preset-only UI while the backend already supports direct numeric override values.

Fix: Settings now include a `自定义` quality mode and an expandable custom parameter panel. The frontend persists and submits `diffusion_steps`, `prompt_audio_seconds`, `segment_tokens`, `first_tokens`, `s2mel_cfg_rate`, `top_p`, `top_k`, `temperature`, `repetition_penalty`, `emo_alpha`, `speed_factor`, and `subtitleLeadSec` where relevant, while presets keep the existing behavior. No backend logic change was needed beyond using the request fields already accepted by both backends.

Guard: Settings should allow preset selection or `自定义`. Presets should preserve existing behavior. `自定义` should submit the user's numeric values for diffusion steps, prompt audio seconds, segment tokens, first streaming tokens, S2Mel CFG, top-p/top-k/temperature/repetition penalty, emotion strength, and speed without backend changes. Playwright `normalExplicitDialogueMapping` asserts representative custom values are present in the job body.

## BUG-035: Tavo first player open feels stuck while runtime fragments load

Status: fixed in code, needs real Tavo validation

Reported: 2026-06-06

Repro: In Tavo, tap the lazy player card for the first time. The lightweight lazy card reacts, but the full player does not become visible until `tavo.runtime.js`, the manifest, and 16 runtime fragments are fetched and executed.

Evidence: User clarified the desired behavior: the total loading time may stay the same, but the player should appear first so the remaining loading work is not visually perceived as a blank/stuck click.

Hypothesis: confirmed. `static/tavo.js` only renders a small lazy card before user interaction. `mountRuntime()` waits for the full runtime promise before hiding the lazy card and showing the real `.idx-card`, so first-open network fan-out becomes visible UI jank.

Root cause: The loader had only two visible states: compact lazy card and fully mounted runtime player. The full player DOM was created only after `tavo.runtime.js`, the manifest, and all runtime fragments finished loading/executing. On Tavo WebView/LAN/tunnel first load, that makes the click feel stalled even though network loading is progressing.

Fix: `static/tavo.js` now renders a full-size loader-owned player shell immediately on first click. The shell mirrors the real player layout, shows visible loading status, keeps the user-gesture AudioContext priming path, and queues shell button clicks (`play`, `add`, settings, prev/next/delete, L/D) until the runtime finishes mounting, then forwards the original action to the real runtime button. It does not request `/voices`, create jobs, or change LIVE stream semantics. Cache busting was bumped to `20260606-live-audio-v11` for the first shell pass, then to `20260606-live-audio-v12` for the visual cleanup.

Guard: The initial page render must still avoid loading runtime, `/voices`, or TTS jobs before user interaction. On first user click, a full-size player shell should appear immediately and queue clicks such as play/settings until the real runtime finishes mounting. This must not change LIVE generation semantics or create extra `/tts_dialogue_stream_job` requests. Playwright now asserts the immediate shell appears synchronously after a lazy click and that it still has `voices=0` and `jobs=0` before runtime takeover.

## BUG-036: Tavo settings/picker dialogs show double outer lines and loader shell exposes fake seek bar

Status: fixed in code, needs real Tavo validation

Reported: 2026-06-06

Repro: Open Tavo voice settings or the voice picker on mobile. The outer dialog surface shows two visible border lines instead of one. On first player open, the loader shell briefly shows a seek/progress bar even though no real audio progress exists yet, and the default cover shows a text placeholder instead of the narrator avatar.

Evidence: User screenshots show `语音设置` dialog with a second outer focus ring around the panel border. The loader-shell screenshot shows a visible horizontal progress/seek track while status says `播放器打开中...`, and the cover square contains `语`.

Hypothesis: confirmed. The dialog CSS has both a normal border and a `:focus-visible` outline with offset, creating the double-line look. The loader shell renders a disabled `.idx-seek` input copied from the real player, exposing a fake progress bar before runtime takeover. Loader cover uses a text placeholder because the loader does not yet apply the runtime narrator avatar helper.

Root cause: Two visual states leaked implementation details. First, native dialog focus styling was explicitly reintroduced through `.idx-panel:focus-visible,.idx-picker:focus-visible`, so mobile rendered a second outer ring outside the dialog border. Second, the loader shell reused the real player seek DOM before any audio existed, so global `.idx-seek` styling made a fake progress bar visible during first-open runtime loading.

Fix: `static/tavo.ui.skin.default.css` and the fallback CSS in `static/tavo.runtime.parts/05_style_config.js` now force the dialog host outline off for focus/focus-visible, leaving only the panel's own border. `static/tavo.js` removes the loader-shell seek DOM and replaces it with a neutral spacer, and the loader cover uses `static/tavo.assets/narrator.png` as the default avatar. Cache busting is bumped to `20260606-live-audio-v12`.

Guard: Settings and voice-picker top-layer dialogs should have exactly one outer panel border; the focused dialog host should not draw an additional outline/ring. Loader shell should not render any visible seek/progress bar before runtime takeover, and its default cover should use `static/tavo.assets/narrator.png` instead of a text placeholder. Playwright now asserts no loader `.idx-seek`, narrator cover background, and `outline-style:none` / `outline-width:0px` for both settings and picker dialogs.

## BUG-034: Tavo LIVE playback lifecycle can overwrite lyrics, resume from start, and double-play after cache lands

Status: fixed in code, needs real Tavo validation

Reported: 2026-06-06

Repro: In Tavo LIVE playback, transient notices such as `等待音频` and backend LLM parsing/progress text compete for the lyric panel. During LIVE playback, subtitles can visibly lag or feel sticky. If live playback buffers and the user pauses/resumes, playback can restart from the beginning instead of the current position. When the completed cache lands, the native audio path can start while the previous WebAudio stream is still audible, creating two overlapping voices, one of which cannot be stopped from the visible controls.

Evidence: User report after `20260606-live-audio-v8` real Tavo testing: streaming can now play, but lifecycle glitches remain in subtitle/status rendering, pause/resume, and WebAudio-to-cache handoff.

Regression evidence, 2026-06-06 after `20260606-live-audio-v9`: `后端处理中 4s` can still remain in the lyric panel, header/status text under the speaker name is visually fighting, WebAudio recovery can fall back to completed cache too early so the experience looks like落盘 instead of LIVE, and after cache lands the play button can keep spinning until the user taps once more. User clarified the product constraint:落盘兜底 is allowed and must work, but LIVE must still try the same backend buffer first and should not silently skip audible streaming before the cache file lands.

Hypothesis: The frontend has too many writers to the same subtitle panel: job-status polling, WebAudio waiting/buffering state, and LLM progress all call `showTrackNotice()`. Pause/resume depends on `trackResumeSec()`, but `stopWebAudioPlayback()` can lose the last WebAudio time or later state changes can reset UI to `00:00`. Cache promotion can call `attachCacheAudio(... forceElement/autoplay ...)` while an existing WebAudio controller/source is still alive or still represented by stale `track.webAudioPlaying`, allowing native `<audio>` and WebAudio to overlap.

Root cause: Three frontend lifecycle paths were overlapping. First, transient progress/status writers for backend LLM/TTS state, WebAudio wait/buffer state, and cache polling all wrote through the same subtitle notice path, so they could replace the lyric panel. Second, WebAudio playback had no explicit owning track, so pause/stop/handoff could read the wrong track or lose the last WebAudio time. Third, cache promotion could autoplay the native `<audio>` path without first stopping the existing WebAudio controller/source and preserving its current second, which allowed double audio and restart-from-zero handoff. The v9 regression kept one more bad edge: LIVE generation performed a pre-live status refresh before opening the stream, same-job recovery marked `playSavedWhenReady` too early, and cache promotion computed autoplay after `setTrackState(saved)` had already reset `loading/buffering` to `idle`, so a completed cache could sit there spinning until the user tapped again.

Fix: `static/tavo.runtime.parts/52_subtitle_media.js` now treats waiting/connecting/buffering/backend-progress notices as transient status only, including `后端处理中 Ns`, deduplicates subtitle notices, polls `segments_meta` faster, and ticks subtitles at `100ms`. `static/tavo.runtime.parts/60_generate_flow.js` no longer blocks LIVE startup on a pre-live status refresh; status metadata refresh now runs in the background while WebAudio immediately opens `GET /tts_dialogue_stream_job/<cache_key>`. `static/tavo.runtime.parts/46_track_state.js` keeps same-job recovery on the original `cache_key`, increases recovery attempts, and only sets `playSavedWhenReady` when entering the actual saved-cache fallback. `static/tavo.runtime.parts/48_track_history.js` decides fallback autoplay before saved-state reset, stops WebAudio before forced/autoplay native cache handoff, seeks the native element to the preserved second, and settles `audio.play()` success/reject so loading cannot spin forever. `static/tavo.runtime.parts/44_element_audio.js` also clears loading when native playback is rejected by the WebView. `dev_workspace/dev_tools/test_tavo_widget_playwright.js` now asserts LIVE recovery reuses one job, transient progress text does not appear in the lyric panel, and exhausted same-key stream recovery auto-plays `/cache_audio/<cache_key>` without leaving the play button loading.

Guard: Transient generation/progress status should update the compact status line, not keep replacing the lyric panel. Once lyric rows exist, only terminal/errors/delete/cancel messages should interrupt them. LIVE pause/resume must preserve the last WebAudio playback time and reconnect with `start_s`/`startOffsetSec`, not restart from zero. LIVE must open the same backend buffer before falling back to saved cache; recovery must never send another `POST /tts_dialogue_stream_job`. Before any saved/cache native `<audio>` autoplay or forced element handoff, all WebAudio sources, timers, subtitles, and stale WebAudio state for that track must be stopped and cleared. Cache landing must not create two audible playback paths, and cache fallback must either play automatically or leave an idle, tappable state, never a permanent spinner.

## BUG-033: Tavo LIVE WebAudio can schedule PCM but remain silent

Status: fixed in code, needs real Tavo validation

Reported: 2026-06-06

Repro: In Tavo JavaScript console, start an AI LIVE generation. The console shows `live track 使用 Web Audio API 真流式`, `AudioContext state=running`, `WAV header parsed`, and `Web Audio 首块音频开始播放`, followed by early `Web Audio buffering count=1`, but the phone has no audible sound.

Evidence: User screenshots show the frontend reached the WebAudio path and parsed PCM from `/tts_dialogue_stream_job/<cache_key>`. This proves the backend live buffer endpoint is producing data. The failed path is frontend playback/output in the Tavo WebView, where `AudioBufferSource.start()` was treated as audible playback.

Hypothesis: The runtime was not consistently reusing the AudioContext unlocked by the initial user gesture, and the WebAudio path marked playback as successful as soon as a buffer was scheduled. Early underrun/silent output had no same-job reconnect compensation.

Root cause: The WebAudio live path treated a scheduled `AudioBufferSource` plus `AudioContext.state === "running"` as equivalent to audible/stable playback. In Tavo WebView that is not enough: the output chain may still be blocked or the first scheduled chunk can underrun immediately. Recovery also lacked a same-job reconnect path, so a silent/stalled live card could stay in fake playback or fall through to confusing pause/error states.

Fix: `static/tavo.runtime.parts/20_generation_params.js` reuses the loader-created user-gesture `AudioContext` and keeps the WebAudio output chain warm. `25_web_audio_stream.js` now supports configurable prebuffer/flush windows and emits `stable_playing` after the first scheduled buffer survives the early window. `46_track_state.js` now treats early `buffering`, `audio_suspended`, `interrupted`, and network stream errors as same-job recovery triggers: it reconnects `GET /tts_dialogue_stream_job/<cache_key>` with a larger prebuffer and never sends a second generation `POST`. After recovery attempts are exhausted, it waits for `/cache_audio/<cache_key>` as the last audible fallback. Playwright smoke now asserts one `POST`, repeated same-key live `GET`, and no re-POST during recovery.

Guard: LIVE mode must keep the backend buffer architecture: `POST /tts_dialogue_stream_job` creates a `LIVE_JOBS` task, backend appends PCM to the cache-key buffer, and frontend `GET /tts_dialogue_stream_job/<cache_key>` reads that buffer. The frontend must not start a second generation for playback recovery. If early WebAudio playback stalls or is likely silent, it should reconnect the same stream/cache key with a larger prebuffer and preserve subtitles/status. Only after repeated same-job stream recovery fails may it wait for `/cache_audio/<cache_key>` as a last-resort audible fallback.

## BUG-031: Launcher UI is overbuilt, noisy, and auto-checks environment on open

Status: open, fixing

Reported: 2026-06-06

Repro: Open `LEON-Launcher.exe`. The launcher immediately runs environment detection, the header/banner overlaps visually, log pages auto-scroll/jump with folded text, and the sidebar exposes too many pages/actions including a separate `停止服务` button.

Evidence: User screenshots show the banner/header text competing with the image and progress bar, log text clipped/folded, and a crowded sidebar. User asked to remove the noisy feature pages, stop automatic environment detection on open, remove the dedicated stop-service page, and keep only basic start/stop, environment detection, and one-click repair.

Additional evidence from follow-up screenshots: the launcher showed both left sidebar navigation and a top horizontal tab strip at the same time; the tab strip covered/clipped page content. The green progress bar in the top-right header was visually distracting and should live only inside the environment detection page. The environment check table grid lines were too harsh. One-click repair showed a completion popup even when the environment was already fine, and some wording implied unrelated “backend/background service” behavior. Later screenshots showed stacked logs looked like clipped CMD windows, left nav had no active state, repeated content titles wasted space, the compact version/ratio controls were too tall/noisy, and one intermediate layout pushed the primary start button below the visible window.

Hypothesis: confirmed.

Root cause: The launcher accumulated diagnostics, logs, voice testing, WebUI, and Tavo instructions into one WinForms shell. Opening the form also triggered the full environment check and extra refresh actions, making the launcher feel slow and visually unstable. The simplified rewrite still had UI-flow mistakes: `环境检测` nav directly called the check routine, the primary start button was positioned with fragile raw height math instead of a fixed bottom container, and `一键修复` re-ran its own environment probes instead of using the visible `开始检测` result.

Fix: `launcher/LEON-Launcher.ps1` now uses the latest simplified form definition: full-width header; left nav with active colors for `首页` and `环境检测`; one large log viewer controlled by four readable dark tab-buttons `启动器` / `服务日志` / `服务启动` / `诊断日志`; no repeated content-page titles; hidden header status instead of a green repeated API URL; fixed bottom-left start/stop button; compact one-line segmented `vLLM` / `6G` switch directly above the button; centered dark `0.15` ratio input visible only for `vLLM`; and environment checks preloaded as `待检测` rows. Clicking `环境检测` only opens the page; the page-level `开始检测` button runs `Run-EnvironmentCheck`, and `一键修复` is a second page-level action beside it. `开始检测` now stores structured result state, and `一键修复` only repairs from that latest completed result; if the user has not run detection yet, it only asks the user to click `开始检测` first.

Guard: Opening the launcher must not run `Run-EnvironmentCheck` automatically. The visible UI should only expose service start/stop, service version/vLLM ratio, environment detection, and one-click repair. Service stop should be controlled by the main service button when the API is already running, not by a separate sidebar page/button. The version selector should be a compact styled two-button switch, not a white dropdown. The short ratio value should be centered and explain itself through hover tooltip. The header should use a clean static layout without the avatar banner overlap, and no live log page should auto-scroll/jump. The UI must not show both a left navigation menu and a top tab strip. The log selector must show readable labels and selected state; use `启动器` / `服务日志` / `服务启动` / `诊断日志`, and do not call stderr `错误输出`. The green progress bar must not appear in the header; it belongs only on the environment page. Environment results should not use harsh grid lines. One-click repair should not show a popup or imply repair work when there is nothing to fix, and it belongs inside `环境检测` rather than as a duplicate sidebar page. The left-bottom start/stop button must remain visible at default and minimum window sizes. Sidebar `环境检测` must not execute checks directly; only `开始检测` may run them. `一键修复` must use the latest completed `开始检测` result; without that result it must not clear rows, rerun probes, or silently start detection.

## BUG-032: vLLM ratio must be visible and user-editable

Status: open, fixing

Reported: 2026-06-06

Repro: Start vLLM through the launcher and call `/health`. The response identifies `version=vllm` but does not show which `gpu_memory_utilization` ratio is currently active. The launcher also exposes the ratio as a fixed dropdown instead of a direct editable value.

Evidence: User requested `/health` to print the current ratio parameter and asked the launcher ratio control to be directly hand-editable with default `0.15`.

Hypothesis: confirmed.

Root cause: The ratio was passed into startup but not surfaced in `/health`. Defaults also remained inconsistent: some paths still fell back to `0.18`, while recent runtime benchmarks favored `0.15` as the speed preset and `0.11` as conservative.

Fix: pending.

Guard: vLLM `/health` should include `vllm_gpu_memory_utilization` and `vllm_enforce_eager`. The launcher ratio control should accept direct typed numeric input, default to `0.15`, and pass the same value through `INDEXTTS_VLLM_GPU_MEMORY_UTILIZATION`. Low-level restart defaults should also be `0.15` unless explicitly overridden.

## BUG-030: Tavo settings leaks normal dialogue mapping into AI and D mode can lag after cache lands

Status: open, fixing

Reported: 2026-06-06

Repro: Open Tavo settings. The user wants `AI模式` and `普通模式` positions swapped. AI mode can show an extra `对白` voice mapping even though `对白/对话` belongs to normal deterministic mode. In `D` mode, generated audio can already be written to disk while the card/page does not refresh promptly.

Evidence: User report with screenshots. Code evidence: `40_mount_shell.js` renders mode buttons as `普通模式` then `AI模式`; `readFields()` can add `对白` into `cfg.roleVoiceList` when normal mode has a default voice, and that same role list is reused by AI mode; `pollCacheUpgrade()` only checks `/cache_audio` with `HEAD` as a stale-status fallback for LIVE tracks, not for `generate` / D-mode tracks.

Hypothesis: confirmed.

Root cause: Normal-mode voice rows and AI role mapping share `cfg.roleVoiceList`, so normal-only dialogue aliases can leak into AI configuration. D-mode completion relies on job status reaching `done`; if cache audio is already readable but status lags, the UI waits longer than necessary.

Fix: pending.

Guard: Settings should render `AI模式` before `普通模式` as requested. AI role mapping must show only AI roles such as `旁白`/`用户`/current character and must not show `对白`/`对话` by default. Normal mode submits `voices.default` / `voices.旁白`; it submits dialogue aliases only when `对白` is explicitly configured. D-mode polling should promote a card to saved history when `/cache_audio/{cache_key}` is readable, even if `job_status` lags briefly.

## BUG-029: benchmark helper incorrectly owns launcher startup path

Status: fixed in benchmark helper, needs one guarded synthesis run

Reported: 2026-06-06

Repro: After the user can start `vllm` successfully through `LEON-Launcher.exe`, run the benchmark helper for a short retest. The helper still tries to restart the service itself through `vllm/tools/restart_indextts_api.ps1`, and Codex also tried wrapping it through `Start-Process` / redirected logs. Several attempts exited quickly with empty outer logs and no GPU activity, while direct launcher startup worked.

Evidence: Current `/health` from the launcher-started API returns `version=vllm`, and GPU memory is about `9.6 GB`, proving the backend can run. The failed helper attempts wrote empty `dev_workspace/benchmarks/retest_6f8b_ratio015_*.out.log/.err.log` files and did not start a listener. A direct short foreground probe of `restart_indextts_api.ps1` did execute and reached `>> constructing GPT wrapper`, so the backend/script was not generally broken; the benchmark wrapper/startup ownership was the wrong layer.

Hypothesis: confirmed.

Root cause: The benchmark helper mixed two responsibilities: benchmarking an already-started local API and owning service restart / GPU-ratio selection. That conflicts with the project startup rule that user-facing startup/restart goes through the root launcher. It also made retests fragile because a benchmark failure could be caused by wrapper startup behavior instead of TTS inference.

Fix: `dev_workspace/dev_tools/benchmark_vllm_gpu_ratios.py` now defaults to current-service mode. It validates the already-running API with `/health`, requires `version=vllm` or `engine=vllm`, resolves the expected voices, records API PID/GPU snapshot, and only restarts the service when `--restart-service` is passed explicitly. Current-service mode ignores extra ratio labels instead of treating them as restart targets. The helper also adds configurable warmup/job wall-time guards and cancels the active job on timeout or GPU guard trips.

Guard: Benchmark helpers must support a "use current service" mode that does not restart or kill the API. Any helper mode that changes vLLM GPU ratio must be explicit, named as a restart mode, and must not be used when the user has started the service through the launcher for an ad hoc retest. Validate with `--skip-warmup --runs 0` before submitting a real synthesis job.

## BUG-028: vLLM benchmark reused old healthy API after failed restart and did not fail fast

Status: fixed in benchmark helper, needs one guarded re-run before trusting new numbers

Reported: 2026-06-06

Repro: Run `dev_workspace/dev_tools/benchmark_vllm_gpu_ratios.py --ratios 0.15 --runs 3` while an old vLLM API is still healthy on `9880`. The restart attempt can fail to initialize a new vLLM worker because the old API/worker still holds GPU memory, but `/health` returns OK from the old process. The benchmark then continues with the stale instance.

Evidence: During the bad 0.15 re-test, the new worker log `logs/vllm/api_restart_stable_20260606_173701_try1.err` contained `ValueError: No available memory for the cache blocks`. At the same time `/health` still returned `version=vllm` from old PID `14140`, so the benchmark treated startup as successful. Warmup pushed GPU memory to `11725 MiB`; run 1 reached `RTF 2.17`; run 2 reached `RTF 7.398` with `s2mel_s=382.939` and `bigvgan_s=61.188`; run 3 was cancelled after 3 segments. After manually stopping old API PID `14140` and worker PID `2428`, GPU memory dropped to about `648 MiB`. A clean restart then started PID `23284` / worker `13584` at about `8048 MiB` idle.

Hypothesis: confirmed.

Root cause: The benchmark helper trusted `/health` alone after restart. That is not sufficient when an old healthy API is still listening while a new worker fails during startup. The helper also lacked fail-fast guards for abnormal warmup memory, abnormal first-run RTF, and near-full VRAM during polling.

Fix: `dev_workspace/dev_tools/benchmark_vllm_gpu_ratios.py` now validates that the listening API PID changes across restart, scans fresh vLLM startup stderr logs for fatal KV-cache / memory-profiling / EngineCore errors, and fails before running long jobs when idle or warmup VRAM exceeds guard thresholds. During a job it cancels and stops the benchmark when running VRAM crosses the guard threshold; after a completed job it stops remaining runs when RTF exceeds the guard threshold.

Guard: Performance benchmarks must not rely on `/health` alone. Record old/new API PID, worker PID, idle VRAM, warmup VRAM, and fatal startup log scan before long synthesis. If warmup VRAM is near full or a first run exceeds the RTF guard, cancel the active job and stop the whole benchmark instead of continuing remaining runs.

## BUG-026: Tavo settings reports saved but reopening shows old config on fast6g

Status: open, user-reported, not investigated yet

Reported: 2026-06-06

Repro: User is using the 6G/`fast6g` version in Tavo. Change settings and save. The UI reports save success, but reopening settings shows the previous/original configuration.

Evidence: User report only so far. No local reproduction or logs captured yet.

Hypothesis: Pending. Likely candidates are Tavo storage scope/key mismatch, settings save writing to one message/chat scope while settings load reads another, capability detection for `fast6g` overwriting saved AI/normal/Qwen-related config on remount, or a stale lazy/runtime config snapshot after save.

Root cause: pending.

Fix: pending. User explicitly asked to record this and fix later.

Guard: After fixing, verify on `fast6g` that changing settings, saving, closing/reopening the panel, remounting the message, and re-entering the chat all show the same saved values. The success toast must only appear after `tavo.set` completes and the in-memory config is updated.

## BUG-027: fast6g style reference paths from old cache can miss local 声腔 files

Status: fixed in code, needs runtime re-validation after `moan_soft` removal

Reported: 2026-06-06

Repro: Reuse segments from `vllm/outputs/cache/by_role/甘婷婷/20260606-013108-395_263429152dd8dcd2b2715e80672dbdd93ee9a406.json` in `fast6g`, with style refs such as `prompts/library/声腔/moan_soft.wav`, `scream_peak`, and `laugh_soft`.

Evidence: The old JSON records `uses_style_audio=true` for `moan_soft`, `scream_peak`, and `laugh_soft`, but local search found `moan_soft.MP3` and Chinese style-slice files such as `尖叫-AD学姐.MP3` / `轻笑-AD学姐.MP3`. A fresh `fast6g` run could report `uses_style_audio=false` for `scream_peak`, and the earlier `moan_soft` test failed with `Calculated padded input size per channel: (0)`. Local decode showed `moan_soft.MP3` reports `1.164s` through `soundfile`, but `librosa` only decoded `0.017s` of silence with MP3 header errors.

Hypothesis: confirmed.

Root cause: Two issues overlapped. First, the style resolver trusted explicit stale refs from cache, so `prompts/library/声腔/moan_soft.wav` could hit a bad local `moan_soft.MP3` or a missing renamed file. Second, English style ids such as `scream_peak` and `laugh_soft` pointed at missing English filenames even though the available local style slices are Chinese names.

Fix: `fast6g/indextts2_api.py` and `vllm/indextts2_api.py` now map only available English style ids to local Chinese style slices. `moan_soft` was removed from `STYLE_VOICE_MAP`, so the AI style catalog no longer主动推荐它。`声腔/`素材仍可作为普通音色配置出现和手动选择。`scream_peak` maps to `声腔/尖叫-AD学姐`; `laugh_soft` maps to `声腔/轻笑-AD学姐`. `vllm/indextts/voice_library.py` and the fast6g resolver also strip `prompts/library` / `library` prefixes and stale extensions when matching local voice references.

Guard: Do not reintroduce `moan_soft` into `STYLE_VOICE_MAP` unless a real, decodable local asset is restored and validated. `/voices` may still list `声腔/`素材 because the user may use them as manual voice configuration. Re-run the user's 甘婷婷 sample through `fast6g` only for supported styles such as `scream_peak` and `laugh_soft`; completed metadata should show `uses_style_audio=true` on styled segments, and cache audio should be written under `fast6g/outputs/cache/by_role/甘婷婷/`. Previous `moan_soft`/substitute output must not be used as quality or multi-voice evidence.

## BUG-025: Tavo LIVE WebAudio clock can advance without audible audio or subtitles

Status: fixed in code, needs real Tavo validation

Reported: 2026-06-06

Repro: In Tavo mobile JavaScript console, generate an AI/LIVE dialogue. The card starts a live WebAudio path, the progress bar appears to move, but there is no audible sound and lyrics/subtitles do not render. The visible `等待首段音频` and `正在合成` notices overlap/cramp each other. Reconnect stays at waiting for backend audio.

Evidence: User screenshot shows `selectTrack idx=0 state=pending urlSource=cacheUrl src=""`, then `新建占位卡片 mode=ai playback=live`, `提交 dialogue job: parse_mode=ai playback=live`, `cached=false live=true`, `live track 使用 Web Audio API 真流式`, `AudioContext state=running sr=48000`, `WAV header parsed: sr=22050 ch=1 bits=16`, `Web Audio 播放时钟已启动`, followed only by repeated `Web Audio buffering count=1/2`. No subtitle/lyrics lines appear after the WAV header parse. User also reported that manually reconnecting the live stream can show `音频已排队`; subtitles/progress appear to move, but there is still no audible playback.

Hypothesis: The frontend starts the live playback clock and UI progress as soon as WebAudio schedules a buffer, but it only checks `AudioContext.state === running`, not whether the scheduled source actually became audible in the Tavo WebView. `音频已排队` is a frontend WebAudio scheduling message, not backend queueing or an extra job. If first PCM is delayed, too short, or immediately underruns, the track looks like it is playing while no sound exists. Subtitle rendering may depend on `segments_meta` or generated segment state that is not attached to the pending live track until job status polling progresses. The status/notice layer also allows two transient messages to occupy the same subtitle area.

Root cause: Three frontend issues overlapped. First, `startSubtitle()` returned immediately when the live track had no `segments` at playback start, so it never started the later `/tts_dialogue_job_status/{cache_key}` polling that would have filled `segments_meta`. Second, the WebAudio live state used `音频已排队` as user-facing wording for `AudioBufferSource.start()` scheduling; that sounded like backend queueing or duplicate job creation even though it was only a frontend audio scheduling state. Third, early WebAudio underrun kept the fake playing/progress path alive too long before falling back to saved-cache playback.

Fix: `static/tavo.runtime.parts/52_subtitle_media.js` now keeps a subtitle session alive and polls job status even when no segments exist at initial playback, then rebuilds lyrics when `segments_meta` arrives. `static/tavo.runtime.parts/46_track_state.js`, `48_track_history.js`, and `60_generate_flow.js` replace `等待首段音频` / `音频已排队` wording with compact `等待音频` / `收到音频` states, and early repeated WebAudio underrun now switches to waiting for complete cache sooner instead of continuing fake progress. `42_playback_header.js` also resumes slightly before the last stalled time for live retries.

Guard: LIVE WebAudio must not start the visible playback clock or advance progress until at least one PCM buffer has been scheduled and the audio context has crossed that source start time. User-facing wording must not say `音频已排队`, because that sounds like backend queueing or duplicate task creation. While waiting for first playable PCM, the UI should show one compact waiting/synthesizing notice without overlapping lyrics/status controls. Subtitles should be populated from job status `segments_meta` as soon as available, even before the full cache audio is ready. Reconnect should either resume the live stream from a known offset or clearly fall back to waiting for saved cache, not stay in an indefinite backend-audio wait state.

## BUG-021: API restart can leave half-started vLLM Python processes and launcher window cannot maximize

Status: open, investigating; low-risk vLLM VRAM fixes runtime-validated

Reported: 2026-06-05

Repro: User killed Python processes and retried startup, but port `9880` still did not become healthy. User also reported the LEON launcher window cannot be enlarged.

Evidence: `nvidia-smi` showed two compute processes from `...\indextts2runtime\python.exe` still holding GPU memory while `9880` had no LISTEN socket. Recent startup logs stop around vLLM engine initialization and do not reach `>> GPT weights restored` or `IndexTTS API listening`. `LEON启动器.ps1` sets a fixed splitter (`$main.IsSplitterFixed = $true`), and the form setup did not explicitly enable resizing/maximize behavior.

2026-06-06 vLLM 0.11 evidence: after cleanly stopping `fast6g`, GPU memory dropped to about `1085 MiB`. Starting `vllm` with `--vllm_gpu_memory_utilization 0.11` created API PID `19704` and vLLM worker PID `17584`, `/health` returned `version=vllm`, `qwen_emo=false`, `llm_parse=true`, but idle GPU memory was still about `9647 MiB / 12288 MiB`. Startup logs showed the main API process loads GPT and moves the GPT wrapper to `cuda:0`, then vLLM starts and loads its own engine. The same log also compiled/loaded two BigVGAN CUDA extension trees: the old unused `vllm/indextts/BigVGAN/...` preload path, then the actual `vllm/indextts/s2mel/modules/bigvgan/...` vocoder path. After the BigVGAN preload fix, the next vLLM 0.11 restart created API PID `28008` and worker PID `26736`, `/health` and `/voices` passed, and startup logs only compiled/loaded `vllm/indextts/s2mel/modules/bigvgan/...`; the legacy `vllm/indextts/BigVGAN/...` path was absent, but idle GPU memory still stayed around `9653 MiB / 12288 MiB`. After the main GPT FP16/autocast fix, the final vLLM 0.11 restart created API PID `29272` and worker PID `28772`; idle GPU memory dropped to about `8008 MiB / 12288 MiB`, `/health` and `/voices` passed, and a short `/warmup` synthesis succeeded in `3.295s` with `RTF=3.6375`. A `gpu_memory_utilization=0.08` startup test failed with `Available KV cache memory: -0.05 GiB` and `No available memory for the cache blocks`, so `0.08` is too low on this machine with the current architecture.

Hypothesis: The restart mutex path can wait behind a stale launcher/restart chain instead of clearing half-started project processes. vLLM Windows spawn/IPC can leave child processes alive without a healthy API listener. The launcher UI also needs explicit resizable form settings and an unfixed splitter. For high vLLM idle memory, the main API GPT wrapper and vLLM worker both need GPT-related weights, but the main-process GPT cannot be removed outright because it computes the latent passed into S2Mel after vLLM generates codes. The confirmed low-risk waste was that the vLLM main-process GPT stayed FP32 despite `--fp16`.

Root cause: pending.

Fix: `vllm/indextts/infer_vllm_v2.py` no longer imports the unused old `indextts.BigVGAN.models.BigVGAN` class and now preloads the same `indextts.s2mel.modules.bigvgan.alias_free_activation.cuda.activation1d` extension used by the actual vocoder. Runtime validation confirmed the next vLLM startup log no longer mentions `vllm\indextts\BigVGAN\alias_free_activation\cuda\build`. The same file now also converts the main GPT wrapper to half precision when `--fp16` is active and wraps local GPT latent/conditioning calls in autocast, matching the non-vLLM backend pattern.

Guard: Restarting should kill stale same-repo API/control-chain processes before launching a new instance. After startup, `9880` must pass `/health`, and no stale project Python should remain if startup fails. vLLM startup with CUDA kernel enabled should compile/load only the active `s2mel/modules/bigvgan` CUDA extension path, not the legacy `indextts/BigVGAN` extension tree. With `--fp16`, the main GPT wrapper should not remain FP32, and a short `/warmup` should pass before using the service. The launcher window should be sizable and maximizable, with the main splitter draggable.

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

Repro: During a long IndexTTS2 dialogue job, Tavo logged `audio error code=4 src=<public-host>/tts_dialogue_stream_job/<cache_key>?start_s=60.219`.

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

Evidence: User reported a Tavo AR debug/error string saying `LLM 解析代理 /parse_text 请求没有到达后端` with request URL `<public-host>/parse_text`, current page `about:srcdoc`, script source `static/tavo.js`, and LLM endpoint `http://127.0.0.1:8317/v1`. User clarified that LLM parse success/failure should be controlled by the backend after job creation, and the frontend should only submit source text, voice mapping, LLM config, and generation parameters once to get a job id/cache key.

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

Root cause: The LIVE/generate quick switch and normal-mode voice controls were added with one-off UI surfaces. The header controls did not share one sizing/alignment rule, and normal mode used standalone picker buttons instead of the existing role-row layout. A later normal-mode cleanup replaced the old default/narrator/dialogue triple row with only `旁白` and optional `对白`.

Fix: `static/tavo.runtime.parts/40_mount_shell.js` now renders 普通模式音色 as three role-style rows. 默认 is a locked display-only row (`default-voice-label`), while 旁白 and 对话 are the only voice picker buttons. `50_settings_fields.js` updates those labels without reading normal rows into the AI role list. `54_voice_picker.js` ignores the read-only default row and scopes role-row events to `[data-role="roles-list"]`. Header styles in `static/tavo.ui.skin.default.css` and fallback CSS keep only the `L`/`D` playback toggle and settings button in the top row. Cache busting is bumped to `20260605-ld-live-v1`.

Guard: Player header controls should share the same top, height, glass background, border weight, and icon scale. Normal-mode voice settings must use role-row layout with only `旁白` and optional `对白`; there must be no visible `默认` row or `[data-role="default-voice-btn"]`. Normal-mode rows must not be saved into AI role mappings.

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

## BUG-023: Tavo LIVE, history controls, and saved-audio fallback regressions

Status: fixed in code, needs real Tavo validation; backend LLM status wording needs next API restart

Reported: 2026-06-06

Repro: User reported that the delete button disappeared, `D` background generation entered the special pending card and blocked normal previous/next history browsing, previous/next did not loop from last to first, LIVE still showed LLM-analysis wording despite parse reuse, clicking the LIVE play button fell into confusing saved-audio fallback messages, live playback reached later segments without foreground audio, the player card became too short, the four home buttons were cramped, offline save failure appeared to block online playback, and browser media `code=4` was shown raw.

Evidence: `showSubtitleNotice()` replaced the subtitle panel with `innerHTML`, which removed the delete button and history counter mounted inside that panel. Generate-mode placeholder tracks were pushed into `generatedTracks`, so `D` jobs became active special cards instead of background jobs. Default LIVE only used WebAudio when `webAudioLive=1` was present, otherwise it waited for cache audio. Saved audio errors surfaced raw media error code details. The reported cache key returned `200 audio/wav` locally and through the public tunnel, proving the generated file existed and the failure was in frontend playback/fallback handling.

Root cause: Recent player-state changes mixed three product states: LIVE streaming, background `D` generation, and saved history playback. Subtitle status rendering also destroyed persistent panel controls. The offline-cache path treated local save/read failures too close to the online playback path, and media element errors were not translated or recovered.

Fix: `D` generation is detached from the active track list until the job is saved, then it appends as a normal saved history card. Previous/next now cycles across saved history. Subtitle notices preserve delete/counter controls. LIVE defaults to WebAudio streaming unless explicitly disabled or native live is requested. LIVE play clicks now pause when already loading/buffering/streaming instead of re-entering saved-cache fallback. Saved playback clears broken offline blobs, falls back to online `/cache_audio`, then tries a temporary fetched blob if direct media playback fails. Media error code 4 is translated into a human-readable WebView/source message. The card height is fixed and the generate button is spaced away from the central controls. Backend LLM parse status now says it is checking reuse first, reports cache hits as reused, and only says it is calling LLM on a cache miss.

Guard: Delete and counter must survive every subtitle notice/subtitle render. `D` jobs must not become the active special card or block saved-history browsing. Previous/next must loop through saved tracks. LIVE should start WebAudio by default and should not show saved-audio fallback wording unless realtime playback actually fails. Offline save failure must not block online playback. Browser media errors must be shown as readable playback/source messages, not raw numeric codes.

## BUG-024: Tavo failed LIVE cards, default voice fallback, progress overflow, and user-facing metrics

Status: fixed in code, needs real Tavo validation

Reported: 2026-06-06

Repro: User screenshots showed a failed `6/6` card still exposing the LIVE exit button. Tapping play on the same card changed the UI back to `AI模式正在生成...`. Another screenshot showed `00:09 / 00:03` and broken subtitle progress. User also asked not to show RTF/steps/first-audio technical metrics, requested a higher D-mode quality tier, and pointed out that normal/single default voice was not configurable.

Evidence: `isLiveExitTrack()` returned true for any non-saved LIVE card and did not exclude `failed/cancelled`; failed tracks could retain stale `url/streamUrl`, so play/select paths could treat them as playable. `formatJobMetrics()` sent RTF/steps/首音 details into subtitle notices. The normal-mode default voice row was a read-only `span`. Frontend quality options stopped at `expressive`, and backend clamps forced custom diffusion/prompt settings back to `16/12`.

Root cause: Frontend card state mixed coarse job state with stale playback fields. Failed/cancelled was not a terminal UI state, default voice was displayed but not editable, and the playback timer trusted raw element/WebAudio time without clamping to known duration.

Fix: Failed/cancelled tracks now clear live flags, disable stale playable URLs, hide LIVE exit, and play only shows the terminal failure/cancelled notice. `trackState()` now lets backend terminal status override stale `state=live`, so a failed card cannot keep live controls after status polling. Default voice is a picker button and is sent as the `default` voice fallback for normal/AI generation. Playback time and subtitle ticks are clamped to known duration/audio metadata. User-visible job metrics no longer include RTF/steps/首音. Added `ultra` / `落盘高质量` with frontend `20 steps / 14s prompt / 96 tokens` and backend clamp support up to `24 steps / 16s prompt`. Cache busting is bumped to `20260606-live-audio-v5`.

Guard: Failed/cancelled cards must not show the LIVE exit button or re-enter loading/generating on play. Current time must never exceed displayed total time. Subtitles must stop at the final line after playback end. Default voice must be selectable in normal-mode settings and serve as role fallback. Technical performance metrics should stay out of the user-facing card UI.
