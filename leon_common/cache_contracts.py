"""Shared cache/audio contract helpers for LEON API backends."""

from __future__ import annotations

import os
from typing import Any, Optional


def media_type_for_audio_path(path: str) -> str:
    return "audio/mpeg" if os.path.splitext(str(path or ""))[1].lower() == ".mp3" else "audio/wav"


def cache_audio_headers(key: str, path: str, extra: Optional[dict] = None) -> dict:
    headers = {
        "X-IndexTTS-Cache": "HIT",
        "X-IndexTTS-Cache-Key": key,
        "X-IndexTTS-Audio-Format": "mp3" if media_type_for_audio_path(path) == "audio/mpeg" else "wav",
        "Accept-Ranges": "bytes",
    }
    if extra:
        headers.update(extra)
    return headers


def audio_file_meta(path: str) -> dict:
    try:
        st = os.stat(path)
        return {"size": st.st_size, "mtime": int(st.st_mtime)}
    except OSError:
        return {}


def segment_meta_at(segments_meta: list, segment_idx: int) -> tuple[int, Optional[dict]]:
    for pos, meta in enumerate(segments_meta or []):
        if isinstance(meta, dict) and int(meta.get("idx", pos)) == int(segment_idx):
            return pos, meta
    if 0 <= int(segment_idx) < len(segments_meta or []):
        meta = segments_meta[int(segment_idx)]
        return int(segment_idx), meta if isinstance(meta, dict) else None
    return -1, None


def model_to_dict(value: Any) -> dict:
    if value is None:
        return {}
    if hasattr(value, "model_dump"):
        return value.model_dump()
    if hasattr(value, "dict"):
        return value.dict()
    return dict(value or {})


__all__ = [
    "audio_file_meta",
    "cache_audio_headers",
    "media_type_for_audio_path",
    "model_to_dict",
    "segment_meta_at",
]
