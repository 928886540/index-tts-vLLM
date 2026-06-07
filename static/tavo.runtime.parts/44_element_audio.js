// IndexTTS Tavo runtime part: 44_element_audio.js // Role: native element audio controls // This fragment is concatenated by static/tavo.runtime.js; it is not a standalone script.
    function startElementAudioFrom(track, startSec) {
      if (!track || !trackPlayableUrl(track)) return false;
      if (!isSavedTrack(track) && isLiveTrack(track) && liveStreamUrlForTrack(track) && !shouldUseElementForLiveTrack(track, startSec)) {
        return waitForSavedLiveTrack(track, "element live cache fallback", {
          resumeSec: startSec,
          title: "等待完整音频…",
          detail: "当前 WebView 不直接播放实时音频，生成完成后切到完整音频"
        });
      }
      stopWebAudioPlayback("switch");
      var url = trackPlayableUrl(track);
      var sourceKind = isSavedTrack(track) ? (url === track.offlineUrl ? "offline" : "saved") : (url === track.streamUrl ? "stream" : "audio");
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
    function mediaErrorText(err) {
      var code = 0;
      try { code = err ? Number(err.code || 0) : 0; } catch (_) { code = 0; }
      if (code === 1) return "播放被浏览器中止";
      if (code === 2) return "网络中断，音频没有下载完整";
      if (code === 3) return "音频下载到了，但浏览器解码失败";
      if (code === 4) return "这个音频源当前 WebView 不支持或读不到";
      return "音频加载失败";
    }
    function recoverSavedAudioElementError(track, detail) {
      if (!track || !isSavedTrack(track)) return false;
      var src = "";
      try { src = audio.currentSrc || audio.src || ""; } catch (_) {}
      var resumeSec = trackResumeSec(track);
      var sourceKind = "";
      try { sourceKind = audio.dataset.idxSourceKind || ""; } catch (_) {}
      if ((sourceKind === "offline" || (track.offlineUrl && src === track.offlineUrl)) && track.cacheUrl) {
        revokeOfflineObjectUrl(track);
        track.offlineReady = false;
        track.offlineWanted = true;
        setTrackOfflineState(track, "failed");
        setStatus("本地离线音频不可用，改播在线音频");
        showTrackNotice(track, "本地离线音频不可用", "正在切换到在线历史音频");
        debugLog("⚠️ 本地离线音频播放失败，改播在线 cache_audio。" + detail, "#fc9");
        startElementAudioFrom(track, resumeSec);
        return true;
      }
      if (track.cacheUrl && !track.onlineBlobRetryDone) {
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
      if (t) setTrackPlaybackState(t, "idle");
      setPlayState("idle");
      if (isUnsupportedPlayError(err)) {
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
      [prev, next, rewind10, forward10, add].forEach(function (el) { setHidden(el, live); });
      setHidden(del, liveControlsOnly);
      setHidden(liveExit, !liveControlsOnly);
      var visibleCount = visibleTrackCards().length || (!tracksLoaded ? Number(knownHistoryCount || 0) : 0);
      if (prev) prev.disabled = live || visibleCount <= 1;
      if (next) next.disabled = live || visibleCount <= 1;
      var canSeekTrack = !!(track && isSavedTrack(track) && (trackPlayableUrl(track) || track.webAudioPlaying));
      if (rewind10) rewind10.disabled = live || !canSeekTrack;
      if (forward10) forward10.disabled = live || !canSeekTrack;
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
