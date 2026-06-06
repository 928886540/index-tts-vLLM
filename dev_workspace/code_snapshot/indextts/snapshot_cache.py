"""Pure file cache helpers for reusable TTS snapshots."""

from __future__ import annotations

import hashlib
import json
import os
import re
from datetime import datetime, timezone
from typing import Optional


CACHE_DIR = os.path.join("outputs", "cache")
_KEY_RE = re.compile(r"^[0-9a-f]{40}$")


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _validate_key(key: str) -> str:
    if not isinstance(key, str) or not _KEY_RE.fullmatch(key):
        raise ValueError("cache key must be a 40-character sha1 hex string")
    return key


def _ensure_cache_dir() -> None:
    os.makedirs(CACHE_DIR, exist_ok=True)


def _read_metadata(path: str) -> dict:
    try:
        with open(path, "r", encoding="utf-8") as fp:
            data = json.load(fp)
    except (FileNotFoundError, json.JSONDecodeError, OSError):
        return {}
    return data if isinstance(data, dict) else {}


def _write_json_atomic(path: str, data: dict) -> None:
    _ensure_cache_dir()
    tmp_path = f"{path}.tmp"
    with open(tmp_path, "w", encoding="utf-8") as fp:
        json.dump(data, fp, ensure_ascii=False, sort_keys=True, indent=2)
        fp.write("\n")
    os.replace(tmp_path, path)


def _write_bytes_atomic(path: str, data: bytes) -> None:
    _ensure_cache_dir()
    tmp_path = f"{path}.tmp"
    with open(tmp_path, "wb") as fp:
        fp.write(data)
    os.replace(tmp_path, path)


def make_cache_key(payload: dict) -> str:
    """Create a stable sha1 cache key for a request payload."""
    stable = json.dumps(payload, ensure_ascii=False, sort_keys=True, default=str)
    return hashlib.sha1(stable.encode("utf-8")).hexdigest()


def cache_paths(key: str) -> tuple[str, str]:
    """Return the wav and metadata JSON paths for a validated cache key."""
    key = _validate_key(key)
    return (
        os.path.join(CACHE_DIR, f"{key}.wav"),
        os.path.join(CACHE_DIR, f"{key}.json"),
    )


def get_cached_audio(key: str) -> Optional[str]:
    """Return cached wav path if present and update hit metadata."""
    wav_path, json_path = cache_paths(key)
    if not os.path.isfile(wav_path):
        return None

    metadata = _read_metadata(json_path)
    metadata["key"] = key
    metadata.setdefault("created_at", _now_iso())
    try:
        hit_count = int(metadata.get("hit_count", 0))
    except (TypeError, ValueError):
        hit_count = 0
    metadata["hit_count"] = hit_count + 1
    metadata["last_hit_at"] = _now_iso()
    _write_json_atomic(json_path, metadata)
    return wav_path


def save_cached_audio(key: str, audio_bytes: bytes, metadata: dict) -> str:
    """Persist cached wav bytes and metadata, returning the wav path."""
    wav_path, json_path = cache_paths(key)
    saved_metadata = dict(metadata or {})
    saved_metadata["key"] = key
    saved_metadata.setdefault("created_at", _now_iso())
    saved_metadata.setdefault("hit_count", 0)
    saved_metadata.setdefault("last_hit_at", None)

    _write_bytes_atomic(wav_path, audio_bytes)
    _write_json_atomic(json_path, saved_metadata)
    return wav_path


def list_cache(limit: int = 200) -> list[dict]:
    """List cache metadata ordered from most recently used to oldest."""
    if not os.path.isdir(CACHE_DIR):
        return []

    items = []
    for name in os.listdir(CACHE_DIR):
        if not name.endswith(".json"):
            continue
        key = name[:-5]
        if not _KEY_RE.fullmatch(key):
            continue
        metadata = _read_metadata(os.path.join(CACHE_DIR, name))
        if not metadata:
            continue
        metadata.setdefault("key", key)
        items.append(metadata)

    items.sort(key=lambda item: item.get("last_hit_at") or item.get("created_at") or "", reverse=True)
    return items[: max(0, int(limit))]


def delete_cache(key: str) -> bool:
    """Delete cached wav and metadata files for a key."""
    wav_path, json_path = cache_paths(key)
    deleted = False
    for path in (wav_path, json_path):
        try:
            os.remove(path)
        except FileNotFoundError:
            continue
        except OSError:
            continue
        else:
            deleted = True
    return deleted


def prune_cache(max_items: int = 5000) -> int:
    """Remove oldest cache entries when the cache exceeds max_items."""
    max_items = max(0, int(max_items))
    items = list_cache(limit=10**9)
    overflow = len(items) - max_items
    if overflow <= 0:
        return 0

    deleted = 0
    for item in sorted(items, key=lambda entry: entry.get("last_hit_at") or entry.get("created_at") or "")[:overflow]:
        key = item.get("key")
        if isinstance(key, str) and _KEY_RE.fullmatch(key) and delete_cache(key):
            deleted += 1
    return deleted
