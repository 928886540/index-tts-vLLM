// IndexTTS Tavo runtime part: 48_track_history.js // Role: track selection, cache upgrade, history and delete flow // This fragment is concatenated by static/tavo.runtime.js; it is not a standalone script.
    async function selectTrack(index, autoplay) {
      if (index < 0 || index >= generatedTracks.length) return;
      var track = generatedTracks[index];
      // 切卡前先清掉旧 audio 状态(防止旧的 currentTime/duration 串到新卡片)
      var previousTrack = currentTrack();
      if (previousTrack && previousTrack !== track) {
        try {
          if (savedElementAudioBelongsToTrack(previousTrack) && isFinite(Number(audio.currentTime))) {
            previousTrack.lastElementSec = Math.max(0, Number(audio.currentTime || 0) || 0);
          }
        } catch (_) {}
      }
      if (previousTrack !== track && isSavedTrack(track)) {
        track.lastElementSec = 0;
        track.savedElementUserPaused = false;
        track.savedSeekKeepPlayingUntil = 0;
      }
      suppressElementPauseState(350);
      try { audio.pause(); } catch (_) {}
      stopWebAudioPlayback("switch");
      stopSubtitle();
      hideSubtitlePanel();
      currentTrackIndex = index;
      currentCacheKey = track.cacheKey || "";
      var state = trackState(track);
      var srcUrl = "";
      // 统一先重置进度条/时间显示
      if (seek) { seek.value = "0"; }
      if (cur) cur.textContent = "00:00";
      if (total) total.textContent = "--:--";
      if ((state === "live" || state === "pending") && track.cacheKey && !track.deleted) {
        setStatus("检查历史音频…");
        showTrackNotice(track, "检查历史音频…", cfg.offlineAudioEnabled ? "优先检查本机离线音频" : "如果已保存，会切到可拖动音频");
        await refreshTrackFromStatus(track, "select snapshot");
        if (!isSavedTrack(track)) await promoteTrackIfCacheReady(track, "select cache check");
        state = trackState(track);
      }
      if ((state === "live" || state === "pending") && normalizePlaybackMode(track.playbackMode) === "live" && !isSavedTrack(track)) {
        var trustedLiveResume = bestStoredLiveResumeSec(track);
        var dirtyElementResume = isFinite(Number(track.lastElementSec)) ? Math.max(0, Number(track.lastElementSec) || 0) : 0;
        if (!(trustedLiveResume > 0) && dirtyElementResume > 0) {
          resetLiveProgressForTrack(track, "select live without trusted resume");
        }
      }
      if (state === "failed" || state === "cancelled") {
        // 终态卡片只展示结果和删除/重新生成入口，不能继续复用旧 live/audio 状态。
        clearElementAudioSrc();
        if (seek) { seek.disabled = true; seek.value = "0"; }
        setTrackPlaybackState(track, state === "cancelled" ? "cancelled" : "error");
        setPlayState("idle");
        setStatus(state === "cancelled" ? "任务已取消" : "生成失败");
        showTrackNotice(track, state === "cancelled" ? "任务已取消" : "生成失败", track.error || "点音符重新生成");
        updateTrackButtons();
        return;
      }
      if (!isSavedTrack(track) && (cardGenerationState(track) === "saving" || track.livePageExited)) {
        clearElementAudioSrc();
        if (seek) { seek.disabled = true; seek.value = "0"; }
        setTrackPlaybackState(track, "idle");
        setPlayState("idle");
        setStatus(cardGenerationState(track) === "saving" ? "正在保存完整音频" : "流式生成已退出");
        showTrackNotice(track, cardGenerationState(track) === "saving" ? "正在保存完整音频" : "流式生成已退出", "落盘后会变成可播放的历史音频");
        if (!isTerminalTrack(track) && !isSavedTrack(track) && track.cacheKey) pollCacheUpgrade(track, "select saving/exited");
        updateTrackButtons();
        return;
      }
      if (isSavedTrack(track)) await hydrateOfflineAudio(track, "select");
      srcUrl = trackPlayableUrl(track);
      debugLog("🎯 selectTrack idx=" + index + " state=" + state + " urlSource=" + (srcUrl === track.offlineUrl ? "offline" : srcUrl === track.url ? "url" : srcUrl === track.cacheUrl ? "cacheUrl" : srcUrl === track.streamUrl ? "streamUrl" : "none") + " src=" + srcUrl, "#9ff");
      if (isLiveTrack(track) && !track.allowStreamPlay && !autoplay) {
        clearElementAudioSrc();
        if (seek) { seek.disabled = true; seek.value = "0"; }
        setTrackPlaybackState(track, "idle");
        setPlayState("idle");
        setStatus("流式生成中");
        showTrackNotice(track, "流式生成中", track.cacheKey ? "点播放从断点继续合成播放" : "正在合成第一段，稍候");
        updateTrackButtons();
        return;
      }
      if (srcUrl) {
        if (shouldUseWebAudioForLiveTrack(track)) {
          clearElementAudioSrc();
          if (seek) { seek.disabled = true; seek.value = "0"; }
          if (cur) cur.textContent = "00:00";
          if (total) total.textContent = "--:--";
          if (autoplay) {
            var liveResumeSec = trackResumeSec(track);
            setStatus("等待音频…");
            showTrackNotice(track, liveResumeSec > 0 ? "从暂停位置续播" : "等待音频…", liveResumeSec > 0 ? ("从 " + formatTime(liveResumeSec) + " 继续") : "正在连接流式音频");
            track.allowStreamPlay = false;
            playLiveTrack(track, liveStreamUrlForTrack(track) || srcUrl, { noticeTitle: liveResumeSec > 0 ? "从暂停位置续播" : "等待音频…", noticeDetail: liveResumeSec > 0 ? ("从 " + formatTime(liveResumeSec) + " 继续") : "正在连接流式音频", waitDetail: "后端合成中", startOffsetSec: liveResumeSec });
          } else {
            setStatus(historyStatusText());
            showTrackNotice(track, "流式生成中", "点播放继续等待");
          }
          updateTrackButtons();
          return;
        }
        if (isLiveTrack(track) && (shouldUseMp3AudioForLiveTrack(track, autoplay ? trackResumeSec(track) : 0) || shouldUseSegmentAudioForLiveTrack(track, autoplay ? trackResumeSec(track) : 0))) {
          clearElementAudioSrc();
          if (seek) { seek.disabled = true; seek.value = "0"; }
          if (autoplay) {
            var nativeResumeSec = trackResumeSec(track);
            playLiveTrack(track, liveStreamUrlForTrack(track) || srcUrl, {
              noticeTitle: nativeResumeSec > 0 ? "从暂停位置续播" : "等待音频…",
              noticeDetail: nativeResumeSec > 0 ? ("从 " + formatTime(nativeResumeSec) + " 继续") : "正在连接实时音频",
              waitDetail: "后端合成中",
              startOffsetSec: nativeResumeSec
            });
          } else {
            setTrackPlaybackState(track, "idle");
            setPlayState("idle");
            setStatus("流式生成中");
            showTrackNotice(track, "流式生成中", shouldUseMp3AudioForLiveTrack(track, 0) ? "点播放连接 MP3 实时流" : "点播放等待已完成小段");
            pollCacheUpgrade(track, shouldUseMp3AudioForLiveTrack(track, 0) ? "select live mp3" : "select native segment");
          }
          updateTrackButtons();
          return;
        }
        if (isLiveTrack(track) && !shouldUseElementForLiveTrack(track, autoplay ? trackResumeSec(track) : 0)) {
          clearElementAudioSrc();
          if (seek) { seek.disabled = true; seek.value = "0"; }
          if (autoplay) {
            waitForSavedLiveTrack(track, "select live cache fallback", {
              resumeSec: trackResumeSec(track),
              title: "等待完整音频…",
              detail: "实时音频在当前 WebView 不稳定，生成完成后切到完整音频"
            });
          } else {
            setTrackPlaybackState(track, "idle");
            setPlayState("idle");
            setStatus("流式生成中");
            showTrackNotice(track, "流式生成中", "完成后会切到可拖动的完整音频");
            pollCacheUpgrade(track, "select live cache fallback");
          }
          updateTrackButtons();
          return;
        }
        if (autoplay && isLiveTrack(track) && liveStreamUrlForTrack(track)) {
          startElementAudioFrom(track, trackResumeSec(track));
          updateTrackButtons();
          return;
        }
        var selectResumeSec = 0;
        suppressElementPauseState(500);
        audio.src = srcUrl;
        markElementAudioTrack(track, isSavedTrack(track) ? savedSourceKindForUrl(track, srcUrl) : (srcUrl === track.streamUrl ? "stream" : "audio"));
        if (isLiveTrack(track)) track.allowStreamPlay = false;
        setAudioPlaybackRate();
        // 强制重新加载 metadata,避免浏览器复用上次缓存的 duration/seekable
        try { audio.load(); } catch (_) {}
        if (isSavedTrack(track)) applySavedElementSeek(track, selectResumeSec);
        if (seek) { seek.disabled = false; }
        if (autoplay) {
          setStatus("正在加载音频…");
          showTrackNotice(track, "正在加载音频…", shouldUseElementForSavedTrack(track) ? "已加载音频，支持拖动" : "马上开始播放");
          setTrackPlaybackState(track, "loading");
          setPlayState("loading");
        } else {
          setStatus(historyStatusText());
          showTrackNotice(track, savedTrackLabel(track), shouldUseElementForSavedTrack(track) ? "点播放开始，可拖动进度条" : "点播放开始");
          setTrackPlaybackState(track, "idle");
          setPlayState("idle");
        }
        updateTrackButtons();
        if (autoplay) {
          var playPromise = audio.play();
          if (playPromise && typeof playPromise.then === "function") {
            playPromise.then(function () {
              setTrackPlaybackState(track, "playing");
              setPlayState("playing");
              setStatus(trackPlaybackLabel(track));
            }).catch(function (err) {
              setTrackPlaybackState(track, "idle");
              setPlayState("idle");
              handleAudioPlayReject("element", err, "请点播放继续");
            });
          }
        }
        return;
      }
      // 都没有 URL —— 该 track 是占位
      suppressElementPauseState(500);
      try { audio.removeAttribute('src'); audio.load(); } catch (_) {}
      if (seek) { seek.disabled = true; }
      if (state === "failed") {
        setTrackPlaybackState(track, "error");
        setPlayState("idle");
        showTrackNotice(track, "生成失败", track.error || "请重新生成一次");
        setStatus("生成失败");
      } else if (state === "cancelled") {
        setTrackPlaybackState(track, "cancelled");
        setPlayState("idle");
        showTrackNotice(track, "任务已取消", track.error || "点音符重新生成");
        setStatus("任务已取消");
      } else if (state === "live") {
        showTrackNotice(track, "流式生成中", "等待音频保存或继续播放");
        setStatus(historyStatusText());
      } else {
        showTrackNotice(track, track.noticeTitle || "音频尚未就绪", track.noticeDetail || "生成完成后会自动显示歌词");
        setStatus(historyStatusText());
      }
      updateTrackButtons();
    }
    function attachCacheAudio(track, opts) {
      opts = opts || {};
      if (!track || !track.cacheUrl) return false;
      var handoffSec = 0;
      var isCurrentTrack = currentTrackIndex >= 0 && generatedTracks[currentTrackIndex] === track;
      var liveElementOwnsTrack = false;
      var liveElementPlaying = false;
      var liveElementSec = 0;
      try {
        liveElementOwnsTrack = !!(isCurrentTrack && elementLiveAudioBelongsToTrack(track));
        liveElementPlaying = !!(liveElementOwnsTrack && audio && !audio.paused && !audio.ended);
        if (liveElementOwnsTrack && isFinite(Number(audio.currentTime))) liveElementSec = elementPlaybackTimeSec(track);
      } catch (_) {
        liveElementOwnsTrack = false;
        liveElementPlaying = false;
        liveElementSec = 0;
      }
      if (opts.forceElement || opts.autoplay) {
        handoffSec = webAudioPlaybackSecForTrack(track);
        stopWebAudioPlayback("handoff");
        if (handoffSec > 0) {
          track.lastWebAudioSec = handoffSec;
          track.lastElementSec = handoffSec;
        }
      } else if (liveElementOwnsTrack && liveElementSec > 0) {
        handoffSec = liveElementSec;
        track.lastElementSec = liveElementSec;
        track.lastLiveProgressSec = Math.max(Number(track.lastLiveProgressSec || 0) || 0, liveElementSec);
      }
      track.url = track.cacheUrl;
      setTrackState(track, "saved");
      track.liveEndedAwaitSaved = false;
      track.streamPlaybackFinished = false;
      track.livePageSuspended = false;
      if (!liveElementOwnsTrack || opts.forceElement || opts.autoplay) clearLiveMp3AudioState(track);
      if (isCurrentTrack) {
        updateTrackButtons();
        var liveWebAudioOwnsTrack = (typeof webAudioBelongsToTrack === "function" && webAudioBelongsToTrack(track));
        if (liveWebAudioOwnsTrack && track.webAudioPausedLocal && !opts.forceElement && !opts.autoplay) {
          handoffSec = webAudioPlaybackSecForTrack(track);
          stopWebAudioPlayback("handoff");
          if (handoffSec > 0) {
            track.lastWebAudioSec = handoffSec;
            track.lastElementSec = handoffSec;
          }
          liveWebAudioOwnsTrack = false;
        }
        if (liveWebAudioOwnsTrack && !opts.forceElement && !opts.autoplay) return true;
        if (liveElementOwnsTrack && !opts.forceElement && !opts.autoplay) {
          if (liveElementPlaying) {
            setTrackPlaybackState(track, "playing");
            setPlayState("playing");
          }
          setStatus(liveElementPlaying ? "完整音频已就绪，继续流式播放" : "完整音频已就绪，可重播");
          showTrackNotice(track, "完整音频已就绪", trackHasStreamIssue(track) ? "检测到流式卡顿，可拖动进度切到完整音频" : "当前流式播放不切换，拖动进度会切到完整音频");
          try {
            if (track.cacheKey && track.mode !== "single" && liveElementPlaying) {
              startSubtitle(track, function () { return elementPlaybackTimeSec(track); });
            }
          } catch (_) {}
          return true;
        }
        if (opts.deferElement) {
          setStatus("完整音频已就绪，可重播");
          showTrackNotice(track, "完整音频已就绪", formatJobMetrics(track.metrics) || "点播放可重播");
          return true;
        }
        if ((isElementUsingTrackStream(track) || isElementUsingTrackLiveSegment(track) || isElementUsingTrackLiveMp3(track)) && !opts.forceElement && !opts.autoplay) {
          setStatus(isElementPlayingTrackStream(track) ? "完整音频已就绪，继续流式播放" : "完整音频已就绪，可重播");
          showTrackNotice(track, "完整音频已就绪", trackHasStreamIssue(track) ? "检测到流式卡顿，可切到完整音频" : "当前流式播放不切换，结束后可重播");
          return true;
        }
        try {
          var currentSrc = audio.currentSrc || audio.src || "";
          if (currentSrc !== track.cacheUrl) {
            suppressElementPauseState(500);
            audio.src = track.cacheUrl;
            markElementAudioTrack(track, "saved");
            audio.load();
            if (seek) seek.value = handoffSec > 0 ? String(Math.floor(handoffSec / Math.max(1, trackDurationHintSec(track)) * 1000)) : "0";
            if (cur) cur.textContent = formatTime(handoffSec);
          }
          if (seek) seek.disabled = false;
          if (opts.autoplay) {
            setAudioPlaybackRate();
            if (handoffSec > 0) {
              try {
                var applyHandoffSeek = function () {
                  try {
                    var target = handoffSec;
                    if (isFinite(audio.duration) && audio.duration > 0) target = Math.min(target, Math.max(0, audio.duration - 0.05));
                    audio.currentTime = Math.max(0, target);
                  } catch (_) {}
                };
                if (audio.readyState > 0) applyHandoffSeek();
                else audio.addEventListener("loadedmetadata", applyHandoffSeek, { once: true });
              } catch (_) {}
            }
            var playPromise = audio.play();
            if (playPromise && typeof playPromise.then === "function") {
              playPromise.then(function () {
                setTrackPlaybackState(track, "playing");
                setPlayState("playing");
                setStatus(trackPlaybackLabel(track));
                debugLog("▶️ 完整音频自动接管播放 cacheKey=" + (track.cacheKey || ""), "#9f9");
              }).catch(function (err) {
                setTrackPlaybackState(track, "idle");
                setPlayState("idle");
                handleAudioPlayReject("cache", err, "缓存已就绪，点播放继续");
              });
            } else {
              setTrackPlaybackState(track, "playing");
              setPlayState("playing");
              setStatus(trackPlaybackLabel(track));
            }
          }
        } catch (e) {
          debugLog("❌ 挂载 cache audio 失败: " + (e && e.message ? e.message : e), "#f99");
        }
      } else {
        updateTrackButtons();
      }
      return true;
    }
    var PENDING_JOBS_KEY_PREFIX = "indextts_pending_jobs_";
    function pendingJobsStorageKeys() {
      var keys = [];
      function add(key) {
        key = String(key || "").trim();
        if (key && keys.indexOf(key) < 0) keys.push(key);
      }
      add(messageId ? (PENDING_JOBS_KEY_PREFIX + messageId) : "");
      return keys;
    }
    function pendingJobLooksActive(t) {
      if (!t || !t.cacheKey || t.deleted || t.cancelled) return false;
      var state = trackState(t);
      return state !== "saved" && state !== "failed" && state !== "cancelled" && state !== "done";
    }
    async function loadPendingJobsForMessage() {
      var keys = pendingJobsStorageKeys();
      if (!keys.length) return [];
      var out = [];
      function addList(list) {
        if (!Array.isArray(list)) return;
        list.filter(pendingJobLooksActive).forEach(function (item) {
          if (!item || !item.cacheKey) return;
          for (var i = 0; i < out.length; i++) {
            if (out[i] && out[i].cacheKey === item.cacheKey) return;
          }
          out.push(item);
        });
      }
      for (var i = 0; i < keys.length; i++) {
        var key = keys[i];
        try {
          if (window.tavo && typeof tavo.get === "function") {
            addList(await tavo.get(key, "chat"));
          }
        } catch (_) {}
        try {
          var raw = localStorage.getItem(key);
          if (raw) addList(JSON.parse(raw));
        } catch (_) {}
      }
      return out;
    }
    async function savePendingJobsForMessage(list, opts) {
      opts = opts || {};
      var keys = pendingJobsStorageKeys();
      if (!keys.length) return;
      var lite = (list || []).filter(pendingJobLooksActive).map(function (t) {
        var pos = ensureTrackRecordPosition(t, generatedTracks.indexOf(t) >= 0 ? generatedTracks.indexOf(t) : (list || []).indexOf(t));
        return {
          cacheKey: t.cacheKey || "",
          trackIndex: pos.trackIndex,
          trackId: pos.trackId,
          cacheUrl: t.cacheUrl || "",
          streamUrl: t.streamUrl || "",
          createdAt: t.createdAt || Date.now(),
          voice: t.voice || "",
          mode: normalizeModeName(t.mode),
          parseMode: normalizeModeName(t.parseMode || t.mode),
          playbackMode: normalizePlaybackMode(t.playbackMode),
          backgroundOnly: !!t.backgroundOnly,
          state: trackState(t),
          status: t.status || "",
          voicesMap: t.voicesMap || null,
          sampleRate: t.sampleRate || t.sample_rate || 0,
          duration_s: t.duration_s || (t.metrics && t.metrics.audio_duration_s) || 0,
          lastWebAudioSec: isFinite(Number(t.lastWebAudioSec)) ? Math.max(0, Number(t.lastWebAudioSec)) : 0,
          lastElementSec: 0,
          lastLiveProgressSec: isFinite(Number(t.lastLiveProgressSec)) ? Math.max(0, Number(t.lastLiveProgressSec)) : 0,
          liveResumeSec: isFinite(Number(t.liveResumeSec)) ? Math.max(0, Number(t.liveResumeSec)) : 0,
          lastStalledSec: isFinite(Number(t.lastStalledSec)) ? Math.max(0, Number(t.lastStalledSec)) : 0,
          metrics: t.metrics || null,
          segments: Array.isArray(t.segments) ? t.segments : []
        };
      });
      lite.sort(compareTrackRecords);
      var failed = null;
      for (var i = 0; i < keys.length; i++) {
        var key = keys[i];
        try { if (window.tavo && typeof tavo.set === "function") await tavo.set(key, lite, "chat"); }
        catch (e) { if (!failed) failed = e; try { debugLog("⚠️ 保存 pending 到 tavo.set 失败: " + (e && e.message ? e.message : e), "#fc9"); } catch (_) {} }
        try { localStorage.setItem(key, JSON.stringify(lite)); }
        catch (e) { if (!failed) failed = e; }
      }
      if (opts.strict && failed) throw failed;
    }
    async function savePendingJobForTrack(track) {
      if (!track || !track.cacheKey || isSavedTrack(track) || track.deleted || track.cancelled || !pendingJobsStorageKeys().length) return;
      ensureTrackRecordPosition(track, generatedTracks.indexOf(track));
      var jobs = await loadPendingJobsForMessage();
      var idx = jobs.findIndex(function (j) { return j && j.cacheKey === track.cacheKey; });
      if (idx >= 0) jobs[idx] = track; else jobs.push(track);
      await savePendingJobsForMessage(jobs);
    }
    async function removePendingJobForTrack(trackOrKey, opts) {
      var cacheKey = typeof trackOrKey === "string" ? trackOrKey : (trackOrKey && trackOrKey.cacheKey);
      if (!cacheKey || !pendingJobsStorageKeys().length) return;
      var jobs = await loadPendingJobsForMessage();
      jobs = jobs.filter(function (j) { return !j || j.cacheKey !== cacheKey; });
      await savePendingJobsForMessage(jobs, opts);
    }
    function restoreTrackFromPending(t, base) {
      if (!pendingJobLooksActive(t)) return null;
      var mode = normalizeModeName(t.mode || t.parseMode || "ai");
      var playbackMode = normalizePlaybackMode(t.playbackMode || "generate");
      var restoredState = playbackMode === "live" ? "live" : "pending";
      var restored = {
        url: null,
        streamUrl: t.streamUrl || (base + "/tts_dialogue_stream_job/" + encodeURIComponent(t.cacheKey)),
        cacheUrl: t.cacheUrl || (base + "/cache_audio/" + encodeURIComponent(t.cacheKey)),
        cacheKey: t.cacheKey,
        trackIndex: trackRecordPositionValue(t, 0),
        trackId: String(t.trackId || t.cacheKey || "").trim(),
        createdAt: t.createdAt || Date.now(),
        voice: representativeVoiceForMode(mode, t.voicesMap || null, t.voice || cfg.defaultVoice),
        mode: mode,
        parseMode: mode,
        playbackMode: playbackMode,
        backgroundOnly: playbackMode === "generate",
        segments: Array.isArray(t.segments) ? t.segments : [],
        voicesMap: t.voicesMap || null,
        metrics: t.metrics || null,
        sampleRate: t.sampleRate || t.sample_rate || 0,
        duration_s: t.duration_s || (t.metrics && t.metrics.audio_duration_s) || 0,
        lastWebAudioSec: isFinite(Number(t.lastWebAudioSec)) ? Math.max(0, Number(t.lastWebAudioSec)) : 0,
        lastElementSec: 0,
        lastLiveProgressSec: isFinite(Number(t.lastLiveProgressSec)) ? Math.max(0, Number(t.lastLiveProgressSec)) : 0,
        liveResumeSec: isFinite(Number(t.liveResumeSec)) ? Math.max(0, Number(t.liveResumeSec)) : 0,
        lastStalledSec: isFinite(Number(t.lastStalledSec)) ? Math.max(0, Number(t.lastStalledSec)) : 0,
        state: restoredState,
        status: restoredState === "live" ? "running" : "pending",
        pendingBlob: true,
        streaming: restoredState === "live",
        allowStreamPlay: false,
        savePromptAsked: false,
        streamHealth: "ok"
      };
      setTrackState(restored, restoredState);
      ensureTrackStates(restored);
      return restored;
    }
    function rememberDetachedBackgroundJob(track) {
      if (!track || !track.cacheKey) return;
      for (var i = 0; i < detachedBackgroundJobs.length; i++) {
        if (detachedBackgroundJobs[i] && detachedBackgroundJobs[i].cacheKey === track.cacheKey) return;
      }
      detachedBackgroundJobs.push(track);
    }
    function forgetDetachedBackgroundJob(trackOrKey) {
      var cacheKey = typeof trackOrKey === "string" ? trackOrKey : (trackOrKey && trackOrKey.cacheKey);
      if (!cacheKey) return;
      detachedBackgroundJobs = detachedBackgroundJobs.filter(function (t) { return !t || t.cacheKey !== cacheKey; });
    }
    function appendDetachedBackgroundTrackToHistory(trackEntry, label) {
      if (!trackEntry || !trackEntry.cacheKey) return false;
      var existingIdx = generatedTracks.findIndex(function (t) { return t && t.cacheKey === trackEntry.cacheKey; });
      if (existingIdx >= 0) {
        forgetDetachedBackgroundJob(trackEntry);
        return false;
      }
      trackEntry.backgroundOnly = false;
      trackEntry.pendingBlob = false;
      trackEntry.streaming = false;
      trackEntry.allowStreamPlay = false;
      trackEntry.url = trackEntry.cacheUrl || trackEntry.url || "";
      setTrackState(trackEntry, "saved");
      generatedTracks.push(trackEntry);
      tracksLoaded = true;
      if (currentTrackIndex < 0) currentTrackIndex = generatedTracks.length - 1;
      forgetDetachedBackgroundJob(trackEntry);
      debugLog("✅ " + (label || "background") + " 完成后追加为普通历史卡片 index=" + generatedTracks.length, "#9f9");
      return true;
    }
    function pollCacheUpgrade(trackEntry, label) {
      if (!trackEntry || !trackEntry.cacheKey || trackEntry.cachePollStarted || isSavedTrack(trackEntry)) return;
      trackEntry.cachePollStarted = true;
      setTrackCacheState(trackEntry, "pending");
      label = label || "snapshot";
      function playbackSegmentStatusText(trackEntry, payload, totalSegments) {
        if (typeof playbackSegmentStatusTextForTrack === "function") {
          return playbackSegmentStatusTextForTrack(trackEntry, payload, totalSegments);
        }
        if (!trackEntry || currentTrack() !== trackEntry) return "";
        if (normalizePlaybackMode(trackEntry.playbackMode) !== "live") return "";
        var isPlaying = !!(
          trackEntry.webAudioPlaying
          || String(trackEntry.playbackState || "") === "playing"
          || (typeof isElementPlayingTrackStream === "function" && isElementPlayingTrackStream(trackEntry))
        );
        if (!isPlaying) return "";
        var sec = 0;
        try { sec = trackResumeSec(trackEntry); } catch (_) { sec = 0; }
        if (!isFinite(Number(sec)) || Number(sec) < 0) return "";
        var raw = [];
        if (payload && Array.isArray(payload.segments_meta) && payload.segments_meta.length) raw = payload.segments_meta;
        else if (Array.isArray(trackEntry.segments) && trackEntry.segments.length) raw = trackEntry.segments;
        if (!raw.length) return "";
        var sampleRate = Number((payload && payload.sample_rate) || trackEntry.sampleRate || trackEntry.sample_rate || 0);
        var rows = raw.map(function (seg, i) {
          var start = segmentStartSec(seg, sampleRate);
          var idx = isFinite(Number(seg && seg.idx)) ? Number(seg.idx) : i;
          return { idx: idx, start: start, duration: Number((seg && seg.duration_s) || 0) };
        }).filter(function (row) {
          return isFinite(row.start) && row.start >= 0;
        }).sort(function (a, b) {
          return a.start - b.start;
        });
        if (!rows.length) return "";
        var currentIdx = -1;
        for (var i = 0; i < rows.length; i += 1) {
          var row = rows[i];
          var next = rows[i + 1];
          var end = row.duration > 0 ? row.start + row.duration : (next ? next.start : Infinity);
          if (sec + 0.05 >= row.start && sec < end + 0.15) {
            currentIdx = row.idx;
            break;
          }
          if (sec >= row.start) currentIdx = row.idx;
        }
        if (currentIdx < 0 && sec <= rows[0].start + 0.15) currentIdx = rows[0].idx;
        if (currentIdx < 0) return "";
        var displayIdx = Math.max(1, Math.floor(Number(currentIdx) || 0) + 1);
        var total = Math.max(
          Number(totalSegments || 0) || 0,
          payload && payload.metrics ? Number(payload.metrics.segments_total || 0) || 0 : 0,
          payload && Array.isArray(payload.segments_plan) ? payload.segments_plan.length : 0,
          trackEntry.segmentPlan && Array.isArray(trackEntry.segmentPlan) ? trackEntry.segmentPlan.length : 0,
          raw.length,
          displayIdx
        );
        return "正在播第 " + displayIdx + (total ? "/" + total : "") + " 段";
      }
      function jobStatusMessage(metrics, trackEntry, payload) {
        var phase = String((metrics && metrics.phase) || "");
        var msg = String((metrics && metrics.message) || "");
        var mode = normalizeModeName((trackEntry && (trackEntry.mode || trackEntry.parseMode)) || (metrics && metrics.parse_mode) || cfg.mode);
        var playback = normalizePlaybackMode((trackEntry && trackEntry.playbackMode) || cfg.playbackMode);
        var total = Number((metrics && metrics.segments_total) || 0) || 0;
        if (!total && metrics && Array.isArray(metrics.segments_plan)) total = metrics.segments_plan.length;
        var doneSegs = Number(metrics && metrics.segments_done);
        if (!isFinite(doneSegs)) doneSegs = payload && Array.isArray(payload.segments_meta) ? payload.segments_meta.length : 0;
        doneSegs = Math.max(0, Math.floor(doneSegs || 0));
        if (total) doneSegs = Math.min(total, doneSegs);
        var playingSeg = playbackSegmentStatusText(trackEntry, payload, total);
        function withPlayingSegment(text) {
          return playingSeg ? (text + " · " + playingSeg) : text;
        }
        function queueStatusText() {
          var rawAhead = Number(metrics && metrics.queue_ahead);
          if (isFinite(rawAhead)) {
            var ahead = Math.max(0, Math.floor(rawAhead));
            if (ahead > 0) return "排队中 · 前面还有 " + ahead + " 个任务";
            return "排队中 · 下一个开始";
          }
          return "排队中";
        }
        function llmWaitText() {
          var elapsed = Number(metrics && metrics.llm_elapsed_s);
          var reuseRequested = !!(metrics && (metrics.llm_reuse || metrics.reuse_llm_parse));
          var reuseCached = !!(metrics && metrics.llm_parse_cached);
          var prefix = reuseRequested && !reuseCached ? "复用未命中，等待 LLM 返回" : "等待 LLM 返回";
          if (isFinite(elapsed) && elapsed >= 1) return prefix + " " + Math.floor(elapsed) + "s";
          return prefix;
        }
        if (phase === "created") return mode === "ai" ? "等待分析文本" : "任务已提交";
        if (phase === "llm_parse_cache") return "分段已就绪，等待合成";
        if (phase === "llm_parse") {
          var llmStage = String((metrics && metrics.llm_stage) || "");
          if (llmStage === "reuse_check" || /检查|复用/i.test(msg)) return "检查分段复用";
          if (llmStage === "waiting") return llmWaitText();
          if (llmStage === "normalizing") return "整理分段结果";
          if (llmStage === "done") return "分段已就绪，等待合成";
          return /LLM/i.test(msg) ? llmWaitText() : "正在分析文本";
        }
        if (phase === "tts_queue") return queueStatusText();
        if (phase === "tts") {
          if (total) return withPlayingSegment("已生成 " + doneSegs + "/" + total + " 段");
          return withPlayingSegment("正在合成");
        }
        if (phase === "saving") return withPlayingSegment(total ? ("已生成 " + Math.max(doneSegs, total) + "/" + total + " 段，正在保存") : "正在保存");
        if (phase === "done") return "完整音频已保存";
        if (/文本已拆分|等待 TTS 合成|拆分文本|拆段/.test(msg)) return "等待合成";
        return withPlayingSegment(msg || "处理中");
      }
      (async function () {
        var done = false;
        for (var i = 0; i < 240; i++) {
          if (trackEntry.deleted) { done = true; break; }
          try {
            if (trackEntry.mode === "single") {
              if (await refreshTrackFromStatus(trackEntry, label)) {
                done = true;
                break;
              }
              await new Promise(function(r){ setTimeout(r, 1000); });
              continue;
            }
            var st = await fetch(cleanBase(cfg.apiBase) + "/tts_dialogue_job_status/" + encodeURIComponent(trackEntry.cacheKey), { cache: "no-store" });
            if (st.ok) {
              var j = await st.json();
              if (j && j.metrics) {
                trackEntry.metrics = j.metrics;
                if (currentTrack() === trackEntry && !isSavedTrack(trackEntry)) {
                  var phase = String(j.metrics.phase || "");
                  if (phase === "llm_parse" || phase === "llm_parse_cache" || phase === "created" || phase === "tts_queue" || phase === "tts" || phase === "saving") {
                    var uiMsg = jobStatusMessage(j.metrics, trackEntry, j);
                    trackEntry.latestSynthesisStatusText = String(uiMsg || "").replace(/\s*·\s*(?:当前在播第|正在播第|播第)\s*\d+(?:\s*\/\s*\d+)?\s*段/g, "");
                    setStatus(uiMsg);
                    if (!isTransientProgressNotice(uiMsg)) showTrackNotice(trackEntry, uiMsg || "正在生成…", formatJobMetrics(j.metrics) || "请稍等");
                  }
                }
              }
              if (j && j.sample_rate) trackEntry.sampleRate = j.sample_rate;
              if (j && j.duration_s) trackEntry.duration_s = j.duration_s;
              if (j && j.cache_url) {
                trackEntry.cacheUrl = new URL(j.cache_url, cleanBase(cfg.apiBase) + "/").href;
              }
              if (j && Array.isArray(j.segments_meta) && j.segments_meta.length) {
                var nextSig = j.segments_meta.map(function (m) {
                  return [m.role || "", m.text || "", Number(m.start_s || 0).toFixed(3), Number(m.start_offset_bytes || 0), Number(m.duration_s || 0).toFixed(3)].join(":");
                }).join("|");
                if (nextSig && nextSig !== trackEntry.segmentsSignature) {
                  trackEntry.segmentsSignature = nextSig;
                  trackEntry.segments = j.segments_meta.map(function (s) {
                    return { role: s.role || "", text: s.text || "", style: s.style || "neutral", style_alpha: s.style_alpha, start_s: s.start_s, start_offset_bytes: s.start_offset_bytes, duration_s: s.duration_s };
                  });
                }
              }
              try { saveReusableSegmentsFromStatus(messageText, cfg, context, trackEntry, j, label || "poll status").catch(function(){}); } catch (_) {}
              var cacheHeadReady = false;
              if (j && j.state !== "done" && j.state !== "failed" && j.state !== "cancelled" && trackEntry.cacheUrl && (normalizePlaybackMode(trackEntry.playbackMode) === "live" || normalizePlaybackMode(trackEntry.playbackMode) === "generate")) {
                try {
                  var hs = await fetch(trackEntry.cacheUrl, { method: "HEAD", cache: "no-store" });
                  cacheHeadReady = !!(hs && hs.ok);
                } catch (_) { cacheHeadReady = false; }
              }
              if (j && (j.state === "done" || cacheHeadReady)) {
                var wasBackground = !!(trackEntry.backgroundOnly || normalizePlaybackMode(trackEntry.playbackMode) === "generate");
                var wasDetached = generatedTracks.indexOf(trackEntry) < 0;
                var isCurrent = currentTrack() === trackEntry;
                var preSavePlaybackState = String(trackEntry.playbackState || "");
                var cacheFallbackNeeded = !!trackEntry.playSavedWhenReady;
                var liveWebAudioOwnsTrack = !!(typeof webAudioBelongsToTrack === "function" && webAudioBelongsToTrack(trackEntry));
                var liveWebAudioAudibleNow = !!(liveWebAudioOwnsTrack && trackEntry.webAudioPlaying);
                var liveElementAudibleNow = !!(typeof isElementPlayingTrackStream === "function" && isElementPlayingTrackStream(trackEntry));
                var liveStreamAudibleNow = liveWebAudioAudibleNow || liveElementAudibleNow;
                var liveEndedAwaitSaved = !!(trackEntry.liveEndedAwaitSaved || (preSavePlaybackState === "ended" && isCurrent && normalizePlaybackMode(trackEntry.playbackMode) === "live"));
                var hardStreamIssue = !!(trackEntry.streamInterrupted || trackEntry.streamHealth === "interrupted");
                var liveCurrentNeedsSoundHandoff = !!(
                  isCurrent
                  && !wasBackground
                  && !liveEndedAwaitSaved
                  && normalizePlaybackMode(trackEntry.playbackMode) === "live"
                  && !trackEntry.pausedByUser
                  && (
                    cacheFallbackNeeded
                    || hardStreamIssue
                    || (!liveStreamAudibleNow && (
                      trackHasStreamIssue(trackEntry)
                      || preSavePlaybackState === "loading"
                      || preSavePlaybackState === "buffering"
                      || (!liveWebAudioOwnsTrack && preSavePlaybackState !== "playing")
                    ))
                  )
                );
                var liveCacheHandoffNeeded = liveCurrentNeedsSoundHandoff;
                var appendedDetached = false;
                if (wasDetached) {
                  setTrackState(trackEntry, "saved");
                  appendedDetached = appendDetachedBackgroundTrackToHistory(trackEntry, label);
                }
                var autoplaySaved = !!liveCacheHandoffNeeded;
                if (liveEndedAwaitSaved) autoplaySaved = false;
                if (wasBackground) autoplaySaved = false;
                trackEntry.playSavedWhenReady = false;
                trackEntry.streamTooSlowFallback = false;
                attachCacheAudio(trackEntry, { forceElement: liveEndedAwaitSaved || autoplaySaved, deferElement: !liveEndedAwaitSaved && liveWebAudioOwnsTrack && !autoplaySaved && !trackHasStreamIssue(trackEntry), autoplay: autoplaySaved });
                trackEntry.liveEndedAwaitSaved = false;
                scheduleOfflineAudioSave(trackEntry, label + " offline", 0);
                knownHistoryCount = persistableHistoryTracks(generatedTracks).length;
                updateTrackButtons();
                if (messageId) saveTracksForMessage(messageId, generatedTracks).catch(function(){});
                removePendingJobForTrack(trackEntry).catch(function(){});
                debugLog("✅ " + label + " 已落盘，cacheUrl 已写回卡片" + (cacheHeadReady ? " (HEAD确认)" : ""), "#9f9");
                if (autoplaySaved) setStatus("生成完成，正在播放完整音频");
                else if (liveEndedAwaitSaved && isCurrent) {
                  setStatus("播放完成，完整音频已就绪");
                  showTrackNotice(trackEntry, "播放完成", "已切到完整音频，支持拖动进度条");
                }
                else if (wasBackground) {
                  if (isCurrent || !currentTrack()) setStatus("后台生成完成 · 历史音频 " + knownHistoryCount + " 条");
                  if (isCurrent) {
                    if (appendedDetached) await selectTrack(currentTrackIndex, false);
                    else showTrackNotice(trackEntry, "后台生成完成", "点播放开始播放完整音频");
                  } else if (!currentTrack()) {
                    showTrackNotice(null, "后台生成完成", "点播放开始播放完整音频");
                  } else {
                    setStatus("后台生成完成 · 历史音频 " + knownHistoryCount + " 条");
                    showTrackNotice(currentTrack(), historyStatusText(), "后台音频已加入历史，可切换播放");
                  }
                }
                var metricsLine = formatJobMetrics(trackEntry.metrics);
                if (metricsLine) debugLog("📊 " + label + " 指标: " + metricsLine, "#9ff");
                if (isCurrent && liveStreamAudibleNow && !autoplaySaved) {
                  debugLog("✅ 完整音频已就绪，保持当前 LIVE 播放，不抢切 audio", "#9f9");
                }
                if (currentTrack() === trackEntry && isElementUsingTrackStream(trackEntry)) {
                  debugLog("✅ 未检测到 stalled/中断，保持当前流式播放，不切到落盘音频", "#9f9");
                }
                done = true;
                break;
              }
              if (j && j.state === "failed") {
                var failedDetached = generatedTracks.indexOf(trackEntry) < 0;
                var failMsg = (j.metrics && j.metrics.message ? j.metrics.message + ": " : "") + (j.error || "服务端生成失败");
                trackEntry.error = failMsg;
                setTrackState(trackEntry, "failed");
                removePendingJobForTrack(trackEntry).catch(function(){});
                forgetDetachedBackgroundJob(trackEntry);
                if (currentTrack() === trackEntry || !currentTrack()) setStatus("生成失败");
                if (failedDetached) {
                  if (!currentTrack()) showTrackNotice(null, "后台生成失败", failMsg);
                } else {
                  if (currentTrack() === trackEntry) {
                    setPlayState("idle");
                    setError(failMsg);
                    showTrackNotice(trackEntry, "生成失败", failMsg);
                  }
                }
                updateTrackButtons();
                debugLog("❌ 服务端任务失败: " + failMsg, "#f99");
                done = true;
                break;
              }
              if (j && j.state === "cancelled") {
                var cancelledDetached = generatedTracks.indexOf(trackEntry) < 0;
                trackEntry.cancelled = true;
                setTrackState(trackEntry, "cancelled");
                removePendingJobForTrack(trackEntry).catch(function(){});
                forgetDetachedBackgroundJob(trackEntry);
                if (currentTrack() === trackEntry || !currentTrack()) setStatus("已取消");
                if (cancelledDetached) {
                  if (!currentTrack()) showTrackNotice(null, "任务已取消", "后台任务已停止");
                } else {
                  if (currentTrack() === trackEntry) {
                    setPlayState("idle");
                    showTrackNotice(trackEntry, "任务已取消", "后台任务已停止");
                  }
                }
                updateTrackButtons();
                debugLog("🛑 服务端任务已取消: " + trackEntry.cacheKey, "#fc9");
                done = true;
                break;
              }
            }
          } catch (e) {
            debugLog("⚠️ " + label + " 状态轮询失败: " + (e && e.message ? e.message : e), "#fc9");
          }
          await new Promise(function(r){ setTimeout(r, 1000); });
        }
        if (!done && !trackEntry.deleted && !isSavedTrack(trackEntry)) {
          trackEntry.cachePollStarted = false;
          debugLog("⚠️ " + label + " 等待落盘超时，cacheKey=" + trackEntry.cacheKey, "#fc9");
        }
      })();
    }
    var tracksLoaded = !messageId;
    var tracksLoading = null;
    var knownHistoryCount = 0;
    function restoreTrackKey(track) {
      if (!track) return "";
      if (track.cacheKey) return "cache:" + String(track.cacheKey);
      if (track.trackId) return "track:" + String(track.trackId);
      return "";
    }
    function pushUniqueRestoredTrack(list, track) {
      if (!track) return false;
      var key = restoreTrackKey(track);
      if (key) {
        for (var i = 0; i < list.length; i++) {
          if (restoreTrackKey(list[i]) === key) return false;
        }
      }
      list.push(track);
      return true;
    }
    function restoreTrackFromHistory(t, base) {
      if (!persistedTrackLooksVisible(t)) return null;
      var restoredMode = t.mode === "single" ? "single" : normalizeModeName(t.mode || "ai");
      var generationState = cardGenerationState(t);
      var playbackMode = normalizePlaybackMode(t.playbackMode || "live");
      var ready = generationState === "ready";
      var restoredState = ready ? "saved" : (generationState === "failed" ? "failed" : (playbackMode === "live" ? "live" : "pending"));
      var restored = {
        url: ready ? (t.cacheUrl || (base + "/cache_audio/" + encodeURIComponent(t.cacheKey))) : "",
        cacheKey: t.cacheKey,
        trackIndex: trackRecordPositionValue(t, 0),
        trackId: String(t.trackId || t.cacheKey || "").trim(),
        cacheUrl: t.cacheUrl || (base + "/cache_audio/" + encodeURIComponent(t.cacheKey)),
        streamUrl: ready || restoredMode === "single" ? "" : (t.streamUrl || (base + "/tts_dialogue_stream_job/" + encodeURIComponent(t.cacheKey))),
        createdAt: t.createdAt || Date.now(),
        voice: representativeVoiceForMode(restoredMode, t.voicesMap || null, t.voice || cfg.defaultVoice),
        mode: restoredMode,
        parseMode: restoredMode === "single" ? "normal" : restoredMode,
        playbackMode: playbackMode,
        backgroundOnly: false,
        generationState: generationState,
        offlineKey: t.offlineKey || offlineAudioKey(t.cacheKey),
        offlineReady: !!t.offlineReady,
        offlineWanted: !!t.offlineWanted,
        offlineSavedAt: t.offlineSavedAt || 0,
        offlineSize: t.offlineSize || 0,
        voicesMap: t.voicesMap || null,
        metrics: t.metrics || null,
        sampleRate: t.sampleRate || t.sample_rate || 0,
        duration_s: t.duration_s || (t.metrics && t.metrics.audio_duration_s) || 0,
        lastElementSec: 0,
        lastWebAudioSec: isFinite(Number(t.lastWebAudioSec)) ? Math.max(0, Number(t.lastWebAudioSec)) : 0,
        lastLiveProgressSec: isFinite(Number(t.lastLiveProgressSec)) ? Math.max(0, Number(t.lastLiveProgressSec)) : 0,
        liveResumeSec: isFinite(Number(t.liveResumeSec)) ? Math.max(0, Number(t.liveResumeSec)) : 0,
        lastStalledSec: isFinite(Number(t.lastStalledSec)) ? Math.max(0, Number(t.lastStalledSec)) : 0,
        segments: Array.isArray(t.segments) ? t.segments : [],
        fromHistory: ready,
        state: restoredState,
        playbackState: "idle",
        status: ready ? "ready" : (t.status || (restoredState === "failed" ? "failed" : (restoredState === "live" ? "running" : "pending"))),
        serverState: ready ? "done" : (t.serverState || (restoredState === "failed" ? "failed" : (restoredState === "live" ? "running" : "pending"))),
        cacheState: ready ? "ready" : (t.cacheState || t.remoteCacheState || "pending"),
        remoteCacheState: ready ? "ready" : (t.remoteCacheState || t.cacheState || "pending"),
        cacheReady: !!ready,
        error: t.error || "",
        offlineState: t.offlineState || "",
        streamHealth: t.streamHealth || "",
        stalledCount: Number(t.stalledCount || 0) || 0
      };
      setTrackState(restored, restoredState);
      if (t.offlineState) setTrackOfflineState(restored, t.offlineState);
      if (t.streamHealth) setTrackStreamHealth(restored, t.streamHealth);
      ensureTrackStates(restored);
      return restored;
    }
    async function ensureTracksLoaded() {
      if (tracksLoaded) return generatedTracks;
      if (tracksLoading) return tracksLoading;
      tracksLoading = (async function () {
        var history = persistableHistoryTracks(await loadTracksForMessage(messageId));
        var pending = await loadPendingJobsForMessage();
        knownHistoryCount = history && history.length ? history.length : 0;
        tracksLoaded = true;
        var base = cleanBase(cfg.apiBase);
        var restoredVisible = [];
        var historyCacheKeys = {};
        if (history && history.length) {
          history.forEach(function (t) {
            var restored = restoreTrackFromHistory(t, base);
            if (restored) {
              if (restored.cacheKey) historyCacheKeys[restored.cacheKey] = true;
              pushUniqueRestoredTrack(restoredVisible, restored);
              if (!isTerminalTrack(restored) && !isSavedTrack(restored)) pollCacheUpgrade(restored, "history restore");
            }
          });
        }
        var detachedPendingCount = 0;
        var restoredPending = [];
        if (pending && pending.length) {
          pending.forEach(function (t) {
            if (t && t.cacheKey && historyCacheKeys[t.cacheKey]) return;
            var restored = restoreTrackFromPending(t, base);
            if (restored) {
              if (restored.backgroundOnly) {
                detachedPendingCount += 1;
                rememberDetachedBackgroundJob(restored);
                pollCacheUpgrade(restored, "pending restore");
              } else {
                if (pushUniqueRestoredTrack(restoredVisible, restored)) {
                  restoredPending.push(restored);
                  pollCacheUpgrade(restored, "pending restore");
                }
              }
            }
          });
        }
        restoredVisible.sort(compareTrackRecords);
        generatedTracks.splice.apply(generatedTracks, [0, generatedTracks.length].concat(restoredVisible));
        if (!generatedTracks.length) {
          updateTrackButtons();
          if (detachedPendingCount) {
            setStatus("后台生成中 · 历史音频 " + knownHistoryCount + " 条");
            showTrackNotice(null, "后台生成中", "完成后会加入普通历史音频");
          } else {
            setStatus(historyStatusText());
            showTrackNotice(null, "历史音频 0 条", "点音符生成音频");
          }
          return generatedTracks;
        }
        currentTrackIndex = generatedTracks.length - 1;
        var activeLiveVisible = generatedTracks.filter(function (t) {
          if (!t || t.deleted || isSavedTrack(t) || isTerminalTrack(t)) return false;
          if (t.backgroundOnly || normalizePlaybackMode(t.playbackMode) !== "live" || t.livePageExited) return false;
          return trackState(t) === "live" || trackState(t) === "pending" || !!(t.pendingBlob || t.streaming || t.cachePollStarted);
        });
        if (activeLiveVisible.length) {
          var latestPending = activeLiveVisible.slice().sort(compareTrackRecords).pop();
          var pendingIndex = generatedTracks.indexOf(latestPending);
          if (pendingIndex >= 0) currentTrackIndex = pendingIndex;
        } else {
          var savedVisible = generatedTracks.filter(function (t) { return t && isSavedTrack(t); });
          if (savedVisible.length) {
          var latestSaved = savedVisible.slice().sort(compareTrackRecords).pop();
          var savedIndex = generatedTracks.indexOf(latestSaved);
          if (savedIndex >= 0) currentTrackIndex = savedIndex;
          }
        }
        updateTrackButtons();
        setStatus(historyStatusText());
        showTrackNotice(currentTrack(), historyStatusText(), detachedPendingCount ? "后台生成会继续检查落盘" : "点播放继续，或用左右按钮切换历史音频");
        debugLog("📂 按需恢复 tracks: history=" + (history ? history.length : 0) + " pending=" + (pending ? pending.length : 0) + " detached=" + detachedPendingCount, "#9ff");
        return generatedTracks;
      })().catch(function (e) {
        tracksLoaded = false;
        throw e;
      }).finally(function () {
        tracksLoading = null;
      });
      return tracksLoading;
    }
    async function initializeHistoryCount() {
      if (!messageId || tracksLoaded) return;
      knownHistoryCount = localHistoryCountForMessage(messageId);
      updateTrackButtons();
      setStatus(historyStatusText());
      showTrackNotice(null, historyStatusText(), knownHistoryCount ? "点开播放器后可播放历史音频" : "点音符生成音频");
      // 兜底：若本版 tavo.get 是异步实现，上面的同步读会落空，这里异步从 tavo 持久层
      // 再确认一次条数（只读变量，不请求 /voices、不生成）。
      try {
        var arr = await loadTracksForMessage(messageId);
        if (tracksLoaded || generatedTracks.length) return;
        var n = persistableHistoryTracks(arr).length;
        if (n !== knownHistoryCount) {
          knownHistoryCount = n;
          updateTrackButtons();
          setStatus(historyStatusText());
          showTrackNotice(null, historyStatusText(), knownHistoryCount ? "点开播放器后可播放历史音频" : "点音符生成音频");
        }
      } catch (_) {}
    }
    async function selectSavedTrackByDelta(delta, autoplay) {
      await ensureTracksLoaded();
      var visibleList = visibleTrackCards();
      if (!visibleList.length) {
        setStatus("历史音频 0 条");
        showTrackNotice(null, "历史音频 0 条", "点音符生成音频");
        updateTrackButtons();
        return false;
      }
      var active = currentTrack();
      var currentVisibleIndex = active ? visibleList.indexOf(active) : -1;
      if (currentVisibleIndex < 0) currentVisibleIndex = delta < 0 ? 0 : -1;
      var nextTrack = visibleList[(currentVisibleIndex + delta + visibleList.length) % visibleList.length];
      var nextIndex = generatedTracks.indexOf(nextTrack);
      if (nextIndex < 0) return false;
      if (nextTrack && isSavedTrack(nextTrack)) {
        nextTrack.lastElementSec = 0;
        nextTrack.savedElementUserPaused = false;
        nextTrack.savedSeekKeepPlayingUntil = 0;
      }
      await selectTrack(nextIndex, autoplay);
      return true;
    }
    async function confirmDeleteTrack(track) {
      if (!track) return false;
      if (!isSavedTrack(track)) return true;
      var label = generatedTracks.length ? ((currentTrackIndex + 1) + "/" + generatedTracks.length) : "当前音频";
      try {
        if (window.tavo && tavo.utils && typeof tavo.utils.select === "function") {
          var choice = await tavo.utils.select([
            { value: "cancel", label: "取消", description: "保留这条历史音频" },
            { value: "delete", label: "确认删除", description: "删除当前卡片和关联缓存" }
          ], "删除 " + label + "？", "cancel");
          return choice === "delete";
        }
      } catch (e) {
        debugLog("⚠️ 删除确认弹窗失败: " + (e && e.message ? e.message : e), "#fc9");
      }
      return typeof window.confirm === "function" ? window.confirm("确认删除当前音频？这会删除历史记录和关联缓存。") : true;
    }
    async function deleteRemoteTrack(track, opts) {
      opts = opts || {};
      if (!track) return { ok: true, skipped: true };
      var base = cleanBase(cfg.apiBase);
      try {
        async function readDeleteResponse(res) {
          var payload = null;
          try { payload = await res.clone().json(); }
          catch (_) {
            try { payload = { message: await res.text() }; } catch (__) { payload = {}; }
          }
          if (!res.ok) {
            var msg = payload && (payload.message || payload.Exception || payload.error);
            throw new Error((msg ? String(msg) + " · " : "") + "HTTP " + res.status);
          }
          return payload || {};
        }
        if (track.cacheKey) {
          var streamUrl = base + "/tts_dialogue_stream_job/" + encodeURIComponent(track.cacheKey);
          if (opts.preserveCompleted) streamUrl = withQueryParam(streamUrl, "preserve_completed", "1");
          var streamRes = await fetch(streamUrl, { method: "DELETE", cache: "no-store" });
          var streamPayload = await readDeleteResponse(streamRes);
          var cachePayload = null;
          if (!opts.streamOnly && !streamPayload.preserved) {
            var cacheRes = await fetch(base + "/cache/" + encodeURIComponent(track.cacheKey), { method: "DELETE", cache: "no-store" });
            cachePayload = await readDeleteResponse(cacheRes);
          }
          return { ok: true, stream: streamPayload, cache: cachePayload, preserved: !!(streamPayload && streamPayload.preserved), state: streamPayload && streamPayload.state };
        } else if (track.deleteUrl) {
          var res = await fetch(track.deleteUrl, { method: "DELETE", cache: "no-store" });
          return { ok: true, stream: await readDeleteResponse(res) };
        }
      } catch (e) {
        debugLog("⚠️ 删除服务端关联缓存失败: " + (e && e.message ? e.message : e), "#fc9");
        if (opts.strict) throw e;
        return { ok: false, error: e };
      }
      return { ok: true, skipped: true };
    }
    async function persistSavedLiveTrackAfterExit(track, label) {
      if (!track || !track.cacheKey) return false;
      if (!track.cacheUrl) track.cacheUrl = cleanBase(cfg.apiBase) + "/cache_audio/" + encodeURIComponent(track.cacheKey);
      try { stopServerLogPolling(); } catch (_) {}
      stopWebAudioPlayback("live exit saved");
      clearElementAudioSrc();
      stopSubtitle();
      hideSubtitlePanel();
      setTrackState(track, "saved");
      setTrackPlaybackState(track, "idle");
      setPlayState("idle");
      attachCacheAudio(track, { deferElement: true });
      scheduleOfflineAudioSave(track, (label || "live exit saved") + " offline", 0);
      knownHistoryCount = persistableHistoryTracks(generatedTracks).length;
      if (messageId) await saveTracksForMessage(messageId, generatedTracks, { strict: true });
      try { await removePendingJobForTrack(track, { strict: true }); }
      catch (e) { debugLog("⚠️ 已保存历史，但清理 pending 失败: " + (e && e.message ? e.message : e), "#fc9"); }
      updateTrackButtons();
      debugLog("✅ " + (label || "live exit") + " 检测到已落盘，保留为历史音频 cacheKey=" + track.cacheKey, "#9f9");
      return true;
    }
    async function exitLivePageKeepingGeneratingTrack(track, label) {
      if (!track || !track.cacheKey) return false;
      try { stopServerLogPolling(); } catch (_) {}
      stopWebAudioPlayback("live exit saving");
      clearElementAudioSrc();
      stopSubtitle();
      hideSubtitlePanel();
      track.livePageExited = true;
      track.livePageSuspended = false;
      track.pausedByUser = false;
      track.allowStreamPlay = false;
      track.playSavedWhenReady = false;
      track.streaming = false;
      track.pendingBlob = true;
      track.generationState = "saving";
      track.status = "saving";
      track.serverState = "running";
      track.cacheState = "pending";
      track.remoteCacheState = "pending";
      setTrackPlaybackState(track, "idle");
      setPlayState("idle");
      pollCacheUpgrade(track, label || "live exit saving");
      knownHistoryCount = persistableHistoryTracks(generatedTracks).length;
      if (messageId) await saveTracksForMessage(messageId, generatedTracks, { strict: true });
      setStatus("正在保存完整音频");
      showTrackNotice(track, "正在保存完整音频", "后端已进入保存阶段，任务不会删除，落盘后保留历史音频");
      updateTrackButtons();
      debugLog("✅ " + (label || "live exit") + " 已退出 LIVE 页面，保留正在保存的普通卡 cacheKey=" + track.cacheKey, "#9f9");
      return true;
    }
    async function checkLiveExitSaved(track, label) {
      if (!track || !track.cacheKey) return false;
      if (await refreshTrackFromStatus(track, label || "live exit status check")) {
        if (isSavedTrack(track)) return persistSavedLiveTrackAfterExit(track, label || "live exit status check");
        return false;
      }
      if (await promoteTrackIfCacheReady(track, label || "live exit cache check")) {
        if (isSavedTrack(track)) return persistSavedLiveTrackAfterExit(track, label || "live exit cache check");
      }
      return false;
    }
    async function clearCurrentTrack() {
      if (currentTrackIndex < 0) return;
      var target = currentTrack();
      if (isCancelableLiveTrack(target)) {
        setStatus("正在删除任务…");
        showTrackNotice(target, "正在删除任务…", "正在停止后端任务并移除当前卡片");
        var deleteResult = await cancelLiveTrack(target, "delete current task");
        if (!deleteResult || !deleteResult.ok || deleteResult.preserved) return;
        if (!generatedTracks.length) {
          showEmptyAfterLiveCancel("delete current task");
          return;
        }
        var nextIndex = Math.max(0, Math.min(currentTrackIndex, generatedTracks.length - 1));
        await selectTrack(nextIndex, false);
        return;
      }
      if (!await confirmDeleteTrack(target)) return;
      setStatus("正在删除音频…");
      showTrackNotice(target, "正在删除音频…", "正在检查并删除 Tavo 离线音频");
      var offlineDeleted = await deleteOfflineAudioForTrack(target);
      if (!offlineDeleted) {
        setTrackPlaybackState(target, "idle");
        setPlayState("idle");
        setStatus("删除失败");
        showTrackNotice(target, "删除失败", "Tavo 离线音频删除失败，当前卡片已保留，可稍后重试");
        updateTrackButtons();
        return;
      }
      var removed = generatedTracks.splice(currentTrackIndex, 1)[0];
      if (removed) removed.deleted = true;
      try { audio.pause(); } catch (_) {}
      stopWebAudioPlayback("switch");
      if (removed && removed.url && /^blob:/i.test(removed.url)) {
        try { URL.revokeObjectURL(removed.url); } catch (_) {}
      }
      deleteRemoteTrack(removed).catch(function () {});
      removePendingJobForTrack(removed).catch(function () {});
      knownHistoryCount = persistableHistoryTracks(generatedTracks).length;
      // 删除后同步把变更写回 tavo.set，下次进页面就不会再看到这张卡片
      if (messageId) {
        saveTracksForMessage(messageId, generatedTracks).catch(function(){});
        debugLog("🗑 删除卡片并同步 tavo.set（剩 " + generatedTracks.length + " 张）", "#fc9");
      }
      currentTrackIndex = Math.min(currentTrackIndex, generatedTracks.length - 1);
      if (currentTrackIndex >= 0) {
        await selectTrack(currentTrackIndex, false);
      } else {
        clearElementAudioSrc();
        currentCacheKey = "";
        if (seek) { seek.disabled = true; seek.value = "0"; }
        if (cur) cur.textContent = "00:00";
        if (total) total.textContent = "--:--";
        setPlayState("idle");
        setStatus("历史音频 0 条");
        showTrackNotice(null, "历史音频 0 条", "点音符生成音频");
        updateTrackButtons();
      }
    }
    async function cancelLiveTrack(track, reason) {
      if (!track || track.deleted || isSavedTrack(track) || normalizePlaybackMode(track.playbackMode) !== "live") return { ok: false, skipped: true };
      var idx = generatedTracks.indexOf(track);
      if (track.cacheKey) {
        try {
          if (await checkLiveExitSaved(track, reason || "live exit")) {
            setStatus("完整音频已保存");
            showTrackNotice(track, "完整音频已保存", "已保留为历史音频");
            return { ok: true, preserved: true, state: "saved" };
          }
        } catch (e) {
          var savedErr = e && e.message ? e.message : String(e);
          setStatus("退出流式失败");
          showTrackNotice(track, "退出流式失败", "检测到可能已落盘，但同步本地历史失败：" + savedErr);
          updateTrackButtons();
          return { ok: false, error: e };
        }
        var remoteResult;
        try {
          remoteResult = await deleteRemoteTrack(track, { strict: true, preserveCompleted: true, streamOnly: true });
        } catch (e) {
          var remoteErr = e && e.message ? e.message : String(e);
          setStatus("退出流式失败");
          showTrackNotice(track, "退出流式失败", "后端取消没有确认成功：" + remoteErr);
          updateTrackButtons();
          return { ok: false, error: e };
        }
        var streamPayload = remoteResult && remoteResult.stream ? remoteResult.stream : {};
        if (remoteResult && (remoteResult.preserved || streamPayload.preserved || streamPayload.state === "done")) {
          try {
            if (streamPayload.cache_url) track.cacheUrl = new URL(streamPayload.cache_url, cleanBase(cfg.apiBase) + "/").href;
            await persistSavedLiveTrackAfterExit(track, reason || "live exit preserved");
            setStatus("完整音频已保存");
            showTrackNotice(track, "完整音频已保存", "退出流式时检测到已落盘，保留历史音频");
            return { ok: true, preserved: true, state: "saved" };
          } catch (e) {
            var preserveErr = e && e.message ? e.message : String(e);
            setStatus("退出流式失败");
            showTrackNotice(track, "退出流式失败", "音频已落盘，但本地历史同步失败：" + preserveErr);
            updateTrackButtons();
            return { ok: false, preserved: true, error: e };
          }
        }
        if (streamPayload.state === "saving") {
          try {
            await exitLivePageKeepingGeneratingTrack(track, reason || "live exit saving");
            return { ok: true, preserved: true, state: "saving" };
          } catch (e) {
            var savingErr = e && e.message ? e.message : String(e);
            setStatus("退出流式失败");
            showTrackNotice(track, "退出流式失败", "任务已进入保存阶段，但本地历史同步失败：" + savingErr);
            updateTrackButtons();
            return { ok: false, preserved: true, error: e };
          }
        }
        try {
          var nextTracks = generatedTracks.filter(function (t) { return t !== track; });
          if (messageId) await saveTracksForMessage(messageId, nextTracks, { strict: true });
          await removePendingJobForTrack(track, { strict: true });
        } catch (e) {
          var persistErr = e && e.message ? e.message : String(e);
          setStatus("退出流式失败");
          showTrackNotice(track, "退出流式失败", "后端已取消，但本地任务清理失败，卡片保留便于重试：" + persistErr);
          updateTrackButtons();
          return { ok: false, error: e };
        }
      }
      try {
        if (track.jobCreateAbortController && typeof track.jobCreateAbortController.abort === "function") {
          track.jobCreateAbortController.abort();
        }
      } catch (_) {}
      try {
        if (track.abortController && typeof track.abortController.abort === "function") {
          track.abortController.abort();
        }
      } catch (_) {}
      track.deleted = true;
      track.cancelled = true;
      track.playSavedWhenReady = false;
      track.allowStreamPlay = false;
      track.cachePollStarted = false;
      setTrackState(track, "cancelled");
      try { stopServerLogPolling(); } catch (_) {}
      try { audio.pause(); } catch (_) {}
      stopWebAudioPlayback("cancel");
      clearElementAudioSrc();
      stopSubtitle();
      hideSubtitlePanel();
      if (track.url && /^blob:/i.test(String(track.url))) {
        try { URL.revokeObjectURL(track.url); } catch (_) {}
      }
      deleteOfflineAudioForTrack(track).catch(function () {});
      if (!track.cacheKey) removePendingJobForTrack(track).catch(function () {});
      if (idx >= 0) {
        generatedTracks.splice(idx, 1);
        currentTrackIndex = Math.min(idx, generatedTracks.length - 1);
      }
      knownHistoryCount = persistableHistoryTracks(generatedTracks).length;
      tracksLoaded = true;
      if (messageId) {
        try { await saveTracksForMessage(messageId, generatedTracks, { strict: !!track.cacheKey }); }
        catch (e) { debugLog("⚠️ live 退出后同步历史失败: " + (e && e.message ? e.message : e), "#fc9"); }
      }
      debugLog("🛑 live 流式已退出并删除: " + (reason || "live exit") + (track.cacheKey ? " cacheKey=" + track.cacheKey : ""), "#fc9");
      return { ok: true, removed: true };
    }
    function showEmptyAfterLiveCancel(reason) {
      clearElementAudioSrc();
      currentCacheKey = "";
      if (seek) { seek.disabled = true; seek.value = "0"; }
      if (cur) cur.textContent = "00:00";
      if (total) total.textContent = "--:--";
      setPlayState("idle");
      setStatus(historyStatusText());
      showTrackNotice(null, historyStatusText(), knownHistoryCount ? "点开播放器后可播放历史音频" : "点音符生成音频");
      updateTrackButtons();
      if (reason) debugLog("🛑 live 流式已中止: " + reason, "#fc9");
    }
    async function exitCurrentLiveTrack(reason) {
      var track = currentTrack();
      if (isSavedTrack(track)) {
        await selectTrack(currentTrackIndex, false);
        return true;
      }
      if (!isCancelableLiveTrack(track)) return false;
      if (track.cacheKey) {
        try {
          if (await checkLiveExitSaved(track, "live exit status check")) {
            await selectTrack(currentTrackIndex, false);
            return true;
          }
        } catch (e) {
          var checkErr = e && e.message ? e.message : String(e);
          setStatus("退出流式失败");
          showTrackNotice(track, "退出流式失败", "检测落盘/同步历史失败：" + checkErr);
          updateTrackButtons();
          return false;
        }
      }
      setStatus("正在退出流式…");
      showTrackNotice(track, "正在退出流式…", "完整音频未落盘，本次任务会被删除");
      var result = await cancelLiveTrack(track, reason || "live exit");
      if (!result || !result.ok) return false;
      if (result.preserved) {
        if (isSavedTrack(track)) await selectTrack(currentTrackIndex, false);
        return true;
      }
      if (!generatedTracks.length) {
        showEmptyAfterLiveCancel(reason || "live exit");
        return true;
      }
      var nextIndex = Math.max(0, Math.min(currentTrackIndex, generatedTracks.length - 1));
      await selectTrack(nextIndex, false);
      return true;
    }
