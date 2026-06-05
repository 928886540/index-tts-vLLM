// IndexTTS Tavo runtime part: 50_settings_fields.js // Role: settings fields, role validation and voice list loading // This fragment is concatenated by static/tavo.runtime.js; it is not a standalone script.
    function findInWidget(sel) { return $(root, sel) || $(panel, sel); }
    function field(name) { return findInWidget('[data-field="' + name + '"]'); }
    // IME-safe setField：用户正在输入或中文输入法组词时，不覆盖 input.value，
    // 否则搜狗/微软等 IME 的候选词会被清掉，导致打不进字。
    function setField(name, value) {
      var el = field(name); if (!el) return;
      if (document.activeElement === el) return;            // 正在输入
      if (el.__indexttsComposing) return;                    // 中文输入法组词中
      var v = value == null ? "" : value;
      if (el.value !== String(v)) el.value = v;
    }
    function getField(name, fallback) { var el = field(name); return el ? el.value : fallback; }
    function setCheckedField(name, value) { var el = field(name); if (el) el.checked = !!value; }
    function getCheckedField(name, fallback) { var el = field(name); return el ? !!el.checked : !!fallback; }
    function clampNumber(value, fallback, min, max) {
      var n = Number(value);
      if (!isFinite(n)) n = fallback;
      return Math.max(min, Math.min(max, n));
    }
    function readFields() {
      cfg.apiBase = String(getField("apiBase", cfg.apiBase || scriptOrigin())).trim() || scriptOrigin();
      cfg.intervalMs = Number(getField("intervalMs", cfg.intervalMs || 50) || 50);
      cfg.speedFactor = clampNumber(getField("speedFactor", cfg.speedFactor || 1.0), 1.0, 0.85, 1.25);
      cfg.qualityMode = String(getField("qualityMode", cfg.qualityMode || "balanced") || "balanced").trim();
      if (["fast", "balanced", "expressive"].indexOf(cfg.qualityMode) < 0) cfg.qualityMode = "balanced";
      cfg.offlineAudioEnabled = getCheckedField("offlineAudioEnabled", cfg.offlineAudioEnabled);
      try { audio.playbackRate = cfg.speedFactor; } catch (_) {}
      // cfg.roleVoiceList 由 renderRoleList 实时维护(addRoleRow/setRowVoice 等),
      // 这里把行里的角色名/音色同步抓一遍(防止用户没失焦就保存)。
      var rows = $all(panel, '.idx-role-row');
      var newList = [];
      rows.forEach(function (row) {
        var nameEl = first(row, '.idx-role-name');
        var role = nameEl ? String(nameEl.value || "").trim() : "";
        var voice = row.dataset.voice || "";
        if (role || voice) newList.push({ role: role, voice: voice });
      });
      if (newList.length) cfg.roleVoiceList = newList;
      cfg.roleVoicesText = serializeRoleVoiceList(cfg.roleVoiceList);  // 同步序列化兜底
      cfg.llmModel = String(getField("llmModel", cfg.llmModel || "")).trim();
      cfg.llmEndpoint = String(getField("llmEndpoint", cfg.llmEndpoint || "")).trim();
      cfg.llmApiKey = String(getField("llmApiKey", cfg.llmApiKey || "")).trim();
      cfg.reuseLlmParse = getCheckedField("reuseLlmParse", cfg.reuseLlmParse !== false);
    }
    function isDialogOpen(d) {
      return !!(d && (d.open || d.hasAttribute && d.hasAttribute("open")));
    }
    async function refreshCharacterConfig(opts) {
      opts = opts || {};
      if (opts.skipIfEditing && isDialogOpen(panel)) return false;
      var charCfg = null;
      try { charCfg = await loadCharacterCfg(characterId); } catch (_) { charCfg = null; }
      if (!charCfg || typeof charCfg !== "object") return false;
      var changed = false;
      if (typeof charCfg.defaultVoice === "string" && charCfg.defaultVoice !== cfg.defaultVoice) {
        cfg.defaultVoice = charCfg.defaultVoice;
        changed = true;
      }
      if (Array.isArray(charCfg.roleVoiceList) && charCfg.roleVoiceList.length) {
        var nextList = normalizeRoleVoiceList(charCfg.roleVoiceList, cfg.currentCharacterName, charCfg.characterName);
        if (JSON.stringify(nextList) !== JSON.stringify(normalizeRoleVoiceList(cfg.roleVoiceList || [], cfg.currentCharacterName))) {
          cfg.roleVoiceList = nextList;
          changed = true;
        }
      }
      if (changed || opts.forceSync) syncUI();
      return changed;
    }
    function roleVoice(roleName) {
      roleName = String(roleName || "").trim();
      var list = normalizeRoleVoiceList(cfg.roleVoiceList || [], cfg.currentCharacterName);
      for (var i = 0; i < list.length; i++) {
        if (String(list[i].role || "").trim() === roleName) return String(list[i].voice || "").trim();
      }
      return "";
    }
    function validateVoiceMappingForGenerate() {
      if (cfg.mode === "single") {
        return cfg.defaultVoice ? "" : "请先在“音色选择”里选择单音色音色。";
      }
      var missing = [];
      var list = normalizeRoleVoiceList(cfg.roleVoiceList || [], cfg.currentCharacterName);
      ["旁白", "用户"].forEach(function (name) {
        if (!roleVoice(name)) missing.push(name);
      });
      list.forEach(function (r) {
        var role = String((r && r.role) || "").trim();
        if (!role || role === "旁白" || role === "用户") return;
        if (!String(r.voice || "").trim()) missing.push(role);
      });
      if (missing.length) return "请先在“角色音色映射”里给这些角色选择音色：" + missing.join("、") + "。";
      return "";
    }
    function modeName() { return cfg.mode === "ai8" ? "多音色" : "单音色"; }
    function syncUI() {
      setField("apiBase", cfg.apiBase || scriptOrigin());
      setField("intervalMs", Number(cfg.intervalMs || 50));
      setField("llmModel", cfg.llmModel || "");
      setField("llmEndpoint", cfg.llmEndpoint || "");
      setField("llmApiKey", cfg.llmApiKey || "");
      setField("speedFactor", cfg.speedFactor || 1.0);
      setField("qualityMode", cfg.qualityMode || "balanced");
      setCheckedField("offlineAudioEnabled", cfg.offlineAudioEnabled);
      setCheckedField("reuseLlmParse", cfg.reuseLlmParse !== false);
      try { audio.playbackRate = clampNumber(cfg.speedFactor || 1.0, 1.0, 0.85, 1.25); } catch (_) {}
      renderRoleList();
      // AI 八情绪 设置只在该模式下显示；单音色配置反之
      try {
        var ai8Show = (cfg.mode === "ai8");
        $all(panel, '.idx-ai8-only').forEach(function (el) { el.style.display = ai8Show ? "" : "none"; });
        $all(panel, '.idx-single-only').forEach(function (el) { el.style.display = ai8Show ? "none" : ""; });
      } catch (_) {}
      // 当前 mode 按钮高亮
      try {
        $all(panel, '.idx-mode').forEach(function (b) {
          if (b.dataset.mode === cfg.mode) b.setAttribute("data-active", "1"); else b.removeAttribute("data-active");
        });
      } catch (_) {}
      if (voicePill) voicePill.textContent = "音色：" + shortName(cfg.defaultVoice);
      if (modePill) modePill.textContent = "模式：" + modeName();
      if (title) title.textContent = (context && context.characterName ? context.characterName : shortName(cfg.defaultVoice));
      if (cover) {
        if (avatarUrl) {
          cover.textContent = "";
          cover.style.backgroundImage = "url(\"" + String(avatarUrl).replace(/"/g, "%22") + "\")";
          cover.style.backgroundSize = "cover";
          cover.style.backgroundPosition = "center";
        } else {
          cover.style.backgroundImage = "";
          cover.textContent = (context && context.characterName ? context.characterName : shortName(cfg.defaultVoice)).slice(0, 1) || "";
        }
      }
      $all(panel, '.idx-mode').forEach(function (b) { b.classList.toggle('is-active', b.dataset.mode === cfg.mode); });
      $all(panel, '.idx-voice').forEach(function (b) { b.classList.toggle('is-active', b.dataset.voice === cfg.defaultVoice); });
    }
    var availableVoices = [];
    var voicesLoaded = false;
    var voicesLoading = null;
    function voiceCategoryRank(subdir) {
      subdir = String(subdir || "");
      if (subdir === "女声") return 0;
      if (subdir === "男声") return 1;
      if (subdir === "情绪") return 2;
      if (subdir === "声腔") return 3;
      if (subdir === "喘息") return 4;
      if (!subdir) return 99;
      return 50;
    }
    function sortVoices(list) {
      return (list || []).slice().sort(function (a, b) {
        var ra = voiceCategoryRank(a && a.subdir);
        var rb = voiceCategoryRank(b && b.subdir);
        if (ra !== rb) return ra - rb;
        var sa = String((a && a.subdir) || "");
        var sb = String((b && b.subdir) || "");
        if (sa !== sb) return sa.localeCompare(sb, "zh-Hans-CN");
        return String((a && a.name) || "").localeCompare(String((b && b.name) || ""), "zh-Hans-CN");
      });
    }
    async function renderVoices() {
      setStatus("正在读取音色列表...");
      var voices = await listVoices(cfg.apiBase);
      availableVoices = sortVoices(voices);
      // 旧 voicesBox grid 已经被"默认音色按钮"替代,这里只更新按钮文本
      var defBtn = first(panel, '[data-role="default-voice-btn"]');
      if (defBtn) defBtn.textContent = cfg.defaultVoice ? cfg.defaultVoice : "选择默认音色…";
      syncUI();
      setStatus(historyStatusText());
      if (!generatedTracks.length) showTrackNotice(null, historyStatusText(), voices.length ? "点播放开始生成音频" : "没有找到可用音色");
      return availableVoices;
    }
    async function ensureVoicesLoaded() {
      if (voicesLoaded) return availableVoices;
      if (voicesLoading) return voicesLoading;
      voicesLoading = renderVoices().then(function (list) {
        voicesLoaded = true;
        return list || availableVoices;
      }).finally(function () {
        voicesLoading = null;
      });
      return voicesLoading;
    }
    async function previewVoice() {
      if (!cfg.defaultVoice) return;
    if (preview) { try { preview.pause(); } catch (_) {} }
      preview = new Audio(cleanBase(cfg.apiBase) + "/voice_preview?name=" + encodeURIComponent(cfg.defaultVoice));
      setStatus("正在试听：" + shortName(cfg.defaultVoice));
      preview.addEventListener('ended', function () { setStatus("试听完成"); });
      preview.addEventListener('error', function () { setStatus("试听失败"); });
      try { await preview.play(); } catch (_) { setStatus("试听失败，请点一下页面后重试"); }
    }

    // ───── 实时字幕控制器 ───── (按当前播放时间显示对应 segment 的角色头像+台词)
