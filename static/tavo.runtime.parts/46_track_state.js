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
    function clearTerminalTrackLiveOutput(track, reason) {
      if (!track) return false;
      var ownsAudio = false;
      try {
        ownsAudio = !!(
          elementAudioBelongsToTrack(track)
          || isElementUsingTrackStream(track)
          || isElementUsingTrackLiveSegment(track)
          || isElementUsingTrackLiveMp3(track)
        );
      } catch (_) {
        ownsAudio = false;
      }
      try {
        if (webAudioBelongsToTrack(track)) stopWebAudioPlayback(reason || "terminal");
      } catch (_) {}
      if (ownsAudio) clearElementAudioSrc();
      try {
        cancelLiveSegmentAudioQueue(reason || "terminal");
        clearLiveMp3AudioState(track);
      } catch (_) {}
      stopSubtitle();
      try {
        if (currentTrack() === track) setPlayState("idle");
      } catch (_) {}
      return ownsAudio;
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
        clearTerminalTrackLiveOutput(track, "failed");
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
        clearTerminalTrackLiveOutput(track, "cancelled");
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
      return isCancelableLiveTrack(track) || trackHasActiveLiveOutput(track);
    }
    function trackHasActiveLiveOutput(track) {
      if (!track || track.deleted || isTerminalTrack(track)) return false;
      var ps = String(track.playbackState || "");
      try {
        if (webAudioBelongsToTrack(track) && (track.webAudioPlaying || track.webAudioPausedLocal || ps === "playing" || ps === "buffering" || ps === "loading")) return true;
      } catch (_) {}
      try {
        if ((isElementUsingTrackStream(track) || isElementUsingTrackLiveSegment(track) || isElementUsingTrackLiveMp3(track)) && (ps === "playing" || ps === "buffering" || ps === "loading" || !audio.paused)) return true;
      } catch (_) {}
      return false;
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
    function sameAudioUrl(a, b) {
      if (!a || !b) return false;
      a = String(a);
      b = String(b);
      if (a === b) return true;
      try { return new URL(a, location.href).href === new URL(b, location.href).href; } catch (_) {}
      return false;
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
    function livePcmUrlForTrack(track) {
      if (!(track && track.cacheKey && track.mode !== "single")) return "";
      return cleanBase(cfg.apiBase) + "/tts_dialogue_stream_job/" + encodeURIComponent(track.cacheKey) + "/pcm";
    }
    function liveMp3UrlForTrack(track, startOffsetSec) {
      if (!(track && track.cacheKey && track.mode !== "single")) return "";
      var url = cleanBase(cfg.apiBase) + "/tts_dialogue_stream_job/" + encodeURIComponent(track.cacheKey) + "/mp3";
      startOffsetSec = Math.max(0, Number(startOffsetSec || 0) || 0);
      return startOffsetSec > 0.01 ? withQueryParam(url, "start_s", startOffsetSec.toFixed(3)) : url;
    }
    function liveSegmentAudioUrlForTrack(track, segmentIdx) {
      if (!(track && track.cacheKey && track.mode !== "single")) return "";
      return cleanBase(cfg.apiBase) + "/tts_dialogue_stream_job/" + encodeURIComponent(track.cacheKey) + "/segment/" + encodeURIComponent(String(segmentIdx));
    }
    function isElementUsingTrackStream(track) {
      if (!track || !track.streamUrl) return false;
      try {
        if (track.cacheKey && audio.dataset.idxCacheKey === String(track.cacheKey) && audio.dataset.idxSourceKind === "stream") return true;
      } catch (_) {}
      var src = audio.currentSrc || audio.src || "";
      return src === track.streamUrl;
    }
    function isElementUsingTrackLiveSegment(track) {
      if (!track || !audio) return false;
      try {
        return !!(track.cacheKey && audio.dataset.idxCacheKey === String(track.cacheKey) && audio.dataset.idxSourceKind === "live-segment");
      } catch (_) {
        return false;
      }
    }
    function liveMp3ElementSrcMatchesTrack(track) {
      if (!(track && track.cacheKey && audio)) return false;
      var src = "";
      try { src = audio.currentSrc || audio.src || ""; } catch (_) { src = ""; }
      if (!src) return false;
      try {
        var u = new URL(src, location.href);
        return u.pathname === "/tts_dialogue_stream_job/" + encodeURIComponent(String(track.cacheKey)) + "/mp3";
      } catch (_) {
        return src.indexOf("/tts_dialogue_stream_job/" + encodeURIComponent(String(track.cacheKey)) + "/mp3") >= 0;
      }
    }
    function isElementUsingTrackLiveMp3(track) {
      if (!track || !audio) return false;
      try {
        if (track.cacheKey && audio.dataset.idxCacheKey === String(track.cacheKey) && audio.dataset.idxSourceKind === "live-mp3") return true;
      } catch (_) {}
      if (liveMp3ElementSrcMatchesTrack(track)) {
        markElementAudioTrack(track, "live-mp3", Math.max(0, Number(track.liveElementOffsetSec || track.liveMp3StartSec || 0) || 0));
        return true;
      }
      return false;
    }
    function isElementPlayingTrackStream(track) {
      return !!((isElementUsingTrackStream(track) || isElementUsingTrackLiveSegment(track) || isElementUsingTrackLiveMp3(track)) && !audio.paused && !audio.ended);
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
    function dataUrlToObjectUrl(dataUrl, fallbackType) {
      dataUrl = String(dataUrl || "");
      if (!/^data:/i.test(dataUrl)) return "";
      try {
        var comma = dataUrl.indexOf(",");
        if (comma < 0) return "";
        var head = dataUrl.slice(0, comma);
        var body = dataUrl.slice(comma + 1);
        var mimeMatch = /^data:([^;,]+)/i.exec(head);
        var mime = (mimeMatch && mimeMatch[1]) || fallbackType || "audio/mpeg";
        var bytes;
        if (/;base64/i.test(head)) {
          var bin = atob(body);
          bytes = new Uint8Array(bin.length);
          for (var i = 0; i < bin.length; i += 1) bytes[i] = bin.charCodeAt(i);
        } else if (typeof TextEncoder === "function") {
          bytes = new TextEncoder().encode(decodeURIComponent(body));
        } else {
          var text = decodeURIComponent(body);
          bytes = new Uint8Array(text.length);
          for (var j = 0; j < text.length; j += 1) bytes[j] = text.charCodeAt(j) & 255;
        }
        return URL.createObjectURL(new Blob([bytes], { type: mime }));
      } catch (_) {
        return "";
      }
    }
    function blobToDataUrl(blob) {
      return new Promise(function (resolve, reject) {
        try {
          var reader = new FileReader();
          reader.onload = function () { resolve(String(reader.result || "")); };
          reader.onerror = function () { reject(reader.error || new Error("读取离线音频失败")); };
          reader.readAsDataURL(blob);
        } catch (e) {
          reject(e);
        }
      });
    }
    function cacheAudioUrlCandidates(track) {
      var out = [];
      function add(url) {
        url = String(url || "").trim();
        if (!url) return;
        try { url = new URL(url, cleanBase(cfg.apiBase) + "/").href; } catch (_) {}
        if (out.indexOf(url) < 0) out.push(url);
      }
      if (track && track.cacheKey) add(cleanBase(cfg.apiBase) + "/cache_audio/" + encodeURIComponent(track.cacheKey));
      if (track) {
        add(track.cacheUrl);
        add(track.url);
      }
      try {
        if (track && elementAudioBelongsToTrack(track) && (isSavedTrack(track) || track.cacheReady)) add(audio.currentSrc || audio.src || "");
      } catch (_) {}
      return out.filter(function (url) {
        try { return /\/cache_audio\/[^/?#]+/i.test(new URL(url, cleanBase(cfg.apiBase) + "/").pathname); }
        catch (_) { return /^\/cache_audio\/[^/?#]+/i.test(String(url || "")); }
      });
    }
    function offlineCacheReadyForSave(track) {
      if (!track || !track.cacheKey) return false;
      if (isSavedTrack(track)) return true;
      return !!(
        track.cacheReady
        || track.cacheState === "ready"
        || track.remoteCacheState === "ready"
        || track.serverState === "done"
        || track.status === "ready"
      );
    }
    async function fetchOfflineAudioDataUrl(track) {
      var urls = cacheAudioUrlCandidates(track);
      var errors = [];
      for (var i = 0; i < urls.length; i += 1) {
        var url = urls[i];
        try {
          var res = await fetch(url, { cache: "no-store" });
          if (!res || !res.ok) throw new Error("HTTP " + (res ? res.status : 0));
          var blob = await res.blob();
          if (!blob || !Number(blob.size || 0)) throw new Error("音频内容为空");
          var dataUrl = await blobToDataUrl(blob);
          if (!/^data:/i.test(dataUrl)) throw new Error("dataUrl 转换失败");
          return { dataUrl: dataUrl, size: Number(blob.size || 0) || 0, sourceUrl: url, contentType: blob.type || "audio/mpeg" };
        } catch (e) {
          errors.push(url + " -> " + (e && e.message ? e.message : String(e)));
        }
      }
      throw new Error(errors.length ? errors.join("; ") : "没有可用 cache_audio URL");
    }
    async function loadOfflineAudioForPlayback(track, label) {
      if (!cfg.offlineAudioEnabled || !track || !track.cacheKey) return "";
      var keys = trackOfflineKeyCandidates(track);
      if (!keys.length) return "";
      var api = offlineFileApi();
      if (typeof api.load !== "function") throw new Error("当前 Tavo 文件存储不支持读取离线音频");
      var key = "";
      var dataUrl = "";
      var errors = [];
      for (var i = 0; i < keys.length; i += 1) {
        try {
          key = keys[i];
          dataUrl = await api.load(key, { scope: OFFLINE_FILE_SCOPE, encoding: "dataUrl" });
          if (dataUrl) break;
        } catch (e) {
          errors.push(keys[i] + ": " + (e && e.message ? e.message : String(e)));
          dataUrl = "";
        }
      }
      if (!dataUrl) throw new Error("Tavo 离线文件为空或不存在");
      revokeOfflineObjectUrl(track);
      var objectUrl = dataUrlToObjectUrl(dataUrl, "audio/mpeg");
      track.offlineKey = key;
      track.offlineObjectUrl = objectUrl || "";
      track.offlineUrl = objectUrl || String(dataUrl);
      track.offlineReady = true;
      track.offlineWanted = false;
      track.offlineSavedAt = Date.now();
      setTrackOfflineState(track, "ready");
      debugLog("📦 " + (label || "offline") + " 已用 tavo.file.load 读取离线音频: " + key, "#9f9");
      return track.offlineUrl;
    }
    function ensureTrackOfflineKey(track) {
      if (!track) return "";
      var opts = (arguments.length > 1 && arguments[1]) || {};
      var existing = String(track.offlineKey || "").trim();
      var preferred = offlineAudioKey(track.cacheKey);
      if (opts.preferDefault || !existing) track.offlineKey = preferred || existing;
      return track.offlineKey || "";
    }
    function trackOfflineKeyCandidates(track) {
      if (!track || !track.cacheKey) return [];
      return offlineAudioKeyCandidates(track.cacheKey, track.offlineKey);
    }
    async function hydrateOfflineAudio(track, label) {
      if (!cfg.offlineAudioEnabled || !track || !track.cacheKey) {
        if (track) setTrackOfflineState(track, cfg.offlineAudioEnabled ? "missing" : "disabled");
        return false;
      }
      if (track.offlineReady && track.offlineUrl && !/^blob:/i.test(String(track.offlineUrl))) {
        setTrackOfflineState(track, "ready");
        return true;
      }
      var keys = trackOfflineKeyCandidates(track);
      if (!keys.length) return false;
      var key = "";
      var rec = null;
      for (var i = 0; i < keys.length; i += 1) {
        rec = await getOfflineAudioRecord(keys[i]);
        if (rec && rec.path) {
          key = keys[i];
          break;
        }
      }
      if (!rec || !rec.path) {
        revokeOfflineObjectUrl(track);
        track.offlineUrl = "";
        track.offlineReady = false;
        setTrackOfflineState(track, "missing");
        return false;
      }
      revokeOfflineObjectUrl(track);
      track.offlineKey = key;
      track.offlineUrl = rec.path;
      track.offlineObjectUrl = "";
      track.offlineReady = true;
      track.offlineWanted = false;
      track.offlineSavedAt = rec.updatedAt || Date.now();
      track.offlineSize = rec.size || track.offlineSize || 0;
      setTrackOfflineState(track, "ready");
      debugLog("📦 " + (label || "offline") + " 命中 Tavo 文件: " + key, "#9f9");
      return true;
    }
    async function saveOfflineAudioForTrack(track, label) {
      if (!cfg.offlineAudioEnabled || !track || !track.cacheKey || track.offlineSaveInProgress) {
        if (track) setTrackOfflineState(track, cfg.offlineAudioEnabled ? "missing" : "disabled");
        return false;
      }
      if (!offlineCacheReadyForSave(track)) {
        track.offlineWanted = true;
        setTrackOfflineState(track, "missing");
        debugLog("↪️ " + (label || "offline") + " 暂不保存离线音频：完整 MP3 还未确认落盘 cacheKey=" + track.cacheKey, "#fc9");
        return false;
      }
      if (!track.cacheUrl) track.cacheUrl = cleanBase(cfg.apiBase) + "/cache_audio/" + encodeURIComponent(track.cacheKey);
      if (!track.cacheUrl) {
        setTrackOfflineState(track, "missing");
        return false;
      }
      var existingKeys = trackOfflineKeyCandidates(track);
      for (var i = 0; i < existingKeys.length; i += 1) {
        var existing = await getOfflineAudioRecord(existingKeys[i]);
        if (existing && existing.path) {
          track.offlineKey = existingKeys[i];
          await hydrateOfflineAudio(track, label || "offline");
          if (messageId) saveTracksForMessage(messageId, generatedTracks).catch(function(){});
          return true;
        }
      }
      var key = ensureTrackOfflineKey(track, { preferDefault: true });
      if (!key) return false;
      track.offlineSaveInProgress = true;
      setTrackOfflineState(track, "saving");
      try {
        var now = Date.now();
        var fetched = null;
        var fetchError = null;
        try {
          fetched = await fetchOfflineAudioDataUrl(track);
        } catch (fe) {
          fetchError = fe;
          debugLog("⚠️ " + (label || "offline") + " 前端读取 cache_audio 失败: " + (fe && fe.message ? fe.message : fe), "#fc9");
        }
        if (!fetched || !fetched.dataUrl) throw fetchError || new Error("前端没有读到可保存的 cache_audio 数据");
        var sourceUrl = (fetched && fetched.sourceUrl) || cacheAudioUrlCandidates(track)[0] || track.cacheUrl;
        var record = {
          key: key,
          cacheKey: track.cacheKey,
          sourceUrl: sourceUrl,
          mode: track.mode || "",
          voice: track.voice || "",
          contentType: (fetched && fetched.contentType) || "audio/mpeg",
          size: (fetched && fetched.size) || track.offlineSize || 0,
          createdAt: track.offlineSavedAt || now,
          updatedAt: now
        };
        if (fetched && fetched.dataUrl) {
          record.content = fetched.dataUrl;
          record.encoding = "dataUrl";
        }
        var saved;
        try {
          saved = await putOfflineAudioRecord(record);
        } catch (saveError) {
          if (scriptFlagEnabled("offlineUrlFallback") && fetched && sourceUrl) {
            debugLog("⚠️ " + (label || "offline") + " dataUrl 保存失败，最后回退 Tavo URL 下载: " + (saveError && saveError.message ? saveError.message : saveError), "#fc9");
            saved = await putOfflineAudioRecord({
              key: key,
              cacheKey: track.cacheKey,
              sourceUrl: sourceUrl,
              mode: track.mode || "",
              voice: track.voice || "",
              contentType: "audio/mpeg",
              size: track.offlineSize || 0,
              createdAt: track.offlineSavedAt || now,
              updatedAt: now
            });
          } else {
            if (fetchError && saveError && saveError.message) saveError.message += "；前端读取也失败: " + (fetchError.message || fetchError);
            throw saveError;
          }
        }
        revokeOfflineObjectUrl(track);
        track.offlineUrl = saved.path;
        track.offlineObjectUrl = "";
        track.offlineReady = true;
        track.offlineWanted = false;
        track.offlineSavedAt = now;
        track.offlineSize = saved.size || track.offlineSize || 0;
        setTrackOfflineState(track, "ready");
        if (messageId) saveTracksForMessage(messageId, generatedTracks).catch(function(){});
        debugLog("💾 " + (label || "offline") + " 已保存 Tavo 离线音频: " + key, "#9f9");
        return true;
      } catch (e) {
        track.offlineUrl = "";
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
      if (!cfg.offlineAudioEnabled || !track || !track.cacheKey || track.offlineReady || track.offlineSaveInProgress || track.offlineSaveTimer) return;
      if (!offlineCacheReadyForSave(track)) {
        track.offlineWanted = true;
        setTrackOfflineState(track, "missing");
        return;
      }
      if (!track.cacheUrl) track.cacheUrl = cleanBase(cfg.apiBase) + "/cache_audio/" + encodeURIComponent(track.cacheKey);
      if (!track.cacheUrl) return;
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
      var keys = trackOfflineKeyCandidates(track);
      revokeOfflineObjectUrl(track);
      if (!keys.length) return true;
      var anyExisted = false;
      for (var i = 0; i < keys.length; i += 1) {
        var key = keys[i];
        var result = await deleteOfflineAudioRecord(key);
        if (!(result && result.ok)) {
          debugLog("⚠️ 删除 Tavo 离线音频失败: " + key + (result && result.error ? "（" + result.error + "）" : ""), "#fc9");
          return false;
        }
        anyExisted = anyExisted || !!result.existed;
        if (result.existed) debugLog("🗑 已删除 Tavo 离线音频: " + key, "#fc9");
      }
      track.offlineUrl = "";
      track.offlineKey = offlineAudioKey(track.cacheKey);
      track.offlineReady = false;
      track.offlineWanted = false;
      setTrackOfflineState(track, cfg.offlineAudioEnabled ? "missing" : "disabled");
      if (!anyExisted) debugLog("🗑 Tavo 离线音频不存在，已确认无需删除: " + keys.join(", "), "#fc9");
      return true;
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
      if (track.preferNativeLive || track.webAudioDeviceFailed) return false;
      if (scriptFlagEnabled("noWebAudioLive")) return false;
      if (scriptFlagEnabled("nativeLive") || scriptFlagEnabled("elementLive") || scriptFlagEnabled("mp3Live")) return false;
      return !!(scriptFlagEnabled("webAudioLive") || scriptFlagEnabled("pcmLive") || scriptFlagEnabled("chunkedLive"));
    }
    function shouldUseMp3AudioForLiveTrack(track, startOffsetSec) {
      if (!(track && track.mode !== "single" && isLiveTrack(track) && track.cacheKey)) return false;
      if (scriptFlagEnabled("noMp3Live")) return false;
      if (scriptFlagEnabled("nativeLive") || scriptFlagEnabled("elementLive")) return false;
      if (scriptFlagEnabled("webAudioLive") || scriptFlagEnabled("pcmLive") || scriptFlagEnabled("chunkedLive")) return false;
      return true;
    }
    function shouldUseSegmentAudioForLiveTrack(track, startOffsetSec) {
      if (!(track && track.mode !== "single" && isLiveTrack(track) && track.cacheKey)) return false;
      if (shouldUseMp3AudioForLiveTrack(track, startOffsetSec)) return false;
      if (scriptFlagEnabled("chunkedLive")) return false;
      return !!(track.preferNativeLive || track.webAudioDeviceFailed || scriptFlagEnabled("nativeLive") || scriptFlagEnabled("elementLive"));
    }
    function shouldUseElementForLiveTrack(track, startOffsetSec) {
      if (!(track && isLiveTrack(track) && liveStreamUrlForTrack(track))) return false;
      if (shouldUseMp3AudioForLiveTrack(track, startOffsetSec)) return false;
      if (shouldUseSegmentAudioForLiveTrack(track, startOffsetSec)) return false;
      startOffsetSec = Math.max(0, Number(startOffsetSec || 0) || 0);
      var forced = !!(track.preferNativeLive || track.webAudioDeviceFailed);
      if (startOffsetSec > 0.01 && !forced) return false;
      return !!(forced || scriptFlagEnabled("nativeLive") || scriptFlagEnabled("elementLive"));
    }
    function isWebAudioDeviceFailureMessage(msg) {
      msg = String(msg || "");
      return /Failed to start the audio device|audio device|AudioContext.*interrupted|interrupted.*AudioContext|\[step:(pcm\.)?schedulePcm\.resume\]/i.test(msg);
    }
    var lastRuntimePageHiddenAt = 0;
    function isRuntimePageHidden() {
      try {
        if (document.hidden) return true;
        var state = String(document.visibilityState || "").toLowerCase();
        return state === "hidden" || state === "prerender";
      } catch (_) {
        return false;
      }
    }
    function parseDisplayedTimeSec(text) {
      text = String(text || "").trim();
      var m = text.match(/^(\d+):([0-5]\d)$/);
      if (!m) return NaN;
      return Math.max(0, Number(m[1] || 0) * 60 + Number(m[2] || 0));
    }
    function rememberLiveResumeSec(track, sec, reason, opts) {
      opts = opts || {};
      if (!track || !isFinite(Number(sec))) return 0;
      sec = clampPlaybackTimeSec(track, Math.max(0, Number(sec) || 0));
      var prev = Math.max(
        0,
        isFinite(Number(track.liveResumeSec)) ? Number(track.liveResumeSec) : 0,
        isFinite(Number(track.lastLiveProgressSec)) ? Number(track.lastLiveProgressSec) : 0,
        isFinite(Number(track.lastWebAudioSec)) ? Number(track.lastWebAudioSec) : 0
      );
      if (!opts.allowBackward && prev > 0 && sec + 1.5 < prev) {
        debugLog("↪️ 忽略回退的 LIVE 断点 " + sec.toFixed(2) + "s，保留 " + prev.toFixed(2) + "s reason=" + (reason || ""), "#fc9");
        sec = prev;
      }
      track.liveResumeSec = sec;
      track.lastLiveProgressSec = sec;
      track.lastWebAudioSec = sec;
      track.lastElementSec = sec;
      return sec;
    }
    function lastKnownLiveResumeSec(track) {
      if (!track) return 0;
      var best = 0;
      function take(v) {
        v = Number(v);
        if (isFinite(v) && v > best) best = v;
      }
      take(track.liveResumeSec);
      take(track.lastLiveProgressSec);
      take(track.lastWebAudioSec);
      take(track.lastElementSec);
      try { if (currentTrack() === track && cur) take(parseDisplayedTimeSec(cur.textContent)); } catch (_) {}
      return clampPlaybackTimeSec(track, best);
    }
    function cancelLiveSegmentAudioQueue(reason) {
      liveSegmentAudioToken++;
      if (liveSegmentAudioTimer) {
        try { clearTimeout(liveSegmentAudioTimer); } catch (_) {}
        liveSegmentAudioTimer = null;
      }
      generatedTracks.forEach(function (t) {
        if (t) t.liveSegmentAudioActive = false;
      });
      if (reason && reason !== "silent") debugLog("⏹ live segment audio 队列停止 reason=" + reason, "#fc9");
    }
    function clearLiveMp3AudioState(track) {
      if (track) {
        track.liveMp3AudioActive = false;
        track.liveMp3StartSec = 0;
      } else {
        generatedTracks.forEach(function (t) {
          if (t) {
            t.liveMp3AudioActive = false;
            t.liveMp3StartSec = 0;
          }
        });
      }
    }
    function startLiveMp3Audio(track, startSec, opts) {
      opts = opts || {};
      if (!track || !track.cacheKey || !shouldUseMp3AudioForLiveTrack(track, startSec)) return false;
      stopWebAudioPlayback("switch");
      cancelLiveSegmentAudioQueue("switch mp3");
      clearElementAudioSrc();
      startSec = Math.max(0, Number(startSec || 0) || 0);
      var url = liveMp3UrlForTrack(track, startSec);
      if (!url) return false;
      track.livePageSuspended = false;
      track.liveMp3AudioActive = true;
      track.liveMp3StartSec = startSec;
      track.liveElementOffsetSec = startSec;
      track.liveEndedAwaitSaved = false;
      track.streamPlaybackFinished = false;
      rememberLiveResumeSec(track, startSec, "live mp3 start", { allowBackward: true });
      track.preferNativeLive = true;
      track.streaming = true;
      track.allowStreamPlay = false;
      track.playSavedWhenReady = false;
      track.pausedByUser = false;
      setTrackStreamHealth(track, "ok");
      setTrackPlaybackState(track, "loading");
      setPlayState("loading");
      setStatus(opts.status || (startSec > 0.01 ? "连接断点 MP3 实时流…" : "连接 MP3 实时流…"));
      showTrackNotice(track, opts.title || "连接 MP3 实时流…", opts.detail || "使用后端 MP3 编码流播放同一个任务，不重新生成");
      if (cur) cur.textContent = formatTime(startSec);
      var hint = trackDurationHintSec(track);
      if (total) total.textContent = hint > 0 ? formatTime(hint) : "--:--";
      if (seek) {
        var meterDur = progressMeterDurationSec(track, startSec);
        seek.disabled = !(canSeekTrackByControls(track) && meterDur > 0);
        seek.value = meterDur > 0 ? String(Math.floor(Math.min(startSec, meterDur) / meterDur * 1000)) : "0";
      }
      markElementAudioTrack(track, "live-mp3", startSec);
      try { audio.preload = "auto"; } catch (_) {}
      if (startSec > 0.01 || (audio.currentSrc || audio.src || "") !== url) {
        audio.src = url;
        try { audio.load(); } catch (_) {}
      }
      setAudioPlaybackRate();
      try {
        if (track.cacheKey && track.mode !== "single") startSubtitle(track, function () { return elementPlaybackTimeSec(track); });
      } catch (_) {}
      debugLog("▶️ LIVE native MP3 stream start_s=" + startSec.toFixed(3) + " cacheKey=" + (track.cacheKey || ""), "#ffd479");
      var p = audio.play();
      if (p && typeof p.then === "function") p.catch(function (err) { handleAudioPlayReject("live-mp3", err, opts.rejectStatus || "请点播放继续实时音频"); });
      pollCacheUpgrade(track, "native mp3 live");
      return true;
    }
    function liveSegmentRowsForTrack(track) {
      var sr = Number((track && (track.sampleRate || track.sample_rate)) || 0);
      return ((track && Array.isArray(track.segments)) ? track.segments : []).map(function (seg, i) {
        var idx = isFinite(Number(seg && seg.idx)) ? Number(seg.idx) : i;
        var start = segmentStartSec(seg, sr);
        var duration = Number((seg && seg.duration_s) || 0) || 0;
        return {
          idx: idx,
          ordinal: i,
          start: isFinite(Number(start)) ? Math.max(0, Number(start) || 0) : 0,
          duration: Math.max(0, duration),
          role: (seg && seg.role) || "",
          text: (seg && seg.text) || ""
        };
      }).filter(function (row) {
        return isFinite(Number(row.idx)) && isFinite(Number(row.start));
      }).sort(function (a, b) {
        return a.start - b.start || a.idx - b.idx;
      }).map(function (row, i) {
        row.ordinal = i;
        return row;
      });
    }
    function liveSegmentOrdinalForStart(track, startSec) {
      var rows = liveSegmentRowsForTrack(track);
      if (!rows.length) return 0;
      startSec = Math.max(0, Number(startSec || 0) || 0);
      for (var i = 0; i < rows.length; i += 1) {
        var row = rows[i];
        var next = rows[i + 1];
        var end = row.duration > 0 ? row.start + row.duration : (next ? next.start : Infinity);
        if (startSec < end - 0.05) return i;
      }
      return rows.length;
    }
    function applyDialogueStatusToTrack(track, payload) {
      if (!track || !payload) return;
      if (payload.metrics) track.metrics = payload.metrics;
      if (payload.sample_rate) track.sampleRate = payload.sample_rate;
      if (payload.duration_s) track.duration_s = payload.duration_s;
      if (payload.cache_url) track.cacheUrl = new URL(payload.cache_url, cleanBase(cfg.apiBase) + "/").href;
      if (Array.isArray(payload.segments_plan) && payload.segments_plan.length) {
        track.segmentPlan = payload.segments_plan.map(function (s, i) {
          return { idx: s.idx != null ? s.idx : i, role: s.role || "", text: s.text || "", style: s.style || "neutral", style_alpha: s.style_alpha };
        });
      }
      if (Array.isArray(payload.segments_meta) && payload.segments_meta.length) {
        var nextSig = payload.segments_meta.map(function (m, i) {
          return [m.idx != null ? m.idx : i, m.role || "", m.text || "", Number(m.start_s || 0).toFixed(3), Number(m.start_offset_bytes || 0), Number(m.duration_s || 0).toFixed(3)].join(":");
        }).join("|");
        if (nextSig && nextSig !== track.segmentsSignature) {
          track.segmentsSignature = nextSig;
          track.segments = payload.segments_meta.map(function (s, i) {
            return { idx: s.idx != null ? s.idx : i, role: s.role || "", text: s.text || "", style: s.style || "neutral", style_alpha: s.style_alpha, start_s: s.start_s, start_offset_bytes: s.start_offset_bytes, duration_s: s.duration_s };
          });
        }
      }
      if (payload.state === "failed") {
        track.error = (payload.metrics && payload.metrics.message ? payload.metrics.message + ": " : "") + (payload.error || "服务端生成失败");
        setTrackState(track, "failed");
      } else if (payload.state === "cancelled") {
        track.error = payload.error || "任务已取消";
        setTrackState(track, "cancelled");
      } else if (payload.state === "done") {
        setTrackServerState(track, "done");
        setTrackCacheState(track, "ready");
        track.cacheReady = true;
      }
    }
    async function fetchDialogueStatusForTrack(track, label) {
      if (!track || !track.cacheKey) return null;
      var res = await fetch(cleanBase(cfg.apiBase) + "/tts_dialogue_job_status/" + encodeURIComponent(track.cacheKey), { cache: "no-store" });
      if (!res.ok) return null;
      var payload = await res.json();
      applyDialogueStatusToTrack(track, payload);
      return payload;
    }
    function playLiveSegmentAudioRow(track, row, startSec, token, opts) {
      opts = opts || {};
      if (!track || !row || token !== liveSegmentAudioToken || currentTrack() !== track || track.deleted || isTerminalTrack(track)) return false;
      var url = liveSegmentAudioUrlForTrack(track, row.idx);
      if (!url) return false;
      var offsetInSegment = Math.max(0, Number(startSec || 0) - Number(row.start || 0));
      track.liveSegmentAudioActive = true;
      track.liveSegmentAudioToken = token;
      track.liveSegmentAudioOrdinal = row.ordinal;
      track.liveSegmentAudioIndex = row.idx;
      track.liveSegmentAudioStartSec = row.start;
      track.preferNativeLive = true;
      track.webAudioDeviceFailed = true;
      track.streaming = true;
      track.allowStreamPlay = false;
      track.pausedByUser = false;
      setTrackStreamHealth(track, "ok");
      setTrackPlaybackState(track, "loading");
      setPlayState("loading");
      setStatus("播放第 " + (row.ordinal + 1) + " 段…");
      if (!hasActiveSubtitleRows(track)) showTrackNotice(track, "播放第 " + (row.ordinal + 1) + " 段…", "使用系统 audio 播放已完成的小段");
      if (seek) { seek.disabled = true; seek.value = "0"; }
      if (cur) cur.textContent = formatTime(row.start || 0);
      markElementAudioTrack(track, "live-segment", row.start || 0);
      try { audio.preload = "auto"; } catch (_) {}
      if ((audio.currentSrc || audio.src || "") !== url) {
        audio.src = url;
        try { audio.load(); } catch (_) {}
      }
      try { audio.dataset.idxSegmentIndex = String(row.idx); } catch (_) {}
      if (offsetInSegment > 0.05) {
        try {
          audio.addEventListener("loadedmetadata", function () {
            try {
              if (isFinite(audio.duration) && audio.duration > 0) offsetInSegment = Math.min(offsetInSegment, Math.max(0, audio.duration - 0.05));
              audio.currentTime = offsetInSegment;
            } catch (_) {}
          }, { once: true });
        } catch (_) {}
      }
      setAudioPlaybackRate();
      debugLog("▶️ LIVE native segment audio idx=" + row.idx + " ordinal=" + (row.ordinal + 1) + " start=" + Number(row.start || 0).toFixed(3) + " offset=" + offsetInSegment.toFixed(3), "#ffd479");
      var p = audio.play();
      if (p && typeof p.then === "function") p.catch(function (err) { handleAudioPlayReject("live-segment", err, opts.rejectStatus || "请点播放继续实时音频"); });
      return true;
    }
    function finishLiveSegmentAudioQueue(track, label) {
      if (!track) return false;
      cancelLiveSegmentAudioQueue("segment finished");
      track.liveSegmentAudioActive = false;
      track.streamPlaybackFinished = true;
      track.streaming = false;
      setTrackPlaybackState(track, "ended");
      setPlayState("idle");
      stopSubtitle();
      if (isSavedTrack(track) || track.cacheReady || track.cacheUrl) {
        setStatus("播放完成，完整音频已就绪");
        showTrackNotice(track, "播放完成", "完整音频已保存，点播放可重播");
      } else {
        setStatus("播放完成，等待完整音频保存");
        showTrackNotice(track, "播放完成", "后台正在整理完整音频");
        pollCacheUpgrade(track, label || "segment audio finished");
      }
      updateTrackButtons();
      return true;
    }
    function startLiveSegmentAudioQueue(track, startSec, opts) {
      opts = opts || {};
      if (!track || !track.cacheKey) return false;
      stopWebAudioPlayback("switch");
      cancelLiveSegmentAudioQueue("replace");
      clearElementAudioSrc();
      var token = ++liveSegmentAudioToken;
      startSec = Math.max(0, Number(startSec || 0) || 0);
      track.liveSegmentAudioActive = true;
      track.liveSegmentAudioToken = token;
      track.liveSegmentAudioOrdinal = isFinite(Number(opts.ordinal)) ? Number(opts.ordinal) : NaN;
      track.preferNativeLive = true;
      track.webAudioDeviceFailed = true;
      track.streaming = true;
      track.allowStreamPlay = false;
      track.playSavedWhenReady = false;
      track.pausedByUser = false;
      setTrackStreamHealth(track, "ok");
      setTrackPlaybackState(track, "loading");
      setPlayState("loading");
      setStatus(opts.status || (startSec > 0.01 ? "等待断点小段…" : "等待首段音频…"));
      showTrackNotice(track, opts.title || "等待首段音频…", opts.detail || "audio 模式会按已完成的小段连续播放");
      function sameRun() {
        return !!(token === liveSegmentAudioToken && currentTrack() === track && track && !track.deleted && !isTerminalTrack(track));
      }
      function schedule(delay) {
        if (!sameRun()) return;
        if (liveSegmentAudioTimer) {
          try { clearTimeout(liveSegmentAudioTimer); } catch (_) {}
        }
        liveSegmentAudioTimer = setTimeout(pump, Math.max(250, Number(delay || 700) || 700));
      }
      async function pump() {
        if (!sameRun()) return false;
        if (track.pausedByUser) {
          setTrackPlaybackState(track, "paused");
          setPlayState("idle");
          return false;
        }
        var payload = null;
        try {
          payload = await fetchDialogueStatusForTrack(track, "live segment audio");
        } catch (e) {
          debugLog("⚠️ live segment 状态轮询失败: " + (e && e.message ? e.message : e), "#fc9");
        }
        if (!sameRun()) return false;
        if (trackState(track) === "failed" || trackState(track) === "cancelled") {
          setPlayState("idle");
          updateTrackButtons();
          return false;
        }
        var rows = liveSegmentRowsForTrack(track);
        var ordinal = isFinite(Number(track.liveSegmentAudioOrdinal)) ? Number(track.liveSegmentAudioOrdinal) : liveSegmentOrdinalForStart(track, startSec);
        if (rows[ordinal]) {
          track.liveSegmentAudioOrdinal = ordinal;
          return playLiveSegmentAudioRow(track, rows[ordinal], startSec, token, opts);
        }
        var done = !!(payload && payload.state === "done");
        if (done && rows.length && ordinal >= rows.length) {
          return finishLiveSegmentAudioQueue(track, "live segment done");
        }
        if (done && !rows.length) {
          debugLog("⚠️ live segment audio 没拿到 segments_meta，改等完整音频 cacheKey=" + (track.cacheKey || ""), "#fc9");
          return waitForSavedLiveTrack(track, "live segment missing meta fallback", {
            resumeSec: trackResumeSec(track),
            title: "等待完整音频…",
            detail: "服务端没有返回可分段播放信息，改用完整音频"
          });
        }
        var metrics = (payload && payload.metrics) || track.metrics || {};
        var total = Number(metrics.segments_total || 0) || (track.segmentPlan && track.segmentPlan.length) || 0;
        var waitingOrdinal = Math.max(0, ordinal);
        var statusText = total ? ("等待第 " + Math.min(total, waitingOrdinal + 1) + "/" + total + " 段音频…") : "等待首段音频…";
        setTrackPlaybackState(track, "buffering");
        setPlayState("loading");
        setStatus(statusText);
        if (!hasActiveSubtitleRows(track)) showTrackNotice(track, statusText, "TTS 服务还在合成，完成一段就会播放一段");
        schedule(650);
        return true;
      }
      pump();
      return true;
    }
    function handleLiveSegmentAudioEnded(track) {
      if (!track || !isElementUsingTrackLiveSegment(track)) return false;
      var rows = liveSegmentRowsForTrack(track);
      var currentIdx = NaN;
      try { currentIdx = Number(audio.dataset.idxSegmentIndex); } catch (_) { currentIdx = NaN; }
      var ordinal = isFinite(Number(track.liveSegmentAudioOrdinal)) ? Number(track.liveSegmentAudioOrdinal) : -1;
      if (isFinite(currentIdx)) {
        for (var i = 0; i < rows.length; i += 1) {
          if (Number(rows[i].idx) === Number(currentIdx)) {
            ordinal = i;
            break;
          }
        }
      }
      var currentRow = rows[ordinal] || null;
      if (currentRow) {
        var endSec = Number(currentRow.start || 0) + Math.max(0, Number(currentRow.duration || 0) || 0);
        rememberLiveResumeSec(track, endSec, "live segment ended");
      }
      track.liveSegmentAudioOrdinal = Math.max(0, ordinal + 1);
      if (rows[track.liveSegmentAudioOrdinal]) {
        return startLiveSegmentAudioQueue(track, rows[track.liveSegmentAudioOrdinal].start || trackResumeSec(track), {
          ordinal: track.liveSegmentAudioOrdinal,
          title: "播放下一段…",
          detail: "继续播放已完成的小段"
        });
      }
      return startLiveSegmentAudioQueue(track, trackResumeSec(track), {
        ordinal: track.liveSegmentAudioOrdinal,
        title: "等待下一段音频…",
        detail: "TTS 服务还在合成，下一段完成后自动播放"
      });
    }
    function liveResumeDebugSnapshot(track) {
      track = track || currentTrack();
      if (!track) return null;
      return {
        cacheKey: track.cacheKey || "",
        state: trackState(track),
        playbackState: String(track.playbackState || ""),
        streamHealth: String(track.streamHealth || ""),
        livePageSuspended: !!track.livePageSuspended,
        pausedByUser: !!track.pausedByUser,
        liveResumeSec: Number(track.liveResumeSec || 0) || 0,
        lastLiveProgressSec: Number(track.lastLiveProgressSec || 0) || 0,
        lastWebAudioSec: Number(track.lastWebAudioSec || 0) || 0,
        lastElementSec: Number(track.lastElementSec || 0) || 0,
        lastStalledSec: Number(track.lastStalledSec || 0) || 0,
        lastKnownLiveResumeSec: lastKnownLiveResumeSec(track),
        trackResumeSec: trackResumeSec(track),
        currentText: cur ? String(cur.textContent || "") : ""
      };
    }
    if (DEBUG_MODE) {
      try {
        window.__indextts_tavo_debug_playback = {
          currentTrack: function () { return liveResumeDebugSnapshot(currentTrack()); },
          patchCurrentTrack: function (patch) {
            var track = currentTrack();
            if (!track) return null;
            patch = patch || {};
            [
              "state", "playbackState", "streamHealth", "streamStalled",
              "livePageSuspended", "pausedByUser", "webAudioPlaying",
              "liveResumeSec", "lastLiveProgressSec", "lastWebAudioSec",
              "lastElementSec", "lastStalledSec"
            ].forEach(function (key) {
              if (Object.prototype.hasOwnProperty.call(patch, key)) track[key] = patch[key];
            });
            if (isFinite(Number(patch.displaySec)) && cur) cur.textContent = formatTime(Math.max(0, Number(patch.displaySec) || 0));
            return liveResumeDebugSnapshot(track);
          }
        };
      } catch (_) {}
    }
    function handleRuntimePageVisibilityChange(reason) {
      var hidden = isRuntimePageHidden();
      if (hidden) {
        lastRuntimePageHiddenAt = Date.now();
        try { window.__indextts_tavo_last_page_hidden_at = lastRuntimePageHiddenAt; } catch (_) {}
        if (reason) debugLog("📱 页面进入后台，不主动暂停 audio reason=" + reason, "#9ff");
      }
      return false;
    }
    function startNativeLiveElementFallback(track, reason, opts) {
      opts = opts || {};
      if (!track || !isLiveTrack(track) || !liveStreamUrlForTrack(track)) return false;
      var resumeSec = opts.resumeSec;
      if (!isFinite(Number(resumeSec))) resumeSec = trackResumeSec(track);
      resumeSec = rememberLiveResumeSec(track, Math.max(0, Number(resumeSec) || 0), reason || "native live fallback");
      track.preferNativeLive = true;
      track.webAudioDeviceFailed = true;
      track.streaming = true;
      track.allowStreamPlay = false;
      track.pausedByUser = false;
      setTrackStreamHealth(track, "ok");
      setTrackPlaybackState(track, "loading");
      setPlayState("loading");
      stopWebAudioPlayback("switch");
      clearElementAudioSrc();
      if (shouldUseSegmentAudioForLiveTrack(track, resumeSec)) {
        debugLog("↪️ WebAudio 输出链路不可用，切同 key native segment audio reason=" + (reason || "") + " cacheKey=" + (track.cacheKey || "") + " start=" + resumeSec.toFixed(2), "#ffd479");
        return startLiveSegmentAudioQueue(track, resumeSec, {
          status: opts.status || "切换实时音频通道…",
          title: opts.title || "切换实时音频通道…",
          detail: opts.detail || "按已完成的小段继续播放，不重新生成",
          rejectStatus: opts.rejectStatus || "点播放继续实时音频"
        });
      }
      if (shouldUseMp3AudioForLiveTrack(track, resumeSec)) {
        debugLog("↪️ WebAudio 输出链路不可用，切同 key native MP3 reason=" + (reason || "") + " cacheKey=" + (track.cacheKey || "") + " start=" + resumeSec.toFixed(2), "#ffd479");
        return startLiveMp3Audio(track, resumeSec, {
          status: opts.status || "切换 MP3 实时流…",
          title: opts.title || "切换 MP3 实时流…",
          detail: opts.detail || "继续播放同一个 MP3 实时流，不重新生成",
          rejectStatus: opts.rejectStatus || "点播放继续实时音频"
        });
      }
      debugLog("↪️ WebAudio 输出链路不可用，切同 key native live audio reason=" + (reason || "") + " cacheKey=" + (track.cacheKey || "") + " start=" + resumeSec.toFixed(2), "#ffd479");
      return startElementAudioFrom(track, resumeSec, {
        forceLiveElement: true,
        label: "native-live",
        status: opts.status || "切换实时音频通道…",
        title: opts.title || "切换实时音频通道…",
        detail: opts.detail || "继续播放同一个实时流，不重新生成",
        rejectStatus: opts.rejectStatus || "点播放继续实时音频"
      });
    }
    function waitForSavedLiveTrack(track, label, opts) {
      opts = opts || {};
      if (!track || !track.cacheKey) return false;
      stopWebAudioPlayback("replace");
      clearElementAudioSrc();
      if (isSavedTrack(track)) {
        track.playSavedWhenReady = opts.autoplaySaved !== false;
        attachCacheAudio(track, {
          forceElement: track.playSavedWhenReady,
          autoplay: track.playSavedWhenReady
        });
        return true;
      }
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
    function markLiveStreamResumable(track, reason, title, detail) {
      if (!track || !track.cacheKey) return false;
      var resumeSec = track.livePageSuspended ? lastKnownLiveResumeSec(track) : trackResumeSec(track);
      resumeSec = rememberLiveResumeSec(track, resumeSec, reason || "live resumable");
      webAudioPlayToken++;
      try {
        if (webAudioBelongsToTrack(track) && typeof webAudioController.stop === "function") webAudioController.stop("播放已停止: " + (reason || "live resumable"));
      } catch (_) {}
      if (webAudioActiveTrack === track) {
        webAudioController = null;
        webAudioActiveTrack = null;
      }
      clearWebAudioProgressTimer();
      markWebAudioStopped(track);
      stopSubtitle();
      clearElementAudioSrc();
      track.streaming = true;
      track.allowStreamPlay = false;
      track.playSavedWhenReady = false;
      track.streamTooSlowFallback = false;
      track.pausedByUser = false;
      setTrackStreamHealth(track, "stalled");
      setTrackPlaybackState(track, "idle");
      setPlayState("idle");
      setStatus(title || "实时音频可重试");
      if (!hasActiveSubtitleRows(track)) showTrackNotice(track, title || "实时音频可重试", detail || "后台仍会自动落盘；点播放可再次请求同一个实时流");
      pollCacheUpgrade(track, reason || "live resumable");
      updateTrackButtons();
      if (messageId) saveTracksForMessage(messageId, generatedTracks).catch(function(){});
      debugLog("↪️ LIVE 连接可重试，保留同 key reason=" + (reason || "") + " cacheKey=" + track.cacheKey + " resume=" + resumeSec.toFixed(2), "#fc9");
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
      if (track && normalizePlaybackMode(track.playbackMode) === "generate") return "等待合成";
      return "等待音频";
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
        else if ((isElementUsingTrackStream(track) || isElementUsingTrackLiveSegment(track) || isElementUsingTrackLiveMp3(track)) && isFinite(Number(audio.currentTime))) resumeSec = elementPlaybackTimeSec(track);
        else if (track.lastElementSec != null) resumeSec = Number(track.lastElementSec) || 0;
      } catch (_) { resumeSec = 0; }
      await prepareOfflineAudio(track, "switch saved", { saveMissing: true });
      stopWebAudioPlayback("switch");
      startElementAudioFrom(track, resumeSec);
    }
    function isNetworkStreamError(err) {
      var msg = String((err && err.message) || err || "");
      if (/\[step:fetch\]\s+HTTP\s+\d+/i.test(msg)) return false;
      return /\[step:(pcm\.fetch|fetch|reader\.read|reader\.read\.loop)\]|Load failed|Failed to fetch|NetworkError|network/i.test(msg);
    }
    function webAudioTrackKey(track) {
      return String((track && (track.cacheKey || track.streamUrl || track.url)) || "").trim();
    }
    function webAudioControllerKey() {
      try { return String((webAudioController && (webAudioController.cacheKey || webAudioController.streamUrl)) || "").trim(); }
      catch (_) { return ""; }
    }
    function webAudioBelongsToTrack(track) {
      if (!track || !webAudioController || webAudioActiveTrack !== track) return false;
      var tk = webAudioTrackKey(track);
      var ck = webAudioControllerKey();
      return !!(tk && ck && tk === ck);
    }
    function markWebAudioStopped(track) {
      generatedTracks.forEach(function (t) {
        if (t) {
          t.webAudioPlaying = false;
          t.webAudioStable = false;
          t.webAudioBufferStable = false;
          t.webAudioCacheKey = "";
          t.webAudioPausedLocal = false;
        }
      });
      if (track) {
        track.webAudioPlaying = false;
        track.webAudioStable = false;
        track.webAudioBufferStable = false;
        track.webAudioCacheKey = "";
        track.webAudioPausedLocal = false;
      }
    }
    function webAudioPlaybackSecForTrack(track) {
      var sec = NaN;
      try {
        if (webAudioBelongsToTrack(track) && typeof webAudioController.getTimeSec === "function") {
          sec = Number(webAudioController.getTimeSec());
        }
      } catch (_) { sec = NaN; }
      var best = isFinite(sec) ? Math.max(0, sec) : 0;
      function take(v) {
        v = Number(v);
        if (isFinite(v) && v > best) best = v;
      }
      if (track) {
        take(track.liveResumeSec);
        take(track.lastLiveProgressSec);
        take(track.lastWebAudioSec);
        take(track.lastElementSec);
        if (!(best > 0)) take(track.lastStalledSec);
      }
      return Math.max(0, isFinite(best) ? best : 0);
    }
    function canResumePausedWebAudioTrack(track) {
      return !!(
        track
        && webAudioBelongsToTrack(track)
        && webAudioController
        && typeof webAudioController.resume === "function"
        && (track.webAudioPausedLocal || (typeof webAudioController.isPaused === "function" && webAudioController.isPaused()))
      );
    }
    function pauseWebAudioTrackLocally(track) {
      if (!track || !webAudioBelongsToTrack(track) || !(webAudioController && typeof webAudioController.pause === "function")) return false;
      var sec = webAudioPlaybackSecForTrack(track);
      sec = rememberLiveResumeSec(track, sec, "user pause");
      track.pausedByUser = true;
      track.webAudioPausedLocal = true;
      track.webAudioPlaying = false;
      track.webAudioStable = false;
      setTrackPlaybackState(track, "paused");
      clearWebAudioProgressTimer();
      stopSubtitle();
      try {
        var p = webAudioController.pause("user pause");
        if (p && typeof p.catch === "function") p.catch(function (e) {
          debugLog("⚠️ WebAudio 本地暂停失败，保留断点: " + (e && e.message ? e.message : e), "#fc9");
        });
      } catch (e) {
        debugLog("⚠️ WebAudio 本地暂停异常，保留断点: " + (e && e.message ? e.message : e), "#fc9");
      }
      setPlayState("idle");
      setStatus("已暂停");
      showTrackNotice(track, "已暂停", "继续缓冲中，点播放直接接着播");
      debugLog("⏸️ WebAudio 本地暂停 @ " + sec.toFixed(2) + "s", "#9ff");
      return true;
    }
    function resumePausedWebAudioTrack(track) {
      if (!canResumePausedWebAudioTrack(track)) return false;
      track.pausedByUser = false;
      track.webAudioPausedLocal = false;
      track.webAudioPlaying = true;
      setTrackPlaybackState(track, "playing");
      setPlayState("playing");
      setStatus(trackPlaybackLabel(track));
      var token = (webAudioController && webAudioController.token) || webAudioPlayToken;
      var playbackRate = clampNumber(cfg.speedFactor || 1.0, 1.0, 0.85, 1.25);
      startWebAudioProgress(token, (typeof performance !== "undefined" ? performance.now() : Date.now()), playbackRate, track, trackResumeSec(track));
      startSubtitle(track, function () {
        if (webAudioController && typeof webAudioController.getTimeSec === "function") return webAudioController.getTimeSec();
        return trackResumeSec(track);
      });
      try {
        var p = webAudioController.resume("user resume");
        if (p && typeof p.catch === "function") p.catch(function (e) {
          debugLog("⚠️ WebAudio 本地恢复失败，转回断点重连: " + (e && e.message ? e.message : e), "#fc9");
          track.webAudioPausedLocal = false;
          track.webAudioPlaying = false;
          stopWebAudioPlayback("pause resume failed");
          playLiveTrack(track, liveStreamUrlForTrack(track), { startOffsetSec: trackResumeSec(track), noticeTitle: "连接断点音频…", noticeDetail: "本地恢复失败，改用同一个实时流" }).catch(function () {});
        });
      } catch (e) {
        debugLog("⚠️ WebAudio 本地恢复异常，转回断点重连: " + (e && e.message ? e.message : e), "#fc9");
        track.webAudioPausedLocal = false;
        track.webAudioPlaying = false;
        stopWebAudioPlayback("pause resume failed");
        playLiveTrack(track, liveStreamUrlForTrack(track), { startOffsetSec: trackResumeSec(track), noticeTitle: "连接断点音频…", noticeDetail: "本地恢复失败，改用同一个实时流" }).catch(function () {});
        return true;
      }
      updateTrackButtons();
      debugLog("▶️ WebAudio 本地恢复，不重新请求后端", "#9f9");
      return true;
    }
    function stopWebAudioPlayback(reason) {
      webAudioPlayToken++;
      var activeTrack = webAudioActiveTrack || currentTrack();
      if (activeTrack && webAudioBelongsToTrack(activeTrack) && typeof webAudioController.getTimeSec === "function") {
        try {
          var sec = Math.max(0, Number(webAudioController.getTimeSec()) || 0);
          rememberLiveResumeSec(activeTrack, sec, reason || "stop webaudio");
        } catch (_) {}
      }
      if (webAudioController && typeof webAudioController.stop === "function") {
        try { webAudioController.stop(reason || "停止播放"); } catch (_) {}
      }
      webAudioController = null;
      webAudioActiveTrack = null;
      clearWebAudioProgressTimer();
      markWebAudioStopped(activeTrack);
      if (activeTrack && reason === "pause") setTrackPlaybackState(activeTrack, "paused");
      stopSubtitle();
      if (reason && reason !== "switch" && reason !== "replace" && reason !== "silent" && reason !== "handoff") {
        setPlayState("idle");
        setStatus(reason === "pause" ? "已暂停" : "播放已停止");
      }
    }
    function startWebAudioProgress(token, startedAt, playbackRate, track, fallbackOffsetSec) {
      fallbackOffsetSec = Math.max(0, Number(fallbackOffsetSec || 0) || 0);
      clearWebAudioProgressTimer();
      webAudioProgressTimer = setInterval(function () {
        if (token !== webAudioPlayToken) { clearWebAudioProgressTimer(); return; }
        if (!webAudioBelongsToTrack(track)) { clearWebAudioProgressTimer(); return; }
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
        var durHint = progressDurationSec(track, sec);
        var meterDur = progressMeterDurationSec(track, sec);
        if (total) total.textContent = durHint > 0 ? formatTime(durHint) : "--:--";
        if (seek) {
          seekProgrammaticUpdate = true;
          seek.disabled = !(canSeekTrackByControls(track) && meterDur > 0);
          seek.value = meterDur > 0 ? String(Math.floor(Math.min(sec, meterDur) / meterDur * 1000)) : "0";
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
        if (track) rememberLiveResumeSec(track, sec, "progress");
        try {
          if (track && track.latestSynthesisStatusText && Date.now() - Number(track.lastPlaybackSegmentStatusAt || 0) > 1000) {
            var base = String(track.latestSynthesisStatusText || "");
            if (/已生成\s*\d+\s*\/\s*\d+\s*段|合成(?:第)?\s*\d+\s*\/\s*\d+(?:\s*段)?|音频合成中|音频已合成|正在保存|保存中/.test(base)) {
              var segText = typeof playbackSegmentStatusTextForTrack === "function" ? playbackSegmentStatusTextForTrack(track, null, 0, sec) : "";
              if (segText) {
                track.lastPlaybackSegmentStatusAt = Date.now();
                setStatus(base + " · " + segText);
              }
            }
          }
        } catch (_) {}
      }, 250);
    }
    async function playTrackViaWebAudio(track, url, opts) {
      opts = opts || {};
      if (!track || !url) return false;
      stopWebAudioPlayback("replace");
      webAudioActiveTrack = track;
      var token = ++webAudioPlayToken;
      var playbackRate = clampNumber(cfg.speedFactor || 1.0, 1.0, 0.85, 1.25);
      var startOffsetSec = Math.max(0, Number(opts.startOffsetSec || 0) || 0);
      var playbackUrl = liveStreamPlaybackUrlForTrack(track, startOffsetSec) || url;
      var playCardKey = webAudioTrackKey(track) || playbackUrl;
      var recoveryAttempt = Math.max(0, Number(opts.recoveryAttempt || 0) || 0);
      var maxRecoveryAttempts = Math.max(0, Number(opts.maxRecoveryAttempts == null ? 3 : opts.maxRecoveryAttempts) || 0);
      var defaultPrebufferSec = normalizeModeName(track.mode || track.parseMode || cfg.mode) === "ai" ? 2.35 : 2.05;
      var prebufferSec = Math.max(1.25, Math.min(4.0, Number(opts.prebufferSec || (recoveryAttempt ? (2.25 + recoveryAttempt * 0.75) : defaultPrebufferSec)) || defaultPrebufferSec));
      var flushSec = Math.max(0.45, Math.min(1.0, Number(opts.flushSec || (normalizeModeName(track.mode || track.parseMode || cfg.mode) === "ai" ? 0.72 : 0.65)) || 0.65));
      var startedAt = 0;
      var waitStartedAt = Date.now();
      var waitTimer = null;
      var firstAudioTimedOut = false;
      var streamTooSlowFallback = false;
      var sameJobRecoveryScheduled = false;
      function sameWebAudioRun() {
        return !!(
          token === webAudioPlayToken
          && currentTrack() === track
          && track
          && !track.deleted
          && webAudioTrackKey(track) === playCardKey
        );
      }
      function waitForSameJobSavedFallback(reason, title, detail) {
        if (!track.cacheKey || streamTooSlowFallback) return false;
        streamTooSlowFallback = true;
        track.playSavedWhenReady = true;
        track.pausedByUser = false;
        debugLog("⚠️ LIVE 同任务最终兜底：等待完整音频 reason=" + reason + " cacheKey=" + track.cacheKey, "#fc9");
        return waitForSavedLiveTrack(track, reason || "web audio sound compensation", {
          resumeSec: trackResumeSec(track),
          autoplaySaved: true,
          status: "等待完整音频…",
          title: title || "等待完整音频…",
          detail: detail || "流式多次恢复失败，完整音频保存后会自动播放"
        });
      }
      function stopWaitTimer() {
        if (waitTimer) { try { clearInterval(waitTimer); } catch (_) {} waitTimer = null; }
      }
      function webAudioShouldYieldToTrackState() {
        if (!sameWebAudioRun()) return true;
        var st = trackState(track);
        return !!(track.deleted || st === "failed" || st === "cancelled" || (st === "saved" && !track.webAudioPlaying));
      }
      function scheduleSameJobRecovery(reason) {
        if (!track.cacheKey || sameJobRecoveryScheduled || streamTooSlowFallback) return false;
        if (recoveryAttempt >= maxRecoveryAttempts) {
          return waitForSameJobSavedFallback(reason, "等待完整音频…", "流式多次恢复失败，完整音频保存后会自动播放");
        }
        sameJobRecoveryScheduled = true;
        stopWaitTimer();
        clearWebAudioProgressTimer();
        stopSubtitle();
        track.webAudioRecoveries = Number(track.webAudioRecoveries || 0) + 1;
        track.webAudioPlaying = false;
        track.webAudioStable = false;
        setTrackStreamHealth(track, "stalled");
        setTrackPlaybackState(track, "buffering");
        setPlayState("loading");
        setStatus("实时音频重连中…");
        if (!hasActiveSubtitleRows(track)) showTrackNotice(track, "实时音频重连中…", "继续读取同一个后端缓存流，不会重新生成");
        var resumeSec = 0;
        try { resumeSec = Math.max(0, trackResumeSec(track) - 0.25); } catch (_) { resumeSec = 0; }
        var nextPrebuffer = Math.min(4.0, Math.max(prebufferSec + 0.75, 2.0));
        debugLog("🔁 Web Audio 同任务补偿重连 attempt=" + (recoveryAttempt + 1) + "/" + maxRecoveryAttempts + " prebuffer=" + nextPrebuffer.toFixed(2) + "s reason=" + reason + " cacheKey=" + track.cacheKey, "#ffd479");
        if (webAudioBelongsToTrack(track) && typeof webAudioController.stop === "function") {
          try { webAudioController.stop("same job recovery"); } catch (_) {}
        }
        setTimeout(function () {
          if (!sameWebAudioRun() || track.deleted || isTerminalTrack(track) || isSavedTrack(track)) return;
          var nextUrl = liveStreamUrlForTrack(track) || url;
          playTrackViaWebAudio(track, nextUrl, {
            noticeTitle: "实时音频重连中…",
            noticeDetail: "继续读取同一个后端缓存流",
            waitDetail: "等待后端缓存流",
            startOffsetSec: resumeSec,
            recoveryAttempt: recoveryAttempt + 1,
            maxRecoveryAttempts: maxRecoveryAttempts,
            prebufferSec: nextPrebuffer
          }).catch(function (e) {
            debugLog("❌ Web Audio 补偿重连异常: " + (e && e.message ? e.message : e), "#f99");
          });
        }, 180);
        return true;
      }
      track.webAudioPlaying = false;
      track.webAudioStable = false;
      track.webAudioBufferStable = false;
      track.webAudioPausedLocal = false;
      track.webAudioCacheKey = playCardKey;
      track.webAudioStartedAtMs = 0;
      setTrackStreamHealth(track, "ok");
      if (!recoveryAttempt) track.stalledCount = 0;
      track.currentWebAudioAttempt = recoveryAttempt;
      clearElementAudioSrc();
      if (seek) { seek.disabled = true; seek.value = "0"; }
      if (cur) cur.textContent = formatTime(startOffsetSec);
      if (total) total.textContent = "--:--";
      setError("");
      setTrackPlaybackState(track, "loading");
      setPlayState("loading");
      setStatus(opts.connectingStatus || "正在连接音频…");
      showTrackNotice(track, opts.noticeTitle || "正在连接音频…", opts.noticeDetail || "等待后端返回声音");
      debugLog("▶️ Web Audio 连接 cacheKey=" + (track.cacheKey || "") + " cardKey=" + playCardKey + " attempt=" + recoveryAttempt + " prebuffer=" + prebufferSec.toFixed(2) + "s flush=" + flushSec.toFixed(2) + "s start=" + startOffsetSec.toFixed(2) + "s", "#9ff");
      waitTimer = setInterval(function () {
        if (!sameWebAudioRun()) { stopWaitTimer(); return; }
        if (webAudioShouldYieldToTrackState()) { stopWaitTimer(); return; }
        if (track.webAudioPlaying) return;
        var sec = Math.max(1, Math.floor((Date.now() - waitStartedAt) / 1000));
        if (sec >= 30) {
          if (!firstAudioTimedOut) {
            firstAudioTimedOut = true;
            debugLog("⏳ LIVE 首段 PCM 等待超过 30s，继续等待 same-key live buffer cacheKey=" + (track.cacheKey || ""), "#fc9");
          }
          setTrackStreamHealth(track, "ok");
        }
        if (!track.latestSynthesisStatusText && sec >= 3) setStatus("等待音频");
      }, 1000);
      try {
        var webAudioHooks = {
          playbackRate: playbackRate,
          onController: function (controller) {
            if (controller) {
              try {
                controller.cacheKey = playCardKey;
                controller.messageId = messageId;
                controller.token = token;
                controller.streamUrl = playbackUrl;
              } catch (_) {}
            }
            if (sameWebAudioRun()) {
              webAudioController = controller;
              webAudioActiveTrack = track;
            } else if (controller && typeof controller.stop === "function") {
              try { controller.stop("stale card controller"); } catch (_) {}
            }
          },
          onStateChange: function (state) {
            if (!sameWebAudioRun()) return;
            if (webAudioShouldYieldToTrackState()) {
              if (state !== "stopped") debugLog("↪️ 忽略 Web Audio 状态 " + state + "：任务状态已是 " + trackState(track), "#fc9");
              return;
            }
            if (state === "connecting") {
              setTrackPlaybackState(track, "loading");
              setStatus("正在连接音频…");
              if (!hasActiveSubtitleRows(track)) showTrackNotice(track, "正在连接音频…", "弱网下可能需要多等几秒");
            } else if (state === "connected" || state === "waiting_pcm") {
              setTrackPlaybackState(track, "loading");
              setStatus("等待音频…");
              if (!hasActiveSubtitleRows(track)) showTrackNotice(track, "等待音频…", opts.waitDetail || "后端合成中");
            } else if (state === "first_pcm") {
              setTrackPlaybackState(track, "buffering");
              setStatus("收到音频，正在缓冲…");
              if (!hasActiveSubtitleRows(track)) showTrackNotice(track, "收到音频", "缓冲一小段后起播");
            } else if (state === "scheduled") {
              setTrackPlaybackState(track, "buffering");
              setStatus("收到音频，准备播放…");
              if (!hasActiveSubtitleRows(track)) showTrackNotice(track, "收到音频", "准备播放");
            } else if (state === "audio_suspended") {
              stopWaitTimer();
              if (scheduleSameJobRecovery("audio_suspended")) return;
            } else if (state === "playing") {
              stopWaitTimer();
              webAudioActiveTrack = track;
              track.livePageSuspended = false;
              track.webAudioPlaying = true;
              track.webAudioStable = false;
              track.webAudioBufferStable = false;
              track.webAudioCacheKey = playCardKey;
              setTrackPlaybackState(track, "playing");
              setPlayState("playing");
              setStatus(trackPlaybackLabel(track));
              setError("");
              debugLog("▶️ Web Audio 首块音频开始播放", "#9f9");
              startedAt = (typeof performance !== "undefined" ? performance.now() : Date.now());
              track.webAudioStartedAtMs = Date.now();
              startWebAudioProgress(token, startedAt, playbackRate, track, startOffsetSec);
              startSubtitle(track, function () {
                if (webAudioController && typeof webAudioController.getTimeSec === "function") return webAudioController.getTimeSec();
                return startOffsetSec + ((((typeof performance !== "undefined" ? performance.now() : Date.now()) - startedAt) / 1000) * playbackRate);
              });
              try {
                if (track.latestSynthesisStatusText) {
                  var playingSegText = typeof playbackSegmentStatusTextForTrack === "function" ? playbackSegmentStatusTextForTrack(track, null, 0, startOffsetSec) : "";
                  if (playingSegText) {
                    track.lastPlaybackSegmentStatusAt = Date.now();
                    setStatus(String(track.latestSynthesisStatusText || "") + " · " + playingSegText);
                  }
                }
              } catch (_) {}
            } else if (state === "stable_playing") {
              track.webAudioStable = true;
              track.webAudioBufferStable = true;
              track.stalledCount = 0;
              setTrackStreamHealth(track, "ok");
              setTrackPlaybackState(track, "playing");
              setPlayState("playing");
              setStatus(trackPlaybackLabel(track));
              debugLog("✅ Web Audio live buffer 已排队 cacheKey=" + (track.cacheKey || ""), "#9f9");
            } else if (state === "buffering") {
              track.savePromptWanted = true;
              track.stalledCount = Number(track.stalledCount || 0) + 1;
              track.lastStalledAt = Date.now();
              track.lastStalledSec = trackResumeSec(track);
              setTrackStreamHealth(track, "stalled");
              debugLog("⚠️ Web Audio buffering count=" + track.stalledCount, "#fc9");
              var earlyMs = startedAt ? (((typeof performance !== "undefined" ? performance.now() : Date.now()) - startedAt) || 0) : 0;
              if (track.webAudioPlaying) {
                setTrackPlaybackState(track, "playing");
                setPlayState("playing");
                setStatus(trackPlaybackLabel(track));
                return;
              }
              setTrackPlaybackState(track, "buffering");
              setPlayState("loading");
              setStatus("网络缓冲中…");
              var earlyStall = !!(startedAt && earlyMs >= 3500 && earlyMs < 10000 && !track.webAudioStable && track.stalledCount >= 4);
              if (earlyStall && scheduleSameJobRecovery("early_stall_" + Math.round(earlyMs) + "ms")) return;
            } else if (state === "resumed") {
              setTrackPlaybackState(track, "playing");
              setPlayState("playing");
              setStatus(trackPlaybackLabel(track));
            } else if (state === "interrupted") {
              stopWaitTimer();
              if (scheduleSameJobRecovery("stream_interrupted")) return;
              setTrackStreamHealth(track, "interrupted");
              markWebAudioStopped(track);
              webAudioController = null;
              clearWebAudioProgressTimer();
              stopSubtitle();
              setTrackPlaybackState(track, "error");
              setPlayState("idle");
              setStatus("流式中断，点播放从断点继续");
              if (!hasActiveSubtitleRows(track)) showTrackNotice(track, "流式中断", "后台仍在合成；点播放从断点继续，完成后转为可拖动音频");
            } else if (state === "stopped") {
              stopWaitTimer();
              if (sameJobRecoveryScheduled || streamTooSlowFallback) return;
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
                setStatus("网络中断，点播放继续");
                if (!hasActiveSubtitleRows(track)) showTrackNotice(track, "网络中断", "后台仍在生成；点播放继续同一个实时流");
              } else {
                var saved = shouldUseElementForSavedTrack(track);
                setStatus(saved ? "播放完成，完整音频已就绪" : "播放完成，后台整理完整音频");
                showTrackNotice(track, "播放完成", saved ? "点播放可重播" : "正在后台整理完整音频");
              }
            }
          },
          onError: function (e) { debugLog("❌ Web Audio 错误: " + (e && e.message ? e.message : e), "#f99"); },
          debug: function (text) { debugLog("[wa] " + text, "#9ff"); },
          startOffsetSec: startOffsetSec,
          ownerMessageId: messageId,
          ownerCacheKey: playCardKey,
          skipOffsetSec: 0,
          prebufferSec: prebufferSec,
          flushSec: flushSec
        };
        var pcmPollUrl = livePcmUrlForTrack(track);
        var preferPcmPoll = !!(pcmPollUrl && typeof streamLivePcmViaWebAudio === "function" && !scriptFlagEnabled("chunkedLive"));
        if (preferPcmPoll) {
          try {
            debugLog("▶️ LIVE WebAudio 使用 same-key PCM polling cacheKey=" + (track.cacheKey || ""), "#9ff");
            await streamLivePcmViaWebAudio(pcmPollUrl, webAudioHooks);
          } catch (pcmErr) {
            var pcmMsg = String((pcmErr && pcmErr.message) || pcmErr || "");
            if (/\[step:pcm\.fetch\]\s+HTTP\s+(404|405|501)\b/i.test(pcmMsg)) {
              debugLog("⚠️ LIVE PCM polling 接口不可用，回退 chunked WAV: " + pcmMsg, "#fc9");
              await streamWavViaWebAudio(playbackUrl, webAudioHooks);
            } else {
              throw pcmErr;
            }
          }
        } else {
          await streamWavViaWebAudio(playbackUrl, webAudioHooks);
        }
        return true;
      } catch (e) {
        stopWaitTimer();
        if (!sameWebAudioRun()) return false;
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
          pollCacheUpgrade(track, "slow stream fallback");
          return false;
        }
        if (firstAudioTimedOut) {
          setTrackPlaybackState(track, "buffering");
          setPlayState("loading");
          return false;
        }
        if (sameJobRecoveryScheduled) {
          setTrackPlaybackState(track, "buffering");
          setPlayState("loading");
          return false;
        }
        if ((e && e.name === "AbortError") || /播放已停止|停止播放/i.test(msg)) {
          setTrackPlaybackState(track, "idle");
          setPlayState("idle");
          return false;
        }
        if (track.cacheKey && isWebAudioDeviceFailureMessage(msg)) {
          startNativeLiveElementFallback(track, "web_audio_device_failed", {
            resumeSec: trackResumeSec(track),
            title: "切换实时音频通道…",
            detail: "WebAudio 设备没有放行，改用同一个实时流"
          });
          return false;
        }
        if (isNetworkStreamError(e) && track.cacheKey) {
          if (scheduleSameJobRecovery("network_error")) return false;
          waitForSameJobSavedFallback("network_error", "等待完整音频…", "流式连接中断，完整音频保存后会自动播放");
          return false;
        }
        if (track.cacheKey && (/\[step:fetch\]\s+HTTP\s+5\d\d/i.test(msg) || /decodeAudioData|WAV|wavHeader|data 段|不支持|not supported|noAudio/i.test(msg))) {
          debugLog("⚠️ 实时流暂不可用，保留同 key 可重试: " + msg, "#fc9");
          markLiveStreamResumable(track, "web audio stream unavailable", "实时音频可重试", "后台仍会自动落盘；点播放可再次请求同一个实时流");
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
      var startOffsetSec = Math.max(0, Number(opts.startOffsetSec || 0) || 0);
      track.livePageSuspended = false;
      if (isSavedTrack(track) && trackPlayableUrl(track)) {
        setPlayState("loading");
        return Promise.resolve(startElementAudioFrom(track, startOffsetSec));
      }
      if (shouldUseWebAudioForLiveTrack(track)) return playTrackViaWebAudio(track, url, opts);
      if (shouldUseMp3AudioForLiveTrack(track, startOffsetSec)) {
        return Promise.resolve(startLiveMp3Audio(track, startOffsetSec, {
          status: opts.noticeTitle || (startOffsetSec > 0 ? "从断点连接 MP3…" : "连接 MP3 实时流…"),
          title: opts.noticeTitle || (startOffsetSec > 0 ? "从断点连接 MP3…" : "连接 MP3 实时流…"),
          detail: opts.noticeDetail || "使用后端 MP3 编码流播放同一个任务"
        }));
      }
      if (shouldUseSegmentAudioForLiveTrack(track, startOffsetSec)) {
        pollCacheUpgrade(track, "native segment live");
        return Promise.resolve(startLiveSegmentAudioQueue(track, startOffsetSec, {
          status: opts.noticeTitle || (startOffsetSec > 0 ? "从断点等待小段…" : "等待首段音频…"),
          title: opts.noticeTitle || (startOffsetSec > 0 ? "从断点等待小段…" : "等待首段音频…"),
          detail: opts.noticeDetail || "audio 模式会按已完成的小段连续播放"
        }));
      }
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
