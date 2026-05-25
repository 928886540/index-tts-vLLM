# Claude × Codex 协作计划

最后更新:2026-05-25 00:30+
本文件作者:Claude(Opus 4.7,1M context)
配套文件:`HANDOFF_WORK_SUMMARY_20260525.md`(Codex 写的工作总结,**必读**)

## 工作目录

```text
D:\apiWorkSpace\index-tts2-vLLM
```

绝对不要碰 `D:\apiWorkSpace\Index-TTS-V26`(那是参考品)。

---

## 双 Agent 配置

### Codex(GPT-5.5)
```powershell
codex --model pm/gpt-5.5
```
- 装在 `C:\Users\Administrator\AppData\Roaming\npm\codex.cmd`
- 用户已有跑着的实例;新启动看 Codex 自己的 session 管理

### Claude(Opus 4.7,1M context,本机)
```powershell
claude
```
- 单窗口、单 session、单工作目录
- 启动后第一件事:读完本文件 + Codex 的 `HANDOFF_WORK_SUMMARY_20260525.md`

---

## 分工边界(模式 2:分支 + 文件域隔离)

### Codex 负责(主分支 `VLLM`)

| 范围 | 文件 |
|---|---|
| 流式合成质量与稳定 | `indextts/utils/front.py`(`split_segments_by_sentence_boundary`) |
| 流式扩散性能 | `indextts/s2mel/modules/flow_matching.py` |
| 推理后端 | `indextts/infer_vllm_v2.py`(尤其 `trim_audio_for_prompt`, `max_prompt_audio_seconds`) |
| WebUI 流式播放器 | `webui.py` 流式分支(`STREAM_*` 常量、chunk 回调、前端 prebuffer/jitter) |
| 启动稳定性 | `patch_vllm.py`、`go-webui-VLLM-NoQwen.bat` |
| 音色历史记录 | `prompts/audio_history.json` 相关逻辑 |

### Claude 负责(独立分支 `VLLM-tavo-api`)

| 范围 | 文件 |
|---|---|
| TAVO/外部 HTTP API | `indextts2_api.py` |
| 多角色对话端点 | `indextts2_api.py` 新增 + 可能新建 `indextts/dialogue.py` |
| 音色库 HTTP 端点 | `indextts2_api.py` 新增 + 可能新建 `indextts/voice_library.py` |
| 流式 HTTP 端点(SSE/分块 WAV) | `indextts2_api.py` 新增 `/tts_stream` `/tts_dialogue_stream` |
| 设计文档 | `V26_AUDIT_FOR_TAVO_20260525.md`(已存在)、未来 `TAVO_API_SPEC.md` |
| 集成测试 | 新建 `tests/test_api_tavo.py`(如有必要) |

### 共享只读(任何一方都不要修改)

| 文件 | 原因 |
|---|---|
| `HANDOFF_WORK_SUMMARY_*.md` | Codex 的工作总结,Claude 只读 |
| `V26_AUDIT_FOR_TAVO_*.md` | Claude 的设计文档,Codex 只读 |
| `COLLABORATION_PLAN_*.md` | 本文件,任何更新走"修订记录"节 |
| `HANDOFF.md`、`HANDOFF_STREAMING_*.md` | 历史归档 |

### 灰色地带(改前必须先看对方最近动了没)

| 文件 | 风险 |
|---|---|
| `indextts/infer_vllm_v2.py` | Codex 的主战场,但 Claude 加 API 时可能要复用其方法。**只调用,不修改**。如必须加方法,先拉一个新模块包一层 |
| `webui.py` | Codex 持续在改。Claude 不动它,除非用户明确要求 |
| `requirements.txt` / `pyproject.toml` | 任何一方加依赖前先 `git status` 看对方有没有改 |

---

## 分支策略

```text
main                       (上游,不动)
  └─ VLLM                  (Codex 主分支)
        ├─ 已推:ff9e8de
        └─ Claude 不直接 commit 到这里
  └─ VLLM-tavo-api         (Claude 的工作分支,从 VLLM 拉)
        ├─ 周期性 rebase 到 VLLM(吸收 Codex 的进展)
        └─ TAVO 全部 PR 在这里准备
```

### Claude 第一次启动时做的初始化

```powershell
git -C D:\apiWorkSpace\index-tts2-vLLM fetch
git -C D:\apiWorkSpace\index-tts2-vLLM checkout -b VLLM-tavo-api VLLM
```

之后 Claude 所有 commit 都在 `VLLM-tavo-api`,**不在 `VLLM` 上 commit**。

### Rebase 节奏

Claude 每次开工先:
```powershell
git -C D:\apiWorkSpace\index-tts2-vLLM fetch
git -C D:\apiWorkSpace\index-tts2-vLLM log --oneline VLLM..origin/VLLM
```

如果 origin/VLLM 有新提交(Codex 推过的),先 rebase:
```powershell
git -C D:\apiWorkSpace\index-tts2-vLLM rebase origin/VLLM VLLM-tavo-api
```

冲突一定优先保留 Codex 的版本(主分支),Claude 这边重新适配。

---

## Claude 下次启动后的执行流程(自动化清单)

1. **读必读文档**
   - `HANDOFF_WORK_SUMMARY_20260525.md`(Codex 工作总结)
   - `V26_AUDIT_FOR_TAVO_20260525.md`(Claude 自己写的 V26 审计)
   - 本文件
   - 如果有更新的 `HANDOFF_*_<date>.md`,按日期降序全读

2. **同步分支**
   ```powershell
   git -C D:\apiWorkSpace\index-tts2-vLLM fetch
   git -C D:\apiWorkSpace\index-tts2-vLLM status
   git -C D:\apiWorkSpace\index-tts2-vLLM log --oneline -10
   ```

3. **首次:创建工作分支** / **后续:rebase**
   ```powershell
   # 首次
   git -C D:\apiWorkSpace\index-tts2-vLLM checkout -b VLLM-tavo-api VLLM
   # 后续
   git -C D:\apiWorkSpace\index-tts2-vLLM checkout VLLM-tavo-api
   git -C D:\apiWorkSpace\index-tts2-vLLM rebase origin/VLLM
   ```

4. **检查 vLLM 后端是否还在跑**(Codex 那边可能开着)
   ```powershell
   Get-CimInstance Win32_Process | Where-Object {
     ($_.Name -in 'cmd.exe','python.exe') -and
     ($_.CommandLine -match 'go-webui-VLLM-NoQwen|webui\.py|indextts2_api|vllm')
   } | Select-Object ProcessId,Name,CommandLine | Format-List
   ```
   - 如果 7860(WebUI)或 9880(API)已占用,**不要重启**,直接复用
   - 如果都没起,按需启动 API:
   ```powershell
   Start-Process -FilePath "cmd.exe" -ArgumentList "/k", "go-API-VLLM-NoQwen.bat" `
     -WorkingDirectory "D:\apiWorkSpace\index-tts2-vLLM" -WindowStyle Normal
   ```

5. **第一阶段任务清单(按优先级)**
   - [ ] P0:在 `indextts2_api.py` 加 `GET /voices` `POST /voices` `DELETE /voices/{name}`
   - [ ] P0:在 `indextts2_api.py` 加 `POST /tts_dialogue`(非流式版,先跑通)
   - [ ] P1:扩展脚本格式为 `角色|情感:台词`(可选情感列)
   - [ ] P1:`POST /tts_stream`(单段流式,SSE 或 chunked WAV)
   - [ ] P2:`POST /tts_dialogue_stream`(终极形态)
   - [ ] P2:`TAVO_API_SPEC.md` 写完整对外文档

   全部参考 `V26_AUDIT_FOR_TAVO_20260525.md` 第八节"对 TAVO 接入的总体规划"。

6. **代码搬运清单(零设计成本,从 V26 复制)**
   - `parse_dialogue_script` 正则 → V26 `webui.py:312`
   - `voice_lib_list/path/save/delete` 函数族 → V26 `webui.py:226-308`
   - `combine_wav_files` → V26 `webui.py:459`
   - `_safe_voice_name` → V26 `webui.py:220`
   - `DIALOGUE_EMOTION_VECTORS` 字典 → V26 `webui.py:327`

   ⚠️ 搬运时必须按 `V26_AUDIT_FOR_TAVO_20260525.md` 第四节的修正:
   - `emo_alpha` 必须可传,不要写死 0.65
   - 情感支持行级覆盖(`角色|情感:台词`)
   - 不要复制 V26 的 8 槽位 UI 上限

---

## 协作守则(基于本次踩坑教训)

### 必须做

1. **每次开工先 `git fetch && git log` 看对方动了没**
2. **看到不认识的提交先问,不动手撤**(本次教训:Claude 把 Codex 的 `0a0eea9` 撤了)
3. **每次提交前 `git status` 确认只 add 自己分工范围内的文件**
4. **任何 `git reset --hard`、`git push --force`、`git checkout --` 之前先问用户**
5. **commit 信息加上**:`[claude]` 或 `[codex]` 前缀,便于事后追溯

### 不要做

1. **不要在对方的分支上直接 commit**(Claude 只在 `VLLM-tavo-api`,Codex 只在 `VLLM`)
2. **不要并发改同一个文件**(灰色地带文件改前必须 `git diff origin/VLLM` 看对方最新版)
3. **不要互相 review 出 trivial style 建议浪费 token**,只 review 实际 bug 和接口契约
4. **不要把对方的工作总结当过期信息**,Codex 的 `HANDOFF_WORK_SUMMARY_*.md` 是 Claude 的真相源
5. **不要把 `音色参考音频/`、`prompts/history/`、`prompts/audio_history.json` 推上 GitHub**(Codex 的红线)
6. **不要碰 `D:\apiWorkSpace\Index-TTS-V26`**

### 出现以下情况立即停手并问用户

- `git status` 显示有不属于本分工的文件 modified
- `git log` 出现作者不是自己的、不在协作计划内的 commit
- `port 7860` / `9880` 已被监听但不知道是谁起的
- 任何"我以为是 hook/我以为是自动行为"的猜测

---

## 提交信息约定

```text
[claude] Add /tts_dialogue endpoint for TAVO integration

<正文,描述实现要点>

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
```

Codex 这边对称用 `[codex]` 前缀(由用户告知 Codex)。

---

## 同步点(periodic handoff)

每次大节点(完成 P0 / P1 / P2),Claude 写一个 `HANDOFF_TAVO_<日期>.md`,内容对称 Codex 的工作总结:

- 当前状态、已推送提交
- 关键修复 / 新端点
- 需要 Codex 配合的接口契约(比如新增的 `infer()` 参数)
- 不要再做的事

这样下次接手不论是 Claude 还是 Codex,都有上下文。

---

## 当前已知的悬空事项

- `音色参考音频/` 未推送(Codex 红线)
- `HANDOFF.md` / `HANDOFF_STREAMING_20260524.md` / `HANDOFF_WORK_SUMMARY_20260525.md` 未推送(可以推,也可以保持本地;用户决定)
- 本文件 `COLLABORATION_PLAN_20260525.md` 应在写完后立即提交并推送

---

## 修订记录

| 日期 | 修订者 | 变更 |
|---|---|---|
| 2026-05-25 00:35 | Claude (Opus 4.7) | 初版,基于 Codex 的 HANDOFF_WORK_SUMMARY_20260525.md 和 V26_AUDIT_FOR_TAVO_20260525.md 拟定 |
