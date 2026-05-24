# IndexTTS2 vLLM 工作总结

最后更新：2026-05-25 00:30 左右

正确工作目录：

```text
D:\apiWorkSpace\index-tts2-vLLM
```

远端仓库：

```text
https://github.com/928886540/index-tts-vLLM
branch: VLLM
latest pushed commit: ff9e8de Avoid Unicode startup log on Windows
```

## 当前状态

当前已启动过一个可见 `cmd /k go-webui-VLLM-NoQwen.bat` 窗口：

```text
cmd.exe PID: 6916
python.exe PID: 5228
multiprocessing-fork PID: 1228
```

刚检查时 `7860` 还没有监听，可能仍在模型初始化阶段。若窗口退出，先看 cmd 里的 traceback。

当前 git 工作区只剩未跟踪文件/目录：

```text
HANDOFF.md
HANDOFF_STREAMING_20260524.md
音色参考音频/
```

这些没有提交到远端。

## 已推送提交

```text
ff9e8de Avoid Unicode startup log on Windows
8590666 Save trimmed prompt audio history
0a0eea9 Reduce streaming diffusion memory pressure
9bebafd Add V26 audit report for TAVO integration planning
c5d5c14 Keep final stream chunk visible
14cfdab Fix voice history update loop
e6c5666 Add voice history and tune streaming defaults
d2449ec Improve streaming segmentation and playback
```

## 关键修复

### 1. 流式分句

新增“完整句优先”的流式软分句：

```text
indextts/utils/front.py
TextTokenizer.split_segments_by_sentence_boundary(...)
```

逻辑：

- 优先按完整句末边界切，不只是 `。！？`，也覆盖英文 `.?!`、省略号、收尾引号/括号等。
- 数字只是目标和保险上限，不再按固定 token 硬切正常句子。
- 单句超过保险上限时，才退到逗号、顿号、分号、冒号、破折号等弱边界。
- 再不行才硬切。

WebUI 流式默认参数现在是：

```python
STREAM_TARGET_SEGMENT_TOKENS = 72
STREAM_HARD_SEGMENT_TOKENS = 82
STREAM_FIRST_SEGMENT_TOKENS = 36
STREAM_MIN_SEGMENT_TOKENS = 24
STREAM_DIFFUSION_STEPS = 8
STREAM_PROMPT_AUDIO_SECONDS = 8
```

### 2. 流式播放器

修复过两个问题：

- 加了小的 jitter/prebuffer，防止下一段稍晚到时立刻断。
- 最终音频返回时保留最后一个 hidden chunk 的值，避免前端还没轮询到最后一段就被清空。

对应问题：实际生成了 `chunk_001` 到 `chunk_011`，但页面只显示 10 段。修复提交：

```text
c5d5c14 Keep final stream chunk visible
```

### 3. 音色试用记录

用户指出之前实现错了：保存了原始上传音频，而不是 Gradio 音频控件裁剪后的片段。

现在改成：

- 上传音频时只启用生成按钮，不写历史。
- 点“生成语音”时，保存当前实际传给 `gen_single(prompt=...)` 的音频路径。
- 旧的错误历史记录会被隐藏，因为记录必须带：

```json
"saved_from": "generation_prompt"
```

注意：这依赖 Gradio 在用户 Trim 后把裁剪音频路径传给 `prompt`。如果后续还发现历史里是完整 26 秒，下一步要改成自定义前端裁剪或显式读取 Gradio 裁剪输出。

### 4. 长参考音频导致性能炸

关键日志：

```text
>> s2mel input 1/13: text_tokens=32, semantic_codes=311, target_frames=534, cat_frames=2739, diffusion_steps=8
6/8 [01:25<00:28, 14.46s/it]
```

判断：

- `text_tokens=32` 不长。
- `target_frames=534` 是当前要生成的小段，也正常。
- `cat_frames=2739` 太大，是“参考音频 prompt + 当前生成段”一起进 s2mel。
- 用户的参考音频约 26 秒，导致每个流式 chunk 都背着超长参考音频跑扩散。

已加保险：

```text
indextts/infer_vllm_v2.py
max_prompt_audio_seconds
max_emo_audio_seconds
trim_audio_for_prompt(...)
```

WebUI 流式调用传：

```python
max_prompt_audio_seconds=8
max_emo_audio_seconds=8
```

下次日志里应看到类似：

```text
>> trim reference audio from 26.xx s to 8.00s
```

并且 `cat_frames` 应明显下降。

### 5. s2mel 扩散显存优化

修改文件：

```text
indextts/s2mel/modules/flow_matching.py
```

改动：

- 去掉 `sol.append(x)`，因为推理只返回最后一步，存所有中间步浪费显存。
- 把 CFG 中不变的 `prompt/style/mu` 拼接移到循环外。
- 只在循环里拼接每步变化的 `x/t`。

目的：降低扩散阶段反复大分配造成的 12GB 显存抖动。

### 6. Windows 启动 GBK 崩溃

报错：

```text
UnicodeEncodeError: 'gbk' codec can't encode character '\u2705'
```

原因：

```text
patch_vllm.py
print("✅  Registry GPT2TTSModel to vllm")
```

已改为 ASCII：

```python
print("Registry GPT2TTSModel to vllm")
```

提交：

```text
ff9e8de Avoid Unicode startup log on Windows
```

## 需要继续验证

1. 启动 WebUI 后刷新页面。
2. 重新上传音频并在 Gradio 音频控件里裁剪。
3. 点生成，让新历史记录保存“生成时实际 prompt”。
4. 看 cmd 日志：

```text
>> trim reference audio from ... to 8.00s
>> s2mel input ... cat_frames=...
>> chunk x/y: text_tokens=..., audio=..., elapsed=..., RTF=...
```

期望：

- `cat_frames` 不再接近 2700。
- 第一段不应再 1 分钟还不吐 chunk。
- `chunk` 的 RTF 尽量低于 1。

## 判断标准

如果再次炸性能，先看 `s2mel input`：

- `cat_frames` 很大：参考音频还是太长，说明裁剪/历史记录仍然拿错文件。
- `target_frames` 很大：该文本段生成语音太长，需要继续降 token 或降低采样随机性。
- `cat_frames` 正常但每步仍十几秒：可能是显存仍然太满，需要降低 vLLM `gpu_memory_utilization` 或进一步减少常驻模型显存。

## 不要再做的事

- 不要把 `音色参考音频/`、`prompts/history/`、`prompts/audio_history.json` 推上 GitHub。
- 不要继续用 26 秒参考音频作为流式 s2mel prompt。
- 不要只靠 buffer 解决流式卡顿；buffer 只能遮短抖动，遮不住 RTF 长期大于 1。
- 不要改到 `D:\apiWorkSpace\Index-TTS-V26`。

