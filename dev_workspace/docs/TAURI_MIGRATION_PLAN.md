# Tauri 启动器迁移计划

创建时间：2026-06-09
目标：全新实现 Tauri 版 LEON 启动器，完全独立，可无缝替换现有 WinForms 版本

## 项目目标

### 核心原则
1. **完全独立**：新项目独立目录，不修改现有 WinForms 代码
2. **无缝切换**：配置文件、API 端点、目录结构完全兼容
3. **视觉升级**：充分利用美术资产，达到 90%+ 美观度
4. **功能对等**：实现现有启动器的所有核心功能

### 目标产物
- `LEON-Launcher-Tauri.exe`（独立可执行文件）
- 包体目标：< 10 MB
- 启动速度：< 2 秒
- 用户只需要把新 exe 放到项目根目录，双击运行

---

## 技术栈选型

### 后端
- **Tauri 2.x**（最新稳定版）
- **Rust**（业务逻辑）
- 依赖库：
  - `serde_json`（JSON 处理）
  - `tokio`（异步运行时）
  - `reqwest`（HTTP 请求，健康检查）
  - `sysinfo`（系统信息、GPU 检测）

### 前端
- **纯 Vanilla JS + HTML + CSS**（无框架，保持轻量）
- **Tailwind CSS**（快速实现现代 UI）
- **动画库**：CSS Animations + 必要时用 GSAP
- 不引入 Vue/React，保持简单直接

### 打包
- Tauri 内置打包工具
- 目标平台：Windows 10/11 x64
- 图标：复用现有 `launcher/leon-launcher.ico`

---

## 项目结构

```
leon_api/
├── launcher-tauri/              ← 新建独立目录
│   ├── src-tauri/               ← Rust 后端
│   │   ├── src/
│   │   │   ├── main.rs          ← 入口
│   │   │   ├── profile.rs       ← Profile 管理
│   │   │   ├── service.rs       ← 服务启动/健康检查
│   │   │   ├── env_check.rs     ← 环境检测
│   │   │   └── log_reader.rs    ← 日志读取
│   │   ├── Cargo.toml
│   │   ├── tauri.conf.json      ← Tauri 配置
│   │   └── icons/               ← 应用图标
│   │
│   ├── src/                     ← 前端源码
│   │   ├── index.html           ← 主页面
│   │   ├── styles/
│   │   │   ├── main.css         ← 主样式
│   │   │   └── components.css   ← 组件样式
│   │   ├── scripts/
│   │   │   ├── app.js           ← 主逻辑
│   │   │   ├── profiles.js      ← Profile 管理
│   │   │   ├── service.js       ← 服务控制
│   │   │   └── logs.js          ← 日志展示
│   │   └── assets/
│   │       ├── characters/      ← 人物卡片图片（软链接）
│   │       └── waveforms/       ← 波形动画（软链接）
│   │
│   ├── package.json             ← 前端构建配置
│   └── README.md                ← 项目文档
│
├── config/profiles/             ← 配置文件（共享）
├── launcher/                    ← 旧版 WinForms（保留）
└── LEON-Launcher-Tauri.exe      ← 最终产物
```

---

## 功能清单与优先级

### P0 - 核心功能（第一周）
- [x] 项目初始化（Tauri + Rust + 前端骨架）
- [x] 窗口配置（大小、标题、图标、DPI 适配）
- [x] 基础视觉集成（顶部人物卡、左侧导航、主视觉背景）
- [x] Profile 列表展示（读取 `config/profiles/*.json`）
- [x] Profile 激活切换（写入 `config/profiles/active.json`）
- [x] 服务启动控制（vLLM/fast6g 切换、启动脚本调用）
- [x] 健康检查（轮询 `http://127.0.0.1:9880/health`）

### P1 - 高级功能（第二周）
- [x] Profile 新建/复制/删除（基础版；新建从默认/active 模板克隆）
- [x] Profile 编辑器基础版（名称、描述、默认档位、LIVE/DISK 核心质量参数、LLM Prompt、声腔基础字段、完整 JSON）
- [x] 日志实时展示基础版（打开日志页后轮询 `logs/<version>/` 最新 tail）
- [x] 环境检测基础版（GPU 信息、端口占用、Python 版本）
- [x] 测试功能基础版（Profile schema v3 预检、服务运行时 `/warmup`）
- [x] 一键停止服务基础版

### P2 - 体验优化（第三周）
- [ ] 启动动画（加载过渡）
- [ ] 状态指示器（服务运行状态、GPU 占用）
- [ ] 通知系统（启动成功/失败提示）
- [x] 错误日志高亮/筛选（级别筛选、搜索、命中计数、错误/警告高亮）
- [x] 快捷键基础版（Ctrl+R 刷新当前页、Ctrl+L 清空日志；输入框聚焦时不拦截）
- [ ] 打包优化（压缩、代码签名）

---

## 兼容性保证

### 配置文件兼容
- 读取相同的 `config/profiles/*.json`
- 写入相同的 `config/profiles/active.json`
- Profile schema v3 完全兼容
- 环境变量 `LEON_ACTIVE_PROFILE_PATH` 使用相同值

### API 调用兼容
- 健康检查：`GET http://127.0.0.1:9880/health`
- Profile 读取：`GET http://127.0.0.1:9880/profiles/active`
- 测试端点：`GET http://127.0.0.1:9880/voices`
- Warmup：`POST http://127.0.0.1:9880/warmup`

### 目录结构兼容
- 工作目录：`D:\apiWorkSpace\leon_api`
- 脚本目录：`scripts/start-vllm-api.bat`、`scripts/start-fast6g-api.bat`
- 日志目录：`logs/vllm/`、`logs/fast6g/`
- Profile 目录：`config/profiles/`

### 启动参数兼容
- vLLM GPU 比例：`--vllm_gpu_memory_utilization`
- Active Profile：`LEON_ACTIVE_PROFILE_PATH` 环境变量
- 端口：固定 9880

---

## UI 设计规范

### 色彩系统（从现有美术资产提取）
```css
/* 背景 */
--bg-primary: #1a1a1a;          /* 主背景 */
--bg-secondary: #2d2d30;        /* 卡片背景 */
--bg-tertiary: #3e3e42;         /* 悬停背景 */

/* 文字 */
--text-primary: #ffffff;
--text-secondary: #cccccc;
--text-tertiary: #858585;

/* 强调色（从人物卡边框提取）*/
--accent-gold: #ffd700;
--accent-cyan: #00d4ff;
--accent-pink: #ff6ba9;
--accent-purple: #b794f6;

/* 功能色 */
--success: #16c60c;
--warning: #f59e0b;
--error: #ef4444;
--info: #3b82f6;

/* 边框 */
--border-subtle: rgba(62, 62, 66, 0.6);
--border-bright: rgba(255, 255, 255, 0.2);
```

### 组件规范
- **圆角**：按钮 8px，卡片 12px，面板 16px
- **阴影**：`0 4px 12px rgba(0, 0, 0, 0.3)`
- **间距**：基础单位 8px（8px、16px、24px、32px）
- **字体**：Microsoft YaHei UI / Segoe UI / 苹方-简
- **字号**：标题 18px、正文 14px、小字 12px

### 动画
- **过渡时长**：200ms（hover）、300ms（modal）
- **缓动函数**：`cubic-bezier(0.4, 0, 0.2, 1)`
- **加载动画**：脉冲、旋转、波形
- **交互反馈**：点击涟漪、拖拽阴影

---

## 实施步骤

### Phase 1: 项目搭建（Day 1）
1. 安装 Rust 工具链（rustup + Visual Studio Build Tools）
2. 创建 Tauri 项目：`npm create tauri-app`
3. 配置 `tauri.conf.json`（窗口大小、图标、权限）
4. 集成 Tailwind CSS
5. 验证：空白窗口能正常打开

### Phase 2: 美术资产集成（Day 1-2）
1. 提取现有美术资产到 `src/assets/`
2. 实现顶部人物卡横条（4 个角色 + 波形）
3. 实现左侧导航栏（图标 + 文字）
4. 实现首页主视觉背景
5. 验证：界面美观度达到设计稿

### Phase 3: 核心功能（Day 2-4）
1. 实现 Profile 读取（Rust 后端）
2. 实现 Profile 列表展示（前端）
3. 实现 Profile 激活切换
4. 实现服务启动控制
5. 实现健康检查轮询
6. 验证：能启动服务并监控状态

### Phase 4: 高级功能（Day 5-7）
1. 实现 Profile 新建/复制/删除
2. 实现 Profile 编辑器（分档位、LLM Prompt、声腔）
3. 实现日志实时展示
4. 实现环境检测页面
5. 验证：功能对等 WinForms 版本

### Phase 5: 打包测试（Day 8-10）
1. 打包为独立 exe
2. 测试兼容性（配置文件、API 调用）
3. 性能优化（启动速度、内存占用）
4. 用户测试（找 2-3 个真实用户试用）
5. 验证：可以完全替换旧版启动器

---

## 成功标准

### 功能完备性
- [ ] 所有 WinForms 版本的核心功能都已实现
- [ ] 配置文件读写完全兼容
- [ ] 服务启动/停止稳定可靠
- [ ] 日志展示实时准确

### 视觉质量
- [ ] UI 美观度达到 90%+（用户主观评价）
- [ ] 动画流畅（60fps）
- [ ] 美术资产完全集成
- [ ] 响应式布局适配不同分辨率

### 性能指标
- [ ] 包体 < 10 MB
- [ ] 冷启动 < 2 秒
- [ ] 内存占用 < 150 MB
- [ ] CPU 空闲时 < 1%

### 用户体验
- [ ] 用户可以无感知替换旧版
- [ ] 所有操作有清晰反馈
- [ ] 错误提示友好易懂
- [ ] 无需额外配置即可使用

---

## 风险与应对

### 风险 1：Rust 学习曲线
**应对**：
- 优先实现核心功能，复杂特性后置
- 参考现有 C# 代码逻辑，一对一翻译
- 遇到困难时用 ChatGPT/Claude 辅助

### 风险 2：美术资产集成复杂
**应对**：
- 先用占位符验证功能
- 逐步替换为真实美术资产
- 必要时简化动画效果

### 风险 3：打包问题
**应对**：
- 早期就开始尝试打包
- 遵循 Tauri 官方最佳实践
- 使用 CI/CD 自动化打包流程

### 风险 4：兼容性问题
**应对**：
- 严格遵循现有配置文件格式
- 端到端测试覆盖所有关键路径
- 保留 WinForms 版本作为备用

---

## 协作分工

### 主 Agent（我）
- 负责整体架构设计
- 实现 Rust 后端核心逻辑
- 配置 Tauri 打包
- 协调其他 Agent

### Sub-Agent 1（前端 UI）
- 实现 HTML/CSS 界面
- 集成美术资产
- 实现交互动画
- 响应式布局

### Sub-Agent 2（功能实现）
- Profile 管理逻辑
- 日志读取与展示
- 环境检测实现
- 测试用例编写

### 用户（你）
- 提供美术资产
- 验收功能完成度
- 提出优化建议
- 最终决策方向

---

## 时间表

| 阶段 | 时间 | 交付物 |
|------|------|--------|
| Phase 1 | Day 1 | 空白 Tauri 窗口 |
| Phase 2 | Day 1-2 | 美术资产集成完成 |
| Phase 3 | Day 2-4 | 核心功能可用 |
| Phase 4 | Day 5-7 | 功能对等 WinForms |
| Phase 5 | Day 8-10 | 可发布的 exe |

**预计总时长**：10 个工作日
**里程碑状态（2026-06-10）**：P0 可构建版本已产出；P1 基础可用项已接入 Profile 新建/复制/删除/预检、Profile 编辑器基础版、日志页 tail 自动刷新、warmup 入口和环境检测；P2 补了基础快捷键和错误日志筛选/高亮。仍需真实 GUI 验证、完整拖拽排序、日志文件 watcher、通知系统和完整 WinForms 功能对等。

---

## 下一步行动

下一步：
1. 打开 Tauri GUI 做手动 smoke，确认不自动启动 API。
2. 在 GUI 中验证 Profile 新建、编辑保存、保存并启用、复制、删除、预检。
3. 服务运行时验证 warmup 按钮和日志页 5 秒 tail 刷新。
4. 先完成最新日志筛选/高亮后的 release build、复制根 exe、无窗口 smoke，再根据 GUI 结果推进拖拽排序、通知系统和日志 watcher。
