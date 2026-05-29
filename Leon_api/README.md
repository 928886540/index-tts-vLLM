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
- 初始挂载不请求 `/voices`
- 初始挂载不创建 TTS job
- 歌词区高度固定为 `148px`
- 打开音色选择器后才请求 `/voices`
- 音色网格能渲染
- 页面没有 `pageerror` 和关键 `console error`

如果要测别的地址，只改环境变量，不要复制一份脚本：

```powershell
$env:TAVO_TEST_URL = 'http://127.0.0.1:9880/tavo_test'
node Leon_api\dev_tools\test_tavo_widget_playwright.js
```

## TAVO 正则接入

正则里用最新版脚本：

```html
<script src="https://index-tts.928886540.xyz/static/tavo.js?v=20260525-fix5"></script>
```

## 访问地址

当前 API 端口：`9880`

- 局域网：`http://192.168.8.100:9880`
- 域名隧道：`https://index-tts.928886540.xyz`

Volink key 

EpqGqHO2cD69b29593b9e0c2b9e78827c3c1fQF6ahNq

https://docs.volink.org/
