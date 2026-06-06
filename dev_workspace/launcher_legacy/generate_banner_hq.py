"""
用 gpt-image-2 生成高质量启动器横幅
"""
import sys
import io
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')

import requests
import base64
import os
from pathlib import Path

API_BASE = "https://tizenry.xyz/v1"
API_KEY = os.environ.get("LEON_IMAGE_API_KEY", "")
OUTPUT_PATH = Path(__file__).parent / "leon-banner-hq.png"

def generate_banner():
    """生成高质量启动器横幅"""
    if not API_KEY:
        raise RuntimeError("Missing LEON_IMAGE_API_KEY environment variable")
    url = f"{API_BASE}/images/generations"
    headers = {
        "Authorization": f"Bearer {API_KEY}",
        "Content-Type": "application/json"
    }

    prompt = """
    A professional, sleek application banner for AI voice synthesis software.
    Dark navy blue gradient background with subtle tech patterns.
    Left side: elegant circular avatar photo placeholder with soft glow effect.
    Center: bold white text "LEON - IndexTTS2" with modern sans-serif font.
    Right side: animated audio waveform visualization in cyan and emerald colors.
    Wide horizontal layout, professional UI design, high contrast, clean and modern.
    No additional text. Cinematic lighting. 8K quality.
    """

    print("Generating HQ banner with gpt-image-2...")
    print(f"Size: 1792x1024 (HD)")

    payload = {
        "model": "gpt-image-2",
        "prompt": prompt,
        "size": "1792x1024",
        "quality": "hd",
        "n": 1,
        "response_format": "b64_json"
    }

    response = requests.post(url, json=payload, headers=headers, timeout=180)
    response.raise_for_status()

    result = response.json()
    b64_str = result["data"][0]["b64_json"]
    img_bytes = base64.b64decode(b64_str)

    OUTPUT_PATH.write_bytes(img_bytes)
    print(f"✅ HQ banner saved: {OUTPUT_PATH}")
    return OUTPUT_PATH

if __name__ == "__main__":
    print("=" * 60)
    print("LEON HQ Banner Generator")
    print("=" * 60)
    generate_banner()
