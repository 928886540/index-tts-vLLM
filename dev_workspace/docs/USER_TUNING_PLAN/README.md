# User Tuning Plan

Updated: 2026-06-09

Status: profile schema v3 is in progress. Quality presets and the first voice-cavity/style-control slice are now profile-owned; the broader tuning UI roadmap remains open.

Priority: P1 = stable distribution with the author's defaults. P2 = optional user tuning, profile editing, and preset sharing.

## Current State 2026-06-09

Implemented so far:

- Source profiles live under `config/profiles/*.json`.
- `config/profiles/active.json` is the applied runtime snapshot.
- Launcher can create/copy/save/apply profiles and edit LIVE/DISK quality preset parameters.
- Tavo fetches `/profiles/active` and keeps only the selected档位 name; request parameters come from active profile `quality.presets.live/generate[mode]`.
- Active profile `llmPrompt` is submitted as `parse_system_prompt`; the API backend renders runtime placeholders before calling the LLM.
- Profile schema v3 adds explicit `styles` entries to source profiles and the active snapshot.
- vLLM and fast6g render `{{style_rules}}` from active profile `styles`, not from an implicit runtime style table.
- LLM output with an unknown `style`, invalid alpha/emo_vec, non-neutral narration style, or unavailable style ref now raises a clear configuration/LLM-output error.

Important limitation:

- Current "声控" is still backend-owned LLM parse outputting per-segment `style`, `style_alpha`, `emo_vec`, and `emo_alpha`.
- The API backend injects `{{style_rules}}`, `{{emotion_rules}}`, and `{{output_contract}}` into the active prompt at runtime.
- Style catalog data is now stored in profile JSON, but launcher UI does not yet expose full style CRUD.
- Launcher UI does not yet expose style catalog editing, role default style, allowed/disabled style, or stage curves.

Real lifecycle validation:

- `fast6g` + active profile + real liangjie `grok-4.1` completed one backend-owned AI dialogue job on 2026-06-09.
- The job produced 4 LLM segments, wrote MP3 cache, and `/cache_audio/<key>` returned `200 audio/mpeg`.
- A discovered Cloudflare 1010 failure was fixed by adding a stable LEON user-agent to both vLLM and fast6g LLM proxy requests.

## Goal

把 LEON 从“作者写死的一套声腔/档位口味”，逐步变成用户可以调教、保存、分享的本地语音工作台。

用户应该能改 LLM 提示词、声腔映射、角色策略、质量档位和 LIVE 稳定性参数，但后端必须继续保留校验、上限和失败提示，避免一个错误配置直接把显存或播放链路打爆。

## Product Principles

- 默认好用：普通用户不需要理解 `diffusion_steps`、`segment_tokens`、WebAudio buffer，也能直接生成。
- 可玩可调：进阶用户可以调提示词、声腔映射、情绪强度、角色策略，形成自己的声音风格。
- 专家可控：专家模式暴露推理参数和 LIVE 缓冲参数，但必须有硬上限、预设恢复和明显风险提示。
- 配置可导入导出：用户调好的方案应该能保存为一个 profile，而不是散落在代码和 Tavo localStorage 里。
- 启动器做调音台：复杂编辑、profile 管理、预检和导入导出优先放在 Windows 启动器里；Tavo 端保持轻量播放和少量快速设置。
- 后端负责安全边界：前端负责好玩，后端负责范围校验、明确报错和显式迁移；运行期不能静默套用隐藏默认值。
- 启动器视觉改造必须保持低环境门槛：优先继续产出可直接打开的本地 exe；若未来换 UI 技术栈，必须明确打包成本和安装成本，不能要求用户手动装复杂运行环境。

## Configuration Layers

### 1. Basic Settings

面向普通用户，保持少量明确选项：

- 后端版本：`vllm` / `fast6g`
- 播放策略：LIVE / D 模式
- LIVE 质量：流式稳定 / 均衡
- D 模式质量：表现力 / 落盘高质量
- 默认音色、旁白音色、对白音色、当前角色音色
- 是否复用 LLM 拆段

目标：不暴露危险参数，只让用户选择“更快出声”还是“质量更高”。

### 2. Tuning Console

面向喜欢调教的用户：

- LLM 拆段提示词模板
- 声腔/style catalog
- style 到本地参考音频的映射
- style 默认强度：`style_alpha` / `emo_alpha`
- style 默认情绪向量：`emo_vec`
- 角色别名和未匹配角色的显式报错/策略规则
- 角色默认声腔、禁用声腔、优先声腔
- 阶段曲线：开场、升温、高点、余韵等 `stage -> style`

目标：用户可以调出“短剧旁白”“耳语恋爱”“病娇低语”“冷淡角色”“哭腔告白”等风格，而不需要改 JS/Python。

### 3. Expert Mode

面向知道自己在做什么的用户：

- `diffusion_steps`
- `prompt_audio_seconds`
- `segment_tokens`
- `first_tokens`
- `s2mel_cfg_rate`
- `top_p`
- `top_k`
- `temperature`
- `repetition_penalty`
- `emo_alpha`
- LIVE `prebufferSec`
- LIVE `flushSec`
- LIVE 恢复次数和恢复预缓冲增量
- 分段策略：最大段长、强制拆句、段间隔 `interval_ms`

目标：允许用户压榨速度/质量/稳定性，但所有值都必须经过后端 clamp。

## Launcher Integration

启动器适合做用户调教的主入口，因为它在桌面端，有足够空间显示表单、提示词、音色列表、参数说明、预检结果和导入导出操作。

建议边界：

- 启动器管理 profile：新建、复制、重命名、导入、导出、恢复默认。
- 启动器编辑 LLM prompt：提供模板变量、输出 JSON schema、测试拆段和恢复默认。
- 启动器编辑声腔映射：style 列表、参考音频、默认强度、emo_vec、适用说明。
- 启动器编辑角色策略：旁白、用户、当前角色、别名、未匹配角色策略、默认 style、允许/禁用 style。
- 启动器编辑质量档位：LIVE 和 D 模式分别配置，专家参数折叠在高级区。
- 启动器做预检：检查 voice/style 是否存在，参数是否越界，坏音频是否可解码。
- Tavo 端消费配置：只读取当前 active profile，负责播放、切换 LIVE/D、选择基础档位和触发生成。

不建议把完整调音台塞进 Tavo WebView。Tavo 的优势是贴近消息上下文和播放体验；复杂编辑更适合启动器，出问题也更容易显示日志和修复建议。

## Profile Shape

建议先用单文件 JSON profile 表达，不急着做复杂数据库。

```json
{
  "version": 3,
  "name": "耳语恋爱",
  "description": "偏低声、贴近、轻微气声的 Tavo 对话预设",
  "llmPromptId": "default_dialogue_v1",
  "llmPrompt": "...",
  "quality": {
    "presets": {
      "live": {
        "fast": { "diffusion_steps": 8, "prompt_audio_seconds": 6, "segment_tokens": 40, "first_tokens": 10, "s2mel_cfg_rate": 0.7 },
        "balanced": { "diffusion_steps": 14, "prompt_audio_seconds": 10, "segment_tokens": 60, "first_tokens": 18, "s2mel_cfg_rate": 0.7 },
        "expressive": { "diffusion_steps": 16, "prompt_audio_seconds": 12, "segment_tokens": 72, "first_tokens": 24, "s2mel_cfg_rate": 0.7 },
        "ultra": { "diffusion_steps": 20, "prompt_audio_seconds": 14, "segment_tokens": 96, "first_tokens": 32, "s2mel_cfg_rate": 0.7 },
        "custom": { "diffusion_steps": 14, "prompt_audio_seconds": 10, "segment_tokens": 60, "first_tokens": 18, "s2mel_cfg_rate": 0.7 }
      },
      "generate": {
        "fast": { "diffusion_steps": 8, "prompt_audio_seconds": 6, "segment_tokens": 40, "first_tokens": 10, "s2mel_cfg_rate": 0.7 },
        "balanced": { "diffusion_steps": 14, "prompt_audio_seconds": 10, "segment_tokens": 60, "first_tokens": 18, "s2mel_cfg_rate": 0.7 },
        "expressive": { "diffusion_steps": 16, "prompt_audio_seconds": 12, "segment_tokens": 72, "first_tokens": 24, "s2mel_cfg_rate": 0.7 },
        "ultra": { "diffusion_steps": 20, "prompt_audio_seconds": 14, "segment_tokens": 96, "first_tokens": 32, "s2mel_cfg_rate": 0.7 },
        "custom": { "diffusion_steps": 14, "prompt_audio_seconds": 10, "segment_tokens": 60, "first_tokens": 18, "s2mel_cfg_rate": 0.7 }
      }
    }
  },
  "livePlayback": {
    "prebufferSec": 2.25,
    "flushSec": 0.5,
    "maxRecoveries": 3
  },
  "styles": {
    "breath_soft": {
      "label": "轻微气声",
      "ref": "声腔/轻喘-步非烟",
      "style_alpha": 0.34,
      "emo_alpha": 0.55,
      "emo_vec": [0, 0, 0, 0.2, 0, 0, 0, 0.8],
      "description": "适合贴近、低声、轻微呼吸感"
    }
  },
  "roles": {
    "旁白": {
      "voice": "400个火爆音色/短剧解说",
      "default_style": "neutral"
    },
    "用户": {
      "voice": "400个火爆音色/蔡徐坤",
      "aliases": ["你", "user", "玩家", "主人"],
      "default_style": "neutral"
    },
    "current_character": {
      "voice": "声腔/低吟-步非烟",
      "default_style": "breath_soft",
      "allowed_styles": ["neutral", "breath_soft", "whisper_soft", "low_murmur"]
    }
  },
  "stageMap": {
    "opening": { "style": "neutral", "style_alpha": 0.2 },
    "rising": { "style": "breath_soft", "style_alpha": 0.36 },
    "peak": { "style": "scream_peak", "style_alpha": 0.5 },
    "afterglow": { "style": "low_murmur", "style_alpha": 0.38 }
  }
}
```

## LLM Prompt Variables

提示词模板建议支持这些变量：

- `{{source_text}}`
- `{{user_name}}`
- `{{character_name}}`
- `{{roles_hint}}`
- `{{voice_catalog}}`
- `{{style_catalog}}`
- `{{stage_catalog}}`
- `{{output_schema}}`
- `{{profile_notes}}`

输出仍然必须是结构化 JSON。LLM 可以推荐 `role`、`text`、`style`、`style_alpha`、`emo_vec`、`emo_alpha`、`stage`、`pause_ms`，但后端最终负责校验。

## Voice Control Model

Current backend behavior:

- LLM decides segment-level voice-control fields.
- `style` selects a voice-cavity / breath / delivery preset.
- `style_alpha` controls how strongly the style reference audio influences the segment.
- `emo_vec` is an 8-dimensional emotion vector in this order: `[happy, angry, sad, fear, hate, low, surprise, neutral]`.
- `emo_alpha` controls emotion-vector strength.
- Backend validates values before calling the TTS service; invalid values fail the request instead of being silently repaired.
- Narration must use `neutral`; non-neutral narration style is treated as LLM output error.
- If `style` resolves to a reference audio, `style_alpha` can override the segment emotion strength for that synthesis call.
- If no valid style reference exists, backend raises `Profile 配置错误` or `LLM 输出错误` instead of silently inventing a reference.

Prompt behavior:

- The default profile prompt contains `{{style_rules}}` and `{{emotion_rules}}`, so the full prompt is only visible after backend rendering.
- Users can currently influence style choice by editing `llmPrompt` and profile JSON `styles`, but they cannot yet edit the style catalog through a dedicated launcher page.
- Directly deleting `{{style_rules}}` or `{{emotion_rules}}` from the prompt will remove the backend's generated voice-control guidance for the LLM.

Desired profile-owned voice control:

```json
{
  "styles": {
    "whisper_soft": {
      "label": "轻声耳语",
      "ref": "声腔/轻声耳语.mp3",
      "style_alpha": 0.42,
      "emo_vec": [0.1, 0, 0.15, 0.05, 0, 0.25, 0, 0.65],
      "emo_alpha": 0.36,
      "description": "低声、贴近、轻微气声"
    }
  },
  "roles": {
    "旁白": {
      "default_style": "neutral",
      "allowed_styles": ["neutral"]
    },
    "用户": {
      "default_style": "neutral",
      "allowed_styles": ["neutral", "whisper_soft"]
    },
    "current_character": {
      "default_style": "whisper_soft",
      "allowed_styles": ["neutral", "whisper_soft", "sob_soft"],
      "blocked_styles": ["scream_peak"]
    }
  },
  "stageMap": {
    "opening": { "style": "neutral", "style_alpha": 0.18 },
    "close": { "style": "whisper_soft", "style_alpha": 0.42 }
  }
}
```

Implementation target:

- Profile schema v3 moves style catalog out of runtime code defaults. Role style policy and stage curves are still future work.
- API backend should expose the rendered active style catalog through `/profiles/active` or a related route for diagnostics.
- Backend must still validate style names, file existence, alpha ranges, and emotion vector shape.
- Launcher should provide style catalog CRUD, ref-audio picker, default strengths, and role policy editing.
- Tavo should not own this complexity; it only sends selected mode/档位 and active profile-derived request fields.

## User-Editable Areas

优先开放：

- LLM 拆段提示词
- style catalog / 声腔映射
- 角色别名和角色默认音色
- LIVE 档位和 D 模式档位分离
- LIVE 预缓冲参数
- 阶段曲线 `stage -> style`

暂缓开放：

- 直接上传/删除全局 voice library
- 直接修改后端模型路径
- 任意 Python/JS 片段执行
- 无上限的 diffusion / token / prompt 秒数
- 自动并发多任务推理

## Safety Guards

- 后端必须对所有专家参数 clamp。
- 缺失 voice/style 映射要清楚报错，不要悄悄换另一个音色。
- 坏的参考音频要标记为不可用，不要静默 `uses_style_audio=false`。
- LIVE 参数不能破坏 saved/cache audio 的原生 `<audio>` 播放边界。
- Profile 版本允许在启动器创建/迁移时补全成可见 JSON；运行期缺字段、坏 ref、未知 style 必须报错。
- 导入 profile 时先预检：字段、音色存在性、style ref 存在性、参数范围。

## Implementation Roadmap

### Phase 1: Package Author Defaults

- 先让用户默认使用作者内置的声腔、提示词、角色策略和质量档位。
- 不在 P1 暴露完整调教 UI，不要求用户理解 profile、style catalog 或专家参数。
- 保持当前代码默认值和后端 clamp，优先解决安装、启动、播放和更新体验。
- 可以把默认配置整理成内部结构，但先不把它作为用户可编辑功能发布。

### Phase 2: Externalize Defaults

- 把当前 style catalog、质量档位和 LLM prompt 复制成默认 profile。
- 代码里的默认值只用于创建/迁移可见 profile JSON，不作为运行期兜底。
- 前端读取 active profile 后使用显式 catalog 和档位配置。
- 后端读取 active profile 并严格校验，不直接信任 profile 文件。

### Phase 3: Prompt Template Editor

- 在启动器里增加 LLM prompt 模板编辑/恢复默认。
- 支持变量预览和测试拆段。
- 保存到本地 profile store；Tavo 端只读取 active profile 或接收展开后的安全字段。
- 继续保证正常 Tavo 生成只走 `/tts_dialogue_stream_job`，不回退到前端 `/parse_text`。

### Phase 4: Style / Role Tuning UI

- 在启动器里做一个调音台页面：style 列表、参考音频、默认强度、emo_vec、说明。
- 角色页支持别名、默认音色、默认 style、允许/禁用 style。
- 提供“复制当前配置为新 profile”。
- 启动器视觉改造作为独立子项：参考 Windows Terminal 的暗色、低干扰、现代桌面工具风格，减少方框菜单感和粗糙滚动区；仍以“方便安装、双击即开”为硬约束。
- Profile 管理交互参考 CC Switch：外层是配置列表，每条显示名称、文件名/说明、是否 active，并提供应用/启用、复制、编辑、删除等快捷动作；点进详情页后编辑名称、文件名、描述、LLM prompt 和档位参数，底部固定保存按钮。

### Phase 5: Expert Parameters

- LIVE 和 D 模式质量档位拆开。
- 暴露 LIVE `prebufferSec`、恢复次数等播放稳定性参数。
- 暴露专家推理参数，但 UI 标明风险，后端继续 clamp。

### Phase 6: Import / Export

- 启动器支持 `.leon.json` profile 导入导出。
- 导入前预检并报告缺失 voice/style。
- 支持分享几个内置示例：短剧旁白、耳语恋爱、冷淡角色、落盘高质量。

## Open Questions

- Profile first slice uses local JSON files in `config/profiles/`. Editable source profiles are `*.json`; `active.json` is the applied runtime snapshot.
- Tavo first slice reads active profile through the API backend route `/profiles/active`. The launcher writes `active.json` and passes `LEON_ACTIVE_PROFILE_PATH` on startup.
- 多设备使用时，profile 以本机 API 为准还是以 Tavo chat storage 为准？
- 内置 profile 是否要区分 `vllm` 和 `fast6g` 推荐参数？
- 用户上传声腔参考音频是否进入第一版，还是先只允许选择已有 `prompts/library`？
- LLM prompt 允许用户完全自由编辑，还是先提供“规则块”编辑器来减少 JSON 失败率？

## First Useful Slice

已落地的第一版：

1. 新增 `config/profiles/leon-default.json` 和 `active.json` 运行快照。
2. 启动器调音台可以新建/复制 profile、编辑名称/文件名/描述、分别编辑 LIVE/DISK 下每个档位的参数和 LLM prompt。
3. 保存只写源 profile；应用写入 `active.json`，业务生成只消费 active snapshot。
4. Tavo 端只保留“当前选择哪个档位”，生成前读取 active profile 并按 `quality.presets.live/generate[mode]` 展开安全字段。
5. Playwright smoke 增加 guard：LIVE/DISK 都保留 Tavo 选择的档位名，但参数来自 active profile 对应 preset；profile LLM prompt 会作为 `parse_system_prompt` 提交。

下一片最有用：

1. 启动器调音台增加“声控/声腔”编辑页：外层 style 列表，详情页编辑名称、说明、参考音频、默认 `style_alpha`、`emo_vec`、`emo_alpha`。
2. 启动器角色策略页支持给旁白、用户、当前角色配置默认 style、允许/禁用 style。
3. Profile schema 后续增加 `roles.*.default_style`、`roles.*.allowed_styles`、`stageMap`。
4. 增加导入/应用 profile 的预检报告：缺字段、坏 ref、未知 style、越界参数逐条列出。
5. 保留当前后端严格校验：未知 style、缺 active profile、坏 ref、非法参数都直接失败。
