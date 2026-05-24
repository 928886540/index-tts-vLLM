# TAVO 轻量接入指南

这份指南面向第一次接入的用户：本地 IndexTTS2 服务由你自己启动，TAVO 里只需要引入一条 JS，然后在设置面板里填少量配置。

本文档只说明接入流程，不要求验证 TTS 效果。不要为了验证去启动或调用 TTS 接口，因为语音生成会占用 GPU。

## 1. 启动前确认

你需要先有一台能访问 IndexTTS2 API 的机器。常见情况是服务跑在局域网内的一台电脑上，端口为 `9880`。

如果 TAVO 在另一台设备的浏览器里打开，IndexTTS2 API 需要能被局域网访问，例如使用本机局域网 IP：

```text
http://<lan-ip>:9880
```

这里的 `<lan-ip>` 换成运行 IndexTTS2 服务那台电脑的局域网 IP，例如 `192.168.1.23`。

## 2. 在 TAVO 里只引入一条 JS

把下面这一行放到 TAVO 可注入 HTML/JS 的位置：

```html
<script src="http://<lan-ip>:9880/static/tavo.js"></script>
```

只需要这一条，不需要再手写其它初始化代码。脚本加载后，TAVO 页面里会出现 IndexTTS 设置入口。

## 3. 推荐设置流程

第一次打开设置面板时，建议按这个顺序填写：

1. 填 `API Base`

   通常会根据 `<script src>` 自动识别成：

   ```text
   http://<lan-ip>:9880
   ```

   如果没有自动填好，就手动填这个地址。

2. 选择或填写默认音色

   默认音色用于旁白、未命中角色映射的消息，以及不开 LLM 解析时的普通朗读。建议先填一个稳定可用的音色，例如：

   ```text
   narrator
   ```

3. 填角色音色映射

   用一行一个 `角色=音色` 的格式：

   ```text
   default=narrator
   narrator=narrator
   小明=male_01
   小红=female_01
   ```

   `default` 是兜底音色，`narrator` 是旁白音色，人物角色也可以分别映射到不同音色。

高级设置可以先不动。选择器、正则、TTS 参数、缓存管理、LLM Prompt 等选项都可以在基础播放跑通后再调整。

## 4. 音色库怎么放

推荐把参考音频放在本地音色库目录：

```text
prompts/library/
  narrator.wav
  male_01.wav
  female_01.wav
```

设置里填写音色时，通常使用文件名去掉 `.wav` 后的名字：

```text
narrator
male_01
female_01
```

旁白 `narrator` 和人物角色可以映射到不同音色。例如旁白用 `narrator.wav`，小明用 `male_01.wav`，小红用 `female_01.wav`。

设置面板里的音色库区域用于查看和选择 `prompts/library/*.wav`。刷新音色库只是在需要时读取本地音色列表，不会生成语音。

## 5. 快照缓存与懒加载

接入脚本使用“点击才处理”的方式：

- 不会在页面加载时预生成大量音频。
- 不会因为历史消息很多就一次性请求所有 TTS。
- 只有你点击某条消息的音频卡时，才会生成音频或读取已有缓存。
- 已生成的音频会按文本、音色、情绪和参数形成快照缓存；下次遇到相同内容时可直接复用。
- 音频元素使用懒加载思路，未点击的卡片不会提前加载完整音频。

设置面板里的快照缓存管理只用于查看、删除或清理本地缓存文件，不代表会自动触发语音生成。

## 6. 可选 LLM 解析

LLM 解析是可选项。不开 LLM 时，会按普通单段文本朗读，并使用默认音色或角色映射音色。

如果你想让模型把消息拆成旁白、人物台词和情绪，可以在设置面板中填写第三方 OpenAI-compatible 配置：

```text
Endpoint: https://your-openai-compatible-endpoint/v1/chat/completions
Model: your-model-name
API Key: your-api-key
```

LLM 需要输出 `segments`，每个片段包含角色和文本，也可以包含情绪参数：

```json
{
  "segments": [
    {
      "role": "narrator",
      "text": "旁白正文",
      "emo_vec": [0, 0, 0, 0, 0, 0, 0, 0.3]
    },
    {
      "role": "小明",
      "text": "人物台词",
      "emo_text": "压低声音，带一点紧张"
    }
  ]
}
```

说明：

- `role` 会用于匹配角色音色映射。
- `emo_vec` 是 8 维情绪向量，即 `emo_vec[8]`。
- `emo_text` 是文字情绪描述。
- `emo_vec` 和 `emo_text` 可以按需要选择使用。

## 7. Profile 配置保存

设置面板里的 Profile 功能是可选的，用于把当前配置保存起来，方便以后切换。

Profile 使用 SQLite 即可，不需要 MySQL。普通接入也可以完全不使用 Profile，不影响基础播放和缓存逻辑。

## 8. 不做 GPU 验证

为了避免占用用户 GPU，本文档不要求也不建议做以下验证：

- 不启动 TTS 服务做演示。
- 不调用 `/tts_stream`、`/tts_cache_stream`、`/tts_dialogue_stream` 或 `/tts_dialogue_cache_stream`。
- 不批量生成测试音频。

文档接入检查只需要确认 TAVO 能加载：

```html
<script src="http://<lan-ip>:9880/static/tavo.js"></script>
```

真实语音生成留给用户在需要时手动点击音频卡触发。

## 9. 相关文档

- `TAVO_SELECTOR_GUIDE_20260525.md`: TAVO 注入位置、选择器和本地正则排查。
- `TAVO_LLM_PROMPT_20260525.md`: 第三方 LLM 输出 `segments`、`emo_vec[8]`、`emo_text` 的提示词模板。
- `TAVO_API_REFERENCE_20260525.md`: 本地 HTTP API 技术参考。
