import re
import shutil
from pathlib import Path
from typing import Optional


VOICE_LIB_DIR = "prompts/library"
VOICE_LIB_EXTS = (".wav", ".mp3", ".flac", ".ogg", ".m4a")

_INVALID_NAME_CHARS = re.compile(r'[\\/:*?"<>|\x00-\x1f]')


def safe_voice_name(name: str) -> str:
    """Return a Windows-safe voice filename stem capped at 60 chars."""
    cleaned = _INVALID_NAME_CHARS.sub("", (name or "").strip())
    return cleaned[:60]


def list_voices() -> list[dict]:
    """List saved voices with name, relative path, extension, and byte size."""
    library_dir = Path(VOICE_LIB_DIR)
    if not library_dir.is_dir():
        return []

    items = []
    for path in library_dir.iterdir():
        if not path.is_file():
            continue

        ext = path.suffix.lower()
        if ext not in VOICE_LIB_EXTS:
            continue

        try:
            size_bytes = path.stat().st_size
        except OSError:
            continue

        items.append(
            {
                "name": path.stem,
                "path": _format_voice_path(path),
                "ext": ext,
                "size_bytes": size_bytes,
            }
        )

    items.sort(key=lambda item: (item["name"].lower(), item["name"], item["ext"]))
    return items


def get_voice_path(name: str) -> Optional[str]:
    """Return a saved voice path by name, or None when it does not exist."""
    safe = safe_voice_name(name)
    if not safe:
        return None

    path = _find_voice_path(safe)
    if path is None:
        return None
    return _format_voice_path(path)


def save_voice(audio_bytes: bytes, name: str, ext: str = ".wav") -> str:
    """Save uploaded audio bytes and return the final voice file path."""
    safe = safe_voice_name(name)
    if not safe:
        raise ValueError("voice name is empty")

    normalized_ext = _normalize_voice_ext(ext)
    dst = _voice_path(safe, normalized_ext)
    dst.parent.mkdir(parents=True, exist_ok=True)
    _delete_existing_voice_files(safe, keep=dst)

    with dst.open("wb") as file:
        file.write(audio_bytes)

    return _format_voice_path(dst)


def save_voice_from_path(source_path: str, name: str) -> str:
    """Copy a local audio file into the voice library and return its path."""
    safe = safe_voice_name(name)
    if not safe:
        raise ValueError("voice name is empty")

    source = Path(source_path)
    if not source.is_file():
        raise FileNotFoundError(source_path)

    normalized_ext = _normalize_voice_ext(source.suffix)
    dst = _voice_path(safe, normalized_ext)
    dst.parent.mkdir(parents=True, exist_ok=True)
    _delete_existing_voice_files(safe, keep=dst)

    if source.resolve(strict=False) != dst.resolve(strict=False):
        shutil.copy2(source, dst)

    return _format_voice_path(dst)


def delete_voice(name: str) -> bool:
    """Delete a saved voice by name, returning False when absent or failed."""
    safe = safe_voice_name(name)
    if not safe:
        return False

    path = _find_voice_path(safe)
    if path is None:
        return False

    try:
        path.unlink()
    except OSError:
        return False
    return True


def _normalize_voice_ext(ext: str) -> str:
    ext = (ext or ".wav").lower()
    if not ext.startswith("."):
        ext = "." + ext
    if ext not in VOICE_LIB_EXTS:
        return ".wav"
    return ext


def _voice_path(name: str, ext: str) -> Path:
    return Path(VOICE_LIB_DIR) / f"{name}{ext}"


def _find_voice_path(safe_name: str) -> Optional[Path]:
    library_dir = Path(VOICE_LIB_DIR)
    for ext in VOICE_LIB_EXTS:
        path = library_dir / f"{safe_name}{ext}"
        if path.is_file():
            return path

    if not library_dir.is_dir():
        return None

    for ext in VOICE_LIB_EXTS:
        target_name = f"{safe_name}{ext}".lower()
        for path in library_dir.iterdir():
            if path.is_file() and path.name.lower() == target_name:
                return path

    return None


def _delete_existing_voice_files(safe_name: str, keep: Optional[Path] = None) -> None:
    keep_resolved = keep.resolve(strict=False) if keep is not None else None
    for ext in VOICE_LIB_EXTS:
        path = _voice_path(safe_name, ext)
        if keep_resolved is not None and path.resolve(strict=False) == keep_resolved:
            continue
        try:
            path.unlink()
        except FileNotFoundError:
            continue


def _format_voice_path(path: Path) -> str:
    return path.as_posix()
