# Leon_api

`Leon_api/` 是开发协作区，不是正式 API 目录，也不进最终小白用户发包。

正式运行代码在仓库根目录：

- `indextts2_api.py`：API 服务入口，默认端口 `9880`
- `static/tavo.js`：TAVO 单脚本播放器
- `indextts/`：音色库、缓存、SQLite profile、LLM 代理等模块
- `prompts/library/`：默认音色库

当前只需要看的文档：

- `handoff_docs/CURRENT_STATUS.md`：当前真实进度、测试入口、已知问题
- `handoff_docs/QUICKSTART_TAVO.md`：TAVO 正则接入方式

其它旧计划、审计、历史交接都放在：

- `handoff_docs/archive/20260525/`

辅助目录：

- `dev_tools/`：本地测试 HTML，例如 `tavo_widget_test.html`
- `screenshots/`：开发截图，不进入正式包
- `code_snapshot/`：历史代码快照，只用于对照

打包给用户时排除整个 `Leon_api/`。

## 启动服务

仓库目录：`D:\apiWorkSpace\index-tts2-vLLM`

前台启动（占当前窗口）：

```powershell
. .\indextts2runtime\python.exe indextts2_api.py -a 0.0.0.0 -p 9880 --fp16 --cuda_kernel
```

后台启动（不占当前窗口）：

```powershell
Start-Process -FilePath "D:\apiWorkSpace\index-tts2-vLLM\indextts2runtime\python.exe" -ArgumentList "indextts2_api.py -a 0.0.0.0 -p 9880" -WorkingDirectory "D:\apiWorkSpace\index-tts2-vLLM"
```

## TAVO 正则接入

正则里用最新版脚本：

```html
<script src="https://index-tts.928886540.xyz/static/tavo.js?v=20260528-latencyfix"></script>
```

本机/局域网调试可以用：

```html
<script src="http://192.168.8.100:9880/static/tavo.js?v=20260528-latencyfix"></script>
```

改完 `static/tavo.js` 后一定换 `v=`，否则 TAVO WebView 可能继续用旧缓存。

## 访问地址

当前 API 端口：`9880`

- 局域网：`http://192.168.8.100:9880`
- 域名隧道：`https://index-tts.928886540.xyz`

常用检查：

- 健康检查：`http://127.0.0.1:9880/health`
- TAVO 测试页：`http://127.0.0.1:9880/tavo_test`
- 注入脚本：`http://127.0.0.1:9880/static/tavo.js?v=dev`
- 旁白图标：`http://127.0.0.1:9880/prompts/icon/common.png`
- 历史缓存音频：`/cache_audio/{cache_key}`

## TAVO 播放器当前规则

配置保存位置：

- 全局配置：LLM 地址、模型、API Key、模式、采样参数、播放语速，写入 `tavo.set(..., "global")`。
- 角色配置：默认音色、角色音色映射，写入 `tavo.set(..., "character")`。
- 单条消息历史：生成出的 `cacheKey`、segments、voicesMap，写入当前 chat 的 `tavo.set`。

角色映射：

- 固定保留 `旁白`、`用户` 两个槽位。
- 具体人物用原文角色名，例如 `潘金莲`、`兰绯`。
- LLM 解析时，原文里的 `你` 和当前用户身份名会统一成 `用户`。
- 不把 `我` 当用户，因为正文第一人称常常是角色自述。
- 无引号动作、心理、环境描写默认归 `旁白`；只有直接对白才归说话人。

声腔/情绪：

- `emo_vec` 仍支持，但更适合普通情绪，例如旁白中性、悲伤、惊讶等。
- `style`/`style_ref` 是段级声腔控制，适合气声、耳语、哭腔、短促反应等声音形态。
- 后端会把 `style` 映射到 `prompts/library/声腔/*.wav`，作为 `emo_audio_prompt` 使用。
- 目前内置 style：`breath_soft`、`breath_heavy`、`intimate_breath`、`moan_soft`、`low_murmur`、`whisper_soft`、`shy_whisper`、`tense_breath`、`sob_soft`、`cry_soft`、`tease_soft`、`laugh_soft`、`gasp_surprise`，以及阶段型 `stage_warmup`、`stage_rising`、`stage_peak`、`stage_afterglow`。

流式播放：

- 手机 UA 默认走 Web Audio 真流式，绕开部分 WebView 对 chunked WAV 的 `<audio>` 限制。
- 桌面端仍可直接用 `<audio src>` 播放流式地址。
- 服务端会立刻返回 `cache_key`，前端先保存占位卡；生成完成后写入 `/cache_audio/{cache_key}`，刷新后可恢复。
- 切到占位卡时会清空旧进度和旧歌词，歌词面板显示当前状态，例如 AI 分析中、合成中、等待缓存。
- 播放中“正在播放”会跟当前 segment 的 role 和音色映射变化，例如 `潘金莲 / xxx.wav`、`旁白 / narrator.wav`。
- 手机端在第一块 PCM 到达前只显示 `等待首段音频 Ns`，不会提前写 `正在播放`。
- 手机 Web Audio 播完后只记录缓存 URL，不立刻后台挂载 `<audio>`，避免成功播放后又弹元素加载错误。

性能排查：

- 正常情况下 `/tts_dialogue_stream_job` 应该很快返回 `cache_key`，真正等待的是第一段 TTS PCM。
- 如果极短句首段也要几十秒，先查 `nvidia-smi` 是否有旧的 `indextts2runtime\python.exe` vLLM 子进程残留。
- 本次实测：清掉旧孤儿 vLLM 进程后，极短句首块从约 `50s` 降到约 `13s`，RTF 从约 `12` 降到约 `3.1`。
- 日志里如果看到 `Failed to load custom CUDA kernel for BigVGAN`，说明 BigVGAN CUDA fused kernel 没启用；当前仍可跑，但不是最快路径。

后台/锁屏：

- 旁白头像使用 `prompts/icon/common.png`，通过 `/prompts/icon/common.png` 暴露给前端。
- 系统媒体面板 artwork 要用方形图，否则手机后台会自动补白。

## Volink 声腔参考音频

生成脚本：

```powershell
$env:VOLINK_API_KEY="你的 Volink key"
.\indextts2runtime\python.exe .\Leon_api\dev_tools\volink_style_refs.py
```

输出目录：

```text
prompts/library/声腔/
```

不要把 Volink key 写进 README 或提交到 git。
