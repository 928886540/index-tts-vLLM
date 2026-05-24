/* IndexTTS × TAVO bridge — single-file injection (Phase 5B skeleton)
 *
 * Usage in TAVO:
 *   <script src="http://<lan-ip>:9880/static/tavo.js"></script>
 *
 * On load, this script:
 *   1. Boots a singleton on window.IndexTTS_TAVO
 *   2. Reads/writes config to localStorage under key "indextts_tavo_config"
 *   3. Mounts a floating gear button → settings panel
 *   4. Sets up a MutationObserver on the configured chat container
 *   5. Injects a 🔊 button into each message; click → TTS pipeline
 *
 * Pipeline (per message):
 *   text → [optional] LLM parse → segments → /tts_cache_stream or /tts_dialogue_stream
 *        → <audio preload="none"> inserted under message
 *
 * Phase 5B status: skeleton only. The settings UI is functional; the
 *   LLM parse and message detection are stubs (TODO markers in code).
 *   Audio playback against /tts_stream works for plain single-voice mode.
 *
 * Conventions:
 *   - Vanilla JS, no framework, no build step.
 *   - All names prefixed `_itts*` in DOM to avoid TAVO collisions.
 *   - Source is readable (no minification) so users can audit and tweak.
 */

(function () {
  'use strict';

  if (window.IndexTTS_TAVO) {
    console.warn('[IndexTTS_TAVO] already loaded, skipping re-init');
    return;
  }

  // -------------------------------------------------------------------------
  // Config & storage
  // -------------------------------------------------------------------------
  const STORAGE_KEY = 'indextts_tavo_config';
  const DEFAULTS = {
    apiBase: scriptOrigin(),      // e.g. http://192.168.1.100:9880
    chatSelector: '#chat',        // CSS selector for the chat container
    messageSelector: '.mes',      // CSS selector for each message
    textSelector: '.mes_text',    // CSS selector for the message text within a message
    voiceMap: {                   // role -> voice library name OR direct path
      default: '',
    },
    llm: {
      enabled: false,
      provider: 'openai',         // openai-compatible endpoint for now
      endpoint: '',               // e.g. https://api.openai.com/v1/chat/completions
      apiKey: '',
      model: '',
      systemPrompt: '',           // optional override; see defaultLlmPrompt()
    },
    params: {
      top_p: 0.8,
      top_k: 30,
      temperature: 0.8,
      repetition_penalty: 10,
      emo_alpha: 0.7,
      interval_ms: 350,
    },
    localRegex: {
      enabled: true,
      mode: 'first-match',        // first-match | whole-message
      rules: [
        '\\[TTS\\]([\\s\\S]*?)\\[/TTS\\]',
        '<tts>([\\s\\S]*?)</tts>',
      ],
    },
    cache: {
      enabled: true,
    },
    autoPlay: false,              // false = lazy load (user clicks per message)
  };

  function loadConfig() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return structuredClone(DEFAULTS);
      const parsed = JSON.parse(raw);
      return mergeDeep(structuredClone(DEFAULTS), parsed);
    } catch (e) {
      console.warn('[IndexTTS_TAVO] config parse failed, using defaults:', e);
      return structuredClone(DEFAULTS);
    }
  }

  function saveConfig(cfg) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(cfg));
  }

  function mergeDeep(target, src) {
    for (const k of Object.keys(src || {})) {
      const sv = src[k];
      if (sv && typeof sv === 'object' && !Array.isArray(sv)) {
        target[k] = mergeDeep(target[k] || {}, sv);
      } else {
        target[k] = sv;
      }
    }
    return target;
  }

  function scriptOrigin() {
    try {
      const script = document.currentScript;
      return script && script.src ? new URL(script.src).origin : '';
    } catch (_) {
      return '';
    }
  }

  // -------------------------------------------------------------------------
  // API client
  // -------------------------------------------------------------------------
  function apiUrl(path) {
    const base = (cfg.apiBase || '').replace(/\/+$/, '');
    if (!base) throw new Error('IndexTTS apiBase not configured');
    return base + path;
  }

  // Returns a stream URL for <audio src=...>. Browser fetches lazily because
  // the generated <audio> uses preload="none" unless autoPlay is enabled.
  function tts_stream_url(text, voicePathOrName) {
    const endpoint = cfg.cache.enabled ? '/tts_cache_stream?' : '/tts_stream?';
    const params = new URLSearchParams({
      text: text,
      ref_audio_path: voicePathOrName,
      top_p: cfg.params.top_p,
      top_k: cfg.params.top_k,
      temperature: cfg.params.temperature,
      repetition_penalty: cfg.params.repetition_penalty,
      emo_alpha: cfg.params.emo_alpha,
    });
    return apiUrl(endpoint + params.toString());
  }

  // For multi-segment (after LLM parse). Returns a Blob URL — we POST,
  // then stream the response into a MediaSource. For Phase 5B skeleton
  // this just POSTs and returns once response.body is available.
  async function fetchDialogueStream(segments, voices) {
    const endpoint = cfg.cache.enabled ? '/tts_dialogue_cache_stream' : '/tts_dialogue_stream';
    const body = {
      segments: segments,
      voices: voices,
      interval_ms: cfg.params.interval_ms,
      top_p: cfg.params.top_p,
      top_k: cfg.params.top_k,
      temperature: cfg.params.temperature,
      repetition_penalty: cfg.params.repetition_penalty,
      emo_alpha: cfg.params.emo_alpha,
    };
    const res = await fetch(apiUrl(endpoint), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const txt = await res.text().catch(() => '');
      throw new Error(endpoint + ' failed: ' + res.status + ' ' + txt);
    }
    return res;
  }

  async function listVoices() {
    // Endpoint provided by Phase 2C (depends on Codex's voice_library.py).
    // For now this may 404; treat as empty.
    try {
      const res = await fetch(apiUrl('/voices'));
      if (!res.ok) return [];
      const data = await res.json();
      return Array.isArray(data) ? data : (data.voices || []);
    } catch (_) {
      return [];
    }
  }

  // -------------------------------------------------------------------------
  // LLM parsing (Phase 4 client-side, OpenAI-compatible endpoints)
  // -------------------------------------------------------------------------
  // Returns Promise<[{role, text, emo_vec?, emo_text?}]>
  // If LLM disabled or fails: returns a single segment with role "default".
  async function parseTextToSegments(rawText) {
    if (!cfg.llm.enabled || !cfg.llm.apiKey || !cfg.llm.endpoint) {
      return [{ role: 'default', text: rawText }];
    }
    try {
      const res = await fetch(cfg.llm.endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer ' + cfg.llm.apiKey,
        },
        body: JSON.stringify({
          model: cfg.llm.model,
          temperature: 0.2,
          messages: [
            { role: 'system', content: cfg.llm.systemPrompt || defaultLlmPrompt() },
            { role: 'user', content: rawText },
          ],
        }),
      });
      if (!res.ok) throw new Error('LLM HTTP ' + res.status + ': ' + await res.text());
      const data = await res.json();
      const content = data.choices && data.choices[0] && data.choices[0].message
        ? data.choices[0].message.content
        : JSON.stringify(data);
      const parsed = parseJsonObject(content);
      const segments = Array.isArray(parsed.segments) ? parsed.segments : [];
      const cleaned = segments
        .map(seg => ({
          role: String(seg.role || 'narrator').trim() || 'narrator',
          text: String(seg.text || '').trim(),
          emo_vec: Array.isArray(seg.emo_vec) && seg.emo_vec.length === 8 ? seg.emo_vec.map(Number) : undefined,
          emo_text: seg.emo_text ? String(seg.emo_text).trim() : undefined,
          emo_alpha: seg.emo_alpha == null ? undefined : Number(seg.emo_alpha),
        }))
        .filter(seg => seg.text);
      return cleaned.length ? cleaned : [{ role: 'default', text: rawText }];
    } catch (e) {
      console.warn('[IndexTTS_TAVO] LLM parse failed, falling back to single segment:', e);
      return [{ role: 'default', text: rawText }];
    }
  }

  function defaultLlmPrompt() {
    return [
      '你是 TTS 对话切分器。把用户给出的小说/正文切成可朗读片段。',
      '必须只输出 JSON 对象，不要 Markdown，不要解释。',
      'JSON 格式: {"segments":[{"role":"narrator","text":"...","emo_vec":[0,0,0,0,0,0,0,0],"emo_text":"..."}]}',
      '旁白 role 固定为 narrator；人物台词 role 使用人物名。',
      'emo_vec 必须是 8 个 0 到 1 的数字；无法确定时可以省略 emo_vec，改用 emo_text。',
      'emo_text 用自然语言描述语气、情绪、喘息、颤抖、压低声音等适合 TTS 的表达。',
      '不要改写正文，不要合并不同角色，不要输出空 text。',
    ].join('\n');
  }

  function parseJsonObject(text) {
    const raw = String(text || '').trim();
    try { return JSON.parse(raw); } catch (_) {}
    const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
    if (fenced) {
      try { return JSON.parse(fenced[1]); } catch (_) {}
    }
    const start = raw.indexOf('{');
    const end = raw.lastIndexOf('}');
    if (start >= 0 && end > start) {
      return JSON.parse(raw.slice(start, end + 1));
    }
    throw new Error('LLM did not return JSON');
  }

  function voiceMapToLines(map) {
    return Object.keys(map || {})
      .sort((a, b) => (a === 'default' ? -1 : b === 'default' ? 1 : a.localeCompare(b)))
      .map(role => role + '=' + (map[role] || ''))
      .join('\n');
  }

  function parseVoiceMapLines(text) {
    const next = {};
    for (const line of String(text || '').split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const eq = trimmed.indexOf('=');
      if (eq <= 0) continue;
      const role = trimmed.slice(0, eq).trim();
      const voice = trimmed.slice(eq + 1).trim();
      if (role && voice) next[role] = voice;
    }
    if (!next.default && cfg.voiceMap.default) next.default = cfg.voiceMap.default;
    return next;
  }

  // -------------------------------------------------------------------------
  // DOM injection
  // -------------------------------------------------------------------------
  const INJECTED_ATTR = 'data-itts-injected';

  function findMessageText(msgEl) {
    const t = msgEl.querySelector(cfg.textSelector);
    return t ? (t.innerText || t.textContent || '').trim() : '';
  }

  function extractTextForTts(rawText) {
    const text = (rawText || '').trim();
    if (!text || !cfg.localRegex.enabled || cfg.localRegex.mode === 'whole-message') {
      return text;
    }

    for (const pattern of cfg.localRegex.rules || []) {
      if (!pattern) continue;
      try {
        const re = new RegExp(pattern, 'i');
        const m = text.match(re);
        if (m) return (m[1] || m[0] || '').trim();
      } catch (e) {
        console.warn('[IndexTTS_TAVO] invalid local regex:', pattern, e);
      }
    }
    return text;
  }

  function injectMessageButton(msgEl) {
    if (msgEl.getAttribute(INJECTED_ATTR)) return;
    msgEl.setAttribute(INJECTED_ATTR, '1');

    const btn = document.createElement('button');
    btn.textContent = '🔊';
    btn.title = 'IndexTTS: 朗读这条消息';
    btn.className = '_itts_play_btn';
    Object.assign(btn.style, {
      marginLeft: '4px', padding: '2px 6px', cursor: 'pointer',
      border: '1px solid #888', background: 'transparent',
      borderRadius: '4px', fontSize: '14px',
    });

    btn.addEventListener('click', async (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      const text = extractTextForTts(findMessageText(msgEl));
      if (!text) return;
      await playForMessage(msgEl, text, btn);
    });

    msgEl.appendChild(btn);

    if (cfg.autoPlay) {
      // best-effort: schedule a click after DOM settles
      setTimeout(() => btn.click(), 200);
    }
  }

  async function playForMessage(msgEl, text, btn) {
    btn.disabled = true;
    btn.textContent = '⏳';
    try {
      const segments = await parseTextToSegments(text);

      // Container for audio
      let audioWrap = msgEl.querySelector('._itts_audio_wrap');
      if (!audioWrap) {
        audioWrap = document.createElement('div');
        audioWrap.className = '_itts_audio_wrap';
        audioWrap.style.marginTop = '6px';
        msgEl.appendChild(audioWrap);
      }
      audioWrap.innerHTML = '';

      if (segments.length === 1 && segments[0].role === 'default') {
        // Fast path: single-segment via GET (browser handles WAV streaming)
        const voice = cfg.voiceMap.default;
        if (!voice) throw new Error('default voice not configured');
        const audio = document.createElement('audio');
        audio.controls = true;
        audio.preload = cfg.autoPlay ? 'auto' : 'none';
        audio.src = tts_stream_url(segments[0].text, voice);
        audioWrap.appendChild(audio);
        if (cfg.autoPlay) await audio.play().catch(() => {});
      } else {
        // Multi-segment: POST and let the browser stream the response
        const res = await fetchDialogueStream(segments, cfg.voiceMap);
        const blob = await res.blob();   // TODO: replace with MediaSource for true streaming
        const url = URL.createObjectURL(blob);
        const audio = document.createElement('audio');
        audio.controls = true;
        audio.preload = 'auto';
        audio.src = url;
        audioWrap.appendChild(audio);
        if (cfg.autoPlay) await audio.play().catch(() => {});
      }

      btn.textContent = '🔊';
    } catch (e) {
      console.error('[IndexTTS_TAVO]', e);
      btn.textContent = '⚠️';
      btn.title = String(e);
    } finally {
      btn.disabled = false;
    }
  }

  // -------------------------------------------------------------------------
  // Observer
  // -------------------------------------------------------------------------
  let observer = null;

  function startObserver() {
    stopObserver();
    const root = document.querySelector(cfg.chatSelector);
    if (!root) {
      console.info('[IndexTTS_TAVO] chat container not found:', cfg.chatSelector);
      return;
    }
    // initial scan
    root.querySelectorAll(cfg.messageSelector).forEach(injectMessageButton);
    observer = new MutationObserver((records) => {
      for (const r of records) {
        for (const node of r.addedNodes) {
          if (!(node instanceof HTMLElement)) continue;
          if (node.matches && node.matches(cfg.messageSelector)) {
            injectMessageButton(node);
          }
          node.querySelectorAll && node.querySelectorAll(cfg.messageSelector).forEach(injectMessageButton);
        }
      }
    });
    observer.observe(root, { childList: true, subtree: true });
  }

  function stopObserver() {
    if (observer) {
      observer.disconnect();
      observer = null;
    }
  }

  // -------------------------------------------------------------------------
  // Settings panel (gear button + floating panel)
  // -------------------------------------------------------------------------
  function buildUi() {
    const gear = document.createElement('div');
    gear.id = '_itts_gear';
    gear.textContent = '🎤';
    gear.title = 'IndexTTS 设置';
    Object.assign(gear.style, {
      position: 'fixed', right: '14px', bottom: '14px',
      width: '40px', height: '40px', lineHeight: '40px', textAlign: 'center',
      background: '#7b3cff', color: '#fff', borderRadius: '50%',
      cursor: 'pointer', userSelect: 'none', zIndex: '999999',
      boxShadow: '0 4px 12px rgba(0,0,0,0.3)', fontSize: '20px',
    });
    document.body.appendChild(gear);

    const panel = document.createElement('div');
    panel.id = '_itts_panel';
    Object.assign(panel.style, {
      position: 'fixed', right: '14px', bottom: '64px',
      width: '360px', maxHeight: '70vh', overflowY: 'auto',
      background: '#1a1a22', color: '#eee', padding: '14px',
      borderRadius: '10px', boxShadow: '0 6px 20px rgba(0,0,0,0.5)',
      zIndex: '999998', display: 'none', fontSize: '13px',
      fontFamily: 'system-ui, sans-serif', lineHeight: '1.5',
    });
    document.body.appendChild(panel);

    gear.addEventListener('click', () => {
      panel.style.display = panel.style.display === 'none' ? 'block' : 'none';
      if (panel.style.display === 'block') renderPanel(panel);
    });
  }

  function renderPanel(panel) {
    panel.innerHTML = '';
    const title = document.createElement('div');
    title.textContent = 'IndexTTS × TAVO 设置';
    title.style.cssText = 'font-weight:600;font-size:14px;margin-bottom:8px;color:#9c6cff;';
    panel.appendChild(title);

    function fieldRow(labelText, inputEl) {
      const row = document.createElement('div');
      row.style.cssText = 'margin-bottom:8px;';
      const lbl = document.createElement('div');
      lbl.textContent = labelText;
      lbl.style.cssText = 'font-size:12px;opacity:0.8;margin-bottom:2px;';
      row.appendChild(lbl);
      row.appendChild(inputEl);
      panel.appendChild(row);
      return row;
    }

    function textInput(value, placeholder) {
      const i = document.createElement('input');
      i.type = 'text';
      i.value = value || '';
      i.placeholder = placeholder || '';
      i.style.cssText = 'width:100%;padding:4px 6px;background:#0d0d14;color:#eee;border:1px solid #333;border-radius:4px;font-size:12px;';
      return i;
    }

    function textAreaInput(value, placeholder, minHeight) {
      const i = document.createElement('textarea');
      i.value = value || '';
      i.placeholder = placeholder || '';
      i.style.cssText = 'width:100%;min-height:' + (minHeight || 64) + 'px;padding:4px 6px;background:#0d0d14;color:#eee;border:1px solid #333;border-radius:4px;font-size:12px;';
      return i;
    }

    const apiBaseInput = textInput(cfg.apiBase, 'http://192.168.1.100:9880');
    fieldRow('API Base URL', apiBaseInput);

    const chatSelInput = textInput(cfg.chatSelector, '#chat');
    fieldRow('Chat 容器选择器', chatSelInput);

    const msgSelInput = textInput(cfg.messageSelector, '.mes');
    fieldRow('单条消息选择器', msgSelInput);

    const textSelInput = textInput(cfg.textSelector, '.mes_text');
    fieldRow('消息文本选择器', textSelInput);

    const defaultVoiceInput = textInput(cfg.voiceMap.default, 'voice library name or absolute path');
    fieldRow('默认音色 (default)', defaultVoiceInput);

    const voiceMapInput = textAreaInput(voiceMapToLines(cfg.voiceMap), 'default=voice_a\nnarrator=voice_a\n小明=voice_b', 72);
    fieldRow('角色音色映射(role=voice,每行一条)', voiceMapInput);

    const regexInput = textAreaInput((cfg.localRegex.rules || []).join('\n'), '\\[TTS\\]([\\s\\S]*?)\\[/TTS\\]', 64);
    fieldRow('本地正则(每行一条,第一个捕获组为朗读正文)', regexInput);

    const cacheToggle = document.createElement('input');
    cacheToggle.type = 'checkbox';
    cacheToggle.checked = !!cfg.cache.enabled;
    fieldRow('启用快照缓存(重复文本直接复用本地音频)', cacheToggle);

    const llmToggle = document.createElement('input');
    llmToggle.type = 'checkbox';
    llmToggle.checked = !!cfg.llm.enabled;
    fieldRow('启用第三方 LLM 解析多角色/情绪', llmToggle);

    const llmEndpointInput = textInput(cfg.llm.endpoint, 'https://api.openai.com/v1/chat/completions');
    fieldRow('LLM Endpoint(OpenAI-compatible)', llmEndpointInput);

    const llmModelInput = textInput(cfg.llm.model, 'gpt-4o-mini');
    fieldRow('LLM Model', llmModelInput);

    const llmKeyInput = textInput(cfg.llm.apiKey, 'sk-...');
    llmKeyInput.type = 'password';
    fieldRow('LLM API Key(仅存浏览器 localStorage)', llmKeyInput);

    const llmPromptInput = textAreaInput(cfg.llm.systemPrompt, defaultLlmPrompt(), 120);
    fieldRow('LLM System Prompt(可留空)', llmPromptInput);

    const btnRow = document.createElement('div');
    btnRow.style.cssText = 'display:flex;gap:8px;margin-top:8px;';

    const saveBtn = document.createElement('button');
    saveBtn.textContent = '保存并应用';
    saveBtn.style.cssText = 'flex:1;padding:6px;background:#7b3cff;color:#fff;border:0;border-radius:4px;cursor:pointer;';
    saveBtn.addEventListener('click', () => {
      cfg.apiBase = apiBaseInput.value.trim();
      cfg.chatSelector = chatSelInput.value.trim() || '#chat';
      cfg.messageSelector = msgSelInput.value.trim() || '.mes';
      cfg.textSelector = textSelInput.value.trim() || '.mes_text';
      cfg.voiceMap = parseVoiceMapLines(voiceMapInput.value);
      cfg.voiceMap.default = defaultVoiceInput.value.trim() || cfg.voiceMap.default || '';
      cfg.localRegex.rules = regexInput.value.split(/\r?\n/).map(s => s.trim()).filter(Boolean);
      cfg.cache.enabled = cacheToggle.checked;
      cfg.llm.enabled = llmToggle.checked;
      cfg.llm.endpoint = llmEndpointInput.value.trim();
      cfg.llm.model = llmModelInput.value.trim();
      cfg.llm.apiKey = llmKeyInput.value.trim();
      cfg.llm.systemPrompt = llmPromptInput.value.trim();
      saveConfig(cfg);
      startObserver();
      panel.style.display = 'none';
    });
    btnRow.appendChild(saveBtn);

    const cancelBtn = document.createElement('button');
    cancelBtn.textContent = '取消';
    cancelBtn.style.cssText = 'padding:6px 12px;background:#333;color:#eee;border:0;border-radius:4px;cursor:pointer;';
    cancelBtn.addEventListener('click', () => { panel.style.display = 'none'; });
    btnRow.appendChild(cancelBtn);

    panel.appendChild(btnRow);

    // Health check indicator
    const healthRow = document.createElement('div');
    healthRow.style.cssText = 'margin-top:10px;font-size:11px;opacity:0.7;';
    panel.appendChild(healthRow);
    (async () => {
      if (!cfg.apiBase) { healthRow.textContent = '⚠ API Base 未配置'; return; }
      try {
        const r = await fetch(apiUrl('/health'), { cache: 'no-store' });
        healthRow.textContent = r.ok ? '✓ 服务在线' : '✗ /health 返回 ' + r.status;
      } catch (e) {
        healthRow.textContent = '✗ 连接失败: ' + e;
      }
    })();
  }

  // -------------------------------------------------------------------------
  // Bootstrap
  // -------------------------------------------------------------------------
  const cfg = loadConfig();

  function init() {
    buildUi();
    startObserver();
    console.info('[IndexTTS_TAVO] ready. Click 🎤 to configure.');
  }

  window.IndexTTS_TAVO = {
    init,
    getConfig: () => structuredClone(cfg),
    setConfig: (patch) => { mergeDeep(cfg, patch); saveConfig(cfg); startObserver(); },
    rescan: () => startObserver(),
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
