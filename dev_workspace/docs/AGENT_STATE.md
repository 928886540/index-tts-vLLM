# Agent State

Updated: 2026-06-07

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
<script src="http://<LAN-IP>:9880/static/tavo.js?v=20260607-tavo-file-v38"></script>
```

Current code state:

- `static/tavo.js`, `static/tavo.runtime.js`, `static/tavo.runtime.manifest.json`, root `README.md`, and `dev_workspace/README.md` use `20260607-tavo-file-v38`.
- Root `README.md` is now the project introduction with README images. `dev_workspace/README.md` is the active working README for Codex repository work.
- Root `AGENTS.md` was moved into `dev_workspace/AGENTS.md`; start new Codex sessions in `dev_workspace` for the shortest working context.
- Tavo settings/config read `tavo.get` first; `localStorage` is fallback only.
- `tavo.set` failures surface as "设置保存失败".
- Saved tracks and pending jobs prefer `tavo.get`; deletion writes through `tavo.set`.
- Offline audio bytes now use Tavo chat-scoped `tavo.file` storage (`indextts-<cacheKey>.wav`) instead of IndexedDB; saved track metadata still uses `tavo.set`.
- If a saved Tavo offline file exists but `tavo.file.url()` is not playable as an `<audio>` source in the current WebView, the player retries with `tavo.file.load(..., { encoding: "dataUrl" })` and a local `blob:` URL before falling back to online `/cache_audio`.
- Deleting a saved/cache card now checks and deletes the matching Tavo chat-scoped offline file before clearing saved history metadata; if Tavo file deletion fails, the card is kept for retry.
- Main play button only plays/pauses current audio. The music-note button creates new audio.
- Empty player disables play and keeps music-note enabled.
- AI mode does not submit `voices.default`; explicit role mappings are required.
- AI mode with no explicit mapping shows "音色未设置" / mapping error instead of falling back to a default voice.
- Avatar-side status is only the configured/current voice label; LLM/TTS/LIVE progress uses a transparent one-line hint floating near the seek/time area. During LIVE playback, synthesis progress can include compact "播第 x/y 段" text; noisy connection/buffer micro-states are filtered/throttled. The top header shows `LIVE`/`DISK`, page counter, then settings; the lyric panel toolbar keeps delete only.
- vLLM and fast6g expose FIFO visibility for the existing single TTS lock; queued LIVE jobs show `前面还有 X 个 TTS 任务` in the transparent progress hint instead of only showing elapsed waiting.
- LIVE controls keep the main play/pause button at the same position as saved-history playback; the live-exit button occupies the music-note position while previous/next only reserve invisible layout space. This remains true when cache落盘 but WebAudio still owns the audible LIVE output.
- Lazy snapshot open/play gestures now pre-prime WebAudio and native audio before the runtime script loads. The loader syncs the resolved `tavo.message.current().id` back to the click closure and pre-primed owner, and the runtime no longer lets the music-note generate gesture destroy that pre-unlocked AudioContext.
- The loader shell shows a small loading bar while the runtime opens, and its history counter is refreshed from the same Tavo/local track snapshot as the lazy card.
- Toggling `LIVE`/`DISK` updates only playback mode chrome and does not overwrite the current speaker-owned title/avatar while audio is active.
- LIVE WebAudio starts with a slightly larger PCM prebuffer, pulls larger PCM chunks, lowers the poll wait, and flushes small pending PCM tails sooner to reduce short stalls at segment boundaries.
- LIVE WebAudio pause now keeps the local AudioContext/PCM controller alive and keeps polling the same cache key in the background; play resumes that local queue first instead of reconnecting or creating a new backend job. If local resume fails, it falls back to same-key `start_s` recovery.
- Restored LIVE pending tracks keep resume seconds and reconnect the same key with `start_s`, without a new POST.
- Fresh non-cached LIVE jobs now persist a chat-scoped pending card immediately after the API backend returns `cacheKey`. If the Tavo WebView dies before cache落盘, remount restores the same visible LIVE card and continues cache polling; explicit LIVE exit/delete clears that pending card and remote job/cache.
- LIVE uses same-key live PCM polling before cache落盘. Frontend PCM output now prefers an AudioWorklet queue, then ScriptProcessor, then BufferSource scheduling; user gesture also primes native audio. If WebAudio device startup fails, the same LIVE key can switch to native live `<audio>` before cache落盘 instead of waiting for saved audio.
- If LIVE is already audible when the cache file lands, the frontend keeps the current LIVE output and does not steal playback into saved `<audio>`; native saved `<audio>` handoff is reserved for explicit saved fallback or interrupted/not-yet-audible streams.
- Loading spinner has fixed SVG transform origin to reduce wobble.
- Native `<audio>` seeking/seeked debug logs are quiet by default; use `debugSeek=1` only when diagnosing seek behavior.
- Group chat speaker avatars now use the current Tavo chat `chat.characters` list as a display-only role/avatar map. Matching is exact role name plus lowercase key fallback; it does not auto-add group characters to AI voice mappings or `roles_hint`.

## Latest Validation

Passed on 2026-06-07:

```powershell
node --check static\tavo.js
node --check static\tavo.runtime.js
node --check dev_workspace\dev_tools\test_tavo_widget_playwright.js
$manifest = Get-Content -Raw static\tavo.runtime.manifest.json | ConvertFrom-Json; $code = "(async function(){`n"; foreach ($m in $manifest.modules) { $code += (Get-Content -Raw (Join-Path static $m.file)) + "`n" }; $code += "`n})();"; $code | node --check -
node dev_workspace\dev_tools\test_tavo_widget_playwright.js
git diff --check
```

`git diff --check` only reported Windows LF-to-CRLF warnings, not whitespace errors.

Additional evidence for the latest no-sound reports:

- Cache WAV `vllm/outputs/cache/a161f65daed31387d94bb5f5a0772b238830598c.wav` is non-silent: about `170.837s`, `22050 Hz`, mono 16-bit, RMS around `-14.08 dB`.
- User console showed `/pcm` chunks with non-zero `peak/rms`, so PCM was arriving and not silent. A later `Failed to start the audio device` happened after switching chat/app and should be treated as an output-session interruption, not proof that PCM data is bad.
- Local `/pcm` smoke confirmed non-silent PCM on vLLM: first PCM around 3.7s, `sample_rate=22050`, `peak=0.928`, `rms=0.292`. It also exposed a header bug where `X-IndexTTS-Live-Done=1` could be returned before the client drained `X-IndexTTS-PCM-Total`; current code fixes backend done semantics and frontend keeps pulling if `next < total`.
- After v21 changes, vLLM was restarted from old PID `29652` to new PID `10792`; `/health` is OK with `vllm_gpu_memory_utilization=0.15`. Fresh `/pcm` smoke key `7297fa757ba5ec1a21e137408937ceebddd51719` was deleted after test; first PCM arrived around `1.927s`, chunk `75264 bytes`, `peak=0.928436`, `rms=0.351856`, and `done=1` had `next=total=75264`.
- Playwright smoke confirms progress now lives as a transparent one-line `.idx-card` floating hint above the lyric panel; top controls read `LIVE -> page counter -> settings`; delete stays in the sticky `.idx-subtitle .idx-sub-toolbar`; toggling `LIVE`/`DISK` during playback keeps the active speaker title/avatar; group chat role `李瓶儿` uses the matching `chat.characters` avatar without adding that role to `voices` or `roles_hint`; LIVE pending durable smoke creates a pending card, remounts the same key without a new POST, and clears pending on explicit LIVE exit; offline playback smoke verifies a failed `tavo.file.url()` audio path retries through `tavo.file.load` as an `offline-blob` without hitting `/cache_audio`; card height remains `450px`.
- Boundary conclusion: the TTS service/API backend generated audible audio; the failing path is frontend/mobile LIVE playback/output. Current code polls same-key PCM, sends it through queued WebAudio output, primes the native audio session on gesture, and can fall back to same-key native live `<audio>` before final cache落盘.

Still needs real Tavo/mobile validation:

- settings save/reopen through real `tavo.set`;
- AI missing-role mapping error UI;
- LIVE first-audio/no-sound behavior on phone;
- restored pending LIVE resume after app re-entry;
- LIVE pending card recovery after lock-screen/WebView death before cache落盘;
- saved/cache native `<audio>` background and lock-screen behavior.
- offline saved audio playback through real Tavo `tavo.file.url` and `tavo.file.load` fallback on phone.
- saved/cache card delete should remove the matching Tavo offline file first, and keep the card if that delete fails.
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
- BUG-048: LIVE/WebAudio audible playback and native cache handoff.
- BUG-049: avatar-side voice label, seek-area progress hint, and spinner stability.
- BUG-050: visible TTS queue-ahead status while jobs wait on the single TTS lock.
- BUG-051: LIVE/DISK top layout and speaker header mismatch guard.
- BUG-052: group chat role avatar map, display-only without auto-expanding voices.
- BUG-053: LIVE pending card durability across lock-screen/WebView death.
- BUG-054: offline saved audio file-url playback fallback through `tavo.file.load`.
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
