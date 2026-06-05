// IndexTTS Tavo runtime part: 44_element_audio.js // Role: native element audio controls // This fragment is concatenated by static/tavo.runtime.js; it is not a standalone script.
    function startElementAudioFrom(track, startSec) {
      if (!track || !trackPlayableUrl(track)) return false;
      if (!isSavedTrack(track) && isLiveTrack(track) && liveStreamUrlForTrack(track) && !shouldUseElementForLiveTrack(track, startSec)) {
        return waitForSavedLiveTrack(track, "element live cache fallback", {
          resumeSec: startSec,
          title: "等待保存音频…",
          detail: "当前 WebView 不直接播放直播 WAV，生成完成后切到完整音频"
        });
      }
      stopWebAudioPlayback("switch");
      var url = trackPlayableUrl(track);
      var sourceKind = isSavedTrack(track) ? "saved" : (url === track.streamUrl ? "stream" : "audio");
      var liveOffsetSec = 0;
      if (!isSavedTrack(track) && isLiveTrack(track) && liveStreamUrlForTrack(track)) {
        liveOffsetSec = Math.max(0, Number(startSec || 0) || 0);
        url = liveStreamPlaybackUrlForTrack(track, liveOffsetSec);
        sourceKind = "stream";
        track.liveElementOffsetSec = liveOffsetSec;
      } else {
        track.liveElementOffsetSec = 0;
      }
      if ((audio.currentSrc || audio.src || "") !== url) {
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
      setStatus("正在加载音频…");
      showTrackNotice(track, "正在加载音频…", shouldUseElementForSavedTrack(track) ? "已加载音频，支持拖动" : "马上开始播放");
      setTrackPlaybackState(track, "loading");
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
    function setHidden(el, hidden) {
      if (!el) return;
      try { el.classList.toggle("idx-hidden", !!hidden); } catch (_) {}
    }
    function updateTrackButtons() {
      var track = currentTrack();
      var live = isCancelableLiveTrack(track);
      var background = live && (track.backgroundOnly || normalizePlaybackMode(track.playbackMode) === "generate");
      var liveControlsOnly = live && !background;
      try {
        var card = first(root, ".idx-card") || root;
        if (card) {
          if (liveControlsOnly) card.setAttribute("data-live-active", "1");
          else card.removeAttribute("data-live-active");
        }
      } catch (_) {}
      [prev, next, rewind10, forward10, add].forEach(function (el) { setHidden(el, live); });
      setHidden(del, liveControlsOnly);
      setHidden(liveExit, !liveControlsOnly);
      if (prev) prev.disabled = live || currentTrackIndex <= 0;
      if (next) next.disabled = live || currentTrackIndex < 0 || currentTrackIndex >= generatedTracks.length - 1;
      var canSeekTrack = !!(track && isSavedTrack(track) && (trackPlayableUrl(track) || track.webAudioPlaying));
      if (rewind10) rewind10.disabled = live || !canSeekTrack;
      if (forward10) forward10.disabled = live || !canSeekTrack;
      if (del) del.disabled = liveControlsOnly || currentTrackIndex < 0 || !track;
      if (liveExit) liveExit.disabled = !liveControlsOnly;
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
      markElementAudioTrack(null, "");
    }
    function oneOf(value, list, fallback) {
      value = String(value || "").trim();
      return list.indexOf(value) >= 0 ? value : fallback;
    }
    function inferLegacyTrackState(track) {
      if (!track) return "pending";
      if (track.deleted || track.cancelled || track.status === "cancelled") return "cancelled";
      if (track.status === "failed" || track.serverState === "failed" || track.cacheState === "failed" || track.remoteCacheState === "failed") return "failed";
      if (track.cacheReady || track.fromHistory || track.status === "ready" || track.cacheState === "ready" || track.remoteCacheState === "ready" || (track.url && !track.streaming && !track.pendingBlob)) return "saved";
      if (track.streamUrl || track.streaming || track.status === "running" || track.serverState === "running" || track.pendingBlob) return "live";
      return "pending";
    }
