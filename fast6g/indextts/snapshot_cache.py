"""Pure file cache helpers for reusable TTS snapshots."""

from __future__ import annotations

import hashlib
import json
import os
import re
import shutil
from datetime import datetime, timezone
from typing import Optional


CACHE_DIR = os.path.join("outputs", "cache")
READABLE_CACHE_DIR = os.path.join(CACHE_DIR, "by_role")
_KEY_RE = re.compile(r"^[0-9a-f]{40}$")
_AUDIO_FORMATS = {
    "mp3": (".mp3", "audio/mpeg"),
    "wav": (".wav", "audio/wav"),
}
_WINDOWS_BAD_CHARS_RE = re.compile(r'[<>:"/\\|?*\x00-\x1f]')
_WINDOWS_RESERVED_NAMES = {
    "CON",
    "PRN",
    "AUX",
    "NUL",
    *(f"COM{i}" for i in range(1, 10)),
    *(f"LPT{i}" for i in range(1, 10)),
}


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _now_stamp() -> str:
    return datetime.now().strftime("%Y%m%d-%H%M%S-%f")[:-3]


def _validate_key(key: str) -> str:
    if not isinstance(key, str) or not _KEY_RE.fullmatch(key):
        raise ValueError("cache key must be a 40-character sha1 hex string")
    return key


def _ensure_cache_dir() -> None:
    os.makedirs(CACHE_DIR, exist_ok=True)


def _ensure_parent_dir(path: str) -> None:
    parent = os.path.dirname(path)
    if parent:
        os.makedirs(parent, exist_ok=True)


def _read_metadata(path: str) -> dict:
    try:
        with open(path, "r", encoding="utf-8") as fp:
            data = json.load(fp)
    except (FileNotFoundError, json.JSONDecodeError, OSError):
        return {}
    return data if isinstance(data, dict) else {}


def _write_json_atomic(path: str, data: dict) -> None:
    _ensure_parent_dir(path)
    tmp_path = f"{path}.tmp"
    with open(tmp_path, "w", encoding="utf-8") as fp:
        json.dump(data, fp, ensure_ascii=False, sort_keys=True, indent=2)
        fp.write("\n")
    os.replace(tmp_path, path)


def _write_bytes_atomic(path: str, data: bytes) -> None:
    _ensure_parent_dir(path)
    tmp_path = f"{path}.tmp"
    with open(tmp_path, "wb") as fp:
        fp.write(data)
    os.replace(tmp_path, path)


def _safe_path_label(value: str, fallback: str = "未命名角色") -> str:
    label = str(value or "").strip()
    label = _WINDOWS_BAD_CHARS_RE.sub("_", label)
    label = re.sub(r"\s+", " ", label).strip(" .")
    if not label:
        label = fallback
    if label.upper() in _WINDOWS_RESERVED_NAMES:
        label = f"_{label}"
    return label[:64]


def _add_role(roles: list[str], value) -> None:
    role = str(value or "").strip()
    if role and role not in roles:
        roles.append(role)


def _collect_roles_from_segments(roles: list[str], segments) -> None:
    if not isinstance(segments, list):
        return
    for item in segments:
        if isinstance(item, dict):
            role = str(item.get("role") or "").strip()
            if role:
                roles.append(role)


def _role_labels_from_metadata(metadata: dict) -> list[str]:
    roles: list[str] = []
    if not isinstance(metadata, dict):
        return ["单音色"]

    _collect_roles_from_segments(roles, metadata.get("segments_meta"))
    _collect_roles_from_segments(roles, metadata.get("segments"))

    raw_roles = metadata.get("roles")
    if isinstance(raw_roles, list):
        for role in raw_roles:
            _add_role(roles, role)

    params = metadata.get("params")
    if isinstance(params, dict):
        _collect_roles_from_segments(roles, params.get("segments"))
        raw_param_roles = params.get("roles")
        if isinstance(raw_param_roles, list):
            for role in raw_param_roles:
                _add_role(roles, role)

    if not roles:
        return ["单音色"]

    counts: dict[str, int] = {}
    first_seen: dict[str, int] = {}
    for idx, role in enumerate(roles):
        counts[role] = counts.get(role, 0) + 1
        first_seen.setdefault(role, idx)

    generic_roles = {"旁白", "对白", "对话", "default", "单音色", "narrator", "dialogue"}
    preferred = [role for role in counts if role not in generic_roles and role.lower() not in generic_roles]
    candidates = preferred or list(counts)
    primary = max(candidates, key=lambda role: (counts[role], -first_seen[role]))
    return [primary]


def _readable_entries_from_metadata(metadata: dict) -> list[dict]:
    entries = metadata.get("readable_cache") if isinstance(metadata, dict) else None
    if not isinstance(entries, list):
        return []
    return [entry for entry in entries if isinstance(entry, dict)]


def _readable_paths_from_entries(entries: list[dict]) -> list[str]:
    paths: list[str] = []
    for entry in entries:
        for field in ("path", "metadata_path"):
            path = entry.get(field)
            if isinstance(path, str) and path:
                paths.append(path)
    return paths


def _find_readable_paths_for_key(key: str) -> list[str]:
    if not os.path.isdir(READABLE_CACHE_DIR):
        return []
    paths: list[str] = []
    suffixes = (f"_{key}.wav", f"_{key}.mp3", f"_{key}.json")
    for root, _dirs, files in os.walk(READABLE_CACHE_DIR):
        for name in files:
            if name.endswith(suffixes):
                paths.append(os.path.join(root, name))
    return paths


def _delete_paths(paths: list[str]) -> bool:
    deleted = False
    cleaned_dirs: list[str] = []
    for path in paths:
        try:
            os.remove(path)
        except FileNotFoundError:
            continue
        except OSError:
            continue
        else:
            deleted = True
            cleaned_dirs.append(os.path.dirname(path))

    for directory in sorted(set(cleaned_dirs), key=len, reverse=True):
        try:
            os.rmdir(directory)
        except OSError:
            pass
    return deleted


def _link_or_copy_audio(src_path: str, dest_path: str) -> str:
    _ensure_parent_dir(dest_path)
    tmp_path = f"{dest_path}.tmp"
    try:
        os.remove(tmp_path)
    except FileNotFoundError:
        pass
    try:
        os.link(src_path, tmp_path)
        storage = "hardlink"
    except OSError:
        shutil.copy2(src_path, tmp_path)
        storage = "copy"
    os.replace(tmp_path, dest_path)
    return storage


def _audio_format_from_path(path: str) -> str:
    ext = os.path.splitext(str(path or ""))[1].lower()
    return "mp3" if ext == ".mp3" else "wav"


def _normalize_audio_format(value) -> str:
    raw = str(value or "").strip().lower().lstrip(".")
    if raw in ("mpeg", "audio/mpeg"):
        raw = "mp3"
    if raw in ("wave", "x-wav", "audio/wav", "audio/wave"):
        raw = "wav"
    return raw if raw in _AUDIO_FORMATS else "wav"


def _metadata_audio_format(metadata: dict) -> str:
    if not isinstance(metadata, dict):
        return "wav"
    return _normalize_audio_format(
        metadata.get("audio_format")
        or metadata.get("format")
        or metadata.get("cache_audio_format")
        or metadata.get("content_type")
    )


def _audio_path_for_key(key: str, audio_format: str = "wav") -> str:
    key = _validate_key(key)
    ext, _media = _AUDIO_FORMATS[_normalize_audio_format(audio_format)]
    return os.path.join(CACHE_DIR, f"{key}{ext}")


def _existing_audio_path(key: str, preferred_format: Optional[str] = None) -> Optional[str]:
    key = _validate_key(key)
    preferred = _normalize_audio_format(preferred_format) if preferred_format else None
    candidates = [preferred] if preferred else ["mp3", "wav"]
    for audio_format in candidates:
        path = _audio_path_for_key(key, audio_format)
        if os.path.isfile(path):
            return path
    return None


def _create_readable_entries(key: str, audio_path: str, metadata: dict) -> list[dict]:
    roles = _role_labels_from_metadata(metadata)
    stamp = _now_stamp()
    audio_format = _audio_format_from_path(audio_path)
    ext, media_type = _AUDIO_FORMATS[audio_format]
    entries: list[dict] = []
    for role in roles:
        role_dir = os.path.join(READABLE_CACHE_DIR, _safe_path_label(role))
        filename = f"{stamp}_{key}"
        readable_audio = os.path.join(role_dir, f"{filename}{ext}")
        readable_json = os.path.join(role_dir, f"{filename}.json")
        storage = _link_or_copy_audio(audio_path, readable_audio)
        entries.append(
            {
                "role": role,
                "path": readable_audio,
                "metadata_path": readable_json,
                "storage": storage,
                "audio_format": audio_format,
                "content_type": media_type,
                "created_at": metadata.get("created_at"),
            }
        )
    return entries


def _sync_readable_metadata(metadata: dict) -> None:
    for entry in _readable_entries_from_metadata(metadata):
        json_path = entry.get("metadata_path")
        if isinstance(json_path, str) and json_path:
            _write_json_atomic(json_path, metadata)


def make_cache_key(payload: dict) -> str:
    """Create a stable sha1 cache key for a request payload."""
    stable = json.dumps(payload, ensure_ascii=False, sort_keys=True, default=str)
    return hashlib.sha1(stable.encode("utf-8")).hexdigest()


def cache_paths(key: str) -> tuple[str, str]:
    """Return the legacy wav path and metadata JSON path for a validated key."""
    key = _validate_key(key)
    return (
        os.path.join(CACHE_DIR, f"{key}.wav"),
        os.path.join(CACHE_DIR, f"{key}.json"),
    )


def get_cached_audio(key: str, format: Optional[str] = None) -> Optional[str]:
    """Return cached audio path if present and update hit metadata.

    With no format, MP3 is preferred when available and WAV remains a
    backwards-compatible fallback for older snapshots and debug caches.
    Passing format="wav" or format="mp3" requires that specific file.
    """
    key = _validate_key(key)
    json_path = os.path.join(CACHE_DIR, f"{key}.json")
    audio_path = _existing_audio_path(key, preferred_format=format)
    if not audio_path:
        return None

    metadata = _read_metadata(json_path)
    metadata["key"] = key
    audio_format = _audio_format_from_path(audio_path)
    metadata["audio_format"] = audio_format
    metadata["content_type"] = _AUDIO_FORMATS[audio_format][1]
    metadata.setdefault("created_at", _now_iso())
    try:
        hit_count = int(metadata.get("hit_count", 0))
    except (TypeError, ValueError):
        hit_count = 0
    metadata["hit_count"] = hit_count + 1
    metadata["last_hit_at"] = _now_iso()
    _write_json_atomic(json_path, metadata)
    _sync_readable_metadata(metadata)
    return audio_path


def save_cached_audio(key: str, audio_bytes: bytes, metadata: dict, audio_format: Optional[str] = None, debug_wav_bytes: Optional[bytes] = None) -> str:
    """Persist cached audio bytes and metadata, returning the main audio path."""
    key = _validate_key(key)
    _, json_path = cache_paths(key)
    audio_format = _normalize_audio_format(audio_format or _metadata_audio_format(metadata))
    audio_path = _audio_path_for_key(key, audio_format)
    ext, media_type = _AUDIO_FORMATS[audio_format]
    old_metadata = _read_metadata(json_path)
    saved_metadata = dict(metadata or {})
    saved_metadata["key"] = key
    saved_metadata["audio_format"] = audio_format
    saved_metadata["content_type"] = media_type
    saved_metadata["audio_ext"] = ext
    saved_metadata.setdefault("created_at", _now_iso())
    saved_metadata.setdefault("hit_count", 0)
    saved_metadata.setdefault("last_hit_at", None)

    stale_paths = _readable_paths_from_entries(_readable_entries_from_metadata(old_metadata))
    stale_paths.extend(_find_readable_paths_for_key(key))
    _delete_paths(stale_paths)

    stale_main = [_audio_path_for_key(key, fmt) for fmt in _AUDIO_FORMATS if fmt != audio_format]
    _delete_paths([p for p in stale_main if not (debug_wav_bytes and p.endswith(".wav"))])

    _write_bytes_atomic(audio_path, bytes(audio_bytes or b""))
    if debug_wav_bytes:
        wav_path = _audio_path_for_key(key, "wav")
        _write_bytes_atomic(wav_path, bytes(debug_wav_bytes))
        saved_metadata["debug_audio"] = {
            "audio_format": "wav",
            "content_type": "audio/wav",
            "path": wav_path,
        }
    saved_metadata["readable_cache"] = _create_readable_entries(key, audio_path, saved_metadata)
    _write_json_atomic(json_path, saved_metadata)
    _sync_readable_metadata(saved_metadata)
    return audio_path


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
    """Delete cached audio and metadata files for a key."""
    wav_path, json_path = cache_paths(key)
    mp3_path = _audio_path_for_key(key, "mp3")
    metadata = _read_metadata(json_path)
    readable_paths = _readable_paths_from_entries(_readable_entries_from_metadata(metadata))
    readable_paths.extend(_find_readable_paths_for_key(_validate_key(key)))
    deleted = False
    for path in (wav_path, mp3_path, json_path):
        try:
            os.remove(path)
        except FileNotFoundError:
            continue
        except OSError:
            continue
        else:
            deleted = True
    if _delete_paths(readable_paths):
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
