# Regression

## Basic Checks

Run before handing off code changes when relevant:

```powershell
python -m py_compile vllm\indextts2_api.py vllm\indextts\infer_vllm_v2.py vllm\indextts\gpt\model_vllm_v2.py fast6g\indextts2_api.py fast6g\indextts\infer_v2.py
node --check static\tavo.js
node --check static\tavo.runtime.js
node --check dev_workspace\dev_tools\test_tavo_widget_playwright.js
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

## vLLM Startup Guard

When validating `vllm` startup with CUDA kernel enabled:

- `/health` should return `version=vllm` and the selected Qwen/LLM flags.
- `/health` should expose the active vLLM startup ratio as `vllm_gpu_memory_utilization` and should also expose `vllm_enforce_eager`.
- `/health` alone is not enough after a restart. Confirm the listening API PID changed from the previous instance and that exactly one expected worker child belongs to the new API PID.
- Startup logs should show only the active `indextts/s2mel/modules/bigvgan/alias_free_activation/cuda` extension path for BigVGAN CUDA preload.
- Startup logs should not compile or load the legacy `indextts/BigVGAN/alias_free_activation/cuda` extension tree.
- Fresh startup stderr logs must not contain fatal worker errors such as `No available memory for the cache blocks`, `Error in memory profiling`, `EngineCore failed to start`, or `EngineCore encountered an issue`.
- With `--fp16`, the main-process GPT wrapper should run half precision/autocast, matching the non-vLLM backend pattern.
- Record API PID, vLLM worker PID, selected `gpu_memory_utilization`, and idle GPU memory after `/health`.
- Run one short `/warmup` after a vLLM FP16 change to catch dtype incompatibility before using Tavo.
- `gpu_memory_utilization=0.08` failed on this machine with no available KV cache memory; do not expose it as a normal launcher preset unless a later architecture change creates more headroom.
- For the current 12 GB RTX 3060 setup, `0.11` and `0.15` are the useful ratio range. In the 2026-06-06 fixed long multi-role benchmark, `0.11` averaged `RTF 1.037` with `10451 MiB` peak VRAM, `0.15` averaged `RTF 1.033` with `10847 MiB` peak VRAM, `0.20` slowed to `RTF 1.111`, and `0.25` collapsed to `RTF 2.875` with S2Mel/BigVGAN timing spikes. Do not chase full VRAM/100% utilization; keep headroom for S2Mel, BigVGAN, and temporary CUDA allocations.
- Launcher and low-level restart defaults should use `0.15` unless the user types another valid value. `0.11` remains the conservative option, but the launcher control must be directly editable instead of a fixed dropdown.

## Benchmark Fail-Fast Guard

For long RTF benchmarks:

- Use a helper with fail-fast guards, currently `dev_workspace/dev_tools/benchmark_vllm_gpu_ratios.py`.
- Default helper mode must benchmark the current launcher-started service without restarting or killing it. Use `--restart-service` only when intentionally changing vLLM ratio or testing restart behavior.
- Before a real synthesis job, run a current-service dry-run such as `vllm\indextts2runtime\python.exe dev_workspace\dev_tools\benchmark_vllm_gpu_ratios.py --skip-warmup --runs 0 --ratios 0.15` and confirm it reports `/health`, resolved voices, API PID, and GPU snapshot without starting a new service.
- Preflight must record baseline GPU memory and active project Python PIDs.
- Restart must prove a new API PID and worker PID, not just a healthy `/health` response.
- Run `/warmup` once before measuring, then check warmup GPU memory before submitting a long job.
- If warmup GPU memory is near full, stop. Do not run the long sample.
- If a job's running GPU memory crosses the guard threshold, cancel the job and stop the benchmark.
- If the first completed run has abnormal RTF, stop remaining runs and report the abnormal result.
- Warmup and synthesis wall-time guards must cancel or stop the job instead of silently waiting for many minutes.
- User-facing progress updates must include current run index, segment progress, elapsed time, GPU memory, and current RTF when available, so the user does not have to infer status from Task Manager.

## Style Reference Guard

For AI/custom segments that use `style`, `style_alpha`, or `emo_ref_audio_path`:

- Old cache refs like `prompts/library/声腔/moan_soft.wav` must not be treated as a supported built-in style unless the style is explicitly restored and validated.
- `/voices` may list `声腔/`素材 because the user may manually choose them as voice configuration; this is not a bug by itself.
- Voice/style lookup should accept references with `prompts/library/` or `library/` prefixes and should retry without stale file extensions.
- English style ids used by the LLM should map only to available local `声腔` files. `moan_soft` is currently removed from the advertised style map because the local asset was bad/removed.
- A bad or too-short style file should fail clearly or be avoided through explicit mapping; it must not silently turn `uses_style_audio=false` for a segment that requested a known style.
- Regression sample: use the user's 甘婷婷 cache JSON/WAV and run supported styles such as `scream_peak` and `laugh_soft` on `fast6g`; completed metadata should show `uses_style_audio=true` and `/cache_audio/<key>` should return `HTTP 200`. Do not use `moan_soft` until a real valid asset is restored.

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

Use the fixed test runner described in `dev_workspace/README.md`:

```powershell
node dev_workspace\dev_tools\test_tavo_widget_playwright.js
```

The smoke test is not a replacement for real Tavo, but it should catch syntax, initial mount, accidental `/voices` requests, and obvious UI breakage.

Current lazy-loader assertions:

- first paint has `.idx-lazy-card` and no `.idx-card`;
- first paint has no `[data-role="lazy-gear"]`;
- first paint has `0` `/voices`, `0` TTS job requests, and `0` runtime manifest/part fetches;
- first click on the lazy card immediately shows a full-size loader shell `.idx-card[data-loader-shell="1"]` with visible loading status;
- the loader shell still has `0` `/voices` and `0` TTS job requests before the real runtime takes over;
- loader shell buttons may queue actions for the runtime, but they must not directly call `/tts_dialogue_stream_job` or `/voices`;
- loader shell must not render a fake `.idx-seek` progress bar before runtime takeover, and its default cover should use `static/tavo.assets/narrator.png`;
- opening runtime and clicking the player settings button opens the compact settings panel;
- runtime loads exactly one manifest and all 16 parts;
- opening settings still does not request `/voices` or create a TTS job;
- settings and voice-picker dialogs should have one outer border only; computed dialog host outline should remain `none` / `0px`;
- settings panel is aligned with the player card and its close button is at least 30px square;
- opening the voice picker requests `/voices`, renders voice items, and has at least 540px height on desktop smoke;
- settings exposes `AI模式` / `普通模式` with `AI模式` rendered first, and the player quick toggle defaults to `L`;
- simulated `data-live-active=1` keeps `[data-role="live-exit"]` visible despite `.idx-hidden`;
- player card keeps a stable minimum height so pending/live/saved state changes do not resize the card;
- settings section order starts with the large AI/normal mode buttons, then `合成质量` -> voice mapping -> `播放 / 离线`; the redundant `文本模式` title must not render;
- AI role mapping must not include normal-only `对白` / `对话` / `台词` / `dialogue` rows by default. Normal mode always submits `voices.default` and `voices.旁白` when narrator is configured; blank `对白` must be omitted so it inherits narrator/default. Explicit `对白` must submit all dialogue aliases with the user-selected voice.
- player header keeps only the `L`/`D` playback toggle and settings button aligned with avatar/name/status;
- playback mode is a direct `L`/`D` toggle and does not render a dropdown menu;
- delete lives inside the subtitle panel, not the header;
- player home controls do not expose visible 10-second rewind/forward buttons;
- music/add and play controls share the same size;
- history page counter floats inside the subtitle panel top-right and does not intercept taps;
- subtitle container must not use a mask/fade that also fades the floating delete/counter controls;
- role hint/status under the title stays single-line ellipsis after header space is freed;
- live exit is circular and play-sized;
- LIVE starts real WebAudio streaming by default: one `POST /tts_dialogue_stream_job`, then `GET /tts_dialogue_stream_job/<cache_key>`. Early live failures must reconnect the same `cache_key` instead of creating a second `POST`. The frontend must not block opening the live stream on a pre-live `/tts_dialogue_job_status` refresh.
- Exhausted same-key LIVE recovery must return to a resumable idle state instead of forcing saved-cache autoplay. The backend may still finish and cache the audio in the background, but manual play should reconnect the same live stream/cache key without another `POST` or `DELETE`.
- LIVE header status should keep the stable voice label and reject transient progress text; the lyric panel should show later planned lines from `segments_plan` while only the first `segments_meta` is complete; current time and the progress meter should keep moving beyond that first segment.
- clicking play on a waiting LIVE card must not immediately show `已暂停`;
- normal-mode voice rows use the same row layout as role mapping and show only `旁白` / `对白`; `旁白` opens the picker for narrator/default, `对白` opens a separate picker and has a clear button for inheriting narrator;
- subtitle height remains `172px` for four visible lyric rows.

## Cache / Snapshot Regression

For a generated `cache_key`:

```powershell
curl.exe --noproxy "*" -I http://127.0.0.1:9880/cache_audio/<cache_key>
curl.exe --noproxy "*" -s http://127.0.0.1:9880/tts_dialogue_job_status/<cache_key>
curl.exe --noproxy "*" -H "Range: bytes=0-99" http://127.0.0.1:9880/cache_audio/<cache_key>
D:\apiWorkSpace\leon_api\vllm\indextts2runtime\python.exe dev_workspace\dev_tools\test_snapshot_cache_readable.py
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

Live/pending tracks are not history. A live card may show `L`, and a background job may show `D`, but the saved history count must only change after `/tts_dialogue_job_status/<cache_key>` reports `done` and the card switches to saved/cache audio.

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
3. Clicking play on a waiting/pending LIVE card immediately shows a compact waiting-audio state and uses WebAudio by default unless `noWebAudioLive=1`, `nativeLive=1`, or `elementLive=1` changes that path. It must not say `音频已排队`, because that is only a frontend WebAudio scheduling state, not backend queueing or duplicate job creation.
4. Clicking play again while LIVE is loading, buffering, streaming, or playing should pause/stop the current live connection cleanly; it must not create a second job or flip through confusing saved-cache states.
5. Clicking live exit first checks status once; if status is `done`, the card becomes saved, otherwise the frontend calls `DELETE /tts_dialogue_stream_job/<cache_key>`.
6. Exiting live removes only the transient live card and keeps existing saved history count unchanged.
7. After status becomes `done`, the same card switches to a normal saved card with `/cache_audio/<cache_key>`. If foreground LIVE polling sees `/cache_audio/<cache_key>` is already readable via `HEAD`, it may switch to saved before the status endpoint catches up; this fallback must not run for failed/cancelled/background-generate jobs.
8. If live playback starts before `track.segments` is populated, subtitles must still keep polling `/tts_dialogue_job_status/<cache_key>` and render lyrics as soon as `segments_meta` arrives.
9. Early repeated WebAudio underrun should first retry the same `cache_key` live buffer. If same-job recovery is exhausted, the card should become idle/resumable and keep background cache polling alive; it must not force saved-cache autoplay or block manual live resume.
10. Transient progress such as `等待音频`, `后端处理中 Ns`, `后端正在合成`, `正在连接音频`, `收到音频`, and `网络缓冲中` must update only compact status/log state, not replace the lyric panel once lyrics or waiting-lyrics state is present.
11. LIVE pause/resume must preserve the current WebAudio second and reconnect the same `cache_key` from that point. It must not send another `POST /tts_dialogue_stream_job` and must not restart from `00:00` unless the user explicitly starts a new generation.
12. When completed cache audio is autoplayed or force-mounted as native `<audio>`, the previous WebAudio controller/source, timers, subtitles, and stale `webAudioPlaying` state must be stopped first to prevent double audio.
13. Cache landing after LIVE fallback must either promote cleanly to saved/cache audio under user control or return to an idle tappable state. It must never leave a permanent loading spinner or create two audible playback paths.
14. WebAudio LIVE resume must request `/tts_dialogue_stream_job/<cache_key>?start_s=<last_second>` while preserving the UI/media timeline. Because the backend already starts the stream at `start_s`, WebAudio must not also discard the same seconds of returned PCM.
15. Pending LIVE jobs restored from Tavo/localStorage must keep `playbackMode=live`, `state=live`, and the last resume seconds (`lastWebAudioSec` / `lastElementSec` / `lastStalledSec`). D-mode pending jobs remain background/pending.
16. The avatar-side status line must not show transient generation/progress phrases such as `等待音频`, `后端处理中`, `后端正在合成`, `正在连接音频`, `收到音频`, or `网络缓冲中` while a current track exists. It should fall back to the current stable voice/role label.
17. LIVE subtitles should render planned later lyrics from `segments_plan` as soon as backend parsing is done, even when only the first completed `segments_meta` has real timing. WebAudio current time/progress must keep moving beyond the first known segment duration; partial metadata must not clamp the player at the first line.

For a background `生成` dialogue job:

1. The player does not open `GET /tts_dialogue_stream_job/<cache_key>`.
2. The frontend polls `/tts_dialogue_job_status/<cache_key>`.
3. Deleting the pending card calls `DELETE /tts_dialogue_stream_job/<cache_key>` and clears pending storage.
4. Returning to the message restores pending jobs and continues polling until saved/failed/cancelled.
5. A `D` job must not be pushed into the active `generatedTracks` list as a special card. It should join saved history only after done, then behave like ordinary history audio.
6. Previous/next should cycle through saved tracks: from `14/14` next goes to `1/14`, and from `1/14` previous goes to `14/14`.

## Saved Audio Background Guard

For saved/cache audio playback:

- Saved tracks must use the native `<audio>` element with `/cache_audio/<cache_key>` or an offline object URL.
- Saved seek, rewind, forward, MediaSession controls, subtitles, and background/lock-screen playback must keep working.
- The live WebAudio/live fallback path must not replace saved playback with WebAudio.
- A WebAudio-to-native cache handoff must seek the native element to the preserved live playback second instead of replaying from the start.
- `loadedmetadata` and `timeupdate` may disable seek for live tracks only; they must leave saved tracks seekable when duration is known.
- A live stream code=4 must clear/fallback the live stream without poisoning the saved audio element for the next saved track.
- Offline save/read failure must not block online `/cache_audio/<cache_key>` playback. If a local blob fails, clear it and try online; if online direct media playback fails, show a readable WebView/source message and try a temporary fetched blob.
- UI must not show raw browser media numeric errors such as `code=4` to the user.

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
- live streaming must first use same-job live recovery on mobile WebView; only after recovery is exhausted may it wait for saved cache as an audible fallback. Saved playback quality/background behavior is still a non-regression priority.
- failed/cancelled LIVE cards must hide the LIVE exit button and play must not re-enter loading/generating.
- displayed current time must not exceed displayed total duration; subtitles should remain on the final line after playback end.
- If live cache lands while WebAudio is active, there must be only one audible playback path after handoff, and the visible play/pause control must stop the sound that is actually playing.

## LLM Parse Guard

For intelligent mode:

- Normal Tavo intelligent generation must not call `/parse_text` from the frontend. Frontend `/parse_text` request count should be `0`.
- Frontend submits one `/tts_dialogue_stream_job` body containing `text`, `voices`, `llm_endpoint`, `llm_model`, `llm_api_key`, `reuse_llm_parse`, `user_name`, `character_name`, `roles_hint`, and generation parameters.
- Backend owns LLM parsing, parse reuse/fingerprint, validation, TTS scheduling, and status/error reporting.
- Changing message text, user/character names, role hints, LLM endpoint/model/key, prompt version, voice map, or generation parameters should change the relevant backend parse/audio cache key.
- Backend LLM failures surface through `/tts_dialogue_job_status/{cache_key}` with `state=failed`, `metrics.phase=llm_parse_failed`, and a concise `error` string.
- The `reuseLlmParse` checkbox should be visible in multi-role settings and default to enabled.
- `/parse_text` may remain as a compatibility/manual proxy endpoint, but it is not the normal Tavo generation path.
- Both `vllm` and `fast6g` should accept `parse_mode=ai` through `/tts_dialogue_stream_job`; `fast6g` uses the same OpenAI-compatible backend parse helper but its TTS inference path remains the 6G backend.
- When Qwen emotion is enabled at backend startup, LLM/custom segments may contain `style`, `style_alpha`, `emo_ref_audio_path`, `emo_vec`, or `emo_alpha`, but synthesis/cache identity must ignore those fields and use Qwen text-emotion instead. AI parsing should return per-segment `emo_text`; synthesis must pass that `emo_text` to IndexTTS2/QwenEmotion and only fall back to the segment text when `emo_text` is missing.

## Normal Mode Guard

For 普通模式:

- Frontend submits `parse_mode=normal`.
- Frontend submits `voices.default` and `voices.旁白` for the narrator/default voice.
- If `对白` is blank, frontend must not submit `voices.对白`; backend fallback should inherit `default` / `旁白`.
- If `对白` is explicitly configured, frontend must submit `voices.对白`, `voices.对话`, `voices.台词`, and `voices.dialogue` with the exact selected voice. Empty duplicate aliases must not overwrite a non-empty explicit dialogue voice.
- Settings UI shows only fixed rows `旁白` and `对白`; there is no visible `默认` row. `旁白` is the default/narrator picker; `对白` is optional and can be cleared to inherit.
- Frontend does not submit LLM endpoint/model/key in normal mode.
- Backend strips tags/script/style/template content, removes emoji/control noise, splits quoted dialogue into `对白`, and maps the rest to `旁白`.
- Backend normalizes `对白` / `对话` / `台词` / `dialogue` to canonical `对白` before resolving voice paths and cache payloads.
- Frontend should prefer cleaned `tavo.message.current().content` over rendered DOM text whenever API content exists. DOM text is fallback only, so sender names, page labels, `assistant message mock`, and player chrome must not enter submitted `body.text`.

## Launcher Environment Guard

For `launcher/LEON-Launcher.ps1`:

- `LEON_LAUNCHER_SMOKE_TEST=1` should build and dispose the launcher without starting the API service.
- The WinForms form should load `leon-launcher.ico` as `Form.Icon` and set a LEON AppUserModelID so the taskbar does not fall back to the PowerShell identity where Windows supports it.
- Opening the launcher must not run environment detection and must not call `Start-LeonService` automatically. LEON service startup should require clicking the large lower-left `启动 LEON 服务` button.
- Opening the launcher must not run environment detection automatically and must not refresh voices/log pages automatically. It should only check cheap `/health` for the start/stop button state.
- The launcher should not show both left navigation and a top tab strip. Keep a single clean surface: service start/stop, service version, editable vLLM ratio, environment detection, and one-click repair.
- The sidebar should not contain a second small `启动服务` or `停止服务` button that competes with the primary service button. The primary button starts the service when stopped and stops it when running.
- The primary start/stop button must be in a fixed left-bottom area and visible at the default `1120x760` window and the minimum supported window size. Do not position it only by raw sidebar height math.
- Service version and vLLM ratio should share one compact row directly above the start/stop button. Use a styled two-button selector such as `vLLM` / `6G`, not a white dropdown. The ratio input appears only for `vllm`, is centered, and `fast6g` hides it.
- Left navigation should show an active state. Content panels should not repeat the selected nav label as a large title.
- `环境检测` in the sidebar only opens the environment page and preloads fixed `待检测` rows. Only the page-level `开始检测` button should execute `Run-EnvironmentCheck`.
- `一键修复` must be linked to the latest completed `开始检测` result. If no completed check exists, clicking it should keep the current rows, keep progress at `0`, log a cancelled repair, and show a concise "先开始检测" status. It must not call `Run-EnvironmentCheck`, must not call `Initialize-EnvironmentCheckRows`, and must not run fresh SVML / VS / CUDA / ninja probes just to decide what to repair.
- Home logs should use separated tab-button sources, currently `启动器`, `服务日志`, `服务启动`, and `诊断日志`, with readable text labels and a visible selected state. `服务日志` is API runtime log, `服务启动` is process stdout startup log, and `诊断日志` is stderr/warnings/progress/traceback output. Do not call stderr `错误输出`. Do not stack multiple clipped log text boxes vertically, and do not use a native WinForms `TabControl` that renders as grey blocks or hides tab text.
- The green progress bar belongs inside the environment detection page only, not in the header/banner.
- Environment check results should avoid harsh `ListView.GridLines`; use a quieter list/table without grid lines.
- One-click repair should live inside the `环境检测` page as a page-level button, not as a separate sidebar page. It should be quiet when nothing needs repair: no completion popup and no misleading service/background wording.
- No launcher page should auto-scroll or jump logs during normal use. Hidden/removed diagnostic pages such as Tavo instructions, WebUI, voice test, and log viewer should not appear in the simplified UI.
- The launcher may call `/warmup` only after a user-triggered service start reaches `/health`; it must not warm the model just because the launcher window opened.
- Backend `/warmup` should run a tiny inference under `tts_stream_lock`, return warmup state through `GET /warmup`, and avoid rerunning unless `force=true`.
- The launcher should expose the selected version Gradio WebUI through a `WebUI` page without auto-starting it. `启动 WebUI` should call the current version WebUI script, poll `http://127.0.0.1:7860`, and keep `浏览器打开` as the reliable path if embedded WebBrowser rendering fails.
- The launcher should select backend version (`vllm` / `fast6g`) before startup, pass `LEON_ENABLE_QWEN_EMO` from the Qwen checkbox, and pass `INDEXTTS_VLLM_GPU_MEMORY_UTILIZATION` for vLLM only.
- The Qwen emotion checkbox applies to both `vllm` and `fast6g`; the vLLM GPU memory ratio control is vLLM-only and should be disabled or clearly marked when `fast6g` is selected.
- Public Tavo host must not be launcher/backend configuration. Real tunnel hostnames must not be committed to repo docs or source. Tavo may load `static/tavo.js` from any reachable host; the runtime should use the loaded script origin for API calls.
- The SVML check must prefer runtime evidence over global DLL presence. If `indextts2runtime\python.exe` can import `torch` and `vllm`, the `Intel SVML 兼容兜底` row should be OK even when `svml_dispmd.dll` is absent from `C:\Windows\System32` and global PATH.
- One-click repair should copy bundled `svml_dispmd.dll` into the project runtime only when Torch/vLLM import output indicates SVML, LLVM, or DLL load failure. It should not blindly write `svml_dispmd.dll` to `C:\Windows\System32`.

## Secret Scan

Before commit or sharing docs:

```powershell
rg -n "sk-[A-Za-z0-9]{8,}" dev_workspace static vllm fast6g README.md
rg -n "api[_-]?key|Authorization|Bearer" dev_workspace/docs static vllm fast6g
```

Do not add real keys to docs or static defaults. Local private files should stay out of git.

