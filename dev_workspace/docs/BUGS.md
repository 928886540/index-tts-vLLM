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
| BUG-048 | fixed in code, needs real Tavo validation | frontend LIVE playback output / API backend live buffer | Generated cache WAV is audible and `/pcm` chunks are non-silent. LIVE now polls same-key PCM, outputs through AudioWorklet/ScriptProcessor queue before falling back to BufferSource, primes native audio and WebAudio on snapshot/play/generate user gestures, uses a slightly larger PCM prebuffer to reduce segment-boundary stalls, can switch to same-key native live `<audio>` before cache落盘 if WebAudio output is blocked, and keeps audible LIVE playback when cache落盘 instead of stealing it into saved `<audio>`. `/pcm` done now only means the requested stream tail is drained. | Real Tavo/mobile: open snapshot, start LIVE, confirm first segment is audible before cache落盘, cache落盘 does not trigger a loading handoff, segment transitions do not cause frequent short dropouts, and switching chat/app only pauses or falls back without losing the key. |
| BUG-049 | fixed in code, needs real Tavo validation | frontend status / player UI | Avatar-side status is reserved for the configured/current voice label only. LLM/TTS/LIVE progress moved to a transparent one-line hint near the seek/time area, can show compact current playing segment text like "播第 x/y 段", and filters/throttles noisy micro-states; delete and page counter stay in the lyric panel toolbar with the counter fixed right even during LIVE; LIVE play/pause keeps the saved-playback position while exit replaces the music-note position; loader shell has a loading bar and refreshed history count; raw backend text like "文本已拆分" is translated; spinner transform origin is fixed. | Real Tavo/mobile: generate AI LIVE, confirm avatar-side line never shows progress/error copy, floating hint stays one-line without a dark panel, LIVE control/page positions do not jump, and progress text does not rapidly cycle through connection/buffer micro-states. |
| BUG-044 | fixed in code, needs launcher visual validation | launcher | Start/stop button now debounces and gives immediate `启动中...` / `停止中...` feedback. | Open launcher and visually confirm no repeat-click confusion. |
| BUG-045 | fixed in code, needs launcher visual validation | launcher / logs | Launcher filters self health/log polling and decodes startup logs more cleanly. | Start service through launcher and confirm logs are not spammy or garbled. |

## Fix Notes

- BUG-048 root cause: the frontend treated chunked fetch delivery and `AudioContext.state=running` / scheduled blocks as enough evidence of audible LIVE playback. In Tavo/iOS WebView, PCM can arrive and be non-silent while the output chain is still effectively muted or later interrupted by app/chat switches.
- BUG-048 v29 root cause: lazy loader resolved the stable `tavo.message.current().id` asynchronously but did not sync it back to the click-handler closure/pre-primed WebAudio owner; the runtime music-note gesture could then force-rebuild and close the user-gesture-unlocked AudioContext before the first LIVE PCM played.
- BUG-048 v29 fix: loader now adopts the pre-primed owner when the resolved message id arrives, runtime can adopt a pre-prime only through the explicit previous loader owner, and the music-note generate gesture no longer force-resets WebAudio by default.
- BUG-048 guard: LIVE WebAudio should prefer same-key `/tts_dialogue_stream_job/{cache_key}/pcm` polling before cache落盘 and output via an AudioWorklet/ScriptProcessor PCM queue when available. BufferSource scheduling is compatibility fallback. Native audio must be primed on user gestures. If WebAudio output/device startup fails, switch to same-key native live `<audio>` before saved-cache fallback.
- BUG-048 PCM API guard: `X-IndexTTS-Live-Done=1` must not be sent with a data chunk until `X-IndexTTS-PCM-Next-Offset >= X-IndexTTS-PCM-Total`; frontend also ignores premature done headers when `next < total`.
- BUG-048 handoff guard: cache落盘 must not stop an already audible LIVE stream just because a prior transient stalled/buffering flag exists; saved `<audio>` autoplay handoff is only for explicit saved fallback, interrupted streams, or streams that never became audible.
- BUG-049 root cause: one status line was overloaded for voice label, LLM/TTS phases, playback warnings, and settings feedback.
- BUG-049 guard: `setStatus()` writes meaningful transient text to the transparent floating progress element, filters short-lived audio micro-states, throttles rapid text changes, then forces the avatar-side line back to the stable voice label or "音色未设置"; pure voice-label updates do not fill the progress element.

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
