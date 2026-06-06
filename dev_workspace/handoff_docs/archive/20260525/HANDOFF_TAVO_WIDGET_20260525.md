# HANDOFF_TAVO_WIDGET_20260525

Date: 2026-05-25
Worktree: `D:\apiWorkSpace\index-tts2-vLLM\.claude\worktrees\tavo-api`
Branch: `VLLM-tavo-api`
Service: IndexTTS API is currently running on `0.0.0.0:9880` from this worktree, using model files from `D:\apiWorkSpace\index-tts2-vLLM\checkpoints`.

## User Intent

The user does **not** want a floating microphone button or a separate page/iframe as the primary TAVO UI.

They want the same interaction model as the existing ComfyUI Xiaomi TTS TAVO widget:

- TAVO display-time regex injects one script into a rendered message.
- The script immediately renders a visible inline audio player inside that message.
- The first visible thing must be a player card, not a settings button.
- The player card must be Chinese UI.
- Settings must be inline/collapsible inside the card, not a floating page.
- Playback must be obvious: a play button on the card starts generation/playback.
- The card should use TAVO context: `tavo.message.current()` for current rendered message and `tavo.chat.current()` later for role/character mapping.

Correct TAVO regex mental model:

```text
TAVO message render -> display-time regex appends/replaces HTML -> <script src=".../static/tavo.js"> executes in that rendered message context -> JS mounts inline widget near current script.
```

Do **not** treat `/static/tavo.js` as a page. Opening the JS URL only shows source. The UI appears only when TAVO AR/JS executes it inside a message.

## Current Runtime / URLs

Local service checks passed:

```text
http://127.0.0.1:9880/static/tavo.js -> 200
http://127.0.0.1:9880/health -> {"status":"ok"}
```

Domain tunnel was restarted via scheduled task `CF Tunnel`, and the user later reported the JS URL became accessible:

```text
<public-host>/static/tavo.js
```

Use cache busting in TAVO regex while iterating:

```html
<script src="<public-host>/static/tavo.js?v=20260525xx"></script>
```

## Current Code State

`static/tavo.js` is modified and **not committed**.

Important status:

- `node --check static\tavo.js` passes.
- `static/tavo.js` has large uncommitted edits.
- `logs/` is untracked and should **not** be committed.
- No final commit has been made for the inline widget changes.

Current `git status`:

```text
## VLLM-tavo-api...userrepo/VLLM-tavo-api
 M static/tavo.js
?? logs/
```

Current diff size at handoff:

```text
static/tavo.js | 777 changed, 237 insertions, 540 deletions
```

## What Was Attempted

A wrong direction was tried first:

- Added a `tavo_panel.html` iframe-style panel.
- Added a floating/launcher style UI.
- This was rejected by user and is conceptually wrong for TAVO primary use.

That `static/tavo_panel.html` file has been removed from the working tree and should remain removed unless repurposed only as a standalone diagnostic page.

Then `static/tavo.js` was partially redirected toward the correct inline widget model:

- Added `LOADER_SCRIPT = document.currentScript` to remember the injected script element.
- Added `mountInlineWidget(scriptEl)` to mount UI into the script's parent message container.
- Added `getTavoCurrentMessageText(host)` to prefer `await tavo.message.current()` and fallback to DOM text.
- Added `buildInlineSettings(card, host)` for inline settings below the player.
- Removed the large old floating settings implementation block.
- `buildUi()` / `renderPanel()` are now gone.
- `node --check` passes.

## Known Problems To Fix Next

The current `static/tavo.js` is not final. Fix these before commit:

1. Remove all remaining floating/observer assumptions.

Current grep shows leftovers:

```text
startObserver() still exists
init() still calls startObserver()
setConfig/rescan still call startObserver()
```

For primary TAVO regex widget, avoid scanning the whole chat DOM. The script should mount only into the current message/script host.

2. Remove duplicate settings insertion.

Current grep shows:

```text
card.body.appendChild(buildInlineSettings(card, msgEl))
root.appendChild(buildInlineSettings(card, host))
```

Keep only the settings block attached to the inline root under the player, created once at mount time. Do not append settings into `card.body` after audio generation.

3. The top row currently has buttons `设置 / 检查 / 刷新` above the player.

User wants an obvious player first. Better layout:

```text
[ large round Play button ]  语音朗读
                              未生成 / 生成中 / 播放中
                              mini progress 00:00 --:--
[ reload ] [ 设置 ] maybe small icon/button
[ collapsed inline settings details ]
```

Use the existing `buildAudioCard()` as the player, but make it visually primary. The extra top header should be compact or removed.

4. Settings must be fully Chinese and inline.

Keep the minimum first:

- 服务地址
- 默认音色
- 角色音色映射
- 启用快照缓存
- 启用多角色解析
- 解析方式
- 第三方接口地址
- 第三方 API 密钥
- 保存设置

Avoid Profile/cache management in the first inline pass. Those can be advanced later.

5. Playback source text must be clear.

Use:

```js
await tavo.message.current()
```

If current message content includes only `[IndexTTS_TAVO_SCRIPT]`, user needs guidance: normally the script should be injected into assistant messages containing actual content, or the regex should append script to message content rather than replacing the whole message. This is important.

Recommended TAVO regex for real use should append script to every assistant message, not replace the message with a sentinel-only card, for example:

```text
Find Regex:
([\s\S]+)

Replace With:
$1
<script src="<public-host>/static/tavo.js?v=2026052502"></script>
```

Scope: role/assistant messages only.
Timing: display-time.
Replacement mode: raw/original HTML replacement.

For a manual test sentinel, the message only contains the sentinel, so there is no story text to read. The widget can still show, but playback will say no readable text unless there is surrounding content.

6. Do not use iframe as primary widget.

If a standalone diagnostics page is desired later, create `static/diagnostics.html`, but keep it separate from the TAVO injected player.

## Current Suggested Patch Direction

In `static/tavo.js`:

1. Keep:

```js
const LOADER_SCRIPT = document.currentScript;
mountInlineWidget(scriptEl)
getTavoCurrentMessageText(host)
buildInlineSettings(card, host)
buildAudioCard()
playForMessage(...)
```

2. Delete or ignore for primary path:

```js
startObserver()
injectMessageButton() for whole-chat scanning
observer cleanup logic
any floating gear/panel remnants
```

`injectMessageButton()` can stay only if you still want the standalone `static/test.html` chat DOM mode, but do not call it in TAVO regex path.

3. Change `init()` to:

```js
function init() {
  mountInlineWidget(LOADER_SCRIPT);
  console.info('[IndexTTS_TAVO] 已加载');
}
```

4. Change API object:

```js
window.IndexTTS_TAVO = {
  init,
  getConfig: () => clonePlain(cfg),
  setConfig: (patch) => { mergeDeep(cfg, patch); saveConfig(cfg); },
  mountInline: (scriptEl) => mountInlineWidget(scriptEl),
};
```

5. Ensure repeated script injections still mount per message.

Current singleton guard should call `window.IndexTTS_TAVO.mountInline(LOADER_SCRIPT)` when the global already exists. That is correct because TAVO may execute the same external script in many message render contexts.

## TAVO Regex Usage To Tell User After Fix

Primary real-use regex should append script to assistant message content:

```text
Find Regex:
([\s\S]+)

Replace With:
$1
<script src="<public-host>/static/tavo.js?v=2026052502"></script>
```

Settings:

```text
作用范围：角色消息 / assistant 消息
执行时机：显示时
替换参数：原文替换 / raw HTML
```

Do not globally apply to user/system messages at first.

For a fixed placeholder test only:

```text
Find Regex:
\[IndexTTS_TAVO_SCRIPT\]

Replace With:
<script src="<public-host>/static/tavo.js?v=2026052502"></script>
```

But this only tests whether UI renders. It does not provide readable story text unless the same message contains story content.

## Validation Commands

Use only static checks unless user explicitly asks to generate audio:

```powershell
cd D:\apiWorkSpace\index-tts2-vLLM\.claude\worktrees\tavo-api
node --check static\tavo.js
git diff --check
curl.exe --noproxy "*" -I http://127.0.0.1:9880/static/tavo.js
```

Do not commit `logs/`.

When ready:

```powershell
git add static/tavo.js HANDOFF_TAVO_WIDGET_20260525.md
git commit -m "[codex] Add inline TAVO player widget handoff"
git push origin VLLM-tavo-api
git push userrepo VLLM-tavo-api
```

## Service Process Info

IndexTTS service was started earlier:

```text
API process PID: 9724
vLLM child PID: 14356
Port: 9880
```

It uses GPU while running.

Do not kill it unless user asks.

## User Frustration Context

The user is upset because they expected a working visible player like the ComfyUI Xiaomi TTS widget, not a hidden/floating settings entry. Do not explain too much. Fix the UI path first, then give exact TAVO regex usage.
