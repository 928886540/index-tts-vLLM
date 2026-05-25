# TAVO API Reference 2026-05-25

Scope: local IndexTTS HTTP API for the lightweight TAVO bridge.

Base URL example:

```text
http://127.0.0.1:9880
http://192.168.x.x:9880
```

GPU rule:

- Does not trigger inference: `/health`, `/voices`, `/cache`, `/profiles`, `/usage`, `/static/*`.
- Triggers IndexTTS inference on cache miss or direct stream: `/tts_stream`, `/tts_cache_stream`, `/tts_dialogue_stream`, `/tts_dialogue_cache_stream`.

## Static

### GET `/static/tavo.js`

Single-file TAVO browser bridge. TAVO only needs:

```html
<script src="http://192.168.x.x:9880/static/tavo.js"></script>
```

The script stores settings in browser `localStorage` under `indextts_tavo_config`.

### GET `/static/test.html`

Static mock page for checking TAVO-style DOM injection and settings UI. It does not call TTS until a user clicks an audio card.

Related docs:

- `QUICKSTART_TAVO.md`: first-run setup for non-technical users.
- `TAVO_SELECTOR_GUIDE_20260525.md`: selector, regex, and one-line injection troubleshooting.
- `TAVO_LLM_PROMPT_20260525.md`: optional third-party LLM parsing prompt and JSON schema.

## Health

### GET `/health`

Purpose: lightweight liveness check.

Response:

```json
{"status": "ok"}
```

No GPU use.

## Voices

### GET `/voices`

Purpose: list local voice library files from `prompts/library`.

Response:

```json
{
  "voices": [
    {
      "name": "narrator",
      "path": "prompts/library/narrator.wav",
      "ext": ".wav",
      "size_bytes": 123456
    }
  ]
}
```

No GPU use.

### POST `/voices`

Purpose: save a voice into `prompts/library`.

Request using local path:

```json
{
  "name": "alice",
  "source_path": "D:/voices/alice.wav"
}
```

Request using base64 bytes:

```json
{
  "name": "alice",
  "audio_base64": "UklGR...",
  "ext": ".wav"
}
```

Response:

```json
{"name": "alice", "path": "prompts/library/alice.wav"}
```

No GPU use.

### DELETE `/voices/{name}`

Purpose: delete one library voice.

Response:

```json
{"deleted": true, "name": "alice"}
```

No GPU use.

## Single-Segment TTS

### GET `/tts_stream`

Purpose: stream one text segment as WAV.

Example:

```text
/tts_stream?text=hello&ref_audio_path=narrator&emo_text=calm
```

Important query params:

- `text`: required.
- `ref_audio_path`: required. Can be a `prompts/library` voice name or a direct file path.
- `emo_text`: optional natural language emotion prompt.
- `emo_alpha`: default `0.7`.
- `top_p`, `top_k`, `temperature`, `repetition_penalty`: sampling controls.

Return type: `audio/wav`, chunked WAV.

Triggers GPU inference.

### POST `/tts_stream`

Same behavior, JSON body:

```json
{
  "text": "深夜的雨打在玻璃上。",
  "ref_audio_path": "narrator",
  "emo_text": "低声、平静",
  "top_k": 30,
  "top_p": 0.8,
  "temperature": 0.8,
  "emo_alpha": 0.7,
  "repetition_penalty": 10
}
```

Return type: `audio/wav`.

Triggers GPU inference.

### GET/POST `/tts_cache_stream`

Purpose: same as `/tts_stream`, but uses local snapshot cache.

Cache storage:

```text
outputs/cache/<sha1>.wav
outputs/cache/<sha1>.json
```

Response headers:

```text
X-IndexTTS-Cache: HIT
X-IndexTTS-Cache-Key: <sha1>
```

or:

```text
X-IndexTTS-Cache: MISS
X-IndexTTS-Cache-Key: <sha1>
```

GPU behavior:

- `HIT`: no inference.
- `MISS`: triggers inference, then writes cache after the stream finishes.

## Dialogue TTS

### POST `/tts_dialogue_stream`

Purpose: stream multi-role dialogue with per-segment emotion.

Request:

```json
{
  "segments": [
    {
      "role": "narrator",
      "text": "深夜的雨打在玻璃上。",
      "emo_vec": [0, 0, 0, 0, 0, 0, 0, 0.3]
    },
    {
      "role": "小明",
      "text": "你怎么还不睡？",
      "emo_text": "压低声音, 带着轻微喘息"
    }
  ],
  "voices": {
    "default": "narrator",
    "narrator": "narrator",
    "小明": "alice"
  },
  "interval_ms": 350,
  "top_p": 0.8,
  "top_k": 30,
  "temperature": 0.8,
  "repetition_penalty": 10,
  "emo_alpha": 0.7
}
```

Notes:

- `role` maps through `voices`.
- `voices` values can be library names or direct file paths.
- `emo_vec` must be 8 numbers when provided.
- `emo_vec` wins over `emo_text`.
- `emo_text` is useful for natural language emotion such as breath, tremble, whisper, or anger.

Return type: `audio/wav`, chunked WAV.

Triggers GPU inference.

### POST `/tts_dialogue_cache_stream`

Purpose: same as `/tts_dialogue_stream`, but caches the whole generated dialogue WAV.

Response headers:

```text
X-IndexTTS-Cache: HIT|MISS
X-IndexTTS-Cache-Key: <sha1>
```

GPU behavior:

- `HIT`: no inference.
- `MISS`: triggers inference, then saves the final WAV snapshot.

## Cache

### GET `/cache?limit=200`

Purpose: list snapshot cache metadata.

Response:

```json
{
  "items": [
    {
      "key": "40_char_sha1",
      "text_preview": "深夜的雨打在玻璃上。",
      "hit_count": 3,
      "created_at": "2026-05-25T00:00:00+00:00",
      "last_hit_at": "2026-05-25T00:10:00+00:00"
    }
  ]
}
```

No GPU use.

TAVO UI note: `static/tavo.js` only calls this endpoint when the user clicks the settings panel cache refresh button.

### POST `/cache/prune`

Purpose: keep only the newest or most recently used cache entries.

Request:

```json
{"max_items": 5000}
```

Response:

```json
{"deleted": 12, "max_items": 5000}
```

No GPU use.

TAVO UI note: `static/tavo.js` only calls this endpoint when the user clicks "清理旧缓存".

### DELETE `/cache/{key}`

Purpose: delete one snapshot by cache key.

Response:

```json
{"deleted": true, "key": "40_char_sha1"}
```

No GPU use.

TAVO UI note: `static/tavo.js` only calls this endpoint when the user deletes a selected cache entry.

## Profiles

Profiles are optional SQLite-backed presets stored by `indextts/profile_store.py`.

### GET `/profiles`

Purpose: list saved TAVO config profiles.

Response:

```json
{
  "profiles": [
    {
      "id": 1,
      "name": "default-local",
      "data": {},
      "created_at": "2026-05-25T00:00:00+00:00",
      "updated_at": "2026-05-25T00:10:00+00:00"
    }
  ]
}
```

No GPU use.

### GET `/profiles/{name}`

Purpose: load one saved profile.

404 response when missing:

```json
{"message": "profile not found", "name": "default-local"}
```

No GPU use.

### POST `/profiles`

Purpose: save one profile.

Request:

```json
{
  "name": "default-local",
  "data": {
    "apiBase": "http://192.168.x.x:9880",
    "voiceMap": {
      "default": "narrator",
      "narrator": "narrator",
      "小明": "alice"
    },
    "llm": {
      "enabled": true,
      "endpoint": "https://api.openai.com/v1/chat/completions",
      "model": "gpt-4o-mini",
      "systemPrompt": ""
    }
  }
}
```

Security note: `static/tavo.js` removes `llm.apiKey` before saving profiles. The API does not need or require the LLM key.

Response:

```json
{"id": 1, "name": "default-local"}
```

No GPU use.

### DELETE `/profiles/{name}`

Purpose: delete one profile.

Response:

```json
{"deleted": true, "name": "default-local"}
```

No GPU use.

## Usage

### GET `/usage?limit=200`

Purpose: list optional local usage logs.

Response:

```json
{"items": []}
```

No GPU use.

### POST `/usage`

Purpose: append one optional usage event.

Request:

```json
{
  "event_type": "tts_play",
  "payload": {
    "cache_key": "40_char_sha1",
    "role_count": 3
  }
}
```

Response:

```json
{"id": 1, "event_type": "tts_play"}
```

No GPU use.

## LLM Parse Proxy

### POST `/parse_text`

Purpose: optional OpenAI-compatible server-side proxy for TAVO text parsing. This is useful when the browser or TAVO WebView cannot call a third-party LLM endpoint directly because of CORS.

Request:

```json
{
  "text": "雨声敲着窗。小明低声说：\"你怎么还不睡？\"",
  "endpoint": "https://api.openai.com/v1/chat/completions",
  "model": "gpt-4o-mini",
  "api_key": "not saved by the server",
  "system_prompt": "Use TAVO_LLM_PROMPT_20260525.md or the default prompt from tavo.js",
  "temperature": 0.2,
  "timeout": 60
}
```

Response:

```json
{
  "segments": [
    {
      "role": "narrator",
      "text": "雨声敲着窗。",
      "emo_vec": [0, 0, 0, 0, 0, 0, 0, 0.2]
    },
    {
      "role": "小明",
      "text": "你怎么还不睡？",
      "emo_text": "压低声音，带轻微喘息"
    }
  ]
}
```

GPU behavior: no IndexTTS inference. This endpoint only performs a network request to the configured third-party LLM.

Security note: the API key is forwarded for that request only. `static/tavo.js` still keeps it in browser `localStorage`; the server proxy does not persist it.

## TAVO Config Example

Browser `localStorage` key: `indextts_tavo_config`.

```json
{
  "apiBase": "http://192.168.x.x:9880",
  "chatSelector": "#chat",
  "messageSelector": ".mes",
  "textSelector": ".mes_text",
  "voiceMap": {
    "default": "narrator",
    "narrator": "narrator",
    "小明": "alice",
    "小红": "bob"
  },
  "llm": {
    "enabled": true,
    "provider": "openai",
    "endpoint": "https://api.openai.com/v1/chat/completions",
    "apiKey": "stored only in browser localStorage",
    "model": "gpt-4o-mini",
    "systemPrompt": ""
  },
  "params": {
    "top_p": 0.8,
    "top_k": 30,
    "temperature": 0.8,
    "repetition_penalty": 10,
    "emo_alpha": 0.7,
    "interval_ms": 350
  },
  "localRegex": {
    "enabled": true,
    "mode": "first-match",
    "rules": [
      "\\[TTS\\]([\\s\\S]*?)\\[/TTS\\]",
      "<tts>([\\s\\S]*?)</tts>"
    ]
  },
  "cache": {
    "enabled": true
  },
  "autoPlay": false
}
```
