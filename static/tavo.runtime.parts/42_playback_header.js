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
    function trackPlaybackLabel(track) {
      if (!track) return cfg.defaultVoice ? shortName(cfg.defaultVoice) : "音色未设置";
      var mode = normalizeModeName(track.mode);
      if (mode === "ai" || mode === "normal") {
        var role = lastSpeakerRole || ((track.segments && track.segments[0] && track.segments[0].role) || "");
        if (role) return playbackLabelForRole(role, track);
        var voice = (track.voicesMap && (track.voicesMap.default || track.voicesMap["旁白"] || track.voicesMap["对白"])) || cfg.defaultVoice;
        return voice ? shortName(voice) : (mode === "ai" ? "AI模式" : "普通模式");
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
        if (sourceKind === "stream" && isFinite(Number(liveOffsetSec))) audio.dataset.idxLiveOffsetSec = String(Math.max(0, Number(liveOffsetSec) || 0));
        else delete audio.dataset.idxLiveOffsetSec;
      } catch (_) {}
    }
    function elementAudioBelongsToTrack(track) {
      if (!track || !audio) return false;
      try {
        if (track.cacheKey && audio.dataset.idxCacheKey === String(track.cacheKey)) return true;
      } catch (_) {}
      var src = "";
      try { src = audio.currentSrc || audio.src || ""; } catch (_) {}
      return !!(src && src === trackPlayableUrl(track));
    }
    function liveElementOffsetSec(track) {
      if (!track || !audio) return 0;
      try {
        if (audio.dataset.idxSourceKind === "stream" && audio.dataset.idxLiveOffsetSec != null) {
          return Math.max(0, Number(audio.dataset.idxLiveOffsetSec) || 0);
        }
      } catch (_) {}
      return Math.max(0, Number(track.liveElementOffsetSec || 0) || 0);
    }
    function elementPlaybackTimeSec(track) {
      var current = 0;
      try { current = Math.max(0, Number(audio.currentTime || 0) || 0); } catch (_) { current = 0; }
      return clampPlaybackTimeSec(track, (isElementUsingTrackStream(track) ? liveElementOffsetSec(track) : 0) + current);
    }
    function trackResumeSec(track) {
      if (!track) return 0;
      if (isSavedTrack(track) && String(track.playbackState || "") === "ended") return 0;
      if (typeof webAudioPlaybackSecForTrack === "function" && webAudioActiveTrack === track) {
        var webSec = webAudioPlaybackSecForTrack(track);
        if (isFinite(Number(webSec)) && Number(webSec) > 0) return Math.max(0, Number(webSec));
      }
      var src = "";
      try { src = audio.currentSrc || audio.src || ""; } catch (_) {}
      var playable = trackPlayableUrl(track);
      if ((elementAudioBelongsToTrack(track) || (playable && src === playable)) && isFinite(Number(audio.currentTime))) return Math.max(0, elementPlaybackTimeSec(track));
      if ((track.state === "live" || track.state === "pending") && (track.streamHealth === "stalled" || track.streamHealth === "interrupted" || track.streamStalled) && isFinite(Number(track.lastStalledSec))) {
        return Math.max(0, (Number(track.lastStalledSec) || 0) - 0.5);
      }
      if (isFinite(Number(track.lastWebAudioSec))) return Math.max(0, Number(track.lastWebAudioSec) || 0);
      if (isFinite(Number(track.lastElementSec))) return Math.max(0, Number(track.lastElementSec) || 0);
      if (isFinite(Number(track.lastStalledSec))) return Math.max(0, Number(track.lastStalledSec) || 0);
      return 0;
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
      if (isLiveProgressTrack(track)) return Math.max(10, positionSec + 5);
      return 0;
    }
    function seekToSeconds(pos, opts) {
      opts = opts || {};
      var track = currentTrack();
      pos = Math.max(0, Number(pos) || 0);
      if (track && isCancelableLiveTrack(track)) {
        if (seek) seek.value = "0";
        setStatus(busyGenerationStatus(track, "seek"));
        showTrackNotice(track, track.backgroundOnly || normalizePlaybackMode(track.playbackMode) === "generate" ? "后台生成中" : "流式生成中", track.backgroundOnly || normalizePlaybackMode(track.playbackMode) === "generate" ? "完成后会变成可播放的历史音频" : "只保留播放/暂停和退出；完成后会变成可拖动历史音频");
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
      if (track && isLiveTrack(track) && !shouldUseWebAudioForLiveTrack(track) && liveStreamUrlForTrack(track)) {
        return waitForSavedLiveTrack(track, "seek live cache fallback", {
          resumeSec: pos,
          title: "等待完整音频…",
          detail: "实时音频不支持拖动，生成完成后从完整音频播放"
        });
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
      var maxDur = (isFinite(dur) && dur > 0) ? dur : trackDurationHintSec(track);
      var target = Math.max(0, trackResumeSec(track) + delta);
      if (maxDur > 0) target = Math.min(target, Math.max(0, maxDur - 0.05));
      return seekToSeconds(target, { noticeTitle: delta < 0 ? "后退 10 秒" : "快进 10 秒" });
    }
