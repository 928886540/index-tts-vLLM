"""Shared profile prompt template rendering for LEON API backends."""

from __future__ import annotations

from collections.abc import Iterable, Mapping
from typing import Any


def style_catalog_for_prompt(styles: Mapping[str, Mapping[str, Any]]) -> str:
    labels = []
    for style_id in sorted(styles.keys(), key=lambda x: (x not in ("neutral", "none"), x)):
        if style_id == "none":
            continue
        entry = styles[style_id]
        desc = str(entry.get("description") or "").strip()
        emo_vec = entry.get("emo_vec")
        vec = ",".join(f"{float(v):.2g}" for v in (emo_vec or []))
        vec_text = f"emo_vec配置[{vec}]，后端强制优先使用" if emo_vec else "emo_vec未配置，LLM 必须输出"
        labels.append(
            f"{style_id}={entry.get('label')}; "
            f"style_alpha默认{float(entry.get('style_alpha')):.2g}; "
            f"emo_alpha默认{float(entry.get('emo_alpha')):.2g}; "
            f"{vec_text}"
            + (f"; {desc}" if desc else "")
        )
    return " / ".join(labels)


def known_roles_for_parse(req: Mapping[str, Any], voices: Mapping[str, Any] | None) -> list[str]:
    roles: list[str] = []

    def add(role: Any) -> None:
        role = str(role or "").strip()
        if role and role not in roles:
            roles.append(role)

    add("旁白")
    add("用户")
    for role in req.get("roles_hint") or []:
        role = str(role or "").strip()
        if role and role not in ("角色", "character", "当前角色", "我"):
            add(role)
    for role in (voices or {}).keys():
        if role != "default" and role not in ("角色", "character", "当前角色", "我"):
            add(role)
    character_name = str(req.get("character_name") or "").strip()
    if character_name:
        add(character_name)
    return roles


def render_profile_prompt_template(
    template: str,
    req: Mapping[str, Any],
    known_roles: Iterable[str],
    style_catalog: str,
    qwen_emo: bool = False,
) -> str:
    text_user = str(req.get("user_name") or "").strip()
    character_name = str(req.get("character_name") or "").strip()
    roles = [str(role).strip() for role in known_roles if str(role).strip()]
    roles_hint = "已知角色名单(LLM 输出 role 字段必须从这里选，或者用剧情里出现的新人物名):\n  " + " / ".join(roles)
    user_alias_hint = "用户身份名: " + (text_user or "未读取到") + "。只有原文中的「你」以及这个用户身份名明确指向玩家/读者时，role 才写 \"用户\"。"
    character_hint = "当前角色名: " + (character_name or "未读取到") + "。原文第一人称「我」通常指当前角色或正在自述的人物，不要因为出现「我」就改成用户。"
    example_user = text_user or "你"

    if qwen_emo:
        output_contract = "{\"segments\":[{\"role\":\"...\",\"text\":\"...\",\"emo_text\":\"...\"}]}"
        style_rules = "5. 当前后端启用 Qwen emotion。不要输出 style/style_alpha/emo_vec/emo_alpha，也不要输出声腔参考。"
        emotion_rules = "重要: 必须给每段输出 emo_text，写成简短自然语言情绪提示，例如「低声、克制、带一点哽咽」「轻松笑意、语速自然」。后端会把 emo_text 交给 IndexTTS2 的 QwenEmotion 生成情绪向量。"
        example_output = "\n".join(
            [
                "{\"segments\":[",
                "  {\"role\":\"旁白\",\"text\":\"她低着头，眼角有泪。\",\"emo_text\":\"低声叙述，情绪压抑，带一点心疼\"},",
                "  {\"role\":\"她\",\"text\":\"对不起，我真的撑不住了。\",\"emo_text\":\"哽咽、低落、快哭出来，但声音不要尖\"},",
                f"  {{\"role\":\"旁白\",\"text\":\"{example_user}叹了口气，把手放在她肩上：\",\"emo_text\":\"平静叙述，动作温柔\"}},",
                "  {\"role\":\"用户\",\"text\":\"别哭。\",\"emo_text\":\"压低声音、温柔安慰、语速慢\"}",
                "]}",
            ]
        )
    else:
        output_contract = "{\"segments\":[{\"role\":\"...\",\"text\":\"...\",\"style\":\"neutral\",\"style_alpha\":0.2}]}"
        style_rules = "5. style 是段级声腔/呼吸参考，只能从这个枚举里选: " + str(style_catalog or "")
        emotion_rules = "\n".join(
            [
                "声腔情绪向量由 active profile 的 style 配置优先决定；style 已配置 emo_vec 时，不要输出 emo_vec，后端会强制使用配置值。",
                "只有 style 枚举里明确写着 emo_vec未配置 时，才输出 8 维 emo_vec，顺序为 [happy,angry,sad,fear,hate,low,surprise,neutral]。",
                "每段可加 emo_alpha 字段做强度微调：旁白 0.12-0.22，平静对白 0.20-0.30，正常带情绪对白 0.32-0.44，强烈台词 0.46-0.52。",
                "style_alpha: neutral=0.12-0.20；轻微声腔=0.34-0.46；明显 breath/moan/呻吟/喘息=0.50-0.70。",
            ]
        )
        example_output = "\n".join(
            [
                "{\"segments\":[",
                "  {\"role\":\"旁白\",\"text\":\"她低着头，眼角有泪。\",\"style\":\"neutral\",\"style_alpha\":0.15},",
                "  {\"role\":\"她\",\"text\":\"对不起，我真的撑不住了。\",\"style\":\"sob_soft\",\"style_alpha\":0.42},",
                f"  {{\"role\":\"旁白\",\"text\":\"{example_user}叹了口气，把手放在她肩上：\",\"style\":\"neutral\",\"style_alpha\":0.15}},",
                "  {\"role\":\"用户\",\"text\":\"别哭。\",\"style\":\"whisper_soft\",\"style_alpha\":0.45}",
                "]}",
            ]
        )

    replacements = {
        "roles_hint": roles_hint,
        "user_alias_hint": user_alias_hint,
        "character_hint": character_hint,
        "output_contract": output_contract,
        "style_catalog": str(style_catalog or ""),
        "style_rules": style_rules,
        "emotion_rules": emotion_rules,
        "example_user": example_user,
        "example_output": example_output,
    }
    rendered = str(template or "")
    for key, value in replacements.items():
        rendered = rendered.replace("{{" + key + "}}", value)
    return rendered.strip()


__all__ = ["known_roles_for_parse", "render_profile_prompt_template", "style_catalog_for_prompt"]
