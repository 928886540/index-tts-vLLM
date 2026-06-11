"""Shared HTTP contract handlers for the LEON API backends."""

from __future__ import annotations

import json
import os
import time
import traceback
from typing import Callable, Optional

from fastapi import Response
from fastapi.responses import FileResponse, JSONResponse

from leon_common.cache_contracts import cache_audio_headers, media_type_for_audio_path
from leon_common.profile_config import validate_active_profile


NO_STORE_HEADERS = {"Cache-Control": "no-store, no-cache, must-revalidate, max-age=0"}
NO_STORE_JS_HEADERS = {
    "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0",
    "Pragma": "no-cache",
    "Expires": "0",
}


def static_file_path(static_dir: Optional[str], name: str) -> Optional[str]:
    if not static_dir:
        return None
    root = os.path.abspath(static_dir)
    path = os.path.abspath(os.path.join(root, name))
    if os.path.commonpath([root, path]) != root:
        return None
    return path if os.path.isfile(path) else None


def static_file_response(
    static_dir: Optional[str],
    name: str,
    media_type: str,
    not_found_message: str,
    headers: Optional[dict] = None,
):
    path = static_file_path(static_dir, name)
    if not path:
        return JSONResponse(status_code=404, content={"message": not_found_message, "static_dir": static_dir})
    return FileResponse(path, media_type=media_type, headers=headers or NO_STORE_HEADERS)


def static_file_head_response(
    static_dir: Optional[str],
    name: str,
    media_type: str,
    headers: Optional[dict] = None,
):
    path = static_file_path(static_dir, name)
    exists = bool(path and os.path.exists(path))
    response_headers = dict(headers or NO_STORE_HEADERS)
    response_headers["Content-Length"] = str(os.path.getsize(path)) if exists else "0"
    return Response(status_code=200 if exists else 404, media_type=media_type, headers=response_headers)


def static_tavo_js_response(static_dir: Optional[str]):
    return static_file_response(
        static_dir,
        "tavo.js",
        "text/javascript; charset=utf-8",
        "static/tavo.js not found",
        NO_STORE_JS_HEADERS,
    )


def tavo_test_response(static_dir: Optional[str]):
    return static_file_response(
        static_dir,
        "tavo_widget_test.html",
        "text/html; charset=utf-8",
        "static/tavo_widget_test.html not found",
        NO_STORE_HEADERS,
    )


def tavo_test_head_response(static_dir: Optional[str]):
    return static_file_head_response(static_dir, "tavo_widget_test.html", "text/html", NO_STORE_HEADERS)


def server_log_tail_response(
    log_buffer,
    n: int = 100,
    since: float = 0.0,
    filter_text: Optional[str] = None,
    max_n: Optional[int] = None,
    case_sensitive_filter: bool = False,
):
    try:
        requested = int(n or 100)
    except Exception:
        requested = 100
    items = list(log_buffer)
    try:
        cap = len(items) if max_n is None else max(1, int(max_n))
    except Exception:
        cap = len(items)
    limit = max(1, min(requested, cap))
    try:
        since_value = float(since or 0.0)
    except Exception:
        since_value = 0.0
    needle = str(filter_text or "")
    needle_cmp = needle if case_sensitive_filter else needle.lower()
    lines = []
    for item in items:
        try:
            ts = float(item.get("ts") or 0)
        except Exception:
            ts = 0.0
        if since_value and ts <= since_value:
            continue
        if needle:
            line = str(item.get("line") or "")
            haystack = line if case_sensitive_filter else line.lower()
            if needle_cmp not in haystack:
                continue
        lines.append(item)
    return JSONResponse(content={"lines": lines[-limit:], "now": time.time()})


def load_active_profile(active_profile_path: str) -> dict:
    """Load and strictly validate the active launcher profile."""
    if not os.path.isfile(active_profile_path):
        raise FileNotFoundError(f"Profile 配置错误: active profile 不存在: {active_profile_path}")
    with open(active_profile_path, "r", encoding="utf-8") as fp:
        profile = json.load(fp)
    if not isinstance(profile, dict):
        raise ValueError("Profile 配置错误: active profile 必须是 JSON object")
    validate_active_profile(profile)
    return profile


def active_profile_response(load_profile: Callable[[], dict]):
    try:
        return JSONResponse(content=load_profile(), headers=NO_STORE_HEADERS)
    except Exception as exc:
        traceback.print_exc()
        return JSONResponse(status_code=400, content={"message": "active profile load failed", "Exception": str(exc)})


def voices_list_response(list_voices: Callable[[], list]):
    try:
        return JSONResponse(content={"voices": list_voices()})
    except Exception as exc:
        traceback.print_exc()
        return JSONResponse(status_code=400, content={"message": "voices list failed", "Exception": str(exc)})


def cache_audio_get_response(key: str, audio_format: Optional[str], get_cached_audio: Callable[..., Optional[str]]):
    try:
        path = get_cached_audio(key, format=audio_format)
        if not path or not os.path.exists(path):
            return JSONResponse(status_code=404, content={"message": "cache miss", "key": key})
        return FileResponse(
            path,
            media_type=media_type_for_audio_path(path),
            headers=cache_audio_headers(key, path),
        )
    except Exception as exc:
        traceback.print_exc()
        return JSONResponse(status_code=400, content={"message": "cache audio failed", "Exception": str(exc)})


def cache_audio_head_response(key: str, audio_format: Optional[str], get_cached_audio: Callable[..., Optional[str]]):
    try:
        path = get_cached_audio(key, format=audio_format)
        if not path or not os.path.exists(path):
            return Response(status_code=404, headers={"X-IndexTTS-Cache": "MISS", "X-IndexTTS-Cache-Key": key})
        return Response(
            status_code=200,
            media_type=media_type_for_audio_path(path),
            headers=cache_audio_headers(key, path, {"Content-Length": str(os.path.getsize(path))}),
        )
    except Exception as exc:
        traceback.print_exc()
        return Response(status_code=400, headers={"X-IndexTTS-Error": str(exc)})
