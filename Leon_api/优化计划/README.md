# IndexTTS 优化计划

## 核心目标

1. 降低用户感知首播等待时间，重点看 TTFA，不只看总 RTF。
2. 提升多角色对白的情绪表现，避免全靠 `emo_vec` 导致声音机械。
3. 弱网下保证体验可解释：不卡死、不乱跑歌词、保存完成后可切已保存音频。
4. 建立可观测流水线，让每次优化都能用数据判断效果。

## 第一阶段：指标与定位

- 后端记录 LLM 拆分耗时、首段生成耗时、每段 RTF、落盘耗时。
- 细分 TTS 内部耗时：`s2mel`、`BigVGAN`、style reference 提取。
- 前端记录首包等待、Web Audio 缓冲次数、断流次数、切保存音频次数。
- 卡片上显示简洁状态，调试面板显示详细指标。

### 2026-05-28 初次实测

- 1 段短文本生成约 5.4s 音频，总推理约 145s，整体 RTF 约 26-28。
- 日志显示 `s2mel_time=90.18s`、`bigvgan_time=30.60s`，主要瓶颈在后端推理，不是前端播放。
- 启动日志显示 `Failed to load custom CUDA kernel for BigVGAN. Falling back to torch.`，进一步查到根因是 `where cl` 找不到 MSVC `cl.exe`，需要安装/修复 Visual Studio Build Tools 或把 `VC\Tools\MSVC\...\bin\Hostx64\x64` 加入启动 PATH。
- `/tts_dialogue_job_status` 在推理期间出现超时，说明当前后台任务仍会阻塞 FastAPI 事件循环；需要把同步推理移到独立 worker/thread/process，状态接口不能被推理卡住。

### 2026-05-28 事件循环阻塞修复实测

- 将 `s2mel + BigVGAN + limiter + CPU copy` 放进 worker thread 后，推理期间 `/tts_dialogue_job_status` 可持续返回。
- 同一类短文本测试里，状态轮询延迟大多为 3-8ms，峰值约 454ms，不再出现 10-30s 超时。
- 这次修复解决的是“前端像卡死/弱网秒失败”的服务响应问题，不直接解决 RTF。
- 当前 RTF 仍高，实测约 15-16；日志显示 `s2mel_time=47.67s`、`bigvgan_time=16.43s`，下一步仍要优先处理 BigVGAN CUDA kernel 和 s2mel 性能。

### 2026-05-28 合成档位实测

- 新增 `fast / balanced / expressive` 三档，分别使用 diffusion steps 4 / 6 / 8。
- `fast`：first PCM 34.3s，RTF 10.84，总耗时 52.7s。
- `balanced`：first PCM 40.8s，RTF 12.28，总耗时 61.7s。
- `expressive`：first PCM 38.9s，RTF 12.00，总耗时 67.0s。
- 状态轮询仍可持续返回，平均几十毫秒以内；三档均未复现状态接口长时间超时。
- 这些指标只能说明速度趋势，音质/情绪保真需要人工听感 A/B；后续默认档位暂定为 `balanced`。

## 第二阶段：流式播放体验

- 明确卡片状态：`pending`、`live`、`buffering`、`saved`、`failed`。
- live 流式播放与 saved 历史播放完全分开。
- 弱网缓冲时歌词跟随真实音频时钟暂停。
- 后台保存完成后弹窗询问是否直接播放已保存音频。
- 已保存音频统一使用普通 audio 元素，支持拖动进度条。

## 第三阶段：RTF 与首播优化

- 第一段优先生成，控制第一段文本长度。
- 短对白优先，长旁白低优先级。
- 高频重复文本命中缓存：LLM 结果、segment 音频、最终合并音频。
- 检查 BigVGAN 自定义 CUDA kernel 是否加载成功，避免 fallback 到 torch 慢路径。
- style reference 只用于高价值短句，普通段落走轻量情绪参数。

## 第四阶段：情绪质量

- 增加智能模式：LLM 只给关键短句选择 style reference。
- 旁白固定 neutral，避免旁白跟剧情乱演。
- 对白按强度分层：普通对白、气声对白、短促反应、强情绪短句。
- 增加 style 样例管理和试听，方便调参数。
- 支持单段重生成，避免全文重跑。

## 可考虑中间件

- Redis：任务状态、短期缓存、轻量队列。
- SSE：后端主动推送 job 进度，减少前端轮询。
- SQLite：保存任务历史、耗时、cache 路径和错误。
- Prometheus 风格 `/metrics`：后续接入监控面板。
- Nginx/Caddy：专门服务保存音频，改善 Range 请求和拖动体验。
- FFmpeg：合并、响度归一、淡入淡出、静音裁切。

## 暂不优先

- Kafka、Kubernetes、复杂微服务拆分。
- 大规模对象存储。
- 过早引入重型任务框架。
