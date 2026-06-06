# TAVO 选择器与正则小白指南 2026-05-25

这份文档只讲 TAVO 页面里怎么接入一条 IndexTTS JS、选择器怎么填、正则什么时候用。它不要求启动 IndexTTS 服务，也不要求调用 TTS 或占用 GPU。

## 1. 一条 JS 放在哪里

先确认 TAVO 已开启高级前端渲染和 JavaScript 支持。否则 HTML 可能能显示，但 `<script>` 不会执行。

推荐放在 TAVO 的可注入 HTML/JS 位置，例如全局自定义 HTML、显示时渲染模板，或一条专门用于挂脚本的固定消息里：

```html
<script src="http://<lan-ip>:9880/static/tavo.js"></script>
```

把 `<lan-ip>` 换成运行 IndexTTS API 那台机器的局域网 IP，例如：

```html
<script src="http://192.168.1.23:9880/static/tavo.js"></script>
```

如果 TAVO 只能通过正则规则把 HTML 注入到消息显示里，可以建一条只处理固定占位符的显示时正则：

```text
消息正文:
[IndexTTS_TAVO_SCRIPT]

Find Regex:
\[IndexTTS_TAVO_SCRIPT\]

Replace With:
<script src="http://192.168.1.23:9880/static/tavo.js"></script>

作用范围:
只放在那条固定占位消息里，或只匹配你明确准备好的占位符。

执行时机:
显示时
```

不要为了注入脚本把每条聊天正文都替换掉。脚本本身会做重复加载保护，但最清楚的做法是只保留一个固定入口。

## 2. 如何确认脚本已经加载

脚本加载成功后，页面右下角会出现 IndexTTS 设置入口。通常是一个悬浮设置按钮，点击后可以打开 `IndexTTS x TAVO 设置` 面板。

也可以打开浏览器开发者工具，看 Console 是否出现：

```text
[IndexTTS_TAVO] ready
```

如果右下角没有设置入口，Console 里也没有 `ready`，优先检查：

- TAVO 的高级前端渲染或 JavaScript 是否启用。
- `<script src="...">` 地址是否写对。
- 浏览器是否能访问 `http://<lan-ip>:9880/static/tavo.js`。
- TAVO 是否把 `<script>` 当普通文本显示了。

## 3. 选择器怎么填

IndexTTS 脚本需要知道三件事：

```text
Chat Container Selector: #chat
Message Selector: .mes
Text Selector: .mes_text
```

这三个默认值来自本仓库的测试页 `static/test.html`，不是所有真实 TAVO 页面的通用答案。

含义如下：

- `#chat`：聊天列表的外层容器。
- `.mes`：每一条消息的外层节点。
- `.mes_text`：每条消息里真正包含正文的节点。

在真实 TAVO 页面里，如果 DOM 结构不同，就要按页面实际元素改。最简单的确认方法：

1. 在浏览器里打开 TAVO 聊天页。
2. 按 `F12` 打开开发者工具。
3. 用元素选择工具点一条已经显示出来的消息。
4. 找到聊天容器、单条消息、消息正文三个层级。
5. 选择稳定的 CSS selector 填到 IndexTTS 设置面板。

可以在 Console 里用下面几行做轻量检查：

```js
document.querySelector('#chat')
document.querySelectorAll('.mes').length
document.querySelector('.mes .mes_text')?.innerText
```

如果第一行是 `null`，说明聊天容器选择器不对。如果第二行是 `0`，说明消息选择器不对。如果第三行没有正文，说明正文选择器不对。

## 4. 如何确认卡片已经注入

脚本加载并且选择器正确后，每条消息下方会出现一个轻量音频卡。卡片通常包含 `IndexTTS` 标题、播放按钮和简短状态信息。

静态检查时只需要看到卡片出现，不要点击播放按钮。点击播放会开始请求音频，可能触发 TTS 推理和 GPU 占用。

判断顺序：

```text
有右下角设置入口 + Console 有 ready
  -> 脚本加载成功

每条消息下出现轻量音频卡
  -> 选择器基本正确

没有卡片
  -> 优先检查 #chat / .mes / .mes_text 是否适配真实 TAVO DOM
```

## 5. 正则什么时候用

这里有两种正则，作用不同。

TAVO 宿主正则用于把 `<script>` 注入到页面。只有当 TAVO 没有直接的 JS 注入位置时，才需要用它做入口。

IndexTTS 设置面板里的“本地正则”用于决定一条消息里哪部分拿去朗读。默认规则是：

```text
\[TTS\]([\s\S]*?)\[/TTS\]
<tts>([\s\S]*?)</tts>
```

对应消息示例：

```text
[TTS]这段会被朗读。[/TTS]
```

```html
<tts>这段也会被朗读。</tts>
```

规则命中时，脚本使用第一个捕获组作为朗读正文。也就是括号 `(...)` 里面捕获到的内容。

如果本地正则不命中，脚本会朗读整条消息正文。因此：

- 只想读整条消息：不用改本地正则。
- 只想读标签里的部分：让模型输出 `[TTS]...[/TTS]` 或 `<tts>...</tts>`。
- 想排除注释、状态栏、系统标记：用本地正则只捕获需要朗读的正文。
- 不确定怎么写：先保留默认两条规则。

## 6. 常见问题

### 右下角没有设置入口

通常是 AR/JS 未启用，或 `<script>` 没有真正执行。先看 TAVO 是否开启高级前端渲染和 JavaScript，再看 Console 里有没有 `[IndexTTS_TAVO] ready`。

### Console 有 ready，但消息下没有音频卡

通常是选择器不对。默认的 `#chat`、`.mes`、`.mes_text` 只是测试页默认值，真实 TAVO 可能不是这个 DOM。用开发者工具重新确认聊天容器、消息节点和正文节点。

### 点卡片后提示 API Base 不通

`API Base` 要填 IndexTTS API 的基础地址，例如：

```text
http://192.168.1.23:9880
```

不要填到 `/static/tavo.js`，也不要填到 `/tts_stream`。如果 TAVO 在另一台设备上，`127.0.0.1` 指的是那台设备自己，通常应该改用运行服务机器的局域网 IP。

### 点卡片后提示 default 音色没填

单段播放需要默认音色。打开右下角设置面板，在 `默认音色 (default)` 里填一个音色库名字或可用音频路径，例如：

```text
narrator
```

角色映射里也建议保留：

```text
default=narrator
narrator=narrator
```

### LLM key 不填能不能用

能。LLM 只是可选的多角色解析能力。LLM key 不填时，仍然可以单段播放，脚本会把消息作为普通文本，用 `default` 音色朗读。

如果想让脚本自动拆成旁白、角色台词和情绪，再填写 LLM endpoint、model 和 API key。

## 7. 静态检查边界

本文档对应的是静态接入检查，边界如下：

允许检查：

- 文档里的 `<script>` 写法是否正确。
- TAVO 是否开启 AR/JS。
- 右下角是否出现设置入口。
- Console 是否出现 `[IndexTTS_TAVO] ready`。
- 每条消息下方是否出现轻量音频卡。
- 选择器和本地正则配置是否符合页面结构。

不要做：

- 不启动 IndexTTS API 服务。
- 不启动 WebUI。
- 不调用 `/tts_stream`、`/tts_cache_stream`、`/tts_dialogue_stream` 或 `/tts_dialogue_cache_stream`。
- 不点击音频卡播放按钮来验证声音。
- 不批量生成测试音频。
- 不做任何需要 TTS 推理或 GPU 的验证。

如果服务没有启动，浏览器自然无法真正拉取 `/static/tavo.js`，这只说明当前环境没有运行静态文件服务，不代表 TTS 接入逻辑错误。真正播放验证留到用户明确准备好 API 服务和音色之后再做。
