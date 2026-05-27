"""Specific replacements + emotion samples generation.

Replaces user's quiet hand-cut samples (AD学姐, Jok, 风韵少妇) with Volink
TTS clones at normalized volume. Adds onomatopoeia-style emotion samples.
"""

import io
import os
import sys
import json
import time
import urllib.request

API = "https://api.volink.org/v1"
KEY = "EpqGqHO2cD69b29593b9e0c2b9e78827c3c1fQF6ahNq"
LIB = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", "prompts", "library")
LIB = os.path.normpath(LIB)

os.environ.setdefault("HTTP_PROXY", "http://127.0.0.1:7897")
os.environ.setdefault("HTTPS_PROXY", "http://127.0.0.1:7897")
sys.stdout.reconfigure(encoding="utf-8")


def http_get_json(path):
    req = urllib.request.Request(API + path, headers={"Authorization": "Bearer " + KEY, "Accept": "application/json"})
    with urllib.request.urlopen(req, timeout=20) as r:
        return json.loads(r.read().decode("utf-8"))


def http_post_audio(payload):
    body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
    req = urllib.request.Request(API + "/audio/speech", data=body, headers={
        "Authorization": "Bearer " + KEY,
        "Content-Type": "application/json; charset=utf-8",
    }, method="POST")
    with urllib.request.urlopen(req, timeout=60) as r:
        return r.read()


def fetch_all_voices():
    voices = []
    offset = 0
    while True:
        d = http_get_json(f"/tts/voices?offset={offset}&limit=100")
        chunk = d.get("voices", [])
        voices.extend(chunk)
        if not d.get("has_more") or not chunk:
            break
        offset += 100
        if offset > 2000:
            break
    # dedupe by id
    seen = set(); out = []
    for v in voices:
        if v["id"] in seen: continue
        seen.add(v["id"]); out.append(v)
    return out


def find_voice(voices, name):
    """Exact match preferred, else first contains-name."""
    for v in voices:
        if v.get("name") == name:
            return v
    for v in voices:
        if name in v.get("name", ""):
            return v
    return None


def normalize_and_save(audio_mp3, dst_path, target_peak=0.85):
    import librosa, soundfile as sf, numpy as np
    buf = io.BytesIO(audio_mp3)
    wav, sr = librosa.load(buf, sr=22050)
    peak = float(np.abs(wav).max()) if wav.size else 0.0
    if peak > 1e-3:
        wav = wav * (target_peak / peak)
    os.makedirs(os.path.dirname(dst_path), exist_ok=True)
    sf.write(dst_path, wav, sr, subtype="PCM_16")
    return peak


def main():
    print("=== 拉取所有 voices ===")
    all_v = fetch_all_voices()
    print(f"   total={len(all_v)} (deduped)")

    # ---- 1) 替换 3 个老样本 ----
    print()
    print("=== 替换 AD学姐 / Jok / 风韵少妇 ===")
    targets = [
        ("AD学姐", "AD学姐.wav", "你好,我是AD学姐。今天有什么想聊的,慢慢说,我陪着你。"),
        ("Jok",     "Jok.wav",     "你好,我是Jok。很高兴认识你,我们慢慢来。"),
        ("风韵少妇", "风韵少妇.wav", "你好啊,我是风韵少妇。过来,陪我聊一会儿,别走那么快。"),
    ]
    for name, fname, text in targets:
        v = find_voice(all_v, name)
        if not v:
            print(f"  ✗ {name}: 没找到")
            continue
        try:
            audio = http_post_audio({"model": v.get("model"), "text": text, "voice": v["id"]})
            dst = os.path.join(LIB, fname)
            peak = normalize_and_save(audio, dst)
            print(f"  ✓ {name}: voice_id={v['id']}  mp3={len(audio)}B  peak={peak:.3f}→0.85  →  {dst}")
        except Exception as e:
            print(f"  ✗ {name}: {e}")
        time.sleep(0.3)

    # ---- 2) 情绪样本 (拟声词) ----
    print()
    print("=== 情绪样本(拟声词 + 短句),用合适 voice 合成 ===")
    # 这种台词不需要专门音色;挑一个能表达较强情绪的 voice (e.g., 魅惑女神 / AD学姐)
    emo_voice = find_voice(all_v, "AD学姐") or find_voice(all_v, "魅惑女神")
    if not emo_voice:
        print("  ✗ 找不到情绪 voice,跳过")
    else:
        print(f"  using voice: {emo_voice['name']} ({emo_voice['id']})")
        emo_samples = [
            ("呻吟",   "啊...啊...好疼...轻一点..."),
            ("喘息",   "呼...呼...累死我了..."),
            ("哭泣",   "呜呜...我...我难受..."),
            ("哽咽",   "对...对不起...我没事..."),
            ("撒娇",   "嘛~不要嘛~你陪我一会儿好不好~"),
            ("低吟",   "嗯...嗯..."),
            ("害羞",   "别...别看我啦..."),
            ("笑",     "哈哈...你说什么呢..."),
        ]
        for fname, text in emo_samples:
            dst = os.path.join(LIB, "情绪", f"{fname}.wav")
            if os.path.exists(dst) and os.path.getsize(dst) > 5000:
                print(f"  · {fname}: skip-exists")
                continue
            try:
                audio = http_post_audio({"model": emo_voice.get("model"), "text": text, "voice": emo_voice["id"]})
                peak = normalize_and_save(audio, dst)
                print(f"  ✓ {fname}: mp3={len(audio)}B  peak={peak:.3f}→0.85  →  {dst}")
            except Exception as e:
                print(f"  ✗ {fname}: {e}")
            time.sleep(0.3)

    print()
    print("DONE.")


if __name__ == "__main__":
    main()
