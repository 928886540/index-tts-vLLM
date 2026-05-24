# Codex 接手计划 2026-05-25

## 当前结论

Claude 侧因为第三方 API 429 中断。后续由 Codex 接管主线开发，并可按文件边界分发给其他 Codex 子任务。

用户明确约束:
- 不跑语音生成，不占用 GPU。
- 目标是小白可用，优先轻量化。
- 数据库选择 SQLite；当前阶段能不用 DB 就不用 DB，绝不上 MySQL。
- TAVO 侧目标是只引入一条 JS，正则和配置放本地。
- 多音色是正文旁白和人物各自不同音色；不配置多音色时退回角色单音色/默认音色。
- 情感需要支持 8 维情绪值，也支持自然语言情感描述，比如喘息、颤抖等。

## 分支状态

主线仓库:
- `D:\apiWorkSpace\index-tts2-vLLM`
- 分支 `VLLM`
- 已推送 `353febc [codex] Add voice_library module for Phase 2/3 voice CRUD`
- `origin` 已改为 `https://github.com/928886540/index-tts-vLLM`

TAVO API worktree:
- `D:\apiWorkSpace\index-tts2-vLLM\.claude\worktrees\tavo-api`
- 分支 `VLLM-tavo-api`
- 已合入 `VLLM` 的 `voice_library.py`
- 已合入 `VLLM` 的 `snapshot_cache.py`
- 已有提交:
  - `d8df358 [claude] Add MASTER_PLAN_PHASE2_PLUS for the full TAVO integration scope`
  - `14c7b6b [claude] Add /tts_dialogue_stream endpoint (Phase 2B) for multi-voice + emotion`
- 当前未提交主线:
- `indextts2_api.py`: `/tts_cache_stream`、`/tts_dialogue_cache_stream`、`/cache` 接口层
- `static/tavo.js`: 默认走 `/tts_cache_stream`，保留懒加载 `<audio preload="none">`
- `indextts/profile_store.py`: 可选 SQLite profile/usage 模块，已合入但未接 API

## 正在分发的子任务

1. xiaomi TTS UI 参考探索
   - 类型: 只读 explorer
   - 路径: `D:\apiWorkSpace\ComfyUI-aki\ComfyUI-aki-v3\ComfyUI\app\ios`
   - 状态: 已完成
   - 关键结论: 借鉴“轻量卡 + 完整播放器懒加载”、cache-first 播放、单全局活动 audio、historyItems/audioCacheKey/currentTime handoff

2. 快照缓存模块
   - 类型: worker
   - 分支/仓库: `VLLM`
   - 只写: `indextts/snapshot_cache.py`
   - 禁止: 不碰 `indextts2_api.py`、`static/*`、文档、音色参考目录
   - 状态: 已完成并推送到 `VLLM`
   - 提交: `a45c59e [codex] Add snapshot_cache module for lazy TTS reuse`
   - 目标: 纯文件缓存 `outputs/cache/<sha1>.wav|.json`，用于后续懒加载复用

3. SQLite profile 模块
   - 类型: worker
   - 分支/仓库: `VLLM`
   - 状态: 已完成并推送到 `VLLM`
   - 提交: `e9dff09 [codex] Add lightweight SQLite profile store`
   - 目标: 可选保存 TAVO profile、角色音色映射、LLM 配置摘要和 usage logs
   - 当前: 只合入模块，不接 API，避免提前扩大复杂度

4. 轻量音频卡
   - 类型: worker
   - 状态: 已完成待提交
   - 目标: 消息内紧凑音频卡、懒加载、单全局 audio、状态/mini progress

5. 轻量架构文档
   - 类型: worker
   - 状态: 已完成待提交
   - 文件: `LIGHTWEIGHT_ARCHITECTURE_20260525.md`

## 接下来主线顺序

1. 收敛 `VLLM-tavo-api`
   - `/voices` GET/POST/DELETE
   - `/static/tavo.js`
   - CORS
   - `py_compile indextts2_api.py`
   - 不启动 server，不请求 TTS

2. 提交并推送 `VLLM-tavo-api`
   - commit 前缀用 `[codex]`
   - push 到 `origin VLLM-tavo-api`

3. 集成缓存模块
   - `snapshot_cache.py` 已合入 `VLLM-tavo-api`
   - `indextts2_api.py` 已加 `/tts_cache_stream`、`/tts_dialogue_cache_stream`、`/cache`
   - 仍然只做语法/静态检查，不跑推理

4. 完善 `static/tavo.js`
   - 已默认优先调用 `/tts_cache_stream` 和 `/tts_dialogue_cache_stream`
   - 已加: LLM 解析配置面板(OpenAI-compatible endpoint/key/model/prompt)
   - 已加: role -> voice 行文本映射 UI
   - 已加: 借鉴 xiaomi 的轻量音频卡、单全局活动 audio、点击后才触发生成
   - 待做: 完整播放器懒加载和历史 handoff

5. 写用户向 Quickstart
   - 启动本地服务
   - TAVO 只加一行 `<script src="http://<lan-ip>:9880/static/tavo.js"></script>`
   - 在浮动设置里填 API 地址、音色、可选 LLM key

## 文件边界

Codex 主线当前可改:
- `indextts2_api.py`
- `static/tavo.js`
- `static/test.html`
- `CODEX_TAKEOVER_PLAN_20260525.md`
- 后续缓存集成需要的 `indextts/snapshot_cache.py`
- 可选 SQLite profile 模块 `indextts/profile_store.py`

不要改:
- `音色参考音频/`
- `.claude/` 下无关日志
- Claude 已提交的历史提交不要 reset
- 其他 agent 正在负责的新文件，除非它已经完成并明确交付

## 验证边界

允许:
- `git status`
- `git diff`
- `py_compile`
- 静态文件读取
- 不触发 GPU 的单元级检查

禁止:
- 启动 IndexTTS API server
- 调 `/tts`、`/tts_stream`、`/tts_dialogue_stream`
- 任何会加载模型或生成音频的命令
