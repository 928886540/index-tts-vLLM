// IndexTTS Tavo runtime part: 40_mount_shell.js // Role: player shell mount and DOM references // This fragment is concatenated by static/tavo.runtime.js; it is not a standalone script.
  function removeLegacyGlobalGear() {
    var btn = document.getElementById("indextts-tavo-global-gear");
    if (btn && btn.parentNode) btn.parentNode.removeChild(btn);
  }

  function mount(root, cfg, context) {
    var characterId = (context && context.characterId) ? String(context.characterId) : "";
    var messageText = context && context.text ? context.text : "";
    var avatarUrl = context && context.avatarUrl ? context.avatarUrl : "";
    var userAvatarUrl = context && context.userAvatarUrl ? context.userAvatarUrl : "";
    var messageId = context && context.messageId ? context.messageId : "";
    root.innerHTML = [
      '<div class="idx-card">',
      '  <button class="idx-gear" type="button" data-role="gear" aria-label="设置">' + gearIcon() + '</button>',
      '  <button class="idx-playback-toggle" type="button" data-role="playback-mode-toggle" aria-label="播放模式" title="播放模式">L</button>',
      '  <div class="idx-top"><div class="idx-cover" data-role="cover"></div><div class="idx-info"><div class="idx-title-row"><div class="idx-name" data-role="title"></div></div><div class="idx-status" data-role="status">选择音色后点音符生成</div></div></div>',
      '  <div class="idx-seek-wrap"><input class="idx-seek" data-role="seek" type="range" min="0" max="1000" value="0" disabled><div class="idx-time"><span data-role="current">00:00</span><span data-role="total">--:--</span></div></div>',
      '  <div class="idx-progress-line" data-role="progress"></div>',
      '  <div class="idx-subtitle" data-role="subtitle"><button class="idx-sub-delete" type="button" data-role="delete" aria-label="删除当前音频" title="删除当前音频"><svg viewBox="0 0 24 24"><path d="M9 3h6l1 2h4v2H4V5h4l1-2zm1 6h2v8h-2V9zm4 0h2v8h-2V9zM7 9h2v8H7V9zm1 11c-1.1 0-2-.9-2-2V8h12v10c0 1.1-.9 2-2 2H8z"/></svg></button><div class="idx-card-counter" data-role="counter">0/0</div><div class="idx-sub-notice"><strong>历史音频 0 条</strong><span>点音符生成音频</span></div></div>',
      '  <div class="idx-controls"><button class="idx-ctrl idx-ctrl-sm" type="button" data-role="prev" aria-label="上一首" title="上一首"><svg viewBox="0 0 24 24"><path d="M6 6h2v12H6zm3.5 6 8.5 6V6z"/></svg></button><button class="idx-ctrl idx-ctrl-main" type="button" data-role="play" data-state="idle" aria-label="播放">' + playIcon("idle") + '</button><button class="idx-ctrl idx-live-exit idx-hidden" type="button" data-role="live-exit" aria-label="退出流式" title="退出流式"><svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6 6 18"/><path d="M7 21h10"/></svg></button><button class="idx-ctrl idx-ctrl-sm" type="button" data-role="next" aria-label="下一首" title="下一首"><svg viewBox="0 0 24 24"><path d="M16 6h2v12h-2zm-10.5 0v12l8.5-6z"/></svg></button><button class="idx-ctrl idx-ctrl-add" type="button" data-role="add" aria-label="生成音频" title="生成音频"><svg viewBox="0 0 24 24"><path d="M12 3v9.55A4 4 0 1 0 14 16V7h4V3z"/></svg></button></div>',
      '  <dialog class="idx-panel" data-role="panel">'
        + '<div class="idx-panel-head"><div class="idx-panel-title">语音设置</div><button class="idx-close" type="button" data-role="close">×</button></div>'
        + '<div class="idx-modes"><button class="idx-mode" data-mode="ai" type="button"><strong>AI模式</strong><span>后端 LLM 拆旁白/人物</span></button><button class="idx-mode" data-mode="normal" type="button"><strong>普通模式</strong><span>后端规则拆旁白/对白</span></button></div>'
        + '<div class="idx-section-title">合成质量</div>'
        + '<div class="idx-grid">'
          + '<label class="idx-field"><span class="idx-label">合成档位</span><select class="idx-input" data-field="qualityMode"><option value="fast">极速（流式推荐）</option><option value="balanced">平衡</option><option value="expressive">质量优先</option><option value="ultra">落盘高质量</option><option value="custom">自定义</option></select></label>'
          + '<label class="idx-field"><span class="idx-label">播放语速</span><input class="idx-input" type="number" min="0.85" max="1.25" step="0.01" data-field="speedFactor" placeholder="1.00"></label>'
        + '</div>'
        + '<details class="idx-llm-details idx-custom-quality"><summary>自定义参数</summary><div class="idx-grid">'
          + '<label class="idx-field"><span class="idx-label">扩散步数</span><input class="idx-input" type="number" min="2" max="24" step="1" data-field="diffusionSteps" placeholder="14"></label>'
          + '<label class="idx-field"><span class="idx-label">参考音频秒数</span><input class="idx-input" type="number" min="2" max="16" step="0.5" data-field="promptAudioSeconds" placeholder="10"></label>'
          + '<label class="idx-field"><span class="idx-label">分段 token</span><input class="idx-input" type="number" min="8" max="120" step="1" data-field="segmentTokens" placeholder="60"></label>'
          + '<label class="idx-field"><span class="idx-label">首段 token</span><input class="idx-input" type="number" min="4" max="120" step="1" data-field="firstTokens" placeholder="18"></label>'
          + '<label class="idx-field"><span class="idx-label">S2Mel CFG</span><input class="idx-input" type="number" min="0" max="1.2" step="0.05" data-field="s2melCfgRate" placeholder="0.70"></label>'
          + '<label class="idx-field"><span class="idx-label">Top P</span><input class="idx-input" type="number" min="0.1" max="1" step="0.01" data-field="topP" placeholder="0.80"></label>'
          + '<label class="idx-field"><span class="idx-label">Top K</span><input class="idx-input" type="number" min="1" max="100" step="1" data-field="topK" placeholder="30"></label>'
          + '<label class="idx-field"><span class="idx-label">Temperature</span><input class="idx-input" type="number" min="0.1" max="1.5" step="0.01" data-field="temperature" placeholder="0.70"></label>'
          + '<label class="idx-field"><span class="idx-label">重复惩罚</span><input class="idx-input" type="number" min="1" max="2" step="0.01" data-field="repetitionPenalty" placeholder="1.20"></label>'
          + '<label class="idx-field"><span class="idx-label">情绪强度</span><input class="idx-input" type="number" min="0" max="1" step="0.01" data-field="emoAlpha" placeholder="0.38"></label>'
          + '<label class="idx-field"><span class="idx-label">歌词提前秒</span><input class="idx-input" type="number" min="0" max="1" step="0.05" data-field="subtitleLeadSec" placeholder="0.30"></label>'
        + '</div></details>'
        + '<div class="idx-normal-only"><div class="idx-section-title">普通模式音色</div><div class="idx-normal-voices" data-role="normal-voices">'
          + '<div class="idx-role-row idx-role-protected idx-normal-voice-row" data-normal-role="narrator">'
            + '<input class="idx-role-name" type="text" value="旁白" readonly>'
            + '<button class="idx-voice-btn" type="button" data-role="normal-narrator-voice-btn">选择旁白音色…</button>'
            + '<span class="idx-role-lock" title="旁白槽位,不可删除">🔒</span>'
          + '</div>'
          + '<div class="idx-role-row idx-role-protected idx-normal-voice-row" data-normal-role="dialogue">'
            + '<input class="idx-role-name" type="text" value="对白" readonly>'
            + '<button class="idx-voice-btn" type="button" data-role="normal-dialogue-voice-btn">继承旁白</button>'
            + '<button class="idx-role-del" type="button" data-role="normal-dialogue-clear" title="清空对白音色，继承旁白">×</button>'
          + '</div>'
        + '</div></div>'
        + '<div class="idx-ai-only">'
          + '<div class="idx-section-title">角色音色映射</div>'
          + '<div class="idx-roles" data-role="roles-list"></div>'
          + '<button class="idx-add-role" type="button" data-role="add-role">+ 添加角色</button>'
          + '<details class="idx-llm-details"><summary>LLM 配置</summary><div class="idx-grid">'
            + '<label class="idx-field idx-wide"><span class="idx-label">LLM 接口地址（写到 /v1 即可，会自动补全 /chat/completions）</span><input class="idx-input" data-field="llmEndpoint" placeholder="http://127.0.0.1:8317/v1"></label>'
            + '<label class="idx-field"><span class="idx-label">LLM 模型</span><input class="idx-input" data-field="llmModel" placeholder="渡鸦/grok-4.20-fast"></label>'
            + '<label class="idx-field"><span class="idx-label">LLM Key</span><input class="idx-input" type="password" data-field="llmApiKey" placeholder="sk-..."></label>'
          + '</div></details>'
          + '<label class="idx-check"><input type="checkbox" data-field="reuseLlmParse"><span><strong>复用 LLM 拆段</strong><span>同一消息、角色和 LLM 配置未变时，由后端复用拆段结果。</span></span></label>'
        + '</div>'
        + '<div class="idx-section-title">播放 / 离线</div>'
        + '<label class="idx-check"><input type="checkbox" data-field="offlineAudioEnabled"><span><strong>保存离线音频</strong><span>已落盘音频存到本机，下次优先放本地。</span></span></label>'
        + '<div class="idx-actions"><button class="idx-btn" type="button" data-role="save">保存</button></div>'
        + '</dialog>'
        // 音色选择器:模态弹窗,走原生 dialog top-layer,跟设置面板同级
        + '<dialog class="idx-picker" data-role="voice-picker">'
          + '<div class="idx-picker-head"><div class="idx-picker-title">选择音色</div><button class="idx-picker-close" type="button">×</button></div>'
          + '<div class="idx-picker-tabs" data-role="picker-tabs"></div>'
          + '<input class="idx-input idx-picker-search" type="text" placeholder="搜索音色名…" data-role="picker-search">'
          + '<div class="idx-picker-grid" data-role="picker-grid"></div>'
          + '<div class="idx-picker-pager"><button type="button" data-role="picker-prev">‹</button><span data-role="picker-page">1 / 1</span><button type="button" data-role="picker-next">›</button></div>'
        + '</dialog>',
      '  <audio data-role="audio" preload="none"></audio><div class="idx-error idx-hidden" data-role="error"></div>',
      '</div>'
    ].join("");

    var audio = first(root, '[data-role="audio"]', 'audio');
    var preview = null;
    var play = first(root, '[data-role="play"]', '.idx-ctrl-main');
    var prev = first(root, '[data-role="prev"]');
    var next = first(root, '[data-role="next"]');
    var rewind10 = first(root, '[data-role="rewind10"]');
    var forward10 = first(root, '[data-role="forward10"]');
    var add = first(root, '[data-role="add"]');
    var del = first(root, '[data-role="delete"]');
    var liveExit = first(root, '[data-role="live-exit"]');
    var status = first(root, '[data-role="status"]', '.idx-status');
    var title = first(root, '[data-role="title"]', '.idx-name');
    var cover = first(root, '[data-role="cover"]', '.idx-cover');
    var counter = first(root, '[data-role="counter"]', '.idx-card-counter');
    var playbackToggle = first(root, '[data-role="playback-mode-toggle"]', '.idx-playback-toggle');
    var err = first(root, '[data-role="error"]', '.idx-error');
    var seek = first(root, '[data-role="seek"]', '.idx-seek');
    var cur = first(root, '[data-role="current"]', '.idx-time span:first-child');
    var total = first(root, '[data-role="total"]', '.idx-time span:last-child');
    var progressLine = first(root, '[data-role="progress"]', '.idx-progress-line');
    var panel = first(root, '[data-role="panel"]', '.idx-panel');
    var gear = first(root, '[data-role="gear"]', '.idx-gear');
    var close = first(root, '[data-role="close"]', '.idx-close');
    var pickerNode = null;
    // TAVO 容器树上很可能有 transform 祖先(scale / translate),会让 panel/picker
    // 的 position:fixed 误以为相对那个祖先(被截一半)。把它们直接挂到 body 上
    // 彻底逃离变形上下文。下次脚本重载会先清掉旧实例避免叠加。
    try {
      var STALE_HOST_ATTR = 'data-indextts-host';
      Array.prototype.slice.call(document.body.querySelectorAll('[' + STALE_HOST_ATTR + ']')).forEach(function (el) { try { el.remove(); } catch (_) {} });
      if (panel) { panel.setAttribute(STALE_HOST_ATTR, '1'); document.body.appendChild(panel); }
      pickerNode = first(root, '[data-role="voice-picker"]');
      if (pickerNode) { pickerNode.setAttribute(STALE_HOST_ATTR, '1'); document.body.appendChild(pickerNode); }
    } catch (_) {}
    function playerAnchorRect() {
      var card = first(root, '.idx-card') || root;
      try {
        var r = card && card.getBoundingClientRect ? card.getBoundingClientRect() : null;
        if (r && (r.width || r.height)) return r;
      } catch (_) {}
      return { left: 12, top: 12, width: 760, height: 0 };
    }
    function setLayerNearPlayer(layer, opts) {
      if (!layer) return;
      opts = opts || {};
      var de = document.documentElement || {};
      var vw = Math.max(320, Number(window.innerWidth || de.clientWidth || 390) || 390);
      var vh = Math.max(320, Number(window.innerHeight || de.clientHeight || 760) || 760);
      var mobile = vw <= 520;
      var margin = mobile ? 8 : 12;
      var anchor = playerAnchorRect();
      var maxWidth = Math.max(280, vw - margin * 2);
      var naturalWidth = mobile ? maxWidth : Math.max(320, Math.min(760, Number(anchor.width || 0) || 760));
      var width = Math.min(maxWidth, naturalWidth);
      var left = mobile ? margin : Math.min(Math.max(margin, Number(anchor.left || margin) + (Number(anchor.width || width) - width) / 2), Math.max(margin, vw - width - margin));
      var preferredHeight = Number(opts.height || 560) || 560;
      if (mobile) preferredHeight = Number(opts.mobileHeight || preferredHeight) || preferredHeight;
      preferredHeight = Math.min(preferredHeight, vh - margin * 2);
      var anchorCenterY = Number(anchor.top || margin) + Math.max(0, Number(anchor.height || 0)) / 2;
      var topLimitForHeight = Math.max(margin, vh - margin - preferredHeight);
      var top = Math.min(Math.max(margin, anchorCenterY - preferredHeight / 2), topLimitForHeight);
      var height = Math.min(preferredHeight, vh - top - margin);
      if (height < 360) {
        top = margin;
        height = Math.max(320, vh - margin * 2);
      }
      if (mobile) height = Math.min(height, vh - margin * 2);
      try {
        layer.style.setProperty("--idx-layer-left", Math.round(left) + "px");
        layer.style.setProperty("--idx-layer-top", Math.round(top) + "px");
        layer.style.setProperty("--idx-layer-width", Math.round(width) + "px");
        layer.style.setProperty("--idx-layer-height", Math.round(height) + "px");
      } catch (_) {}
    }
    function positionSettingsPanel() { setLayerNearPlayer(panel, { height: 560, mobileHeight: 520 }); }
    function positionVoicePicker() { setLayerNearPlayer(pickerNode, { height: 570, mobileHeight: 540 }); }
    var voicesBox = first(root, '[data-role="voices"]', '.idx-voices');
    var voicePill = first(root, '[data-role="voice-pill"]');
    var modePill = first(root, '[data-role="mode-pill"]');
    var generatedTracks = [];
    var detachedBackgroundJobs = [];
    var currentTrackIndex = -1;
    var currentCacheKey = "";
    var webAudioController = null;
    var webAudioActiveTrack = null;
    var webAudioPlayToken = 0;
    var webAudioProgressTimer = null;

    if (!panel) throw new Error("TAVO player missing settings panel");
    removeLegacyGlobalGear();

    function isHeaderProgressStatus(v) {
      var text = String(v == null ? "" : v);
      if (!text) return false;
      try {
        if (typeof isTransientProgressNotice === "function" && isTransientProgressNotice(text)) return true;
      } catch (_) {}
      return /等待音频|正在连接音频|连接实时音频|连接断点音频|收到音频|网络缓冲|后台生成中|后台生成提交中|后端正在|后端处理中|处理中|提交|生成中|正在生成|正在合成|正在.*LLM|检查 LLM|已复用 LLM|实时音频重连|正在加载音频|缓冲中/.test(text);
    }
    function configuredVoiceLabelText() {
      try {
        var mode = normalizeModeName(cfg.mode);
        var voices = mode === "normal" ? normalModeVoicesMap(cfg) : rolesListToVoicesMap(cfg.roleVoiceList, "", cfg.currentCharacterName);
        var voice = representativeVoiceForMode(mode, voices, mode === "normal" ? cfg.defaultVoice : "");
        return voice ? shortName(voice) : "音色未设置";
      } catch (_) {
        return "音色未设置";
      }
    }
    function stableHeaderStatusText() {
      try {
        var t = currentTrack();
        if (t) {
          var label = trackPlaybackLabel(t);
          if (label) return label;
        }
      } catch (_) {}
      return configuredVoiceLabelText();
    }
    function setProgressStatus(v) {
      if (!progressLine) return;
      var text = v == null ? "" : String(v);
      var stable = "";
      try { stable = stableHeaderStatusText(); } catch (_) {}
      if (stable && text === stable) text = "";
      progressLine.textContent = text;
      progressLine.classList.toggle("idx-progress-empty", !text);
      try { progressLine.title = text || ""; } catch (_) {}
    }
    function setStatus(v) {
      if (!status) return;
      var text = v == null ? "" : String(v);
      setProgressStatus(text);
      text = stableHeaderStatusText() || "音色未设置";
      status.textContent = text;
      try { status.title = status.textContent || ""; } catch (_) {}
      try {
        if (status.__idxScrollTimer) { clearInterval(status.__idxScrollTimer); status.__idxScrollTimer = null; }
        status.scrollLeft = 0;
        status.style.overflowX = "hidden";
        status.style.whiteSpace = "nowrap";
        status.style.textOverflow = "ellipsis";
      } catch (_) {}
    }
    function historyStatusText() {
      var visibleList = visibleTrackCards();
      var total = visibleList.length;
      if (!total && !tracksLoaded && knownHistoryCount > 0) return "历史音频 " + knownHistoryCount + " 条";
      var active = currentTrack();
      if (isLiveExitTrack(active)) return "流式生成中 · 当前 " + Math.max(1, visibleList.indexOf(active) + 1) + "/" + Math.max(1, total);
      if (!total) return "历史音频 0 条";
      var idx = active ? (visibleList.indexOf(active) + 1) : total;
      if (idx <= 0) idx = total;
      return "历史音频 " + total + " 条 · 当前 " + idx + "/" + total;
    }
    function visibleTrackCards() {
      return (generatedTracks || []).filter(function (t) { return !!(t && !t.deleted); });
    }
    function updateTrackCounter() {
      var active = currentTrack();
      var visibleList = visibleTrackCards();
      var total = visibleList.length || (!tracksLoaded ? knownHistoryCount : 0);
      var idx = total && active ? (visibleList.indexOf(active) + 1) : 0;
      if (idx < 0) idx = 0;
      if (counter) counter.textContent = idx + "/" + total;
    }
    function setError(v) {
      if (err) { err.textContent = ""; err.classList.add("idx-hidden"); }
      if (v) showTrackNotice(currentTrack(), "发生错误", String(v));
    }
