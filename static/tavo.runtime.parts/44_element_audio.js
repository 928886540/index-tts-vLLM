// IndexTTS Tavo runtime part: 44_element_audio.js // Role: native element audio controls // This fragment is concatenated by static/tavo.runtime.js; it is not a standalone script.
    function startElementAudioFrom(track, startSec, opts) {
      opts = opts || {};
      if (!track || !trackPlayableUrl(track)) return false;
      var forceLiveElement = !!opts.forceLiveElement;
      if (!forceLiveElement && shouldUseMp3AudioForLiveTrack(track, startSec)) {
        return startLiveMp3Audio(track, startSec, {
          status: opts.status || "连接 MP3 实时流…",
          title: opts.title || "连接 MP3 实时流…",
          detail: opts.detail || "使用后端 MP3 编码流播放同一个任务",
          rejectStatus: opts.rejectStatus
        });
      }
      if (!forceLiveElement && shouldUseSegmentAudioForLiveTrack(track, startSec)) {
        return startLiveSegmentAudioQueue(track, startSec, {
          status: opts.status || "等待首段音频…",
          title: opts.title || "等待首段音频…",
          detail: opts.detail || "audio 模式会按已完成的小段连续播放",
          rejectStatus: opts.rejectStatus
        });
      }
      if (!isSavedTrack(track) && isLiveTrack(track) && liveStreamUrlForTrack(track) && !forceLiveElement && !shouldUseElementForLiveTrack(track, startSec)) {
        return waitForSavedLiveTrack(track, "element live cache fallback", {
          resumeSec: startSec,
          title: "等待完整音频…",
          detail: "当前 WebView 不直接播放实时音频，生成完成后切到完整音频"
        });
      }
      stopWebAudioPlayback("switch");
      var url = trackPlayableUrl(track);
      var sourceKind = isSavedTrack(track) ? savedSourceKindForUrl(track, url) : (url === track.streamUrl ? "stream" : "audio");
      var liveOffsetSec = 0;
      if (!isSavedTrack(track) && isLiveTrack(track) && liveStreamUrlForTrack(track)) {
        liveOffsetSec = Math.max(0, Number(startSec || 0) || 0);
        url = liveStreamPlaybackUrlForTrack(track, liveOffsetSec);
        sourceKind = "stream";
        track.liveElementOffsetSec = liveOffsetSec;
        track.preferNativeLive = true;
        try { audio.preload = "auto"; } catch (_) {}
      } else {
        track.liveElementOffsetSec = 0;
        try { audio.preload = isSavedTrack(track) ? "metadata" : "none"; } catch (_) {}
      }
      if ((audio.currentSrc || audio.src || "") !== url) {
        suppressElementPauseState(350);
        audio.src = url;
        try { audio.load(); } catch (_) {}
      }
      markElementAudioTrack(track, sourceKind, liveOffsetSec);
      setAudioPlaybackRate();
      if (seek) seek.disabled = sourceKind === "stream";
      if (startSec != null && isFinite(Number(startSec))) {
        var target = Math.max(0, Number(startSec));
        var seekApplied = false;
        var applySeek = function () {
          if (isFinite(audio.duration) && audio.duration > 0) target = Math.min(target, Math.max(0, audio.duration - 0.05));
          audio.currentTime = target;
          seekApplied = true;
        };
        if (sourceKind !== "stream") {
          try {
            if (audio.readyState > 0) applySeek();
          } catch (_) {}
          if (!seekApplied) {
            try { audio.addEventListener("loadedmetadata", function () { try { applySeek(); } catch (_) {} }, { once: true }); } catch (_) {}
          }
        } else {
          if (cur) cur.textContent = formatTime(liveOffsetSec);
          var hint = trackDurationHintSec(track);
          if (total) total.textContent = hint > 0 ? formatTime(hint) : "--:--";
        }
      }
      setStatus(opts.status || "正在加载音频…");
      showTrackNotice(track, opts.title || "正在加载音频…", opts.detail || (shouldUseElementForSavedTrack(track) ? "已加载音频，支持拖动" : "马上开始播放"));
      setTrackPlaybackState(track, "loading");
      setPlayState("loading");
      audio.play().catch(function (err) { handleAudioPlayReject(opts.label || "element", err, opts.rejectStatus || "请点播放继续"); });
      return true;
    }
    function isUnsupportedPlayError(err) {
      var name = err && err.name ? String(err.name) : "";
      var msg = err && err.message ? String(err.message) : String(err || "");
      return name === "NotSupportedError" || /not supported/i.test(msg);
    }
    function mediaErrorText(err) {
      var code = 0;
      try { code = err ? Number(err.code || 0) : 0; } catch (_) { code = 0; }
      if (code === 1) return "播放被浏览器中止";
      if (code === 2) return "网络中断，音频没有下载完整";
      if (code === 3) return "音频下载到了，但浏览器解码失败";
      if (code === 4) return "这个音频源当前 WebView 不支持或读不到";
      return "音频加载失败";
    }
    function savedTrackStaleLiveAudioSource(track) {
      if (!track || !audio || !isSavedTrack(track)) return null;
      var src = "";
      var sourceKind = "";
      var cacheKey = "";
      try {
        src = audio.currentSrc || audio.src || "";
        sourceKind = audio.dataset.idxSourceKind || "";
        cacheKey = audio.dataset.idxCacheKey || "";
      } catch (_) {}
      var staleKind = sourceKind === "stream" || sourceKind === "live-segment" || sourceKind === "live-mp3";
      var staleSrc = /\/tts_dialogue_stream_job\//.test(String(src || ""));
      if (!staleKind && !staleSrc) return null;
      if (track.cacheKey && cacheKey && cacheKey !== String(track.cacheKey)) return null;
      if (track.cacheKey && staleSrc && src.indexOf(encodeURIComponent(String(track.cacheKey))) < 0 && src.indexOf(String(track.cacheKey)) < 0) return null;
      return { src: src, sourceKind: sourceKind };
    }
    function switchSavedTrackFromLiveSourceToCompleteAudio(track, reason, opts) {
      opts = opts || {};
      var stale = savedTrackStaleLiveAudioSource(track);
      if (!stale) return false;
      if (!track.cacheUrl && track.cacheKey) track.cacheUrl = cleanBase(cfg.apiBase) + "/cache_audio/" + encodeURIComponent(track.cacheKey);
      if (!track.cacheUrl && !trackPlayableUrl(track)) return false;
      var resetProgress = !!opts.resetProgress;
      var resumeSec = Number(opts.resumeSec);
      if (!isFinite(resumeSec)) {
        var liveSec = 0;
        try { liveSec = elementLiveAudioBelongsToTrack(track) ? elementPlaybackTimeSec(track) : 0; } catch (_) { liveSec = 0; }
        resumeSec = Math.max(
          0,
          Number(liveSec || 0) || 0,
          Number(track.lastLiveProgressSec || 0) || 0,
          Number(track.liveResumeSec || 0) || 0,
          Number(track.lastStalledSec || 0) || 0,
          Number(track.lastElementSec || 0) || 0
        );
      }
      if (resetProgress) resumeSec = 0;
      resumeSec = clampPlaybackTimeSec(track, resumeSec);
      var shouldAutoplay = opts.autoplay === true;
      if (opts.autoplay == null) {
        try { shouldAutoplay = !!(!audio.paused && !audio.ended && String(track.playbackState || "") === "playing"); } catch (_) { shouldAutoplay = false; }
      }
      try { stopWebAudioPlayback("saved live source handoff"); } catch (_) {}
      try { cancelLiveSegmentAudioQueue("saved live source handoff"); } catch (_) {}
      try { clearLiveMp3AudioState(track); } catch (_) {}
      track.streamUrl = "";
      track.streaming = false;
      track.pendingBlob = false;
      track.allowStreamPlay = false;
      track.playSavedWhenReady = false;
      track.liveEndedAwaitSaved = false;
      track.savedLiveSourceActive = false;
      track.streamPlaybackFinished = !!opts.ended;
      track.livePageSuspended = false;
      track.pausedByUser = false;
      if (track.cacheUrl) track.url = track.cacheUrl;
      setTrackState(track, "saved");
      track.livePageExited = true;
      track.latestSynthesisStatusText = "";
      track.lastPlaybackSegmentStatusAt = 0;
      setTrackStreamHealth(track, "ok");
      track.stalledCount = 0;
      var url = trackPlayableUrl(track) || track.cacheUrl;
      if (!url) return false;
      function applySavedPosition() {
        try {
          if (currentTrack && currentTrack() !== track) return;
          var target = resumeSec;
          if (isFinite(audio.duration) && audio.duration > 0 && !resetProgress) target = Math.min(target, Math.max(0, audio.duration - 0.05));
          if (resetProgress) target = 0;
          audio.currentTime = Math.max(0, target);
          track.lastElementSec = Math.max(0, target);
          if (cur) cur.textContent = formatTime(target);
          var hint = progressDurationSec(track, target);
          if (total) total.textContent = hint > 0 ? formatTime(hint) : "--:--";
          if (seek) {
            var meter = progressMeterDurationSec(track, target);
            seek.disabled = !(canSeekTrackByControls(track) && meter > 0);
            seek.value = meter > 0 ? String(Math.floor(Math.min(target, meter) / meter * 1000)) : "0";
          }
          refreshActiveSubtitleForTrack(track, target, { force: true, scroll: !resetProgress, noStart: !!opts.ended });
        } catch (_) {}
      }
      try {
        suppressElementPauseState(700);
        try { audio.pause(); } catch (_) {}
        try { audio.removeAttribute("src"); audio.load(); } catch (_) {}
        audio.src = url;
        markElementAudioTrack(track, savedSourceKindForUrl(track, url));
        audio.load();
      } catch (_) {}
      applySavedPosition();
      try { audio.addEventListener("loadedmetadata", applySavedPosition, { once: true }); } catch (_) {}
      try { audio.addEventListener("canplay", applySavedPosition, { once: true }); } catch (_) {}
      if (track.cacheKey && track.cacheUrl) scheduleOfflineAudioSave(track, (reason || "saved live source handoff") + " offline", 800);
      if (messageId) saveTracksForMessage(messageId, generatedTracks).catch(function(){});
      removePendingJobForTrack(track).catch(function(){});
      if (!opts.ended) {
        setTimeout(function () { refreshActiveSubtitleForTrack(track, track.lastElementSec || resumeSec, { force: true, scroll: true }); }, 0);
        setTimeout(function () { refreshActiveSubtitleForTrack(track, track.lastElementSec || resumeSec, { force: true, scroll: true }); }, 140);
      }
      if (opts.ended) {
        stopSubtitle();
        setTrackPlaybackState(track, "ended");
        setPlayState("idle");
        setStatus(opts.status || "播放完成，完整音频已就绪");
        showTrackNotice(track, opts.title || "播放完成", opts.detail || "已退出流式播放，卡片已保留为完整音频");
      } else if (shouldAutoplay) {
        setTrackPlaybackState(track, "loading");
        setPlayState("loading");
        setStatus(opts.status || "流式卡顿，切换完整音频…");
        showTrackNotice(track, opts.title || "切换完整音频…", opts.detail || "完整音频已保存，从当前位置继续播放");
        try {
          setAudioPlaybackRate();
          var p = audio.play();
          if (p && typeof p.catch === "function") p.catch(function (e) { handleAudioPlayReject("saved-cache-handoff", e, "请点播放继续完整音频"); });
        } catch (_) {}
      } else {
        setTrackPlaybackState(track, "idle");
        setPlayState("idle");
        setStatus(opts.status || "完整音频已就绪");
        showTrackNotice(track, opts.title || savedTrackLabel(track), opts.detail || "已切回历史音频，可拖动进度条");
      }
      updateTrackButtons();
      debugLog("↪️ saved 卡残留 LIVE audio 源已切到完整音频 reason=" + (reason || "") + " kind=" + (stale.sourceKind || "") + " src=" + (stale.src || ""), "#fc9");
      return true;
    }
    function recoverSavedAudioElementError(track, detail) {
      if (!track || !isSavedTrack(track)) return false;
      var src = "";
      try { src = audio.currentSrc || audio.src || ""; } catch (_) {}
      var resumeSec = trackResumeSec(track);
      var sourceKind = "";
      try { sourceKind = audio.dataset.idxSourceKind || ""; } catch (_) {}
      if (!track.cacheUrl && track.cacheKey) track.cacheUrl = cleanBase(cfg.apiBase) + "/cache_audio/" + encodeURIComponent(track.cacheKey);
      var staleLiveSource = !!(
        sourceKind === "stream"
        || sourceKind === "live-segment"
        || sourceKind === "live-mp3"
        || /\/tts_dialogue_stream_job\//.test(String(src || ""))
      );
      if (staleLiveSource && track.cacheUrl) {
        return switchSavedTrackFromLiveSourceToCompleteAudio(track, "saved audio error" + (detail || ""), { resumeSec: resumeSec, autoplay: false });
      }
      var savedSourceActive = !!(sourceKind === "saved" || sourceKind === "saved-blob" || sameAudioUrl(src, track.cacheUrl) || sameAudioUrl(src, track.url));
      if ((sourceKind === "offline" || sourceKind === "offline-blob" || (track.offlineUrl && sameAudioUrl(src, track.offlineUrl))) && track.cacheUrl) {
        if (!track.offlineBlobRetryDone && typeof loadOfflineAudioForPlayback === "function") {
          track.offlineBlobRetryDone = true;
          setStatus("读取本地离线音频…");
          showTrackNotice(track, "读取本地离线音频…", "当前 WebView 不能直连本地文件路径，改用 Tavo 文件字节播放");
          debugLog("⚠️ 本地离线路径直连失败，尝试 tavo.file.load 离线播放。" + detail, "#fc9");
          (async function () {
            try {
              var offlinePlayable = await loadOfflineAudioForPlayback(track, "offline playback fallback");
              if (!offlinePlayable) throw new Error("离线音频读取为空");
              audio.src = offlinePlayable;
              markElementAudioTrack(track, "offline-blob");
              try { audio.load(); } catch (_) {}
              if (seek) seek.disabled = false;
              setAudioPlaybackRate();
              setTrackPlaybackState(track, "loading");
              setPlayState("loading");
              var p = audio.play();
              if (p && typeof p.then === "function") p.catch(function (err) { handleAudioPlayReject("offline-blob", err, "请点播放继续"); });
            } catch (e) {
              revokeOfflineObjectUrl(track);
              track.offlineUrl = "";
              track.offlineReady = false;
              track.offlineWanted = true;
              setTrackOfflineState(track, "failed");
              setStatus("本地离线音频不可用，改播在线音频");
              showTrackNotice(track, "本地离线音频不可用", "正在切换到在线历史音频");
              debugLog("⚠️ tavo.file.load 离线播放失败，改播在线 cache_audio。" + (e && e.message ? "（" + e.message + "）" : ""), "#fc9");
              startElementAudioFrom(track, resumeSec);
            }
          })();
          return true;
        }
        revokeOfflineObjectUrl(track);
        track.offlineUrl = "";
        track.offlineReady = false;
        track.offlineWanted = true;
        setTrackOfflineState(track, "failed");
        setStatus("本地离线音频不可用，改播在线音频");
        showTrackNotice(track, "本地离线音频不可用", "正在切换到在线历史音频");
        debugLog("⚠️ 本地离线音频播放失败，改播在线 cache_audio。" + detail, "#fc9");
        startElementAudioFrom(track, resumeSec);
        return true;
      }
      if (track.cacheUrl && savedSourceActive && !track.onlineBlobRetryDone) {
        track.onlineBlobRetryDone = true;
        setStatus("在线音频直连失败，尝试临时缓存播放");
        showTrackNotice(track, "正在换一种方式播放", "直接播放失败，改为先读取音频再播放");
        debugLog("⚠️ 在线 audio 元素直连失败，尝试 fetch blob fallback。" + detail + " src=" + src, "#fc9");
        (async function () {
          try {
            var res = await fetch(track.cacheUrl, { cache: "no-store" });
            if (!res.ok) throw new Error("HTTP " + res.status);
            var blob = await res.blob();
            if (!blob || !blob.size) throw new Error("空音频");
            if (track.onlineBlobUrl) {
              try { URL.revokeObjectURL(track.onlineBlobUrl); } catch (_) {}
            }
            track.onlineBlobUrl = URL.createObjectURL(blob);
            audio.src = track.onlineBlobUrl;
            markElementAudioTrack(track, "saved-blob");
            try { audio.load(); } catch (_) {}
            if (seek) seek.disabled = false;
            setAudioPlaybackRate();
            setTrackPlaybackState(track, "loading");
            setPlayState("loading");
            await audio.play();
          } catch (e) {
            setTrackPlaybackState(track, "error");
            setPlayState("idle");
            var msg = "在线音频读取失败。服务端已有文件，但当前 Tavo WebView 没法读取这条音频。";
            setStatus("播放失败");
            showTrackNotice(track, "播放失败", msg);
            setError(msg);
            debugLog("❌ fetch blob fallback 失败: " + (e && e.message ? e.message : e), "#f99");
          }
        })();
        return true;
      }
      return false;
    }
    function handleAudioPlayReject(label, err, fallbackStatus) {
      if (err && err.name === "AbortError") return;
      var t = currentTrack();
      if (t && isTerminalTrack(t)) {
        setPlayState("idle");
        setStatus(trackState(t) === "cancelled" ? "任务已取消" : "生成失败");
        showTrackNotice(t, trackState(t) === "cancelled" ? "任务已取消" : "生成失败", t.error || "点音符重新生成");
        return;
      }
      if (t) setTrackPlaybackState(t, "idle");
      setPlayState("idle");
      if (isUnsupportedPlayError(err)) {
        if (t && isElementUsingTrackLiveSegment(t)) {
          debugLog("⚠️ live segment audio.play() 不支持，等待完整音频: " + (err && err.message ? err.message : err), "#fc9");
          waitForSavedLiveTrack(t, "live segment unsupported fallback", {
            resumeSec: trackResumeSec(t),
            title: "等待完整音频…",
            detail: "当前 WebView 连完整小段音频也不支持，生成完成后自动切到完整音频"
          });
          return;
        }
        if (t && isElementUsingTrackLiveMp3(t)) {
          debugLog("⚠️ live MP3 audio.play() 不支持，等待完整音频: " + (err && err.message ? err.message : err), "#fc9");
          waitForSavedLiveTrack(t, "live mp3 unsupported fallback", {
            resumeSec: trackResumeSec(t),
            title: "等待完整音频…",
            detail: "当前 WebView 不支持 MP3 实时流，生成完成后自动切到完整音频"
          });
          return;
        }
        var sourceKind = "";
        try { sourceKind = audio && audio.dataset ? (audio.dataset.idxSourceKind || "") : ""; } catch (_) { sourceKind = ""; }
        if (t && (label === "offline-blob" || sourceKind === "offline-blob") && (isSavedTrack(t) || t.cacheReady || t.cacheKey || t.cacheUrl)) {
          var resumeSec = trackResumeSec(t);
          revokeOfflineObjectUrl(t);
          t.offlineUrl = "";
          t.offlineReady = false;
          t.offlineWanted = true;
          setTrackOfflineState(t, "failed");
          if (!t.cacheUrl && t.cacheKey) t.cacheUrl = cleanBase(cfg.apiBase) + "/cache_audio/" + encodeURIComponent(t.cacheKey);
          if (t.cacheUrl) {
            t.url = t.cacheUrl;
            setTrackState(t, "saved");
          }
          setStatus("本地离线音频不可用，改播在线音频");
          showTrackNotice(t, "本地离线音频不可用", "当前 WebView 不支持这份本地音频，正在切换在线历史音频");
          debugLog("⚠️ offline-blob audio.play() 不支持，改播在线 cache_audio: " + (err && err.message ? err.message : err), "#fc9");
          if (t.cacheUrl) startElementAudioFrom(t, resumeSec, { status: "正在加载在线历史音频…", title: "改播在线历史音频", detail: "本地离线音频当前 WebView 不支持" });
          return;
        }
        debugLog("⚠️ " + label + " audio.play() 不支持，已等待用户重试: " + (err && err.message ? err.message : err), "#fc9");
        setStatus(fallbackStatus || "当前 WebView 暂时没放行播放，请再点一次播放");
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
    function canPlayTrack(track) {
      if (!track || track.deleted || isTerminalTrack(track)) return false;
      if (isSavedTrack(track)) return !!(trackPlayableUrl(track) || track.cacheKey || track.cacheUrl);
      if (normalizePlaybackMode(track.playbackMode) === "live") return !!(track.cacheKey || track.streamUrl || track.url);
      return !!trackPlayableUrl(track);
    }
    function canPlayCurrentTrack() {
      return canPlayTrack(currentTrack());
    }
    function setPlayState(state) {
      if (play) {
        var nextHtml = state === "loading" ? loadingIcon() : playIcon(state);
        if (play.dataset.state !== state) play.dataset.state = state;
        if (play.dataset.iconState !== state) {
          play.innerHTML = nextHtml;
          play.dataset.iconState = state;
        }
        play.disabled = !canPlayCurrentTrack() && state !== "loading";
      }
      if (cover) cover.dataset.playing = state === "playing" ? "1" : "0";
    }
    function setHidden(el, hidden) {
      if (!el) return;
      try { el.classList.toggle("idx-hidden", !!hidden); } catch (_) {}
    }
    function updateTrackButtons() {
      var track = currentTrack();
      var live = isLiveExitTrack(track);
      var terminal = !!(track && isTerminalTrack(track));
      var liveControlsOnly = live;
      try {
        var card = first(root, ".idx-card") || root;
        if (card) {
          if (liveControlsOnly) card.setAttribute("data-live-active", "1");
          else card.removeAttribute("data-live-active");
        }
      } catch (_) {}
      [prev, next].forEach(function (el) { setHidden(el, false); });
      [rewind10, forward10].forEach(function (el) { setHidden(el, false); });
      setHidden(add, liveControlsOnly);
      setHidden(del, liveControlsOnly);
      setHidden(liveExit, !liveControlsOnly);
      var visibleCount = visibleTrackCards().length || (!tracksLoaded ? Number(knownHistoryCount || 0) : 0);
      if (prev) prev.disabled = live || visibleCount <= 1;
      if (next) next.disabled = live || visibleCount <= 1;
      var canSeekTrack = !!(track && canSeekTrackByControls(track));
      if (rewind10) rewind10.disabled = !canSeekTrack;
      if (forward10) forward10.disabled = !canSeekTrack;
      if (del) del.disabled = liveControlsOnly || currentTrackIndex < 0 || !track;
      if (liveExit) liveExit.disabled = !liveControlsOnly;
      if (play) {
        var playable = canPlayTrack(track);
        play.disabled = terminal || !playable;
        var playTitle = !track ? "没有音频，点音符生成" : (!playable ? "音频尚未就绪，点音符生成" : "播放");
        if (terminal) playTitle = trackState(track) === "cancelled" ? "任务已取消，点音符重新生成" : "生成失败，点音符重新生成";
        play.setAttribute("title", playTitle);
        play.setAttribute("aria-label", terminal ? (trackState(track) === "cancelled" ? "任务已取消" : "生成失败") : playTitle);
      }
      updateTrackCounter();
    }
    function clearWebAudioProgressTimer() {
      if (webAudioProgressTimer) {
        try { clearInterval(webAudioProgressTimer); } catch (_) {}
        webAudioProgressTimer = null;
      }
    }
    function clearElementAudioSrc() {
      try {
        if (currentTrack && isElementUsingTrackLiveSegment(currentTrack())) cancelLiveSegmentAudioQueue("clear element");
      } catch (_) {}
      try {
        if (currentTrack && isElementUsingTrackLiveMp3(currentTrack())) clearLiveMp3AudioState(currentTrack());
      } catch (_) {}
      suppressElementPauseState(500);
      try { audio.pause(); } catch (_) {}
      try { audio.removeAttribute("src"); audio.load(); } catch (_) {}
      markElementAudioTrack(null, "");
    }
    function oneOf(value, list, fallback) {
      value = String(value || "").trim();
      return list.indexOf(value) >= 0 ? value : fallback;
    }
    function inferLegacyTrackState(track) {
      if (!track) return "pending";
      var generationState = typeof cardGenerationState === "function" ? cardGenerationState(track) : "";
      if (generationState === "cancelled") return "cancelled";
      if (generationState === "failed") return "failed";
      if (generationState === "ready") return "saved";
      if (track.deleted || track.cancelled || track.state === "cancelled" || track.status === "cancelled" || track.serverState === "cancelled") return "cancelled";
      if (track.state === "failed" || track.status === "failed" || track.serverState === "failed" || track.cacheState === "failed" || track.remoteCacheState === "failed") return "failed";
      if (track.cacheReady || track.fromHistory || track.status === "ready" || track.status === "done" || track.serverState === "done" || track.cacheState === "ready" || track.remoteCacheState === "ready" || (track.url && !track.streaming && !track.pendingBlob)) return "saved";
      if (track.streamUrl || track.streaming || track.status === "running" || track.serverState === "running" || track.pendingBlob) return "live";
      return "pending";
    }
