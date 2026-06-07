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
| BUG-048 | fixed in code, needs real Tavo validation | frontend LIVE WebAudio / mobile WebView | Generated cache WAV is audible; no-sound path was frontend playback handoff risk. WebAudio "stable" now requires buffered audio, short buffering no longer resets to idle, and cache-ready LIVE can force native saved `<audio>` handoff when WebAudio is unstable. | Real Tavo/mobile: start LIVE, confirm audio becomes audible or cleanly switches to saved cache without spinner/no-sound state. |
| BUG-049 | fixed in code, needs real Tavo validation | frontend status / header UI | Avatar-side status is reserved for the configured/current voice label only. LLM/TTS/LIVE progress moved to a separate fixed-height progress line; raw backend text like "文本已拆分" is translated; spinner transform origin is fixed. | Real Tavo/mobile: generate AI LIVE and confirm avatar-side line never shows progress/error copy, while progress line remains readable and non-jittery. |
| BUG-044 | fixed in code, needs launcher visual validation | launcher | Start/stop button now debounces and gives immediate `启动中...` / `停止中...` feedback. | Open launcher and visually confirm no repeat-click confusion. |
| BUG-045 | fixed in code, needs launcher visual validation | launcher / logs | Launcher filters self health/log polling and decodes startup logs more cleanly. | Start service through launcher and confirm logs are not spammy or garbled. |

## Fix Notes

- BUG-048 root cause: the frontend treated `AudioContext.state=running` / first scheduled block as stable playback even when the mobile WebView produced no audible output. It also showed first-audio/buffering warnings too aggressively and could miss native saved-audio handoff after the cache landed.
- BUG-048 guard: stable WebAudio needs buffered audio evidence; short buffering after start keeps the UI in playing/loading instead of flashing "还没收到实时音频"; completed cache handoff stops WebAudio before mounting native saved `<audio>`.
- BUG-049 root cause: one status line was overloaded for voice label, LLM/TTS phases, playback warnings, and settings feedback.
- BUG-049 guard: `setStatus()` writes transient text to the progress line, then forces the avatar-side line back to the stable voice label or "音色未设置"; pure voice-label updates do not fill the progress line.

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
