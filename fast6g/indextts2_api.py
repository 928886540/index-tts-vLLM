import os
import sys
import traceback
import base64
import hashlib
import html
import json
import re
import secrets
import socket
import time
from collections import deque
from pathlib import Path
from typing import Optional, List, Dict

now_dir = os.getcwd()

import argparse
import asyncio
import signal
import numpy as np
import soundfile as sf
from fastapi import FastAPI, Response
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse, JSONResponse, FileResponse
from fastapi.staticfiles import StaticFiles
import uvicorn
from io import BytesIO

from indextts.infer_v2 import IndexTTS2
from indextts import snapshot_cache

from pydantic import BaseModel

"""
import torchaudio
### monkey patch
_original_torchaudio_save = torchaudio.save
def patched_save(uri, src, sample_rate, format=None, **kwargs):
    if format is None:
        format = 'wav'
    return _original_torchaudio_save(uri, src, sample_rate, format=format, **kwargs)
torchaudio.save = patched_save
###
"""

parser = argparse.ArgumentParser()
parser.add_argument("--model_dir", type=str, default="./checkpoints", help="Model checkpoints directory")
parser.add_argument("-a", "--bind_addr", type=str, default="127.0.0.1", help="default: 127.0.0.1")
parser.add_argument("-p", "--port", type=int, default="9880", help="default: 9880")
parser.add_argument("--fp16", action="store_true", default=False, help="Use FP16 for inference if available")
parser.add_argument("--qwen_emo", action="store_true", default=False, help="Deprecated no-op. Qwen emotion is not used by the launcher path.")
parser.add_argument("--no_qwen_emo", dest="qwen_emo", action="store_false", help="Disable deprecated Qwen emotion model.")
args = parser.parse_args()
if args.qwen_emo:
    print(">> Qwen emotion is deprecated for LEON voice-cavity mode; forcing --no_qwen_emo.")
args.qwen_emo = False

# device = args.device
port = args.port
host = args.bind_addr
argv = sys.argv


LOG_BUFFER = deque(maxlen=1000)


class _StdoutTee:
    def __init__(self, real, label):
        self._real = real
        self._label = label
        self._partial = ""

    def write(self, s):
        try:
            self._real.write(s)
        except Exception:
            pass
        try:
            self._partial += s
            while "\n" in self._partial:
                line, self._partial = self._partial.split("\n", 1)
                line = line.rstrip("\r")
                if line:
                    LOG_BUFFER.append({"ts": time.time(), "stream": self._label, "line": line})
        except Exception:
            pass

    def flush(self):
        try:
            self._real.flush()
        except Exception:
            pass

    def __getattr__(self, name):
        return getattr(self._real, name)


try:
    sys.stdout = _StdoutTee(sys.stdout, "stdout")
    sys.stderr = _StdoutTee(sys.stderr, "stderr")
except Exception:
    pass


def _resolve_dir_from_env(env_name: str, *candidates: str) -> Optional[str]:
    env_value = os.getenv(env_name)
    paths = []
    if env_value:
        paths.append(env_value)
    paths.extend(candidates)
    for path in paths:
        if not path:
            continue
        abs_path = os.path.abspath(path)
        if os.path.isdir(abs_path):
            return abs_path
    return None


APP_ROOT = os.path.abspath(os.getcwd())
WORKSPACE_ROOT = os.path.abspath(os.getenv("LEON_ROOT") or os.path.join(APP_ROOT, os.pardir))
STATIC_DIR = _resolve_dir_from_env(
    "LEON_STATIC_DIR",
    os.path.join(APP_ROOT, "static"),
    os.path.join(WORKSPACE_ROOT, "static"),
    os.path.join(APP_ROOT, os.pardir, "static"),
)
VOICE_LIB_EXTS = (".wav", ".mp3", ".flac", ".ogg", ".m4a")


def _voice_dir_has_audio(path: str) -> bool:
    try:
        root = Path(path)
        if not root.is_dir():
            return False
        return any(p.is_file() and p.suffix.lower() in VOICE_LIB_EXTS for p in root.rglob("*"))
    except Exception:
        return False


def _resolve_voice_library_dir() -> str:
    env_path = os.getenv("LEON_VOICE_LIB_DIR")
    if env_path:
        abs_env = os.path.abspath(env_path)
        if os.path.isdir(abs_env):
            return abs_env
    candidates = [
        os.path.join(APP_ROOT, "prompts", "library"),
        os.path.join(WORKSPACE_ROOT, "prompts", "library"),
        os.path.join(WORKSPACE_ROOT, "vllm", "prompts", "library"),
    ]
    existing = []
    for candidate in candidates:
        abs_path = os.path.abspath(candidate)
        if not os.path.isdir(abs_path):
            continue
        existing.append(abs_path)
        if _voice_dir_has_audio(abs_path):
            return abs_path
    return existing[0] if existing else os.path.join(APP_ROOT, "prompts", "library")


VOICE_LIB_DIR = _resolve_voice_library_dir()
CACHE_DIR = os.path.join("outputs", "cache")
snapshot_cache.CACHE_DIR = CACHE_DIR
snapshot_cache.READABLE_CACHE_DIR = os.path.join(CACHE_DIR, "by_role")
HTML_TAG_RE = re.compile(r"<[^>]+>")
HTML_BLOCK_RE = re.compile(r"<([A-Za-z][A-Za-z0-9:_-]*)(?:\s[^>]*)?>[\s\S]*?</\1\s*>", re.IGNORECASE)
HTML_VOID_RE = re.compile(r"<\s*(?:br|hr|img|input|meta|link|source|track|wbr|area|base|col|embed|param)\b[^>]*\/?\s*>", re.IGNORECASE)
EMOJI_RE = re.compile(
    "["
    "\U0001F1E6-\U0001F1FF"
    "\U0001F300-\U0001FAFF"
    "\U00002700-\U000027BF"
    "\U00002600-\U000026FF"
    "]+",
    re.UNICODE,
)
CONTROL_RE = re.compile(r"[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]")
SENTENCE_SPLIT_RE = re.compile(r"([^。！？!?；;\n]+[。！？!?；;]*|\n+)")
LIVE_JOB_LINGER_SECONDS = 300
BACKEND_LLM_PARSE_PROMPT_VERSION = "20260606-fast6g-backend-v1"
BACKEND_NORMAL_PARSE_VERSION = "20260607-fast6g-normal-v2"
LLM_PARSE_CACHE_MAX = 64
LLM_PARSE_CACHE: Dict[str, dict] = {}
STREAM_MODE_SETTINGS = {
    "fast": {
        "target_tokens": 40,
        "diffusion_steps": 8,
        "prompt_audio_seconds": 6,
        "s2mel_cfg_rate": 0.7,
    },
    "balanced": {
        "target_tokens": 60,
        "diffusion_steps": 14,
        "prompt_audio_seconds": 10,
        "s2mel_cfg_rate": 0.7,
    },
    "expressive": {
        "target_tokens": 72,
        "diffusion_steps": 16,
        "prompt_audio_seconds": 12,
        "s2mel_cfg_rate": 0.7,
    },
    "ultra": {
        "target_tokens": 96,
        "diffusion_steps": 20,
        "prompt_audio_seconds": 14,
        "s2mel_cfg_rate": 0.7,
    },
}

STYLE_VOICE_MAP = {
    "neutral": "",
    "none": "",
    "breath_soft": "声腔/轻喘-AD学姐",
    "breath_heavy": "声腔/喘息-AD学姐",
    "intimate_breath": "声腔/喘息-AD学姐",
    "low_murmur": "声腔/低吟-AD学姐",
    "whisper_soft": "声腔/耳语-AD学姐",
    "shy_whisper": "声腔/低语-AD学姐",
    "tense_breath": "声腔/惊喘-AD学姐",
    "sob_soft": "声腔/哽咽-AD学姐",
    "cry_soft": "声腔/哭腔-AD学姐",
    "tease_soft": "声腔/挑逗-AD学姐",
    "laugh_soft": "声腔/轻笑-AD学姐",
    "gasp_surprise": "声腔/惊喘-AD学姐",
    "scream_peak": "声腔/尖叫-AD学姐",
    "stage_warmup": "声腔/轻喘-AD学姐",
    "stage_rising": "声腔/喘息-AD学姐",
    "stage_peak": "声腔/尖叫-AD学姐",
    "stage_afterglow": "声腔/余韵-AD学姐",
}

_PERSON_STYLE_NAMES = (
    "轻喘",
    "喘息",
    "耳语",
    "低语",
    "低吟",
    "惊喘",
    "哭腔",
    "哽咽",
    "挑逗",
    "轻笑",
    "尖叫",
    "余韵",
)

for _style_speaker in ("步非烟", "AD学姐", "JOK"):
    for _style_name in _PERSON_STYLE_NAMES:
        _style_id = f"{_style_name}-{_style_speaker}"
        STYLE_VOICE_MAP[_style_id] = f"声腔/{_style_id}"


def _static_file_path(name: str) -> Optional[str]:
    if not STATIC_DIR:
        return None
    path = os.path.abspath(os.path.join(STATIC_DIR, name))
    if os.path.commonpath([STATIC_DIR, path]) != STATIC_DIR:
        return None
    return path if os.path.isfile(path) else None


def _safe_voice_name(name: str) -> str:
    raw = str(name or "").strip().strip("/")
    if not raw:
        return ""
    raw = re.sub(r'[\\:*?"<>|\x00-\x1f]', "", raw)
    parts = [re.sub(r'[\\/:*?"<>|\x00-\x1f]', "", p) for p in raw.split("/") if p and p not in (".", "..")]
    return "/".join(p for p in parts if p)[:160]


def _voice_lookup_candidates(name: str) -> List[str]:
    raw = str(name or "").strip().strip("\"'")
    if not raw:
        return []
    normalized = raw.replace("\\", "/").strip("/")
    values = [normalized]
    lower = normalized.lower()
    for marker in ("prompts/library/", "library/"):
        idx = lower.rfind(marker)
        if idx >= 0:
            values.append(normalized[idx + len(marker):])
    expanded = []
    for value in values:
        value = value.strip("/")
        if not value:
            continue
        expanded.append(value)
        for ext in VOICE_LIB_EXTS:
            if value.lower().endswith(ext):
                expanded.append(value[:-len(ext)])
                break
    out = []
    seen = set()
    for value in expanded:
        key = value.lower()
        if value and key not in seen:
            seen.add(key)
            out.append(value)
    return out


def _format_voice_path(path: Path) -> str:
    return path.as_posix()


def _find_voice_path(name: str) -> Optional[Path]:
    library_dir = Path(VOICE_LIB_DIR)
    if not library_dir.is_dir():
        return None
    for candidate in _voice_lookup_candidates(name):
        safe = _safe_voice_name(candidate)
        if not safe:
            continue
        for ext in VOICE_LIB_EXTS:
            path = library_dir / f"{safe}{ext}"
            if path.is_file():
                return path
        base = safe.rsplit("/", 1)[-1]
        wanted = safe.lower()
        for path in library_dir.rglob("*"):
            if not path.is_file() or path.suffix.lower() not in VOICE_LIB_EXTS:
                continue
            rel = path.relative_to(library_dir).with_suffix("").as_posix()
            if rel.lower() == wanted or path.stem == base or path.stem.lower() == base.lower():
                return path
    return None


def _list_voices() -> list[dict]:
    library_dir = Path(VOICE_LIB_DIR)
    if not library_dir.is_dir():
        return []
    items = []
    for path in library_dir.rglob("*"):
        if not path.is_file() or path.suffix.lower() not in VOICE_LIB_EXTS:
            continue
        rel = path.relative_to(library_dir)
        items.append({
            "name": rel.with_suffix("").as_posix(),
            "path": _format_voice_path(path),
            "ext": path.suffix.lower(),
            "size_bytes": path.stat().st_size,
            "subdir": rel.parts[0] if len(rel.parts) > 1 else "",
        })
    items.sort(key=lambda item: (item["subdir"], item["name"].lower(), item["name"]))
    return items


def _resolve_voice(name_or_path: str) -> Optional[str]:
    if not name_or_path:
        return None
    raw = str(name_or_path).strip()
    for candidate in (raw, os.path.join(APP_ROOT, raw), os.path.join(WORKSPACE_ROOT, raw)):
        if os.path.exists(candidate):
            return candidate
    path = _find_voice_path(raw)
    return _format_voice_path(path) if path else None


def _ensure_cache_dir() -> None:
    os.makedirs(CACHE_DIR, exist_ok=True)


def _make_cache_key(payload: dict) -> str:
    return snapshot_cache.make_cache_key(payload)


def _cache_paths(key: str) -> tuple[str, str]:
    return snapshot_cache.cache_paths(key)


def _get_cached_audio(key: str) -> Optional[str]:
    return snapshot_cache.get_cached_audio(key)


def _write_json_atomic(path: str, data: dict) -> None:
    os.makedirs(os.path.dirname(path), exist_ok=True)
    tmp = f"{path}.tmp"
    with open(tmp, "w", encoding="utf-8") as fp:
        json.dump(data, fp, ensure_ascii=False, sort_keys=True, indent=2)
        fp.write("\n")
    os.replace(tmp, path)


def _save_cached_audio(key: str, wav_bytes: bytes, metadata: dict) -> str:
    return snapshot_cache.save_cached_audio(key, wav_bytes, metadata)


def _read_cache_metadata(key: str) -> dict:
    _wav_path, json_path = _cache_paths(key)
    try:
        with open(json_path, "r", encoding="utf-8") as fp:
            data = json.load(fp)
        return data if isinstance(data, dict) else {}
    except Exception:
        return {}


def _delete_cache(key: str) -> bool:
    return snapshot_cache.delete_cache(key)


def _audio_file_meta(path: str) -> dict:
    try:
        st = os.stat(path)
        return {"size": st.st_size, "mtime": int(st.st_mtime)}
    except OSError:
        return {}


def _clean_tavo_body_text(text: str) -> str:
    text = html.unescape(str(text or ""))
    for _ in range(12):
        before = text
        text = html.unescape(text)
        text = re.sub(r"<!--[\s\S]*?-->", "\n", text)
        text = HTML_BLOCK_RE.sub("\n", text)
        text = HTML_VOID_RE.sub("\n", text)
        text = HTML_TAG_RE.sub("\n", text)
        if text == before:
            break
    text = re.sub(r"\[[A-Za-z0-9_-]*TAVO[A-Za-z0-9_-]*\]", "\n", text, flags=re.IGNORECASE)
    text = re.sub(r"\[IndexTTS_TAVO_SCRIPT\]", "\n", text, flags=re.IGNORECASE)
    text = text.replace("<", "\n").replace(">", "\n")
    text = CONTROL_RE.sub("", text)
    text = EMOJI_RE.sub("", text)
    text = re.sub(r"^[ \t>*#\-_=~`]+", "", text, flags=re.MULTILINE)
    text = re.sub(r"[ \t\u3000]+", " ", text)
    text = re.sub(r"\n{3,}", "\n\n", text)
    return text.strip()


def _split_text_units(text: str, max_chars: int = 86) -> List[str]:
    units = []
    for match in SENTENCE_SPLIT_RE.finditer(str(text or "")):
        part = (match.group(1) or "").strip()
        if part and not part.isspace():
            units.append(part)
    if not units and text:
        units = [str(text)]
    out = []
    for part in units:
        while len(part) > max_chars:
            out.append(part[:max_chars].strip())
            part = part[max_chars:]
        if part.strip():
            out.append(part.strip())
    return out


def _parse_dialogue_text_normal(text: str) -> list[dict]:
    text = _clean_tavo_body_text(text)
    if not text:
        raise RuntimeError("no readable text")
    segments = []
    quote_pairs = {"「": "」", "『": "』", "“": "”", "‘": "’", "\"": "\""}
    narration = []
    i = 0

    def flush_narration():
        raw = "".join(narration).strip()
        narration.clear()
        for unit in _split_text_units(raw):
            segments.append({"role": "旁白", "text": unit})

    while i < len(text):
        ch = text[i]
        if ch in quote_pairs:
            closer = quote_pairs[ch]
            j = i + 1
            inner = []
            found = False
            while j < len(text):
                if text[j] == closer:
                    found = True
                    break
                inner.append(text[j])
                j += 1
            if found:
                flush_narration()
                for unit in _split_text_units("".join(inner)):
                    segments.append({"role": "对白", "text": unit})
                i = j + 1
                continue
        narration.append(ch)
        i += 1
    flush_narration()
    return segments or [{"role": "旁白", "text": text}]


def _clamp_float(value, default: float, low: float, high: float) -> float:
    try:
        number = float(value)
    except (TypeError, ValueError):
        number = float(default)
    return max(float(low), min(float(high), number))


def _clamp_int(value, default: int, low: int, high: int) -> int:
    try:
        number = int(value)
    except (TypeError, ValueError):
        number = int(default)
    return max(int(low), min(int(high), number))


def _stream_mode_settings(mode: str = "balanced") -> dict:
    mode = str(mode or "balanced").strip().lower()
    if mode not in STREAM_MODE_SETTINGS:
        mode = "balanced"
    return dict(STREAM_MODE_SETTINGS[mode], mode=mode)


def _dialogue_infer_kwargs(req: dict) -> dict:
    settings = _stream_mode_settings(req.get("performance_mode") or "balanced")
    target_tokens = int(settings["target_tokens"])
    if req.get("segment_tokens") is not None:
        target_tokens = _clamp_int(req.get("segment_tokens"), target_tokens, 8, 120)
    prompt_seconds = float(settings["prompt_audio_seconds"])
    if req.get("prompt_audio_seconds") is not None:
        prompt_seconds = _clamp_float(req.get("prompt_audio_seconds"), prompt_seconds, 2.0, 16.0)
    diffusion_steps = int(settings["diffusion_steps"])
    if req.get("diffusion_steps") is not None:
        diffusion_steps = _clamp_int(req.get("diffusion_steps"), diffusion_steps, 2, 24)
    cfg_rate = float(settings.get("s2mel_cfg_rate", 0.7))
    if req.get("s2mel_cfg_rate") is not None:
        cfg_rate = _clamp_float(req.get("s2mel_cfg_rate"), cfg_rate, 0.1, 1.2)
    return {
        "performance_mode": settings["mode"],
        "max_text_tokens_per_segment": target_tokens,
        "diffusion_steps": diffusion_steps,
        "max_prompt_audio_seconds": prompt_seconds,
        "max_emo_audio_seconds": prompt_seconds,
        "s2mel_cfg_rate": cfg_rate,
    }


def _generation_cache_payload(req: dict) -> dict:
    kwargs = _dialogue_infer_kwargs(req)
    return {
        "performance_mode": kwargs["performance_mode"],
        "segment_tokens": kwargs["max_text_tokens_per_segment"],
        "diffusion_steps": kwargs["diffusion_steps"],
        "prompt_audio_seconds": kwargs["max_prompt_audio_seconds"],
        "s2mel_cfg_rate": kwargs["s2mel_cfg_rate"],
    }


def _secret_hash(value: str) -> str:
    value = str(value or "")
    if not value:
        return ""
    return hashlib.sha1(value.encode("utf-8")).hexdigest()


def _normalize_role(role: str) -> str:
    from indextts.llm_proxy import _normalize_role as normalize_role

    return normalize_role(role)


def _segment_style_name(seg: dict) -> str:
    return str(seg.get("style") or seg.get("style_ref") or "").strip()


def _style_name_from_ref(ref: str) -> str:
    normalized = str(ref or "").strip().replace("\\", "/")
    leaf = normalized.rsplit("/", 1)[-1]
    for ext in VOICE_LIB_EXTS:
        if leaf.lower().endswith(ext):
            return leaf[:-len(ext)]
    return leaf


def _style_voice_ref(style: str) -> str:
    key = str(style or "").strip()
    return STYLE_VOICE_MAP.get(key) or STYLE_VOICE_MAP.get(key.lower()) or key


def _resolve_segment_style_audio(seg: dict) -> Optional[str]:
    ref = str(seg.get("emo_ref_audio_path") or "").strip()
    style = _segment_style_name(seg) or _style_name_from_ref(ref)
    if not style or style in ("neutral", "none"):
        return _resolve_voice(ref) if ref else None
    mapped = _style_voice_ref(style)
    if not mapped:
        return _resolve_voice(ref) if ref else None
    resolved = _resolve_voice(mapped)
    if resolved:
        return resolved
    if mapped != style:
        resolved = _resolve_voice(style)
        if resolved:
            return resolved
    return _resolve_voice(ref) if ref else None


def _style_cache_fragment(seg: dict) -> dict:
    if args.qwen_emo:
        return {"style": None, "style_alpha": None, "emo_ref_audio_path": None, "style_audio": None, "style_meta": {}}
    style = _segment_style_name(seg)
    explicit = str(seg.get("emo_ref_audio_path") or "").strip()
    style_audio = _resolve_segment_style_audio(seg)
    return {
        "style": style or None,
        "style_alpha": seg.get("style_alpha"),
        "emo_ref_audio_path": explicit or None,
        "style_audio": style_audio,
        "style_meta": _audio_file_meta(style_audio) if style_audio else {},
    }


def _segment_cache_payload(seg: dict) -> dict:
    item = {
        "role": _normalize_role(seg.get("role") or ""),
        "text": str(seg.get("text") or "").strip(),
    }
    if args.qwen_emo:
        item["emo_text"] = seg.get("emo_text") or None
    else:
        item.update(_style_cache_fragment(seg))
        item["emo_vec"] = seg.get("emo_vec") or None
        item["emo_text"] = seg.get("emo_text") or None
        item["emo_alpha"] = seg.get("emo_alpha")
    return item


def _dialogue_cache_payload(req: dict, segments: list, role_voice_paths: dict, default_path: str, parse_info: Optional[dict] = None) -> dict:
    role_payload = {
        role: {"path": path, "meta": _audio_file_meta(path)}
        for role, path in sorted((role_voice_paths or {}).items())
    }
    payload = {
        "kind": "fast6g_dialogue_cache_v1",
        "segments": [_segment_cache_payload(s) for s in segments],
        "voices": role_payload,
        "default_voice": {"path": default_path, "meta": _audio_file_meta(default_path)} if default_path else None,
        "interval_ms": int(req.get("interval_ms", 350)),
        "top_p": float(req.get("top_p", 0.8)),
        "top_k": int(req.get("top_k", 30)),
        "temperature": float(req.get("temperature", 0.8)),
        "repetition_penalty": float(req.get("repetition_penalty", 10)),
        "qwen_emo": bool(args.qwen_emo),
        "generation": _generation_cache_payload(req),
    }
    if parse_info:
        payload["backend_parse"] = parse_info
    cache_nonce = str(req.get("cache_nonce") or "").strip()
    if cache_nonce:
        payload["cache_nonce"] = cache_nonce
    return payload


def _normalize_dialogue_voices(voices: dict) -> Dict[str, str]:
    normalized: Dict[str, str] = {}
    for key, value in (voices or {}).items():
        role = "default" if key == "default" else _normalize_role(key)
        voice = str(value or "").strip()
        if voice or role not in normalized:
            normalized[role] = voice
    return normalized


def _configured_voice_payload(voices: dict) -> dict:
    payload = {}
    for role, voice in sorted((voices or {}).items()):
        resolved = _resolve_voice(voice)
        payload[role] = {
            "voice": voice,
            "path": resolved or "",
            "meta": _audio_file_meta(resolved) if resolved else {},
        }
    return payload


def _resolve_dialogue_voices(segments: list, voices: dict) -> tuple[str, dict, list]:
    voices = _normalize_dialogue_voices(voices)
    default_path = _resolve_voice(voices.get("default", ""))
    role_voice_paths = {}
    unresolved = []
    for seg in segments:
        role = _normalize_role(seg.get("role") or "旁白")
        if role in role_voice_paths:
            continue
        voice = voices.get(role, "")
        path = _resolve_voice(voice) or default_path
        if path:
            role_voice_paths[role] = path
        else:
            unresolved.append(role)
    return default_path, role_voice_paths, unresolved


def _normal_segments_from_request(req: dict) -> list[dict]:
    segments = req.get("segments") or []
    out = []
    for seg in segments:
        data = seg.dict() if hasattr(seg, "dict") else dict(seg or {})
        text = str(data.get("text") or "").strip()
        if not text:
            continue
        item = dict(data)
        item["role"] = _normalize_role(item.get("role") or "旁白")
        item["text"] = text
        if args.qwen_emo:
            for key in ("style", "style_ref", "style_alpha", "emo_ref_audio_path", "emo_vec", "emo_alpha"):
                item.pop(key, None)
        out.append(item)
    if out:
        return out
    return _parse_dialogue_text_normal(str(req.get("text") or ""))


def _dialogue_request_cache_payload(req: dict, segments: list, role_voice_paths: dict, default_path: str, parse_info: Optional[dict] = None) -> dict:
    return _dialogue_cache_payload(req, segments, role_voice_paths, default_path, parse_info=parse_info)


def _llm_max_tokens_for_text(text: str) -> int:
    return min(12000, max(4000, int(len(str(text or "")) * 5 + 0.999)))


def _style_catalog_for_prompt() -> str:
    names = sorted(k for k in STYLE_VOICE_MAP.keys() if k not in ("none", "neutral"))
    labels = ["neutral=普通/平静(建议0.15)"]
    labels.extend(f"{name}=声腔参考(建议0.34-0.70)" for name in names)
    return " / ".join(labels)


def _known_roles_for_parse(req: dict, voices: dict) -> List[str]:
    roles: List[str] = []

    def add(role):
        role = str(role or "").strip()
        if role and role not in roles:
            roles.append(role)

    add("旁白")
    add("用户")
    for role in (req.get("roles_hint") or []):
        role = str(role or "").strip()
        if role and role not in ("角色", "character", "当前角色", "我"):
            add(role)
    for role in (voices or {}).keys():
        if role != "default" and role not in ("角色", "character", "当前角色", "我"):
            add(role)
    character_name = str(req.get("character_name") or "").strip()
    if character_name:
        add(character_name)
    return roles


def _build_backend_parse_prompt(req: dict, voices: dict) -> str:
    custom_prompt = str(req.get("parse_system_prompt") or "").strip()
    if custom_prompt:
        return custom_prompt

    text_user = str(req.get("user_name") or "").strip()
    character_name = str(req.get("character_name") or "").strip()
    known_roles = _known_roles_for_parse(req, voices)
    roles_hint = "已知角色名单(LLM 输出 role 字段必须从这里选，或者用剧情里出现的新人物名):\n  " + " / ".join(known_roles)
    user_alias_hint = "用户身份名: " + (text_user or "未读取到") + "。只有原文中的「你」以及这个用户身份名明确指向玩家/读者时，role 才写 \"用户\"。"
    character_hint = "当前角色名: " + (character_name or "未读取到") + "。原文第一人称「我」通常指当前角色或正在自述的人物，不要因为出现「我」就改成用户。"
    example_user = text_user or "你"
    if args.qwen_emo:
        return "\n".join([
            "你是中文小说→TTS 片段拆分器。只返回严格 JSON，不要任何解释，不要 ``` 代码块。",
            "",
            roles_hint,
            user_alias_hint,
            character_hint,
            "输出格式:",
            "{\"segments\":[{\"role\":\"...\",\"text\":\"...\",\"emo_text\":\"...\"}]}",
            "",
            "拆段规则:",
            "1. 旁白（叙述、环境、动作描写、心理描写、所有无引号正文）→ role 固定为 \"旁白\"。",
            "2. 人物直接说出口的话 → role 用说话人的名字；如果说话人是「你」或用户身份名，role 统一写 \"用户\"。",
            "3. 「他说：」「她笑道：」「白夜雨说道：」这类引导句本身永远是旁白；只有后面引号里的直接台词才按说话人分配。",
            "4. text 是要朗读的原文片段，保留标点和语气词。",
            "",
            "重要: 当前后端已启用 Qwen emotion。不要输出 style/style_alpha/emo_vec/emo_alpha，也不要输出声腔参考；但必须给每段输出 emo_text，写成简短自然语言情绪提示，例如「低声、克制、带一点哽咽」「轻松笑意、语速自然」。后端会把 emo_text 交给 IndexTTS2 的 QwenEmotion 生成情绪向量。",
            "",
            "完整性硬规则: 必须覆盖输入原文 100%，按原文顺序输出，不要总结、改写、删字、漏掉最后一段。",
            "",
            "示例输入:",
            f"她低着头，眼角有泪。「对不起，我真的撑不住了。」\n{example_user}叹了口气，把手放在她肩上：「别哭。」",
            "示例输出:",
            "{\"segments\":[{\"role\":\"旁白\",\"text\":\"她低着头，眼角有泪。\",\"emo_text\":\"低声叙述，情绪压抑，带一点心疼\"},{\"role\":\"她\",\"text\":\"对不起，我真的撑不住了。\",\"emo_text\":\"哽咽、低落、快哭出来，但声音不要尖\"},{\"role\":\"旁白\",\"text\":\"" + example_user + "叹了口气，把手放在她肩上：\",\"emo_text\":\"平静叙述，动作温柔\"},{\"role\":\"用户\",\"text\":\"别哭。\",\"emo_text\":\"压低声音、温柔安慰、语速慢\"}]}",
        ])

    return "\n".join([
        "你是中文小说→TTS 片段拆分器。只返回严格 JSON，不要任何解释，不要 ``` 代码块。",
        "",
        roles_hint,
        user_alias_hint,
        character_hint,
        "输出格式:",
        "{\"segments\":[{\"role\":\"...\",\"text\":\"...\",\"style\":\"neutral\",\"style_alpha\":0.2,\"emo_vec\":[h,a,s,f,d,l,u,n]}]}",
        "",
        "拆段规则:",
        "1. 旁白（叙述、环境、动作描写、心理描写、所有无引号正文）→ role 固定为 \"旁白\"。",
        "   旁白 style 永远写 neutral，style_alpha 写 0.15，emo_vec 写 [0,0,0,0,0,0,0,1]。",
        "2. 人物直接说出口的话 → role 用说话人的名字；如果说话人是「你」或用户身份名，role 统一写 \"用户\"。",
        "3. 「他说：」「她笑道：」「白夜雨说道：」这类引导句本身永远是旁白；只有后面引号里的直接台词才按说话人分配。",
        "4. text 是要朗读的原文片段，保留标点和语气词。",
        "5. style 是段级声腔/呼吸参考，只能从这个枚举里选: " + _style_catalog_for_prompt(),
        "",
        "emo_vec 是 8 维向量，顺序必须是 [happy,angry,sad,fear,hate,low,surprise,neutral]。",
        "每段可加 emo_alpha 字段：旁白 0.12-0.22，平静对白 0.20-0.30，正常带情绪对白 0.32-0.44，强烈台词 0.46-0.52。",
        "完整性硬规则: 必须覆盖输入原文 100%，按原文顺序输出，不要总结、改写、删字、漏掉最后一段。",
    ])


def _parse_cache_payload(req: dict, voices: dict) -> dict:
    return {
        "kind": "fast6g_dialogue_llm_parse_v1",
        "prompt_version": BACKEND_LLM_PARSE_PROMPT_VERSION,
        "qwen_emo": bool(args.qwen_emo),
        "text": str(req.get("text") or ""),
        "llm_endpoint": str(req.get("llm_endpoint") or ""),
        "llm_model": str(req.get("llm_model") or ""),
        "llm_api_key_sha1": _secret_hash(req.get("llm_api_key") or ""),
        "parse_temperature": float(req.get("parse_temperature", 0.2)),
        "parse_timeout": int(req.get("parse_timeout", 90)),
        "parse_max_tokens": int(req.get("parse_max_tokens")) if req.get("parse_max_tokens") is not None else None,
        "parse_system_prompt": str(req.get("parse_system_prompt") or ""),
        "user_name": str(req.get("user_name") or ""),
        "character_name": str(req.get("character_name") or ""),
        "roles_hint": _known_roles_for_parse(req, voices),
    }


def _get_parse_cache(key: str):
    if not key or key not in LLM_PARSE_CACHE:
        return None
    item = LLM_PARSE_CACHE.get(key) or {}
    item["last_hit"] = time.time()
    try:
        return json.loads(json.dumps(item.get("segments") or [], ensure_ascii=False))
    except Exception:
        return item.get("segments") or []


def _put_parse_cache(key: str, segments: list) -> None:
    if not key or not segments:
        return
    LLM_PARSE_CACHE[key] = {"segments": segments, "created_at": time.time(), "last_hit": time.time()}
    if len(LLM_PARSE_CACHE) > LLM_PARSE_CACHE_MAX:
        oldest = sorted(LLM_PARSE_CACHE.items(), key=lambda kv: kv[1].get("last_hit") or kv[1].get("created_at") or 0)
        for old_key, _ in oldest[: max(1, len(LLM_PARSE_CACHE) - LLM_PARSE_CACHE_MAX)]:
            LLM_PARSE_CACHE.pop(old_key, None)


def _stabilize_dialogue_emo_vec(role: str, emo_vec):
    if role == "旁白":
        return [0.0] * 7 + [0.85]
    if not isinstance(emo_vec, list) or len(emo_vec) != 8:
        return None
    vals = []
    for value in emo_vec[:8]:
        try:
            vals.append(max(0.0, min(1.0, float(value))))
        except (TypeError, ValueError):
            vals.append(0.0)
    for idx in (0, 1, 6):
        vals[idx] *= 0.8
    active_sum = sum(vals[:7])
    if active_sum > 1.05:
        scale = 1.05 / active_sum
        for idx in range(7):
            vals[idx] *= scale
    vals[7] = max(vals[7], 0.25)
    return vals


def _normalize_backend_parsed_segments(parsed: dict, req: dict) -> List[dict]:
    from indextts import llm_proxy

    normalized = llm_proxy.normalize_segments(parsed).get("segments") or []
    user_name = str(req.get("user_name") or "").strip()
    character_name = str(req.get("character_name") or "").strip()
    out: List[dict] = []
    for seg in normalized:
        text = str(seg.get("text") or "").strip()
        if not text:
            continue
        role = _normalize_role(seg.get("role") or "旁白")
        if role == user_name and user_name:
            role = "用户"
        elif role in ("角色", "当前角色") or role.lower() == "character":
            role = character_name or role
        if args.qwen_emo:
            emo_text = str(seg.get("emo_text") or "").strip() or text
            out.append({"role": role or "旁白", "text": text, "emo_text": emo_text})
            continue
        style = str(seg.get("style") or seg.get("style_ref") or "neutral").strip() or "neutral"
        if style not in STYLE_VOICE_MAP:
            style = "neutral"
        style_alpha = _clamp_float(seg.get("style_alpha"), 0.15 if style == "neutral" else 0.42, 0.12, 0.70)
        if style == "neutral":
            style_alpha = max(0.12, min(0.20, style_alpha))
        else:
            style_alpha = max(0.30, min(0.70, style_alpha))
        if role == "旁白":
            style = "neutral"
            style_alpha = 0.15
        emo_alpha_default = 0.18 if role == "旁白" else (0.28 if style == "neutral" else float(req.get("emo_alpha") or 0.38))
        emo_alpha = _clamp_float(seg.get("emo_alpha"), emo_alpha_default, 0.12 if role == "旁白" else 0.18, 0.22 if role == "旁白" else 0.52)
        emo_vec = _stabilize_dialogue_emo_vec(role, seg.get("emo_vec")) or ([0, 0, 0, 0, 0, 0, 0, 0.8] if role == "旁白" else [0, 0, 0, 0, 0, 0, 0, 0.35])
        out.append({"role": role or "旁白", "text": text, "style": style, "style_alpha": style_alpha, "emo_vec": emo_vec, "emo_alpha": emo_alpha})
    if not out:
        raise RuntimeError("LLM 没有返回可用片段")
    return out


async def _parse_dialogue_text_in_backend(prepared: dict, job: "_LiveJob") -> List[dict]:
    req = prepared["req"]
    parse_cfg = prepared["parse"]
    cache_key = parse_cfg.get("cache_key") or ""
    if parse_cfg.get("reuse") and cache_key:
        cached = _get_parse_cache(cache_key)
        if cached:
            job.metrics["llm_parse_cached"] = True
            job.metrics["llm_segments"] = len(cached)
            job.metrics["phase"] = "llm_parse_cache"
            job.metrics["message"] = "已复用上次 LLM 拆段"
            return cached

    from indextts import llm_proxy

    endpoint = str(req.get("llm_endpoint") or "").strip()
    model = str(req.get("llm_model") or "").strip()
    if not endpoint or not model:
        raise RuntimeError("AI模式缺少 LLM endpoint 或 model")
    started = time.perf_counter()
    max_tokens = req.get("parse_max_tokens")
    if max_tokens is None:
        max_tokens = _llm_max_tokens_for_text(req.get("text") or "")
    job.metrics["state"] = "parsing"
    job.metrics["phase"] = "llm_parse"
    job.metrics["message"] = "复用未命中，正在调用 LLM 拆分文本" if parse_cfg.get("reuse") else "后端正在调用 LLM 拆分文本"
    result = await asyncio.to_thread(
        llm_proxy.parse_text_openai_compatible,
        text=req.get("text") or "",
        endpoint=endpoint,
        model=model,
        api_key=req.get("llm_api_key") or "",
        system_prompt=_build_backend_parse_prompt(req, prepared.get("voices") or {}),
        temperature=float(req.get("parse_temperature", 0.2)),
        timeout=int(req.get("parse_timeout", 90)),
        max_tokens=max_tokens,
    )
    segments = _normalize_backend_parsed_segments(result, req)
    job.metrics["llm_parse_s"] = round(time.perf_counter() - started, 3)
    job.metrics["llm_parse_cached"] = False
    job.metrics["llm_segments"] = len(segments)
    if parse_cfg.get("reuse") and cache_key:
        _put_parse_cache(cache_key, segments)
    return segments


def _pack_wav_bytes(data: np.ndarray, rate: int) -> bytes:
    return pack_wav(BytesIO(), data, rate).getvalue()


def _wav_streaming_header(sample_rate: int, channels: int = 1, bits: int = 16) -> bytes:
    byte_rate = sample_rate * channels * bits // 8
    block_align = channels * bits // 8
    unknown = 0xFFFFFFFF
    return (
        b"RIFF"
        + unknown.to_bytes(4, "little")
        + b"WAVE"
        + b"fmt "
        + (16).to_bytes(4, "little")
        + (1).to_bytes(2, "little")
        + channels.to_bytes(2, "little")
        + sample_rate.to_bytes(4, "little")
        + byte_rate.to_bytes(4, "little")
        + block_align.to_bytes(2, "little")
        + bits.to_bytes(2, "little")
        + b"data"
        + unknown.to_bytes(4, "little")
    )


def _make_complete_wav_bytes(pcm: bytes, sample_rate: int, channels: int = 1, bits: int = 16) -> bytes:
    byte_rate = sample_rate * channels * bits // 8
    block_align = channels * bits // 8
    data_size = len(pcm)
    riff_size = 36 + data_size
    return (
        b"RIFF"
        + riff_size.to_bytes(4, "little")
        + b"WAVE"
        + b"fmt "
        + (16).to_bytes(4, "little")
        + (1).to_bytes(2, "little")
        + channels.to_bytes(2, "little")
        + sample_rate.to_bytes(4, "little")
        + byte_rate.to_bytes(4, "little")
        + block_align.to_bytes(2, "little")
        + bits.to_bytes(2, "little")
        + b"data"
        + data_size.to_bytes(4, "little")
        + pcm
    )


def _wav_bytes_to_pcm_bytes(wav_bytes: bytes) -> tuple[int, bytes]:
    with sf.SoundFile(BytesIO(wav_bytes)) as fp:
        data = fp.read(dtype="int16", always_2d=False)
        rate = int(fp.samplerate)
    if isinstance(data, np.ndarray) and data.ndim > 1:
        data = data[:, 0]
    return rate, np.asarray(data, dtype=np.int16).tobytes()


def _array_to_pcm_bytes(data: np.ndarray) -> bytes:
    arr = np.asarray(data)
    if arr.ndim > 1:
        arr = arr[:, 0]
    if arr.dtype != np.int16:
        arr = np.clip(arr, -32768, 32767).astype(np.int16)
    return arr.tobytes()


def _silence_pcm_bytes(sample_rate: int, ms: int, channels: int = 1) -> bytes:
    frames = max(0, int(int(sample_rate or 22050) * max(0, int(ms or 0)) / 1000.0))
    return b"\x00\x00" * frames * max(1, int(channels))


class _LiveJob:
    def __init__(self, cache_key: str):
        self.cache_key = cache_key
        self.sample_rate = 22050
        self.pcm = bytearray()
        self.finished = asyncio.Event()
        self.error: Optional[str] = None
        self.cancelled = False
        self.created_at = time.time()
        self._perf_created = time.perf_counter()
        self.segments_meta: List[dict] = []
        self.metrics: Dict[str, object] = {
            "created_at": self.created_at,
            "state": "pending",
            "phase": "created",
            "message": "任务已创建",
            "segments_total": 0,
            "segments_done": 0,
            "first_pcm_s": None,
            "total_wall_s": None,
            "audio_duration_s": 0.0,
            "rtf": None,
            "segments": [],
        }


def _mark_job_cancelled(job: "_LiveJob", message: str = "任务已取消") -> None:
    job.cancelled = True
    job.error = None
    job.metrics["state"] = "cancelled"
    job.metrics["phase"] = "cancelled"
    job.metrics["message"] = message


def _gc_live_job(cache_key: str, delay: float = LIVE_JOB_LINGER_SECONDS, expected_job: Optional["_LiveJob"] = None) -> None:
    async def _go():
        await asyncio.sleep(delay)
        if expected_job is not None and LIVE_JOBS.get(cache_key) is not expected_job:
            return
        LIVE_JOBS.pop(cache_key, None)
    try:
        asyncio.create_task(_go())
    except Exception:
        pass


async def _stream_from_live_job(job: "_LiveJob", start_offset_s: float = 0.0):
    try:
        start_offset_s = max(0.0, float(start_offset_s or 0.0))
    except Exception:
        start_offset_s = 0.0
    sample_rate = int(job.sample_rate or 22050)
    block_align = 2
    offset = int(start_offset_s * sample_rate * block_align)
    offset = max(0, offset - (offset % block_align))
    yield _wav_streaming_header(sample_rate)
    while True:
        if offset < len(job.pcm):
            chunk = bytes(job.pcm[offset:])
            yield chunk
            offset = len(job.pcm)
        if job.finished.is_set() and offset >= len(job.pcm):
            return
        await asyncio.sleep(0.08)


def _job_status_from_cache(cache_key: str) -> Optional[dict]:
    path = _get_cached_audio(cache_key)
    if not path:
        return None
    meta = _read_cache_metadata(cache_key)
    return {
        "state": "done",
        "cache_key": cache_key,
        "cache_url": f"/cache_audio/{cache_key}",
        "segments_done": len(meta.get("segments_meta") or []),
        "segments_meta": meta.get("segments_meta") or [],
        "segments_plan": meta.get("segments_plan") or (meta.get("metrics") or {}).get("segments_plan") or [],
        "sample_rate": meta.get("sample_rate") or 22050,
        "duration_s": meta.get("duration_s"),
        "metrics": meta.get("metrics") or {},
        "error": None,
    }


tts_pipeline = IndexTTS2(
    model_dir=args.model_dir,
    cfg_path=os.path.join(args.model_dir, "config.yaml"),
    use_fp16=args.fp16,
    use_qwen_emo=args.qwen_emo,
)

APP = FastAPI()
APP.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
    expose_headers=["X-IndexTTS-Cache", "X-IndexTTS-Cache-Key"],
)

tts_lock = asyncio.Lock()
LIVE_JOBS: Dict[str, _LiveJob] = {}


class TTS_Request(BaseModel):
    text: str = None
    emo_text: str = None
    ref_audio_path: str = None
    emo_ref_audio_path: str = None
    performance_mode: str = "balanced"
    diffusion_steps: Optional[int] = None
    prompt_audio_seconds: Optional[float] = None
    segment_tokens: Optional[int] = None
    s2mel_cfg_rate: Optional[float] = None
    top_k: int = 30
    top_p: float = 0.8
    temperature: float = 0.8
    emo_alpha: float = 1.0
    speed_factor: float = 1.0
    seed: int = -1
    parallel_infer: bool = True
    repetition_penalty: float = 10


class TTS_Segment(BaseModel):
    role: str
    text: str
    style: Optional[str] = None
    style_ref: Optional[str] = None
    style_alpha: Optional[float] = None
    emo_ref_audio_path: Optional[str] = None
    emo_vec: Optional[List[float]] = None
    emo_text: Optional[str] = None
    emo_alpha: Optional[float] = None


class TTS_Dialogue_Request(BaseModel):
    segments: Optional[List[TTS_Segment]] = None
    text: Optional[str] = None
    parse_mode: str = "ai"
    voices: Dict[str, str]
    llm_endpoint: Optional[str] = None
    llm_model: Optional[str] = None
    llm_api_key: Optional[str] = None
    parse_temperature: float = 0.2
    parse_timeout: int = 90
    parse_max_tokens: Optional[int] = None
    parse_system_prompt: Optional[str] = None
    reuse_llm_parse: bool = True
    user_name: Optional[str] = None
    character_name: Optional[str] = None
    roles_hint: Optional[List[str]] = None
    performance_mode: str = "balanced"
    diffusion_steps: Optional[int] = None
    prompt_audio_seconds: Optional[float] = None
    segment_tokens: Optional[int] = None
    s2mel_cfg_rate: Optional[float] = None
    interval_ms: int = 350
    top_p: float = 0.8
    top_k: int = 30
    temperature: float = 0.8
    repetition_penalty: float = 10
    emo_alpha: float = 1.0
    bypass_cache: bool = False
    cache_nonce: Optional[str] = None


def pack_wav(io_buffer: BytesIO, data: np.ndarray, rate: int):
    io_buffer = BytesIO()
    sf.write(io_buffer, data, rate, format="wav")
    return io_buffer


@APP.get("/static/tavo.js")
async def tavo_js_endpoint():
    path = _static_file_path("tavo.js")
    if not path:
        return JSONResponse(status_code=404, content={"message": "static/tavo.js not found", "static_dir": STATIC_DIR})
    return FileResponse(
        path,
        media_type="text/javascript; charset=utf-8",
        headers={
            "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0",
            "Pragma": "no-cache",
            "Expires": "0",
        },
    )


@APP.get("/tavo_test")
async def tavo_widget_test_endpoint():
    path = _static_file_path("tavo_widget_test.html")
    if not path:
        return JSONResponse(status_code=404, content={"message": "static/tavo_widget_test.html not found", "static_dir": STATIC_DIR})
    return FileResponse(
        path,
        media_type="text/html; charset=utf-8",
        headers={"Cache-Control": "no-store, no-cache, must-revalidate, max-age=0"},
    )


@APP.head("/tavo_test")
async def tavo_widget_test_head():
    path = _static_file_path("tavo_widget_test.html")
    headers = {
        "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0",
        "Content-Length": str(os.path.getsize(path)) if path and os.path.exists(path) else "0",
    }
    return Response(status_code=200 if path and os.path.exists(path) else 404, media_type="text/html", headers=headers)


if STATIC_DIR:
    APP.mount("/static", StaticFiles(directory=STATIC_DIR), name="static")


def handle_control(command: str):
    if command == "restart":
        os.execl(sys.executable, sys.executable, *argv)
    elif command == "exit":
        os.kill(os.getpid(), signal.SIGTERM)
        exit(0)


def check_params(req: dict):
    text: str = req.get("text", "")
    ref_audio_path: str = req.get("ref_audio_path", "")
    resolved = _resolve_voice(ref_audio_path)
    if ref_audio_path in [None, ""]:
        return JSONResponse(status_code=400, content={"message": "ref_audio_path is required"})
    if not resolved:
        return JSONResponse(status_code=400, content={"message": "ref_audio_path not found", "ref_audio_path": ref_audio_path})
    req["ref_audio_path"] = resolved
    if text in [None, ""]:
        return JSONResponse(status_code=400, content={"message": "text is required"})
    return None


async def tts_handle(req: dict):
    check_res = check_params(req)
    if check_res is not None:
        return check_res
    try:
        sampling_kwargs = _dialogue_infer_kwargs(req)
        sampling_rate, wav_data = tts_pipeline.infer(
            spk_audio_prompt=req["ref_audio_path"],
            emo_audio_prompt=req["emo_ref_audio_path"] if req["emo_ref_audio_path"] else None,
            text=req["text"],
            emo_text=None,
            use_emo_text=False,
            emo_alpha=req["emo_alpha"],
            top_p=req["top_p"],
            top_k=req["top_k"],
            temperature=req["temperature"],
            repetition_penalty=req["repetition_penalty"],
            max_text_tokens_per_segment=sampling_kwargs["max_text_tokens_per_segment"],
            diffusion_steps=sampling_kwargs["diffusion_steps"],
            max_prompt_audio_seconds=sampling_kwargs["max_prompt_audio_seconds"],
            max_emo_audio_seconds=sampling_kwargs["max_emo_audio_seconds"],
            s2mel_cfg_rate=sampling_kwargs["s2mel_cfg_rate"],
            output_path=None,
        )
        return Response(pack_wav(BytesIO(),wav_data,sampling_rate).getvalue(), media_type=f"audio/wav")
    except Exception as e:
        print("Error:",e)
        traceback.print_exc()
        return JSONResponse(status_code=400, content={"message": "tts failed", "Exception": str(e)})


@APP.get("/control")
async def control(command: str = None):
    if command is None:
        return JSONResponse(status_code=400, content={"message": "command is required"})
    handle_control(command)


@APP.get("/health")
async def health():
    return JSONResponse(content={
        "status": "ok",
        "version": "fast6g",
        "engine": "fast6g",
        "local_url": f"http://127.0.0.1:{port}",
        "qwen_emo": bool(args.qwen_emo),
        "capabilities": {
            "tts": True,
            "dialogue_jobs": True,
            "normal_parse": True,
            "llm_parse": True,
            "qwen_emo": bool(args.qwen_emo),
            "qwen_emo_auto": bool(args.qwen_emo),
        },
    })


@APP.get("/server_log/tail")
async def server_log_tail(n: int = 100, since: float = 0.0, filter: Optional[str] = None):
    try:
        n = max(1, min(500, int(n or 100)))
    except Exception:
        n = 100
    lines = []
    needle = str(filter or "")
    for item in list(LOG_BUFFER):
        if since and float(item.get("ts") or 0) <= float(since):
            continue
        if needle and needle not in str(item.get("line") or ""):
            continue
        lines.append(item)
    return JSONResponse(content={"lines": lines[-n:], "now": time.time()})


@APP.get("/voices")
async def voices_list_endpoint():
    try:
        return JSONResponse(content={"voices": _list_voices()})
    except Exception as e:
        traceback.print_exc()
        return JSONResponse(status_code=400, content={"message": "voices list failed", "Exception": str(e)})


@APP.get("/voice_preview")
async def voice_preview_endpoint(name: str):
    path = _resolve_voice(name)
    if not path or not os.path.exists(path):
        return JSONResponse(status_code=404, content={"message": "voice not found", "name": name})
    media_type = "audio/mpeg" if os.path.splitext(path)[1].lower() == ".mp3" else "audio/wav"
    return FileResponse(path, media_type=media_type, headers={"Cache-Control": "no-store"})


@APP.get("/cache_audio/{key}")
async def cache_audio_by_key(key: str):
    try:
        path = _get_cached_audio(key)
        if not path:
            return JSONResponse(status_code=404, content={"message": "cache miss", "key": key})
        return FileResponse(
            path,
            media_type="audio/wav",
            headers={"X-IndexTTS-Cache": "HIT", "X-IndexTTS-Cache-Key": key},
        )
    except Exception as e:
        return JSONResponse(status_code=400, content={"message": "cache audio failed", "Exception": str(e)})


@APP.head("/cache_audio/{key}")
async def cache_audio_by_key_head(key: str):
    try:
        path = _get_cached_audio(key)
        if not path:
            return Response(status_code=404, headers={"X-IndexTTS-Cache": "MISS", "X-IndexTTS-Cache-Key": key})
        return Response(
            status_code=200,
            media_type="audio/wav",
            headers={
                "X-IndexTTS-Cache": "HIT",
                "X-IndexTTS-Cache-Key": key,
                "Content-Length": str(os.path.getsize(path)),
            },
        )
    except Exception as e:
        return Response(status_code=400, headers={"X-IndexTTS-Error": str(e)})


async def _run_dialogue_job(job: "_LiveJob", prepared: dict):
    req = prepared["req"]
    segments = prepared.get("segments") or []
    role_voice_paths = prepared.get("role_voice_paths") or {}
    default_path = prepared.get("default_path")
    qwen_mode = bool(args.qwen_emo)
    sampling_kwargs = _dialogue_infer_kwargs(req)
    job.metrics["parse_mode"] = prepared["parse_mode"]
    job.metrics["emotion_mode"] = "qwen_emo" if qwen_mode else "off"
    job.metrics["performance_mode"] = sampling_kwargs["performance_mode"]
    job.metrics["diffusion_steps"] = sampling_kwargs["diffusion_steps"]
    job.metrics["prompt_audio_seconds"] = sampling_kwargs["max_prompt_audio_seconds"]
    job.metrics["segment_tokens"] = sampling_kwargs["max_text_tokens_per_segment"]
    job.metrics["s2mel_cfg_rate"] = sampling_kwargs["s2mel_cfg_rate"]
    try:
        if prepared.get("needs_parse"):
            segments = await _parse_dialogue_text_in_backend(prepared, job)
            default_path, role_voice_paths, unresolved = _resolve_dialogue_voices(segments, prepared.get("voices") or {})
            if unresolved:
                raise RuntimeError("音色映射缺失: AI模式拆出了这些角色，但没有对应音色，也没有 default: " + "、".join(unresolved))
            prepared["segments"] = segments
            prepared["default_path"] = default_path
            prepared["role_voice_paths"] = role_voice_paths

        job.metrics["state"] = "queued"
        job.metrics["phase"] = "tts_queue"
        job.metrics["message"] = "等待 TTS 合成"
        async with tts_lock:
            if job.cancelled:
                _mark_job_cancelled(job)
                return
            job.metrics["state"] = "running"
            job.metrics["phase"] = "tts"
            job.metrics["message"] = "正在合成音频"
            segments_plan = []
            for plan_idx, plan_seg in enumerate(segments):
                plan_role = _normalize_role(plan_seg.get("role") or "旁白")
                plan_text = str(plan_seg.get("text") or "").strip()
                if not plan_text:
                    continue
                segments_plan.append({
                    "idx": plan_idx,
                    "role": plan_role,
                    "text": plan_text,
                    "style": _segment_style_name(plan_seg) or "neutral",
                    "style_alpha": plan_seg.get("style_alpha"),
                })
            job.metrics["segments_total"] = len(segments_plan)
            job.metrics["segments_plan"] = segments_plan
            for idx, seg in enumerate(segments):
                if job.cancelled:
                    _mark_job_cancelled(job)
                    return
                role = _normalize_role(seg.get("role") or "旁白")
                text = str(seg.get("text") or "").strip()
                if not text:
                    continue
                voice_path = role_voice_paths.get(role) or default_path
                if not voice_path:
                    raise RuntimeError(f"role voice unresolved: {role}")
                style_audio = _resolve_segment_style_audio(seg)
                emo_vec = _stabilize_dialogue_emo_vec(role, seg.get("emo_vec"))
                emo_text_seg = str(seg.get("emo_text") or "").strip() or None
                seg_alpha = seg.get("emo_alpha")
                seg_alpha = float(seg_alpha) if seg_alpha is not None else float(req.get("emo_alpha", 1.0))
                style_alpha = seg.get("style_alpha")
                if style_audio and style_alpha is not None:
                    seg_alpha = float(style_alpha)
                if qwen_mode:
                    style_audio = None
                    emo_vec = None
                    emo_text_seg = str(seg.get("emo_text") or "").strip() or text
                    seg_alpha = 1.0
                elif style_audio:
                    emo_vec = None
                    emo_text_seg = None
                elif emo_vec:
                    emo_text_seg = None
                if idx > 0 and int(req.get("interval_ms") or 0) > 0:
                    job.pcm.extend(_silence_pcm_bytes(job.sample_rate, int(req.get("interval_ms") or 0)))
                seg_start = len(job.pcm)
                seg_started = time.perf_counter()

                def _infer_one():
                    return tts_pipeline.infer(
                        spk_audio_prompt=voice_path,
                        emo_audio_prompt=style_audio,
                        text=text,
                        emo_text=emo_text_seg,
                        use_emo_text=bool(qwen_mode),
                        emo_alpha=seg_alpha,
                        emo_vector=emo_vec,
                        top_p=float(req.get("top_p", 0.8)),
                        top_k=int(req.get("top_k", 30)),
                        temperature=float(req.get("temperature", 0.8)),
                        repetition_penalty=float(req.get("repetition_penalty", 10)),
                        max_text_tokens_per_segment=sampling_kwargs["max_text_tokens_per_segment"],
                        diffusion_steps=sampling_kwargs["diffusion_steps"],
                        max_prompt_audio_seconds=sampling_kwargs["max_prompt_audio_seconds"],
                        max_emo_audio_seconds=sampling_kwargs["max_emo_audio_seconds"],
                        s2mel_cfg_rate=sampling_kwargs["s2mel_cfg_rate"],
                        output_path=None,
                    )

                sampling_rate, wav_data = await asyncio.to_thread(_infer_one)
                infer_stats = dict(getattr(tts_pipeline, "last_infer_stats", {}) or {})
                job.sample_rate = int(sampling_rate or job.sample_rate or 22050)
                pcm = _array_to_pcm_bytes(wav_data)
                if pcm and job.metrics.get("first_pcm_s") is None:
                    job.metrics["first_pcm_s"] = round(time.perf_counter() - job._perf_created, 3)
                job.pcm.extend(pcm)
                seg_wall = time.perf_counter() - seg_started
                seg_bytes = len(job.pcm) - seg_start
                seg_duration = seg_bytes / (job.sample_rate * 2) if job.sample_rate else 0.0
                seg_meta = {
                    "idx": idx,
                    "role": role,
                    "text": text,
                    "sample_rate": job.sample_rate,
                    "start_offset_bytes": seg_start,
                    "start_s": (seg_start / (job.sample_rate * 2)) if job.sample_rate else 0.0,
                    "duration_s": seg_duration,
                    "wall_s": round(seg_wall, 3),
                    "style": "neutral" if qwen_mode else (_segment_style_name(seg) or "neutral"),
                    "style_alpha": None if qwen_mode else (float(style_alpha) if style_alpha is not None and style_audio else None),
                    "uses_style_audio": bool(style_audio),
                    "uses_emo_vector": bool(emo_vec),
                    "emotion_mode": "qwen_emo" if qwen_mode else "off",
                    "infer_rtf": infer_stats.get("rtf"),
                    "s2mel_s": infer_stats.get("s2mel_s"),
                    "gpt_gen_s": infer_stats.get("gpt_gen_s"),
                    "bigvgan_s": infer_stats.get("bigvgan_s"),
                    "spk_cache_hit": infer_stats.get("spk_cache_hit"),
                    "emo_cache_hit": infer_stats.get("emo_cache_hit"),
                }
                for total_key, stat_key in (
                    ("infer_total_s", "total_infer_s"),
                    ("gpt_gen_s", "gpt_gen_s"),
                    ("gpt_forward_s", "gpt_forward_s"),
                    ("s2mel_s", "s2mel_s"),
                    ("bigvgan_s", "bigvgan_s"),
                ):
                    value = infer_stats.get(stat_key)
                    if isinstance(value, (int, float)):
                        job.metrics[total_key] = round(float(job.metrics.get(total_key) or 0.0) + float(value), 3)
                job.segments_meta.append(seg_meta)
                job.metrics["segments"].append(seg_meta)
                job.metrics["segments_done"] = len(job.segments_meta)
                job.metrics["audio_duration_s"] = round(len(job.pcm) / (job.sample_rate * 2), 3) if job.sample_rate else 0.0

        if job.cancelled:
            _mark_job_cancelled(job)
            return
        job.metrics["state"] = "saving"
        job.metrics["phase"] = "saving"
        job.metrics["message"] = "音频合成完成，正在保存缓存"
        wav_bytes = _make_complete_wav_bytes(bytes(job.pcm), job.sample_rate)
        audio_duration = len(job.pcm) / (job.sample_rate * 2) if job.sample_rate else 0.0
        total_wall = time.perf_counter() - job._perf_created
        job.metrics["audio_duration_s"] = round(audio_duration, 3)
        job.metrics["total_wall_s"] = round(total_wall, 3)
        job.metrics["rtf"] = round(total_wall / audio_duration, 3) if audio_duration > 0 else None
        job.metrics["state"] = "done"
        job.metrics["phase"] = "done"
        job.metrics["message"] = "音频已保存"
        metadata = {
            "kind": "fast6g_dialogue_stream_v1",
            "segments_meta": job.segments_meta,
            "segments_plan": job.metrics.get("segments_plan") or [],
            "sample_rate": job.sample_rate,
            "duration_s": audio_duration,
            "metrics": job.metrics,
            "version": "fast6g",
        }
        _save_cached_audio(job.cache_key, wav_bytes, metadata)
    except Exception as e:
        if job.cancelled:
            _mark_job_cancelled(job)
            return
        job.error = str(e)
        job.metrics["state"] = "failed"
        job.metrics["phase"] = "failed"
        job.metrics["message"] = "后端生成失败"
        job.metrics["error"] = str(e)
        job.metrics["total_wall_s"] = round(time.perf_counter() - job._perf_created, 3)
        traceback.print_exc()
    finally:
        job.finished.set()
        _gc_live_job(job.cache_key, expected_job=job)


async def _prepare_dialogue_job(req: dict):
    parse_mode = str(req.get("parse_mode") or "ai").strip().lower()
    if parse_mode in ("single", "plain", "basic"):
        parse_mode = "normal"
    elif parse_mode != "normal":
        parse_mode = "ai"
    req["parse_mode"] = parse_mode
    voices = _normalize_dialogue_voices(req.get("voices") or {})
    text = str(req.get("text") or "").strip()
    raw_segments = req.get("segments") or []
    if not voices:
        return None, JSONResponse(status_code=400, content={"message": "voices is required"})
    if not raw_segments and not text:
        return None, JSONResponse(status_code=400, content={"message": "segments or text is required"})

    if raw_segments:
        segments = _normal_segments_from_request(req)
        default_path, role_voice_paths, unresolved = _resolve_dialogue_voices(segments, voices)
        if unresolved:
            return None, JSONResponse(status_code=400, content={"message": "voices unresolved", "roles": unresolved})
        payload = _dialogue_request_cache_payload(req, segments, role_voice_paths, default_path)
        cache_key = _make_cache_key(payload)
        return {
            "req": req,
            "needs_parse": False,
            "parse_mode": parse_mode,
            "segments": segments,
            "voices": voices,
            "default_path": default_path,
            "role_voice_paths": role_voice_paths,
            "cache_key": cache_key,
            "cache_payload": payload,
        }, None

    if parse_mode == "normal":
        segments = _normal_segments_from_request(req)
        default_path, role_voice_paths, unresolved = _resolve_dialogue_voices(segments, voices)
        if unresolved:
            return None, JSONResponse(status_code=400, content={"message": "voices unresolved", "roles": unresolved})
        parse_info = {
            "mode": "normal",
            "version": BACKEND_NORMAL_PARSE_VERSION,
            "clean_text_sha1": hashlib.sha1(_clean_tavo_body_text(text).encode("utf-8")).hexdigest(),
        }
        payload = _dialogue_request_cache_payload(req, segments, role_voice_paths, default_path, parse_info=parse_info)
        payload["kind"] = "fast6g_dialogue_normal_parse_v1"
        cache_key = _make_cache_key(payload)
        return {
            "req": req,
            "needs_parse": False,
            "parse_mode": "normal",
            "segments": segments,
            "voices": voices,
            "default_path": default_path,
            "role_voice_paths": role_voice_paths,
            "cache_key": cache_key,
            "cache_payload": payload,
        }, None

    if not str(req.get("llm_endpoint") or "").strip() or not str(req.get("llm_model") or "").strip():
        return None, JSONResponse(status_code=400, content={"message": "text dialogue job requires llm_endpoint and llm_model"})
    configured_payload = _configured_voice_payload(voices)
    invalid_voices = [role for role, item in configured_payload.items() if item.get("voice") and not item.get("path")]
    if invalid_voices:
        return None, JSONResponse(status_code=400, content={"message": "voices unresolved", "roles": invalid_voices})
    parse_payload = _parse_cache_payload(req, voices)
    parse_cache_key = _make_cache_key(parse_payload)
    cache_payload = {
        "kind": "fast6g_dialogue_backend_parse_v1",
        "text": text,
        "backend_parse": parse_payload,
        "voices": configured_payload,
        "interval_ms": int(req.get("interval_ms", 350)),
        "top_p": float(req.get("top_p", 0.8)),
        "top_k": int(req.get("top_k", 30)),
        "temperature": float(req.get("temperature", 0.8)),
        "repetition_penalty": float(req.get("repetition_penalty", 10)),
        "emo_alpha": float(req.get("emo_alpha", 1.0)),
        "qwen_emo": bool(args.qwen_emo),
        "generation": _generation_cache_payload(req),
    }
    cache_nonce = str(req.get("cache_nonce") or "").strip()
    if cache_nonce:
        cache_payload["cache_nonce"] = cache_nonce
    cache_key = _make_cache_key(cache_payload)
    return {
        "req": req,
        "needs_parse": True,
        "parse_mode": "ai",
        "segments": [],
        "voices": voices,
        "cache_key": cache_key,
        "cache_payload": cache_payload,
        "parse": {
            "cache_key": parse_cache_key,
            "payload": parse_payload,
            "reuse": bool(req.get("reuse_llm_parse", True)),
        },
    }, None


@APP.post("/tts_dialogue_stream_job")
async def tts_dialogue_stream_job_endpoint(request: TTS_Dialogue_Request):
    req = request.dict()
    prepared, err = await _prepare_dialogue_job(req)
    if err is not None:
        return err
    cache_key = prepared["cache_key"]
    cached_path = None if bool(req.get("bypass_cache", False)) else _get_cached_audio(cache_key)
    if cached_path:
        return JSONResponse(content={
            "job_id": cache_key,
            "cache_key": cache_key,
            "url": f"/tts_dialogue_stream_job/{cache_key}",
            "cache_url": f"/cache_audio/{cache_key}",
            "cached": True,
            "live": False,
            "expires_in": LIVE_JOB_LINGER_SECONDS,
        })
    live = LIVE_JOBS.get(cache_key)
    if live and not live.cancelled:
        return JSONResponse(content={
            "job_id": cache_key,
            "cache_key": cache_key,
            "url": f"/tts_dialogue_stream_job/{cache_key}",
            "cache_url": f"/cache_audio/{cache_key}",
            "cached": False,
            "live": True,
            "expires_in": LIVE_JOB_LINGER_SECONDS,
        })
    job = _LiveJob(cache_key)
    LIVE_JOBS[cache_key] = job
    asyncio.create_task(_run_dialogue_job(job, prepared))
    return JSONResponse(content={
        "job_id": cache_key,
        "cache_key": cache_key,
        "url": f"/tts_dialogue_stream_job/{cache_key}",
        "cache_url": f"/cache_audio/{cache_key}",
        "cached": False,
        "live": True,
        "expires_in": LIVE_JOB_LINGER_SECONDS,
    })


@APP.get("/tts_dialogue_stream_job/{job_id}")
async def tts_dialogue_stream_job_audio_endpoint(job_id: str, start_s: float = 0.0):
    cache_key = job_id
    cached_path = _get_cached_audio(cache_key)
    if cached_path:
        return FileResponse(
            cached_path,
            media_type="audio/wav",
            headers={"X-IndexTTS-Cache": "HIT", "X-IndexTTS-Cache-Key": cache_key},
        )
    job = LIVE_JOBS.get(cache_key)
    if job:
        return StreamingResponse(
            _stream_from_live_job(job, start_offset_s=start_s),
            media_type="audio/wav",
            headers={"X-IndexTTS-Cache": "LIVE", "X-IndexTTS-Cache-Key": cache_key},
        )
    return JSONResponse(status_code=404, content={"message": "job missing or expired", "cache_key": cache_key})


@APP.delete("/tts_dialogue_stream_job/{job_id}")
async def tts_dialogue_stream_job_delete_endpoint(job_id: str):
    live = LIVE_JOBS.get(job_id)
    if live:
        _mark_job_cancelled(live)
        live.finished.set()
        _gc_live_job(job_id, delay=30, expected_job=live)
    deleted = False
    try:
        deleted = _delete_cache(job_id)
    except Exception:
        deleted = False
    return JSONResponse(content={"cancelled_live": bool(live), "deleted": deleted, "cache_key": job_id})


@APP.get("/tts_dialogue_job_status/{cache_key}")
async def tts_dialogue_job_status_endpoint(cache_key: str):
    job = LIVE_JOBS.get(cache_key)
    if job:
        if job.cancelled or job.metrics.get("state") == "cancelled":
            state = "cancelled"
        else:
            state = "failed" if job.error else ("done" if job.finished.is_set() else "running")
        return JSONResponse(content={
            "state": state,
            "cache_key": cache_key,
            "cache_url": f"/cache_audio/{cache_key}",
            "pcm_bytes": len(job.pcm),
            "segments_done": len(job.segments_meta),
            "segments_meta": job.segments_meta,
            "segments_plan": job.metrics.get("segments_plan") or [],
            "sample_rate": job.sample_rate,
            "duration_s": job.metrics.get("audio_duration_s") or 0.0,
            "metrics": job.metrics,
            "error": job.error,
        })
    cached = _job_status_from_cache(cache_key)
    if cached:
        return JSONResponse(content=cached)
    return JSONResponse(status_code=404, content={"state": "missing", "cache_key": cache_key})


@APP.get("/tts")
async def tts_get_endpoint(
    text: str = None,
    emo_text: str = None,
    ref_audio_path: str = None,
    emo_ref_audio_path: str = None,
    top_k: int = 30,
    top_p: float = 0.8,
    temperature: float = 0.8,
    emo_alpha: float = 1.0,
    speed_factor: float = 1.0,
    seed: int = -1,
    parallel_infer: bool = True,
    repetition_penalty: float = 10,
):
    req = {
        "text": text,
        "emo_text": emo_text,
        "ref_audio_path": ref_audio_path,
        "emo_ref_audio_path": emo_ref_audio_path,
        "top_k": top_k,
        "top_p": top_p,
        "temperature": temperature,
        "emo_alpha": float(emo_alpha),
        "speed_factor": float(speed_factor),
        "seed": seed,
        "parallel_infer": parallel_infer,
        "repetition_penalty": float(repetition_penalty),
    }
    return await tts_handle(req)


@APP.post("/tts")
async def tts_post_endpoint(request: TTS_Request):
    req = request.dict()
    return await tts_handle(req)


# @APP.get("/set_gpt_weights")
# async def set_gpt_weights(weights_path: str = None):
#     return JSONResponse(status_code=200, content={"message": "index不需要切换模型"})


# @APP.get("/set_sovits_weights")
# async def set_sovits_weights(weights_path: str = None):
#     return JSONResponse(status_code=200, content={"message": "index不需要切换模型"})


if __name__ == "__main__":
    try:
        if host == "None":
            host = None
        uvicorn.run(app=APP, host=host, port=port)
    except Exception as e:
        traceback.print_exc()
        os.kill(os.getpid(), signal.SIGTERM)
        exit(0)
