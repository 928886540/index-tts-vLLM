# TODO

## P0

- Make this docs workflow the active handoff path:
  - future work starts by reading `Leon_api/AGENTS.md` and `Leon_api/docs/*`;
  - new bugs are recorded in `docs/BUGS.md` before code changes;
  - fixes update `docs/REGRESSION.md` with guards.

- Return IndexTTS2 to the mainline Tavo engine:
  - verify API startup on `9880`;
  - `static/tavo.js` now matches the desired live-card boundary in code: live is transient, saved is native `<audio>`;
  - `static/tavo.js` is now a light loader; runtime lives in `static/tavo.runtime.js` + `static/tavo.runtime.parts/`;
  - update Tavo regex/cache-busting URL to `https://index-tts.928886540.xyz/static/tavo.js?v=20260605-live-status-v1`;
  - run a short end-to-end generation without ComfyUI occupying GPU.

- Resource and RTF baseline:
  - check `8188` remains stopped;
  - record `nvidia-smi` before test;
  - run one fixed short sample and one long dialogue sample;
  - record RTF, audio duration, total elapsed time, and GPU memory.

- Protect saved history:
  - code audit done for `static/tavo.js` persistence paths: only saved/cache-ready tracks are persisted and counted;
  - live/pending/cancelled/failed tracks should not erase saved history;
  - still verify in real Tavo: lazy snapshot count, full player count, and re-entered message count.

- Failed-job playback hardening:
  - live `code=4` fallback implemented: live stream errors wait for saved cache instead of poisoning the audio element;
  - failed/missing/deleted jobs still need real Tavo validation to confirm they do not become `<audio>` sources;
  - error UI should show backend failure, not generic audio format errors.

- Human-readable cache index:
  - code now writes one primary-role readable entry under `outputs/cache/by_role/<主角色>/<timestamp>_<cache_key>.wav`;
  - still run one real generation to confirm the generated role folder and matching JSON look right with actual Tavo metadata.

## P1

- Re-audit role mapping and LLM parse:
  - `旁白`, `用户`, current character, and renamed character cases;
  - intelligent mode role output should map to actual voice;
  - backend `segments_meta` should preserve actual voice and timing.
  - frontend no longer overrides LLM role ownership with the old "unquoted text -> 旁白" heuristic; validate with a real LLM parse sample.
  - `reuseLlmParse` is now exposed in settings; Tavo frontend no longer calls `/parse_text` in normal intelligent mode. It submits text + LLM config once to `/tts_dialogue_stream_job`; backend owns parse/reuse/status.

- Re-check Tavo test path:
  - use `http://127.0.0.1:9880/tavo_test`;
  - keep Playwright runner in `%TEMP%\idx-playwright-runner`;
  - do not install `node_modules` in the repo;
  - smoke now guards lazy-loader behavior before runtime mount.

- Improve metrics:
  - show mode, model params, segments, duration, total elapsed, RTF;
  - ensure cache metadata has enough information to debug resource/quality regressions.

- Mobile playback pass:
  - saved audio seek and replay;
  - background/foreground behavior;
  - MediaSession / system playback controls;
  - live stream failure and recovery behavior.
  - specifically confirm saved/cache audio still uses native `<audio>` and works in background/lock-screen after the live-card patch.

## P2

- Compare engines with a fixed sample suite:
  - IndexTTS2;
  - GPT-SoVITS as experimental;
  - optional CosyVoice2 / F5-TTS / Fish Speech if user wants further research.

- Build a repeatable audio quality report:
  - Whisper transcript coverage;
  - silence/RMS scan;
  - segment duration outliers;
  - manual listening notes.

- Packaging and startup hygiene:
  - one-click local startup;
  - no accidental ComfyUI/SD contention;
  - clear service status page;
  - clean shutdown / restart scripts.

## Parking Lot

- Do not clean up the large prompt/audio asset worktree until the user asks. There were many pre-existing deletes/adds under `prompts/` and generated dev audio outputs.
- Do not run long batch TTS tests while the user may be actively using the service.
- Do not move secrets from old README/handoff files into new docs.
