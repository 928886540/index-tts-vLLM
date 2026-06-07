import argparse
import json
import subprocess
import sys
import time
import urllib.error
import urllib.request
from datetime import datetime
from pathlib import Path

"""Benchmark vLLM with a fixed dialogue sample.

Generated JSON/JSONL/log outputs are written under dev_workspace/benchmarks/
and intentionally stay untracked.

Default mode uses the API that is already running, typically started by the
root launcher. Use --restart-service explicitly when changing vLLM ratio.
"""

ROOT = Path(__file__).resolve().parents[2]
SOURCE_JSON = ROOT / "vllm" / "outputs" / "cache" / "by_role" / "甘婷婷" / "20260606-013108-395_263429152dd8dcd2b2715e80672dbdd93ee9a406.json"
OUT_DIR = ROOT / "dev_workspace" / "benchmarks"

API = "http://127.0.0.1:9880"
RATIOS = [0.11, 0.15, 0.20, 0.25]
RUNS_PER_RATIO = 3
RESTART_SERVICE = False
FAIL_FAST = True
MAX_IDLE_GPU_MIB = 10500
MAX_WARMUP_GPU_MIB = 11200
MAX_RUN_GPU_MIB = 11200
MAX_RTF = 2.0
MAX_WARMUP_SECONDS = 90
MAX_JOB_SECONDS = 240

VOICE_MAP = {
    "default": "400个火爆音色/短剧解说",
    "旁白": "400个火爆音色/短剧解说",
    "甘婷婷": "声腔/低吟-步非烟",
    "用户": "400个火爆音色/蔡徐坤",
}

GENERATION_PARAMS = {
    "parse_mode": "ai",
    "performance_mode": "expressive",
    "interval_ms": 350,
    "top_p": 0.8,
    "top_k": 30,
    "temperature": 0.7,
    "repetition_penalty": 1.2,
    "emo_alpha": 0.55,
    "diffusion_steps": 16,
    "prompt_audio_seconds": 12,
    "segment_tokens": 72,
    "first_tokens": 24,
    "s2mel_cfg_rate": 0.7,
    "bypass_cache": True,
}


def log(message: str) -> None:
    print(f"[{datetime.now().strftime('%H:%M:%S')}] {message}", flush=True)


def ratio_label(value) -> str:
    if isinstance(value, float):
        return f"{value:.2f}"
    return str(value)


def ratio_slug(value) -> str:
    text = ratio_label(value).strip() or "current"
    safe = []
    for ch in text:
        safe.append(ch if ch.isalnum() else "_")
    return "".join(safe).strip("_") or "current"


def append_jsonl(path: Path, record) -> None:
    with path.open("a", encoding="utf-8") as fp:
        fp.write(json.dumps(record, ensure_ascii=False) + "\n")


def http_json(method: str, path: str, payload=None, timeout=30):
    data = None
    headers = {}
    if payload is not None:
        data = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        headers["Content-Type"] = "application/json"
    req = urllib.request.Request(API + path, data=data, headers=headers, method=method)
    with urllib.request.urlopen(req, timeout=timeout) as response:
        body = response.read()
        if not body:
            return {}
        return json.loads(body.decode("utf-8"))


def gpu_snapshot():
    cmd = [
        "nvidia-smi",
        "--query-gpu=memory.used,memory.total,utilization.gpu,temperature.gpu,power.draw",
        "--format=csv,noheader,nounits",
    ]
    try:
        out = subprocess.check_output(cmd, text=True, stderr=subprocess.STDOUT).strip()
        parts = [p.strip() for p in out.split(",")]
        return {
            "memory_used_mib": int(float(parts[0])),
            "memory_total_mib": int(float(parts[1])),
            "utilization_gpu_pct": int(float(parts[2])),
            "temperature_c": int(float(parts[3])),
            "power_w": float(parts[4]) if len(parts) > 4 and parts[4] else None,
        }
    except Exception as exc:
        return {"error": str(exc)}


def _first_positive_int(text: str):
    for token in (text or "").replace("\r", "\n").split():
        try:
            value = int(token)
        except ValueError:
            continue
        if value > 0:
            return value
    return None


def _listening_pid_from_netstat(port: int):
    try:
        out = subprocess.check_output(["netstat", "-ano", "-p", "tcp"], text=True, stderr=subprocess.STDOUT)
    except Exception:
        return None
    suffix = f":{port}"
    for raw_line in out.splitlines():
        line = raw_line.strip()
        if "LISTENING" not in line:
            continue
        parts = line.split()
        if len(parts) < 5:
            continue
        local = parts[1]
        if local.endswith(suffix):
            try:
                return int(parts[-1])
            except ValueError:
                return None
    return None


def api_processes():
    port = 9880
    ps = (
        f"Get-NetTCPConnection -LocalPort {port} -State Listen -ErrorAction SilentlyContinue | "
        "Select-Object -First 1 -ExpandProperty OwningProcess"
    )
    try:
        api_pid_text = subprocess.check_output(
            ["powershell.exe", "-NoProfile", "-Command", ps],
            text=True,
            stderr=subprocess.DEVNULL,
        ).strip()
        api_pid = _first_positive_int(api_pid_text)
    except Exception:
        api_pid = None
    if not api_pid:
        api_pid = _listening_pid_from_netstat(port)
    worker_pid = None
    if api_pid:
        ps_worker = (
            f"Get-CimInstance Win32_Process -ErrorAction SilentlyContinue | "
            f"Where-Object {{ $_.ParentProcessId -eq {api_pid} -and $_.CommandLine -like '*multiprocessing.spawn*' }} | "
            "Select-Object -First 1 -ExpandProperty ProcessId"
        )
        try:
            worker_text = subprocess.check_output(
                ["powershell.exe", "-NoProfile", "-Command", ps_worker],
                text=True,
                stderr=subprocess.DEVNULL,
            ).strip()
            worker_pid = _first_positive_int(worker_text)
        except Exception:
            worker_pid = None
    return {"api_pid": api_pid, "worker_pid": worker_pid}


def wait_health(timeout=300):
    deadline = time.time() + timeout
    last_error = None
    while time.time() < deadline:
        try:
            return http_json("GET", "/health", timeout=10)
        except Exception as exc:
            last_error = exc
            time.sleep(3)
    raise RuntimeError(f"health timeout: {last_error}")


def require_vllm_health(health):
    version = (health or {}).get("version")
    engine = (health or {}).get("engine")
    if version != "vllm" and engine != "vllm":
        raise RuntimeError(f"expected vLLM API on {API}, got version={version!r} engine={engine!r}")


def recent_fatal_startup_error(started_at: float):
    log_dir = ROOT / "logs" / "vllm"
    if not log_dir.exists():
        return None
    patterns = (
        "No available memory for the cache blocks",
        "Error in memory profiling",
        "EngineCore failed to start",
        "EngineCore encountered an issue",
    )
    for path in sorted(log_dir.glob("api_restart_stable_*.err"), key=lambda p: p.stat().st_mtime, reverse=True):
        try:
            if path.stat().st_mtime < started_at - 5:
                continue
            text = path.read_text(encoding="utf-8", errors="ignore")
        except OSError:
            continue
        for pattern in patterns:
            if pattern in text:
                return f"{path.name}: {pattern}"
    return None


def require_gpu_below(stage: str, snapshot, limit_mib: int):
    if not FAIL_FAST or not limit_mib:
        return
    used = snapshot.get("memory_used_mib") if isinstance(snapshot, dict) else None
    if used is not None and used > limit_mib:
        raise RuntimeError(f"{stage} GPU memory too high: {used}MiB > {limit_mib}MiB")


def restart_vllm(ratio: float):
    log(f"restart vLLM ratio={ratio}")
    before = api_processes()
    script = ROOT / "vllm" / "tools" / "restart_indextts_api.ps1"
    cmd = [
        "powershell.exe",
        "-NoProfile",
        "-ExecutionPolicy",
        "Bypass",
        "-File",
        str(script),
        "-Port",
        "9880",
        "-HostAddress",
        "0.0.0.0",
        "-LeonRoot",
        str(ROOT),
        "-VllmGpuMemoryUtilization",
        str(ratio),
        "-Retries",
        "1",
        "-MaxWaitSeconds",
        "300",
    ]
    env = None
    wall_started = time.time()
    started = time.perf_counter()
    proc = subprocess.Popen(cmd, cwd=str(ROOT), text=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE, env=env)
    stdout = ""
    stderr = ""
    try:
        stdout, stderr = proc.communicate(timeout=120)
    except subprocess.TimeoutExpired:
        # On Windows the restart PowerShell can keep a console handle alive even
        # after the API is healthy. Treat health as the source of truth, then
        # stop waiting on the wrapper process.
        try:
            health = wait_health(timeout=10)
        except Exception:
            proc.kill()
            stdout, stderr = proc.communicate(timeout=10)
            elapsed = round(time.perf_counter() - started, 3)
            raise RuntimeError(f"restart timed out ratio={ratio} elapsed={elapsed}s stdout={stdout[-1000:]} stderr={stderr[-1000:]}")
        proc.kill()
        try:
            proc.communicate(timeout=10)
        except Exception:
            pass
        elapsed = round(time.perf_counter() - started, 3)
        result = {"elapsed_s": elapsed, "health": health, "wrapper_timeout": True, **api_processes(), "gpu": gpu_snapshot()}
        validate_restart_result(ratio, before, result, wall_started)
        return result
    elapsed = round(time.perf_counter() - started, 3)
    if proc.returncode != 0:
        raise RuntimeError(f"restart failed ratio={ratio} rc={proc.returncode} elapsed={elapsed}s stdout={stdout[-1000:]} stderr={stderr[-1000:]}")
    health = wait_health(timeout=60)
    result = {"elapsed_s": elapsed, "health": health, **api_processes(), "gpu": gpu_snapshot()}
    validate_restart_result(ratio, before, result, wall_started)
    return result


def validate_restart_result(ratio: float, before, result, started_at: float):
    api_pid = result.get("api_pid")
    before_pid = (before or {}).get("api_pid")
    if not api_pid:
        raise RuntimeError(f"restart ratio={ratio} returned healthy API but no listening PID was detected")
    if before_pid and api_pid == before_pid:
        raise RuntimeError(f"restart ratio={ratio} did not replace API PID: still {api_pid}")
    fatal = recent_fatal_startup_error(started_at)
    if fatal:
        raise RuntimeError(f"restart ratio={ratio} saw fatal vLLM startup error: {fatal}")
    require_gpu_below(f"restart ratio={ratio}", result.get("gpu") or {}, MAX_IDLE_GPU_MIB)


def load_segments():
    with SOURCE_JSON.open("r", encoding="utf-8") as fp:
        source = json.load(fp)
    segments = []
    for item in source.get("segments_meta") or []:
        role = str(item.get("role") or "").strip()
        text = str(item.get("text") or "").strip()
        if role and text:
            segments.append({"role": role, "text": text})
    if not segments:
        raise RuntimeError("no usable segments")
    return source, segments


def resolve_voice_names():
    voices = http_json("GET", "/voices", timeout=30).get("voices") or []
    names = {item.get("name") for item in voices}
    missing = sorted(set(VOICE_MAP.values()) - names)
    if missing:
        raise RuntimeError(f"voice names not found in /voices: {missing}")
    return {name: next(v for v in voices if v.get("name") == name).get("path") for name in sorted(set(VOICE_MAP.values()))}


def warmup(ratio: float):
    payload = {"text": "你好。", "voice": VOICE_MAP["旁白"], "force": True}
    started = time.perf_counter()
    result = http_json("POST", "/warmup", payload=payload, timeout=MAX_WARMUP_SECONDS)
    result["client_elapsed_s"] = round(time.perf_counter() - started, 3)
    result["gpu_after"] = gpu_snapshot()
    log(f"warmup ratio={ratio_label(ratio)} status={result.get('status')} elapsed={result.get('elapsed_s')} gpu={result['gpu_after'].get('memory_used_mib')}MiB")
    require_gpu_below(f"warmup ratio={ratio_label(ratio)}", result["gpu_after"], MAX_WARMUP_GPU_MIB)
    return result


def run_job(ratio: float, run_idx: int, segments, out_jsonl: Path):
    nonce = f"vllm-ratio-{ratio_slug(ratio)}-run-{run_idx}-{int(time.time() * 1000)}"
    payload = {
        **GENERATION_PARAMS,
        "voices": VOICE_MAP,
        "segments": segments,
        "cache_nonce": nonce,
    }
    record = {
        "ratio": ratio,
        "run_idx": run_idx,
        "cache_nonce": nonce,
        "request": {k: v for k, v in payload.items() if k != "segments"},
        "segments_count": len(segments),
        "gpu_before": gpu_snapshot(),
        **api_processes(),
    }
    started = time.perf_counter()
    cache_key = None
    try:
        created = http_json("POST", "/tts_dialogue_stream_job", payload=payload, timeout=60)
        record["job_create"] = created
        cache_key = created.get("cache_key")
        if not cache_key:
            raise RuntimeError(f"missing cache_key: {created}")
        log(f"job start ratio={ratio_label(ratio)} run={run_idx} key={cache_key} gpu={record['gpu_before'].get('memory_used_mib')}MiB")
        max_gpu = dict(record["gpu_before"])
        last_report = 0.0
        while True:
            status = http_json("GET", f"/tts_dialogue_job_status/{cache_key}", timeout=30)
            snap = gpu_snapshot()
            if snap.get("memory_used_mib", 0) > max_gpu.get("memory_used_mib", 0):
                max_gpu = snap
            state = status.get("state")
            metrics = status.get("metrics") or {}
            elapsed = time.perf_counter() - started
            if FAIL_FAST and snap.get("memory_used_mib") is not None and snap["memory_used_mib"] > MAX_RUN_GPU_MIB:
                reason = f"GPU memory guard tripped: {snap['memory_used_mib']}MiB > {MAX_RUN_GPU_MIB}MiB"
                log(f"job abort ratio={ratio_label(ratio)} run={run_idx}: {reason}")
                try:
                    http_json("DELETE", f"/tts_dialogue_stream_job/{cache_key}", timeout=30)
                    status = http_json("GET", f"/tts_dialogue_job_status/{cache_key}", timeout=30)
                except Exception as cancel_exc:
                    record["cancel_error"] = repr(cancel_exc)
                record["status"] = status
                record["state"] = "aborted"
                record["error"] = reason
                record["abort_remaining"] = reason
                break
            if MAX_JOB_SECONDS and elapsed > MAX_JOB_SECONDS:
                reason = f"job wall-time guard tripped: {elapsed:.1f}s > {MAX_JOB_SECONDS}s"
                log(f"job abort ratio={ratio_label(ratio)} run={run_idx}: {reason}")
                try:
                    http_json("DELETE", f"/tts_dialogue_stream_job/{cache_key}", timeout=30)
                    status = http_json("GET", f"/tts_dialogue_job_status/{cache_key}", timeout=30)
                except Exception as cancel_exc:
                    record["cancel_error"] = repr(cancel_exc)
                record["status"] = status
                record["state"] = "aborted"
                record["error"] = reason
                record["abort_remaining"] = reason
                break
            if elapsed - last_report >= 30:
                log(
                    f"job poll ratio={ratio_label(ratio)} run={run_idx} state={state} "
                    f"segments={metrics.get('segments_done')}/{metrics.get('segments_total')} "
                    f"elapsed={elapsed:.0f}s gpu={snap.get('memory_used_mib')}MiB"
                )
                last_report = elapsed
            if state in ("done", "failed", "cancelled"):
                record["status"] = status
                record["state"] = state
                break
            time.sleep(5)
        record["client_elapsed_s"] = round(time.perf_counter() - started, 3)
        record["gpu_after"] = gpu_snapshot()
        record["gpu_peak"] = max_gpu
        metrics = (record.get("status") or {}).get("metrics") or {}
        if FAIL_FAST and record.get("state") in ("failed", "cancelled") and not record.get("abort_remaining"):
            reason = f"job ended with state={record.get('state')}"
            error_text = (record.get("status") or {}).get("error")
            if error_text:
                reason = f"{reason}: {error_text}"
            record["abort_remaining"] = reason
            log(f"job abnormal ratio={ratio_label(ratio)} run={run_idx}: {reason}")
        if FAIL_FAST and record.get("state") == "done":
            rtf = metrics.get("rtf")
            if rtf is not None and float(rtf) > MAX_RTF:
                reason = f"RTF guard tripped: {float(rtf):.3f} > {MAX_RTF:.3f}"
                record["abort_remaining"] = reason
                log(f"job abnormal ratio={ratio_label(ratio)} run={run_idx}: {reason}")
        log(
            f"job done ratio={ratio_label(ratio)} run={run_idx} state={record['state']} "
            f"rtf={metrics.get('rtf')} wall_rtf={metrics.get('wall_rtf')} "
            f"audio={metrics.get('audio_duration_s')}s wall={metrics.get('total_wall_s')}s "
            f"peak_gpu={max_gpu.get('memory_used_mib')}MiB"
        )
    except Exception as exc:
        record["state"] = "error"
        record["error"] = repr(exc)
        if FAIL_FAST:
            record["abort_remaining"] = repr(exc)
        record["client_elapsed_s"] = round(time.perf_counter() - started, 3)
        record["gpu_after"] = gpu_snapshot()
        log(f"job error ratio={ratio_label(ratio)} run={run_idx}: {exc!r}")
    append_jsonl(out_jsonl, record)
    return record


def summarize(records, meta, out_path: Path):
    done = [r for r in records if r.get("state") == "done"]
    summary = {
        "created_at": datetime.now().isoformat(),
        "source_json": str(SOURCE_JSON),
        "voice_map": VOICE_MAP,
        "generation_params": GENERATION_PARAMS,
        "source_audio_duration_s": meta.get("duration_s"),
        "records": records,
        "by_ratio": {},
    }
    for ratio in RATIOS:
        rows = [r for r in done if ratio_label(r.get("ratio")) == ratio_label(ratio)]
        if not rows:
            continue
        metrics = [(r.get("status") or {}).get("metrics") or {} for r in rows]
        def avg(key):
            vals = [float(m.get(key)) for m in metrics if m.get(key) is not None]
            return round(sum(vals) / len(vals), 3) if vals else None
        warm_rows = rows[1:] if len(rows) > 1 else rows
        warm_metrics = [(r.get("status") or {}).get("metrics") or {} for r in warm_rows]
        def warm_avg(key):
            vals = [float(m.get(key)) for m in warm_metrics if m.get(key) is not None]
            return round(sum(vals) / len(vals), 3) if vals else None
        summary["by_ratio"][str(ratio)] = {
            "done_runs": len(rows),
            "avg_rtf_all": avg("rtf"),
            "avg_wall_rtf_all": avg("wall_rtf"),
            "avg_total_wall_s_all": avg("total_wall_s"),
            "avg_gpt_gen_s_all": avg("gpt_gen_s"),
            "avg_s2mel_s_all": avg("s2mel_s"),
            "avg_bigvgan_s_all": avg("bigvgan_s"),
            "avg_rtf_warm_runs_2_3": warm_avg("rtf"),
            "avg_wall_rtf_warm_runs_2_3": warm_avg("wall_rtf"),
            "max_gpu_peak_mib": max((r.get("gpu_peak") or {}).get("memory_used_mib", 0) for r in rows),
        }
    with out_path.open("w", encoding="utf-8") as fp:
        json.dump(summary, fp, ensure_ascii=False, indent=2)
    return summary


def main():
    global API, RATIOS, RUNS_PER_RATIO, SOURCE_JSON
    global RESTART_SERVICE, FAIL_FAST, MAX_IDLE_GPU_MIB, MAX_WARMUP_GPU_MIB, MAX_RUN_GPU_MIB, MAX_RTF, MAX_WARMUP_SECONDS, MAX_JOB_SECONDS

    parser = argparse.ArgumentParser()
    parser.add_argument("--api", default=API)
    parser.add_argument("--source-json", default=str(SOURCE_JSON))
    parser.add_argument("--ratios", nargs="*", type=float, default=None)
    parser.add_argument("--runs", type=int, default=RUNS_PER_RATIO)
    parser.add_argument(
        "--restart-service",
        action="store_true",
        help="Restart vLLM for each ratio. Default is to benchmark the current launcher-started service.",
    )
    parser.add_argument("--skip-warmup", action="store_true")
    parser.add_argument("--no-fail-fast", action="store_true")
    parser.add_argument("--max-idle-gpu-mib", type=int, default=MAX_IDLE_GPU_MIB)
    parser.add_argument("--max-warmup-gpu-mib", type=int, default=MAX_WARMUP_GPU_MIB)
    parser.add_argument("--max-run-gpu-mib", type=int, default=MAX_RUN_GPU_MIB)
    parser.add_argument("--max-rtf", type=float, default=MAX_RTF)
    parser.add_argument("--max-warmup-seconds", type=int, default=MAX_WARMUP_SECONDS)
    parser.add_argument("--max-job-seconds", type=int, default=MAX_JOB_SECONDS)
    args = parser.parse_args()

    API = args.api.rstrip("/")
    SOURCE_JSON = Path(args.source_json)
    RESTART_SERVICE = args.restart_service
    if RESTART_SERVICE:
        RATIOS = args.ratios if args.ratios is not None else RATIOS
    else:
        if args.ratios and len(args.ratios) > 1:
            log(f"current-service mode ignores extra ratio labels: {args.ratios[1:]}")
        RATIOS = [args.ratios[0] if args.ratios else "current"]
    RUNS_PER_RATIO = args.runs
    FAIL_FAST = not args.no_fail_fast
    MAX_IDLE_GPU_MIB = args.max_idle_gpu_mib
    MAX_WARMUP_GPU_MIB = args.max_warmup_gpu_mib
    MAX_RUN_GPU_MIB = args.max_run_gpu_mib
    MAX_RTF = args.max_rtf
    MAX_WARMUP_SECONDS = args.max_warmup_seconds
    MAX_JOB_SECONDS = args.max_job_seconds

    OUT_DIR.mkdir(parents=True, exist_ok=True)
    stamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    out_jsonl = OUT_DIR / f"vllm_gpu_ratio_{stamp}.jsonl"
    out_summary = OUT_DIR / f"vllm_gpu_ratio_{stamp}_summary.json"
    log(f"results jsonl={out_jsonl}")
    log(f"summary json={out_summary}")
    log(
        "fail_fast="
        + json.dumps(
            {
                "enabled": FAIL_FAST,
                "max_idle_gpu_mib": MAX_IDLE_GPU_MIB,
                "max_warmup_gpu_mib": MAX_WARMUP_GPU_MIB,
                "max_run_gpu_mib": MAX_RUN_GPU_MIB,
                "max_rtf": MAX_RTF,
                "max_warmup_seconds": MAX_WARMUP_SECONDS,
                "max_job_seconds": MAX_JOB_SECONDS,
                "restart_service": RESTART_SERVICE,
            },
            ensure_ascii=False,
        )
    )

    source, segments = load_segments()
    log(f"loaded segments={len(segments)} source_duration={source.get('duration_s')}")

    # Validate against the live API before the long run.
    health = wait_health(timeout=30)
    require_vllm_health(health)
    log("health=" + json.dumps({k: health.get(k) for k in ("version", "engine", "qwen_emo", "llm_parse")}, ensure_ascii=False))
    resolved = resolve_voice_names()
    log("resolved voices=" + json.dumps(resolved, ensure_ascii=False))

    records = []
    if not RESTART_SERVICE:
        ratio = RATIOS[0]
        current_record = {
            "ratio": ratio,
            "type": "current_service",
            "health": health,
            **api_processes(),
            "gpu": gpu_snapshot(),
        }
        records.append(current_record)
        append_jsonl(out_jsonl, current_record)
        log(
            f"current service ok label={ratio_label(ratio)} "
            f"gpu={current_record['gpu'].get('memory_used_mib')}MiB "
            f"pids={current_record.get('api_pid')}/{current_record.get('worker_pid')}"
        )
        try:
            require_gpu_below("current service idle", current_record["gpu"], MAX_IDLE_GPU_MIB)
        except Exception as exc:
            current_record["state"] = "preflight_error"
            current_record["error"] = repr(exc)
            log(f"current service preflight error: {exc!r}")
            summarize(records, source, out_summary)
            return 2
        if not args.skip_warmup:
            try:
                current_record["warmup"] = warmup(ratio)
            except Exception as exc:
                current_record["state"] = "warmup_error"
                current_record["error"] = repr(exc)
                log(f"warmup error label={ratio_label(ratio)}: {exc!r}")
                summarize(records, source, out_summary)
                return 2
        if RUNS_PER_RATIO <= 0:
            summary = summarize(records, source, out_summary)
            log("dry run complete: no synthesis jobs requested")
            log("summary=" + json.dumps(summary.get("by_ratio"), ensure_ascii=False))
            return 0
        for run_idx in range(1, RUNS_PER_RATIO + 1):
            record = run_job(ratio, run_idx, segments, out_jsonl)
            records.append(record)
            if FAIL_FAST and record.get("abort_remaining"):
                log(f"benchmark fail-fast stop: {record.get('abort_remaining')}")
                summarize(records, source, out_summary)
                return 2
        summary = summarize(records, source, out_summary)
        log("summary=" + json.dumps(summary.get("by_ratio"), ensure_ascii=False))
        return 0

    for ratio in RATIOS:
        ratio_record = {"ratio": ratio, "type": "restart"}
        try:
            ratio_record["restart"] = restart_vllm(ratio)
            log(f"restart ok ratio={ratio} gpu={ratio_record['restart']['gpu'].get('memory_used_mib')}MiB pids={ratio_record['restart'].get('api_pid')}/{ratio_record['restart'].get('worker_pid')}")
            if not args.skip_warmup:
                ratio_record["warmup"] = warmup(ratio)
        except Exception as exc:
            ratio_record["state"] = "restart_error"
            ratio_record["error"] = repr(exc)
            log(f"restart error ratio={ratio}: {exc!r}")
            records.append(ratio_record)
            append_jsonl(out_jsonl, ratio_record)
            if FAIL_FAST:
                summarize(records, source, out_summary)
                return 2
            continue
        records.append(ratio_record)
        append_jsonl(out_jsonl, ratio_record)
        for run_idx in range(1, RUNS_PER_RATIO + 1):
            record = run_job(ratio, run_idx, segments, out_jsonl)
            records.append(record)
            if FAIL_FAST and record.get("abort_remaining"):
                log(f"benchmark fail-fast stop: {record.get('abort_remaining')}")
                summarize(records, source, out_summary)
                return 2
    summary = summarize(records, source, out_summary)
    log("summary=" + json.dumps(summary.get("by_ratio"), ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
