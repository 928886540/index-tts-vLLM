"""Generate focused Volink samples for the user's prompt library.

The API key is not stored here. For this local workspace it is read from the
existing Volink helper if VOLINK_API_KEY is not set.
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

os.environ.setdefault("HTTP_PROXY", "http://127.0.0.1:7897")
os.environ.setdefault("HTTPS_PROXY", "http://127.0.0.1:7897")
sys.stdout.reconfigure(encoding="utf-8")


def get_key():
    key = os.environ.get("VOLINK_API_KEY")
    if key:
        return key
    try:
        import volink_generate

        return volink_generate.KEY
    except Exception as exc:
        raise RuntimeError("Set VOLINK_API_KEY before running this script") from exc


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
    out = []
    seen = set()

    for page in range(1, 30):
        data = get_json(f"/tts/voices?page_size=100&page={page}")
        chunk = data.get("voices", [])
        for voice in chunk:
            voice_id = voice.get("id")
            if voice_id and voice_id not in seen:
                seen.add(voice_id)
                out.append(voice)
        if not data.get("has_more") or not chunk:
            break

    return out


def find_voice(voices, name, model_contains=None):
    exact = [
        v
        for v in voices
        if v.get("name") == name
        and (not model_contains or model_contains in v.get("model", ""))
    ]
    if exact:
        return exact[0]

    fuzzy = [
        v
        for v in voices
        if name in v.get("name", "")
        and (not model_contains or model_contains in v.get("model", ""))
    ]
    return fuzzy[0] if fuzzy else None


def generate_one(label, voice, text, dst_dir):
    dst = os.path.join(dst_dir, f"{label}.mp3")
    audio, content_type = post_audio(
        {
            "model": voice.get("model"),
            "text": text,
            "voice": voice["id"],
        }
    )
    if not audio or len(audio) < 500 or audio.startswith(b"{") or b"<html" in audio[:200].lower():
        raise RuntimeError(f"non-audio response: {content_type}, {audio[:120]!r}")
    os.makedirs(os.path.dirname(dst), exist_ok=True)
    with open(dst, "wb") as f:
        f.write(audio)
    return dst, len(audio)


def main():
    voices = fetch_all_voices()
    print(f"voices={len(voices)}")

    requested_and_curated = [
        (
            "字节_魅力女友",
            ["魅力女友", "魅力苏菲", "初恋女友", "贴心女友"],
            "bytedance",
            "你好啊，我是魅力女友。今天先给你一段试听，声音会温柔一点，也会贴近一点。",
        ),
        (
            "字节_成熟姐姐",
            ["成熟姐姐"],
            "bytedance",
            "你好，我是成熟姐姐。别着急，慢慢说，我会认真听你把话讲完。",
        ),
        (
            "日日新_风韵少妇",
            ["Sophia Allure", "Amorous Queen", "Elegant Lady", "Velvet Voice"],
            "sensetime",
            "你好啊，我是风韵少妇。夜色刚好，坐近一点，陪我轻轻聊几句。",
        ),
        (
            "字节_妩媚御姐",
            ["妩媚御姐"],
            "bytedance",
            "你好，我是妩媚御姐。今晚的声音放慢一些，像耳边轻声说话。",
        ),
        (
            "字节_贴心女友",
            ["贴心女友"],
            "bytedance",
            "你好呀，我是贴心女友。今天辛苦了，先放松一下，听我陪你说会儿话。",
        ),
        (
            "字节_撒娇学妹",
            ["撒娇学妹"],
            "bytedance",
            "学长，你终于来了。我是撒娇学妹，这段声音就当作今天的小惊喜。",
        ),
        (
            "日日新_风情女王",
            ["Amorous Queen"],
            "sensetime",
            "你好，我是风情女王。别躲开我的目光，今晚只需要安静听我说。",
        ),
        (
            "日日新_迷人女友",
            ["Charming Girlfriend"],
            "sensetime",
            "你好啊，我是迷人女友。把烦心事先放一边，让我陪你轻轻说几句话。",
        ),
    ]

    print("=== voice samples ===")
    for label, candidates, model_hint, text in requested_and_curated:
        voice = None
        for name in candidates:
            voice = find_voice(voices, name, model_hint)
            if voice:
                break
        if not voice:
            print(f"MISS {label}: candidates={candidates}")
            continue
        try:
            dst, size = generate_one(label, voice, text, LIB)
            print(
                f"OK {label} <- {voice.get('name')} [{voice.get('model')}] "
                f"mp3={size}B -> {dst}"
            )
        except Exception as exc:
            print(f"FAIL {label}: {exc}")
        time.sleep(0.35)

    emotion_voice = (
        find_voice(voices, "魅惑女神", "cosyvoice")
        or find_voice(voices, "妩媚御姐", "bytedance")
        or find_voice(voices, "Charming Girlfriend", "sensetime")
    )
    if not emotion_voice:
        print("MISS emotion voice")
        return

    safe_emotions = [
        ("亲密喘息", "呼……呼……等一下，让我先缓一缓。嗯……现在好多了。"),
        ("害羞低语", "别靠那么近啦……我会不好意思的。嗯，就这样轻轻说话。"),
        ("轻声撒娇", "不要走嘛……再陪我一会儿，好不好？我还想听你说话。"),
        ("惊喜轻叹", "啊……真的给我的吗？我有一点开心，也有一点不知所措。"),
        ("委屈哽咽", "我没有生气……只是有点委屈。你过来，听我慢慢说。"),
        ("温柔耳语", "放轻松，闭上眼睛。今晚不用逞强，我就在这里陪你。"),
        ("慵懒轻笑", "嗯哼……你又逗我笑。真拿你没办法，过来一点。"),
        ("紧张呼吸", "呼……我有点紧张。没关系，我会慢慢来，一句一句说清楚。"),
    ]

    print("=== safe emotion samples ===")
    emotion_dir = os.path.join(LIB, "情绪")
    for label, text in safe_emotions:
        try:
            dst, size = generate_one(label, emotion_voice, text, emotion_dir)
            print(
                f"OK {label} <- {emotion_voice.get('name')} [{emotion_voice.get('model')}] "
                f"mp3={size}B -> {dst}"
            )
        except Exception as exc:
            print(f"FAIL {label}: {exc}")
        time.sleep(0.35)


if __name__ == "__main__":
    main()
