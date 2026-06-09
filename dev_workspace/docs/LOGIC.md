# LEON Tavo Playback Logic

This file is the source of truth for Tavo generation, playback, storage, and live-page exit behavior.

Before changing `static/tavo.js`, `static/tavo.runtime.js`, `static/tavo.runtime.parts/*`, Tavo storage keys, live playback, saved playback, or LLM reuse, read this file first.

## Hard Rules

- There is no "live card". There are ordinary audio cards only.
- LIVE is a playback page/mode, not a card type.
- An audio card is created immediately when generation starts. While unfinished, it is still the same ordinary card with a generating/saving state.
- Saved/history playback means complete audio playback only. It must not enter the LIVE path.
- Backgrounding, switching pages, opening console, lock screen, and system media controls are not exits.
- Only the explicit "exit live" button enters live-exit logic.
- Tavo offline audio saving and playback are separate: save complete `/cache_audio/<cacheKey>` bytes as a chat-scoped dataUrl file, then play by `tavo.file.load(...)` plus a local `blob:` URL. Do not use `tavo.file.url()` or raw dataUrl as the `<audio src>` for audio playback.
- LLM parse cache is message-scoped. Reuse means "use the existing parsed result and skip the LLM request".

## Boundaries

- Frontend: Tavo injected player and storage in `static/`.
- API backend: HTTP routes in `vllm/indextts2_api.py` and `fast6g/indextts2_api.py`.
- TTS service: IndexTTS2 synthesis pipeline.
- Launcher: local Windows control surface.

Do not call the TTS service "backend" when discussing state. Most bugs here are frontend state bugs or API route contract bugs.

## Canonical State Model

Keep these layers separate.

### 1. Card Generation State

This describes the ordinary audio card itself:

- `generating`: job has started, complete audio has not landed.
- `saving`: synthesis is complete or nearly complete, final file is being written.
- `ready`: complete audio is available.
- `failed`: job failed.
- `cancelled`: job was explicitly cancelled before landing.

Legacy field names such as `pending`, `live`, `saved`, `serverState`, `cacheState`, `remoteCacheState`, `status`, `pendingBlob`, and `streaming` may still exist in current code. They are implementation details and must be normalized into the card generation state before making UI or delete decisions.

`live` in any legacy field must never be interpreted as "a live card".

### 2. Live Page State

This describes the current playback UI/session:

- `livePageActive`: the user is currently in the realtime playback page/mode.
- `livePageActive=false`: the player is showing normal card/history playback.

Exiting the live page is a UI/session action. It is not automatically a card deletion.

### 3. Playback Source State

This describes the current `<audio>` source:

- `offlineBlob`: Tavo file exists and was loaded through `tavo.file.load` into a `blob:` URL.
- `cacheAudio`: complete audio from `/cache_audio/<cacheKey>`.
- `liveMp3`: realtime MP3 output from `/tts_dialogue_stream_job/<cacheKey>/mp3`, only while the live page is active and the card has not been confirmed ready.
- `none`: no playable source yet.

Saved/history playback may use only `offlineBlob` or `cacheAudio`.

## New Generation Flow

When the user clicks the music-note button or play/generate entry on a new message:

1. Create an ordinary audio card immediately.
2. Store it under the message-scoped card history.
3. Check playback mode.
4. Resolve LLM parse input by the message-scoped LLM cache rules.
5. Start the API backend job.

The card exists before audio lands. It is not a live card.

## LLM Parse Cache

The LLM parse cache belongs to the current Tavo message.

Rules:

1. If `reuseLlmParse` is enabled and a valid parsed result exists for this message, use it and skip the LLM request.
2. If `reuseLlmParse` is enabled but no valid parsed result exists, call LLM once, then save the parsed result with `tavo.set` in message scope.
3. If `reuseLlmParse` is disabled, call LLM, then overwrite the message-scoped parsed result with `tavo.set`.
4. Do not show "waiting for LLM" when a valid reused parse result is being used.

The cache key must be tied to message identity, not mutable message text.

## LIVE Mode Flow

LIVE mode means the frontend may play realtime audio while the ordinary card is still generating.

1. Create the ordinary card.
2. Check or create the message-scoped LLM parse result.
3. Start the API backend job.
4. Play realtime MP3 through native `<audio>` when available.
5. Poll or check final landing state in parallel.
6. When complete audio lands, the same ordinary card becomes `ready`.

Normal app lifecycle events do not exit LIVE:

- app background
- page switch
- console switch
- lock screen
- system media pause/play/seek
- WebView remount

For these events, do not delete jobs, do not delete cards, do not write task-level `pausedByUser`, and do not mark the card as exited. Native `<audio>` may naturally play, pause, or seek, but the card/job state must not be mutated as an exit.

## Explicit Exit Live Button

Only the explicit exit-live button runs this logic.

1. Check whether the current ordinary card has landed or is saving.
2. If landed or saving:
   - exit the live page only;
   - keep the card;
   - do not delete the API job/cache;
   - do not delete local card history.
3. If not landed:
   - cancel/delete the API backend job;
   - delete the unfinished ordinary card;
   - delete the pending/generating record for that card;
   - exit the live page.
4. If cancellation or local persistence cleanup fails:
   - keep the card visible;
   - keep it retryable;
   - surface the failure.

The order matters. Never remove the card before the backend cancellation and local storage cleanup have both been confirmed.

## Abnormal Re-Entry

If Tavo/WebView/app dies while a card is still generating:

1. Rehydrate the ordinary card from message-scoped storage.
2. Before restoring realtime playback, check whether complete audio has landed.
3. If landed, mark the card `ready` and use normal saved/history playback.
4. If not landed and the job is still recoverable, restore the realtime session for the same job/key.
5. Do not create a new job just because the WebView remounted.

## DISK Mode Flow

DISK mode is asynchronous complete-audio generation.

1. Create the ordinary card.
2. Check or create the message-scoped LLM parse result.
3. Start the API backend job.
4. Poll/check landing state.
5. When ready, play complete audio only.

DISK mode must not use realtime live playback routes. Segment generation inside the TTS service is an implementation detail; the frontend still waits for the final complete audio.

## Saved/History Playback

When a card is ready:

Offline save contract:

1. Confirm complete cache audio exists.
2. Fetch `/cache_audio/<cacheKey>` as a Blob.
3. Convert the Blob to a `data:audio/...;base64,...` dataUrl.
4. Save with `tavo.file.save(name, dataUrl, { scope: "chat", encoding: "dataUrl" })`.
5. Store only lightweight metadata in `tavo.set`; do not store large audio dataUrls in variables.

Playback contract:

1. Prefer Tavo offline file if it exists.
2. Load Tavo offline audio using `tavo.file.load(name, { scope: "chat", encoding: "dataUrl" })`.
3. Convert the returned dataUrl to a `blob:` URL.
4. Set `<audio src>` to that `blob:` URL and mark source as offline blob.
5. If the Tavo file is missing or cannot be loaded, use `/cache_audio/<cacheKey>`.

Do not use `tavo.file.url()` or the path returned by `tavo.file.save()` as the audio source. Some Tavo WebViews expose that URL as a non-seekable or unsupported stream, which breaks saved seek behavior. Tavo file encodings here are `utf8`, `dataUrl`, and `base64`; do not invent `byte`.

Saved/history seek rules:

- Seek target is seconds.
- Seek writes `audio.currentTime` on the complete audio source.
- Seek must not request `/tts_dialogue_stream_job/...`.
- Seek must not request `/mp3?start_s=...`.
- Subtitle highlight and progress UI must follow the actual complete-audio seek, not run independently.

## Storage Rules

The primary card history is message-scoped.

Use message identity as the storage key. Do not key card recovery by mutable message text.

Pending/generating records are auxiliary recovery data only. If card history and pending data disagree:

1. A landed/ready card wins over pending/generating data.
2. A ready card must never be demoted into realtime playback.
3. Stale pending data must be cleared after a ready card is confirmed.

## Regression Checks

Any change touching this logic should prove at least these cases:

- Saved offline playback uses `blob:` from `tavo.file.load`, not `files/chat/...`.
- Offline save writes `tavo.file.save(..., { encoding: "dataUrl" })` after fetching complete `/cache_audio/<cacheKey>`.
- Saved playback seek changes real `audio.currentTime`, progress, and highlighted subtitle together.
- Saved playback seek emits no LIVE route request.
- LIVE background/app switch/system media controls do not delete tasks/cards and do not write task-level pause state.
- Explicit exit live preserves landed/saving cards.
- Explicit exit live deletes unfinished cards only after confirmed cancellation and storage cleanup.
- DISK cards poll landing and play complete audio only.
- LLM reuse hit skips the LLM request.
