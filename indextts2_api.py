import os
import sys
import traceback
import base64
import hashlib
import html
import json
import re
import socket
import secrets
import time
import shutil
from collections import deque

# ---------------------------------------------------------------------------
# Stdout/stderr tee → in-memory ring buffer, exposed via /server_log/tail.
# Installed before anything else so all subsequent print()s are captured.
# vLLM spawn-workers run in subprocesses and DON'T inherit this tee, which
# is fine — the buffer is meant for IndexTTS2 inference timings (RTF,
# s2mel_time, bigvgan_time) which come from the main process.
# ---------------------------------------------------------------------------
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
        try: self._real.flush()
        except Exception: pass
    def __getattr__(self, name):
        return getattr(self._real, name)

try:
    sys.stdout = _StdoutTee(sys.stdout, "stdout")
    sys.stderr = _StdoutTee(sys.stderr, "stderr")
except Exception:
    pass

now_dir = os.getcwd()

import argparse
import asyncio
import signal
from typing import Optional, List, Dict
import numpy as np
import soundfile as sf
import torch
from fastapi import FastAPI, Response
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse, JSONResponse, FileResponse
from fastapi.staticfiles import StaticFiles
import uvicorn
from io import BytesIO

from indextts.infer_vllm_v2 import IndexTTS2

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
parser.add_argument("--fp16", action="store_true", default=True, help="Use FP16 for inference (default: on)")
parser.add_argument("--no_fp16", dest="fp16", action="store_false", help="Force FP32 inference")
parser.add_argument("--use_deepspeed", action="store_true", default=False, help="Use Deepspeed to accelerate if available")
parser.add_argument("--cuda_kernel", action="store_true", default=True, help="Use BigVGAN fused-activation CUDA kernel (default: on)")
parser.add_argument("--no_cuda_kernel", dest="cuda_kernel", action="store_false", help="Disable BigVGAN CUDA kernel")
parser.add_argument("--qwen_emo", action="store_true", default=False, help="Enable Qwen text-emotion model (loads ~2GB to GPU). Off by default; TAVO front-end uses emotion vectors and never calls this.")
parser.add_argument("--no_qwen_emo", dest="qwen_emo", action="store_false", help="(legacy) Qwen is already off by default; this flag is a no-op kept for backward compatibility.")
parser.add_argument("--vllm_gpu_memory_utilization", type=float, default=float(os.getenv("INDEXTTS_VLLM_GPU_MEMORY_UTILIZATION", "0.18")), help="vLLM GPU memory reservation ratio. Lower is safer on 12GB GPUs.")
parser.add_argument("--vllm_enforce_eager", action="store_true", default=os.getenv("INDEXTTS_VLLM_ENFORCE_EAGER", "1") != "0", help="Disable vLLM CUDA graph capture for lower memory pressure (default: on).")
parser.add_argument("--no_vllm_enforce_eager", dest="vllm_enforce_eager", action="store_false", help="Allow vLLM CUDA graph capture for potentially faster GPT generation.")
args = parser.parse_args()

# device = args.device
port = args.port
host = args.bind_addr
argv = sys.argv


APP = FastAPI()
APP.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
    expose_headers=["X-IndexTTS-Cache", "X-IndexTTS-Cache-Key"],
)
@APP.get("/static/tavo.js")
async def tavo_js_endpoint():
    """Serve the injected TAVO bridge without browser/CDN caching."""
    path = os.path.join("static", "tavo.js")
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
    """Standalone browser test page for the TAVO injected widget."""
    return FileResponse(
        os.path.join("static", "tavo_widget_test.html"),
        media_type="text/html; charset=utf-8",
        headers={"Cache-Control": "no-store, no-cache, must-revalidate, max-age=0"},
    )


@APP.head("/tavo_test")
async def tavo_widget_test_head():
    path = os.path.join("static", "tavo_widget_test.html")
    headers = {
        "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0",
        "Content-Length": str(os.path.getsize(path)) if os.path.exists(path) else "0",
    }
    return Response(status_code=200 if os.path.exists(path) else 404, media_type="text/html", headers=headers)


def _icon_media_type(path: str) -> str:
    ext = os.path.splitext(path)[1].lower()
    if ext == ".png":
        return "image/png"
    if ext in (".jpg", ".jpeg"):
        return "image/jpeg"
    if ext == ".webp":
        return "image/webp"
    if ext == ".svg":
        return "image/svg+xml"
    return "application/octet-stream"


def _prompt_icon_path(name: str) -> Optional[str]:
    safe_name = os.path.basename(str(name or ""))
    if not safe_name or safe_name != name:
        return None
    if os.path.splitext(safe_name)[1].lower() not in {".png", ".jpg", ".jpeg", ".webp", ".svg"}:
        return None
    path = os.path.join("prompts", "icon", safe_name)
    return path if os.path.exists(path) else None


@APP.get("/prompts/icon/{name}")
async def prompt_icon_endpoint(name: str):
    path = _prompt_icon_path(name)
    if not path:
        return JSONResponse(status_code=404, content={"message": "icon not found", "name": name})
    return FileResponse(
        path,
        media_type=_icon_media_type(path),
        headers={"Cache-Control": "public, max-age=86400"},
    )


@APP.head("/prompts/icon/{name}")
async def prompt_icon_head(name: str):
    path = _prompt_icon_path(name)
    if not path:
        return Response(status_code=404)
    return Response(
        status_code=200,
        media_type=_icon_media_type(path),
        headers={
            "Cache-Control": "public, max-age=86400",
            "Content-Length": str(os.path.getsize(path)),
        },
    )


if os.path.isdir("static"):
    APP.mount("/static", StaticFiles(directory="static"), name="static")


class TTS_Request(BaseModel):
    text: str = None
    emo_text: str = None
    ref_audio_path: str = None
    emo_ref_audio_path: str = None
    top_k: int = 30
    top_p: float = 0.8
    temperature: float = 0.7
    emo_alpha: float = 0.55
    emo_vec: list = []
    normalize_emo_vec: bool = False
    speed_factor: float = 1.0
    seed: int = -1
    parallel_infer: bool = True
    repetition_penalty: float = 1.2
    bypass_cache: bool = False
    diffusion_steps: Optional[int] = None
    prompt_audio_seconds: Optional[float] = None
    segment_tokens: Optional[int] = None
    first_tokens: Optional[int] = None
    s2mel_cfg_rate: Optional[float] = None


# Phase 2 dialogue request models.
# `segments` is still accepted for old callers that pre-parse text. The Tavo
# intelligent path should send raw `text` plus LLM config and let the backend
# job own parsing, reuse, status, and errors.
class TTS_Segment(BaseModel):
    role: str
    text: str
    # Segment-level vocal style. `style` is the preferred public field; the
    # other names are accepted for direct file/path control and old drafts.
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
    # `ai` = backend LLM parse, `normal` = deterministic narrator/dialogue split.
    parse_mode: str = "ai"
    # role -> voice library name OR direct file path
    voices: Dict[str, str]
    # Backend-owned LLM parsing config for text-only intelligent dialogue jobs.
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
    performance_mode: str = "expressive"
    interval_ms: int = 350
    top_p: float = 0.8
    top_k: int = 30
    temperature: float = 0.7
    repetition_penalty: float = 1.2
    emo_alpha: float = 0.55  # default if a segment doesn't override
    diffusion_steps: Optional[int] = None
    prompt_audio_seconds: Optional[float] = None
    segment_tokens: Optional[int] = None
    first_tokens: Optional[int] = None
    s2mel_cfg_rate: Optional[float] = None
    bypass_cache: bool = False
    cache_nonce: Optional[str] = None


class Voice_Save_Request(BaseModel):
    name: str
    source_path: Optional[str] = None
    audio_base64: Optional[str] = None
    ext: str = ".wav"


class Profile_Save_Request(BaseModel):
    name: str
    data: dict


class Usage_Log_Request(BaseModel):
    event_type: str
    payload: dict


class Cache_Prune_Request(BaseModel):
    max_items: int = 5000


class Parse_Text_Request(BaseModel):
    text: str
    endpoint: str
    model: str
    api_key: str
    system_prompt: Optional[str] = None
    temperature: float = 0.2
    timeout: int = 60
    max_tokens: Optional[int] = None


def pack_wav(io_buffer: BytesIO, data: np.ndarray, rate: int):
    io_buffer = BytesIO()
    sf.write(io_buffer, data, rate, format="wav")
    return io_buffer


# ---------------------------------------------------------------------------
# Streaming helpers (Phase 1: single-segment streaming for TAVO regex use).
# Streaming and test endpoints use these generation defaults.
# ---------------------------------------------------------------------------

# Stream-tuned generation parameters mirrored from webui.py.
# These are the values that produced RTF ~0.6 on the same RTX 3060 hardware.
# diffusion_steps=8 (vs default 16) is the biggest single lever; short segment
# tokens + 8s prompt cap keep cat_frames small so each diffusion step is cheap.
STREAM_TARGET_SEGMENT_TOKENS = 72
STREAM_HARD_SEGMENT_TOKENS = 82
STREAM_FIRST_SEGMENT_TOKENS = 24
STREAM_MIN_SEGMENT_TOKENS = 24
STREAM_DIFFUSION_STEPS = 8
STREAM_PROMPT_AUDIO_SECONDS = 8
STREAM_MODE_SETTINGS = {
    "fast": {
        "target_tokens": 40,
        "hard_tokens": 56,
        "first_tokens": 10,
        "min_tokens": 12,
        "diffusion_steps": 8,
        "prompt_audio_seconds": 6,
        # ⚠️ CFG=0 会让本模型 s2mel 输出近静音（极速档曾因此“进度在走但没声音”）。
        # 必须 cfg>0；实时靠短参考/短段控制 RTF，不靠关 CFG。
        "s2mel_cfg_rate": 0.7,
    },
    "balanced": {
        "target_tokens": 60,
        "hard_tokens": 76,
        "first_tokens": 18,
        "min_tokens": 16,
        "diffusion_steps": 14,
        "prompt_audio_seconds": 10,
        "s2mel_cfg_rate": 0.7,
    },
    "expressive": {
        "target_tokens": 72,
        "hard_tokens": 92,
        "first_tokens": 24,
        "min_tokens": STREAM_MIN_SEGMENT_TOKENS,
        # 质量优先：接近模型默认 16 步，适合生成后播落盘，实时可能 RTF>1。
        "diffusion_steps": 16,
        "prompt_audio_seconds": 12,
        "s2mel_cfg_rate": 0.7,
    },
}


def _stream_mode_settings(mode: str = "expressive") -> dict:
    mode = str(mode or "expressive").strip().lower()
    if mode not in STREAM_MODE_SETTINGS:
        mode = "expressive"
    return dict(STREAM_MODE_SETTINGS[mode], mode=mode)


def _stream_infer_kwargs(requested_segment_tokens: int = None, performance_mode: str = "expressive") -> dict:
    settings = _stream_mode_settings(performance_mode)
    target_tokens = int(requested_segment_tokens or settings["target_tokens"])
    target_tokens = max(8, min(target_tokens, STREAM_TARGET_SEGMENT_TOKENS))
    hard_tokens = int(settings["hard_tokens"])
    first_tokens = min(int(settings["first_tokens"]), target_tokens)
    min_tokens = min(int(settings["min_tokens"]), target_tokens)
    prompt_seconds = int(settings["prompt_audio_seconds"])
    return {
        "max_text_tokens_per_sentence": target_tokens,
        "diffusion_steps": int(settings["diffusion_steps"]),
        "max_prompt_audio_seconds": prompt_seconds,
        "max_emo_audio_seconds": prompt_seconds,
        "prefer_sentence_boundary": True,
        "quick_streaming_tokens": first_tokens,
        "sentence_split_hard_max_tokens": hard_tokens,
        "sentence_split_min_tokens": min_tokens,
        "performance_mode": settings["mode"],
        "s2mel_cfg_rate": float(settings.get("s2mel_cfg_rate", 0.7)),
    }


def _clamp_float(value, default: float, min_value: float, max_value: float) -> float:
    try:
        value = float(value)
    except (TypeError, ValueError):
        return default
    return max(min_value, min(max_value, value))


def _clamp_int(value, default: int, min_value: int, max_value: int) -> int:
    try:
        value = int(value)
    except (TypeError, ValueError):
        return default
    return max(min_value, min(max_value, value))


def _apply_s2mel_test_overrides(req: dict, sampling_kwargs: dict) -> dict:
    """Apply optional generation knobs without changing defaults."""
    if req.get("diffusion_steps") is not None:
        sampling_kwargs["diffusion_steps"] = _clamp_int(req.get("diffusion_steps"), sampling_kwargs.get("diffusion_steps", 6), 2, 16)
    if req.get("prompt_audio_seconds") is not None:
        prompt_seconds = _clamp_float(req.get("prompt_audio_seconds"), sampling_kwargs.get("max_prompt_audio_seconds", 8), 2.0, 12.0)
        sampling_kwargs["max_prompt_audio_seconds"] = prompt_seconds
        sampling_kwargs["max_emo_audio_seconds"] = prompt_seconds
    if req.get("segment_tokens") is not None:
        target_tokens = _clamp_int(req.get("segment_tokens"), sampling_kwargs.get("max_text_tokens_per_sentence", 56), 8, 120)
        sampling_kwargs["max_text_tokens_per_sentence"] = target_tokens
        sampling_kwargs["quick_streaming_tokens"] = min(sampling_kwargs.get("quick_streaming_tokens", target_tokens), target_tokens)
        sampling_kwargs["sentence_split_min_tokens"] = min(sampling_kwargs.get("sentence_split_min_tokens", target_tokens), target_tokens)
        sampling_kwargs["sentence_split_hard_max_tokens"] = max(target_tokens, min(140, target_tokens + 16))
    first_tokens_value = req.get("first_tokens")
    if first_tokens_value is None:
        first_tokens_value = req.get("quick_streaming_tokens")
    if first_tokens_value is not None:
        target_tokens = int(sampling_kwargs.get("max_text_tokens_per_sentence", 56))
        sampling_kwargs["quick_streaming_tokens"] = _clamp_int(first_tokens_value, sampling_kwargs.get("quick_streaming_tokens", 16), 4, target_tokens)
    if req.get("s2mel_cfg_rate") is not None:
        sampling_kwargs["s2mel_cfg_rate"] = _clamp_float(req.get("s2mel_cfg_rate"), 0.7, 0.0, 1.2)
    return sampling_kwargs


# Serialize streaming inference: the underlying IndexTTS2 mutates shared
# instance state (cache_spk_cond, etc.), so concurrent infer() calls would
# clobber each other. Lock around inference only; the StreamingResponse
# generator yields outside the lock.
tts_stream_lock = asyncio.Lock()
STREAM_JOBS: Dict[str, dict] = {}
STREAM_JOB_TTL_SECONDS = 600


# ---------------------------------------------------------------------------
# Live streaming jobs keyed by cache_key (pub-sub buffer).
# 设计目标：客户端断开/刷新不丢推理任务，回来 GET 同 cache_key 继续读。
# - POST /tts_dialogue_stream_job 立即创建 LIVE_JOBS 条目 + 启动后台
#   inference task，返回 cache_key 给客户端。客户端立即可写 tavo.set。
# - GET /tts_dialogue_stream_job/{cache_key} 多消费者：从 buffer 0
#   开始读，新 PCM 到达就 yield，结束后落盘 snapshot_cache。
# - 完成后任务在 LIVE_JOBS 里再驻留 5 分钟方便晚到的客户端继续 stream；
#   之后 GC。已落盘的内容用 /cache_audio/{key} 即可永久取回。
# ---------------------------------------------------------------------------
LIVE_JOBS: Dict[str, "_LiveStreamingJob"] = {}
LIVE_JOB_LINGER_SECONDS = 300


class _LiveStreamingJob:
    def __init__(self, cache_key: str, sample_rate: int = 22050):
        self.cache_key = cache_key
        self.sample_rate = sample_rate
        self.header = _wav_streaming_header(sample_rate, channels=1, bits=16)
        self.pcm = bytearray()
        self.finished = asyncio.Event()
        self.error: Optional[str] = None
        self.cancelled = False
        self.created_at = time.time()
        self._perf_created = time.perf_counter()
        # 为字幕用：每段 PCM 起始字节偏移 + 文本 + 角色 + 真实时长
        self.segments_meta: List[dict] = []
        self.metrics: Dict[str, object] = {
            "created_at": self.created_at,
            "state": "pending",
            "segments_total": 0,
            "segments_done": 0,
            "lock_wait_s": None,
            "first_pcm_s": None,
            "total_wall_s": None,
            "audio_duration_s": 0.0,
            "rtf": None,
            "cache_write_s": None,
            "segments_wall_s": 0.0,
            "wall_rtf": None,
            "gpt_gen_s": 0.0,
            "gpt_forward_s": 0.0,
            "s2mel_s": 0.0,
            "bigvgan_s": 0.0,
            "spk_condition_s": 0.0,
            "emo_condition_s": 0.0,
            "condition_s": 0.0,
            "segments": [],
        }


def _gc_live_job(cache_key: str, delay: float = LIVE_JOB_LINGER_SECONDS, expected_job: Optional["_LiveStreamingJob"] = None):
    async def _go():
        await asyncio.sleep(delay)
        if expected_job is not None and LIVE_JOBS.get(cache_key) is not expected_job:
            return
        LIVE_JOBS.pop(cache_key, None)
    try: asyncio.create_task(_go())
    except Exception: pass


async def _stream_from_live_job(job: "_LiveStreamingJob", start_offset_s: float = 0.0):
    """Multi-consumer streamer; reads job.pcm tail-poll, yields new bytes."""
    try:
        start_offset_s = max(0.0, float(start_offset_s or 0.0))
    except Exception:
        start_offset_s = 0.0
    sample_rate = int(job.sample_rate or 22050)
    block_align = 2
    offset = int(start_offset_s * sample_rate * block_align)
    offset = max(0, offset - (offset % block_align))
    yield _wav_streaming_header(sample_rate, channels=1, bits=16)
    while True:
        if offset < len(job.pcm):
            chunk = bytes(job.pcm[offset:])
            yield chunk
            offset = len(job.pcm)
        if job.finished.is_set() and offset >= len(job.pcm):
            return
        await asyncio.sleep(0.05)


def _make_complete_wav_bytes(pcm: bytes, sample_rate: int, channels: int = 1, bits: int = 16) -> bytes:
    """Build a proper WAV with real size fields (so /cache_audio can serve
    seekable, range-friendly audio)."""
    byte_rate = sample_rate * channels * bits // 8
    block_align = channels * bits // 8
    data_size = len(pcm)
    riff_size = 36 + data_size
    header = (
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
    )
    return header + pcm


BACKEND_LLM_PARSE_PROMPT_VERSION = "20260605-backend-v1"
BACKEND_NORMAL_PARSE_VERSION = "20260605-normal-v1"
LLM_PARSE_CACHE_MAX = 64
LLM_PARSE_CACHE: Dict[str, dict] = {}


def _mark_job_cancelled(job: "_LiveStreamingJob", message: str = "任务已取消"):
    if not job:
        return
    job.cancelled = True
    job.error = None
    job.metrics["state"] = "cancelled"
    job.metrics["phase"] = "cancelled"
    job.metrics["message"] = message


def _secret_hash(value: str) -> str:
    value = str(value or "")
    if not value:
        return ""
    return hashlib.sha1(value.encode("utf-8")).hexdigest()


def _llm_max_tokens_for_text(text: str) -> int:
    return min(12000, max(4000, int(len(str(text or "")) * 5 + 0.999)))


def _normalize_dialogue_voices(voices: dict) -> Dict[str, str]:
    from indextts.llm_proxy import _normalize_role

    normalized: Dict[str, str] = {}
    for key, value in (voices or {}).items():
        role = "default" if key == "default" else _normalize_role(key)
        normalized[role] = str(value or "").strip()
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


def _dialogue_common_settings(req: dict) -> dict:
    interval_ms = int(req.get("interval_ms", 350))
    default_emo_alpha = float(req.get("emo_alpha", 0.55))
    performance_mode = str(req.get("performance_mode") or "expressive").strip().lower()
    sampling_kwargs = {
        "top_p": float(req.get("top_p", 0.8)),
        "top_k": int(req.get("top_k", 30)),
        "temperature": float(req.get("temperature", 0.7)),
        "repetition_penalty": float(req.get("repetition_penalty", 1.2)),
        **_stream_infer_kwargs(performance_mode=performance_mode),
    }
    sampling_kwargs = _apply_s2mel_test_overrides(req, sampling_kwargs)
    return {
        "interval_ms": interval_ms,
        "default_emo_alpha": default_emo_alpha,
        "sampling_kwargs": sampling_kwargs,
    }


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
        "   无论主语是不是用户身份名/当前角色名，只要不是引号里的直接台词，都必须写 \"旁白\"。",
        "   例如「白夜雨抱住她」「潘金莲低下头」「她笑了」「我低下头看着……」「白夜雨说道：」都写旁白，不要让用户或角色认领旁白。",
        "   旁白 style 永远写 neutral，style_alpha 写 0.15，emo_vec 写 [0,0,0,0,0,0,0,1]。",
        "   旁白连续多个句子，要按句号/问号/感叹号/分号拆成多个旁白 segments，每段≤2 句。",
        "2. 人物直接说出口的话 → role 用说话人的名字。",
        "   - 如果说话人是「你」或用户身份名，role 统一写 \"用户\"。",
        "   - 不要把「我」当作用户；无引号的「我……」默认是第一人称叙述，role 写 \"旁白\"。",
        "   - 其他人物优先从已知角色名单挑名字；名单外的新人物用原文里的名字。",
        "3. 「他说：」「她笑道：」「白夜雨说道：」这类引导句本身永远是旁白；只有后面引号里的直接台词才按说话人分配。",
        "4. text 是要朗读的原文片段，保留标点和语气词。",
        "5. style 是段级声腔/呼吸参考，只能从这个枚举里选: " + _style_catalog_for_prompt(),
        "",
        "完整性硬规则:",
        "- 必须覆盖输入原文 100%，按原文顺序输出，不要总结、改写、删字、漏掉最后一段。",
        "- 每个原文片段只能出现一次，不要把多段无关尾巴合并成一条对白。",
        "- 如果最后一个引号后还有动作/叙述/心理描写，最后一段必须是 role=\"旁白\"。",
        "- 不确定说话人时用 role=\"旁白\"，不要沿用上一句对白角色。",
        "",
        "emo_vec 是 8 维向量，必须严格按模型顺序:",
        "[0]=happy 高兴 [1]=angry 愤怒 [2]=sad 悲伤 [3]=fear 恐惧 [4]=hate 反感 [5]=low 低落 [6]=surprise 惊讶 [7]=neutral 自然。",
        "每段只激活 1-2 个最匹配维度，其他写 0；平静叙述/客观描写用 [0,0,0,0,0,0,0,0.8]。",
        "每段可加 emo_alpha 字段：旁白 0.12-0.22，平静对白 0.20-0.30，正常带情绪对白 0.32-0.44，强烈台词 0.46-0.52。",
        "style_alpha: neutral=0.12-0.20；轻微声腔=0.34-0.46；明显 breath/moan/呻吟/喘息=0.50-0.70。",
        "",
        "示例输入:",
        "她低着头，眼角有泪。「对不起，我真的撑不住了。」",
        f"{example_user}叹了口气，把手放在她肩上：「别哭。」",
        "示例输出:",
        "{\"segments\":[",
        "  {\"role\":\"旁白\",\"text\":\"她低着头，眼角有泪。\",\"style\":\"neutral\",\"style_alpha\":0.15,\"emo_vec\":[0,0,0,0,0,0,0,1]},",
        "  {\"role\":\"她\",\"text\":\"对不起，我真的撑不住了。\",\"style\":\"sob_soft\",\"style_alpha\":0.42,\"emo_vec\":[0,0,0.48,0.05,0,0.12,0,0.35]},",
        f"  {{\"role\":\"旁白\",\"text\":\"{example_user}叹了口气，把手放在她肩上：\",\"style\":\"neutral\",\"style_alpha\":0.15,\"emo_vec\":[0,0,0,0,0,0,0,1]}},",
        "  {\"role\":\"用户\",\"text\":\"别哭。\",\"style\":\"whisper_soft\",\"style_alpha\":0.45,\"emo_vec\":[0.2,0,0.3,0,0,0.2,0,0.5]}",
        "]}",
    ])


def _parse_cache_payload(req: dict, voices: dict) -> dict:
    return {
        "kind": "tts_dialogue_llm_parse_v1",
        "prompt_version": BACKEND_LLM_PARSE_PROMPT_VERSION,
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


def _put_parse_cache(key: str, segments: list):
    if not key or not segments:
        return
    LLM_PARSE_CACHE[key] = {"segments": segments, "created_at": time.time(), "last_hit": time.time()}
    if len(LLM_PARSE_CACHE) > LLM_PARSE_CACHE_MAX:
        oldest = sorted(LLM_PARSE_CACHE.items(), key=lambda kv: kv[1].get("last_hit") or kv[1].get("created_at") or 0)
        for old_key, _ in oldest[: max(1, len(LLM_PARSE_CACHE) - LLM_PARSE_CACHE_MAX)]:
            LLM_PARSE_CACHE.pop(old_key, None)


_HTML_TAG_RE = re.compile(r"<[^>]+>")
_EMOJI_RE = re.compile(
    "["
    "\U0001F1E6-\U0001F1FF"
    "\U0001F300-\U0001FAFF"
    "\U00002700-\U000027BF"
    "\U00002600-\U000026FF"
    "]+",
    re.UNICODE,
)
_CONTROL_RE = re.compile(r"[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]")


def _clean_tavo_body_text(text: str) -> str:
    text = html.unescape(str(text or ""))
    for _ in range(6):
        before = text
        text = re.sub(r"<(script|style|template)\b[^>]*>[\s\S]*?</\1>", "", text, flags=re.IGNORECASE)
        text = re.sub(r"\[[A-Za-z0-9_-]*TAVO[A-Za-z0-9_-]*\]", "", text, flags=re.IGNORECASE)
        text = re.sub(r"\[IndexTTS_TAVO_SCRIPT\]", "", text, flags=re.IGNORECASE)
        text = re.sub(r"</(p|div|br|li|section|article|blockquote|h[1-6])\s*>", "\n", text, flags=re.IGNORECASE)
        text = _HTML_TAG_RE.sub("", text)
        if text == before:
            break
    text = _CONTROL_RE.sub("", text)
    text = _EMOJI_RE.sub("", text)
    text = re.sub(r"^[ \t>*#\-_=~`]+", "", text, flags=re.MULTILINE)
    text = re.sub(r"[ \t\u3000]+", " ", text)
    text = re.sub(r"\n{3,}", "\n\n", text)
    return text.strip()


_QUOTE_PAIRS = {
    "「": "」",
    "『": "』",
    "“": "”",
    "‘": "’",
    "\"": "\"",
}
_QUOTE_OPENERS = set(_QUOTE_PAIRS.keys())
_SENTENCE_SPLIT_RE = re.compile(r"([^。！？!?；;…\n]+[。！？!?；;…]*|\n+)")


def _split_normal_text_units(text: str, max_chars: int = 86) -> List[str]:
    text = str(text or "").strip()
    if not text:
        return []
    units: List[str] = []
    for match in _SENTENCE_SPLIT_RE.finditer(text):
        part = (match.group(1) or "").strip()
        if not part or part.isspace():
            continue
        units.append(part)
    if not units:
        units = [text]
    out: List[str] = []
    buf = ""
    for part in units:
        if len(part) > max_chars:
            if buf:
                out.append(buf.strip())
                buf = ""
            pieces = re.split(r"(?<=[，,、：:])", part)
            chunk = ""
            for piece in pieces:
                piece = piece.strip()
                if not piece:
                    continue
                if chunk and len(chunk) + len(piece) > max_chars:
                    out.append(chunk.strip())
                    chunk = piece
                else:
                    chunk += piece
            if chunk:
                while len(chunk) > max_chars:
                    out.append(chunk[:max_chars].strip())
                    chunk = chunk[max_chars:]
                if chunk.strip():
                    out.append(chunk.strip())
            continue
        if buf and len(buf) + len(part) > max_chars:
            out.append(buf.strip())
            buf = part
        else:
            buf += part
    if buf.strip():
        out.append(buf.strip())
    return [x for x in out if re.search(r"[\u4e00-\u9fffA-Za-z0-9]", x)]


def _normal_segment(role: str, text: str) -> dict:
    return {
        "role": role,
        "text": text,
        "style": "neutral",
        "style_alpha": 0.15 if role == "旁白" else 0.20,
        "emo_vec": [0, 0, 0, 0, 0, 0, 0, 0.85 if role == "旁白" else 0.65],
        "emo_alpha": 0.16 if role == "旁白" else 0.24,
    }


def _parse_dialogue_text_normal(req: dict) -> List[dict]:
    text = _clean_tavo_body_text(req.get("text") or "")
    if not text:
        raise RuntimeError("普通模式没有可朗读正文")
    segments: List[dict] = []
    narration: List[str] = []
    i = 0

    def flush_narration():
        raw = "".join(narration).strip()
        narration.clear()
        for unit in _split_normal_text_units(raw):
            segments.append(_normal_segment("旁白", unit))

    while i < len(text):
        ch = text[i]
        if ch in _QUOTE_OPENERS:
            closer = _QUOTE_PAIRS[ch]
            j = i + 1
            inner: List[str] = []
            found = False
            while j < len(text):
                cur = text[j]
                if cur == closer:
                    found = True
                    break
                inner.append(cur)
                j += 1
            if found:
                flush_narration()
                for unit in _split_normal_text_units("".join(inner)):
                    segments.append(_normal_segment("对白", unit))
                i = j + 1
                continue
        narration.append(ch)
        i += 1
    flush_narration()

    merged: List[dict] = []
    for seg in segments:
        if merged and merged[-1]["role"] == seg["role"] and len(merged[-1]["text"]) + len(seg["text"]) <= 52:
            merged[-1]["text"] = (merged[-1]["text"] + seg["text"]).strip()
        else:
            merged.append(seg)
    if not merged:
        merged.append(_normal_segment("旁白", text))
    return merged


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
        role = str(seg.get("role") or "旁白").strip()
        lowered = role.lower()
        if role == user_name and user_name:
            role = "用户"
        elif role in ("角色", "当前角色") or lowered == "character":
            role = character_name or role
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
        out.append({
            "role": role or "旁白",
            "text": text,
            "style": style,
            "style_alpha": style_alpha,
            "emo_vec": emo_vec,
            "emo_alpha": emo_alpha,
        })
    if not out:
        raise RuntimeError("LLM 没有返回可用片段")
    return out


async def _parse_dialogue_text_in_backend(prepared: dict, job: "_LiveStreamingJob") -> List[dict]:
    req = prepared["req"]
    parse_cfg = prepared["parse"]
    cache_key = parse_cfg.get("cache_key") or ""
    if parse_cfg.get("reuse") and cache_key:
        cached = _get_parse_cache(cache_key)
        if cached:
            job.metrics["llm_parse_cached"] = True
            job.metrics["llm_segments"] = len(cached)
            return cached

    from indextts import llm_proxy

    endpoint = str(req.get("llm_endpoint") or "").strip()
    model = str(req.get("llm_model") or "").strip()
    if not endpoint or not model:
        raise RuntimeError("多音色智能模式缺少 LLM endpoint 或 model")

    started = time.perf_counter()
    prompt = _build_backend_parse_prompt(req, prepared.get("voices") or {})
    max_tokens = req.get("parse_max_tokens")
    if max_tokens is None:
        max_tokens = _llm_max_tokens_for_text(req.get("text") or "")
    job.metrics["state"] = "parsing"
    job.metrics["phase"] = "llm_parse"
    job.metrics["message"] = "后端正在调用 LLM 拆分文本"
    result = await asyncio.to_thread(
        llm_proxy.parse_text_openai_compatible,
        text=req.get("text") or "",
        endpoint=endpoint,
        model=model,
        api_key=req.get("llm_api_key") or "",
        system_prompt=prompt,
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


def _resolve_dialogue_voices_for_segments(segments: list, voices: dict):
    from indextts.llm_proxy import _normalize_role

    default_path = _resolve_voice(voices.get("default", ""))
    role_voice_paths: Dict[str, str] = {}
    unresolved_roles: List[str] = []
    seen_roles = set()
    for seg in segments:
        role = _normalize_role(seg.get("role") or "")
        if not role or role in seen_roles:
            seen_roles.add(role)
            continue
        seen_roles.add(role)
        path = _resolve_voice(voices.get(role, "")) or default_path
        if not path:
            unresolved_roles.append(role)
        else:
            role_voice_paths[role] = path
    return default_path, role_voice_paths, unresolved_roles


def _dialogue_segments_cache_payload(segments: list, role_voice_paths: dict, default_path: str, req: dict, common: dict, parse_info: dict = None) -> dict:
    sampling_kwargs = common["sampling_kwargs"]
    role_payload = {
        role: {"path": path, "meta": _audio_file_meta(path)}
        for role, path in sorted((role_voice_paths or {}).items())
    }
    cache_payload = {
        "kind": "tts_dialogue_stream_v1",
        "segments": [
            {
                "role": (seg.get("role") or "").strip(),
                "text": (seg.get("text") or "").strip(),
                **_style_cache_fragment(seg),
                "emo_vec": seg.get("emo_vec") or None,
                "emo_text": seg.get("emo_text") or None,
                "emo_alpha": seg.get("emo_alpha"),
            }
            for seg in segments
        ],
        "voices": role_payload,
        "default_voice": {"path": default_path, "meta": _audio_file_meta(default_path)} if default_path else None,
        "interval_ms": common["interval_ms"],
        "emo_alpha": common["default_emo_alpha"],
        **sampling_kwargs,
    }
    if parse_info:
        cache_payload["backend_parse"] = parse_info
    cache_nonce = str(req.get("cache_nonce") or "").strip()
    if cache_nonce:
        cache_payload["cache_nonce"] = cache_nonce
    return cache_payload


def _attach_dialogue_segments_to_prepared(prepared: dict, segments: list):
    voices = prepared.get("voices") or {}
    default_path, role_voice_paths, unresolved_roles = _resolve_dialogue_voices_for_segments(segments, voices)
    if unresolved_roles:
        mode = str((prepared.get("req") or {}).get("parse_mode") or "ai").strip().lower()
        label = "普通模式拆分" if mode == "normal" else "LLM 拆段"
        raise RuntimeError("音色映射缺失: " + label + "拆出了这些角色，但没有对应音色，也没有 default: " + "、".join(unresolved_roles))
    prepared["segments"] = segments
    prepared["role_voice_paths"] = role_voice_paths
    prepared["default_path"] = default_path
    return prepared


async def _prepare_dialogue_for_streaming(req: dict):
    """Resolve stable job inputs and compute cache_key.

    Returns (prepared_dict, None) on success or (None, JSONResponse) on input error.
    Text-only jobs intentionally defer LLM parsing to the background worker so
    Tavo receives a job/cache id before LLM success or failure is known.
    """
    segments = req.get("segments") or []
    text = str(req.get("text") or "").strip()
    voices = _normalize_dialogue_voices(req.get("voices") or {})
    parse_mode = str(req.get("parse_mode") or "ai").strip().lower()
    if parse_mode in ("single", "normal", "plain", "basic"):
        parse_mode = "normal"
    else:
        parse_mode = "ai"
    req["parse_mode"] = parse_mode
    if not voices:
        return None, JSONResponse(status_code=400, content={"message": "voices is required"})
    if not segments and not text:
        return None, JSONResponse(status_code=400, content={"message": "segments or text is required"})

    common = _dialogue_common_settings(req)
    from indextts import snapshot_cache

    if segments:
        default_path, role_voice_paths, unresolved_roles = _resolve_dialogue_voices_for_segments(segments, voices)
        if unresolved_roles:
            return None, JSONResponse(
                status_code=400,
                content={"message": "voices unresolved", "roles": unresolved_roles},
            )
        cache_payload = _dialogue_segments_cache_payload(segments, role_voice_paths, default_path, req, common)
        cache_key = snapshot_cache.make_cache_key(cache_payload)
        return {
            "req": req,
            "needs_parse": False,
            "parse_mode": parse_mode,
            "segments": segments,
            "voices": voices,
            "role_voice_paths": role_voice_paths,
            "default_path": default_path,
            "sampling_kwargs": common["sampling_kwargs"],
            "interval_ms": common["interval_ms"],
            "default_emo_alpha": common["default_emo_alpha"],
            "cache_payload": cache_payload,
            "cache_key": cache_key,
        }, None

    if parse_mode == "normal":
        segments = _parse_dialogue_text_normal(req)
        default_path, role_voice_paths, unresolved_roles = _resolve_dialogue_voices_for_segments(segments, voices)
        if unresolved_roles:
            return None, JSONResponse(
                status_code=400,
                content={"message": "voices unresolved", "roles": unresolved_roles},
            )
        parse_info = {
            "mode": "normal",
            "version": BACKEND_NORMAL_PARSE_VERSION,
            "clean_text_sha1": hashlib.sha1(_clean_tavo_body_text(text).encode("utf-8")).hexdigest(),
        }
        cache_payload = _dialogue_segments_cache_payload(segments, role_voice_paths, default_path, req, common, parse_info=parse_info)
        cache_payload["kind"] = "tts_dialogue_stream_normal_parse_v1"
        cache_key = snapshot_cache.make_cache_key(cache_payload)
        return {
            "req": req,
            "needs_parse": False,
            "parse_mode": "normal",
            "segments": segments,
            "voices": voices,
            "role_voice_paths": role_voice_paths,
            "default_path": default_path,
            "sampling_kwargs": common["sampling_kwargs"],
            "interval_ms": common["interval_ms"],
            "default_emo_alpha": common["default_emo_alpha"],
            "cache_payload": cache_payload,
            "cache_key": cache_key,
        }, None

    if not str(req.get("llm_endpoint") or "").strip() or not str(req.get("llm_model") or "").strip():
        return None, JSONResponse(status_code=400, content={"message": "text dialogue job requires llm_endpoint and llm_model"})

    configured_payload = _configured_voice_payload(voices)
    invalid_voices = [role for role, item in configured_payload.items() if item.get("voice") and not item.get("path")]
    if invalid_voices:
        return None, JSONResponse(status_code=400, content={"message": "voices unresolved", "roles": invalid_voices})
    parse_payload = _parse_cache_payload(req, voices)
    parse_cache_key = snapshot_cache.make_cache_key(parse_payload)
    cache_payload = {
        "kind": "tts_dialogue_stream_backend_parse_v1",
        "text": text,
        "backend_parse": parse_payload,
        "voices": configured_payload,
        "interval_ms": common["interval_ms"],
        "emo_alpha": common["default_emo_alpha"],
        **common["sampling_kwargs"],
    }
    cache_nonce = str(req.get("cache_nonce") or "").strip()
    if cache_nonce:
        cache_payload["cache_nonce"] = cache_nonce
    cache_key = snapshot_cache.make_cache_key(cache_payload)
    return {
        "req": req,
        "needs_parse": True,
        "parse_mode": "ai",
        "segments": [],
        "voices": voices,
        "sampling_kwargs": common["sampling_kwargs"],
        "interval_ms": common["interval_ms"],
        "default_emo_alpha": common["default_emo_alpha"],
        "cache_payload": cache_payload,
        "cache_key": cache_key,
        "parse": {
            "cache_key": parse_cache_key,
            "payload": parse_payload,
            "reuse": bool(req.get("reuse_llm_parse", True)),
        },
    }, None


def _stabilize_dialogue_emo_vec(role: str, emo_vec):
    """Keep LLM-provided emotion vectors from hitting the model at full force."""
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
    # Intimate/ASMR lean: the model's bright, high-arousal dimensions push
    # pitch and energy up, which is the opposite of the low/breathy delivery
    # this deployment wants. Gently de-emphasize them; sad/fear/hate/low/neutral
    # pass through untouched. Model emo order (config.yaml emo_num):
    # [0]=happy [1]=angry [2]=sad [3]=fear [4]=hate [5]=low [6]=surprise [7]=neutral.
    # Tune AROUSAL_DAMP at the wake-up A/B; 1.0 disables the lean.
    AROUSAL_DAMP = {0: 0.8, 1: 0.8, 6: 0.8}
    for idx, factor in AROUSAL_DAMP.items():
        vals[idx] *= factor
    active_cap = 0.58
    active_sum = 0.0
    for idx in range(7):
        vals[idx] = min(vals[idx], active_cap)
        active_sum += vals[idx]
    max_active_sum = 1.05
    if active_sum > max_active_sum:
        scale = max_active_sum / active_sum
        for idx in range(7):
            vals[idx] *= scale
    vals[7] = max(vals[7], 0.25)
    return vals


def _clamp_dialogue_alpha(role: str, value, *, style_audio: bool = False) -> float:
    try:
        alpha = float(value)
    except (TypeError, ValueError):
        alpha = 0.55
    if role == "旁白":
        return max(0.12, min(0.25, alpha))
    if style_audio:
        # 情色/亲密的质感全在声腔参考音频里；让它真正盖上去，而不是只贴一半。
        # 上限为“做爱感”抬高，但仍 <1.0 以保住角色本身音色。A/B 时再细调。
        return max(0.32, min(0.78, alpha))
    return max(0.20, min(0.62, alpha))


async def _run_dialogue_inference_to_job(job: "_LiveStreamingJob", prepared: dict):
    """Background worker: runs dialogue inference, writes PCM to job.pcm,
    saves the complete WAV to snapshot_cache on finish. Survives client
    disconnects — no GET in flight is required."""
    job.metrics["state"] = "queued"
    job.metrics["phase"] = "created"
    job.metrics["message"] = "任务已创建，等待后端处理"
    job.metrics["parse_mode"] = prepared.get("parse_mode") or (prepared.get("req") or {}).get("parse_mode") or "ai"
    try:
        if prepared.get("needs_parse"):
            job.metrics["state"] = "parsing"
            job.metrics["phase"] = "llm_parse"
            job.metrics["message"] = "后端正在分析文本"
            segments = await _parse_dialogue_text_in_backend(prepared, job)
            _attach_dialogue_segments_to_prepared(prepared, segments)
            if job.cancelled:
                _mark_job_cancelled(job)
                return

        lock_wait_started = time.perf_counter()
        job.metrics["state"] = "queued"
        job.metrics["phase"] = "tts_queue"
        job.metrics["message"] = "文本已拆分，等待 TTS 合成"
        async with tts_stream_lock:
            if job.cancelled:
                _mark_job_cancelled(job)
                return
            job.metrics["state"] = "running"
            job.metrics["phase"] = "tts"
            job.metrics["message"] = "正在合成音频"
            job.metrics["lock_wait_s"] = round(time.perf_counter() - lock_wait_started, 3)
            from indextts.llm_proxy import _normalize_role
            segments = prepared["segments"]
            role_voice_paths = prepared["role_voice_paths"]
            default_path = prepared["default_path"]
            sampling_kwargs = prepared["sampling_kwargs"]
            interval_ms = prepared["interval_ms"]
            default_emo_alpha = prepared["default_emo_alpha"]
            job.metrics["segments_total"] = len([s for s in segments if (s.get("text") or "").strip()])
            job.metrics["performance_mode"] = sampling_kwargs.get("performance_mode")
            job.metrics["diffusion_steps"] = sampling_kwargs.get("diffusion_steps")
            job.metrics["s2mel_cfg_rate"] = sampling_kwargs.get("s2mel_cfg_rate", 0.7)
            job.metrics["prompt_audio_seconds"] = sampling_kwargs.get("max_prompt_audio_seconds")
            job.metrics["segment_tokens"] = sampling_kwargs.get("max_text_tokens_per_sentence")
            job.metrics["first_tokens"] = sampling_kwargs.get("quick_streaming_tokens")

            async def on_chunk(chunk_wav, sr, seg_idx, total_segments):
                if job.cancelled:
                    return
                pcm = _chunk_to_pcm_bytes(chunk_wav)
                job.sample_rate = sr
                job.pcm.extend(pcm)
                if pcm and job.metrics.get("first_pcm_s") is None:
                    job.metrics["first_pcm_s"] = round(time.perf_counter() - job._perf_created, 3)

            for idx, seg in enumerate(segments):
                if job.cancelled:
                    _mark_job_cancelled(job)
                    return
                role = _normalize_role(seg.get("role") or "")
                text = (seg.get("text") or "").strip()
                if not text:
                    continue
                voice_path = role_voice_paths.get(role) or default_path
                if not voice_path:
                    continue

                emo_vec = seg.get("emo_vec") or None
                emo_text_seg = seg.get("emo_text") or None
                style_audio = _resolve_segment_style_audio(seg)
                seg_alpha = seg.get("emo_alpha")
                seg_alpha = float(seg_alpha) if seg_alpha is not None else default_emo_alpha
                style_alpha = seg.get("style_alpha")
                if style_audio and style_alpha is not None:
                    seg_alpha = float(style_alpha)
                seg_alpha = _clamp_dialogue_alpha(role, seg_alpha, style_audio=bool(style_audio))
                emo_vec = _stabilize_dialogue_emo_vec(role, emo_vec)
                if role == "旁白":
                    emo_text_seg = None
                use_emo_text_seg = False
                if style_audio:
                    emo_vec = None
                    emo_text_seg = None
                elif emo_vec:
                    emo_text_seg = None
                elif emo_text_seg:
                    use_emo_text_seg = True

                # 段间静音
                if idx > 0 and interval_ms > 0:
                    silence = _silence_pcm_bytes(job.sample_rate, interval_ms)
                    job.pcm.extend(silence)

                seg_start_offset = len(job.pcm)
                seg_started = time.perf_counter()
                await tts_pipeline.infer(
                    spk_audio_prompt=voice_path,
                    emo_audio_prompt=style_audio,
                    text=text,
                    emo_text=emo_text_seg,
                    use_emo_text=use_emo_text_seg,
                    emo_alpha=seg_alpha,
                    emo_vector=emo_vec,
                    output_path=None,
                    stream_chunk_callback=on_chunk,
                    **sampling_kwargs,
                )
                infer_stats = dict(getattr(tts_pipeline, "last_infer_stats", {}) or {})
                if job.cancelled:
                    _mark_job_cancelled(job)
                    return
                seg_wall = time.perf_counter() - seg_started
                seg_byte_count = len(job.pcm) - seg_start_offset
                seg_duration = seg_byte_count / (job.sample_rate * 2) if job.sample_rate else 0.0
                seg_rtf = (seg_wall / seg_duration) if seg_duration > 0 else None
                seg_metric = {
                    "idx": idx,
                    "role": role,
                    "style": _segment_style_name(seg) or "neutral",
                    "text_len": len(text),
                    "wall_s": round(seg_wall, 3),
                    "duration_s": round(seg_duration, 3),
                    "rtf": round(seg_rtf, 3) if seg_rtf is not None else None,
                    "pcm_bytes": seg_byte_count,
                    "uses_style_audio": bool(style_audio),
                    "spk_cache_hit": bool(infer_stats.get("spk_cache_hit")),
                    "emo_cache_hit": bool(infer_stats.get("emo_cache_hit")),
                    "spk_condition_s": float(infer_stats.get("spk_condition_s") or 0.0),
                    "emo_condition_s": float(infer_stats.get("emo_condition_s") or 0.0),
                    "gpt_gen_s": float(infer_stats.get("gpt_gen_s") or 0.0),
                    "gpt_forward_s": float(infer_stats.get("gpt_forward_s") or 0.0),
                    "s2mel_s": float(infer_stats.get("s2mel_s") or 0.0),
                    "bigvgan_s": float(infer_stats.get("bigvgan_s") or 0.0),
                    "infer_rtf": infer_stats.get("rtf"),
                    "sentence_count": infer_stats.get("sentence_count"),
                    "text_token_count": infer_stats.get("text_token_count"),
                }
                job.segments_meta.append({
                    "idx": idx,
                    "role": role,
                    "text": text,
                    "style": _segment_style_name(seg) or "neutral",
                    "style_alpha": seg_alpha if style_audio else None,
                    "style_audio": style_audio,
                    "sample_rate": job.sample_rate,
                    "start_offset_bytes": seg_start_offset,
                    "start_s": (seg_start_offset / (job.sample_rate * 2)) if job.sample_rate else 0.0,
                    "duration_s": seg_duration,
                    "rtf": seg_metric["rtf"],
                    "wall_s": seg_metric["wall_s"],
                })
                job.metrics["segments"].append(seg_metric)
                job.metrics["segments_done"] = len(job.segments_meta)
                for stage_key in ("gpt_gen_s", "gpt_forward_s", "s2mel_s", "bigvgan_s", "spk_condition_s", "emo_condition_s"):
                    job.metrics[stage_key] = round(sum(float(s.get(stage_key) or 0.0) for s in job.metrics["segments"]), 3)
                job.metrics["condition_s"] = round(float(job.metrics["spk_condition_s"] or 0.0) + float(job.metrics["emo_condition_s"] or 0.0), 3)
                job.metrics["audio_duration_s"] = round(len(job.pcm) / (job.sample_rate * 2), 3) if job.sample_rate else 0.0
                total_audio = float(job.metrics["audio_duration_s"] or 0.0)
                total_wall = sum(float(s.get("wall_s") or 0.0) for s in job.metrics["segments"])
                job.metrics["segments_wall_s"] = round(total_wall, 3)
                job.metrics["rtf"] = round(total_wall / total_audio, 3) if total_audio > 0 else None

        # Inference 完成 → 写完整 WAV 到 snapshot_cache，未来 /cache_audio/{key}
        # 可直接给 FileResponse（含 Content-Length，移动端可 seek）。
        try:
            if job.cancelled:
                _mark_job_cancelled(job)
                return
            from indextts import snapshot_cache
            cache_write_started = time.perf_counter()
            wav_full = _make_complete_wav_bytes(bytes(job.pcm), job.sample_rate)
            audio_duration = len(job.pcm) / (job.sample_rate * 2) if job.sample_rate else 0
            job.metrics["audio_duration_s"] = round(audio_duration, 3)
            job.metrics["total_wall_s"] = round(time.perf_counter() - job._perf_created, 3)
            total_segment_wall = sum(float(s.get("wall_s") or 0.0) for s in job.metrics["segments"])
            job.metrics["segments_wall_s"] = round(total_segment_wall, 3)
            job.metrics["rtf"] = round(total_segment_wall / audio_duration, 3) if audio_duration > 0 else None
            job.metrics["wall_rtf"] = round(float(job.metrics["total_wall_s"] or 0.0) / audio_duration, 3) if audio_duration > 0 else None
            job.metrics["state"] = "saving"
            job.metrics["phase"] = "saving"
            job.metrics["message"] = "音频合成完成，正在保存缓存"
            metadata = {
                "kind": "tts_dialogue_stream_v1",
                "segments_meta": job.segments_meta,
                "sample_rate": job.sample_rate,
                "duration_s": audio_duration,
            }
            snapshot_cache.save_cached_audio(job.cache_key, wav_full, metadata)
            job.metrics["cache_write_s"] = round(time.perf_counter() - cache_write_started, 3)
            job.metrics["state"] = "done"
            job.metrics["phase"] = "done"
            job.metrics["message"] = "音频已保存"
            _, json_path = snapshot_cache.cache_paths(job.cache_key)
            saved_metadata = snapshot_cache._read_metadata(json_path)
            saved_metadata["metrics"] = job.metrics
            snapshot_cache._write_json_atomic(json_path, saved_metadata)
            snapshot_cache.prune_cache(max_items=5000)
        except Exception:
            traceback.print_exc()
    except Exception as e:
        if job.cancelled:
            _mark_job_cancelled(job)
            return
        job.error = str(e)
        job.metrics["state"] = "failed"
        if job.metrics.get("phase") == "llm_parse" or job.metrics.get("state") == "parsing":
            job.metrics["phase"] = "llm_parse_failed"
            job.metrics["message"] = "后端 LLM 拆段失败"
        else:
            job.metrics["phase"] = "failed"
            job.metrics["message"] = "后端生成失败"
        job.metrics["error"] = str(e)
        job.metrics["total_wall_s"] = round(time.perf_counter() - job._perf_created, 3)
        traceback.print_exc()
    finally:
        job.finished.set()
        _gc_live_job(job.cache_key, expected_job=job)


def _prune_stream_jobs():
    now = time.time()
    for job_id, item in list(STREAM_JOBS.items()):
        if item.get("expires_at", 0) < now:
            STREAM_JOBS.pop(job_id, None)


def _wav_streaming_header(sample_rate: int, channels: int = 1, bits: int = 16) -> bytes:
    # WAV header with size fields set to 0xFFFFFFFF, signalling "unknown" to
    # the decoder. HTML5 <audio> and most chunked-WAV consumers accept this
    # and start playback as bytes arrive (seek bar will be broken).
    byte_rate = sample_rate * channels * bits // 8
    block_align = channels * bits // 8
    UNKNOWN = 0xFFFFFFFF
    return (
        b"RIFF"
        + UNKNOWN.to_bytes(4, "little")
        + b"WAVE"
        + b"fmt "
        + (16).to_bytes(4, "little")
        + (1).to_bytes(2, "little")  # PCM
        + channels.to_bytes(2, "little")
        + sample_rate.to_bytes(4, "little")
        + byte_rate.to_bytes(4, "little")
        + block_align.to_bytes(2, "little")
        + bits.to_bytes(2, "little")
        + b"data"
        + UNKNOWN.to_bytes(4, "little")
    )


def _wav_file_header(data_bytes_len: int, sample_rate: int, channels: int = 1, bits: int = 16) -> bytes:
    byte_rate = sample_rate * channels * bits // 8
    block_align = channels * bits // 8
    data_bytes_len = max(0, int(data_bytes_len))
    riff_size = 36 + data_bytes_len
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
        + data_bytes_len.to_bytes(4, "little")
    )


def _chunk_to_pcm_bytes(chunk_wav) -> bytes:
    # Some IndexTTS paths return float audio in [-1, 1], while the vLLM path
    # returns already-scaled int16 amplitude stored in a float tensor. Scaling
    # the latter again causes hard clipping and audible crackle.
    if chunk_wav.dim() == 2:
        wav = chunk_wav[0] if chunk_wav.shape[0] == 1 else chunk_wav.mean(dim=0)
    else:
        wav = chunk_wav
    wav = wav.detach().cpu()
    if wav.numel() and float(wav.abs().max()) > 2.0:
        wav_int16 = wav.clamp(-32767.0, 32767.0).to(torch.int16)
    else:
        wav_int16 = (wav.clamp(-1.0, 1.0) * 32767.0).to(torch.int16)
    return wav_int16.numpy().tobytes()


def _silence_pcm_bytes(sample_rate: int, ms: int, channels: int = 1) -> bytes:
    # Generate int16 silence PCM for inserting between dialogue segments.
    n_samples = max(0, int(sample_rate * ms / 1000))
    return b"\x00" * (n_samples * channels * 2)


def _resolve_voice(name_or_path: str) -> Optional[str]:
    # Resolve a voice reference. Order:
    #   1. If it exists as a filesystem path, use it directly.
    #   2. Otherwise look it up in indextts.voice_library (which Codex owns).
    # voice_library is optional — if the module isn't shipped yet, only direct
    # paths work and the caller will see "voices unresolved" for names.
    if not name_or_path:
        return None
    if os.path.exists(name_or_path):
        return name_or_path
    try:
        from indextts import voice_library  # provided by Codex on VLLM branch
        path = voice_library.get_voice_path(name_or_path)
        if path and os.path.exists(path):
            return path
    except ImportError:
        pass
    return None


def _resolve_ref_audio(req: dict):
    ref = req.get("ref_audio_path", "")
    resolved = _resolve_voice(ref)
    if not resolved:
        return JSONResponse(
            status_code=400,
            content={"message": "ref_audio_path not found", "ref_audio_path": ref},
        )
    req["ref_audio_path"] = resolved
    return None


STYLE_VOICE_MAP = {
    "neutral": "",
    "none": "",
    "breath_soft": "声腔/breath_soft",
    "breath_heavy": "声腔/breath_heavy",
    "intimate_breath": "声腔/intimate_breath",
    "moan_soft": "声腔/moan_soft",
    "low_murmur": "声腔/low_murmur",
    "whisper_soft": "声腔/whisper_soft",
    "shy_whisper": "声腔/shy_whisper",
    "tense_breath": "声腔/tense_breath",
    "sob_soft": "声腔/sob_soft",
    "cry_soft": "声腔/cry_soft",
    "tease_soft": "声腔/tease_soft",
    "laugh_soft": "声腔/laugh_soft",
    "gasp_surprise": "声腔/gasp_surprise",
    "scream_peak": "声腔/scream_peak",
    "stage_warmup": "声腔/breath_soft",
    "stage_rising": "声腔/intimate_breath",
    "stage_peak": "声腔/scream_peak",
    "stage_afterglow": "声腔/low_murmur",
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


def _segment_style_name(seg: dict) -> str:
    return str(seg.get("style") or seg.get("style_ref") or "").strip()


def _resolve_segment_style_audio(seg: dict) -> Optional[str]:
    ref = str(seg.get("emo_ref_audio_path") or "").strip()
    if ref:
        return _resolve_voice(ref)
    style = _segment_style_name(seg)
    if not style or style in ("neutral", "none"):
        return None
    mapped = STYLE_VOICE_MAP.get(style, style)
    if not mapped:
        return None
    return _resolve_voice(mapped)


def _style_cache_fragment(seg: dict) -> dict:
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


def _audio_file_meta(path: str) -> dict:
    try:
        st = os.stat(path)
        return {"size": st.st_size, "mtime": int(st.st_mtime)}
    except OSError:
        return {}


def _single_tts_cache_payload(req: dict) -> dict:
    ref_path = req.get("ref_audio_path", "")
    return {
        "kind": "tts_stream_v1",
        "text": req.get("text", ""),
        "ref_audio_path": ref_path,
        "ref_meta": _audio_file_meta(ref_path),
        "emo_text": req.get("emo_text") or "",
        "emo_ref_audio_path": req.get("emo_ref_audio_path") or "",
        "emo_vec": req.get("emo_vec") or [],
        "normalize_emo_vec": bool(req.get("normalize_emo_vec", False)),
        "top_k": int(req.get("top_k", 30)),
        "top_p": float(req.get("top_p", 0.8)),
        "temperature": float(req.get("temperature", 0.7)),
        "emo_alpha": float(req.get("emo_alpha", 0.55)),
        "repetition_penalty": float(req.get("repetition_penalty", 1.2)),
        "diffusion_steps": int(req.get("diffusion_steps") or 0),
        "prompt_audio_seconds": float(req.get("prompt_audio_seconds") or 0),
        "segment_tokens": int(req.get("segment_tokens") or 0),
        "first_tokens": int(req.get("first_tokens") or 0),
    }


def handle_control(command: str):
    if command == "restart":
        os.execl(sys.executable, sys.executable, *argv)
    elif command == "exit":
        os.kill(os.getpid(), signal.SIGTERM)
        exit(0)
def check_params(req: dict):
    text: str = req.get("text", "")
    ref_audio_path: str = req.get("ref_audio_path", "")
    if ref_audio_path in [None, ""]:
        return JSONResponse(status_code=400, content={"message": "ref_audio_path is required"})
    if text in [None, ""]:
        return JSONResponse(status_code=400, content={"message": "text is required"})
    return None


async def tts_handle(req: dict):
    check_res = check_params(req)
    if check_res is not None:
        return check_res
    resolve_res = _resolve_ref_audio(req)
    if resolve_res is not None:
        return resolve_res
    try:
        emo_text = req["emo_text"]
        use_emo_text = bool(req["emo_text"])
        if emo_text == 'auto':
            emo_text = None
            use_emo_text = True
        emo_vec = req["emo_vec"]
        if len(emo_vec) == 0:
            emo_vec = None
        else:
            use_emo_text = False
            emo_text = None
            if req["normalize_emo_vec"]:
                emo_vec = tts_pipeline.normalize_emo_vec(emo_vec)
        sampling_rate, wav_data = await tts_pipeline.infer(
            spk_audio_prompt=req["ref_audio_path"],
            emo_audio_prompt=req["emo_ref_audio_path"] if req["emo_ref_audio_path"] else None,
            text=req["text"],
            emo_text=emo_text,
            use_emo_text=use_emo_text,
            emo_alpha=req["emo_alpha"],
            emo_vector=emo_vec,
            top_p=req["top_p"],
            top_k=req["top_k"],
            temperature=req["temperature"],
            repetition_penalty=req["repetition_penalty"],
            output_path=None,
            **_apply_s2mel_test_overrides(req, {}),
        )
        return Response(pack_wav(BytesIO(), wav_data, sampling_rate).getvalue(), media_type=f"audio/wav")
    except Exception as e:
        print("Error:", e)
        traceback.print_exc()
        return JSONResponse(status_code=400, content={"message": "tts failed", "Exception": str(e)})


async def tts_stream_handle(req: dict):
    """Phase 1 streaming endpoint for TAVO regex playback.

    Returns audio/wav with chunked transfer. The first byte is sent as soon
    as the first segment finishes decoding, so HTML5 <audio> can start
    playing while the rest is still being generated.
    """
    check_res = check_params(req)
    if check_res is not None:
        return check_res
    resolve_res = _resolve_ref_audio(req)
    if resolve_res is not None:
        return resolve_res

    queue: asyncio.Queue = asyncio.Queue(maxsize=64)
    SENTINEL = object()
    sample_rate_holder = {"sr": None}
    error_holder = {"exc": None}

    async def on_chunk(chunk_wav, sr, seg_idx, total_segments):
        sample_rate_holder["sr"] = sr
        await queue.put(_chunk_to_pcm_bytes(chunk_wav))

    async def run_infer():
        try:
            async with tts_stream_lock:
                emo_text = req.get("emo_text")
                use_emo_text = bool(emo_text)
                if emo_text == "auto":
                    emo_text = None
                    use_emo_text = True
                emo_vec = req.get("emo_vec") or []
                if not emo_vec:
                    emo_vec = None
                else:
                    use_emo_text = False
                    emo_text = None
                    if req.get("normalize_emo_vec"):
                        emo_vec = tts_pipeline.normalize_emo_vec(emo_vec)

                await tts_pipeline.infer(
                    spk_audio_prompt=req["ref_audio_path"],
                    emo_audio_prompt=req.get("emo_ref_audio_path") or None,
                    text=req["text"],
                    emo_text=emo_text,
                    use_emo_text=use_emo_text,
                    emo_alpha=float(req.get("emo_alpha", 0.55)),
                    emo_vector=emo_vec,
                    top_p=float(req.get("top_p", 0.8)),
                    top_k=int(req.get("top_k", 30)),
                    temperature=float(req.get("temperature", 0.7)),
                    repetition_penalty=float(req.get("repetition_penalty", 1.2)),
                    output_path=None,
                    stream_chunk_callback=on_chunk,
                    **_apply_s2mel_test_overrides(req, _stream_infer_kwargs()),
                )
        except Exception as e:
            error_holder["exc"] = e
            traceback.print_exc()
        finally:
            await queue.put(SENTINEL)

    async def stream_generator():
        infer_task = asyncio.create_task(run_infer())
        try:
            first = await queue.get()
            if first is SENTINEL:
                # Inference produced zero chunks (e.g. invalid input).
                # Emit a tiny silent WAV so the client doesn't see a
                # 200 with empty body, which some players interpret as
                # broken audio.
                yield _wav_streaming_header(22050, channels=1, bits=16)
                return

            sr = sample_rate_holder["sr"] or 22050
            yield _wav_streaming_header(sr, channels=1, bits=16)
            yield first
            while True:
                chunk = await queue.get()
                if chunk is SENTINEL:
                    break
                yield chunk
        finally:
            # Make sure the inference task is awaited so exceptions surface
            # and the lock is released even on client disconnect.
            try:
                await infer_task
            except Exception:
                pass

    return StreamingResponse(stream_generator(), media_type="audio/wav")


async def tts_cache_stream_handle(req: dict):
    """Single-segment streaming endpoint with file-backed snapshot caching."""
    check_res = check_params(req)
    if check_res is not None:
        return check_res
    resolve_res = _resolve_ref_audio(req)
    if resolve_res is not None:
        return resolve_res

    from indextts import snapshot_cache

    payload = _single_tts_cache_payload(req)
    cache_key = snapshot_cache.make_cache_key(payload)
    bypass_cache = bool(req.get("bypass_cache", False))
    cached_path = None if bypass_cache else snapshot_cache.get_cached_audio(cache_key)
    if cached_path:
        return FileResponse(
            cached_path,
            media_type="audio/wav",
            headers={"X-IndexTTS-Cache": "HIT", "X-IndexTTS-Cache-Key": cache_key},
        )

    queue: asyncio.Queue = asyncio.Queue(maxsize=64)
    SENTINEL = object()
    sample_rate_holder = {"sr": None}
    error_holder = {"exc": None}
    pcm_chunks = []

    async def on_chunk(chunk_wav, sr, seg_idx, total_segments):
        pcm = _chunk_to_pcm_bytes(chunk_wav)
        sample_rate_holder["sr"] = sr
        pcm_chunks.append(pcm)
        await queue.put(pcm)

    async def run_infer():
        try:
            async with tts_stream_lock:
                emo_text = req.get("emo_text")
                use_emo_text = bool(emo_text)
                if emo_text == "auto":
                    emo_text = None
                    use_emo_text = True
                emo_vec = req.get("emo_vec") or []
                if not emo_vec:
                    emo_vec = None
                else:
                    use_emo_text = False
                    emo_text = None
                    if req.get("normalize_emo_vec"):
                        emo_vec = tts_pipeline.normalize_emo_vec(emo_vec)

                await tts_pipeline.infer(
                    spk_audio_prompt=req["ref_audio_path"],
                    emo_audio_prompt=req.get("emo_ref_audio_path") or None,
                    text=req["text"],
                    emo_text=emo_text,
                    use_emo_text=use_emo_text,
                    emo_alpha=float(req.get("emo_alpha", 0.55)),
                    emo_vector=emo_vec,
                    top_p=float(req.get("top_p", 0.8)),
                    top_k=int(req.get("top_k", 30)),
                    temperature=float(req.get("temperature", 0.7)),
                    repetition_penalty=float(req.get("repetition_penalty", 1.2)),
                    output_path=None,
                    stream_chunk_callback=on_chunk,
                    **_apply_s2mel_test_overrides(req, _stream_infer_kwargs()),
                )
        except Exception as e:
            error_holder["exc"] = e
            traceback.print_exc()
        finally:
            await queue.put(SENTINEL)

    async def stream_generator():
        infer_task = asyncio.create_task(run_infer())
        try:
            first = await queue.get()
            if first is SENTINEL:
                yield _wav_streaming_header(22050, channels=1, bits=16)
                return

            sr = sample_rate_holder["sr"] or 22050
            yield _wav_streaming_header(sr, channels=1, bits=16)
            yield first
            while True:
                chunk = await queue.get()
                if chunk is SENTINEL:
                    break
                yield chunk
        finally:
            try:
                await infer_task
            except Exception:
                pass
            if error_holder["exc"] is None and pcm_chunks and sample_rate_holder["sr"]:
                pcm = b"".join(pcm_chunks)
                wav_bytes = _wav_file_header(len(pcm), sample_rate_holder["sr"]) + pcm
                metadata = {
                    "text_preview": (req.get("text") or "")[:120],
                    "ref_audio_path": req.get("ref_audio_path", ""),
                    "params": payload,
                }
                try:
                    snapshot_cache.save_cached_audio(cache_key, wav_bytes, metadata)
                    snapshot_cache.prune_cache(max_items=5000)
                except Exception:
                    traceback.print_exc()

    return StreamingResponse(
        stream_generator(),
        media_type="audio/wav",
        headers={
            "X-IndexTTS-Cache": "BYPASS" if bypass_cache else "MISS",
            "X-IndexTTS-Cache-Key": cache_key,
        },
    )


async def tts_dialogue_stream_handle(req: dict):
    """Phase 2: multi-segment streaming for narrator + character dialogue.

    Caller provides pre-parsed segments (typically the output of a 3rd-party
    LLM call done client-side) along with a role->voice mapping. Each segment
    is inferred in order; chunks are streamed as they arrive; silence is
    inserted between segments.

    Voice references can be either a voice library name (resolved via
    indextts.voice_library, owned by Codex on the VLLM branch) or a direct
    filesystem path. Missing voices are reported up-front with a 400 so the
    client doesn't get half a stream and then an error.
    """
    segments = req.get("segments") or []
    voices = req.get("voices") or {}
    if not segments:
        return JSONResponse(status_code=400, content={"message": "segments is required"})
    if not voices:
        return JSONResponse(status_code=400, content={"message": "voices is required"})

    # Normalize voice-mapping keys so users can write either canonical or alias
    # forms (e.g. "用户=高圆圆", "narrator=Jok", "旁白=Jok").
    from indextts.llm_proxy import _normalize_role
    voices = {(_normalize_role(k) if k != "default" else "default"): v for k, v in voices.items()}

    # Pre-resolve every role -> voice path. Detect missing up-front.
    default_path = _resolve_voice(voices.get("default", ""))
    role_voice_paths: Dict[str, str] = {}
    unresolved_roles: List[str] = []
    seen_roles = set()
    for seg in segments:
        role = _normalize_role(seg.get("role") or "")
        if not role or role in seen_roles:
            seen_roles.add(role)
            continue
        seen_roles.add(role)
        path = _resolve_voice(voices.get(role, "")) or default_path
        if not path:
            unresolved_roles.append(role)
        else:
            role_voice_paths[role] = path
    if unresolved_roles:
        return JSONResponse(
            status_code=400,
            content={
                "message": "voices unresolved for these roles (provide them in `voices` or set a `default`)",
                "roles": unresolved_roles,
            },
        )

    interval_ms = int(req.get("interval_ms", 350))
    default_emo_alpha = float(req.get("emo_alpha", 0.55))
    performance_mode = str(req.get("performance_mode") or "expressive").strip().lower()
    sampling_kwargs = {
        "top_p": float(req.get("top_p", 0.8)),
        "top_k": int(req.get("top_k", 30)),
        "temperature": float(req.get("temperature", 0.7)),
        "repetition_penalty": float(req.get("repetition_penalty", 1.2)),
        **_stream_infer_kwargs(performance_mode=performance_mode),
    }
    sampling_kwargs = _apply_s2mel_test_overrides(req, sampling_kwargs)

    queue: asyncio.Queue = asyncio.Queue(maxsize=64)
    SENTINEL = object()
    sample_rate_holder = {"sr": None}

    async def on_chunk(chunk_wav, sr, seg_idx, total_segments):
        sample_rate_holder["sr"] = sr
        await queue.put(_chunk_to_pcm_bytes(chunk_wav))

    async def run_infer():
        try:
            async with tts_stream_lock:
                for idx, seg in enumerate(segments):
                    role = _normalize_role(seg.get("role") or "")
                    text = (seg.get("text") or "").strip()
                    if not text:
                        continue
                    voice_path = role_voice_paths.get(role) or default_path
                    if not voice_path:
                        # Should be unreachable: caught up-front, but be safe.
                        continue

                    emo_vec = seg.get("emo_vec") or None
                    emo_text_seg = seg.get("emo_text") or None
                    style_audio = _resolve_segment_style_audio(seg)
                    seg_alpha = seg.get("emo_alpha")
                    seg_alpha = float(seg_alpha) if seg_alpha is not None else default_emo_alpha
                    style_alpha = seg.get("style_alpha")
                    if style_audio and style_alpha is not None:
                        seg_alpha = float(style_alpha)
                    seg_alpha = _clamp_dialogue_alpha(role, seg_alpha, style_audio=bool(style_audio))
                    emo_vec = _stabilize_dialogue_emo_vec(role, emo_vec)
                    if role == "旁白":
                        emo_text_seg = None
                    # emo_vec wins when both are present; matches the V26
                    # convention and the LLM-output schema we recommend.
                    if style_audio:
                        emo_vec = None
                        emo_text_seg = None
                        use_emo_text_seg = False
                    elif emo_vec:
                        emo_text_seg = None
                        use_emo_text_seg = False
                    else:
                        use_emo_text_seg = bool(emo_text_seg)

                    # Inter-segment silence. Sample rate is known after the
                    # first chunk arrived, so only insert from idx>=1 onward.
                    if idx > 0 and sample_rate_holder["sr"]:
                        await queue.put(
                            _silence_pcm_bytes(sample_rate_holder["sr"], interval_ms)
                        )

                    await tts_pipeline.infer(
                        spk_audio_prompt=voice_path,
                        emo_audio_prompt=style_audio,
                        text=text,
                        emo_text=emo_text_seg,
                        use_emo_text=use_emo_text_seg,
                        emo_alpha=seg_alpha,
                        emo_vector=emo_vec,
                        output_path=None,
                        stream_chunk_callback=on_chunk,
                        **sampling_kwargs,
                    )
        except Exception:
            traceback.print_exc()
        finally:
            await queue.put(SENTINEL)

    async def stream_generator():
        infer_task = asyncio.create_task(run_infer())
        try:
            first = await queue.get()
            if first is SENTINEL:
                yield _wav_streaming_header(22050, channels=1, bits=16)
                return
            sr = sample_rate_holder["sr"] or 22050
            yield _wav_streaming_header(sr, channels=1, bits=16)
            yield first
            while True:
                chunk = await queue.get()
                if chunk is SENTINEL:
                    break
                yield chunk
        finally:
            try:
                await infer_task
            except Exception:
                pass

    return StreamingResponse(stream_generator(), media_type="audio/wav")


async def tts_dialogue_cache_stream_handle(req: dict):
    """Multi-role dialogue streaming with whole-dialogue file cache."""
    segments = req.get("segments") or []
    voices = req.get("voices") or {}
    if not segments:
        return JSONResponse(status_code=400, content={"message": "segments is required"})
    if not voices:
        return JSONResponse(status_code=400, content={"message": "voices is required"})

    # Normalize voice-mapping keys so users can write either canonical or alias
    # forms (e.g. "用户=高圆圆", "narrator=Jok", "旁白=Jok").
    from indextts.llm_proxy import _normalize_role
    voices = {(_normalize_role(k) if k != "default" else "default"): v for k, v in voices.items()}

    default_path = _resolve_voice(voices.get("default", ""))
    role_voice_paths: Dict[str, str] = {}
    unresolved_roles: List[str] = []
    seen_roles = set()
    for seg in segments:
        role = _normalize_role(seg.get("role") or "")
        if not role or role in seen_roles:
            seen_roles.add(role)
            continue
        seen_roles.add(role)
        path = _resolve_voice(voices.get(role, "")) or default_path
        if not path:
            unresolved_roles.append(role)
        else:
            role_voice_paths[role] = path
    if unresolved_roles:
        return JSONResponse(
            status_code=400,
            content={
                "message": "voices unresolved for these roles (provide them in `voices` or set a `default`)",
                "roles": unresolved_roles,
            },
        )

    from indextts import snapshot_cache

    interval_ms = int(req.get("interval_ms", 350))
    default_emo_alpha = float(req.get("emo_alpha", 0.55))
    performance_mode = str(req.get("performance_mode") or "expressive").strip().lower()
    sampling_kwargs = {
        "top_p": float(req.get("top_p", 0.8)),
        "top_k": int(req.get("top_k", 30)),
        "temperature": float(req.get("temperature", 0.7)),
        "repetition_penalty": float(req.get("repetition_penalty", 1.2)),
        **_stream_infer_kwargs(performance_mode=performance_mode),
    }
    sampling_kwargs = _apply_s2mel_test_overrides(req, sampling_kwargs)
    role_payload = {
        role: {"path": path, "meta": _audio_file_meta(path)}
        for role, path in sorted(role_voice_paths.items())
    }
    cache_payload = {
        "kind": "tts_dialogue_stream_v1",
        "segments": [
            {
                "role": (seg.get("role") or "").strip(),
                "text": (seg.get("text") or "").strip(),
                **_style_cache_fragment(seg),
                "emo_vec": seg.get("emo_vec") or None,
                "emo_text": seg.get("emo_text") or None,
                "emo_alpha": seg.get("emo_alpha"),
            }
            for seg in segments
        ],
        "voices": role_payload,
        "default_voice": {"path": default_path, "meta": _audio_file_meta(default_path)} if default_path else None,
        "interval_ms": interval_ms,
        "emo_alpha": default_emo_alpha,
        **sampling_kwargs,
    }
    cache_nonce = str(req.get("cache_nonce") or "").strip()
    if cache_nonce:
        cache_payload["cache_nonce"] = cache_nonce
    cache_key = snapshot_cache.make_cache_key(cache_payload)
    cached_path = snapshot_cache.get_cached_audio(cache_key)
    if cached_path:
        return FileResponse(
            cached_path,
            media_type="audio/wav",
            headers={"X-IndexTTS-Cache": "HIT", "X-IndexTTS-Cache-Key": cache_key},
        )

    queue: asyncio.Queue = asyncio.Queue(maxsize=64)
    SENTINEL = object()
    sample_rate_holder = {"sr": None}
    error_holder = {"exc": None}
    pcm_chunks = []

    async def on_chunk(chunk_wav, sr, seg_idx, total_segments):
        pcm = _chunk_to_pcm_bytes(chunk_wav)
        sample_rate_holder["sr"] = sr
        pcm_chunks.append(pcm)
        await queue.put(pcm)

    async def run_infer():
        try:
            async with tts_stream_lock:
                for idx, seg in enumerate(segments):
                    role = _normalize_role(seg.get("role") or "")
                    text = (seg.get("text") or "").strip()
                    if not text:
                        continue
                    voice_path = role_voice_paths.get(role) or default_path
                    if not voice_path:
                        continue

                    emo_vec = seg.get("emo_vec") or None
                    emo_text_seg = seg.get("emo_text") or None
                    style_audio = _resolve_segment_style_audio(seg)
                    seg_alpha = seg.get("emo_alpha")
                    seg_alpha = float(seg_alpha) if seg_alpha is not None else default_emo_alpha
                    style_alpha = seg.get("style_alpha")
                    if style_audio and style_alpha is not None:
                        seg_alpha = float(style_alpha)
                    seg_alpha = _clamp_dialogue_alpha(role, seg_alpha, style_audio=bool(style_audio))
                    emo_vec = _stabilize_dialogue_emo_vec(role, emo_vec)
                    if role == "旁白":
                        emo_text_seg = None
                    if style_audio:
                        emo_vec = None
                        emo_text_seg = None
                        use_emo_text_seg = False
                    elif emo_vec:
                        emo_text_seg = None
                        use_emo_text_seg = False
                    else:
                        use_emo_text_seg = bool(emo_text_seg)

                    if idx > 0 and sample_rate_holder["sr"]:
                        silence = _silence_pcm_bytes(sample_rate_holder["sr"], interval_ms)
                        pcm_chunks.append(silence)
                        await queue.put(silence)

                    await tts_pipeline.infer(
                        spk_audio_prompt=voice_path,
                        emo_audio_prompt=style_audio,
                        text=text,
                        emo_text=emo_text_seg,
                        use_emo_text=use_emo_text_seg,
                        emo_alpha=seg_alpha,
                        emo_vector=emo_vec,
                        output_path=None,
                        stream_chunk_callback=on_chunk,
                        **sampling_kwargs,
                    )
        except Exception as e:
            error_holder["exc"] = e
            traceback.print_exc()
        finally:
            await queue.put(SENTINEL)

    async def stream_generator():
        infer_task = asyncio.create_task(run_infer())
        try:
            first = await queue.get()
            if first is SENTINEL:
                yield _wav_streaming_header(22050, channels=1, bits=16)
                return
            sr = sample_rate_holder["sr"] or 22050
            yield _wav_streaming_header(sr, channels=1, bits=16)
            yield first
            while True:
                chunk = await queue.get()
                if chunk is SENTINEL:
                    break
                yield chunk
        finally:
            try:
                await infer_task
            except Exception:
                pass
            if error_holder["exc"] is None and pcm_chunks and sample_rate_holder["sr"]:
                pcm = b"".join(pcm_chunks)
                wav_bytes = _wav_file_header(len(pcm), sample_rate_holder["sr"]) + pcm
                metadata = {
                    "text_preview": " ".join(
                        (seg.get("text") or "").strip() for seg in segments
                    )[:120],
                    "roles": sorted(role_voice_paths.keys()),
                    "params": cache_payload,
                }
                try:
                    snapshot_cache.save_cached_audio(cache_key, wav_bytes, metadata)
                    snapshot_cache.prune_cache(max_items=5000)
                except Exception:
                    traceback.print_exc()

    return StreamingResponse(
        stream_generator(),
        media_type="audio/wav",
        headers={"X-IndexTTS-Cache": "MISS", "X-IndexTTS-Cache-Key": cache_key},
    )


@APP.get("/control")
async def control(command: str = None):
    if command is None:
        return JSONResponse(status_code=400, content={"message": "command is required"})
    handle_control(command)


@APP.get("/health")
async def health():
    """Lightweight liveness probe for TAVO clients / monitoring."""
    return JSONResponse(content={"status": "ok"})


@APP.get("/diagnostics/perf")
async def perf_diagnostics():
    """Return runtime checks that explain common RTF bottlenecks."""
    pipeline = globals().get("tts_pipeline")
    cl_path = shutil.which("cl")
    nvcc_path = shutil.which("nvcc")
    flashinfer_available = False
    flashinfer_error = None
    try:
        __import__("flashinfer")
        flashinfer_available = True
    except Exception as e:
        flashinfer_error = str(e)

    bigvgan_cuda_active = bool(getattr(pipeline, "use_cuda_kernel", False)) if pipeline is not None else False
    hints = []
    if args.cuda_kernel and not bigvgan_cuda_active:
        if not cl_path:
            hints.append("BigVGAN CUDA kernel requested but disabled because MSVC cl.exe is not visible in PATH.")
        else:
            hints.append("BigVGAN CUDA kernel requested but disabled; check startup traceback for compile failure.")
    if not flashinfer_available:
        hints.append("FlashInfer is not installed; vLLM top-k/top-p sampling uses PyTorch fallback.")

    return JSONResponse(content={
        "bigvgan_cuda_requested": bool(args.cuda_kernel),
        "bigvgan_cuda_active": bigvgan_cuda_active,
        "cl_path": cl_path,
        "nvcc_path": nvcc_path,
        "flashinfer_available": flashinfer_available,
        "flashinfer_error": flashinfer_error,
        "fp16": bool(args.fp16),
        "qwen_emo": bool(args.qwen_emo),
        "device": getattr(pipeline, "device", None) if pipeline is not None else None,
        "hints": hints,
    })


@APP.get("/diagnostics/resource")
async def resource_diagnostics():
    """Return lightweight memory/cache state for 12GB GPU stability checks."""
    pipeline = globals().get("tts_pipeline")
    torch_cuda = {}
    if torch.cuda.is_available():
        try:
            torch_cuda = {
                "allocated_mb": round(torch.cuda.memory_allocated() / 1024 / 1024, 1),
                "reserved_mb": round(torch.cuda.memory_reserved() / 1024 / 1024, 1),
                "max_allocated_mb": round(torch.cuda.max_memory_allocated() / 1024 / 1024, 1),
                "max_reserved_mb": round(torch.cuda.max_memory_reserved() / 1024 / 1024, 1),
            }
        except Exception as e:
            torch_cuda = {"error": str(e)}
    return JSONResponse(content={
        "vllm_gpu_memory_utilization": float(args.vllm_gpu_memory_utilization),
        "vllm_enforce_eager": bool(args.vllm_enforce_eager),
        "fp16": bool(args.fp16),
        "qwen_emo": bool(args.qwen_emo),
        "live_jobs": len(LIVE_JOBS),
        "stream_jobs": len(STREAM_JOBS),
        "spk_condition_cache": {
            "size": len(getattr(pipeline, "spk_condition_cache", {}) or {}) if pipeline is not None else 0,
            "max": getattr(pipeline, "spk_condition_cache_max_items", None) if pipeline is not None else None,
        },
        "emo_condition_cache": {
            "size": len(getattr(pipeline, "emo_condition_cache", {}) or {}) if pipeline is not None else 0,
            "max": getattr(pipeline, "emo_condition_cache_max_items", None) if pipeline is not None else None,
        },
        "torch_cuda": torch_cuda,
    })


@APP.post("/diagnostics/clear_runtime_cache")
async def clear_runtime_cache():
    """Clear non-model runtime caches without unloading model weights."""
    pipeline = globals().get("tts_pipeline")
    cleared = {}
    if pipeline is not None:
        for attr in ("spk_condition_cache", "emo_condition_cache"):
            cache = getattr(pipeline, attr, None)
            if hasattr(cache, "clear"):
                cleared[attr] = len(cache)
                cache.clear()
    if torch.cuda.is_available():
        try:
            torch.cuda.empty_cache()
            torch.cuda.ipc_collect()
        except Exception:
            pass
    return JSONResponse(content={"cleared": cleared})


@APP.get("/cache_audio/{key}")
async def cache_audio_by_key(key: str):
    """Serve a cached audio blob directly by its snapshot cache key.

    Used by the TAVO widget to restore historical generated tracks after
    a page reload: the widget persists {cacheKey, voice, ...} via tavo.set,
    and on next mount turns those keys into <audio src=/cache_audio/{key}>.
    Returns a regular FileResponse with proper Content-Length so mobile
    WebView audio elements can seek / replay.
    """
    try:
        from indextts import snapshot_cache
        path = snapshot_cache.get_cached_audio(key)
        if not path or not os.path.exists(path):
            return JSONResponse(status_code=404, content={"message": "cache miss", "key": key})
        return FileResponse(
            path,
            media_type="audio/wav",
            headers={"X-IndexTTS-Cache": "HIT", "X-IndexTTS-Cache-Key": key},
        )
    except Exception as e:
        traceback.print_exc()
        return JSONResponse(status_code=400, content={"message": "cache audio failed", "Exception": str(e)})


@APP.head("/cache_audio/{key}")
async def cache_audio_by_key_head(key: str):
    """HEAD probe for cached audio.

    Some WebViews/proxies probe media URLs before issuing a ranged GET. Keep
    this endpoint aligned with GET /cache_audio/{key} so a valid cache does
    not look like a 405 failure.
    """
    try:
        from indextts import snapshot_cache
        path = snapshot_cache.get_cached_audio(key)
        if not path or not os.path.exists(path):
            return Response(status_code=404, headers={"X-IndexTTS-Cache": "MISS", "X-IndexTTS-Cache-Key": key})
        return Response(
            status_code=200,
            media_type="audio/wav",
            headers={
                "X-IndexTTS-Cache": "HIT",
                "X-IndexTTS-Cache-Key": key,
                "Accept-Ranges": "bytes",
                "Content-Length": str(os.path.getsize(path)),
            },
        )
    except Exception as e:
        traceback.print_exc()
        return Response(status_code=400, headers={"X-IndexTTS-Error": str(e)})


@APP.get("/server_log/tail")
async def server_log_tail(n: int = 100, since: float = 0.0, filter: Optional[str] = None):
    """Return recent server-side stdout/stderr lines (for the debug overlay).

    Args:
        n: max number of lines to return (default 100).
        since: only return lines newer than this UNIX timestamp.
        filter: if set, only return lines whose text contains this substring
                (case-insensitive). Useful for grabbing just RTF/timing lines.
    """
    items = list(LOG_BUFFER)
    if since:
        items = [e for e in items if e["ts"] > since]
    if filter:
        f = filter.lower()
        items = [e for e in items if f in e["line"].lower()]
    items = items[-max(1, min(n, len(LOG_BUFFER))):]
    return JSONResponse(content={"lines": items, "now": time.time()})


@APP.get("/server_info")
async def server_info():
    """Return user-friendly service addresses for TAVO setup."""
    lan_ip = "127.0.0.1"
    try:
        with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as sock:
            sock.connect(("8.8.8.8", 80))
            lan_ip = sock.getsockname()[0]
    except Exception:
        try:
            lan_ip = socket.gethostbyname(socket.gethostname())
        except Exception:
            lan_ip = "127.0.0.1"
    return JSONResponse(content={
        "status": "ok",
        "port": port,
        "bind_addr": host,
        "local_url": f"http://127.0.0.1:{port}",
        "lan_url": f"http://{lan_ip}:{port}",
        "script_url": f"http://{lan_ip}:{port}/static/tavo.js",
    })


@APP.get("/voices")
async def voices_list_endpoint():
    """List the local voice library stored under prompts/library."""
    try:
        from indextts import voice_library

        return JSONResponse(content={"voices": voice_library.list_voices()})
    except Exception as e:
        traceback.print_exc()
        return JSONResponse(status_code=400, content={"message": "voices list failed", "Exception": str(e)})


@APP.get("/voice_preview")
async def voices_preview_endpoint(name: str):
    """Preview a library voice by name or a direct local audio path."""
    try:
        path = _resolve_voice(name)
        if not path:
            return JSONResponse(status_code=404, content={"message": "voice not found", "name": name})
        return FileResponse(path, media_type="audio/mpeg")
    except Exception as e:
        traceback.print_exc()
        return JSONResponse(status_code=400, content={"message": "voice preview failed", "Exception": str(e)})


@APP.post("/voices")
async def voices_save_endpoint(request: Voice_Save_Request):
    """Save a voice by local file path or base64 audio bytes.

    This stays filesystem-only for the lightweight TAVO flow. No database is
    needed: users can also manage prompts/library directly if they prefer.
    """
    try:
        from indextts import voice_library

        if request.source_path:
            path = voice_library.save_voice_from_path(request.source_path, request.name)
        elif request.audio_base64:
            audio_bytes = base64.b64decode(request.audio_base64)
            path = voice_library.save_voice(audio_bytes, request.name, request.ext)
        else:
            return JSONResponse(
                status_code=400,
                content={"message": "source_path or audio_base64 is required"},
            )
        return JSONResponse(content={"name": voice_library.safe_voice_name(request.name), "path": path})
    except Exception as e:
        traceback.print_exc()
        return JSONResponse(status_code=400, content={"message": "voice save failed", "Exception": str(e)})


@APP.delete("/voices/{name}")
async def voices_delete_endpoint(name: str):
    """Delete one local voice by library name."""
    try:
        from indextts import voice_library

        deleted = voice_library.delete_voice(name)
        return JSONResponse(content={"deleted": deleted, "name": voice_library.safe_voice_name(name)})
    except Exception as e:
        traceback.print_exc()
        return JSONResponse(status_code=400, content={"message": "voice delete failed", "Exception": str(e)})


@APP.get("/profiles")
async def profiles_list_endpoint():
    """List lightweight TAVO profiles from the local SQLite store."""
    try:
        from indextts import profile_store

        return JSONResponse(content={"profiles": profile_store.list_profiles()})
    except Exception as e:
        traceback.print_exc()
        return JSONResponse(status_code=400, content={"message": "profiles list failed", "Exception": str(e)})


@APP.get("/profiles/{name}")
async def profiles_get_endpoint(name: str):
    """Return one lightweight TAVO profile by name."""
    try:
        from indextts import profile_store

        profile = profile_store.get_profile(name)
        if profile is None:
            return JSONResponse(status_code=404, content={"message": "profile not found", "name": name})
        return JSONResponse(content=profile)
    except Exception as e:
        traceback.print_exc()
        return JSONResponse(status_code=400, content={"message": "profile get failed", "Exception": str(e)})


@APP.post("/profiles")
async def profiles_save_endpoint(request: Profile_Save_Request):
    """Save one lightweight TAVO profile to the local SQLite store."""
    try:
        from indextts import profile_store

        profile_id = profile_store.save_profile(request.name, request.data)
        return JSONResponse(content={"id": profile_id, "name": request.name})
    except Exception as e:
        traceback.print_exc()
        return JSONResponse(status_code=400, content={"message": "profile save failed", "Exception": str(e)})


@APP.delete("/profiles/{name}")
async def profiles_delete_endpoint(name: str):
    """Delete one lightweight TAVO profile by name."""
    try:
        from indextts import profile_store

        deleted = profile_store.delete_profile(name)
        return JSONResponse(content={"deleted": deleted, "name": name})
    except Exception as e:
        traceback.print_exc()
        return JSONResponse(status_code=400, content={"message": "profile delete failed", "Exception": str(e)})


@APP.get("/usage")
async def usage_list_endpoint(limit: int = 200):
    """List recent lightweight TAVO usage events from the local SQLite store."""
    try:
        from indextts import profile_store

        return JSONResponse(content={"items": profile_store.list_usage(limit=limit)})
    except Exception as e:
        traceback.print_exc()
        return JSONResponse(status_code=400, content={"message": "usage list failed", "Exception": str(e)})


@APP.post("/usage")
async def usage_append_endpoint(request: Usage_Log_Request):
    """Append one lightweight TAVO usage event to the local SQLite store."""
    try:
        from indextts import profile_store

        usage_id = profile_store.append_usage(request.event_type, request.payload)
        return JSONResponse(content={"id": usage_id, "event_type": request.event_type})
    except Exception as e:
        traceback.print_exc()
        return JSONResponse(status_code=400, content={"message": "usage append failed", "Exception": str(e)})


@APP.post("/parse_text")
async def parse_text_endpoint(request: Parse_Text_Request):
    """Optional server-side OpenAI-compatible LLM proxy for TAVO parsing.

    This is CPU/network only. It does not load models or run TTS inference.
    It exists mainly for browsers/TAVO webviews that cannot call third-party
    LLM endpoints directly because of CORS.
    """
    try:
        from indextts import llm_proxy

        result = await asyncio.to_thread(
            llm_proxy.parse_text_openai_compatible,
            text=request.text,
            endpoint=request.endpoint,
            model=request.model,
            api_key=request.api_key,
            system_prompt=request.system_prompt,
            temperature=request.temperature,
            timeout=request.timeout,
            max_tokens=request.max_tokens,
        )
        return JSONResponse(content=result)
    except Exception as e:
        traceback.print_exc()
        return JSONResponse(status_code=400, content={"message": "parse_text failed", "Exception": str(e)})


@APP.get("/cache")
async def cache_list_endpoint(limit: int = 200):
    """List local TTS snapshot cache metadata."""
    try:
        from indextts import snapshot_cache

        return JSONResponse(content={"items": snapshot_cache.list_cache(limit=limit)})
    except Exception as e:
        traceback.print_exc()
        return JSONResponse(status_code=400, content={"message": "cache list failed", "Exception": str(e)})


@APP.post("/cache/prune")
async def cache_prune_endpoint(request: Cache_Prune_Request):
    """Prune old local TTS snapshots by LRU-ish metadata timestamps."""
    try:
        from indextts import snapshot_cache

        deleted = snapshot_cache.prune_cache(max_items=request.max_items)
        return JSONResponse(content={"deleted": deleted, "max_items": request.max_items})
    except Exception as e:
        traceback.print_exc()
        return JSONResponse(status_code=400, content={"message": "cache prune failed", "Exception": str(e)})


@APP.delete("/cache/{key}")
async def cache_delete_endpoint(key: str):
    """Delete one local TTS snapshot by cache key."""
    try:
        from indextts import snapshot_cache

        live_job = LIVE_JOBS.pop(key, None)
        if live_job:
            live_job.cancelled = True
            live_job.metrics["state"] = "cancelled"
            live_job.finished.set()
        deleted = snapshot_cache.delete_cache(key)
        return JSONResponse(content={"deleted": deleted, "cancelled_live": bool(live_job), "key": key})
    except Exception as e:
        traceback.print_exc()
        return JSONResponse(status_code=400, content={"message": "cache delete failed", "Exception": str(e)})


@APP.delete("/cache_tts_single")
async def cache_delete_single_endpoint(
    text: str = None,
    ref_audio_path: str = None,
    emo_text: str = None,
    emo_ref_audio_path: str = None,
    top_k: int = 30,
    top_p: float = 0.8,
    temperature: float = 0.7,
    emo_alpha: float = 0.55,
    normalize_emo_vec: bool = False,
    repetition_penalty: float = 1.2,
    bypass_cache: bool = False,
):
    """Delete one single-voice TTS snapshot using the same params as /tts_cache_stream."""
    req = {
        "text": text,
        "emo_text": emo_text,
        "ref_audio_path": ref_audio_path,
        "emo_ref_audio_path": emo_ref_audio_path,
        "top_k": top_k,
        "top_p": top_p,
        "temperature": temperature,
        "emo_alpha": float(emo_alpha),
        "emo_vec": [],
        "normalize_emo_vec": normalize_emo_vec,
        "repetition_penalty": float(repetition_penalty),
        "bypass_cache": bypass_cache,
    }
    check_res = check_params(req)
    if check_res is not None:
        return check_res
    resolve_res = _resolve_ref_audio(req)
    if resolve_res is not None:
        return resolve_res
    try:
        from indextts import snapshot_cache

        cache_key = snapshot_cache.make_cache_key(_single_tts_cache_payload(req))
        deleted = snapshot_cache.delete_cache(cache_key)
        return JSONResponse(content={"deleted": deleted, "key": cache_key})
    except Exception as e:
        traceback.print_exc()
        return JSONResponse(status_code=400, content={"message": "cache delete single failed", "Exception": str(e)})


@APP.get("/tts")
async def tts_get_endpoint(
    text: str = None,
    emo_text: str = None,
    ref_audio_path: str = None,
    emo_ref_audio_path: str = None,
    top_k: int = 30,
    top_p: float = 0.8,
    temperature: float = 0.7,
    emo_alpha: float = 0.55,
    normalize_emo_vec: bool = False,
    speed_factor: float = 1.0,
    seed: int = -1,
    parallel_infer: bool = True,
    repetition_penalty: float = 1.2,
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
        "emo_vec": [],
        "normalize_emo_vec": normalize_emo_vec,
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


@APP.get("/tts_stream")
async def tts_stream_get_endpoint(
    text: str = None,
    ref_audio_path: str = None,
    emo_text: str = None,
    emo_ref_audio_path: str = None,
    top_k: int = 30,
    top_p: float = 0.8,
    temperature: float = 0.7,
    emo_alpha: float = 0.55,
    repetition_penalty: float = 1.2,
):
    """Streaming TTS for TAVO regex injection.

    Returns audio/wav with chunked transfer. Designed to be used as:
        <audio controls autoplay
               src="http://<lan-ip>:9880/tts_stream?text=...&ref_audio_path=..."></audio>
    """
    req = {
        "text": text,
        "emo_text": emo_text,
        "ref_audio_path": ref_audio_path,
        "emo_ref_audio_path": emo_ref_audio_path,
        "top_k": top_k,
        "top_p": top_p,
        "temperature": temperature,
        "emo_alpha": float(emo_alpha),
        "emo_vec": [],
        "normalize_emo_vec": False,
        "repetition_penalty": float(repetition_penalty),
    }
    return await tts_stream_handle(req)


@APP.post("/tts_stream")
async def tts_stream_post_endpoint(request: TTS_Request):
    req = request.dict()
    return await tts_stream_handle(req)


@APP.get("/tts_cache_stream")
async def tts_cache_stream_get_endpoint(
    text: str = None,
    ref_audio_path: str = None,
    emo_text: str = None,
    emo_ref_audio_path: str = None,
    top_k: int = 30,
    top_p: float = 0.8,
    temperature: float = 0.7,
    emo_alpha: float = 0.55,
    normalize_emo_vec: bool = False,
    repetition_penalty: float = 1.2,
):
    """Streaming TTS with local snapshot cache for lazy TAVO playback."""
    req = {
        "text": text,
        "emo_text": emo_text,
        "ref_audio_path": ref_audio_path,
        "emo_ref_audio_path": emo_ref_audio_path,
        "top_k": top_k,
        "top_p": top_p,
        "temperature": temperature,
        "emo_alpha": float(emo_alpha),
        "emo_vec": [],
        "normalize_emo_vec": normalize_emo_vec,
        "repetition_penalty": float(repetition_penalty),
    }
    return await tts_cache_stream_handle(req)


@APP.post("/tts_cache_stream")
async def tts_cache_stream_post_endpoint(request: TTS_Request):
    req = request.dict()
    return await tts_cache_stream_handle(req)


@APP.post("/tts_stream_job")
async def tts_stream_job_endpoint(request: TTS_Request):
    """Create a short-lived GET URL for streaming a POST-sized TTS request."""
    req = request.dict()
    check_res = check_params(req)
    if check_res is not None:
        return check_res
    resolve_res = _resolve_ref_audio(req)
    if resolve_res is not None:
        return resolve_res

    from indextts import snapshot_cache

    cache_key = snapshot_cache.make_cache_key(_single_tts_cache_payload(req))
    bypass_cache = bool(req.get("bypass_cache", False))
    cached_path = None if bypass_cache else snapshot_cache.get_cached_audio(cache_key)
    _prune_stream_jobs()
    job_id = secrets.token_urlsafe(18)
    STREAM_JOBS[job_id] = {
        "req": req,
        "expires_at": time.time() + STREAM_JOB_TTL_SECONDS,
    }
    return JSONResponse(content={
        "job_id": job_id,
        "cache_key": cache_key,
        "url": f"/tts_stream_job/{job_id}",
        "cache_url": f"/cache_audio/{cache_key}",
        "cached": bool(cached_path),
        "expires_in": STREAM_JOB_TTL_SECONDS,
    })


@APP.get("/tts_stream_job/{job_id}")
async def tts_stream_job_audio_endpoint(job_id: str):
    """Stream audio for a short-lived job created by /tts_stream_job."""
    _prune_stream_jobs()
    item = STREAM_JOBS.get(job_id)
    if not item:
        return JSONResponse(status_code=404, content={"message": "stream job expired or not found"})
    item["expires_at"] = time.time() + STREAM_JOB_TTL_SECONDS
    return await tts_cache_stream_handle(dict(item["req"]))


@APP.post("/tts_dialogue_stream_job")
async def tts_dialogue_stream_job_endpoint(request: TTS_Dialogue_Request):
    """异步推理 + 流式可断线重连。

    1) 用 payload 算出 cache_key
    2) 若 snapshot_cache 已有 → cached=True，客户端直接走 /cache_audio/{key}
    3) 若 LIVE_JOBS 已有同 cache_key 在跑 → 复用
    4) 否则起后台 inference task → LIVE_JOBS 写 buffer，客户端 GET 同 URL
       从 buffer 0 开始读，任何时候断开/重连都不丢
    5) cache_key 立即随响应返回,前端可立刻写 tavo.set 永久持久化
    """
    req = request.dict()
    prepared, err = await _prepare_dialogue_for_streaming(req)
    if err is not None:
        return err
    cache_key = prepared["cache_key"]
    bypass_cache = bool(req.get("bypass_cache", False))

    from indextts import snapshot_cache
    cached_path = snapshot_cache.get_cached_audio(cache_key)
    if cached_path and not bypass_cache:
        return JSONResponse(content={
            "job_id": cache_key,
            "cache_key": cache_key,
            "url": f"/tts_dialogue_stream_job/{cache_key}",
            "cache_url": f"/cache_audio/{cache_key}",
            "expires_in": LIVE_JOB_LINGER_SECONDS,
            "cached": True,
            "live": False,
        })

    if cache_key in LIVE_JOBS:
        if LIVE_JOBS[cache_key].cancelled or LIVE_JOBS[cache_key].metrics.get("state") == "cancelled":
            LIVE_JOBS.pop(cache_key, None)
        else:
            return JSONResponse(content={
                "job_id": cache_key,
                "cache_key": cache_key,
                "url": f"/tts_dialogue_stream_job/{cache_key}",
                "cache_url": f"/cache_audio/{cache_key}",
                "expires_in": LIVE_JOB_LINGER_SECONDS,
                "cached": False,
                "live": True,
            })

    job = _LiveStreamingJob(cache_key)
    LIVE_JOBS[cache_key] = job
    asyncio.create_task(_run_dialogue_inference_to_job(job, prepared))
    return JSONResponse(content={
        "job_id": cache_key,
        "cache_key": cache_key,
        "url": f"/tts_dialogue_stream_job/{cache_key}",
        "cache_url": f"/cache_audio/{cache_key}",
        "expires_in": LIVE_JOB_LINGER_SECONDS,
        "cached": False,
        "live": True,
    })


@APP.get("/tts_dialogue_stream_job/{job_id}")
async def tts_dialogue_stream_job_audio_endpoint(job_id: str, start_s: float = 0.0):
    """从 cache_key 拉音频：磁盘缓存命中→FileResponse(可 seek)；
    LIVE_JOBS 命中→StreamingResponse(buffer 从头读)；都没有→404。"""
    cache_key = job_id
    from indextts import snapshot_cache
    cached_path = snapshot_cache.get_cached_audio(cache_key)
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
    """Cancel a live dialogue job and delete its saved snapshot if present."""
    cache_key = job_id
    try:
        from indextts import snapshot_cache

        live_job = LIVE_JOBS.get(cache_key)
        if live_job:
            _mark_job_cancelled(live_job)
            live_job.finished.set()
            _gc_live_job(cache_key, delay=30, expected_job=live_job)
        deleted = snapshot_cache.delete_cache(cache_key)
        return JSONResponse(content={
            "cancelled_live": bool(live_job),
            "deleted": deleted,
            "cache_key": cache_key,
        })
    except Exception as e:
        traceback.print_exc()
        return JSONResponse(status_code=400, content={"message": "dialogue job delete failed", "Exception": str(e), "cache_key": cache_key})


@APP.get("/tts_dialogue_job_status/{cache_key}")
async def tts_dialogue_job_status_endpoint(cache_key: str):
    """轮询作业状态：done/running/failed/missing。前端字幕/进度用。

    优先级:LIVE_JOBS(运行中) → snapshot 磁盘(完成且 metadata 有 segments_meta) → missing。
    """
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
    from indextts import snapshot_cache
    import json as _json
    cached_path = snapshot_cache.get_cached_audio(cache_key)
    if cached_path:
        _, json_path = snapshot_cache.cache_paths(cache_key)
        meta = {}
        try:
            with open(json_path, "r", encoding="utf-8") as fp:
                meta = _json.load(fp)
        except Exception:
            meta = {}
        params = meta.get("params") if isinstance(meta.get("params"), dict) else meta
        segments_meta = params.get("segments_meta") or meta.get("segments_meta") or []
        sample_rate = params.get("sample_rate") or meta.get("sample_rate") or 22050
        metrics = params.get("metrics") or meta.get("metrics") or {}
        duration_s = params.get("duration_s") or meta.get("duration_s")
        return JSONResponse(content={
            "state": "done", "cache_key": cache_key,
            "cache_url": f"/cache_audio/{cache_key}",
            "segments_meta": segments_meta,
            "sample_rate": sample_rate,
            "duration_s": duration_s,
            "metrics": metrics,
        })
    return JSONResponse(status_code=404, content={"state": "missing", "cache_key": cache_key})


@APP.post("/tts_dialogue_stream")
async def tts_dialogue_stream_endpoint(request: TTS_Dialogue_Request):
    """Phase 2: multi-voice + emotion streaming for TAVO dialogue.

    Body schema:
        {
          "segments": [
            {"role": "narrator", "text": "...", "emo_vec": [0,0,0,0,0,0,0,0.8]},
            {"role": "小明",     "text": "...", "emo_text": "压低声音,带着喘息"}
          ],
          "voices": {
            "narrator": "voice_a",        // library name or absolute path
            "小明":     "voice_b",
            "default":  "voice_a"          // fallback for any unmapped role
          },
          "interval_ms": 350,
          "top_p": 0.8, "top_k": 30, "temperature": 0.7,
          "repetition_penalty": 1.2,
          "emo_alpha": 0.55
        }

    Returns chunked audio/wav. First bytes go out as soon as the first
    segment's first chunk is decoded; later segments are inserted after a
    configurable silence gap.
    """
    req = request.dict()
    return await tts_dialogue_stream_handle(req)


@APP.post("/tts_dialogue_cache_stream")
async def tts_dialogue_cache_stream_endpoint(request: TTS_Dialogue_Request):
    """Multi-voice + emotion streaming with local whole-dialogue cache."""
    req = request.dict()
    return await tts_dialogue_cache_stream_handle(req)


# @APP.get("/set_gpt_weights")
# async def set_gpt_weights(weights_path: str = None):
#     return JSONResponse(status_code=200, content={"message": "index不需要切换模型"})


# @APP.get("/set_sovits_weights")
# async def set_sovits_weights(weights_path: str = None):
#     return JSONResponse(status_code=200, content={"message": "index不需要切换模型"})


if __name__ == "__main__":
    tts_pipeline = IndexTTS2(
        model_dir=args.model_dir,
        cfg_path=os.path.join(args.model_dir, "config.yaml"),
        is_fp16=args.fp16,
        # use_deepspeed=args.use_deepspeed,
        use_cuda_kernel=args.cuda_kernel,
        use_qwen_emo=args.qwen_emo,
        gpu_memory_utilization=args.vllm_gpu_memory_utilization,
        vllm_enforce_eager=args.vllm_enforce_eager,
    )
    try:
        if host == "None":
            host = None
        bind_for_log = host if host not in (None, "None") else "<all>"
        print(f"IndexTTS API listening on http://{bind_for_log}:{port}")
        print(f"  - GET/POST /tts                  (one-shot, returns full WAV)")
        print(f"  - GET/POST /tts_stream           (single-segment streaming, for TAVO regex)")
        print(f"  - GET/POST /tts_cache_stream     (single-segment streaming with file cache)")
        print(f"  - POST/GET /tts_stream_job       (short URL streaming job for long TAVO text)")
        print(f"  - POST     /tts_dialogue_stream  (multi-voice + emotion streaming)")
        print(f"  - POST     /tts_dialogue_cache_stream (multi-voice streaming with file cache)")
        print(f"  - GET/POST /voices               (local voice library)")
        print(f"  - GET/POST /cache                (local TTS snapshot cache)")
        print(f"  - GET/POST /profiles             (optional local profile store)")
        print(f"  - GET/POST /usage                (optional local usage log)")
        print(f"  - POST     /parse_text           (optional OpenAI-compatible LLM proxy)")
        print(f"  - GET      /static/tavo.js       (single-file TAVO bridge)")
        print(f"  - GET      /health               (liveness probe)")
        if host in ("127.0.0.1", "localhost"):
            print("  [NOTE] Bound to localhost only. For LAN/TAVO use, pass `-a 0.0.0.0`.")
        uvicorn.run(app=APP, host=host, port=port)
    except Exception as e:
        traceback.print_exc()
        os.kill(os.getpid(), signal.SIGTERM)
        exit(0)
