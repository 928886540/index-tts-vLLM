"""
生成更明亮的启动器横幅
"""
import sys
import io
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')

import requests
import base64
import os
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont, ImageFilter, ImageEnhance

API_BASE = "https://tizenry.xyz/v1"
API_KEY = os.environ.get("LEON_IMAGE_API_KEY", "")
AVATAR_PATH = Path(__file__).parent / "leon-avatar.jpeg"
OUTPUT_PATH = Path(__file__).parent / "leon-banner-modern.png"

def create_modern_banner():
    """创建现代风格横幅（无需 API，纯 PIL）"""
    # 尺寸：1200x160 适合启动器顶部
    width, height = 1200, 160

    # 创建渐变背景
    img = Image.new('RGB', (width, height), '#0F172A')
    draw = ImageDraw.Draw(img)

    # 渐变效果（从深蓝到更浅的蓝）
    for y in range(height):
        r = int(15 + (y / height) * 10)
        g = int(23 + (y / height) * 18)
        b = int(42 + (y / height) * 43)
        draw.rectangle([(0, y), (width, y+1)], fill=(r, g, b))

    # 加载头像
    if AVATAR_PATH.exists():
        avatar = Image.open(AVATAR_PATH)
        # 调整头像大小
        avatar_size = 100
        avatar = avatar.resize((avatar_size, avatar_size), Image.Resampling.LANCZOS)

        # 创建圆形遮罩
        mask = Image.new('L', (avatar_size, avatar_size), 0)
        mask_draw = ImageDraw.Draw(mask)
        mask_draw.ellipse((0, 0, avatar_size, avatar_size), fill=255)

        # 应用遮罩并粘贴
        avatar.putalpha(mask)
        img.paste(avatar, (40, 30), avatar)

    # 添加文字
    try:
        # 尝试使用系统字体
        title_font = ImageFont.truetype("msyh.ttc", 32)
        subtitle_font = ImageFont.truetype("msyh.ttc", 16)
    except:
        title_font = ImageFont.load_default()
        subtitle_font = ImageFont.load_default()

    # 标题
    draw.text((160, 45), "LEON - IndexTTS2", fill='#FFFFFF', font=title_font)

    # 副标题
    draw.text((160, 90), "本地 AI 语音合成服务", fill='#94A3B8', font=subtitle_font)

    # 右侧装饰（简单的音频波形）
    wave_x_start = 900
    wave_y_center = height // 2
    for i in range(15):
        x = wave_x_start + i * 15
        bar_height = 20 + (i % 3) * 15
        y1 = wave_y_center - bar_height // 2
        y2 = wave_y_center + bar_height // 2
        color = (16, 185, 129) if i % 2 == 0 else (34, 211, 238)
        draw.rectangle([(x, y1), (x + 8, y2)], fill=color)

    # 保存
    img.save(OUTPUT_PATH, 'PNG')
    print(f"✅ 现代横幅生成完成: {OUTPUT_PATH}")
    return OUTPUT_PATH

if __name__ == "__main__":
    print("=" * 60)
    print("LEON 现代横幅生成器")
    print("=" * 60)
    create_modern_banner()
