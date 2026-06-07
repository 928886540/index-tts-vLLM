# Decisions

## DEC-001: Active handoff state lives in `dev_workspace/docs`

Status: accepted

`dev_workspace/README.md` is the active working README for Codex sessions. It should explain the project boundary, startup path, active docs, and common validation commands.

The root `README.md` is the project introduction / public-facing overview. Do not rely on it as the active handoff context for repository work.

The root `AGENTS.md` was moved into `dev_workspace/AGENTS.md`; new Codex sessions should start in `dev_workspace` when the user wants lightweight working context.

Detailed current state, bugs, regression, decisions, and TODOs still live in `dev_workspace/docs/`.

`dev_workspace/handoff_docs/` remains archive/historical context.

## DEC-002: IndexTTS2 is the mainline candidate again

Status: accepted

GPT-SoVITS is not stable enough for the user's target long Tavo dialogue experience. It can remain an experimental engine, but IndexTTS2 should be treated as the mainline candidate for quality and text coverage.

Tradeoff: IndexTTS2 is heavier. The project should spend effort controlling VRAM, service warmup, concurrency, and cache behavior instead of trying to tune GPT-SoVITS into a stable long-dialogue engine.

## DEC-003: This is a local desktop integration, not SaaS

Status: accepted

The architecture targets one user's machine and local Tavo integration. Do not overbuild cloud account, tenant, billing, or public authentication systems unless the user changes the product direction.

Local network / tunnel access can exist for Tavo devices, but the operational model is still a user-controlled local service.

## DEC-004: Tavo real app validation is required

Status: accepted

Mock pages and Playwright smoke tests are useful but not final. Tavo AR injection, message identity, `tavo.get` / `tavo.set`, mobile WebView audio, background playback, and regex cache busting must be validated in the real Tavo app or emulator.

## DEC-005: Prefer explicit failures over silent fallback

Status: accepted

Missing mappings, invalid cache state, failed inference, model service unavailability, and malformed audio should produce clear UI/log errors.

Do not silently choose another voice, clear history, or mask failed jobs unless the user explicitly asks for that product behavior.

## DEC-006: Track history means saved/cacheable audio only

Status: accepted

Live, pending, failed, or deleted tracks are transient. They must not overwrite saved history counts or clear existing saved tracks.

History count should reflect stable saved/cacheable tracks for the current Tavo message.

## DEC-007: Heavy TTS concurrency should be controlled

Status: accepted

On the user's 12 GB GPU, IndexTTS2 should avoid competing heavy inference jobs. Prefer a simple local FIFO / single heavy TTS job policy before adding distributed infrastructure.

LLM parsing may be parallelized separately if it does not contend with the GPU.

## DEC-008: Keep one Tavo injected entry script

Status: accepted

The Tavo regex should continue loading a single script URL, currently `static/tavo.js`. Internal refactors should not require the user to reconfigure multiple regex entries.

When changing the script, bump the cache-busting query used in Tavo regex documentation.

## DEC-009: Metrics are part of the product

Status: accepted

Every generated cache should make it possible to answer:

- what text and mode generated it;
- what voice mapping and model parameters were used;
- how many segments were synthesized;
- audio duration and total elapsed time;
- RTF;
- whether it came from cache or fresh inference.

This is necessary because the core tradeoff is quality versus resource cost.

## DEC-010: Live stream and saved playback are separate product states

Status: accepted

Live/pending Tavo tracks are transient job UI, not history audio. They should expose only play/pause and live exit. Normal history controls such as previous, next, add, delete, rewind, forward, and seek belong to saved/cache-ready audio.

Saved/cache audio must keep using the native `<audio>` element with `/cache_audio/<cache_key>` or an offline Tavo file URL because this is the most important path for mobile background playback, lock-screen controls, MediaSession, and seek stability.

Do not copy GPT-SoVITS saved WebAudio behavior into IndexTTS2. The user explicitly noted GPT-SoVITS background playback is poor; only copy the live-card state boundary and exit semantics.

Live `<audio>` element streaming is opt-in only through script flags such as `nativeLive=1` / `elementLive=1`; `start_s > 0` live stream URLs must not be assigned to native `<audio>`. By default, LIVE uses the backend live buffer with WebAudio: `GET /tts_dialogue_stream_job/<cache_key>` reads PCM while the backend keeps generating into the same cache-key buffer. Frontend recovery must not create another generation job; it may only reconnect the same `cache_key` stream with larger prebuffer, then wait for `/cache_audio/<cache_key>` as the last audible fallback after same-job live recovery is exhausted.

## DEC-011: LLM owns dialogue role assignment

Status: accepted

For intelligent/multi-role mode, the LLM decides `segment.role`. The frontend may normalize aliases and placeholders, such as `narrator -> 旁白`, `你/user/<Tavo user name> -> 用户`, and `角色/current character -> currentCharacterName`, then map roles to configured voices.

The frontend must not override a non-`旁白` LLM role just because the segment text is not inside quotation marks. Quote/narration policy belongs in the LLM prompt and regression samples, not in frontend post-processing.

## DEC-012: Qwen emotion is deprecated for the launcher path

Status: deprecated

Qwen emotion should not be the recommended Tavo/launcher path.

Runtime testing confirmed that IndexTTS2's `use_emo_text=True` path calls local QwenEmotion to convert text into an 8-dimensional emotion vector, then disables `emo_audio_prompt`. That can automate coarse emotion weights, but it does not reliably produce breath, whisper, sob, vocal-cavity, or style-reference texture.

The launcher now forces Qwen emotion off. Backend/script `--qwen_emo` compatibility may remain for manual comparison, but the product direction is: AI mode should let the LLM output per-segment `role`, `text`, `style`, `style_alpha`, `emo_vec`, and `emo_alpha`; the backend then uses style reference audio and emotion parameters directly.

## DEC-013: Public tunnel host stays out of Git

Status: accepted

Do not hardcode the user's real public tunnel hostname in repository files. Also do not make the launcher/backend detect or depend on a public domain.

The program serves `static/tavo.js` locally. Users can load it through LAN or through their own tunnel/reverse proxy. `static/tavo.js` uses the origin it was loaded from as the API origin, so a public host only belongs in the Tavo regex script URL, not in app configuration.

Repository docs should show local/LAN examples and describe public host replacement generically.

## DEC-014: vLLM main-process GPT must honor FP16

Status: accepted

The vLLM backend still needs a main-process GPT wrapper after vLLM generates semantic codes, because that wrapper computes the latent passed into S2Mel. It cannot be deleted as a simple duplicate.

The critical finding from 2026-06-06 is that this main-process GPT wrapper was staying FP32 even when the service was launched with `--fp16`. On the RTX 3060 12 GB test machine, fixing this by applying `.half()` plus local autocast dropped vLLM `0.11` idle GPU memory from about `9653 MiB` to about `8008 MiB`.

Guard: future vLLM changes must keep the main-process GPT wrapper aligned with the startup precision flag. A short `/warmup` must pass after changing this path. Do not reintroduce a FP32 main GPT wrapper unless there is a measured quality or stability reason and the VRAM cost is recorded.

## DEC-015: vLLM ratio should preserve TTS headroom, not chase full VRAM

Status: accepted

The measured `gpu_memory_utilization` sweet spot on the RTX 3060 12 GB machine is `0.11` to `0.15` for the current IndexTTS2/vLLM architecture and 16-step expressive tier.

Evidence from the 2026-06-06 fixed long multi-role benchmark:

- `0.11`: avg RTF `1.037`, max peak VRAM `10451 MiB`.
- `0.15`: avg RTF `1.033`, max peak VRAM `10847 MiB`.
- `0.20`: avg RTF `1.111`, max peak VRAM `11660 MiB`.
- `0.25`: avg RTF `2.875`, max peak VRAM `11992 MiB`, with S2Mel/BigVGAN timing collapse.

Decision: keep `0.11` as the safer long-session default and use `0.15` as the performance preset when other GPU workloads are off. Avoid `0.20+` unless a later architecture change reduces S2Mel/BigVGAN memory pressure. Do not treat 100% GPU/VRAM usage as a success metric for this pipeline.

## DEC-016: Use strict project terminology for frontend, API backend, TTS service, and launcher

Status: accepted

The project uses these terms:

- `后端` / backend means the API backend only: HTTP routes, request/response models, job/cache/status handling, and API-side helpers in `vllm/indextts2_api.py`, `fast6g/indextts2_api.py`, and related API modules.
- `前端` / frontend means Tavo-side injected UI/scripts: `static/tavo.js`, `static/tavo.runtime.js`, runtime parts, Tavo storage, WebAudio/native audio playback, and settings UI.
- `TTS服务` / TTS service means the IndexTTS / IndexTTS2 inference and synthesis pipeline. Do not call this "backend" in this project.
- `启动器` / launcher means `LEON-Launcher.exe`, `launcher/`, and startup scripts.

Reason: the user relies on precise boundary language when reporting bugs. Mixing the IndexTTS inference layer into "backend" creates confusion about whether a regression is in the API contract, the Tavo frontend, the TTS service, or the launcher.

Guard: bug notes, handoffs, and final replies should name the boundary explicitly, for example "frontend role mapping", "API backend status endpoint", "TTS service synthesis timing", or "launcher startup flow".

