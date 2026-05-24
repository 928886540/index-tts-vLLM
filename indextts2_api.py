import os
import sys
import traceback
import base64

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
parser.add_argument("--fp16", action="store_true", default=False, help="Use FP16 for inference if available")
parser.add_argument("--use_deepspeed", action="store_true", default=False, help="Use Deepspeed to accelerate if available")
parser.add_argument("--cuda_kernel", action="store_true", default=False, help="Use cuda kernel for inference if available")
parser.add_argument("--no_qwen_emo", action="store_true", default=False, help="Disable Qwen_emotion, which can save about 2GB VRAM, but text emotion prompt will be no longer available.")
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


# Phase 2 dialogue request models.
# Caller is expected to pre-parse the source text into segments (typically by
# calling a 3rd-party LLM client-side, e.g. from tavo.js). Each segment names
# a role; each role maps to a voice in `voices`. Per-segment emotion can be
# given as `emo_vec` (8-dim) or `emo_text` (natural language like "压低声音,
# 带着喘息"). emo_vec wins when both present.
class TTS_Segment(BaseModel):
    role: str
    text: str
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


class Cache_Prune_Request(BaseModel):
    max_items: int = 5000


def pack_wav(io_buffer: BytesIO, data: np.ndarray, rate: int):
    io_buffer = BytesIO()
    sf.write(io_buffer, data, rate, format="wav")
    return io_buffer


# ---------------------------------------------------------------------------
# Streaming helpers (Phase 1: single-segment streaming for TAVO regex use).
# Only /tts_stream uses these. /tts is unchanged.
# ---------------------------------------------------------------------------

# Serialize streaming inference: the underlying IndexTTS2 mutates shared
# instance state (cache_spk_cond, etc.), so concurrent infer() calls would
# clobber each other. Lock around inference only; the StreamingResponse
# generator yields outside the lock.
tts_stream_lock = asyncio.Lock()


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
    # chunk_wav: torch tensor on CPU, shape [channels, samples], float32 in
    # roughly [-1, 1]. Convert to int16 mono PCM.
    if chunk_wav.dim() == 2:
        wav = chunk_wav[0] if chunk_wav.shape[0] == 1 else chunk_wav.mean(dim=0)
    else:
        wav = chunk_wav
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
        headers={"X-IndexTTS-Cache": "MISS", "X-IndexTTS-Cache-Key": cache_key},
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

    # Pre-resolve every role -> voice path. Detect missing up-front.
    default_path = _resolve_voice(voices.get("default", ""))
    role_voice_paths: Dict[str, str] = {}
    unresolved_roles: List[str] = []
    seen_roles = set()
    for seg in segments:
        role = (seg.get("role") or "").strip()
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
                    role = (seg.get("role") or "").strip()
                    text = (seg.get("text") or "").strip()
                    if not text:
                        continue
                    voice_path = role_voice_paths.get(role) or default_path
                    if not voice_path:
                        # Should be unreachable: caught up-front, but be safe.
                        continue

                    emo_vec = seg.get("emo_vec") or None
                    emo_text_seg = seg.get("emo_text") or None
                    seg_alpha = seg.get("emo_alpha")
                    seg_alpha = float(seg_alpha) if seg_alpha is not None else default_emo_alpha
                    # emo_vec wins when both are present; matches the V26
                    # convention and the LLM-output schema we recommend.
                    if emo_vec:
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
                        emo_audio_prompt=None,
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

    default_path = _resolve_voice(voices.get("default", ""))
    role_voice_paths: Dict[str, str] = {}
    unresolved_roles: List[str] = []
    seen_roles = set()
    for seg in segments:
        role = (seg.get("role") or "").strip()
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
                    role = (seg.get("role") or "").strip()
                    text = (seg.get("text") or "").strip()
                    if not text:
                        continue
                    voice_path = role_voice_paths.get(role) or default_path
                    if not voice_path:
                        continue

                    emo_vec = seg.get("emo_vec") or None
                    emo_text_seg = seg.get("emo_text") or None
                    seg_alpha = seg.get("emo_alpha")
                    seg_alpha = float(seg_alpha) if seg_alpha is not None else default_emo_alpha
                    if emo_vec:
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
                        emo_audio_prompt=None,
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


@APP.get("/voices")
async def voices_list_endpoint():
    """List the local voice library stored under prompts/library."""
    try:
        from indextts import voice_library

        return JSONResponse(content={"voices": voice_library.list_voices()})
    except Exception as e:
        traceback.print_exc()
        return JSONResponse(status_code=400, content={"message": "voices list failed", "Exception": str(e)})


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
        use_qwen_emo=not args.no_qwen_emo,
    )
    try:
        if host == "None":
            host = None
        bind_for_log = host if host not in (None, "None") else "<all>"
        print(f"IndexTTS API listening on http://{bind_for_log}:{port}")
        print(f"  - GET/POST /tts                  (one-shot, returns full WAV)")
        print(f"  - GET/POST /tts_stream           (single-segment streaming, for TAVO regex)")
        print(f"  - GET/POST /tts_cache_stream     (single-segment streaming with file cache)")
        print(f"  - POST     /tts_dialogue_stream  (multi-voice + emotion streaming)")
        print(f"  - POST     /tts_dialogue_cache_stream (multi-voice streaming with file cache)")
        print(f"  - GET/POST /voices               (local voice library)")
        print(f"  - GET/POST /cache                (local TTS snapshot cache)")
        print(f"  - GET      /static/tavo.js       (single-file TAVO bridge)")
        print(f"  - GET      /health               (liveness probe)")
        if host in ("127.0.0.1", "localhost"):
            print("  [NOTE] Bound to localhost only. For LAN/TAVO use, pass `-a 0.0.0.0`.")
        uvicorn.run(app=APP, host=host, port=port)
    except Exception as e:
        traceback.print_exc()
        os.kill(os.getpid(), signal.SIGTERM)
        exit(0)
