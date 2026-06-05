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
      showTrackNotice(track, "已暂停", track.cacheKey ? "不会自动恢复流式；保存完成后点播放会检查历史音频" : "已停止等待");
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
        if (existingTrack.webAudioPlaying || isElementPlayingTrackStream(existingTrack) || (elementAudioBelongsToTrack(existingTrack) && !audio.paused && !audio.ended)) {
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
        if ((isLiveTrack(existingTrack) || trackState(existingTrack) === "pending") && play && play.dataset.state === "loading") {
          pauseLiveTrack(existingTrack);
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
          if (existingTrack.cacheKey && await refreshTrackFromStatus(existingTrack, "play snapshot")) {
            if (shouldUseElementForSavedTrack(existingTrack)) {
              await prepareOfflineAudio(existingTrack, "play saved", { saveMissing: true });
              startElementAudioFrom(existingTrack, trackResumeSec(existingTrack));
              return;
            }
          }
          var liveUrl = liveStreamUrlForTrack(existingTrack);
          if (liveUrl) {
            var manualResumeSec = trackResumeSec(existingTrack);
            existingTrack.allowStreamPlay = false;
            setStatus(manualResumeSec > 0 ? "从断点继续…" : "连接流式音频…");
            showTrackNotice(existingTrack, manualResumeSec > 0 ? "从断点继续播放" : "连接流式音频", manualResumeSec > 0 ? ("从 " + formatTime(manualResumeSec) + " 继续，后台仍在合成") : "后台仍在合成，连接后从断点继续");
            await playLiveTrack(existingTrack, liveUrl, {
              noticeTitle: manualResumeSec > 0 ? "从断点继续播放" : "连接流式音频",
              noticeDetail: manualResumeSec > 0 ? ("从 " + formatTime(manualResumeSec) + " 继续，后台仍在合成") : "后台仍在合成，连接后从断点继续",
              waitDetail: "等待后端继续输出 PCM",
              startOffsetSec: manualResumeSec
            });
            return;
          }
          setTrackPlaybackState(existingTrack, "error");
          setPlayState("idle");
          setStatus(existingTrack.cacheKey ? "音频已失效，点 + 重新生成" : "还没有音频，点 + 生成");
          showTrackNotice(existingTrack, existingTrack.cacheKey ? "需要重新生成" : "还没有音频", existingTrack.cacheKey ? "原流式任务已结束且无保存音频，点 + 重新生成" : "点 + 号开始生成");
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

      // ★ Bug 修复:点 ▶ / 🎵 第一时间 push 占位卡片,让用户立刻看见一张
      // "生成中…" 卡。后续的 LLM 拆段 + dialogue job 拿到 cacheKey 会
      // 原地把这张卡的属性填上(url, cacheKey, segments...),不会再 push 新的。
      var placeholder = null;
      if (cfg.mode === "ai8") {
        placeholder = {
          url: null,
          streamUrl: "",
          cacheUrl: "",
          cacheKey: "",
          createdAt: Date.now(),
          voice: cfg.defaultVoice,
          mode: cfg.mode,
          segments: [],
          state: "pending",
          status: "pending",
          pendingBlob: true,
        };
        generatedTracks.push(placeholder);
        currentTrackIndex = generatedTracks.length - 1;
        // 关键:重置 audio.src / seek / 标题 到新卡片,否则旧 audio 还在播,UI 错位
        try { audio.pause(); } catch (_) {}
        await selectTrack(currentTrackIndex, false);
        setStatus("准备生成…");
        showTrackNotice(placeholder, "准备生成…", "等待 LLM 分析文本");
        debugLog("🎵 立即 push 占位卡片(currentTrackIndex=" + currentTrackIndex + ")", "#9ff");
      }

      setPlayState("loading");
      try {
        var base = cleanBase(cfg.apiBase), body, url;
        if (cfg.mode === "ai8") {
          setStatus("提交到后端分析…");
          showTrackNotice(placeholder, "提交到后端分析…", "后端会负责 LLM 拆段、复用判断和合成状态");
          if (!cfg.llmEndpoint || !cfg.llmModel) throw new Error("AI 八情绪模式需要填写 LLM 接口地址和模型。");
          var t0 = Date.now();
          debugLog("━━━━━━━━━━━━━━━━━━━━━━━━━", "#fff");
          debugLog("🎬 AI 八情绪生成开始: 前端只提交 job, 后端负责 LLM 拆段 (text=" + messageText.length + " 字)", "#fff");
          startServerLogPolling(base);
          if (placeholder && placeholder.deleted) throw Object.assign(new Error("生成已取消"), { name: "AbortError" });
          var voicesMap = rolesListToVoicesMap(cfg.roleVoiceList, cfg.defaultVoice, cfg.currentCharacterName);
          var rolesHint = normalizeRoleVoiceList(cfg.roleVoiceList || [], cfg.currentCharacterName).map(function (r) { return String((r && r.role) || "").trim(); }).filter(Boolean);
          debugLog("🎙️ 音色映射: " + JSON.stringify(voicesMap), "#ffd479");
          body = Object.assign({
            text: messageText,
            voices: voicesMap,
            llm_endpoint: cfg.llmEndpoint,
            llm_model: cfg.llmModel,
            llm_api_key: cfg.llmApiKey || "",
            reuse_llm_parse: cfg.reuseLlmParse !== false,
            user_name: (context && context.userName) || "",
            character_name: (context && context.characterName) || cfg.currentCharacterName || "",
            roles_hint: rolesHint,
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
          if (force) body.cache_nonce = String(Date.now()) + "-" + Math.random().toString(36).slice(2);
          var ttsStart = Date.now();
          var jobInfo;
          var ttsTimer = setInterval(function () {
            var sec = Math.floor((Date.now() - ttsStart) / 1000);
            setStatus("后端处理中 " + sec + "s…");
            showTrackNotice(placeholder, "后端处理中 " + sec + "s…", "先拆段，再合成首段音频");
          }, 1000);
          try {
            debugLog("📡 提交 dialogue job: text-only, backend-owned parse", "#ffd479");
            jobInfo = await createDialogueStreamJob(base, body);
            debugLog("🔗 cache_key=" + jobInfo.cacheKey + " cached=" + jobInfo.cached + " live=" + jobInfo.live, "#9f9");
          } finally {
            clearInterval(ttsTimer);
          }
          if (placeholder && placeholder.deleted) {
            if (jobInfo && jobInfo.cacheKey) deleteRemoteTrack({ cacheKey: jobInfo.cacheKey }).catch(function () {});
            throw Object.assign(new Error("生成已取消"), { name: "AbortError" });
          }
          var streamUrl = jobInfo.streamUrl;
          var cacheUrl = jobInfo.cacheUrl;
          // 复用第一时间 push 的占位卡片(placeholder),原地填字段。这样
          // 不会出现"先一张占位 + 后一张真卡片"两张卡。
          var trackEntry = placeholder || {
            url: null,
            createdAt: Date.now(),
            voice: cfg.defaultVoice,
            mode: cfg.mode,
            pendingBlob: true,
          };
          trackEntry.streamUrl = streamUrl;
          trackEntry.cacheUrl = cacheUrl;
          trackEntry.cacheKey = jobInfo.cacheKey;
          trackEntry.segments = [];
          trackEntry.voicesMap = voicesMap;
          trackEntry.streamInterrupted = false;
          trackEntry.streamStalled = false;
          trackEntry.stalledCount = 0;
          trackEntry.streamHealth = "ok";
          trackEntry.savePromptAsked = false;
          trackEntry.allowStreamPlay = true;
          setTrackState(trackEntry, jobInfo.cached ? "saved" : "live");
          if (!placeholder) {
            // 防御性:正常路径下 placeholder 一定有,这里兜底
            generatedTracks.push(trackEntry);
            currentTrackIndex = generatedTracks.length - 1;
          }
          updateTrackButtons();
          if (messageId) {
            saveTracksForMessage(messageId, generatedTracks).catch(function(){});
            debugLog("💾 立即写 tavo.set cacheKey=" + jobInfo.cacheKey, "#9ff");
          }
          if (trackEntry.pausedByUser) {
            setStatus("已暂停，后台保存中");
            showTrackNotice(trackEntry, "已暂停", "合成还在后台进行，保存后会成为历史音频");
            pollCacheUpgrade(trackEntry, "paused snapshot");
            stopServerLogPolling();
            return;
          }
          // 如果服务端早就有这条音频的缓存，走完整音频播放器；这是可拖动进度条的路径。
          if (jobInfo.cached && cacheUrl) {
            trackEntry.url = cacheUrl;
            setTrackState(trackEntry, "saved");
            await prepareOfflineAudio(trackEntry, "cached hit", { saveMissing: true });
            setStatus("已有音频，正在播放");
            showTrackNotice(trackEntry, trackEntry.offlineUrl ? "本地离线音频" : "已有音频", trackEntry.offlineUrl ? "已从 IndexedDB 读取" : "已加载音频，支持拖动");
            setPlayState("loading");
            debugLog(trackEntry.offlineUrl ? "⚡ 命中本地离线音频，直接播放" : "⚡ 命中服务端缓存，直接 audio.src 播放", "#9f9");
            startElementAudioFrom(trackEntry, 0);
            return;
          }
          // 没缓存 → 走流式（移动 Web Audio / 桌面 <audio src>）。后端是异步
          // job，断线重连不丢；同时 GET 完成后会自动落盘到 snapshot_cache。
          if (shouldUseWebAudioForLiveTrack(trackEntry)) {
            setStatus("等待首段音频…");
            showTrackNotice(trackEntry, "等待首段音频…", "正在合成，声音出来前不要切走");
            debugLog("▶️ live track 使用 Web Audio API 真流式", "#ffd479");
            currentCacheKey = jobInfo.cacheKey;
            setPlayState("loading");
            pollCacheUpgrade(trackEntry, "web audio snapshot");
            trackEntry.allowStreamPlay = false;
            await playLiveTrack(trackEntry, streamUrl, { noticeTitle: "等待首段音频…", noticeDetail: "正在合成，声音出来前不要切走", waitDetail: "正在合成第一段" });
            if (isSavedTrack(trackEntry)) attachCacheAudio(trackEntry, { deferElement: true });
            stopServerLogPolling();
            return;
          } else {
            // 默认把 chunked WAV 交给 <audio> 元素播放。Tavo/WebView 的
            // WebAudio 时钟可能会走但系统音频不出声；原生 audio 更可靠。
            trackEntry.url = streamUrl;
            trackEntry.streaming = true;
            var totalSec = Math.floor((Date.now() - t0) / 1000);
            currentCacheKey = jobInfo.cacheKey;
            setPlayState("loading");
            debugLog("▶️ 启动 audio 元素流式播放, 截至此处用时 " + totalSec + "s", "#9f9");
            pollCacheUpgrade(trackEntry, "audio element snapshot");
            trackEntry.allowStreamPlay = false;
            await playLiveTrack(trackEntry, streamUrl, { noticeTitle: "等待首段音频…", noticeDetail: "正在合成，声音出来前不要切走", waitDetail: "正在合成第一段" });
            // 音频播完后停止服务端日志轮询
            try {
              audio.addEventListener("ended", stopServerLogPolling, { once: true });
              audio.addEventListener("error", stopServerLogPolling, { once: true });
              audio.addEventListener("pause", function () { if (audio.currentTime >= (audio.duration || 0) - 0.05) stopServerLogPolling(); });
            } catch (_) { stopServerLogPolling(); }
          }
        } else {
          var singleJob = await createSingleStreamJob(base, cfg, messageText, force);
          var singleTrack = {
            url: singleJob.cached && singleJob.cacheUrl ? singleJob.cacheUrl : singleJob.streamUrl,
            streamUrl: singleJob.streamUrl,
            cacheUrl: singleJob.cacheUrl,
            cacheKey: singleJob.cacheKey,
            deleteUrl: singleDeleteUrl(base, cfg, messageText),
            createdAt: Date.now(),
            voice: cfg.defaultVoice,
            mode: cfg.mode,
            state: singleJob.cached ? "saved" : "live",
            status: singleJob.cached ? "ready" : "running",
            pendingBlob: !singleJob.cached,
            streaming: !singleJob.cached,
            streamInterrupted: false,
            streamStalled: false,
            stalledCount: 0,
            streamHealth: "ok",
            savePromptAsked: false,
            allowStreamPlay: !singleJob.cached
          };
          setTrackState(singleTrack, singleJob.cached ? "saved" : "live");
          if (singleJob.cached) await prepareOfflineAudio(singleTrack, "single cached hit", { saveMissing: true });
          generatedTracks.push(singleTrack);
          await selectTrack(generatedTracks.length - 1, false);
          if (messageId) saveTracksForMessage(messageId, generatedTracks).catch(function(){});
          setStatus(singleJob.cached ? "已有单音色音频" : "正在生成单音色音频...");
          showTrackNotice(currentTrack(), singleJob.cached ? (singleTrack.offlineUrl ? "本地离线音频" : "已有单音色音频") : "正在生成单音色音频…", singleJob.cached ? "马上开始播放" : "声音出来后会自动播放");
        }
        setAudioPlaybackRate();
        await audio.play().catch(function (e) {
          if (e && e.name === 'AbortError') return;
          handleAudioPlayReject("element", e, "请点播放继续");
          if (!isUnsupportedPlayError(e)) throw e;
        });
      } catch (e) {
        var msg = String((e && e.message) || e || "");
        var isAbort = (e && e.name === 'AbortError') || /aborted/i.test(msg);
        setPlayState("idle");
        stopServerLogPolling();
        // 切卡/切角色导致的 AbortError 是正常用户操作,不弹红色错误
        if (isAbort) {
          setStatus("已取消");
          debugLog("⏸ 生成被中断(切卡/切角色等): " + msg, "#fc9");
        } else {
          setStatus("生成失败");
          setError(msg);
          debugLog("❌ 错误: " + msg, "#f99");
        }
        // 生成失败 → 从列表里删掉占位卡片,避免留死卡
        if (placeholder) {
          var idx = generatedTracks.indexOf(placeholder);
          if (idx >= 0) {
            generatedTracks.splice(idx, 1);
            if (currentTrackIndex >= generatedTracks.length) currentTrackIndex = generatedTracks.length - 1;
            updateTrackButtons();
            debugLog("🗑 移除失败的占位卡片", "#fc9");
          }
        }
      }
    }
