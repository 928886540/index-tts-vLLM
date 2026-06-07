# Bugs

Active bug ledger for current work. Full historical entries were archived on 2026-06-07:

- `dev_workspace/docs/archive/BUGS_ARCHIVE_20260607.md`

Read the archive only when tracing an older bug, checking exact root-cause history, or reviving a fixed issue.

## Process Rules

- Do not use this file as the first or only response to a fresh user bug report.
- Diagnose and fix code first; update this ledger only when tracking, handoff, or regression context is useful.
- Keep entries concise and do not paste raw user reports.
- Keep evidence separate from hypotheses.
- After a fix, record root cause, changed boundary, and regression guard.
- Move old fixed entries to the archive when this file grows large.

## Active / Recent Bugs

| ID | Status | Boundary | Summary | Next check |
| --- | --- | --- | --- | --- |
| BUG-026 | fixed in code, needs real Tavo validation | frontend / Tavo storage | Settings now prefer `tavo.get/set`; `localStorage` is fallback only; failed `tavo.set` surfaces "设置保存失败". | In real Tavo on `fast6g` and `vllm`, save settings, reopen panel, remount message, and re-enter chat. |
| BUG-046 | fixed in code, needs real Tavo validation | frontend playback / Tavo storage | Play button now only play/pause; music-note generates; empty player disables play; delete clears stale key/audio/WebAudio/pending state; restored LIVE pending resumes same key with `start_s`. | Real Tavo/mobile: delete final audio, confirm play is disabled; restore pending LIVE and confirm no new POST. |
| BUG-047 | fixed in code, needs real Tavo validation | frontend role mapping | AI mode no longer submits `voices.default`; required roles must have explicit voice mappings; header uses explicit role voice. | Real Tavo: remove an AI role mapping and confirm lyric/player shows clear mapping error before job creation. |
| BUG-048 | fixed in code, needs real Tavo validation | frontend LIVE playback output / API backend live buffer | Generated cache WAV is audible and `/pcm` chunks are non-silent. LIVE now polls same-key PCM, outputs through AudioWorklet/ScriptProcessor queue before falling back to BufferSource, primes native audio and WebAudio on snapshot/play/generate user gestures, keeps local WebAudio/PCM alive across user pause/resume when possible, uses thicker PCM buffering plus earlier small-tail flushing to reduce segment-boundary stalls, can switch to same-key native live `<audio>` before cache落盘 if WebAudio output is blocked, and keeps audible LIVE playback when cache落盘 instead of stealing it into saved `<audio>`. `/pcm` done now only means the requested stream tail is drained. | Real Tavo/mobile: open snapshot, start LIVE, pause then wait then resume without a new POST, confirm first segment is audible before cache落盘, cache落盘 does not trigger a loading handoff, segment transitions do not cause frequent short dropouts, and switching chat/app only pauses or falls back without losing the key. |
| BUG-049 | fixed in code, needs real Tavo validation | frontend status / player UI | Avatar-side status is reserved for the configured/current voice label only. LLM/TTS/LIVE progress moved to a transparent one-line hint near the seek/time area, can show compact current playing segment text like "播第 x/y 段", and filters/throttles noisy micro-states; delete stays in the lyric panel toolbar; LIVE play/pause keeps the saved-playback position while exit replaces the music-note position; loader shell has a loading bar and refreshed history count; raw backend text like "文本已拆分" is translated; spinner transform origin is fixed. | Real Tavo/mobile: generate AI LIVE, confirm avatar-side line never shows progress/error copy, floating hint stays one-line without a dark panel, LIVE control/page positions do not jump, and progress text does not rapidly cycle through connection/buffer micro-states. |
| BUG-050 | fixed in code, needs real Tavo validation | API backend queue status / frontend progress | vLLM and fast6g now expose FIFO TTS lock queue visibility through job metrics; Tavo shows `前面还有 X 个 TTS 任务` during `tts_queue` instead of only showing elapsed waiting. | Real Tavo: start one long TTS job, submit a second LIVE job, confirm the second card shows queue-ahead text and switches to normal synthesis progress when it becomes active. |
| BUG-051 | fixed in code, needs real Tavo validation | frontend player UI / speaker header | Header controls now render `LIVE/DISK + page counter + settings`. `syncUI()` no longer rewrites title/avatar when the active track is owned by a current speaker, so mode toggling does not mismatch avatar/name/voice state. | Real Tavo/mobile: during LIVE playback with a speaker avatar/title active, toggle `LIVE`/`DISK` and confirm title/avatar/voice stay matched; confirm page counter stays between mode and settings. |
| BUG-052 | fixed in code, needs real Tavo validation | frontend / Tavo chat role avatars | Group chat speaker avatars now resolve from current `chat.characters` by role name for display only; unmapped group roles are not auto-added to voice maps or AI `roles_hint`. | Real Tavo group chat: generate/play a segment whose role is another chat character and confirm title/avatar switch to that character while voice config stays explicit-only. |
| BUG-053 | fixed in code, needs real Tavo validation | frontend / Tavo storage / LIVE lifecycle | LIVE jobs now persist a visible pending card immediately after `cacheKey` creation, so WebView death/lock-screen remount can restore the same key and keep cache polling. Explicit LIVE exit/delete is the cleanup path. | Real Tavo/mobile: start LIVE, lock screen or kill/re-enter the message before cache lands, confirm the card returns without a new job and later becomes saved history; then explicit exit/delete clears it. |
| BUG-054 | fixed in code, needs real Tavo validation | frontend / Tavo file storage / offline playback | Saved offline audio may exist in `tavo.file`, but some WebViews cannot play the `tavo.file.url()` path directly as `<audio src>`. The player now retries with `tavo.file.load(..., { encoding: "dataUrl" })` and a `blob:` URL before falling back online. Saved-card delete now synchronously checks/deletes the matching Tavo offline file before removing history metadata. | Real Tavo/mobile: enable offline save, reopen/play a saved card, confirm a local file-url failure does not immediately fall back to `/cache_audio`, then delete the saved card and confirm the Tavo file does not remain. |
| BUG-055 | fixed in code, needs real Tavo validation | frontend LIVE playback / mobile WebView audio session | App background/page-hide WebAudio `suspended/interrupted` is now treated as a temporary suspend, not an output-device failure. The card keeps the same key, records monotonic LIVE resume seconds, and waits for foreground user play; unlock/keepalive buffers are silent. | Real Tavo/mobile: start LIVE, switch app/lock screen, return, confirm no repeated WebAudio rebuild/native live `<audio>` fallback loop and no audible chirp; tap play to resume the same key without jumping back to an older segment. |
| BUG-044 | fixed in code, needs launcher visual validation | launcher | Start/stop button now debounces and gives immediate `启动中...` / `停止中...` feedback. | Open launcher and visually confirm no repeat-click confusion. |
| BUG-045 | fixed in code, needs launcher visual validation | launcher / logs | Launcher filters self health/log polling and decodes startup logs more cleanly. | Start service through launcher and confirm logs are not spammy or garbled. |

## Fix Notes

- BUG-048 root cause: the frontend treated chunked fetch delivery and `AudioContext.state=running` / scheduled blocks as enough evidence of audible LIVE playback. In Tavo/iOS WebView, PCM can arrive and be non-silent while the output chain is still effectively muted or later interrupted by app/chat switches.
- BUG-048 v29 root cause: lazy loader resolved the stable `tavo.message.current().id` asynchronously but did not sync it back to the click-handler closure/pre-primed WebAudio owner; the runtime music-note gesture could then force-rebuild and close the user-gesture-unlocked AudioContext before the first LIVE PCM played.
- BUG-048 v29 fix: loader now adopts the pre-primed owner when the resolved message id arrives, runtime can adopt a pre-prime only through the explicit previous loader owner, and the music-note generate gesture no longer force-resets WebAudio by default.
- BUG-048 v30 root cause: LIVE pause still stopped the WebAudio controller in common paths, so resuming could reconnect the same key instead of continuing the already-buffering local PCM queue. The PCM scheduler also allowed tiny segment-tail PCM to sit in `pending` too long, which could create short audible stalls at boundaries.
- BUG-048 v30 fix: user pause now locally suspends WebAudio while PCM polling continues, user resume restarts the same controller first, PCM scheduling no longer auto-resumes during user pause, poll wait is shorter, chunk windows are larger, and small pending PCM tails flush sooner when the playback queue is getting low.
- BUG-048 guard: LIVE WebAudio should prefer same-key `/tts_dialogue_stream_job/{cache_key}/pcm` polling before cache落盘 and output via an AudioWorklet/ScriptProcessor PCM queue when available. BufferSource scheduling is compatibility fallback. Native audio must be primed on user gestures. If WebAudio output/device startup fails, switch to same-key native live `<audio>` before saved-cache fallback.
- BUG-048 PCM API guard: `X-IndexTTS-Live-Done=1` must not be sent with a data chunk until `X-IndexTTS-PCM-Next-Offset >= X-IndexTTS-PCM-Total`; frontend also ignores premature done headers when `next < total`.
- BUG-048 handoff guard: cache落盘 must not stop an already audible LIVE stream just because a prior transient stalled/buffering flag exists; saved `<audio>` autoplay handoff is only for explicit saved fallback, interrupted streams, or streams that never became audible.
- BUG-049 root cause: one status line was overloaded for voice label, LLM/TTS phases, playback warnings, and settings feedback.
- BUG-049 guard: `setStatus()` writes meaningful transient text to the transparent floating progress element, filters short-lived audio micro-states, throttles rapid text changes, then forces the avatar-side line back to the stable voice label or "音色未设置"; pure voice-label updates do not fill the progress element.
- BUG-050 root cause: the API backend already serialized heavy TTS inference with a lock, but jobs waiting on that lock had no visible queue position. The frontend could only show elapsed waiting, which looked like a stalled backend.
- BUG-050 fix: vLLM and fast6g wrap the existing TTS lock with FIFO queue bookkeeping and write `queue_ahead`, `queue_position`, `queue_size`, and `queue_wait_s` into live job metrics. The Tavo progress line translates `tts_queue` into readable queue copy.
- BUG-050 guard: all heavy TTS inference paths should use the same queue wrapper around the single TTS lock; queued live jobs should surface queue-ahead text through `/tts_dialogue_job_status/{cache_key}` without occupying the avatar-side voice label or lyric panel.
- BUG-051 root cause: playback mode toggling calls `syncUI()`, and the old code unconditionally rewrote header title/cover from default context even while the active track speaker owned the header. The page counter also still had old subtitle-toolbar placement rules.
- BUG-051 fix: `syncUI()` skips default title/cover rewrites when `currentTrack()` and `lastSpeakerRole` indicate speaker-owned header state. Loader/runtime DOM now place the page counter in the top card header, `LIVE`/`DISK` replace `L`/`D`, and skin/fallback CSS share the same three-control layout.
- BUG-051 guard: Playwright asserts top controls read `LIVE -> page counter -> settings`, counter is outside `.idx-subtitle`, and toggling `LIVE`/`DISK` during LIVE playback does not reset active speaker title/avatar.
- BUG-052 root cause: the frontend only exposed the current message character avatar to `avatarForRole()`, so group chat roles spoken by other characters fell back to the current message character.
- BUG-052 fix: `currentMessageContext()` builds a role/avatar map from the current character, current `chat.characters`, and persona/user context; `avatarForRole()` checks that map before falling back to the current character avatar.
- BUG-052 guard: Playwright includes a group-chat smoke where `segments_meta.role=李瓶儿` uses the matching `chat.characters` avatar, while `voices` and `roles_hint` do not auto-add the unmapped group role.
- BUG-053 root cause: LIVE generation created an in-memory placeholder and cache polling, but only DISK/background jobs were written to `indextts_pending_jobs_<messageId>` after `cacheKey` creation. If the Tavo WebView died before cache落盘, the API backend/TTS service could keep working while the frontend had no durable card to restore.
- BUG-053 fix: non-cached LIVE and DISK jobs both call `savePendingJobForTrack()` immediately after `cacheKey` is known. Existing pending restore rehydrates LIVE as a visible same-key card and keeps `pollCacheUpgrade()` running; explicit live exit/delete still removes pending and deletes the remote job/cache.
- BUG-053 guard: Playwright starts a LIVE job, verifies chat-scoped pending storage before close, remounts the test page and confirms the same key is restored without a new POST, then confirms explicit LIVE exit clears pending and sends DELETE.
- BUG-054 root cause: `tavo.file.save()`/`exists()` could succeed and `tavo.file.url()` could return a path, but that path is not guaranteed to be a playable audio source in every Tavo WebView. The old recovery treated `MEDIA_ERR_SRC_NOT_SUPPORTED` on the local file URL as offline failure and immediately switched to online `cache_audio`.
- BUG-054 fix: offline playback errors now first retry by reading the same Tavo chat file with `tavo.file.load(key, { scope: "chat", encoding: "dataUrl" })`, converting it to a `blob:` URL, and playing that local blob. Only a failed load/blob retry marks offline failed and falls back online.
- BUG-054 delete fix: saved-card delete now awaits `tavo.file.exists()` and `tavo.file.delete()` for `indextts-<cacheKey>.wav` before removing the track from persisted history. If file deletion fails, the card is kept so the user can retry instead of leaking a Tavo file.
- BUG-054 guard: Playwright mocks a present Tavo file whose `file.url()` fails as audio, verifies `file.load` is called, confirms `offline-blob` playback starts, asserts no `/cache_audio` fallback occurs when the blob succeeds, then clicks delete and checks the same Tavo file existed and was deleted before history metadata is cleared.
- BUG-055 root cause: WebAudio `audio_suspended/interrupted` from app background was handled like a recoverable output-device failure. That path immediately rebuilt AudioContexts and then switched to native live `<audio>` without a fresh foreground gesture, causing retry loops and unsupported audio errors.
- BUG-055 fix: page-hide/visibility-hidden and non-gesture WebAudio suspend events now mark the LIVE card as temporarily suspended with the same cache key, stop the WebAudio polling loop, keep cache polling/pending state, and wait for user play before reconnecting. The tiny unlock/keepalive/wake buffers are now silent.
- BUG-055 resume fix: LIVE progress now records `liveResumeSec` / `lastLiveProgressSec` monotonically and prefers those values over stale `lastStalledSec`; the background-suspend smoke injects old stalled `7s` plus latest progress `17s` and verifies foreground play reconnects with `start_s=17.000`.
- BUG-055 guard: Playwright simulates `document.hidden + visibilitychange` during LIVE WebAudio playback and asserts there is no second POST, no DELETE, no native live `<audio>` stream play, no repeated polling loop after suspend, and no resume jump back to an older stalled second.

## Current Risk Areas

- Tavo frontend storage and playback: `static/tavo.js`, `static/tavo.runtime.js`, and `static/tavo.runtime.parts/*`.
- Tavo real-app behavior is not fully proven by Playwright. Real AR lifecycle, `tavo.get/set`, mobile WebView audio, and app re-entry still need emulator or phone validation.
- API backend job/cache/status behavior: `vllm/indextts2_api.py`, `fast6g/indextts2_api.py`.
- TTS service resource pressure on 12 GB VRAM can still create slow first audio or high RTF.
- Launcher UX and startup path need visual validation after UI or log changes.

## Recently Fixed Lineage

These fixed Tavo issues are relevant when a regression returns; read the archive for full entries:

- BUG-033 to BUG-038: LIVE WebAudio audible streaming, same-key recovery, first-open shell, custom params, and recovery exhaustion.
- BUG-039 to BUG-043: normal-mode mapping/cleaning, DOM chrome cleanup, LIVE resume offset, header status, and planned subtitle rendering.
- BUG-023 to BUG-025: LIVE/history controls, saved fallback, failed cards, progress clamping, and user-facing metrics cleanup.
- BUG-012 to BUG-015: backend-owned AI parse, dialog lifecycle, readable cache index, and normal-mode voice UI.

## Add Entry Template

```text
## BUG-000: title

Status:
Reported:
Boundary:
Repro:
Evidence:
Hypothesis:
Root cause:
Fix:
Guard:
Notes:
```
