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
parser.add_argument("--qwen_emo", action="store_true", default=False, help="Enable IndexTTS2 Qwen text-emotion model at startup. Off by default for 6GB mode.")
parser.add_argument("--no_qwen_emo", dest="qwen_emo", action="store_false", help="Disable Qwen emotion model.")
args = parser.parse_args()

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
VOICE_LIB_DIR = os.path.join("prompts", "library")
VOICE_LIB_EXTS = (".wav", ".mp3", ".flac", ".ogg", ".m4a")
CACHE_DIR = os.path.join("outputs", "cache")
KEY_RE = re.compile(r"^[0-9a-f]{40}$")
HTML_TAG_RE = re.compile(r"<[^>]+>")
SENTENCE_SPLIT_RE = re.compile(r"([^。！？!?；;\n]+[。！？!?；;]*|\n+)")
LIVE_JOB_LINGER_SECONDS = 300


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


def _format_voice_path(path: Path) -> str:
    return path.as_posix()


def _find_voice_path(name: str) -> Optional[Path]:
    safe = _safe_voice_name(name)
    if not safe:
        return None
    library_dir = Path(VOICE_LIB_DIR)
    if not library_dir.is_dir():
        return None
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
    if os.path.exists(name_or_path):
        return name_or_path
    path = _find_voice_path(name_or_path)
    return _format_voice_path(path) if path else None


def _ensure_cache_dir() -> None:
    os.makedirs(CACHE_DIR, exist_ok=True)


def _make_cache_key(payload: dict) -> str:
    stable = json.dumps(payload, ensure_ascii=False, sort_keys=True, default=str)
    return hashlib.sha1(stable.encode("utf-8")).hexdigest()


def _cache_paths(key: str) -> tuple[str, str]:
    if not KEY_RE.fullmatch(str(key or "")):
        raise ValueError("cache key must be a 40-character sha1 hex string")
    return os.path.join(CACHE_DIR, f"{key}.wav"), os.path.join(CACHE_DIR, f"{key}.json")


def _get_cached_audio(key: str) -> Optional[str]:
    wav_path, _json_path = _cache_paths(key)
    return wav_path if os.path.isfile(wav_path) else None


def _write_json_atomic(path: str, data: dict) -> None:
    os.makedirs(os.path.dirname(path), exist_ok=True)
    tmp = f"{path}.tmp"
    with open(tmp, "w", encoding="utf-8") as fp:
        json.dump(data, fp, ensure_ascii=False, sort_keys=True, indent=2)
        fp.write("\n")
    os.replace(tmp, path)


def _save_cached_audio(key: str, wav_bytes: bytes, metadata: dict) -> str:
    _ensure_cache_dir()
    wav_path, json_path = _cache_paths(key)
    tmp = f"{wav_path}.tmp"
    with open(tmp, "wb") as fp:
        fp.write(wav_bytes)
    os.replace(tmp, wav_path)
    meta = dict(metadata or {})
    meta["key"] = key
    meta.setdefault("created_at", time.time())
    _write_json_atomic(json_path, meta)
    return wav_path


def _read_cache_metadata(key: str) -> dict:
    _wav_path, json_path = _cache_paths(key)
    try:
        with open(json_path, "r", encoding="utf-8") as fp:
            data = json.load(fp)
        return data if isinstance(data, dict) else {}
    except Exception:
        return {}


def _delete_cache(key: str) -> bool:
    deleted = False
    for path in _cache_paths(key):
        try:
            os.remove(path)
            deleted = True
        except FileNotFoundError:
            pass
        except OSError:
            pass
    return deleted


def _audio_file_meta(path: str) -> dict:
    try:
        st = os.stat(path)
        return {"size": st.st_size, "mtime": int(st.st_mtime)}
    except OSError:
        return {}


def _clean_tavo_body_text(text: str) -> str:
    text = html.unescape(str(text or ""))
    for _ in range(4):
        before = text
        text = re.sub(r"<(script|style|template)\b[^>]*>[\s\S]*?</\1>", "", text, flags=re.IGNORECASE)
        text = re.sub(r"</(p|div|br|li|section|article|blockquote|h[1-6])\s*>", "\n", text, flags=re.IGNORECASE)
        text = HTML_TAG_RE.sub("", text)
        if text == before:
            break
    text = re.sub(r"[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]", "", text)
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


def _dialogue_cache_payload(req: dict, segments: list, role_voice_paths: dict, default_path: str) -> dict:
    return {
        "kind": "fast6g_dialogue_cache_v1",
        "segments": [{"role": s.get("role", ""), "text": s.get("text", "")} for s in segments],
        "voices": {role: {"path": path, "meta": _audio_file_meta(path)} for role, path in sorted(role_voice_paths.items())},
        "default_voice": {"path": default_path, "meta": _audio_file_meta(default_path)} if default_path else None,
        "interval_ms": int(req.get("interval_ms", 350)),
        "top_p": float(req.get("top_p", 0.8)),
        "top_k": int(req.get("top_k", 30)),
        "temperature": float(req.get("temperature", 0.8)),
        "repetition_penalty": float(req.get("repetition_penalty", 10)),
        "cache_nonce": str(req.get("cache_nonce") or ""),
    }


def _resolve_dialogue_voices(segments: list, voices: dict) -> tuple[str, dict, list]:
    voices = {("default" if k == "default" else str(k or "").strip()): str(v or "").strip() for k, v in (voices or {}).items()}
    default_path = _resolve_voice(voices.get("default", ""))
    role_voice_paths = {}
    unresolved = []
    for seg in segments:
        role = str(seg.get("role") or "旁白").strip() or "旁白"
        if role in role_voice_paths:
            continue
        voice = voices.get(role, "")
        path = _resolve_voice(voice) or default_path
        if path:
            role_voice_paths[role] = path
        else:
            unresolved.append(role)
    return default_path, role_voice_paths, unresolved


def _pack_wav_bytes(data: np.ndarray, rate: int) -> bytes:
    return pack_wav(BytesIO(), data, rate).getvalue()


def _normal_segments_from_request(req: dict) -> list[dict]:
    segments = req.get("segments") or []
    out = []
    for seg in segments:
        data = seg.dict() if hasattr(seg, "dict") else dict(seg or {})
        text = str(data.get("text") or "").strip()
        if text:
            out.append({"role": str(data.get("role") or "旁白").strip() or "旁白", "text": text})
    if out:
        return out
    return _parse_dialogue_text_normal(str(req.get("text") or ""))


def _dialogue_request_cache_payload(req: dict, segments: list, role_voice_paths: dict, default_path: str) -> dict:
    payload = _dialogue_cache_payload(req, segments, role_voice_paths, default_path)
    payload["qwen_emo"] = bool(args.qwen_emo)
    return payload


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
        "sample_rate": meta.get("sample_rate") or 22050,
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
    emo_ref_audio_path: Optional[str] = None
    emo_vec: Optional[List[float]] = None
    emo_text: Optional[str] = None
    emo_alpha: Optional[float] = None


class TTS_Dialogue_Request(BaseModel):
    segments: Optional[List[TTS_Segment]] = None
    text: Optional[str] = None
    parse_mode: str = "normal"
    voices: Dict[str, str]
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
        sampling_rate, wav_data = tts_pipeline.infer(
            spk_audio_prompt=req["ref_audio_path"],
            emo_audio_prompt=req["emo_ref_audio_path"] if req["emo_ref_audio_path"] else None,
            text=req["text"],
            emo_text=req["emo_text"],
            use_emo_text=bool(req["emo_text"]),
            emo_alpha=req["emo_alpha"],
            top_p=req["top_p"],
            top_k=req["top_k"],
            temperature=req["temperature"],
            repetition_penalty=req["repetition_penalty"],
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
            "llm_parse": False,
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
    segments = prepared["segments"]
    role_voice_paths = prepared["role_voice_paths"]
    default_path = prepared["default_path"]
    qwen_mode = bool(args.qwen_emo)
    job.metrics["parse_mode"] = prepared["parse_mode"]
    job.metrics["emotion_mode"] = "qwen_emo" if qwen_mode else "off"
    try:
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
            job.metrics["segments_total"] = len(segments)
            for idx, seg in enumerate(segments):
                if job.cancelled:
                    _mark_job_cancelled(job)
                    return
                role = str(seg.get("role") or "旁白").strip() or "旁白"
                text = str(seg.get("text") or "").strip()
                if not text:
                    continue
                voice_path = role_voice_paths.get(role) or default_path
                if not voice_path:
                    raise RuntimeError(f"role voice unresolved: {role}")
                if idx > 0 and int(req.get("interval_ms") or 0) > 0:
                    job.pcm.extend(_silence_pcm_bytes(job.sample_rate, int(req.get("interval_ms") or 0)))
                seg_start = len(job.pcm)
                seg_started = time.perf_counter()

                def _infer_one():
                    return tts_pipeline.infer(
                        spk_audio_prompt=voice_path,
                        emo_audio_prompt=None,
                        text=text,
                        emo_text=text if qwen_mode else None,
                        use_emo_text=qwen_mode,
                        emo_alpha=float(req.get("emo_alpha", 1.0)),
                        top_p=float(req.get("top_p", 0.8)),
                        top_k=int(req.get("top_k", 30)),
                        temperature=float(req.get("temperature", 0.8)),
                        repetition_penalty=float(req.get("repetition_penalty", 10)),
                        output_path=None,
                    )

                sampling_rate, wav_data = await asyncio.to_thread(_infer_one)
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
                    "emotion_mode": "qwen_emo" if qwen_mode else "off",
                }
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
        metadata = {
            "kind": "fast6g_dialogue_stream_v1",
            "segments_meta": job.segments_meta,
            "sample_rate": job.sample_rate,
            "duration_s": audio_duration,
            "metrics": job.metrics,
            "version": "fast6g",
        }
        _save_cached_audio(job.cache_key, wav_bytes, metadata)
        job.metrics["state"] = "done"
        job.metrics["phase"] = "done"
        job.metrics["message"] = "音频已保存"
        _write_json_atomic(_cache_paths(job.cache_key)[1], {**metadata, "metrics": job.metrics})
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
    parse_mode = str(req.get("parse_mode") or "normal").strip().lower()
    if parse_mode in ("single", "plain", "basic"):
        parse_mode = "normal"
    if parse_mode != "normal":
        return None, JSONResponse(
            status_code=400,
            content={
                "message": "fast6g currently supports normal parse only. Use vllm for backend LLM dialogue parsing, or switch Tavo to normal mode.",
                "capability": "llm_parse",
                "supported": False,
            },
        )
    segments = _normal_segments_from_request(req)
    voices = req.get("voices") or {}
    default_path, role_voice_paths, unresolved = _resolve_dialogue_voices(segments, voices)
    if unresolved:
        return None, JSONResponse(status_code=400, content={"message": "voices unresolved", "roles": unresolved})
    payload = _dialogue_request_cache_payload(req, segments, role_voice_paths, default_path)
    cache_key = _make_cache_key(payload)
    return {
        "req": req,
        "parse_mode": parse_mode,
        "segments": segments,
        "default_path": default_path,
        "role_voice_paths": role_voice_paths,
        "cache_key": cache_key,
        "cache_payload": payload,
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
            "sample_rate": job.sample_rate,
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
