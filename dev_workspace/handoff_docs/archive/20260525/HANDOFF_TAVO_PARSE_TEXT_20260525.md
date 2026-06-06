# HANDOFF TAVO /parse_text 2026-05-25

## Repo State

- Worktree: `D:\apiWorkSpace\index-tts2-vLLM\.claude\worktrees\tavo-api`
- Branch: `VLLM-tavo-api`
- Remotes: `origin` and `userrepo` point to `https://github.com/928886540/index-tts-vLLM`
- Current HEAD: `a0a6e4c [codex] Link TAVO docs and refresh phase status`

Do not reset this branch. Do not delete unfamiliar Claude/Codex commits. Do not add the voice reference audio directory.

## Already Pushed

- `487fcef [codex] Refine TAVO lightweight UI and LLM prompt docs`
- `23fa58b [codex] Add TAVO selector guide and richer test page`
- `a0a6e4c [codex] Link TAVO docs and refresh phase status`

These are already on `origin/VLLM-tavo-api` and `userrepo/VLLM-tavo-api`.

## Current Uncommitted Work

Expected `git status --short`:

```text
 M MASTER_PLAN_PHASE2_PLUS.md
 M QUICKSTART_TAVO.md
 M TAVO_API_REFERENCE_20260525.md
 M indextts2_api.py
 M static/tavo.js
?? indextts/llm_proxy.py
?? HANDOFF_TAVO_PARSE_TEXT_20260525.md
```

All current uncommitted work belongs to one feature: optional TAVO LLM parse proxy via `POST /parse_text`.

## New File: `indextts/llm_proxy.py`

Purpose:

- Calls an OpenAI-compatible `/v1/chat/completions` endpoint using Python stdlib only.
- Exposes `parse_text_openai_compatible(...)`, returning normalized `{"segments": [...]}`.
- Exposes `extract_json_object(raw)` for pure JSON, fenced JSON, and mixed text.
- Exposes `normalize_segments(data)` to clean `role`, `text`, optional `emo_vec[8]`, `emo_text`, and `emo_alpha`.
- Does not save API keys and masks the key in HTTP error detail.

This file has already passed:

```powershell
D:\apiWorkSpace\index-tts2-vLLM\indextts2runtime\python.exe -m py_compile indextts\llm_proxy.py
```

## API Changes: `indextts2_api.py`

Current changes:

- Added `Parse_Text_Request`.
- Added `POST /parse_text`.
- Uses `asyncio.to_thread(...)` around `llm_proxy.parse_text_openai_compatible(...)`.
- Added `/parse_text` to the startup route banner.

Boundary:

- `/parse_text` does not run IndexTTS and does not use GPU.
- It only makes a network request to the user-configured third-party LLM endpoint.
- The API key is forwarded for that request only and is not persisted.

## Frontend Changes: `static/tavo.js`

Current changes:

- Added `cfg.llm.mode`: `client` or `server`.
- Added settings select `LLM call mode` with browser-direct and local `/parse_text` proxy choices.
- `parseTextToSegments(...)` now supports:
  - `client`: browser calls the third-party LLM directly.
  - `server`: browser calls local `/parse_text`, which proxies to the third-party LLM.
- Extracted shared `cleanSegments(data, rawText)`.

User-facing intent:

- TAVO still injects only one JS file.
- LLM parsing remains optional.
- Server proxy mode is for CORS-blocked TAVO WebViews.
- No LLM config still falls back to single-segment `default` voice.

## Docs Touched

- `QUICKSTART_TAVO.md`: documents browser-direct vs local `/parse_text` proxy mode.
- `TAVO_API_REFERENCE_20260525.md`: adds `POST /parse_text` request/response/security notes.
- `MASTER_PLAN_PHASE2_PLUS.md`: marks P4B `/parse_text` as complete.

## Static Checks Already Run

These passed before this handoff was written:

```powershell
node --check static\tavo.js
D:\apiWorkSpace\index-tts2-vLLM\indextts2runtime\python.exe -m py_compile indextts2_api.py indextts\llm_proxy.py indextts\voice_library.py indextts\snapshot_cache.py indextts\profile_store.py
git diff --check
```

