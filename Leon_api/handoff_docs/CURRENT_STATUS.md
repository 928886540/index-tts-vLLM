# IndexTTS × TAVO 当前进度交接（2026-05-25）

## 当前结论

正式开发目录已经从隐藏 `.claude` 迁回主仓库。`Leon_api/` 只作为协作、交接、测试夹具目录；最终给小白用户打包时不包含 `Leon_api/`。

当前主分支 `VLLM` 已经具备：

- `indextts2_api.py`：正式 API 入口，端口默认 `9880`。
- `static/tavo.js`：TAVO 消息内中文播放器脚本。
- `indextts/voice_library.py`：本地音色库，读取 `prompts/library/`。
- `indextts/snapshot_cache.py`：本地音频快照缓存。
- `indextts/profile_store.py`：轻量 SQLite profile/usage 存储。
- `indextts/llm_proxy.py`：可选 OpenAI-compatible LLM 解析代理。

## API 端口

默认端口：`9880`

局域网或 Cloudflare tunnel 访问时，服务应绑定：

```powershell
python indextts2_api.py -a 0.0.0.0 -p 9880
```

你的域名规则当前应指向：

```text
https://index-tts.928886540.xyz -> http://localhost:9880
```

`tavo.js` 入口（当前建议带版本号，避免手机/TAVO 缓存旧脚本）：

```text
https://index-tts.928886540.xyz/static/tavo.js?v=20260525-fix3
```

当前已确认域名可访问，并且响应头已关闭缓存：

```text
Cache-Control: no-store, no-cache, must-revalidate, max-age=0
cf-cache-status: BYPASS
```

## TAVO 上如何接入测试

TAVO 不是打开 `tavo.js` 页面。正确方式是：用显示时正则把脚本追加到角色消息里，脚本会在当前消息下面渲染播放器。

### 推荐正则

Find Regex:

```text
([\s\S]+)
```

Replace With:

```text
$1
<script src="https://index-tts.928886540.xyz/static/tavo.js?v=20260525-fix3"></script>
```

配置项：

```text
作用范围：角色消息 / assistant 消息
执行时机：显示时
替换参数：原文替换 / raw HTML
```

TAVO 需要打开高级渲染和 JavaScript 执行。

## 当前 TAVO UI 行为

`static/tavo.js` 当前行为：

- 不悬浮。
- 不打开独立页面。
- 在当前 TAVO 消息内直接插入轻量播放器卡片。
- 第一屏就是播放器：头像/封面圆盘、进度条、上一首、播放/暂停、下一首、音符生成、删除当前音频。
- 如果还没有生成过音频，播放按钮会提示先点音符生成。
- 右上角齿轮打开设置面板；设置面板现在覆盖播放器，避免用户一边改设置一边误按播放/生成。
- 点“保存”后会保存并自动关闭设置面板。
- 播放器大圆角；空错误框已隐藏，不再出现底部红色空边框。
- UI 全中文。
- 音色以卡片形式展示，点击音色卡会调用 `/voice_preview` 试听。
- 点击播放时才请求后端生成音频，属于懒加载。
- 服务端 `/tts_cache_stream` 和 `/tts_dialogue_cache_stream` 会做快照缓存，重复文本/参数命中时直接读缓存。
- 当前角色头像优先通过 TAVO API 读取：
  `tavo.message.current()` -> `tavo.character.get(msg.characterId)` -> `character.avatar`。
  读不到时再从 DOM 头像兜底。

## 音色库

音色库目录：

```text
prompts/library/
```

支持扩展名：

```text
.wav .mp3 .flac .ogg .m4a
```

`/voices` 会列出这里的文件。前端播放器会自动读取音色列表；默认选第一个音色。

## 2026-05-25 晚间修复

- 修复前端 `.idx-hidden` 只对设置面板生效的问题；空错误框不再显示红边。
- 设置页从下方展开改为播放器内覆盖层。
- 播放器外层圆角从 8px 调整到 18px。
- 修复后端 `_chunk_to_pcm_bytes()` 二次放大 vLLM int16 音频的问题；这是“爆音/削顶”的主要原因。
- 当前服务已重启，PID `10680`，监听 `0.0.0.0:9880`。

## 多角色和情绪

单音色模式：

- 不需要 LLM。
- 当前消息全文用一个默认音色朗读。
- 遵循 NoQwen 建议，不使用情绪提示文本；当前请求会传 `emo_text: ""`，避免 FastAPI 422。

AI 八情绪多角色模式：

- 可选配置，用户不填第三方 LLM 就不会启用。
- 用户填自己的 OpenAI-compatible endpoint、model、key。
- 后端 `/parse_text` 代调第三方 LLM。
- LLM 输出 `segments`：`role/text/emo_vec`，其中 `emo_vec` 固定 8 个 0-1 数值。
- 旁白 role 固定为 `narrator`；人物台词 role 使用人物名。
- 后端 `/tts_dialogue_cache_stream` 按 role 映射音色并生成整段音频。

角色音色映射格式：

```text
narrator=旁白音色
李明=男声音色
小雨=女声音色
```

没有映射到的 role 使用默认音色。

## 已验证

已跑静态检查：

```powershell
node --check static\tavo.js
python -m py_compile indextts2_api.py indextts\llm_proxy.py indextts\voice_library.py indextts\snapshot_cache.py indextts\profile_store.py
git diff --check -- static/tavo.js indextts2_api.py
```

均通过。

额外验证：

```powershell
curl.exe --noproxy "*" -s http://127.0.0.1:9880/voices
curl.exe --noproxy "*" -s -D - "http://127.0.0.1:9880/voice_preview?name=高圆圆" -o NUL
```

`/voices` 能返回 5 个本地音色；`/voice_preview` GET 返回 `200 OK` 和 `audio/mpeg`。

当前服务状态：

```text
http://127.0.0.1:9880/server_info -> ok
http://127.0.0.1:9880/voices -> 返回 5 个音色
https://index-tts.928886540.xyz/static/tavo.js?v=20260525-fix3 -> 200 OK
```

用户截图里出现过“生成失败”。当前前端会直接显示错误正文；如果再次失败，重点排查：

- `/tts_cache_stream` 是否返回 422/500。
- TAVO 页面跨域请求是否被拦。
- 请求体里的默认音色是否为空或不是 `/voices` 返回的音色名。
- 当前消息正文是否被正则替换后读成空文本。

## 下一步建议

1. 在 TAVO 角色消息显示时正则中追加 `?v=20260525-fix3` 脚本。
2. 用一条很短的消息点音符生成，确认 `/tts_cache_stream` 能成功返回音频。
3. 如果仍“生成失败”，先把前端错误正文显示到播放器里，减少盲测。
4. 再打开 AI 八情绪多角色，测试旁白和人物不同音色。
5. 对手机 TAVO 实机做 UI 尺寸微调。

## 注意事项

- 不要提交 `音色参考音频/`。
- 不要提交 `prompts/history/` 生成历史。
- 如需打包默认音色，只提交 `prompts/library/*.mp3`。
- `Leon_api/` 是协作目录，不进入最终发包。
- 不要恢复 `.claude/` 到正式仓库。
