# IndexTTS Tavo Runtime Parts

`static/tavo.runtime.js` is a small manifest-driven loader. It fetches these fragments, concatenates them in order, and executes them as the original runtime closure.

The fragments are behavior-equivalent slices of the current IndexTTS2 runtime. They intentionally share one closure after concatenation; do not treat them as standalone scripts yet.

Business boundary: these files come from the IndexTTS2 `static/tavo.js` runtime. Do not paste GPT-SoVITS TTS/job/cache/audio business logic here. Only loader structure, skin CSS, and asset patterns are borrowed.

Order:
1. `00_base_context.js` - bootstrap, config constants, Tavo context helpers.
2. `05_style_config.js` - style loading, global config, message context.
3. `10_tracks_icons.js` - track persistence, icons, base API helpers.
4. `20_generation_params.js` - style presets, legacy LLM reuse helpers, single/dialogue job helpers, audio priming.
5. `25_web_audio_stream.js` - Web Audio WAV streaming.
6. `30_llm_parse.js` - legacy frontend LLM parse prompt and normalization. Normal Tavo intelligent generation is backend-owned via `/tts_dialogue_stream_job`.
7. `40_mount_shell.js` - player shell mount and DOM references.
8. `42_playback_header.js` - header, status, seek helpers.
9. `44_element_audio.js` - native element audio controls.
10. `46_track_state.js` - track state, offline cache, live playback helpers.
11. `48_track_history.js` - track selection, cache upgrade, history and delete flow.
12. `50_settings_fields.js` - settings fields, role validation and voice list loading.
13. `52_subtitle_media.js` - subtitle and MediaSession handling.
14. `54_voice_picker.js` - role rows and voice picker panel.
15. `60_generate_flow.js` - single and multi-role generate flow.
16. `62_events_boot.js` - dialog, audio event bindings, runtime bootstrap.
