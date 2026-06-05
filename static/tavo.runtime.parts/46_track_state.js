// IndexTTS Tavo runtime part: 46_track_state.js // Role: track state, offline cache, live playback helpers // This fragment is concatenated by static/tavo.runtime.js; it is not a standalone script.
    function ensureTrackStates(track) {
      if (!track) return null;
      var inferred = inferLegacyTrackState(track);
      var state = oneOf(track.state, ["pending", "live", "saved", "failed", "cancelled"], "");
      // 后端终态/落盘证据必须压过旧 UI state，避免 failed+live 混在同一张卡上。
      if (!state || inferred === "failed" || inferred === "cancelled" || inferred === "saved") state = inferred;
      track.state = state; // legacy coarse state, persisted for old cards.
      if (state === "failed" || state === "cancelled") {
        track.pendingBlob = false;
        track.streaming = false;
        track.allowStreamPlay = false;
        track.playSavedWhenReady = false;
        track.cachePollStarted = false;
        if (state === "cancelled") track.cancelled = true;
      } else if (state === "saved") {
        track.pendingBlob = false;
        track.streaming = false;
        track.allowStreamPlay = false;
      }
      track.serverState = oneOf(track.serverState, ["pending", "running", "done", "failed", "cancelled"],
        state === "saved" ? "done" : (state === "cancelled" ? "cancelled" : (state === "failed" ? "failed" : (state === "live" ? "running" : "pending"))));
      var cacheState = track.cacheState || track.remoteCacheState;
      track.cacheState = oneOf(cacheState, ["none", "pending", "ready", "failed", "missing"],
        state === "saved" ? "ready" : (state === "failed" ? "failed" : (state === "cancelled" ? "none" : ((track.cacheKey || track.cacheUrl) ? "pending" : "none"))));
      track.remoteCacheState = track.cacheState;
      track.offlineState = !cfg.offlineAudioEnabled ? "disabled" : oneOf(track.offlineState, ["missing", "saving", "ready", "failed"],
        (track.offlineReady || track.offlineUrl) ? "ready" : (track.offlineSaveInProgress ? "saving" : "missing"));
      track.streamHealth = oneOf(track.streamHealth, ["ok", "stalled", "interrupted"],
        track.streamInterrupted ? "interrupted" : (track.streamStalled ? "stalled" : "ok"));
      if (track.stalledCount == null) track.stalledCount = 0;
      return track;
    }
    function setTrackPlaybackState(track, state) {
      if (!track) return "";
      ensureTrackStates(track);
      track.playbackState = oneOf(state, ["idle", "loading", "streaming", "playing", "buffering", "paused", "ended", "error", "cancelled"], "idle");
      return track.playbackState;
    }
    function setTrackServerState(track, state) {
      if (!track) return "";
      ensureTrackStates(track);
      track.serverState = oneOf(state, ["pending", "running", "done", "failed", "cancelled"], "pending");
      return track.serverState;
    }
    function setTrackCacheState(track, state) {
      if (!track) return "";
      ensureTrackStates(track);
      track.cacheState = oneOf(state, ["none", "pending", "ready", "failed", "missing"], "none");
      track.remoteCacheState = track.cacheState;
      if (track.cacheState === "ready") track.cacheReady = true;
      return track.cacheState;
    }
    function setTrackOfflineState(track, state) {
      if (!track) return "";
      ensureTrackStates(track);
      track.offlineState = !cfg.offlineAudioEnabled ? "disabled" : oneOf(state, ["missing", "saving", "ready", "failed"], "missing");
      return track.offlineState;
    }
    function setTrackStreamHealth(track, state) {
      if (!track) return "";
      ensureTrackStates(track);
      track.streamHealth = oneOf(state, ["ok", "stalled", "interrupted"], "ok");
      if (track.streamHealth === "ok") {
        track.streamInterrupted = false;
        track.streamStalled = false;
      } else if (track.streamHealth === "interrupted") {
        track.streamInterrupted = true;
        track.streamStalled = true;
      } else {
        track.streamStalled = true;
      }
      return track.streamHealth;
    }
    function setTrackState(track, state) {
      if (!track) return "";
      state = oneOf(state, ["pending", "live", "saved", "failed", "cancelled"], "pending");
      track.state = state;
      if (state === "saved") {
        track.cancelled = false;
        track.deleted = false;
        track.status = "ready";
        track.pendingBlob = false;
        track.streaming = false;
        if (track.cacheUrl || track.fromHistory || track.url) track.cacheReady = true;
        setTrackServerState(track, "done");
        setTrackCacheState(track, "ready");
        if (!track.playbackState || track.playbackState === "loading" || track.playbackState === "streaming" || track.playbackState === "buffering") setTrackPlaybackState(track, "idle");
      } else if (state === "live") {
        track.status = "running";
        track.pendingBlob = true;
        track.streaming = true;
        setTrackServerState(track, "running");
        setTrackCacheState(track, (track.cacheKey || track.cacheUrl) ? "pending" : "none");
        if (!track.playbackState || track.playbackState === "idle") setTrackPlaybackState(track, "streaming");
      } else if (state === "failed") {
        track.status = "failed";
        track.pendingBlob = false;
        track.streaming = false;
        track.allowStreamPlay = false;
        track.playSavedWhenReady = false;
        track.cachePollStarted = false;
        setTrackServerState(track, "failed");
        setTrackCacheState(track, "failed");
        setTrackPlaybackState(track, "error");
      } else if (state === "cancelled") {
        track.status = "cancelled";
        track.cancelled = true;
        track.pendingBlob = false;
        track.streaming = false;
        track.allowStreamPlay = false;
        track.playSavedWhenReady = false;
        track.cachePollStarted = false;
        setTrackServerState(track, "cancelled");
        setTrackCacheState(track, "none");
        setTrackPlaybackState(track, "cancelled");
      } else {
        track.status = "pending";
        track.pendingBlob = true;
        setTrackServerState(track, "pending");
        setTrackCacheState(track, (track.cacheKey || track.cacheUrl) ? "pending" : "none");
        if (!track.playbackState) setTrackPlaybackState(track, "loading");
      }
      ensureTrackStates(track);
      return state;
    }
    function trackState(track) {
      if (!track) return "pending";
      ensureTrackStates(track);
      return track.state;
    }
    function isTerminalTrack(track) {
      var state = trackState(track);
      return state === "failed" || state === "cancelled";
    }
    function isSavedTrack(track) { return trackState(track) === "saved"; }
    function isLiveTrack(track) { return trackState(track) === "live"; }
    function isLiveExitTrack(track) {
      return isCancelableLiveTrack(track);
    }
    function isCancelableLiveTrack(track) {
      if (!track || track.deleted || isSavedTrack(track)) return false;
      if (normalizePlaybackMode(track.playbackMode) !== "live" || track.backgroundOnly) return false;
      var state = trackState(track);
      if (state === "failed" || state === "cancelled") return false;
      return state === "live" || state === "pending" || !!(track.pendingBlob || track.streaming || track.cachePollStarted);
    }
    function isPendingGenerateTrack(track) {
      if (!track || track.deleted || isSavedTrack(track)) return false;
      if (normalizePlaybackMode(track.playbackMode) !== "generate") return false;
      var state = trackState(track);
      if (state === "failed" || state === "cancelled") return false;
      return state === "pending" || !!(track.pendingBlob || track.cachePollStarted);
    }
    function isFinishedLiveTrack(track) {
      if (!track || isSavedTrack(track) || track.deleted || track.cancelled) return false;
      return !!(track.streamPlaybackFinished || track.playbackState === "ended");
    }
    function trackPlayableUrl(track) {
      if (!track) return "";
      var state = trackState(track);
      if (track.deleted || state === "failed" || state === "cancelled") return "";
      if (cfg.offlineAudioEnabled && track.offlineUrl) return track.offlineUrl;
      if (state === "saved") return track.url || track.cacheUrl || track.streamUrl || "";
      if (state === "live") return track.streamUrl || track.url || "";
      return track.url || "";
    }
    function liveStreamUrlForTrack(track) {
      if (!track) return "";
      if (track.streamUrl) return track.streamUrl;
      if (track.mode !== "single" && track.cacheKey) {
        track.streamUrl = cleanBase(cfg.apiBase) + "/tts_dialogue_stream_job/" + encodeURIComponent(track.cacheKey);
        return track.streamUrl;
      }
      return track.url || "";
    }
    function liveStreamPlaybackUrlForTrack(track, startOffsetSec) {
      var url = liveStreamUrlForTrack(track);
      if (!url) return "";
      startOffsetSec = Math.max(0, Number(startOffsetSec || 0) || 0);
      return startOffsetSec > 0.01 ? withQueryParam(url, "start_s", startOffsetSec.toFixed(3)) : url;
    }
    function isElementUsingTrackStream(track) {
      if (!track || !track.streamUrl) return false;
      try {
        if (track.cacheKey && audio.dataset.idxCacheKey === String(track.cacheKey) && audio.dataset.idxSourceKind === "stream") return true;
      } catch (_) {}
      var src = audio.currentSrc || audio.src || "";
      return src === track.streamUrl;
    }
    function isElementPlayingTrackStream(track) {
      return !!(isElementUsingTrackStream(track) && !audio.paused && !audio.ended);
    }
    function trackHasStreamIssue(track) {
      if (!track) return false;
      ensureTrackStates(track);
      return !!(track.streamInterrupted || track.streamHealth === "interrupted" || track.streamHealth === "stalled" || Number(track.stalledCount || 0) > 0);
    }
    function trackShouldAskPlaySaved(track) {
      if (!track) return false;
      ensureTrackStates(track);
      return !!(track.streamInterrupted || track.streamHealth === "interrupted" || Number(track.stalledCount || 0) > 2);
    }
    function revokeOfflineObjectUrl(track) {
      if (track && track.offlineObjectUrl) {
        try { URL.revokeObjectURL(track.offlineObjectUrl); } catch (_) {}
        track.offlineObjectUrl = "";
        if (track.offlineUrl && /^blob:/i.test(track.offlineUrl)) track.offlineUrl = "";
      }
    }
    function ensureTrackOfflineKey(track) {
      if (!track) return "";
      if (!track.offlineKey) track.offlineKey = offlineAudioKey(track.cacheKey);
      return track.offlineKey || "";
    }
    async function hydrateOfflineAudio(track, label) {
      if (!cfg.offlineAudioEnabled || !track || !track.cacheKey) {
        if (track) setTrackOfflineState(track, cfg.offlineAudioEnabled ? "missing" : "disabled");
        return false;
      }
      if (track.offlineReady && track.offlineUrl && /^blob:/i.test(String(track.offlineUrl))) {
        setTrackOfflineState(track, "ready");
        return true;
      }
      var key = ensureTrackOfflineKey(track);
      if (!key) return false;
      var rec = await getOfflineAudioRecord(key);
      if (!rec || !rec.blob) {
        revokeOfflineObjectUrl(track);
        track.offlineReady = false;
        setTrackOfflineState(track, "missing");
        return false;
      }
      revokeOfflineObjectUrl(track);
      track.offlineUrl = URL.createObjectURL(rec.blob);
      track.offlineObjectUrl = track.offlineUrl;
      track.offlineReady = true;
      track.offlineWanted = false;
      track.offlineSavedAt = rec.updatedAt || rec.createdAt || Date.now();
      track.offlineSize = rec.size || (rec.blob && rec.blob.size) || 0;
      setTrackOfflineState(track, "ready");
      debugLog("📦 " + (label || "offline") + " 命中 IndexedDB: " + key, "#9f9");
      return true;
    }
    async function saveOfflineAudioForTrack(track, label) {
      if (!cfg.offlineAudioEnabled || !track || !track.cacheKey || !track.cacheUrl || track.offlineSaveInProgress) {
        if (track) setTrackOfflineState(track, cfg.offlineAudioEnabled ? "missing" : "disabled");
        return false;
      }
      var key = ensureTrackOfflineKey(track);
      if (!key) return false;
      track.offlineSaveInProgress = true;
      setTrackOfflineState(track, "saving");
      try {
        var existing = await getOfflineAudioRecord(key);
        if (existing && existing.blob) {
          await hydrateOfflineAudio(track, label || "offline");
          if (messageId) saveTracksForMessage(messageId, generatedTracks).catch(function(){});
          return true;
        }
        var res = await fetch(track.cacheUrl, { cache: "no-store" });
        if (!res.ok) throw new Error("HTTP " + res.status);
        var blob = await res.blob();
        if (!blob || !blob.size) throw new Error("空音频");
        var now = Date.now();
        await putOfflineAudioRecord({
          key: key,
          cacheKey: track.cacheKey,
          sourceUrl: track.cacheUrl,
          mode: track.mode || "",
          voice: track.voice || "",
          contentType: blob.type || "audio/wav",
          size: blob.size,
          blob: blob,
          createdAt: track.offlineSavedAt || now,
          updatedAt: now
        });
        revokeOfflineObjectUrl(track);
        track.offlineUrl = URL.createObjectURL(blob);
        track.offlineObjectUrl = track.offlineUrl;
        track.offlineReady = true;
        track.offlineWanted = false;
        track.offlineSavedAt = now;
        track.offlineSize = blob.size;
        setTrackOfflineState(track, "ready");
        if (messageId) saveTracksForMessage(messageId, generatedTracks).catch(function(){});
        debugLog("💾 " + (label || "offline") + " 已保存离线音频: " + key + " (" + Math.round(blob.size / 1024) + " KB)", "#9f9");
        return true;
      } catch (e) {
        track.offlineWanted = true;
        setTrackOfflineState(track, "failed");
        debugLog("⚠️ " + (label || "offline") + " 离线保存失败；不影响在线播放: " + (e && e.message ? e.message : e), "#fc9");
        if (messageId) saveTracksForMessage(messageId, generatedTracks).catch(function(){});
        return false;
      } finally {
        track.offlineSaveInProgress = false;
      }
    }
    function scheduleOfflineAudioSave(track, label, delayMs) {
      if (!cfg.offlineAudioEnabled || !track || !track.cacheKey || !track.cacheUrl || track.offlineReady || track.offlineSaveInProgress || track.offlineSaveTimer) return;
      track.offlineWanted = true;
      setTrackOfflineState(track, "missing");
      track.offlineSaveTimer = setTimeout(function () {
        track.offlineSaveTimer = null;
        saveOfflineAudioForTrack(track, label).catch(function(){});
      }, Math.max(0, Number(delayMs || 0) || 0));
    }
    async function prepareOfflineAudio(track, label) {
      if (!cfg.offlineAudioEnabled || !track) return false;
      var hit = await hydrateOfflineAudio(track, label);
      var opts = (arguments.length > 2 && arguments[2]) || {};
      if (!hit && opts.saveMissing && isSavedTrack(track) && track.cacheKey && track.cacheUrl) {
        scheduleOfflineAudioSave(track, (label || "offline") + " compensation", 0);
      }
      return hit;
    }
    async function deleteOfflineAudioForTrack(track) {
      if (!track) return false;
      var key = ensureTrackOfflineKey(track);
      revokeOfflineObjectUrl(track);
      if (!key) return false;
      var ok = await deleteOfflineAudioRecord(key);
      if (ok) {
        track.offlineReady = false;
        track.offlineWanted = false;
        setTrackOfflineState(track, cfg.offlineAudioEnabled ? "missing" : "disabled");
        debugLog("🗑 已删除离线音频: " + key, "#fc9");
      }
      return ok;
    }
    function scriptFlagEnabled(name) {
      try {
        if (!script || !script.src) return false;
        return new RegExp("[?&]" + name + "=1\\b").test(script.src);
      } catch (_) {}
      return false;
    }
    function shouldUseWebAudioForLiveTrack(track) {
      if (!(track && track.mode !== "single" && isLiveTrack(track) && track.streamUrl)) return false;
      if (scriptFlagEnabled("noWebAudioLive")) return false;
      if (scriptFlagEnabled("nativeLive") || scriptFlagEnabled("elementLive")) return false;
      return true;
    }
    function shouldUseElementForLiveTrack(track, startOffsetSec) {
      if (!(track && isLiveTrack(track) && liveStreamUrlForTrack(track))) return false;
      startOffsetSec = Math.max(0, Number(startOffsetSec || 0) || 0);
      if (startOffsetSec > 0.01) return false;
      return scriptFlagEnabled("nativeLive") || scriptFlagEnabled("elementLive");
    }
    function waitForSavedLiveTrack(track, label, opts) {
      opts = opts || {};
      if (!track || !track.cacheKey) return false;
      stopWebAudioPlayback("replace");
      clearElementAudioSrc();
      track.streaming = true;
      track.allowStreamPlay = false;
      track.playSavedWhenReady = opts.autoplaySaved !== false;
      if (opts.resumeSec != null && isFinite(Number(opts.resumeSec))) {
        track.lastElementSec = Math.max(0, Number(opts.resumeSec) || 0);
      }
      setTrackStreamHealth(track, "stalled");
      setTrackPlaybackState(track, "buffering");
      setPlayState("loading");
      setStatus(opts.status || "实时播放不可用，等待完整音频…");
      showTrackNotice(track, opts.title || "等待完整音频…", opts.detail || "实时播放不可用，生成完成后切到完整音频");
      pollCacheUpgrade(track, label || "live cache fallback");
      if (messageId) saveTracksForMessage(messageId, generatedTracks).catch(function(){});
      return true;
    }
    function shouldUseElementForSavedTrack(track) {
      return isSavedTrack(track);
    }
    function savedTrackLabel(track) {
      return shouldUseElementForSavedTrack(track) ? "完整音频已就绪" : "音频已就绪";
    }
    function waitingLabelForTrack(track) {
      if (shouldUseElementForSavedTrack(track)) return "缓冲中…";
      if (track && track.backgroundOnly) return "后台生成中…";
      if (track && track.mode === "single") return "正在生成普通模式音频…";
      if (track && normalizeModeName(track.mode) === "ai") return "AI模式正在生成…";
      if (track && normalizeModeName(track.mode) === "normal") return "普通模式正在生成…";
      return "正在等待音频…";
    }
    function qualityModeLabel(mode) {
      mode = String(mode || "");
      if (mode === "fast") return "极速";
      if (mode === "ultra") return "落盘高质量";
      if (mode === "expressive") return "质量优先";
      return "平衡";
    }
    function formatJobMetrics(metrics) {
      return "";
    }
    async function askPlaySavedTrack(track) {
      if (!track || track.savePromptAsked || currentTrack() !== track || !isSavedTrack(track)) return;
      track.savePromptAsked = true;
      var choice = null;
      try {
        if (window.tavo && tavo.utils && typeof tavo.utils.select === "function") {
          choice = await tavo.utils.select([
            { value: "play", label: "切换播放", description: "从当前位置切到完整音频，支持拖动进度条" },
            { value: "wait", label: "继续等待", description: "保持当前流式播放，不切换" }
          ], "完整音频已就绪，是否切换播放？", "play");
        } else if (typeof window.confirm === "function") {
          choice = window.confirm("完整音频已就绪，是否切换播放？") ? "play" : "wait";
        }
      } catch (e) {
        debugLog("⚠️ 完整音频弹窗失败: " + (e && e.message ? e.message : e), "#fc9");
      }
      if (choice !== "play" || currentTrack() !== track || !isSavedTrack(track)) return;
      var resumeSec = 0;
      try {
        if (webAudioController && typeof webAudioController.getTimeSec === "function") resumeSec = webAudioController.getTimeSec();
        else if (track.lastWebAudioSec != null) resumeSec = Number(track.lastWebAudioSec) || 0;
        else if (isElementUsingTrackStream(track) && isFinite(Number(audio.currentTime))) resumeSec = Number(audio.currentTime) || 0;
        else if (track.lastElementSec != null) resumeSec = Number(track.lastElementSec) || 0;
      } catch (_) { resumeSec = 0; }
      await prepareOfflineAudio(track, "switch saved", { saveMissing: true });
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
      var activeTrack = currentTrack();
      if (activeTrack && webAudioController && typeof webAudioController.getTimeSec === "function") {
        try { activeTrack.lastWebAudioSec = Math.max(0, Number(webAudioController.getTimeSec()) || 0); } catch (_) {}
      }
      if (webAudioController && typeof webAudioController.stop === "function") {
        try { webAudioController.stop(reason || "停止播放"); } catch (_) {}
      }
      webAudioController = null;
      clearWebAudioProgressTimer();
      markWebAudioStopped(activeTrack);
      if (activeTrack && reason === "pause") setTrackPlaybackState(activeTrack, "paused");
      stopSubtitle();
      if (reason && reason !== "switch" && reason !== "replace" && reason !== "silent") {
        setPlayState("idle");
        setStatus(reason === "pause" ? "已暂停" : "播放已停止");
      }
    }
    function startWebAudioProgress(token, startedAt, playbackRate, track, fallbackOffsetSec) {
      fallbackOffsetSec = Math.max(0, Number(fallbackOffsetSec || 0) || 0);
      clearWebAudioProgressTimer();
      webAudioProgressTimer = setInterval(function () {
        if (token !== webAudioPlayToken) { clearWebAudioProgressTimer(); return; }
        var sec = 0;
        try {
          if (webAudioController && typeof webAudioController.getTimeSec === "function") sec = webAudioController.getTimeSec();
          else {
            var now = (typeof performance !== "undefined" ? performance.now() : Date.now());
            sec = Math.max(0, fallbackOffsetSec + ((now - startedAt) / 1000) * playbackRate);
          }
        } catch (_) { sec = 0; }
        sec = clampPlaybackTimeSec(track, sec);
        if (cur) cur.textContent = formatTime(sec);
        var durHint = trackDurationHintSec(track);
        if (total) total.textContent = durHint > 0 ? formatTime(durHint) : "--:--";
        if (seek) {
          seekProgrammaticUpdate = true;
          seek.disabled = isCancelableLiveTrack(track) || !(durHint > 0);
          seek.value = durHint > 0 ? String(Math.floor(Math.min(sec, durHint) / durHint * 1000)) : "0";
          setTimeout(function () { seekProgrammaticUpdate = false; }, 0);
        }
        try {
          if (navigator.mediaSession && navigator.mediaSession.setPositionState && durHint > 0) {
            navigator.mediaSession.setPositionState({
              duration: durHint,
              playbackRate: playbackRate || 1,
              position: Math.min(sec, durHint),
            });
          }
        } catch (_) {}
        if (track) track.lastWebAudioSec = sec;
      }, 250);
    }
    async function playTrackViaWebAudio(track, url, opts) {
      opts = opts || {};
      if (!track || !url) return false;
      stopWebAudioPlayback("replace");
      var token = ++webAudioPlayToken;
      var playbackRate = clampNumber(cfg.speedFactor || 1.0, 1.0, 0.85, 1.25);
      var startOffsetSec = Math.max(0, Number(opts.startOffsetSec || 0) || 0);
      var startedAt = 0;
      var waitStartedAt = Date.now();
      var waitTimer = null;
      var firstAudioTimedOut = false;
      var streamTooSlowFallback = false;
      function stopWaitTimer() {
        if (waitTimer) { try { clearInterval(waitTimer); } catch (_) {} waitTimer = null; }
      }
      function webAudioShouldYieldToTrackState() {
        var st = trackState(track);
        return !!(track.deleted || st === "failed" || st === "cancelled" || (st === "saved" && !track.webAudioPlaying));
      }
      track.webAudioPlaying = false;
      setTrackStreamHealth(track, "ok");
      clearElementAudioSrc();
      if (seek) { seek.disabled = true; seek.value = "0"; }
      if (cur) cur.textContent = formatTime(startOffsetSec);
      if (total) total.textContent = "--:--";
      setError("");
      setTrackPlaybackState(track, "loading");
      setPlayState("loading");
      setStatus(opts.connectingStatus || "正在连接音频…");
      showTrackNotice(track, opts.noticeTitle || "正在连接音频…", opts.noticeDetail || "等待后端返回声音");
      waitTimer = setInterval(function () {
        if (token !== webAudioPlayToken) { stopWaitTimer(); return; }
        if (webAudioShouldYieldToTrackState()) { stopWaitTimer(); return; }
        if (track.webAudioPlaying) return;
        var sec = Math.max(1, Math.floor((Date.now() - waitStartedAt) / 1000));
        if (sec >= 90) {
          firstAudioTimedOut = true;
          setTrackStreamHealth(track, "interrupted");
          setTrackPlaybackState(track, "error");
          setPlayState("idle");
          setStatus("首段音频超时");
          setError("90 秒内没有收到可播放音频，已停止这次流式连接。可以重新生成或稍后点播放检查历史音频。");
          showTrackNotice(track, "首段音频超时", "已停止这次流式连接，不会继续卡住");
          if (webAudioController && typeof webAudioController.stop === "function") {
            try { webAudioController.stop("first audio timeout"); } catch (_) {}
          }
          stopWaitTimer();
          return;
        }
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
            if (webAudioShouldYieldToTrackState()) {
              if (state !== "stopped") debugLog("↪️ 忽略 Web Audio 状态 " + state + "：任务状态已是 " + trackState(track), "#fc9");
              return;
            }
            if (state === "connecting") {
              setTrackPlaybackState(track, "loading");
              setStatus("正在连接音频…");
              showTrackNotice(track, "正在连接音频…", "弱网下可能需要多等几秒");
            } else if (state === "connected" || state === "waiting_pcm") {
              setTrackPlaybackState(track, "streaming");
              setStatus("等待首段音频…");
              showTrackNotice(track, "等待首段音频…", opts.waitDetail || "后端正在合成第一段");
            } else if (state === "first_pcm") {
              setTrackPlaybackState(track, "buffering");
              setStatus("收到音频，正在缓冲…");
              showTrackNotice(track, "收到音频", "缓冲一小段后起播");
            } else if (state === "scheduled") {
              setTrackPlaybackState(track, "buffering");
              setStatus("音频已排队，准备起播…");
              showTrackNotice(track, "音频已排队", "即将开始出声");
            } else if (state === "audio_suspended") {
              track.pausedByUser = true;
              track.lastWebAudioSec = trackResumeSec(track);
              setTrackPlaybackState(track, "paused");
              setPlayState("idle");
              setStatus("音频通道未放行，点播放继续");
              showTrackNotice(track, "音频通道未放行", "点播放继续，不会从头开始");
            } else if (state === "playing") {
              stopWaitTimer();
              track.webAudioPlaying = true;
              setTrackPlaybackState(track, "playing");
              setPlayState("playing");
              setStatus(trackPlaybackLabel(track));
              setError("");
              debugLog("▶️ Web Audio 播放时钟已启动", "#9f9");
              startedAt = (typeof performance !== "undefined" ? performance.now() : Date.now());
              startWebAudioProgress(token, startedAt, playbackRate, track, startOffsetSec);
              startSubtitle(track, function () {
                if (webAudioController && typeof webAudioController.getTimeSec === "function") return webAudioController.getTimeSec();
                return startOffsetSec + ((((typeof performance !== "undefined" ? performance.now() : Date.now()) - startedAt) / 1000) * playbackRate);
              });
            } else if (state === "buffering") {
              track.savePromptWanted = true;
              track.stalledCount = Number(track.stalledCount || 0) + 1;
              track.lastStalledAt = Date.now();
              track.lastStalledSec = trackResumeSec(track);
              setTrackStreamHealth(track, "stalled");
              setTrackPlaybackState(track, "buffering");
              setPlayState("loading");
              setStatus("网络缓冲中…");
              showTrackNotice(track, "网络缓冲中…", "歌词会停在当前播放位置");
              debugLog("⚠️ Web Audio buffering count=" + track.stalledCount, "#fc9");
              if (track.cacheKey && track.stalledCount >= 4 && !streamTooSlowFallback) {
                streamTooSlowFallback = true;
                track.playSavedWhenReady = true;
                setStatus("实时生成跟不上，等待完整音频…");
                showTrackNotice(track, "实时生成跟不上", "停止流式，等完整音频完成后自动播放");
                debugLog("⚠️ Web Audio 连续缓冲，切到落盘后播放 cacheKey=" + track.cacheKey, "#fc9");
                if (webAudioController && typeof webAudioController.stop === "function") {
                  try { webAudioController.stop("stream too slow"); } catch (_) {}
                }
              }
            } else if (state === "resumed") {
              setTrackPlaybackState(track, "playing");
              setPlayState("playing");
              setStatus(trackPlaybackLabel(track));
            } else if (state === "interrupted") {
              stopWaitTimer();
              setTrackStreamHealth(track, "interrupted");
              markWebAudioStopped(track);
              webAudioController = null;
              clearWebAudioProgressTimer();
              stopSubtitle();
              setTrackPlaybackState(track, "error");
              setPlayState("idle");
              setStatus("流式中断，点播放从断点继续");
              showTrackNotice(track, "流式中断", "后台仍在合成；点播放从断点继续，完成后转为可拖动音频");
            } else if (state === "stopped") {
              stopWaitTimer();
              markWebAudioStopped(track);
              setTrackPlaybackState(track, "paused");
              clearWebAudioProgressTimer();
            } else if (state === "ended") {
              stopWaitTimer();
              markWebAudioStopped(track);
              webAudioController = null;
              clearWebAudioProgressTimer();
              setTrackPlaybackState(track, "ended");
              setPlayState("idle");
              stopSubtitle();
              if ((track.streamInterrupted || track.streamHealth === "interrupted") && !isSavedTrack(track)) {
                setStatus("网络中断，等待完整音频…");
                showTrackNotice(track, "网络中断，等待完整音频…", "完整音频就绪后可切换播放");
              } else {
                var saved = shouldUseElementForSavedTrack(track);
                setStatus(saved ? "播放完成，完整音频已就绪" : "播放完成，等待完整音频…");
                showTrackNotice(track, "播放完成", saved ? "点播放可重播" : "正在后台整理完整音频");
              }
            }
          },
          onError: function (e) { debugLog("❌ Web Audio 错误: " + (e && e.message ? e.message : e), "#f99"); },
          debug: function (text) { debugLog("[wa] " + text, "#9ff"); },
          startOffsetSec: startOffsetSec
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
        var st = trackState(track);
        if (track.deleted || st === "failed" || st === "cancelled") {
          debugLog("↪️ 忽略 Web Audio 流式异常，任务状态已是 " + st + ": " + msg, "#fc9");
          return false;
        }
        if (st === "saved") {
          setPlayState("idle");
          setStatus("完整音频已就绪");
          showTrackNotice(track, "完整音频已就绪", "点播放可重播，支持拖动进度条");
          return false;
        }
        if (streamTooSlowFallback) {
          setTrackStreamHealth(track, "stalled");
          setTrackPlaybackState(track, "buffering");
          setPlayState("loading");
          setStatus("实时生成跟不上，等待完整音频…");
          pollCacheUpgrade(track, "slow stream fallback");
          return false;
        }
        if (firstAudioTimedOut) {
          setTrackStreamHealth(track, "interrupted");
          setTrackPlaybackState(track, "error");
          setPlayState("idle");
          setStatus("首段音频超时");
          return false;
        }
        if ((e && e.name === "AbortError") || /播放已停止|停止播放/i.test(msg)) {
          setTrackPlaybackState(track, "idle");
          setPlayState("idle");
          return false;
        }
        if (isNetworkStreamError(e) && track.cacheKey) {
          setTrackStreamHealth(track, "interrupted");
          setTrackPlaybackState(track, "error");
          setPlayState("idle");
          setStatus("流式中断，点播放从断点继续");
          setError("网络中断。点播放可从断点继续；若已合成完成会自动转为可拖动音频。");
          showTrackNotice(track, "流式中断", "为省流量不自动重连；点播放从断点继续");
          debugLog("⚠️ Web Audio 连接中断，不恢复流式: " + msg, "#fc9");
          return false;
        }
        if (track.cacheKey && (/\[step:fetch\]\s+HTTP\s+5\d\d/i.test(msg) || /decodeAudioData|WAV|wavHeader|data 段|不支持|not supported|noAudio/i.test(msg))) {
          debugLog("⚠️ 实时流暂不可用，改等完整音频: " + msg, "#fc9");
          waitForSavedLiveTrack(track, "web audio stream fallback", {
            resumeSec: trackResumeSec(track),
            title: "实时流暂不可用",
            detail: "生成完成后自动切到完整音频"
          });
          return false;
        }
        var friendly = friendlyPlaybackError(e);
        setTrackPlaybackState(track, "error");
        setPlayState("idle");
        setStatus("播放失败");
        setError(friendly);
        showTrackNotice(track, "播放失败", friendly);
        debugLog("❌ Web Audio 流式异常: " + msg, "#f99");
        return false;
      }
    }
    function playLiveTrack(track, url, opts) {
      opts = opts || {};
      if (!track || !url) return Promise.resolve(false);
      if (shouldUseWebAudioForLiveTrack(track)) return playTrackViaWebAudio(track, url, opts);
      var startOffsetSec = Math.max(0, Number(opts.startOffsetSec || 0) || 0);
      if (!shouldUseElementForLiveTrack(track, startOffsetSec)) {
        return Promise.resolve(waitForSavedLiveTrack(track, "live cache fallback", {
          resumeSec: startOffsetSec,
          title: opts.noticeTitle || "等待完整音频…",
          detail: opts.noticeDetail || "Tavo WebView 不直接播放实时音频，生成完成后切到完整音频"
        }));
      }
      stopWebAudioPlayback("replace");
      track.streamUrl = liveStreamUrlForTrack(track) || url;
      track.url = track.streamUrl;
      track.streaming = true;
      track.allowStreamPlay = false;
      setTrackStreamHealth(track, "ok");
      setTrackPlaybackState(track, "loading");
      setPlayState("loading");
      setStatus(opts.noticeTitle || (startOffsetSec > 0 ? "从断点继续播放" : "连接流式音频"));
      showTrackNotice(track, opts.noticeTitle || "连接流式音频", opts.noticeDetail || "使用系统音频通道播放直播流");
      debugLog("▶️ live track 使用 audio 元素流式 start_s=" + startOffsetSec.toFixed(3), "#ffd479");
      return Promise.resolve(startElementAudioFrom(track, startOffsetSec));
    }
    async function promoteTrackIfCacheReady(track, label) {
      if (!track || !track.cacheKey || track.deleted) return false;
      try {
        if (!track.cacheUrl) track.cacheUrl = cleanBase(cfg.apiBase) + "/cache_audio/" + encodeURIComponent(track.cacheKey);
        var hs = await fetch(track.cacheUrl, { method: "HEAD", cache: "no-store" });
        if (!hs || !hs.ok) return false;
        setTrackState(track, "saved");
        attachCacheAudio(track, { deferElement: true });
        scheduleOfflineAudioSave(track, (label || "cache ready") + " offline", 0);
        knownHistoryCount = persistableHistoryTracks(generatedTracks).length;
        updateTrackButtons();
        if (messageId) saveTracksForMessage(messageId, generatedTracks).catch(function(){});
        removePendingJobForTrack(track).catch(function(){});
        debugLog("✅ " + (label || "cache ready") + " HEAD确认已落盘，切换为历史音频", "#9f9");
        return true;
      } catch (e) {
        debugLog("⚠️ 检查 cache_audio HEAD 失败: " + (e && e.message ? e.message : e), "#fc9");
      }
      return false;
    }
    async function refreshTrackFromStatus(track, label) {
      if (!track || !track.cacheKey || track.deleted) return false;
      try {
        if (track.mode === "single") {
          if (!track.cacheUrl) track.cacheUrl = cleanBase(cfg.apiBase) + "/cache_audio/" + encodeURIComponent(track.cacheKey);
          var hs = await fetch(track.cacheUrl, { method: "HEAD", cache: "no-store" });
          if (!hs.ok) return false;
          setTrackState(track, "saved");
          attachCacheAudio(track, { deferElement: true });
          scheduleOfflineAudioSave(track, (label || "single") + " offline", 0);
          knownHistoryCount = persistableHistoryTracks(generatedTracks).length;
          updateTrackButtons();
          if (messageId) saveTracksForMessage(messageId, generatedTracks).catch(function(){});
          debugLog("✅ " + (label || "single") + " 单音色缓存已保存", "#9f9");
          return true;
        }
        var st = await fetch(cleanBase(cfg.apiBase) + "/tts_dialogue_job_status/" + encodeURIComponent(track.cacheKey), { cache: "no-store" });
        if (!st.ok) return false;
        var j = await st.json();
        if (j && j.metrics) track.metrics = j.metrics;
        if (j && j.sample_rate) track.sampleRate = j.sample_rate;
        if (j && j.duration_s) track.duration_s = j.duration_s;
        if (j && j.cache_url) track.cacheUrl = new URL(j.cache_url, cleanBase(cfg.apiBase) + "/").href;
        if (j && Array.isArray(j.segments_meta) && j.segments_meta.length) {
          track.segments = j.segments_meta.map(function (s) {
            return { role: s.role || "", text: s.text || "", style: s.style || "neutral", style_alpha: s.style_alpha, start_s: s.start_s, start_offset_bytes: s.start_offset_bytes, duration_s: s.duration_s };
          });
        }
        if (j && j.state === "done") {
          setTrackState(track, "saved");
          attachCacheAudio(track, { deferElement: true });
          scheduleOfflineAudioSave(track, (label || "track") + " offline", 0);
          knownHistoryCount = persistableHistoryTracks(generatedTracks).length;
          updateTrackButtons();
          if (messageId) saveTracksForMessage(messageId, generatedTracks).catch(function(){});
          removePendingJobForTrack(track).catch(function(){});
          debugLog("✅ " + (label || "track") + " 已保存，切换为历史音频", "#9f9");
          return true;
        }
        if (j && j.state === "failed") {
          track.error = (j.metrics && j.metrics.message ? j.metrics.message + ": " : "") + (j.error || "服务端生成失败");
          setTrackState(track, "failed");
          removePendingJobForTrack(track).catch(function(){});
          updateTrackButtons();
          if (messageId) saveTracksForMessage(messageId, generatedTracks).catch(function(){});
          debugLog("❌ " + (label || "track") + " 服务端生成失败: " + track.error, "#f99");
          return true;
        }
        if (j && j.state === "cancelled") {
          track.error = j.error || "任务已取消";
          setTrackState(track, "cancelled");
          removePendingJobForTrack(track).catch(function(){});
          updateTrackButtons();
          if (messageId) saveTracksForMessage(messageId, generatedTracks).catch(function(){});
          debugLog("🛑 " + (label || "track") + " 服务端任务已取消", "#fc9");
          return true;
        }
      } catch (e) {
        debugLog("⚠️ 检查历史音频状态失败: " + (e && e.message ? e.message : e), "#fc9");
      }
      return false;
    }
