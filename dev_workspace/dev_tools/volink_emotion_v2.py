"""Redo emotion samples: use Volink native voice (魅惑女神), ~7s each."""

import io
import os
import sys
import json
import time
import urllib.request

API = "https://api.volink.org/v1"
KEY = "EpqGqHO2cD69b29593b9e0c2b9e78827c3c1fQF6ahNq"
LIB = os.path.normpath(os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", "prompts", "library"))

os.environ.setdefault("HTTP_PROXY", "http://127.0.0.1:7897")
os.environ.setdefault("HTTPS_PROXY", "http://127.0.0.1:7897")
sys.stdout.reconfigure(encoding="utf-8")


def get(p):
    req = urllib.request.Request(API + p, headers={"Authorization": "Bearer " + KEY})
    with urllib.request.urlopen(req, timeout=20) as r:
        return json.loads(r.read().decode("utf-8"))


def post_tts(payload):
    body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
    req = urllib.request.Request(API + "/audio/speech", data=body, headers={
        "Authorization": "Bearer " + KEY,
        "Content-Type": "application/json; charset=utf-8",
    }, method="POST")
    with urllib.request.urlopen(req, timeout=60) as r:
        return r.read()


def fetch_all():
    out = []; seen = set()
    for page in range(1, 8):
        d = get(f"/tts/voices?page_size=100&page={page}")
        for v in d.get("voices", []):
            if v["id"] not in seen: seen.add(v["id"]); out.append(v)
        if not d.get("has_more"): break
    return out


def save_normalized(audio_mp3, dst):
    import librosa, soundfile as sf, numpy as np
    wav, sr = librosa.load(io.BytesIO(audio_mp3), sr=22050)
    peak = float(np.abs(wav).max()) if wav.size else 0.0
    if peak > 1e-3:
        wav = wav * (0.85 / peak)
    os.makedirs(os.path.dirname(dst), exist_ok=True)
    sf.write(dst, wav, sr, subtype="PCM_16")
    return peak, len(wav) / sr


def main():
    all_v = fetch_all()
    by_name = {v.get("name", ""): v for v in all_v}

    # 用 Volink 自带的女声(情感表达力强),不用用户克隆的 AD学姐
    # 候选: 魅惑女神(cosyvoice) / 风情女王(sensetime) / 撒娇甜心(sensetime)
    target_voice = by_name.get("魅惑女神") or by_name.get("Amorous Queen") or by_name.get("Spoiled Sweetie")
    if not target_voice:
        print("✗ 找不到合适的情绪 voice,退出")
        return
    print(f"using voice: {target_voice['name']} ({target_voice['id']}) model={target_voice.get('model')}")

    # ~7s ≈ 25-35 字,多拟声词 + 多停顿
    emo_samples = [
        ("呻吟", "啊...啊...好疼...你慢一点啊...嗯...再轻一点...啊...嗯...就这样..."),
        ("喘息", "呼...呼...我...我真的累了...让我...让我喘口气...呼...呼..."),
        ("哭泣", "呜...呜呜...我真的好难过...你不要这样对我...呜...呜呜...你听我说..."),
        ("哽咽", "对...对不起...我...我没事...真的...真的没事...只是...只是有点想哭..."),
        ("撒娇", "嘛~~不要嘛~~你怎么可以这样啦~~人家等了你好久好久~~讨厌~~不理你了~~"),
        ("低吟", "嗯...嗯...啊...就这样...再这样下去...不行...不行了...嗯..."),
        ("害羞", "别...别看我啦...讨厌...你这样我...我不好意思...真的别看了啦..."),
        ("笑", "哈哈哈...你说什么呢...真是的...哈...哈哈...笑死我了...哎呀..."),
    ]

    out_dir = os.path.join(LIB, "情绪")
    # 先删旧的(短的)
    for fname, _ in emo_samples:
        old = os.path.join(out_dir, f"{fname}.wav")
        if os.path.exists(old):
            try: os.remove(old); print(f"  · 删除旧: {fname}.wav")
            except Exception: pass

    print()
    print("=== 重新生成 ~7s 情绪样本 ===")
    for fname, text in emo_samples:
        dst = os.path.join(out_dir, f"{fname}.wav")
        try:
            audio = post_tts({"model": target_voice.get("model"), "text": text, "voice": target_voice["id"]})
            peak, dur = save_normalized(audio, dst)
            mark = "✓" if dur >= 4.0 else "⚠️"
            print(f"  {mark} {fname:6s}  mp3={len(audio)}B  dur={dur:.2f}s  peak={peak:.3f}→0.85  text='{text[:30]}…'")
        except Exception as e:
            print(f"  ✗ {fname}: {e}")
        time.sleep(0.3)


if __name__ == "__main__":
    main()
