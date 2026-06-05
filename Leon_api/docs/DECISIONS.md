# Decisions

## DEC-001: Active handoff state lives in `Leon_api/docs`

Status: accepted

`Leon_api/README.md` stays short and structural. Current state, bugs, regression, decisions, and TODOs live in `Leon_api/docs/`.

`Leon_api/handoff_docs/` remains archive/historical context.

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

Saved/cache audio must keep using the native `<audio>` element with `/cache_audio/<cache_key>` or an offline object URL because this is the most important path for mobile background playback, lock-screen controls, MediaSession, and seek stability.

Do not copy GPT-SoVITS saved WebAudio behavior into IndexTTS2. The user explicitly noted GPT-SoVITS background playback is poor; only copy the live-card state boundary and exit semantics.

Live native stream playback is opt-in only through script flags such as `nativeLive=1` / `elementLive=1`; `start_s > 0` live stream URLs must not be assigned to native `<audio>`. By default, live jobs should poll until `/cache_audio/<cache_key>` is ready and then switch to saved native playback.

## DEC-011: LLM owns dialogue role assignment

Status: accepted

For intelligent/multi-role mode, the LLM decides `segment.role`. The frontend may normalize aliases and placeholders, such as `narrator -> 旁白`, `你/user/<Tavo user name> -> 用户`, and `角色/current character -> currentCharacterName`, then map roles to configured voices.

The frontend must not override a non-`旁白` LLM role just because the segment text is not inside quotation marks. Quote/narration policy belongs in the LLM prompt and regression samples, not in frontend post-processing.
