# TAVO 快速接入草稿

目标: 小白只做一次本地启动，再在 TAVO 里引入一条 JS。

## 1. 启动 IndexTTS API

使用现有启动脚本启动本地 API。给 TAVO 局域网浏览器访问时，服务需要绑定到 `0.0.0.0`，端口默认 `9880`。

启动后终端会显示这些接口:

- `/tts_stream`: 单段流式
- `/tts_cache_stream`: 单段流式 + 本地快照缓存
- `/tts_dialogue_stream`: 多角色 + 情绪流式
- `/tts_dialogue_cache_stream`: 多角色 + 情绪流式 + 本地快照缓存
- `/voices`: 本地音色库
- `/cache`: 本地快照缓存管理
- `/static/tavo.js`: TAVO 单文件桥接脚本

## 2. 准备音色

推荐把参考音频放到本地音色库:

```text
prompts/library/
  narrator.wav
  alice.wav
  bob.wav
```

也可以通过 `/voices` 接口保存音色。当前阶段不需要 MySQL，不需要 SQLite，音色库就是本地文件夹。

## 3. 在 TAVO 里引入一条 JS

把下面这一行放到 TAVO 可注入 HTML/JS 的位置，IP 换成本机局域网 IP:

```html
<script src="http://192.168.x.x:9880/static/tavo.js"></script>
```

脚本会自动把 API Base 设成这个 `script src` 的来源。页面右下角会出现 IndexTTS 设置按钮。

## 4. 设置项

基础设置:
- `API Base URL`: 通常自动填好。
- `Chat 容器选择器`: TAVO 聊天列表容器，默认 `#chat`。
- `单条消息选择器`: 默认 `.mes`。
- `消息文本选择器`: 默认 `.mes_text`。

音色设置:

```text
default=narrator
narrator=narrator
小明=alice
小红=bob
```

值可以是 `prompts/library` 里的音色名，也可以是直接文件路径。

正则设置:

```text
\[TTS\]([\s\S]*?)\[/TTS\]
<tts>([\s\S]*?)</tts>
```

命中第一个捕获组时只朗读捕获组内容；不命中时朗读整条消息。

## 5. 可选 LLM 解析

打开“启用第三方 LLM 解析多角色/情绪”，填写 OpenAI-compatible endpoint、model、API key。

LLM 输出会被解析成:

```json
{
  "segments": [
    {"role": "narrator", "text": "旁白正文", "emo_vec": [0,0,0,0,0,0,0,0.3]},
    {"role": "小明", "text": "人物台词", "emo_text": "压低声音, 带着喘息"}
  ]
}
```

不开 LLM 时，默认按单段 `default` 音色朗读。

## 6. 快照与懒加载

默认启用快照缓存:

- 第一次点击播放时生成音频，并写入 `outputs/cache/<sha1>.wav`。
- 下次同样的文本、音色、情感和参数会直接复用本地 WAV。
- `<audio preload="none">` 保持懒加载，消息很多时不会预先请求所有音频。

## 7. 配置预设

设置面板里的“配置预设/Profile”可以把当前配置保存到本地 SQLite:

- 保存内容包括 API 地址、选择器、正则、音色映射、LLM endpoint/model/prompt、TTS 参数。
- 不保存明文 LLM API key；key 仍只留在当前浏览器 localStorage。
- 这是可选功能，不影响默认 TTS 主链路。

## 8. 当前限制

- 轻量音频卡已具备基础播放、状态、mini progress；完整播放器懒加载还没做。
- LLM 目前按 OpenAI-compatible chat completions 实现；Anthropic/Gemini 原生协议还没单独适配。
- 这份文档是草稿，等第一次真实联调后再整理成最终用户文档。
