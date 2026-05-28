"""Lightweight OpenAI-compatible chat completion helpers for text parsing."""

from __future__ import annotations

import json
import math
import re
import urllib.error
import urllib.parse
import urllib.request
from collections.abc import Mapping, Sequence
from typing import Any


_FENCE_RE = re.compile(r"```[ \t]*(?:json)?[ \t]*\r?\n?(.*?)```", re.IGNORECASE | re.DOTALL)
_NARRATOR_ALIASES = {"旁白", "叙述", "正文", "narrator"}
_NARRATOR_CANONICAL = "旁白"
# 第二人称小说里「你」常代指读者/玩家角色；第一人称「我」常是角色自述，
# 不能归到用户。前端会把具体用户身份名也规范成「用户」。
_USER_ALIASES = {"你", "用户", "user", "you"}
_USER_CANONICAL = "用户"


def parse_text_openai_compatible(
    text: str,
    endpoint: str,
    model: str,
    api_key: str | None,
    system_prompt: str | None,
    temperature: float = 0.2,
    timeout: float = 60,
    max_tokens: int | None = None,
) -> dict[str, Any]:
    """Send text to an OpenAI-compatible chat endpoint and return normalized JSON."""

    messages: list[dict[str, str]] = []
    if system_prompt:
        messages.append({"role": "system", "content": system_prompt})
    messages.append({"role": "user", "content": text})

    payload = {
        "model": model,
        "temperature": temperature,
        "messages": messages,
        "response_format": {"type": "json_object"},
        # Some OpenAI-compatible proxies default to SSE streaming when this
        # field is omitted. We use urllib + a single read(), so force a
        # non-streaming response.
        "stream": False,
    }
    if max_tokens is not None:
        max_tokens = int(max(256, min(32000, max_tokens)))
        payload["max_tokens"] = max_tokens
    body = json.dumps(payload, ensure_ascii=False).encode("utf-8")

    headers = {
        "Content-Type": "application/json",
        "Accept": "application/json",
    }
    if api_key:
        headers["Authorization"] = f"Bearer {api_key}"

    request = urllib.request.Request(
        _normalize_chat_endpoint(endpoint),
        data=body,
        headers=headers,
        method="POST",
    )

    try:
        with urllib.request.urlopen(request, timeout=timeout) as response:
            response_text = response.read().decode("utf-8", errors="replace")
    except urllib.error.HTTPError as exc:
        detail = exc.read().decode("utf-8", errors="replace").strip()
        if api_key:
            detail = detail.replace(api_key, "***")
        if len(detail) > 500:
            detail = detail[:500] + "..."
        raise RuntimeError(f"LLM proxy request failed with HTTP {exc.code}: {detail}") from exc
    except urllib.error.URLError as exc:
        raise RuntimeError(f"LLM proxy request failed: {exc.reason}") from exc

    response_data = extract_json_object(response_text)
    content = _chat_message_content(response_data)
    parsed = extract_json_object(content) if content is not None else response_data
    return normalize_segments(parsed)


def extract_json_object(raw: Any) -> dict[str, Any]:
    """Extract a JSON object from a dict, pure JSON text, fenced JSON, or mixed text."""

    return _extract_json_object(raw, max_depth=3)


def normalize_segments(data: Any) -> dict[str, Any]:
    """Return a dict with normalized speaker/text segments and sanitized emotion fields."""

    if isinstance(data, Mapping):
        result: dict[str, Any] = dict(data)
        raw_segments = data.get("segments")
    elif isinstance(data, Sequence) and not isinstance(data, (str, bytes, bytearray)):
        result = {}
        raw_segments = data
    else:
        result = {}
        raw_segments = None

    normalized: list[dict[str, Any]] = []
    if isinstance(raw_segments, Sequence) and not isinstance(raw_segments, (str, bytes, bytearray)):
        for item in raw_segments:
            segment = _normalize_segment(item)
            if segment is not None:
                normalized.append(segment)

    result["segments"] = normalized
    return result


def _extract_json_object(raw: Any, max_depth: int) -> dict[str, Any]:
    if isinstance(raw, Mapping):
        return dict(raw)
    if isinstance(raw, bytes):
        raw = raw.decode("utf-8", errors="replace")
    if not isinstance(raw, str):
        raise ValueError("expected a JSON object or text containing one")

    text = raw.strip()
    if not text:
        raise ValueError("empty JSON text")

    loaded = _try_json_loads(text)
    if isinstance(loaded, Mapping):
        return dict(loaded)
    if isinstance(loaded, str) and max_depth > 0:
        try:
            return _extract_json_object(loaded, max_depth=max_depth - 1)
        except ValueError:
            pass

    for fenced in _FENCE_RE.findall(text):
        try:
            return _extract_json_object(fenced.strip(), max_depth=max_depth - 1)
        except ValueError:
            continue

    for candidate in _iter_json_object_candidates(text):
        loaded = _try_json_loads(candidate)
        if isinstance(loaded, Mapping):
            return dict(loaded)

    raise ValueError("no JSON object found")


def _try_json_loads(text: str) -> Any:
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        return None


def _iter_json_object_candidates(text: str) -> list[str]:
    candidates: list[str] = []
    for start, char in enumerate(text):
        if char != "{":
            continue
        depth = 0
        in_string = False
        escaped = False
        for index in range(start, len(text)):
            current = text[index]
            if in_string:
                if escaped:
                    escaped = False
                elif current == "\\":
                    escaped = True
                elif current == '"':
                    in_string = False
                continue

            if current == '"':
                in_string = True
            elif current == "{":
                depth += 1
            elif current == "}":
                depth -= 1
                if depth == 0:
                    candidates.append(text[start : index + 1])
                    break
    return candidates


def _normalize_segment(item: Any) -> dict[str, Any] | None:
    if not isinstance(item, Mapping):
        return None

    text_value = item.get("text")
    if text_value is None:
        return None
    text = str(text_value).strip()
    if not text:
        return None

    role = _normalize_role(item.get("role"))
    segment: dict[str, Any] = {
        "role": role,
        "text": text,
    }

    style = _normalize_text_field(item.get("style"))
    if style is None:
        style = _normalize_text_field(item.get("style_ref"))
    if style is not None:
        segment["style"] = style

    style_ref = _normalize_text_field(item.get("style_ref"))
    if style_ref is not None:
        segment["style_ref"] = style_ref

    style_alpha = _normalize_unit_float(item.get("style_alpha"))
    if style_alpha is not None:
        segment["style_alpha"] = style_alpha

    emo_ref_audio_path = _normalize_text_field(item.get("emo_ref_audio_path"))
    if emo_ref_audio_path is not None:
        segment["emo_ref_audio_path"] = emo_ref_audio_path

    emo_vec = _normalize_emo_vec(item.get("emo_vec"))
    if emo_vec is not None:
        segment["emo_vec"] = emo_vec

    emo_text = item.get("emo_text")
    if emo_text is not None:
        cleaned_emo_text = str(emo_text).strip()
        if cleaned_emo_text:
            segment["emo_text"] = cleaned_emo_text

    emo_alpha = _normalize_unit_float(item.get("emo_alpha"))
    if emo_alpha is not None:
        segment["emo_alpha"] = emo_alpha

    return segment


def _normalize_role(value: Any) -> str:
    role = str(value).strip() if value is not None else _NARRATOR_CANONICAL
    lowered = role.lower()
    if lowered in _NARRATOR_ALIASES:
        return _NARRATOR_CANONICAL
    if lowered in _USER_ALIASES:
        return _USER_CANONICAL
    return role or _NARRATOR_CANONICAL


def _normalize_emo_vec(value: Any) -> list[float] | None:
    if not isinstance(value, Sequence) or isinstance(value, (str, bytes, bytearray)):
        return None
    if len(value) != 8:
        return None

    cleaned: list[float] = []
    for item in value:
        number = _finite_float(item)
        if number is None:
            return None
        cleaned.append(_clip_unit(number))
    return cleaned


def _normalize_unit_float(value: Any) -> float | None:
    number = _finite_float(value)
    if number is None:
        return None
    return _clip_unit(number)


def _normalize_text_field(value: Any) -> str | None:
    if value is None:
        return None
    text = str(value).strip()
    return text or None


def _finite_float(value: Any) -> float | None:
    if isinstance(value, bool):
        return None
    try:
        number = float(value)
    except (TypeError, ValueError):
        return None
    if not math.isfinite(number):
        return None
    return number


def _clip_unit(value: float) -> float:
    return max(0.0, min(1.0, value))


def _chat_message_content(data: Mapping[str, Any]) -> Any | None:
    choices = data.get("choices")
    if not isinstance(choices, Sequence) or isinstance(choices, (str, bytes, bytearray)):
        return None
    if not choices:
        return None

    first = choices[0]
    if not isinstance(first, Mapping):
        return None

    message = first.get("message")
    if isinstance(message, Mapping) and "content" in message:
        return message["content"]
    if "text" in first:
        return first["text"]
    return None


def _normalize_chat_endpoint(endpoint: str) -> str:
    endpoint = endpoint.strip()
    if not endpoint:
        raise ValueError("endpoint is required")

    parsed = urllib.parse.urlparse(endpoint)
    path = parsed.path.rstrip("/")
    if path.endswith("/chat/completions"):
        return endpoint

    if path in ("", "/v1") or path.endswith("/v1"):
        suffix = "chat/completions" if path.endswith("/v1") else "v1/chat/completions"
        base = endpoint.rstrip("/")
        return f"{base}/{suffix}"

    return endpoint


__all__ = [
    "extract_json_object",
    "normalize_segments",
    "parse_text_openai_compatible",
]
