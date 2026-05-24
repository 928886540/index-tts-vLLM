# Index-TTS V26 整合包审计报告(为 TAVO 接入做准备)

最后更新:2026-05-25
审计目标:`D:\apiWorkSpace\Index-TTS-V26\Index-TTS-V26\dist\index-tts-windows-cu128-deepspeed\app\webui.py` (1767 行)
本仓库:`D:\apiWorkSpace\index-tts2-vLLM`(vLLM 版本)

## 审计动机

vLLM 版仓库 (`indextts2_api.py`) 没有多角色对话、没有音色库、没有 HTTP 流式。
V26 整合包号称"正文多个音色",在动手为 TAVO 改 API 之前,先把 V26 的能力摸清,
看哪些可以直接搬到 vLLM 版,哪些是坑要避开。

**结论(三句话):**

1. V26 的多角色对话只在 Gradio WebUI 里,**没有 HTTP API,没有流式播放**。
2. 但脚本格式、音色库目录、WAV 拼接这三块工程逻辑做得不错,可以**整段抄过来**。
3. 情感粒度是"角色级"不是"行级",对 RP/TAVO 场景**不够用**,要扩成行级或走 emo_text 推断。

---

## 一、多角色对话脚本格式

**位置:** `webui.py:311-352`

### 解析正则(312 行)

```python
DIALOGUE_ROLE_PATTERN = re.compile(r"^\s*([^:：]{1,32})\s*[:：]\s*(.+?)\s*$")
```

- 一行一句台词
- 角色名 + 半角冒号 `:` 或全角冒号 `:` + 台词
- 角色名最多 32 字符
- 不匹配的行**直接丢弃**,不当旁白处理

### 示例

```
小明:你好,今天天气真不错。
小红:是啊,要不要一起去公园?
小明:好啊,我去拿外套。
```

### 解析逻辑

```python
def parse_dialogue_script(script: str):
    lines = []
    for raw_line in (script or "").splitlines():
        raw_line = raw_line.strip()
        if not raw_line:
            continue
        match = DIALOGUE_ROLE_PATTERN.match(raw_line)
        if not match:
            continue
        role = match.group(1).strip()
        text = match.group(2).strip()
        if role and text:
            lines.append({"role": role, "text": text})
    return lines
```

→ 返回 `[{"role": "小明", "text": "你好..."}, ...]`

### 对 TAVO 的价值

⭐⭐⭐⭐⭐ **直接抄,但扩展。**

TAVO 输出经常带情绪信息,推荐扩展为:

```
角色名|情感:台词       # 行级情感(优先)
角色名:台词           # 退化到角色绑定情感(兼容 V26 用户)
```

建议的扩展正则:

```python
PATTERN = re.compile(r"^\s*([^|:：]{1,32})\s*(?:\|\s*([^:：]{1,16}))?\s*[:：]\s*(.+?)\s*$")
# group(1)=角色, group(2)=可选情感, group(3)=台词
```

---

## 二、角色 → 音色 映射(8 槽位)

**位置:** `webui.py:314-456`

### 常量

```python
DIALOGUE_ROLE_SLOT_COUNT = 8         # 最多 8 个角色
DIALOGUE_ROLE_SLOT_FIELD_COUNT = 3   # 每个槽位 3 个字段
```

每个槽位包含:`(角色名, 音色引用, 情感)`。

### UI 流程

1. 用户贴脚本
2. 点"解析角色并填入下表"
3. 系统识别出全部不重复角色,自动填入前 N 个槽位
4. 用户每个角色挑一个音色(下拉,来自音色库),挑一个情感(下拉,9 选 1)
5. 点"生成多人对话"

### 映射数据结构

```python
mapping = {
    "小明": {"voice": "voice_a", "emotion": "高兴"},
    "小红": {"voice": "voice_b", "emotion": "默认"},
}
```

### 对 TAVO 的价值

⭐⭐⭐ TAVO 不需要 UI 槽位,但**这个 mapping 结构就是 API payload**。

API 端建议:

```json
POST /tts_dialogue
{
  "script": "小明:你好\n小红:嗨",
  "role_voices": {
    "小明": "voice_a_name_or_path",
    "小红": "voice_b_name_or_path"
  },
  "role_emotions": {       // 可选,行级情感优先于此
    "小明": "高兴"
  },
  "interval_ms": 450,
  "stream": false
}
```

无槽位上限 —— API 不该有 8 这个魔法数字限制,V26 是 UI 限制。

---

## 三、音色库

**位置:** `webui.py:212-308`

### 目录结构

```python
VOICE_LIB_DIR = "prompts/library"
VOICE_LIB_EXTS = (".wav", ".mp3", ".flac", ".ogg", ".m4a")
```

- 一个音色 = 一个音频文件,文件名是音色名
- 文件名经 `_safe_voice_name()` 清洗(Windows 非法字符去掉,截到 60 字符)
- 角色绑定时,音色字段填**音色名**(不带扩展名),`resolve_role_voice()` 自动找到文件

### 关键函数

| 函数 | 行号 | 作用 |
|---|---|---|
| `_safe_voice_name(name)` | 220 | 文件名清洗 |
| `voice_lib_list()` | 226 | 列出所有音色名 |
| `voice_lib_path(name)` | 236 | 音色名 → 文件路径 |
| `_voice_lib_save(audio_path, name)` | 247 | 保存,自动覆盖同名旧扩展 |
| `on_delete_from_library(name)` | 290 | 删除 |

### 对 TAVO 的价值

⭐⭐⭐⭐⭐ **TAVO 接入的基础设施,必须抄。**

TAVO 用户希望"一次性配置好所有角色音色,后续对话只传文本",
所以 API 必须提供音色库管理端点:

```
GET    /voices                  # 列出所有音色名
POST   /voices                  # 上传新音色 (multipart: file + name)
DELETE /voices/{name}           # 删除
GET    /voices/{name}/preview   # 试听 (可选,直接返回原参考音频)
```

`prompts/library/` 目录结构可以**直接复用**,vLLM 仓库已经有这个路径习惯。

---

## 四、对话级情感(踩坑提醒)

**位置:** `webui.py:316-336`

```python
DIALOGUE_EMOTION_CHOICES = [
    "默认", "高兴", "愤怒", "悲伤", "恐惧",
    "厌恶", "低落", "惊喜", "平静"
]
DIALOGUE_EMOTION_VECTORS = {
    "高兴": [0.8, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0],
    "愤怒": [0.0, 0.8, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0],
    # ...每个情感都是 one-hot 0.8
}
```

### V26 实现的限制

⚠️ **这不是"每行台词带自己的情感",是"每个角色全程一个情感"。**

- 走 `emo_vector` 路径,**不走** `emo_text` 大模型推断
- `emo_alpha=0.65` **写死**(`webui.py:543`),不可调
- 主轴 0.8、其它 0,粗暴 one-hot
- 一旦小明绑定"高兴",整段对话小明所有台词都是高兴,不能某句突然怒

### 对 TAVO 的价值

⭐⭐⭐ 概念有用,实现有坑。

TAVO 用户的需求显然是**行级**:
> 「角色一开始平静,结尾愤怒」需要一段对话里同一角色出现多种情感。

API 设计建议:

1. **行级情感优先**:脚本里 `角色|情感:台词` 形式覆盖角色默认
2. **角色默认情感兜底**:`role_emotions` 字段提供角色默认
3. **emo_text 模式**:若都没指定,可选启用 `auto`,把当前台词本身丢给 Qwen 推情感
4. **`emo_alpha` 必须可传**,V26 的 0.65 写死是技术债

---

## 五、WAV 拼接(`combine_wav_files`)

**位置:** `webui.py:459-481`

```python
def combine_wav_files(wav_paths, output_path, interval_ms=450):
    # 用 Python 标准库 wave 拼接
    # 每段之间插入 silence_frames 字节的零样本(静音)
```

特点:
- 用标准库 `wave`,无外部依赖
- 检查每段 channels/sampwidth/framerate 一致(不一致直接报错)
- 静音间隔默认 450ms,可调

### manifest.json

**位置:** `webui.py:559-561`

每次生成同时写元数据:

```json
[
  [1, "小明", "高兴", "你好,今天天气真不错。", "outputs/dialogue/.../001_小明.wav"],
  [2, "小红", "默认", "是啊,要不要一起去公园?", "outputs/dialogue/.../002_小红.wav"]
]
```

### 对 TAVO 的价值

⭐⭐⭐⭐ **直接抄。**

`combine_wav_files` 几乎可以一行不改地搬过来。
manifest.json 对调试和回放也非常有用,TAVO 端可以拿来做时间轴/字幕同步。

---

## 六、HTTP API ❌ 完全没有

```bash
grep "FastAPI|uvicorn.run|StreamingResponse" V26/app/*.py
# → No files found
```

**整个 V26 整合包不包含任何 HTTP API。** 只有 Gradio WebUI。

→ TAVO 要接入,vLLM 仓库的 `indextts2_api.py` 是**唯一入口**,V26 的能力一行代码都不能直接复用,必须搬运 + 重写为 FastAPI 端点。

---

## 七、流式播放 ❌ 完全没有

V26 的对话生成 (`gen_dialogue`, 484 行) 是**严格串行**:
- 一段一段顺序合成
- 全部合成完后才 `combine_wav_files` 合并
- 用户必须等完整生成,听不到中间任何一段

对比:vLLM 版 WebUI 已有边生成边播流式(我们正在调优的这块)。

→ TAVO 接入时,**对话模式 + 流式**是 V26 没有的全新能力,要在 vLLM 版从零设计。

---

## 八、对 TAVO 接入的总体规划

### 必须搬过来的(零设计成本)

| V26 资产 | 搬运目标 | 估计工作量 |
|---|---|---|
| `parse_dialogue_script` 正则 | `indextts2_api.py` 新增辅助函数 | 10 分钟(扩展支持情感列) |
| `prompts/library/` 音色库目录约定 | vLLM 仓库新建同名目录 + helper | 30 分钟 |
| `voice_lib_*` 系列函数 | `indextts2_api.py` 端点 | 1 小时 |
| `combine_wav_files` 拼接函数 | `indextts2_api.py` 直接复制 | 5 分钟 |
| `manifest.json` 写入 | 同上 | 5 分钟 |
| `DIALOGUE_EMOTION_VECTORS` 字典 | 复制 | 1 分钟 |

### 必须重写的(V26 没有或不够用)

| 能力 | 原因 | 优先级 |
|---|---|---|
| FastAPI 端点封装 | V26 全 Gradio | P0 |
| 行级情感语法 (`角色\|情感:台词`) | V26 只到角色级 | P1 |
| `emo_alpha` 参数化 | V26 写死 0.65 | P1 |
| `emo_text` 推断模式 | V26 完全没走这条路 | P2 |
| 对话模式 + 流式合一 | V26 串行,vLLM 流式没对话 | P2(大头) |

### 建议的 API 端点最终形态

```
POST /tts                  # 单段生成,保持现状(向后兼容)
POST /tts_stream           # 单段流式 (上次讨论的 SSE)
POST /tts_dialogue         # 多角色对话,一次性返回
POST /tts_dialogue_stream  # 多角色对话 + 流式(终极形态,接 TAVO 主用)
GET  /voices               # 音色列表
POST /voices               # 上传音色
DELETE /voices/{name}      # 删除音色
```

---

## 九、给下一个开发者的提醒

- 不要去 V26 仓库改代码,V26 是参考品,**所有改动都在 `D:\apiWorkSpace\index-tts2-vLLM`**。
- 不要复制 V26 的 `emo_alpha=0.65` 写死,**所有情感参数必须可传**。
- 不要复制 V26 的"角色级情感"模型,**TAVO 必须行级**。
- 复制 `combine_wav_files` 时记得保留 channels/sampwidth/framerate 一致性检查,
  否则混用不同采样率的音色库会爆。
- 音色库目录建议沿用 `prompts/library/`,保持和 V26 用户的迁移成本最低。
- 别忘了 `_safe_voice_name` 的 Windows 非法字符清洗,TAVO 角色名可能带各种符号。

---

## 附:V26 关键代码位置索引

| 内容 | 文件 | 行号 |
|---|---|---|
| 对话脚本正则 | `webui.py` | 312 |
| 对话槽位常量 | `webui.py` | 314-315 |
| 情感选项 | `webui.py` | 316-336 |
| 解析对话脚本 | `webui.py` | 339 |
| 角色去重 | `webui.py` | 360 |
| 音色引用解析 | `webui.py` | 371 |
| 槽位构造 | `webui.py` | 382 |
| 槽位 → mapping | `webui.py` | 444 |
| WAV 拼接 | `webui.py` | 459 |
| 对话主生成函数 | `webui.py` | 484 |
| manifest 写入 | `webui.py` | 559 |
| 音色库目录定义 | `webui.py` | 215-217 |
| 音色库操作 | `webui.py` | 220-308 |
| 多人对话 UI Tab | `webui.py` | 1362 起 |

## 附:V26 的备份文件名暗示的演进历史

V26 整合包同目录还有这些备份(没看内容,仅记录命名):

- `webui.py.backup_before_dialogue_emotion_20260501` —— 加情感前的版本
- `webui.py.backup_before_multirole_20260501` —— 加多角色前的版本
- `webui.py.backup_before_role_slots_20260501` —— 加 8 槽位前的版本
- `webui.py.backup_before_product_ui` —— 商业化 UI 之前的版本

→ 多角色 + 槽位 + 情感这三件事是 2026-05-01 前后做的,
  说明 V26 作者也是先做了多角色再补情感的渐进路线。
  我们 vLLM 版可以直接一步到位(行级情感 + 流式 + API)。
