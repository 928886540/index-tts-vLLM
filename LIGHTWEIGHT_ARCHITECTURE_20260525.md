# Leon 自制音频服务接入系统 - 轻量实际版架构

日期: 2026-05-25  
分支: `VLLM-tavo-api`  
范围: 当前 TAVO 接入 + IndexTTS 本地音频服务的实际实现与轻量更新计划

---

## 1. 当前定位

这套系统不是一个重后台平台，而是一个面向本地 TAVO 使用场景的轻量音频接入层:

- 用户在 TAVO 里只接入一条 JS: `<script src="http://<lan-ip>:9880/static/tavo.js"></script>`
- 浏览器端负责配置、正则识别、可选 LLM 解析和音频卡插入。
- 本机 FastAPI 负责把文本请求转成本地 IndexTTS 音频流。
- 音色、缓存、静态 JS 都先放本地文件系统。
- 当前主链路不需要 DB；已预留可选 SQLite profile 模块，确实到 profile、历史、任务索引变复杂时再接入，不上 MySQL。

---

## 2. 总体分层图

```mermaid
flowchart TD
    subgraph Browser["入口层: TAVO 浏览器"]
        TAVO["TAVO 聊天页面"]
        JS["一条 JS: /static/tavo.js"]
        LS["localStorage\nAPI Base / 音色映射 / 正则 / LLM 配置 / TTS 参数"]
        Regex["本地正则\n[TTS]...[/TTS] / <tts>...</tts> / 整条消息"]
        LLM["可选第三方 LLM\nOpenAI-compatible endpoint\n浏览器直调"]
        Audio["消息内音频卡\n<audio preload=\"none\">"]
    end

    subgraph API["API 层: 本机 FastAPI, 默认 9880"]
        Static["/static/tavo.js"]
        Voices["/voices\n本地音色库管理"]
        TTS1["/tts_stream\n单段流式"]
        TTS2["/tts_cache_stream\n单段流式 + 快照缓存"]
        DLG1["/tts_dialogue_stream\n多角色 + 情绪流式"]
        DLG2["/tts_dialogue_cache_stream\n多角色 + 情绪 + 快照缓存"]
        CacheAPI["/cache\n缓存列表 / 删除 / prune"]
        Lock["asyncio.Lock\n同步/单进程队列锁"]
    end

    subgraph TTS["TTS 层: 本地 IndexTTS"]
        Model["IndexTTS2\nindextts.infer_vllm_v2"]
        VoiceResolve["音色解析\nlibrary name 或直接文件路径"]
        Stream["chunked WAV / audio/wav"]
    end

    subgraph Storage["存储层: 文件系统优先"]
        VoiceLib["prompts/library\n音色库 .wav/.mp3/.flac/.ogg/.m4a"]
        Snap["outputs/cache\n<sha1>.wav + <sha1>.json"]
        StaticFile["static/tavo.js"]
        Logs["logs\n未来可选"]
    end

    subgraph Data["数据层: 主链路当前无 DB"]
        NoDB["当前主链路: 无 Redis / 无 RabbitMQ / 无 MySQL"]
        SQLite["可选预留: SQLite profile_store.py\ntask queue / profile / 历史索引"]
    end

    TAVO --> JS
    JS <--> LS
    JS --> Regex
    Regex --> LLM
    Regex --> TTS1
    LLM --> DLG1
    JS --> TTS2
    JS --> DLG2
    JS --> Audio

    Static --> JS
    Voices --> VoiceLib
    CacheAPI --> Snap
    TTS1 --> Lock
    TTS2 --> Lock
    DLG1 --> Lock
    DLG2 --> Lock
    Lock --> Model
    Model --> VoiceResolve
    VoiceResolve --> VoiceLib
    Model --> Stream
    TTS2 <--> Snap
    DLG2 <--> Snap
    Stream --> Audio

    NoDB -.复杂度达到阈值后再升级.-> SQLite
```

---

## 3. 当前数据流

### 3.1 单段轻量播放

```text
TAVO 新消息
  -> static/tavo.js MutationObserver 发现消息
  -> 读取 localStorage 配置
  -> 本地正则提取待朗读文本
  -> 选择 default 音色或用户配置音色
  -> 生成 <audio preload="none">
  -> 用户点击播放
  -> GET /tts_cache_stream 或 /tts_stream
  -> FastAPI 进入 asyncio.Lock 串行推理
  -> IndexTTS 生成 chunked WAV
  -> 浏览器 audio 播放
```

默认优先走 `/tts_cache_stream`。如果同样的文本、音色、情绪和参数已经生成过，服务端直接返回 `outputs/cache/<sha1>.wav`；未命中时现场生成并写入 `<sha1>.wav` 和 `<sha1>.json`。

### 3.2 多角色/情绪播放

```text
TAVO 新消息
  -> static/tavo.js 提取正文
  -> 可选浏览器直调第三方 LLM
  -> LLM 返回 segments: [{role, text, emo_vec 或 emo_text}]
  -> localStorage voiceMap 把 role 映射到 prompts/library 音色名或直接路径
  -> POST /tts_dialogue_cache_stream 或 /tts_dialogue_stream
  -> FastAPI 串行处理每段
  -> IndexTTS 按角色切音色, 按段落情绪参数生成
  -> 段间插入 interval_ms 静音
  -> 返回整段 chunked WAV
```

当前设计里，LLM 是可选增强，不是核心依赖。不开 LLM 时仍可使用单段默认音色。

---

## 4. 各层职责

### 4.1 入口层: TAVO 一条 JS

实际入口是 `static/tavo.js`:

- 自动从 script src 推导 `apiBase`。
- 配置写入浏览器 `localStorage`，key 为 `indextts_tavo_config`。
- 支持聊天容器、消息节点、正文节点选择器配置。
- 支持本地正则规则，当前默认包含 `[TTS]...[/TTS]` 和 `<tts>...</tts>`。
- 支持角色到音色的 `voiceMap`。
- 支持可选 OpenAI-compatible 第三方 LLM，由浏览器直接请求。
- 支持懒加载音频，避免消息多时一次性请求所有音频。

这一层不引入前端框架、不需要构建步骤，也不要求用户编辑服务端配置文件。

### 4.2 API 层: FastAPI 单进程轻量服务

当前 API 层在 `indextts2_api.py`:

- `FastAPI()` + `CORSMiddleware`。
- `StaticFiles` 挂载 `/static`。
- `/health` 做轻量存活检查。
- `/voices` 管理本地音色库。
- `/cache` 管理本地快照缓存。
- 四个 TAVO 核心 TTS 端点:
  - `GET/POST /tts_stream`
  - `GET/POST /tts_cache_stream`
  - `POST /tts_dialogue_stream`
  - `POST /tts_dialogue_cache_stream`

当前并发策略是 `asyncio.Lock` 串行化 TTS 推理。原因是底层 `IndexTTS2` 实例存在共享状态，直接并发推理会互相覆盖。这里的锁就是当前的轻量队列，不引入 Redis/RabbitMQ。

后续如果任务状态、取消、重试和历史索引变复杂，可以增加 SQLite task queue；在那之前，保持单进程队列锁更符合本地工具定位。

### 4.3 TTS 层: 本地 IndexTTS

TTS 层使用本地 `IndexTTS2`:

- 模型加载来自 `checkpoints/config.yaml` 和本地 checkpoints。
- 单段请求使用 `text + ref_audio_path + emo_* + 采样参数`。
- 多角色请求使用 `segments + voices + interval_ms + 采样参数`。
- 音色既可以是 `prompts/library` 里的名称，也可以是直接音频路径。
- 返回以 `audio/wav` 为主，流式端点使用 chunked WAV。

这层不依赖外部云 TTS，不上传音频，不要求联网。

### 4.4 存储层: 文件系统优先

当前核心目录:

```text
prompts/library/
  narrator.wav
  alice.wav
  bob.wav

outputs/cache/
  <sha1>.wav
  <sha1>.json

static/
  tavo.js

logs/
  未来可选
```

`prompts/library` 是音色库。`indextts/voice_library.py` 负责列出、保存、删除音色文件，并做文件名安全处理。

`outputs/cache` 是快照缓存。`indextts/snapshot_cache.py` 使用稳定 JSON payload 生成 sha1 key，保存音频和元数据，并支持命中计数、列表、删除和 prune。

### 4.5 数据层: 主链路当前无 DB

当前 TAVO 朗读主链路没有数据库:

- 没有 MySQL。
- 没有 Redis。
- 没有 RabbitMQ。

已预留一个不接 API 的可选 SQLite 模块: `indextts/profile_store.py`。它只用于未来 profile、角色音色映射、LLM 配置摘要和 usage logs，不参与当前默认朗读路径。

SQLite 的接入条件:

- 需要跨会话用户 profile。
- 需要大量历史记录查询。
- 需要任务索引、取消、重试、恢复。
- 缓存条目达到文件扫描不舒服的规模。
- 需要按音色、情绪、角色、时间范围筛选。

即使升级，也只上 SQLite。这个项目不需要 MySQL 这类重型服务。

---

## 5. 和图片不同的轻量化取舍

用户图里的“音频服务接入系统”可以很容易扩展成完整后台系统: 网关、任务队列、Redis、RabbitMQ、数据库、后台管理、审计、权限、多 worker、监控告警等。但当前项目的真实目标不是 SaaS 平台，而是本机 TAVO 音频增强工具。因此这里主动做轻量化取舍。

### 5.1 不做 Redis/RabbitMQ

当前瓶颈是本地 GPU/IndexTTS 推理，不是 HTTP 请求吞吐。即使加消息队列，底层单个模型实例仍然需要串行或受控并发。对本地用户而言，Redis/RabbitMQ 会带来:

- 新安装步骤。
- 新端口和进程。
- Windows 环境维护成本。
- 错误排查成本。
- 与实际收益不匹配的复杂度。

所以当前用 `asyncio.Lock` 做单进程队列锁。后续真需要可观察任务队列时，优先 SQLite。

### 5.2 不做复杂后台管理系统

音色库当前就是 `prompts/library` 文件夹，缓存当前就是 `outputs/cache` 文件夹。用户可以:

- 直接放音色文件。
- 通过 `/voices` 保存音色。
- 通过 `/cache` 查看和清理缓存。

这比做登录、菜单、后台表格、权限和审计更贴合当前阶段。等 TAVO 真实联调后，再根据用户最常用动作补一个轻 UI，而不是先做全功能后台。

### 5.3 不上 MySQL

项目是本地单机工具，数据天然是文件型:

- 音色是音频文件。
- 缓存是 WAV + JSON。
- JS 配置在浏览器 localStorage。

MySQL 会把部署门槛和故障面放大，但不会改善当前核心体验。后续如果需要结构化查询，SQLite 已足够，并且 Python 标准库直接支持。

### 5.4 LLM 放在可选路径

多角色和情绪解析可以靠第三方 LLM 提升效果，但不应该成为必需组件。当前设计让浏览器可选直调 OpenAI-compatible endpoint:

- 不配置 LLM: 单段默认音色可用。
- 配置 LLM: 多角色、情绪、旁白拆分增强。
- 服务端不默认保存 API key。

这样失败边界清楚，也避免服务端代理先把系统复杂化。

---

## 6. 轻量更新计划

### 6.1 近期目标

1. 稳定 `static/tavo.js` 的真实 TAVO DOM 适配。
2. 完成音频卡交互: 生成、播放、加载中、错误、缓存命中标记。
3. 明确默认正则策略: 只读标记块，还是允许整条消息朗读。
4. 补齐多角色 LLM prompt 和 JSON 容错。
5. 做一次 Windows + 局域网浏览器联调记录。

### 6.2 中期目标

1. 给 `/cache` 做简单清理入口，不做重后台。
2. 用可选 `/profiles` 保存多套 TAVO 配置预设，SQLite 只存 profile，不存明文 LLM key。
3. 增加本地日志目录 `logs/`，只记录必要错误和请求摘要。
4. 评估 SQLite task queue 是否真的需要。
5. 如果长文本取消需求强，再接入取消标记或任务状态。

### 6.3 SQLite 触发线

只有出现以下情况才把 `profile_store.py` 接入 API:

- profile 多套配置需要跨浏览器/跨设备同步。
- 历史播放记录需要检索、收藏、复用。
- 任务需要排队、取消、重试、恢复。
- 缓存文件规模大到 JSON 扫描影响启动或列表响应。

SQLite 只作为本地索引和任务状态，不替代音频文件本身。

---

## 7. 下一步分工清单

| 事项 | 建议负责人 | 文件/范围 | 说明 |
|---|---|---|---|
| TAVO DOM 真实选择器确认 | Claude / 用户联调 | `static/tavo.js` 配置默认值 | 确认 TAVO 当前页面的 chat/message/text selector |
| 音频卡 UI 完整化 | Codex | `static/tavo.js` | 播放按钮、加载中、失败重试、缓存命中提示 |
| 音色库选择器 | Codex | `static/tavo.js`、`/voices` | 已有手动刷新、设为默认、插入 role=voice 映射 |
| LLM 解析提示词定稿 | Claude | 文档或 JS 内默认 prompt | 输出稳定 `segments` JSON |
| 本地正则策略确认 | Claude / 用户 | `static/tavo.js` | `[TTS]`、`<tts>`、整条消息的优先级 |
| 音色库验收 | Codex / Claude | `indextts/voice_library.py`、`/voices` | 中文名、空格、扩展名、覆盖保存 |
| 快照缓存验收 | Codex / Claude | `indextts/snapshot_cache.py`、`/cache` | key 稳定性、命中计数、prune 行为 |
| 配置预设验收 | Codex | `indextts/profile_store.py`、`/profiles` | 可选 SQLite；保存/加载 voiceMap、正则、LLM endpoint/model，但不保存明文 API key |
| 长文本和多角色压力测试 | Claude / Codex | API 手工联调 | 关注显存、首段延迟、段间静音 |
| 用户快速上手文档 | Claude | `QUICKSTART_TAVO.md` 或新文档 | 等真实联调后再收敛成最终版 |
| SQLite task queue 评估 | Codex / Claude | 只做设计, 暂不实现 | 只有任务复杂度上来才开工 |

---

## 8. 当前结论

当前实际架构已经满足“Leon 自制音频服务接入系统”的轻量版本:

- 入口足够轻: TAVO 只接一条 JS。
- 配置足够轻: 浏览器 localStorage。
- API 足够轻: FastAPI + 单进程队列锁。
- TTS 足够本地: IndexTTS 直接生成 WAV 流。
- 存储足够透明: 音色和缓存都是文件。
- 数据层保持克制: 当前主链路无 DB，后续只在必要时接入 SQLite。

下一阶段重点不是补重型基础设施，而是把 TAVO 端交互、音色选择、缓存复用和多角色解析做稳。
