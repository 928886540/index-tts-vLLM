# LEON Tavo V1 发布包说明

本版本拆成三个 7z 包：

- `leon-common-v1.7z`：必装。包含启动器、共享脚本、Tavo 前端、Profile 配置、声库/声腔参考音频。
- `leon-vllm-v1.7z`：可选。质量优先引擎，包含 vLLM 后端、模型 checkpoints 和 Python runtime。
- `leon-fast6g-v1.7z`：可选。6 GB 显存友好引擎，包含 fast6g 后端、模型 checkpoints 和 Python runtime。

## 安装方式

1. 新建一个安装目录，例如 `D:\LEON_Tavo_V1`。
2. 先把 `leon-common-v1.7z` 解压到这个目录。
3. 再把 `leon-vllm-v1.7z`、`leon-fast6g-v1.7z` 中至少一个解压到同一个目录。
4. 解压后目录里应该能看到：

```text
LEON-Launcher-Tauri.exe
config\
prompts\
scripts\
static\
vllm\        （如果安装 vllm 包）
fast6g\      （如果安装 fast6g 包）
```

## 启动

双击：

```text
<安装目录>\LEON-Launcher-Tauri.exe
```

启动器打开时不会自动启动 TTS 服务。选择 `vllm` 或 `fast6g` 后，手动点击启动。

环境监测不会在启动器打开时自动跑，避免卡顿。需要检查时进入环境页面手动刷新；能一键修复的只包括安全的本地项，例如创建缺失的 `active.json`、创建日志/缓存目录、清理 LEON 自己占用的异常端口或残留进程。显卡驱动、缺失模型包、缺失 runtime、非 LEON 程序占用显存这类问题不会静默修复，会给出明确提示。

## 快速测试

- 试听参考音频是离线本地播放，不需要启动服务。
- “生成试听”需要先启动 `vllm` 或 `fast6g` 服务；如果服务没有运行，启动器会提示并禁用生成入口。

## Tavo 接入

服务启动后，Tavo 注入脚本使用：

```html
<script src="http://<本机或局域网IP>:9880/static/tavo.js?v=20260612-mp3-cache-v70"></script>
```

同一台机器可用 `127.0.0.1`，手机或局域网设备用启动器日志里显示的 LAN 地址。
