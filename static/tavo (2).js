;(async function () {
  "use strict";

  var script = document.currentScript;
  var STYLE_ID = "indextts-tavo-player-v4";
  var CONFIG_KEY = "indextts_tavo_config_v3";

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
    roleVoicesText: "narrator=高圆圆\n李明=Jok\n小雨=温柔御姐",
    llmEndpoint: "",
    llmModel: "",
    llmApiKey: "",
    intervalMs: 50,
    topP: 0.8,
    topK: 30,
    temperature: 0.8,
    repetitionPenalty: 10,
    emoAlpha: 0.7
  };

  function $(root, sel) { return root && root.querySelector ? root.querySelector(sel) : null; }
  function $all(root, sel) { return root && root.querySelectorAll ? Array.prototype.slice.call(root.querySelectorAll(sel)) : []; }
  function first(root) { for (var i = 1; i < arguments.length; i++) { var el = $(root, arguments[i]); if (el) return el; } return null; }
  function on(el, ev, fn) { if (el) el.addEventListener(ev, fn); }
  function cleanBase(url) { return String(url || "").replace(/\/+$/, ""); }
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
      ".idx-card{position:relative;overflow:hidden;border-radius:18px;background:radial-gradient(circle at 88% 8%,rgba(216,167,255,.16),transparent 34%),linear-gradient(160deg,#1b1522 0%,#120e18 54%,#0c0910 100%);border:1px solid rgba(206,170,230,.22);box-shadow:0 18px 42px rgba(0,0,0,.34);padding:16px}",
      ".idx-top{display:flex;align-items:center;gap:12px;min-width:0}.idx-cover{width:56px;height:56px;flex:0 0 56px;border-radius:14px;background:#241a2c;box-shadow:inset 0 0 0 1px rgba(255,255,255,.08),0 10px 24px rgba(0,0,0,.34);display:flex;align-items:center;justify-content:center;color:#e9c8ff;font-size:18px;font-weight:800;background-size:cover;background-position:center}.idx-cover[data-playing='1']{animation:none}",
      ".idx-info{flex:1;min-width:0;padding-right:48px}.idx-title-row{display:flex;align-items:center;gap:8px;min-width:0}.idx-name{font-size:18px;font-weight:800;color:#e9c8ff;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.idx-format{flex:0 0 auto;border:1px solid rgba(206,170,230,.34);background:rgba(206,170,230,.12);color:#d9b7f0;border-radius:999px;padding:2px 7px;font-size:10px;font-weight:800}.idx-status{margin-top:4px;font-size:12px;color:rgba(238,231,244,.62);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.idx-gear{position:absolute;right:16px;top:16px;width:42px;height:42px;border-radius:14px;border:1px solid rgba(206,170,230,.28);background:rgba(206,170,230,.10);color:#eee7f4;display:flex;align-items:center;justify-content:center;cursor:pointer;padding:0}.idx-gear:hover{background:rgba(206,170,230,.18)}",
      ".idx-seek-wrap{margin:16px 0 0;background:rgba(8,6,12,.48);border:1px solid rgba(206,170,230,.14);border-radius:14px;padding:13px 12px 12px}.idx-seek{width:100%;height:24px;margin:0;accent-color:#c88ee9;cursor:pointer}.idx-time{display:flex;justify-content:space-between;font-size:12px;color:rgba(238,231,244,.68);font-variant-numeric:tabular-nums;margin-top:6px}",
      ".idx-controls{display:flex;align-items:center;justify-content:center;gap:12px;margin-top:14px}.idx-ctrl{border:1px solid rgba(206,170,230,.16);border-radius:50%;background:rgba(206,170,230,.08);color:#eee7f4;cursor:pointer;display:flex;align-items:center;justify-content:center;padding:0}.idx-ctrl:hover{background:rgba(206,170,230,.16)}.idx-ctrl svg{width:20px;height:20px;fill:currentColor}.idx-ctrl-sm{width:44px;height:44px}.idx-ctrl-main{width:66px;height:66px;background:#c890e8;color:#170e20;border-color:rgba(255,255,255,.18);box-shadow:0 10px 24px rgba(200,144,232,.25)}.idx-ctrl-main[data-state='playing']{background:#e1b0f5}.idx-ctrl-main svg{width:28px;height:28px}.idx-ctrl-add{width:48px;height:48px;background:rgba(154,94,182,.42);color:#f4e7ff}.idx-ctrl-delete{width:48px;height:48px;background:rgba(120,38,52,.46);color:#ffd5dd}.idx-ctrl:disabled{opacity:.42;cursor:not-allowed;filter:grayscale(.25)}",
      ".idx-meta{display:flex;align-items:center;justify-content:center;gap:8px;flex-wrap:wrap;margin-top:12px}.idx-pill{font-size:11px;color:rgba(238,231,244,.75);background:rgba(255,255,255,.06);border:1px solid rgba(206,170,230,.14);border-radius:999px;padding:4px 9px;max-width:100%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}",
      ".idx-panel{position:fixed!important;top:12px!important;left:50%!important;right:auto!important;bottom:auto!important;transform:translateX(-50%)!important;width:min(440px,calc(100vw - 24px))!important;max-height:calc(100vh - 24px)!important;overflow-y:auto;overscroll-behavior:contain;-webkit-overflow-scrolling:touch;background:rgba(9,6,13,.97);border:0;border-radius:18px;box-shadow:0 18px 48px rgba(0,0,0,.52),inset 0 1px 0 rgba(255,255,255,.05);padding:16px;z-index:2147483600}.idx-panel-head{display:flex;align-items:center;justify-content:space-between;gap:10px;margin:-16px -16px 10px;padding:14px 16px 10px;position:sticky;top:-16px;background:linear-gradient(180deg,#120e18 0%,rgba(18,14,24,.94) 100%);z-index:1}.idx-panel-title{font-size:14px;font-weight:800;color:#e9c8ff}.idx-close{border:0;background:transparent;color:rgba(238,231,244,.70);font-size:20px;line-height:1;cursor:pointer}",
      ".idx-section-title{font-size:12px;font-weight:700;color:#d9b7f0;margin:12px 0 7px}.idx-voices{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px}.idx-voice{min-height:58px;border:1px solid rgba(206,170,230,.16);border-radius:8px;background:rgba(255,255,255,.06);color:#eee7f4;text-align:left;padding:9px;cursor:pointer;font-family:inherit;position:relative;overflow:hidden}.idx-voice:before{content:'';position:absolute;left:0;right:0;bottom:0;height:4px;background:linear-gradient(90deg,#c890e8,#d8a7ff);opacity:.30}.idx-voice strong{display:block;font-size:13px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.idx-voice span{display:block;margin-top:4px;font-size:11px;color:rgba(238,231,244,.56)}.idx-voice.is-active{border-color:#c890e8;background:rgba(200,144,232,.16);box-shadow:0 0 0 2px rgba(200,144,232,.12)}",
      ".idx-modes{display:grid;grid-template-columns:1fr;gap:7px}.idx-mode{border:1px solid rgba(206,170,230,.16);border-radius:8px;background:rgba(255,255,255,.06);color:#eee7f4;text-align:left;padding:9px;cursor:pointer;font-family:inherit}.idx-mode strong{display:block;font-size:12px}.idx-mode span{display:block;margin-top:3px;font-size:11px;color:rgba(238,231,244,.56)}.idx-mode.is-active{border-color:#c890e8;background:rgba(200,144,232,.16);box-shadow:0 0 0 2px rgba(200,144,232,.10)}",
      ".idx-label{font-size:11px;color:rgba(238,231,244,.66)}.idx-input,.idx-textarea{width:100%;border:1px solid rgba(206,170,230,.16);border-radius:9px;background:#0b0810;color:#eee7f4;padding:8px;font-size:12px;font-family:inherit;outline:none}.idx-btn{height:32px;border:1px solid rgba(206,170,230,.20);border-radius:9px;background:rgba(255,255,255,.06);color:#eee7f4;padding:0 10px;font-size:12px;cursor:pointer;font-family:inherit}.idx-error{margin-top:10px;color:#ffd5dd;background:rgba(120,38,52,.22);border:1px solid rgba(255,120,145,.28);border-radius:10px;padding:8px;font-size:12px;white-space:pre-wrap;overflow-wrap:anywhere}",
      "@media(max-width:520px){.idx-card{padding:14px;border-radius:16px}.idx-panel{top:8px!important;left:8px!important;right:8px!important;bottom:8px!important;transform:none!important;width:auto!important;max-height:none!important;border-radius:16px}.idx-controls{gap:10px}.idx-ctrl-sm{width:40px;height:40px}.idx-ctrl-main{width:62px;height:62px}.idx-ctrl-add,.idx-ctrl-delete{width:44px;height:44px}.idx-grid{grid-template-columns:1fr}.idx-voices{grid-template-columns:1fr 1fr}}"
    ].join("");
    document.head.appendChild(style);
  }

  async function getConfig() {
    var saved = null;
    try { if (window.tavo && typeof tavo.get === "function") saved = await tavo.get(CONFIG_KEY, "global"); } catch (_) {}
    if (!saved) { try { saved = JSON.parse(localStorage.getItem(CONFIG_KEY) || "null"); } catch (_) {} }
    var cfg = Object.assign({}, DEFAULT_CONFIG, saved || {});
    if (cfg.roleVoicesText && !/^\s*narrator\s*[=:：]/m.test(cfg.roleVoicesText)) {
      var m = String(cfg.roleVoicesText).match(/^\s*旁白\s*[=:：]\s*(.+)$/m);
      if (m && m[1]) cfg.roleVoicesText = "narrator=" + m[1].trim() + "\n" + cfg.roleVoicesText;
    }
    return cfg;
  }
  async function saveConfig(cfg) {
    try { if (window.tavo && typeof tavo.set === "function") await tavo.set(CONFIG_KEY, Object.assign({}, cfg), "global"); } catch (_) {}
    try { localStorage.setItem(CONFIG_KEY, JSON.stringify(cfg)); } catch (_) {}
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
    try {
      if (window.tavo && tavo.message && typeof tavo.message.current === "function") {
        var msg = await tavo.message.current();
        if (msg && msg.content) text = String(msg.content);
        if (msg && msg.characterId != null && window.tavo && tavo.character && typeof tavo.character.get === "function") {
          var character = await tavo.character.get(msg.characterId);
          if (character) {
            characterName = character.nickname || character.name || "";
            avatarUrl = avatarUrl || character.avatar || pickAvatarUrl(character);
          }
        }
        avatarUrl = avatarUrl || pickAvatarUrl(msg) || pickAvatarUrl(msg && (msg.character || msg.role || msg.sender || msg.author));
      }
    } catch (_) {}
    try {
      if (!avatarUrl && window.tavo && tavo.character && typeof tavo.character.current === "function") avatarUrl = pickAvatarUrl(await tavo.character.current());
      if (!avatarUrl && window.tavo && tavo.role && typeof tavo.role.current === "function") avatarUrl = pickAvatarUrl(await tavo.role.current());
    } catch (_) {}
    if (!avatarUrl) avatarUrl = domAvatarUrl(script && script.parentElement);
    avatarUrl = normalizeTavoAssetUrl(avatarUrl);
    if (!text && msgEl) {
      try {
        var clone = msgEl.cloneNode(true);
        clone.querySelectorAll('.idx-tts, .idx-card, .idx-panel, .idx-global-gear, script').forEach(function (n) { n.remove(); });
        text = clone.innerText || clone.textContent || "";
      } catch (_) { text = msgEl.innerText || msgEl.textContent || ""; }
    }
    return { text: text.replace(/<script[\s\S]*?<\/script>/gi, "").replace(/\[IndexTTS_TAVO_SCRIPT\]/g, "").trim(), avatarUrl: avatarUrl, characterName: characterName };
  }
  function playIcon(state) { return state === "playing" ? '<svg viewBox="0 0 24 24"><path d="M7 5h4v14H7zm6 0h4v14h-4z"/></svg>' : '<svg viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg>'; }
  function gearIcon() { return '<svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor"><path d="M19.43 12.98c.04-.32.07-.64.07-.98s-.03-.66-.07-.98l2.11-1.65-2-3.46-2.49 1a7.03 7.03 0 0 0-1.69-.98L14 2h-4l-.38 2.65c-.61.25-1.17.58-1.69.98l-2.49-1-2 3.46 2.11 1.65c-.04.32-.07.64-.07.98s.03.66.07.98l-2.11 1.65 2 3.46 2.49-1c.52.4 1.08.73 1.69.98L10 22h4l.38-2.65c.61-.25 1.17-.58 1.69-.98l2.49 1 2-3.46-2.11-1.65zM12 15.5A3.5 3.5 0 1 1 12 8a3.5 3.5 0 0 1 0 7.5z"/></svg>'; }
  function formatTime(sec) { sec = Math.max(0, Number(sec || 0)); if (!isFinite(sec)) return "--:--"; return String(Math.floor(sec / 60)).padStart(2, "0") + ":" + String(Math.floor(sec % 60)).padStart(2, "0"); }
  function parseRoleVoices(text, voice) { var out = { default: voice }; String(text || "").split(/\r?\n/).forEach(function (line) { var m = line.trim().match(/^(.+?)[=:：]\s*(.+)$/); if (m) out[m[1].trim()] = m[2].trim(); }); return out; }
  async function listVoices(base) { try { var r = await fetch(cleanBase(base) + "/voices", { cache: "no-store" }); if (!r.ok) return []; var d = await r.json(); return Array.isArray(d.voices) ? d.voices : []; } catch (_) { return []; } }
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

  async function parseWithLlm(text, cfg, setStatus) {
    setStatus("AI 正在拆分角色和八情绪...");
    var prompt = [
      "把小说正文拆成 TTS 片段。旁白 role 固定 narrator，人物台词 role 用人物名。",
      "每段必须输出 emo_vec，长度 8，数值 0-1。不要输出 emo_text。",
      "只返回 JSON：{\"segments\":[{\"role\":\"narrator\",\"text\":\"...\",\"emo_vec\":[0,0,0,0,0,0,0,0.4]}]}"
    ].join("\n");
    var res = await fetch(cleanBase(cfg.apiBase) + cfg.parseEndpoint, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text: text, endpoint: cfg.llmEndpoint, model: cfg.llmModel, api_key: cfg.llmApiKey || "", system_prompt: prompt, temperature: 0.2, timeout: 90 }) });
    if (!res.ok) throw new Error(await res.text());
    var data = await res.json();
    if (!data || !Array.isArray(data.segments) || !data.segments.length) throw new Error("AI 没有返回可用片段");
    return data.segments.map(function (seg) { return { role: seg.role || "narrator", text: seg.text || "", emo_vec: seg.emo_vec || [0,0,0,0,0,0,0,0.35], emo_alpha: Number(seg.emo_alpha || cfg.emoAlpha || 0.7) }; }).filter(function (seg) { return seg.text.trim(); });
  }

  function removeLegacyGlobalGear() {
    var btn = document.getElementById("indextts-tavo-global-gear");
    if (btn && btn.parentNode) btn.parentNode.removeChild(btn);
  }

  function mount(root, cfg, context) {
    var messageText = context && context.text ? context.text : "";
    var avatarUrl = context && context.avatarUrl ? context.avatarUrl : "";
    root.innerHTML = [
      '<div class="idx-card">',
      '  <button class="idx-gear" type="button" data-role="gear" aria-label="设置">' + gearIcon() + '</button>',
      '  <div class="idx-top"><div class="idx-cover" data-role="cover"></div><div class="idx-info"><div class="idx-title-row"><div class="idx-name" data-role="title">IndexTTS 语音播放器</div><span class="idx-format">WAV</span></div><div class="idx-status" data-role="status">选择音色后点播放</div></div></div>',
      '  <div class="idx-seek-wrap"><input class="idx-seek" data-role="seek" type="range" min="0" max="1000" value="0" disabled><div class="idx-time"><span data-role="current">00:00</span><span data-role="total">--:--</span></div></div>',
      '  <div class="idx-controls"><button class="idx-ctrl idx-ctrl-sm" type="button" data-role="prev" aria-label="上一首" title="上一首"><svg viewBox="0 0 24 24"><path d="M6 6h2v12H6zm3.5 6 8.5 6V6z"/></svg></button><button class="idx-ctrl idx-ctrl-main" type="button" data-role="play" data-state="idle" aria-label="播放">' + playIcon("idle") + '</button><button class="idx-ctrl idx-ctrl-sm" type="button" data-role="next" aria-label="下一首" title="下一首"><svg viewBox="0 0 24 24"><path d="M16 6h2v12h-2zm-10.5 0v12l8.5-6z"/></svg></button><button class="idx-ctrl idx-ctrl-add" type="button" data-role="add" aria-label="生成音频" title="生成音频"><svg viewBox="0 0 24 24"><path d="M12 3v9.55A4 4 0 1 0 14 16V7h4V3z"/></svg></button><button class="idx-ctrl idx-ctrl-delete" type="button" data-role="delete" aria-label="删除当前音频" title="删除当前音频"><svg viewBox="0 0 24 24"><path d="M9 3h6l1 2h4v2H4V5h4l1-2zm1 6h2v8h-2V9zm4 0h2v8h-2V9zM7 9h2v8H7V9zm1 11c-1.1 0-2-.9-2-2V8h12v10c0 1.1-.9 2-2 2H8z"/></svg></button></div>',
      '  <div class="idx-meta"><span class="idx-pill" data-role="voice-pill">音色：自动</span><span class="idx-pill" data-role="mode-pill">模式：单音色</span><span class="idx-pill">字数：' + escapeHtml(String(messageText.length)) + '</span></div>',
      '  <div class="idx-panel idx-hidden" data-role="panel"><div class="idx-panel-head"><div class="idx-panel-title">语音设置</div><button class="idx-close" type="button" data-role="close">×</button></div><div class="idx-section-title">默认音色</div><div class="idx-voices" data-role="voices"></div><div class="idx-section-title">播放模式</div><div class="idx-modes"><button class="idx-mode" data-mode="single" type="button"><strong>单音色</strong><span>不走 LLM，整段使用当前音色</span></button><button class="idx-mode" data-mode="ai8" type="button"><strong>AI 八情绪多角色</strong><span>第三方 AI 拆旁白/人物并输出 emo_vec[8]</span></button></div><div class="idx-section-title">高级</div><div class="idx-grid"><label class="idx-field idx-wide"><span class="idx-label">服务地址（默认自动）</span><input class="idx-input" data-field="apiBase"></label><label class="idx-field"><span class="idx-label">片段间隔 ms</span><input class="idx-input" type="number" data-field="intervalMs" min="0" max="3000"></label><label class="idx-field"><span class="idx-label">LLM 模型</span><input class="idx-input" data-field="llmModel"></label><label class="idx-field idx-wide"><span class="idx-label">角色音色映射</span><textarea class="idx-textarea" data-field="roleVoicesText"></textarea></label><label class="idx-field idx-wide"><span class="idx-label">LLM 接口地址</span><input class="idx-input" data-field="llmEndpoint" placeholder="https://.../v1/chat/completions"></label><label class="idx-field idx-wide"><span class="idx-label">LLM Key</span><input class="idx-input" type="password" data-field="llmApiKey"></label></div><div class="idx-actions"><button class="idx-btn" type="button" data-role="save">保存</button><button class="idx-btn" type="button" data-role="reload">刷新音色</button></div></div>',
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
    var err = first(root, '[data-role="error"]', '.idx-error');
    var seek = first(root, '[data-role="seek"]', '.idx-seek');
    var cur = first(root, '[data-role="current"]', '.idx-time span:first-child');
    var total = first(root, '[data-role="total"]', '.idx-time span:last-child');
    var panel = first(root, '[data-role="panel"]', '.idx-panel');
    var gear = first(root, '[data-role="gear"]', '.idx-gear');
    var close = first(root, '[data-role="close"]', '.idx-close');
    var voicesBox = first(root, '[data-role="voices"]', '.idx-voices');
    var voicePill = first(root, '[data-role="voice-pill"]');
    var modePill = first(root, '[data-role="mode-pill"]');
    var generatedTracks = [];
    var currentTrackIndex = -1;
    var currentCacheKey = "";

    if (!panel) throw new Error("TAVO player missing settings panel");
    removeLegacyGlobalGear();

    function setStatus(v) { if (status) status.textContent = v; }
    function setError(v) { if (err) { err.textContent = v || ""; err.classList.toggle("idx-hidden", !v); } }
    function setPlayState(state) { if (play) { play.dataset.state = state; play.innerHTML = playIcon(state); play.disabled = state === "loading"; } if (cover) cover.dataset.playing = state === "playing" ? "1" : "0"; }
    function updateTrackButtons() {
      if (prev) prev.disabled = currentTrackIndex <= 0;
      if (next) next.disabled = currentTrackIndex < 0 || currentTrackIndex >= generatedTracks.length - 1;
      if (del) del.disabled = currentTrackIndex < 0 || !audio.src;
    }
    function selectTrack(index, autoplay) {
      if (index < 0 || index >= generatedTracks.length) return;
      var track = generatedTracks[index];
      currentTrackIndex = index;
      currentCacheKey = track.cacheKey || "";
      audio.src = track.url;
      if (seek) { seek.disabled = false; seek.value = "0"; }
      setStatus((autoplay ? "正在播放" : "已选择") + "：第 " + String(index + 1) + " 首");
      updateTrackButtons();
      if (autoplay) audio.play().catch(function () { setStatus("请点播放继续"); });
    }
    function clearCurrentTrack() {
      if (currentTrackIndex < 0) return;
      var removed = generatedTracks.splice(currentTrackIndex, 1)[0];
      try { audio.pause(); } catch (_) {}
      if (removed && removed.url && /^blob:/i.test(removed.url)) {
        try { URL.revokeObjectURL(removed.url); } catch (_) {}
      }
      if (removed && removed.cacheKey) {
        fetch(cleanBase(cfg.apiBase) + "/cache/" + encodeURIComponent(removed.cacheKey), { method: "DELETE" }).catch(function () {});
      } else if (removed && removed.deleteUrl) {
        fetch(removed.deleteUrl, { method: "DELETE" }).catch(function () {});
      }
      currentTrackIndex = Math.min(currentTrackIndex, generatedTracks.length - 1);
      if (currentTrackIndex >= 0) {
        selectTrack(currentTrackIndex, false);
      } else {
        audio.removeAttribute("src");
        audio.load();
        currentCacheKey = "";
        if (seek) { seek.disabled = true; seek.value = "0"; }
        if (cur) cur.textContent = "00:00";
        if (total) total.textContent = "--:--";
        setPlayState("idle");
        setStatus("没有可播放音频，点音符生成");
        updateTrackButtons();
      }
    }
    function findInWidget(sel) { return $(root, sel) || $(panel, sel); }
    function field(name) { return findInWidget('[data-field="' + name + '"]'); }
    function setField(name, value) { var el = field(name); if (el) el.value = value == null ? "" : value; }
    function getField(name, fallback) { var el = field(name); return el ? el.value : fallback; }
    function readFields() {
      cfg.apiBase = String(getField("apiBase", cfg.apiBase || scriptOrigin())).trim() || scriptOrigin();
      cfg.intervalMs = Number(getField("intervalMs", cfg.intervalMs || 50) || 50);
      cfg.roleVoicesText = getField("roleVoicesText", cfg.roleVoicesText || "");
      cfg.llmModel = String(getField("llmModel", cfg.llmModel || "")).trim();
      cfg.llmEndpoint = String(getField("llmEndpoint", cfg.llmEndpoint || "")).trim();
      cfg.llmApiKey = String(getField("llmApiKey", cfg.llmApiKey || "")).trim();
    }
    function modeName() { return cfg.mode === "ai8" ? "AI 八情绪多角色" : "单音色"; }
    function syncUI() {
      setField("apiBase", cfg.apiBase || scriptOrigin());
      setField("intervalMs", Number(cfg.intervalMs || 50));
      setField("roleVoicesText", cfg.roleVoicesText || "");
      setField("llmModel", cfg.llmModel || "");
      setField("llmEndpoint", cfg.llmEndpoint || "");
      setField("llmApiKey", cfg.llmApiKey || "");
      if (voicePill) voicePill.textContent = "音色：" + shortName(cfg.defaultVoice);
      if (modePill) modePill.textContent = "模式：" + modeName();
      if (title) title.textContent = (context && context.characterName ? context.characterName : shortName(cfg.defaultVoice)) + " · IndexTTS";
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
    async function renderVoices() {
      setStatus("正在读取音色...");
      var voices = await listVoices(cfg.apiBase);
      if (!cfg.defaultVoice && voices[0]) cfg.defaultVoice = voices[0].name;
      if (!voicesBox) return;
      voicesBox.innerHTML = voices.map(function (v) { var n = escapeHtml(v.name); return '<button class="idx-voice" type="button" data-voice="' + n + '"><strong>' + n + '</strong><span>点击试听</span></button>'; }).join("");
      $all(panel, '.idx-voice').forEach(function (b) { b.addEventListener('click', async function () { cfg.defaultVoice = b.dataset.voice; syncUI(); await saveConfig(cfg); await previewVoice(); }); });
      syncUI();
      setStatus(voices.length ? "已读取 " + voices.length + " 个音色" : "没有找到音色");
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
    async function generate(force) {
      readFields(); await saveConfig(cfg); setError("");
      if (!messageText) { setError("当前消息没有可朗读正文。"); return; }
      if (!cfg.defaultVoice) { setError("请先点选一个音色卡片。"); return; }
      if (audio.src && !force) { if (audio.paused) await audio.play(); else audio.pause(); return; }
      setPlayState("loading");
      try {
        var base = cleanBase(cfg.apiBase), body, url;
        if (cfg.mode === "ai8") {
          setStatus("正在生成整段音频...");
          if (!cfg.llmEndpoint || !cfg.llmModel) throw new Error("AI 八情绪模式需要填写 LLM 接口地址和模型。");
          body = { segments: await parseWithLlm(messageText, cfg, setStatus), voices: parseRoleVoices(cfg.roleVoicesText, cfg.defaultVoice), interval_ms: cfg.intervalMs, top_p: cfg.topP, top_k: cfg.topK, temperature: cfg.temperature, repetition_penalty: cfg.repetitionPenalty, emo_alpha: cfg.emoAlpha };
          url = base + cfg.dialogueEndpoint;
          var res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
          if (!res.ok) throw new Error(await res.text());
          var blob = await res.blob();
          var objectUrl = URL.createObjectURL(blob);
          currentCacheKey = res.headers.get("X-IndexTTS-Cache-Key") || "";
          generatedTracks.push({ url: objectUrl, cacheKey: currentCacheKey, createdAt: Date.now(), voice: cfg.defaultVoice, mode: cfg.mode });
          selectTrack(generatedTracks.length - 1, false);
          setStatus(res.headers.get("X-IndexTTS-Cache") === "HIT" ? "已读取缓存" : "生成完成");
        } else {
          url = await createSingleStreamJob(base, cfg, messageText, force);
          generatedTracks.push({ url: url, cacheKey: "", deleteUrl: singleDeleteUrl(base, cfg, messageText), createdAt: Date.now(), voice: cfg.defaultVoice, mode: cfg.mode, streaming: true });
          selectTrack(generatedTracks.length - 1, false);
          setStatus("正在连接流式音频...");
        }
        await audio.play();
      } catch (e) { setPlayState("idle"); setStatus("生成失败"); setError(e && e.message ? e.message : String(e)); }
    }

    on(gear, 'click', function (ev) { ev.preventDefault(); ev.stopPropagation(); panel.classList.toggle('idx-hidden'); });
    on(close, 'click', function () { panel.classList.add('idx-hidden'); });
    on(play, 'click', function () { generate(false); });
    on(add, 'click', function () { generate(true); });
    on(prev, 'click', function () { selectTrack(currentTrackIndex - 1, true); });
    on(next, 'click', function () { selectTrack(currentTrackIndex + 1, true); });
    on(del, 'click', clearCurrentTrack);
    on(first(panel, '[data-role="save"]'), 'click', async function () { readFields(); await saveConfig(cfg); syncUI(); panel.classList.add('idx-hidden'); setStatus("设置已保存"); });
    on(first(panel, '[data-role="reload"]'), 'click', renderVoices);
    $all(panel, '.idx-mode').forEach(function (b) { b.addEventListener('click', async function () { cfg.mode = b.dataset.mode; syncUI(); await saveConfig(cfg); }); });
    on(audio, 'play', function () { setPlayState("playing"); setStatus("正在播放：" + shortName(cfg.defaultVoice)); });
    on(audio, 'waiting', function () { setPlayState("loading"); setStatus("正在等待音频流..."); });
    on(audio, 'canplay', function () { if (!audio.paused) { setPlayState("playing"); setStatus("正在播放：" + shortName(cfg.defaultVoice)); } });
    on(audio, 'pause', function () { setPlayState("idle"); if (audio.currentTime > 0 && !audio.ended) setStatus("已暂停"); });
    on(audio, 'ended', function () { setPlayState("idle"); setStatus("播放完成"); });
    on(audio, 'error', function () { setPlayState("idle"); setStatus("播放失败"); setError("音频流加载失败。请检查服务地址、音色和后端日志。"); });
    on(audio, 'loadedmetadata', function () { if (seek) seek.disabled = false; if (total) total.textContent = formatTime(audio.duration); });
    on(audio, 'timeupdate', function () { if (cur) cur.textContent = formatTime(audio.currentTime); if (total) total.textContent = audio.duration ? formatTime(audio.duration) : "--:--"; if (seek) seek.value = audio.duration ? String(Math.floor(audio.currentTime / audio.duration * 1000)) : "0"; });
    on(seek, 'input', function () { if (audio && audio.duration) audio.currentTime = Number(seek.value || 0) / 1000 * audio.duration; });

    updateTrackButtons();
    syncUI(); renderVoices().catch(function (e) { setStatus("音色列表读取失败，仍可打开设置"); setError(e && e.message ? e.message : String(e)); });
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
    mount(root, await getConfig(), await currentMessageContext());
  } catch (e) { try { console.error("[IndexTTS TAVO]", e && e.stack ? e.stack : (e && e.message ? e.message : JSON.stringify(e))); } catch (_) {} }
})();
