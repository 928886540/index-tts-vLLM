# IndexTTS + TAVO 集成 — 交接文档

**最后更新**:2026-05-24
**接手者**:Codex / Claude
**用户偏好**:中文 + 大白话,简短,不要堆术语,不要建议"换硬件"

---

## 1. 项目目标

把 IndexTTS-2 接入 TAVO(酒馆类 AI 角色扮演聊天软件)做语音合成。**最终交付物面向小白**(必须能双击 .bat 跑起来,不能要求小白懂命令行)。今天是开发 Day 1。

用户 fork(日常 push):https://github.com/928886540/index-tts
官方 upstream:https://github.com/index-tts/index-tts

---

## 2. 工作目录(两份并存)

| 路径 | 用途 |
|---|---|
| `D:\apiWorkSpace\indexTTS\index-tts\` | **我们自己的版本**(uv 装,改了流式定制) |
| `D:\apiWorkSpace\Index-TTS-V26\` | 整合包(王知风做的,自带 Python runtime + DeepSpeed wheel + 模型) |

两份独立的模型权重(各 ~5GB),没共享。后续优化可以让自己版本的 `model_dir` 指向整合包的 checkpoints 省空间。

---

## 3. 硬件 / 环境

- Win 11
- **RTX 3060 12GB**(消费级,显存是硬约束)
- Python 3.10.11(系统装,uv 用它)
- 显卡驱动 591.86 / CUDA Runtime 13.1
- **CUDA Toolkit 12.8.93**(今天装的,在 `C:\Program Files\NVIDIA GPU Computing Toolkit\CUDA\v12.8\`)
- 用户本地 Clash 代理:`http://127.0.0.1:7897`
- 用户常开 ComfyUI(端口 8188),**会抢 GPU 显存** — 测速前必须杀

---

## 4. webui.py 改了什么(关键!)

文件:`D:\apiWorkSpace\indexTTS\index-tts\webui.py`

| 改动 | 描述 |
|---|---|
| `import torch / numpy / torchaudio` | 流式分支用 |
| `DEFAULT_TEST_TEXT` 常量 | 用户测试用露骨文本写死。**push 到 GitHub 前必须清空**(用户 fork 是公开的) |
| UI:`stream_mode_checkbox` | 在「生成语音」按钮旁边,流式开关 |
| UI:`hidden_stream_file` (gr.File) | 隐藏,JS 监听它的 href 变化 |
| UI:`gr.HTML('<audio id="custom_player">')` | 原生 audio 控件,在生成按钮下方 |
| `gen_single` 改为 generator | 流式分支用 `tts.infer(stream_return=True)`,缓冲算法 + 每段独立 wav |
| `demo.load(js=STREAM_JS)` 注入 JS | **不要用 `gr.Blocks(js=)`**,在 Gradio 5.45 不工作!必须用 demo.load |
| `gen_button.click(outputs=[hidden_stream_file, output_audio])` | 两个输出 |

**缓冲算法**(已实现):估算总段数 = `字数 / 60`,缓冲 `N × (1 - 1/RTF)` 段(RTF=2 时缓冲 N/2),够了一次性 yield 给前端,之后 1:1。yield 之间 `time.sleep(0.5)`(让前端 200ms 轮询跟得上,否则前端只抓到最后一个 href = "从中间开始播放" bug)。

**JS 工作方式**(借鉴 [index-tts Issue #408](https://github.com/index-tts/index-tts/issues/408)):
- MutationObserver + 200ms 轮询监听 hidden file 的 `<a href>` 变化
- 新 href 加入 audioQueue,audio 元素 `ended` 事件触发下一段
- 0.1s 静音占位符解锁浏览器 autoplay 策略

---

## 5. 性能测试结果(同一段 480 字测试)

| 配置 | gpt_gen_time | Total | Audio | **RTF** |
|---|---|---|---|---|
| 我们自己 FP16 | ~120s | ~190s | 96s | **2.0-2.25** ✓ |
| 我们自己 DeepSpeed(6Morpheus6 wheel) | 412s | 450s | 82s | **5.49 ✗ 反向加速** |
| 整合包 V26 small_gpu(FP16) | 126s | 191s | 96s | **1.98** ✓ |
| 整合包 V26 auto(DeepSpeed,版本匹配) | 446s | 494s | 86s | **5.75 ✗ 反向加速** |

**核心发现:DeepSpeed 在 3060 + IndexTTS-2 上死路一条**。
- 我们自己装失败可以归因 PyTorch 2.7 wheel 跑 2.8 runtime 的 ABI 问题
- **整合包用的是作者一起编译的 PyTorch + DeepSpeed,版本一定匹配,但 RTF 还是 5.75**
- 证明这不是版本问题,是 DeepSpeed inject 的 kernel 在 3060 Ampere + IndexTTS-2 修改版 GPT 架构上没优化好(社区 0.5 数据来自 Linux + A100)

**未验证的变量**:DeepSpeed 测试时 GPU 显存被 ComfyUI 占了 8GB(Free memory 只剩 3.75GB,日志里看到的)。用户已杀 ComfyUI 但**没再测一次 DeepSpeed** — 严格来说还有 5% 可能性显存腾出来后 DeepSpeed 能正常。下次接手可以补这一测。

---

## 6. 当前决策点(用户在选)

DeepSpeed 死透,剩 3 个选项:

| 选项 | RTF | 代价 |
|---|---|---|
| **A. 整合包 normal + 把流式定制移植过去** | 1.98 + 缓冲算法 | 改 `Index-TTS-V26/dist/.../app/webui.py`,1-2 小时 |
| **B. vLLM Windows 整合包** [BV1nhW6zoES4](https://www.bilibili.com/video/BV1nhW6zoES4/) | ~0.15(15 倍提速) | 下 8-15GB 整合包,流式定制重做,**音质有风险**([上游 Issue #208/#203/#209/#211 反馈 IndexTTS-2 vLLM 有噪音/长静音](https://github.com/Ksuriuri/index-tts-vllm/issues/208)) |
| C. 降到 IndexTTS-1.5 | ~0.7-1 | 失去情感独立控制(TAVO 核心卖点) |

**用户最后表态:倾向 B(vLLM)**,正等代价确认,还没下载。

---

## 7. 已知坑(踩过的,后续避开)

1. **`gr.Blocks(js=...)` 在 Gradio 5.45 不工作** — 必须用 `demo.load(js=...)`
2. **`gr.Audio(streaming=True)` 跟 generator 配合会 KeyError**(Gradio 内部状态机 bug),所以方案改成 #408 风格(隐藏 File + JS audio queue),不碰 Gradio streaming 协议
3. **Python stdout 默认 block-buffered**,日志显示几分钟没动 ≠ 卡死。后台跑必须加 `PYTHONUNBUFFERED=1`
4. **DeepSpeed wheel ABI 跟 PyTorch 必须匹配**(major.minor 都要):2.7 编译的 wheel 不能跑 2.8 runtime
5. **DeepSpeed import 时硬要求 nvcc**(`CUDA_HOME` 必须能跑 `nvcc -V`),没装 CUDA Toolkit 装不上
6. **中文 .bat 文件名在 Git Bash 执行失败**(编码问题),要用 `PowerShell Start-Process`
7. **cmd 快速编辑模式**:用户鼠标点 cmd 窗口会进入选中模式冻结输出,看起来像"卡了"。让用户右键标题栏 → 默认值 → 取消"快速编辑模式"
8. **ComfyUI 等 GPU 应用会抢显存**,DeepSpeed 显存不足时严重劣化,**性能测试前必须杀**
9. **整合包用 7862 端口**(不是 7860),Gradio 7860 被占就自动换
10. **`tts.infer(stream_return=True, output_path=...)`** 同时传 output_path 会在 `infer_v2.py:699` 提前 return,流式 yield 丢失 — 流式分支 `output_path=None` 是关键

---

## 8. 重要文件 / 路径

| 路径 | 内容 |
|---|---|
| `D:\apiWorkSpace\indexTTS\index-tts\webui.py` | 已改造,有 DEFAULT_TEST_TEXT 露骨常量(push 前清空!) |
| `D:\apiWorkSpace\indexTTS\index-tts\lazy_setup\` | 4 个 .bat + README,小白安装方案(进度:基础流程齐了,新增技术步骤要继续沉淀进去) |
| `D:\apiWorkSpace\indexTTS\index-tts\voice_samples\` | 5 个常用音色(高圆圆 / AD学姐 / 温柔御姐 / Jok / 风韵少妇),**已 .gitignore**,不会推 GitHub |
| `D:\apiWorkSpace\indexTTS\index-tts\.gitignore` | 加了 `/voice_samples/` |
| `D:\apiWorkSpace\Index-TTS-V26\dist\index-tts-windows-cu128-deepspeed\app\webui.py` | 整合包自带 webui(官方原版,**没有流式定制**) |
| `D:\apiWorkSpace\Index-TTS-V26\dist\...\data\checkpoints\` | 整合包自带模型(跟 ModelScope 下的同一份) |
| `D:\apiWorkSpace\Index-TTS-V26\dist\...\runtime\python.exe` | 整合包自带 Python(独立 of 系统 Python) |
| `C:\Users\Administrator\Desktop\cuda_12.8.1_installer.exe` | CUDA Toolkit 安装包(3.37GB,装完可删) |
| `C:\Users\Administrator\.claude\projects\D--apiWorkSpace-indexTTS\memory\` | 项目记忆(用户画像 / 项目目标 / 网络策略 / 反馈规则) |

---

## 9. 网络策略

- **Dev 启动 webui**:`HTTP_PROXY=http://127.0.0.1:7897 HTTPS_PROXY=http://127.0.0.1:7897`(走 Clash,首次启动 webui 要拉 facebook/w2v-bert-2.0、amphion/MaskGCT 等小模型)
- **小白懒人脚本**:`set HF_ENDPOINT=https://hf-mirror.com`(走国内 HF 镜像,不依赖代理)
- **下大模型**:走 ModelScope(`uv run modelscope download --model IndexTeam/IndexTTS-2 --local_dir checkpoints`),不走 HuggingFace
- **PyPI**:阿里云镜像 `https://mirrors.aliyun.com/pypi/simple`

---

## 10. 启动命令速查

**我们自己的版本**(在 `D:\apiWorkSpace\indexTTS\index-tts\`):
```bash
PYTHONUNBUFFERED=1 HTTP_PROXY=http://127.0.0.1:7897 HTTPS_PROXY=http://127.0.0.1:7897 \
  uv run webui.py --fp16
```
(`--deepspeed --cuda_kernel` 这两个开了反而慢 3 倍,**不要开**)

**整合包 V26**(双击):
- `D:\apiWorkSpace\Index-TTS-V26\小显卡启动版.bat` → Normal 模式(只 FP16,稳)
- `D:\apiWorkSpace\Index-TTS-V26\启动新版.bat` → Auto 模式(开 DeepSpeed,实测反向加速 3 倍,**不要用**)

---

## 11. 下一步建议

按用户最后意向:

1. **下 vLLM 整合包 BV1nhW6zoES4**(夸克网盘:https://pan.quark.cn/s/874e178da323,解压密码 `bilibili@数列解析几何一生之敌`)
2. **先纯启动跑 480 字测试,只听音质**(不管流式) — 如果有上游 Issue 反映的噪音/长静音,立刻放弃,回选项 A
3. 如果音质 OK → 移植流式定制到 vLLM 整合包的 `webui_v2.py`(架构跟官方不同,要重新做)
4. 流式定制移植完后 → 接 TAVO API server(FastAPI / WebSocket / SSE),底层调用代码可以复用

---

## 12. 长期路线(用户共识)

- IndexTTS 这层:本地推理,RTF 越低越好,流式必须实现(TAVO 用户体验关键)
- TAVO 集成层:**不要走 Gradio**(只能给浏览器),要写**独立 FastAPI/WebSocket server**,接口接收 text + voice_ref,流式返回 mp3 bytes 或 wav chunk URL,TAVO 前端自己用 Web Audio API 排队播放
- 懒人交付:lazy_setup 目录要跟着每个技术决策更新,小白双击即用是硬约束
