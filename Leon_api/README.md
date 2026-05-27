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
<script src="https://index-tts.928886540.xyz/static/tavo.js?v=20260525-fix5"></script>
```

## 访问地址

当前 API 端口：`9880`

- 局域网：`http://192.168.8.100:9880`
- 域名隧道：`https://index-tts.928886540.xyz`

Volink key 





EpqGqHO2cD69b29593b9e0c2b9e78827c3c1fQF6ahNq
