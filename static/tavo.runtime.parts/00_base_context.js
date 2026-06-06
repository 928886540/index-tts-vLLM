// IndexTTS Tavo runtime part: 00_base_context.js // Role: bootstrap, config constants, Tavo context helpers // This fragment is concatenated by static/tavo.runtime.js; it is not a standalone script.
window.__indextts_tavo_runtime_app_promise = (async function () {
  "use strict";

  var script = (typeof window !== "undefined" && window.__indextts_tavo_runtime_script_override) || document.currentScript;
  var STYLE_ID = "indextts-tavo-player-v5";
  var CONFIG_KEY = "indextts_tavo_config_v3";
  var CONFIG_VERSION = 12;
  var CHAR_SCOPE_CONFIG_KEY = "indextts_tavo_character_config_v1";
  // 角色级配置: defaultVoice + roleVoiceList。LLM/api/mode 参数走全局。
  var CHAR_KEY_PREFIX = "indextts_tavo_character_v1:";
  var GLOBAL_CONFIG_FIELDS = [
    "configVersion",
    "apiBase", "mode", "playbackMode", "endpoint", "dialogueEndpoint", "parseEndpoint",
    "llmEndpoint", "llmModel", "llmApiKey", "reuseLlmParse",
    "intervalMs", "topP", "topK", "temperature", "repetitionPenalty", "emoAlpha", "speedFactor", "qualityMode",
    "offlineAudioEnabled"
  ];
  var RESERVED_ROLES = ["旁白", "用户"];  // 这两个常驻不可删；具体人物用原名或 defaultVoice
  function normalizeModeName(mode) {
    mode = String(mode || "").trim().toLowerCase();
    if (mode === "ai" || mode === "ai8" || mode === "multi" || mode === "multivoice") return "ai";
    return "normal";
  }
  function normalizePlaybackMode(mode) {
    mode = String(mode || "").trim().toLowerCase();
    if (mode === "generate" || mode === "background" || mode === "file") return "generate";
    return "live";
  }
  function normalizeCharacterRoleName(name) {
    return String(name || "").trim();
  }
  function isCharacterPlaceholderRole(role) {
    role = String(role || "").trim();
    return role === "角色" || role === "character" || role === "当前角色";
  }
  function canonicalRoleName(role, characterRoleName, previousCharacterRoleName) {
    role = String(role || "").trim();
    characterRoleName = normalizeCharacterRoleName(characterRoleName);
    previousCharacterRoleName = normalizeCharacterRoleName(previousCharacterRoleName);
    if (characterRoleName && isCharacterPlaceholderRole(role)) return characterRoleName;
    if (characterRoleName && previousCharacterRoleName && role === previousCharacterRoleName) return characterRoleName;
    if (role === "narrator") return "旁白";
    if (role === "你" || role === "user" || role === "User" || role === "我") return "用户";
    return role;
  }
  function voiceForRoleNames(list, names, characterRoleName, previousCharacterRoleName) {
    list = (list && Array.isArray(list)) ? list : [];
    names = names || [];
    for (var i = 0; i < list.length; i++) {
      var rawRole = String((list[i] && list[i].role) || "").trim();
      var role = canonicalRoleName(rawRole, characterRoleName, previousCharacterRoleName);
      if (names.indexOf(role) >= 0 || names.indexOf(rawRole) >= 0) return String((list[i] && list[i].voice) || "");
    }
    return "";
  }
  function normalizeRoleVoiceList(list, characterRoleName, previousCharacterRoleName) {
    list = (list && Array.isArray(list)) ? list.slice() : [];
    function findVoice(names, fallbackIndex) {
      var hit = voiceForRoleNames(list, names, characterRoleName, previousCharacterRoleName);
      return hit || String((list[fallbackIndex] && list[fallbackIndex].voice) || "");
    }
    var reserved = [
      { role: "旁白", voice: findVoice(["旁白", "narrator"], 0) },
      { role: "用户", voice: findVoice(["用户", "你", "user", "我"], 1) },
    ];
    var used = { "旁白": true, "用户": true };
    var extra = [];
    function addExtra(role, voice) {
      role = canonicalRoleName(role, characterRoleName, previousCharacterRoleName);
      voice = String(voice || "").trim();
      if (!role || role === "旁白" || role === "用户") return;
      if (used[role]) {
        for (var i = 0; i < extra.length; i++) {
          if (extra[i].role === role && !extra[i].voice && voice) extra[i].voice = voice;
        }
        return;
      }
      used[role] = true;
      extra.push({ role: role, voice: voice });
    }
    // 后续行:去掉 role + voice 都空的(避免上次会话累积大量空行)。
    // 旧配置里的“角色”只迁移为当前 Tavo 角色名一次；用户删除后不再强塞回来。
    list.forEach(function (r) {
      var role = String((r && r.role) || "").trim();
      var voice = String((r && r.voice) || "").trim();
      if (!role && !voice) return;
      addExtra(role, voice);
    });
    return reserved.concat(extra);
  }
  async function loadCharacterCfg(characterId) {
    if (characterId) {
      try { var rawLocal = localStorage.getItem(CHAR_KEY_PREFIX + characterId); if (rawLocal) return JSON.parse(rawLocal); } catch (_) {}
    }
    try { if (window.tavo && typeof tavo.get === "function") { var cs = await tavo.get(CHAR_SCOPE_CONFIG_KEY, "character"); if (cs) return cs; } } catch (_) {}
    if (!characterId) return null;
    try { if (window.tavo && typeof tavo.get === "function") { var tv = await tavo.get(CHAR_KEY_PREFIX + characterId, "global"); if (tv) return tv; } } catch (_) {}
    try { var raw = localStorage.getItem(CHAR_KEY_PREFIX + characterId); if (raw) return JSON.parse(raw); } catch (_) {}
    return null;
  }
  async function saveCharacterCfg(characterId, partial) {
    try { if (window.tavo && typeof tavo.set === "function") await tavo.set(CHAR_SCOPE_CONFIG_KEY, partial || {}, "character"); } catch (_) {}
    if (!characterId) return;
    try { if (window.tavo && typeof tavo.set === "function") await tavo.set(CHAR_KEY_PREFIX + characterId, partial || {}, "global"); } catch (_) {}
    try { localStorage.setItem(CHAR_KEY_PREFIX + characterId, JSON.stringify(partial || {})); } catch (_) {}
  }

  // ---- Debug overlay (只在测试页或显式 ttsDebug=1 时显示) ------------
  // 之前把 file:// 也当作测试页，结果手机 TAVO webview 协议命中误开了面板。
  // 现在只两种触发：脚本/URL 含 ttsDebug=1，或者文件名是 tavo_widget_test。
  var DEBUG_MODE = (function () {
    try {
      var href = String(location.href || "");
      if (href.indexOf("tavo_widget_test") >= 0) return true;
      if (location.search && location.search.indexOf("ttsDebug=1") >= 0) return true;
      if (script && script.src && /[?&]ttsDebug=1\b/.test(script.src)) return true;
    } catch (_) {}
    return false;
  })();
  var DEBUG_BOX = null;
  function ensureDebugBox() {
    if (!DEBUG_MODE) return null;
    if (DEBUG_BOX) return DEBUG_BOX;
    try {
      DEBUG_BOX = document.createElement("div");
      DEBUG_BOX.style.cssText = "position:fixed;right:12px;bottom:12px;width:440px;max-height:55vh;display:flex;flex-direction:column;background:rgba(15,20,28,0.94);color:#cfe;font:11px/1.45 Consolas,Menlo,monospace;border:1px solid #334;border-radius:8px;box-shadow:0 6px 24px rgba(0,0,0,.4);z-index:2147483647";
      var head = document.createElement("div");
      head.style.cssText = "display:flex;align-items:center;justify-content:space-between;padding:6px 10px;border-bottom:1px solid #334;color:#fff;font-weight:600";
      head.innerHTML = '<span>▼ TTS 调试日志</span>';
      var btnRow = document.createElement("span");
      btnRow.style.cssText = "display:flex;gap:6px";
      var clearBtn = document.createElement("a"); clearBtn.textContent = "清空"; clearBtn.style.cssText = "color:#7fdbff;cursor:pointer;text-decoration:underline";
      var hideBtn = document.createElement("a"); hideBtn.textContent = "隐藏"; hideBtn.style.cssText = "color:#ff9;cursor:pointer;text-decoration:underline";
      btnRow.appendChild(clearBtn); btnRow.appendChild(hideBtn);
      head.appendChild(btnRow);
      var body = document.createElement("div");
      body.style.cssText = "flex:1;overflow:auto;padding:6px 10px;white-space:pre-wrap;word-break:break-all";
      body.id = "indextts-debug-body";
      clearBtn.onclick = function () { body.innerHTML = ""; };
      hideBtn.onclick = function () { DEBUG_BOX.style.display = "none"; };
      DEBUG_BOX.appendChild(head);
      DEBUG_BOX.appendChild(body);
      document.body.appendChild(DEBUG_BOX);
      DEBUG_BOX.bodyEl = body;
    } catch (_) { DEBUG_BOX = null; }
    return DEBUG_BOX;
  }
  function debugLog(text, color) {
    // 错误/关键日志同时落 console.log，方便 TAVO 里没浮窗时也能在 webview 控制台查。
    try {
      if (color === "#f99" || /^❌/.test(String(text || ""))) console.error("[indextts]", text);
      else console.log("[indextts]", text);
    } catch (_) {}
    if (!DEBUG_MODE) return;
    try {
      var box = ensureDebugBox(); if (!box) return;
      var line = document.createElement("div");
      var ts = new Date(); var hh = String(ts.getHours()).padStart(2,"0"), mm = String(ts.getMinutes()).padStart(2,"0"), ss = String(ts.getSeconds()).padStart(2,"0"), ms = String(ts.getMilliseconds()).padStart(3,"0");
      line.innerHTML = '<span style="color:#888">[' + hh+":"+mm+":"+ss+"."+ms + ']</span> ' + (color ? '<span style="color:'+color+'">'+escapeHtmlSafe(text)+'</span>' : escapeHtmlSafe(text));
      box.bodyEl.appendChild(line);
      box.bodyEl.scrollTop = box.bodyEl.scrollHeight;
    } catch (_) {}
  }
  function escapeHtmlSafe(s) { return String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;"); }
  // Long-poll server stdout while a request is active.
  var serverLogPoller = null;
  function startServerLogPolling(base) {
    if (!DEBUG_MODE || serverLogPoller) return;
    var sinceTs = Date.now() / 1000;
    serverLogPoller = setInterval(function () {
      fetch(base.replace(/\/+$/,"") + "/server_log/tail?since=" + sinceTs + "&n=50&filter=" + encodeURIComponent(">>"))
        .then(function (r) { return r.ok ? r.json() : null; })
        .then(function (d) {
          if (!d || !Array.isArray(d.lines)) return;
          d.lines.forEach(function (e) {
            if (e.ts > sinceTs) { sinceTs = e.ts; debugLog("[srv] " + e.line, "#9ff"); }
          });
        }).catch(function () {});
    }, 700);
  }
  function stopServerLogPolling() {
    if (serverLogPoller) { clearInterval(serverLogPoller); serverLogPoller = null; }
  }

  function scriptOrigin() {
    try { return new URL(script && script.src ? script.src : location.href).origin; }
    catch (_) { return "http://127.0.0.1:9880"; }
  }
  function scriptAssetUrl(fileName) {
    try {
      if (script && script.src) return new URL(fileName, script.src).href;
    } catch (_) {}
    return scriptOrigin().replace(/\/+$/, "") + "/static/" + String(fileName || "").replace(/^\/+/, "");
  }

  var DEFAULT_CONFIG = {
    configVersion: CONFIG_VERSION,
    apiBase: scriptOrigin(),
    mode: "normal",
    playbackMode: "live",
    endpoint: "/tts_cache_stream",
    dialogueEndpoint: "/tts_dialogue_cache_stream",
    parseEndpoint: "/parse_text",
    defaultVoice: "",
    // 新结构化角色映射 — 每条 {role, voice}。
    // 旁白/用户 两行常驻不可删；具体人物用原名或 defaultVoice。
    roleVoiceList: [
      { role: "旁白",   voice: "" },
      { role: "用户",   voice: "" },
      { role: "角色",   voice: "" },
    ],
    roleVoicesText: "旁白=\n用户=\n角色=",
    llmEndpoint: "http://127.0.0.1:8317/v1",
    llmModel: "渡鸦/grok-4.20-fast",
    llmApiKey: "",
    intervalMs: 50,
    topP: 0.8,
    topK: 30,
    temperature: 0.7,
    repetitionPenalty: 1.2,
    emoAlpha: 0.38,
    speedFactor: 1.0,
    qualityMode: "balanced",
    reuseLlmParse: true,
    offlineAudioEnabled: false
  };

  function $(root, sel) { return root && root.querySelector ? root.querySelector(sel) : null; }
  function $all(root, sel) { return root && root.querySelectorAll ? Array.prototype.slice.call(root.querySelectorAll(sel)) : []; }
  function first(root) { for (var i = 1; i < arguments.length; i++) { var el = $(root, arguments[i]); if (el) return el; } return null; }
  function on(el, ev, fn) { if (el) el.addEventListener(ev, fn); }
  function cleanBase(url) { return String(url || "").replace(/\/+$/, ""); }
  function withQueryParam(url, key, value) {
    try {
      var u = new URL(url, location.href);
      u.searchParams.set(key, String(value));
      return u.href;
    } catch (_) {
      var sep = String(url || "").indexOf("?") >= 0 ? "&" : "?";
      return String(url || "") + sep + encodeURIComponent(key) + "=" + encodeURIComponent(String(value));
    }
  }
  function shortText(v, limit) {
    v = String(v == null ? "" : v);
    limit = limit || 1200;
    return v.length > limit ? v.slice(0, limit) + "\n...(已截断, 共 " + v.length + " 字符)" : v;
  }
  function scriptSrcText() {
    try { return script && script.src ? script.src : ""; } catch (_) { return ""; }
  }
  function localPageText() {
    try { return location.href || ""; } catch (_) { return ""; }
  }
  function localNetworkHint(url) {
    var host = "";
    try { host = new URL(url, location.href).hostname; } catch (_) {}
    if (/^(127\.0\.0\.1|localhost)$/i.test(host)) {
      return "\n注意: 在手机/Tavo WebView 里 127.0.0.1/localhost 指手机自己,不是电脑。手机测试请把脚本/服务地址换成电脑局域网 IP,例如 http://<LAN-IP>:9880。";
    }
    return "";
  }
  function formatNetworkError(label, url, err, extraLines) {
    var raw = err && err.message ? err.message : String(err || "");
    var name = err && err.name ? err.name : "Error";
    var lines = [
      label + " 连不上 IndexTTS 后端。",
      "这一步还没进 IndexTTS 服务,也没有调用 LLM 模型。",
      "先检查: Tavo AR/手机能不能打开脚本同源的 IndexTTS 地址;服务地址要用局域网 IP 或 HTTPS 隧道,不要用只在电脑本机可见的地址。",
      "",
      "技术细节:",
      "请求 URL: " + url,
      "浏览器错误: " + name + (raw ? ": " + raw : ""),
      "Tavo AR 页面: " + localPageText(),
      "脚本来源: " + scriptSrcText()
    ];
    (extraLines || []).forEach(function (line) { if (line) lines.push(line); });
    lines.push("常见原因: 手机访问不到电脑端口、防火墙拦截、地址不是局域网 IP、Tavo WebView 拦截 HTTP/CORS/证书。");
    return lines.join("\n") + localNetworkHint(url);
  }
  function formatHttpError(label, url, res, body, extraLines) {
    var lines = [
      label + " 已经到达 IndexTTS 后端,但后端返回失败。",
      "这通常才是后端/LLM 配置问题。下面的响应内容里一般会写清楚是 LLM endpoint、模型名、key、网络连接还是返回格式出错。",
      "",
      "技术细节:",
      "请求 URL: " + url,
      "HTTP: " + res.status + " " + (res.statusText || ""),
    ];
    (extraLines || []).forEach(function (line) { if (line) lines.push(line); });
    lines.push("响应内容:\n" + shortText(body || "(空响应)"));
    return lines.join("\n");
  }
  function escapeHtml(v) { return String(v == null ? "" : v).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;"); }
  function shortName(v) { return String(v || "自动").split(/[\\/]/).pop().replace(/\.[a-z0-9]+$/i, "") || "自动"; }

  function inlineHost(scriptEl) {
    var parent = scriptEl && scriptEl.parentElement;
    if (parent && parent !== document.head && parent !== document.body && parent !== document.documentElement) return parent;
    return document.body || document.documentElement;
  }
  function messageElement(scriptEl) {
    var host = inlineHost(scriptEl);
    if (!host || !host.closest) return host;
    return host.closest('.mes, [mesid], [data-message-id], .message, .tavo-message, article, li') || host;
  }
  function domAvatarUrl(el) {
    if (!el || !el.querySelector) return "";
    var selectors = '.avatar img[src], .mesAvatarWrapper img[src], img.avatar[src], [class*="avatar"] img[src], [class*="Avatar"] img[src]';
    var img = null;
    try { img = el.querySelector(selectors); } catch (_) { img = el.querySelector('img[src]'); }
    if (!img && el.closest) {
      var msg = el.closest('.mes, [mesid], [data-message-id], .message, .tavo-message, article, li');
      if (msg && msg !== el) {
        try { img = msg.querySelector(selectors); } catch (_) { img = msg.querySelector('img[src]'); }
      }
    }
    return img ? (img.currentSrc || img.src || "") : "";
  }
  function normalizeTavoAssetUrl(url) {
    url = String(url || "").trim();
    if (!url) return "";
    if (/^(https?:|blob:|data:)/i.test(url)) return url;
    try { return new URL(url.replace(/^\/+/, ""), window.location.origin + "/").href; }
    catch (_) { return url; }
  }

  function ensureSkinStyle() {
    try {
      var skinId = STYLE_ID + "-skin";
      if (document.getElementById(skinId)) return;
      var link = document.createElement("link");
      link.id = skinId;
      link.rel = "stylesheet";
      link.href = scriptAssetUrl("tavo.ui.skin.default.css") + "?skin_v=" + encodeURIComponent(String((window.__indextts_tavo_loader_version || CONFIG_VERSION)));
      link.onerror = function () { debugLog("⚠️ UI skin CSS 加载失败: " + link.href, "#fc9"); };
      document.head.appendChild(link);
    } catch (_) {}
  }
