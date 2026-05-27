"""Generate SenseTime/日日新 candidates + sample more Chinese voices."""

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
    return peak


def main():
    all_v = fetch_all()
    print(f"total voices: {len(all_v)}")
    by_model = {}
    for v in all_v:
        by_model.setdefault(v.get("model", ""), []).append(v)
    for m, vs in by_model.items():
        print(f"  {m}: {len(vs)}")
        # 抽样 5 个中文名(看是不是英文)
        for v in vs[:5]:
            print(f"    {v.get('name','')[:30]}")

    # ---------- SenseTime 候选 ----------
    # 用户说"风韵少妇 在日日新里",日日新=SenseTime,全英文名。
    # 这几个最像 风韵/总裁/萝莉/大叔/温柔的:
    sens_picks = [
        ("Sophia Allure",          "风韵御姐",  "你好啊,我是风韵御姐。慢慢说,我都听着呢。"),
        ("Amorous Queen",          "风情女王",  "你好,我是风情女王。过来,陪我聊一会儿。"),
        ("Velvet Voice",           "天鹅绒嗓",  "你好,我是天鹅绒嗓音,声音很柔。"),
        ("Elegant Lady",           "优雅女士",  "你好,我是优雅女士。今天天气不错。"),
        ("Gentle Empress",         "温柔女王",  "你好,我是温柔女王。坐过来一点。"),
        ("Innocent Young Girl",    "清纯萝莉",  "你好呀,我是清纯萝莉,哥哥你今天怎么这么晚才回来?"),
        ("Spoiled Sweetie",        "撒娇甜心",  "嘛~你怎么才来嘛~我等了你好久。"),
        ("Charming Girlfriend",    "迷人女友",  "你好啊,我是迷人女友。今天累不累?"),
        ("Bubbly Sweetie",         "活泼甜心",  "嗨!我是活泼甜心,我们去玩吧!"),
        ("Ruthless CEO",           "霸道总裁",  "你好,我是霸道总裁。这件事,我说了算。"),
        ("Majestic Executive",     "沉稳高管",  "你好,我是沉稳高管,业务上的事我们慢慢谈。"),
        ("Chilled Aristocrat",     "冷峻贵公子","你好,我是冷峻贵公子。何事相邀?"),
        ("Warm Uncle",             "暖心大叔",  "你好,我是暖心大叔。有什么困难尽管说。"),
        ("Loving Boyfriend",       "温柔男友",  "你好,我是温柔男友。今天累了吧,过来。"),
        ("Gentle Prince",          "温柔王子",  "你好,我是温柔王子。让我陪在你身边。"),
        ("Sweet Puppy Boy",        "甜蜜奶狗",  "你好啊,我是甜蜜奶狗,主人今天好香!"),
    ]
    print()
    print("=== 生成 SenseTime/日日新 候选 →  prompts/library/日日新/ ===")
    name_to_voice = {v.get("name", ""): v for v in all_v}
    for en, cn, text in sens_picks:
        v = name_to_voice.get(en)
        if not v:
            print(f"  ✗ {en} → 候选库里没找到")
            continue
        dst = os.path.join(LIB, "日日新", f"{cn}.wav")
        if os.path.exists(dst) and os.path.getsize(dst) > 5000:
            print(f"  · {cn}: skip-exists")
            continue
        try:
            audio = post_tts({"model": v.get("model"), "text": text, "voice": v["id"]})
            peak = save_normalized(audio, dst)
            print(f"  ✓ {cn:10s} ({en:25s})  mp3={len(audio)}B  peak={peak:.3f}→0.85")
        except Exception as e:
            print(f"  ✗ {cn} ({en}): {e}")
        time.sleep(0.3)

    # ---------- 探测 minimax / bytedance 中文名 ----------
    print()
    print("=== minimax / bytedance 中文名样本(前 30 个) ===")
    for model_keyword, label in [("minimax", "MiniMax"), ("bytedance", "ByteDance")]:
        chinese_named = [v for v in all_v if model_keyword in v.get("model", "")
                          and any(0x4E00 <= ord(c) <= 0x9FFF for c in v.get("name", ""))]
        print(f"\n  {label} 中文名 voice: {len(chinese_named)}")
        for v in chinese_named[:30]:
            print(f"    {v['id']}  {v.get('name', '')[:30]:30s}  gender={v.get('genders', [])}")

    print("\nDONE.")


if __name__ == "__main__":
    main()
