"""Shared FastAPI route helpers for LEON engine backends."""

from .routes import (
    active_profile_response,
    cache_audio_get_response,
    cache_audio_head_response,
    load_active_profile,
    server_log_tail_response,
    static_file_head_response,
    static_file_path,
    static_file_response,
    static_tavo_js_response,
    tavo_test_head_response,
    tavo_test_response,
    voices_list_response,
)
from .jobs import (
    TtsEngineAdapter,
    TtsQueue,
    cached_job_status,
    dialogue_job_delete_response,
    dialogue_job_start_response,
    dialogue_job_status_response,
    mark_job_cancelled,
)

__all__ = [
    "active_profile_response",
    "cache_audio_get_response",
    "cache_audio_head_response",
    "load_active_profile",
    "server_log_tail_response",
    "static_file_head_response",
    "static_file_path",
    "static_file_response",
    "static_tavo_js_response",
    "tavo_test_head_response",
    "tavo_test_response",
    "voices_list_response",
    "TtsEngineAdapter",
    "TtsQueue",
    "cached_job_status",
    "dialogue_job_delete_response",
    "dialogue_job_start_response",
    "dialogue_job_status_response",
    "mark_job_cancelled",
]
