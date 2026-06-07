;(function () {
  "use strict";

  var loaderScript = (typeof document !== "undefined" && document.currentScript) ? document.currentScript : null;
  var LOADER_VERSION = "20260607-ai-live-v17";
  var STYLE_ID = "indextts-tavo-loader-v2";
  var TRACKS_KEY_PREFIX = "indextts_tracks_";
  var TAP_GUARD_KEY = "__indextts_tavo_tap_guard_until";
  var PICKER_TRIGGER_SELECTOR = '[data-role="normal-narrator-voice-btn"],[data-role="normal-dialogue-voice-btn"],[data-role="roles-list"] .idx-voice-btn,.idx-picker-item,.idx-picker-apply';

  function deriveBaseUrl(src) {
    var raw = String(src || "").trim();
    if (!raw) return { baseUrl: "", query: "" };
    try {
      var u = new URL(raw, (typeof location !== "undefined" ? location.href : "http://localhost/"));
      var idx = u.pathname.lastIndexOf("/");
      var basePath = idx >= 0 ? u.pathname.slice(0, idx + 1) : "/";
      return { baseUrl: u.origin + basePath, query: u.search || "" };
    } catch (_) {
      var qIndex = raw.indexOf("?");
      var noQuery = qIndex >= 0 ? raw.slice(0, qIndex) : raw;
      var slash = noQuery.lastIndexOf("/");
      return { baseUrl: slash >= 0 ? noQuery.slice(0, slash + 1) : "", query: qIndex >= 0 ? raw.slice(qIndex) : "" };
    }
  }

  function joinUrl(base, fileName, query) {
    return String(base || "") + String(fileName || "") + String(query || "");
  }

  function withQueryParam(url, key, value) {
    try {
      var u = new URL(url, (typeof location !== "undefined" ? location.href : "http://localhost/"));
      u.searchParams.set(key, String(value));
      return u.href;
    } catch (_) {
      var sep = String(url || "").indexOf("?") >= 0 ? "&" : "?";
      return String(url || "") + sep + encodeURIComponent(key) + "=" + encodeURIComponent(String(value));
    }
  }

  function assetUrl(fileName) {
    try {
      var src = loaderScript && loaderScript.src ? loaderScript.src : "";
      if (src) return new URL(fileName, src).href;
    } catch (_) {}
    try {
      var info = deriveBaseUrl(loaderScript && loaderScript.src);
      return joinUrl(info.baseUrl || "", fileName, "");
    } catch (_) {
      return String(fileName || "");
    }
  }

  function escapeHtml(value) {
    return String(value == null ? "" : value).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
  }

  function formatTime(sec) {
    sec = Math.max(0, Number(sec || 0));
    if (!isFinite(sec)) return "--:--";
    return String(Math.floor(sec / 60)).padStart(2, "0") + ":" + String(Math.floor(sec % 60)).padStart(2, "0");
  }

  function stableHash(text) {
    text = String(text || "");
    var h = 2166136261;
    for (var i = 0; i < text.length; i++) {
      h ^= text.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return (h >>> 0).toString(16);
  }

  function playIcon() {
    return '<svg viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg>';
  }

  function gearIcon() {
    return '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="4" y1="7" x2="20" y2="7"/><line x1="4" y1="17" x2="20" y2="17"/><circle cx="9" cy="7" r="2.2"/><circle cx="15" cy="17" r="2.2"/></svg>';
  }

  function prevIcon() {
    return '<svg viewBox="0 0 24 24"><path d="M6 6h2v12H6zm3.5 6 8.5 6V6z"/></svg>';
  }

  function nextIcon() {
    return '<svg viewBox="0 0 24 24"><path d="M16 6h2v12h-2zm-10.5 0v12l8.5-6z"/></svg>';
  }

  function musicIcon() {
    return '<svg viewBox="0 0 24 24"><path d="M12 3v9.55A4 4 0 1 0 14 16V7h4V3z"/></svg>';
  }

  function deleteIcon() {
    return '<svg viewBox="0 0 24 24"><path d="M9 3h6l1 2h4v2H4V5h4l1-2zm1 6h2v8h-2V9zm4 0h2v8h-2V9zM7 9h2v8H7V9zm1 11c-1.1 0-2-.9-2-2V8h12v10c0 1.1-.9 2-2 2H8z"/></svg>';
  }

  function $(root, sel) { return root && root.querySelector ? root.querySelector(sel) : null; }
  function $all(root, sel) { return root && root.querySelectorAll ? Array.prototype.slice.call(root.querySelectorAll(sel)) : []; }
  function on(el, ev, fn) { if (el) el.addEventListener(ev, fn); }

  function messageElement(scriptEl) {
    var el = scriptEl && scriptEl.parentElement;
    while (el && el !== document.body) {
      if (el.dataset && (el.dataset.messageId || el.dataset.id || el.dataset.mid)) return el;
      if (el.classList && (el.classList.contains("message") || el.classList.contains("mes") || el.classList.contains("tavo-message"))) return el;
      if (el.hasAttribute && (el.hasAttribute("mesid") || el.hasAttribute("data-message-id"))) return el;
      el = el.parentElement;
    }
    return scriptEl && scriptEl.parentElement;
  }

  function messageTextForHash(scriptEl) {
    try {
      var msgEl = messageElement(scriptEl);
      if (!msgEl) return "";
      var clone = msgEl.cloneNode(true);
      $all(clone, ".idx-tts,.idx-card,.idx-panel,.idx-picker,script").forEach(function (n) { if (n.parentNode) n.parentNode.removeChild(n); });
      return String(clone.innerText || clone.textContent || "").replace(/\s+/g, " ").trim();
    } catch (_) { return ""; }
  }

  function pickMessageId(scriptEl) {
    var id = "";
    try {
      var msgEl = messageElement(scriptEl);
      if (msgEl && msgEl.dataset) id = String(msgEl.dataset.messageId || msgEl.dataset.id || msgEl.dataset.mid || "").trim();
      if (!id && msgEl && msgEl.getAttribute) id = String(msgEl.getAttribute("mesid") || msgEl.getAttribute("data-message-id") || msgEl.id || "").trim();
    } catch (_) {}
    try { if (!id) id = String((scriptEl && scriptEl.parentElement && (scriptEl.parentElement.id || scriptEl.parentElement.dataset.id)) || "").trim(); } catch (_) {}
    if (!id) {
      var text = messageTextForHash(scriptEl);
      if (text) id = "message-" + stableHash(text);
    }
    return id;
  }

  async function resolveTavoMessageId(fallbackId) {
    try {
      if (window.tavo && window.tavo.message && typeof window.tavo.message.current === "function") {
        var msg = await window.tavo.message.current();
        if (msg && msg.id != null) return String(msg.id).trim() || fallbackId || "";
      }
    } catch (_) {}
    return fallbackId || "";
  }

  function persistedTrackLooksSaved(t) {
    if (!t || !t.cacheKey || t.deleted || t.cancelled) return false;
    var state = String(t.state || "").trim();
    var status = String(t.status || "").trim();
    var serverState = String(t.serverState || "").trim();
    var cacheState = String(t.cacheState || t.remoteCacheState || "").trim();
    if (state === "failed" || state === "cancelled" || status === "failed" || status === "cancelled" || serverState === "failed" || serverState === "cancelled") return false;
    return state === "saved" || cacheState === "ready" || !!(t.cacheReady || t.fromHistory || t.status === "ready");
  }

  function persistableHistoryTracks(tracks) {
    return (tracks || []).filter(persistedTrackLooksSaved);
  }

  function tracksFromStorageKey(key) {
    try {
      if (window.tavo && typeof window.tavo.get === "function") {
        var cv = window.tavo.get(key, "chat");
        if (Array.isArray(cv)) return cv;
        var gv = window.tavo.get(key, "global");
        if (Array.isArray(gv)) return gv;
      }
    } catch (_) {}
    try {
      var raw = localStorage.getItem(key);
      if (raw == null) return null;
      var arr = raw ? JSON.parse(raw) : [];
      return Array.isArray(arr) ? arr : [];
    } catch (_) {}
    return null;
  }

  function localTracksForMessage(messageId) {
    if (!messageId) return [];
    var tracks = tracksFromStorageKey(TRACKS_KEY_PREFIX + messageId);
    return Array.isArray(tracks) ? tracks : [];
  }

  function latestTrack(messageId) {
    var arr = persistableHistoryTracks(localTracksForMessage(messageId));
    return arr.length ? arr[arr.length - 1] : null;
  }

  function shortName(v) {
    v = String(v || "").trim();
    if (!v) return "语音";
    var parts = v.split(/[\\/]/);
    return (parts[parts.length - 1] || v).replace(/\.[a-z0-9]+$/i, "") || "语音";
  }

  function ensureStyle() {
    if (document.getElementById(STYLE_ID)) return;
    var style = document.createElement("style");
    style.id = STYLE_ID;
    style.textContent = [
      ".idx-tts{max-width:760px;margin:12px 0;color:#eee7f4;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI','Microsoft YaHei',sans-serif;line-height:1.45;letter-spacing:0}",
      ".idx-lazy-card{position:relative;display:flex;align-items:center;gap:12px;border-radius:16px;background:radial-gradient(circle at 88% 8%,rgba(216,167,255,.18),transparent 40%),linear-gradient(160deg,rgba(27,21,34,.55),rgba(12,9,16,.55));border:1px solid rgba(206,170,230,.22);padding:14px;backdrop-filter:blur(18px) saturate(130%);-webkit-backdrop-filter:blur(18px) saturate(130%)}",
      ".idx-lazy-play{border:1px solid rgba(206,170,230,.30);background:rgba(20,14,28,.58);color:#eee7f4;display:flex;align-items:center;justify-content:center;cursor:pointer;padding:0;flex:0 0 auto;width:58px;height:58px;border-radius:50%}.idx-lazy-play svg{width:26px;height:26px;fill:currentColor}.idx-lazy-play[data-loading='1']{opacity:.65;cursor:progress}",
      ".idx-lazy-main{min-width:0;flex:1;cursor:pointer}.idx-lazy-title{font-size:17px;font-weight:800;color:#e9c8ff;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.idx-lazy-status{margin-top:4px;font-size:12px;color:rgba(238,231,244,.66);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.idx-lazy-progress{height:4px;margin-top:8px;background:rgba(206,170,230,.13);border-radius:999px;overflow:hidden}.idx-lazy-progress span{display:block;height:100%;background:linear-gradient(90deg,#c890e8,#8ecbff);border-radius:inherit}",
      ".idx-card[data-loader-shell='1']{position:relative;overflow:hidden;height:450px;min-height:450px;border-radius:18px;background:radial-gradient(circle at 88% 8%,rgba(216,167,255,.22),transparent 40%),linear-gradient(160deg,rgba(27,21,34,.55) 0%,rgba(18,14,24,.48) 54%,rgba(12,9,16,.55) 100%);border:1px solid rgba(206,170,230,.22);padding:16px;display:flex;flex-direction:column;backdrop-filter:blur(22px) saturate(140%);-webkit-backdrop-filter:blur(22px) saturate(140%)}",
      ".idx-card[data-loader-shell='1'] .idx-gear,.idx-card[data-loader-shell='1'] .idx-playback-toggle{position:absolute;top:26px;height:36px;border-radius:999px;border:1px solid rgba(206,170,230,.24);background:rgba(20,14,28,.46);color:rgba(238,231,244,.86);display:flex;align-items:center;justify-content:center;cursor:pointer;padding:0;z-index:2}.idx-card[data-loader-shell='1'] .idx-gear{right:14px;width:42px}.idx-card[data-loader-shell='1'] .idx-gear svg{width:16px;height:16px;fill:none;stroke:currentColor;stroke-width:1.8}.idx-card[data-loader-shell='1'] .idx-playback-toggle{right:60px;width:38px;min-width:38px;font-size:11px;font-weight:900;font-family:inherit;color:rgba(216,241,255,.88)}",
      ".idx-card[data-loader-shell='1'] .idx-top{display:flex;align-items:center;gap:12px;min-width:0;padding-right:94px;min-height:56px}.idx-card[data-loader-shell='1'] .idx-cover{width:56px;height:56px;flex:0 0 56px;border-radius:14px;background:#241a2c;display:flex;align-items:center;justify-content:center;color:#e9c8ff;font-size:18px;font-weight:800;background-size:cover;background-position:center;box-shadow:inset 0 0 0 1px rgba(255,255,255,.08),0 10px 24px rgba(0,0,0,.34)}.idx-card[data-loader-shell='1'] .idx-cover[data-has-image='1']{font-size:0;color:transparent}.idx-card[data-loader-shell='1'] .idx-info{flex:1;min-width:0}.idx-card[data-loader-shell='1'] .idx-name{font-size:18px;font-weight:800;color:#e9c8ff;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.idx-card[data-loader-shell='1'] .idx-status{margin-top:4px;font-size:12px;color:rgba(238,231,244,.62);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}",
      ".idx-card[data-loader-shell='1'] .idx-loader-gap{height:64px;flex:0 0 64px}",
      ".idx-card[data-loader-shell='1'] .idx-subtitle{position:relative;display:flex;flex-direction:column;justify-content:center;margin:12px 0 0;padding:28px 10px 9px;background:linear-gradient(180deg,rgba(60,36,84,.30) 0%,rgba(40,24,56,.48) 50%,rgba(60,36,84,.30) 100%);border:1px solid rgba(206,170,230,.18);border-radius:14px;height:172px;min-height:172px;max-height:172px;overflow:hidden}.idx-card[data-loader-shell='1'] .idx-sub-notice{margin:auto;text-align:center;color:rgba(244,231,255,.78);font-size:13px;line-height:1.45;max-width:92%;padding:10px 8px}.idx-card[data-loader-shell='1'] .idx-sub-notice strong{display:block;color:#fff;font-size:15px;margin-bottom:4px}.idx-card[data-loader-shell='1'] .idx-sub-notice span{display:block;color:rgba(244,231,255,.56);font-size:12px}",
      ".idx-card[data-loader-shell='1'] .idx-card-counter{position:absolute;right:10px;top:8px;min-width:48px;height:24px;padding:0 9px;border:1px solid rgba(206,170,230,.20);border-radius:999px;background:rgba(20,14,28,.58);color:rgba(238,231,244,.78);font-size:11px;font-weight:800;font-variant-numeric:tabular-nums;display:flex;align-items:center;justify-content:center;z-index:1;pointer-events:none}.idx-card[data-loader-shell='1'] .idx-sub-delete{position:absolute;left:10px;top:8px;width:26px;height:24px;border:1px solid rgba(255,120,145,.26);border-radius:999px;background:rgba(120,38,52,.30);color:#ffd5dd;display:flex;align-items:center;justify-content:center;cursor:pointer;padding:0;z-index:2}.idx-card[data-loader-shell='1'] .idx-sub-delete svg{width:14px;height:14px;fill:currentColor;stroke:none}",
      ".idx-card[data-loader-shell='1'] .idx-controls{display:flex;align-items:center;justify-content:center;gap:16px;margin-top:18px;min-height:74px;flex:0 0 74px;flex-wrap:nowrap}.idx-card[data-loader-shell='1'] .idx-ctrl{border:1px solid rgba(206,170,230,.16);border-radius:50%;background:rgba(206,170,230,.08);color:#eee7f4;cursor:pointer;display:flex;align-items:center;justify-content:center;padding:0}.idx-card[data-loader-shell='1'] .idx-ctrl svg{width:20px;height:20px;fill:none;stroke:currentColor;stroke-width:2.3;stroke-linecap:round;stroke-linejoin:round}.idx-card[data-loader-shell='1'] .idx-ctrl-sm{width:42px;height:42px}.idx-card[data-loader-shell='1'] .idx-ctrl-main,.idx-card[data-loader-shell='1'] .idx-ctrl-add{width:66px;height:66px}.idx-card[data-loader-shell='1'] .idx-ctrl-main{background:#c890e8;color:#170e20;border-color:rgba(255,255,255,.18);box-shadow:0 10px 24px rgba(200,144,232,.25)}.idx-card[data-loader-shell='1'] .idx-ctrl-main svg,.idx-card[data-loader-shell='1'] .idx-ctrl-add svg{width:28px;height:28px;fill:currentColor;stroke:none}.idx-card[data-loader-shell='1'] .idx-ctrl-main[data-state='loading'] svg{animation:idx-loader-spin .9s linear infinite}.idx-card[data-loader-shell='1'] .idx-ctrl-add{margin-left:22px;background:rgba(154,94,182,.42);color:#f4e7ff;box-shadow:0 10px 24px rgba(154,94,182,.18)}.idx-card[data-loader-shell='1'] .idx-live-exit,.idx-card[data-loader-shell='1'] .idx-hidden{display:none!important}@keyframes idx-loader-spin{to{transform:rotate(360deg)}}",
      "@media(max-width:520px){.idx-card[data-loader-shell='1']{height:430px;min-height:430px;padding:14px;border-radius:16px}.idx-card[data-loader-shell='1'] .idx-top{padding-right:84px}.idx-card[data-loader-shell='1'] .idx-gear,.idx-card[data-loader-shell='1'] .idx-playback-toggle{top:25px;height:34px}.idx-card[data-loader-shell='1'] .idx-gear{right:14px;width:40px}.idx-card[data-loader-shell='1'] .idx-playback-toggle{right:58px;width:34px;min-width:34px}.idx-card[data-loader-shell='1'] .idx-controls{gap:13px}.idx-card[data-loader-shell='1'] .idx-ctrl-main,.idx-card[data-loader-shell='1'] .idx-ctrl-add{width:62px;height:62px}.idx-card[data-loader-shell='1'] .idx-ctrl-add{margin-left:16px}}",
      ".idx-tts[data-touch-guard='1']{pointer-events:none!important}"
    ].join("");
    document.head.appendChild(style);
  }

  function installGlobalTapGuard() {
    try {
      if (window.__indextts_tavo_tap_guard_installed) return;
      window.__indextts_tavo_tap_guard_installed = true;
      function settingsPanelOpen() {
        try { return !!document.querySelector(".idx-panel[open],.idx-panel[data-open='1']"); }
        catch (_) { return false; }
      }
      ["click", "touchend", "pointerup", "mouseup"].forEach(function (type) {
        document.addEventListener(type, function (ev) {
          var until = Number(window[TAP_GUARD_KEY] || 0) || 0;
          if (!until || Date.now() > until) return;
          var target = ev.target;
          if (target && target.closest && target.closest('[data-role="lazy-card"]')) return;
          if (!target || !target.closest || !target.closest(PICKER_TRIGGER_SELECTOR)) return;
          if (settingsPanelOpen()) return;
          ev.preventDefault();
          ev.stopPropagation();
          if (typeof ev.stopImmediatePropagation === "function") ev.stopImmediatePropagation();
        }, true);
      });
    } catch (_) {}
  }

  function armTapGuard(ms) {
    installGlobalTapGuard();
    try { window[TAP_GUARD_KEY] = Date.now() + Math.max(800, Number(ms || 0) || 0); } catch (_) {}
  }

  function startPreprimedAudioKeepalive(ctx) {
    if (!ctx) return;
    try {
      if (window.__indextts_tavo_preprimed_keepalive_source) return;
      var rate = ctx.sampleRate || 44100;
      var frames = Math.max(1, Math.floor(rate * 0.5));
      var buf = ctx.createBuffer(1, frames, rate);
      var data = buf.getChannelData(0);
      for (var i = 0; i < data.length; i++) data[i] = 0.00001;
      var gain = ctx.createGain ? ctx.createGain() : null;
      var src = ctx.createBufferSource();
      src.buffer = buf;
      src.loop = true;
      if (gain) {
        gain.gain.value = 0.00001;
        src.connect(gain);
        gain.connect(ctx.destination);
      } else {
        src.connect(ctx.destination);
      }
      src.start(0);
      window.__indextts_tavo_preprimed_keepalive_source = src;
    } catch (_) {}
  }

  function primeRuntimeAudioContext() {
    try {
      var ctx = window.__indextts_tavo_preprimed_audio_context;
      if (ctx) {
        try { if (ctx.state === "suspended") ctx.resume(); } catch (_) {}
        startPreprimedAudioKeepalive(ctx);
        return ctx;
      }
      var AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return null;
      ctx = new AC();
      try { ctx.resume(); } catch (_) {}
      try {
        var rate = ctx.sampleRate || 44100;
        var buf = ctx.createBuffer(1, Math.max(1, Math.floor(rate * 0.025)), rate);
        var data = buf.getChannelData(0);
        if (data && data.length) data[0] = 0.0005;
        var src = ctx.createBufferSource();
        src.buffer = buf;
        src.connect(ctx.destination);
        src.start(0);
      } catch (_) {}
      window.__indextts_tavo_preprimed_audio_context = ctx;
      startPreprimedAudioKeepalive(ctx);
      return ctx;
    } catch (_) { return null; }
  }

  function closeAccidentalPicker() {
    try {
      $all(document, ".idx-picker[open]").forEach(function (picker) {
        if (picker && picker.getAttribute && picker.getAttribute("data-open") === "1") return;
        try { if (typeof picker.close === "function") picker.close(); else picker.removeAttribute("open"); }
        catch (_) { try { picker.removeAttribute("open"); } catch (__) {} }
        try { picker.removeAttribute("data-open"); } catch (_) {}
        try { picker.setAttribute("aria-hidden", "true"); } catch (_) {}
      });
    } catch (_) {}
  }

  function loadScript(src, setup) {
    return new Promise(function (resolve, reject) {
      var s = document.createElement("script");
      s.src = src;
      s.async = false;
      if (typeof setup === "function") { try { setup(s); } catch (_) {} }
      s.onload = function () { resolve(s); };
      s.onerror = function () { reject(new Error(src)); };
      (document.head || document.documentElement || document.body).appendChild(s);
    });
  }

  function updateLazyHistory(root, messageId) {
    if (!root || !messageId) return;
    var latest = latestTrack(messageId);
    var historyCount = persistableHistoryTracks(localTracksForMessage(messageId)).length;
    var status = $(root, '[data-role="lazy-status"]');
    var progress = $(root, ".idx-lazy-progress span");
    var title = $(root, ".idx-lazy-title");
    var resumeSec = latest ? Math.max(0, Number(latest.lastElementSec || latest.lastWebAudioSec || 0) || 0) : 0;
    if (title && latest && latest.voice) title.textContent = shortName(latest.voice);
    if (status) status.textContent = latest ? ("历史音频 " + historyCount + " 条 · " + formatTime(resumeSec)) : "历史音频 0 条 · 点开播放器";
    if (progress) progress.style.width = (latest && latest.duration_s ? Math.max(2, Math.min(100, resumeSec / Number(latest.duration_s || 1) * 100)) : 0) + "%";
  }

  function setLoaderShellStatus(root, title, detail, loading) {
    if (!root) return;
    var status = $(root, '[data-role="status"]');
    var notice = $(root, ".idx-sub-notice");
    var playBtn = $(root, '[data-role="play"]');
    if (status && title) status.textContent = title;
    if (notice && (title || detail)) {
      notice.innerHTML = '<strong>' + escapeHtml(title || "播放器加载中") + '</strong><span>' + escapeHtml(detail || "正在准备播放器") + '</span>';
    }
    if (playBtn) {
      if (loading) playBtn.setAttribute("data-state", "loading");
      else playBtn.setAttribute("data-state", "idle");
    }
  }

  function loaderShellActionSelector(action) {
    action = String(action || "").trim();
    if (action === "play") return '[data-role="play"]';
    if (action === "add") return '[data-role="add"]';
    if (action === "gear") return '[data-role="gear"]';
    if (action === "prev") return '[data-role="prev"]';
    if (action === "next") return '[data-role="next"]';
    if (action === "delete") return '[data-role="delete"]';
    if (action === "playback") return '[data-role="playback-mode-toggle"]';
    return "";
  }

  function renderLoaderShell(root, messageId, action) {
    if (!root) return;
    var shell = $(root, '[data-role="loader-shell"]');
    var latest = latestTrack(messageId);
    var historyCount = persistableHistoryTracks(localTracksForMessage(messageId)).length;
    var resumeSec = latest ? Math.max(0, Number(latest.lastElementSec || latest.lastWebAudioSec || 0) || 0) : 0;
    var title = shortName(latest && latest.voice);
    var statusText = action === "play" ? "准备播放…" : "播放器打开中…";
    var detail = action === "gear" ? "设置面板会在加载完成后自动打开" : "组件加载在后台继续，不会创建新的语音任务";
    var narratorAvatar = assetUrl("tavo.assets/narrator.png");
    var coverStyle = narratorAvatar ? ' style="background-image:url(&quot;' + escapeHtml(narratorAvatar).replace(/"/g, "%22") + '&quot;)" data-has-image="1"' : "";
    if (shell) {
      setLoaderShellStatus(root, statusText, detail, action === "play");
      return;
    }
    root.removeAttribute("data-lazy-placeholder");
    root.setAttribute("data-loader-shell", "1");
    root.innerHTML = [
      '<div class="idx-card" data-loader-shell="1" data-role="loader-shell">',
      '  <button class="idx-gear" type="button" data-role="gear" data-loader-action="gear" aria-label="设置" title="设置">' + gearIcon() + '</button>',
      '  <button class="idx-playback-toggle" type="button" data-role="playback-mode-toggle" data-loader-action="playback" aria-label="播放模式" title="播放模式">L</button>',
      '  <div class="idx-top"><div class="idx-cover" data-role="cover"' + coverStyle + '>' + escapeHtml(title.slice(0, 1) || "旁") + '</div><div class="idx-info"><div class="idx-name" data-role="title">' + escapeHtml(title) + '</div><div class="idx-status" data-role="status">' + escapeHtml(statusText) + '</div></div></div>',
      '  <div class="idx-loader-gap" aria-hidden="true"></div>',
      '  <div class="idx-subtitle" data-role="subtitle"><button class="idx-sub-delete" type="button" data-role="delete" data-loader-action="delete" aria-label="删除当前音频" title="删除当前音频">' + deleteIcon() + '</button><div class="idx-card-counter" data-role="counter">' + (historyCount ? "1/" + historyCount : "0/0") + '</div><div class="idx-sub-notice"><strong>' + escapeHtml(statusText) + '</strong><span>' + escapeHtml(detail) + '</span></div></div>',
      '  <div class="idx-controls"><button class="idx-ctrl idx-ctrl-sm" type="button" data-role="prev" data-loader-action="prev" aria-label="上一首" title="上一首">' + prevIcon() + '</button><button class="idx-ctrl idx-ctrl-main" type="button" data-role="play" data-loader-action="play" data-state="' + (action === "play" ? "loading" : "idle") + '" aria-label="播放">' + playIcon() + '</button><button class="idx-ctrl idx-live-exit idx-hidden" type="button" data-role="live-exit" aria-label="退出流式"></button><button class="idx-ctrl idx-ctrl-sm" type="button" data-role="next" data-loader-action="next" aria-label="下一首" title="下一首">' + nextIcon() + '</button><button class="idx-ctrl idx-ctrl-add" type="button" data-role="add" data-loader-action="add" aria-label="生成音频" title="生成音频">' + musicIcon() + '</button></div>',
      '</div>'
    ].join("");
  }

  function findRuntimeTarget(scope, selector, shellRoot) {
    var candidates = [];
    try { candidates = candidates.concat($all(scope || document, selector)); } catch (_) {}
    try { candidates = candidates.concat($all(document, selector)); } catch (_) {}
    for (var i = 0; i < candidates.length; i++) {
      var el = candidates[i];
      if (!el) continue;
      try {
        if (shellRoot && shellRoot.contains && shellRoot.contains(el)) continue;
        if (el.closest && el.closest('[data-loader-shell="1"]')) continue;
      } catch (_) {}
      return el;
    }
    return null;
  }

  function refreshLazyHistoryAsync(root, messageId) {
    if (!root || !messageId || !window.tavo || typeof window.tavo.get !== "function") {
      updateLazyHistory(root, messageId);
      return;
    }
    var key = TRACKS_KEY_PREFIX + messageId;
    var bestCount = persistableHistoryTracks(localTracksForMessage(messageId)).length;
    function storeAndUpdate(value) {
      if (!Array.isArray(value)) return;
      var saved = persistableHistoryTracks(value);
      if (!saved.length && bestCount > 0) return;
      if (saved.length < bestCount) return;
      bestCount = saved.length;
      try { localStorage.setItem(key, JSON.stringify(saved)); } catch (_) {}
      updateLazyHistory(root, messageId);
    }
    try {
      var chatValue = window.tavo.get(key, "chat");
      if (chatValue && typeof chatValue.then === "function") chatValue.then(storeAndUpdate).catch(function () {});
      else storeAndUpdate(chatValue);
    } catch (_) {}
    try {
      var globalValue = window.tavo.get(key, "global");
      if (globalValue && typeof globalValue.then === "function") globalValue.then(storeAndUpdate).catch(function () {});
      else storeAndUpdate(globalValue);
    } catch (_) {}
  }

  function scheduleLazyHistoryRefresh(root, messageId) {
    var attempts = 0;
    function run() {
      attempts++;
      resolveTavoMessageId(messageId).then(function (resolvedId) {
        if (resolvedId && resolvedId !== messageId) {
          messageId = resolvedId;
          try { root.setAttribute("data-indextts-message-id", messageId); } catch (_) {}
        }
        refreshLazyHistoryAsync(root, messageId);
        if (attempts < 8) setTimeout(run, attempts < 3 ? 350 : 1200);
      }).catch(function () {
        refreshLazyHistoryAsync(root, messageId);
        if (attempts < 8) setTimeout(run, attempts < 3 ? 350 : 1200);
      });
    }
    run();
  }

  try {
    try { console.log("[IndexTTS TAVO loader] loaded", LOADER_VERSION, (loaderScript && loaderScript.src) || "inline"); } catch (_) {}
    ensureStyle();
    if (loaderScript && loaderScript.dataset.indexttsLoaderMounted === "1") return;
    if (loaderScript) loaderScript.dataset.indexttsLoaderMounted = "1";

    var msgEl = messageElement(loaderScript);
    if (msgEl && msgEl !== document.body && msgEl !== document.documentElement) {
      var existingFull = $all(msgEl, ".idx-tts").filter(function (node) { return !!$(node, ".idx-card") && !$(node, '[data-role="loader-shell"]'); })[0];
      if (existingFull) {
        $all(msgEl, ".idx-tts").forEach(function (node) {
          if (node !== existingFull && $(node, ".idx-lazy-card") && node.parentNode) node.parentNode.removeChild(node);
        });
        return;
      }
      $all(msgEl, ".idx-tts").forEach(function (node) { if (node.parentNode) node.parentNode.removeChild(node); });
    }

    var root = document.createElement("div");
    root.className = "idx-tts";
    root.setAttribute("data-lazy-placeholder", "1");
    if (loaderScript && loaderScript.parentNode) loaderScript.parentNode.insertBefore(root, loaderScript.nextSibling);
    else document.body.appendChild(root);

    var info = deriveBaseUrl(loaderScript && loaderScript.src);
    var runtimeSrc = withQueryParam(joinUrl(info.baseUrl || "", "tavo.runtime.js", info.query || ""), "runtime_v", LOADER_VERSION);
    try { window.__indextts_tavo_loader_version = LOADER_VERSION; } catch (_) {}

    var messageId = pickMessageId(loaderScript);
    try { root.setAttribute("data-indextts-message-id", messageId || ""); } catch (_) {}
    var latest = latestTrack(messageId);
    var historyCount = persistableHistoryTracks(localTracksForMessage(messageId)).length;
    var resumeSec = latest ? Math.max(0, Number(latest.lastElementSec || latest.lastWebAudioSec || 0) || 0) : 0;
    var title = shortName(latest && latest.voice);
    root.innerHTML = [
      '<div class="idx-lazy-card" data-role="lazy-card">',
      '  <button class="idx-lazy-play" type="button" data-role="lazy-play" aria-label="播放最后一条语音" title="' + escapeHtml(resumeSec ? ("从 " + formatTime(resumeSec) + " 继续") : "播放语音") + '">' + playIcon() + '</button>',
      '  <div class="idx-lazy-main" data-role="lazy-open" role="button" tabindex="0">',
      '    <div class="idx-lazy-title">' + escapeHtml(title) + '</div>',
      '    <div class="idx-lazy-status" data-role="lazy-status">' + (latest ? ("历史音频 " + historyCount + " 条 · " + formatTime(resumeSec)) : "历史音频 0 条 · 点开播放器") + '</div>',
      '    <div class="idx-lazy-progress"><span style="width:' + (latest && latest.duration_s ? Math.max(2, Math.min(100, resumeSec / Number(latest.duration_s || 1) * 100)) : 0) + '%"></span></div>',
      '  </div>',
      '</div>'
    ].join("");
    scheduleLazyHistoryRefresh(root, messageId);

    try {
      window.addEventListener("indextts:tracks-updated", function (ev) {
        var detail = (ev && ev.detail) || {};
        var incoming = String(detail.messageId || "").trim();
        var own = String(root.getAttribute("data-indextts-message-id") || messageId || "").trim();
        if (incoming && own && incoming !== own) return;
        if (incoming && !own) {
          messageId = incoming;
          try { root.setAttribute("data-indextts-message-id", messageId); } catch (_) {}
        }
        refreshLazyHistoryAsync(root, messageId);
      });
    } catch (_) {}

    var bootPromise = null;
    on(root, "click", function (ev) {
      var target = ev.target;
      var actionEl = target && target.closest ? target.closest("[data-loader-action]") : null;
      if (!actionEl || !root.contains(actionEl)) return;
      var action = String(actionEl.getAttribute("data-loader-action") || "");
      var selector = loaderShellActionSelector(action);
      if (!selector) return;
      ev.preventDefault();
      ev.stopPropagation();
      armTapGuard(1800);
      if (action === "play" || action === "add") primeRuntimeAudioContext();
      renderLoaderShell(root, messageId, action);
      route(selector);
    });

    function mountRuntime(clickSelector) {
      var action = "";
      if (clickSelector === '[data-role="play"]') action = "play";
      else if (clickSelector === '[data-role="add"]') action = "add";
      else if (clickSelector === '[data-role="gear"]') action = "gear";
      renderLoaderShell(root, messageId, action);
      if (bootPromise) return bootPromise.then(function () { return clickSelector; });
      var playBtn = $(root, '[data-role="lazy-play"]');
      if (playBtn) playBtn.setAttribute("data-loading", "1");
      bootPromise = loadScript(runtimeSrc, function () {
        try { window.__indextts_tavo_runtime_script_override = loaderScript; } catch (_) {}
      }).then(function () {
        var runtimeReady = null;
        try { runtimeReady = window.__indextts_tavo_runtime_ready; } catch (_) {}
        if (runtimeReady && typeof runtimeReady.then === "function") return runtimeReady;
        return true;
      }).then(function () {
        root.setAttribute("data-runtime-loaded", "1");
        root.style.display = "none";
        root.setAttribute("data-touch-guard", "1");
        armTapGuard(1600);
        [0, 80, 220, 520].forEach(function (delay) { setTimeout(closeAccidentalPicker, delay); });
        setTimeout(function () { try { root.removeAttribute("data-touch-guard"); } catch (_) {} }, 1600);
        return clickSelector;
      }).catch(function (e) {
        bootPromise = null;
        if (playBtn) playBtn.removeAttribute("data-loading");
        setLoaderShellStatus(root, "播放器加载失败", "请确认 /static/tavo.runtime.js 能访问；再次点击会重试", false);
        throw e;
      }).finally(function () {
        try { if (window.__indextts_tavo_runtime_script_override === loaderScript) window.__indextts_tavo_runtime_script_override = null; } catch (_) {}
      });
      return bootPromise;
    }

    function route(selector) {
      mountRuntime(selector).then(function (sel) {
        if (!sel) return;
        var scope = messageElement(loaderScript) || document;
        var btn = findRuntimeTarget(scope, sel, root);
        if (btn) btn.click();
      }).catch(function (e) {
        try { console.error("[IndexTTS TAVO loader]", e && e.message ? e.message : e); } catch (_) {}
      });
    }

    on($(root, '[data-role="lazy-play"]'), "pointerdown", function () { armTapGuard(1600); primeRuntimeAudioContext(); });
    on($(root, '[data-role="lazy-play"]'), "touchstart", function () { armTapGuard(1600); primeRuntimeAudioContext(); });
    on($(root, '[data-role="lazy-open"]'), "pointerdown", function () { armTapGuard(1600); });
    on($(root, '[data-role="lazy-open"]'), "touchstart", function () { armTapGuard(1600); });
    on($(root, '[data-role="lazy-play"]'), "click", function (ev) { ev.preventDefault(); ev.stopPropagation(); armTapGuard(1800); primeRuntimeAudioContext(); route('[data-role="play"]'); });
    on($(root, '[data-role="lazy-open"]'), "click", function (ev) { ev.preventDefault(); ev.stopPropagation(); armTapGuard(1800); mountRuntime(""); });
    on($(root, '[data-role="lazy-open"]'), "keydown", function (ev) { if (ev.key === "Enter" || ev.key === " ") { ev.preventDefault(); mountRuntime(""); } });
  } catch (e) {
    try { console.error("[IndexTTS TAVO loader]", e && e.stack ? e.stack : e); } catch (_) {}
  }
})();
