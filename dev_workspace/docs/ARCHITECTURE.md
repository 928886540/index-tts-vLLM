# Architecture

## Product Boundary

This project is a local IndexTTS2 + Tavo integration package with selectable backend versions. It is not a SaaS backend, and it is not designed around public multi-user tenancy.

Primary goal: a user runs the model service on their own Windows machine, injects the Tavo player script into Tavo, and generates/playbacks dialogue audio with stable cache history.

## Runtime Components

- `vllm/`: vLLM quality API backend version directory.
- `fast6g/`: double-accelerated 6 GB friendly API backend version directory.
- `static/tavo.js`: shared single Tavo frontend injected script and player UI.
- `launcher-tauri/` and `scripts/`: shared startup tooling and version selection.
- `prompts/library/` under each backend version: voice/reference audio library.
- `outputs/cache/` under the selected backend version: generated MP3 cache, optional debug/legacy WAV, and metadata snapshots.
- `dev_workspace/dev_tools/`: local smoke tests, payloads, Playwright runner script, audio analysis utilities.
- `dev_workspace/docs/`: active collaboration state.
- `dev_workspace/handoff_docs/`: historical handoff material.

## Terminology Boundary

Use these terms consistently in code review, bug notes, and user-facing explanations:

- Backend / API backend / `后端`: the HTTP API layer, including `vllm/indextts2_api.py`, `fast6g/indextts2_api.py`, request models, job status, cache endpoints, and API-side LLM parse helpers.
- Frontend / `前端`: Tavo-side injected scripts and UI, including `static/tavo.js`, runtime parts, Tavo storage, WebAudio/native audio lifecycle, and role/voice settings UI.
- TTS service / `TTS服务`: IndexTTS / IndexTTS2 inference and model synthesis pipeline. This is not called "backend" in this project terminology.
- Launcher / `启动器`: `LEON-Launcher-Tauri.exe`, `launcher-tauri/`, and startup scripts.

When describing a flow, separate the boundaries: frontend submits a job, API backend owns job/cache/status and validation, TTS service performs synthesis, then frontend plays live or saved audio.

## Tavo Flow

```text
Tavo rendered message
  -> regex injects static/tavo.js
  -> player reads current message/chat context
  -> user selects normal or intelligent generation
  -> frontend sends one TTS job request to the API backend
  -> API backend owns optional LLM parse, parse reuse, segment validation, and status
  -> API backend queues work and calls the TTS service
  -> TTS service runs IndexTTS2 inference
  -> live stream or cache snapshot becomes playable
  -> frontend persists track metadata with tavo.set
  -> saved audio can be replayed from /cache_audio/{cache_key}
```

## Backend Job Model

The project already moved toward an async job and cache-key model:

- `POST /tts_dialogue_stream_job`: create or attach to a dialogue generation job.
- `GET /tts_dialogue_stream_job/{cache_key}`: stream live/generated audio.
- `GET /tts_dialogue_job_status/{cache_key}`: inspect running/done/failed state and segment metadata.
- `GET /cache_audio/{cache_key}`: serve completed cache snapshots. Default response is MP3 (`audio/mpeg`); `?format=wav` is retained for explicit debug/regression/legacy WAV checks.
- `GET /server_log/tail`: inspect recent server logs.

Important invariant: TTS generation should not be tightly coupled to a single frontend HTTP connection. If Tavo disconnects, the API backend should be able to keep the job alive, let the TTS service finish when possible, and save the cache.

For normal Tavo intelligent mode, the frontend must not call `/parse_text` before job creation. It submits raw `text`, `voices`, LLM endpoint/model/key, Tavo user/character context, role hints, and generation parameters to `/tts_dialogue_stream_job`. The API backend creates the job/cache id immediately, performs LLM parsing in the background before entering the TTS lock, calls the TTS service for synthesis, and reports parse/TTS phases through `/tts_dialogue_job_status/{cache_key}`. Legacy `segments` input is still accepted for compatibility, and `/parse_text` remains as a manual/compatibility proxy endpoint.

## Resource Boundary

IndexTTS2 is higher quality but resource-heavy. On the user's RTX 3060 12 GB machine, RTF can spike if the workload spills out of dedicated VRAM into shared GPU memory or competes with ComfyUI/SD/LLM services.

Architecture preference:

- keep the IndexTTS2 service warm instead of repeatedly loading the model;
- default to FP16 and CUDA kernel when available;
- cap heavy TTS concurrency, usually `1`;
- avoid running ComfyUI/SD at the same time as long TTS generation;
- expose clear RTF and job timing in metrics.

## Frontend Persistence Boundary

Tavo state should use durable Tavo APIs:

- `tavo.message.current()` for current message identity;
- `tavo.chat.current()` for current chat / role context;
- `tavo.get(name, scope)` and `tavo.set(name, value, scope)` for persistent track metadata.

Do not rely on `window` globals surviving message re-render, app restart, chat switch, or mobile WebView lifecycle events.

Track history should persist only stable saved/cacheable entries. Live/pending/failed transient tracks must not erase previously saved history.

## Audio Boundary

Saved/cache audio should prefer MP3 through the native `<audio>` element when possible, because it has the best chance of integrating with system background playback, MediaSession, fast loading, and Tavo file storage. WAV is retained only as optional debug/regression/legacy data.

Default LIVE streaming should use the MP3 route through native `<audio>`. Explicit WebAudio/PCM and finite WAV segment routes remain diagnostics for regressions and compatibility checks. Treat mobile playback as a real Tavo regression problem, not a normal browser-only problem.

## Snapshot Metadata

Cache metadata should include enough information for resume and subtitles:

- `cache_key`
- text / mode / voice mapping / generation parameters
- `segments_meta`
- `start_s`, `duration_s`, sample rate
- RTF, total duration, total elapsed time
- model/version and important inference parameters
- audio format / content type, currently defaulting to MP3 with optional debug WAV metadata when present

The frontend should display and persist counts based on saved tracks, not transient jobs.

## Docs Boundary

Keep ongoing work in:

- `docs/AGENT_STATE.md`: current state and handoff notes.
- `docs/BUGS.md`: bug ledger.
- `docs/REGRESSION.md`: verification checklist.
- `docs/TODO.md`: prioritized next work.

Use `handoff_docs/` as archive only.

