;(async function () {
  "use strict";

  var script = document.currentScript;
  var STYLE_ID = "indextts-tavo-player-v4";
  var CONFIG_KEY = "indextts_tavo_config_v3";
  var CHAR_SCOPE_CONFIG_KEY = "indextts_tavo_character_config_v1";
  // 角色级配置: defaultVoice + roleVoiceList。LLM/api/mode 参数走全局。
  var CHAR_KEY_PREFIX = "indextts_tavo_character_v1:";
  var GLOBAL_CONFIG_FIELDS = [
    "apiBase", "mode", "endpoint", "dialogueEndpoint", "parseEndpoint",
    "llmEndpoint", "llmModel", "llmApiKey",
    "intervalMs", "topP", "topK", "temperature", "repetitionPenalty", "emoAlpha", "speedFactor", "qualityMode"
  ];
  var RESERVED_ROLES = ["旁白", "用户"];  // 这两个常驻不可删；具体人物用原名或 defaultVoice
  function voiceForRoleNames(list, names) {
    list = (list && Array.isArray(list)) ? list : [];
    names = names || [];
    for (var i = 0; i < list.length; i++) {
      var role = String((list[i] && list[i].role) || "").trim();
      if (names.indexOf(role) >= 0) return String((list[i] && list[i].voice) || "");
    }
    return "";
  }
  function normalizeRoleVoiceList(list) {
    list = (list && Array.isArray(list)) ? list.slice() : [];
    function findVoice(names, fallbackIndex) {
      var hit = voiceForRoleNames(list, names);
      return hit || String((list[fallbackIndex] && list[fallbackIndex].voice) || "");
    }
    var reserved = [
      { role: "旁白", voice: findVoice(["旁白", "narrator"], 0) },
      { role: "用户", voice: findVoice(["用户", "你", "user", "我"], 1) },
    ];
    // 后续行:去掉 role + voice 都空的(避免上次会话累积大量空行)
    var extra = list.filter(function (r) {
      var role = String((r && r.role) || "").trim();
      var voice = String((r && r.voice) || "").trim();
      if (role === "旁白" || role === "用户" || role === "角色" || role === "我") return false;
      return role || voice;
    });
    return reserved.concat(extra);
  }
  async function loadCharacterCfg(characterId) {
    try { if (window.tavo && typeof tavo.get === "function") { var cs = await tavo.get(CHAR_SCOPE_CONFIG_KEY, "character"); if (cs) return cs; } } catch (_) {}
    if (!characterId) return null;
    try { if (window.tavo && typeof tavo.get === "function") { var tv = await tavo.get(CHAR_KEY_PREFIX + characterId, "global"); if (tv) return tv; } } catch (_) {}
    try { var raw = localStorage.getItem(CHAR_KEY_PREFIX + characterId); if (raw) return JSON.parse(raw); } catch (_) {}
    return null;
  }
  async function saveCharacterCfg(characterId, partial) {
    try { if (window.tavo && typeof tavo.set === "function") await tavo.set(CHAR_SCOPE_CONFIG_KEY, partial || {}, "character"); } catch (_) {}
    if (!characterId) return;
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

  var DEFAULT_CONFIG = {
    apiBase: scriptOrigin(),
    mode: "single",
    endpoint: "/tts_cache_stream",
    dialogueEndpoint: "/tts_dialogue_cache_stream",
    parseEndpoint: "/parse_text",
    defaultVoice: "",
    // 新结构化角色映射 — 每条 {role, voice}。
    // 旁白/用户 两行常驻不可删；具体人物用原名或 defaultVoice。
    roleVoiceList: [
      { role: "旁白",   voice: "" },
      { role: "用户",   voice: "" },
    ],
    roleVoicesText: "旁白=\n用户=",
    llmEndpoint: "http://127.0.0.1:8317/v1",
    llmModel: "渡鸦/grok-4.20-fast",
    llmApiKey: "",
    intervalMs: 50,
    topP: 0.8,
    topK: 30,
    temperature: 0.8,
    repetitionPenalty: 10,
    emoAlpha: 0.7,
    speedFactor: 1.08,
    qualityMode: "balanced"
  };

  function $(root, sel) { return root && root.querySelector ? root.querySelector(sel) : null; }
  function $all(root, sel) { return root && root.querySelectorAll ? Array.prototype.slice.call(root.querySelectorAll(sel)) : []; }
  function first(root) { for (var i = 1; i < arguments.length; i++) { var el = $(root, arguments[i]); if (el) return el; } return null; }
  function on(el, ev, fn) { if (el) el.addEventListener(ev, fn); }
  function cleanBase(url) { return String(url || "").replace(/\/+$/, ""); }
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
      return "\n注意: 在手机/Tavo WebView 里 127.0.0.1/localhost 指手机自己,不是电脑。手机测试请把脚本/服务地址换成电脑局域网 IP,例如 http://192.168.8.100:9880。";
    }
    return "";
  }
  function formatNetworkError(label, url, err, extraLines) {
    var raw = err && err.message ? err.message : String(err || "");
    var name = err && err.name ? err.name : "Error";
    var lines = [
      label + " 请求没有到达后端。",
      "请求 URL: " + url,
      "浏览器错误: " + name + (raw ? ": " + raw : ""),
      "当前页面: " + localPageText(),
      "脚本来源: " + scriptSrcText()
    ];
    (extraLines || []).forEach(function (line) { if (line) lines.push(line); });
    lines.push("常见原因: 手机访问不到电脑端口/防火墙拦截/地址不是局域网 IP/Tavo WebView 拦截 HTTP/CORS。");
    return lines.join("\n") + localNetworkHint(url);
  }
  function formatHttpError(label, url, res, body, extraLines) {
    var lines = [
      label + " 后端返回错误。",
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

  function ensureStyle() {
    if (document.getElementById(STYLE_ID)) return;
    var style = document.createElement("style");
    style.id = STYLE_ID;
    style.textContent = [
      ".idx-tts *{box-sizing:border-box;letter-spacing:0}",
      ".idx-tts{max-width:760px;margin:12px 0;color:#eee7f4;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI','Microsoft YaHei',sans-serif;line-height:1.45;letter-spacing:0}.idx-hidden{display:none!important}",
      ".idx-card{position:relative;overflow:hidden;border-radius:18px;background:radial-gradient(circle at 88% 8%,rgba(216,167,255,.22),transparent 40%),linear-gradient(160deg,rgba(27,21,34,.55) 0%,rgba(18,14,24,.48) 54%,rgba(12,9,16,.55) 100%);backdrop-filter:blur(22px) saturate(140%);-webkit-backdrop-filter:blur(22px) saturate(140%);border:1px solid rgba(206,170,230,.22);padding:16px}",
      ".idx-top{display:flex;align-items:center;gap:12px;min-width:0}.idx-cover{width:56px;height:56px;flex:0 0 56px;border-radius:14px;background:#241a2c;box-shadow:inset 0 0 0 1px rgba(255,255,255,.08),0 10px 24px rgba(0,0,0,.34);display:flex;align-items:center;justify-content:center;color:#e9c8ff;font-size:18px;font-weight:800;background-size:cover;background-position:center}.idx-cover[data-playing='1']{animation:none}",
      ".idx-info{flex:1;min-width:0;padding-right:48px}.idx-title-row{display:flex;align-items:center;gap:8px;min-width:0}.idx-name{font-size:18px;font-weight:800;color:#e9c8ff;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.idx-format{flex:0 0 auto;border:1px solid rgba(206,170,230,.34);background:rgba(206,170,230,.12);color:#d9b7f0;border-radius:999px;padding:2px 7px;font-size:10px;font-weight:800}.idx-status{margin-top:4px;font-size:12px;color:rgba(238,231,244,.62);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.idx-gear{position:absolute;right:14px;top:14px;width:40px;height:40px;border-radius:50%;border:1px solid rgba(206,170,230,.30);background:rgba(20,14,28,.55);-webkit-backdrop-filter:blur(8px);backdrop-filter:blur(8px);color:#eee7f4;display:flex;align-items:center;justify-content:center;cursor:pointer;padding:0;z-index:2;transition:background .15s,transform .12s}.idx-gear:active{transform:scale(.92)}.idx-gear svg{width:18px;height:18px;fill:currentColor}@media(hover:hover){.idx-gear:hover{background:rgba(60,38,80,.65)}}",
      ".idx-seek-wrap{margin:14px 0 0;background:transparent;border:0;border-radius:0;padding:0}.idx-seek{width:100%;height:24px;margin:0;accent-color:#c88ee9;cursor:pointer}.idx-time{display:flex;justify-content:space-between;font-size:12px;color:rgba(238,231,244,.68);font-variant-numeric:tabular-nums;margin-top:4px}",
      ".idx-subtitle{display:flex;flex-direction:column;gap:2px;margin:12px 0 0;padding:18px 10px;background:linear-gradient(180deg,rgba(60,36,84,.30) 0%,rgba(40,24,56,.50) 50%,rgba(60,36,84,.30) 100%);border:1px solid rgba(206,170,230,.18);border-radius:14px;max-height:240px;min-height:160px;overflow-y:auto;scroll-behavior:smooth;-webkit-overflow-scrolling:touch;mask-image:linear-gradient(to bottom,transparent 0,#000 18%,#000 82%,transparent 100%);-webkit-mask-image:linear-gradient(to bottom,transparent 0,#000 18%,#000 82%,transparent 100%)}.idx-subtitle.idx-hidden{display:none}.idx-sub-row{display:flex;flex-direction:column;align-items:center;gap:4px;padding:6px 8px;border-radius:10px;flex-shrink:0;text-align:center;cursor:pointer;color:rgba(244,231,255,.42);font-size:13px;line-height:1.45;font-weight:500;transition:color .25s,font-size .2s,font-weight .2s,letter-spacing .2s,padding .2s}.idx-sub-row:hover{background:rgba(255,255,255,.04)}.idx-sub-row.is-current{color:#fff;font-size:17px;font-weight:700;letter-spacing:.5px;padding:10px 8px}.idx-sub-row.is-past{color:rgba(244,231,255,.30)}.idx-sub-notice{margin:auto;text-align:center;color:rgba(244,231,255,.78);font-size:13px;line-height:1.6;max-width:92%;padding:18px 8px}.idx-sub-notice strong{display:block;color:#fff;font-size:16px;margin-bottom:4px}.idx-sub-notice span{display:block;color:rgba(244,231,255,.56);font-size:12px}.idx-sub-avatar{width:24px;height:24px;border-radius:50%;background:#241a2c;object-fit:cover;border:1.5px solid rgba(206,170,230,.40);opacity:.85;transition:width .2s,height .2s,opacity .2s}.idx-sub-row.is-current .idx-sub-avatar{width:32px;height:32px;opacity:1}.idx-sub-avatar.idx-hidden{display:none}.idx-sub-text{display:block;word-break:break-word;max-width:100%}",
      ".idx-controls{display:flex;align-items:center;justify-content:center;gap:12px;margin-top:14px}.idx-ctrl{border:1px solid rgba(206,170,230,.16);border-radius:50%;background:rgba(206,170,230,.08);color:#eee7f4;cursor:pointer;display:flex;align-items:center;justify-content:center;padding:0;-webkit-tap-highlight-color:transparent;transition:background-color .12s ease}@media(hover:hover){.idx-ctrl:hover{background:rgba(206,170,230,.16)}}.idx-ctrl:focus{outline:none}.idx-ctrl svg{width:20px;height:20px;fill:currentColor}.idx-ctrl-sm{width:44px;height:44px}.idx-ctrl-main{width:66px;height:66px;background:#c890e8;color:#170e20;border-color:rgba(255,255,255,.18);box-shadow:0 10px 24px rgba(200,144,232,.25)}.idx-ctrl-main[data-state='playing']{background:#e1b0f5}.idx-ctrl-main svg{width:28px;height:28px}.idx-ctrl-main[data-state='loading'] svg{animation:idx-spin .9s linear infinite}@keyframes idx-spin{to{transform:rotate(360deg)}}.idx-ctrl-add{width:48px;height:48px;background:rgba(154,94,182,.42);color:#f4e7ff}.idx-ctrl-delete{width:48px;height:48px;background:rgba(120,38,52,.46);color:#ffd5dd}.idx-ctrl:disabled{opacity:.42;cursor:not-allowed;filter:grayscale(.25)}",
      ".idx-meta{display:flex;align-items:center;justify-content:center;gap:8px;flex-wrap:wrap;margin-top:12px}.idx-pill{font-size:11px;color:rgba(238,231,244,.75);background:rgba(255,255,255,.06);border:1px solid rgba(206,170,230,.14);border-radius:999px;padding:4px 9px;max-width:100%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}",
      ".idx-panel{margin:auto auto 0 auto;border:1px solid rgba(206,170,230,.22);border-top-left-radius:18px;border-top-right-radius:18px;border-bottom-left-radius:0;border-bottom-right-radius:0;background:rgba(12,8,18,.985);color:#eee7f4;width:100%;max-width:100vw;height:fit-content;max-height:80vh;overflow-y:auto;overscroll-behavior:contain;-webkit-overflow-scrolling:touch;box-shadow:0 -8px 32px rgba(0,0,0,.45),inset 0 1px 0 rgba(255,255,255,.05);padding:14px;padding-bottom:calc(14px + env(safe-area-inset-bottom,0px))}.idx-panel::backdrop{background:rgba(0,0,0,.55);backdrop-filter:blur(3px)}.idx-panel-head{display:flex;align-items:center;justify-content:space-between;gap:10px;margin:-14px -14px 10px;padding:12px 14px 10px;position:sticky;top:-14px;background:linear-gradient(180deg,#120e18 0%,rgba(18,14,24,.94) 100%);z-index:1}.idx-panel-title{font-size:14px;font-weight:800;color:#e9c8ff}.idx-close{border:0;background:transparent;color:rgba(238,231,244,.70);font-size:22px;line-height:1;cursor:pointer;padding:0 6px}",
      ".idx-section-title{font-size:12px;font-weight:700;color:#d9b7f0;margin:12px 0 7px}.idx-voices{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px}.idx-voice{min-height:58px;border:1px solid rgba(206,170,230,.16);border-radius:8px;background:rgba(255,255,255,.06);color:#eee7f4;text-align:left;padding:9px;cursor:pointer;font-family:inherit;position:relative;overflow:hidden}.idx-voice:before{content:'';position:absolute;left:0;right:0;bottom:0;height:4px;background:linear-gradient(90deg,#c890e8,#d8a7ff);opacity:.30}.idx-voice strong{display:block;font-size:13px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.idx-voice span{display:block;margin-top:4px;font-size:11px;color:rgba(238,231,244,.56)}.idx-voice.is-active{border-color:#c890e8;background:rgba(200,144,232,.16);box-shadow:0 0 0 2px rgba(200,144,232,.12)}",
      ".idx-modes{display:grid;grid-template-columns:1fr;gap:7px}.idx-mode{border:1px solid rgba(206,170,230,.16);border-radius:8px;background:rgba(255,255,255,.06);color:#eee7f4;text-align:left;padding:9px;cursor:pointer;font-family:inherit}.idx-mode strong{display:block;font-size:12px}.idx-mode span{display:block;margin-top:3px;font-size:11px;color:rgba(238,231,244,.56)}.idx-mode.is-active{border-color:#c890e8;background:rgba(200,144,232,.16);box-shadow:0 0 0 2px rgba(200,144,232,.10)}",
      ".idx-label{font-size:11px;color:rgba(238,231,244,.66)}.idx-input,.idx-textarea{width:100%;border:1px solid rgba(206,170,230,.16);border-radius:9px;background:#0b0810;color:#eee7f4;padding:8px;font-size:12px;font-family:inherit;outline:none}.idx-btn{height:32px;border:1px solid rgba(206,170,230,.20);border-radius:9px;background:rgba(255,255,255,.06);color:#eee7f4;padding:0 10px;font-size:12px;cursor:pointer;font-family:inherit}.idx-error{margin-top:10px;color:#ffd5dd;background:rgba(120,38,52,.22);border:1px solid rgba(255,120,145,.28);border-radius:10px;padding:8px;font-size:12px;white-space:pre-wrap;overflow-wrap:anywhere}",
      // 结构化角色映射 UI
      ".idx-roles{display:flex;flex-direction:column;gap:6px;margin-bottom:8px}.idx-role-row{display:grid;grid-template-columns:96px 1fr 28px;gap:6px;align-items:center}.idx-role-name{min-width:0;border:1px solid rgba(206,170,230,.16);background:#0b0810;color:#eee7f4;border-radius:8px;padding:6px 8px;font-size:12px;font-family:inherit;outline:none}.idx-voice-btn{min-width:0;border:1px solid rgba(206,170,230,.20);background:rgba(206,170,230,.08);color:#eee7f4;border-radius:8px;padding:6px 10px;font-size:12px;cursor:pointer;text-align:left;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;font-family:inherit}.idx-voice-btn:hover{background:rgba(206,170,230,.16)}.idx-role-del{width:28px;height:28px;border:1px solid rgba(255,120,145,.28);background:rgba(120,38,52,.22);color:#ffd5dd;border-radius:8px;cursor:pointer;font-size:14px;line-height:1;font-family:inherit}.idx-role-lock{width:28px;height:28px;display:flex;align-items:center;justify-content:center;color:rgba(238,231,244,.45);font-size:13px;user-select:none;cursor:default}.idx-add-role{margin-top:4px;width:100%;border:1px dashed rgba(206,170,230,.30);background:transparent;color:#d9b7f0;padding:8px;border-radius:9px;cursor:pointer;font-size:12px;font-family:inherit}.idx-add-role:hover{background:rgba(206,170,230,.06)}.idx-llm-details{margin-top:10px;border:1px solid rgba(206,170,230,.16);border-radius:9px;background:rgba(255,255,255,.03);overflow:hidden}.idx-llm-details>summary{list-style:none;cursor:pointer;padding:9px 12px;font-size:12px;font-weight:700;color:#d9b7f0;display:flex;align-items:center;justify-content:space-between;user-select:none}.idx-llm-details>summary::-webkit-details-marker{display:none}.idx-llm-details>summary::after{content:'▾';font-size:10px;color:rgba(238,231,244,.55);transition:transform .2s}.idx-llm-details[open]>summary::after{transform:rotate(180deg)}.idx-llm-details>.idx-grid{padding:8px 12px 12px;border-top:1px solid rgba(206,170,230,.12)}",
      // 音色选择器弹窗
      ".idx-picker{margin:auto auto 0 auto;border:1px solid rgba(206,170,230,.22);border-top-left-radius:18px;border-top-right-radius:18px;border-bottom-left-radius:0;border-bottom-right-radius:0;background:rgba(12,8,18,.985);color:#eee7f4;width:100%;max-width:100vw;height:fit-content;max-height:80vh;box-shadow:0 -8px 32px rgba(0,0,0,.45);padding:14px;padding-bottom:calc(14px + env(safe-area-inset-bottom,0px));display:flex;flex-direction:column;min-height:0}.idx-picker::backdrop{background:rgba(0,0,0,.55);backdrop-filter:blur(3px)}.idx-picker-head{display:flex;align-items:center;justify-content:space-between;padding-bottom:8px;border-bottom:1px solid rgba(206,170,230,.18);margin-bottom:8px}.idx-picker-title{font-size:14px;font-weight:800;color:#e9c8ff}.idx-picker-close{border:0;background:transparent;color:#eee7f4;font-size:22px;cursor:pointer;padding:0 6px;line-height:1}.idx-picker-tabs{display:flex;gap:6px;overflow-x:auto;margin-bottom:8px;flex-wrap:wrap}.idx-picker-tab{flex:0 0 auto;border:1px solid rgba(206,170,230,.16);background:rgba(255,255,255,.04);color:#eee7f4;border-radius:999px;padding:5px 11px;cursor:pointer;font-size:11px;font-family:inherit;white-space:nowrap}.idx-picker-tab.is-active{border-color:#c890e8;background:rgba(200,144,232,.20);color:#fff}.idx-picker-search{margin-bottom:8px}.idx-picker-grid{flex:1 1 auto;min-height:200px;max-height:50vh;overflow-y:auto;display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:6px;align-content:start;padding:2px}.idx-picker-item{min-height:54px;border:1px solid rgba(206,170,230,.16);border-radius:10px;background:rgba(255,255,255,.05);color:#eee7f4;text-align:left;padding:8px 8px 8px 12px;cursor:pointer;font-family:inherit;font-size:12px;line-height:1.35;display:flex;align-items:center;gap:6px;justify-content:space-between;transition:background .15s,border-color .15s}.idx-picker-item:hover{background:rgba(206,170,230,.14);border-color:rgba(206,170,230,.34)}.idx-picker-item.is-playing{border-color:#c890e8;background:rgba(200,144,232,.18);box-shadow:0 0 0 1px rgba(200,144,232,.22) inset}.idx-picker-item-info{flex:1;min-width:0;display:flex;flex-direction:column;justify-content:center}.idx-picker-item-name{font-size:13px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;display:block}.idx-picker-item-sub{font-size:10px;color:rgba(238,231,244,.55);margin-top:2px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.idx-picker-apply{flex:0 0 auto;width:30px;height:30px;border-radius:50%;border:1px solid rgba(200,144,232,.45);background:rgba(200,144,232,.18);color:#fff;cursor:pointer;font-size:14px;font-weight:700;display:flex;align-items:center;justify-content:center;font-family:inherit;padding:0;line-height:1}.idx-picker-apply:hover{background:#c890e8;color:#170e20;border-color:#c890e8;transform:scale(1.05)}.idx-picker-apply:active{transform:scale(.95)}.idx-picker-pager{display:flex;align-items:center;justify-content:center;gap:12px;padding-top:8px;border-top:1px solid rgba(206,170,230,.14);color:rgba(238,231,244,.72);font-size:11px}.idx-picker-pager button{border:1px solid rgba(206,170,230,.20);background:rgba(255,255,255,.06);color:#eee7f4;border-radius:7px;padding:3px 10px;cursor:pointer;font-family:inherit;font-size:11px}.idx-picker-pager button:disabled{opacity:.4;cursor:not-allowed}",
      ".idx-card audio{display:none!important}.idx-info{padding-right:104px}.idx-card-counter{position:absolute;right:60px;top:18px;min-width:44px;height:30px;padding:0 9px;border:1px solid rgba(206,170,230,.22);border-radius:999px;background:rgba(20,14,28,.46);color:rgba(238,231,244,.78);font-size:11px;font-weight:800;font-variant-numeric:tabular-nums;display:flex;align-items:center;justify-content:center;z-index:2}.idx-gear svg{width:19px;height:19px;fill:none!important;stroke:currentColor}",
      ".idx-seek{-webkit-appearance:none;appearance:none;height:30px;background:transparent;accent-color:auto}.idx-seek::-webkit-slider-runnable-track{height:8px;border-radius:999px;background:linear-gradient(90deg,rgba(216,167,255,.85),rgba(130,190,255,.72));box-shadow:inset 0 0 0 1px rgba(255,255,255,.10)}.idx-seek::-webkit-slider-thumb{-webkit-appearance:none;appearance:none;width:20px;height:20px;margin-top:-6px;border-radius:50%;border:2px solid #fff;background:#c890e8;box-shadow:0 0 0 5px rgba(200,144,232,.18),0 4px 12px rgba(0,0,0,.35)}.idx-seek::-moz-range-track{height:8px;border-radius:999px;background:linear-gradient(90deg,rgba(216,167,255,.85),rgba(130,190,255,.72))}.idx-seek::-moz-range-thumb{width:18px;height:18px;border-radius:50%;border:2px solid #fff;background:#c890e8;box-shadow:0 0 0 5px rgba(200,144,232,.18)}",
      ".idx-panel{width:min(760px,calc(100vw - 24px));max-width:760px;max-height:calc(100vh - 24px);margin:auto;border-radius:18px;background:rgba(12,8,18,.985);scrollbar-width:none}.idx-panel::-webkit-scrollbar{display:none}.idx-panel-head{top:-14px}.idx-grid{display:grid;grid-template-columns:1fr 1fr;gap:12px}.idx-field{display:flex;flex-direction:column;gap:5px;min-width:0}.idx-field.idx-wide{grid-column:1/-1}.idx-actions{display:flex;justify-content:flex-end;gap:12px;margin-top:14px;padding-top:12px;border-top:1px solid rgba(206,170,230,.12)}",
      ".idx-picker,.idx-picker-grid{scrollbar-width:none}.idx-picker::-webkit-scrollbar,.idx-picker-grid::-webkit-scrollbar,.idx-subtitle::-webkit-scrollbar{display:none}.idx-picker-item.is-selected{border-color:#d8a7ff;background:rgba(200,144,232,.20);box-shadow:0 0 0 1px rgba(216,167,255,.24) inset,0 0 18px rgba(200,144,232,.14)}.idx-picker-selected{flex:0 0 auto;width:20px;height:20px;border-radius:50%;background:#d8a7ff;color:#160d1f;font-size:12px;font-weight:900;display:none;align-items:center;justify-content:center}.idx-picker-item.is-selected .idx-picker-selected{display:flex}.idx-picker-wave{flex:0 0 auto;width:24px;height:18px;display:none;align-items:center;justify-content:center;gap:2px}.idx-picker-item.is-selected .idx-picker-wave,.idx-picker-item.is-playing .idx-picker-wave{display:flex}.idx-picker-wave i{width:3px;border-radius:999px;background:#d8a7ff;opacity:.85;animation:idx-wave .78s ease-in-out infinite}.idx-picker-wave i:nth-child(2){animation-delay:.12s}.idx-picker-wave i:nth-child(3){animation-delay:.24s}@keyframes idx-wave{0%,100%{height:5px;opacity:.45}50%{height:17px;opacity:1}}",
      "@media(max-width:520px){.idx-card{padding:14px;border-radius:16px}.idx-info{padding-right:96px}.idx-card-counter{right:56px;top:16px}.idx-panel{width:calc(100vw - 16px);max-height:calc(100vh - 16px);border-radius:16px}.idx-controls{gap:10px}.idx-ctrl-sm{width:40px;height:40px}.idx-ctrl-main{width:62px;height:62px}.idx-ctrl-add,.idx-ctrl-delete{width:44px;height:44px}.idx-grid{grid-template-columns:1fr}.idx-voices{grid-template-columns:1fr 1fr}.idx-role-row{grid-template-columns:84px 1fr 26px}.idx-picker-grid{grid-template-columns:1fr 1fr}}"
    ].join("");
    document.head.appendChild(style);
  }

  async function getConfig() {
    var saved = null;
    try { if (window.tavo && typeof tavo.get === "function") saved = await tavo.get(CONFIG_KEY, "global"); } catch (_) {}
    if (!saved) { try { saved = JSON.parse(localStorage.getItem(CONFIG_KEY) || "null"); } catch (_) {} }
    var cfg = Object.assign({}, DEFAULT_CONFIG, pickGlobalConfig(saved || {}));
    // 强制把 apiBase 锁死成本次加载脚本的来源 —— 用户换 LAN/外网/隧道 URL 时
    // 不会被 localStorage 里残留的旧 apiBase 拖累，所有请求一定打回脚本同源。
    cfg.apiBase = scriptOrigin();
    if (cfg.roleVoicesText && !/^\s*旁白\s*[=:：]/m.test(cfg.roleVoicesText)) {
      var m = String(cfg.roleVoicesText).match(/^\s*narrator\s*[=:：]\s*(.+)$/m);
      if (m && m[1]) cfg.roleVoicesText = "旁白=" + m[1].trim() + "\n" + cfg.roleVoicesText;
    }
    // 旧版用户的 cfg 没有 roleVoiceList —— 从 roleVoicesText 迁移过来
    if (!Array.isArray(cfg.roleVoiceList) || cfg.roleVoiceList.length === 0) {
      cfg.roleVoiceList = parseRoleVoiceText(cfg.roleVoicesText || "");
    }
    return cfg;
  }
  function pickGlobalConfig(cfg) {
    var out = {};
    if (!cfg || typeof cfg !== "object") return out;
    GLOBAL_CONFIG_FIELDS.forEach(function (key) {
      if (cfg[key] !== undefined) out[key] = cfg[key];
    });
    return out;
  }
  function pickCharacterConfig(cfg) {
    return {
      defaultVoice: cfg.defaultVoice || "",
      roleVoiceList: normalizeRoleVoiceList(cfg.roleVoiceList || []),
    };
  }
  // 把旧 textarea 文本(每行/逗号分隔的 role=voice)转成结构化数组
  function parseRoleVoiceText(text) {
    var out = [];
    String(text || "").split(/[\r\n,，;；]+/).forEach(function (line) {
      var m = line.trim().match(/^(.+?)[=:：]\s*(.+)$/);
      if (m) out.push({ role: m[1].trim(), voice: m[2].trim() });
    });
    return out.length ? out : [
      { role: "旁白", voice: "" },
      { role: "用户", voice: "" },
    ];
  }
  // 反向序列化:给老路径(parseRoleVoices)和后端 voices 字典提供数据
  function serializeRoleVoiceList(list) {
    return (list || []).filter(function (r) { return r.role && r.voice; })
      .map(function (r) { return r.role + "=" + r.voice; }).join("\n");
  }
  function rolesListToVoicesMap(list, defaultVoice) {
    var out = { default: defaultVoice || "" };
    (list || []).forEach(function (r) {
      if (r.role && r.voice) out[r.role] = r.voice;
    });
    return out;
  }
  async function saveConfig(cfg, characterId) {
    // 写入前 normalize 一次,杜绝脏数据回到 storage
    if (Array.isArray(cfg.roleVoiceList)) cfg.roleVoiceList = normalizeRoleVoiceList(cfg.roleVoiceList);
    // 全局只保存 LLM/api/mode/推理参数，不保存任何音色。
    var globalCfg = pickGlobalConfig(cfg);
    try { if (window.tavo && typeof tavo.set === "function") await tavo.set(CONFIG_KEY, globalCfg, "global"); } catch (_) {}
    try { localStorage.setItem(CONFIG_KEY, JSON.stringify(globalCfg)); } catch (_) {}
    // 角色级: defaultVoice + roleVoiceList 写 TAVO character scope。
    await saveCharacterCfg(characterId, pickCharacterConfig(cfg));
  }
  function pickAvatarUrl(obj) {
    if (!obj || typeof obj !== "object") return "";
    var keys = ["avatar", "avatarUrl", "avatar_url", "icon", "iconUrl", "image", "imageUrl", "photo", "profileImage", "profile_image"];
    for (var i = 0; i < keys.length; i++) {
      var v = obj[keys[i]];
      if (typeof v === "string" && v.trim()) return v.trim();
      if (v && typeof v === "object") {
        var nested = pickAvatarUrl(v);
        if (nested) return nested;
      }
    }
    return "";
  }

  async function currentMessageContext() {
    var text = "";
    var msgEl = messageElement(script);
    var avatarUrl = domAvatarUrl(msgEl);
    var characterName = "";
    var characterId = "";
    var messageId = "";
    var userName = "";
    var userAvatarUrl = "";
    try {
      if (window.tavo && tavo.message && typeof tavo.message.current === "function") {
        var msg = await tavo.message.current();
        if (msg && msg.content) text = String(msg.content);
        if (msg && msg.id != null) messageId = String(msg.id);
        if (msg && msg.characterId != null) {
          characterId = String(msg.characterId);
          if (window.tavo && tavo.character && typeof tavo.character.get === "function") {
            var character = await tavo.character.get(msg.characterId);
            if (character) {
              characterName = character.nickname || character.name || "";
              avatarUrl = avatarUrl || character.avatar || pickAvatarUrl(character);
            }
          }
        }
        avatarUrl = avatarUrl || pickAvatarUrl(msg) || pickAvatarUrl(msg && (msg.character || msg.role || msg.sender || msg.author));
      }
    } catch (_) {}
    try {
      if (window.tavo && tavo.chat && typeof tavo.chat.current === "function") {
        var chat = await tavo.chat.current();
        if (chat && chat.persona) {
          userName = String(chat.persona.name || "").trim();
          userAvatarUrl = userAvatarUrl || pickAvatarUrl(chat.persona);
          if (chat.persona.id != null && window.tavo && tavo.persona && typeof tavo.persona.get === "function") {
            var persona = await tavo.persona.get(chat.persona.id);
            if (persona) {
              userName = String(persona.name || userName || "").trim();
              userAvatarUrl = userAvatarUrl || pickAvatarUrl(persona);
            }
          }
        }
      }
    } catch (_) {}
    try {
      if (!avatarUrl && window.tavo && tavo.character && typeof tavo.character.current === "function") avatarUrl = pickAvatarUrl(await tavo.character.current());
      if (!avatarUrl && window.tavo && tavo.role && typeof tavo.role.current === "function") avatarUrl = pickAvatarUrl(await tavo.role.current());
    } catch (_) {}
    if (!avatarUrl) avatarUrl = domAvatarUrl(script && script.parentElement);
    avatarUrl = normalizeTavoAssetUrl(avatarUrl);
    userAvatarUrl = normalizeTavoAssetUrl(userAvatarUrl);
    if (!text && msgEl) {
      try {
        var clone = msgEl.cloneNode(true);
        clone.querySelectorAll('.idx-tts, .idx-card, .idx-panel, .idx-global-gear, script').forEach(function (n) { n.remove(); });
        text = clone.innerText || clone.textContent || "";
      } catch (_) { text = msgEl.innerText || msgEl.textContent || ""; }
    }
    return { text: text.replace(/<script[\s\S]*?<\/script>/gi, "").replace(/\[IndexTTS_TAVO_SCRIPT\]/g, "").trim(), avatarUrl: avatarUrl, characterName: characterName, characterId: characterId, messageId: messageId, userName: userName, userAvatarUrl: userAvatarUrl };
  }
  // 每条消息的播放历史持久化：key = "indextts_tracks_<messageId>"。
  // 只存可重建的元信息（cacheKey + voice + mode + createdAt），不存 blob。
  // 重新进页面时通过 /cache_audio/{cacheKey} 把 audio.src 接上。
  var TRACKS_KEY_PREFIX = "indextts_tracks_";
  async function loadTracksForMessage(messageId) {
    if (!messageId) return [];
    var key = TRACKS_KEY_PREFIX + messageId;
    try { if (window.tavo && typeof tavo.get === "function") { var cv = await tavo.get(key, "chat"); if (Array.isArray(cv)) return cv; } } catch (_) {}
    try { if (window.tavo && typeof tavo.get === "function") { var v = await tavo.get(key, "global"); if (Array.isArray(v)) return v; } } catch (_) {}
    try { var raw = localStorage.getItem(key); if (raw) { var arr = JSON.parse(raw); if (Array.isArray(arr)) return arr; } } catch (_) {}
    return [];
  }
  async function saveTracksForMessage(messageId, tracks) {
    if (!messageId) return;
    var key = TRACKS_KEY_PREFIX + messageId;
    // 只挑能跨会话持久化的字段；blob URL 重启就失效，丢掉。
    // segments 也存下来,字幕重进页面后才有时间轴显示。
    var lite = (tracks || []).map(function (t) {
      var state = String((t && t.state) || "").trim();
      if (state !== "pending" && state !== "live" && state !== "saved" && state !== "failed") {
        state = (t && (t.cacheReady || t.fromHistory || t.status === "ready")) ? "saved" : ((t && (t.streamUrl || t.streaming || t.status === "running" || t.pendingBlob)) ? "live" : "pending");
      }
      return {
        cacheKey: t.cacheKey || "",
        voice: t.voice || "",
        mode: t.mode || "",
        state: state,
        createdAt: t.createdAt || Date.now(),
        voicesMap: t.voicesMap || null,
        metrics: t.metrics ? {
          first_pcm_s: t.metrics.first_pcm_s,
          total_wall_s: t.metrics.total_wall_s,
          audio_duration_s: t.metrics.audio_duration_s,
          rtf: t.metrics.rtf,
          performance_mode: t.metrics.performance_mode,
          diffusion_steps: t.metrics.diffusion_steps,
          segments_total: t.metrics.segments_total,
          segments_done: t.metrics.segments_done
        } : null,
        segments: (t.segments || []).map(function (s) {
          return { role: s.role || "", text: s.text || "", style: s.style || "neutral", style_alpha: s.style_alpha };
        }),
      };
    }).filter(function (t) { return !!t.cacheKey; });
    try { if (window.tavo && typeof tavo.set === "function") await tavo.set(key, lite, "chat"); } catch (_) {}
    try { localStorage.setItem(key, JSON.stringify(lite)); } catch (_) {}
  }
  function playIcon(state) { return state === "playing" ? '<svg viewBox="0 0 24 24"><path d="M7 5h4v14H7zm6 0h4v14h-4z"/></svg>' : '<svg viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg>'; }
  function loadingIcon() { return '<svg viewBox="0 0 24 24"><path d="M12 2a10 10 0 1 0 10 10h-3a7 7 0 1 1-7-7V2z"/></svg>'; }
  function gearIcon() { return '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="4" y1="7" x2="20" y2="7"/><line x1="4" y1="17" x2="20" y2="17"/><circle cx="9" cy="7" r="2.2"/><circle cx="15" cy="17" r="2.2"/></svg>'; }
  function formatTime(sec) { sec = Math.max(0, Number(sec || 0)); if (!isFinite(sec)) return "--:--"; return String(Math.floor(sec / 60)).padStart(2, "0") + ":" + String(Math.floor(sec % 60)).padStart(2, "0"); }
  function parseRoleVoices(text, voice) { var out = { default: voice }; String(text || "").split(/[\r\n,，;；]+/).forEach(function (line) { var m = line.trim().match(/^(.+?)[=:：]\s*(.+)$/); if (m) out[m[1].trim()] = m[2].trim(); }); return out; }
  async function listVoices(base) { try { var r = await fetch(cleanBase(base) + "/voices", { cache: "no-store" }); if (!r.ok) return []; var d = await r.json(); return Array.isArray(d.voices) ? d.voices : []; } catch (_) { return []; } }
  var STYLE_PRESETS = [
    { id: "neutral", label: "普通/平静", alpha: 0.20 },
    { id: "breath_soft", label: "轻微气声", alpha: 0.48 },
    { id: "breath_heavy", label: "明显喘息", alpha: 0.74 },
    { id: "intimate_breath", label: "亲密气声", alpha: 0.78 },
    { id: "moan_soft", label: "低声短吟", alpha: 0.82 },
    { id: "low_murmur", label: "压低呢喃", alpha: 0.58 },
    { id: "whisper_soft", label: "温柔耳语", alpha: 0.50 },
    { id: "shy_whisper", label: "害羞低语", alpha: 0.52 },
    { id: "tense_breath", label: "紧张呼吸", alpha: 0.50 },
    { id: "sob_soft", label: "委屈哽咽", alpha: 0.58 },
    { id: "cry_soft", label: "哭腔", alpha: 0.60 },
    { id: "tease_soft", label: "轻声撒娇", alpha: 0.52 },
    { id: "laugh_soft", label: "慵懒轻笑", alpha: 0.48 },
    { id: "gasp_surprise", label: "惊讶轻叹", alpha: 0.50 },
    { id: "stage_warmup", label: "亲密初段/轻气声", alpha: 0.55 },
    { id: "stage_rising", label: "升温段/呼吸变重", alpha: 0.76 },
    { id: "stage_peak", label: "高强度段/短促声腔", alpha: 0.86 },
    { id: "stage_afterglow", label: "余韵段/低声放松", alpha: 0.56 }
  ];
  function styleIdsText() { return STYLE_PRESETS.map(function (s) { return s.id + "=" + s.label + "(建议" + s.alpha + ")"; }).join(" / "); }
  function normalizeStyleId(style) {
    style = String(style || "neutral").trim();
    var ok = STYLE_PRESETS.some(function (s) { return s.id === style; });
    return ok ? style : "neutral";
  }
  function defaultStyleAlpha(style, cfg) {
    style = normalizeStyleId(style);
    var hit = STYLE_PRESETS.find(function (s) { return s.id === style; });
    if (hit) return hit.alpha;
    return Number(cfg.emoAlpha || 0.4);
  }
  function llmMaxTokensForText(text) {
    return Math.min(12000, Math.max(4000, Math.ceil(String(text || "").length * 5)));
  }
  function normalizeCoverageText(value) {
    return String(value || "")
      .replace(/[\s\u3000]/g, "")
      .replace(/[「」『』“”"‘’'（）()《》〈〉【】\[\]{}]/g, "")
      .replace(/[，。！？；：、,.!?;:…—\-~～·]/g, "");
  }
  function tailNarrationAfterQuote(value) {
    var text = String(value || "").trim();
    var lastClose = Math.max(
      text.lastIndexOf("」"),
      text.lastIndexOf("』"),
      text.lastIndexOf("”"),
      text.lastIndexOf("\"")
    );
    if (lastClose < 0 || lastClose >= text.length - 1) return "";
    var tail = text.slice(lastClose + 1).trim();
    if (!tail || !/[\u4e00-\u9fffA-Za-z0-9]/.test(tail)) return "";
    return tail;
  }
  function assertLlmSegmentsCoverSource(sourceText, segments) {
    var sourceNorm = normalizeCoverageText(sourceText);
    var joinedNorm = normalizeCoverageText((segments || []).map(function (s) { return s.text || ""; }).join(""));
    if (!sourceNorm || !joinedNorm) return;
    if (sourceNorm !== joinedNorm) {
      var tailLen = Math.min(32, sourceNorm.length);
      var sourceTail = sourceNorm.slice(-tailLen);
      var joinedTail = joinedNorm.slice(-tailLen);
      var diff = Math.abs(sourceNorm.length - joinedNorm.length);
      var tolerance = Math.max(12, Math.ceil(sourceNorm.length * 0.02));
      if (sourceTail !== joinedTail || diff > tolerance) {
        debugLog("⚠️ LLM 覆盖差异：原文约 " + sourceNorm.length + " 字，返回约 " + joinedNorm.length + " 字，差 " + diff + " 字。原文尾部=" + sourceTail + "；返回尾部=" + joinedTail, "#fc9");
        return;
      }
      debugLog("⚠️ LLM 覆盖校验发现轻微差异但已放行：原文约 " + sourceNorm.length + " 字，返回约 " + joinedNorm.length + " 字，差 " + diff + " 字。", "#fc9");
    }
    var tail = tailNarrationAfterQuote(sourceText);
    if (tail && segments && segments.length) {
      var last = segments[segments.length - 1];
      if ((last.role || "") !== "旁白") {
        debugLog("⚠️ LLM 尾段可能应为旁白：当前 role=" + (last.role || "?") + "，尾部=" + tail.slice(0, 40), "#fc9");
      }
    }
  }
  function escapeRegExpText(value) {
    return String(value || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }
  function quoteDepthAt(sourceText, idx) {
    var depth = 0;
    var asciiQuoteOpen = false;
    var text = String(sourceText || "");
    for (var i = 0; i < Math.max(0, idx); i++) {
      var ch = text.charAt(i);
      if (ch === "「" || ch === "『" || ch === "“") depth += 1;
      else if (ch === "」" || ch === "』" || ch === "”") depth = Math.max(0, depth - 1);
      else if (ch === '"') asciiQuoteOpen = !asciiQuoteOpen;
    }
    return depth + (asciiQuoteOpen ? 1 : 0);
  }
  function findSegmentTextInSource(sourceText, segmentText, fromIdx) {
    var text = String(segmentText || "").trim();
    if (!text) return -1;
    var src = String(sourceText || "");
    var idx = src.indexOf(text, Math.max(0, fromIdx || 0));
    if (idx >= 0) return idx;
    return src.indexOf(text);
  }
  function looksLikeNarrationSegment(text, role) {
    var s = String(text || "").trim();
    if (!s || /[「」『』“”"]/.test(s)) return false;
    var verbs = "(低下|抬起|低头|抬头|看着|望着|看见|听见|感觉|走|站|坐|躺|靠|伸|抱|搂|抓|攥|咬|闭|睁|转|笑|哭|喘|颤|缩|贴|凑|伏|跪|垂|松|捂|揉|摸|按|亲|吻|加快|放慢|停下|开始|尖叫|叫|张开|流|滴|仰|扭|摇|晃|动|沉浸|起伏)";
    if (new RegExp("^我" + verbs).test(s)) return true;
    if (new RegExp("^[他她它]" + verbs).test(s)) return true;
    role = String(role || "").trim();
    if (role && role !== "旁白" && role !== "用户") {
      return new RegExp("^" + escapeRegExpText(role) + verbs).test(s);
    }
    return false;
  }
  function singleParams(cfg, text) {
    var p = new URLSearchParams();
    p.set("text", text);
    p.set("ref_audio_path", cfg.defaultVoice);
    p.set("emo_text", "");
    p.set("emo_ref_audio_path", "");
    p.set("emo_alpha", String(cfg.emoAlpha));
    p.set("top_p", String(cfg.topP));
    p.set("top_k", String(cfg.topK));
    p.set("temperature", String(cfg.temperature));
    p.set("repetition_penalty", String(cfg.repetitionPenalty));
    return p;
  }
  function singleStreamUrl(base, cfg, text, force) {
    var p = singleParams(cfg, text);
    if (force) {
      p.set("bypass_cache", "1");
      p.set("_t", String(Date.now()));
    }
    return cleanBase(base) + cfg.endpoint + "?" + p.toString();
  }
  function singleDeleteUrl(base, cfg, text) {
    return cleanBase(base) + "/cache_tts_single?" + singleParams(cfg, text).toString();
  }
  function singleBody(cfg, text, force) {
    return {
      text: text,
      ref_audio_path: cfg.defaultVoice,
      emo_text: "",
      emo_ref_audio_path: "",
      emo_vec: [],
      normalize_emo_vec: false,
      top_p: cfg.topP,
      top_k: cfg.topK,
      temperature: cfg.temperature,
      repetition_penalty: cfg.repetitionPenalty,
      emo_alpha: cfg.emoAlpha,
      bypass_cache: !!force
    };
  }
  async function createSingleStreamJob(base, cfg, text, force) {
    var res = await fetch(cleanBase(base) + "/tts_stream_job", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(singleBody(cfg, text, force))
    });
    if (!res.ok) throw new Error(await res.text());
    var data = await res.json();
    if (!data || !data.url) throw new Error("后端没有返回流式播放地址。");
    return new URL(data.url, cleanBase(base) + "/").href;
  }

  async function createDialogueStreamJob(base, body) {
    var res = await fetch(cleanBase(base) + "/tts_dialogue_stream_job", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body)
    });
    if (!res.ok) throw new Error(await res.text());
    var data = await res.json();
    if (!data || !data.url) throw new Error("后端没有返回流式播放地址。");
    return {
      streamUrl: new URL(data.url, cleanBase(base) + "/").href,
      cacheUrl: data.cache_url ? new URL(data.cache_url, cleanBase(base) + "/").href : "",
      cacheKey: data.cache_key || "",
      cached: !!data.cached,
      live: !!data.live,
    };
  }

  function isMobileUA() {
    try { return /Android|iPhone|iPad|iPod|Mobile|Phone|MicroMessenger/i.test(navigator.userAgent || ""); }
    catch (_) { return false; }
  }

  // 在用户点击事件里同步创建并 resume AudioContext。iOS Safari 要求 audio
  // 必须在 user gesture 里激活；后面经过 await saveConfig / await parseWithLlm
  // 之后才创建的 ctx 会停在 suspended，永远不出声。
  var PRIMED_CTX = null;
  var PRIMED_UNLOCK_SOURCE = null;
  function primeAudioContext() {
    if (PRIMED_CTX) {
      try { if (PRIMED_CTX.state === "suspended") PRIMED_CTX.resume(); } catch (_) {}
      return PRIMED_CTX;
    }
    var AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    try {
      var ctx = new AC();
      // 立刻 resume + 播一段 1 帧静音解锁 iOS 音频通道
      try { ctx.resume(); } catch (_) {}
      try {
        var unlockRate = ctx.sampleRate || 44100;
        var b = ctx.createBuffer(1, Math.max(1, Math.floor(unlockRate * 0.03)), unlockRate);
        var ch = b.getChannelData(0);
        if (ch && ch.length) ch[0] = 0.0005;
        var s = ctx.createBufferSource();
        s.buffer = b; s.connect(ctx.destination); s.start(0);
        PRIMED_UNLOCK_SOURCE = s;
        s.onended = function () { if (PRIMED_UNLOCK_SOURCE === s) PRIMED_UNLOCK_SOURCE = null; };
      } catch (_) {}
      PRIMED_CTX = ctx;
      return ctx;
    } catch (_) { return null; }
  }

  // 真流式播放：用 Web Audio API 直接拉 chunked-WAV 的 ReadableStream，
  // 解析 WAV 头后把 PCM 块逐段塞进 AudioContext。完全不走 <audio> 元素，
  // 因此不受手机浏览器 "Content-Length 未知就报错" 的限制。
  // hooks: { onStateChange(state), onError(err), debug(text), playbackRate }
  async function streamWavViaWebAudio(streamUrl, hooks) {
    hooks = hooks || {};
    var playbackRate = Math.max(0.85, Math.min(1.25, Number(hooks.playbackRate || 1) || 1));
    var AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) throw new Error("浏览器不支持 Web Audio API");
    hooks.onStateChange && hooks.onStateChange("connecting");
    // 优先复用 user-gesture 里 prime 出来的 ctx；没有再 new 一个（桌面/file://
    // 这种没经过 gesture 的场景也能跑）。
    var ctx = PRIMED_CTX || new AC();
    try { if (ctx.state === "suspended") await ctx.resume(); }
    catch (e) { throw new Error("[step:resume] " + (e && e.message ? e.message : e)); }
    var output = ctx.createGain ? ctx.createGain() : null;
    if (output) {
      output.gain.value = 1;
      output.connect(ctx.destination);
    }
    var activeSources = [];
    var reader = null;
    var stopped = false;
    var stopReason = "";
    var endTimer = null;
    var started = false;
    var nextAt = 0;
    var playbackStartCtxTime = null;
    var readEnded = false;
    var bufferTimer = null;
    var bufferingState = false;
    var scheduledSpans = [];
    var scheduledAudioSec = 0;
    function getPlaybackTimeSec() {
      if (!started || !scheduledSpans.length) return 0;
      var now = 0;
      try { now = ctx.currentTime || 0; } catch (_) { now = 0; }
      for (var i = 0; i < scheduledSpans.length; i++) {
        var sp = scheduledSpans[i];
        if (now < sp.start) return sp.audioStart;
        if (now >= sp.start && now <= sp.end) return sp.audioStart + ((now - sp.start) * playbackRate);
      }
      return scheduledSpans[scheduledSpans.length - 1].audioEnd;
    }
    function armEndedWatcher() {
      if (endTimer) { try { clearInterval(endTimer); } catch (_) {} endTimer = null; }
      if (bufferTimer) { try { clearInterval(bufferTimer); } catch (_) {} bufferTimer = null; }
      endTimer = setInterval(function () {
        if (stopped) {
          try { clearInterval(endTimer); } catch (_) {}
          endTimer = null;
          return;
        }
        var now = 0;
        try { now = ctx.currentTime || 0; } catch (_) { now = 0; }
        // 用 AudioContext 时钟判断结束；WebView 暂停/弱网卡住时 currentTime 不会乱跑。
        if (nextAt && now + 0.03 >= nextAt) {
          try { clearInterval(endTimer); } catch (_) {}
          endTimer = null;
          hooks.onStateChange && hooks.onStateChange("ended");
        }
      }, 120);
    }
    function armBufferWatcher() {
      if (bufferTimer) return;
      bufferTimer = setInterval(function () {
        if (stopped || readEnded || !started) return;
        var now = 0;
        try { now = ctx.currentTime || 0; } catch (_) { now = 0; }
        var ahead = nextAt - now;
        if (ahead <= 0.04 && !bufferingState) {
          bufferingState = true;
          hooks.onStateChange && hooks.onStateChange("buffering");
        } else if (bufferingState && ahead >= 0.18) {
          bufferingState = false;
          hooks.onStateChange && hooks.onStateChange("resumed");
        }
      }, 120);
    }
    function makeAbortError(reason) {
      var e = new Error(reason || "播放已停止");
      e.name = "AbortError";
      return e;
    }
    function stopWebAudio(reason) {
      stopped = true;
      stopReason = reason || "播放已停止";
      if (endTimer) { try { clearInterval(endTimer); } catch (_) {} endTimer = null; }
      if (bufferTimer) { try { clearInterval(bufferTimer); } catch (_) {} bufferTimer = null; }
      activeSources.slice().forEach(function (node) { try { node.stop(0); } catch (_) {} });
      if (reader && typeof reader.cancel === "function") {
        try { reader.cancel(stopReason).catch(function () {}); } catch (_) {}
      }
      hooks.onStateChange && hooks.onStateChange("stopped");
    }
    if (hooks.onController) hooks.onController({ stop: stopWebAudio, getTimeSec: getPlaybackTimeSec });
    function connectNode(node) {
      node.connect(output || ctx.destination);
    }
    function keepSource(node) {
      activeSources.push(node);
      node.onended = function () {
        var idx = activeSources.indexOf(node);
        if (idx >= 0) activeSources.splice(idx, 1);
      };
    }
    if (hooks.debug) hooks.debug("AudioContext state=" + ctx.state + " sr=" + ctx.sampleRate);

    var res;
    try { res = await fetch(streamUrl); }
    catch (e) { throw new Error("[step:fetch] " + (e && e.message ? e.message : e)); }
    if (!res.ok) throw new Error("[step:fetch] HTTP " + res.status + " " + (await res.text().catch(function(){return"";})));
    hooks.onStateChange && hooks.onStateChange("connected");

    // 试 ReadableStream 真流式；如果 WebView 不支持 (常见于 iOS 老版 / 部分
    // Android WebView)，退回 arrayBuffer 全下载后整段解码播。
    var canStream = !!(res.body && typeof res.body.getReader === "function");
    if (canStream) {
      try { reader = res.body.getReader(); }
      catch (e) { canStream = false; hooks.debug && hooks.debug("getReader 抛异常, 退回 arrayBuffer: " + (e && e.message ? e.message : e)); }
    }

    if (!canStream) {
      hooks.debug && hooks.debug("无 ReadableStream 支持，走 arrayBuffer 整段解码");
      var ab;
      try { ab = await res.arrayBuffer(); }
      catch (e) { throw new Error("[step:arrayBuffer] " + (e && e.message ? e.message : e)); }
      var audioBuf;
      try { audioBuf = await ctx.decodeAudioData(ab.slice(0)); }
      catch (e) { throw new Error("[step:decodeAudioData] " + (e && e.message ? e.message : e)); }
      var src;
      try {
        src = ctx.createBufferSource();
        src.buffer = audioBuf;
        try { src.playbackRate.value = playbackRate; } catch (_) {}
        connectNode(src);
        keepSource(src);
        var fallbackStartAt = ctx.currentTime + 0.03;
        var dur = audioBuf.duration / playbackRate;
        playbackStartCtxTime = fallbackStartAt;
        nextAt = fallbackStartAt + dur;
        scheduledSpans.push({ start: fallbackStartAt, end: nextAt, audioStart: 0, audioEnd: audioBuf.duration });
        scheduledAudioSec = audioBuf.duration;
        started = true;
        src.start(fallbackStartAt);
      } catch (e) { throw new Error("[step:bufferSource.start] " + (e && e.message ? e.message : e)); }
      hooks.onStateChange && hooks.onStateChange("playing");
      armEndedWatcher();
      return { ctx: ctx, duration: dur, mode: "buffered" };
    }

    var pending = new Uint8Array(0);
    function appendPending(chunk) {
      if (!chunk || !chunk.length) return;
      var nb = new Uint8Array(pending.length + chunk.length);
      nb.set(pending); nb.set(chunk, pending.length); pending = nb;
    }
    async function pullMore() {
      try {
        if (stopped) throw makeAbortError(stopReason);
        var r = await reader.read();
        if (r.done) return false;
        appendPending(r.value);
        return true;
      } catch (e) { throw new Error("[step:reader.read] " + (e && e.message ? e.message : e)); }
    }
    function findDataOffset(arr) {
      for (var i = 12; i + 8 <= arr.length; i++) {
        if (arr[i] === 0x64 && arr[i+1] === 0x61 && arr[i+2] === 0x74 && arr[i+3] === 0x61) return i + 8;
      }
      return -1;
    }

    while (pending.length < 44) {
      if (stopped) throw makeAbortError(stopReason);
      if (!(await pullMore())) throw new Error("[step:wavHeader] WAV 头未到先断流");
    }
    var hv = new DataView(pending.buffer, pending.byteOffset, pending.byteLength);
    var channels = hv.getUint16(22, true);
    var sampleRate = hv.getUint32(24, true);
    var bitsPerSample = hv.getUint16(34, true);
    if (bitsPerSample !== 16) throw new Error("[step:wavHeader] 只支持 16-bit PCM, 实际 bits=" + bitsPerSample);
    var dataOff = findDataOffset(pending);
    while (dataOff < 0) {
      if (!(await pullMore())) throw new Error("[step:wavHeader] 没找到 WAV data 段就断流");
      dataOff = findDataOffset(pending);
    }
    if (hooks.debug) hooks.debug("WAV header parsed: sr=" + sampleRate + " ch=" + channels + " bits=" + bitsPerSample);
    hooks.onStateChange && hooks.onStateChange("waiting_pcm");
    var pcm = pending.slice(dataOff);
    pending = null;

    var startAt = ctx.currentTime + 0.06;
    nextAt = startAt;
    started = false;
    playbackStartCtxTime = null;
    var bytesPerSec = sampleRate * channels * 2;
    var blockAlign = Math.max(2 * channels, 2);
    var flushBytes = Math.max(8192, Math.floor(bytesPerSec * 0.35));
    flushBytes = flushBytes - (flushBytes % blockAlign);
    if (flushBytes < blockAlign) flushBytes = blockAlign;
    var startBufferBytes = Math.max(flushBytes, Math.floor(bytesPerSec * 0.65));
    startBufferBytes = startBufferBytes - (startBufferBytes % blockAlign);
    if (startBufferBytes < flushBytes) startBufferBytes = flushBytes;
    var interrupted = false;
    startAt = ctx.currentTime + 0.12;
    nextAt = startAt;

    async function ensureAudioContextRunning(step) {
      try {
        if (ctx.state === "suspended") {
          await ctx.resume();
          hooks.debug && hooks.debug(step + " resume AudioContext -> " + ctx.state);
        }
      } catch (e) {
        throw new Error("[step:" + step + ".resume] " + (e && e.message ? e.message : e));
      }
    }

    async function schedulePcm(bytes) {
      if (bytes.length < 2 * channels) return;
      try {
        if (stopped) throw makeAbortError(stopReason);
        await ensureAudioContextRunning("schedulePcm");
        var samples = Math.floor(bytes.length / (2 * channels));
        var aBuf = ctx.createBuffer(channels, samples, sampleRate);
        var view = new DataView(bytes.buffer, bytes.byteOffset, samples * 2 * channels);
        for (var c = 0; c < channels; c++) {
          var chan = aBuf.getChannelData(c);
          for (var i = 0; i < samples; i++) {
            chan[i] = view.getInt16((i * channels + c) * 2, true) / 32768;
          }
        }
        var src = ctx.createBufferSource();
        src.buffer = aBuf;
        try { src.playbackRate.value = playbackRate; } catch (_) {}
        connectNode(src);
        keepSource(src);
        var t = Math.max(nextAt, ctx.currentTime + 0.02);
        src.start(t);
        var realDur = aBuf.duration / playbackRate;
        var audioStart = scheduledAudioSec;
        var audioEnd = audioStart + aBuf.duration;
        nextAt = t + realDur;
        scheduledSpans.push({ start: t, end: nextAt, audioStart: audioStart, audioEnd: audioEnd });
        scheduledAudioSec = audioEnd;
        if (!started) {
          playbackStartCtxTime = t;
          started = true;
          hooks.onStateChange && hooks.onStateChange("playing");
          armBufferWatcher();
        } else if (bufferingState && nextAt - (ctx.currentTime || 0) >= 0.18) {
          bufferingState = false;
          hooks.onStateChange && hooks.onStateChange("resumed");
        }
      } catch (e) {
        throw new Error("[step:schedulePcm] " + (e && e.message ? e.message : e));
      }
    }

    function alignedLength(n) {
      n = Math.max(0, Math.floor(n || 0));
      return n - (n % blockAlign);
    }
    async function scheduleStartIfReady(force) {
      if (started || !pcm) return false;
      var needBytes = force ? blockAlign : startBufferBytes;
      if (pcm.length < needBytes) return false;
      var firstChunkBytes = force ? alignedLength(pcm.length) : alignedLength(Math.min(pcm.length, Math.max(startBufferBytes, flushBytes)));
      if (firstChunkBytes <= 0) return false;
      hooks.onStateChange && hooks.onStateChange("first_pcm");
      var firstSlice = pcm.slice(0, firstChunkBytes);
      pcm = pcm.slice(firstChunkBytes);
      await schedulePcm(firstSlice);
      return true;
    }

    while (true) {
      var r;
      try { r = await reader.read(); }
      catch (e) {
        if (stopped) throw makeAbortError(stopReason);
        if (started) {
          // 已经起播了。流被切到后台/导航等中断算正常退出，不要弹 UI 错误，
          // 已经调度进 AudioContext 的 buffer 会自然播完。
          interrupted = true;
          readEnded = true;
          hooks.onStateChange && hooks.onStateChange("interrupted");
          hooks.debug && hooks.debug("流中断但已起播，转后台保存: " + (e && e.message ? e.message : e));
          break;
        }
        hooks.onError && hooks.onError(e);
        throw new Error("[step:reader.read.loop] " + (e && e.message ? e.message : e));
      }
      if (r.done) { readEnded = true; break; }
      if (r.value && r.value.length) {
        var nb = new Uint8Array(pcm.length + r.value.length);
        nb.set(pcm); nb.set(r.value, pcm.length); pcm = nb;
      }
      await scheduleStartIfReady(false);
      while (started && pcm.length >= flushBytes) {
        var slice = pcm.slice(0, flushBytes);
        pcm = pcm.slice(flushBytes);
        await schedulePcm(slice);
      }
    }
    if (!started) await scheduleStartIfReady(true);
    if (pcm && pcm.length >= blockAlign) {
      var remainLen = alignedLength(pcm.length);
      if (remainLen > 0) await schedulePcm(pcm.slice(0, remainLen));
    }
    pcm = null;
    if (!started) throw new Error("[step:noAudio] 后端没有返回可播放音频");
    if (stopped) return { ctx: ctx, duration: Math.max(0, nextAt - startAt), mode: "streaming", stopped: true, interrupted: interrupted };

    var totalDur = Math.max(0, nextAt - startAt);
    armEndedWatcher();
    return { ctx: ctx, duration: totalDur, mode: "streaming", interrupted: interrupted };
  }

  async function parseWithLlm(text, cfg, setStatus, context) {
    var llmStart = Date.now();
    setStatus("步骤 1/3：连接 LLM…");
    debugLog("🤖 LLM 请求开始: model=" + cfg.llmModel + ", endpoint=" + cfg.llmEndpoint + ", textLen=" + text.length, "#ffd479");
    // 把当前角色映射的 role 名作为「已知角色」注入 prompt,让 LLM 输出的 role 字段
    // 跟前端 voicesMap 严格对齐(否则后端归一可能错位)。
    context = context || {};
    var userName = String(context.userName || "").trim();
    var currentCharacterName = String(context.characterName || "").trim();
    var knownRoles = ((cfg.roleVoiceList || []).map(function (r) { return String(r.role || "").trim(); }).filter(function (r) { return r && r !== "角色" && r !== "我"; }));
    if (knownRoles.indexOf("旁白") < 0) knownRoles.unshift("旁白");
    if (knownRoles.indexOf("用户") < 0) knownRoles.splice(1, 0, "用户");
    if (currentCharacterName && knownRoles.indexOf(currentCharacterName) < 0) knownRoles.push(currentCharacterName);
    var rolesHint = "已知角色名单(LLM 输出 role 字段必须从这里选,或者用剧情里出现的新人物名):\n  " + knownRoles.join(" / ") + "\n";
    var userAliasHint = "用户身份名: " + (userName || "未读取到") + "。只有原文中的「你」以及这个用户身份名明确指向玩家/读者时，role 才写 \"用户\"。";
    var characterHint = "当前角色名: " + (currentCharacterName || "未读取到") + "。原文第一人称「我」通常指当前角色或正在自述的人物，不要因为出现「我」就改成用户。";
    var prompt = [
      "你是中文小说→TTS 片段拆分器。只返回严格 JSON，不要任何解释，不要 ``` 代码块。",
      "",
      rolesHint,
      userAliasHint,
      characterHint,
      "输出格式：",
      "{\"segments\":[{\"role\":\"...\",\"text\":\"...\",\"style\":\"neutral\",\"style_alpha\":0.2,\"emo_vec\":[a,h,f,d,s,l,u,n]}]}",
      "",
      "拆段规则：",
      "1. 旁白（叙述、环境、动作描写、心理描写、无引号的第一人称自述）→ role 固定为 \"旁白\"。",
      "   如果叙述句的主体是「你」或用户身份名（例如「你抬头」「白夜雨抱住她」「白夜雨说」且白夜雨是用户身份名），role 必须写 \"用户\"，不要写旁白。",
      "   其他人物动作/心理描写即使能指向具体人物（例如「潘金莲低下头」「她笑了」「我低下头看着……」），只要不是直接说出口的话，都写 \"旁白\"，不要让角色认领旁白。",
      "   ⚠️ 旁白的 style 永远写 neutral，style_alpha 写 0.15，emo_vec 永远写 [0,0,0,0,0,0,0,1]（纯 neutral）。",
      "       旁白是叙述者，本身没情绪，跟着剧情起伏会做作；后端也会强制覆盖成中性。",
      "   ⚠️ 旁白连续多个句子，要按句号/问号/感叹号/分号 拆成多个旁白 segments，每段≤2 句。",
      "       不要把整段旁白合并成一条 segment 偷懒。例：「她抬头看了我一眼。她哭了。」要拆成两条。",
      "2. 人物直接说出口的话 → role 用说话人的名字。",
      "   - 如果说话人是「你」或用户身份名，role 统一写 \"用户\"（不写 \"你\"、不写用户身份名）。",
      "   - 不要把「我」当作用户；无引号的「我……」默认是第一人称叙述，role 写 \"旁白\"。只有明确处在引号/对白里的「我……」才按说话人归属。",
      "   - 其他人物优先从「已知角色名单」里挑名字;名单外的新人物用原文里的名字（如「林老师」「兰绯」「她」）。",
      "3. 「他说：」「她笑道：」「白夜雨说道：」这类引导句本身是旁白；后面引号里的直接台词才按说话人分配。只有「你说道：」「用户名说道：」这种用户动作引导句可写 role=\"用户\"。",
      "4. text 是要朗读的原文片段，保留标点和语气词（啊、嗯、……）。",
      "5. style 是段级声腔/呼吸参考，只能从这个枚举里选：" + styleIdsText(),
      "   - 旁白、客观描写、普通对白 → neutral。",
      "   - 只是轻微带气声/柔声 → breath_soft 或 whisper_soft。",
      "   - 语义里有急促呼吸、压抑紧张 → tense_breath。",
      "   - 明显呼吸加重但仍在说话 → breath_heavy。",
      "   - 亲密、贴耳、黏连、短促气声 → intimate_breath，style_alpha 0.70-0.82。",
      "   - 明显的「嗯、啊、唔、哈、呼、……」等短促气音/短吟，必须用 moan_soft 或 breath_heavy，不要写 neutral。",
      "   - 委屈、哭腔、鼻音 → sob_soft 或 cry_soft。",
      "   - 撒娇、轻笑、惊讶分别用 tease_soft / laugh_soft / gasp_surprise。",
      "   - 如果文本明显呈现亲密互动的强度变化，用阶段型 style：stage_warmup=轻微升温；stage_rising=呼吸变重；stage_peak=最高强度的短促声腔；stage_afterglow=余韵/低声放松。",
      "   - 普通对话优先 neutral；但带明显气音、短促反应、断续语气词的段落不要 neutral。",
      "",
      "完整性硬规则：",
      "- 必须覆盖输入原文 100%，按原文顺序输出，不要总结、改写、删字、漏掉最后一段。",
      "- 每个原文片段只能出现一次，不要把多段无关尾巴合并成一条对白。",
      "- 如果最后一个引号后还有动作/叙述/心理描写，最后一段必须是 role=\"旁白\"。",
      "- 不确定说话人时用 role=\"旁白\"，不要沿用上一句对白角色。",
      "",
      "emo_vec 是 8 维向量，必须严格按这个顺序：",
      "  [0]=angry 愤怒    [1]=happy 高兴    [2]=fear 恐惧     [3]=hate 反感",
      "  [4]=sad 悲伤      [5]=low 低落      [6]=surprise 惊讶 [7]=neutral 自然",
      "每个值 0-1。必须根据该段实际语义分析，不是随便填数。",
      "",
      "分析要求（极重要）：",
      "- 每段只激活 1-2 个最匹配的维度，其他全部写 0。多维齐动 = 模型会演得做作。",
      "  ❌ 错误示范：[0,0,0.4,0,0.5,0.6,0.3,0.1]（4 维齐动）",
      "  ✅ 正确示范：[0,0,0,0,0.7,0,0,0.3]（只 sad 主导 + 一点 neutral）",
      "- 平静叙述 / 客观描写 → [0,0,0,0,0,0,0,0.8]。不要混入别的。",
      "- 哭、自责 → sad 主导。例：[0,0,0,0,0.7,0,0,0.2]",
      "- 紧张、害怕 → fear 主导。例：[0,0,0.7,0,0,0,0,0.2]",
      "- 撒娇、温柔 → happy 适中。例：[0,0.4,0,0,0,0,0,0.5]",
      "- 愤怒、咆哮 → angry 主导。例：[0.8,0,0,0,0,0,0,0.1]",
      "- 不要每段写一样；不要全 0；维度数宁少勿多。",
      "",
      "每段可加 emo_alpha 字段（0.2-0.5），控制情绪强度：",
      "- 平静段写 0.2-0.3，正常对话 0.35-0.4，强烈情绪 0.45-0.5。",
      "- 不要超过 0.5，否则一定做作。",
      "style_alpha 控制声腔参考强度：neutral=0.15-0.25；轻微 style=0.45-0.60；明显 breath/moan style=0.70-0.86。stage_peak 可写 0.82-0.88，但不要超过 0.9。",
      "",
      "示例输入：",
      "她低着头，眼角有泪。「对不起，我真的撑不住了。」",
      (userName ? userName : "你") + "叹了口气，把手放在她肩上：「别哭。」",
      "示例输出：",
      "{\"segments\":[",
      "  {\"role\":\"旁白\",\"text\":\"她低着头，眼角有泪。\",\"style\":\"neutral\",\"style_alpha\":0.15,\"emo_vec\":[0,0,0,0,0,0,0,1]},",
      "  {\"role\":\"她\",\"text\":\"对不起，我真的撑不住了。\",\"style\":\"sob_soft\",\"style_alpha\":0.58,\"emo_vec\":[0,0,0.2,0,0.7,0.4,0,0]},",
      "  {\"role\":\"用户\",\"text\":\"" + (userName ? userName : "你") + "叹了口气，把手放在她肩上：\",\"style\":\"neutral\",\"style_alpha\":0.15,\"emo_vec\":[0,0,0,0,0,0,0,1]},",
      "  {\"role\":\"用户\",\"text\":\"别哭。\",\"style\":\"whisper_soft\",\"style_alpha\":0.45,\"emo_vec\":[0,0.2,0,0,0.3,0.2,0,0.5]}",
      "]}"
    ].join("\n");
    setStatus("AI 分析中…");
    var maxTokens = llmMaxTokensForText(text);
    var parseUrl = cleanBase(cfg.apiBase) + cfg.parseEndpoint;
    var llmTarget = "LLM endpoint(后端访问): " + cfg.llmEndpoint;
    debugLog("🔎 LLM 解析代理: parseUrl=" + parseUrl + ", " + llmTarget, "#ffd479");
    var res;
    try {
      res = await fetch(parseUrl, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text: text, endpoint: cfg.llmEndpoint, model: cfg.llmModel, api_key: cfg.llmApiKey || "", system_prompt: prompt, temperature: 0.2, timeout: 90, max_tokens: maxTokens }) });
    } catch (e) {
      throw new Error(formatNetworkError("LLM 解析代理 /parse_text", parseUrl, e, [
        llmTarget,
        "说明: 这里失败的是浏览器到 IndexTTS 后端 /parse_text 的请求,还没进入 LLM 解析。"
      ]));
    }
    if (!res.ok) throw new Error(formatHttpError("LLM 解析代理 /parse_text", parseUrl, res, await res.text(), [llmTarget]));
    var data;
    try {
      data = await res.json();
    } catch (e) {
      throw new Error("LLM 解析代理 /parse_text 返回的不是合法 JSON。\n请求 URL: " + parseUrl + "\n" + llmTarget + "\n解析错误: " + (e && e.message ? e.message : e));
    }
    if (!data || !Array.isArray(data.segments) || !data.segments.length) throw new Error("AI 没有返回可用片段");
    var llmSec = Math.floor((Date.now() - llmStart) / 1000);
    setStatus("拆分完成 " + data.segments.length + " 段");
    debugLog("✅ LLM 返回 " + data.segments.length + " 段, 用时 " + llmSec + "s", "#9f9");
    try {
      data.segments.forEach(function (s, i) {
        var ev = (s.emo_vec || []).map(function (v) { return Number(v).toFixed(2); }).join(",");
        debugLog("  [raw " + i + "] role=" + (s.role || "?") + "  style=" + normalizeStyleId(s.style || s.style_ref) + (s.style_alpha != null ? "  sα=" + s.style_alpha : "") + "  emo=[" + ev + "]" + (s.emo_alpha != null ? "  α=" + s.emo_alpha : "") + "  text=" + JSON.stringify(String(s.text || "").slice(0, 40)));
      });
    } catch (_) {}
    var sourceSearchOffset = 0;
    var normalizedSegments = data.segments.map(function (seg) {
      var style = normalizeStyleId(seg.style || seg.style_ref);
      var styleAlpha = Number(seg.style_alpha);
      if (!isFinite(styleAlpha)) styleAlpha = defaultStyleAlpha(style, cfg);
      styleAlpha = Math.max(0, Math.min(0.9, styleAlpha));
      var role = String(seg.role || "旁白").trim();
      if (role === "你" || role === "user" || role === "User" || (userName && role === userName)) role = "用户";
      if (role && role !== "旁白" && role !== "用户") {
        var segTextForRole = String(seg.text || "");
        var sourceIdx = findSegmentTextInSource(text, segTextForRole, sourceSearchOffset);
        if (sourceIdx >= 0) {
          sourceSearchOffset = sourceIdx + segTextForRole.length;
          if (quoteDepthAt(text, sourceIdx) === 0 && looksLikeNarrationSegment(segTextForRole, role)) {
            debugLog("↩️ 纠正旁白归属: role=" + role + " → 旁白 text=" + JSON.stringify(segTextForRole.slice(0, 32)), "#fc9");
            role = "旁白";
            style = "neutral";
            styleAlpha = 0.15;
          }
        }
      }
      return {
        role: role || "旁白",
        text: seg.text || "",
        style: style,
        style_alpha: styleAlpha,
        emo_vec: seg.emo_vec || [0,0,0,0,0,0,0,0.35],
        emo_alpha: Number(seg.emo_alpha || cfg.emoAlpha || 0.4)
      };
    }).filter(function (seg) { return seg.text.trim(); });
    assertLlmSegmentsCoverSource(text, normalizedSegments);
    return normalizedSegments;
  }

  function removeLegacyGlobalGear() {
    var btn = document.getElementById("indextts-tavo-global-gear");
    if (btn && btn.parentNode) btn.parentNode.removeChild(btn);
  }

  function mount(root, cfg, context) {
    var characterId = (context && context.characterId) ? String(context.characterId) : "";
    var messageText = context && context.text ? context.text : "";
    var avatarUrl = context && context.avatarUrl ? context.avatarUrl : "";
    var userAvatarUrl = context && context.userAvatarUrl ? context.userAvatarUrl : "";
    var messageId = context && context.messageId ? context.messageId : "";
    root.innerHTML = [
      '<div class="idx-card">',
      '  <button class="idx-gear" type="button" data-role="gear" aria-label="设置">' + gearIcon() + '</button>',
      '  <div class="idx-card-counter" data-role="counter">0/0</div>',
      '  <div class="idx-top"><div class="idx-cover" data-role="cover"></div><div class="idx-info"><div class="idx-title-row"><div class="idx-name" data-role="title"></div></div><div class="idx-status" data-role="status">选择音色后点播放</div></div></div>',
      '  <div class="idx-seek-wrap"><input class="idx-seek" data-role="seek" type="range" min="0" max="1000" value="0" disabled><div class="idx-time"><span data-role="current">00:00</span><span data-role="total">--:--</span></div></div>',
      '  <div class="idx-subtitle" data-role="subtitle"><div class="idx-sub-notice"><strong>历史音频 0 条</strong><span>点音符生成新的音频</span></div></div>',
      '  <div class="idx-controls"><button class="idx-ctrl idx-ctrl-sm" type="button" data-role="prev" aria-label="上一首" title="上一首"><svg viewBox="0 0 24 24"><path d="M6 6h2v12H6zm3.5 6 8.5 6V6z"/></svg></button><button class="idx-ctrl idx-ctrl-main" type="button" data-role="play" data-state="idle" aria-label="播放">' + playIcon("idle") + '</button><button class="idx-ctrl idx-ctrl-sm" type="button" data-role="next" aria-label="下一首" title="下一首"><svg viewBox="0 0 24 24"><path d="M16 6h2v12h-2zm-10.5 0v12l8.5-6z"/></svg></button><button class="idx-ctrl idx-ctrl-add" type="button" data-role="add" aria-label="生成音频" title="生成音频"><svg viewBox="0 0 24 24"><path d="M12 3v9.55A4 4 0 1 0 14 16V7h4V3z"/></svg></button><button class="idx-ctrl idx-ctrl-delete" type="button" data-role="delete" aria-label="删除当前音频" title="删除当前音频"><svg viewBox="0 0 24 24"><path d="M9 3h6l1 2h4v2H4V5h4l1-2zm1 6h2v8h-2V9zm4 0h2v8h-2V9zM7 9h2v8H7V9zm1 11c-1.1 0-2-.9-2-2V8h12v10c0 1.1-.9 2-2 2H8z"/></svg></button></div>',
      '  <dialog class="idx-panel" data-role="panel">'
        + '<div class="idx-panel-head"><div class="idx-panel-title">语音设置</div><button class="idx-close" type="button" data-role="close">×</button></div>'
        + '<div class="idx-section-title">播放模式</div>'
        + '<div class="idx-modes"><button class="idx-mode" data-mode="single" type="button"><strong>单音色</strong><span>不走 LLM，整段使用当前音色</span></button><button class="idx-mode" data-mode="ai8" type="button"><strong>多音色</strong><span>第三方 AI 拆旁白/人物并输出 style + emo_vec</span></button></div>'
        // 单音色模式专属 —— mode==="single" 时显示
        + '<div class="idx-single-only"><div class="idx-section-title">音色选择</div><div class="idx-default-voice"><button class="idx-voice-btn" type="button" data-role="default-voice-btn">选择音色…</button></div></div>'
        // AI 八情绪专属 —— mode==="ai8" 时显示；切换不清空（输入值在 readFields 时已存入 cfg）
        + '<div class="idx-ai8-only">'
          + '<div class="idx-section-title">角色音色映射</div>'
          + '<div class="idx-roles" data-role="roles-list"></div>'
          + '<button class="idx-add-role" type="button" data-role="add-role">+ 添加角色</button>'
          + '<details class="idx-llm-details"><summary>LLM 配置</summary><div class="idx-grid">'
            + '<label class="idx-field idx-wide"><span class="idx-label">LLM 接口地址（写到 /v1 即可，会自动补全 /chat/completions）</span><input class="idx-input" data-field="llmEndpoint" placeholder="http://127.0.0.1:8317/v1"></label>'
            + '<label class="idx-field"><span class="idx-label">LLM 模型</span><input class="idx-input" data-field="llmModel" placeholder="渡鸦/grok-4.20-fast"></label>'
            + '<label class="idx-field"><span class="idx-label">LLM Key</span><input class="idx-input" type="password" data-field="llmApiKey" placeholder="sk-..."></label>'
            + '<label class="idx-field"><span class="idx-label">播放语速</span><input class="idx-input" type="number" min="0.85" max="1.25" step="0.01" data-field="speedFactor" placeholder="1.08"></label>'
            + '<label class="idx-field"><span class="idx-label">合成档位</span><select class="idx-input" data-field="qualityMode"><option value="fast">极速</option><option value="balanced">平衡</option><option value="expressive">质量</option></select></label>'
          + '</div></details>'
        + '</div>'
        + '<div class="idx-actions"><button class="idx-btn" type="button" data-role="save">保存</button></div>'
        + '</dialog>'
        // 音色选择器:模态弹窗,走原生 dialog top-layer,跟设置面板同级
        + '<dialog class="idx-picker" data-role="voice-picker">'
          + '<div class="idx-picker-head"><div class="idx-picker-title">选择音色</div><button class="idx-picker-close" type="button">×</button></div>'
          + '<div class="idx-picker-tabs" data-role="picker-tabs"></div>'
          + '<input class="idx-input idx-picker-search" type="text" placeholder="搜索音色名…" data-role="picker-search">'
          + '<div class="idx-picker-grid" data-role="picker-grid"></div>'
          + '<div class="idx-picker-pager"><button type="button" data-role="picker-prev">‹</button><span data-role="picker-page">1 / 1</span><button type="button" data-role="picker-next">›</button></div>'
        + '</dialog>',
      '  <audio data-role="audio" preload="none"></audio><div class="idx-error idx-hidden" data-role="error"></div>',
      '</div>'
    ].join("");

    var audio = first(root, '[data-role="audio"]', 'audio');
    var preview = null;
    var play = first(root, '[data-role="play"]', '.idx-ctrl-main');
    var prev = first(root, '[data-role="prev"]');
    var next = first(root, '[data-role="next"]');
    var add = first(root, '[data-role="add"]');
    var del = first(root, '[data-role="delete"]');
    var status = first(root, '[data-role="status"]', '.idx-status');
    var title = first(root, '[data-role="title"]', '.idx-name');
    var cover = first(root, '[data-role="cover"]', '.idx-cover');
    var counter = first(root, '[data-role="counter"]', '.idx-card-counter');
    var err = first(root, '[data-role="error"]', '.idx-error');
    var seek = first(root, '[data-role="seek"]', '.idx-seek');
    var cur = first(root, '[data-role="current"]', '.idx-time span:first-child');
    var total = first(root, '[data-role="total"]', '.idx-time span:last-child');
    var panel = first(root, '[data-role="panel"]', '.idx-panel');
    var gear = first(root, '[data-role="gear"]', '.idx-gear');
    var close = first(root, '[data-role="close"]', '.idx-close');
    // TAVO 容器树上很可能有 transform 祖先(scale / translate),会让 panel/picker
    // 的 position:fixed 误以为相对那个祖先(被截一半)。把它们直接挂到 body 上
    // 彻底逃离变形上下文。下次脚本重载会先清掉旧实例避免叠加。
    try {
      var STALE_HOST_ATTR = 'data-indextts-host';
      Array.prototype.slice.call(document.body.querySelectorAll('[' + STALE_HOST_ATTR + ']')).forEach(function (el) { try { el.remove(); } catch (_) {} });
      if (panel) { panel.setAttribute(STALE_HOST_ATTR, '1'); document.body.appendChild(panel); }
      var pickerNode = first(root, '[data-role="voice-picker"]');
      if (pickerNode) { pickerNode.setAttribute(STALE_HOST_ATTR, '1'); document.body.appendChild(pickerNode); }
    } catch (_) {}
    var voicesBox = first(root, '[data-role="voices"]', '.idx-voices');
    var voicePill = first(root, '[data-role="voice-pill"]');
    var modePill = first(root, '[data-role="mode-pill"]');
    var generatedTracks = [];
    var currentTrackIndex = -1;
    var currentCacheKey = "";
    var webAudioController = null;
    var webAudioPlayToken = 0;
    var webAudioProgressTimer = null;

    if (!panel) throw new Error("TAVO player missing settings panel");
    removeLegacyGlobalGear();

    function setStatus(v) {
      if (!status) return;
      status.textContent = v == null ? "" : String(v);
      // 文字溢出才滚动。停留长 + 步长大 → 不抖。
      try {
        if (status.__idxScrollTimer) { clearInterval(status.__idxScrollTimer); status.__idxScrollTimer = null; }
        status.scrollLeft = 0;
        requestAnimationFrame(function () {
          if (!status) return;
          var excess = status.scrollWidth - status.clientWidth;
          if (excess > 16) {  // 容差大一点,小溢出不滚省得抖
            status.style.overflowX = "hidden";
            status.style.whiteSpace = "nowrap";
            status.style.textOverflow = "clip";
            var direction = 1, holdEnd = 60, holdStart = 60;  // 60×80ms = 4.8s 停留
            var maxScroll = excess;  // 锁死最大位移
            status.__idxScrollTimer = setInterval(function () {
              if (!status || !document.body.contains(status)) {
                clearInterval(status.__idxScrollTimer); status.__idxScrollTimer = null; return;
              }
              if (direction === 1) {
                if (status.scrollLeft >= maxScroll) {
                  status.scrollLeft = maxScroll;  // 钳位防抖
                  if (holdEnd-- > 0) return;
                  direction = -1; holdEnd = 60;
                } else {
                  status.scrollLeft = Math.min(status.scrollLeft + 2, maxScroll);
                }
              } else {
                if (status.scrollLeft <= 0) {
                  status.scrollLeft = 0;
                  if (holdStart-- > 0) return;
                  direction = 1; holdStart = 60;
                } else {
                  status.scrollLeft = Math.max(status.scrollLeft - 2, 0);
                }
              }
            }, 80);  // 80ms / 步,慢一些更顺
          } else {
            status.style.textOverflow = "ellipsis";
          }
        });
      } catch (_) {}
    }
    function historyStatusText() {
      var total = generatedTracks.length;
      if (!total) return "历史音频 0 条";
      var idx = currentTrackIndex >= 0 ? currentTrackIndex + 1 : total;
      return "历史音频 " + total + " 条 · 当前 " + idx + "/" + total;
    }
    function updateTrackCounter() {
      var total = generatedTracks.length;
      var idx = total && currentTrackIndex >= 0 ? currentTrackIndex + 1 : 0;
      if (counter) counter.textContent = idx + "/" + total;
    }
    function setError(v) {
      if (err) { err.textContent = ""; err.classList.add("idx-hidden"); }
      if (v) showTrackNotice(currentTrack(), "发生错误", String(v));
    }
    function currentTrack() { return currentTrackIndex >= 0 ? generatedTracks[currentTrackIndex] : null; }
    function currentVoicesMap(track) {
      return (track && track.voicesMap) || rolesListToVoicesMap(cfg.roleVoiceList, cfg.defaultVoice);
    }
    function voiceNameForRole(role, track) {
      var voices = currentVoicesMap(track);
      role = String(role || "").trim();
      return (role && voices[role]) || voices.default || cfg.defaultVoice || "";
    }
    function displayRoleName(role) {
      role = String(role || "").trim();
      if (role === "用户") return (context && context.userName) ? context.userName : "用户";
      return role || "旁白";
    }
    function playbackLabelForRole(role, track) {
      role = String(role || "").trim() || "多音色";
      var voice = voiceNameForRole(role, track);
      return displayRoleName(role) + (voice ? " / " + shortName(voice) : "");
    }
    function trackPlaybackLabel(track) {
      if (!track) return shortName(cfg.defaultVoice);
      if (track.mode === "ai8") {
        var role = lastSpeakerRole || ((track.segments && track.segments[0] && track.segments[0].role) || "");
        return role ? playbackLabelForRole(role, track) : "多音色";
      }
      return shortName((track && track.voice) || cfg.defaultVoice);
    }
    function setPlayingStatusForRole(role, track) {
      setStatus("正在播放：" + playbackLabelForRole(role, track || currentTrack()));
    }
    function setAudioPlaybackRate() {
      try { audio.playbackRate = clampNumber(cfg.speedFactor || 1.08, 1.08, 0.85, 1.25); } catch (_) {}
    }
    function startElementAudioFrom(track, startSec) {
      if (!track || !trackPlayableUrl(track)) return false;
      stopWebAudioPlayback("switch");
      var url = trackPlayableUrl(track);
      if ((audio.currentSrc || audio.src || "") !== url) {
        audio.src = url;
        try { audio.load(); } catch (_) {}
      }
      setAudioPlaybackRate();
      if (seek) seek.disabled = false;
      if (startSec != null && isFinite(Number(startSec))) {
        var target = Math.max(0, Number(startSec));
        try {
          if (isFinite(audio.duration) && audio.duration > 0) target = Math.min(target, Math.max(0, audio.duration - 0.05));
          audio.currentTime = target;
        } catch (_) {}
      }
      setStatus("正在加载音频…");
      showTrackNotice(track, "正在加载音频…", shouldUseElementForSavedTrack(track) ? "已加载音频，支持拖动" : "马上开始播放");
      setPlayState("loading");
      audio.play().catch(function (err) { handleAudioPlayReject("element", err, "请点播放继续"); });
      return true;
    }
    function isUnsupportedPlayError(err) {
      var name = err && err.name ? String(err.name) : "";
      var msg = err && err.message ? String(err.message) : String(err || "");
      return name === "NotSupportedError" || /not supported/i.test(msg);
    }
    function handleAudioPlayReject(label, err, fallbackStatus) {
      if (err && err.name === "AbortError") return;
      if (isUnsupportedPlayError(err)) {
        debugLog("⚠️ " + label + " audio.play() 不支持: " + (err && err.message ? err.message : err), "#fc9");
        setStatus(fallbackStatus || "当前 WebView 不支持 audio 直播，等待 Web Audio/请点播放");
        return;
      }
      debugLog("❌ " + label + " audio.play() reject: " + err, "#f99");
      setStatus(fallbackStatus || "请点播放继续");
    }
    function friendlyPlaybackError(err) {
      var msg = String((err && err.message) || err || "");
      if (/noAudio|没有返回可播放音频/i.test(msg)) return "后端没有返回音频，请重新生成一次。";
      if (/fetch|network|Load failed|Failed to fetch/i.test(msg)) return "连接音频流失败。弱网下请稍后重试；如果持续失败，再检查服务地址和后端日志。";
      if (/decodeAudioData|WAV|wavHeader|data 段/i.test(msg)) return "音频流格式异常，请重新生成一次。";
      if (/resume|AudioContext/i.test(msg)) return "浏览器没有放行音频播放，请点一次播放按钮重试。";
      return msg.replace(/\[step:[^\]]+\]\s*/g, "") || "播放失败，请重新生成一次。";
    }
    function setPlayState(state) { if (play) { play.dataset.state = state; play.innerHTML = state === "loading" ? loadingIcon() : playIcon(state); play.disabled = false; } if (cover) cover.dataset.playing = state === "playing" ? "1" : "0"; }
    function updateTrackButtons() {
      var track = currentTrack();
      if (prev) prev.disabled = currentTrackIndex <= 0;
      if (next) next.disabled = currentTrackIndex < 0 || currentTrackIndex >= generatedTracks.length - 1;
      if (del) del.disabled = currentTrackIndex < 0 || !track;
      updateTrackCounter();
    }
    function clearWebAudioProgressTimer() {
      if (webAudioProgressTimer) {
        try { clearInterval(webAudioProgressTimer); } catch (_) {}
        webAudioProgressTimer = null;
      }
    }
    function clearElementAudioSrc() {
      try { audio.pause(); } catch (_) {}
      try { audio.removeAttribute("src"); audio.load(); } catch (_) {}
    }
    function setTrackState(track, state) {
      if (!track) return "";
      state = state || "pending";
      track.state = state;
      if (state === "saved") {
        track.status = "ready";
        track.pendingBlob = false;
        track.streaming = false;
        if (track.cacheUrl || track.fromHistory) track.cacheReady = true;
      } else if (state === "live") {
        track.status = "running";
        track.pendingBlob = true;
        track.streaming = true;
      } else if (state === "failed") {
        track.status = "failed";
        track.pendingBlob = false;
        track.streaming = false;
      } else {
        track.status = "pending";
        track.pendingBlob = true;
      }
      return state;
    }
    function trackState(track) {
      if (!track) return "pending";
      var s = String(track.state || "").trim();
      if (s === "pending" || s === "live" || s === "saved" || s === "failed") return s;
      if (track.status === "failed") return setTrackState(track, "failed");
      if (track.cacheReady || track.fromHistory || track.status === "ready" || (track.url && !track.streaming && !track.pendingBlob)) return setTrackState(track, "saved");
      if (track.streamUrl || track.streaming || track.status === "running" || track.pendingBlob) return setTrackState(track, "live");
      return setTrackState(track, "pending");
    }
    function isSavedTrack(track) { return trackState(track) === "saved"; }
    function isLiveTrack(track) { return trackState(track) === "live"; }
    function trackPlayableUrl(track) {
      if (!track) return "";
      if (isSavedTrack(track)) return track.url || track.cacheUrl || track.streamUrl || "";
      if (isLiveTrack(track)) return track.streamUrl || track.url || "";
      return track.url || "";
    }
    function shouldUseWebAudioForLiveTrack(track) {
      return !!(isMobileUA() && track && track.mode === "ai8" && isLiveTrack(track) && track.streamUrl);
    }
    function shouldUseElementForSavedTrack(track) {
      return isSavedTrack(track);
    }
    function savedTrackLabel(track) {
      return shouldUseElementForSavedTrack(track) ? "音频已保存" : "音频已就绪";
    }
    function waitingLabelForTrack(track) {
      if (shouldUseElementForSavedTrack(track)) return "缓冲中…";
      if (track && track.mode === "single") return "正在生成单音色音频…";
      return "正在等待音频…";
    }
    function qualityModeLabel(mode) {
      mode = String(mode || "");
      if (mode === "fast") return "极速";
      if (mode === "expressive") return "质量";
      return "平衡";
    }
    function formatJobMetrics(metrics) {
      if (!metrics) return "";
      function num(v) { v = Number(v); return isFinite(v) ? v : null; }
      var parts = [];
      var first = num(metrics.first_pcm_s);
      var total = num(metrics.total_wall_s);
      var dur = num(metrics.audio_duration_s);
      var rtf = num(metrics.rtf);
      var wallRtf = num(metrics.wall_rtf);
      var steps = num(metrics.diffusion_steps);
      var firstTokens = num(metrics.first_tokens);
      var s2mel = num(metrics.s2mel_s);
      var condition = num(metrics.condition_s);
      var done = num(metrics.segments_done);
      var all = num(metrics.segments_total);
      if (metrics.performance_mode) parts.push("档位 " + qualityModeLabel(metrics.performance_mode));
      if (steps != null) parts.push("steps " + steps);
      if (firstTokens != null) parts.push("首段 " + firstTokens);
      if (first != null) parts.push("首音 " + first.toFixed(1) + "s");
      if (rtf != null) parts.push("RTF " + rtf.toFixed(2));
      if (wallRtf != null && wallRtf !== rtf) parts.push("全程RTF " + wallRtf.toFixed(2));
      if (s2mel != null && s2mel > 0) parts.push("s2mel " + s2mel.toFixed(1) + "s");
      if (condition != null && condition > 0) parts.push("条件 " + condition.toFixed(1) + "s");
      if (dur != null && dur > 0) parts.push("音频 " + dur.toFixed(1) + "s");
      if (total != null) parts.push("总耗时 " + total.toFixed(1) + "s");
      if (done != null && all != null && all > 0) parts.push("段 " + done + "/" + all);
      return parts.join(" · ");
    }
    async function askPlaySavedTrack(track) {
      if (!track || track.savePromptAsked || currentTrack() !== track || !isSavedTrack(track)) return;
      track.savePromptAsked = true;
      var choice = null;
      try {
        if (window.tavo && tavo.utils && typeof tavo.utils.select === "function") {
          choice = await tavo.utils.select([
            { value: "play", label: "直接播放", description: "切到已保存音频，支持拖动进度条" },
            { value: "wait", label: "继续等待", description: "保持当前流式播放，不切换" }
          ], "音频已保存，是否直接播放？", "play");
        } else if (typeof window.confirm === "function") {
          choice = window.confirm("音频已保存，是否直接播放已保存音频？") ? "play" : "wait";
        }
      } catch (e) {
        debugLog("⚠️ 保存音频弹窗失败: " + (e && e.message ? e.message : e), "#fc9");
      }
      if (choice !== "play" || currentTrack() !== track || !isSavedTrack(track)) return;
      var resumeSec = 0;
      try {
        if (webAudioController && typeof webAudioController.getTimeSec === "function") resumeSec = webAudioController.getTimeSec();
        else if (track.lastWebAudioSec != null) resumeSec = Number(track.lastWebAudioSec) || 0;
      } catch (_) { resumeSec = 0; }
      stopWebAudioPlayback("switch");
      startElementAudioFrom(track, resumeSec);
    }
    function isNetworkStreamError(err) {
      var msg = String((err && err.message) || err || "");
      if (/\[step:fetch\]\s+HTTP\s+\d+/i.test(msg)) return false;
      return /\[step:(fetch|reader\.read|reader\.read\.loop)\]|Load failed|Failed to fetch|NetworkError|network/i.test(msg);
    }
    function markWebAudioStopped(track) {
      generatedTracks.forEach(function (t) { if (t) t.webAudioPlaying = false; });
      if (track) track.webAudioPlaying = false;
    }
    function stopWebAudioPlayback(reason) {
      webAudioPlayToken++;
      if (webAudioController && typeof webAudioController.stop === "function") {
        try { webAudioController.stop(reason || "停止播放"); } catch (_) {}
      }
      webAudioController = null;
      clearWebAudioProgressTimer();
      markWebAudioStopped(currentTrack());
      stopSubtitle();
      if (reason && reason !== "switch" && reason !== "replace" && reason !== "silent") {
        setPlayState("idle");
        setStatus(reason === "pause" ? "已暂停" : "播放已停止");
      }
    }
    function startWebAudioProgress(token, startedAt, playbackRate, track) {
      clearWebAudioProgressTimer();
      webAudioProgressTimer = setInterval(function () {
        if (token !== webAudioPlayToken) { clearWebAudioProgressTimer(); return; }
        var sec = 0;
        try {
          if (webAudioController && typeof webAudioController.getTimeSec === "function") sec = webAudioController.getTimeSec();
          else {
            var now = (typeof performance !== "undefined" ? performance.now() : Date.now());
            sec = Math.max(0, ((now - startedAt) / 1000) * playbackRate);
          }
        } catch (_) { sec = 0; }
        if (cur) cur.textContent = formatTime(sec);
        if (track) track.lastWebAudioSec = sec;
      }, 250);
    }
    async function playTrackViaWebAudio(track, url, opts) {
      opts = opts || {};
      if (!track || !url) return false;
      stopWebAudioPlayback("replace");
      var token = ++webAudioPlayToken;
      var playbackRate = clampNumber(cfg.speedFactor || 1.08, 1.08, 0.85, 1.25);
      var startedAt = 0;
      var waitStartedAt = Date.now();
      var waitTimer = null;
      function stopWaitTimer() {
        if (waitTimer) { try { clearInterval(waitTimer); } catch (_) {} waitTimer = null; }
      }
      track.webAudioPlaying = false;
      track.streamInterrupted = false;
      clearElementAudioSrc();
      if (seek) { seek.disabled = true; seek.value = "0"; }
      if (cur) cur.textContent = "00:00";
      if (total) total.textContent = "--:--";
      setError("");
      setPlayState("loading");
      setStatus(opts.connectingStatus || "正在连接音频…");
      showTrackNotice(track, opts.noticeTitle || "正在连接音频…", opts.noticeDetail || "等待后端返回声音");
      waitTimer = setInterval(function () {
        if (token !== webAudioPlayToken) { stopWaitTimer(); return; }
        if (track.webAudioPlaying) return;
        var sec = Math.max(1, Math.floor((Date.now() - waitStartedAt) / 1000));
        setStatus("等待首段音频 " + sec + "s…");
        showTrackNotice(track, "等待首段音频 " + sec + "s…", opts.waitDetail || "弱网或后端合成较慢");
      }, 1000);
      try {
        await streamWavViaWebAudio(url, {
          playbackRate: playbackRate,
          onController: function (controller) {
            if (token === webAudioPlayToken) webAudioController = controller;
          },
          onStateChange: function (state) {
            if (token !== webAudioPlayToken) return;
            if (state === "connecting") {
              setStatus("正在连接音频…");
              showTrackNotice(track, "正在连接音频…", "弱网下可能需要多等几秒");
            } else if (state === "connected" || state === "waiting_pcm") {
              setStatus("等待首段音频…");
              showTrackNotice(track, "等待首段音频…", opts.waitDetail || "后端正在合成第一段");
            } else if (state === "first_pcm") {
              setStatus("收到音频，正在缓冲…");
              showTrackNotice(track, "收到音频", "缓冲一小段后起播");
            } else if (state === "playing") {
              stopWaitTimer();
              track.webAudioPlaying = true;
              setPlayState("playing");
              setStatus("正在播放：" + trackPlaybackLabel(track));
              setError("");
              debugLog("▶️ Web Audio 首块已起播", "#9f9");
              startedAt = (typeof performance !== "undefined" ? performance.now() : Date.now());
              startWebAudioProgress(token, startedAt, playbackRate, track);
              startSubtitle(track, function () {
                if (webAudioController && typeof webAudioController.getTimeSec === "function") return webAudioController.getTimeSec();
                return ((((typeof performance !== "undefined" ? performance.now() : Date.now()) - startedAt) / 1000) * playbackRate);
              });
            } else if (state === "buffering") {
              track.savePromptWanted = true;
              setPlayState("loading");
              setStatus("网络缓冲中…");
              showTrackNotice(track, "网络缓冲中…", "歌词会停在当前播放位置");
            } else if (state === "resumed") {
              setPlayState("playing");
              setStatus("正在播放：" + trackPlaybackLabel(track));
            } else if (state === "interrupted") {
              stopWaitTimer();
              track.streamInterrupted = true;
              track.savePromptWanted = true;
              setStatus("网络不稳，转后台保存…");
              showTrackNotice(track, "网络不稳，转后台保存…", "合成任务还在跑，保存后会询问是否直接播放");
              if (isSavedTrack(track)) {
                askPlaySavedTrack(track).catch(function(e){ debugLog("⚠️ 已保存播放弹窗失败: " + (e && e.message ? e.message : e), "#fc9"); });
              } else if (track.cacheKey) {
                pollCacheUpgrade(track, "weak-net snapshot");
              }
            } else if (state === "stopped") {
              stopWaitTimer();
              markWebAudioStopped(track);
              clearWebAudioProgressTimer();
            } else if (state === "ended") {
              stopWaitTimer();
              markWebAudioStopped(track);
              webAudioController = null;
              clearWebAudioProgressTimer();
              setPlayState("idle");
              stopSubtitle();
              if (track.streamInterrupted && !isSavedTrack(track)) {
                setStatus("网络中断，等待音频保存…");
                showTrackNotice(track, "网络中断，等待音频保存…", "保存完成后会询问是否直接播放");
              } else {
                var saved = shouldUseElementForSavedTrack(track);
                setStatus(saved ? "播放完成，音频已保存" : "播放完成，等待音频保存…");
                showTrackNotice(track, "播放完成", saved ? "点播放可重播" : "正在后台保存");
              }
            }
          },
          onError: function (e) { debugLog("❌ Web Audio 错误: " + (e && e.message ? e.message : e), "#f99"); },
          debug: function (text) { debugLog("[wa] " + text, "#9ff"); }
        });
        return true;
      } catch (e) {
        stopWaitTimer();
        if (token !== webAudioPlayToken) return false;
        var msg = String((e && e.message) || e || "");
        markWebAudioStopped(track);
        webAudioController = null;
        clearWebAudioProgressTimer();
        stopSubtitle();
        if ((e && e.name === "AbortError") || /播放已停止|停止播放/i.test(msg)) {
          setPlayState("idle");
          return false;
        }
        if (isNetworkStreamError(e) && track.cacheKey) {
          track.streamInterrupted = true;
          track.savePromptWanted = true;
          setPlayState("idle");
          setError("");
          if (shouldUseElementForSavedTrack(track)) {
            setStatus("网络不稳，音频已保存");
            showTrackNotice(track, "网络不稳，音频已保存", "正在询问是否直接播放");
            askPlaySavedTrack(track).catch(function(e){ debugLog("⚠️ 已保存播放弹窗失败: " + (e && e.message ? e.message : e), "#fc9"); });
          } else {
            setTrackState(track, "live");
            setStatus("网络不稳，后台合成中…");
            showTrackNotice(track, "网络不稳，后台合成中…", "这张音频不会丢，保存后会询问是否直接播放");
            pollCacheUpgrade(track, "weak-net snapshot");
          }
          debugLog("⚠️ Web Audio 连接中断，保留 cacheKey 等待落盘: " + msg, "#fc9");
          return false;
        }
        var friendly = friendlyPlaybackError(e);
        setPlayState("idle");
        setStatus("播放失败");
        setError(friendly);
        showTrackNotice(track, "播放失败", friendly);
        debugLog("❌ Web Audio 流式异常: " + msg, "#f99");
        return false;
      }
    }
    async function refreshTrackFromStatus(track, label) {
      if (!track || !track.cacheKey || track.deleted) return false;
      try {
        var st = await fetch(cleanBase(cfg.apiBase) + "/tts_dialogue_job_status/" + encodeURIComponent(track.cacheKey), { cache: "no-store" });
        if (!st.ok) return false;
        var j = await st.json();
        if (j && j.metrics) track.metrics = j.metrics;
        if (j && j.cache_url) track.cacheUrl = new URL(j.cache_url, cleanBase(cfg.apiBase) + "/").href;
        if (j && Array.isArray(j.segments_meta) && j.segments_meta.length) {
          track.segments = j.segments_meta.map(function (s) {
            return { role: s.role || "", text: s.text || "", style: s.style || "neutral", style_alpha: s.style_alpha };
          });
        }
        if (j && j.state === "done") {
          setTrackState(track, "saved");
          attachCacheAudio(track, { deferElement: true });
          if (messageId) saveTracksForMessage(messageId, generatedTracks).catch(function(){});
          debugLog("✅ " + (label || "track") + " 已保存，切换为历史音频", "#9f9");
          return true;
        }
        if (j && j.state === "failed") {
          track.error = j.error || "服务端生成失败";
          setTrackState(track, "failed");
          return true;
        }
      } catch (e) {
        debugLog("⚠️ 检查历史音频状态失败: " + (e && e.message ? e.message : e), "#fc9");
      }
      return false;
    }
    async function selectTrack(index, autoplay) {
      if (index < 0 || index >= generatedTracks.length) return;
      var track = generatedTracks[index];
      currentTrackIndex = index;
      currentCacheKey = track.cacheKey || "";
      var state = trackState(track);
      // 切卡前先清掉旧 audio 状态(防止旧的 currentTime/duration 串到新卡片)
      try { audio.pause(); } catch (_) {}
      stopWebAudioPlayback("switch");
      stopSubtitle();
      hideSubtitlePanel();
      var srcUrl = "";
      // 统一先重置进度条/时间显示
      if (seek) { seek.value = "0"; }
      if (cur) cur.textContent = "00:00";
      if (total) total.textContent = "--:--";
      if (state === "live" && track.cacheKey && !track.deleted) {
        setStatus("检查历史音频…");
        showTrackNotice(track, "检查历史音频…", "如果已保存，会直接切到可拖动音频");
        await refreshTrackFromStatus(track, "select snapshot");
        state = trackState(track);
      }
      srcUrl = trackPlayableUrl(track);
      debugLog("🎯 selectTrack idx=" + index + " state=" + state + " urlSource=" + (srcUrl === track.url ? "url" : srcUrl === track.cacheUrl ? "cacheUrl" : srcUrl === track.streamUrl ? "streamUrl" : "none") + " src=" + srcUrl, "#9ff");
      if (srcUrl) {
        if (shouldUseWebAudioForLiveTrack(track)) {
          clearElementAudioSrc();
          if (seek) { seek.disabled = true; seek.value = "0"; }
          if (cur) cur.textContent = "00:00";
          if (total) total.textContent = "--:--";
          if (autoplay) {
            setStatus("等待首段音频…");
            showTrackNotice(track, "等待首段音频…", "正在连接流式音频");
            playTrackViaWebAudio(track, srcUrl, { noticeTitle: "等待首段音频…", noticeDetail: "正在连接流式音频", waitDetail: "正在合成第一段" });
          } else {
            setStatus(historyStatusText());
            showTrackNotice(track, "流式生成中", "点播放继续等待");
          }
          updateTrackButtons();
          return;
        }
        audio.src = srcUrl;
        setAudioPlaybackRate();
        // 强制重新加载 metadata,避免浏览器复用上次缓存的 duration/seekable
        try { audio.load(); } catch (_) {}
        if (seek) { seek.disabled = false; }
        if (autoplay) {
          setStatus("正在加载音频…");
          showTrackNotice(track, "正在加载音频…", shouldUseElementForSavedTrack(track) ? "已加载音频，支持拖动" : "马上开始播放");
        } else {
          setStatus(historyStatusText());
          showTrackNotice(track, savedTrackLabel(track), shouldUseElementForSavedTrack(track) ? "点播放开始，可拖动进度条" : "点播放开始");
        }
        updateTrackButtons();
        if (autoplay) audio.play().catch(function (err) { handleAudioPlayReject("element", err, "请点播放继续"); });
        return;
      }
      // 都没有 URL —— 该 track 是占位
      try { audio.removeAttribute('src'); audio.load(); } catch (_) {}
      if (seek) { seek.disabled = true; }
      if (state === "failed") {
        showTrackNotice(track, "生成失败", track.error || "请重新生成一次");
        setStatus("生成失败");
      } else if (state === "live") {
        showTrackNotice(track, "流式生成中", "等待音频保存或继续播放");
        setStatus(historyStatusText());
      } else {
        showTrackNotice(track, track.noticeTitle || "音频尚未就绪", track.noticeDetail || "生成完成后会自动显示歌词");
        setStatus(historyStatusText());
      }
      updateTrackButtons();
    }
    function attachCacheAudio(track, opts) {
      opts = opts || {};
      if (!track || !track.cacheUrl) return false;
      track.url = track.cacheUrl;
      setTrackState(track, "saved");
      if (currentTrackIndex >= 0 && generatedTracks[currentTrackIndex] === track) {
        updateTrackButtons();
        if (track.webAudioPlaying && !opts.forceElement) return true;
        if (opts.deferElement) {
          setStatus("音频已保存，可重播");
          showTrackNotice(track, "音频已保存", formatJobMetrics(track.metrics) || "点播放可重播");
          return true;
        }
        try {
          var currentSrc = audio.currentSrc || audio.src || "";
          if (currentSrc !== track.cacheUrl) {
            audio.src = track.cacheUrl;
            audio.load();
            if (seek) seek.value = "0";
            if (cur) cur.textContent = "00:00";
          }
          if (seek) seek.disabled = false;
          if (opts.autoplay) {
            setAudioPlaybackRate();
            audio.play().catch(function (err) { handleAudioPlayReject("cache", err, "缓存已就绪，点播放继续"); });
          }
        } catch (e) {
          debugLog("❌ 挂载 cache audio 失败: " + (e && e.message ? e.message : e), "#f99");
        }
      } else {
        updateTrackButtons();
      }
      return true;
    }
    function pollCacheUpgrade(trackEntry, label) {
      if (!trackEntry || !trackEntry.cacheKey || trackEntry.cachePollStarted || isSavedTrack(trackEntry)) return;
      trackEntry.cachePollStarted = true;
      label = label || "snapshot";
      (async function () {
        var done = false;
        for (var i = 0; i < 240; i++) {
          if (trackEntry.deleted) { done = true; break; }
          try {
            var st = await fetch(cleanBase(cfg.apiBase) + "/tts_dialogue_job_status/" + encodeURIComponent(trackEntry.cacheKey), { cache: "no-store" });
            if (st.ok) {
              var j = await st.json();
              if (j && j.metrics) {
                trackEntry.metrics = j.metrics;
              }
              if (j && j.cache_url) {
                trackEntry.cacheUrl = new URL(j.cache_url, cleanBase(cfg.apiBase) + "/").href;
              }
              if (j && Array.isArray(j.segments_meta) && j.segments_meta.length && (!trackEntry.segments || !trackEntry.segments.length)) {
                trackEntry.segments = j.segments_meta.map(function (s) {
                  return { role: s.role || "", text: s.text || "", style: s.style || "neutral", style_alpha: s.style_alpha };
                });
              }
              if (j && j.state === "done") {
                var shouldAskPlaySaved = currentTrack() === trackEntry && !!(trackEntry.savePromptWanted || trackEntry.streamInterrupted);
                setTrackState(trackEntry, "saved");
                attachCacheAudio(trackEntry, { forceElement: false, deferElement: trackEntry.webAudioPlaying });
                if (messageId) saveTracksForMessage(messageId, generatedTracks).catch(function(){});
                debugLog("✅ " + label + " 已落盘，cacheUrl 已写回卡片", "#9f9");
                var metricsLine = formatJobMetrics(trackEntry.metrics);
                if (metricsLine) debugLog("📊 " + label + " 指标: " + metricsLine, "#9ff");
                if (shouldAskPlaySaved) askPlaySavedTrack(trackEntry).catch(function(e){ debugLog("⚠️ 已保存播放弹窗失败: " + (e && e.message ? e.message : e), "#fc9"); });
                done = true;
                break;
              }
              if (j && j.state === "failed") {
                setTrackState(trackEntry, "failed");
                debugLog("❌ 服务端推理失败: " + (j.error || ""), "#f99");
                break;
              }
            }
          } catch (e) {
            debugLog("⚠️ " + label + " 状态轮询失败: " + (e && e.message ? e.message : e), "#fc9");
          }
          await new Promise(function(r){ setTimeout(r, 1000); });
        }
        if (!done && !trackEntry.deleted && !isSavedTrack(trackEntry)) {
          trackEntry.cachePollStarted = false;
          debugLog("⚠️ " + label + " 等待落盘超时，cacheKey=" + trackEntry.cacheKey, "#fc9");
        }
      })();
    }
    async function confirmDeleteTrack(track) {
      if (!track) return false;
      var label = generatedTracks.length ? ((currentTrackIndex + 1) + "/" + generatedTracks.length) : "当前音频";
      try {
        if (window.tavo && tavo.utils && typeof tavo.utils.select === "function") {
          var choice = await tavo.utils.select([
            { value: "cancel", label: "取消", description: "保留这条历史音频" },
            { value: "delete", label: "确认删除", description: "删除当前卡片和关联缓存" }
          ], "删除 " + label + "？", "cancel");
          return choice === "delete";
        }
      } catch (e) {
        debugLog("⚠️ 删除确认弹窗失败: " + (e && e.message ? e.message : e), "#fc9");
      }
      return typeof window.confirm === "function" ? window.confirm("确认删除当前音频？这会删除历史记录和关联缓存。") : true;
    }
    async function deleteRemoteTrack(track) {
      if (!track) return;
      var base = cleanBase(cfg.apiBase);
      try {
        if (track.cacheKey) {
          await fetch(base + "/tts_dialogue_stream_job/" + encodeURIComponent(track.cacheKey), { method: "DELETE" }).catch(function () {});
          await fetch(base + "/cache/" + encodeURIComponent(track.cacheKey), { method: "DELETE" }).catch(function () {});
        } else if (track.deleteUrl) {
          await fetch(track.deleteUrl, { method: "DELETE" }).catch(function () {});
        }
      } catch (e) {
        debugLog("⚠️ 删除服务端关联缓存失败: " + (e && e.message ? e.message : e), "#fc9");
      }
    }
    async function clearCurrentTrack() {
      if (currentTrackIndex < 0) return;
      var target = currentTrack();
      if (!await confirmDeleteTrack(target)) return;
      var removed = generatedTracks.splice(currentTrackIndex, 1)[0];
      if (removed) removed.deleted = true;
      try { audio.pause(); } catch (_) {}
      stopWebAudioPlayback("switch");
      if (removed && removed.url && /^blob:/i.test(removed.url)) {
        try { URL.revokeObjectURL(removed.url); } catch (_) {}
      }
      deleteRemoteTrack(removed).catch(function () {});
      // 删除后同步把变更写回 tavo.set，下次进页面就不会再看到这张卡片
      if (messageId) {
        saveTracksForMessage(messageId, generatedTracks).catch(function(){});
        debugLog("🗑 删除卡片并同步 tavo.set（剩 " + generatedTracks.length + " 张）", "#fc9");
      }
      currentTrackIndex = Math.min(currentTrackIndex, generatedTracks.length - 1);
      if (currentTrackIndex >= 0) {
        await selectTrack(currentTrackIndex, false);
      } else {
        audio.removeAttribute("src");
        audio.load();
        currentCacheKey = "";
        if (seek) { seek.disabled = true; seek.value = "0"; }
        if (cur) cur.textContent = "00:00";
        if (total) total.textContent = "--:--";
        setPlayState("idle");
        setStatus("历史音频 0 条");
        showTrackNotice(null, "历史音频 0 条", "点音符生成新的音频");
        updateTrackButtons();
      }
    }
    function findInWidget(sel) { return $(root, sel) || $(panel, sel); }
    function field(name) { return findInWidget('[data-field="' + name + '"]'); }
    // IME-safe setField：用户正在输入或中文输入法组词时，不覆盖 input.value，
    // 否则搜狗/微软等 IME 的候选词会被清掉，导致打不进字。
    function setField(name, value) {
      var el = field(name); if (!el) return;
      if (document.activeElement === el) return;            // 正在输入
      if (el.__indexttsComposing) return;                    // 中文输入法组词中
      var v = value == null ? "" : value;
      if (el.value !== String(v)) el.value = v;
    }
    function getField(name, fallback) { var el = field(name); return el ? el.value : fallback; }
    function clampNumber(value, fallback, min, max) {
      var n = Number(value);
      if (!isFinite(n)) n = fallback;
      return Math.max(min, Math.min(max, n));
    }
    function readFields() {
      cfg.apiBase = String(getField("apiBase", cfg.apiBase || scriptOrigin())).trim() || scriptOrigin();
      cfg.intervalMs = Number(getField("intervalMs", cfg.intervalMs || 50) || 50);
      cfg.speedFactor = clampNumber(getField("speedFactor", cfg.speedFactor || 1.08), 1.08, 0.85, 1.25);
      cfg.qualityMode = String(getField("qualityMode", cfg.qualityMode || "balanced") || "balanced").trim();
      if (["fast", "balanced", "expressive"].indexOf(cfg.qualityMode) < 0) cfg.qualityMode = "balanced";
      try { audio.playbackRate = cfg.speedFactor; } catch (_) {}
      // cfg.roleVoiceList 由 renderRoleList 实时维护(addRoleRow/setRowVoice 等),
      // 这里把行里的角色名/音色同步抓一遍(防止用户没失焦就保存)。
      var rows = $all(panel, '.idx-role-row');
      var newList = [];
      rows.forEach(function (row) {
        var nameEl = first(row, '.idx-role-name');
        var role = nameEl ? String(nameEl.value || "").trim() : "";
        var voice = row.dataset.voice || "";
        if (role || voice) newList.push({ role: role, voice: voice });
      });
      if (newList.length) cfg.roleVoiceList = newList;
      cfg.roleVoicesText = serializeRoleVoiceList(cfg.roleVoiceList);  // 同步序列化兜底
      cfg.llmModel = String(getField("llmModel", cfg.llmModel || "")).trim();
      cfg.llmEndpoint = String(getField("llmEndpoint", cfg.llmEndpoint || "")).trim();
      cfg.llmApiKey = String(getField("llmApiKey", cfg.llmApiKey || "")).trim();
    }
    function modeName() { return cfg.mode === "ai8" ? "多音色" : "单音色"; }
    function syncUI() {
      setField("apiBase", cfg.apiBase || scriptOrigin());
      setField("intervalMs", Number(cfg.intervalMs || 50));
      setField("llmModel", cfg.llmModel || "");
      setField("llmEndpoint", cfg.llmEndpoint || "");
      setField("llmApiKey", cfg.llmApiKey || "");
      setField("speedFactor", cfg.speedFactor || 1.08);
      setField("qualityMode", cfg.qualityMode || "balanced");
      try { audio.playbackRate = clampNumber(cfg.speedFactor || 1.08, 1.08, 0.85, 1.25); } catch (_) {}
      renderRoleList();
      // AI 八情绪 设置只在该模式下显示；单音色配置反之
      try {
        var ai8Show = (cfg.mode === "ai8");
        $all(panel, '.idx-ai8-only').forEach(function (el) { el.style.display = ai8Show ? "" : "none"; });
        $all(panel, '.idx-single-only').forEach(function (el) { el.style.display = ai8Show ? "none" : ""; });
      } catch (_) {}
      // 当前 mode 按钮高亮
      try {
        $all(panel, '.idx-mode').forEach(function (b) {
          if (b.dataset.mode === cfg.mode) b.setAttribute("data-active", "1"); else b.removeAttribute("data-active");
        });
      } catch (_) {}
      if (voicePill) voicePill.textContent = "音色：" + shortName(cfg.defaultVoice);
      if (modePill) modePill.textContent = "模式：" + modeName();
      if (title) title.textContent = (context && context.characterName ? context.characterName : shortName(cfg.defaultVoice));
      if (cover) {
        if (avatarUrl) {
          cover.textContent = "";
          cover.style.backgroundImage = "url(\"" + String(avatarUrl).replace(/"/g, "%22") + "\")";
          cover.style.backgroundSize = "cover";
          cover.style.backgroundPosition = "center";
        } else {
          cover.style.backgroundImage = "";
          cover.textContent = (context && context.characterName ? context.characterName : shortName(cfg.defaultVoice)).slice(0, 1) || "";
        }
      }
      $all(panel, '.idx-mode').forEach(function (b) { b.classList.toggle('is-active', b.dataset.mode === cfg.mode); });
      $all(panel, '.idx-voice').forEach(function (b) { b.classList.toggle('is-active', b.dataset.voice === cfg.defaultVoice); });
    }
    var availableVoices = [];
    function voiceCategoryRank(subdir) {
      subdir = String(subdir || "");
      if (subdir === "女声") return 0;
      if (subdir === "男声") return 1;
      if (subdir === "情绪") return 2;
      if (subdir === "声腔") return 3;
      if (subdir === "喘息") return 4;
      if (!subdir) return 99;
      return 50;
    }
    function sortVoices(list) {
      return (list || []).slice().sort(function (a, b) {
        var ra = voiceCategoryRank(a && a.subdir);
        var rb = voiceCategoryRank(b && b.subdir);
        if (ra !== rb) return ra - rb;
        var sa = String((a && a.subdir) || "");
        var sb = String((b && b.subdir) || "");
        if (sa !== sb) return sa.localeCompare(sb, "zh-Hans-CN");
        return String((a && a.name) || "").localeCompare(String((b && b.name) || ""), "zh-Hans-CN");
      });
    }
    async function renderVoices() {
      setStatus("正在读取音色列表...");
      var voices = await listVoices(cfg.apiBase);
      availableVoices = sortVoices(voices);
      if (!cfg.defaultVoice && availableVoices[0]) cfg.defaultVoice = availableVoices[0].name;
      // 旧 voicesBox grid 已经被"默认音色按钮"替代,这里只更新按钮文本
      var defBtn = first(panel, '[data-role="default-voice-btn"]');
      if (defBtn) defBtn.textContent = cfg.defaultVoice ? cfg.defaultVoice : "选择默认音色…";
      syncUI();
      setStatus(historyStatusText());
      if (!generatedTracks.length) showTrackNotice(null, "历史音频 0 条", voices.length ? "已就绪，可生成新的音频" : "没有找到可用音色");
    }
    async function previewVoice() {
      if (!cfg.defaultVoice) return;
    if (preview) { try { preview.pause(); } catch (_) {} }
      preview = new Audio(cleanBase(cfg.apiBase) + "/voice_preview?name=" + encodeURIComponent(cfg.defaultVoice));
      setStatus("正在试听：" + shortName(cfg.defaultVoice));
      preview.addEventListener('ended', function () { setStatus("试听完成"); });
      preview.addEventListener('error', function () { setStatus("试听失败"); });
      try { await preview.play(); } catch (_) { setStatus("试听失败，请点一下页面后重试"); }
    }

    // ───── 实时字幕控制器 ───── (按当前播放时间显示对应 segment 的角色头像+台词)
    var DEFAULT_AVATARS = {
      narrator: cleanBase(cfg.apiBase || scriptOrigin()) + "/prompts/icon/narrator-transparent.png",
      user:     'data:image/svg+xml;charset=utf-8,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 512 512"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#1f3a5a"/><stop offset="1" stop-color="#0e1f33"/></linearGradient></defs><rect width="512" height="512" fill="url(#g)"/><text x="256" y="330" font-family="Microsoft YaHei,sans-serif" font-size="180" fill="#a5d4ff" text-anchor="middle" font-weight="bold">用</text></svg>'),
      character:'data:image/svg+xml;charset=utf-8,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 512 512"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#5a2240"/><stop offset="1" stop-color="#33152a"/></linearGradient></defs><rect width="512" height="512" fill="url(#g)"/><text x="256" y="330" font-family="Microsoft YaHei,sans-serif" font-size="180" fill="#ffd4e8" text-anchor="middle" font-weight="bold">人</text></svg>')
    };
    function avatarForRole(role) {
      if (role === "旁白") return DEFAULT_AVATARS.narrator;
      if (role === "用户") return userAvatarUrl || DEFAULT_AVATARS.user;
      // 角色/人物头像优先用当前 TAVO 角色头像
      return avatarUrl || DEFAULT_AVATARS.character;
    }
    var subBox = first(root, '[data-role="subtitle"]');
    function showSubtitleNotice(titleText, detailText) {
      if (!subBox) return;
      subBox.classList.remove('idx-hidden');
      subBox.innerHTML = '<div class="idx-sub-notice"><strong>' + escapeHtml(titleText || "") + '</strong>' + (detailText ? '<span>' + escapeHtml(detailText) + '</span>' : '') + '</div>';
    }
    function hideSubtitlePanel() {
      stopSubtitle();
      showSubtitleNotice("未播放音频", historyStatusText());
    }
    function showTrackNotice(track, titleText, detailText) {
      if (track) {
        track.noticeTitle = titleText || "";
        track.noticeDetail = detailText || "";
      }
      if (currentTrack() === track || !track) showSubtitleNotice(titleText, detailText);
    }

    // 拆碎长文本成约 12-22 字的小段(歌词风格,一行可读)。
    // 1) 按句末标点切; 2) 还长就按逗号切; 3) 还长按 20 字硬切;
    // 4) 极短碎片(<=3 字)合并到前一行尾部,避免单字行。
    function splitLyricLines(s) {
      var raw = String(s || "").trim();
      if (!raw) return [];
      var stage1 = raw.split(/(?<=[。！？!?；;…])\s*|\n+/).map(function (x) { return x.trim(); }).filter(Boolean);
      var out = [];
      stage1.forEach(function (p) {
        if (p.length <= 22) { out.push(p); return; }
        var stage2 = p.split(/(?<=[，,、])\s*/).map(function (x) { return x.trim(); }).filter(Boolean);
        stage2.forEach(function (q) {
          if (q.length <= 22) { out.push(q); return; }
          for (var i = 0; i < q.length; i += 20) out.push(q.slice(i, i + 20));
        });
      });
      var merged = [];
      out.forEach(function (s) {
        if (merged.length && s.length <= 3) merged[merged.length - 1] += s;
        else merged.push(s);
      });
      return merged.length ? merged : [raw];
    }

    var activeSubtitle = null;
    function clearSubtitleDom() { if (subBox) subBox.innerHTML = ""; }
    function stopSubtitle() {
      if (!activeSubtitle) return;
      if (activeSubtitle.tickHandle) clearInterval(activeSubtitle.tickHandle);
      if (activeSubtitle.pollHandle) clearInterval(activeSubtitle.pollHandle);
      activeSubtitle = null;
    }

    function renderSubtitleRows(timeline, resetScroll) {
      if (!subBox) return;
      subBox.classList.remove('idx-hidden');
      // 头像不进歌词区(占空间)。说话人通过左上角 cover 切换体现。
      subBox.innerHTML = timeline.map(function (row, idx) {
        var text = String(row.text || "");
        return '<div class="idx-sub-row" data-idx="' + idx + '" data-start="' + row.start.toFixed(3) + '" data-role-name="' + escapeHtml(displayRoleName(row.role || "旁白")) + '" title="点击跳转到这一句">'
          + '<span class="idx-sub-text">' + escapeHtml(text) + '</span>'
          + '</div>';
      }).join("");
      if (resetScroll) { try { subBox.scrollTop = 0; } catch (_) {} }
      $all(subBox, '.idx-sub-row').forEach(function (row) {
        on(row, 'click', function () {
          var startSec = parseFloat(row.dataset.start || "0");
          try {
            if (audio && audio.src && isFinite(audio.duration) && audio.duration > 0) {
              audio.currentTime = Math.min(Math.max(0, startSec), audio.duration - 0.05);
              if (audio.paused) audio.play().catch(function () {});
            }
          } catch (_) {}
        });
      });
    }

    // 当前说话人 → 左上角 cover + 标题同步
    var lastSpeakerRole = "";
    function syncHeaderToSpeaker(role, text) {
      role = role || "";
      if (role && role !== lastSpeakerRole) {
        lastSpeakerRole = role;
        try {
          if (cover) {
            cover.textContent = "";
            cover.style.backgroundImage = "url(\"" + avatarForRole(role).replace(/"/g, "%22") + "\")";
            cover.style.backgroundSize = "cover";
            cover.style.backgroundPosition = "center";
          }
          if (title) title.textContent = displayRoleName(role);
        } catch (_) {}
      }
      if (role && (audio && !audio.paused || (currentTrack() && currentTrack().webAudioPlaying))) {
        setPlayingStatusForRole(role);
      }
      // 同步给系统媒体面板(后台/锁屏可见 + 控制)
      try { updateMediaSession(role, text); } catch (_) {}
    }
    function mediaArtworkType(src) {
      src = String(src || "");
      if (/^data:image\/svg\+xml/i.test(src) || /\.svg(?:[?#]|$)/i.test(src)) return "image/svg+xml";
      if (/\.png(?:[?#]|$)/i.test(src) || /^data:image\/png/i.test(src)) return "image/png";
      if (/\.(?:jpg|jpeg)(?:[?#]|$)/i.test(src) || /^data:image\/jpe?g/i.test(src)) return "image/jpeg";
      if (/\.webp(?:[?#]|$)/i.test(src) || /^data:image\/webp/i.test(src)) return "image/webp";
      return "";
    }
    function updateMediaSession(speakerRole, currentText) {
      if (!navigator.mediaSession || typeof MediaMetadata === "undefined") return;
      try {
        var ms = navigator.mediaSession;
        var charName = (context && context.characterName) ? context.characterName : (cfg.defaultVoice || "IndexTTS");
        var artSrc = avatarForRole(speakerRole || "旁白");
        var artType = mediaArtworkType(artSrc);
        ms.metadata = new MediaMetadata({
          title: (currentText ? String(currentText).slice(0, 60) : charName),
          artist: charName,
          album: "IndexTTS",
          artwork: [
            { src: artSrc, sizes: "96x96",  type: artType },
            { src: artSrc, sizes: "256x256", type: artType },
            { src: artSrc, sizes: "512x512", type: artType },
          ],
        });
        ms.setActionHandler('play',  function () { try { generate(false).catch(function(){}); } catch (_) {} });
        ms.setActionHandler('pause', function () { try { if (currentTrack() && currentTrack().webAudioPlaying) stopWebAudioPlayback("pause"); else audio.pause(); } catch (_) {} });
        ms.setActionHandler('previoustrack', function () { try { selectTrack(currentTrackIndex - 1, true).catch(function(){}); } catch (_) {} });
        ms.setActionHandler('nexttrack',     function () { try { selectTrack(currentTrackIndex + 1, true).catch(function(){}); } catch (_) {} });
        try {
          if (audio && isFinite(audio.duration) && audio.duration > 0) {
            ms.setPositionState({
              duration: audio.duration,
              playbackRate: audio.playbackRate || 1,
              position: Math.min(audio.currentTime || 0, audio.duration),
            });
          }
        } catch (_) {}
      } catch (_) {}
    }

    function setRowClass(idx, currentIdx) {
      if (!subBox) return;
      var rows = $all(subBox, '.idx-sub-row');
      rows.forEach(function (r) {
        var i = Number(r.dataset.idx);
        r.classList.remove('is-current', 'is-past');
        if (i === currentIdx) r.classList.add('is-current');
        else if (i < currentIdx) r.classList.add('is-past');
      });
    }

    function scrollCurrentIntoMiddle() {
      if (!subBox) return;
      var cur = first(subBox, '.idx-sub-row.is-current');
      if (!cur) return;
      try {
        var boxRect = subBox.getBoundingClientRect();
        var rowRect = cur.getBoundingClientRect();
        var offset = (rowRect.top + rowRect.height / 2) - (boxRect.top + boxRect.height / 2);
        if (Math.abs(offset) > 2) subBox.scrollTop = Math.max(0, subBox.scrollTop + offset);
      } catch (_) {}
    }

    function startSubtitle(trackEntry, getTimeSec) {
      stopSubtitle();
      var segs = (trackEntry && trackEntry.segments) || [];
      if (!segs.length) { showSubtitleNotice("暂无歌词", "音频可播放，但没有拿到分段字幕"); return; }
      var gap = (Number(cfg.intervalMs || 350) / 1000);
      var timeline = [];
      function rebuild(metaList) {
        var t = 0;
        timeline = [];
        for (var i = 0; i < segs.length; i++) {
          var segDur;
          var m = metaList && metaList[i];
          if (m && m.duration_s != null && m.duration_s > 0) segDur = m.duration_s;
          else segDur = Math.max(0.6, (segs[i].text || "").length * 0.15);
          // 长文本按句号/逗号拆成 12-22 字的小段
          var subs = splitLyricLines(segs[i].text);
          var totalChars = subs.reduce(function (a, s) { return a + s.length; }, 1);
          var subStart = t;
          for (var j = 0; j < subs.length; j++) {
            var subDur = segDur * (subs[j].length / totalChars);
            timeline.push({
              role: segs[i].role || "旁白",
              text: subs[j],
              start: subStart,
              end: subStart + subDur,
            });
            subStart += subDur;
          }
          t += segDur + gap;
        }
        renderSubtitleRows(timeline, !metaList);
      }
      rebuild();
      var lastIdx = -1;
      var state = { tickHandle: null, pollHandle: null, track: trackEntry };
      activeSubtitle = state;
      state.tickHandle = setInterval(function () {
        if (activeSubtitle !== state) return;
        var t;
        try { t = getTimeSec(); } catch (_) { t = NaN; }
        if (!isFinite(t) || t < 0) return;
        var idx = -1;
        for (var i = 0; i < timeline.length; i++) {
          if (t >= timeline[i].start && t < timeline[i].end) { idx = i; break; }
          if (t >= timeline[i].start) idx = i;
        }
        if (idx >= 0 && idx !== lastIdx) {
          lastIdx = idx;
          setRowClass(idx, idx);
          scrollCurrentIntoMiddle();
          // 左上角 cover/标题 + 系统媒体面板同步当前说话人
          syncHeaderToSpeaker(timeline[idx].role, timeline[idx].text);
        }
      }, 150);
      // 后台轮询 job_status 拿真实 segments_meta 校准时间轴
      if (trackEntry.cacheKey) {
        state.pollHandle = setInterval(function () {
          if (activeSubtitle !== state) return;
          fetch(cleanBase(cfg.apiBase) + "/tts_dialogue_job_status/" + encodeURIComponent(trackEntry.cacheKey))
            .then(function (r) { return r.ok ? r.json() : null; })
            .then(function (j) {
              if (!j) return;
              if (Array.isArray(j.segments_meta) && j.segments_meta.length) rebuild(j.segments_meta);
              if (j.state === "done" || j.state === "failed") {
                if (state.pollHandle) { clearInterval(state.pollHandle); state.pollHandle = null; }
              }
            })
            .catch(function () {});
        }, 1500);
      }
    }

    // ───── 结构化角色映射 + 音色选择器 ─────
    // 注意:panel 和 picker 在 mount 顶部已经被 appendChild 到 document.body,
    // root 内查不到这两棵子树。rolesList 必须从 panel 查,picker 相关从 pickerEl 自身查。
    var rolesListEl    = first(panel, '[data-role="roles-list"]');
    var pickerEl       = (typeof pickerNode !== "undefined" && pickerNode) || first(panel.parentNode || document.body, '[data-role="voice-picker"]');
    var pickerGridEl   = first(pickerEl, '[data-role="picker-grid"]');
    var pickerTabsEl   = first(pickerEl, '[data-role="picker-tabs"]');
    var pickerSearchEl = first(pickerEl, '[data-role="picker-search"]');
    var pickerPageEl   = first(pickerEl, '[data-role="picker-page"]');
    var pickerPrevEl   = first(pickerEl, '[data-role="picker-prev"]');
    var pickerNextEl   = first(pickerEl, '[data-role="picker-next"]');
    var pickerState = { rowIdx: -1, tab: "", search: "", page: 1, pageSize: 12 };

    function renderRoleList() {
      if (!rolesListEl) return;
      // 始终确保前两行常驻槽存在(旁白/用户),即使旧数据丢失也补齐
      cfg.roleVoiceList = cfg.roleVoiceList || [];
      while (cfg.roleVoiceList.length < RESERVED_ROLES.length) {
        cfg.roleVoiceList.push({ role: RESERVED_ROLES[cfg.roleVoiceList.length] || "", voice: "" });
      }
      cfg.roleVoiceList = normalizeRoleVoiceList(cfg.roleVoiceList);
      var list = cfg.roleVoiceList;
      // 渲染前同步用户当前在输入框里的值,避免重渲染清空未保存输入
      var rows = $all(panel, '.idx-role-row');
      rows.forEach(function (row, i) {
        var nameEl = first(row, '.idx-role-name');
        if (nameEl && list[i]) list[i].role = String(nameEl.value || "").trim();
      });
      rolesListEl.innerHTML = list.map(function (item, idx) {
        var role = String(item.role || "");
        var voice = String(item.voice || "");
        var protectedRow = idx < RESERVED_ROLES.length;
        return ''
          + '<div class="idx-role-row' + (protectedRow ? ' idx-role-protected' : '') + '" data-row-idx="' + idx + '" data-voice="' + escapeHtml(voice) + '">'
          + '<input class="idx-role-name" type="text" placeholder="角色名" value="' + escapeHtml(role) + '"' + (protectedRow ? ' readonly' : '') + '>'
          + '<button class="idx-voice-btn" type="button">' + escapeHtml(voice || "选择音色…") + '</button>'
          + (protectedRow
              ? '<span class="idx-role-lock" title="常驻角色,不可删除">🔒</span>'
              : '<button class="idx-role-del" type="button" title="删除">×</button>')
          + '</div>';
      }).join("");
      $all(rolesListEl, '.idx-role-row').forEach(function (row) {
        var idx = Number(row.dataset.rowIdx);
        var nameEl = first(row, '.idx-role-name');
        var voiceBtn = first(row, '.idx-voice-btn');
        var delBtn = first(row, '.idx-role-del');  // protected 行没有这个元素,first 返回 null,on 跳过
        on(nameEl, 'input', function () {
          if (!cfg.roleVoiceList[idx]) cfg.roleVoiceList[idx] = { role: "", voice: "" };
          cfg.roleVoiceList[idx].role = String(nameEl.value || "").trim();
        });
        on(voiceBtn, 'click', function (e) { e.preventDefault(); e.stopPropagation(); openVoicePicker(idx); });
        on(delBtn, 'click', function (e) {
          e.preventDefault(); e.stopPropagation();
          if (cfg.roleVoiceList && cfg.roleVoiceList[idx] !== undefined) {
            cfg.roleVoiceList.splice(idx, 1);
            renderRoleList();
          }
        });
      });
    }

    function nextNewRoleName() {
      var used = {};
      (cfg.roleVoiceList || []).forEach(function (r) {
        var role = String((r && r.role) || "").trim();
        if (role) used[role] = true;
      });
      var n = 1;
      while (used["新角色" + n]) n += 1;
      return "新角色" + n;
    }

    function focusLastEditableRole() {
      setTimeout(function () {
        var rows = $all(rolesListEl, '.idx-role-row');
        for (var i = rows.length - 1; i >= 0; i -= 1) {
          var nameEl = first(rows[i], '.idx-role-name');
          if (nameEl && !nameEl.readOnly) {
            nameEl.focus();
            try { nameEl.select(); } catch (_) {}
            return;
          }
        }
      }, 0);
    }

    function addRoleRow() {
      cfg.roleVoiceList = cfg.roleVoiceList || [];
      // 前两槽位是 reserved,addRoleRow 总是在末尾追加新可删行
      cfg.roleVoiceList.push({ role: nextNewRoleName(), voice: "" });
      renderRoleList();
      focusLastEditableRole();
    }

    function setRowVoice(idx, voiceName) {
      if (!cfg.roleVoiceList[idx]) cfg.roleVoiceList[idx] = { role: "", voice: "" };
      cfg.roleVoiceList[idx].voice = voiceName;
      renderRoleList();
    }

    function openVoicePicker(rowIdx) {
      if (!pickerEl) return;
      pickerState.rowIdx = rowIdx;
      pickerState.tab = "";
      pickerState.search = "";
      pickerState.page = 1;
      if (pickerSearchEl) pickerSearchEl.value = "";
      renderPickerTabs();
      renderPickerGrid();
      openDialog(pickerEl);
    }
    function closeVoicePicker() {
      if (pickerEl) closeDialog(pickerEl);
      pickerState.rowIdx = -1;
    }
    function pickerSubdirs() {
      var set = {};
      (availableVoices || []).forEach(function (v) { set[v.subdir || ""] = true; });
      return Object.keys(set).filter(function (s) { return !!s; }).sort(function (a, b) {
        var ra = voiceCategoryRank(a), rb = voiceCategoryRank(b);
        if (ra !== rb) return ra - rb;
        return a.localeCompare(b, "zh-Hans-CN");
      });
    }
    function renderPickerTabs() {
      if (!pickerTabsEl) return;
      var subs = pickerSubdirs();
      var tabs = ['<button class="idx-picker-tab' + (pickerState.tab === "" ? " is-active" : "") + '" data-tab="">全部</button>'];
      subs.forEach(function (s) {
        tabs.push('<button class="idx-picker-tab' + (pickerState.tab === s ? " is-active" : "") + '" data-tab="' + escapeHtml(s) + '">' + escapeHtml(s) + '</button>');
      });
      // 根目录单独 tab(没分类的音色)
      tabs.push('<button class="idx-picker-tab' + (pickerState.tab === "__root__" ? " is-active" : "") + '" data-tab="__root__">未分类</button>');
      pickerTabsEl.innerHTML = tabs.join("");
      $all(pickerTabsEl, '.idx-picker-tab').forEach(function (btn) {
        on(btn, 'click', function () {
          pickerState.tab = btn.dataset.tab || "";
          pickerState.page = 1;
          renderPickerTabs();
          renderPickerGrid();
        });
      });
    }
    function pickerFiltered() {
      var q = String(pickerState.search || "").toLowerCase().trim();
      return (availableVoices || []).filter(function (v) {
        var sd = v.subdir || "";
        if (pickerState.tab === "__root__") { if (sd) return false; }
        else if (pickerState.tab && sd !== pickerState.tab) return false;
        if (q && v.name.toLowerCase().indexOf(q) < 0) return false;
        return true;
      });
    }
    // picker 内试听:点 item 整块 toggle 播放 /voice_preview;另一份 audio
    // 实例避免跟主播放器冲突。同一时间只播一个 preview。
    var pickerPreviewAudio = null;
    function pickerPreview(voiceName, itemEl) {
      try {
        if (pickerPreviewAudio) { try { pickerPreviewAudio.pause(); } catch (_) {} }
        $all(pickerGridEl, '.idx-picker-item.is-playing').forEach(function (b) { b.classList.remove('is-playing'); });
        if (!voiceName) return;
        var url = cleanBase(cfg.apiBase) + "/voice_preview?name=" + encodeURIComponent(voiceName);
        pickerPreviewAudio = new Audio(url);
        if (itemEl) itemEl.classList.add('is-playing');
        pickerPreviewAudio.addEventListener('ended', function () { if (itemEl) itemEl.classList.remove('is-playing'); });
        pickerPreviewAudio.addEventListener('error', function () { if (itemEl) itemEl.classList.remove('is-playing'); });
        pickerPreviewAudio.play().catch(function () { if (itemEl) itemEl.classList.remove('is-playing'); });
      } catch (_) { if (itemEl) itemEl.classList.remove('is-playing'); }
    }
    function stopPickerPreview() {
      if (pickerPreviewAudio) { try { pickerPreviewAudio.pause(); } catch (_) {} pickerPreviewAudio = null; }
      $all(pickerGridEl, '.idx-picker-item.is-playing').forEach(function (b) { b.classList.remove('is-playing'); });
    }

    function renderPickerGrid() {
      if (!pickerGridEl) return;
      var filtered = pickerFiltered();
      var totalPages = Math.max(1, Math.ceil(filtered.length / pickerState.pageSize));
      if (pickerState.page > totalPages) pickerState.page = totalPages;
      var start = (pickerState.page - 1) * pickerState.pageSize;
      var page = filtered.slice(start, start + pickerState.pageSize);
      var selectedVoice = "";
      if (pickerState.rowIdx === -2) selectedVoice = cfg.defaultVoice || "";
      else if (pickerState.rowIdx >= 0 && cfg.roleVoiceList && cfg.roleVoiceList[pickerState.rowIdx]) selectedVoice = cfg.roleVoiceList[pickerState.rowIdx].voice || "";
      pickerGridEl.innerHTML = page.map(function (v) {
        var sd = v.subdir || "";
        var selected = v.name === selectedVoice;
        return '<div class="idx-picker-item' + (selected ? ' is-selected' : '') + '" data-voice="' + escapeHtml(v.name) + '" title="点击试听">'
          + '<div class="idx-picker-item-info">'
            + '<span class="idx-picker-item-name">' + escapeHtml(v.name.split("/").pop()) + '</span>'
            + (sd ? '<span class="idx-picker-item-sub">' + escapeHtml(sd) + '</span>' : '')
          + '</div>'
          + '<span class="idx-picker-wave" aria-hidden="true"><i></i><i></i><i></i></span>'
          + '<span class="idx-picker-selected" aria-hidden="true">✓</span>'
          + '<button class="idx-picker-apply" type="button" data-action="apply" title="选用此音色" aria-label="选用">✓</button>'
          + '</div>';
      }).join("") || '<div style="grid-column:1/-1;padding:20px;text-align:center;color:rgba(238,231,244,.5);font-size:12px">没有匹配的音色</div>';
      $all(pickerGridEl, '.idx-picker-item').forEach(function (item) {
        var apply = first(item, '[data-action="apply"]');
        var voiceName = item.dataset.voice;
        function applyVoice() {
          stopPickerPreview();
          if (pickerState.rowIdx === -2) {
            cfg.defaultVoice = voiceName;
            var defBtn = first(panel, '[data-role="default-voice-btn"]');
            if (defBtn) defBtn.textContent = voiceName;
            saveConfig(cfg, characterId).catch(function(){});
          } else if (pickerState.rowIdx >= 0) {
            setRowVoice(pickerState.rowIdx, voiceName);
          }
          closeVoicePicker();
        }
        // 点 item 主体 = toggle 试听
        on(item, 'click', function (e) {
          if (e.target && e.target.closest && e.target.closest('[data-action="apply"]')) return;
          if (item.classList.contains('is-playing')) { stopPickerPreview(); return; }
          pickerPreview(voiceName, item);
        });
        on(apply, 'click', function (e) { e.preventDefault(); e.stopPropagation(); applyVoice(); });
      });
      if (pickerPageEl) pickerPageEl.textContent = filtered.length ? (pickerState.page + ' / ' + totalPages + ' · 共 ' + filtered.length + ' 条') : '无结果';
      if (pickerPrevEl) pickerPrevEl.disabled = pickerState.page <= 1;
      if (pickerNextEl) pickerNextEl.disabled = pickerState.page >= totalPages;
    }
    // 绑定 picker 的全局事件(close / search / pager)
    // 注意:picker 已经移到 panel 外、跟 panel 平级了,picker-close 在 picker 内,从 pickerEl 查找
    on(first(pickerEl, '.idx-picker-close'), 'click', function () { stopPickerPreview(); closeVoicePicker(); });
    on(pickerSearchEl, 'input', function () { pickerState.search = pickerSearchEl.value || ""; pickerState.page = 1; renderPickerGrid(); });
    on(pickerPrevEl, 'click', function () { if (pickerState.page > 1) { pickerState.page--; renderPickerGrid(); } });
    on(pickerNextEl, 'click', function () { pickerState.page++; renderPickerGrid(); });
    // panel 内按钮统一用事件代理 —— 避免 dialog 内部事件路由怪问题 + renderRoleList 重渲染不丢绑定
    on(panel, 'click', function (e) {
      var t = e.target; if (!t || !t.closest) return;
      if (t.closest('[data-role="add-role"]')) { e.preventDefault(); addRoleRow(); return; }
      if (t.closest('[data-role="default-voice-btn"]')) { e.preventDefault(); openVoicePicker(-2); return; }
      var roleRow = t.closest('.idx-role-row');
      if (roleRow) {
        var idx = Number(roleRow.dataset.rowIdx);
        if (t.closest('.idx-role-del')) { e.preventDefault(); if (cfg.roleVoiceList && cfg.roleVoiceList[idx] !== undefined) { cfg.roleVoiceList.splice(idx, 1); renderRoleList(); } return; }
        if (t.closest('.idx-voice-btn')) { e.preventDefault(); openVoicePicker(idx); return; }
      }
    });

    function pauseLiveTrack(track) {
      if (!track) return;
      track.pausedByUser = true;
      try { audio.pause(); } catch (_) {}
      stopWebAudioPlayback("pause");
      setPlayState("idle");
      if (track.cacheKey) pollCacheUpgrade(track, "paused snapshot");
      setStatus("已暂停，后台继续保存");
      showTrackNotice(track, "已暂停", track.cacheKey ? "合成还在后台进行，保存后可播放历史音频" : "已停止等待，点播放可继续");
    }

    async function generate(force) {
      readFields(); await saveConfig(cfg, characterId); setError("");
      if (!messageText) { setError("当前消息没有可朗读正文。"); return; }
      if (!cfg.defaultVoice) { setError("请先点选一个音色卡片。"); return; }
      // 已有卡片时，播放按钮只做"播放/暂停/选当前卡片"，不生成新音频。
      // 新建必须点 + 号（force=true 才走下面的 generate 流程）。
      if (!force && generatedTracks.length > 0) {
        if (currentTrackIndex < 0) currentTrackIndex = generatedTracks.length - 1;
        var existingTrack = currentTrack();
        if (existingTrack && existingTrack.webAudioPlaying) {
          stopWebAudioPlayback("pause");
          return;
        }
        if (existingTrack && existingTrack.pausedByUser && (isLiveTrack(existingTrack) || trackState(existingTrack) === "pending")) {
          existingTrack.pausedByUser = false;
          setPlayState("loading");
          setStatus("继续等待音频…");
          showTrackNotice(existingTrack, "继续等待音频…", existingTrack.cacheKey ? "正在检查保存状态" : "正在等待生成任务返回");
          if (existingTrack.cacheKey) pollCacheUpgrade(existingTrack, "resume snapshot");
          return;
        }
        if (existingTrack && (isLiveTrack(existingTrack) || trackState(existingTrack) === "pending") && play && play.dataset.state === "loading") {
          pauseLiveTrack(existingTrack);
          return;
        }
        if (shouldUseElementForSavedTrack(existingTrack)) {
          var existingUrl = trackPlayableUrl(existingTrack);
          var audioUrl = audio.currentSrc || audio.src || "";
          if (existingUrl && audioUrl !== existingUrl) {
            startElementAudioFrom(existingTrack, 0);
          } else if (audio.src) {
            if (audio.paused) { setAudioPlaybackRate(); await audio.play().catch(function(e){ handleAudioPlayReject("element", e, "请点播放继续"); }); }
            else audio.pause();
          } else {
            startElementAudioFrom(existingTrack, 0);
          }
          return;
        }
        if (shouldUseWebAudioForLiveTrack(existingTrack)) {
          await playTrackViaWebAudio(existingTrack, trackPlayableUrl(existingTrack), { noticeTitle: "等待首段音频…", noticeDetail: "正在连接流式音频", waitDetail: "正在合成第一段" });
          return;
        }
        if (audio.src) {
          if (audio.paused) { setAudioPlaybackRate(); await audio.play().catch(function(e){ handleAudioPlayReject("element", e, "请点播放继续"); }); }
          else audio.pause();
          return;
        }
        // 没 src 但有卡片 → 选当前卡片，让 selectTrack 决定 URL 来源
        await selectTrack(currentTrackIndex, true);
        return;
      }
      // 兼容旧逻辑（无卡片 + audio.src 残留时）
      if (audio.src && !force && generatedTracks.length === 0) {
        if (audio.paused) {
          setAudioPlaybackRate();
          await audio.play().catch(function(e){ handleAudioPlayReject("element", e, "请点播放继续"); });
        } else audio.pause();
        return;
      }

      // ★ Bug 修复:点 ▶ / 🎵 第一时间 push 占位卡片,让用户立刻看见一张
      // "生成中…" 卡。后续的 LLM 拆段 + dialogue job 拿到 cacheKey 会
      // 原地把这张卡的属性填上(url, cacheKey, segments...),不会再 push 新的。
      var placeholder = null;
      if (cfg.mode === "ai8") {
        placeholder = {
          url: null,
          streamUrl: "",
          cacheUrl: "",
          cacheKey: "",
          createdAt: Date.now(),
          voice: cfg.defaultVoice,
          mode: cfg.mode,
          segments: [],
          state: "pending",
          status: "pending",
          pendingBlob: true,
        };
        generatedTracks.push(placeholder);
        currentTrackIndex = generatedTracks.length - 1;
        // 关键:重置 audio.src / seek / 标题 到新卡片,否则旧 audio 还在播,UI 错位
        try { audio.pause(); } catch (_) {}
        await selectTrack(currentTrackIndex, false);
        setStatus("准备生成…");
        showTrackNotice(placeholder, "准备生成…", "等待 LLM 分析文本");
        debugLog("🎵 立即 push 占位卡片(currentTrackIndex=" + currentTrackIndex + ")", "#9ff");
      }

      setPlayState("loading");
      try {
        var base = cleanBase(cfg.apiBase), body, url;
        if (cfg.mode === "ai8") {
          setStatus("AI 分析中…");
          showTrackNotice(placeholder, "AI 分析中…", "正在拆分旁白、人物、声腔和情绪");
          if (!cfg.llmEndpoint || !cfg.llmModel) throw new Error("AI 八情绪模式需要填写 LLM 接口地址和模型。");
          var t0 = Date.now();
          debugLog("━━━━━━━━━━━━━━━━━━━━━━━━━", "#fff");
          debugLog("🎬 AI 八情绪生成开始 (text=" + messageText.length + " 字)", "#fff");
          startServerLogPolling(base);
          var segments = await parseWithLlm(messageText, cfg, setStatus, context);
          if (placeholder && placeholder.deleted) throw Object.assign(new Error("生成已取消"), { name: "AbortError" });
          var roleCounts = {}; segments.forEach(function (s) { roleCounts[s.role] = (roleCounts[s.role] || 0) + 1; });
          var roleSummary = Object.keys(roleCounts).map(function (r) { return r + "×" + roleCounts[r]; }).join(", ");
          setStatus("开始合成 " + segments.length + " 段…");
          showTrackNotice(placeholder, "开始合成 " + segments.length + " 段…", roleSummary);
          var voicesMap = rolesListToVoicesMap(cfg.roleVoiceList, cfg.defaultVoice);
          debugLog("🎙️ 音色映射: " + JSON.stringify(voicesMap), "#ffd479");
          body = { segments: segments, voices: voicesMap, performance_mode: cfg.qualityMode || "balanced", interval_ms: cfg.intervalMs, top_p: cfg.topP, top_k: cfg.topK, temperature: cfg.temperature, repetition_penalty: cfg.repetitionPenalty, emo_alpha: cfg.emoAlpha, speed_factor: clampNumber(cfg.speedFactor || 1.08, 1.08, 0.85, 1.25) };
          var ttsStart = Date.now();
          var jobInfo;
          var ttsTimer = setInterval(function () {
            var sec = Math.floor((Date.now() - ttsStart) / 1000);
            setStatus("合成中 " + sec + "s…");
            showTrackNotice(placeholder, "合成中 " + sec + "s…", "等待首块音频返回");
          }, 1000);
          try {
            debugLog("📡 提交 dialogue job", "#ffd479");
            jobInfo = await createDialogueStreamJob(base, body);
            debugLog("🔗 cache_key=" + jobInfo.cacheKey + " cached=" + jobInfo.cached + " live=" + jobInfo.live, "#9f9");
          } finally {
            clearInterval(ttsTimer);
          }
          if (placeholder && placeholder.deleted) {
            if (jobInfo && jobInfo.cacheKey) deleteRemoteTrack({ cacheKey: jobInfo.cacheKey }).catch(function () {});
            throw Object.assign(new Error("生成已取消"), { name: "AbortError" });
          }
          var streamUrl = jobInfo.streamUrl;
          var cacheUrl = jobInfo.cacheUrl;
          // 复用第一时间 push 的占位卡片(placeholder),原地填字段。这样
          // 不会出现"先一张占位 + 后一张真卡片"两张卡。
          var trackEntry = placeholder || {
            url: null,
            createdAt: Date.now(),
            voice: cfg.defaultVoice,
            mode: cfg.mode,
            pendingBlob: true,
          };
          trackEntry.streamUrl = streamUrl;
          trackEntry.cacheUrl = cacheUrl;
          trackEntry.cacheKey = jobInfo.cacheKey;
          trackEntry.segments = segments;
          trackEntry.voicesMap = voicesMap;
          setTrackState(trackEntry, jobInfo.cached ? "saved" : "live");
          if (!placeholder) {
            // 防御性:正常路径下 placeholder 一定有,这里兜底
            generatedTracks.push(trackEntry);
            currentTrackIndex = generatedTracks.length - 1;
          }
          updateTrackButtons();
          if (messageId) {
            saveTracksForMessage(messageId, generatedTracks).catch(function(){});
            debugLog("💾 立即写 tavo.set cacheKey=" + jobInfo.cacheKey, "#9ff");
          }
          if (trackEntry.pausedByUser) {
            setStatus("已暂停，后台保存中");
            showTrackNotice(trackEntry, "已暂停", "合成还在后台进行，保存后会成为历史音频");
            pollCacheUpgrade(trackEntry, "paused snapshot");
            stopServerLogPolling();
            return;
          }
          // 如果服务端早就有这条音频的缓存，走完整音频播放器；这是可拖动进度条的路径。
          if (jobInfo.cached && cacheUrl) {
            trackEntry.url = cacheUrl;
            setTrackState(trackEntry, "saved");
            setStatus("已有音频，正在播放");
            showTrackNotice(trackEntry, "已有音频", "已加载音频，支持拖动");
            setPlayState("loading");
            debugLog("⚡ 命中服务端缓存，直接 audio.src 播放", "#9f9");
            startElementAudioFrom(trackEntry, 0);
            return;
          }
          // 没缓存 → 走流式（移动 Web Audio / 桌面 <audio src>）。后端是异步
          // job，断线重连不丢；同时 GET 完成后会自动落盘到 snapshot_cache。
          if (isMobileUA()) {
            setStatus("等待首段音频…");
            showTrackNotice(trackEntry, "等待首段音频…", "正在合成，声音出来前不要切走");
            debugLog("📱 检测到手机 UA, 用 Web Audio API 真流式", "#ffd479");
            currentCacheKey = jobInfo.cacheKey;
            setPlayState("loading");
            pollCacheUpgrade(trackEntry, "mobile snapshot");
            await playTrackViaWebAudio(trackEntry, streamUrl, { noticeTitle: "等待首段音频…", noticeDetail: "正在合成，声音出来前不要切走", waitDetail: "正在合成第一段" });
            if (isSavedTrack(trackEntry)) attachCacheAudio(trackEntry, { deferElement: true });
            stopServerLogPolling();
            return;
          } else {
            // 桌面端 chunked WAV 给 <audio> 元素直接播。
            trackEntry.url = streamUrl;
            trackEntry.streaming = true;
            await selectTrack(generatedTracks.length - 1, false);
            var totalSec = Math.floor((Date.now() - t0) / 1000);
            setStatus("流式播放 " + segments.length + " 段");
            debugLog("▶️ 启动音频播放, 截至此处用时 " + totalSec + "s", "#9f9");
            pollCacheUpgrade(trackEntry, "desktop snapshot");
            // 音频播完后停止服务端日志轮询
            try {
              audio.addEventListener("ended", stopServerLogPolling, { once: true });
              audio.addEventListener("error", stopServerLogPolling, { once: true });
              audio.addEventListener("pause", function () { if (audio.currentTime >= (audio.duration || 0) - 0.05) stopServerLogPolling(); });
            } catch (_) { stopServerLogPolling(); }
          }
        } else {
          url = await createSingleStreamJob(base, cfg, messageText, force);
          generatedTracks.push({ url: url, cacheKey: "", deleteUrl: singleDeleteUrl(base, cfg, messageText), createdAt: Date.now(), voice: cfg.defaultVoice, mode: cfg.mode, state: "live", status: "running", pendingBlob: true, streaming: true });
          await selectTrack(generatedTracks.length - 1, false);
          setStatus("正在生成单音色音频...");
          showTrackNotice(currentTrack(), "正在生成单音色音频…", "声音出来后会自动播放");
        }
        setAudioPlaybackRate();
        await audio.play().catch(function (e) {
          if (e && e.name === 'AbortError') return;
          handleAudioPlayReject("element", e, "请点播放继续");
          if (!isUnsupportedPlayError(e)) throw e;
        });
      } catch (e) {
        var msg = String((e && e.message) || e || "");
        var isAbort = (e && e.name === 'AbortError') || /aborted/i.test(msg);
        setPlayState("idle");
        stopServerLogPolling();
        // 切卡/切角色导致的 AbortError 是正常用户操作,不弹红色错误
        if (isAbort) {
          setStatus("已取消");
          debugLog("⏸ 生成被中断(切卡/切角色等): " + msg, "#fc9");
        } else {
          setStatus("生成失败");
          setError(msg);
          debugLog("❌ 错误: " + msg, "#f99");
        }
        // 生成失败 → 从列表里删掉占位卡片,避免留死卡
        if (placeholder) {
          var idx = generatedTracks.indexOf(placeholder);
          if (idx >= 0) {
            generatedTracks.splice(idx, 1);
            if (currentTrackIndex >= generatedTracks.length) currentTrackIndex = generatedTracks.length - 1;
            updateTrackButtons();
            debugLog("🗑 移除失败的占位卡片", "#fc9");
          }
        }
      }
    }

    function openDialog(d) { if (!d) return; try { if (typeof d.showModal === 'function') d.showModal(); else if (typeof d.show === 'function') d.show(); else d.setAttribute('open', ''); } catch (_) { try { d.setAttribute('open', ''); } catch (__) {} } }
    function closeDialog(d) { if (!d) return; try { if (typeof d.close === 'function') d.close(); else d.removeAttribute('open'); } catch (_) { try { d.removeAttribute('open'); } catch (__) {} } }
    on(gear, 'click', function (ev) { ev.preventDefault(); ev.stopPropagation(); if (panel.open) closeDialog(panel); else openDialog(panel); });
    on(close, 'click', function () { closeDialog(panel); });
    on(play, 'pointerdown', function () { primeAudioContext(); });
    on(add, 'pointerdown', function () { primeAudioContext(); });
    on(play, 'touchstart', function () { primeAudioContext(); });
    on(add, 'touchstart', function () { primeAudioContext(); });
    on(play, 'click', function () { primeAudioContext(); generate(false); });
    on(add, 'click', function () { primeAudioContext(); generate(true); });
    on(prev, 'click', function () { selectTrack(currentTrackIndex - 1, true).catch(function (e) { setError(e && e.message ? e.message : String(e)); }); });
    on(next, 'click', function () { selectTrack(currentTrackIndex + 1, true).catch(function (e) { setError(e && e.message ? e.message : String(e)); }); });
    on(del, 'click', function () { clearCurrentTrack().catch(function (e) { setError(e && e.message ? e.message : String(e)); }); });
    on(first(panel, '[data-role="save"]'), 'click', async function () { readFields(); await saveConfig(cfg, characterId); syncUI(); closeDialog(panel); setStatus("设置已保存"); });
    // IME 组词期间不覆盖输入值（搜狗/微软拼音等）。事件委托到 panel 上，覆盖所有 data-field 输入。
    try {
      panel.addEventListener('compositionstart', function (e) {
        if (e.target && e.target.dataset && e.target.dataset.field) e.target.__indexttsComposing = true;
      }, true);
      panel.addEventListener('compositionend', function (e) {
        if (e.target && e.target.dataset && e.target.dataset.field) e.target.__indexttsComposing = false;
      }, true);
    } catch (_) {}
    on(first(panel, '[data-role="reload"]'), 'click', renderVoices);
    $all(panel, '.idx-mode').forEach(function (b) { b.addEventListener('click', async function () { readFields(); cfg.mode = b.dataset.mode; syncUI(); await saveConfig(cfg, characterId); }); });
    on(audio, 'play', function () {
      var t = currentTrack();
      setPlayState("playing"); setStatus("正在播放：" + trackPlaybackLabel(t));
      // 系统媒体面板基础信息(后台/锁屏可见,可控制播放/上下首)
      try { updateMediaSession(lastSpeakerRole, ""); } catch (_) {}
      // 桌面 / <audio> 路径的字幕：当前 track 是 ai8 且有 segments 时启动
      if (t && t.mode === "ai8") {
        if (t.segments && t.segments.length) {
          startSubtitle(t, function () { return audio.currentTime || 0; });
        } else if (t.cacheKey && !t.fetchingSegments) {
          // 历史卡片没存 segments → 后台拉 job_status 补回来
          t.fetchingSegments = true;
          debugLog("📥 历史卡无 segments,后台拉 job_status…", "#9ff");
          fetch(cleanBase(cfg.apiBase) + "/tts_dialogue_job_status/" + encodeURIComponent(t.cacheKey))
            .then(function (r) { return r.ok ? r.json() : null; })
            .then(function (j) {
              if (j && Array.isArray(j.segments_meta) && j.segments_meta.length) {
                t.segments = j.segments_meta.map(function (s) {
                  return { role: s.role || "", text: s.text || "" };
                });
                debugLog("✅ 补回 " + t.segments.length + " 段 segments,字幕启动", "#9f9");
                // 现在启动字幕
                if (currentTrackIndex >= 0 && generatedTracks[currentTrackIndex] === t) {
                  startSubtitle(t, function () { return audio.currentTime || 0; });
                }
                if (messageId) saveTracksForMessage(messageId, generatedTracks).catch(function(){});
              } else {
                debugLog("⚠️ job_status 没返回 segments_meta(可能服务端没存这条历史)", "#fc9");
              }
            })
            .catch(function (e) { debugLog("❌ 拉 segments_meta 失败: " + e, "#f99"); })
            .finally(function () { t.fetchingSegments = false; });
        }
      }
    });
    on(audio, 'waiting', function () {
      var t = currentTrack();
      var label = waitingLabelForTrack(t);
      setPlayState("loading");
      setStatus(label);
      if (t) showTrackNotice(t, label, "歌词会停在当前播放位置");
    });
    on(audio, 'canplay', function () {
      setError("");
      if (!audio.paused) {
        setPlayState("playing");
        // 多音色模式下当前播放的音色不固定,不要写 cfg.defaultVoice
        setStatus("正在播放：" + trackPlaybackLabel(currentTrack()));
      }
    });
    on(audio, 'playing', function () { setError(""); setPlayState("playing"); setStatus("正在播放：" + trackPlaybackLabel(currentTrack())); });
    on(audio, 'pause', function () { setPlayState("idle"); if (audio.currentTime > 0 && !audio.ended) setStatus("已暂停"); stopSubtitle(); });
    on(audio, 'ended', function () { setPlayState("idle"); setStatus("播放完成"); stopSubtitle(); });
    on(audio, 'error', function () {
      var active = currentTrack();
      if (active && (active.webAudioPlaying || shouldUseWebAudioForLiveTrack(active))) {
        debugLog("⚠️ 忽略 audio 元素错误：当前手机链路使用 Web Audio，src=" + (audio.currentSrc || audio.src || ""), "#fc9");
        setError("");
        return;
      }
      var detail = "";
      try {
        if (audio.error) detail = " code=" + audio.error.code + (audio.error.message ? " message=" + audio.error.message : "");
      } catch (_) {}
      setPlayState("idle");
      setStatus("播放失败");
      setError("音频加载失败。" + detail + " 请检查服务地址、音色和后端日志。");
      debugLog("❌ audio error" + detail + " src=" + (audio.currentSrc || audio.src || ""), "#f99");
      stopSubtitle();
    });
    on(audio, 'loadedmetadata', function () {
      setError("");
      setAudioPlaybackRate();
      if (seek) seek.disabled = false;
      if (total) total.textContent = formatTime(audio.duration);
      debugLog("📐 audio metadata loaded: duration=" + audio.duration.toFixed(2) + "s seekable=" + (audio.seekable.length > 0 ? audio.seekable.end(0).toFixed(2) : "0"), "#9ff");
    });
    on(audio, 'seeking', function () { debugLog("⏩ seeking → " + audio.currentTime.toFixed(2), "#9ff"); });
    on(audio, 'seeked',  function () { debugLog("✅ seeked  → " + audio.currentTime.toFixed(2), "#9ff"); });
    on(audio, 'stalled', function () { debugLog("⚠️ stalled @ " + audio.currentTime.toFixed(2), "#fc9"); });
    on(audio, 'timeupdate', function () { if (cur) cur.textContent = formatTime(audio.currentTime); if (total) total.textContent = audio.duration ? formatTime(audio.duration) : "--:--"; if (seek) seek.value = audio.duration ? String(Math.floor(audio.currentTime / audio.duration * 1000)) : "0"; });
    on(seek, 'input', function () { if (audio && audio.duration) audio.currentTime = Number(seek.value || 0) / 1000 * audio.duration; });

    updateTrackButtons();
    syncUI(); renderVoices().catch(function (e) { setStatus("音色列表读取失败，仍可打开设置"); setError(e && e.message ? e.message : String(e)); });
    // 从 tavo.set 持久化恢复本条消息的历史卡片（cacheKey 列表 → 转成可重播的 track）
    if (messageId) {
      loadTracksForMessage(messageId).then(function (saved) {
        if (!saved || !saved.length) return;
        var base = cleanBase(cfg.apiBase);
        saved.forEach(function (t) {
          var savedState = t.state === "live" ? "live" : (t.state === "failed" ? "failed" : "saved");
          var restored = {
            url: null,                 // 用到时由 selectTrack 通过 cacheKey 拉
            cacheKey: t.cacheKey,
            cacheUrl: base + "/cache_audio/" + encodeURIComponent(t.cacheKey),
            streamUrl: base + "/tts_dialogue_stream_job/" + encodeURIComponent(t.cacheKey),
            createdAt: t.createdAt || Date.now(),
            voice: t.voice || cfg.defaultVoice,
            mode: t.mode || "ai8",
            voicesMap: t.voicesMap || null,
            metrics: t.metrics || null,
            segments: Array.isArray(t.segments) ? t.segments : [],
            fromHistory: savedState === "saved",
            state: savedState
          };
          setTrackState(restored, savedState);
          generatedTracks.push(restored);
          if (savedState === "live") pollCacheUpgrade(restored, "restored live snapshot");
        });
        currentTrackIndex = generatedTracks.length - 1;
        updateTrackButtons();
        setStatus(historyStatusText());
        showTrackNotice(currentTrack(), historyStatusText(), "点播放继续，或用左右按钮切换历史音频");
        debugLog("📂 恢复历史 tracks: " + generatedTracks.length + " 段, 每张含 segments: " +
          generatedTracks.map(function(t){return (t.segments||[]).length;}).join(','), "#9ff");
      }).catch(function () {});
    }
  }

  try {
    ensureStyle();
    removeLegacyGlobalGear();
    if (script && script.dataset.indexttsMounted === "1") return;
    if (script) script.dataset.indexttsMounted = "1";
    var msgEl = messageElement(script);
    if (msgEl && msgEl !== document.body && msgEl !== document.documentElement) {
      $all(msgEl, '.idx-tts').forEach(function (node) { if (node.parentNode) node.parentNode.removeChild(node); });
    }
    var root = document.createElement("div");
    root.className = "idx-tts";
    if (script && script.parentNode) script.parentNode.insertBefore(root, script.nextSibling); else document.body.appendChild(root);
    var cfg = await getConfig();
    var ctx = await currentMessageContext();
    // 角色级 defaultVoice + roleVoiceList 覆盖全局 cfg。
    // 优先读 TAVO character scope；ctx.characterId 只用于旧版全局 key/localStorage 迁移。
    try {
      var charCfg = await loadCharacterCfg(ctx.characterId);
      if (charCfg) {
        if (typeof charCfg.defaultVoice === "string") cfg.defaultVoice = charCfg.defaultVoice;
        if (!cfg.defaultVoice && Array.isArray(charCfg.roleVoiceList)) {
          cfg.defaultVoice = voiceForRoleNames(charCfg.roleVoiceList, ["角色"]) || cfg.defaultVoice;
        }
        if (Array.isArray(charCfg.roleVoiceList) && charCfg.roleVoiceList.length) cfg.roleVoiceList = charCfg.roleVoiceList;
      }
    } catch (_) {}
    // 关键:过滤掉历史会话累积的多余空行,确保前 2 行 reserved
    cfg.roleVoiceList = normalizeRoleVoiceList(cfg.roleVoiceList);
    mount(root, cfg, ctx);
  } catch (e) { try { console.error("[IndexTTS TAVO]", e && e.stack ? e.stack : (e && e.message ? e.message : JSON.stringify(e))); } catch (_) {} }
})();
