// IndexTTS Tavo runtime part: 54_voice_picker.js // Role: role rows and voice picker panel // This fragment is concatenated by static/tavo.runtime.js; it is not a standalone script.
    var rolesListEl    = first(panel, '[data-role="roles-list"]');
    var pickerEl       = (typeof pickerNode !== "undefined" && pickerNode) || first(panel.parentNode || document.body, '[data-role="voice-picker"]');
    var pickerGridEl   = first(pickerEl, '[data-role="picker-grid"]');
    var pickerTabsEl   = first(pickerEl, '[data-role="picker-tabs"]');
    var pickerSearchEl = first(pickerEl, '[data-role="picker-search"]');
    var pickerPageEl   = first(pickerEl, '[data-role="picker-page"]');
    var pickerPrevEl   = first(pickerEl, '[data-role="picker-prev"]');
    var pickerNextEl   = first(pickerEl, '[data-role="picker-next"]');
    var pickerState = { rowIdx: -1, tab: "", search: "", page: 1, pageSize: 12 };
    var reopenPanelAfterPicker = false;

    function renderRoleList() {
      if (!rolesListEl) return;
      // 始终确保前两行常驻槽存在(旁白/用户),即使旧数据丢失也补齐
      cfg.roleVoiceList = cfg.roleVoiceList || [];
      while (cfg.roleVoiceList.length < RESERVED_ROLES.length) {
        cfg.roleVoiceList.push({ role: RESERVED_ROLES[cfg.roleVoiceList.length] || "", voice: "" });
      }
      cfg.roleVoiceList = normalizeRoleVoiceList(cfg.roleVoiceList, cfg.currentCharacterName);
      var list = cfg.roleVoiceList;
      // 渲染前同步用户当前在输入框里的值,避免重渲染清空未保存输入
      var rows = $all(panel, '.idx-role-row');
      rows.forEach(function (row, i) {
        var nameEl = first(row, '.idx-role-name');
        if (nameEl && list[i]) list[i].role = String(nameEl.value || "").trim();
      });
      rolesListEl.innerHTML = list.map(function (item, idx) {
        var role = String(item.role || "");
        var voice = String(item.voice || "");
        var protectedRow = idx < RESERVED_ROLES.length;
        return ''
          + '<div class="idx-role-row' + (protectedRow ? ' idx-role-protected' : '') + '" data-row-idx="' + idx + '" data-voice="' + escapeHtml(voice) + '">'
          + '<input class="idx-role-name" type="text" placeholder="角色名" value="' + escapeHtml(role) + '"' + (protectedRow ? ' readonly' : '') + '>'
          + '<button class="idx-voice-btn" type="button">' + escapeHtml(voice || "选择音色…") + '</button>'
          + (protectedRow
              ? '<span class="idx-role-lock" title="常驻角色,不可删除">🔒</span>'
              : '<button class="idx-role-del" type="button" title="删除">×</button>')
          + '</div>';
      }).join("");
      $all(rolesListEl, '.idx-role-row').forEach(function (row) {
        var idx = Number(row.dataset.rowIdx);
        var nameEl = first(row, '.idx-role-name');
        var voiceBtn = first(row, '.idx-voice-btn');
        var delBtn = first(row, '.idx-role-del');  // protected 行没有这个元素,first 返回 null,on 跳过
        on(nameEl, 'input', function () {
          if (!cfg.roleVoiceList[idx]) cfg.roleVoiceList[idx] = { role: "", voice: "" };
          cfg.roleVoiceList[idx].role = String(nameEl.value || "").trim();
        });
        on(nameEl, 'change', function () { saveConfig(cfg, characterId).catch(function(){}); });
        on(voiceBtn, 'click', function (e) { e.preventDefault(); e.stopPropagation(); openVoicePicker(idx).catch(function (err) { setError(err && err.message ? err.message : String(err)); }); });
        on(delBtn, 'click', function (e) {
          e.preventDefault(); e.stopPropagation();
          if (cfg.roleVoiceList && cfg.roleVoiceList[idx] !== undefined) {
            cfg.roleVoiceList.splice(idx, 1);
            renderRoleList();
          }
        });
      });
    }

    function nextNewRoleName() {
      var used = {};
      (cfg.roleVoiceList || []).forEach(function (r) {
        var role = String((r && r.role) || "").trim();
        if (role) used[role] = true;
      });
      var n = 1;
      while (used["新角色" + n]) n += 1;
      return "新角色" + n;
    }

    function focusLastEditableRole() {
      setTimeout(function () {
        var rows = $all(rolesListEl, '.idx-role-row');
        for (var i = rows.length - 1; i >= 0; i -= 1) {
          var nameEl = first(rows[i], '.idx-role-name');
          if (nameEl && !nameEl.readOnly) {
            nameEl.focus();
            try { nameEl.select(); } catch (_) {}
            return;
          }
        }
      }, 0);
    }

    function addRoleRow() {
      cfg.roleVoiceList = cfg.roleVoiceList || [];
      // 前两槽位是 reserved,addRoleRow 总是在末尾追加新可删行
      cfg.roleVoiceList.push({ role: nextNewRoleName(), voice: "" });
      renderRoleList();
      focusLastEditableRole();
    }

    function setRowVoice(idx, voiceName) {
      if (!cfg.roleVoiceList[idx]) cfg.roleVoiceList[idx] = { role: "", voice: "" };
      cfg.roleVoiceList[idx].voice = voiceName;
      renderRoleList();
    }

    async function openVoicePicker(rowIdx) {
      if (!pickerEl) return;
      pickerState.rowIdx = rowIdx;
      pickerState.tab = "";
      pickerState.search = "";
      pickerState.page = 1;
      if (pickerSearchEl) pickerSearchEl.value = "";
      if (pickerTabsEl) pickerTabsEl.innerHTML = "";
      if (pickerGridEl) pickerGridEl.innerHTML = '<div style="grid-column:1/-1;padding:20px;text-align:center;color:rgba(238,231,244,.58);font-size:12px">正在读取音色…</div>';
      if (pickerPageEl) pickerPageEl.textContent = "读取中";
      reopenPanelAfterPicker = !!(panel && panel.open);
      if (reopenPanelAfterPicker) closeDialog(panel);
      if (typeof positionVoicePicker === "function") positionVoicePicker();
      try { pickerEl.setAttribute("data-open", "1"); pickerEl.removeAttribute("aria-hidden"); } catch (_) {}
      openDialog(pickerEl);
      try {
        await ensureVoicesLoaded();
      } catch (e) {
        if (pickerGridEl) pickerGridEl.innerHTML = '<div style="grid-column:1/-1;padding:20px;text-align:center;color:rgba(255,213,221,.82);font-size:12px">音色列表读取失败</div>';
        setStatus("音色列表读取失败");
        setError(e && e.message ? e.message : String(e));
        return;
      }
      renderPickerTabs();
      renderPickerGrid();
    }
    function closeVoicePicker() {
      if (pickerEl) closeDialog(pickerEl);
      try { if (pickerEl) { pickerEl.removeAttribute("data-open"); pickerEl.setAttribute("aria-hidden", "true"); } } catch (_) {}
      pickerState.rowIdx = -1;
      if (reopenPanelAfterPicker && panel && !panel.open) {
        reopenPanelAfterPicker = false;
        if (typeof positionSettingsPanel === "function") positionSettingsPanel();
        openDialog(panel);
      } else {
        reopenPanelAfterPicker = false;
      }
    }
    function pickerSubdirs() {
      var set = {};
      (availableVoices || []).forEach(function (v) { set[v.subdir || ""] = true; });
      return Object.keys(set).filter(function (s) { return !!s; }).sort(function (a, b) {
        var ra = voiceCategoryRank(a), rb = voiceCategoryRank(b);
        if (ra !== rb) return ra - rb;
        return a.localeCompare(b, "zh-Hans-CN");
      });
    }
    function renderPickerTabs() {
      if (!pickerTabsEl) return;
      var subs = pickerSubdirs();
      var tabs = ['<button class="idx-picker-tab' + (pickerState.tab === "" ? " is-active" : "") + '" data-tab="">全部</button>'];
      subs.forEach(function (s) {
        tabs.push('<button class="idx-picker-tab' + (pickerState.tab === s ? " is-active" : "") + '" data-tab="' + escapeHtml(s) + '">' + escapeHtml(s) + '</button>');
      });
      // 根目录单独 tab(没分类的音色)
      tabs.push('<button class="idx-picker-tab' + (pickerState.tab === "__root__" ? " is-active" : "") + '" data-tab="__root__">未分类</button>');
      pickerTabsEl.innerHTML = tabs.join("");
      $all(pickerTabsEl, '.idx-picker-tab').forEach(function (btn) {
        on(btn, 'click', function () {
          pickerState.tab = btn.dataset.tab || "";
          pickerState.page = 1;
          renderPickerTabs();
          renderPickerGrid();
        });
      });
    }
    function pickerFiltered() {
      var q = String(pickerState.search || "").toLowerCase().trim();
      return (availableVoices || []).filter(function (v) {
        var sd = v.subdir || "";
        if (pickerState.tab === "__root__") { if (sd) return false; }
        else if (pickerState.tab && sd !== pickerState.tab) return false;
        if (q && v.name.toLowerCase().indexOf(q) < 0) return false;
        return true;
      });
    }
    // picker 内试听:点 item 整块 toggle 播放 /voice_preview;另一份 audio
    // 实例避免跟主播放器冲突。同一时间只播一个 preview。
    var pickerPreviewAudio = null;
    function pickerPreview(voiceName, itemEl) {
      try {
        if (pickerPreviewAudio) { try { pickerPreviewAudio.pause(); } catch (_) {} }
        $all(pickerGridEl, '.idx-picker-item.is-playing').forEach(function (b) { b.classList.remove('is-playing'); });
        if (!voiceName) return;
        var url = cleanBase(cfg.apiBase) + "/voice_preview?name=" + encodeURIComponent(voiceName);
        pickerPreviewAudio = new Audio(url);
        if (itemEl) itemEl.classList.add('is-playing');
        pickerPreviewAudio.addEventListener('ended', function () { if (itemEl) itemEl.classList.remove('is-playing'); });
        pickerPreviewAudio.addEventListener('error', function () { if (itemEl) itemEl.classList.remove('is-playing'); });
        pickerPreviewAudio.play().catch(function () { if (itemEl) itemEl.classList.remove('is-playing'); });
      } catch (_) { if (itemEl) itemEl.classList.remove('is-playing'); }
    }
    function stopPickerPreview() {
      if (pickerPreviewAudio) { try { pickerPreviewAudio.pause(); } catch (_) {} pickerPreviewAudio = null; }
      $all(pickerGridEl, '.idx-picker-item.is-playing').forEach(function (b) { b.classList.remove('is-playing'); });
    }

    function renderPickerGrid() {
      if (!pickerGridEl) return;
      var filtered = pickerFiltered();
      var totalPages = Math.max(1, Math.ceil(filtered.length / pickerState.pageSize));
      if (pickerState.page > totalPages) pickerState.page = totalPages;
      var start = (pickerState.page - 1) * pickerState.pageSize;
      var page = filtered.slice(start, start + pickerState.pageSize);
      var selectedVoice = "";
      if (pickerState.rowIdx === -2) selectedVoice = cfg.defaultVoice || "";
      else if (pickerState.rowIdx >= 0 && cfg.roleVoiceList && cfg.roleVoiceList[pickerState.rowIdx]) selectedVoice = cfg.roleVoiceList[pickerState.rowIdx].voice || "";
      pickerGridEl.innerHTML = page.map(function (v) {
        var sd = v.subdir || "";
        var selected = v.name === selectedVoice;
        return '<div class="idx-picker-item' + (selected ? ' is-selected' : '') + '" data-voice="' + escapeHtml(v.name) + '" title="点击试听">'
          + '<div class="idx-picker-item-info">'
            + '<span class="idx-picker-item-name">' + escapeHtml(v.name.split("/").pop()) + '</span>'
            + (sd ? '<span class="idx-picker-item-sub">' + escapeHtml(sd) + '</span>' : '')
          + '</div>'
          + '<span class="idx-picker-wave" aria-hidden="true"><i></i><i></i><i></i></span>'
          + '<span class="idx-picker-selected" aria-hidden="true">✓</span>'
          + '<button class="idx-picker-apply" type="button" data-action="apply" title="选用此音色" aria-label="选用">✓</button>'
          + '</div>';
      }).join("") || '<div style="grid-column:1/-1;padding:20px;text-align:center;color:rgba(238,231,244,.5);font-size:12px">没有匹配的音色</div>';
      $all(pickerGridEl, '.idx-picker-item').forEach(function (item) {
        var apply = first(item, '[data-action="apply"]');
        var voiceName = item.dataset.voice;
        function applyVoice() {
          stopPickerPreview();
          if (pickerState.rowIdx === -2) {
            cfg.defaultVoice = voiceName;
            var defBtn = first(panel, '[data-role="default-voice-btn"]');
            if (defBtn) defBtn.textContent = voiceName;
            saveConfig(cfg, characterId).catch(function(){});
          } else if (pickerState.rowIdx >= 0) {
            setRowVoice(pickerState.rowIdx, voiceName);
            saveConfig(cfg, characterId).catch(function(){});
          }
          closeVoicePicker();
        }
        // 点 item 主体 = toggle 试听
        on(item, 'click', function (e) {
          if (e.target && e.target.closest && e.target.closest('[data-action="apply"]')) return;
          if (item.classList.contains('is-playing')) { stopPickerPreview(); return; }
          pickerPreview(voiceName, item);
        });
        on(apply, 'click', function (e) { e.preventDefault(); e.stopPropagation(); applyVoice(); });
      });
      if (pickerPageEl) pickerPageEl.textContent = filtered.length ? (pickerState.page + ' / ' + totalPages + ' · 共 ' + filtered.length + ' 条') : '无结果';
      if (pickerPrevEl) pickerPrevEl.disabled = pickerState.page <= 1;
      if (pickerNextEl) pickerNextEl.disabled = pickerState.page >= totalPages;
    }
    // 绑定 picker 的全局事件(close / search / pager)
    // 注意:picker 已经移到 panel 外、跟 panel 平级了,picker-close 在 picker 内,从 pickerEl 查找
    on(first(pickerEl, '.idx-picker-close'), 'click', function () { stopPickerPreview(); closeVoicePicker(); });
    on(pickerSearchEl, 'input', function () { pickerState.search = pickerSearchEl.value || ""; pickerState.page = 1; renderPickerGrid(); });
    on(pickerPrevEl, 'click', function () { if (pickerState.page > 1) { pickerState.page--; renderPickerGrid(); } });
    on(pickerNextEl, 'click', function () { pickerState.page++; renderPickerGrid(); });
    // panel 内按钮统一用事件代理 —— 避免 dialog 内部事件路由怪问题 + renderRoleList 重渲染不丢绑定
    on(panel, 'click', function (e) {
      var t = e.target; if (!t || !t.closest) return;
      if (t.closest('[data-role="add-role"]')) { e.preventDefault(); addRoleRow(); return; }
      if (t.closest('[data-role="default-voice-btn"]')) { e.preventDefault(); openVoicePicker(-2).catch(function (err) { setError(err && err.message ? err.message : String(err)); }); return; }
      var roleRow = t.closest('.idx-role-row');
      if (roleRow) {
        var idx = Number(roleRow.dataset.rowIdx);
        if (t.closest('.idx-role-del')) { e.preventDefault(); if (cfg.roleVoiceList && cfg.roleVoiceList[idx] !== undefined) { cfg.roleVoiceList.splice(idx, 1); renderRoleList(); } return; }
        if (t.closest('.idx-voice-btn')) { e.preventDefault(); openVoicePicker(idx).catch(function (err) { setError(err && err.message ? err.message : String(err)); }); return; }
      }
    });
