import html
import asyncio
import contextlib
import json
import os
import shutil
import sys
import threading
import time

import warnings

warnings.filterwarnings("ignore", category=FutureWarning)
warnings.filterwarnings("ignore", category=UserWarning)

import pandas as pd
import torch
import torchaudio

current_dir = os.path.dirname(os.path.abspath(__file__))
sys.path.append(current_dir)
sys.path.append(os.path.join(current_dir, "indextts"))

import argparse
parser = argparse.ArgumentParser(
    description="IndexTTS WebUI",
    formatter_class=argparse.ArgumentDefaultsHelpFormatter,
)
parser.add_argument("--verbose", action="store_true", default=False, help="Enable verbose mode")
parser.add_argument("--port", type=int, default=7860, help="Port to run the web UI on")
parser.add_argument("--host", type=str, default="0.0.0.0", help="Host to run the web UI on")
parser.add_argument("--model_dir", type=str, default="./checkpoints", help="Model checkpoints directory")
parser.add_argument("--fp16", action="store_true", default=False, help="Use FP16 for inference if available")
parser.add_argument("--deepspeed", action="store_true", default=False, help="Use DeepSpeed to accelerate if available")
parser.add_argument("--cuda_kernel", action="store_true", default=False, help="Use CUDA kernel for inference if available")
parser.add_argument("--gui_seg_tokens", type=int, default=120, help="GUI: Max tokens per generation segment")
parser.add_argument("--no_qwen_emo", action="store_true", default=False, help="Disable Qwen_emotion, which can save about 2GB VRAM, but text emotion prompt will be no longer available.")
cmd_args = parser.parse_args()

if not os.path.exists(cmd_args.model_dir):
    print(f"Model directory {cmd_args.model_dir} does not exist. Please download the model first.")
    sys.exit(1)

for file in [
    "bpe.model",
    "gpt.pth",
    "config.yaml",
    "s2mel.pth",
    "wav2vec2bert_stats.pt"
]:
    file_path = os.path.join(cmd_args.model_dir, file)
    if not os.path.exists(file_path):
        print(f"Required file {file_path} does not exist. Please download it.")
        sys.exit(1)

import gradio as gr
from indextts.infer_vllm_v2 import IndexTTS2
from tools.i18n.i18n import I18nAuto

if __name__ == "__main__":
    i18n = I18nAuto(language="Auto")
    MODE = 'local'
    tts = IndexTTS2(model_dir=cmd_args.model_dir,
                    cfg_path=os.path.join(cmd_args.model_dir, "config.yaml"),
                    is_fp16=cmd_args.fp16,
                    # use_deepspeed=cmd_args.deepspeed,
                    use_cuda_kernel=cmd_args.cuda_kernel,
                    use_qwen_emo=not cmd_args.no_qwen_emo,
                    )
    # 支持的语言列表
    LANGUAGES = {
        "中文": "zh_CN",
        "English": "en_US"
    }
    EMO_CHOICES_ALL = [i18n("与音色参考音频相同"),
                    i18n("使用情感参考音频"),
                    i18n("使用情感向量控制"),
                    i18n("使用情感描述文本控制")]
    EMO_CHOICES_OFFICIAL = EMO_CHOICES_ALL[:-1]  # skip experimental features

    os.makedirs("outputs/tasks",exist_ok=True)
    os.makedirs("prompts",exist_ok=True)
    os.makedirs(os.path.join("prompts", "history"), exist_ok=True)

    STREAM_TARGET_SEGMENT_TOKENS = 82
    STREAM_HARD_SEGMENT_TOKENS = 92
    STREAM_FIRST_SEGMENT_TOKENS = 42
    STREAM_MIN_SEGMENT_TOKENS = 28
    STREAM_DIFFUSION_STEPS = 12
    AUDIO_HISTORY_PATH = os.path.join("prompts", "audio_history.json")
    AUDIO_HISTORY_DIR = os.path.join("prompts", "history")
    AUDIO_HISTORY_LIMIT = 30

    def get_stream_split_limits(requested_segment_tokens):
        target_tokens = min(int(requested_segment_tokens), STREAM_TARGET_SEGMENT_TOKENS)
        hard_tokens = min(
            STREAM_HARD_SEGMENT_TOKENS,
            max(target_tokens + 24, int(target_tokens * 1.35)),
        )
        first_tokens = min(STREAM_FIRST_SEGMENT_TOKENS, target_tokens)
        return target_tokens, hard_tokens, first_tokens

    def safe_audio_history_name(path):
        base = os.path.basename(path or "audio.wav")
        stem, ext = os.path.splitext(base)
        ext = ext if ext else ".wav"
        safe_stem = "".join(ch if ch.isalnum() or ch in "._-" else "_" for ch in stem).strip("._-")
        if not safe_stem:
            safe_stem = "audio"
        return f"{int(time.time())}_{safe_stem[:48]}{ext}"

    def load_audio_history():
        if not os.path.exists(AUDIO_HISTORY_PATH):
            return []
        try:
            with open(AUDIO_HISTORY_PATH, "r", encoding="utf-8") as f:
                records = json.load(f)
        except Exception:
            return []

        cleaned = []
        seen = set()
        for record in records:
            path = record.get("path") if isinstance(record, dict) else None
            if not path or path in seen or not os.path.exists(path):
                continue
            seen.add(path)
            cleaned.append({
                "name": record.get("name") or os.path.basename(path),
                "path": path,
                "source": record.get("source") or path,
                "time": record.get("time") or "",
            })
        return cleaned[:AUDIO_HISTORY_LIMIT]

    def save_audio_history(records):
        with open(AUDIO_HISTORY_PATH, "w", encoding="utf-8") as f:
            json.dump(records[:AUDIO_HISTORY_LIMIT], f, ensure_ascii=False, indent=2)

    def audio_history_choices():
        return [(record["name"], record["path"]) for record in load_audio_history()]

    def add_audio_history(audio_path):
        if not audio_path or not os.path.exists(audio_path):
            return None

        history_dir_abs = os.path.abspath(AUDIO_HISTORY_DIR)
        source_abs = os.path.abspath(audio_path)
        for record in load_audio_history():
            if os.path.abspath(record.get("source", "")) == source_abs or os.path.abspath(record["path"]) == source_abs:
                stable_path = record["path"]
                break
        else:
            stable_path = None

        if stable_path is not None:
            already_in_history = True
        else:
            already_in_history = False

        try:
            already_in_history = already_in_history or os.path.commonpath([history_dir_abs, source_abs]) == history_dir_abs
        except ValueError:
            pass

        if already_in_history and stable_path is None:
            stable_path = audio_path
        elif stable_path is None:
            stable_path = os.path.join(AUDIO_HISTORY_DIR, safe_audio_history_name(audio_path))
            shutil.copy2(audio_path, stable_path)

        records = [record for record in load_audio_history() if os.path.abspath(record["path"]) != os.path.abspath(stable_path)]
        records.insert(0, {
            "name": os.path.basename(stable_path),
            "path": stable_path,
            "source": source_abs,
            "time": time.strftime("%Y-%m-%d %H:%M:%S"),
        })
        save_audio_history(records)
        return stable_path

    example_cases = []
    with open("examples/cases.jsonl", "r", encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            example = json.loads(line)
            if example.get("emo_audio",None):
                emo_audio_path = os.path.join("examples",example["emo_audio"])
            else:
                emo_audio_path = None

            example_cases.append([os.path.join("examples", example.get("prompt_audio", "sample_prompt.wav")),
                                EMO_CHOICES_ALL[example.get("emo_mode",0)],
                                example.get("text"),
                                emo_audio_path,
                                example.get("emo_weight",1.0),
                                example.get("emo_text",""),
                                example.get("emo_vec_1",0),
                                example.get("emo_vec_2",0),
                                example.get("emo_vec_3",0),
                                example.get("emo_vec_4",0),
                                example.get("emo_vec_5",0),
                                example.get("emo_vec_6",0),
                                example.get("emo_vec_7",0),
                                example.get("emo_vec_8",0),
                                ])

    def get_example_cases(include_experimental = False):
        if include_experimental:
            return example_cases  # show every example

        # exclude emotion control mode 3 (emotion from text description)
        return [x for x in example_cases if x[1] != EMO_CHOICES_ALL[3]]

    cancel_generation = {"value": False, "task": None, "loop": None}

    def request_cancel():
        cancel_generation["value"] = True
        task = cancel_generation.get("task")
        loop = cancel_generation.get("loop")
        if task is not None and not task.done():
            if loop is not None and loop.is_running():
                loop.call_soon_threadsafe(task.cancel)
            else:
                task.cancel()
        gr.Info(i18n("已请求停止，正在中断当前生成"))

    async def gen_single(emo_control_method,prompt, text,
                emo_ref_path, emo_weight,
                vec1, vec2, vec3, vec4, vec5, vec6, vec7, vec8,
                emo_text,emo_random,
                stream_mode,
                max_text_tokens_per_segment=120,
                    *args, progress=gr.Progress()):
        cancel_generation["value"] = False
        cancel_generation["task"] = None
        cancel_generation["loop"] = asyncio.get_running_loop()
        output_path = None
        if not output_path:
            output_path = os.path.join("outputs", f"spk_{int(time.time())}.wav")
        # set gradio progress
        tts.gr_progress = progress
        do_sample, top_p, top_k, temperature, \
            length_penalty, num_beams, repetition_penalty, max_mel_tokens = args
        kwargs = {
            "do_sample": bool(do_sample),
            "top_p": float(top_p),
            "top_k": int(top_k) if int(top_k) > 0 else None,
            "temperature": float(temperature),
            "length_penalty": float(length_penalty),
            "num_beams": num_beams,
            "repetition_penalty": float(repetition_penalty),
            "max_mel_tokens": int(max_mel_tokens),
            # "typical_sampling": bool(typical_sampling),
            # "typical_mass": float(typical_mass),
        }
        if type(emo_control_method) is not int:
            emo_control_method = emo_control_method.value
        if emo_control_method == 0:  # emotion from speaker
            emo_ref_path = None  # remove external reference audio
        if emo_control_method == 1:  # emotion from reference audio
            pass
        if emo_control_method == 2:  # emotion from custom vectors
            vec = [vec1, vec2, vec3, vec4, vec5, vec6, vec7, vec8]
            vec = tts.normalize_emo_vec(vec, apply_bias=True)
        else:
            # don't use the emotion vector inputs for the other modes
            vec = None

        if emo_text == "":
            # erase empty emotion descriptions; `infer()` will then automatically use the main prompt
            emo_text = None

        print(f"Emo control mode:{emo_control_method},weight:{emo_weight},vec:{vec}")
        requested_segment_tokens = int(max_text_tokens_per_segment)
        if not stream_mode:
            tts.gr_progress = progress
            infer_task = asyncio.create_task(tts.infer(spk_audio_prompt=prompt, text=text,
                        output_path=output_path,
                        emo_audio_prompt=emo_ref_path, emo_alpha=emo_weight,
                        emo_vector=vec,
                        use_emo_text=(emo_control_method==3), emo_text=emo_text,use_random=emo_random,
                        verbose=cmd_args.verbose,
                        max_text_tokens_per_sentence=requested_segment_tokens,
                        stop_generation_callback=lambda: cancel_generation["value"],
                        **kwargs))
            cancel_generation["task"] = infer_task
            try:
                output = await infer_task
            except asyncio.CancelledError:
                progress(1.0, desc="已停止生成")
                yield gr.update(value=None), gr.update(value=None, visible=True)
                return
            finally:
                if cancel_generation.get("task") is infer_task:
                    cancel_generation["task"] = None
                    cancel_generation["loop"] = None
            yield gr.update(value=None), gr.update(value=output, visible=True)
            return

        effective_segment_tokens, stream_hard_tokens, stream_first_tokens = get_stream_split_limits(requested_segment_tokens)
        task_id = time.strftime("stream_%Y%m%d_%H%M%S")
        task_dir = os.path.join("outputs", "tasks", task_id)
        os.makedirs(task_dir, exist_ok=True)
        play_queue = asyncio.Queue()
        last_play_path = {"value": None}
        tts.gr_progress = progress
        progress(
            0.01,
            desc=f"流式播放准备中，完整句优先，目标 {effective_segment_tokens} Token，保险上限 {stream_hard_tokens}",
        )
        yield gr.update(value=None), gr.update(value=None, visible=True)

        async def on_stream_chunk(wav, sampling_rate, idx, total):
            if cancel_generation["value"]:
                return
            chunk_path = os.path.join(task_dir, f"chunk_{idx + 1:03d}.wav")
            play_path = os.path.join(task_dir, f"play_{idx + 1:03d}.wav")
            torchaudio.save(chunk_path, wav.type(torch.int16), sampling_rate)
            torchaudio.save(play_path, wav.type(torch.int16), sampling_rate)
            await play_queue.put(play_path)

        infer_task = asyncio.create_task(tts.infer(
                spk_audio_prompt=prompt,
                text=text,
                output_path=output_path,
                emo_audio_prompt=emo_ref_path,
                emo_alpha=emo_weight,
                emo_vector=vec,
                use_emo_text=(emo_control_method == 3),
                emo_text=emo_text,
                use_random=emo_random,
                interval_silence=200,
                verbose=cmd_args.verbose,
                max_text_tokens_per_sentence=effective_segment_tokens,
                diffusion_steps=STREAM_DIFFUSION_STEPS,
                prefer_sentence_boundary=True,
                quick_streaming_tokens=stream_first_tokens,
                sentence_split_hard_max_tokens=stream_hard_tokens,
                sentence_split_min_tokens=STREAM_MIN_SEGMENT_TOKENS,
                stream_chunk_callback=on_stream_chunk,
                stop_generation_callback=lambda: cancel_generation["value"],
                **kwargs,
        ))
        cancel_generation["task"] = infer_task

        try:
            while not infer_task.done() or not play_queue.empty():
                try:
                    play_path = await asyncio.wait_for(play_queue.get(), timeout=0.2)
                    last_play_path["value"] = play_path
                    yield gr.update(value=play_path), gr.update(value=None, visible=True)
                except asyncio.TimeoutError:
                    continue

            try:
                final_path = await infer_task
            except asyncio.CancelledError:
                final_path = None

            while not play_queue.empty():
                play_path = await play_queue.get()
                last_play_path["value"] = play_path
                yield gr.update(value=play_path), gr.update(value=None, visible=True)
            if cancel_generation["value"] or final_path is None:
                progress(1.0, desc="已停止生成")
                yield gr.update(value=None), gr.update(value=None, visible=True)
                return
            progress(1.0, desc="生成完成")
            yield gr.update(value=last_play_path["value"]), gr.update(value=final_path, visible=True)
        except asyncio.CancelledError:
            cancel_generation["value"] = True
            if not infer_task.done():
                infer_task.cancel()
                with contextlib.suppress(asyncio.CancelledError):
                    await infer_task
            raise
        finally:
            if cancel_generation.get("task") is infer_task:
                cancel_generation["task"] = None
                cancel_generation["loop"] = None

    def update_prompt_audio(audio_path):
        stable_path = add_audio_history(audio_path)
        return (
            gr.update(interactive=True),
            gr.update(choices=audio_history_choices(), value=stable_path),
        )

    def select_audio_history(audio_path):
        if not audio_path or not os.path.exists(audio_path):
            return gr.update(), gr.update(interactive=False)
        return gr.update(value=audio_path), gr.update(interactive=True)

    def create_warning_message(warning_text):
        return gr.HTML(f"<div style=\"padding: 0.5em 0.8em; border-radius: 0.5em; background: #ffa87d; color: #000; font-weight: bold\">{html.escape(warning_text)}</div>")

    def create_experimental_warning_message():
        return create_warning_message(i18n('提示：此功能为实验版，结果尚不稳定，我们正在持续优化中。'))

    CUSTOM_CSS = """
    /* Gradio's queue ETA is misleading for TTS because each segment has different cost. */
    .eta-bar,
    .meta-text.progress-text {
        display: none !important;
    }
    .progress-level-inner {
        font-family: var(--font);
        font-size: 14px;
        font-weight: 600;
    }
    #hidden_stream_file {
        display: none !important;
    }
    #custom_player_wrap {
        border: 1px solid var(--border-color-primary);
        border-radius: 8px;
        padding: 12px;
        background: var(--block-background-fill);
        box-shadow: 0 1px 2px rgba(0, 0, 0, 0.04);
    }
    #custom_player {
        display: none;
    }
    .stream_header {
        align-items: center;
        display: flex;
        gap: 10px;
        justify-content: space-between;
        margin-bottom: 10px;
    }
    .stream_title {
        color: var(--body-text-color);
        font-size: 14px;
        font-weight: 700;
    }
    #stream_badge {
        background: var(--button-secondary-background-fill);
        border: 1px solid var(--border-color-primary);
        border-radius: 999px;
        color: var(--body-text-color);
        font-size: 12px;
        line-height: 1;
        padding: 5px 8px;
    }
    #stream_status {
        color: var(--body-text-color-subdued);
        font-size: 13px;
        margin-top: 2px;
    }
    .stream_controls {
        align-items: center;
        display: grid;
        gap: 10px;
        grid-template-columns: 36px 74px minmax(120px, 1fr);
    }
    #stream_play_button {
        align-items: center;
        border: 1px solid var(--border-color-primary);
        border-radius: 8px;
        cursor: pointer;
        display: flex;
        font-size: 14px;
        height: 34px;
        justify-content: center;
        padding: 0;
        width: 36px;
    }
    #stream_time {
        color: var(--body-text-color);
        font-variant-numeric: tabular-nums;
        font-size: 13px;
        white-space: nowrap;
    }
    #stream_progress {
        background: var(--border-color-primary);
        border-radius: 999px;
        cursor: pointer;
        height: 8px;
        overflow: hidden;
        position: relative;
    }
    #stream_progress_fill {
        background: var(--body-text-color);
        border-radius: inherit;
        height: 100%;
        transform-origin: left center;
        transform: scaleX(0);
        width: 100%;
    }
    """

    STREAM_JS = """
    function(...args) {
        const STATE_KEY = "__indextts_stream_player";
        const state = window[STATE_KEY] || {
            queue: [],
            seen: new Set(),
            playing: false,
            completed: true,
            unlocked: false,
            ignoredHref: null,
            clickBound: false,
            bindTimer: null,
            pollTimer: null,
            prebufferTimer: null,
            prebufferSegments: 2,
            prebufferTimeoutMs: 2200,
            observer: null,
            player: null,
            root: null,
            playButton: null,
            progress: null,
        };
        window[STATE_KEY] = state;

        function byId(id) {
            return document.getElementById(id);
        }

        function getPlayer() {
            return byId("custom_player");
        }

        function getRoot() {
            return byId("hidden_stream_file");
        }

        function setText(id, text) {
            const node = byId(id);
            if (node) {
                node.textContent = text;
            }
        }

        function setStatus(text) {
            setText("stream_status", text);
        }

        function setBadge() {
            setText("stream_badge", `${state.seen.size} 段`);
        }

        function formatTime(seconds) {
            if (!Number.isFinite(seconds) || seconds < 0) {
                return "--:--";
            }
            const total = Math.floor(seconds);
            const min = Math.floor(total / 60);
            const sec = String(total % 60).padStart(2, "0");
            return `${min}:${sec}`;
        }

        function updatePlaybackUi() {
            const player = getPlayer();
            const fill = byId("stream_progress_fill");
            const progress = byId("stream_progress");
            const playButton = byId("stream_play_button");
            if (!player) {
                return;
            }
            const duration = Number.isFinite(player.duration) ? player.duration : 0;
            const current = Number.isFinite(player.currentTime) ? player.currentTime : 0;
            const ratio = duration > 0 ? Math.max(0, Math.min(1, current / duration)) : 0;
            if (fill) {
                fill.style.transform = `scaleX(${ratio})`;
            }
            if (progress) {
                progress.setAttribute("aria-valuenow", String(Math.round(ratio * 100)));
            }
            if (playButton) {
                playButton.textContent = player.paused ? "▶" : "Ⅱ";
            }
            setText("stream_current", formatTime(current));
            setText("stream_duration", formatTime(duration));
            setBadge();
        }

        function normalizeHref(href) {
            if (!href) {
                return null;
            }
            try {
                return new URL(href, window.location.href).href;
            } catch (_) {
                return href;
            }
        }

        function findHref() {
            const root = getRoot();
            if (!root) {
                return null;
            }
            const nodes = root.querySelectorAll("a[href], audio[src], source[src]");
            for (const node of nodes) {
                const href = normalizeHref(node.href || node.src || node.getAttribute("href") || node.getAttribute("src"));
                if (href && (href.includes("/file=") || href.includes("/gradio_api/file=") || href.toLowerCase().includes(".wav"))) {
                    return href;
                }
            }
            const text = root.textContent || "";
            const match = text.match(/(?:\\/gradio_api\\/file=|\\/file=|[A-Za-z]:\\\\)[^\\s"'<>]+\\.wav/i);
            return match ? normalizeHref(match[0]) : null;
        }

        function clearPrebufferTimer() {
            if (state.prebufferTimer) {
                window.clearTimeout(state.prebufferTimer);
                state.prebufferTimer = null;
            }
        }

        function maybeStartPlayback() {
            if (state.playing || !state.queue.length) {
                return;
            }
            if (state.queue.length >= state.prebufferSegments) {
                clearPrebufferTimer();
                playNext();
                return;
            }
            setStatus(`缓冲中 ${state.queue.length}/${state.prebufferSegments}`);
            if (!state.prebufferTimer) {
                state.prebufferTimer = window.setTimeout(() => {
                    state.prebufferTimer = null;
                    if (!state.playing && state.queue.length) {
                        playNext();
                    }
                }, state.prebufferTimeoutMs);
            }
        }

        function playNext() {
            const player = getPlayer();
            clearPrebufferTimer();
            if (!player) {
                state.playing = false;
                return;
            }
            if (!state.queue.length) {
                state.playing = false;
                updatePlaybackUi();
                if (!state.completed) {
                    setStatus("等下一段");
                }
                return;
            }
            const href = state.queue.shift();
            state.playing = true;
            player.src = href;
            player.load();
            updatePlaybackUi();
            player.play().then(() => {
                setStatus(`播放中，队列 ${state.queue.length}`);
                updatePlaybackUi();
            }).catch(() => {
                state.playing = false;
                setStatus("点播放按钮解锁");
                updatePlaybackUi();
            });
        }

        function enqueue(href) {
            href = normalizeHref(href);
            if (!href || state.seen.has(href)) {
                return;
            }
            if (state.ignoredHref && href === state.ignoredHref) {
                return;
            }
            state.ignoredHref = null;
            state.seen.add(href);
            state.queue.push(href);
            state.completed = false;
            setStatus(`收到 ${state.seen.size} 段`);
            setBadge();
            if (!state.playing) {
                maybeStartPlayback();
            }
        }

        function resetStream() {
            const player = getPlayer();
            clearPrebufferTimer();
            state.queue = [];
            state.seen = new Set();
            state.playing = false;
            state.completed = false;
            state.ignoredHref = findHref();
            if (player) {
                player.pause();
                player.removeAttribute("src");
                player.load();
            }
            setStatus("等待首段");
            updatePlaybackUi();
        }

        function stopPlayback() {
            const player = getPlayer();
            clearPrebufferTimer();
            state.queue = [];
            state.playing = false;
            state.completed = true;
            state.ignoredHref = findHref();
            if (player) {
                player.pause();
                player.removeAttribute("src");
                player.load();
            }
            setStatus("已请求停止");
            updatePlaybackUi();
        }

        function buildSilentWavUrl() {
            const sampleRate = 8000;
            const samples = 800;
            const bytes = 44 + samples * 2;
            const buffer = new ArrayBuffer(bytes);
            const view = new DataView(buffer);
            function writeString(offset, value) {
                for (let i = 0; i < value.length; i++) {
                    view.setUint8(offset + i, value.charCodeAt(i));
                }
            }
            writeString(0, "RIFF");
            view.setUint32(4, 36 + samples * 2, true);
            writeString(8, "WAVE");
            writeString(12, "fmt ");
            view.setUint32(16, 16, true);
            view.setUint16(20, 1, true);
            view.setUint16(22, 1, true);
            view.setUint32(24, sampleRate, true);
            view.setUint32(28, sampleRate * 2, true);
            view.setUint16(32, 2, true);
            view.setUint16(34, 16, true);
            writeString(36, "data");
            view.setUint32(40, samples * 2, true);
            return URL.createObjectURL(new Blob([buffer], { type: "audio/wav" }));
        }

        function unlockPlayer() {
            const player = getPlayer();
            if (!player || state.unlocked) {
                return;
            }
            const silentUrl = buildSilentWavUrl();
            player.src = silentUrl;
            player.play().then(() => {
                state.unlocked = true;
                setTimeout(() => {
                    player.pause();
                    player.removeAttribute("src");
                    player.load();
                    URL.revokeObjectURL(silentUrl);
                    setStatus("等待首段");
                    updatePlaybackUi();
                }, 120);
            }).catch(() => {
                URL.revokeObjectURL(silentUrl);
                setStatus("点播放按钮解锁");
                updatePlaybackUi();
            });
        }

        function bind() {
            const player = getPlayer();
            const root = getRoot();
            if (!player || !root) {
                window.clearTimeout(state.bindTimer);
                state.bindTimer = window.setTimeout(bind, 250);
                return;
            }

            if (state.player !== player) {
                player.addEventListener("timeupdate", updatePlaybackUi);
                player.addEventListener("loadedmetadata", updatePlaybackUi);
                player.addEventListener("play", updatePlaybackUi);
                player.addEventListener("pause", updatePlaybackUi);
                player.addEventListener("ended", () => {
                    if (state.queue.length) {
                        playNext();
                    } else {
                        state.playing = false;
                        state.completed = true;
                        setStatus("队列已播完");
                        updatePlaybackUi();
                    }
                });
                state.player = player;
            }

            const playButton = byId("stream_play_button");
            if (playButton && state.playButton !== playButton) {
                playButton.addEventListener("click", () => {
                    const player = getPlayer();
                    if (!player) {
                        return;
                    }
                    if (!player.src && state.queue.length) {
                        playNext();
                    } else if (player.paused) {
                        player.play().catch(() => setStatus("点播放按钮解锁"));
                    } else {
                        player.pause();
                    }
                    updatePlaybackUi();
                });
                state.playButton = playButton;
            }

            const progress = byId("stream_progress");
            if (progress && state.progress !== progress) {
                progress.addEventListener("click", (event) => {
                    const player = getPlayer();
                    if (!player || !Number.isFinite(player.duration) || player.duration <= 0) {
                        return;
                    }
                    const rect = progress.getBoundingClientRect();
                    const ratio = Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width));
                    player.currentTime = ratio * player.duration;
                    updatePlaybackUi();
                });
                state.progress = progress;
            }

            if (state.root !== root) {
                if (state.observer) {
                    state.observer.disconnect();
                }
                state.observer = new MutationObserver(() => enqueue(findHref()));
                state.observer.observe(root, { childList: true, subtree: true, attributes: true, attributeFilter: ["href", "src"] });
                state.root = root;
            }

            if (!state.clickBound) {
                document.addEventListener("click", (event) => {
                    const target = event.target;
                    if (target && target.closest && target.closest("#gen_button")) {
                        resetStream();
                        unlockPlayer();
                    } else if (target && target.closest && target.closest("#stop_button")) {
                        stopPlayback();
                    }
                }, true);
                state.clickBound = true;
            }

            if (!state.pollTimer) {
                state.pollTimer = window.setInterval(() => enqueue(findHref()), 200);
            }
            if (state.completed) {
                setStatus("监听已启动");
            }
            updatePlaybackUi();
            enqueue(findHref());
        }

        bind();
        if (args.length > 0 && args[15] !== false) {
            resetStream();
            unlockPlayer();
        } else if (args.length > 0) {
            setStatus("流式播放已关闭");
        }
        return args;
    }
    """

    STREAM_HEAD = f"<script>({STREAM_JS})();</script>"

    with gr.Blocks(title="IndexTTS Demo", css=CUSTOM_CSS, head=STREAM_HEAD) as demo:
        mutex = threading.Lock()
        gr.HTML('''
        <h2><center>IndexTTS2: A Breakthrough in Emotionally Expressive and Duration-Controlled Auto-Regressive Zero-Shot Text-to-Speech</h2>
    <p align="center">
    <a href='https://arxiv.org/abs/2506.21619'><img src='https://img.shields.io/badge/ArXiv-2506.21619-red'></a>
    </p>
        ''')

        with gr.Tab(i18n("音频生成")):
            with gr.Row():
                os.makedirs("prompts",exist_ok=True)
                with gr.Column():
                    prompt_audio = gr.Audio(label=i18n("音色参考音频"),key="prompt_audio",
                                            sources=["upload","microphone"],type="filepath")
                    audio_history_dropdown = gr.Dropdown(
                        label=i18n("音色试用记录"),
                        choices=audio_history_choices(),
                        value=None,
                        interactive=True,
                    )
                prompt_list = os.listdir("prompts")
                default = ''
                if prompt_list:
                    default = prompt_list[0]
                with gr.Column():
                    input_text_single = gr.TextArea(label=i18n("文本"),key="input_text_single", placeholder=i18n("请输入目标文本"), info=f"{i18n('当前模型版本')}{tts.model_version or '1.0'}")
                    with gr.Row():
                        gen_button = gr.Button(i18n("生成语音"), key="gen_button", elem_id="gen_button", interactive=True)
                        stop_button = gr.Button(i18n("停止生成"), key="stop_button", elem_id="stop_button")
                        stream_mode_checkbox = gr.Checkbox(label=i18n("流式播放"), value=True)
                with gr.Column():
                    output_audio = gr.Audio(label=i18n("生成结果"), visible=True,key="output_audio")
                    gr.HTML(
                        """
                        <div id="custom_player_wrap">
                            <div class="stream_header">
                                <div>
                                    <div class="stream_title">流式播放</div>
                                    <div id="stream_status">流式播放器待命</div>
                                </div>
                                <div id="stream_badge">0 段</div>
                            </div>
                            <audio id="custom_player" preload="auto"></audio>
                            <div class="stream_controls">
                                <button id="stream_play_button" type="button" aria-label="播放或暂停">▶</button>
                                <div id="stream_time"><span id="stream_current">0:00</span> / <span id="stream_duration">--:--</span></div>
                                <div id="stream_progress" role="slider" aria-label="播放进度" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0">
                                    <div id="stream_progress_fill"></div>
                                </div>
                            </div>
                        </div>
                        """
                    )
                    hidden_stream_file = gr.File(label="stream chunk", elem_id="hidden_stream_file", visible=True)

            experimental_checkbox = gr.Checkbox(label=i18n("显示实验功能"), value=False)

            with gr.Accordion(i18n("功能设置")):
                # 情感控制选项部分
                with gr.Row():
                    emo_control_method = gr.Radio(
                        choices=EMO_CHOICES_OFFICIAL,
                        type="index",
                        value=EMO_CHOICES_OFFICIAL[0],label=i18n("情感控制方式"))
                    # we MUST have an extra, INVISIBLE list of *all* emotion control
                    # methods so that gr.Dataset() can fetch ALL control mode labels!
                    # otherwise, the gr.Dataset()'s experimental labels would be empty!
                    emo_control_method_all = gr.Radio(
                        choices=EMO_CHOICES_ALL,
                        type="index",
                        value=EMO_CHOICES_ALL[0], label=i18n("情感控制方式"),
                        visible=False)  # do not render
            # 情感参考音频部分
            with gr.Group(visible=False) as emotion_reference_group:
                with gr.Row():
                    emo_upload = gr.Audio(label=i18n("上传情感参考音频"), type="filepath")

            # 情感随机采样
            with gr.Row(visible=False) as emotion_randomize_group:
                emo_random = gr.Checkbox(label=i18n("情感随机采样"), value=False)

            # 情感向量控制部分
            with gr.Group(visible=False) as emotion_vector_group:
                with gr.Row():
                    with gr.Column():
                        vec1 = gr.Slider(label=i18n("喜"), minimum=0.0, maximum=1.0, value=0.0, step=0.05)
                        vec2 = gr.Slider(label=i18n("怒"), minimum=0.0, maximum=1.0, value=0.0, step=0.05)
                        vec3 = gr.Slider(label=i18n("哀"), minimum=0.0, maximum=1.0, value=0.0, step=0.05)
                        vec4 = gr.Slider(label=i18n("惧"), minimum=0.0, maximum=1.0, value=0.0, step=0.05)
                    with gr.Column():
                        vec5 = gr.Slider(label=i18n("厌恶"), minimum=0.0, maximum=1.0, value=0.0, step=0.05)
                        vec6 = gr.Slider(label=i18n("低落"), minimum=0.0, maximum=1.0, value=0.0, step=0.05)
                        vec7 = gr.Slider(label=i18n("惊喜"), minimum=0.0, maximum=1.0, value=0.0, step=0.05)
                        vec8 = gr.Slider(label=i18n("平静"), minimum=0.0, maximum=1.0, value=0.0, step=0.05)

            with gr.Group(visible=False) as emo_text_group:
                create_experimental_warning_message()
                with gr.Row():
                    emo_text = gr.Textbox(label=i18n("情感描述文本"),
                                        placeholder=i18n("请输入情绪描述（或留空以自动使用目标文本作为情绪描述）"),
                                        value="",
                                        info=i18n("例如：委屈巴巴、危险在悄悄逼近"))

            with gr.Row(visible=False) as emo_weight_group:
                emo_weight = gr.Slider(label=i18n("情感权重"), minimum=0.0, maximum=1.0, value=0.65, step=0.01)

            with gr.Accordion(i18n("高级生成参数设置"), open=False, visible=True) as advanced_settings_group:
                with gr.Row():
                    with gr.Column(scale=1):
                        gr.Markdown(f"**{i18n('GPT2 采样设置')}** _{i18n('参数会影响音频多样性和生成速度详见')} [Generation strategies](https://huggingface.co/docs/transformers/main/en/generation_strategies)._")
                        with gr.Row():
                            do_sample = gr.Checkbox(label="do_sample", value=True, info=i18n("是否进行采样"))
                            temperature = gr.Slider(label="temperature", minimum=0.1, maximum=2.0, value=0.8, step=0.1)
                        with gr.Row():
                            top_p = gr.Slider(label="top_p", minimum=0.0, maximum=1.0, value=0.8, step=0.01)
                            top_k = gr.Slider(label="top_k", minimum=0, maximum=100, value=30, step=1)
                            num_beams = gr.Slider(label="num_beams", value=3, minimum=1, maximum=10, step=1)
                        with gr.Row():
                            repetition_penalty = gr.Number(label="repetition_penalty", precision=None, value=10.0, minimum=0.1, maximum=20.0, step=0.1)
                            length_penalty = gr.Number(label="length_penalty", precision=None, value=0.0, minimum=-2.0, maximum=2.0, step=0.1)
                        max_mel_tokens = gr.Slider(label="max_mel_tokens", value=1500, minimum=50, maximum=tts.cfg.gpt.max_mel_tokens, step=10, info=i18n("生成Token最大数量，过小导致音频被截断"), key="max_mel_tokens")
                        # with gr.Row():
                        #     typical_sampling = gr.Checkbox(label="typical_sampling", value=False, info="不建议使用")
                        #     typical_mass = gr.Slider(label="typical_mass", value=0.9, minimum=0.0, maximum=1.0, step=0.1)
                    with gr.Column(scale=2):
                        gr.Markdown(f'**{i18n("分句设置")}** _{i18n("参数会影响音频质量和生成速度")}_')
                        with gr.Row():
                            initial_value = max(20, min(tts.cfg.gpt.max_text_tokens, cmd_args.gui_seg_tokens))
                            max_text_tokens_per_segment = gr.Slider(
                                label=i18n("分句最大Token数"), value=initial_value, minimum=20, maximum=tts.cfg.gpt.max_text_tokens, step=2, key="max_text_tokens_per_segment",
                                info=i18n("建议80~200之间，值越大，分句越长；值越小，分句越碎；过小过大都可能导致音频质量不高"),
                            )
                        with gr.Accordion(i18n("预览分句结果"), open=True) as segments_settings:
                            segments_preview = gr.Dataframe(
                                headers=[i18n("序号"), i18n("分句内容"), i18n("Token数")],
                                key="segments_preview",
                                wrap=True,
                            )
                advanced_params = [
                    do_sample, top_p, top_k, temperature,
                    length_penalty, num_beams, repetition_penalty, max_mel_tokens,
                    # typical_sampling, typical_mass,
                ]

            # we must use `gr.Dataset` to support dynamic UI rewrites, since `gr.Examples`
            # binds tightly to UI and always restores the initial state of all components,
            # such as the list of available choices in emo_control_method.
            example_table = gr.Dataset(label="Examples",
                samples_per_page=20,
                samples=get_example_cases(include_experimental=False),
                type="values",
                # these components are NOT "connected". it just reads the column labels/available
                # states from them, so we MUST link to the "all options" versions of all components,
                # such as `emo_control_method_all` (to be able to see EXPERIMENTAL text labels)!
                components=[prompt_audio,
                            emo_control_method_all,  # important: support all mode labels!
                            input_text_single,
                            emo_upload,
                            emo_weight,
                            emo_text,
                            vec1, vec2, vec3, vec4, vec5, vec6, vec7, vec8]
            )

        def on_example_click(example):
            print(f"Example clicked: ({len(example)} values) = {example!r}")
            return (
                gr.update(value=example[0]),
                gr.update(value=example[1]),
                gr.update(value=example[2]),
                gr.update(value=example[3]),
                gr.update(value=example[4]),
                gr.update(value=example[5]),
                gr.update(value=example[6]),
                gr.update(value=example[7]),
                gr.update(value=example[8]),
                gr.update(value=example[9]),
                gr.update(value=example[10]),
                gr.update(value=example[11]),
                gr.update(value=example[12]),
                gr.update(value=example[13]),
            )

        # click() event works on both desktop and mobile UI
        example_table.click(on_example_click,
                            inputs=[example_table],
                            outputs=[prompt_audio,
                                    emo_control_method,
                                    input_text_single,
                                    emo_upload,
                                    emo_weight,
                                    emo_text,
                                    vec1, vec2, vec3, vec4, vec5, vec6, vec7, vec8]
        )

        def on_input_text_change(text, max_text_tokens_per_segment, stream_mode):
            if text and len(text) > 0:
                text_tokens_list = tts.tokenizer.tokenize(text)

                if stream_mode:
                    target_tokens, hard_tokens, first_tokens = get_stream_split_limits(max_text_tokens_per_segment)
                    segments = tts.tokenizer.split_segments_by_sentence_boundary(
                        text_tokens_list,
                        max_text_tokens_per_segment=target_tokens,
                        hard_max_text_tokens_per_segment=hard_tokens,
                        min_text_tokens_per_segment=STREAM_MIN_SEGMENT_TOKENS,
                        quick_streaming_tokens=first_tokens,
                    )
                else:
                    segments = tts.tokenizer.split_segments(
                        text_tokens_list,
                        max_text_tokens_per_segment=int(max_text_tokens_per_segment),
                    )
                data = []
                for i, s in enumerate(segments):
                    segment_str = ''.join(s)
                    tokens_count = len(s)
                    data.append([i, segment_str, tokens_count])
                return {
                    segments_preview: gr.update(value=data, visible=True, type="array"),
                }
            else:
                df = pd.DataFrame([], columns=[i18n("序号"), i18n("分句内容"), i18n("Token数")])
                return {
                    segments_preview: gr.update(value=df),
                }

        def on_method_change(emo_control_method):
            if emo_control_method == 1:  # emotion reference audio
                return (gr.update(visible=True),
                        gr.update(visible=False),
                        gr.update(visible=False),
                        gr.update(visible=False),
                        gr.update(visible=True)
                        )
            elif emo_control_method == 2:  # emotion vectors
                return (gr.update(visible=False),
                        gr.update(visible=True),
                        gr.update(visible=True),
                        gr.update(visible=False),
                        gr.update(visible=True)
                        )
            elif emo_control_method == 3:  # emotion text description
                return (gr.update(visible=False),
                        gr.update(visible=True),
                        gr.update(visible=False),
                        gr.update(visible=True),
                        gr.update(visible=True)
                        )
            else:  # 0: same as speaker voice
                return (gr.update(visible=False),
                        gr.update(visible=False),
                        gr.update(visible=False),
                        gr.update(visible=False),
                        gr.update(visible=False)
                        )

        emo_control_method.change(on_method_change,
            inputs=[emo_control_method],
            outputs=[emotion_reference_group,
                    emotion_randomize_group,
                    emotion_vector_group,
                    emo_text_group,
                    emo_weight_group]
        )

        def on_experimental_change(is_experimental, current_mode_index):
            # 切换情感控制选项
            new_choices = EMO_CHOICES_ALL if is_experimental else EMO_CHOICES_OFFICIAL
            # if their current mode selection doesn't exist in new choices, reset to 0.
            # we don't verify that OLD index means the same in NEW list, since we KNOW it does.
            new_index = current_mode_index if current_mode_index < len(new_choices) else 0

            return (
                gr.update(choices=new_choices, value=new_choices[new_index]),
                gr.update(samples=get_example_cases(include_experimental=is_experimental)),
            )

        experimental_checkbox.change(
            on_experimental_change,
            inputs=[experimental_checkbox, emo_control_method],
            outputs=[emo_control_method, example_table]
        )

        input_text_single.change(
            on_input_text_change,
            inputs=[input_text_single, max_text_tokens_per_segment, stream_mode_checkbox],
            outputs=[segments_preview]
        )

        max_text_tokens_per_segment.change(
            on_input_text_change,
            inputs=[input_text_single, max_text_tokens_per_segment, stream_mode_checkbox],
            outputs=[segments_preview]
        )

        stream_mode_checkbox.change(
            on_input_text_change,
            inputs=[input_text_single, max_text_tokens_per_segment, stream_mode_checkbox],
            outputs=[segments_preview]
        )

        prompt_audio.upload(update_prompt_audio,
                            inputs=[prompt_audio],
                            outputs=[gen_button, audio_history_dropdown])

        audio_history_dropdown.change(select_audio_history,
                            inputs=[audio_history_dropdown],
                            outputs=[prompt_audio, gen_button])

        gen_event = gen_button.click(gen_single,
                        inputs=[emo_control_method,prompt_audio, input_text_single, emo_upload, emo_weight,
                                vec1, vec2, vec3, vec4, vec5, vec6, vec7, vec8,
                                emo_text,emo_random,
                                stream_mode_checkbox,
                                max_text_tokens_per_segment,
                                *advanced_params,
                        ],
                        outputs=[hidden_stream_file, output_audio],
                        js=STREAM_JS,
                        stream_every=0.05)
        stop_button.click(request_cancel, queue=False)
        demo.load(js=STREAM_JS)
    demo.queue(20)
    demo.launch(server_name=cmd_args.host, server_port=cmd_args.port, inbrowser=True)
