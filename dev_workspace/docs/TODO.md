# TODO

## P0

- Investigate `BUG-026`:
  - on `fast6g`, settings save reports success but reopening shows old config;
  - capture Tavo console/storage evidence before changing code;
  - verify save/reopen/remount/re-enter chat after the fix.

- Make this docs workflow the active handoff path:
  - future work starts by reading root `AGENTS.md`, then `dev_workspace/AGENTS.md` and `dev_workspace/docs/*`;
  - new bugs are recorded in `docs/BUGS.md` before code changes;
  - fixes update `docs/REGRESSION.md` with guards.

- Return IndexTTS2 to the mainline Tavo engine:
  - verified `fast6g` API startup on `9880`, `/health`, `/voices`, and one short normal-mode generation on 2026-06-06;
  - after the Qwen/AI-mode code change, restart and verify `fast6g` `/health` reports `llm_parse=true`;
  - run one `fast6g` AI-mode job against a mock or real OpenAI-compatible LLM endpoint;
  - verify Qwen-enabled startup for both `vllm` and `fast6g` ignores style/emo_vec during synthesis while using per-segment `emo_text`;
  - still verify `vllm` API startup after the fast6g fixes if switching back to the quality backend;
  - `static/tavo.js` now matches the desired live-card boundary in code: live is transient, saved is native `<audio>`;
  - `static/tavo.js` is now a light loader; runtime lives in `static/tavo.runtime.js` + `static/tavo.runtime.parts/`;
  - update Tavo regex/cache-busting URL with LAN URL or the user's own tunnel host outside repo config;
  - run a short end-to-end generation without ComfyUI occupying GPU.

- Resource and RTF baseline:
  - checked `fast6g` long dialogue style RTF on 2026-06-06 with the user's 甘婷婷 cache sample;
  - three 13-segment style jobs completed with RTF `2.727-2.808`, audio `60.213-66.227s`, and GPU memory about `6318 MiB` before / `8171 MiB` after;
  - next performance pass should isolate why GPT generation dominates (`130-149s`) and compare Tavo quality tiers with the same long text only when the user wants more long runs.

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
  - `fast6g` short normal-mode generation confirmed matching `by_role/旁白/...wav/json` on 2026-06-06;
  - still run one real Tavo generation to confirm role folders look right with actual Tavo metadata.

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

