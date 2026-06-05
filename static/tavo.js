;(function () {
  "use strict";

  var loaderScript = (typeof document !== "undefined" && document.currentScript) ? document.currentScript : null;
  var LOADER_VERSION = "20260605-normal-generate-v1";
  var STYLE_ID = "indextts-tavo-loader-v2";
  var TRACKS_KEY_PREFIX = "indextts_tracks_";
  var TAP_GUARD_KEY = "__indextts_tavo_tap_guard_until";
  var PICKER_TRIGGER_SELECTOR = '[data-role="default-voice-btn"],.idx-role-row .idx-voice-btn,.idx-picker-item,.idx-picker-apply';

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
    var cacheState = String(t.cacheState || t.remoteCacheState || "").trim();
    if (state === "failed" || state === "cancelled") return false;
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
      var existingFull = $all(msgEl, ".idx-tts").filter(function (node) { return !!$(node, ".idx-card"); })[0];
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
    function mountRuntime(clickSelector) {
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
        var btn = $(scope, sel) || $(document, sel);
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
