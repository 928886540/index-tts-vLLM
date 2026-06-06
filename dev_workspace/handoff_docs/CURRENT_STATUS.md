# IndexTTS × TAVO 当前进度交接（2026-05-27 下午刷新）

> 这一份覆盖了 2026-05-25 → 2026-05-27 这两轮重写。旧版本(只到 fix3)请看 `archive/20260525/`。
>
> **最近一次 git 状态(2026-05-27 14:04 后)**
> - `20719b0` 开发工具，参考音频 —— 把 `Leon_api/dev_tools/`、`Leon_api/screenshots/`、`prompts/library/{男声,女声,情绪,...}/` 等 105 个文件正式 commit 入仓
> - `41f1754` 现有bug set页面过长。实现流式播放 —— 本文档对应的那次大重写(后端 LIVE_JOBS / 前端真流式 + 字幕 + 持久化)
> - 工作树目前只剩 `Leon_api/dev_tools/restart_test.{err,log}` 未提交(纯运行日志,可丢)
>
> **遗留物 / 下次接手第一时间清掉:**
> - 根目录 `.codex_dispatch_voice_library.log`(4015 行,误提交,应进 `.gitignore` 并 `git rm --cached`)
> - `static/tavo (2).js`(445 行,Windows 资源管理器复制时生成的副本,删掉)

## TL;DR

后端架构这一轮做了**异步 job + cache_key pubsub buffer** 大重构,前端 tavo.js 跟着改成
**卡片立即持久化 + 真流式 + 实时字幕**。核心目标:**生成中断/刷新不丢历史,
手机也能流式播放,卡片按消息 id 跨 session 留存**。

测试方式仍是在 TAVO 消息显示时正则注入 `<script src=".../static/tavo.js?v=日期">`。

---

## 1. 启动

```powershell
cd D:\apiWorkSpace\index-tts2-vLLM
.\indextts2runtime\python.exe indextts2_api.py -a 0.0.0.0 -p 9880
```

参数默认即 `--fp16 --cuda_kernel` 且 **不加载 Qwen 情绪模型**(`--qwen_emo` 显式打开才会用 Qwen)。

> 凌晨那次自测的 PID 5508 已经过时,接手时先 `Get-Process python` 或 `netstat -ano | findstr :9880` 确认服务是否还在,不在就重启。

---

## 2. 这一轮新加 / 改动的端点

| 端点 | 作用 | 新旧 |
|---|---|---|
| `POST /tts_dialogue_stream_job` | **立即返回 `cache_key` + 启动后台推理任务**(不再等 GET) | 重写 |
| `GET /tts_dialogue_stream_job/{cache_key}` | 从 LIVE_JOBS pubsub buffer 流式读取;断线重连不丢 | 重写 |
| `GET /tts_dialogue_job_status/{cache_key}` | 轮询作业状态(running/done/failed) + 每段 `segments_meta`(role/text/start_offset/duration) | **新增** |
| `GET /cache_audio/{cache_key}` | 按 snapshot key 直接拿完整 WAV(含 Content-Length,可 seek) | 新增 |
| `GET /server_log/tail?n=&filter=` | tee stdout/stderr 进 ring buffer 取尾部 | 新增 |
| `POST /parse_text` | OpenAI-compatible LLM 代理。已加 `stream: false` 防 SSE 默认 | 修复 |

后端关键文件:
- `indextts2_api.py:255-330` —— `LIVE_JOBS`、`_LiveStreamingJob`、`_stream_from_live_job`、
  `_make_complete_wav_bytes`、`_prepare_dialogue_for_streaming`、`_run_dialogue_inference_to_job`、
  `_gc_live_job`
- `indextts2_api.py:1541-1660` —— 新版 POST/GET/Status 三个端点
- `indextts2_api.py:1004-1029` —— `/cache_audio/{key}` 端点
- `indextts2_api.py:1031-1054` —— `/server_log/tail` 端点

### LIVE_JOBS pubsub 数据流

```
客户端 POST /tts_dialogue_stream_job
   │
   ├─ payload → snapshot_cache.make_cache_key(...)  =  cache_key 唯一标识
   ├─ snapshot 已有? → 返回 {cached: true, cache_url}
   ├─ LIVE_JOBS 已有? → 返回 {live: true} 附着到现存 job
   └─ 都没? 创建 _LiveStreamingJob → asyncio.create_task 跑推理
                                 └─ 返回 {cache_key, url, cache_url}

后台 task:                            
  写 WAV header → job.header                      
  对每段 segment 跑 tts_pipeline.infer
     on_chunk(pcm) → job.pcm.extend(pcm)         
     段间 silence → job.pcm.extend(silence)      
  跑完 → 完整 WAV → snapshot_cache.save_cached_audio
       → job.finished.set()
       → _gc_live_job 5 分钟后清 LIVE_JOBS

任何客户端 GET /tts_dialogue_stream_job/{cache_key}
  ├─ snapshot 已落盘? → FileResponse(content-length, seekable)
  ├─ LIVE_JOBS 还在? → StreamingResponse 从 job.header + job.pcm 头开始读
  │                    每 50ms tail-poll, 新 PCM 立刻 yield
  │                    finished + 全读完 → 关
  └─ 都没? → 404
```

**关键不变量:**
- `cache_key = hash(payload)`,客户端可以前置算出,**不依赖服务器返回**;后端只是确认值
- 推理跟 HTTP 连接解耦:client 断开 task 不停;client 重连按 cache_key 拿同一个 buffer
- 跑完自动落盘 → 后续 `/cache_audio/{key}` 永久可取(直到 snapshot prune 才被删)

---

## 3. 前端 tavo.js 这一轮改动

### 默认配置(`tavo.js:13-25`)

```js
DEFAULT_CONFIG = {
  apiBase: scriptOrigin(),                          // 强制 = 脚本加载来源
  mode: "single",
  defaultVoice: "",
  roleVoicesText: "旁白=旁白\n我=霸气青年\n明月=风韵少妇_minimax",
  llmEndpoint: "http://127.0.0.1:8317/v1",          // 默认本地代理
  llmModel: "渡鸦/grok-4.20-fast",                  // 默认带前缀
  llmApiKey: "",                                    // 空,用户自己填
  emoAlpha: 0.4,                                    // 之前 0.7 太做作
  ...
}
```

`apiBase` 在 `getConfig` 里**强制覆盖**成 `scriptOrigin()`,localStorage 残留无效。
脚本从哪儿加载,API 就打到哪儿,绝对一致。

### 卡片模型 + 持久化(`tavo.js:240-270`)

```
trackEntry = {
  url:        blob URL OR cacheUrl OR streamUrl,    // 播放源,三级 fallback
  streamUrl:  /tts_dialogue_stream_job/<key>,       // 实时流(可中断重连)
  cacheUrl:   /cache_audio/<key>,                   // 落盘后的稳定 URL
  cacheKey:   <40 hex>,                              // 持久化用
  segments:   [{role, text, emo_vec, ...}],         // 字幕用
  voice:      <音色名>,
  mode:       "ai8" | "single",
  createdAt:  Date.now(),
  pendingBlob: 是否还在等 inference 落盘
}
```

按消息 id 持久化:`tavo.set("indextts_tracks_<messageId>", lite_tracks)`(只存 cacheKey + 元数据,
不存 blob)。mount() 时通过 `tavo.get(...)` 读回,在 generatedTracks 数组里恢复成可播放的卡片,
prev/next 按数组索引在卡片间跳。

`saveTracksForMessage` 在以下时机触发:
- 卡片刚 push 进数组(立即有 cacheKey)
- 后台 job_status 轮询发现 state=done 时(URL 升级到 cacheUrl)
- 删除卡片之后(同步删除)

### 播放按钮逻辑(`tavo.js:866-880`)

```
点 ▶ 播放按钮:
  if (generatedTracks 空) → 新建生成
  else if (audio.src 已就绪) → play / pause toggle
  else → selectTrack(currentTrackIndex, autoplay=true)
点 + 加号按钮 → 永远新建(force=true)
```

之前的 bug:每次点播放都新建,因为 audio.src 在移动 Web Audio 路径上一直为空。
现在用 `generatedTracks.length > 0` 作为"已有内容"判断,无需依赖 audio.src。

### 移动端真流式(`tavo.js:streamWavViaWebAudio`)

iOS Safari / 安卓 WebView 的 `<audio>` 不接受 chunked WAV(无 Content-Length 时报 media error)。
绕开方法:**完全不用 `<audio>`,用 Web Audio API**。
- `fetch(streamUrl).body.getReader()` 拿 ReadableStream
- 解析 WAV 头(channels/sampleRate/bits/data 段位置)
- 每 ~0.5s PCM 累积成一块,`ctx.createBuffer` + `BufferSource.start(nextAt)` 调度
- nextAt 按 buffer.duration 累加,**无缝拼接**
- 若 `body.getReader()` 不支持,降级到 `arrayBuffer + decodeAudioData` 一次性播

iOS 用户手势锁:点 ▶ 按钮 click 处理器内同步调 `primeAudioContext()` 创建并 resume,
跨过后续的 await 链不会丢手势。`PRIMED_CTX` 复用,不关闭。

错误处理:**已起播之后的 reader.read 异常容忍**(用户切到后台再回来,stream 断 = 正常退出,
不弹错误 UI;已调度的 buffer 自然播完)。

### 实时字幕 + 头像气泡(`tavo.js:843-940`)

- `startSubtitle(trackEntry, getTimeSec)` 用 trackEntry.segments 构建时间轴
  (估算 = text.length × 0.15s,后台轮询 `/tts_dialogue_job_status` 拿真实 duration_s 替换)
- 每 150ms tick 计算当前时间对应哪一段,高亮显示该段头像 + role + text
- 头像默认 3 套(内嵌 SVG):**旁白 / 我用户 / 其他角色**;TAVO 提供的 avatarUrl 优先用于"其他角色"
- 桌面 `<audio>` 用 `audio.currentTime`;移动 Web Audio 用 `performance.now() - playStartedAt`
- 播放结束/暂停/出错时 `stopSubtitle()` 收起气泡

CSS:`tavo.js:160` 那一行末尾追加了 `.idx-subtitle` + `.idx-subtitle-avatar` + 渐变背景 + 淡入动画。

### 调试浮窗(只在测试页)

`DEBUG_MODE` 只在 URL 含 `tavo_widget_test` 或 `?ttsDebug=1` 时开。所有 `debugLog` 同时
`console.log/console.error`,正常 TAVO 没浮窗也能远程调试控制台看到。

### IME 防覆盖

`setField` 加了守护:输入框正 focus 或 IME 组词中(compositionstart 设置 `__indexttsComposing=true`)
时跳过 value 覆盖,搜狗/微软拼音不再被 syncUI 打断。

---

## 4. 后端微调

### 旁白 emo_vec 微情绪化(`indextts2_api.py:_run_dialogue_inference_to_job` + 另两处 handle)

`role == "旁白"` 时无视 LLM 输入,做软压制:
- 每个非中性维度 `× 0.4` 然后 capped 到 0.3
- neutral 维度抬到 ≥ 0.6
- `emo_alpha` 压到 ≤ 0.25

效果:叙述者不再跟着剧情大起大落但仍有轻微情绪波动。

### LLM prompt(`tavo.js:parseWithLlm`)

- 每段只激活 **1-2 个** emo_vec 维度(多维齐动 → 做作)
- 旁白严格 `[0,0,0,0,0,0,0,1]`(虽然后端会再覆盖一次)
- 「你」做主语的叙述 → 旁白;「你」说话 → role 统一规范 "我"
- 输出每段 `emo_alpha` 0.2-0.5

`llm_proxy.py` 把 role 别名归一:`我/你/用户/user/me/you → 我`,`narrator/旁白/叙述/正文 → 旁白`。
dialogue 端点对 voices map 的 key 也做同样归一,所以 `用户=高圆圆` 和 `我=高圆圆` 等价。

### 输出端音频处理(`indextts/infer_vllm_v2.py`)

- 输出端 **soft-clip with tanh knee**(膝点 0.7):防 bigvgan 输出 > 1.0 时的硬截顶爆音
- 段边界 5ms 淡入淡出:消段切换 pop
- ref 音频温柔归一化:只在 peak < 0.3 时拉到 0.3,> 1.0 时压到 0.95,正常音色不动
  (避免之前激进的 ×12 增益放大底噪导致"做作")
- 语速 multiplier 2.0 已退回 1.72(模型训练时的比例,2.0 会破坏节奏)
- `gpu_memory_utilization=0.25` + `max_num_seqs=1` + `enable_prefix_caching=False`:
  压 KV cache 从 1.93GB → 0.64GB 释放给 s2mel/bigvgan

---

## 5. 自测结果(2026-05-27 02:25)

```
POST /tts_dialogue_stream_job
  → cache_key=7ca7d686...  cached=false  live=false  ✓ 立即返回 key

后台 task 跑:
  >> chunk 1/1: text_tokens=26, RTF=0.95    [旁白]
  >> chunk 1/1: text_tokens=20, RTF=2.18    [她-高圆圆 冷启动]
  >> chunk 1/1: text_tokens=26, RTF=0.70    [旁白-热]
  >> chunk 1/1: text_tokens=22, RTF=0.71    [我-霸道青年]
  Total inference: 15.4s for 11.66s audio = RTF 1.32

GET /cache_audio/<key>
  → 200, content-length: 567524, accept-ranges: bytes  ✓ 可 seek

POST 同 payload 二次
  → cached=true                ✓ 不重复推理

WAV 校验
  → live-stream 与 cache-audio 字节级一致  ✓
```

---

## 6. 未完成 / 待用户

### 6.1 Volink TTS 批量生成默认音色集 [已生成 31 个,待 UI + 余量决定]

**完成现状(2026-05-27 凌晨):**
- Volink API base = `https://api.volink.org/v1`
- key 在 `Leon_api/README.md`
- TTS endpoint: `POST /v1/audio/speech`
- Payload: `{"model":"<voice.model>","text":"...","voice":"<voice.id>"}`(必须 `text` 不是 `input`)
- **大坑:windows curl 用 `-d` 会把中文搞乱码 → 永远走 `--data-binary @file.json` 或 Python urllib**
- Voice 库 561 个,分 4 个 model:
  - bytedance/openspeech-tts-v3: 286
  - minimax/speech-02-turbo: 197(用户原 "_minimax" 后缀那批的来源)
  - cosyvoice/CosyVoice2-0.5B: 42(用户克隆的 AD学姐 / Jok 在这)
  - sensetime/sensenova-tts-v1: 36(**用户说的"日日新",全英文名**)
- 完整 voice 名单 → `Leon_api/dev_tools/volink_voices.txt`(561 行)
- Voice 分页只支持 `page_size=100&page=N`(不是 `limit`+`offset`)
- **balance/credits 端点没找到**(/v1/balance 等都 404),没法编程查余额

**已落盘 31 个(已随 `20719b0` 入仓):**
- `prompts/library/男声/*.wav` × 10(高冷领导 / 温柔男友 / 忧郁少年 / 专业播报 / 睿智老爹 / 翩翩公子 / 邻家男孩 / 儒雅青年 等)
- `prompts/library/女声/*.wav` × 10(暖心外婆 / 魅惑女神 / 热销达人 / 访谈主持 / 宝岛甜心 / 温柔女神 / 冰山美人 / 卡通女孩 / 甜蜜恋人 / 魅力女生)
- `prompts/library/AD学姐.wav`、`Jok.wav`(替换原 mp3,peak normalize 0.85)
- `prompts/library/情绪/*.wav` × 8(呻吟/喘息/哭泣/哽咽/撒娇/低吟/害羞/笑 拟声词)
- 全部 librosa peak normalize 到 0.85

**Volink 用户搜了"风韵少妇" 0 match**——可能就在 SenseTime/日日新 那 36 个里(全英文名),候选:
- Sophia Allure(成熟魅惑)
- Amorous Queen(多情女王)
- Charming Girlfriend
- Elegant Lady
- Gentle Empress
- Velvet Voice

**复用脚本:**
- `Leon_api/dev_tools/volink_generate.py` —— 按分类批量生成(初版)
- `Leon_api/dev_tools/volink_replace.py` —— 替换特定 3 个 + 8 个情绪样本

**下次接手要做:**
1. 决定要不要继续生成更多(用户说"花到剩 200K",但也说"别瞎下")—— **建议先做 UI 改造**让用户直接在面板里挑 Volink voice 名,他在 UI 里点的才生成
2. 调研结果:中文 TTS 用户偏好(参考):
   - 御姐 → 火山豆包"魅惑女声" / MiniMax `female-yujie`
   - 学姐 → 火山"灵动 / 清新女声" / Gemini "Kore"
   - 总裁 → 火山"沉稳男声" / ElevenLabs "Adam"
   - 萝莉 → 火山"奶气萌娃" / MiniMax `female-shaonv`
3. 用户特别提到 SenseTime/日日新 voices(36 个英文名),里面应该有"风韵少妇"对应——下次确认后用 voice id 生成

### 6.2 UI 重做:音色面板 + 角色映射 [新增,优先级高]

**问题:**
- 现状音色卡片就一个 grid 全平铺,30+ 音色显示混乱
- 角色音色映射是 textarea 手输("我=xxx\n旁白=yyy"),不友好
- 用户期望:
  - **音色面板**:按子目录分组(男声/女声/旁白/情绪)、分页、搜索框
  - **角色映射**:结构化行(默认有 `我`、`明月` 两条),每行:`[角色名输入] → [选择音色按钮 → 弹音色库选取]`
  - 可点 `+ 添加角色` 增加新行

**接手代码位置:**
- `static/tavo.js:613-635` —— `<div class="idx-panel">` 模板里 AI 八情绪那块
- `tavo.js:parseRoleVoices` —— textarea 文本解析逻辑,改成对象数组持久化
- `tavo.js:159` —— `parseRoleVoices` 接受逗号/换行,继续保留兼容性

**改造思路:**
```html
<div class="idx-ai8-only">
  <div class="idx-section-title">角色配置</div>
  <div class="idx-roles" data-role="roles-list">
    <!-- 每条 row 是 {role, voice} -->
    <div class="idx-role-row">
      <input class="idx-input" placeholder="角色名" data-row-field="role" value="我">
      <button class="idx-voice-pick" data-row-field="voice">高圆圆</button>
      <button class="idx-row-del">×</button>
    </div>
  </div>
  <button class="idx-add-role">+ 添加角色</button>
  ...
</div>

<!-- 弹出层 -->
<div class="idx-voice-picker idx-hidden">
  <input placeholder="搜索音色…" data-role="voice-search">
  <div class="idx-voice-tabs">
    <button data-tab="all">全部</button>
    <button data-tab="男声">男声</button>
    <button data-tab="女声">女声</button>
    <button data-tab="旁白">旁白</button>
    <button data-tab="情绪">情绪</button>
  </div>
  <div class="idx-voice-grid"><!-- 分页 --></div>
  <div class="idx-pager">[上一页] [下一页]</div>
</div>
```

数据迁移:旧的 `roleVoicesText` 是纯文本,新逻辑用 `cfg.roleVoiceList = [{role:"我", voice:"高圆圆"}, ...]`。
保留 `roleVoicesText` 反向序列化以便兼容已有用户的旧配置。


### 6.2 第二次流式失败排查 [待 console 错误]

新加的 `[step:...]` 错误前缀已经在 `streamWavViaWebAudio` 里铺好,等用户复现后把
`❌ Web Audio 错误: [step:???]` 报回来就能定位是 fetch/reader/decode/start 哪步炸。

### 6.3 settings.local.json allowlist

我重写过 `.claude/settings.local.json` 加了一批常用命令,但环境有时会回滚到旧版本。
完整想要的 allowlist:

```json
{
  "permissions": {
    "allow": [
      "Bash(nvidia-smi *)",
      "Bash(D:/apiWorkSpace/index-tts2-vLLM/indextts2runtime/python.exe *)",
      "PowerShell(Test-Path *)",
      "PowerShell(Stop-Process *)",
      "PowerShell(Get-Process *)",
      "PowerShell(Get-ScheduledTask *)",
      "PowerShell(Disable-ScheduledTask *)",
      "PowerShell(Start-Process *)",
      "PowerShell(Remove-Item *)",
      "PowerShell(Get-Content *)",
      "PowerShell(Start-Sleep *)",
      "Bash(curl.exe --noproxy \"*\" *)",
      "Bash(HTTP_PROXY=http://127.0.0.1:7897 HTTPS_PROXY=http://127.0.0.1:7897 curl *)",
      "Bash(curl.exe *)",
      "Bash(curl *)",
      "Bash(node --check *)",
      "Bash(python *)",
      "Bash(echo *)", "Bash(ls *)", "Bash(netstat *)", "Bash(taskkill *)",
      "Bash(findstr *)", "Bash(awk *)", "Bash(grep *)", "Bash(head *)",
      "Bash(tail *)", "Bash(wc *)", "Bash(sort *)", "Bash(uniq *)",
      "Bash(tee *)", "Bash(date *)", "Bash(sleep *)", "Bash(file *)",
      "Bash(stat *)",
      "Read(//tmp/**)",
      "Read(D:\\apiWorkSpace\\**)",
      "WebFetch(domain:docs.volink.org)",
      "WebFetch(domain:api.volink.org)",
      "WebFetch(domain:volink.org)",
      "WebSearch"
    ]
  }
}
```

---

## 7. 已知小问题

- BigVGAN custom CUDA kernel 需要 Ninja 才能编译加载,当前是 fallback 到 torch 实现(慢一点)。
  装一下:`.\indextts2runtime\python.exe -m pip install ninja`
- AsyncLLM.__del__ 在退出时打 `TypeError: 'NoneType' object is not callable`,vLLM 自身的
  cleanup 顺序问题,不影响功能
- 仓库根目录有一个误提交的 `.codex_dispatch_voice_library.log`(4015 行 codex 调度日志),`static/` 下有一个 `tavo (2).js` 副本文件 —— 都是 `20719b0` 顺带带进来的,接手时清掉并把 log 加进 `.gitignore`。

---

## 8. 关键文件清单(变更面)

```
indextts2_api.py             核心,后端所有端点 + LIVE_JOBS pubsub
static/tavo.js               前端 player + 字幕 + Web Audio + 持久化
indextts/llm_proxy.py        role 别名归一 + stream:false
indextts/infer_vllm_v2.py    soft-clip + 旁白微情绪 + ref 温柔归一化
Leon_api/dev_tools/          测试 payload + 自测脚本 + restart 日志
prompts/library/             音色库(动态扫描,放新 mp3 直接生效)
outputs/cache/<sha1>.wav     dialogue snapshot 持久缓存
outputs/cache/<sha1>.json    snapshot 元数据(含 segments_meta)
```

---

## 9. 下次接手快速验证

```powershell
# 1) 起服务
.\indextts2runtime\python.exe indextts2_api.py -a 0.0.0.0 -p 9880

# 2) 健康
curl.exe --noproxy "*" -s http://127.0.0.1:9880/health
# → {"status":"ok"}

# 3) 端到端
curl.exe --noproxy "*" -s -X POST http://127.0.0.1:9880/tts_dialogue_stream_job `
  -H "Content-Type: application/json" `
  --data-binary "@Leon_api/dev_tools/selftest_payload.json"
# → {"cache_key": "...", "url": "...", "cache_url": "...", "cached": false, "live": false}

# 4) 等几秒后(看 Leon_api/dev_tools/restart_test.log 里 >> RTF 出现就行)
curl.exe --noproxy "*" -s http://127.0.0.1:9880/cache_audio/<cache_key> -o test.wav
# → WAV 文件
```

TAVO 那边正则脚本注入,**改 ?v= 后缀强制刷新**即可拿到最新 `tavo.js`。
