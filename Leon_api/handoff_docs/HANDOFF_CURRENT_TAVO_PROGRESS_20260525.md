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

`tavo.js` 入口：

```text
https://index-tts.928886540.xyz/static/tavo.js?v=20260525
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
<script src="https://index-tts.928886540.xyz/static/tavo.js?v=20260525"></script>
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
- 在当前 TAVO 消息内直接插入播放器卡片。
- 第一屏就是播放器：播放按钮、状态、进度、重新生成、停止。
- `语音设置` 折叠在播放器下方。
- UI 全中文。
- 点击播放时才请求后端生成音频，属于懒加载。
- 服务端 `/tts_cache_stream` 和 `/tts_dialogue_cache_stream` 会做快照缓存，重复文本/参数命中时直接读缓存。

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

## 多角色和情绪

单音色模式：

- 不需要 LLM。
- 当前消息全文用一个默认音色朗读。
- 会传 `emo_text`，用于情绪/呼吸感提示。

多角色模式：

- 可打开 `LLM 解析`。
- 用户填自己的 OpenAI-compatible endpoint、model、key。
- 后端 `/parse_text` 代调第三方 LLM。
- LLM 输出 `segments`：`role/text/emo_vec/emo_text`。
- 后端 `/tts_dialogue_cache_stream` 按 role 映射音色并生成整段音频。

角色音色映射格式：

```text
旁白=旁白音色
李明=男声音色
小雨=女声音色
```

没有映射到的 role 使用默认音色。

## 已验证

已跑静态检查：

```powershell
node --check static\tavo.js
python -m py_compile indextts2_api.py indextts\llm_proxy.py indextts\voice_library.py indextts\snapshot_cache.py indextts\profile_store.py
```

均通过。

未跑真实 TTS 生成前端播放验收，因为这会占用 GPU；用户后面已说 GPU 空出来，可以继续做真实联调。

## 下一步建议

1. 启动服务并确认 `https://index-tts.928886540.xyz/static/tavo.js?v=20260525` 返回最新脚本。
2. 在 TAVO 角色消息显示时正则中追加脚本。
3. 先用单音色播放一条短消息，确认前端能显示播放器并调用 `/tts_cache_stream`。
4. 再打开多角色 + LLM 解析，测试旁白和人物不同音色。
5. 对手机 TAVO 实机做 UI 尺寸微调。

## 注意事项

- 不要提交 `音色参考音频/`。
- `Leon_api/` 是协作目录，不进入最终发包。
- 不要恢复 `.claude/` 到正式仓库。
