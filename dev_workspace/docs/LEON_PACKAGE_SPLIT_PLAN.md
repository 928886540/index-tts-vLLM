# LEON Package Split Plan

Goal: split LEON into one common package plus optional engine packages without keeping two duplicated API backends alive forever.

Target install combinations:

- `leon-common` only: launcher, shared static Tavo frontend, profile editor, voice/style library, docs, common startup and diagnostics. It can open and diagnose, but cannot start TTS without an engine package.
- `leon-common` + `leon-vllm`: full vLLM quality path.
- `leon-common` + `leon-fast6g`: full 6 GB friendly path.
- `leon-common` + both engine packages: launcher version selector chooses `vllm` or `fast6g`.

## Current Answer

`fast6g` should not skip the shared path. It does not depend on vLLM, but it still needs the same active profile, style reference audio, old GPU information, RPC/API port checks, environment checks, logs, cache routes, and startup/stop behavior.

The only version-specific parts should be model runtime, model loading, engine-specific inference options, and environment probes that truly differ.

## Package Boundaries

Common package:

- `LEON-Launcher-Tauri.exe` and `launcher-tauri/` source.
- `static/` Tavo injected frontend.
- `config/profiles/*.json` and active profile management.
- `prompts/library/` shared voice and style reference audio.
- shared scripts under `scripts/`.
- future `leon_common/` Python package for profile, voice library, LLM proxy, prompt rendering, jobs, cache, route helpers, and diagnostics.

vLLM package:

- `vllm/` runtime, checkpoints, vLLM startup adapter, vLLM-specific environment probe.
- only the vLLM engine adapter after API commonization.

fast6g package:

- `fast6g/` runtime, checkpoints, 6G startup adapter, 6G-specific environment probe.
- only the fast6g engine adapter after API commonization.

## Migration Stages

1. Stabilize current Tauri launcher path.
   - Keep current `vllm/` and `fast6g/` runnable.
   - Make startup call one shared entry: `scripts/restart-leon-api.ps1 -Version vllm|fast6g`.
   - Move shared checks into common code: profile existence, active profile schema, `prompts/library`, port `9880`, stale process cleanup, GPU summary, logs path.

2. Extract low-risk shared Python modules.
   - `leon_common/profile_store.py`
   - `leon_common/voice_library.py`
   - `leon_common/llm_proxy.py`
   - `leon_common/prompt_render.py`
   - `leon_common/env_probe.py`
   - Both backends import these modules first, with no route restructuring yet.

3. Extract shared API contracts.
   - Move common route models, profile routes, voice routes, cache helpers, job status helpers, and LLM parse flow into `leon_common/api/`.
   - Keep engine-specific code behind an adapter interface:
     - `load_engine(config)`
     - `warmup()`
     - `infer_segment(...)`
     - `health_extra()`
     - `environment_probe()`

4. Convert `vllm` and `fast6g` into adapters.
   - `vllm/indextts2_api.py` becomes a thin entrypoint that registers the vLLM adapter.
   - `fast6g/indextts2_api.py` becomes a thin entrypoint that registers the fast6g adapter.
   - Shared routes stay byte-for-byte common after this stage.

5. Add package manifests and install validation.
   - Common manifest records `commonVersion`, required directory layout, profile schema version, and supported engine package range.
   - Engine manifest records `engineId`, `engineVersion`, required common version range, startup command, runtime probe command, and model/runtime paths.
   - Launcher refuses to start an engine if manifest compatibility or required files are missing.

6. Remove duplicated backend code.
   - Delete duplicated route/job/cache/profile/LLM code only after both engines pass the same regression suite.
   - Keep old entrypoint wrappers for compatibility if packaging needs stable paths.

## Regression Gates

Each stage must prove:

- opening launcher does not auto-start API;
- both `vllm` and `fast6g` can be selected, checked, started, stopped, and logged;
- both versions read `config/profiles/active.json`;
- non-neutral `styles.*.refs` resolve through shared `prompts/library`;
- style audio reaches IndexTTS as `emo_audio_prompt`;
- `/health`, `/profiles/active`, `/voices`, `/tts_dialogue_stream_job`, `/tts_dialogue_job_status/{key}`, and `/cache_audio/{key}` keep the same contract;
- missing common package, missing engine package, invalid active profile, missing style refs, occupied RPC/API port, and broken runtime all produce clear launcher/API errors instead of hidden fallbacks.

## Rough Effort

Conservative estimate:

- startup/env/profile commonization: 0.5-1 day;
- shared Python utility extraction: 1 day;
- shared API route + job/cache extraction: 2-3 days;
- engine adapter cleanup and package manifests: 1-2 days;
- real vLLM + fast6g validation: 0.5-1 day.

Total: about 5-8 engineering days if we avoid unrelated UI redesign and long audio benchmarks.

## Current Status 2026-06-12

Stage 3 API/job contract split is closed here. Do not continue by moving model loading or segment inference into common code; keep those as engine adapter responsibilities.

Completed:

- Stage 1 shared startup entry exists: `scripts/restart-leon-api.ps1 -Version vllm|fast6g`.
- Tauri launcher and both version BAT files call the shared startup entry.
- Old WinForms launcher files were retired; current launcher entry is `LEON-Launcher-Tauri.exe`.
- Stage 2 low-risk helper extraction is partially complete:
  - `leon_common/profile_store.py`
  - `leon_common/voice_library.py`
  - `leon_common/llm_proxy.py`
  - `leon_common/prompt_render.py`
  - `leon_common/profile_config.py`
  - `leon_common/cache_contracts.py`
- Both `vllm/indextts/` and `fast6g/indextts/` keep compatibility wrappers for those shared helpers.
- fast6g API now uses the shared voice library for `/voices` and `_resolve_voice()`, matching vLLM behavior.
- Stage 3 API/job contract split is in place:
  - `leon_common/api/routes.py` owns shared response builders for `/profiles/active`, `/voices`, `GET`/`HEAD /cache_audio/{key}`, `/static/tavo.js`, `/tavo_test`, `HEAD /tavo_test`, and `/server_log/tail`;
  - `leon_common/api/jobs.py` owns the shared engine-adapter protocol, TTS queue bookkeeping, dialogue job start/reuse responses, status responses, cancellation marking, and `preserve_completed` delete contract;
  - `vllm/indextts/api_routes.py` and `fast6g/indextts/api_routes.py` are thin compatibility wrappers;
  - `vllm/indextts/api_jobs.py` and `fast6g/indextts/api_jobs.py` are thin compatibility wrappers;
  - both `vllm/indextts2_api.py` and `fast6g/indextts2_api.py` keep the public route decorators and engine-specific prepare/run/stream functions, then delegate shared contracts to the common helpers.

Not done yet:

- `leon_common/env_probe.py` is not extracted yet. Current env/GPU probing is still split between PowerShell startup and Tauri Rust, so avoid creating a premature Python abstraction.
- Stage 3 now has the API/job contract boundary in place. Continue by moving route registration and voice-management wrappers if useful. Do not move TTS model loading or segment inference into common code; those should remain engine adapter responsibilities.
- Engine adapters and package manifests are still future stages. The current stop point is intentional: common code owns API/job/cache contracts, while `vllm` and `fast6g` keep engine-specific prepare/run/stream/inference.

Latest no-start validation passed:

```powershell
python -m py_compile leon_common\__init__.py leon_common\profile_store.py leon_common\voice_library.py leon_common\llm_proxy.py leon_common\prompt_render.py leon_common\profile_config.py leon_common\cache_contracts.py leon_common\api\__init__.py leon_common\api\routes.py leon_common\api\jobs.py vllm\indextts\api_routes.py fast6g\indextts\api_routes.py vllm\indextts\api_jobs.py fast6g\indextts\api_jobs.py vllm\indextts2_api.py fast6g\indextts2_api.py fast6g\indextts\infer_v2.py
python -c "from indextts.api_routes import load_active_profile, voices_list_response, cache_audio_get_response, cache_audio_head_response; p=load_active_profile(r'D:\apiWorkSpace\leon_api\config\profiles\active.json'); print('vllm api_routes ok', p.get('version'))"
python -c "from indextts.api_routes import load_active_profile, voices_list_response, cache_audio_get_response, cache_audio_head_response; p=load_active_profile(r'D:\apiWorkSpace\leon_api\config\profiles\active.json'); print('fast6g api_routes ok', p.get('version'))"
python -c "from indextts.api_routes import static_file_path, static_tavo_js_response, tavo_test_response, tavo_test_head_response; static_dir=r'D:\apiWorkSpace\leon_api\static'; print(bool(static_file_path(static_dir,'tavo.js')), type(static_tavo_js_response(static_dir)).__name__, type(tavo_test_response(static_dir)).__name__, tavo_test_head_response(static_dir).status_code)"
python -c "from indextts.api_jobs import TtsQueue, dialogue_job_start_response, dialogue_job_status_response, dialogue_job_delete_response; print('api_jobs ok', TtsQueue.__name__)"
python -c "from indextts import voice_library; from indextts.profile_config import default_active_profile, validate_active_profile; from indextts.cache_contracts import cache_audio_headers, media_type_for_audio_path; print(len(voice_library.list_voices())); print(voice_library.get_voice_path('声腔/喘息-AD学姐'))"
powershell.exe -NoProfile -ExecutionPolicy Bypass -File scripts\restart-leon-api.ps1 -Version vllm -ValidateOnly
powershell.exe -NoProfile -ExecutionPolicy Bypass -File scripts\restart-leon-api.ps1 -Version fast6g -ValidateOnly
git diff --check
```

Validation notes:

- Import checks passed from both `vllm/` and `fast6g/` cwd.
- Shared voice library count was `1093` from both engine cwd paths.
- `active.json` validated successfully in both startup validate-only runs.
- No API service was started or restarted, and no TTS generation was run.
