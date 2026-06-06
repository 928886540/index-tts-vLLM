// IndexTTS Tavo runtime part: 60_generate_flow.js // Role: single and multi-role generate flow // This fragment is concatenated by static/tavo.runtime.js; it is not a standalone script.
    function pauseLiveTrack(track) {
      if (!track) return;
      track.pausedByUser = true;
      try {
        if (isFinite(Number(audio.currentTime))) track.lastElementSec = Math.max(0, elementPlaybackTimeSec(track));
      } catch (_) {}
      try { audio.pause(); } catch (_) {}
      stopWebAudioPlayback("pause");
      track.playSavedWhenReady = false;
      setPlayState("idle");
      setStatus("已暂停");
      showTrackNotice(track, "已暂停", track.cacheKey ? "不会自动恢复流式；完整音频就绪后点播放会检查历史音频" : "已停止等待");
    }

    async function generate(force) {
      await refreshCharacterConfig({ skipIfEditing: true });
      readFields(); await saveConfig(cfg, characterId); setError("");
      if (!messageText) { setError("当前消息没有可朗读正文。"); return; }
      try {
        await ensureTracksLoaded();
      } catch (e) {
        setError("历史音频读取失败: " + (e && e.message ? e.message : String(e)));
        return;
      }
      // 已有卡片时，播放按钮只做"播放/暂停/选当前卡片"，不生成新音频。
      // 新建必须点 + 号（force=true 才走下面的 generate 流程）。
      if (!force && generatedTracks.length > 0) {
        if (currentTrackIndex < 0) currentTrackIndex = generatedTracks.length - 1;
        var existingTrack = currentTrack();
        if (!existingTrack) return;
        var existingIsPlaying = String(existingTrack.playbackState || "") === "playing"
          && (existingTrack.webAudioPlaying || isElementPlayingTrackStream(existingTrack) || (elementAudioBelongsToTrack(existingTrack) && !audio.paused && !audio.ended));
        if (existingIsPlaying) {
          if (isSavedTrack(existingTrack)) {
            try {
              existingTrack.lastElementSec = Math.max(0, Number(audio.currentTime || 0) || 0);
              audio.pause();
              setTrackPlaybackState(existingTrack, "paused");
              setPlayState("idle");
              setStatus("已暂停");
              showTrackNotice(existingTrack, "已暂停", "点播放从当前位置继续");
            } catch (_) {}
          } else {
            pauseLiveTrack(existingTrack);
          }
          return;
        }
        var existingState = trackState(existingTrack);
        if (existingState === "failed" || existingState === "cancelled") {
          setTrackPlaybackState(existingTrack, existingState === "failed" ? "error" : "cancelled");
          setPlayState("idle");
          setStatus(existingState === "cancelled" ? "任务已取消" : "生成失败");
          showTrackNotice(existingTrack, existingState === "cancelled" ? "任务已取消" : "生成失败", existingTrack.error || "点 + 重新生成");
          updateTrackButtons();
          return;
        }
        if (shouldUseElementForSavedTrack(existingTrack)) {
          await prepareOfflineAudio(existingTrack, "play", { saveMissing: true });
          var existingUrl = trackPlayableUrl(existingTrack);
          var audioUrl = audio.currentSrc || audio.src || "";
          if (existingUrl && !elementAudioBelongsToTrack(existingTrack) && audioUrl !== existingUrl) {
            startElementAudioFrom(existingTrack, trackResumeSec(existingTrack));
          } else if (audio.src) {
            if (audio.paused) { setAudioPlaybackRate(); await audio.play().catch(function(e){ handleAudioPlayReject("element", e, "请点播放继续"); }); }
            else audio.pause();
          } else {
            startElementAudioFrom(existingTrack, trackResumeSec(existingTrack));
          }
          return;
        }
        if (isLiveTrack(existingTrack) || trackState(existingTrack) === "pending") {
          if (existingTrack.cacheKey && (await promoteTrackIfCacheReady(existingTrack, "play cache check") || await refreshTrackFromStatus(existingTrack, "play snapshot"))) {
            if (shouldUseElementForSavedTrack(existingTrack)) {
              await prepareOfflineAudio(existingTrack, "play saved", { saveMissing: true });
              startElementAudioFrom(existingTrack, trackResumeSec(existingTrack));
              return;
            }
            if (trackState(existingTrack) === "failed" || trackState(existingTrack) === "cancelled") {
              setPlayState("idle");
              setStatus(trackState(existingTrack) === "cancelled" ? "任务已取消" : "生成失败");
              showTrackNotice(existingTrack, trackState(existingTrack) === "cancelled" ? "任务已取消" : "生成失败", existingTrack.error || "点 + 重新生成");
              return;
            }
          }
          if (existingTrack.backgroundOnly || normalizePlaybackMode(existingTrack.playbackMode) === "generate") {
            if (existingTrack.cacheKey) pollCacheUpgrade(existingTrack, "background play check");
            setPlayState("idle");
            setStatus("后台生成中…");
            showTrackNotice(existingTrack, "后台生成中…", "生成完成后会变成可播放的历史音频");
            return;
          }
          var liveUrl = liveStreamUrlForTrack(existingTrack);
          if (liveUrl) {
            var manualResumeSec = trackResumeSec(existingTrack);
            existingTrack.allowStreamPlay = false;
            setTrackPlaybackState(existingTrack, "loading");
            setPlayState("loading");
            setStatus(manualResumeSec > 0 ? "连接断点音频…" : "连接实时音频…");
            showTrackNotice(existingTrack, manualResumeSec > 0 ? "连接断点音频" : "连接实时音频", manualResumeSec > 0 ? ("从 " + formatTime(manualResumeSec) + " 继续实时播放") : "继续实时播放；完整音频会自动进入历史");
            await playLiveTrack(existingTrack, liveUrl, {
              noticeTitle: manualResumeSec > 0 ? "连接断点音频…" : "连接实时音频…",
              noticeDetail: manualResumeSec > 0 ? ("从 " + formatTime(manualResumeSec) + " 继续") : "正在连接实时音频",
              waitDetail: "等待后端返回实时音频",
              startOffsetSec: manualResumeSec
            });
            return;
          }
          setTrackPlaybackState(existingTrack, "error");
          setPlayState("idle");
          setStatus(existingTrack.cacheKey ? "音频已失效，点 + 重新生成" : "还没有音频，点 + 生成");
          showTrackNotice(existingTrack, existingTrack.cacheKey ? "需要重新生成" : "还没有音频", existingTrack.cacheKey ? "原实时任务已结束且没有完整音频，点 + 重新生成" : "点 + 号开始生成");
          return;
        }
        if (audio.src) {
          if (audio.paused) { setAudioPlaybackRate(); await audio.play().catch(function(e){ handleAudioPlayReject("element", e, "请点播放继续"); }); }
          else audio.pause();
          return;
        }
        // 没 src 但有卡片 → 选当前卡片，让 selectTrack 决定 URL 来源
        await selectTrack(currentTrackIndex, true);
        return;
      }
      var voiceProblem = validateVoiceMappingForGenerate();
      if (voiceProblem) {
        setError(voiceProblem);
        showTrackNotice(null, "音色映射未配置", voiceProblem);
        return;
      }
      // 兼容旧逻辑（无卡片 + audio.src 残留时）
      if (audio.src && !force && generatedTracks.length === 0) {
        if (audio.paused) {
          setAudioPlaybackRate();
          await audio.play().catch(function(e){ handleAudioPlayReject("element", e, "请点播放继续"); });
        } else audio.pause();
        return;
      }

      var parseMode = normalizeModeName(cfg.mode);
      var playbackMode = normalizePlaybackMode(cfg.playbackMode);
      var backgroundDetached = playbackMode === "generate";
      var aiParseHint = cfg.reuseLlmParse !== false ? "后端会先检查 LLM 拆段复用" : "后端会做 LLM 拆段";
      var aiSubmitTitle = cfg.reuseLlmParse !== false ? "提交到后端检查拆段…" : "提交到后端分析…";
      var aiSubmitDetail = cfg.reuseLlmParse !== false ? "后端先查复用，未命中才调用 LLM" : "LLM 拆段由后端控制，可随时删除任务";
      function showGenerationProgress(track, titleText, detailText) {
        if (backgroundDetached && currentTrack() !== track) {
          if (!currentTrack()) {
            setStatus(titleText);
            showTrackNotice(null, titleText, detailText);
          }
          return;
        }
        setStatus(titleText);
        showTrackNotice(track, titleText, detailText);
      }
      if (parseMode === "ai" && (!cfg.llmEndpoint || !cfg.llmModel)) throw new Error("AI模式需要填写 LLM 接口地址和模型。");
      var voicesMap = parseMode === "normal" ? normalModeVoicesMap(cfg) : rolesListToVoicesMap(cfg.roleVoiceList, cfg.defaultVoice, cfg.currentCharacterName);
      var rolesHint = parseMode === "normal"
        ? ["旁白", "对白"]
        : normalizeRoleVoiceList(cfg.roleVoiceList || [], cfg.currentCharacterName).map(function (r) { return String((r && r.role) || "").trim(); }).filter(Boolean);
      var placeholder = {
        url: null,
        streamUrl: "",
        cacheUrl: "",
        cacheKey: "",
        createdAt: Date.now(),
        voice: cfg.defaultVoice,
        mode: parseMode,
        parseMode: parseMode,
        playbackMode: playbackMode,
        backgroundOnly: false,
        segments: [],
        voicesMap: voicesMap,
        state: "pending",
        status: "pending",
        pendingBlob: true,
        streaming: false,
        allowStreamPlay: false
      };
      setTrackState(placeholder, "pending");
      if (backgroundDetached) {
        tracksLoaded = true;
        generatedTracks.push(placeholder);
        var backgroundIndex = generatedTracks.length - 1;
        if (currentTrackIndex < 0) {
          currentTrackIndex = backgroundIndex;
          await selectTrack(currentTrackIndex, false);
        }
        showGenerationProgress(placeholder, "准备后台生成…", parseMode === "ai" ? aiParseHint : "后端会按旁白/对白规则拆段");
        updateTrackButtons();
        debugLog("🎵 新建落盘普通卡片 mode=" + parseMode + " playback=" + playbackMode + " index=" + backgroundIndex, "#9ff");
      } else {
        generatedTracks.push(placeholder);
        currentTrackIndex = generatedTracks.length - 1;
        try { audio.pause(); } catch (_) {}
        clearElementAudioSrc();
        await selectTrack(currentTrackIndex, false);
        showGenerationProgress(placeholder, "准备生成…", parseMode === "ai" ? aiParseHint : "后端会按旁白/对白规则拆段");
        debugLog("🎵 新建占位卡片 mode=" + parseMode + " playback=" + playbackMode + " index=" + currentTrackIndex, "#9ff");
        setPlayState("loading");
      }
      try {
        var base = cleanBase(cfg.apiBase);
        var t0 = Date.now();
        var body = Object.assign({
          text: messageText,
          voices: voicesMap,
          parse_mode: parseMode,
          performance_mode: cfg.qualityMode || "balanced",
          interval_ms: cfg.intervalMs,
          top_p: cfg.topP,
          top_k: cfg.topK,
          temperature: cfg.temperature,
          repetition_penalty: cfg.repetitionPenalty,
          emo_alpha: cfg.emoAlpha,
          speed_factor: clampNumber(cfg.speedFactor || 1.0, 1.0, 0.85, 1.25),
          bypass_cache: !!force
        }, generationQualityOverrides(cfg.qualityMode));
        if (parseMode === "ai") {
          body.llm_endpoint = cfg.llmEndpoint;
          body.llm_model = cfg.llmModel;
          body.llm_api_key = cfg.llmApiKey || "";
          body.reuse_llm_parse = cfg.reuseLlmParse !== false;
          body.user_name = (context && context.userName) || "";
          body.character_name = (context && context.characterName) || cfg.currentCharacterName || "";
          body.roles_hint = rolesHint;
        }
        if (force) body.cache_nonce = String(Date.now()) + "-" + Math.random().toString(36).slice(2);
        debugLog("━━━━━━━━━━━━━━━━━━━━━━━━━", "#fff");
        debugLog("🎬 生成开始: mode=" + parseMode + " playback=" + playbackMode + " text=" + messageText.length + " 字", "#fff");
        debugLog("🎙️ 音色映射: " + JSON.stringify(voicesMap), "#ffd479");
        startServerLogPolling(base);
        if (placeholder.deleted) throw Object.assign(new Error("生成已取消"), { name: "AbortError" });
        showGenerationProgress(placeholder, parseMode === "ai" ? aiSubmitTitle : "提交到后端拆段…", playbackMode === "generate" ? "后台生成完整音频，不连接流式播放" : "拿到任务后开始等待音频");
        var jobInfo;
        var jobCreateController = (typeof AbortController === "function") ? new AbortController() : null;
        placeholder.jobCreateAbortController = jobCreateController;
        var ttsStart = Date.now();
        var ttsTimer = setInterval(function () {
          if (placeholder.deleted) return;
          var sec = Math.floor((Date.now() - ttsStart) / 1000);
          showGenerationProgress(placeholder, (playbackMode === "generate" ? "后台生成提交中 " : "后端处理中 ") + sec + "s…", parseMode === "ai" ? aiSubmitDetail : "普通模式规则拆段，可随时删除任务");
        }, 1000);
        try {
          debugLog("📡 提交 dialogue job: parse_mode=" + parseMode + " playback=" + playbackMode, "#ffd479");
          jobInfo = await createDialogueStreamJob(base, body, { signal: jobCreateController && jobCreateController.signal });
          debugLog("🔗 cache_key=" + jobInfo.cacheKey + " cached=" + jobInfo.cached + " live=" + jobInfo.live, "#9f9");
        } finally {
          clearInterval(ttsTimer);
          placeholder.jobCreateAbortController = null;
        }
        if (placeholder.deleted) {
          if (jobInfo && jobInfo.cacheKey) deleteRemoteTrack({ cacheKey: jobInfo.cacheKey }).catch(function () {});
          throw Object.assign(new Error("生成已取消"), { name: "AbortError" });
        }
        placeholder.streamUrl = jobInfo.streamUrl;
        placeholder.cacheUrl = jobInfo.cacheUrl;
        placeholder.cacheKey = jobInfo.cacheKey;
        placeholder.segments = [];
        placeholder.voicesMap = voicesMap;
        placeholder.streamInterrupted = false;
        placeholder.streamStalled = false;
        placeholder.stalledCount = 0;
        placeholder.streamHealth = "ok";
        placeholder.savePromptAsked = false;
        placeholder.backgroundOnly = false;
        placeholder.playbackMode = playbackMode;
        placeholder.allowStreamPlay = playbackMode === "live" && !jobInfo.cached;
        placeholder.url = jobInfo.cached ? jobInfo.cacheUrl : (playbackMode === "live" ? jobInfo.streamUrl : "");
        setTrackState(placeholder, jobInfo.cached ? "saved" : (backgroundDetached ? "pending" : "live"));
        currentCacheKey = jobInfo.cacheKey;
        updateTrackButtons();
        if (messageId && backgroundDetached && !jobInfo.cached) {
          savePendingJobForTrack(placeholder).catch(function(){});
          debugLog("💾 已记录后台生成 pending cacheKey=" + jobInfo.cacheKey, "#9ff");
        }
        if (jobInfo.cached && jobInfo.cacheUrl) {
          await removePendingJobForTrack(placeholder).catch(function(){});
          await prepareOfflineAudio(placeholder, "cached hit", { saveMissing: true });
          knownHistoryCount = persistableHistoryTracks(generatedTracks).length;
          showGenerationProgress(placeholder, playbackMode === "generate" ? ("已有音频 · 历史音频 " + knownHistoryCount + " 条") : "已有音频，正在播放", playbackMode === "generate" ? "已加入普通历史音频" : "已加载音频，支持拖动");
          debugLog(placeholder.offlineUrl ? "⚡ 命中本地离线音频" : "⚡ 命中服务端缓存", "#9f9");
          if (playbackMode === "live") {
            setPlayState("loading");
            startElementAudioFrom(placeholder, 0);
          } else if (backgroundDetached) {
            attachCacheAudio(placeholder, { deferElement: true });
            if (currentTrack() === placeholder) setPlayState("idle");
          } else {
            setPlayState("idle");
            attachCacheAudio(placeholder, { deferElement: true });
          }
          updateTrackButtons();
          if (messageId) saveTracksForMessage(messageId, generatedTracks).catch(function(){});
          return;
        }
        pollCacheUpgrade(placeholder, playbackMode === "generate" ? "background generate" : "live snapshot");
        if (backgroundDetached) {
          showGenerationProgress(placeholder, "后台生成中…", "可以退出 Tavo，回来后会继续检查音频是否落盘");
          stopServerLogPolling();
          return;
        }
        if (parseMode === "ai" && placeholder.cacheKey) {
          await refreshTrackFromStatus(placeholder, "pre-live status");
          if (isSavedTrack(placeholder)) {
            setPlayState("loading");
            startElementAudioFrom(placeholder, 0);
            stopServerLogPolling();
            return;
          }
          var preLiveState = trackState(placeholder);
          if (preLiveState === "failed" || preLiveState === "cancelled") {
            setPlayState("idle");
            setStatus(preLiveState === "cancelled" ? "任务已取消" : "生成失败");
            showTrackNotice(placeholder, preLiveState === "cancelled" ? "任务已取消" : "生成失败", placeholder.error || "后端任务未能生成音频");
            updateTrackButtons();
            stopServerLogPolling();
            return;
          }
        }
        if (placeholder.pausedByUser) {
          setStatus("已暂停，后台合成中");
          showTrackNotice(placeholder, "已暂停", "合成还在后台进行，完成后会成为历史音频");
          stopServerLogPolling();
          return;
        }
        setStatus("等待音频…");
        showTrackNotice(placeholder, "等待音频…", "后端合成中，完整音频会自动进入历史");
        setPlayState("loading");
        placeholder.allowStreamPlay = false;
        if (shouldUseWebAudioForLiveTrack(placeholder)) {
          debugLog("▶️ live track 使用 Web Audio API 真流式", "#ffd479");
          await playLiveTrack(placeholder, jobInfo.streamUrl, { noticeTitle: "等待音频…", noticeDetail: "后端合成中，完整音频会自动进入历史", waitDetail: "后端合成中" });
          if (isSavedTrack(placeholder)) attachCacheAudio(placeholder, { deferElement: true });
          stopServerLogPolling();
          return;
        }
        var totalSec = Math.floor((Date.now() - t0) / 1000);
        debugLog("▶️ 启动 live 播放路径, 截至此处用时 " + totalSec + "s", "#9f9");
        await playLiveTrack(placeholder, jobInfo.streamUrl, { noticeTitle: "等待音频…", noticeDetail: "后端合成中，完整音频会自动进入历史", waitDetail: "后端合成中" });
        try {
          audio.addEventListener("ended", stopServerLogPolling, { once: true });
          audio.addEventListener("error", stopServerLogPolling, { once: true });
          audio.addEventListener("pause", function () { if (audio.currentTime >= (audio.duration || 0) - 0.05) stopServerLogPolling(); });
        } catch (_) { stopServerLogPolling(); }
      } catch (e) {
        var msg = String((e && e.message) || e || "");
        var isAbort = (e && e.name === 'AbortError') || /aborted/i.test(msg);
        var affectsCurrentCard = !backgroundDetached || currentTrack() === placeholder || !currentTrack();
        if (affectsCurrentCard) setPlayState("idle");
        stopServerLogPolling();
        // 切卡/切角色导致的 AbortError 是正常用户操作,不弹红色错误
        if (isAbort) {
          setStatus(backgroundDetached ? "后台生成已取消" : "已取消");
          debugLog("⏸ 生成被中断(切卡/切角色等): " + msg, "#fc9");
        } else {
          setStatus(backgroundDetached ? "后台生成失败" : "生成失败");
          if (backgroundDetached && !affectsCurrentCard) {
            if (!currentTrack()) showTrackNotice(null, "后台生成失败", msg);
          } else {
            setError(msg);
          }
          debugLog("❌ 错误: " + msg, "#f99");
        }
        // 生成失败不自动删卡；D 只有用户点删除才删后端任务/音频。
        if (placeholder) {
          if (!placeholder.deleted) {
            placeholder.error = msg;
            setTrackState(placeholder, isAbort ? "cancelled" : "failed");
            if (currentTrack() === placeholder) showTrackNotice(placeholder, isAbort ? "已取消" : "生成失败", msg || "点删除可移除这张卡片");
          }
          removePendingJobForTrack(placeholder).catch(function(){});
          forgetDetachedBackgroundJob(placeholder);
          if (messageId) saveTracksForMessage(messageId, generatedTracks).catch(function(){});
          updateTrackButtons();
          if (!generatedTracks.length && !backgroundDetached) {
            currentCacheKey = "";
            if (seek) { seek.disabled = true; seek.value = "0"; }
            if (cur) cur.textContent = "00:00";
            if (total) total.textContent = "--:--";
            showTrackNotice(null, historyStatusText(), knownHistoryCount ? "点播放再读取历史音频" : "点播放开始生成音频");
            updateTrackButtons();
          }
        }
      }
    }
