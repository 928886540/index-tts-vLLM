"""Shared active-profile schema helpers for LEON API backends."""

from __future__ import annotations

import re
from typing import Any, Optional


def default_profile_prompt_template() -> str:
    return "\n".join(
        [
            "你是中文小说→TTS 片段拆分器。只返回严格 JSON，不要任何解释，不要 ``` 代码块。",
            "",
            "{{roles_hint}}",
            "{{user_alias_hint}}",
            "{{character_hint}}",
            "输出格式:",
            "{{output_contract}}",
            "",
            "拆段规则:",
            "1. 旁白（叙述、环境、动作描写、心理描写、所有无引号正文）→ role 固定为 \"旁白\"。",
            "   无论主语是不是用户身份名/当前角色名，只要不是引号里的直接台词，都必须写 \"旁白\"。",
            "   例如「白夜雨抱住她」「潘金莲低下头」「她笑了」「我低下头看着……」「白夜雨说道：」都写旁白，不要让用户或角色认领旁白。",
            "   旁白连续多个句子，要按句号/问号/感叹号/分号拆成多个旁白 segments，每段≤2 句。",
            "2. 人物直接说出口的话 → role 用说话人的名字。",
            "   - 如果说话人是「你」或用户身份名，role 统一写 \"用户\"。",
            "   - 不要把「我」当作用户；无引号的「我……」默认是第一人称叙述，role 写 \"旁白\"。",
            "   - 其他人物优先从已知角色名单挑名字；名单外的新人物用原文里的名字。",
            "3. 「他说：」「她笑道：」「白夜雨说道：」这类引导句本身永远是旁白；只有后面引号里的直接台词才按说话人分配。",
            "4. text 是要朗读的原文片段，保留标点和语气词。",
            "{{style_rules}}",
            "",
            "{{emotion_rules}}",
            "",
            "完整性硬规则:",
            "- 必须覆盖输入原文 100%，按原文顺序输出，不要总结、改写、删字、漏掉最后一段。",
            "- 每个原文片段只能出现一次，不要把多段无关尾巴合并成一条对白。",
            "- 如果最后一个引号后还有动作/叙述/心理描写，最后一段必须是 role=\"旁白\"。",
            "- 不确定说话人时用 role=\"旁白\"，不要沿用上一句对白角色。",
            "",
            "示例输入:",
            "她低着头，眼角有泪。「对不起，我真的撑不住了。」",
            "{{example_user}}叹了口气，把手放在她肩上：「别哭。」",
            "示例输出:",
            "{{example_output}}",
        ]
    )


def default_quality_presets() -> dict:
    def preset(diffusion_steps: int, prompt_audio_seconds: int, segment_tokens: int, first_tokens: int) -> dict:
        return {
            "diffusion_steps": diffusion_steps,
            "prompt_audio_seconds": prompt_audio_seconds,
            "segment_tokens": segment_tokens,
            "first_tokens": first_tokens,
            "s2mel_cfg_rate": 0.7,
            "interval_ms": 50,
            "top_p": 0.8,
            "top_k": 30,
            "temperature": 0.7,
            "repetition_penalty": 1.2,
        }

    presets = {
        "fast": preset(8, 6, 40, 10),
        "balanced": preset(14, 10, 60, 18),
        "expressive": preset(16, 12, 72, 24),
        "ultra": preset(20, 14, 96, 32),
        "custom": preset(14, 10, 60, 18),
    }
    return {"live": dict(presets), "generate": dict(presets)}


def default_quality_modes() -> list:
    return [
        {"id": "fast", "label": "极速（流式推荐）"},
        {"id": "balanced", "label": "平衡"},
        {"id": "expressive", "label": "质量优先"},
        {"id": "ultra", "label": "落盘高质量"},
    ]


def default_active_profile(styles: dict) -> dict:
    return {
        "version": 3,
        "name": "LEON default",
        "description": "Default local tuning profile managed by the LEON launcher.",
        "llmPromptId": "launcher_profile_prompt_template_v1",
        "llmPrompt": default_profile_prompt_template(),
        "quality": {
            "defaultMode": "balanced",
            "customLabel": "自定义",
            "modes": default_quality_modes(),
            "presets": default_quality_presets(),
        },
        "styles": styles,
    }


def validate_active_profile(profile: dict) -> None:
    if int(profile.get("version") or 0) != 3:
        raise ValueError("Profile 配置错误: version 必须是 3")
    quality = profile.get("quality")
    if not isinstance(quality, dict):
        raise ValueError("Profile 配置错误: 缺少 quality object")
    styles = profile.get("styles")
    if not isinstance(styles, dict) or not styles:
        raise ValueError("Profile 配置错误: 缺少 styles 声腔配置")
    if "neutral" not in styles:
        raise ValueError("Profile 配置错误: styles 必须包含 neutral")
    validated = {}
    for raw_id, value in styles.items():
        style_id = str(raw_id or "").strip()
        if not style_id:
            raise ValueError("Profile 配置错误: styles 存在空 style id")
        entry = strict_style_entry(style_id, value)
        if entry is not None:
            validated[style_id] = entry
    if "neutral" not in validated:
        raise ValueError("Profile 配置错误: styles 必须启用 neutral")


def style_number(value: Any, field: str, low: float, high: float) -> float:
    try:
        parsed = float(value)
    except (TypeError, ValueError):
        raise ValueError(f"Profile 配置错误: styles.{field} 必须是数字")
    if parsed < low or parsed > high:
        raise ValueError(f"Profile 配置错误: styles.{field} 超出范围 {low}-{high}: {parsed}")
    return parsed


def strict_style_entry(style_id: str, value: Any) -> Optional[dict]:
    if not re.match(r"^[A-Za-z0-9_\-\u4e00-\u9fff]+$", style_id or ""):
        raise ValueError(f"Profile 配置错误: 非法 style id: {style_id}")
    if not isinstance(value, dict):
        raise ValueError(f"Profile 配置错误: styles.{style_id} 必须是 object")
    if value.get("enabled") is False:
        return None
    label = str(value.get("label") or "").strip()
    if not label:
        raise ValueError(f"Profile 配置错误: styles.{style_id}.label 不能为空")
    refs = []
    raw_refs = value.get("refs")
    if isinstance(raw_refs, list):
        for item in raw_refs:
            ref_item = str(item or "").strip()
            if ref_item and ref_item not in refs:
                refs.append(ref_item)
    ref = str(value.get("ref") or "").strip()
    if ref and ref not in refs:
        refs.append(ref)
    if style_id not in ("neutral", "none") and not refs:
        raise ValueError(f"Profile 配置错误: styles.{style_id}.refs 至少选择 1 个参考音频")
    style_alpha = style_number(value.get("style_alpha"), f"{style_id}.style_alpha", 0.12, 0.78)
    emo_alpha = style_number(value.get("emo_alpha"), f"{style_id}.emo_alpha", 0.12, 0.62)
    raw_vec = value.get("emo_vec")
    emo_vec = None
    if raw_vec not in (None, ""):
        if not isinstance(raw_vec, list) or len(raw_vec) != 8:
            raise ValueError(f"Profile 配置错误: styles.{style_id}.emo_vec 必须是 8 维数组")
        emo_vec = []
        for index, item in enumerate(raw_vec):
            emo_vec.append(style_number(item, f"{style_id}.emo_vec[{index}]", 0.0, 1.0))
    return {
        "label": label,
        "ref": refs[0] if refs else "",
        "refs": refs,
        "style_alpha": style_alpha,
        "emo_alpha": emo_alpha,
        "emo_vec": emo_vec,
        "description": str(value.get("description") or "").strip(),
    }


def active_style_profiles(profile: dict) -> dict:
    raw_styles = profile.get("styles")
    if not isinstance(raw_styles, dict) or not raw_styles:
        raise ValueError("Profile 配置错误: 缺少 styles 声腔配置")
    styles = {}
    for raw_id, value in raw_styles.items():
        style_id = str(raw_id or "").strip()
        if not style_id:
            raise ValueError("Profile 配置错误: styles 存在空 style id")
        entry = strict_style_entry(style_id, value)
        if entry is not None:
            styles[style_id] = entry
    if "neutral" not in styles:
        raise ValueError("Profile 配置错误: styles 必须启用 neutral")
    return styles


__all__ = [
    "active_style_profiles",
    "default_active_profile",
    "default_profile_prompt_template",
    "default_quality_modes",
    "default_quality_presets",
    "strict_style_entry",
    "style_number",
    "validate_active_profile",
]
