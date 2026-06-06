"""Generate focused vocal-style reference clips for segment-level IndexTTS styles.

These are short reference audios for `emo_ref_audio_path`, not final dialogue.
Keep the text non-explicit and style-oriented so the downstream model extracts
breath/whisper/murmur quality instead of memorizing a sentence.
"""

import io
import json
import os
import sys
import time
import urllib.request


API = "https://api.volink.org/v1"
LIB = os.path.normpath(
    os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", "prompts", "library")
)
OUT_DIR = os.path.join(LIB, "声腔")

os.environ.setdefault("HTTP_PROXY", "http://127.0.0.1:7897")
os.environ.setdefault("HTTPS_PROXY", "http://127.0.0.1:7897")
sys.stdout.reconfigure(encoding="utf-8")


def get_key():
    key = os.environ.get("VOLINK_API_KEY")
    if key:
        return key
    import volink_generate

    return volink_generate.KEY


KEY = get_key()


def get_json(path):
    req = urllib.request.Request(
        API + path,
        headers={"Authorization": "Bearer " + KEY, "Accept": "application/json"},
    )
    with urllib.request.urlopen(req, timeout=30) as r:
        return json.loads(r.read().decode("utf-8"))


def post_audio(payload):
    body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
    req = urllib.request.Request(
        API + "/audio/speech",
        data=body,
        headers={
            "Authorization": "Bearer " + KEY,
            "Content-Type": "application/json; charset=utf-8",
        },
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=90) as r:
        return r.read(), r.headers.get("Content-Type", "")


def fetch_all_voices():
    voices = []
    seen = set()
    for page in range(1, 30):
        data = get_json(f"/tts/voices?page_size=100&page={page}")
        chunk = data.get("voices", [])
        for voice in chunk:
            voice_id = voice.get("id")
            if voice_id and voice_id not in seen:
                seen.add(voice_id)
                voices.append(voice)
        if not data.get("has_more") or not chunk:
            break
    return voices


def find_voice(voices, candidates):
    for name, model_hint in candidates:
        for voice in voices:
            if voice.get("name") == name and model_hint in voice.get("model", ""):
                return voice
        for voice in voices:
            if name in voice.get("name", "") and model_hint in voice.get("model", ""):
                return voice
    raise RuntimeError(f"no matching voice for {candidates}")


def normalize_and_save(audio_mp3, dst_path, target_peak=0.85):
    import librosa
    import numpy as np
    import soundfile as sf

    wav, sr = librosa.load(io.BytesIO(audio_mp3), sr=22050)
    peak = float(np.abs(wav).max()) if wav.size else 0.0
    if peak > 1e-3:
        wav = wav * (target_peak / peak)
    os.makedirs(os.path.dirname(dst_path), exist_ok=True)
    sf.write(dst_path, wav, sr, subtype="PCM_16")
    return peak, sr


def generate(label, voice, text):
    dst = os.path.join(OUT_DIR, f"{label}.wav")
    audio, content_type = post_audio(
        {"model": voice.get("model"), "text": text, "voice": voice["id"]}
    )
    if not audio or len(audio) < 500 or audio.startswith(b"{") or b"<html" in audio[:200].lower():
        raise RuntimeError(f"non-audio response: {content_type}, {audio[:120]!r}")
    peak, sr = normalize_and_save(audio, dst)
    return dst, len(audio), peak, sr


def main():
    voices = fetch_all_voices()
    print(f"voices={len(voices)}")
    voice = find_voice(
        voices,
        [
            ("魅惑女神", "cosyvoice"),
            ("妩媚御姐", "bytedance"),
            ("Sophia Allure", "sensetime"),
            ("Charming Girlfriend", "sensetime"),
        ],
    )
    print(f"style voice={voice.get('name')} model={voice.get('model')} id={voice.get('id')}")

    samples = [
        ("breath_soft", "呼……嗯……先别急，我缓一下。声音放轻一点，慢慢说。"),
        ("breath_heavy", "呼……哈……呼……我有点喘。停一下，让气息慢慢稳住。"),
        ("intimate_breath", "嗯……呼……靠近一点点，声音轻一点。就这样，慢慢呼吸。"),
        ("moan_soft", "嗯……啊……不是疼，只是有点受不了。慢一点，我在听。"),
        ("low_murmur", "嗯……我知道。别说太大声，贴近一点，低低地说。"),
        ("whisper_soft", "别紧张，听我轻轻说。放松一点，我就在这里。"),
        ("shy_whisper", "别这样看我……我会不好意思。嗯，就轻一点说。"),
        ("tense_breath", "呼……我有点紧张。没关系，慢慢来，一点一点就好。"),
        ("sob_soft", "嗯……我没事。只是有点委屈，声音可能会抖。"),
        ("cry_soft", "呜……别担心，我只是忍不住了。让我缓一会儿。"),
        ("tease_soft", "不要嘛……再陪我一会儿。就一小会儿，好不好？"),
        ("laugh_soft", "嗯哼……你又这样逗我。真拿你没办法。"),
        ("gasp_surprise", "啊……真的？我没想到。等一下，让我缓缓。"),
    ]

    for label, text in samples:
        try:
            dst, size, peak, sr = generate(label, voice, text)
            print(f"OK {label}: mp3={size}B peak={peak:.3f}->0.85 sr={sr} -> {dst}")
        except Exception as exc:
            print(f"FAIL {label}: {exc}")
        time.sleep(0.35)


if __name__ == "__main__":
    main()
