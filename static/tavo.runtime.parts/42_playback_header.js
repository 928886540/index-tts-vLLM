// IndexTTS Tavo runtime part: 42_playback_header.js // Role: header, status, seek helpers // This fragment is concatenated by static/tavo.runtime.js; it is not a standalone script.
    function currentTrack() { return currentTrackIndex >= 0 ? generatedTracks[currentTrackIndex] : null; }
    function currentVoicesMap(track) {
      if (track && track.voicesMap) return track.voicesMap;
      if (normalizeModeName((track && track.mode) || cfg.mode) === "normal") return normalModeVoicesMap(cfg);
      return rolesListToVoicesMap(cfg.roleVoiceList, cfg.defaultVoice, cfg.currentCharacterName);
    }
    function voiceNameForRole(role, track) {
      var voices = currentVoicesMap(track);
      role = String(role || "").trim();
      var mode = normalizeModeName((track && track.mode) || cfg.mode);
      if (mode === "ai") return (role && voices[role]) || "";
      return (role && voices[role]) || voices.default || cfg.defaultVoice || "";
    }
    function displayRoleName(role) {
      role = String(role || "").trim();
      if (role === "用户") return (context && context.userName) ? context.userName : "用户";
      return role || "旁白";
    }
    function playbackLabelForRole(role, track) {
      role = String(role || "").trim() || (normalizeModeName((track && track.mode) || cfg.mode) === "ai" ? "AI模式" : "普通模式");
      var voice = voiceNameForRole(role, track);
      return voice ? shortName(voice) : "音色未设置";
    }
    function representativeVoiceForMode(mode, voicesMap, fallback) {
      mode = normalizeModeName(mode);
      voicesMap = voicesMap || {};
      if (mode === "ai") {
        var preferred = [cfg.currentCharacterName, "旁白", "用户"].filter(Boolean);
        for (var i = 0; i < preferred.length; i += 1) {
          if (voicesMap[preferred[i]]) return voicesMap[preferred[i]];
        }
        var keys = Object.keys(voicesMap);
        for (var j = 0; j < keys.length; j += 1) {
          if (keys[j] !== "default" && voicesMap[keys[j]]) return voicesMap[keys[j]];
        }
        return "";
      }
      return voicesMap.default || voicesMap["旁白"] || voicesMap["对白"] || fallback || "";
    }
    function trackPlaybackLabel(track) {
      if (!track) return cfg.defaultVoice ? shortName(cfg.defaultVoice) : "音色未设置";
      var mode = normalizeModeName(track.mode);
      if (mode === "ai" || mode === "normal") {
        var role = lastSpeakerRole || ((track.segments && track.segments[0] && track.segments[0].role) || "");
        if (role) return playbackLabelForRole(role, track);
        var voice = representativeVoiceForMode(mode, track.voicesMap, cfg.defaultVoice);
        return voice ? shortName(voice) : "音色未设置";
      }
      var singleVoice = (track && track.voice) || cfg.defaultVoice;
      return singleVoice ? shortName(singleVoice) : "音色未设置";
    }
    function setPlayingStatusForRole(role, track) {
      setStatus(playbackLabelForRole(role, track || currentTrack()));
    }
    function setAudioPlaybackRate() {
      try { audio.playbackRate = clampNumber(cfg.speedFactor || 1.0, 1.0, 0.85, 1.25); } catch (_) {}
    }
    function markElementAudioTrack(track, sourceKind, liveOffsetSec) {
      try {
        if (!audio) return;
        if (track && track.cacheKey) audio.dataset.idxCacheKey = String(track.cacheKey);
        else delete audio.dataset.idxCacheKey;
        audio.dataset.idxSourceKind = sourceKind || "";
        if ((sourceKind === "stream" || sourceKind === "live-segment" || sourceKind === "live-mp3") && isFinite(Number(liveOffsetSec))) audio.dataset.idxLiveOffsetSec = String(Math.max(0, Number(liveOffsetSec) || 0));
        else delete audio.dataset.idxLiveOffsetSec;
      } catch (_) {}
    }
    function elementAudioBelongsToTrack(track) {
      if (!track || !audio) return false;
      var kind = "";
      try { kind = audio.dataset.idxSourceKind || ""; } catch (_) { kind = ""; }
      try {
        if (track.cacheKey && audio.dataset.idxCacheKey === String(track.cacheKey)) {
          if (!isSavedTrack(track)) return true;
          return kind === "saved" || kind === "saved-blob" || kind === "offline" || kind === "offline-blob" || kind === "stream" || kind === "live-segment" || kind === "live-mp3";
        }
      } catch (_) {}
      var src = "";
      try { src = audio.currentSrc || audio.src || ""; } catch (_) {}
      return !!(src && src === trackPlayableUrl(track));
    }
    function savedElementAudioBelongsToTrack(track) {
      if (!track || !audio || !isSavedTrack(track)) return false;
      var kind = "";
      try { kind = audio.dataset.idxSourceKind || ""; } catch (_) { kind = ""; }
      if (kind === "stream" || kind === "live-segment" || kind === "live-mp3") return false;
      var src = "";
      try { src = audio.currentSrc || audio.src || ""; } catch (_) {}
      if (/\/tts_dialogue_stream_job\//.test(String(src || ""))) return false;
      if (elementAudioBelongsToTrack(track)) return true;
      if (!src) return false;
      var candidates = [track.offlineUrl, track.cacheUrl, track.url, trackPlayableUrl(track)];
      for (var i = 0; i < candidates.length; i += 1) {
        if (candidates[i] && sameAudioUrl(src, candidates[i])) return true;
      }
      return false;
    }
    function savedSourceKindForUrl(track, url) {
      if (track && sameAudioUrl(url, track.offlineUrl)) {
        return /^blob:|^data:/i.test(String(url || track.offlineUrl || "")) ? "offline-blob" : "offline";
      }
      return "saved";
    }
    function elementLiveAudioBelongsToTrack(track) {
      if (!track || !audio) return false;
      var kind = "";
      var src = "";
      try { kind = audio.dataset.idxSourceKind || ""; } catch (_) { kind = ""; }
      if (kind !== "stream" && kind !== "live-segment" && kind !== "live-mp3") return false;
      try {
        if (track.cacheKey && audio.dataset.idxCacheKey === String(track.cacheKey)) return true;
      } catch (_) {}
      try { src = audio.currentSrc || audio.src || ""; } catch (_) { src = ""; }
      if (!src) return false;
      if (kind === "stream" && track.streamUrl && sameAudioUrl(src, track.streamUrl)) return true;
      if (track.cacheKey && /\/tts_dialogue_stream_job\//.test(src) && src.indexOf(encodeURIComponent(String(track.cacheKey))) >= 0) return true;
      if (track.cacheKey && /\/tts_dialogue_stream_job\//.test(src) && src.indexOf(String(track.cacheKey)) >= 0) return true;
      return false;
    }
    function liveElementOffsetSec(track) {
      if (!track || !audio) return 0;
      try {
        if ((audio.dataset.idxSourceKind === "stream" || audio.dataset.idxSourceKind === "live-segment" || audio.dataset.idxSourceKind === "live-mp3") && audio.dataset.idxLiveOffsetSec != null) {
          return Math.max(0, Number(audio.dataset.idxLiveOffsetSec) || 0);
        }
      } catch (_) {}
      return Math.max(0, Number(track.liveElementOffsetSec || 0) || 0);
    }
    function isTrackUsingSeekableLiveOutput(track) {
      if (!track || !audio) return false;
      if (isSavedTrack(track)) return false;
      try {
        if (isElementUsingTrackLiveMp3(track) || isElementUsingTrackLiveSegment(track) || isElementUsingTrackStream(track) || isElementPlayingTrackStream(track)) return true;
      } catch (_) {}
      try {
        if (typeof webAudioBelongsToTrack === "function" && webAudioBelongsToTrack(track)) return true;
      } catch (_) {}
      return false;
    }
    function elementPlaybackTimeSec(track) {
      var current = 0;
      try { current = Math.max(0, Number(audio.currentTime || 0) || 0); } catch (_) { current = 0; }
      if (track && isLiveProgressTrack(track) && !elementLiveAudioBelongsToTrack(track)) {
        return bestStoredLiveResumeSec(track);
      }
      return clampPlaybackTimeSec(track, (elementLiveAudioBelongsToTrack(track) ? liveElementOffsetSec(track) : 0) + current);
    }
    function resetLiveProgressForTrack(track, reason) {
      if (!track) return;
      track.liveResumeSec = 0;
      track.lastLiveProgressSec = 0;
      track.lastWebAudioSec = 0;
      track.lastElementSec = 0;
      track.lastStalledSec = 0;
      track.liveElementOffsetSec = 0;
      track.liveMp3StartSec = 0;
      track.streamPlaybackFinished = false;
      track.liveEndedAwaitSaved = false;
      try {
        if (currentTrack && currentTrack() === track) {
          if (cur) cur.textContent = "00:00";
          if (seek) seek.value = "0";
        }
      } catch (_) {}
      if (reason) debugLog("↩️ 清理 LIVE 进度: " + reason + " cacheKey=" + (track.cacheKey || ""), "#9ff");
    }
    function bestStoredLiveResumeSec(track) {
      if (!track) return 0;
      var best = 0;
      function take(v) {
        v = Number(v);
        if (isFinite(v) && v > best) best = v;
      }
      take(track.liveResumeSec);
      take(track.lastLiveProgressSec);
      take(track.lastWebAudioSec);
      return clampPlaybackTimeSec(track, best);
    }
    function savedTrackResumeSec(track) {
      if (!track) return 0;
      if (String(track.playbackState || "") === "ended") return 0;
      var stored = 0;
      if (isFinite(Number(track.lastElementSec))) stored = clampPlaybackTimeSec(track, Math.max(0, Number(track.lastElementSec) || 0));
      try {
        if (savedElementAudioBelongsToTrack(track) && isFinite(Number(audio.currentTime))) {
          var current = clampPlaybackTimeSec(track, Math.max(0, Number(audio.currentTime || 0) || 0));
          if (current > 0.05 || String(track.playbackState || "") === "playing") return current;
          if (stored > 0.05 && !audio.ended) return stored;
          return current;
        }
      } catch (_) {}
      return stored;
    }
    function trackResumeSec(track) {
      if (!track) return 0;
      if (isSavedTrack(track)) return savedTrackResumeSec(track);
      if (track.livePageSuspended || track.pausedByUser || String(track.playbackState || "") === "paused") {
        return bestStoredLiveResumeSec(track);
      }
      if (typeof webAudioPlaybackSecForTrack === "function" && webAudioActiveTrack === track) {
        var webSec = webAudioPlaybackSecForTrack(track);
        if (isFinite(Number(webSec)) && Number(webSec) > 0) return Math.max(0, Number(webSec));
      }
      var src = "";
      try { src = audio.currentSrc || audio.src || ""; } catch (_) {}
      var playable = trackPlayableUrl(track);
      if ((elementAudioBelongsToTrack(track) || elementLiveAudioBelongsToTrack(track) || (playable && src === playable)) && isFinite(Number(audio.currentTime))) return Math.max(0, elementPlaybackTimeSec(track));
      var storedResume = bestStoredLiveResumeSec(track);
      if (storedResume > 0) return storedResume;
      if ((track.state === "live" || track.state === "pending") && (track.streamHealth === "stalled" || track.streamHealth === "interrupted" || track.streamStalled) && isFinite(Number(track.lastStalledSec))) {
        return Math.max(0, (Number(track.lastStalledSec) || 0) - 0.5);
      }
      return 0;
    }
    function rememberNativeLiveElementResumeSec(track, reason, opts) {
      if (!track) return 0;
      var usingNativeLive = false;
      try {
        usingNativeLive = !!(isElementUsingTrackStream(track) || isElementUsingTrackLiveSegment(track) || isElementUsingTrackLiveMp3(track) || isElementPlayingTrackStream(track));
      } catch (_) {
        usingNativeLive = false;
      }
      var sec = NaN;
      if (usingNativeLive) {
        try {
          if (isFinite(Number(audio.currentTime))) sec = elementPlaybackTimeSec(track);
        } catch (_) { sec = NaN; }
      }
      if (!isFinite(Number(sec)) || Number(sec) <= 0) sec = bestStoredLiveResumeSec(track);
      if (!isFinite(Number(sec)) || Number(sec) <= 0) {
        try { sec = trackResumeSec(track); } catch (_) { sec = 0; }
      }
      sec = rememberLiveResumeSec(track, Math.max(0, Number(sec) || 0), reason || "native live element pause", opts);
      return sec;
    }
    function segmentStartSec(seg, sampleRate) {
      if (!seg) return NaN;
      if (isFinite(Number(seg.start_s))) return Math.max(0, Number(seg.start_s));
      if (isFinite(Number(seg.start_offset_s))) return Math.max(0, Number(seg.start_offset_s));
      sampleRate = Number(sampleRate || seg.sample_rate || 0);
      if (sampleRate > 0 && isFinite(Number(seg.start_offset_bytes))) {
        return Math.max(0, Number(seg.start_offset_bytes) / (sampleRate * 2));
      }
      return NaN;
    }
    function playbackSegmentStatusTextForTrack(track, payload, totalSegments, positionSec) {
      if (!track) return "";
      if (normalizePlaybackMode(track.playbackMode) !== "live") return "";
      var isPlaying = !!(
        track.webAudioPlaying
        || String(track.playbackState || "") === "playing"
        || (typeof isElementPlayingTrackStream === "function" && isElementPlayingTrackStream(track))
      );
      if (!isPlaying) return "";
      var sec = Number(positionSec);
      if (!isFinite(sec)) {
        try { sec = trackResumeSec(track); } catch (_) { sec = 0; }
      }
      if (!isFinite(sec) || sec < 0) return "";
      var raw = [];
      if (payload && Array.isArray(payload.segments_meta) && payload.segments_meta.length) raw = payload.segments_meta;
      else if (Array.isArray(track.segments) && track.segments.length) raw = track.segments;
      if (!raw.length) return "";
      var sampleRate = Number((payload && payload.sample_rate) || track.sampleRate || track.sample_rate || 0);
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
        track.segmentPlan && Array.isArray(track.segmentPlan) ? track.segmentPlan.length : 0,
        raw.length,
        displayIdx
      );
      return "正在播第 " + displayIdx + (total ? "/" + total : "") + " 段";
    }
    function trackDurationHintSec(track) {
      if (!track) return 0;
      var d = Number(track.duration_s || (track.metrics && track.metrics.audio_duration_s));
      if (isFinite(d) && d > 0) return d;
      var sr = Number(track.sampleRate || track.sample_rate || 0);
      var maxEnd = 0;
      (track.segments || []).forEach(function (s) {
        var st = segmentStartSec(s, sr);
        var dur = Number(s.duration_s || 0);
        if (isFinite(st) && isFinite(dur) && dur > 0) maxEnd = Math.max(maxEnd, st + dur);
      });
      return maxEnd;
    }
    function isLiveProgressTrack(track) {
      if (!track) return false;
      try {
        if (isSavedTrack(track)) return false;
        if (isElementUsingTrackLiveSegment(track) || isElementUsingTrackLiveMp3(track)) return true;
        if (track.webAudioPlaying || webAudioActiveTrack === track) return true;
        if (isElementUsingTrackStream(track) || isElementPlayingTrackStream(track)) return true;
        var state = trackState(track);
        return state === "live" || state === "pending";
      } catch (_) {
        return !!(track && (track.webAudioPlaying || track.streaming || track.pendingBlob));
      }
    }
    function clampPlaybackTimeSec(track, sec) {
      sec = Math.max(0, Number(sec || 0) || 0);
      var dur = trackDurationHintSec(track);
      var audioDur = Number(audio && audio.duration);
      if (!isElementUsingTrackStream(track) && isFinite(audioDur) && audioDur > 0) {
        dur = dur > 0 ? Math.max(dur, audioDur) : audioDur;
      }
      if (isLiveProgressTrack(track)) return sec;
      if (dur > 0 && sec > dur) return dur;
      return sec;
    }
    function progressDurationSec(track, positionSec) {
      positionSec = Math.max(0, Number(positionSec || 0) || 0);
      var dur = Number(audio && audio.duration);
      var hint = trackDurationHintSec(track);
      if (isLiveProgressTrack(track)) {
        if (hint > 0 && positionSec <= hint + 0.25) return hint;
        return 0;
      }
      if (isFinite(dur) && dur > 0) return hint > dur + 0.5 ? hint : dur;
      return hint > 0 ? hint : 0;
    }
    function progressMeterDurationSec(track, positionSec) {
      positionSec = Math.max(0, Number(positionSec || 0) || 0);
      var dur = progressDurationSec(track, positionSec);
      if (dur > 0) return dur;
      return 0;
    }
    function liveSeekDurationSec(track) {
      if (!track || isSavedTrack(track) || !isLiveProgressTrack(track)) return 0;
      var pos = 0;
      try { pos = trackResumeSec(track); } catch (_) { pos = bestStoredLiveResumeSec(track); }
      pos = Math.max(0, Number(pos || 0) || 0);
      function usable(d) {
        d = Number(d);
        return isFinite(d) && d > 0 && pos <= d + 0.25 ? d : 0;
      }
      var direct = usable(track.duration_s || (track.metrics && track.metrics.audio_duration_s));
      if (direct > 0) return direct;
      return usable(trackDurationHintSec(track));
    }
    function canSeekLiveTrack(track) {
      if (!track || track.deleted || isTerminalTrack(track)) return false;
      if (isSavedTrack(track)) return false;
      if (normalizePlaybackMode(track.playbackMode) !== "live" || track.backgroundOnly) return false;
      if (!track.cacheKey && !liveStreamUrlForTrack(track)) return false;
      return liveSeekDurationSec(track) > 0;
    }
    function canSeekTrackByControls(track) {
      if (!track || track.deleted || isTerminalTrack(track)) return false;
      if (isSavedTrack(track)) return !!(trackPlayableUrl(track) || track.cacheUrl || track.cacheKey);
      return canSeekLiveTrack(track);
    }
    function applySavedElementSeek(track, pos) {
      if (!track || !isSavedTrack(track)) return false;
      pos = Math.max(0, Number(pos) || 0);
      var url = trackPlayableUrl(track);
      if (!url && track.cacheKey) {
        track.cacheUrl = cleanBase(cfg.apiBase) + "/cache_audio/" + encodeURIComponent(track.cacheKey);
        track.url = track.cacheUrl;
        url = trackPlayableUrl(track);
      }
      if (!url) return false;
      var wasPlaying = false;
      try {
        wasPlaying = !!(
          String(track.playbackState || "") === "playing"
          || (play && play.dataset && play.dataset.state === "playing")
          || (!track.savedElementUserPaused && !audio.ended && Number(track.savedElementLastPlayingAt || 0) > 0 && Date.now() - Number(track.savedElementLastPlayingAt || 0) < 5000)
          || (savedElementAudioBelongsToTrack(track) && !audio.paused && !audio.ended)
        );
      } catch (_) { wasPlaying = String(track.playbackState || "") === "playing"; }
      stopWebAudioPlayback("switch");
      var sourceChanged = false;
      if (!savedElementAudioBelongsToTrack(track) || !sameAudioUrl(audio.currentSrc || audio.src || "", url)) {
        suppressElementPauseState(500);
        audio.src = url;
        try { audio.load(); } catch (_) {}
        markElementAudioTrack(track, savedSourceKindForUrl(track, url));
        sourceChanged = true;
      } else {
        markElementAudioTrack(track, savedSourceKindForUrl(track, url));
      }
      track.lastElementSec = pos;
      var apply = function () {
        try {
          if (currentTrack && currentTrack() !== track) return;
          var activeSrc = audio.currentSrc || audio.src || "";
          if (activeSrc && !sameAudioUrl(activeSrc, url) && !savedElementAudioBelongsToTrack(track)) return;
          var target = pos;
          if (isFinite(audio.duration) && audio.duration > 0) target = Math.min(target, Math.max(0, audio.duration - 0.05));
          audio.currentTime = Math.max(0, target);
          track.lastElementSec = Math.max(0, target);
          if (cur) cur.textContent = formatTime(target);
          var hint = progressDurationSec(track, target);
          if (total) total.textContent = hint > 0 ? formatTime(hint) : "--:--";
          if (seek) {
            var meter = progressMeterDurationSec(track, target);
            if (meter > 0) seek.value = String(Math.floor(Math.min(target, meter) / meter * 1000));
          }
          refreshActiveSubtitleForTrack(track, target, { force: true, scroll: true });
          markElementAudioTrack(track, savedSourceKindForUrl(track, url));
        } catch (_) {}
      };
      apply();
      try { audio.addEventListener("loadedmetadata", apply, { once: true }); } catch (_) {}
      try { audio.addEventListener("canplay", apply, { once: true }); } catch (_) {}
      setTimeout(apply, 80);
      setTimeout(apply, 260);
      if (wasPlaying && sourceChanged) {
        try {
          setAudioPlaybackRate();
          var p = audio.play();
          if (p && typeof p.catch === "function") p.catch(function (e) { handleAudioPlayReject("saved-seek", e, "请点播放继续"); });
        } catch (_) {}
      }
      if (wasPlaying) {
        track.savedSeekKeepPlayingUntil = Date.now() + 700;
        setTrackPlaybackState(track, "playing");
        setPlayState("playing");
        setStatus(trackPlaybackLabel(track));
        setTimeout(function () {
          try {
            if (currentTrack() === track && savedElementAudioBelongsToTrack(track) && !audio.ended) {
              setTrackPlaybackState(track, "playing");
              setPlayState("playing");
              setStatus(trackPlaybackLabel(track));
            }
          } catch (_) {}
        }, 320);
      }
      return true;
    }
    function seekToSeconds(pos, opts) {
      opts = opts || {};
      var track = currentTrack();
      pos = Math.max(0, Number(pos) || 0);
      if (track && isSavedTrack(track)) {
        return applySavedElementSeek(track, pos);
      }
      if (track && canSeekLiveTrack(track) && liveStreamUrlForTrack(track)) {
        var liveDur = liveSeekDurationSec(track);
        if (liveDur > 0) pos = Math.min(pos, Math.max(0, liveDur - 0.05));
        pos = rememberLiveResumeSec(track, pos, opts.noticeTitle || "live seek", { allowBackward: true });
        track.pausedByUser = false;
        setStatus(opts.noticeTitle || "跳转实时音频…");
        showTrackNotice(track, opts.noticeTitle || "跳转实时音频", "从 " + formatTime(pos) + " 继续同一个任务");
        return playLiveTrack(track, liveStreamUrlForTrack(track), {
          noticeTitle: opts.noticeTitle || "跳转实时音频…",
          noticeDetail: "从 " + formatTime(pos) + " 继续",
          waitDetail: "等待后端返回对应位置音频",
          startOffsetSec: pos
        });
      }
      if (track && isCancelableLiveTrack(track)) {
        if (seek) seek.value = "0";
        setStatus(busyGenerationStatus(track, "seek"));
        showTrackNotice(track, track.backgroundOnly || normalizePlaybackMode(track.playbackMode) === "generate" ? "后台生成中" : "流式生成中", track.backgroundOnly || normalizePlaybackMode(track.playbackMode) === "generate" ? "完成后会变成可播放的历史音频" : "当前实时流还没有可跳转位置");
        return false;
      }
      var dur = Number(audio && audio.duration);
      if (audio && (audio.currentSrc || audio.src) && isFinite(dur) && dur > 0) {
        audio.currentTime = Math.max(0, Math.min(dur - 0.05, pos));
        return true;
      }
      if (track && isSavedTrack(track) && trackPlayableUrl(track)) {
        startElementAudioFrom(track, pos);
        return true;
      }
      if (track && (track.webAudioPlaying || isLiveTrack(track) || liveStreamUrlForTrack(track))) {
        track.lastWebAudioSec = pos;
        var liveUrl = liveStreamUrlForTrack(track);
        if (liveUrl) {
          playLiveTrack(track, liveUrl, {
            noticeTitle: opts.noticeTitle || "跳转播放",
            noticeDetail: "从 " + formatTime(pos) + " 继续",
            waitDetail: "等待后端返回对应位置音频",
            startOffsetSec: pos
          });
          return true;
        }
      }
      return false;
    }
    function seekBySeconds(delta) {
      delta = Number(delta) || 0;
      var track = currentTrack();
      var dur = Number(audio && audio.duration);
      if (track && isLiveProgressTrack(track) && !canSeekLiveTrack(track)) return false;
      var maxDur = track && isLiveProgressTrack(track) ? liveSeekDurationSec(track) : ((isFinite(dur) && dur > 0) ? dur : trackDurationHintSec(track));
      var target = Math.max(0, trackResumeSec(track) + delta);
      if (maxDur > 0) target = Math.min(target, Math.max(0, maxDur - 0.05));
      return seekToSeconds(target, { noticeTitle: delta < 0 ? "后退 10 秒" : "快进 10 秒" });
    }
