from __future__ import annotations

import json
import math
import shutil
from dataclasses import dataclass
from pathlib import Path

import lameenc
import numpy as np
import soundfile as sf


ROOT = Path(__file__).resolve().parents[1]
STYLE_DIR = ROOT / "prompts" / "library" / "声腔"
REPORT_PATH = STYLE_DIR / "声腔切片报告.json"


@dataclass(frozen=True)
class StyleSpec:
    name: str
    seconds: float
    old_source: str | None = None


STYLE_SPECS = [
    StyleSpec("轻喘", 4.5, "breath_soft.wav"),
    StyleSpec("喘息", 5.0, "breath_heavy.wav"),
    StyleSpec("耳语", 5.0, "whisper_soft.wav"),
    StyleSpec("低语", 5.0, "shy_whisper.wav"),
    StyleSpec("低吟", 4.8, "moan_soft.wav"),
    StyleSpec("惊喘", 3.5, "gasp_surprise.wav"),
    StyleSpec("哭腔", 5.0, "cry_soft.wav"),
    StyleSpec("哽咽", 5.0, "sob_soft.wav"),
    StyleSpec("挑逗", 5.0, "tease_soft.wav"),
    StyleSpec("轻笑", 3.8, "laugh_soft.wav"),
    StyleSpec("尖叫", 4.8, "scream_peak.wav"),
    StyleSpec("余韵", 5.0, "low_murmur.wav"),
]


NEW_SOURCES = {
    "AD学姐": Path(r"D:\人声处理工具\输出\htdemucs\查寝时突然欲望爆发\vocals.wav"),
    "JOK": Path(r"D:\人声处理工具\输出\htdemucs\出差后的NTR电话\vocals.wav"),
}


def _read_audio(path: Path) -> tuple[np.ndarray, int]:
    audio, sr = sf.read(path, always_2d=True, dtype="float32")
    if audio.size == 0:
        raise RuntimeError(f"empty audio: {path}")
    return audio, sr


def _peak_normalize(audio: np.ndarray, peak: float = 0.92) -> np.ndarray:
    audio = np.asarray(audio, dtype=np.float32)
    current = float(np.max(np.abs(audio))) if audio.size else 0.0
    if current > 1e-6:
        audio = audio * min(1.0, peak / current)
    return np.clip(audio, -0.98, 0.98)


def _fade(audio: np.ndarray, sr: int, fade_ms: int = 30) -> np.ndarray:
    n = min(len(audio) // 2, max(1, int(sr * fade_ms / 1000)))
    if n <= 1:
        return audio
    ramp = np.linspace(0.0, 1.0, n, dtype=np.float32)
    audio = audio.copy()
    audio[:n] *= ramp[:, None]
    audio[-n:] *= ramp[::-1, None]
    return audio


def _write_mp3(path: Path, audio: np.ndarray, sr: int) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    audio = _fade(_peak_normalize(audio), sr)
    audio_i16 = (audio * 32767.0).astype("<i2", copy=False)
    encoder = lameenc.Encoder()
    encoder.set_bit_rate(192)
    encoder.set_in_sample_rate(sr)
    encoder.set_channels(audio_i16.shape[1])
    encoder.set_quality(2)
    data = encoder.encode(audio_i16.tobytes()) + encoder.flush()
    path.write_bytes(data)


def _copy_old_styles() -> list[dict]:
    report: list[dict] = []
    for spec in STYLE_SPECS:
        if not spec.old_source:
            continue
        src = STYLE_DIR / spec.old_source
        if not src.is_file():
            continue
        audio, sr = _read_audio(src)
        dst = STYLE_DIR / f"{spec.name}-步非烟.MP3"
        _write_mp3(dst, audio, sr)
        report.append(
            {
                "speaker": "步非烟",
                "style": spec.name,
                "file": dst.name,
                "source": str(src),
                "start_sec": None,
                "duration_sec": round(len(audio) / sr, 3),
            }
        )
    return report


def _frame_features(mono: np.ndarray, sr: int, frame_sec: float = 0.05) -> dict[str, np.ndarray]:
    frame = max(1, int(sr * frame_sec))
    n = len(mono) // frame
    mono = mono[: n * frame]
    frames = mono.reshape(n, frame)
    rms = np.sqrt(np.mean(frames * frames, axis=1) + 1e-12)
    peak = np.max(np.abs(frames), axis=1)
    zcr = np.mean(frames[:, 1:] * frames[:, :-1] < 0, axis=1)
    diff = np.mean(np.abs(np.diff(frames, axis=1)), axis=1) / (rms + 1e-6)
    return {"rms": rms, "peak": peak, "zcr": zcr, "rough": diff, "frame": np.array([frame])}


def _scale(values: np.ndarray, lo: float | None = None, hi: float | None = None) -> np.ndarray:
    if lo is None:
        lo = float(np.percentile(values, 5))
    if hi is None:
        hi = float(np.percentile(values, 95))
    if hi <= lo + 1e-9:
        return np.zeros_like(values)
    return np.clip((values - lo) / (hi - lo), 0.0, 1.0)


def _window_stats(features: dict[str, np.ndarray], sr: int, seconds: float) -> list[dict]:
    frame = int(features["frame"][0])
    frames_per_window = max(2, int(seconds * sr / frame))
    hop = max(1, frames_per_window // 4)
    rms = features["rms"]
    peak = features["peak"]
    zcr = features["zcr"]
    rough = features["rough"]
    energy_threshold = max(float(np.percentile(rms, 68)) * 0.65, 0.003)
    rms_norm = _scale(rms)
    peak_norm = _scale(peak)
    zcr_norm = _scale(zcr)
    rough_norm = _scale(rough)
    windows: list[dict] = []
    for start in range(0, max(1, len(rms) - frames_per_window), hop):
        end = start + frames_per_window
        if end > len(rms):
            break
        r = rms[start:end]
        active = float(np.mean(r > energy_threshold))
        if active < 0.16:
            continue
        rn = rms_norm[start:end]
        pn = peak_norm[start:end]
        zn = zcr_norm[start:end]
        gn = rough_norm[start:end]
        windows.append(
            {
                "frame_start": start,
                "frame_end": end,
                "start_sec": start * frame / sr,
                "end_sec": end * frame / sr,
                "active": active,
                "rms": float(np.mean(rn)),
                "rms_max": float(np.max(rn)),
                "rms_std": float(np.std(rn)),
                "peak": float(np.mean(pn)),
                "peak_max": float(np.max(pn)),
                "zcr": float(np.mean(zn)),
                "zcr_std": float(np.std(zn)),
                "rough": float(np.mean(gn)),
                "burst": float(np.max(r) / (np.mean(r) + 1e-6)),
            }
        )
    return windows


def _score(style: str, w: dict) -> float:
    active = w["active"]
    rms = w["rms"]
    rms_max = w["rms_max"]
    rms_std = w["rms_std"]
    peak = w["peak"]
    peak_max = w["peak_max"]
    zcr = w["zcr"]
    zcr_std = w["zcr_std"]
    rough = w["rough"]
    burst = min(w["burst"] / 4.5, 1.0)
    stable = 1.0 - min(rms_std * 1.4, 1.0)
    low_energy = 1.0 - rms

    table = {
        "轻喘": 0.22 * active + 0.28 * low_energy + 0.25 * zcr + 0.15 * rough + 0.10 * burst,
        "喘息": 0.20 * active + 0.30 * rms + 0.22 * zcr + 0.18 * rough + 0.10 * burst,
        "耳语": 0.18 * active + 0.38 * low_energy + 0.28 * zcr + 0.10 * rough + 0.06 * stable,
        "低语": 0.25 * active + 0.26 * low_energy + 0.18 * (1 - zcr) + 0.20 * stable + 0.11 * peak,
        "低吟": 0.30 * active + 0.34 * rms + 0.20 * (1 - zcr) + 0.16 * stable,
        "惊喘": 0.16 * active + 0.22 * peak_max + 0.25 * burst + 0.20 * zcr + 0.17 * rms_std,
        "哭腔": 0.28 * active + 0.25 * rms + 0.22 * rms_std + 0.15 * rough + 0.10 * (1 - zcr),
        "哽咽": 0.22 * active + 0.25 * rms_std + 0.24 * burst + 0.16 * low_energy + 0.13 * rough,
        "挑逗": 0.28 * active + 0.24 * rms + 0.20 * stable + 0.16 * (1 - zcr) + 0.12 * peak,
        "轻笑": 0.16 * active + 0.25 * rms_std + 0.24 * burst + 0.20 * zcr_std + 0.15 * zcr,
        "尖叫": 0.28 * active + 0.32 * rms_max + 0.20 * peak_max + 0.12 * zcr + 0.08 * rough,
        "余韵": 0.24 * active + 0.30 * low_energy + 0.24 * stable + 0.16 * (1 - zcr) + 0.06 * peak,
    }
    return float(table[style])


def _overlap_ratio(a: tuple[float, float], b: tuple[float, float]) -> float:
    left = max(a[0], b[0])
    right = min(a[1], b[1])
    if right <= left:
        return 0.0
    return (right - left) / max(0.001, min(a[1] - a[0], b[1] - b[0]))


def _choose_window(style: str, windows: list[dict], used: list[tuple[float, float]]) -> dict:
    ranked = sorted(windows, key=lambda w: _score(style, w), reverse=True)
    for item in ranked:
        interval = (item["start_sec"], item["end_sec"])
        if all(_overlap_ratio(interval, prev) < 0.18 for prev in used):
            return item
    return ranked[0]


def _slice_new_speaker(speaker: str, path: Path) -> list[dict]:
    audio, sr = _read_audio(path)
    mono = np.mean(audio, axis=1)
    features = _frame_features(mono, sr)
    report: list[dict] = []
    used: list[tuple[float, float]] = []
    for spec in STYLE_SPECS:
        windows = _window_stats(features, sr, spec.seconds)
        chosen = _choose_window(spec.name, windows, used)
        start = int(chosen["start_sec"] * sr)
        end = int(chosen["end_sec"] * sr)
        clip = audio[start:end]
        dst = STYLE_DIR / f"{spec.name}-{speaker}.MP3"
        _write_mp3(dst, clip, sr)
        used.append((chosen["start_sec"], chosen["end_sec"]))
        report.append(
            {
                "speaker": speaker,
                "style": spec.name,
                "file": dst.name,
                "source": str(path),
                "start_sec": round(chosen["start_sec"], 3),
                "end_sec": round(chosen["end_sec"], 3),
                "duration_sec": round((end - start) / sr, 3),
                "score": round(_score(spec.name, chosen), 6),
            }
        )
    return report


def main() -> None:
    STYLE_DIR.mkdir(parents=True, exist_ok=True)
    report: list[dict] = []
    report.extend(_copy_old_styles())
    for speaker, path in NEW_SOURCES.items():
        if not path.is_file():
            raise FileNotFoundError(path)
        report.extend(_slice_new_speaker(speaker, path))
    REPORT_PATH.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"wrote {len(report)} style clips")
    for item in report:
        print(f"{item['file']} <- {item['source']} {item.get('start_sec')} {item['duration_sec']}s")


if __name__ == "__main__":
    main()
