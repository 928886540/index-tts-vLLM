// IndexTTS Tavo runtime part: 52_subtitle_media.js // Role: subtitle and MediaSession handling // This fragment is concatenated by static/tavo.runtime.js; it is not a standalone script.
    var DEFAULT_AVATARS = {
      narrator: scriptAssetUrl("tavo.assets/narrator.png"),
      user:     'data:image/svg+xml;charset=utf-8,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 512 512"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#1f3a5a"/><stop offset="1" stop-color="#0e1f33"/></linearGradient></defs><rect width="512" height="512" fill="url(#g)"/><text x="256" y="330" font-family="Microsoft YaHei,sans-serif" font-size="180" fill="#a5d4ff" text-anchor="middle" font-weight="bold">用</text></svg>'),
      character:'data:image/svg+xml;charset=utf-8,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 512 512"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#5a2240"/><stop offset="1" stop-color="#33152a"/></linearGradient></defs><rect width="512" height="512" fill="url(#g)"/><text x="256" y="330" font-family="Microsoft YaHei,sans-serif" font-size="180" fill="#ffd4e8" text-anchor="middle" font-weight="bold">人</text></svg>')
    };
    function avatarForRole(role) {
      role = String(role || "").trim();
      if (role === "旁白") return DEFAULT_AVATARS.narrator;
      if (role === "用户" || (context && context.userName && role === context.userName)) return userAvatarUrl || DEFAULT_AVATARS.user;
      var map = (context && context.roleAvatars) || {};
      var matched = role ? (map[role] || map[role.toLowerCase()]) : "";
      if (matched) return matched;
      return avatarUrl || DEFAULT_AVATARS.character;
    }
    var subBox = first(root, '[data-role="subtitle"]');
    var subtitleNoticeState = { key: "", at: 0 };
    function keepSubtitleChrome() {
      if (!subBox) return;
      try {
        if (subtitleToolbar) {
          if (subtitleToolbar.parentNode !== subBox) subBox.insertBefore(subtitleToolbar, subBox.firstChild || null);
          if (del && del.parentNode !== subtitleToolbar) subtitleToolbar.insertBefore(del, subtitleToolbar.firstChild || null);
          return;
        }
      } catch (_) {}
      try { if (del && del.parentNode !== subBox) subBox.appendChild(del); } catch (_) {}
    }
    function isTransientProgressNotice(titleText) {
      var title = String(titleText || "");
      if (!title) return false;
      if (/失败|错误|不可用|取消|删除|退出/.test(title)) return false;
      return /等待音频|正在连接音频|连接实时音频|连接断点音频|收到音频|网络缓冲|后台生成中|后台生成提交中|后端正在|后端处理中|处理中|提交|生成中|正在生成|正在合成|排队中|前面还有\s*\d+\s*个\s*TTS\s*任务|下一个开始|合成(?:第)?\s*\d+\s*\/\s*\d+(?:\s*段)?|(?:当前在播第|播第)\s*\d+|音频合成中|等待首段音频|等待\s*TTS\s*合成|TTS\s*合成|分段完成|任务已创建|音频已合成|正在保存|保存中|正在.*LLM|LLM\s*分段|检查 LLM|已复用 LLM|实时音频重连|正在加载音频|缓冲中/.test(title);
    }
    function normalizedNoticeKey(titleText, detailText) {
      return String(titleText || "").replace(/\d+\s*s/g, "Ns") + "\n" + String(detailText || "");
    }
    function showSubtitleNotice(titleText, detailText) {
      if (!subBox) return;
      var key = normalizedNoticeKey(titleText, detailText);
      var now = Date.now();
      if (subtitleNoticeState.key === key && now - subtitleNoticeState.at < 900) return;
      subtitleNoticeState.key = key;
      subtitleNoticeState.at = now;
      subBox.classList.remove('idx-hidden');
      var detailHtml = detailText ? escapeHtml(detailText).replace(/\n/g, "<br>") : "";
      Array.prototype.slice.call(subBox.children).forEach(function (node) {
        if (node === subtitleToolbar || node === del || node === counter || node === progressLine) return;
        try { node.remove(); } catch (_) {}
      });
      keepSubtitleChrome();
      var notice = document.createElement("div");
      notice.className = "idx-sub-notice";
      notice.innerHTML = '<strong>' + escapeHtml(titleText || "") + '</strong>' + (detailHtml ? '<span>' + detailHtml + '</span>' : '');
      subBox.appendChild(notice);
    }
    function hideSubtitlePanel() {
      stopSubtitle();
      showSubtitleNotice("未播放音频", historyStatusText());
    }
    function showTrackNotice(track, titleText, detailText) {
      if (track) {
        track.noticeTitle = titleText || "";
        track.noticeDetail = detailText || "";
      }
      var title = String(titleText || "");
      var allowLyricInterrupt = /失败|错误|不可用|取消|删除|退出/.test(title);
      var transientProgress = isTransientProgressNotice(title);
      if (transientProgress) {
        return;
      }
      if (!allowLyricInterrupt) {
        if (track && hasActiveSubtitleRows(track)) return;
        if (!track && activeSubtitle && hasActiveSubtitleRows(activeSubtitle.track)) return;
      }
      if (currentTrack() === track || !track) showSubtitleNotice(titleText, detailText);
    }
    function hasActiveSubtitleRows(track) {
      return !!(activeSubtitle && activeSubtitle.track === track && subBox && first(subBox, '.idx-sub-row'));
    }

    // 拆碎长文本成约 12-22 字的小段(歌词风格,一行可读)。
    // 1) 按句末标点切; 2) 还长就按逗号切; 3) 还长按 20 字硬切;
    // 4) 极短碎片(<=3 字)合并到前一行尾部,避免单字行。
    function splitLyricLines(s) {
      var raw = String(s || "").trim();
      if (!raw) return [];
      var stage1 = raw.split(/(?<=[。！？!?；;…])\s*|\n+/).map(function (x) { return x.trim(); }).filter(Boolean);
      var out = [];
      stage1.forEach(function (p) {
        if (p.length <= 22) { out.push(p); return; }
        var stage2 = p.split(/(?<=[，,、])\s*/).map(function (x) { return x.trim(); }).filter(Boolean);
        stage2.forEach(function (q) {
          if (q.length <= 22) { out.push(q); return; }
          for (var i = 0; i < q.length; i += 20) out.push(q.slice(i, i + 20));
        });
      });
      var merged = [];
      out.forEach(function (s) {
        if (merged.length && s.length <= 3) merged[merged.length - 1] += s;
        else merged.push(s);
      });
      return merged.length ? merged : [raw];
    }

    var activeSubtitle = null;
    var seekProgrammaticUpdate = false;
    function clearSubtitleDom() {
      if (!subBox) return;
      Array.prototype.slice.call(subBox.children).forEach(function (node) {
        if (node === subtitleToolbar || node === del || node === counter || node === progressLine) return;
        try { node.remove(); } catch (_) {}
      });
      keepSubtitleChrome();
    }
    function stopSubtitle() {
      if (!activeSubtitle) return;
      if (activeSubtitle.tickHandle) clearInterval(activeSubtitle.tickHandle);
      if (activeSubtitle.pollHandle) clearInterval(activeSubtitle.pollHandle);
      activeSubtitle = null;
    }

    function renderSubtitleRows(timeline, resetScroll) {
      if (!subBox) return;
      subBox.classList.remove('idx-hidden');
      clearSubtitleDom();
      // 头像不进歌词区(占空间)。说话人通过左上角 cover 切换体现。
      var html = timeline.map(function (row, idx) {
        var text = String(row.text || "");
        return '<div class="idx-sub-row" data-idx="' + idx + '" data-start="' + row.start.toFixed(3) + '" data-role-name="' + escapeHtml(displayRoleName(row.role || "旁白")) + '" title="点击跳转到这一句">'
          + '<span class="idx-sub-text">' + escapeHtml(text) + '</span>'
          + '</div>';
      }).join("");
      if (html) {
        var holder = document.createElement("div");
        holder.innerHTML = html;
        while (holder.firstChild) subBox.appendChild(holder.firstChild);
      }
      keepSubtitleChrome();
      if (resetScroll) { try { subBox.scrollTop = 0; } catch (_) {} }
      $all(subBox, '.idx-sub-row').forEach(function (row) {
        on(row, 'click', function () {
          var startSec = parseFloat(row.dataset.start || "0");
          try { seekToSeconds(startSec, { noticeTitle: "跳到歌词" }); } catch (_) {}
        });
      });
    }

    // 当前说话人 → 左上角 cover + 标题同步
    var lastSpeakerRole = "";
    function syncHeaderToSpeaker(role, text) {
      role = role || "";
      if (role && role !== lastSpeakerRole) {
        lastSpeakerRole = role;
        try {
          if (cover) {
            cover.textContent = "";
            cover.style.backgroundImage = "url(\"" + avatarForRole(role).replace(/"/g, "%22") + "\")";
            cover.style.backgroundSize = "cover";
            cover.style.backgroundPosition = "center";
          }
          if (title) title.textContent = displayRoleName(role);
        } catch (_) {}
      }
      if (role && (audio && !audio.paused || (currentTrack() && currentTrack().webAudioPlaying))) {
        setPlayingStatusForRole(role);
      }
      // 同步给系统媒体面板(后台/锁屏可见 + 控制)
      try { updateMediaSession(role, text); } catch (_) {}
    }
    function mediaArtworkType(src) {
      src = String(src || "");
      if (/^data:image\/svg\+xml/i.test(src) || /\.svg(?:[?#]|$)/i.test(src)) return "image/svg+xml";
      if (/\.png(?:[?#]|$)/i.test(src) || /^data:image\/png/i.test(src)) return "image/png";
      if (/\.(?:jpg|jpeg)(?:[?#]|$)/i.test(src) || /^data:image\/jpe?g/i.test(src)) return "image/jpeg";
      if (/\.webp(?:[?#]|$)/i.test(src) || /^data:image\/webp/i.test(src)) return "image/webp";
      return "";
    }
    function mediaArtworkEntries(src) {
      src = String(src || "");
      if (!src) src = scriptAssetUrl("tavo-now-playing-cover.png");
      var type = mediaArtworkType(src);
      return ["512x512", "1024x1024", "256x256"].map(function (size) {
        var item = { src: src, sizes: size };
        if (type) item.type = type;
        return item;
      });
    }
    function updateMediaSession(speakerRole, currentText) {
      if (!navigator.mediaSession || typeof MediaMetadata === "undefined") return;
      try {
        var ms = navigator.mediaSession;
        var charName = (context && context.characterName) ? context.characterName : (cfg.defaultVoice || "IndexTTS");
        var role = speakerRole || lastSpeakerRole || "";
        var artSrc = avatarForRole(role) || avatarForRole("") || scriptAssetUrl("tavo-now-playing-cover.png");
        ms.metadata = new MediaMetadata({
          title: (currentText ? String(currentText).slice(0, 60) : charName),
          artist: displayRoleName(role) || charName,
          album: "IndexTTS",
          artwork: mediaArtworkEntries(artSrc),
        });
        ms.setActionHandler('play',  function () { try { playOrPauseCurrentTrack().catch(function(){}); } catch (_) {} });
        ms.setActionHandler('pause', function () { try { if (currentTrack() && currentTrack().webAudioPlaying) { var t = currentTrack(); if (t) t.pausedByUser = true; stopWebAudioPlayback("pause"); } else audio.pause(); } catch (_) {} });
        try { ms.setActionHandler('previoustrack', null); } catch (_) {}
        try { ms.setActionHandler('nexttrack', null); } catch (_) {}
        ms.setActionHandler('seekbackward', function (details) {
          try { if (isCancelableLiveTrack(currentTrack())) return; seekBySeconds(-Math.max(1, Number(details && details.seekOffset) || 10)); } catch (_) {}
        });
        ms.setActionHandler('seekforward', function (details) {
          try { if (isCancelableLiveTrack(currentTrack())) return; seekBySeconds(Math.max(1, Number(details && details.seekOffset) || 10)); } catch (_) {}
        });
        ms.setActionHandler('seekto', function (details) {
          try {
            var pos = Number(details && details.seekTime);
            if (isFinite(pos)) {
              var track = currentTrack();
              var dur = Number(audio && audio.duration);
              if (isCancelableLiveTrack(track)) return;
              if (audio && (audio.currentSrc || audio.src) && isFinite(dur) && dur > 0) audio.currentTime = Math.max(0, Math.min(dur - 0.05, pos));
              else seekToSeconds(Math.max(0, pos), { noticeTitle: "系统进度跳转" });
            }
          } catch (_) {}
        });
        try {
          var activeForMedia = currentTrack();
          var mediaDur = Number(audio && audio.duration);
          var mediaHint = trackDurationHintSec(activeForMedia);
          if ((!isFinite(mediaDur) || mediaDur <= 0) && mediaHint > 0) mediaDur = mediaHint;
          if (audio && isFinite(mediaDur) && mediaDur > 0) {
            var mediaPos = elementPlaybackTimeSec(activeForMedia);
            ms.setPositionState({
              duration: mediaDur,
              playbackRate: audio.playbackRate || 1,
              position: Math.min(mediaPos, mediaDur),
            });
          }
        } catch (_) {}
      } catch (_) {}
    }

    function setRowClass(idx, currentIdx) {
      if (!subBox) return;
      var rows = $all(subBox, '.idx-sub-row');
      rows.forEach(function (r) {
        var i = Number(r.dataset.idx);
        r.classList.remove('is-current', 'is-past');
        if (i === currentIdx) r.classList.add('is-current');
        else if (i < currentIdx) r.classList.add('is-past');
      });
    }

    function scrollCurrentIntoMiddle() {
      if (!subBox) return;
      var now = Date.now();
      if (subBox.__idxLastLyricScroll && now - subBox.__idxLastLyricScroll < 450) return;
      var cur = first(subBox, '.idx-sub-row.is-current');
      if (!cur) return;
      try {
        var boxRect = subBox.getBoundingClientRect();
        var rowRect = cur.getBoundingClientRect();
        var offset = (rowRect.top + rowRect.height / 2) - (boxRect.top + boxRect.height / 2);
        var deadZone = Math.max(18, boxRect.height * 0.18);
        if (Math.abs(offset) > deadZone) {
          subBox.__idxLastLyricScroll = now;
          subBox.scrollTop = Math.max(0, subBox.scrollTop + offset);
        }
      } catch (_) {}
    }

    function startSubtitle(trackEntry, getTimeSec) {
      stopSubtitle();
      var segs = (trackEntry && trackEntry.segments) || [];
      var gap = (Number(cfg.intervalMs || 350) / 1000);
      var timeline = [];
      var lastIdx = -1;
      var lastMetaSignature = "";
      var lastPlanSignature = "";
      var state = { tickHandle: null, pollHandle: null, track: trackEntry };
      activeSubtitle = state;
      function normalizeSubtitleSegments(list) {
        return (Array.isArray(list) ? list : []).map(function (s, i) {
          return {
            idx: s && s.idx != null ? Number(s.idx) : i,
            role: (s && s.role) || "",
            text: (s && s.text) || "",
            style: (s && s.style) || "neutral",
            style_alpha: s && s.style_alpha,
            start_s: s && s.start_s,
            start_offset_bytes: s && s.start_offset_bytes,
            duration_s: s && s.duration_s
          };
        }).filter(function (s) { return String(s.text || "").trim(); });
      }
      function subtitleSegmentSignature(list) {
        return normalizeSubtitleSegments(list).map(function (m) {
          return [m.idx, m.role || "", m.text || "", Number(m.start_s || 0).toFixed(3), Number(m.start_offset_bytes || 0), Number(m.duration_s || 0).toFixed(3)].join(":");
        }).join("|");
      }
      function plannedSegmentsFromStatus(j) {
        if (!j) return [];
        if (Array.isArray(j.segments_plan) && j.segments_plan.length) return normalizeSubtitleSegments(j.segments_plan);
        if (j.metrics && Array.isArray(j.metrics.segments_plan) && j.metrics.segments_plan.length) return normalizeSubtitleSegments(j.metrics.segments_plan);
        return [];
      }
      function mergeMetaWithPlan(metaList, planList) {
        var meta = normalizeSubtitleSegments(metaList);
        var plan = normalizeSubtitleSegments(planList);
        var count = Math.max(meta.length, plan.length);
        var out = [];
        for (var i = 0; i < count; i += 1) {
          var p = plan[i] || {};
          var m = meta[i] || {};
          var row = Object.assign({}, p, m);
          if (!row.text) row.text = p.text || m.text || "";
          if (!row.role) row.role = p.role || m.role || "旁白";
          if (row.idx == null || !isFinite(Number(row.idx))) row.idx = i;
          if (String(row.text || "").trim()) out.push(row);
        }
        return out;
      }
      function showWaitingSubtitleNotice() {
        if (trackEntry && trackEntry.cacheKey && !isSavedTrack(trackEntry)) {
          showSubtitleNotice("等待歌词…", "后端返回分段后自动显示");
        } else {
          showSubtitleNotice("暂无歌词", "音频可播放，但没有拿到分段字幕");
        }
      }
      function rebuild(metaList, sampleRate) {
        var t = 0;
        timeline = [];
        var count = Math.max(segs.length, (metaList && metaList.length) || 0);
        if (!count) {
          showWaitingSubtitleNotice();
          return false;
        }
        for (var i = 0; i < count; i++) {
          var seg = (metaList && metaList[i]) || segs[i] || {};
          var segDur;
          var m = metaList && metaList[i];
          if (m && m.duration_s != null && m.duration_s > 0) segDur = m.duration_s;
          else segDur = Math.max(0.6, (seg.text || "").length * 0.15);
          var exactStart = segmentStartSec(m || seg, sampleRate || (trackEntry && trackEntry.sampleRate));
          if (isFinite(exactStart)) t = exactStart;
          // 长文本按句号/逗号拆成 12-22 字的小段
          var subs = splitLyricLines(seg.text);
          var totalChars = subs.reduce(function (a, s) { return a + s.length; }, 1);
          var subStart = t;
          for (var j = 0; j < subs.length; j++) {
            var subDur = segDur * (subs[j].length / totalChars);
            timeline.push({
              role: seg.role || "旁白",
              text: subs[j],
              start: subStart,
              end: subStart + subDur,
            });
            subStart += subDur;
          }
          t = isFinite(exactStart) ? (exactStart + segDur) : (t + segDur + gap);
        }
        renderSubtitleRows(timeline, !metaList);
        if (metaList) lastIdx = -1;
        return timeline.length > 0;
      }
      if (!rebuild() && !(trackEntry && trackEntry.cacheKey)) {
        activeSubtitle = null;
        return;
      }
      state.tickHandle = setInterval(function () {
        if (activeSubtitle !== state) return;
        if (!timeline.length) return;
        var t;
        try { t = getTimeSec(); } catch (_) { t = NaN; }
        if (!isFinite(t) || t < 0) return;
        t = clampPlaybackTimeSec(trackEntry, t);
        var displayT = t + clampNumber(cfg.subtitleLeadSec == null ? 0.30 : cfg.subtitleLeadSec, 0.30, 0, 1.0);
        if (timeline.length && isFinite(Number(timeline[timeline.length - 1].end))) {
          var end = Number(timeline[timeline.length - 1].end);
          if (end > 0 && displayT >= end) displayT = Math.max(0, end - 0.001);
        }
        var idx = -1;
        for (var i = 0; i < timeline.length; i++) {
          if (displayT >= timeline[i].start && displayT < timeline[i].end) { idx = i; break; }
          if (displayT >= timeline[i].start) idx = i;
        }
        if (idx >= 0 && idx !== lastIdx) {
          lastIdx = idx;
          setRowClass(idx, idx);
          scrollCurrentIntoMiddle();
          // 左上角 cover/标题 + 系统媒体面板同步当前说话人
          syncHeaderToSpeaker(timeline[idx].role, timeline[idx].text);
        }
      }, 100);
      // 后台轮询 job_status 拿真实 segments_meta 校准时间轴
      if (trackEntry.cacheKey) {
        function pollSubtitleMeta() {
          if (activeSubtitle !== state) return;
          fetch(cleanBase(cfg.apiBase) + "/tts_dialogue_job_status/" + encodeURIComponent(trackEntry.cacheKey))
            .then(function (r) { return r.ok ? r.json() : null; })
            .then(function (j) {
              if (!j) return;
              var plan = plannedSegmentsFromStatus(j);
              var meta = normalizeSubtitleSegments(j.segments_meta || []);
              if (plan.length) {
                var planSig = subtitleSegmentSignature(plan);
                if (planSig && planSig !== lastPlanSignature) {
                  lastPlanSignature = planSig;
                  trackEntry.segmentPlan = plan;
                }
              }
              if (meta.length || (trackEntry.segmentPlan && trackEntry.segmentPlan.length)) {
                var merged = mergeMetaWithPlan(meta, trackEntry.segmentPlan || []);
                var metaSig = subtitleSegmentSignature(merged);
                if (metaSig && metaSig !== trackEntry.segmentsSignature) {
                  trackEntry.segmentsSignature = metaSig;
                  segs = merged;
                  trackEntry.segments = merged;
                  if (messageId && isSavedTrack(trackEntry)) saveTracksForMessage(messageId, generatedTracks).catch(function(){});
                }
                if (j.sample_rate) trackEntry.sampleRate = j.sample_rate;
                if (j.duration_s) trackEntry.duration_s = j.duration_s;
                if (j.metrics) trackEntry.metrics = j.metrics;
                var sig = subtitleSegmentSignature(merged);
                if (sig !== lastMetaSignature) {
                  lastMetaSignature = sig;
                  rebuild(meta, j.sample_rate);
                }
              }
              if (j.state === "done" || j.state === "failed") {
                if (state.pollHandle) { clearInterval(state.pollHandle); state.pollHandle = null; }
              }
            })
            .catch(function () {});
        }
        state.pollHandle = setInterval(pollSubtitleMeta, 800);
        pollSubtitleMeta();
      }
    }

    // ───── 结构化角色映射 + 音色选择器 ─────
    // 注意:panel 和 picker 在 mount 顶部已经被 appendChild 到 document.body,
    // root 内查不到这两棵子树。rolesList 必须从 panel 查,picker 相关从 pickerEl 自身查。
