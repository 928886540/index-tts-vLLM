// IndexTTS Tavo runtime part: 62_events_boot.js // Role: dialog, audio event bindings, runtime bootstrap // This fragment is concatenated by static/tavo.runtime.js; it is not a standalone script.
    function openDialog(d) {
      if (!d) return;
      try { d.setAttribute("tabindex", "-1"); } catch (_) {}
      try { if (typeof d.showModal === 'function') d.showModal(); else if (typeof d.show === 'function') d.show(); else d.setAttribute('open', ''); } catch (_) { try { d.setAttribute('open', ''); } catch (__) {} }
      try {
        if (typeof d.focus === "function") d.focus({ preventScroll: true });
      } catch (_) {
        try { if (typeof d.focus === "function") d.focus(); } catch (__) {}
      }
    }
    function closeDialog(d) { if (!d) return; try { if (typeof d.close === 'function') d.close(); else d.removeAttribute('open'); } catch (_) { try { d.removeAttribute('open'); } catch (__) {} } }
    on(gear, 'click', async function (ev) {
      ev.preventDefault(); ev.stopPropagation();
      if (panel.open) closeDialog(panel);
      else {
        await refreshCharacterConfig({ forceSync: true });
        if (typeof positionSettingsPanel === "function") positionSettingsPanel();
        openDialog(panel);
      }
    });
    on(close, 'click', function () { closeDialog(panel); });
    // 移动 webview 的 audio.play() 必须在用户手势的同步调用栈里执行。异步播放路径
    // 里有一串 await（ensureTracksLoaded/prepareOffline）可能会把
    // 手势耗掉，导致已落盘音频暂停后再点播放被 NotAllowedError 拒绝、看起来“卡死没法播”。
    // 这里在手势内同步处理“元素音频已就绪”的续播/暂停，命中即不进 await 链。
    function tryResumeOrPauseInGesture() {
      try {
        var t = currentTrack();
        if (t && isTerminalTrack(t)) {
          clearElementAudioSrc();
          return false;
        }
        if (t && (isCancelableLiveTrack(t) || (typeof trackHasActiveLiveOutput === "function" && trackHasActiveLiveOutput(t)))) {
          var ps = String(t.playbackState || "");
          if (ps === "paused" && typeof resumePausedWebAudioTrack === "function" && resumePausedWebAudioTrack(t)) {
            return true;
          }
          if (ps === "playing" && (t.webAudioPlaying || isElementPlayingTrackStream(t))) {
            pauseLiveTrack(t);
            return true;
          }
        }
        if (!t || !elementAudioBelongsToTrack(t)) return false;
        if (!(audio.currentSrc || audio.src) || audio.ended) return false;
        if (audio.paused) {
          setAudioPlaybackRate();
          var p = audio.play();
          if (p && typeof p.then === "function") p.catch(function (e) { handleAudioPlayReject("element", e, "请点播放继续"); });
        } else {
          audio.pause();
        }
        return true;
      } catch (_) { return false; }
    }
    function busyGenerationStatus(track, action) {
      var background = track && (track.backgroundOnly || normalizePlaybackMode(track.playbackMode) === "generate");
      if (action === "seek") return background ? "后台生成中，完成后才能拖动" : "流式生成中不能拖动";
      return background ? "后台生成中，先删除或等待完成" : "流式生成中，可点播放暂停或等待完成";
    }
    function noteAudioGesture() {
      try { window.__indextts_tavo_last_audio_gesture_at = Date.now(); } catch (_) {}
    }
    function handlePageAudioSuspend(reason) {
      try {
        if (typeof handleRuntimePageVisibilityChange === "function") handleRuntimePageVisibilityChange(reason);
      } catch (e) {
        debugLog("⚠️ 页面后台暂挂处理失败: " + (e && e.message ? e.message : e), "#fc9");
      }
    }
    on(document, "visibilitychange", function () { handlePageAudioSuspend("visibilitychange"); });
    on(window, "pagehide", function () { handlePageAudioSuspend("pagehide"); });
    on(play, 'pointerdown', noteAudioGesture);
    on(add, 'pointerdown', noteAudioGesture);
    on(rewind10, 'pointerdown', noteAudioGesture);
    on(forward10, 'pointerdown', noteAudioGesture);
    on(play, 'touchstart', noteAudioGesture);
    on(add, 'touchstart', noteAudioGesture);
    on(rewind10, 'touchstart', noteAudioGesture);
    on(forward10, 'touchstart', noteAudioGesture);
    on(play, 'click', function (ev) {
      noteAudioGesture(ev);
      if (tryResumeOrPauseInGesture()) return;
      if (!canPlayCurrentTrack()) {
        setPlayState("idle");
        setStatus(historyStatusText());
        showTrackNotice(currentTrack(), currentTrack() ? "还没有可播放音频" : historyStatusText(), "点音符生成音频");
        updateTrackButtons();
        return;
      }
      playOrPauseCurrentTrack().catch(function (e) { setError(e && e.message ? e.message : String(e)); });
    });
    on(add, 'click', function (ev) {
      noteAudioGesture(ev);
      var t = currentTrack();
      if (isCancelableLiveTrack(t)) { setStatus(busyGenerationStatus(t)); return; }
      generate(true).catch(function (e) { setError(e && e.message ? e.message : String(e)); });
    });
    on(rewind10, 'click', function (ev) {
      noteAudioGesture(ev);
      var t = currentTrack();
      if (isCancelableLiveTrack(t) && !canSeekTrackByControls(t)) { setStatus(busyGenerationStatus(t, "seek")); return; }
      if (!seekBySeconds(-10)) setStatus("暂无可跳转音频");
    });
    on(forward10, 'click', function (ev) {
      noteAudioGesture(ev);
      var t = currentTrack();
      if (isCancelableLiveTrack(t) && !canSeekTrackByControls(t)) { setStatus(busyGenerationStatus(t, "seek")); return; }
      if (!seekBySeconds(10)) setStatus("暂无可跳转音频");
    });
    on(prev, 'click', function () {
      var t = currentTrack();
      if (isCancelableLiveTrack(t)) { setStatus(busyGenerationStatus(t)); return; }
      selectSavedTrackByDelta(-1, true).catch(function (e) { setError(e && e.message ? e.message : String(e)); });
    });
    on(next, 'click', function () {
      var t = currentTrack();
      if (isCancelableLiveTrack(t)) { setStatus(busyGenerationStatus(t)); return; }
      selectSavedTrackByDelta(1, true).catch(function (e) { setError(e && e.message ? e.message : String(e)); });
    });
    on(del, 'click', function () { clearCurrentTrack().catch(function (e) { setError(e && e.message ? e.message : String(e)); }); });
    on(liveExit, 'click', function () { exitCurrentLiveTrack("live exit").catch(function (e) { setError(e && e.message ? e.message : String(e)); }); });
    on(playbackToggle, 'click', async function (ev) {
      if (ev) { ev.preventDefault(); ev.stopPropagation(); }
      try {
        readFields();
        cfg.playbackMode = normalizePlaybackMode(cfg.playbackMode) === "generate" ? "live" : "generate";
        syncUI();
        await saveConfig(cfg, characterId);
        setStatus(cfg.playbackMode === "generate" ? "DISK：后台落盘" : "LIVE：边生成边播放");
      } catch (e) {
        setError("设置保存失败: " + (e && e.message ? e.message : String(e)));
      }
    });
    on(first(panel, '[data-role="save"]'), 'click', async function () {
      try {
        readFields();
        await saveConfig(cfg, characterId);
        syncUI();
        closeDialog(panel);
        setStatus("设置已保存");
      } catch (e) {
        setError("设置保存失败: " + (e && e.message ? e.message : String(e)));
      }
    });
    try {
      window.addEventListener('resize', function () {
        if (panel && panel.open && typeof positionSettingsPanel === "function") positionSettingsPanel();
        if (typeof pickerEl !== "undefined" && pickerEl && pickerEl.open && typeof positionVoicePicker === "function") positionVoicePicker();
      }, { passive: true });
    } catch (_) {}
    // IME 组词期间不覆盖输入值（搜狗/微软拼音等）。事件委托到 panel 上，覆盖所有 data-field 输入。
    try {
      panel.addEventListener('compositionstart', function (e) {
        if (e.target && e.target.dataset && e.target.dataset.field) e.target.__indexttsComposing = true;
      }, true);
      panel.addEventListener('compositionend', function (e) {
        if (e.target && e.target.dataset && e.target.dataset.field) e.target.__indexttsComposing = false;
      }, true);
    } catch (_) {}
    on(field("qualityMode"), 'change', function () { readFields(); syncUI(); });
    on(first(panel, '[data-role="reload"]'), 'click', function () {
      voicesLoaded = false;
      ensureVoicesLoaded().catch(function (e) { setStatus("音色列表读取失败"); setError(e && e.message ? e.message : String(e)); });
    });
    $all(panel, '.idx-mode').forEach(function (b) { b.addEventListener('click', async function () {
      try {
        readFields();
        cfg.mode = normalizeModeName(b.dataset.mode);
        syncUI();
        await saveConfig(cfg, characterId);
      } catch (e) {
        setError("设置保存失败: " + (e && e.message ? e.message : String(e)));
      }
    }); });
    var seekUserDragging = false;
    function seekTargetSecondsFromValue(track) {
      var value = Math.max(0, Math.min(1000, Number(seek && seek.value || 0) || 0));
      var meterDur = progressMeterDurationSec(track, trackResumeSec(track));
      if (!(meterDur > 0)) {
        var dur = Number(audio && audio.duration);
        meterDur = (isFinite(dur) && dur > 0) ? dur : trackDurationHintSec(track);
      }
      return meterDur > 0 ? value / 1000 * meterDur : 0;
    }
    on(audio, 'play', function () {
      var t = currentTrack();
      if (t) setTrackPlaybackState(t, "playing");
      setPlayState("playing"); setStatus(trackPlaybackLabel(t));
      // 系统媒体面板基础信息(后台/锁屏可见,可控制播放/前后 10 秒)
      try { updateMediaSession(lastSpeakerRole, ""); } catch (_) {}
      // 桌面 / <audio> 路径的字幕：普通/AI dialogue track 有 segments 时启动。
      if (t && t.mode !== "single" && (normalizeModeName(t.mode) === "ai" || normalizeModeName(t.mode) === "normal")) {
        if (t.cacheKey || (t.segments && t.segments.length)) {
          startSubtitle(t, function () { return elementPlaybackTimeSec(t); });
        }
      }
    });
    on(audio, 'waiting', function () {
      var t = currentTrack();
      var label = waitingLabelForTrack(t);
      if (t) setTrackPlaybackState(t, "buffering");
      setPlayState("loading");
      setStatus(label);
      if (t && !hasActiveSubtitleRows(t)) showTrackNotice(t, label, "歌词会停在当前播放位置");
    });
    on(audio, 'canplay', function () {
      setError("");
      if (!audio.paused) {
        var t = currentTrack();
        if (t) setTrackPlaybackState(t, "playing");
        setPlayState("playing");
        // 多音色模式下当前播放的音色不固定,不要写 cfg.defaultVoice
        setStatus(trackPlaybackLabel(t));
      }
    });
    on(audio, 'playing', function () { var t = currentTrack(); if (t) setTrackPlaybackState(t, "playing"); setError(""); setPlayState("playing"); setStatus(trackPlaybackLabel(t)); });
    on(audio, 'pause', function () { var t = currentTrack(); if (t && !audio.ended) setTrackPlaybackState(t, "paused"); setPlayState("idle"); if (audio.currentTime > 0 && !audio.ended) setStatus("已暂停"); stopSubtitle(); });
    on(audio, 'ended', function () {
      var t = currentTrack();
      if (t && isElementUsingTrackLiveSegment(t) && handleLiveSegmentAudioEnded(t)) return;
      if (t && isElementUsingTrackLiveMp3(t)) {
        var liveEndedSec = elementPlaybackTimeSec(t);
        rememberLiveResumeSec(t, liveEndedSec, "live mp3 ended");
        clearLiveMp3AudioState(t);
        t.streamPlaybackFinished = true;
        t.streaming = false;
        t.liveEndedAwaitSaved = true;
        if (offlineCacheReadyForSave(t)) {
          if (!t.cacheUrl && t.cacheKey) t.cacheUrl = cleanBase(cfg.apiBase) + "/cache_audio/" + encodeURIComponent(t.cacheKey);
          setTrackState(t, "saved");
          attachCacheAudio(t, { forceElement: true, autoplay: false });
          if (t.cacheKey && t.cacheUrl) scheduleOfflineAudioSave(t, "ended offline", 800);
          if (messageId) saveTracksForMessage(messageId, generatedTracks).catch(function(){});
          removePendingJobForTrack(t).catch(function(){});
          setTrackPlaybackState(t, "ended");
          setPlayState("idle");
          setStatus("播放完成，完整音频已就绪");
          showTrackNotice(t, "播放完成", "已切到完整音频，支持拖动进度条");
          stopSubtitle();
          updateTrackButtons();
          return;
        }
        setTrackPlaybackState(t, "ended");
        setPlayState("idle");
        setStatus("MP3 实时流已结束，等待完整音频保存");
        showTrackNotice(t, "MP3 实时流已结束", "完整音频落盘后会自动切到可拖动播放");
        pollCacheUpgrade(t, "live mp3 ended before cache");
        stopSubtitle();
        updateTrackButtons();
        return;
      }
      if (t && t.mode === "single" && t.cacheKey && t.cacheUrl) {
        setTrackState(t, "saved");
        attachCacheAudio(t, { deferElement: true });
        if (messageId) saveTracksForMessage(messageId, generatedTracks).catch(function(){});
      }
      if (t && t.cacheKey && t.cacheUrl) scheduleOfflineAudioSave(t, "ended offline", 800);
      if (t) setTrackPlaybackState(t, "ended");
      setPlayState("idle");
      setStatus("播放完成");
      stopSubtitle();
    });
    on(audio, 'error', function () {
      var active = currentTrack();
      if (active && isTerminalTrack(active)) {
        clearElementAudioSrc();
        stopSubtitle();
        setPlayState("idle");
        return;
      }
      if (active && (active.webAudioPlaying || shouldUseWebAudioForLiveTrack(active))) {
        debugLog("⚠️ 忽略 audio 元素错误：当前手机链路使用 Web Audio，src=" + (audio.currentSrc || audio.src || ""), "#fc9");
        setError("");
        return;
      }
      var detail = "";
      try {
        if (audio.error) detail = "（" + mediaErrorText(audio.error) + "）";
      } catch (_) {}
      if (active && isSavedTrack(active) && recoverSavedAudioElementError(active, detail)) {
        stopSubtitle();
        return;
      }
      if (active && isElementUsingTrackLiveSegment(active)) {
        debugLog("⚠️ live segment audio 元素不可用" + detail + "，等待完整音频 src=" + (audio.currentSrc || audio.src || ""), "#fc9");
        waitForSavedLiveTrack(active, "audio error live segment fallback", {
          resumeSec: trackResumeSec(active),
          title: "等待完整音频…",
          detail: "当前 WebView 不支持这条小段音频，生成完成后自动切到完整音频"
        });
        stopSubtitle();
        return;
      }
      if (active && isElementUsingTrackLiveMp3(active)) {
        debugLog("⚠️ live MP3 audio 元素不可用" + detail + "，等待完整音频 src=" + (audio.currentSrc || audio.src || ""), "#fc9");
        waitForSavedLiveTrack(active, "audio error live mp3 fallback", {
          resumeSec: trackResumeSec(active),
          title: "等待完整音频…",
          detail: "当前 WebView 不支持这条 MP3 实时流，生成完成后自动切到完整音频"
        });
        stopSubtitle();
        return;
      }
      if (active && isLiveTrack(active) && liveStreamUrlForTrack(active)) {
        var errCode = 0;
        try { errCode = audio.error ? Number(audio.error.code || 0) : 0; } catch (_) { errCode = 0; }
        if (errCode === 4 || isElementUsingTrackStream(active)) {
          debugLog("⚠️ live stream audio 元素不可用" + detail + "，等待完整音频 src=" + (audio.currentSrc || audio.src || ""), "#fc9");
          waitForSavedLiveTrack(active, "audio error live cache fallback", {
            resumeSec: trackResumeSec(active),
            title: "等待完整音频…",
            detail: "当前 WebView 不支持这条实时音频流，生成完成后自动切到完整音频"
          });
          stopSubtitle();
          return;
        }
      }
      if (active) setTrackPlaybackState(active, "error");
      setPlayState("idle");
      setStatus("播放失败");
      setError((detail || "音频加载失败") + "。请检查服务地址、音色和后端日志。");
      debugLog("❌ audio error " + (detail || "") + " src=" + (audio.currentSrc || audio.src || ""), "#f99");
      stopSubtitle();
    });
    on(audio, 'loadedmetadata', function () {
      setError("");
      setAudioPlaybackRate();
      var t = currentTrack();
      var dur = Number(audio.duration);
      var progressDur = progressDurationSec(t, elementPlaybackTimeSec(t));
      var meterDur = progressMeterDurationSec(t, elementPlaybackTimeSec(t));
      if (seek) seek.disabled = !(canSeekTrackByControls(t) && meterDur > 0);
      if (total) total.textContent = progressDur > 0 ? formatTime(progressDur) : "--:--";
      debugLog("📐 audio metadata loaded: duration=" + (isFinite(dur) ? dur.toFixed(2) : String(audio.duration)) + "s seekable=" + (audio.seekable.length > 0 ? audio.seekable.end(0).toFixed(2) : "0"), "#9ff");
    });
    on(audio, 'seeking', function () { if (scriptFlagEnabled("debugSeek")) debugLog("⏩ seeking → " + audio.currentTime.toFixed(2), "#9ff"); });
    on(audio, 'seeked',  function () { if (scriptFlagEnabled("debugSeek")) debugLog("✅ seeked  → " + audio.currentTime.toFixed(2), "#9ff"); });
    on(audio, 'stalled', function () {
      var t = currentTrack();
      if (t) {
        t.stalledCount = Number(t.stalledCount || 0) + 1;
        setTrackStreamHealth(t, "stalled");
        t.lastStalledAt = Date.now();
        t.lastStalledSec = elementPlaybackTimeSec(t);
      }
      debugLog("⚠️ stalled @ " + audio.currentTime.toFixed(2) + (t ? " count=" + t.stalledCount : ""), "#fc9");
    });
    on(audio, 'timeupdate', function () {
      var activeTrack = currentTrack();
      var pos = elementPlaybackTimeSec(activeTrack);
      if (activeTrack) activeTrack.lastElementSec = pos;
      var progressDur = progressDurationSec(activeTrack, pos);
      var meterDur = progressMeterDurationSec(activeTrack, pos);
      if (cur && !seekUserDragging) cur.textContent = formatTime(pos);
      if (total) total.textContent = progressDur > 0 ? formatTime(progressDur) : "--:--";
      if (seek && !seekUserDragging) {
        seekProgrammaticUpdate = true;
        seek.disabled = !(canSeekTrackByControls(activeTrack) && meterDur > 0);
        seek.value = meterDur > 0 ? String(Math.floor(Math.min(pos, meterDur) / meterDur * 1000)) : "0";
        setTimeout(function () { seekProgrammaticUpdate = false; }, 0);
      }
    });
    on(seek, 'input', function () {
      if (seekProgrammaticUpdate) return;
      seekUserDragging = true;
      var t = currentTrack();
      if (!canSeekTrackByControls(t)) {
        setStatus(busyGenerationStatus(t, "seek"));
        return;
      }
      var target = seekTargetSecondsFromValue(t);
      if (cur) cur.textContent = formatTime(target);
      if (canSeekLiveTrack(t)) {
        setStatus("松手后跳转实时音频");
        return;
      }
      var dur = Number(audio && audio.duration);
      if (audio && isFinite(dur) && dur > 0) audio.currentTime = Number(seek.value || 0) / 1000 * dur;
      else {
        var hint = trackDurationHintSec(t);
        if (hint > 0 && cur) cur.textContent = formatTime(Number(seek.value || 0) / 1000 * hint);
      }
    });
    on(seek, 'change', function () {
      if (seekProgrammaticUpdate) return;
      var t = currentTrack();
      if (!canSeekTrackByControls(t)) {
        seekUserDragging = false;
        setStatus(busyGenerationStatus(t, "seek"));
        return;
      }
      var target = seekTargetSecondsFromValue(t);
      if (canSeekLiveTrack(t)) {
        seekUserDragging = false;
        seekToSeconds(target, { noticeTitle: "拖动进度" });
        return;
      }
      var dur = Number(audio && audio.duration);
      if (audio && isFinite(dur) && dur > 0) { seekUserDragging = false; return; }
      var hint = trackDurationHintSec(t);
      if (hint > 0) seekToSeconds(Number(seek.value || 0) / 1000 * hint, { noticeTitle: "拖动进度" });
      seekUserDragging = false;
    });

    updateTrackButtons();
    syncUI();
    knownHistoryCount = messageId ? localHistoryCountForMessage(messageId) : 0;
    setStatus(historyStatusText());
    showTrackNotice(null, historyStatusText(), knownHistoryCount ? "点开播放器后可播放历史音频" : "点音符生成音频");
    initializeHistoryCount()
      .then(function () { return ensureTracksLoaded(); })
      .catch(function (e) {
        debugLog("⚠️ 初始化历史音频失败: " + (e && e.message ? e.message : e), "#fc9");
      });
  }

  try {
    ensureStyle();
    removeLegacyGlobalGear();
    if (script && script.dataset.indexttsMounted === "1") return;
    if (script) script.dataset.indexttsMounted = "1";
    var msgEl = messageElement(script);
    if (msgEl && msgEl !== document.body && msgEl !== document.documentElement) {
      $all(msgEl, '.idx-tts').forEach(function (node) { if (node.parentNode) node.parentNode.removeChild(node); });
    }
    var root = document.createElement("div");
    root.className = "idx-tts";
    if (script && script.parentNode) script.parentNode.insertBefore(root, script.nextSibling); else document.body.appendChild(root);
    var cfg = await getConfig();
    var ctx = await currentMessageContext();
    try {
      var loaderMessageId = script && script.dataset ? String(script.dataset.indexttsMessageId || "") : "";
      if (typeof adoptPreprimedAudioOwner === "function") adoptPreprimedAudioOwner(ctx.messageId, loaderMessageId);
    } catch (_) {}
    cfg.currentCharacterName = ctx.characterName || "";
    // 角色级 defaultVoice + roleVoiceList 覆盖全局 cfg。
    // 优先读 TAVO character scope；ctx.characterId 只用于旧版全局 key/localStorage 迁移。
    try {
      var charCfg = await loadCharacterCfg(ctx.characterId);
      if (charCfg) {
        if (typeof charCfg.defaultVoice === "string") cfg.defaultVoice = charCfg.defaultVoice;
        if (!cfg.defaultVoice && Array.isArray(charCfg.roleVoiceList)) {
          cfg.defaultVoice = voiceForRoleNames(charCfg.roleVoiceList, ["角色", "character", "当前角色", cfg.currentCharacterName], cfg.currentCharacterName, charCfg.characterName) || cfg.defaultVoice;
        }
        if (Array.isArray(charCfg.roleVoiceList) && charCfg.roleVoiceList.length) cfg.roleVoiceList = normalizeRoleVoiceList(charCfg.roleVoiceList, cfg.currentCharacterName, charCfg.characterName);
      }
    } catch (_) {}
    // 关键:过滤掉历史会话累积的多余空行,确保前 2 行 reserved
    cfg.roleVoiceList = normalizeRoleVoiceList(cfg.roleVoiceList, cfg.currentCharacterName);
    mount(root, cfg, ctx);
  } catch (e) { try { console.error("[IndexTTS TAVO]", e && e.stack ? e.stack : (e && e.message ? e.message : JSON.stringify(e))); } catch (_) {} }
})();
