# IndexTTS × TAVO 总体计划与分工(Phase 2+)

最后更新:2026-05-25
作者:Claude 初版；Codex 接手维护，分支 `VLLM-tavo-api`
配套已存在文档:
- `COLLABORATION_PLAN_20260525.md` —— 双 Agent 协作守则(commit 前缀、分支隔离、避免踩坑)
- `TAVO_INTEGRATION_PHASE1.md` —— Phase 1 已完成的 `/tts_stream` 文档
- `V26_AUDIT_FOR_TAVO_20260525.md` —— V26 多角色对话审计
- `HANDOFF_WORK_SUMMARY_20260525.md` —— Codex 流式优化总结

---

## 一、最终愿景(来自用户图示 + 对话澄清)

```
TAVO 浏览器
   │
   ├─ <script src="http://lan-ip:9880/static/tavo.js"></script>   ← 唯一前端入口
   │   ├─ DOM 观察:监听新消息
   │   ├─ Settings 面板:音色映射 / LLM 配置 / 参数(localStorage)
   │   ├─ [可选] 调第三方 LLM 解析正文 → 角色 + 情感
   │   └─ 调本机 IndexTTS HTTP → 流式插入 <audio>
   │
   └─ 本机 IndexTTS 服务(0.0.0.0:9880)
        ├─ /tts_stream              ✅ P1 单段流式 (已完成)
        ├─ /tts_dialogue_stream     ✅ P2 多角色 + 情感 + 流式
        ├─ /voices                  ✅ P2 音色库 CRUD
        ├─ /tts_cache_stream        ✅ P3 单段快照 + 懒加载
        ├─ /tts_dialogue_cache_stream ✅ P3 多角色整段快照 + 懒加载
        ├─ /cache                   ✅ P3 缓存管理
        ├─ /parse_text              ⚪ P4 (可选)服务端代调 LLM；当前先走客户端第三方 LLM
        ├─ /static/tavo.js          ✅ P5 自包含 JS
        └─ /health                  ✅ 已完成
```

**核心原则:**
- **轻量化**(目标用户:小白)。能不上数据库就不上,先文件系统;真要 DB 时**只用 SQLite**(Python 自带,零安装)。**永远不上 MySQL/MariaDB**。
- **零配置启动**。解压 → 双击 bat → 复制一行 `<script>` 到 TAVO → 完成。
- **本地资源,0 上传,完全 NSFW,0 费用**(用户原话)。

### 参考图的轻量化落地

用户提供的“Leon 自制音频服务接入系统”图可以作为最终形态参考，但本项目第一版不照搬重后台:

| 图中层级 | 当前轻量版对应 | 取舍 |
|---|---|---|
| 客户端/使用层 | TAVO 浏览器 + 一条 `static/tavo.js` | 不做独立 Web 后台，先用浮动设置面板 |
| API 服务层 | `indextts2_api.py` FastAPI | 单进程本地服务，先不拆微服务 |
| 任务队列/异步调度 | `asyncio.Lock` 串行保护模型状态 | 暂不上 Redis/RabbitMQ；后续需要任务恢复再上 SQLite task 表 |
| IndexTTS 服务层 | 本机 IndexTTS2 pipeline | 保持本地模型，不上传数据 |
| 存储层 | `prompts/library`、`outputs/cache`、`static/` | 纯文件优先，小白可直接看懂和备份 |
| 数据库层 | 当前无 DB；预留 `profile_store.py` SQLite | 只有 profile/历史/索引复杂后才启用 SQLite，永不上 MySQL |

---

## 二、阶段拆分(细到可执行)

### ✅ Phase 1:单段流式(已完成)
- `GET/POST /tts_stream` + `/health` + 启动横幅
- 文档:`TAVO_INTEGRATION_PHASE1.md`

### ★ Phase 2:多角色对话 + 情感
**目标:** TAVO 把"已解析好的段落"丢过来,服务端按角色切音色 + 按情感调,流式吐出。

| 子任务 | 谁 | 文件 | 状态 |
|---|---|---|---|
| 2A `indextts/voice_library.py` 纯函数模块 | Codex | `indextts/voice_library.py` | ✅ 已完成 |
| 2B `POST /tts_dialogue_stream` 端点 | Claude/Codex | `indextts2_api.py` | ✅ 已完成 |
| 2C `/voices` HTTP 包装(GET/POST/DELETE) | Codex | `indextts2_api.py` | ✅ 已完成 |
| 2D 文档 | Codex | `TAVO_API_REFERENCE_20260525.md` | ✅ 已完成 |

**请求 schema(POST /tts_dialogue_stream):**

```json
{
  "segments": [
    {
      "role": "narrator",
      "text": "深夜的雨打在玻璃上。",
      "emo_vec": [0,0,0,0,0,0,0,0.8],
      "emo_text": null,
      "emo_alpha": 0.7
    },
    {
      "role": "小明",
      "text": "你怎么还不睡?",
      "emo_text": "压低声音,带着喘息"
    }
  ],
  "voices": {
    "narrator": "voice_a",
    "小明": "voice_b",
    "default": "voice_a"
  },
  "interval_ms": 350,
  "top_p": 0.8, "top_k": 30, "temperature": 0.8,
  "repetition_penalty": 10
}
```

- `voices` 值可以是**音色库名**(走 voice_library 解析)或**直接文件路径**
- 每段可独立指定 `emo_vec`(8 维) 或 `emo_text`(自然语言,含"喘息""颤抖"等),二选一
- 段间插入 `interval_ms` 静音
- 返回 chunked WAV(同 Phase 1)

### ★ Phase 3:快照缓存 + 懒加载
**目标:** 相同的(文本 + 音色 + 情感 + 参数)只生成一次,后续命中缓存秒回。客户端按需拉取,不预下载。

| 子任务 | 谁 | 文件 |
|---|---|---|
| 3A `indextts/snapshot_cache.py` 模块 | Codex | 新建 |
| 3B 端点 `/tts_cache_stream`(带缓存的流式) | Codex | `indextts2_api.py` | ✅ |
| 3C 端点 `/cache` GET 列表 / DELETE 清理 | Codex | `indextts2_api.py` | ✅ |
| 3D 客户端懒加载约定:`<audio preload="none">` + 点击触发 | Codex | `static/tavo.js`(P5) | ✅ |
| 3E 多角色整段缓存 `/tts_dialogue_cache_stream` | Codex | `indextts2_api.py` | ✅ |

**缓存键设计:**
```python
import hashlib, json
def cache_key(text: str, voice_path: str, emo_vec: list, emo_text: str,
              top_p, top_k, temperature, repetition_penalty, model_rev: str) -> str:
    payload = {"t": text, "v": voice_path, "ev": emo_vec, "et": emo_text,
               "tp": top_p, "tk": top_k, "tm": temperature, "rp": repetition_penalty,
               "rev": model_rev}
    return hashlib.sha1(json.dumps(payload, sort_keys=True, ensure_ascii=False).encode("utf-8")).hexdigest()
```

**存储:**
- `outputs/cache/<sha1>.wav`(纯音频)
- `outputs/cache/<sha1>.json`(元数据:text 前 80 字、voice、时间戳、命中次数)
- 索引:**首阶段不用 DB**,启动时一次性扫描 `outputs/cache/*.json` 进内存 dict,够用
- 满 N 条(默认 5000)→ 按"最久未命中"清理

**触发上 SQLite 的边界:** 缓存 > 5 万条或需要按音色/情感筛选。届时新建 `indextts/cache_index.py` 用 sqlite3。

### ⚪ Phase 4:LLM 解析(用户可选)
**目标:** 把 TAVO 原始正文 → 段落数组(供 Phase 2 使用)。

| 子任务 | 谁 | 文件 |
|---|---|---|
| 4A 系统提示词模板 | Codex | `TAVO_LLM_PROMPT_20260525.md` |
| 4B [可选] 服务端代理 `/parse_text` | Codex | `indextts2_api.py` + `indextts/llm_proxy.py` | ✅ OpenAI-compatible |
| 4C 客户端直调示例(放 tavo.js 里) | Codex | `static/tavo.js` | ✅ OpenAI-compatible |

**默认策略:** 客户端直调(用户在浏览器里填 OpenAI/Claude API key 存 localStorage)。
**可选策略:** 服务端代理(给浏览器/TAVO WebView 被第三方 CORS 拦截的用户；key 仍由浏览器提交，本地服务不保存)。

**LLM 输出 schema:**
```json
{
  "segments": [
    {"role": "narrator", "text": "...", "emo_vec": [0,0,0,0,0,0,0,0.8]},
    {"role": "小明",     "text": "...", "emo_text": "喘息着,声音颤抖"}
  ]
}
```

### ★ Phase 5:单 JS 注入(TAVO 端)
**目标:** 用户加**一行** `<script src="http://lan-ip:9880/static/tavo.js"></script>` 到 TAVO,其余都在 JS 里完成。

| 子任务 | 谁 | 文件 |
|---|---|---|
| 5A 静态文件路由 | Claude | `indextts2_api.py`(`app.mount("/static", ...)`) |
| 5B `tavo.js` 核心 | Codex | `static/tavo.js` 新建 | ✅ |
| 5C Settings 面板 UI | Codex | `static/tavo.js`(浮动面板) | ✅ 基础版 |
| 5D 集成测试 HTML | Codex | `static/test.html` | ✅ |
| 5E xiaomi 风格轻量音频卡 | Codex | `static/tavo.js` | ✅ 基础版 |
| 5F 音色库选择器 | Codex | `static/tavo.js` | ✅ 手动刷新/设默认/插入映射 |
| 5G 缓存管理 UI | Codex | `static/tavo.js` | ✅ 手动刷新/删除/prune |

**tavo.js 责任:**
- MutationObserver 监听 TAVO 聊天 DOM
- 识别"待 TTS"内容(配置触发标记,如 `[TTS]...[/TTS]` 或扫描整段)
- 调用流程:`fetch /parse_text` (可选) → `fetch /tts_dialogue_stream` → 创建 `<audio preload="none">` 插入消息下方
- Settings 面板(齿轮按钮):
  - 音色映射(`role → voice_name`)
  - LLM 配置(provider / endpoint / api_key / model)
  - 参数预设(速度 / 情感强度 / 温度)
  - 全部存 localStorage
- 状态指示:加载中 / 缓存命中(标记一个小图标)

**依赖:** 纯 vanilla JS,无第三方库,无 build 步骤。文件直接是源码,小白可读可改。

### ⚪ Phase 6:UI 优化 + 音色卡设计
- 已探索 `D:\apiWorkSpace\ComfyUI-aki\ComfyUI-aki-v3\ComfyUI\app\ios`(xiaomi tts 项目)
- 借鉴点: 轻量卡、完整播放器懒加载、cache-first、单全局 audio、history handoff
- 当前先做轻量卡，不做完整大后台

---

## 三、分工边界(文件级,不要踩)

### Codex 的领地(`VLLM` 分支)
| 文件 | 状态 |
|---|---|
| `indextts/utils/front.py` | 已改(流式分句) |
| `indextts/s2mel/modules/flow_matching.py` | 已改(显存优化) |
| `indextts/infer_vllm_v2.py` | 已改(stream callback / trim) |
| `webui.py` | 已改(WebUI 流式) |
| `patch_vllm.py` | 已改(GBK 修复) |
| **`indextts/voice_library.py`** | 已完成 |
| **`indextts/snapshot_cache.py`** | 已完成 |
| `prompts/audio_history.json` | Codex 维护 |
| 启动 bat 文件 | Codex 维护(已被 gitignore) |

### Claude 的领地(`VLLM-tavo-api` 分支)
| 文件 | 状态 |
|---|---|
| `indextts2_api.py` | 已加 P1-P5 端点、CORS、static mount |
| `static/tavo.js` | 已完成基础版: 单 JS、设置面板、LLM、音色、缓存、轻量卡 |
| `static/test.html` | 已完成基础测试页 |
| `indextts/llm_proxy.py` | 已完成(P4B,可选) |
| 所有 `TAVO_*.md` / `MASTER_*.md` 文档 | Claude 维护 |
| `TAVO_LLM_PROMPT_20260525.md` | 已完成(P4A) |

### 共享只读(不要修改对方维护的)
- `HANDOFF_WORK_SUMMARY_*.md` —— Codex 写,Claude 只读
- `V26_AUDIT_FOR_TAVO_*.md` / `COLLABORATION_PLAN_*.md` / 本文件 —— Claude 写,Codex 只读
- `MASTER_PLAN_PHASE2_PLUS.md` —— 本文件,**改动走"修订记录"节**

### Rebase 节奏
- Claude 每次开工前 `git fetch && git rebase userrepo/VLLM VLLM-tavo-api`
- 冲突一律保留 Codex 版本(主分支),Claude 这边重新适配
- 切回 worktree 工作

---

## 四、执行顺序(从现在开始)

```
[已完成] P2A/P2B/P2C: voice_library + dialogue endpoint + voices API
[已完成] P3A/P3B/P3C/P3E: snapshot_cache + cache endpoints + dialogue cache
[已完成] P4B/P4C: 服务端 `/parse_text` 代理 + 客户端 OpenAI-compatible LLM 解析配置
[已完成] P5A/P5B/P5C/P5D: static route + tavo.js + settings + test.html
[已完成] P5E/P6A 基础版: xiaomi 风格轻量音频卡、单全局 audio、懒加载卡片
[已完成] 架构文档: 参考用户图，落成轻量实际版
[预研] 可选 SQLite profile_store: 只在 profile/历史/任务索引需要时接入
[已完成] P5F: 设置面板音色库选择器，手动刷新 `/voices`
[已完成] P5G: 设置面板快照缓存管理，手动刷新 `/cache`
            ↓
静态验证 → 提交推送 → 等用户允许后再启动服务联调
```

每个阶段完成都 `git push userrepo` 让用户随时能 pull 测试。

---

## 五、轻量化清单(贯穿所有 Phase)

| 维度 | 决策 |
|---|---|
| 数据库 | 默认无;触发条件明确后才上 SQLite |
| Python 依赖 | 不新增第三方包(除非必要,且首选 stdlib) |
| JS 依赖 | 0 框架,纯 vanilla |
| Build 步骤 | 0,JS 文件即源码 |
| 用户配置 | 全走 HTTP/localStorage,不让用户编辑文件 |
| 安装步骤 | 现有 `.bat` 启动 + `<script>` 一行,不增加 |
| 文档 | 用户面向的写一份 `QUICKSTART.md`(P5 后),技术文档分阶段 |

---

## 六、风险与未决问题

1. **GPU 显存压力**:Phase 2 多角色频繁切音色 → cache 失效频繁。若 RTF 上升明显,需要做"批量预热常用 N 个音色"。
2. **WAV 流式兼容性**:目前用 `size=0xFFFFFFFF` 的 unknown-length 技巧,部分老旧/移动端播放器可能拒绝。若遇到,Phase 5.5 加 MP3/Opus 编码端点。
3. **LLM 解析延迟**:第三方 API 一来回 1-3 秒,会拖慢首段。可优化:LLM 流式输出 + 解析到一段就触发 TTS。**留给 Phase 4 后期优化**。
4. **客户端断开后 inference 不停**:目前没接 `stop_generation_callback`。**P3 缓存上线后影响会减弱**(已生成的不浪费),先不急。
5. **跨域 CORS**:TAVO 域名访问 `lan-ip:9880`,浏览器可能拦截。**P5 上线前必加** `CORSMiddleware`。
6. **音色文件路径权限**:Windows 路径里的反斜杠 / 中文 / 空格需要测试 URL 编码鲁棒性。

---

## 七、修订记录

| 日期时间 | 修订者 | 变更 |
|---|---|---|
| 2026-05-25 02:00 | Claude (Opus 4.7) | 初版。整合用户陆续提出的:多角色情感(P2)、轻量化 + SQLite 准入条件、单 JS 注入(P5)、快照缓存 + 懒加载(P3) |
| 2026-05-25 03:xx | Codex | 接手后更新真实状态；加入用户架构图的轻量化映射；标记缓存、多角色、单 JS、客户端 LLM 的完成状态 |
| 2026-05-25 03:xx | Codex | 增加设置面板音色库选择器和 `TAVO_API_REFERENCE_20260525.md` |
| 2026-05-25 03:xx | Codex | 增加设置面板快照缓存管理 UI |
| 2026-05-25 04:xx | Codex | 增加 LLM 提示词文档、选择器指南、轻量测试页，并修正 P2-P6 实际状态 |

---

## 八、给 Codex 的简报(下次它接到 codex exec 时读这部分就够)

1. 我们在搞 IndexTTS × TAVO 接入,目标用户是小白。
2. Claude 已完成 P1(`/tts_stream` 在 `VLLM-tavo-api` 分支)。
3. 你的当前任务在 P2A:写 `indextts/voice_library.py` 纯函数模块(已 dispatch)。
4. 后续可能给你的任务在 **P3A**:`indextts/snapshot_cache.py` —— 看本文件 Phase 3 节的设计。
5. 不要碰 `indextts2_api.py` / `static/*` / `TAVO_*.md` / `MASTER_*.md` —— 那是 Claude 的。
6. 你的领地:`indextts/utils/front.py` / `flow_matching.py` / `infer_vllm_v2.py` / `webui.py` / `voice_library.py` / `snapshot_cache.py` / `patch_vllm.py`。
7. 提交用 `[codex]` 前缀,push 到 `userrepo VLLM`(不是 origin)。

## 九、给下次 Claude(Opus 4.7,我自己)的简报

1. 第一件事:`git fetch && git log userrepo/VLLM..HEAD --oneline` 看自己分支距离主分支多远。
2. 第二件事:读 `HANDOFF_WORK_SUMMARY_*` 最新一份,看 Codex 干了啥。
3. 第三件事:读本文件第二节看进度表,从最早未完成的 `★` 项开始干。
4. 第四件事:必要时 `codex exec --model pm/gpt-5.5 --sandbox workspace-write "..."` 派活,只读用 `--sandbox read-only`。
5. 永远 `git push userrepo`,不要 `origin`(有 GitHub 重定向 403 问题)。
