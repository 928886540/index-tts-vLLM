// IndexTTS Tavo runtime part: 10_tracks_icons.js // Role: track persistence, icons, base API helpers // This fragment is concatenated by static/tavo.runtime.js; it is not a standalone script.
  var TRACKS_KEY_PREFIX = "indextts_tracks_";
  async function loadTracksForMessage(messageId) {
    if (!messageId) return [];
    var key = TRACKS_KEY_PREFIX + messageId;
    try { var raw = localStorage.getItem(key); if (raw) { var arr = JSON.parse(raw); if (Array.isArray(arr)) return arr; } } catch (_) {}
    try { if (window.tavo && typeof tavo.get === "function") { var cv = await tavo.get(key, "chat"); if (Array.isArray(cv)) return cv; } } catch (_) {}
    try { if (window.tavo && typeof tavo.get === "function") { var v = await tavo.get(key, "global"); if (Array.isArray(v)) return v; } } catch (_) {}
    return [];
  }
  function localTracksForMessage(messageId) {
    if (!messageId) return [];
    var key = TRACKS_KEY_PREFIX + messageId;
    // AR webview 重建/重进页面后 localStorage 会被清空，tavo 变量才是持久源。
    // 变量操作是同步的，优先同步读 tavo.get；读不到（或本版 tavo.get 返回 Promise）
    // 再回退 localStorage。否则懒加载时首页历史条数永远显示 0。
    try {
      if (window.tavo && typeof tavo.get === "function") {
        var cv = tavo.get(key, "chat");
        if (Array.isArray(cv) && cv.length) return cv;
        var gv = tavo.get(key, "global");
        if (Array.isArray(gv) && gv.length) return gv;
      }
    } catch (_) {}
    try {
      var raw = localStorage.getItem(key);
      if (!raw) return [];
      var arr = JSON.parse(raw);
      return Array.isArray(arr) ? arr : [];
    } catch (_) {}
    return [];
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
  function localHistoryCountForMessage(messageId) {
    return persistableHistoryTracks(localTracksForMessage(messageId)).length;
  }
  async function saveTracksForMessage(messageId, tracks) {
    if (!messageId) return;
    var key = TRACKS_KEY_PREFIX + messageId;
    // 只挑能跨会话持久化的字段；blob URL 重启就失效，丢掉。
    // segments 也存下来,字幕重进页面后才有时间轴显示。
    var lite = persistableHistoryTracks(tracks).map(function (t) {
      return {
        cacheKey: t.cacheKey || "",
        voice: t.voice || "",
        mode: t.mode || "",
        state: "saved",
        playbackState: t.playbackState || "",
        serverState: "done",
        cacheState: "ready",
        remoteCacheState: "ready",
        offlineState: t.offlineState || "",
        streamHealth: t.streamHealth || (t.streamInterrupted ? "interrupted" : (t.streamStalled ? "stalled" : "")),
        stalledCount: Number(t.stalledCount || 0) || 0,
        createdAt: t.createdAt || Date.now(),
        offlineKey: t.offlineKey || offlineAudioKey(t.cacheKey),
        offlineReady: !!t.offlineReady,
        offlineWanted: !!t.offlineWanted,
        offlineSavedAt: t.offlineSavedAt || 0,
        offlineSize: t.offlineSize || 0,
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
        sampleRate: t.sampleRate || t.sample_rate || 0,
        duration_s: t.duration_s || (t.metrics && t.metrics.audio_duration_s) || 0,
        segments: (t.segments || []).map(function (s) {
          return { role: s.role || "", voice: s.voice || "", text: s.text || "", style: s.style || "neutral", style_alpha: s.style_alpha, start_s: s.start_s, start_offset_bytes: s.start_offset_bytes, duration_s: s.duration_s };
        }),
      };
    }).filter(function (t) { return !!t.cacheKey; });
    try { if (window.tavo && typeof tavo.set === "function") await tavo.set(key, lite, "chat"); } catch (_) {}
    try { localStorage.setItem(key, JSON.stringify(lite)); } catch (_) {}
  }
  function playIcon(state) { return state === "playing" ? '<svg viewBox="0 0 24 24"><path d="M7 5h4v14H7zm6 0h4v14h-4z"/></svg>' : '<svg viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg>'; }
  function loadingIcon() { return '<svg viewBox="0 0 24 24"><path d="M12 2a10 10 0 1 0 10 10h-3a7 7 0 1 1-7-7V2z"/></svg>'; }
  function gearIcon() { return '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="4" y1="7" x2="20" y2="7"/><line x1="4" y1="17" x2="20" y2="17"/><circle cx="9" cy="7" r="2.2"/><circle cx="15" cy="17" r="2.2"/></svg>'; }
  function playbackModeLetter(mode) { return normalizePlaybackMode(mode) === "generate" ? "D" : "L"; }
  function formatTime(sec) { sec = Math.max(0, Number(sec || 0)); if (!isFinite(sec)) return "--:--"; return String(Math.floor(sec / 60)).padStart(2, "0") + ":" + String(Math.floor(sec % 60)).padStart(2, "0"); }
  function parseRoleVoices(text, voice) { var out = { default: voice }; String(text || "").split(/[\r\n,，;；]+/).forEach(function (line) { var m = line.trim().match(/^(.+?)[=:：]\s*(.+)$/); if (m) out[m[1].trim()] = m[2].trim(); }); return out; }
  async function listVoices(base) { try { var r = await fetch(cleanBase(base) + "/voices", { cache: "no-store" }); if (!r.ok) return []; var d = await r.json(); return Array.isArray(d.voices) ? d.voices : []; } catch (_) { return []; } }
  function generationQualityOverrides(mode) {
    mode = String(mode || "balanced").trim();
    if (mode === "fast") return { diffusion_steps: 8, prompt_audio_seconds: 6, segment_tokens: 40, first_tokens: 10 };
    if (mode === "balanced") return { diffusion_steps: 14, prompt_audio_seconds: 10, segment_tokens: 60, first_tokens: 18 };
    return { diffusion_steps: 16, prompt_audio_seconds: 12, segment_tokens: 72, first_tokens: 24 };
  }
  function applyGenerationParamsToSearchParams(p, cfg) {
    var q = generationQualityOverrides(cfg && cfg.qualityMode);
    p.set("diffusion_steps", String(q.diffusion_steps));
    p.set("prompt_audio_seconds", String(q.prompt_audio_seconds));
    p.set("segment_tokens", String(q.segment_tokens));
    p.set("first_tokens", String(q.first_tokens));
  }
