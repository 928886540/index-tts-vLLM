# Regression

## Basic Checks

Run before handing off code changes when relevant:

```powershell
python -m py_compile indextts2_api.py indextts\infer_vllm_v2.py indextts\gpt\model_vllm_v2.py
node --check static\tavo.js
node --check Leon_api\dev_tools\test_tavo_widget_playwright.js
git diff --check
```

If only docs changed, syntax checks are optional, but `git diff --check` is still useful.

## Runtime Health

When the API should be running:

```powershell
curl.exe --noproxy "*" -s http://127.0.0.1:9880/health
curl.exe --noproxy "*" -s http://127.0.0.1:9880/voices
curl.exe --noproxy "*" -I http://127.0.0.1:9880/static/tavo.js
```

Expected:

- `/health` returns ok JSON.
- `/voices` returns the voice library.
- `/static/tavo.js` returns JavaScript.

## GPU / ComfyUI Preflight

Before performance or RTF testing:

```powershell
cmd.exe /c netstat -ano | findstr ":8188"
nvidia-smi
```

Expected:

- `8188` is empty unless the user intentionally runs ComfyUI.
- Dedicated GPU memory has enough headroom.
- No unexpected heavy Python/ComfyUI/SD process is competing with IndexTTS2.

Record:

- GPU memory before test.
- Audio duration.
- Total elapsed time.
- RTF.
- Whether FP16/CUDA kernel/DeepSpeed/vLLM options were enabled.

## Tavo Script Regression

After changing `static/tavo.js`:

1. Bump the Tavo regex script query in docs or loader JSON if present.
2. Confirm Tavo loads the intended URL, not an old cached script.
3. Confirm initial mount only creates `.idx-lazy-card`; full `.idx-card` is absent.
4. Confirm initial mount does not load `tavo.runtime.js`, the runtime manifest, runtime parts, `/voices`, or any TTS job before the user clicks.
5. Click the lazy card to open the runtime, then open settings from the player card and confirm runtime loads one manifest plus all runtime parts.
6. Confirm the lazy snapshot has no settings button, settings opens aligned with the player card, and the close button is a compact icon button.
7. Open the voice selector and confirm it is tall enough for one page of voice cards.
8. Generate a short normal-mode audio.
9. Generate a multi-role / intelligent-mode audio if that feature was touched.
10. Re-enter the same message and confirm saved history count.

## Playwright Smoke

Use the fixed test runner described in `Leon_api/README.md`:

```powershell
node Leon_api\dev_tools\test_tavo_widget_playwright.js
```

The smoke test is not a replacement for real Tavo, but it should catch syntax, initial mount, accidental `/voices` requests, and obvious UI breakage.

Current lazy-loader assertions:

- first paint has `.idx-lazy-card` and no `.idx-card`;
- first paint has no `[data-role="lazy-gear"]`;
- first paint has `0` `/voices`, `0` TTS job requests, and `0` runtime manifest/part fetches;
- opening runtime and clicking the player settings button opens the compact settings panel;
- runtime loads exactly one manifest and all 16 parts;
- opening settings still does not request `/voices` or create a TTS job;
- settings panel is aligned with the player card and its close button is at least 30px square;
- opening the voice picker requests `/voices`, renders voice items, and has at least 540px height on desktop smoke;
- settings exposes `普通模式` / `AI模式` and the player quick toggle defaults to `LIVE`;
- simulated `data-live-active=1` keeps `[data-role="live-exit"]` visible despite `.idx-hidden`;
- player card keeps a stable minimum height so pending/live/saved state changes do not resize the card;
- settings section order is `文本模式` -> `合成质量` -> voice mapping -> `播放 / 离线`;
- player header `0/0`, `LIVE/生成`, and settings controls share height and top alignment;
- normal-mode voice rows use the same row layout as role mapping: 默认 is locked display-only, only 旁白/对话 open the picker;
- subtitle height remains `136px`.

## Cache / Snapshot Regression

For a generated `cache_key`:

```powershell
curl.exe --noproxy "*" -I http://127.0.0.1:9880/cache_audio/<cache_key>
curl.exe --noproxy "*" -s http://127.0.0.1:9880/tts_dialogue_job_status/<cache_key>
curl.exe --noproxy "*" -H "Range: bytes=0-99" http://127.0.0.1:9880/cache_audio/<cache_key>
D:\apiWorkSpace\index-tts2-vLLM\indextts2runtime\python.exe Leon_api\dev_tools\test_snapshot_cache_readable.py
```

Expected:

- Completed cache audio returns 200 and supports byte-range reads when appropriate.
- Job status contains state, cache information, segment metadata, and metrics.
- Missing cache should be reported as missing, not treated as playable audio.
- Root cache files remain at `outputs/cache/<cache_key>.wav` and `.json`; `/cache_audio/<cache_key>` must keep using this stable key path.
- A readable index entry should also exist at `outputs/cache/by_role/<主角色>/<timestamp>_<cache_key>.wav` with a matching `.json`.
- Only one primary-role readable entry is expected per cache key. Prefer a non-generic role over `旁白` / `对白` / `default`; if none exists, use the most frequent available role.
- Cache hit metadata and cache deletion/pruning should update or remove the readable JSON/WAV together with the root cache.

## History Count Guard

For any Tavo persistence or history change:

1. Generate one saved audio for a message.
2. Confirm full player count shows `1`.
3. Collapse/reopen lazy card and confirm snapshot count shows `1`.
4. Close/re-enter the Tavo message and confirm count remains `1`.
5. Generate a second saved audio and confirm count becomes `2`.
6. Trigger or simulate a failed job and confirm count remains `2`.
7. Delete one saved audio and confirm count becomes `1`.
8. Delete all saved audio only through explicit delete and confirm count becomes `0`.

Failed, live, pending, or missing tracks must not silently overwrite saved history with an empty array.

Live/pending tracks are not history. A live card may show `LIVE`, and a background job may show `生成`, but the saved history count must only change after `/tts_dialogue_job_status/<cache_key>` reports `done` and the card switches to saved/cache audio.

For background `生成` mode, pending jobs should be stored under the current Tavo message, restored after re-entering, and removed after done/failed/cancelled/delete.

## Failed Track Guard

When a job fails:

- UI shows a stable failed state.
- Polling stops.
- Live reader/WebAudio/native audio/subtitle state is cleaned up.
- The failed stream URL is not fed into `<audio>`.
- Existing saved history remains intact.
- Clicking play on the failed track does not show generic `audio format not supported`; it should ask for regeneration or show the real backend error.

## Live Card Guard

For a running live dialogue job:

1. The card shows only play/pause and live exit as active controls. CSS must not hide `.idx-live-exit` under `data-live-active=1`.
2. Previous, next, add, delete, rewind, forward, seek drag, subtitle click seek, and MediaSession seek do not act on the live track.
3. Clicking play pauses or resumes the live wait/play state; it does not create a second job.
4. Clicking live exit first checks status once; if status is `done`, the card becomes saved, otherwise the frontend calls `DELETE /tts_dialogue_stream_job/<cache_key>`.
5. Exiting live removes only the transient live card and keeps existing saved history count unchanged.
6. After status becomes `done`, the same card switches to a normal saved card with `/cache_audio/<cache_key>`. If foreground LIVE polling sees `/cache_audio/<cache_key>` is already readable via `HEAD`, it may switch to saved before the status endpoint catches up; this fallback must not run for failed/cancelled/background-generate jobs.

For a background `生成` dialogue job:

1. The player does not open `GET /tts_dialogue_stream_job/<cache_key>`.
2. The frontend polls `/tts_dialogue_job_status/<cache_key>`.
3. Deleting the pending card calls `DELETE /tts_dialogue_stream_job/<cache_key>` and clears pending storage.
4. Returning to the message restores pending jobs and continues polling until saved/failed/cancelled.

## Saved Audio Background Guard

For saved/cache audio playback:

- Saved tracks must use the native `<audio>` element with `/cache_audio/<cache_key>` or an offline object URL.
- Saved seek, rewind, forward, MediaSession controls, subtitles, and background/lock-screen playback must keep working.
- The live WebAudio/live fallback path must not replace saved playback with WebAudio.
- `loadedmetadata` and `timeupdate` may disable seek for live tracks only; they must leave saved tracks seekable when duration is known.
- A live stream code=4 must clear/fallback the live stream without poisoning the saved audio element for the next saved track.

## Role / Voice Mapping Guard

For any role mapping, LLM parse, or voice library change:

Test at least:

- `旁白`
- `用户`
- one named character

Expected:

- Frontend submitted role names match the intended mapping.
- Backend uses the mapped voice.
- `segments_meta` exposes the actual voice used.
- UI displays actual segment voice when available.
- Renaming or switching current Tavo character does not duplicate stale mappings.
- The frontend must not force non-quoted LLM segments back to `旁白`; role ownership belongs to the LLM, while the frontend only normalizes aliases and maps roles to voices.

## Mobile Audio Guard

For any playback lifecycle change, validate in real Tavo or emulator:

- live stream starts from a user gesture;
- saved/cache audio uses native audio when possible;
- play/pause works after background/foreground switch;
- seeking saved audio does not refetch or restart unexpectedly;
- failed stream does not poison the audio element;
- subtitles remain aligned after resume.
- live streaming may wait for saved cache on mobile WebView; saved playback quality/background behavior is the non-regression priority.

## LLM Parse Guard

For intelligent mode:

- Normal Tavo intelligent generation must not call `/parse_text` from the frontend. Frontend `/parse_text` request count should be `0`.
- Frontend submits one `/tts_dialogue_stream_job` body containing `text`, `voices`, `llm_endpoint`, `llm_model`, `llm_api_key`, `reuse_llm_parse`, `user_name`, `character_name`, `roles_hint`, and generation parameters.
- Backend owns LLM parsing, parse reuse/fingerprint, validation, TTS scheduling, and status/error reporting.
- Changing message text, user/character names, role hints, LLM endpoint/model/key, prompt version, voice map, or generation parameters should change the relevant backend parse/audio cache key.
- Backend LLM failures surface through `/tts_dialogue_job_status/{cache_key}` with `state=failed`, `metrics.phase=llm_parse_failed`, and a concise `error` string.
- The `reuseLlmParse` checkbox should be visible in multi-role settings and default to enabled.
- `/parse_text` may remain as a compatibility/manual proxy endpoint, but it is not the normal Tavo generation path.

## Normal Mode Guard

For 普通模式:

- Frontend submits `parse_mode=normal`.
- Frontend submits `voices.default`, `voices.旁白`, and `voices.对白`; if only default is configured, 旁白/对白 should map to default.
- Settings UI shows 默认/旁白/对话 as fixed rows; 默认 is locked display-only and 旁白/对话 are picker buttons.
- Frontend does not submit LLM endpoint/model/key in normal mode.
- Backend strips tags/script/style/template content, removes emoji/control noise, splits quoted dialogue into `对白`, and maps the rest to `旁白`.

## Launcher Environment Guard

For `Leon_api/环境检查/LEON启动器.ps1`:

- `LEON_LAUNCHER_SMOKE_TEST=1` should build and dispose the launcher without starting the API service.
- The WinForms form should load `leon-launcher.ico` as `Form.Icon` and set a LEON AppUserModelID so the taskbar does not fall back to the PowerShell identity where Windows supports it.
- Opening the launcher may run environment detection, but it must not call `Start-LeonService` automatically. Backend startup should require clicking the large lower-left `启动 LEON 服务` button.
- The sidebar should not contain a second small `启动服务` button that competes with the primary start action.
- The center first tab should be `首页日志`, receive launcher logs, and refresh backend logs from `/server_log/tail` when the API is available. The `首页 / 日志` sidebar button should return to this view after using other launcher functions.
- The launcher may call `/warmup` only after a user-triggered service start reaches `/health`; it must not warm the model just because the launcher window opened.
- Backend `/warmup` should run a tiny inference under `tts_stream_lock`, return warmup state through `GET /warmup`, and avoid rerunning unless `force=true`.
- The launcher should expose the existing root Gradio WebUI through a `WebUI` page without auto-starting it. `启动 WebUI` should call `go-webui-VLLM-NoQwen.bat`, poll `http://127.0.0.1:7860`, and keep `浏览器打开` as the reliable path if embedded WebBrowser rendering fails.
- The SVML check must prefer runtime evidence over global DLL presence. If `indextts2runtime\python.exe` can import `torch` and `vllm`, the `Intel SVML 兼容兜底` row should be OK even when `svml_dispmd.dll` is absent from `C:\Windows\System32` and global PATH.
- One-click repair should copy bundled `svml_dispmd.dll` into the project runtime only when Torch/vLLM import output indicates SVML, LLVM, or DLL load failure. It should not blindly write `svml_dispmd.dll` to `C:\Windows\System32`.

## Secret Scan

Before commit or sharing docs:

```powershell
rg -n "sk-[A-Za-z0-9]{8,}" Leon_api static indextts *.py README.md
rg -n "api[_-]?key|Authorization|Bearer" Leon_api/docs static indextts *.py
```

Do not add real keys to docs or static defaults. Local private files should stay out of git.
