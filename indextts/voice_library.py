import re
import shutil
from pathlib import Path
from typing import Optional


VOICE_LIB_DIR = "prompts/library"
VOICE_LIB_EXTS = (".wav", ".mp3", ".flac", ".ogg", ".m4a")

_INVALID_NAME_CHARS = re.compile(r'[\\:*?"<>|\x00-\x1f]')
_INVALID_COMPONENT_CHARS = re.compile(r'[\\/:*?"<>|\x00-\x1f]')


def safe_voice_name(name: str) -> str:
    """Return a library-safe voice identifier capped at 160 chars.

    允许 "/" 作为子目录分隔符(如 "男声/陈宇")。每段(由 / 分隔)各自做 windows 文件名
    清洗,并禁止 ".." 越级。"""
    raw = (name or "").strip().strip("/")
    if not raw:
        return ""
    cleaned = _INVALID_NAME_CHARS.sub("", raw)
    parts = [p for p in cleaned.split("/") if p and p != "." and p != ".."]
    cleaned_parts = [_INVALID_COMPONENT_CHARS.sub("", p) for p in parts]
    cleaned_parts = [p for p in cleaned_parts if p]
    joined = "/".join(cleaned_parts)
    return joined[:160]


def list_voices() -> list[dict]:
    """List saved voices recursively, walking sub-directories.

    name: 相对 library 的不带扩展名路径，如 "男声/陈宇" 或 "高圆圆"。
    path: 仓库内相对路径，给 `_resolve_voice` 使用。
    subdir: "男声" / "女声" / "旁白" 这类一级子目录,方便前端分组显示。
    """
    library_dir = Path(VOICE_LIB_DIR)
    if not library_dir.is_dir():
        return []

    items = []
    for path in library_dir.rglob("*"):
        if not path.is_file():
            continue
        ext = path.suffix.lower()
        if ext not in VOICE_LIB_EXTS:
            continue
        try:
            size_bytes = path.stat().st_size
        except OSError:
            continue
        rel = path.relative_to(library_dir)
        rel_posix = rel.as_posix()
        name = rel.with_suffix("").as_posix()  # 子目录前缀作为 name 一部分
        subdir = rel.parts[0] if len(rel.parts) > 1 else ""
        items.append(
            {
                "name": name,
                "path": _format_voice_path(path),
                "ext": ext,
                "size_bytes": size_bytes,
                "subdir": subdir,
            }
        )

    items.sort(key=lambda item: (item.get("subdir", ""), item["name"].lower(), item["name"], item["ext"]))
    return items


def get_voice_path(name: str) -> Optional[str]:
    """Return a saved voice path by name (with or without subdir prefix), or None.

    支持三种写法:
      "高圆圆"          → library/高圆圆.{wav,mp3,...} 任一存在的即取
      "男声/陈宇"      → library/男声/陈宇.{ext}
      "library/.../x"  → 直接当相对路径解释
    无前缀写法找不到时,会递归扫所有子目录找 stem 同名的文件。
    """
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
    """按 safe_name 找文件,支持带子目录的写法。

    优先级:
      1) 直接路径 + 各扩展名: library/{safe_name}{ext}
      2) 整库递归找文件名匹配(忽略大小写)
      3) 整库递归按 stem 匹配(用户输无前缀名时兜底)
    """
    library_dir = Path(VOICE_LIB_DIR)
    if not library_dir.is_dir():
        return None

    # 1) 直接路径
    for ext in VOICE_LIB_EXTS:
        path = library_dir / f"{safe_name}{ext}"
        if path.is_file():
            return path

    # 2) 忽略大小写的全路径匹配
    target_lower = (safe_name + "").lower()
    for ext in VOICE_LIB_EXTS:
        wanted = (safe_name + ext).lower()
        for p in library_dir.rglob("*" + ext):
            if p.is_file() and p.relative_to(library_dir).as_posix().lower() == wanted:
                return p

    # 3) stem 匹配(无前缀)
    base = safe_name.rsplit("/", 1)[-1]
    for p in library_dir.rglob("*"):
        if not p.is_file():
            continue
        if p.suffix.lower() in VOICE_LIB_EXTS and p.stem == base:
            return p
        if p.suffix.lower() in VOICE_LIB_EXTS and p.stem.lower() == base.lower():
            return p

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
