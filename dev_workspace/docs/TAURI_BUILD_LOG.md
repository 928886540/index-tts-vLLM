# Tauri 启动器构建日志

## 2026-06-10 - P2 日志筛选/高亮与中断交接

新增：

- 日志页增加级别筛选：
  - `全部`
  - `错误+警告`
  - `错误`
  - `警告`
  - `成功`
  - `信息`
- 日志页增加搜索框、可见/总数计数和搜索词高亮。
- 日志渲染改为内存 `logEntries` 模型，筛选/search 不再破坏当前日志列表。
- 错误/警告/成功行增加更明显的背景色；`fatal`、`panic`、`exception` 归为 error，`retry` 归为 warning。

验证已通过：

```powershell
node --check launcher-tauri\src\scripts\app.js
node --check launcher-tauri\src\scripts\mock-api.js
npm --prefix launcher-tauri run frontend:build
$env:RUSTUP_HOME='D:\Rust\.rustup'; $env:CARGO_HOME='D:\Rust\.cargo'; $env:Path='D:\Rust\.cargo\bin;' + $env:Path; cargo fmt --manifest-path launcher-tauri\src-tauri\Cargo.toml --check
$env:RUSTUP_HOME='D:\Rust\.rustup'; $env:CARGO_HOME='D:\Rust\.cargo'; $env:Path='D:\Rust\.cargo\bin;' + $env:Path; cargo check --manifest-path launcher-tauri\src-tauri\Cargo.toml
```

Vite 产物：

- `dist/index.html`: 16.24 kB
- `dist/assets/index-BLucUzJX.css`: 14.74 kB
- `dist/assets/index-BtLC2hHC.js`: 27.32 kB

未完成：

- `cargo build --release` 在本轮被用户中断，未完成可确认结果。
- 最新日志筛选/高亮 UI 尚未复制到根 `LEON-Launcher-Tauri.exe` 并跑无窗口 smoke。
- 继续前先看 `dev_workspace/docs/TAURI_HANDOFF_20260610.md`。

## 2026-06-10 - P1 基础功能推进

新增：

- Profile 新建基础版：
  - 调音台新增“新建 Profile”按钮；
  - Rust 后端从 `leon-default.json` 或 `active.json` 克隆 schema v3 模板；
  - 新文件名使用 `leon-new-profile*.json`，默认 `displayOrder=9999`；
  - 新建后自动打开编辑器，用户仍需显式保存/启用。
- Profile 编辑器基础版：
  - 详情按钮打开内嵌编辑面板；
  - 可编辑 `name`、`description`、`quality.defaultMode`、`llmPrompt`；
  - 可编辑现有 `styles` 的 `label`、`ref`、`style_alpha`、`emo_alpha`；
  - 保留完整 JSON 编辑区，避免 schema 后续扩展时丢字段；
  - 保存写回 `config/profiles/<file>.json`，保存时移除 `appliedAt` / `appliedFrom` 并刷新 `updatedAt`；
  - “保存并启用”先保存源 Profile，再写入 `config/profiles/active.json`。
- Warmup 基础入口：
  - 首页新增“模型预热”按钮；
  - 仅在 `http://127.0.0.1:9880/health` 可达时请求 `POST /warmup`；
  - 服务未运行时只提示错误，不自动启动 API。
- 日志页基础实时展示：
  - 打开日志页后每 5 秒读取一次 `logs/<version>/` 最新日志 tail；
  - 离开日志页停止轮询；
  - 手动“读取日志”仍可即时刷新。
- Profile 编辑器质量参数：
  - 支持编辑当前默认档位的 LIVE/DISK `diffusion_steps`、`prompt_audio_seconds`、`segment_tokens`、`first_tokens`、`s2mel_cfg_rate`。
- 快捷键基础版：
  - `Ctrl+R` 刷新当前页；
  - `Ctrl+L` 清空日志；
  - 输入框、下拉框、textarea 聚焦时不拦截快捷键。
- 浏览器预览 mock 补齐完整 Profile 数据、新建、保存、启用、复制、删除和 warmup fallback。

新增验证已通过：

```powershell
node --check launcher-tauri\src\scripts\app.js
node --check launcher-tauri\src\scripts\mock-api.js
npm --prefix launcher-tauri run frontend:build
cargo fmt --manifest-path launcher-tauri\src-tauri\Cargo.toml --check
cargo check --manifest-path launcher-tauri\src-tauri\Cargo.toml
cargo build --release --manifest-path launcher-tauri\src-tauri\Cargo.toml
$env:LEON_LAUNCHER_SMOKE_TEST='1'; Start-Process -FilePath D:\apiWorkSpace\leon_api\LEON-Launcher-Tauri.exe -WorkingDirectory D:\apiWorkSpace\leon_api -Wait -PassThru
```

最新根目录 exe：

- `LEON-Launcher-Tauri.exe`: 3,680,768 bytes
- 无窗口 smoke 结果：`ExitCode=0`

注意：`npm --prefix launcher-tauri run frontend:build` 会清空并重建 `launcher-tauri/dist/`；不要和 `cargo check` / `cargo build` 并行跑，否则 Tauri `generate_context!` 可能在 asset 重建瞬间读到旧 hash 文件名。

仍未验证：

- 未打开真实 Tauri GUI 点击编辑器。
- 未启动 LEON API 服务，因此 warmup 只完成了编译路径，未跑真实 `/warmup`。
- 未做完整 WinForms 功能对等，例如拖拽排序、日志 watcher、通知系统、错误高亮。

## 2026-06-10 - P0 可构建版本

产物：

- 根目录可执行文件：`D:\apiWorkSpace\leon_api\LEON-Launcher-Tauri.exe`
- Tauri release exe：`launcher-tauri/src-tauri/target/release/leon-launcher-tauri.exe`
- NSIS 安装包：`launcher-tauri/src-tauri/target/release/bundle/nsis/LEON Launcher_1.0.0_x64-setup.exe`

体积：

- `LEON-Launcher-Tauri.exe`: 3,633,664 bytes
- `LEON Launcher_1.0.0_x64-setup.exe`: 1,527,134 bytes

已完成：

- Tauri 2 + Rust + Vanilla JS 项目骨架可编译。
- 前端从纯 `mock-api.js` 切到 Tauri `window.__TAURI__.core.invoke`，浏览器预览仍保留 mock fallback。
- Rust 后端接入真实 LEON 合同：
  - Profile 列表读取 `config/profiles/*.json`；
  - 启用 Profile 写入 `config/profiles/active.json`，并保留 `appliedAt` / `appliedFrom`；
  - 服务启动调用真实脚本 `scripts/start-vllm-api.bat` / `scripts/start-fast6g-api.bat`；
  - 启动环境写入 `LEON_ACTIVE_PROFILE_PATH`、`LEON_LAUNCHER_VERSION`、`LEON_ENABLE_QWEN_EMO=0`、`PYTHONUTF8`、`PYTHONIOENCODING`；
  - vLLM 启动写入 `INDEXTTS_VLLM_GPU_MEMORY_UTILIZATION` 和 `LEON_ENABLE_MSVC=1`；
  - 停止服务先请求 `GET http://127.0.0.1:9880/control?command=exit`；
  - 健康检查轮询 `GET http://127.0.0.1:9880/health`。
- 复用 `launcher/leon-launcher.ico` 到 Tauri 图标。
- 加入 `LEON_LAUNCHER_SMOKE_TEST=1` 的无窗口 smoke 路径：只检查 LEON 根目录、Profile 列表和 `active.json`，不启动 API。

验证通过：

```powershell
node --check launcher-tauri\src\scripts\app.js
node --check launcher-tauri\src\scripts\mock-api.js
npm --prefix launcher-tauri run frontend:build
cargo fmt --manifest-path launcher-tauri\src-tauri\Cargo.toml --check
cargo check --manifest-path launcher-tauri\src-tauri\Cargo.toml
cargo build --manifest-path launcher-tauri\src-tauri\Cargo.toml
npm --prefix launcher-tauri run build
$env:LEON_LAUNCHER_SMOKE_TEST='1'; Start-Process -FilePath D:\apiWorkSpace\leon_api\LEON-Launcher-Tauri.exe -WorkingDirectory D:\apiWorkSpace\leon_api -Wait -PassThru
```

Smoke 结果：`ExitCode=0`。

注意：

- 未做真实 GUI 点击验证。
- 未启动 LEON API 服务，避免影响用户当前运行环境。
- `npm install` 生成了 `package-lock.json`；`node_modules/` 和 Tauri `target/` 是本地构建产物，不应提交。
- `npm audit` 报 2 个 moderate 级别依赖审计项；暂未执行 `npm audit fix --force`，避免破坏 Tauri/Vite 版本组合。

## 下一步

优先补 P1 中最影响可用性的功能：

1. Profile 复制 / 删除 / 预检，不做完整复杂编辑器。
2. 日志页读取 `logs/<version>/` 最新 stdout/stderr/api 日志。
3. 环境页补端口占用 PID、Python 路径、GPU 显存展示。
4. GUI 手动 smoke：打开 Tauri 启动器，确认 Profile 列表、启用、状态轮询、停止按钮反馈。
