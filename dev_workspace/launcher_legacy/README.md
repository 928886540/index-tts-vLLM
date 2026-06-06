# LEON 启动器

给小白用户使用时，直接让他双击：

```text
LEON启动器.exe
```

不要让用户双击 `.ps1`。不要让 Codex 直接跑 `.bat` 来启动服务；`.bat` 只作为启动器内部调用和明确排障时的底层入口。

以后统一启动方式就是这个 EXE。启动器打开后只做环境检测和展示界面，不默认启动后端；需要用户手动点击界面里的 `启动服务`。点击后会调用仓库根目录的 `go-API-VLLM-NoQwen.bat`。不要改回其它临时 LAN 脚本。

启动器会在首次打开时自动做环境检测，也可以在界面里手动点击 `环境检测` / `一键修复`。

## 当前功能

- 首次启动自动检测环境。
- 手动检测 NVIDIA 驱动、CUDA Toolkit、MSVC Build Tools、项目 Python runtime、Torch CUDA、vLLM、`patch_vllm` 插件注册、模型文件、音色库、API 端口和启动 BAT。
- `svml_dispmd.dll` 按运行时可用性检测：如果当前 runtime 能正常 import Torch/vLLM，就不会因为 System32 或全局 PATH 里没有这个 DLL 而误报。
- 一键修复可处理：
  - 在明确命中 SVML/LLVM/DLL 加载问题时，复制随包 `svml_dispmd.dll` 到项目 runtime；
  - 通过 `winget` 安装 Visual Studio Build Tools；
  - 通过 `winget` 安装 NVIDIA CUDA Toolkit；
  - 在项目 runtime 里补装 `ninja`。
- 点击 `启动服务` 会调用仓库根目录的 `go-API-VLLM-NoQwen.bat`。
- 界面内可查看启动器日志和后端启动日志。
- 可刷新 `/voices` 音色列表，选择默认/旁白/对白/用户音色。
- 可用普通模式提交一次多音色测试，完成后打开 `/cache_audio/{cache_key}` 试听。
- 内置 Tavo 接入说明，可复制域名脚本、局域网脚本和默认 API 地址。
- `LEON启动器.exe` 是一个很小的 Windows 壳程序，负责绕开 `.ps1` 文件关联问题并拉起图形启动器。

## 默认地址

- API：`http://127.0.0.1:9880`
- 本地测试页：`http://127.0.0.1:9880/tavo_test`
- 局域网脚本示例：`http://192.168.8.100:9880/static/tavo.js`
- 域名脚本示例：`https://index-tts.928886540.xyz/static/tavo.js?v=20260605-ui-unify-v2`

## 发包注意

- 项目路径不要包含中文，否则 vLLM / LLVM / ninja / CUDA 编译类问题很容易出现。
- `indextts2runtime`、`checkpoints`、`prompts/library` 必须随包完整。
- 发包时保留 `LEON启动器.exe`、`LEON启动器.ps1`、`leon-launcher-banner-avatar-ai.png` 和 `leon-avatar.jpeg`。
- 不要把 API key 写进启动器或文档。当前启动器文件没有内置图像生成 key。
- 如果后续替换 UI 横幅，覆盖 `leon-launcher-banner-avatar-ai.png` 即可。
