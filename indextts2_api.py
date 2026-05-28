import os
import sys
import traceback
import base64
import socket
import secrets
import time
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
    temperature: float = 0.8
    emo_alpha: float = 0.7
    emo_vec: list = []
    normalize_emo_vec: bool = False
    speed_factor: float = 1.0
    seed: int = -1
    parallel_infer: bool = True
    repetition_penalty: float = 10
    bypass_cache: bool = False


# Phase 2 dialogue request models.
# Caller is expected to pre-parse the source text into segments (typically by
# calling a 3rd-party LLM client-side, e.g. from tavo.js). Each segment names
# a role; each role maps to a voice in `voices`. Per-segment emotion can be
# given as `emo_vec` (8-dim) or `emo_text` (natural language like "压低声音,
# 带着喘息"). emo_vec wins when both present.
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
    segments: List[TTS_Segment]
    # role -> voice library name OR direct file path
    voices: Dict[str, str]
    interval_ms: int = 350
    top_p: float = 0.8
    top_k: int = 30
    temperature: float = 0.8
    repetition_penalty: float = 10
    emo_alpha: float = 0.7  # default if a segment doesn't override


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
# Only /tts_stream uses these. /tts is unchanged.
# ---------------------------------------------------------------------------

# Stream-tuned generation parameters mirrored from webui.py.
# These are the values that produced RTF ~0.6 on the same RTX 3060 hardware.
# diffusion_steps=8 (vs default 16) is the biggest single lever; short segment
# tokens + 8s prompt cap keep cat_frames small so each diffusion step is cheap.
STREAM_TARGET_SEGMENT_TOKENS = 72
STREAM_HARD_SEGMENT_TOKENS = 82
STREAM_FIRST_SEGMENT_TOKENS = 36
STREAM_MIN_SEGMENT_TOKENS = 24
STREAM_DIFFUSION_STEPS = 12
STREAM_PROMPT_AUDIO_SECONDS = 8


def _stream_split_limits(requested_segment_tokens: int = STREAM_TARGET_SEGMENT_TOKENS):
    target_tokens = min(int(requested_segment_tokens), STREAM_TARGET_SEGMENT_TOKENS)
    hard_tokens = min(
        STREAM_HARD_SEGMENT_TOKENS,
        max(target_tokens + 24, int(target_tokens * 1.35)),
    )
    first_tokens = min(STREAM_FIRST_SEGMENT_TOKENS, target_tokens)
    return target_tokens, hard_tokens, first_tokens


def _stream_infer_kwargs(requested_segment_tokens: int = STREAM_TARGET_SEGMENT_TOKENS) -> dict:
    target_tokens, hard_tokens, first_tokens = _stream_split_limits(requested_segment_tokens)
    return {
        "max_text_tokens_per_sentence": target_tokens,
        "diffusion_steps": STREAM_DIFFUSION_STEPS,
        "max_prompt_audio_seconds": STREAM_PROMPT_AUDIO_SECONDS,
        "max_emo_audio_seconds": STREAM_PROMPT_AUDIO_SECONDS,
        "prefer_sentence_boundary": True,
        "quick_streaming_tokens": first_tokens,
        "sentence_split_hard_max_tokens": hard_tokens,
        "sentence_split_min_tokens": STREAM_MIN_SEGMENT_TOKENS,
    }


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
        self.created_at = time.time()
        # 为字幕用：每段 PCM 起始字节偏移 + 文本 + 角色 + 真实时长
        self.segments_meta: List[dict] = []


def _gc_live_job(cache_key: str, delay: float = LIVE_JOB_LINGER_SECONDS):
    async def _go():
        await asyncio.sleep(delay)
        LIVE_JOBS.pop(cache_key, None)
    try: asyncio.create_task(_go())
    except Exception: pass


async def _stream_from_live_job(job: "_LiveStreamingJob"):
    """Multi-consumer streamer; reads job.pcm tail-poll, yields new bytes."""
    yield job.header
    offset = 0
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


async def _prepare_dialogue_for_streaming(req: dict):
    """Resolve voices, build cache_payload, compute cache_key.

    Returns (prepared_dict, None) on success or (None, JSONResponse) on input error.
    """
    segments = req.get("segments") or []
    voices = req.get("voices") or {}
    if not segments:
        return None, JSONResponse(status_code=400, content={"message": "segments is required"})
    if not voices:
        return None, JSONResponse(status_code=400, content={"message": "voices is required"})

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
        return None, JSONResponse(
            status_code=400,
            content={"message": "voices unresolved", "roles": unresolved_roles},
        )

    interval_ms = int(req.get("interval_ms", 350))
    default_emo_alpha = float(req.get("emo_alpha", 0.7))
    sampling_kwargs = {
        "top_p": float(req.get("top_p", 0.8)),
        "top_k": int(req.get("top_k", 30)),
        "temperature": float(req.get("temperature", 0.8)),
        "repetition_penalty": float(req.get("repetition_penalty", 10)),
        **_stream_infer_kwargs(),
    }
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
    from indextts import snapshot_cache
    cache_key = snapshot_cache.make_cache_key(cache_payload)
    return {
        "segments": segments,
        "role_voice_paths": role_voice_paths,
        "default_path": default_path,
        "sampling_kwargs": sampling_kwargs,
        "interval_ms": interval_ms,
        "default_emo_alpha": default_emo_alpha,
        "cache_payload": cache_payload,
        "cache_key": cache_key,
    }, None


async def _run_dialogue_inference_to_job(job: "_LiveStreamingJob", prepared: dict):
    """Background worker: runs dialogue inference, writes PCM to job.pcm,
    saves the complete WAV to snapshot_cache on finish. Survives client
    disconnects — no GET in flight is required."""
    try:
        async with tts_stream_lock:
            from indextts.llm_proxy import _normalize_role
            segments = prepared["segments"]
            role_voice_paths = prepared["role_voice_paths"]
            default_path = prepared["default_path"]
            sampling_kwargs = prepared["sampling_kwargs"]
            interval_ms = prepared["interval_ms"]
            default_emo_alpha = prepared["default_emo_alpha"]

            async def on_chunk(chunk_wav, sr, seg_idx, total_segments):
                pcm = _chunk_to_pcm_bytes(chunk_wav)
                job.sample_rate = sr
                job.pcm.extend(pcm)

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
                if role == "旁白":
                    if isinstance(emo_vec, list) and len(emo_vec) == 8:
                        scaled = [min(float(v) * 0.4, 0.3) for v in emo_vec[:7]]
                        neu = max(float(emo_vec[7]) if len(emo_vec) > 7 else 0.6, 0.6)
                        emo_vec = scaled + [neu]
                    else:
                        emo_vec = [0.0]*7 + [0.8]
                    emo_text_seg = None
                    seg_alpha = min(seg_alpha, 0.25)
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
                seg_byte_count = len(job.pcm) - seg_start_offset
                seg_duration = seg_byte_count / (job.sample_rate * 2) if job.sample_rate else 0.0
                job.segments_meta.append({
                    "idx": idx,
                    "role": role,
                    "text": text,
                    "style": _segment_style_name(seg) or "neutral",
                    "style_alpha": seg_alpha if style_audio else None,
                    "style_audio": style_audio,
                    "start_offset_bytes": seg_start_offset,
                    "duration_s": seg_duration,
                })

        # Inference 完成 → 写完整 WAV 到 snapshot_cache，未来 /cache_audio/{key}
        # 可直接给 FileResponse（含 Content-Length，移动端可 seek）。
        try:
            from indextts import snapshot_cache
            wav_full = _make_complete_wav_bytes(bytes(job.pcm), job.sample_rate)
            metadata = {
                "kind": "tts_dialogue_stream_v1",
                "segments_meta": job.segments_meta,
                "sample_rate": job.sample_rate,
                "duration_s": len(job.pcm) / (job.sample_rate * 2) if job.sample_rate else 0,
            }
            snapshot_cache.save_cached_audio(job.cache_key, wav_full, metadata)
            snapshot_cache.prune_cache(max_items=5000)
        except Exception:
            traceback.print_exc()
    except Exception as e:
        job.error = str(e)
        traceback.print_exc()
    finally:
        job.finished.set()
        _gc_live_job(job.cache_key)


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
    "stage_warmup": "声腔/breath_soft",
    "stage_rising": "声腔/intimate_breath",
    "stage_peak": "声腔/moan_soft",
    "stage_afterglow": "声腔/low_murmur",
}


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
        "temperature": float(req.get("temperature", 0.8)),
        "emo_alpha": float(req.get("emo_alpha", 0.7)),
        "repetition_penalty": float(req.get("repetition_penalty", 10)),
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
                    emo_alpha=float(req.get("emo_alpha", 0.7)),
                    emo_vector=emo_vec,
                    top_p=float(req.get("top_p", 0.8)),
                    top_k=int(req.get("top_k", 30)),
                    temperature=float(req.get("temperature", 0.8)),
                    repetition_penalty=float(req.get("repetition_penalty", 10)),
                    output_path=None,
                    stream_chunk_callback=on_chunk,
                    **_stream_infer_kwargs(),
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
                    emo_alpha=float(req.get("emo_alpha", 0.7)),
                    emo_vector=emo_vec,
                    top_p=float(req.get("top_p", 0.8)),
                    top_k=int(req.get("top_k", 30)),
                    temperature=float(req.get("temperature", 0.8)),
                    repetition_penalty=float(req.get("repetition_penalty", 10)),
                    output_path=None,
                    stream_chunk_callback=on_chunk,
                    **_stream_infer_kwargs(),
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
    default_emo_alpha = float(req.get("emo_alpha", 0.7))
    sampling_kwargs = {
        "top_p": float(req.get("top_p", 0.8)),
        "top_k": int(req.get("top_k", 30)),
        "temperature": float(req.get("temperature", 0.8)),
        "repetition_penalty": float(req.get("repetition_penalty", 10)),
        **_stream_infer_kwargs(),
    }

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
                    # 旁白 微情绪压制（同 tts_dialogue_cache_stream 逻辑）
                    if role == "旁白":
                        if isinstance(emo_vec, list) and len(emo_vec) == 8:
                            scaled = [min(float(v) * 0.4, 0.3) for v in emo_vec[:7]]
                            neu = max(float(emo_vec[7]) if len(emo_vec) > 7 else 0.6, 0.6)
                            emo_vec = scaled + [neu]
                        else:
                            emo_vec = [0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.8]
                        emo_text_seg = None
                        seg_alpha = min(seg_alpha, 0.25)
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
    default_emo_alpha = float(req.get("emo_alpha", 0.7))
    sampling_kwargs = {
        "top_p": float(req.get("top_p", 0.8)),
        "top_k": int(req.get("top_k", 30)),
        "temperature": float(req.get("temperature", 0.8)),
        "repetition_penalty": float(req.get("repetition_penalty", 10)),
        **_stream_infer_kwargs(),
    }
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
                    # 旁白：保留 LLM 给的情绪倾向，但每个非中性维度压到 ≤0.3，
                    # 中性维度抬到 ≥0.6；alpha 也压到 0.25。
                    # 让旁白有轻微情感波动但不至于做作。
                    if role == "旁白":
                        if isinstance(emo_vec, list) and len(emo_vec) == 8:
                            scaled = [min(float(v) * 0.4, 0.3) for v in emo_vec[:7]]
                            neu = max(float(emo_vec[7]) if len(emo_vec) > 7 else 0.6, 0.6)
                            emo_vec = scaled + [neu]
                        else:
                            emo_vec = [0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.8]
                        emo_text_seg = None
                        seg_alpha = min(seg_alpha, 0.25)
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

        deleted = snapshot_cache.delete_cache(key)
        return JSONResponse(content={"deleted": deleted, "key": key})
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
    temperature: float = 0.8,
    emo_alpha: float = 0.7,
    normalize_emo_vec: bool = False,
    repetition_penalty: float = 10,
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
    temperature: float = 0.8,
    emo_alpha: float = 0.7,
    normalize_emo_vec: bool = False,
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
    temperature: float = 0.8,
    emo_alpha: float = 0.7,
    repetition_penalty: float = 10,
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
    temperature: float = 0.8,
    emo_alpha: float = 0.7,
    normalize_emo_vec: bool = False,
    repetition_penalty: float = 10,
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

    _prune_stream_jobs()
    job_id = secrets.token_urlsafe(18)
    STREAM_JOBS[job_id] = {
        "req": req,
        "expires_at": time.time() + STREAM_JOB_TTL_SECONDS,
    }
    return JSONResponse(content={
        "job_id": job_id,
        "url": f"/tts_stream_job/{job_id}",
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

    from indextts import snapshot_cache
    cached_path = snapshot_cache.get_cached_audio(cache_key)
    if cached_path:
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
        "live": False,
    })


@APP.get("/tts_dialogue_stream_job/{job_id}")
async def tts_dialogue_stream_job_audio_endpoint(job_id: str):
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
            _stream_from_live_job(job),
            media_type="audio/wav",
            headers={"X-IndexTTS-Cache": "LIVE", "X-IndexTTS-Cache-Key": cache_key},
        )
    return JSONResponse(status_code=404, content={"message": "job missing or expired", "cache_key": cache_key})


@APP.get("/tts_dialogue_job_status/{cache_key}")
async def tts_dialogue_job_status_endpoint(cache_key: str):
    """轮询作业状态：done/running/failed/missing。前端字幕/进度用。

    优先级:LIVE_JOBS(运行中) → snapshot 磁盘(完成且 metadata 有 segments_meta) → missing。
    """
    job = LIVE_JOBS.get(cache_key)
    if job:
        state = "failed" if job.error else ("done" if job.finished.is_set() else "running")
        return JSONResponse(content={
            "state": state,
            "cache_key": cache_key,
            "cache_url": f"/cache_audio/{cache_key}",
            "pcm_bytes": len(job.pcm),
            "segments_done": len(job.segments_meta),
            "segments_meta": job.segments_meta,
            "sample_rate": job.sample_rate,
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
        return JSONResponse(content={
            "state": "done", "cache_key": cache_key,
            "cache_url": f"/cache_audio/{cache_key}",
            "segments_meta": segments_meta,
            "sample_rate": sample_rate,
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
          "top_p": 0.8, "top_k": 30, "temperature": 0.8,
          "repetition_penalty": 10,
          "emo_alpha": 0.7
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
