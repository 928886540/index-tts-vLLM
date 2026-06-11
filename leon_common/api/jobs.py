"""Shared job/status contracts for LEON API backends.

This module owns API-side orchestration that is the same for every engine.
Actual model loading and segment inference stay behind engine-local callables.
"""

from __future__ import annotations

import asyncio
import time
import traceback
from typing import Callable, Optional, Protocol

from fastapi.responses import JSONResponse


class TtsEngineAdapter(Protocol):
    """Boundary for engine-specific code.

    Common API code may coordinate jobs, cache, and status. Engine packages
    own model loading, warmup, resource probes, and actual segment inference.
    """

    engine_id: str

    def health_extra(self) -> dict: ...

    async def warmup(self, request: dict) -> dict: ...

    async def infer_segment(self, segment: dict, controls: dict) -> dict: ...


def dialogue_job_response(cache_key: str, cached: bool, live: bool, expires_in: int):
    return JSONResponse(content={
        "job_id": cache_key,
        "cache_key": cache_key,
        "url": f"/tts_dialogue_stream_job/{cache_key}",
        "cache_url": f"/cache_audio/{cache_key}",
        "cached": bool(cached),
        "live": bool(live),
        "expires_in": int(expires_in),
    })


def mark_job_cancelled(job, message: str = "任务已取消") -> None:
    if not job:
        return
    job.cancelled = True
    job.error = None
    job.metrics["state"] = "cancelled"
    job.metrics["phase"] = "cancelled"
    job.metrics["message"] = message


class TtsQueue:
    def __init__(self, lock):
        self.lock = lock
        self.waiting = []
        self.active = None
        self.seq = 0

    def _next_id(self) -> int:
        self.seq += 1
        return self.seq

    def item(self, kind: str, cache_key: str = "") -> dict:
        return {
            "id": self._next_id(),
            "kind": str(kind or "tts"),
            "cache_key": str(cache_key or ""),
            "queued_at": time.time(),
            "perf_queued_at": time.perf_counter(),
        }

    def remove_waiter(self, item: dict) -> None:
        try:
            self.waiting.remove(item)
        except ValueError:
            pass

    def snapshot(self, cache_key: str = "", item: Optional[dict] = None) -> dict:
        target_id = item.get("id") if item else None
        target_key = str(cache_key or (item.get("cache_key") if item else "") or "")
        active = self.active
        waiting = list(self.waiting)
        active_count = 1 if active else 0
        matched = None
        is_active = False
        is_waiting = False
        ahead_waiting = 0

        def _matches(cur: Optional[dict]) -> bool:
            if not cur:
                return False
            if target_id is not None and cur.get("id") == target_id:
                return True
            return bool(target_key and cur.get("cache_key") == target_key)

        if _matches(active):
            matched = active
            is_active = True
        else:
            for cur in waiting:
                if _matches(cur):
                    matched = cur
                    is_waiting = True
                    break
                ahead_waiting += 1

        if is_active:
            ahead = 0
            position = 1
        elif is_waiting:
            ahead = ahead_waiting + active_count
            position = ahead + 1
        else:
            ahead = None
            position = None

        wait_s = None
        if matched and matched.get("perf_queued_at") is not None:
            wait_s = round(max(0.0, time.perf_counter() - float(matched["perf_queued_at"])), 3)
        return {
            "queue_ahead": ahead,
            "queue_position": position,
            "queue_size": active_count + len(waiting),
            "queue_waiting": len(waiting),
            "queue_active": bool(active),
            "queue_active_kind": active.get("kind") if active else "",
            "queue_wait_s": wait_s,
        }

    @staticmethod
    def write_metrics(metrics: Optional[dict], snapshot: dict) -> None:
        if not isinstance(metrics, dict):
            return
        if snapshot.get("queue_ahead") is None:
            return
        for key in ("queue_ahead", "queue_position", "queue_size", "queue_waiting", "queue_active", "queue_active_kind", "queue_wait_s"):
            metrics[key] = snapshot.get(key)

    def refresh_job_metrics(self, job) -> None:
        if not job:
            return
        self.write_metrics(job.metrics, self.snapshot(cache_key=job.cache_key))

    def slot(self, kind: str = "tts", cache_key: str = "", metrics: Optional[dict] = None):
        return _TtsInferenceSlot(self, kind=kind, cache_key=cache_key, metrics=metrics)


class _TtsInferenceSlot:
    def __init__(self, queue: TtsQueue, kind: str = "tts", cache_key: str = "", metrics: Optional[dict] = None):
        self.queue = queue
        self.item = queue.item(kind, cache_key)
        self.metrics = metrics
        self.acquired = False

    async def __aenter__(self):
        self.queue.waiting.append(self.item)
        self.queue.write_metrics(self.metrics, self.queue.snapshot(item=self.item))
        try:
            await self.queue.lock.acquire()
        except BaseException:
            self.queue.remove_waiter(self.item)
            self.queue.write_metrics(self.metrics, self.queue.snapshot(item=self.item))
            raise
        self.acquired = True
        self.queue.remove_waiter(self.item)
        self.item["acquired_at"] = time.time()
        self.item["perf_acquired_at"] = time.perf_counter()
        self.queue.active = self.item
        self.queue.write_metrics(self.metrics, self.queue.snapshot(item=self.item))
        if isinstance(self.metrics, dict):
            self.metrics["lock_wait_s"] = round(
                max(0.0, float(self.item["perf_acquired_at"]) - float(self.item["perf_queued_at"])),
                3,
            )
        return self

    async def __aexit__(self, exc_type, exc, tb):
        if self.acquired:
            if self.queue.active and self.queue.active.get("id") == self.item.get("id"):
                self.queue.active = None
            self.queue.lock.release()
        else:
            self.queue.remove_waiter(self.item)
        return False


def dialogue_job_start_response(
    req: dict,
    prepared: dict,
    live_jobs: dict,
    get_cached_audio: Callable[..., Optional[str]],
    create_job: Callable[[str], object],
    run_job: Callable[[object, dict], object],
    expires_in: int,
):
    cache_key = prepared["cache_key"]
    bypass_cache = bool(req.get("bypass_cache", False))
    cached_path = None if bypass_cache else get_cached_audio(cache_key)
    if cached_path:
        return dialogue_job_response(cache_key, cached=True, live=False, expires_in=expires_in)

    live = live_jobs.get(cache_key)
    if live:
        if getattr(live, "cancelled", False) or getattr(live, "metrics", {}).get("state") == "cancelled":
            live_jobs.pop(cache_key, None)
        else:
            return dialogue_job_response(cache_key, cached=False, live=True, expires_in=expires_in)

    job = create_job(cache_key)
    live_jobs[cache_key] = job
    asyncio.create_task(run_job(job, prepared))
    return dialogue_job_response(cache_key, cached=False, live=True, expires_in=expires_in)


def cached_job_status(cache_key: str, get_cached_audio: Callable[..., Optional[str]], read_cache_metadata: Callable[[str], dict]) -> Optional[dict]:
    cached_path = get_cached_audio(cache_key)
    if not cached_path:
        return None
    meta = read_cache_metadata(cache_key)
    params = meta.get("params") if isinstance(meta.get("params"), dict) else meta
    metrics = params.get("metrics") or meta.get("metrics") or {}
    segments_meta = params.get("segments_meta") or meta.get("segments_meta") or []
    return {
        "state": "done",
        "cache_key": cache_key,
        "cache_url": f"/cache_audio/{cache_key}",
        "segments_done": len(segments_meta),
        "segments_meta": segments_meta,
        "segments_plan": params.get("segments_plan") or meta.get("segments_plan") or metrics.get("segments_plan") or [],
        "sample_rate": params.get("sample_rate") or meta.get("sample_rate") or 22050,
        "duration_s": params.get("duration_s") or meta.get("duration_s"),
        "metrics": metrics,
        "error": None,
    }


def live_job_status_content(cache_key: str, job) -> dict:
    if getattr(job, "cancelled", False) or job.metrics.get("state") == "cancelled":
        state = "cancelled"
    else:
        state = "failed" if job.error else ("done" if job.finished.is_set() else "running")
    return {
        "state": state,
        "cache_key": cache_key,
        "cache_url": f"/cache_audio/{cache_key}",
        "pcm_bytes": len(job.pcm),
        "segments_done": len(job.segments_meta),
        "segments_meta": job.segments_meta,
        "segments_plan": job.metrics.get("segments_plan") or [],
        "sample_rate": job.sample_rate,
        "duration_s": job.metrics.get("audio_duration_s") or 0.0,
        "metrics": job.metrics,
        "error": job.error,
    }


def dialogue_job_status_response(
    cache_key: str,
    live_jobs: dict,
    get_cached_audio: Callable[..., Optional[str]],
    read_cache_metadata: Callable[[str], dict],
    refresh_live_job_metrics: Optional[Callable[[object], None]] = None,
    refresh_llm_metrics: Optional[Callable[[Optional[dict]], None]] = None,
):
    job = live_jobs.get(cache_key)
    if job:
        if refresh_live_job_metrics:
            refresh_live_job_metrics(job)
        if refresh_llm_metrics:
            refresh_llm_metrics(job.metrics)
        return JSONResponse(content=live_job_status_content(cache_key, job))
    cached = cached_job_status(cache_key, get_cached_audio, read_cache_metadata)
    if cached:
        return JSONResponse(content=cached)
    return JSONResponse(status_code=404, content={"state": "missing", "cache_key": cache_key})


def dialogue_job_delete_response(
    job_id: str,
    preserve_completed: bool,
    live_jobs: dict,
    get_cached_audio: Callable[..., Optional[str]],
    delete_cache: Callable[[str], bool],
    gc_live_job: Callable[..., None],
    suppress_delete_errors: bool = False,
):
    try:
        live = live_jobs.get(job_id)
        cached_path = get_cached_audio(job_id)
        if preserve_completed and cached_path:
            return JSONResponse(content={
                "cancelled_live": False,
                "deleted": False,
                "preserved": True,
                "state": "done",
                "cache_key": job_id,
                "cache_url": f"/cache_audio/{job_id}",
            })
        if preserve_completed and live:
            phase = str(live.metrics.get("phase") or live.metrics.get("state") or "")
            segments_total = int(live.metrics.get("segments_total") or len(live.metrics.get("segments_plan") or []) or 0)
            segments_done = int(live.metrics.get("segments_done") or len(live.segments_meta or []) or 0)
            all_segments_done = bool(segments_total > 0 and segments_done >= segments_total and len(live.pcm) > 0)
            if live.finished.is_set() or phase in ("saving", "done") or all_segments_done:
                state = "done" if live.finished.is_set() or phase == "done" else "saving"
                return JSONResponse(content={
                    "cancelled_live": False,
                    "deleted": False,
                    "preserved": True,
                    "state": state,
                    "cache_key": job_id,
                    "cache_url": f"/cache_audio/{job_id}",
                    "metrics": live.metrics,
                })
        if live:
            mark_job_cancelled(live)
            live.finished.set()
            gc_live_job(job_id, delay=30, expected_job=live)
        try:
            deleted = delete_cache(job_id)
        except Exception:
            if not suppress_delete_errors:
                raise
            deleted = False
        return JSONResponse(content={
            "cancelled_live": bool(live),
            "deleted": bool(deleted),
            "preserved": False,
            "state": "cancelled" if live else "missing",
            "cache_key": job_id,
        })
    except Exception as exc:
        traceback.print_exc()
        return JSONResponse(status_code=400, content={"message": "dialogue job delete failed", "Exception": str(exc), "cache_key": job_id})
