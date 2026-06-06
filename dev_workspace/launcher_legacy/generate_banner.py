"""
生成 LEON 启动器横幅海报
"""
import sys
import io
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')

import requests
import base64
import os
from pathlib import Path
from PIL import Image

# 配置
API_BASE = "https://tizenry.xyz/v1"
API_KEY = os.environ.get("LEON_IMAGE_API_KEY", "")
AVATAR_PATH = Path(__file__).parent / "leon-avatar.jpeg"
OUTPUT_PATH = Path(__file__).parent / "leon-banner-personal.png"

def convert_to_png(input_path: Path, output_path: Path):
    """将图片转换为 PNG 格式"""
    img = Image.open(input_path)
    # 转换为 RGBA 模式
    if img.mode != 'RGBA':
        img = img.convert('RGBA')
    img.save(output_path, 'PNG')
    print(f"✓ 转换完成: {output_path}")
    return output_path

def generate_banner_with_avatar(avatar_png_path: Path, output_path: Path):
    """基于头像生成横幅"""
    if not API_KEY:
        raise RuntimeError("Missing LEON_IMAGE_API_KEY environment variable")
    url = f"{API_BASE}/images/edits"
    headers = {
        "Authorization": f"Bearer {API_KEY}"
    }

    # 精心设计的提示词
    prompt = """
    Create a professional technology banner with this portrait on the left side.
    Dark gradient background from deep navy to black with subtle cyan and emerald light effects.
    On the right side: abstract audio waveforms, neural network visualization, glowing particles.
    Modern, sleek, high-tech aesthetic. Professional personal brand feel.
    Cinematic lighting on the portrait. Wide horizontal composition.
    No text or typography.
    """

    print("⏳ 正在生成横幅海报...")
    print(f"   输入: {avatar_png_path.name}")
    print(f"   尺寸: 1792x1024 (横版)")

    with open(avatar_png_path, "rb") as f:
        files = {
            "image": (avatar_png_path.name, f, "image/png"),
        }
        data = {
            "model": "gpt-image-2",
            "prompt": prompt,
            "size": "1792x1024",
            "n": 1,
            "response_format": "b64_json"
        }

        response = requests.post(url, headers=headers, files=files, data=data, timeout=180)

    response.raise_for_status()

    result = response.json()
    b64_str = result["data"][0]["b64_json"]
    img_bytes = base64.b64decode(b64_str)

    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_bytes(img_bytes)

    print(f"✅ 横幅生成完成: {output_path}")
    return output_path

def main():
    print("=" * 60)
    print("LEON 启动器横幅生成器")
    print("=" * 60)

    # 步骤 1: 转换头像为 PNG
    print("\n[1/2] 转换头像格式...")
    avatar_png = AVATAR_PATH.parent / "leon-avatar-temp.png"
    convert_to_png(AVATAR_PATH, avatar_png)

    # 步骤 2: 生成横幅
    print("\n[2/2] 生成横幅海报...")
    try:
        banner_path = generate_banner_with_avatar(avatar_png, OUTPUT_PATH)

        # 清理临时文件
        if avatar_png.exists():
            avatar_png.unlink()

        print("\n" + "=" * 60)
        print("✅ 全部完成！")
        print(f"横幅路径: {banner_path}")
        print("=" * 60)

        return banner_path
    except Exception as e:
        print(f"\n❌ 生成失败: {e}")
        # 清理临时文件
        if avatar_png.exists():
            avatar_png.unlink()
        raise

if __name__ == "__main__":
    main()
