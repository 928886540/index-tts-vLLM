// IndexTTS Tavo runtime part: 20_generation_params.js // Role: style presets, LLM reuse helpers, single/dialogue job helpers, audio priming // This fragment is concatenated by static/tavo.runtime.js; it is not a standalone script.
  var STYLE_PRESETS = [
    { id: "neutral", label: "普通/平静", alpha: 0.20 },
    { id: "breath_soft", label: "轻微气声", alpha: 0.34 },
    { id: "breath_heavy", label: "明显喘息", alpha: 0.46 },
    { id: "intimate_breath", label: "亲密气声", alpha: 0.44 },
    { id: "moan_soft", label: "低声短吟", alpha: 0.48 },
    { id: "low_murmur", label: "压低呢喃", alpha: 0.40 },
    { id: "whisper_soft", label: "温柔耳语", alpha: 0.36 },
    { id: "shy_whisper", label: "害羞低语", alpha: 0.36 },
    { id: "tense_breath", label: "紧张呼吸", alpha: 0.38 },
    { id: "sob_soft", label: "委屈哽咽", alpha: 0.42 },
    { id: "cry_soft", label: "哭腔", alpha: 0.44 },
    { id: "tease_soft", label: "轻声撒娇", alpha: 0.38 },
    { id: "laugh_soft", label: "慵懒轻笑", alpha: 0.34 },
    { id: "gasp_surprise", label: "惊讶轻叹", alpha: 0.38 },
    { id: "scream_peak", label: "尖叫/高潮峰值", alpha: 0.50 },
    { id: "stage_warmup", label: "亲密初段/轻气声", alpha: 0.36 },
    { id: "stage_rising", label: "升温段/呼吸变重", alpha: 0.44 },
    { id: "stage_peak", label: "高潮峰值/尖叫", alpha: 0.50 },
    { id: "stage_afterglow", label: "余韵段/低声放松", alpha: 0.38 }
  ];
  var PERSON_STYLE_VARIANTS = [
    { name: "轻喘", label: "轻喘", alpha: 0.34 },
    { name: "喘息", label: "明显喘息", alpha: 0.46 },
    { name: "耳语", label: "耳语", alpha: 0.36 },
    { name: "低语", label: "低语", alpha: 0.36 },
    { name: "低吟", label: "低声短吟", alpha: 0.48 },
    { name: "惊喘", label: "惊喘", alpha: 0.38 },
    { name: "哭腔", label: "哭腔", alpha: 0.44 },
    { name: "哽咽", label: "哽咽", alpha: 0.42 },
    { name: "挑逗", label: "挑逗", alpha: 0.38 },
    { name: "轻笑", label: "轻笑", alpha: 0.34 },
    { name: "尖叫", label: "尖叫/峰值", alpha: 0.50 },
    { name: "余韵", label: "余韵低声", alpha: 0.38 }
  ];
  ["步非烟", "AD学姐", "JOK"].forEach(function (speaker) {
    PERSON_STYLE_VARIANTS.forEach(function (item) {
      STYLE_PRESETS.push({
        id: item.name + "-" + speaker,
        label: item.label + "/" + speaker,
        alpha: item.alpha
      });
    });
  });
  function styleIdsText() { return STYLE_PRESETS.map(function (s) { return s.id + "=" + s.label + "(建议" + s.alpha + ")"; }).join(" / "); }
  function normalizeStyleId(style) {
    style = String(style || "neutral").trim();
    var ok = STYLE_PRESETS.some(function (s) { return s.id === style; });
    return ok ? style : "neutral";
  }
  function defaultStyleAlpha(style, cfg) {
    style = normalizeStyleId(style);
    var hit = STYLE_PRESETS.find(function (s) { return s.id === style; });
    if (hit) return Math.min(hit.alpha, style === "neutral" ? 0.20 : 0.66);
    return Math.min(Number(cfg.emoAlpha || 0.38), 0.66);
  }
  function stabilizeEmoVec(vec, role, style) {
    if (role === "旁白") return [0,0,0,0,0,0,0,1];
    var arr = Array.isArray(vec) ? vec.slice(0, 8).map(function (v) {
      v = Number(v);
      return isFinite(v) ? Math.max(0, Math.min(1, v)) : 0;
    }) : [];
    while (arr.length < 8) arr.push(0);
    var activeCap = style === "neutral" ? 0.34 : 0.42;
    var activeSum = 0;
    for (var i = 0; i < 7; i++) {
      arr[i] = Math.min(arr[i], activeCap);
      activeSum += arr[i];
    }
    var maxActiveSum = style === "neutral" ? 0.55 : 0.76;
    if (activeSum > maxActiveSum && activeSum > 0) {
      var scale = maxActiveSum / activeSum;
      for (var j = 0; j < 7; j++) arr[j] = arr[j] * scale;
    }
    arr[7] = Math.max(style === "neutral" ? 0.60 : 0.38, Math.min(1, arr[7] || 0));
    return arr;
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
  function parseReuseHash(text) {
    text = String(text || "");
    var h = 2166136261;
    for (var i = 0; i < text.length; i++) {
      h ^= text.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return (h >>> 0).toString(16);
  }
  function cloneSegments(segments) {
    try { return JSON.parse(JSON.stringify(segments || [])); }
    catch (_) { return (segments || []).map(function (s) { return Object.assign({}, s); }); }
  }
  function parseReuseFingerprint(text, cfg, context) {
    var roles = (cfg && Array.isArray(cfg.roleVoiceList) ? cfg.roleVoiceList : [])
      .map(function (r) { return String((r && r.role) || "").trim(); })
      .filter(Boolean);
    return JSON.stringify({
      v: 1,
      text: String(text || ""),
      userName: String((context && context.userName) || ""),
      characterName: String((context && context.characterName) || cfg.currentCharacterName || ""),
      roles: roles,
      llmEndpoint: String((cfg && cfg.llmEndpoint) || ""),
      llmModel: String((cfg && cfg.llmModel) || ""),
      parseEndpoint: String((cfg && cfg.parseEndpoint) || "")
    });
  }
  function parseReuseStorageKeys(fingerprint, context) {
    var keys = [];
    function add(key) { if (key && keys.indexOf(key) < 0) keys.push(key); }
    add("indextts_llm_parse_v1_" + parseReuseHash(fingerprint));
    if (context && context.messageId) add("indextts_llm_parse_msg_" + parseReuseHash(String(context.messageId)) + "_" + parseReuseHash(fingerprint));
    return keys;
  }
  function parseReuseRecordMatches(record, fingerprint) {
    return !!(record && record.fingerprint === fingerprint && Array.isArray(record.segments) && record.segments.length);
  }
  async function loadReusableSegments(text, cfg, context, setStatus) {
    if (!cfg || cfg.reuseLlmParse === false) return null;
    var fingerprint = parseReuseFingerprint(text, cfg, context);
    var keys = parseReuseStorageKeys(fingerprint, context);
    for (var i = 0; i < keys.length; i++) {
      var key = keys[i];
      var record = null;
      try { record = JSON.parse(localStorage.getItem(key) || "null"); } catch (_) {}
      if (!record) {
        try { if (window.tavo && typeof tavo.get === "function") record = await tavo.get(key, "chat"); } catch (_) {}
      }
      if (parseReuseRecordMatches(record, fingerprint)) {
        var segments = cloneSegments(record.segments);
        debugLog("♻️ 复用 LLM 拆段 cacheKey=" + key + " segments=" + segments.length, "#9f9");
        if (typeof setStatus === "function") setStatus("复用 LLM 拆段 " + segments.length + " 段");
        return segments;
      }
    }
    return null;
  }
  async function saveReusableSegments(text, cfg, context, segments) {
    if (!cfg || cfg.reuseLlmParse === false || !Array.isArray(segments) || !segments.length) return;
    var fingerprint = parseReuseFingerprint(text, cfg, context);
    var keys = parseReuseStorageKeys(fingerprint, context);
    var record = { fingerprint: fingerprint, segments: cloneSegments(segments), createdAt: Date.now() };
    for (var i = 0; i < keys.length; i++) {
      try { localStorage.setItem(keys[i], JSON.stringify(record)); } catch (_) {}
      try { if (window.tavo && typeof tavo.set === "function") await tavo.set(keys[i], record, "chat"); } catch (_) {}
    }
    debugLog("💾 保存 LLM 拆段复用 cacheKey=" + keys[0] + " segments=" + segments.length, "#9ff");
  }
  async function parseWithOptionalReuse(text, cfg, setStatus, context) {
    var cached = await loadReusableSegments(text, cfg, context, setStatus);
    if (cached && cached.length) return cached;
    var segments = await parseWithLlm(text, cfg, setStatus, context);
    await saveReusableSegments(text, cfg, context, segments);
    return segments;
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
    applyGenerationParamsToSearchParams(p, cfg);
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
    return Object.assign({
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
    }, generationQualityOverrides(cfg.qualityMode, cfg));
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
    return {
      streamUrl: new URL(data.url, cleanBase(base) + "/").href,
      cacheUrl: data.cache_url ? new URL(data.cache_url, cleanBase(base) + "/").href : "",
      cacheKey: data.cache_key || "",
      cached: !!data.cached,
      live: false
    };
  }

  async function createDialogueStreamJob(base, body, opts) {
    opts = opts || {};
    var res = await fetch(cleanBase(base) + "/tts_dialogue_stream_job", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: opts.signal
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
  var PRIMED_CTX_OWNER = "";
  var PRIMED_UNLOCK_SOURCE = null;
  var PRIMED_KEEPALIVE_SOURCE = null;
  var PRIMED_KEEPALIVE_CTX = null;
  function normalizeAudioOwner(ownerMessageId) {
    return String(ownerMessageId || "").trim();
  }
  function globalPreprimedAudioOwner() {
    try { return normalizeAudioOwner(window.__indextts_tavo_preprimed_audio_owner); }
    catch (_) { return ""; }
  }
  function ownerMatchesAudioContext(ownerMessageId, existingOwner) {
    ownerMessageId = normalizeAudioOwner(ownerMessageId);
    existingOwner = normalizeAudioOwner(existingOwner);
    return !ownerMessageId || !existingOwner || existingOwner === ownerMessageId;
  }
  function canAdoptAudioOwner(ownerMessageId, existingOwner, previousOwner) {
    ownerMessageId = normalizeAudioOwner(ownerMessageId);
    existingOwner = normalizeAudioOwner(existingOwner);
    previousOwner = normalizeAudioOwner(previousOwner);
    if (!ownerMessageId) return false;
    if (!existingOwner || existingOwner === ownerMessageId) return true;
    if (previousOwner && existingOwner === previousOwner) return true;
    return false;
  }
  function adoptPreprimedAudioOwner(ownerMessageId, previousOwner) {
    ownerMessageId = normalizeAudioOwner(ownerMessageId);
    previousOwner = normalizeAudioOwner(previousOwner);
    if (!ownerMessageId) return false;
    try {
      var ctx = PRIMED_CTX || window.__indextts_tavo_preprimed_audio_context;
      if (!ctx) return false;
      var globalOwner = globalPreprimedAudioOwner();
      if (!canAdoptAudioOwner(ownerMessageId, globalOwner, previousOwner)) return false;
      registerPreprimedAudioContext(ctx, ownerMessageId);
      debugLog("🔊 WebAudio ctx 认领到当前消息 owner=" + ownerMessageId + (previousOwner ? " from=" + previousOwner : ""), "#9ff");
      return true;
    } catch (_) {
      return false;
    }
  }
  function registerPreprimedAudioContext(ctx, ownerMessageId) {
    PRIMED_CTX = ctx || null;
    PRIMED_CTX_OWNER = normalizeAudioOwner(ownerMessageId);
    try {
      window.__indextts_tavo_preprimed_audio_context = PRIMED_CTX;
      window.__indextts_tavo_preprimed_audio_owner = PRIMED_CTX_OWNER;
      window.__indextts_tavo_preprimed_audio_owner_at = Date.now();
    } catch (_) {}
  }
  function nativeUnlockWavUrl() {
    try {
      if (window.__indextts_tavo_native_unlock_url) return window.__indextts_tavo_native_unlock_url;
      var rate = 8000;
      var frames = Math.max(1, Math.floor(rate * 0.08));
      var bytes = new Uint8Array(44 + frames * 2);
      function putText(off, text) {
        for (var i = 0; i < text.length; i++) bytes[off + i] = text.charCodeAt(i);
      }
      function put16(off, value) {
        bytes[off] = value & 255; bytes[off + 1] = (value >> 8) & 255;
      }
      function put32(off, value) {
        bytes[off] = value & 255; bytes[off + 1] = (value >> 8) & 255; bytes[off + 2] = (value >> 16) & 255; bytes[off + 3] = (value >> 24) & 255;
      }
      putText(0, "RIFF"); put32(4, 36 + frames * 2); putText(8, "WAVE");
      putText(12, "fmt "); put32(16, 16); put16(20, 1); put16(22, 1);
      put32(24, rate); put32(28, rate * 2); put16(32, 2); put16(34, 16);
      putText(36, "data"); put32(40, frames * 2);
      for (var j = 0; j < frames; j++) {
        var edge = Math.min(1, j / Math.max(1, Math.floor(rate * 0.012)), (frames - j) / Math.max(1, Math.floor(rate * 0.012)));
        var sample = Math.round(Math.sin(2 * Math.PI * 440 * j / rate) * 56 * Math.max(0, edge));
        put16(44 + j * 2, sample < 0 ? sample + 65536 : sample);
      }
      var blob = new Blob([bytes], { type: "audio/wav" });
      window.__indextts_tavo_native_unlock_url = URL.createObjectURL(blob);
      return window.__indextts_tavo_native_unlock_url;
    } catch (_) {
      return "";
    }
  }
  function primeNativeAudioElementForGesture(label) {
    try {
      var el = window.__indextts_tavo_native_unlock_audio;
      if (!el) {
        el = new Audio();
        el.preload = "auto";
        el.volume = 1;
        try { el.setAttribute("playsinline", ""); el.setAttribute("webkit-playsinline", ""); } catch (_) {}
        window.__indextts_tavo_native_unlock_audio = el;
      }
      var url = nativeUnlockWavUrl();
      if (url && el.src !== url) {
        el.src = url;
        try { el.load(); } catch (_) {}
      }
      var p = el.play();
      if (p && typeof p.then === "function") {
        p.then(function () {
          setTimeout(function () { try { el.pause(); el.currentTime = 0; } catch (_) {} }, 90);
        }).catch(function (e) {
          debugLog("⚠️ native audio unlock 被拒绝 " + (label || "") + ": " + (e && e.message ? e.message : e), "#fc9");
        });
      }
      return true;
    } catch (e) {
      debugLog("⚠️ native audio unlock 失败 " + (label || "") + ": " + (e && e.message ? e.message : e), "#fc9");
      return false;
    }
  }
  function startRuntimeAudioKeepalive(ctx) {
    if (!ctx) return;
    if (PRIMED_KEEPALIVE_SOURCE && PRIMED_KEEPALIVE_CTX === ctx) return;
    if (PRIMED_KEEPALIVE_SOURCE && PRIMED_KEEPALIVE_CTX !== ctx) {
      try { PRIMED_KEEPALIVE_SOURCE.stop(0); } catch (_) {}
      PRIMED_KEEPALIVE_SOURCE = null;
      PRIMED_KEEPALIVE_CTX = null;
    }
    try {
      var globalSrc = window.__indextts_tavo_preprimed_keepalive_source;
      var globalCtx = window.__indextts_tavo_preprimed_keepalive_ctx;
      if (globalSrc && globalCtx === ctx) {
        PRIMED_KEEPALIVE_SOURCE = globalSrc;
        PRIMED_KEEPALIVE_CTX = ctx;
        return;
      }
      if (globalSrc && globalCtx && globalCtx !== ctx) {
        try { globalSrc.stop(0); } catch (_) {}
        window.__indextts_tavo_preprimed_keepalive_source = null;
        window.__indextts_tavo_preprimed_keepalive_ctx = null;
      }
    } catch (_) {}
    try {
      var rate = ctx.sampleRate || 44100;
      var frames = Math.max(1, Math.floor(rate * 0.5));
      var b = ctx.createBuffer(1, frames, rate);
      var ch = b.getChannelData(0);
      for (var i = 0; i < ch.length; i++) {
        ch[i] = Math.sin(2 * Math.PI * 80 * i / rate) * 0.0006;
      }
      var gain = ctx.createGain ? ctx.createGain() : null;
      var src = ctx.createBufferSource();
      src.buffer = b;
      src.loop = true;
      if (gain) {
        gain.gain.value = 0.35;
        src.connect(gain);
        gain.connect(ctx.destination);
      } else {
        src.connect(ctx.destination);
      }
      src.start(0);
      PRIMED_KEEPALIVE_SOURCE = src;
      PRIMED_KEEPALIVE_CTX = ctx;
      try { window.__indextts_tavo_preprimed_keepalive_source = src; } catch (_) {}
      try { window.__indextts_tavo_preprimed_keepalive_ctx = ctx; } catch (_) {}
      debugLog("🔊 WebAudio keepalive 已接入同一个 AudioContext", "#9ff");
    } catch (e) {
      debugLog("⚠️ WebAudio keepalive 启动失败: " + (e && e.message ? e.message : e), "#fc9");
    }
  }
  function wakeRuntimeAudioOutput(ctx, destination, label) {
    if (!ctx) return false;
    try {
      var rate = ctx.sampleRate || 44100;
      var frames = Math.max(1, Math.floor(rate * 0.08));
      var b = ctx.createBuffer(1, frames, rate);
      var ch = b.getChannelData(0);
      for (var i = 0; i < ch.length; i++) {
        var edge = Math.min(1, i / Math.max(1, Math.floor(rate * 0.012)), (ch.length - i) / Math.max(1, Math.floor(rate * 0.012)));
        ch[i] = Math.sin(2 * Math.PI * 220 * i / rate) * 0.0016 * Math.max(0, edge);
      }
      var gain = ctx.createGain ? ctx.createGain() : null;
      var src = ctx.createBufferSource();
      src.buffer = b;
      if (gain) {
        gain.gain.value = 1;
        src.connect(gain);
        gain.connect(destination || ctx.destination);
      } else {
        src.connect(destination || ctx.destination);
      }
      src.start(0);
      debugLog("🔊 WebAudio 输出通道唤醒 " + (label || ""), "#9ff");
      return true;
    } catch (e) {
      debugLog("⚠️ WebAudio 输出通道唤醒失败: " + (e && e.message ? e.message : e), "#fc9");
      return false;
    }
  }
  function takePreprimedAudioContext(ownerMessageId) {
    ownerMessageId = normalizeAudioOwner(ownerMessageId);
    if (PRIMED_CTX && ownerMatchesAudioContext(ownerMessageId, PRIMED_CTX_OWNER)) {
      if (ownerMessageId && PRIMED_CTX_OWNER !== ownerMessageId) registerPreprimedAudioContext(PRIMED_CTX, ownerMessageId);
      return PRIMED_CTX;
    }
    if (PRIMED_CTX && ownerMessageId && PRIMED_CTX_OWNER && PRIMED_CTX_OWNER !== ownerMessageId) {
      if (canAdoptAudioOwner(ownerMessageId, PRIMED_CTX_OWNER, "")) {
        registerPreprimedAudioContext(PRIMED_CTX, ownerMessageId);
        try { if (PRIMED_CTX.state === "suspended") PRIMED_CTX.resume(); } catch (_) {}
        startRuntimeAudioKeepalive(PRIMED_CTX);
        return PRIMED_CTX;
      }
      debugLog("⚠️ 跳过旧消息 WebAudio ctx owner=" + PRIMED_CTX_OWNER + " current=" + ownerMessageId, "#fc9");
    }
    try {
      var existing = window.__indextts_tavo_preprimed_audio_context;
      var owner = globalPreprimedAudioOwner();
      if (existing && ownerMatchesAudioContext(ownerMessageId, owner)) {
        PRIMED_CTX = existing;
        PRIMED_CTX_OWNER = owner || ownerMessageId;
        if (ownerMessageId && owner !== ownerMessageId) registerPreprimedAudioContext(PRIMED_CTX, ownerMessageId);
        try { if (PRIMED_CTX.state === "suspended") PRIMED_CTX.resume(); } catch (_) {}
        startRuntimeAudioKeepalive(PRIMED_CTX);
        return PRIMED_CTX;
      } else if (existing && ownerMessageId && owner && owner !== ownerMessageId) {
        if (canAdoptAudioOwner(ownerMessageId, owner, "")) {
          registerPreprimedAudioContext(existing, ownerMessageId);
          try { if (PRIMED_CTX.state === "suspended") PRIMED_CTX.resume(); } catch (_) {}
          startRuntimeAudioKeepalive(PRIMED_CTX);
          return PRIMED_CTX;
        }
        debugLog("⚠️ 全局 WebAudio ctx 属于其他消息 owner=" + owner + " current=" + ownerMessageId, "#fc9");
      }
    } catch (_) {}
    return null;
  }
  function resetPreprimedAudioContext(reason) {
    try {
      if (PRIMED_KEEPALIVE_SOURCE) PRIMED_KEEPALIVE_SOURCE.stop(0);
    } catch (_) {}
    try {
      var globalSrc = window.__indextts_tavo_preprimed_keepalive_source;
      if (globalSrc) globalSrc.stop(0);
    } catch (_) {}
    try {
      if (PRIMED_CTX && PRIMED_CTX.state !== "closed") PRIMED_CTX.close();
    } catch (_) {}
    try {
      var globalCtx = window.__indextts_tavo_preprimed_audio_context;
      if (globalCtx && globalCtx !== PRIMED_CTX && globalCtx.state !== "closed") globalCtx.close();
    } catch (_) {}
    PRIMED_KEEPALIVE_SOURCE = null;
    PRIMED_KEEPALIVE_CTX = null;
    PRIMED_CTX = null;
    PRIMED_CTX_OWNER = "";
    try {
      window.__indextts_tavo_preprimed_keepalive_source = null;
      window.__indextts_tavo_preprimed_keepalive_ctx = null;
      window.__indextts_tavo_preprimed_audio_context = null;
      window.__indextts_tavo_preprimed_audio_owner = "";
    } catch (_) {}
    debugLog("🔄 WebAudio ctx 已重建准备 " + (reason || ""), "#ffd479");
  }
  function primeAudioContext(ownerMessageId, opts) {
    opts = opts || {};
    ownerMessageId = normalizeAudioOwner(ownerMessageId);
    primeNativeAudioElementForGesture(opts.reason || "audio-context");
    if (opts.forceNew) resetPreprimedAudioContext(opts.reason || "forceNew");
    var existing = takePreprimedAudioContext(ownerMessageId);
    if (existing) return existing;
    if (PRIMED_CTX && ownerMatchesAudioContext(ownerMessageId, PRIMED_CTX_OWNER)) {
      try { if (PRIMED_CTX.state === "suspended") PRIMED_CTX.resume(); } catch (_) {}
      startRuntimeAudioKeepalive(PRIMED_CTX);
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
        for (var i = 0; ch && i < ch.length; i++) {
          var edge = Math.min(1, i / Math.max(1, Math.floor(unlockRate * 0.006)), (ch.length - i) / Math.max(1, Math.floor(unlockRate * 0.006)));
          ch[i] = Math.sin(2 * Math.PI * 220 * i / unlockRate) * 0.0012 * Math.max(0, edge);
        }
        var s = ctx.createBufferSource();
        s.buffer = b; s.connect(ctx.destination); s.start(0);
        PRIMED_UNLOCK_SOURCE = s;
        s.onended = function () { if (PRIMED_UNLOCK_SOURCE === s) PRIMED_UNLOCK_SOURCE = null; };
      } catch (_) {}
      registerPreprimedAudioContext(ctx, ownerMessageId);
      startRuntimeAudioKeepalive(ctx);
      return ctx;
    } catch (_) { return null; }
  }

  // 真流式播放：用 Web Audio API 直接拉 chunked-WAV 的 ReadableStream，
  // 解析 WAV 头后把 PCM 块逐段塞进 AudioContext。完全不走 <audio> 元素，
  // 因此不受手机浏览器 "Content-Length 未知就报错" 的限制。
  // hooks: { onStateChange(state), onError(err), debug(text), playbackRate }
