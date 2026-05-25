# IndexTTS2 vLLM 流式播放交接

最后更新：2026-05-24 22:30 左右

正确工作目录：

```text
D:\apiWorkSpace\index-tts2-vLLM
```

不要改错到：

```text
D:\apiWorkSpace\Index-TTS-V26
```

## 用户当前状态

用户很烦，核心诉求是：vLLM 版 WebUI 的流式播放要真正可用，不要再让用户陪着测半成品。

最新问题是“又卡了”。这次主要不是前端播放器队列本身卡，而是后端分段太长后，每段生成间隔太久，导致流式播放必然断。

接手后第一件事：确认 cwd 是 `D:\apiWorkSpace\index-tts2-vLLM`。

## 当前进程状态

刚才查过并尝试杀过：

```powershell
Get-CimInstance Win32_Process | Where-Object {
  ($_.Name -in 'cmd.exe','python.exe') -and
  ($_.CommandLine -match 'go-webui-VLLM-NoQwen|webui\.py|multiprocessing-fork|vllm|index-tts2-vLLM')
}
```

结果：没有匹配的 WebUI/vLLM `cmd.exe/python.exe` 进程。

又查过端口和 GPU：

- 7860 只有 `SYN_SENT`，没有 WebUI 监听。
- `nvidia-smi --query-compute-apps` 没看到 IndexTTS/vLLM Python 进程。
- 只看到很多 `runtime\logview\start_log_server.bat` 的 `cmd.exe`，看起来不像本工程 WebUI/vLLM。

如果接手后要启动：

```powershell
Start-Process -FilePath "cmd.exe" -ArgumentList "/k", "go-webui-VLLM-NoQwen.bat" -WorkingDirectory "D:\apiWorkSpace\index-tts2-vLLM" -WindowStyle Normal
```

WebUI 通常是：

```text
http://127.0.0.1:7860/
```

## Git 状态

在正确仓库 `D:\apiWorkSpace\index-tts2-vLLM` 里，当前有这些未提交改动：

```text
 M indextts/infer_vllm_v2.py
 M webui.py
?? HANDOFF.md
?? 音色参考音频/
?? HANDOFF_STREAMING_20260524.md
```

注意：之前我一度把 `HANDOFF_STREAMING_20260524.md` 误写到了 `D:\apiWorkSpace\Index-TTS-V26`，已准备删除那份。真正要看的就是本文件。

## 已经做过的代码改动

### `indextts/infer_vllm_v2.py`

已经加入：

- `diffusion_steps` 从硬编码 25 改为可传，默认 16。
- 兼容旧参数 `max_text_tokens_per_segment`。
- 支持 `stream_chunk_callback`：每生成完一段就把 wav 回调给 WebUI。
- 支持 `stop_generation_callback`：停止按钮可中断。
- Gradio 进度：准备、处理音频、分句、第 x/y 段、合并、保存。
- max-mel warning 只在实际打满 `max_mel_tokens` 时提示。
- 停止后返回 `None`，不再合并最终音频。

关键位置：

- `IndexTTS2.infer(...)` 约 266 行。
- 当前分句仍是：

```python
text_tokens_list = self.tokenizer.tokenize(text)
sentences = self.tokenizer.split_segments(text_tokens_list, max_text_tokens_per_sentence)
```

这里还没有用 `quick_streaming_tokens`，下一步应该改这里。

### `webui.py`

已经加入：

- `gen_single` 改为 async generator。
- UI 有“生成语音 / 停止生成 / 流式播放”。
- 用隐藏 `gr.File` 传每段 wav 地址给前端。
- 自定义播放器 UI，替代原生 audio 控件。
- `STREAM_JS` 使用 `MutationObserver + 200ms 轮询` 监听 hidden file 的 href。
- Stop 按钮 `request_cancel()`，`queue=False`，会设置 cancel flag 并 cancel 当前 task。
- 隐藏 Gradio 自带 ETA，因为对 TTS 分段任务误导很大。
- `gen_button.click(..., stream_every=0.05)` 已加。

关键位置：

- `request_cancel()`：约 115 行。
- `gen_single(...)`：约 120-265 行。
- `CUSTOM_CSS / STREAM_JS`：约 285 行以后。
- UI：约 740 行以后。
- 按钮绑定：约 1000 行以后。

## 已验证现象

### Stop

早些时候验证过：开始生成约 5 秒后请求停止，约 2 秒内结束，没有写最终 `spk_*.wav`。

但 GPU/后端非常忙时，Gradio client 调停止可能超时。接手后要重新在浏览器确认。

### 120 token 会卡

最新卡顿目录：

```text
outputs\tasks\stream_20260524_220748
```

只生成 4 段，每段 wav 约 13-15 秒，但 chunk 到达间隔是 36-45 秒：

```text
chunk_001.wav dur=13.9s 22:08:30
chunk_002.wav dur=13.8s 22:09:06 gap=36.6s
chunk_003.wav dur=12.9s 22:09:45 gap=38.8s
chunk_004.wav dur=14.8s 22:10:30 gap=44.8s
```

结论：120 token 对用户 RTX 3060 12GB 的流式体验太慢，不是前端队列天然延迟。

### 70 token 太碎

早些时候 70 token 能让 chunk 间隔降到 4-8 秒左右，但用户明确反馈切得太碎，“没人这么说话”。

所以不能直接回到强制 70。

## 当前判断

流式分段需要折中：

- 不能 70，太碎。
- 不能 120，后端每段 36-45 秒才吐一段。
- 建议 90-100 token 左右。
- 首段可以更快一点，后续按中等长度合并。
- 尽量按标点边界切，别硬切半句话。

`indextts\utils\front.py` 已有 `quick_streaming_tokens`：

```python
def split_segments_by_token(..., quick_streaming_tokens: int = 0)
```

位置约 345-435 行。

`infer_v2.py` 的非 vLLM 版已经这样用：

```python
segments = self.tokenizer.split_segments(
    text_tokens_list,
    max_text_tokens_per_segment,
    quick_streaming_tokens=quick_streaming_tokens,
)
```

vLLM 版应仿照这个。

## 建议下一步

1. 只在 `D:\apiWorkSpace\index-tts2-vLLM` 操作。
2. `infer_vllm_v2.py` 增加：

```python
quick_streaming_tokens = int(generation_kwargs.pop("quick_streaming_tokens", 0))
```

3. 分句改为：

```python
sentences = self.tokenizer.split_segments(
    text_tokens_list,
    max_text_tokens_per_sentence,
    quick_streaming_tokens=quick_streaming_tokens,
)
```

4. `webui.py` 流式分支不要再把用户的 120 原样传给后端。建议先用：

```python
STREAM_SEGMENT_TOKEN_LIMIT = 96
STREAM_QUICK_TOKENS = 48
effective_segment_tokens = min(requested_segment_tokens, STREAM_SEGMENT_TOKEN_LIMIT)
```

5. 调 `tts.infer(...)` 时传：

```python
max_text_tokens_per_sentence=effective_segment_tokens,
quick_streaming_tokens=STREAM_QUICK_TOKENS,
```

6. 非流式完整生成继续用用户 slider 原值，不要影响完整生成音质。
7. 进度文案显示真实流式上限，例如 `流式播放准备中，分段Token上限 96`。

## 验证命令

编译：

```powershell
D:\apiWorkSpace\index-tts2-vLLM\indextts2runtime\python.exe -m py_compile webui.py indextts\infer_vllm_v2.py
```

查进程：

```powershell
Get-CimInstance Win32_Process | Where-Object {
  ($_.Name -in 'cmd.exe','python.exe') -and
  ($_.CommandLine -match 'go-webui-VLLM-NoQwen|webui\.py|multiprocessing-fork|vllm|index-tts2-vLLM')
} | Select-Object ProcessId,Name,CommandLine | Format-List
```

查最近 chunk 间隔：

```powershell
D:\apiWorkSpace\index-tts2-vLLM\indextts2runtime\python.exe -c "import wave,pathlib,datetime; root=pathlib.Path('outputs/tasks'); \
for d in sorted(root.glob('stream_*'), key=lambda p:p.stat().st_mtime, reverse=True)[:5]: \
 print(d.name); prev=None; \
 for p in sorted(d.glob('chunk_*.wav')): \
  w=wave.open(str(p),'rb'); dur=w.getnframes()/w.getframerate(); w.close(); \
  t=p.stat().st_mtime; print(' ', p.name, f'dur={dur:.1f}s', datetime.datetime.fromtimestamp(t).strftime('%H:%M:%S'), '' if prev is None else f'gap={t-prev:.1f}s'); prev=t"
```

查 GPU：

```powershell
nvidia-smi --query-gpu=utilization.gpu,memory.used,memory.total --format=csv,noheader,nounits
```

## 给下一个 Codex 的提醒

- 不要再让用户“试试看”半成品。先编译、启动、确认服务起来。
- 不要改 `D:\apiWorkSpace\Index-TTS-V26`。
- 不要直接强制 70 token，用户已经明确嫌碎。
- 不要继续 120 token 流式，用户机器上已经证明会断。
- 用户是 RTX 3060 12GB，别建议换硬件。

