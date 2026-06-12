// IndexTTS Tavo runtime part: 10_tracks_icons.js // Role: track persistence, icons, base API helpers // This fragment is concatenated by static/tavo.runtime.js; it is not a standalone script.
  var TRACKS_KEY_PREFIX = "indextts_tracks_";
  async function loadTracksForMessage(messageId) {
    if (!messageId) return [];
    var key = TRACKS_KEY_PREFIX + messageId;
    try { if (window.tavo && typeof tavo.get === "function") { var cv = await tavo.get(key, "chat"); if (Array.isArray(cv)) return cv; } } catch (_) {}
    try { if (window.tavo && typeof tavo.get === "function") { var v = await tavo.get(key, "global"); if (Array.isArray(v)) return v; } } catch (_) {}
    try { var raw = localStorage.getItem(key); if (raw) { var arr = JSON.parse(raw); if (Array.isArray(arr)) return arr; } } catch (_) {}
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
        if (Array.isArray(cv)) return cv;
        var gv = tavo.get(key, "global");
        if (Array.isArray(gv)) return gv;
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
  function cardGenerationState(t) {
    if (!t) return "generating";
    var state = String(t.state || "").trim();
    var generationState = String(t.generationState || t.cardState || "").trim();
    var status = String(t.status || "").trim();
    var serverState = String(t.serverState || "").trim();
    var cacheState = String(t.cacheState || t.remoteCacheState || "").trim();
    var phase = String((t.metrics && t.metrics.phase) || "").trim();
    if (t.deleted || t.cancelled || state === "cancelled" || status === "cancelled" || serverState === "cancelled" || generationState === "cancelled") return "cancelled";
    if (state === "failed" || status === "failed" || serverState === "failed" || cacheState === "failed" || generationState === "failed") return "failed";
    if (t.cacheReady || t.fromHistory || state === "saved" || status === "ready" || status === "done" || serverState === "done" || cacheState === "ready" || generationState === "ready") return "ready";
    if (phase === "saving" || status === "saving" || serverState === "saving" || cacheState === "saving" || generationState === "saving") return "saving";
    return "generating";
  }
  function legacyStateForCardGenerationState(t) {
    var generationState = cardGenerationState(t);
    if (generationState === "ready") return "saved";
    if (generationState === "failed") return "failed";
    if (generationState === "cancelled") return "cancelled";
    return normalizePlaybackMode(t && t.playbackMode) === "live" ? "live" : "pending";
  }
  function persistedTrackLooksSaved(t) {
    return !!(t && t.cacheKey && cardGenerationState(t) === "ready");
  }
  function persistedTrackLooksVisible(t) {
    if (!t || !t.cacheKey || t.deleted) return false;
    return cardGenerationState(t) !== "cancelled";
  }
  function persistableHistoryTracks(tracks) {
    return (tracks || []).filter(persistedTrackLooksVisible);
  }
  function ensureTrackRecordPosition(track, index) {
    if (!track) return { trackIndex: Math.max(0, Number(index || 0) || 0), trackId: "" };
    var idx = Math.max(0, Number(index || 0) || 0);
    if (!isFinite(idx)) idx = 0;
    var existingIndex = Number(track.trackIndex);
    if (isFinite(existingIndex) && existingIndex >= 0) idx = Math.floor(existingIndex);
    else {
      try { track.trackIndex = idx; } catch (_) {}
    }
    var id = String(track.trackId || "").trim();
    if (!id) {
      id = String(track.cacheKey || "").trim();
      if (!id) id = "track-" + String(track.createdAt || Date.now()) + "-" + String(idx);
      try { track.trackId = id; } catch (_) {}
    }
    return { trackIndex: idx, trackId: id };
  }
  function trackRecordPositionValue(track, fallbackIndex) {
    var n = Number(track && track.trackIndex);
    if (isFinite(n) && n >= 0) return Math.floor(n);
    return Math.max(0, Number(fallbackIndex || 0) || 0);
  }
  function compareTrackRecords(a, b) {
    var ai = trackRecordPositionValue(a, 0);
    var bi = trackRecordPositionValue(b, 0);
    if (ai !== bi) return ai - bi;
    var ac = Number(a && a.createdAt) || 0;
    var bc = Number(b && b.createdAt) || 0;
    if (ac !== bc) return ac - bc;
    return String((a && (a.trackId || a.cacheKey)) || "").localeCompare(String((b && (b.trackId || b.cacheKey)) || ""));
  }
  function localHistoryCountForMessage(messageId) {
    return persistableHistoryTracks(localTracksForMessage(messageId)).length;
  }
  async function saveTracksForMessage(messageId, tracks, opts) {
    if (!messageId) return;
    opts = opts || {};
    var key = TRACKS_KEY_PREFIX + messageId;
    // 只挑能跨会话持久化的字段；blob URL 重启就失效，丢掉。
    // segments 也存下来,字幕重进页面后才有时间轴显示。
    var lite = persistableHistoryTracks(tracks).map(function (t) {
      var pos = ensureTrackRecordPosition(t, (tracks || []).indexOf(t));
      var generationState = cardGenerationState(t);
      var legacyState = legacyStateForCardGenerationState(t);
      var ready = generationState === "ready";
      var playbackMode = normalizePlaybackMode(t.playbackMode);
      return {
        cacheKey: t.cacheKey || "",
        trackIndex: pos.trackIndex,
        trackId: pos.trackId,
        voice: t.voice || "",
        mode: t.mode || "",
        parseMode: t.parseMode || t.mode || "",
        playbackMode: playbackMode,
        backgroundOnly: !!(playbackMode === "generate" || t.backgroundOnly),
        livePageExited: !!t.livePageExited,
        allowStreamPlay: !!t.allowStreamPlay,
        generationState: generationState,
        state: legacyState,
        playbackState: t.playbackState || "",
        status: ready ? "ready" : (t.status || (generationState === "failed" ? "failed" : (legacyState === "live" ? "running" : "pending"))),
        serverState: ready ? "done" : (t.serverState || (generationState === "failed" ? "failed" : (legacyState === "live" ? "running" : "pending"))),
        cacheState: ready ? "ready" : (t.cacheState || t.remoteCacheState || (generationState === "saving" ? "pending" : "pending")),
        remoteCacheState: ready ? "ready" : (t.remoteCacheState || t.cacheState || (generationState === "saving" ? "pending" : "pending")),
        cacheReady: !!(ready || t.cacheReady),
        cacheUrl: t.cacheUrl || "",
        streamUrl: ready ? "" : (t.streamUrl || ""),
        offlineState: t.offlineState || "",
        streamHealth: t.streamHealth || (t.streamInterrupted ? "interrupted" : (t.streamStalled ? "stalled" : "")),
        stalledCount: Number(t.stalledCount || 0) || 0,
        lastElementSec: 0,
        lastWebAudioSec: isFinite(Number(t.lastWebAudioSec)) ? Math.max(0, Number(t.lastWebAudioSec)) : 0,
        lastLiveProgressSec: isFinite(Number(t.lastLiveProgressSec)) ? Math.max(0, Number(t.lastLiveProgressSec)) : 0,
        liveResumeSec: isFinite(Number(t.liveResumeSec)) ? Math.max(0, Number(t.liveResumeSec)) : 0,
        createdAt: t.createdAt || Date.now(),
        offlineKey: t.offlineKey || offlineAudioKey(t.cacheKey),
        offlineReady: !!t.offlineReady,
        offlineWanted: !!t.offlineWanted,
        offlineSavedAt: t.offlineSavedAt || 0,
        offlineSize: t.offlineSize || 0,
        voicesMap: t.voicesMap || null,
        error: t.error || "",
        metrics: t.metrics ? {
          phase: t.metrics.phase,
          message: t.metrics.message,
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
    lite.sort(compareTrackRecords);
    var failed = null;
    try { if (window.tavo && typeof tavo.set === "function") await tavo.set(key, lite, "chat"); }
    catch (e) { failed = e; try { debugLog("⚠️ 保存历史到 tavo.set 失败: " + (e && e.message ? e.message : e), "#fc9"); } catch (_) {} }
    try { localStorage.setItem(key, JSON.stringify(lite)); }
    catch (e) { if (!failed) failed = e; }
    if (opts.strict && failed) throw failed;
  }
  function playIcon(state) { return state === "playing" ? '<svg viewBox="0 0 24 24"><path d="M7 5h4v14H7zm6 0h4v14h-4z"/></svg>' : '<svg viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg>'; }
  function loadingIcon() { return '<svg viewBox="0 0 24 24"><path d="M12 2a10 10 0 1 0 10 10h-3a7 7 0 1 1-7-7V2z"/></svg>'; }
  function gearIcon() { return '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="4" y1="7" x2="20" y2="7"/><line x1="4" y1="17" x2="20" y2="17"/><circle cx="9" cy="7" r="2.2"/><circle cx="15" cy="17" r="2.2"/></svg>'; }
  function playbackModeLetter(mode) { return normalizePlaybackMode(mode) === "generate" ? "DISK" : "LIVE"; }
  function formatTime(sec) { sec = Math.max(0, Number(sec || 0)); if (!isFinite(sec)) return "--:--"; return String(Math.floor(sec / 60)).padStart(2, "0") + ":" + String(Math.floor(sec % 60)).padStart(2, "0"); }
  function parseRoleVoices(text, voice) { var out = { default: voice }; String(text || "").split(/[\r\n,，;；]+/).forEach(function (line) { var m = line.trim().match(/^(.+?)[=:：]\s*(.+)$/); if (m) out[m[1].trim()] = m[2].trim(); }); return out; }
  async function listVoices(base) { try { var r = await fetch(cleanBase(base) + "/voices", { cache: "no-store" }); if (!r.ok) return []; var d = await r.json(); return Array.isArray(d.voices) ? d.voices : []; } catch (_) { return []; } }
  function profileQualityModeIds(cfg) {
    return ((cfg && Array.isArray(cfg.profileQualityModes)) ? cfg.profileQualityModes : [])
      .map(function (item) { return String((item && item.id) || "").trim(); })
      .filter(Boolean);
  }
  function normalizeGenerationQualityMode(mode, cfg) {
    mode = String(mode || "").trim();
    if (mode === "custom") return "custom";
    if (cfg && cfg.profileConfigError) throw makeProfileConfigError(cfg.profileConfigError);
    var ids = profileQualityModeIds(cfg);
    if (!ids.length) throw makeProfileConfigError("active profile 没有可用档位定义");
    if (ids.indexOf(mode) < 0) throw makeProfileConfigError("Tavo 当前档位不在 active profile 中: " + (mode || "(空)"));
    return mode;
  }
  function playbackQualityKey(playbackMode) {
    return normalizePlaybackMode(playbackMode) === "generate" ? "generate" : "live";
  }
  function effectiveQualityMode(cfg, playbackMode) {
    cfg = cfg || {};
    return normalizeGenerationQualityMode(cfg.qualityMode || cfg.profileDefaultQualityMode || "", cfg);
  }
  function profileQualityPreset(cfg, playbackMode, mode) {
    cfg = cfg || {};
    var key = playbackQualityKey(playbackMode || cfg.playbackMode);
    var presets = cfg.profileQualityPresets && typeof cfg.profileQualityPresets === "object" ? cfg.profileQualityPresets[key] : null;
    var preset = presets && typeof presets === "object" ? presets[normalizeGenerationQualityMode(mode, cfg)] : null;
    return preset && typeof preset === "object" ? preset : null;
  }
  function profileQualityModeLabel(cfg, mode) {
    mode = String(mode || "").trim();
    if (mode === "custom") return String((cfg && cfg.profileCustomQualityLabel) || "自定义").trim() || "自定义";
    var modes = (cfg && Array.isArray(cfg.profileQualityModes)) ? cfg.profileQualityModes : [];
    for (var i = 0; i < modes.length; i += 1) {
      if (String((modes[i] && modes[i].id) || "").trim() === mode) {
        return String(modes[i].label || mode).trim() || mode;
      }
    }
    return mode || "(未选择)";
  }
  function customQualityOverrides(cfg) {
    cfg = cfg || {};
    var segmentTokens = Math.round(clampNumber(cfg.segmentTokens, 60, 8, 120));
    return {
      diffusion_steps: Math.round(clampNumber(cfg.diffusionSteps, 14, 2, 24)),
      prompt_audio_seconds: clampNumber(cfg.promptAudioSeconds, 10, 2, 16),
      segment_tokens: segmentTokens,
      first_tokens: Math.round(clampNumber(cfg.firstTokens, 18, 4, Math.max(4, segmentTokens))),
      s2mel_cfg_rate: clampNumber(cfg.s2melCfgRate, 0.7, 0, 1.2),
      interval_ms: Math.round(clampNumber(cfg.intervalMs, 50, 0, 2000)),
      top_p: clampNumber(cfg.topP, 0.8, 0.1, 1),
      top_k: Math.round(clampNumber(cfg.topK, 30, 1, 100)),
      temperature: clampNumber(cfg.temperature, 0.7, 0.1, 1.5),
      repetition_penalty: clampNumber(cfg.repetitionPenalty, 1.2, 1, 2)
    };
  }
  function generationQualityOverrides(mode, cfg, playbackMode) {
    mode = normalizeGenerationQualityMode(mode, cfg);
    if (mode === "custom") return customQualityOverrides(cfg);
    var profilePreset = profileQualityPreset(cfg, playbackMode, mode);
    if (!profilePreset) throw makeProfileConfigError("active profile 缺少 " + playbackQualityKey(playbackMode || (cfg && cfg.playbackMode)) + "." + mode + " 参数");
    return {
      diffusion_steps: profilePreset.diffusion_steps,
      prompt_audio_seconds: profilePreset.prompt_audio_seconds,
      segment_tokens: profilePreset.segment_tokens,
      first_tokens: profilePreset.first_tokens,
      s2mel_cfg_rate: profilePreset.s2mel_cfg_rate,
      interval_ms: profilePreset.interval_ms,
      top_p: profilePreset.top_p,
      top_k: profilePreset.top_k,
      temperature: profilePreset.temperature,
      repetition_penalty: profilePreset.repetition_penalty
    };
  }
  function applyGenerationParamsToSearchParams(p, cfg, playbackMode) {
    var mode = effectiveQualityMode(cfg, playbackMode);
    var q = generationQualityOverrides(mode, cfg, playbackMode);
    p.set("performance_mode", mode);
    p.set("diffusion_steps", String(q.diffusion_steps));
    p.set("prompt_audio_seconds", String(q.prompt_audio_seconds));
    p.set("segment_tokens", String(q.segment_tokens));
    p.set("first_tokens", String(q.first_tokens));
    p.set("s2mel_cfg_rate", String(q.s2mel_cfg_rate));
    p.set("interval_ms", String(q.interval_ms));
    p.set("top_p", String(q.top_p));
    p.set("top_k", String(q.top_k));
    p.set("temperature", String(q.temperature));
    p.set("repetition_penalty", String(q.repetition_penalty));
  }
