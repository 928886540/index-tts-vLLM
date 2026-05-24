import os
import sys
import traceback

now_dir = os.getcwd()

import argparse
import asyncio
import signal
import numpy as np
import soundfile as sf
import torch
from fastapi import FastAPI, Response
from fastapi.responses import StreamingResponse, JSONResponse
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


def _chunk_to_pcm_bytes(chunk_wav) -> bytes:
    # chunk_wav: torch tensor on CPU, shape [channels, samples], float32 in
    # roughly [-1, 1]. Convert to int16 mono PCM.
    if chunk_wav.dim() == 2:
        wav = chunk_wav[0] if chunk_wav.shape[0] == 1 else chunk_wav.mean(dim=0)
    else:
        wav = chunk_wav
    wav_int16 = (wav.clamp(-1.0, 1.0) * 32767.0).to(torch.int16)
    return wav_int16.numpy().tobytes()


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


@APP.get("/control")
async def control(command: str = None):
    if command is None:
        return JSONResponse(status_code=400, content={"message": "command is required"})
    handle_control(command)


@APP.get("/health")
async def health():
    """Lightweight liveness probe for TAVO clients / monitoring."""
    return JSONResponse(content={"status": "ok"})


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
        print(f"  - GET/POST /tts          (one-shot, returns full WAV)")
        print(f"  - GET/POST /tts_stream   (streaming WAV chunks, for TAVO regex)")
        print(f"  - GET      /health       (liveness probe)")
        if host in ("127.0.0.1", "localhost"):
            print("  [NOTE] Bound to localhost only. For LAN/TAVO use, pass `-a 0.0.0.0`.")
        uvicorn.run(app=APP, host=host, port=port)
    except Exception as e:
        traceback.print_exc()
        os.kill(os.getpid(), signal.SIGTERM)
        exit(0)
