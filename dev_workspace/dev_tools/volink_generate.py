"""
Batch-generate voice samples from Volink TTS for the IndexTTS library.
Pulls /v1/tts/voices, picks curated voices, generates self-intro audio per voice,
saves to prompts/library/<category>/<name>.mp3.

UTF-8 handled end-to-end via JSON bytes (avoids Windows shell mojibake).
"""

import io
import os
import sys
import json
import time
import urllib.request
import urllib.error

API = "https://api.volink.org/v1"
KEY = "EpqGqHO2cD69b29593b9e0c2b9e78827c3c1fQF6ahNq"
MODEL = "cosyvoice/CosyVoice2-0.5B"
LIB = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", "prompts", "library")
LIB = os.path.normpath(LIB)

# Use user's proxy (env may already have it)
PROXY = "http://127.0.0.1:7897"
os.environ.setdefault("HTTP_PROXY", PROXY)
os.environ.setdefault("HTTPS_PROXY", PROXY)

# Force stdout UTF-8 so Chinese names print clean on Windows
sys.stdout.reconfigure(encoding="utf-8")


def http_get_json(path):
    req = urllib.request.Request(API + path, headers={
        "Authorization": "Bearer " + KEY,
        "Accept": "application/json",
    })
    with urllib.request.urlopen(req, timeout=20) as r:
        return json.loads(r.read().decode("utf-8"))


def http_post_audio(path, payload):
    body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
    req = urllib.request.Request(API + path, data=body, headers={
        "Authorization": "Bearer " + KEY,
        "Content-Type": "application/json; charset=utf-8",
    }, method="POST")
    with urllib.request.urlopen(req, timeout=60) as r:
        return r.read(), r.headers.get("Content-Type", "")


def fetch_all_voices():
    voices = []
    offset = 0
    page = 100
    while True:
        d = http_get_json(f"/tts/voices?offset={offset}&limit={page}")
        chunk = d.get("voices", [])
        voices.extend(chunk)
        if not d.get("has_more") or not chunk:
            break
        offset += page
        if offset > 2000:
            break
    return voices


def safe_filename(s):
    bad = '\\/:*?"<>|'
    return "".join("_" if c in bad else c for c in s).strip()[:60]


def pick_voices(all_voices):
    """Curated selection by category. Looks for names containing semantic hints
    so we get balanced 旁白/男声/女声/情绪 buckets."""
    by_id = {v["id"]: v for v in all_voices}
    name_of = lambda v: v.get("name", "")

    # 优先 official creator
    official = [v for v in all_voices if v.get("creator") == "official"]
    others = [v for v in all_voices if v.get("creator") != "official"]

    def find_match(pool, keywords, taken_ids, n):
        hits = []
        for v in pool:
            if v["id"] in taken_ids:
                continue
            name = name_of(v)
            if any(k in name for k in keywords):
                hits.append(v)
                if len(hits) >= n:
                    break
        return hits

    taken = set()

    # 旁白 (narrator) ×5
    narrators = find_match(official, ["旁白", "解说", "讲述", "叙事", "新闻"], taken, 5)
    if len(narrators) < 5:
        narrators += find_match(others, ["旁白", "解说", "讲述", "叙事"], taken | {v["id"] for v in narrators}, 5 - len(narrators))
    for v in narrators: taken.add(v["id"])

    # 男声 ×10
    males = [v for v in official if "male" in v.get("genders", []) and v["id"] not in taken][:10]
    for v in males: taken.add(v["id"])

    # 女声 ×10
    females = [v for v in official if "female" in v.get("genders", []) and v["id"] not in taken][:10]
    for v in females: taken.add(v["id"])

    return {
        "旁白": narrators[:5],
        "男声": males,
        "女声": females,
    }


def build_text_for(name, category):
    """Self-intro per voice for ~5 second sample."""
    if category == "旁白":
        return f"你好,我是{name}。深夜的城市灯火通明,故事即将开始。"
    if category == "男声":
        return f"你好,我是{name},今天能认识你真好。我们慢慢聊。"
    if category == "女声":
        return f"你好啊,我是{name}。慢慢说,我都听着呢。"
    return f"你好,我是{name}。"


def generate_one(voice, category, dst_dir):
    name = voice.get("name", "")
    if not name:
        return None, "no-name"
    voice_id = voice["id"]
    text = build_text_for(name, category)
    safe = safe_filename(name)
    # 落盘成 wav，librosa 拉响以后写。文件名带 _vk 后缀,跟用户克隆的原文件区分。
    dst = os.path.join(dst_dir, f"{safe}.wav")
    if os.path.exists(dst) and os.path.getsize(dst) > 5000:
        return dst, "skip-exists"

    try:
        audio, ct = http_post_audio("/audio/speech", {
            "model": voice.get("model") or MODEL,
            "text": text,
            "voice": voice_id,
        })
        if not audio or len(audio) < 200:
            return None, f"empty (ct={ct})"
        if b"<html" in audio[:200].lower() or audio.startswith(b"{"):
            return None, f"non-audio: {audio[:200]!r}"
        # 用 librosa 解 mp3 → 峰值归一 0.85 → soundfile 写 wav
        try:
            import librosa
            import soundfile as sf
            import numpy as np
            buf = io.BytesIO(audio)
            wav, sr = librosa.load(buf, sr=22050)
            peak = float(np.abs(wav).max()) if wav.size else 0.0
            if peak > 1e-3:
                wav = wav * (0.85 / peak)
                applied = f" normalized peak {peak:.3f}→0.85"
            else:
                applied = " (silent? skipped normalize)"
            os.makedirs(dst_dir, exist_ok=True)
            sf.write(dst, wav, sr, subtype="PCM_16")
            return dst, f"ok ({len(audio)} mp3 → {os.path.getsize(dst)} wav,{applied})"
        except Exception as norm_e:
            # 归一化失败就直接写 mp3 原始
            dst_mp3 = os.path.join(dst_dir, f"{safe}.mp3")
            os.makedirs(dst_dir, exist_ok=True)
            with open(dst_mp3, "wb") as f:
                f.write(audio)
            return dst_mp3, f"ok ({len(audio)} bytes, normalize failed: {norm_e})"
    except urllib.error.HTTPError as e:
        body = e.read().decode("utf-8", errors="replace")[:300]
        return None, f"HTTP {e.code}: {body}"
    except Exception as e:
        return None, f"exc: {e}"


def main():
    print(f"=== 拉取 voice 目录 ===")
    voices = fetch_all_voices()
    print(f"  共 {len(voices)} 个")
    official_count = sum(1 for v in voices if v.get("creator") == "official")
    print(f"  其中 official: {official_count}")

    picks = pick_voices(voices)
    for cat, vs in picks.items():
        print(f"  {cat}: {len(vs)}")
        for v in vs:
            print(f"    {v['id']}  {v.get('name','?')}  genders={v.get('genders',[])}")

    print()
    print(f"=== 开始生成,落盘到 {LIB} ===")
    total_ok = 0
    total_fail = 0
    for cat, vs in picks.items():
        dst_dir = os.path.join(LIB, cat)
        for v in vs:
            dst, status = generate_one(v, cat, dst_dir)
            mark = "✓" if dst else "✗"
            print(f"  {mark} [{cat}] {v.get('name','?'):20s}  → {status}")
            if dst: total_ok += 1
            else: total_fail += 1
            time.sleep(0.3)  # gentle
    print(f"\nDONE  ok={total_ok}  fail={total_fail}")


if __name__ == "__main__":
    main()
