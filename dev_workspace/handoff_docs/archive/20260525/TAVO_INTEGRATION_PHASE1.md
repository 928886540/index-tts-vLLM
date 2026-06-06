# TAVO 接入 Phase 1:流式播放最小可用版

最后更新:2026-05-25
作者:Claude (Opus 4.7, 1M context),分支 `VLLM-tavo-api`
配套修改文件:`indextts2_api.py`

## 范围

**只做一件事:TAVO 通过正则注入 `<audio>`,从 LAN 拉本机 IndexTTS 流式播放。**

明确不做(后续阶段):
- Phase 2:多角色对话 + 行级情感
- Phase 3:音色库 HTTP 管理、emo_text 推断、可调情感向量、参数预设

## 端点

### `GET /tts_stream` (主用,给 TAVO)

| 参数 | 类型 | 默认 | 说明 |
|---|---|---|---|
| `text` | string | (必填) | 要合成的文本,URL 编码 |
| `ref_audio_path` | string | (必填) | 参考音色 wav 的本地绝对路径(从 API 进程的视角) |
| `emo_text` | string | None | 情感描述文本(留空走音色自带情感) |
| `emo_ref_audio_path` | string | None | 情感参考音频 |
| `top_k` | int | 30 | 采样 |
| `top_p` | float | 0.8 | 采样 |
| `temperature` | float | 0.8 | 采样 |
| `emo_alpha` | float | 0.7 | 情感强度 |
| `repetition_penalty` | float | 10 | 防重复 |

**返回:** `audio/wav`,chunked transfer-encoding。第一段合成完就开始吐字节。HTML5 `<audio>` 直接吃。

### `POST /tts_stream` (一样,接受 JSON body)

### `GET /health`

```json
{"status": "ok"}
```

## 启动(LAN 模式)

默认 bind `127.0.0.1`,**TAVO 拉不到**。要么改启动 bat,要么手动:

```powershell
indextts2runtime\python.exe indextts2_api.py --cuda_kernel --fp16 --no_qwen_emo -a 0.0.0.0
```

启动后控制台会打印:

```
IndexTTS API listening on http://<all>:9880
  - GET/POST /tts          (one-shot, returns full WAV)
  - GET/POST /tts_stream   (streaming WAV chunks, for TAVO regex)
  - GET      /health       (liveness probe)
```

> 用户的 `go-API-VLLM-NoQwen.bat` 在 `.gitignore` 里(`*.bat`),没改。
> 自己加 `-a 0.0.0.0`,或者用命令行直接跑。

查本机 LAN IP:

```powershell
ipconfig | findstr IPv4
```

TAVO 端使用 `http://<LAN-IP>:9880/...`。

## curl 自测(先验证端到端通)

```powershell
curl.exe -N "http://127.0.0.1:9880/tts_stream?text=你好,这是流式测试&ref_audio_path=D:/apiWorkSpace/index-tts2-vLLM/音色参考音频/voice.wav" -o test_stream.wav
```

- `-N` 关闭 buffer,让 curl 实时拿 chunk
- 跑完用任意播放器打开 `test_stream.wav`,听得到声音就通了
- 如果听到了但有"咔哒"或截断,可能是 WAV header 的 size 字段问题,告诉我换 MP3 编码

## 健康检查

```powershell
curl.exe http://127.0.0.1:9880/health
# {"status":"ok"}
```

## TAVO 正则示例

假设服务在 `<LAN-IP>:9880`,音色文件在 `D:/voices/girl.wav`。

### 简单触发(`[TTS]文本[/TTS]` 转音频块)

```
Find:    /\[TTS\](.+?)\[\/TTS\]/g
Replace: <audio controls autoplay src="http://<LAN-IP>:9880/tts_stream?text=$1&ref_audio_path=D:/voices/girl.wav"></audio>
```

> 注意:`$1` 里如果有 `&`、`#`、空格等,TAVO 自己得做 URL 编码。否则会被截断。

### 切音色变体(双音色,同一段文本)

```
Find:    /\[A\](.+?)\[\/A\]/g
Replace: <audio controls autoplay src="http://<LAN-IP>:9880/tts_stream?text=$1&ref_audio_path=D:/voices/A.wav"></audio>

Find:    /\[B\](.+?)\[\/B\]/g
Replace: <audio controls autoplay src="http://<LAN-IP>:9880/tts_stream?text=$1&ref_audio_path=D:/voices/B.wav"></audio>
```

> 真正的"一段对话多音色"留到 Phase 2 在服务端做(`/tts_dialogue_stream`),
> Phase 1 这种正则做法是把每个角色一段一段拆开,各自起一个 `<audio>`。

## 浏览器/纯 HTML 自测页

把下面这段存成 `test.html`,改 IP 和 ref_audio_path,双击打开:

```html
<!DOCTYPE html>
<html lang="zh">
<body>
  <h1>IndexTTS Stream Test</h1>
  <audio controls autoplay
         src="http://<LAN-IP>:9880/tts_stream?text=测试一下流式播放是否能用,这句话再长一点看看分段效果如何。&ref_audio_path=D:/voices/girl.wav">
  </audio>
</body>
</html>
```

期望:点开页面 → 几秒内就开始有声音(不是等几十秒整段生成完才响)。

## 已知限制(Phase 1 接受)

1. **并发串行化**:多个 `/tts_stream` 请求**排队**,不并发。因为 IndexTTS2 实例的 cache 是共享的,并发 infer 会互相覆盖。后续如果要并发,要么开多进程,要么改成无状态调用。
2. **WAV 格式**:用了 `size=0xFFFFFFFF` 的 "unknown length" 技巧。Chrome / Firefox / Edge 都接受,但有些移动端播放器或非常老的播放器可能会拒绝。如果遇到,Phase 1.5 加 MP3 编码。
3. **客户端断开**:目前断开后 infer 仍会跑完(没接 `stop_generation_callback`),只是不会再被消费。下次有需要再优化。
4. **没有 mp3/opus**:只发 PCM WAV。压缩格式留给后面。
5. **没有 CORS header**:目前 TAVO 应该是同源/允许跨域。如果遇到浏览器拦截,要给 FastAPI 加 `CORSMiddleware`。

## 关于参考音频路径

`ref_audio_path` 是 **API 进程能看到的路径**,不是 TAVO 客户端的路径。
- 服务跑在 Windows 上:用 `D:/...` 或 `D:\\...`
- 跨机调用:得是 API 服务器本机能访问的路径

后续 Phase 3 会做音色库 HTTP 端点(`/voices`),那时候只用传"音色名"不用传路径。

## 集成验证清单

- [ ] API 启动正常,控制台打印 3 个端点
- [ ] `/health` 200
- [ ] curl 流式拉取产生 `test_stream.wav`,长度合理(不是 0KB,不是几 GB)
- [ ] `test_stream.wav` 用播放器能听
- [ ] HTML5 `<audio>` 在浏览器里能播,**第一段响起来明显早于全部生成完**(否则不算流式)
- [ ] TAVO 端正则替换后,聊天里能正常播

## 给 Codex 的不要做清单

- 不要改 `indextts2_api.py` 我新增的 `tts_stream_*` 相关函数和端点 —— 那是 P1 TAVO 链路,我会持续维护
- 你继续管 `infer_vllm_v2.py` 的 `stream_chunk_callback` 接口 —— 如果接口要改,提前在 `HANDOFF_WORK_SUMMARY_*.md` 告诉我,我同步适配
- `pack_wav` 是 `/tts` 用的,与 `/tts_stream` 无关,你想动随意

## 给 Claude(下次的自己)的不要做清单

- 不要改 `webui.py`、`indextts/infer_vllm_v2.py`、`indextts/s2mel/modules/flow_matching.py` —— 这些是 Codex 的主战场
- 流式参数(`STREAM_TARGET_SEGMENT_TOKENS` 之类)是 Codex 调好的,不要在 API 端覆盖
- 暂时不要加多角色/音色库 —— P1 范围内禁止 scope creep
