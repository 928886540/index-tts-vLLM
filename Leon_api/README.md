# Leon_api

`Leon_api/` 是开发协作区，不是正式 API 目录，也不进最终小白用户发包。

正式运行代码在仓库根目录：

- `indextts2_api.py`：API 服务入口，默认端口 `9880`
- `static/tavo.js`：TAVO 单脚本轻入口；完整播放器 runtime 在 `static/tavo.runtime.js` 和 `static/tavo.runtime.parts/`
- `indextts/`：音色库、缓存、SQLite profile、LLM 代理等模块
- `prompts/library/`：默认音色库

当前优先看的文档：

- `AGENTS.md`：进入本协作区前必须遵守的规则
- `docs/AGENT_STATE.md`：当前真实进度、运行状态、交接重点
- `docs/ARCHITECTURE.md`：当前架构边界和 Tavo/缓存/资源模型
- `docs/DECISIONS.md`：已经接受的产品/工程决策
- `docs/BUGS.md`：bug 台账；用户报新 bug 后先记录再改代码
- `docs/TODO.md`：优先级和下一步
- `docs/REGRESSION.md`：修复后的回归清单

历史交接仍保留在 `handoff_docs/`，但新工作优先更新 `docs/`。

## 2026-05-29 Codex 接手快照（历史）

先看这里，避免下个 Codex 又从旧文档绕远路。

- 当前主分支：`VLLM`
- 当前功能基线提交：`f0269e6 Fix Tavo role mapping and stream resume`
- 2026-05-30 继续前已先按用户要求推 checkpoint：`dde94ce Checkpoint Tavo playback tuning`
- 2026-05-30 当前未推修复方向：
  - `static/tavo.js`：播放器卡片新增后退/快进 10 秒按钮，进度条圆点加大；歌词点击、进度拖动、后台媒体按钮统一走同一个 seek 入口。
  - `static/tavo.js`：系统后台/锁屏媒体图不再使用当前角色小头像，改用 `static/tavo-now-playing-cover.png` 大图。
  - `static/tavo.js` + `indextts2_api.py`：`segments_meta` 保存/返回 `start_s/start_offset_bytes/duration_s/sample_rate`，前端字幕用真实起始时间校准，减少切后台回来后歌词和进度错位。
  - `indextts/gpt/model_vllm_v2.py` + `indextts/infer_vllm_v2.py`：TAVO/API 传入的 `top_p/top_k/temperature/repetition_penalty` 现在真正进入 vLLM `SamplingParams`；之前这些参数在 vLLM 路径基本没生效。
  - 音质默认值已向质量侧移动：TAVO 默认 `qualityMode=balanced`，fast/balanced/expressive 对应 diffusion `8/14/16`；balanced/expressive 参考音频与分段窗口更长，默认采样 `top_p=0.8 temperature=0.7 repetition_penalty=1.2`。
- 已过的轻量验证：`node --check static\tavo.js`，`python -m py_compile indextts2_api.py indextts\infer_vllm_v2.py indextts\gpt\model_vllm_v2.py`，运行时 Python 下的 `vllm.SamplingParams` 参数实例化检查，`node Leon_api\dev_tools\test_tavo_widget_playwright.js`，以及 `/static/tavo-now-playing-cover.png` 返回 200。
- 注意：当前会话没有可用的内置 image2 工具入口，`OPENAI_API_KEY` 也没设置；所以背景图先用本地 Pillow 生成 PNG 接入。若后续要严格换成 image2 生成图，覆盖同一路径 `static/tavo-now-playing-cover.png` 即可。
- 不要把当前工作区里 `prompts/` 和 `音色参考音频/` 的大量素材删除/新增混进本轮提交，上一轮 checkpoint 也刻意排除了这些音频素材变动。
- 本轮只新增了声腔参考说明：`prompts/library/声腔/说明.txt`
- 不要在用户正在用服务时启动长音频测试、批量 TTS 或重启 API；需要测真实音频时先确认用户没在用。
- TAVO 前端、角色映射、播放卡片、`tavo.get` / `tavo.set`、Advanced Rendering、正则注入相关改动，必须先读本机 `tavo` skill：`C:\Users\Administrator\.codex\skills\tavo\SKILL.md`
- 机器规则也必须先读：`C:\Users\Administrator\.codex\AGENTS.md` 和 `C:\Users\Administrator\.codex\instruction.md`

最近已经处理过的关键点：

- 角色映射默认行应是 `旁白 / 用户 / 当前角色名`，不是字面量 `角色`。
- 第三行当前角色映射可删除，`旁白` 和 `用户` 常驻。
- 切换/重命名角色时，要用保存的 `characterName` 迁移旧映射，不能复制出同音色重复角色。
- LLM 拆段后处理：无引号正文强制归 `旁白`；只有引号里的直接台词才归 `用户` 或具体角色。
- 前端字幕优先用后端 `segments_meta` 补全，避免后半段歌词丢失。
- WebAudio 流式暂停后续播要从暂停秒数继续，不能从头播放落盘音频。
- 音色选择器两列必须固定宽度，长音色名不要撑开布局。

固定验证方式：

```powershell
node --check static\tavo.js
node --check Leon_api\dev_tools\test_tavo_widget_playwright.js
python -m py_compile indextts2_api.py
node Leon_api\dev_tools\test_tavo_widget_playwright.js
```

注意：Playwright runner 固定在 `%TEMP%\idx-playwright-runner`，不要在仓库里装 `node_modules` 或新浏览器。

## TAVO 开发硬性要求

凡是修改 `static/tavo.js`、TAVO 注入脚本、TAVO 正则接入、`tavo.get`/`tavo.set` 持久化、消息/角色/聊天上下文、Advanced Rendering 相关逻辑时，必须先使用 `$tavo` / `tavo` skill，并优先按该 skill 的 JavaScript API 规则处理持久化和上下文读取。

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

## TAVO WebUI 测试固定方案

以后测试 `static/tavo.js` 统一使用这个方案，不要新建另一套测试页，也不要在仓库里安装 Playwright / 浏览器 / `node_modules`。

固定入口：

- 测试页：`http://127.0.0.1:9880/tavo_test`
- 页面文件：`static/tavo_widget_test.html`
- 自动化脚本：`Leon_api/dev_tools/test_tavo_widget_playwright.js`
- Playwright 临时 runner：`%TEMP%\idx-playwright-runner`
- 浏览器缓存：默认 Playwright 缓存目录 `%LOCALAPPDATA%\ms-playwright`

第一次机器上没有 runner 时，只允许装到固定临时目录：

```powershell
$tmp = Join-Path $env:TEMP 'idx-playwright-runner'
New-Item -ItemType Directory -Force -Path $tmp | Out-Null
Push-Location $tmp
npm init -y
npm install playwright@1.60.0 --no-audit --no-fund
npx playwright install chromium
Pop-Location
```

常规测试命令：

```powershell
node Leon_api\dev_tools\test_tavo_widget_playwright.js
```

脚本当前固定检查：

- `/tavo_test` 能挂载真实 `/static/tavo.js`
- 初始挂载只出现 `.idx-lazy-card`，不加载 runtime manifest/parts
- 初始挂载不请求 `/voices`
- 初始挂载不创建 TTS job
- 点 lazy 卡片打开播放器，再点播放器设置后加载 1 个 manifest 和 16 个 runtime parts
- 歌词区高度固定为 `136px`
- 打开音色选择器后才请求 `/voices`
- 音色网格能渲染
- mock 智能生成：同一消息重挂载后生成两次，前端 `/parse_text` 请求数必须为 0，只提交 mocked dialogue job；job body 必须包含原文、音色映射、LLM 配置和 Tavo 用户/角色上下文
- 页面没有 `pageerror` 和关键 `console error`

如果要测别的地址，只改环境变量，不要复制一份脚本：

```powershell
$env:TAVO_TEST_URL = 'http://127.0.0.1:9880/tavo_test'
node Leon_api\dev_tools\test_tavo_widget_playwright.js
```

## TAVO 正则接入

正则里用最新版脚本：

```html
<script src="https://index-tts.928886540.xyz/static/tavo.js?v=20260605-job-parse-v1"></script>
```

## 访问地址

当前 API 端口：`9880`

- 局域网：`http://192.168.8.100:9880`
- 域名隧道：`https://index-tts.928886540.xyz`

Volink key 

EpqGqHO2cD69b29593b9e0c2b9e78827c3c1fQF6ahNq

https://docs.volink.org/
