# Agent State

Updated: 2026-06-07

## Current Goal

Finish the root workspace migration and keep IndexTTS2 as the Tavo mainline without copying GPT-SoVITS engine behavior into this project.

## Latest Fix Snapshot: Tavo Normal Mapping / Cleaner / LIVE Resume v13

Updated: 2026-06-07

Fix now in code:

- `static/tavo.js`, `static/tavo.runtime.js`, `static/tavo.runtime.manifest.json`, and `README.md` are bumped to `20260607-live-audio-v15`.
- Normal mode settings show only `旁白` and `对白`. `对白` blank is omitted from request voices and inherits narrator/default; explicit `对白` submits all aliases: `对白`, `对话`, `台词`, `dialogue`.
- Frontend and both backends canonicalize dialogue aliases to `对白`; duplicate empty aliases no longer overwrite a non-empty user-selected dialogue voice.
- Normal-mode text cleaning now removes tag blocks plus their contents, residual tags, Tavo script markers, injected player/UI controls, emoji/symbol noise, and hidden AR fragments before submitting text. Both backend versions also run stricter normal-text sanitation.
- Follow-up audit fix: `currentMessageContext()` now prefers cleaned `tavo.message.current().content` over rendered DOM text, so sender/header/test chrome cannot override the actual API message body.
- LIVE stream recovery exhaustion now returns the card to an idle/resumable state on the same `cache_key` instead of forcing saved-cache autoplay. Manual play reconnects the same stream and must not create another job or delete audio.
- Follow-up audit fix: WebAudio LIVE resume now requests the backend stream with `?start_s=<last_second>`, separates backend offset from local PCM skipping, and persists/restores LIVE pending resume seconds (`lastWebAudioSec`, `lastElementSec`, `lastStalledSec`) across Tavo re-entry.
- LIVE header/status follow-up: transient progress such as `正在合成音频` / `后端处理中` is suppressed from the avatar-side status line while a track exists; the line falls back to the stable current voice/role label.
- LIVE subtitle/progress follow-up: backend status now exposes `segments_plan` and live `duration_s`; the frontend merges planned lyrics with completed `segments_meta`, so later lyrics can render before their audio segment has fully completed, and WebAudio progress is no longer clamped to the first known segment duration.
- Settings expose `自定义` synthesis parameters and submit the custom generation values already accepted by the backends.

Validation target for this snapshot:

```powershell
node --check static\tavo.js
node --check static\tavo.runtime.js
node --check dev_workspace\dev_tools\test_tavo_widget_playwright.js
python -m py_compile vllm\indextts2_api.py fast6g\indextts2_api.py vllm\indextts\llm_proxy.py fast6g\indextts\llm_proxy.py
$env:TAVO_TEST_URL='http://127.0.0.1:9882/static/tavo_widget_test.html'; node dev_workspace\dev_tools\test_tavo_widget_playwright.js
```

Latest Playwright v13 follow-up also asserts:

- normal request text does not include DOM chrome such as `assistant message mock`;
- restored LIVE resume sends `GET /tts_dialogue_stream_job/<cache_key>?start_s=2.750` with no extra `POST` or `DELETE`.
- LIVE planned-subtitle smoke keeps the header status at a stable voice label (`高圆圆` in mock), renders second/third planned lyric lines while only the first `segments_meta` has timing, and keeps current time/progress moving past the first segment.

## Latest Fix Snapshot: Tavo First-Open Player Shell v12

Updated: 2026-06-06

User clarified the first-open player optimization: the actual load time can stay similar, but tapping the lazy card should show a full player surface immediately while runtime loading continues invisibly.

Fix now in code:

- This older first-open shell snapshot used the previous v12 cache-bust. Current cache-bust is recorded in the v13 snapshot above.
- `static/tavo.js` still keeps first paint cheap: no runtime, no manifest/parts, no `/voices`, and no TTS job before user interaction.
- On first click, the loader immediately renders a full-size `.idx-card[data-loader-shell="1"]` that mirrors the real player layout and shows visible loading state.
- Loader-shell buttons queue the intended action and forward it after the real runtime mounts. This covers play, generate/add, settings, prev/next, delete, and L/D toggle.
- The loader shell does not change LIVE job semantics: it does not create `/tts_dialogue_stream_job` by itself and it keeps the WebAudio user-gesture priming path for play/add.
- v12 visual cleanup removes the fake seek/progress bar from the loader shell, uses `static/tavo.assets/narrator.png` as the default loader cover, and removes the extra dialog focus ring from settings/picker so only one outer border remains.
- `dev_workspace/dev_tools/test_tavo_widget_playwright.js` now asserts the immediate shell appears synchronously after lazy click, still has `/voices=0` and job requests `0`, has no loader `.idx-seek`, uses the narrator cover, and keeps settings/picker dialog outline at `none` / `0px`.

Validation passed on a temporary static server at `http://127.0.0.1:9882/static/tavo_widget_test.html`:

```powershell
node --check static\tavo.js
node --check static\tavo.runtime.js
node --check dev_workspace\dev_tools\test_tavo_widget_playwright.js
git diff --check -- static/tavo.js static/tavo.runtime.js static/tavo.runtime.manifest.json README.md dev_workspace/dev_tools/test_tavo_widget_playwright.js dev_workspace/docs/BUGS.md
$env:TAVO_TEST_URL='http://127.0.0.1:9882/static/tavo_widget_test.html'; node dev_workspace\dev_tools\test_tavo_widget_playwright.js
```

Playwright still passed the LIVE guards: one generation `POST`, same-key stream reconnects, and exhausted recovery auto-mounts `/cache_audio/<cache_key>` without leaving the play button spinning.

## Latest Fix Snapshot: Tavo LIVE Playback Lifecycle v10

Updated: 2026-06-06

User clarified the key LIVE regression:落盘兜底 is allowed and must work, but LIVE must first try the backend live buffer and should not silently skip audible streaming before the cache file lands. If LIVE recovery exhausts, saved/cache audio must auto-play or stop loading cleanly.

Fix now in code:

- `static/tavo.js`, `static/tavo.runtime.js`, and `static/tavo.runtime.manifest.json` are bumped to `20260606-live-audio-v10`.
- `static/tavo.runtime.parts/60_generate_flow.js` no longer blocks LIVE startup on a pre-live status refresh. Status/segments metadata refresh runs in the background while WebAudio immediately opens `GET /tts_dialogue_stream_job/<cache_key>`.
- `static/tavo.runtime.parts/46_track_state.js` keeps same-job recovery on the original `cache_key`, increases recovery attempts, and only sets `playSavedWhenReady` when entering the actual saved-cache fallback.
- `static/tavo.runtime.parts/48_track_history.js` decides saved-cache fallback autoplay before `setTrackState(saved)` resets loading/buffering state, stops WebAudio before native cache handoff, seeks to the preserved second, and settles `audio.play()` success/reject so loading cannot spin forever.
- `static/tavo.runtime.parts/44_element_audio.js` clears loading when native playback is rejected by the WebView.
- `static/tavo.runtime.parts/52_subtitle_media.js` keeps transient progress including `后端处理中 Ns` out of the lyric panel.
- `dev_workspace/dev_tools/test_tavo_widget_playwright.js` now asserts one LIVE `POST`, same-key stream reconnects, no transient LIVE progress text in the lyric panel, and exhausted same-key stream recovery auto-plays `/cache_audio/<cache_key>` without leaving the play button loading.

Validated with Playwright mock on `http://127.0.0.1:9882/static/tavo_widget_test.html`: LIVE fallback submitted one `POST`, opened four same-key stream `GET`s, then mounted `/cache_audio/dddd...dddd` as native saved audio and ended with `playState=playing`.

Still requires real Tavo/mobile validation: confirm real LIVE becomes audible before cache landing when backend first PCM is available, pause/resume continues from the current second, and cache landing does not leave an unkillable WebAudio voice or a spinning play button.

## Latest Fix Snapshot: Tavo LIVE Same-Job Audio Recovery

Updated: 2026-06-06

User reported that Tavo LIVE streaming reached the WebAudio path but the phone had no audible sound. The product constraint is unchanged: LIVE must stay streaming. Do not replace it with default落盘 playback.

Fix now in code:

- `static/tavo.js`, `static/tavo.runtime.js`, and `static/tavo.runtime.manifest.json` are bumped to `20260606-live-audio-v8`.
- `static/tavo.runtime.parts/20_generation_params.js` reuses the loader-created, user-gesture AudioContext and keeps the WebAudio output chain warm.
- `static/tavo.runtime.parts/25_web_audio_stream.js` now supports configurable `prebufferSec` / `flushSec`, starts with a larger default prebuffer, and emits `stable_playing` only after the scheduled buffer survives the early window.
- `static/tavo.runtime.parts/46_track_state.js` now treats early `buffering`, `audio_suspended`, `interrupted`, and network stream failures as same-job recovery triggers.
- `static/tavo.runtime.parts/40_mount_shell.js` removes the redundant `文本模式` title above the large AI/normal mode buttons.
- Recovery reconnects `GET /tts_dialogue_stream_job/<cache_key>` on the same cache key with larger prebuffer. It must not send another `POST /tts_dialogue_stream_job`.
- Only after same-job recovery attempts are exhausted does the frontend wait for `/cache_audio/<cache_key>` as the last audible fallback.
- `dev_workspace/dev_tools/test_tavo_widget_playwright.js` now guards the key behavior: one LIVE `POST`, repeated same-key stream `GET`, no re-POST during recovery.

Validation:

```powershell
node --check static\tavo.js
node --check static\tavo.runtime.js
node --check static\tavo.runtime.parts\20_generation_params.js
node --check static\tavo.runtime.parts\25_web_audio_stream.js
node --check static\tavo.runtime.parts\46_track_state.js
node --check dev_workspace\dev_tools\test_tavo_widget_playwright.js
node dev_workspace\dev_tools\test_tavo_widget_playwright.js
git diff --check
```

The Playwright mock passed on `http://127.0.0.1:9882/static/tavo_widget_test.html`: LIVE submitted exactly one generation job, the first stream GET was forced to fail, and recovery opened `GET /tts_dialogue_stream_job/cccccccccccccccccccccccccccccccccccccccc` twice with the same cache key. No second generation POST was made.

Runtime note:

- The interrupted local static test server on `127.0.0.1:9880` left PID `5504`; it was confirmed as `python -m http.server` and stopped.
- The real vLLM API remained running on `0.0.0.0:9880` as PID `16000` with worker PID `8076`.
- `/health` currently reports `version=vllm`, `qwen_emo=false`, `vllm_gpu_memory_utilization=0.15`, and `vllm_enforce_eager=true`.
- `nvidia-smi` showed about `10755 MiB / 12288 MiB` used with low GPU utilization. That is model/KV/CUDA context residency from the warm vLLM service, not active synthesis. It will not release fully unless the service processes are stopped.

Real Tavo/mobile validation is still required: confirm that LIVE is audible after loading the v7 script, that early silent/stalled playback performs same-cache recovery, and that saved/cache audio still uses native `<audio>` for background/lock-screen behavior.

## Latest Validation Snapshot: vLLM GPU Ratio RTF Benchmark

Updated: 2026-06-06

The fixed long multi-role sample from the user's 甘婷婷 readable cache was benchmarked on `vllm` with `gpu_memory_utilization` values `0.11`, `0.15`, `0.20`, and `0.25`, three fresh uncached runs each.

Input / params:

- Source JSON: `vllm/outputs/cache/by_role/甘婷婷/20260606-013108-395_263429152dd8dcd2b2715e80672dbdd93ee9a406.json`.
- Voice mapping used real `/voices` names: `旁白/default -> 400个火爆音色/短剧解说`, `甘婷婷 -> 声腔/低吟-步非烟`, `用户 -> 400个火爆音色/蔡徐坤`.
- The exact requested names `短句解说` and `低吟_步非烟` were not present in `/voices`; the closest available entries above were used.
- Generation tier matched the 16-step expressive setting: `diffusion_steps=16`, `prompt_audio_seconds=12`, `segment_tokens=72`, `first_tokens=24`, `s2mel_cfg_rate=0.7`, `top_p=0.8`, `top_k=30`, `temperature=0.7`, `repetition_penalty=1.2`, `emo_alpha=0.55`, `bypass_cache=true`.
- The benchmark used role/text segments only from the source cache and did not reuse stale style references such as the removed/bad `moan_soft`.

Results:

| vLLM ratio | Runs | Avg RTF | Warm RTF runs 2-3 | Avg wall | Avg GPT gen | Avg S2Mel | Avg BigVGAN | Max peak VRAM |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `0.11` | 3 | `1.037` | `1.038` | `69.772s` | `40.575s` | `24.831s` | `1.323s` | `10451 MiB` |
| `0.15` | 3 | `1.033` | `1.023` | `69.538s` | `40.372s` | `24.811s` | `1.288s` | `10847 MiB` |
| `0.20` | 3 | `1.111` | `1.131` | `74.789s` | `45.372s` | `25.030s` | `1.491s` | `11660 MiB` |
| `0.25` | 3 | `2.875` | `3.575` | `193.260s` | `43.926s` | `137.336s` | `6.526s` | `11992 MiB` |

Conclusion:

- The FP16/autocast fix made the long vLLM path viable near realtime: this sample now runs around `RTF 1.03` at `0.11` / `0.15`, compared with the earlier source cache around `RTF 3.519`.
- `0.15` was slightly fastest, but only by a tiny margin and with about `396 MiB` more peak VRAM than `0.11`.
- `0.11` is the safer long-session default. `0.15` is the speed sweet spot when ComfyUI/SD/other GPU workloads are off.
- `0.20` already trends slower. `0.25` should be avoided: pushing VRAM close to full makes S2Mel jump from about `25s` to about `137s` average and BigVGAN from about `1.3s` to about `6.5s`.
- Do not tune for "GPU/VRAM peak reaches 100%". vLLM ratio only sizes vLLM KV cache; IndexTTS2 still needs headroom for S2Mel, BigVGAN, temporary CUDA allocations, and per-segment orchestration gaps.

The repeatable benchmark helper is `dev_workspace/dev_tools/benchmark_vllm_gpu_ratios.py`. Generated benchmark JSON/logs live under `dev_workspace/benchmarks/` and should stay uncommitted.

## Latest Validation Snapshot: vLLM 0.11 VRAM Pass

Updated: 2026-06-06

Low-risk vLLM startup/VRAM fixes were applied and runtime-validated:

- `vllm/indextts/infer_vllm_v2.py` no longer preloads the legacy `indextts/BigVGAN/alias_free_activation/cuda` extension tree.
- It now preloads the same `indextts/s2mel/modules/bigvgan/alias_free_activation/cuda` extension path that `BigVGAN.from_pretrained()` actually uses.
- The vLLM main-process GPT wrapper now follows the normal backend behavior under `--fp16`: after loading the checkpoint and moving to CUDA, it calls `.half()` and GPT calls run under `torch.amp.autocast(...)`.
- vLLM was restarted on `9880` with `--vllm_gpu_memory_utilization 0.11`, `--cuda_kernel`, `--fp16`, and `--no_qwen_emo`.
- `/health` passed with `version=vllm`, `qwen_emo=false`, and `llm_parse=true`; `/voices` returned `HTTP 200`.
- Final running vLLM processes after restoring `0.11`: API PID `29272`, worker PID `28772`.
- Latest startup logs only show the `s2mel/modules/bigvgan` CUDA extension path; the old `indextts/BigVGAN` path is absent.
- Idle GPU memory after the final `0.11` restart was about `8008 MiB / 12288 MiB`, down from the earlier `~9653 MiB` baseline.
- Short warmup succeeded after the FP16/autocast change: text `你好。`, elapsed `3.295s`, `gpt_gen_time=1.27s`, `gpt_forward_time=0.02s`, `s2mel_time=0.43s`, `bigvgan_time=0.11s`, `RTF=3.6375`. GPU memory after warmup was about `8490 MiB / 12288 MiB`.
- A test restart with `gpu_memory_utilization=0.08` failed. vLLM reported `Available KV cache memory: -0.05 GiB` and `No available memory for the cache blocks`; the half-started process was stopped and `0.11` was restored.

Next performance direction: run a real fixed-text RTF comparison on `vllm 0.11` after the FP16 fix. The main-process GPT cannot simply be removed because it computes the latent passed into S2Mel after vLLM generates semantic codes; deeper savings would require using vLLM hidden states or another latent path and should be treated as higher risk.

## Restart Handoff: 2026-06-06 Push Point

The repository has been moved to `D:\apiWorkSpace\leon_api` and is intended to be the Git root. The current push includes:

- root layout with `vllm/`, `fast6g/`, shared `static/`, shared `launcher/`, shared `scripts/`, and `dev_workspace/`;
- root launcher version selection for `vllm` / `fast6g`;
- Qwen emotion is deprecated on the launcher path and should stay off by default;
- vLLM GPU memory ratio startup option (`0.18` default / `0.11` conservative);
- public tunnel/domain removed from program configuration and docs;
- fixed LAN IP examples removed from tracked code/docs;
- large model/audio/DLL/runtime assets removed from Git tracking and ignored locally.

If this session is restarted, ask Codex:

```text
继续 D:\apiWorkSpace\leon_api。先读 AGENTS.md 和 dev_workspace/docs/AGENT_STATE.md。检查上次 push 的状态，然后继续完成目录迁移后的路径/启动器/版本切换验证；不要恢复大音频/模型文件进 Git，不要写死公网域名或局域网 IP。
```

## Latest Validation Snapshot: fast6g Startup

Updated: 2026-06-06

Verified on `master` after commit `8cd78fd`:

- `fast6g` starts through `scripts/start-fast6g-api.bat` and serves `http://127.0.0.1:9880/health`.
- `/health` reports `version=fast6g`, `engine=fast6g`, `normal_parse=true`, `llm_parse=false`, and `qwen_emo=false` by default.
- `/voices` returns 1109 local voices on this machine. Because `fast6g/prompts/library` is local/empty, `fast6g` now falls back to `LEON_VOICE_LIB_DIR`, root `prompts/library`, then `vllm/prompts/library` when selecting the voice library.
- Short normal-mode dialogue job completed:
  - cache key `7515f69f5c42477ae4e7bb3be3825687ddb6a62d`
  - 1 segment, audio duration `2.334s`
  - total wall `~9.3s` / observed polling elapsed `10.285s`
  - `/cache_audio/<key>` returned `HTTP 200`
  - root cache WAV/JSON and readable `outputs/cache/by_role/旁白/..._<key>.wav/json` were written.
- GPU memory after startup/generation was about `8.1 GB / 12 GB`.
- The first public/private network confirmation can appear because the service binds `0.0.0.0:9880`; the user confirmed it.

Fixes made during validation:

- `fast6g/indextts2_api.py` now resolves the shared/local voice library instead of requiring duplicated audio under `fast6g/prompts/library`.
- `fast6g` now uses the same `indextts/snapshot_cache.py` readable cache helper as `vllm`, so generated caches also create `outputs/cache/by_role/<主角色>/...` entries and delete them with root cache files.
- `launcher/LEON-Launcher.ps1` environment checks use the same voice-library fallback logic, so selecting `fast6g` does not warn incorrectly when voices live under the shared/vLLM local library.

Validation commands completed:

```powershell
python -m py_compile vllm\indextts2_api.py vllm\indextts\infer_vllm_v2.py vllm\indextts\gpt\model_vllm_v2.py fast6g\indextts2_api.py fast6g\indextts\infer_v2.py fast6g\indextts\snapshot_cache.py
$env:PYTHONPATH='D:\apiWorkSpace\leon_api\vllm'; python dev_workspace\dev_tools\test_snapshot_cache_readable.py
$env:PYTHONPATH='D:\apiWorkSpace\leon_api\fast6g'; python dev_workspace\dev_tools\test_snapshot_cache_readable.py
node --check static\tavo.js
node --check static\tavo.runtime.js
node --check dev_workspace\dev_tools\test_tavo_widget_playwright.js
git diff --check
$env:LEON_LAUNCHER_SMOKE_TEST='1'; ... Invoke-Expression launcher\LEON-Launcher.ps1
```

## Latest Code Snapshot: fast6g AI Mode / Qwen Deprecation

Updated: 2026-06-06

Implemented and runtime-validated on `fast6g`:

- Launcher Qwen emotion is deprecated and hidden/forced off. Backend/script `--qwen_emo` compatibility remains only for manual comparison.
- Launcher vLLM GPU memory ratio remains vLLM-only and is only passed through `INDEXTTS_VLLM_GPU_MEMORY_UTILIZATION` when the selected version is `vllm`.
- `fast6g` now has the same OpenAI-compatible backend LLM parse helper as `vllm` and reports `llm_parse=true`.
- `fast6g` `parse_mode=ai` accepts raw text, LLM endpoint/model/key, parse reuse settings, Tavo user/character context, and voice mappings through `/tts_dialogue_stream_job`.
- Product direction after testing: for breath/whisper/sob/vocal texture, use AI-parsed `style`, `style_alpha`, `emo_vec`, and `emo_alpha`. Qwen text emotion only produces 8-dimensional emotion weights and disables style reference audio in the current IndexTTS2 inference path, so it is not useful for the target voice-cavity behavior.
- `BUG-026` was recorded separately: Tavo settings can report saved but reopen with old config on `fast6g`; user asked to record it and fix later.

Runtime validation:

- `fast6g` qwen-off `/health`: `llm_parse=true`, `qwen_emo=false`.
- Normal job `d325f10c57d805e4ccefaaa09e3aa11494cf0909`: 1 segment, `audio_duration_s=1.95`, `total_wall_s=7.931`, `rtf=4.066`, `/cache_audio` 200.
- AI mock LLM job `e20fdce22df1152e86adba749fa129719cde2ade`: 2 segments, roles `旁白/用户`, `llm_segments=2`, `audio_duration_s=3.858`, `total_wall_s=11.77`, `rtf=3.05`, `/cache_audio` 200.
- Medium normal job `e78ab135206e3aa3f838c1cb912f4bd566ae2a04`: 5 segments, `audio_duration_s=22.918`, `total_wall_s=70.314`, `rtf=3.068`, `first_pcm_s=20.816`.
- Qwen comparison startup `/health`: `qwen_emo=true`, `llm_parse=true`.
- Qwen comparison job `a75285bcf8ff5688954a81c99f6efef0a517dd76`: submitted `style=whisper_soft`, `emo_vec`, and `emo_text`; status showed `emotion_mode=qwen_emo`, `uses_style_audio=false`, `uses_emo_vector=false`, `style=neutral`, `rtf=4.437`. This is the evidence for deprecating Qwen on the launcher path.

This repository is now the likely mainline again because GPT-SoVITS proved unreliable for long Tavo dialogue: it can output long silence, miss text, or fail segments even when the HTTP request succeeds. IndexTTS2 has higher resource cost, but it is the better candidate for stable Tavo long dialogue.

## Latest Validation Snapshot: fast6g 甘婷婷 Style RTF

Updated: 2026-06-06

User-provided source:

- JSON: `vllm/outputs/cache/by_role/甘婷婷/20260606-013108-395_263429152dd8dcd2b2715e80672dbdd93ee9a406.json`
- speaker WAV: `vllm/outputs/cache/by_role/甘婷婷/20260606-013108-395_263429152dd8dcd2b2715e80672dbdd93ee9a406.wav`

Fix/validation notes:

- `moan_soft.MP3` was a bad renamed file on this machine: `soundfile` reported `1.164s`, but `librosa` decoded only `0.017s` of silence and emitted MP3 header errors. That caused the emotion/style encoder `Calculated padded input size per channel: (0)` failure.
- `moan_soft` is removed from the runtime style map because the local asset was bad/removed. Do not advertise or test it unless a real decodable asset is restored.
- Supported English style ids still map to valid local Chinese style slices where assets exist, for example `scream_peak -> 声腔/尖叫-AD学姐` and `laugh_soft -> 声腔/轻笑-AD学姐`.
- `声腔/`素材仍可作为普通音色配置手动选择；这不是 bug。只是不再把 `moan_soft` 放进 AI style 枚举里主动推荐。
- The resolver now strips stale `prompts/library` / `library` prefixes and old extensions, and known style mapping wins over stale explicit cache refs.
- `fast6g` was restarted through `scripts/start-fast6g-api.bat`; `/health` reported `version=fast6g`, `llm_parse=true`, `qwen_emo=false`.
- GPU memory before long style tests was about `6318 MiB / 12288 MiB`; after the tests about `8171 MiB / 12288 MiB`.

The prior `moan_soft` run is invalid as `moan_soft` evidence because it used a substitute mapping, and it is also invalid as multi-voice evidence because the test used one source speaker. Keep only the supported-style RTF numbers as rough backend timing evidence:

- `scream_peak` job `c38c00c8e02f33a8d12d3d5f46149396d7096e80`: audio `60.213s`, wall `164.206s`, RTF `2.727`, `gpt_gen_s=130.083`, `s2mel_s=28.726`, `bigvgan_s=3.728`.
- `laugh_soft` job `3d18366480d7d97fca22217cbf43d7b42c68107d`: audio `63.023s`, wall `172.745s`, RTF `2.741`, `gpt_gen_s=138.452`, `s2mel_s=28.739`, `bigvgan_s=3.885`.

Readable WAVs for manual listening:

- `fast6g/outputs/cache/by_role/甘婷婷/20260606-150325-092_c38c00c8e02f33a8d12d3d5f46149396d7096e80.wav`
- `fast6g/outputs/cache/by_role/甘婷婷/20260606-150709-734_3d18366480d7d97fca22217cbf43d7b42c68107d.wav`

RTF conclusion: this fast6g path improves over the source vLLM cache (`rtf=3.519`) but is still not near realtime. In the supported long style tests, GPT generation dominates (`130-138s`) while S2Mel is about `29s`. Re-run multi-voice RTF with explicit role voices before using any output as quality evidence.

## Current Project Shape

Repository root is now `D:\apiWorkSpace\leon_api`:

- `vllm/`: vLLM quality backend version.
- `fast6g/`: double-accelerated 6 GB friendly backend version.
- `static/`: shared Tavo injected frontend.
- `launcher/`: shared Windows launcher source/assets.
- `scripts/`: shared startup scripts used by the launcher.
- `dev_workspace/`: collaboration docs, smoke tests, screenshots, historical handoffs, and legacy launcher notes.

The older `dev_workspace/handoff_docs/` files are still useful context, but ongoing work should update `dev_workspace/docs/` first.

## Latest Structure Snapshot: Root leon_api Workspace

Updated: 2026-06-06

Completed so far:

- `vllm\Leon_api` was migrated out of the vLLM version folder.
- The active collaboration area now lives at root `dev_workspace/`.
- Legacy Chinese-named collaboration folders were moved to English names:
  - `环境检查` -> `dev_workspace/launcher_legacy`
  - `优化计划` -> `dev_workspace/optimization_plan`
  - `优化计划2.md` -> `dev_workspace/optimization_plan_2.md`
  - `LLVM ERROR报错解决` -> `dev_workspace/llvm_error_fix`
- Shared frontend resources live at root `static/`.
- Shared startup tooling lives at root `launcher/` and `scripts/`.
- Root `README.md`, `AGENTS.md`, and `.gitignore` now describe the new layout and keep runtime/model/cache/package artifacts out of git.
- Qwen emotion decision is recorded in `docs/DECISIONS.md`; do not expand that work until the directory/startup migration is fully verified.

Current launcher direction:

- Root user entry is `D:\apiWorkSpace\leon_api\LEON-Launcher.exe`.
- Current launcher source is `launcher/LEON-Launcher.ps1`.
- The launcher selects `vllm` or `fast6g`, then starts the selected version through `scripts/start-vllm-api.bat` or `scripts/start-fast6g-api.bat`.
- `LEON_ENABLE_QWEN_EMO=1` is set only when the launcher checkbox is enabled.
- vLLM startup exposes `gpu_memory_utilization` in the launcher. Current choices are `0.18` default and `0.11` conservative; the value is passed as `INDEXTTS_VLLM_GPU_MEMORY_UTILIZATION`.
- Public Tavo tunnel host must not be hardcoded in Git and must not be treated as launcher/backend configuration. The program should work with local/LAN URLs by default. If the user has a tunnel/reverse proxy, they replace only the script host in the Tavo regex; `static/tavo.js` then uses its own loaded origin as the API origin.

Git/LFS direction:

- Keep code, scripts, docs, tests, and small config under Git.
- Keep model weights, prompt/reference audio, generated WAV/MP3/MP4, DLL fallbacks, runtime environments, and package archives local/untracked.
- `.gitattributes` no longer routes audio/video/DLL files through LFS; these files are local assets unless explicitly reintroduced later.

## Latest Investigation Snapshot: RTF and Home Player UI

Updated: 2026-06-05

RTF evidence from the latest real cache files:

- `54e4954a5312c5f90d62c329ee198424be3aec4b`: 14 segments, audio `109.319s`, `rtf=5.418`, `wall_rtf=5.47`, `lock_wait_s=0`, `total_wall_s=597.947`, `s2mel_s=504.206`, `gpt_gen_s=76.226`, `bigvgan_s=8.191`, `first_pcm_s=34.266`.
- `c69e43eb5bcd4544cfe22631822ddb1eaf91b17d`: 15 segments, audio `120.573s`, `rtf=6.051`, `wall_rtf=7.548`, `lock_wait_s=180.455`, `s2mel_s=634.267`.
- `nvidia-smi` at 14:17 showed RTX 3060 memory `11876MiB / 12288MiB` with API PID `21012` and multiprocessing child PID `31712`; `8188` was empty.
- Later read-only checks at 16:23 showed GPU memory down to about `1072MiB / 12288MiB`, no compute Python process, and no listener on `9880` or `8188`.

Conclusion: the previous live-card status bug caused a visible "fake stuck" path, but the newest cache metrics also show real backend slowness. For the latest no-wait sample, S2Mel/diffusion dominates the wall time. The slow-run evidence comes from completed cache metadata and the earlier near-full-VRAM snapshot, not from the current idle/offline machine state.

Home player UI changes now in code:

- Removed visible 10-second rewind/forward buttons from the player home controls.
- Kept avatar, role name/status, `L`/`D` playback mode, and settings on one header row.
- Playback mode is a direct single-letter toggle: `L` means LIVE, `D` means落盘/后台生成.
- Moved delete into the subtitle panel near the old page-counter position.
- Moved the page counter into the subtitle panel top-right with `pointer-events:none`.
- Made the music/add button the same size as the main play button.
- Kept the role hint/status under the title as a single-line ellipsis after freeing header space.
- Widened the settings button slightly.
- Made the live exit button circular and play-sized.
- Fixed the LIVE play-click path so a waiting/live card checks cache/status instead of immediately flipping to `已暂停`.

Current cache-busted Tavo URL:

```html
<script src="http://<LAN-IP>:9880/static/tavo.js?v=20260606-live-audio-v8"></script>
```

Current validation for this `L`/`D` follow-up:

- Static JS syntax checks and `git diff --check` should be run after any final doc edit.
- Full Playwright/Tavo smoke was not run in this follow-up because `9880` was not listening.
- Do not claim current GPU saturation unless a fresh `nvidia-smi` during generation shows it again.

## Latest Fix Snapshot: Normal/AI Modes, Live/Generate Jobs, Backend-Owned Parse

Updated: 2026-06-05

`static/tavo.js` is now a light Tavo regex entry. It mounts only a lazy card at first paint, then loads `static/tavo.runtime.js` on user interaction. The runtime reads `static/tavo.runtime.manifest.json`, fetches the 16 files under `static/tavo.runtime.parts/`, concatenates them in order, and executes the original IndexTTS2 runtime closure.

Completed in code:

- Preserved a single Tavo script URL while splitting the runtime into manifest-driven parts.
- Added `static/tavo.ui.skin.default.css` and `static/tavo.assets/narrator.png` as borrowed UI/asset patterns only.
- Added `reuseLlmParse` config and UI toggle; normal Tavo intelligent generation no longer calls `/parse_text` from the WebView. It submits original text, voice mapping, LLM config, and Tavo context to `/tts_dialogue_stream_job`; the backend job owns LLM parse, parse reuse, status, and errors.
- Replaced user-facing `单音色/多音色` with `普通模式/AI模式`. 普通模式 sends raw text plus default/旁白/对白 voices to the backend deterministic splitter with `parse_mode=normal`; AI模式 sends `parse_mode=ai` and LLM config to backend-owned parsing.
- Added the player `L`/`D` quick switch. `L` keeps the transient LIVE card; `D` creates a background落盘 job, persists the pending cache key, polls `/tts_dialogue_job_status/{cache_key}`, and restores it after re-entering the message.
- Deleting pending/live tracks now aborts frontend job creation/stream readers, calls backend DELETE when a cache key exists, removes pending Tavo storage, and the backend reports `cancelled` instead of turning cancellation into a failed LLM/TTS job.
- Added a human-readable cache index. The stable API files remain `outputs/cache/{cache_key}.wav/json`; each saved cache also writes one primary-role entry under `outputs/cache/by_role/<主角色>/<timestamp>_<cache_key>.wav/json` for manual backtracking.
- Kept IndexTTS2 business rules in the runtime parts: saved/cache audio still uses native `<audio>`, live/pending tracks stay transient, and LLM role ownership stays with the LLM output.
- Updated Playwright smoke to assert the lazy entry does not load runtime parts, request `/voices`, or create TTS jobs before user interaction.

Verified:

```powershell
node --check static\tavo.js
node --check static\tavo.runtime.js
node --check dev_workspace\dev_tools\test_tavo_widget_playwright.js
python -m py_compile indextts2_api.py indextts\infer_vllm_v2.py indextts\gpt\model_vllm_v2.py
D:\apiWorkSpace\leon_api\vllm\indextts2runtime\python.exe dev_workspace\dev_tools\test_snapshot_cache_readable.py
node dev_workspace\dev_tools\test_tavo_widget_playwright.js
```

Playwright result: initial lazy card had `/voices=0`, job requests `0`, runtime manifest/parts `0`; clicking settings loaded one manifest and 16 runtime parts; opening the voice picker then requested `/voices` once. The smoke also checks settings labels `普通模式/AI模式`, default `LIVE` toggle, compact close buttons, centered settings/picker layers, backend-owned AI parse errors, and normal-mode `生成` cancellation.

The same Playwright script also runs a mocked intelligent-mode check. It aborts `/parse_text` as a forbidden path, intercepts `/tts_dialogue_stream_job`, `/tts_dialogue_job_status/*`, and `/cache_audio/*`, generates twice for the same message after a re-mount, and verifies `parseCount=0`, `jobCount=2`. It also asserts the job body contains `text`, `voices`, `llm_endpoint`, `llm_model`, `reuse_llm_parse`, `user_name`, `character_name`, and generation parameters.

Screenshots saved for layout evidence:

- `dev_workspace/screenshots/tavo_loader_settings_desktop.png`
- `dev_workspace/screenshots/tavo_loader_settings_mobile.png`

Tavo regex cache-busting URL should be updated to:

```html
<script src="http://<LAN-IP>:9880/static/tavo.js?v=20260606-live-audio-v8"></script>
```

## Latest Packaging Snapshot: LEON Launcher

Updated: 2026-06-05

Created a local Windows launcher workspace under `dev_workspace/launcher_legacy/`.

Files:

- `LEON启动器.exe`: user-facing double-click entry. It is a small C# WinExe bootstrapper that loads the WinForms PowerShell launcher from the same folder and bypasses `.ps1` file association issues.
- `LEON启动器.bootstrap.cs`: maintainable source for rebuilding `LEON启动器.exe` with the built-in .NET Framework `csc.exe`.
- `leon-launcher.ico`: launcher icon generated from the provided avatar and embedded into the EXE.
- `一键环境检查和启动.bat`: backup entry only.
- `LEON启动器.ps1`: WinForms launcher with first-open environment check, manual check/repair, service start/stop, backend log view, voice list refresh, normal-mode multi-voice test, and Tavo setup instructions.
- `README.md`: short usage notes for the launcher folder.
- `leon-avatar.jpeg`: copied avatar source used as launcher asset input.
- `leon-launcher-banner-avatar-ai.png`: generated launcher banner using the provided avatar.

Important behavior:

- Mandatory startup method: use `LEON-Launcher.exe` as the user/Codex entry for startup and restart workflows. Do not directly run `go-API-VLLM-NoQwen.bat` from Codex unless the user explicitly asks for low-level troubleshooting.
- The launcher must not auto-start the backend when opened. It performs environment checks and waits for the user to click the launcher start button.
- Internally, the launcher start button calls the shared root scripts for the selected version. Treat those BAT files as implementation details, not the operator entry. `一键环境检查和启动.bat` is historical backup only.
- Checks include administrator status, Chinese path, `indextts2runtime\python.exe`, NVIDIA driver, CUDA Toolkit / `nvcc`, MSVC `cl.exe`, runtime-aware SVML compatibility, Torch CUDA / vLLM / FastAPI / ninja imports, `patch_vllm` registration, required checkpoint files, voice library count, API port `9880`, and startup BAT presence.
- One-click repair can copy the bundled `svml_dispmd.dll` into the project runtime only when import logs indicate SVML/LLVM/DLL load trouble, launch `winget` installs for Visual Studio Build Tools and NVIDIA CUDA Toolkit, and install `ninja` into the project runtime.
- Voice testing uses `/voices`, `/tts_dialogue_stream_job`, `/tts_dialogue_job_status/{cache_key}`, and `/cache_audio/{cache_key}` with `parse_mode=normal`.
- Tavo instructions use the current cache-busted LAN script URL; public hosts are user-managed outside the program.
- No image API key or OpenAI-compatible key is written into launcher files or docs.
- `LEON启动器.ps1` is UTF-8 with BOM so Windows PowerShell 5.1 can parse Chinese text directly.

Verified:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -Command '$errs=$null; $tokens=$null; [System.Management.Automation.Language.Parser]::ParseFile("D:\apiWorkSpace\leon_api\launcher\LEON-Launcher.ps1",[ref]$tokens,[ref]$errs) | Out-Null; if($errs){ exit 1 }'
$env:LEON_LAUNCHER_SMOKE_TEST='1'; powershell.exe -NoProfile -ExecutionPolicy Bypass -Command '$env:LEON_LAUNCHER_SCRIPT="D:\apiWorkSpace\leon_api\launcher\LEON-Launcher.ps1"; $p=$env:LEON_LAUNCHER_SCRIPT; $utf8=New-Object System.Text.UTF8Encoding($false); $code=[System.IO.File]::ReadAllText($p,$utf8); Set-Location "D:\apiWorkSpace\leon_api\launcher"; Invoke-Expression $code'
$env:LEON_LAUNCHER_SMOKE_TEST='1'; $p = Start-Process -FilePath "D:\apiWorkSpace\leon_api\LEON-Launcher.exe" -WorkingDirectory "D:\apiWorkSpace\leon_api" -Wait -PassThru; $p.ExitCode
```

The generated EXE SHA256 is `ACA06C44076D29694EBE9DE0D6AFAEA6FD98F2EEF82EB354AA63BDC5C2794416`.

## Known Runtime Situation

- User disabled the Windows scheduled task named `auto start`, which had been relaunching ComfyUI.
- Port `8188` was confirmed empty after killing the ComfyUI Python process.
- NVIDIA RTX 3060 has 12 GB VRAM. After ComfyUI was stopped, the machine still had about 4.3 GB GPU memory in use.
- A Python process on `127.0.0.1:9881` was present and was not killed because it looked like a TTS/model service, not ComfyUI.
- API port `9880` is the expected IndexTTS2 / Leon adapter port in this project.

## Active Direction

1. Make IndexTTS2 the default Tavo TTS mainline again.
2. Keep GPU use controlled: one heavy TTS inference at a time, avoid competing with ComfyUI/LLM/SD workloads, keep FP16/CUDA kernel defaults.
3. Preserve the Tavo player lessons already learned: job status, cache snapshots, history persistence, failed-state clarity, and real regression guards.
4. Use `docs/BUGS.md` and `docs/REGRESSION.md` as the shared memory for failures before making code changes.

## Previous Fix Snapshot: Tavo Live Card Boundary

Updated: 2026-06-05

`static/tavo.js` now has the GPT-SoVITS-style live special card flow adapted for IndexTTS2, but saved playback intentionally stays on IndexTTS2's native `<audio>` path.

Completed in code:

- `BUG-007`: live dialogue streams no longer default to native `<audio>` playback, and `start_s > 0` live stream URLs are blocked from native `<audio>`. Live jobs wait/poll for `/cache_audio/<cache_key>` unless explicitly opted in with script flags `webAudioLive=1`, `nativeLive=1`, or `elementLive=1`.
- `BUG-008`: removed the frontend "unquoted text must become narrator" role override. LLM owns segment role assignment; frontend only normalizes aliases/placeholders and maps roles to voices.
- `BUG-009`: pending/live tracks are transient, hidden from saved history count and Tavo persistence. Live card shows only play/pause plus live exit. Exit checks job status once; if `done`, the card converts to saved, otherwise it calls `DELETE /tts_dialogue_stream_job/<cache_key>` and removes the transient card.
- Saved/cache audio still uses native `<audio>` with `/cache_audio/<cache_key>` or offline object URL. Do not replace this with GPT-SoVITS-style saved WebAudio; the user specifically warned that GPT-SoVITS background playback is poor and must not be copied into IndexTTS2 saved playback.

Verified:

```powershell
node --check static\tavo.js
node --check dev_workspace\dev_tools\test_tavo_widget_playwright.js
git diff --check
node dev_workspace\dev_tools\test_tavo_widget_playwright.js
```

Playwright smoke result was OK: initial mount made `0` voice requests and `0` job requests, role rows rendered, picker loaded on demand, and `consoleCount` was `0`.

Still required:

- Real Tavo/iOS validation for live exit, live-to-saved conversion, saved background/lock-screen playback, and history count after re-entering a message.
- Tavo regex cache-busting URL was:

```html
<script src="http://<LAN-IP>:9880/static/tavo.js?v=20260605-live-card"></script>
```

## Recently Imported Documentation Workflow

Created active docs:

- `docs/AGENT_STATE.md`
- `docs/ARCHITECTURE.md`
- `docs/DECISIONS.md`
- `docs/BUGS.md`
- `docs/TODO.md`
- `docs/REGRESSION.md`

Created `dev_workspace/AGENTS.md` so future agents entering this directory read the active docs before work.

`dev_workspace/README.md` should stay short and point to these docs. Detailed bug state belongs in `docs/`, not in the README body.

## Worktree Caution

Before editing code, run:

```powershell
git -C D:\apiWorkSpace\leon_api status --short
```

At the time this docs workflow was added, the worktree already had many unrelated audio asset deletions/additions and generated test WAV/JSON files. Do not revert them unless the user explicitly asks. Avoid sweeping cleanup commits that mix documentation, audio assets, and runtime code.

## Current High-Risk Areas

- Tavo injected player and persistence in `static/tavo.js`.
- `indextts2_api.py` live job / snapshot cache behavior.
- vLLM sampling parameter pass-through in `indextts/gpt/model_vllm_v2.py` and `indextts/infer_vllm_v2.py`.
- GPU/VRAM pressure causing RTF spikes.
- Mobile WebView audio behavior: streaming, saved audio replay, background playback, MediaSession, and cache seek.

## Verification Habit

Lightweight checks before handoff:

```powershell
node --check static\tavo.js
node --check dev_workspace\dev_tools\test_tavo_widget_playwright.js
python -m py_compile indextts2_api.py indextts\infer_vllm_v2.py indextts\gpt\model_vllm_v2.py
git diff --check
```

Runtime checks when service is expected to be running:

```powershell
curl.exe --noproxy "*" -s http://127.0.0.1:9880/health
curl.exe --noproxy "*" -s http://127.0.0.1:9880/voices
curl.exe --noproxy "*" -I http://127.0.0.1:9880/static/tavo.js
```

Real Tavo validation remains required for playback, storage, message identity, AR injection, and mobile audio behavior.

## Latest Fix Snapshot: Tavo LIVE Status / Layout Follow-up

Updated: 2026-06-05

User reported that LIVE mode showed no exit button, appeared stuck on the second segment, could show mismatched text after switching back, and the card jumped in height. User later clarified that clicking play showed the audio had already landed on disk.

Fixes now in code:

- `.idx-live-exit` is no longer hidden by the live-active CSS selector that hides normal history controls.
- Foreground LIVE polling updates `segments_meta` by content signature, not only when the list grows.
- Foreground LIVE polling can confirm `/cache_audio/{cache_key}` with `HEAD` and switch to saved if the file is already readable but `job_status` lags. This fallback is disabled for failed/cancelled/background-generate jobs.
- Player card/control height is stabilized to reduce pending/live/saved layout jumps.
- Settings order is now: mode buttons directly, then `合成质量`, voice mapping, `播放 / 离线`.
- Cache-busted Tavo URL is now `http://<LAN-IP>:9880/static/tavo.js?v=20260606-live-audio-v8` for LAN examples; public hosts are user-managed outside the program.

RTF evidence from recent real cache metadata:

- `54e4954a5312c5f90d62c329ee198424be3aec4b`: 14/14 segments, audio `109.319s`, `rtf=5.418`.
- `c69e43eb5bcd4544cfe22631822ddb1eaf91b17d`: 15/15 segments, audio `120.573s`, `rtf=6.051`.
- `nvidia-smi` at 13:57 showed RTX 3060 memory `11867MiB / 12288MiB` with two project runtime Python processes: API PID `21012` and multiprocessing child PID `31712`. This points to real GPU memory pressure in addition to the frontend stuck-state bug.

Verified after that earlier live-status follow-up, while the local API was available:

```powershell
node --check static\tavo.js
node --check static\tavo.runtime.js
node --check dev_workspace\dev_tools\test_tavo_widget_playwright.js
git diff --check
node dev_workspace\dev_tools\test_tavo_widget_playwright.js
```

Playwright now asserts `liveExitDisplay="flex"`, `cardMinHeight="360px"`, settings order, no frontend `/parse_text`, normal generate cancellation, and voice picker behavior.

