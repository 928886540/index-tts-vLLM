# TODO

## P0

- Real Tavo validation for `BUG-026` / `BUG-046` / `BUG-047` / `BUG-048` / `BUG-049`:
  - verify settings save/reopen/remount/re-enter chat uses `tavo.set` values on `fast6g` and `vllm`;
  - verify empty player disables play and only the music-note button creates a new job;
  - verify AI mode refuses missing role mappings instead of submitting/defaulting a voice;
  - verify restored LIVE pending audio resumes the same key and does not stay in a permanent spinner;
  - verify default MP3 LIVE becomes audible on phone, and when LIVE cannot continue it switches to native saved MP3 after cache ready;
  - verify the avatar-side status line only shows the configured/current voice label.

- Make this docs workflow the active handoff path:
  - future work starts by reading root `AGENTS.md`, then `dev_workspace/AGENTS.md` and `dev_workspace/docs/*`;
  - fresh user bug reports are implementation/debugging tasks first, not documentation tasks;
  - `docs/BUGS.md` is a concise ledger or post-fix handoff note, not a place to dump raw reports;
  - fixes update `docs/REGRESSION.md` with guards when the behavior needs future protection.

- Return IndexTTS2 to the mainline Tavo engine:
  - verified `fast6g` API startup on `9880`, `/health`, `/voices`, and one short normal-mode generation on 2026-06-06;
  - after the Qwen/AI-mode code change, restart and verify `fast6g` `/health` reports `llm_parse=true`;
  - verified one `fast6g` AI-mode job against real OpenAI-compatible liangjie `grok-4.1` on 2026-06-09; backend-owned `llm_stage=done`, `segments_done=4/4`, MP3 cache and by_role index landed;
  - verify Qwen-enabled startup for both `vllm` and `fast6g` ignores style/emo_vec during synthesis while using per-segment `emo_text`;
  - `vllm` API startup was re-verified on 2026-06-06 at `gpu_memory_utilization=0.11`; `/health`, `/voices`, and a short `/warmup` passed;
  - `static/tavo.js` now matches the desired live-card boundary in code: live is transient, saved is native `<audio>`;
  - `static/tavo.js` is now a light loader; runtime lives in `static/tavo.runtime.js` + `static/tavo.runtime.parts/`;
  - update Tavo regex/cache-busting URL with LAN URL or the user's own tunnel host outside repo config;
  - run a short end-to-end generation without ComfyUI occupying GPU.

- Resource and RTF baseline:
  - checked `fast6g` long dialogue style RTF on 2026-06-06 with the user's 甘婷婷 cache sample;
  - checked low-risk `vllm` startup optimizations on 2026-06-06: duplicate BigVGAN CUDA extension preload was removed, and the main-process GPT wrapper now uses FP16/autocast under `--fp16`;
  - final `vllm 0.11` idle GPU memory dropped from about `9653 MiB` to about `8008 MiB`; after short warmup it was about `8490 MiB`;
  - `vllm 0.08` was tested and rejected for now: vLLM reported no available KV cache memory and failed startup;
  - two supported 13-segment style jobs completed with RTF `2.727-2.741`, audio `60.213-63.023s`, and GPU memory about `6318 MiB` before / `8171 MiB` after;
  - the previous `moan_soft` run is invalid as style/quality evidence because that style was removed after the local asset was confirmed bad/removed;
  - fixed long multi-role vLLM benchmark completed for ratios `0.11`, `0.15`, `0.20`, and `0.25`, three uncached runs each;
  - current recommendation: `0.11` for safe long sessions, `0.15` for best measured speed when other GPU workloads are off, avoid `0.20+` for now because near-full VRAM hurts S2Mel/BigVGAN;
  - next performance pass, only if needed, should compare quality tiers/steps at `0.11` and `0.15` rather than increasing vLLM ratio further.

- Protect saved history:
  - code audit done for `static/tavo.js` persistence paths: only saved/cache-ready tracks are persisted and counted;
  - live/pending/cancelled/failed tracks should not erase saved history;
  - still verify in real Tavo: lazy snapshot count, full player count, and re-entered message count.

- Failed-job playback hardening:
  - live `code=4` fallback implemented: live stream errors wait for saved cache instead of poisoning the audio element;
  - failed/missing/deleted jobs still need real Tavo validation to confirm they do not become `<audio>` sources;
  - error UI should show backend failure, not generic audio format errors.

- Human-readable cache index:
  - code now writes one primary-role readable entry under `outputs/cache/by_role/<主角色>/<timestamp>_<cache_key>.<ext>`; new user-facing cache defaults to `.mp3`, with `.wav` retained for debug/legacy entries;
  - `fast6g` short normal-mode generation confirmed matching legacy `by_role/旁白/...wav/json` on 2026-06-06; next real Tavo generation should confirm new `.mp3/json` readable entries;
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
  - saved MP3 audio seek and replay;
  - background/foreground behavior;
  - MediaSession / system playback controls;
  - live stream failure and recovery behavior.
  - specifically confirm saved/cache audio still uses native `<audio>` MP3 and works in background/lock-screen after the live-card patch.

- User distribution defaults:
  - P1 users should run the author's built-in prompts, style mappings, voice strategy, and quality tiers by default;
  - do not block P1 on profile editing or full user-tuning UI;
  - keep defaults stable and update-safe before exposing user-editable tuning.

## P2

- User tuning blueprint:
  - planning folder: `dev_workspace/docs/USER_TUNING_PLAN/`;
  - first launcher profile slice is implemented with schema v2 quality presets and active profile consumption;
  - next slice should externalize voice-control/style catalog into profile schema v3;
  - launcher should be the main profile/tuning UI; Tavo should stay lightweight for playback and quick mode choices;
  - future work can expose LLM prompt templates, style catalogs, role strategies, LIVE buffer settings, expert quality parameters, and import/export profiles.

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
  - launcher visual refresh should target a Windows Terminal-like dark desktop style while preserving easy packaging and double-click startup;
  - launcher profile UX should use a CC Switch-like structure: outer config list with active/apply/copy/edit actions, inner detail page for editing and saving;
  - no accidental ComfyUI/SD contention;
  - clear service status page;
  - clean shutdown / restart scripts.

## Parking Lot

- Do not clean up the large prompt/audio asset worktree until the user asks. There were many pre-existing deletes/adds under `prompts/` and generated dev audio outputs.
- Do not run long batch TTS tests while the user may be actively using the service.
- Do not move secrets from old README/handoff files into new docs.

