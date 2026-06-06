/* IndexTTS × TAVO bridge — single-file injection
 *
 * Usage in TAVO:
 *   <script src="http://<lan-ip>:9880/static/tavo.js"></script>
 *
 * On load, this script:
 *   1. Boots a singleton on window.IndexTTS_TAVO
 *   2. Reads/writes config via Tavo global variables, with localStorage fallback
 *   3. Mounts a floating gear button → settings panel
 *   4. Sets up a MutationObserver on the configured chat container
 *   5. Injects a compact audio card into each message; click → TTS pipeline
 *
 * Pipeline (per message):
 *   text → [optional] LLM parse → segments → /tts_cache_stream or /tts_dialogue_stream
 *        → <audio preload="none"> inserted under message
 *
 * Current status:
 *   - Single-message lazy playback via /tts_stream or /tts_cache_stream.
 *   - Optional LLM dialogue parsing with role voices and emotion fields.
 *   - Multi-role playback via /tts_dialogue_stream or /tts_dialogue_cache_stream.
 *   - Local voice picker, profile presets, cache controls, and message cards.
 *
 * Conventions:
 *   - Vanilla JS, no framework, no build step.
 *   - All names prefixed `_itts*` in DOM to avoid TAVO collisions.
 *   - Source is readable (no minification) so users can audit and tweak.
 */

(function () {
  'use strict';

  const LOADER_SCRIPT = document.currentScript;

  if (window.IndexTTS_TAVO) {
    if (typeof window.IndexTTS_TAVO.mountInline === 'function') {
      window.IndexTTS_TAVO.mountInline(LOADER_SCRIPT);
    } else {
      console.warn('[IndexTTS_TAVO] already loaded, skipping re-init');
    }
    return;
  }

  // -------------------------------------------------------------------------
  // Config & storage
  // -------------------------------------------------------------------------
  const STORAGE_KEY = 'indextts_tavo_config';
  const SECRET_STORAGE_KEY = 'indextts_tavo_secret';
  const DEFAULTS = {
    apiBase: scriptOrigin(),      // e.g. http://<LAN-IP>:9880
    chatSelector: '#chat',        // CSS selector for the chat container
    messageSelector: '.mes',      // CSS selector for each message
    textSelector: '.mes_text',    // CSS selector for the message text within a message
    voiceMap: {                   // role -> voice library name OR direct path
      default: '',
    },
    llm: {
      enabled: false,
      provider: 'openai',         // openai-compatible endpoint for now
      mode: 'client',             // client | server (/parse_text)
      endpoint: '',               // e.g. https://api.openai.com/v1/chat/completions
      apiKey: '',
      model: 'gpt-4o-mini',
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
    const fromTavo = loadConfigFromTavo();
    const fromLocal = loadConfigFromLocalStorage();
    const merged = mergeDeep(clonePlain(DEFAULTS), fromTavo || fromLocal || {});
    const apiKey = loadLocalApiKey(fromLocal);
    merged.llm = merged.llm || clonePlain(DEFAULTS.llm);
    merged.llm.apiKey = apiKey;
    return merged;
  }

  function loadConfigFromTavo() {
    try {
      if (!window.tavo || typeof window.tavo.get !== 'function') return null;
      const stored = window.tavo.get(STORAGE_KEY, 'global');
      if (!stored) return null;
      return typeof stored === 'string' ? JSON.parse(stored) : clonePlain(stored);
    } catch (e) {
      console.warn('[IndexTTS_TAVO] Tavo config read failed:', e);
      return null;
    }
  }

  function loadConfigFromLocalStorage() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch (e) {
      console.warn('[IndexTTS_TAVO] localStorage config parse failed:', e);
      return null;
    }
  }

  function loadLocalApiKey(localConfig) {
    try {
      const secretRaw = localStorage.getItem(SECRET_STORAGE_KEY);
      if (secretRaw) {
        const secret = JSON.parse(secretRaw);
        if (secret && typeof secret.apiKey === 'string') return secret.apiKey;
      }
    } catch (_) {}
    return localConfig && localConfig.llm && typeof localConfig.llm.apiKey === 'string'
      ? localConfig.llm.apiKey
      : '';
  }

  function publicConfig(cfg) {
    const data = clonePlain(cfg);
    if (data.llm) delete data.llm.apiKey;
    return data;
  }

  function saveConfigToTavo(cfg) {
    try {
      if (!window.tavo || typeof window.tavo.set !== 'function') return;
      window.tavo.set(STORAGE_KEY, publicConfig(cfg), 'global');
    } catch (e) {
      console.warn('[IndexTTS_TAVO] Tavo config save failed:', e);
    }
  }

  function saveConfig(cfg) {
    saveConfigToTavo(cfg);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(cfg));
    localStorage.setItem(SECRET_STORAGE_KEY, JSON.stringify({
      apiKey: cfg.llm && cfg.llm.apiKey ? cfg.llm.apiKey : '',
    }));
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

  function clonePlain(value) {
    if (typeof structuredClone === 'function') return structuredClone(value);
    return JSON.parse(JSON.stringify(value));
  }

  function scriptOrigin() {
    try {
      const script = LOADER_SCRIPT || document.currentScript;
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
    if (!base) throw new Error('请先设置 IndexTTS 服务地址');
    return base + path;
  }

  function profileNamePath(name) {
    return '/profiles/' + encodeURIComponent(name);
  }

  function configForProfile() {
    return publicConfig(cfg);
  }

  async function fetchProfiles() {
    const res = await fetch(apiUrl('/profiles'), { cache: 'no-store' });
    if (!res.ok) throw new Error('/profiles 返回 ' + res.status);
    const data = await res.json();
    return Array.isArray(data.profiles) ? data.profiles : [];
  }

  async function saveProfile(name) {
    const res = await fetch(apiUrl('/profiles'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: name, data: configForProfile() }),
    });
    if (!res.ok) throw new Error('/profiles 保存失败 ' + res.status);
    return res.json();
  }

  async function loadProfile(name) {
    const keepApiKey = cfg.llm && cfg.llm.apiKey ? cfg.llm.apiKey : '';
    const res = await fetch(apiUrl(profileNamePath(name)), { cache: 'no-store' });
    if (!res.ok) throw new Error(profileNamePath(name) + ' 返回 ' + res.status);
    const profile = await res.json();
    mergeDeep(cfg, profile.data || {});
    cfg.llm = cfg.llm || clonePlain(DEFAULTS.llm);
    cfg.llm.apiKey = keepApiKey;
    saveConfig(cfg);
    startObserver();
    return profile;
  }

  async function fetchCacheItems(limit) {
    const res = await fetch(apiUrl('/cache?limit=' + encodeURIComponent(limit || 50)), { cache: 'no-store' });
    if (!res.ok) throw new Error('/cache 返回 ' + res.status);
    const data = await res.json();
    return Array.isArray(data.items) ? data.items : [];
  }

  async function deleteCacheItem(key) {
    const res = await fetch(apiUrl('/cache/' + encodeURIComponent(key)), { method: 'DELETE' });
    if (!res.ok) throw new Error('/cache 删除失败 ' + res.status);
    return res.json();
  }

  async function pruneCache(maxItems) {
    const res = await fetch(apiUrl('/cache/prune'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ max_items: Number(maxItems || 5000) }),
    });
    if (!res.ok) throw new Error('/cache/prune 失败 ' + res.status);
    return res.json();
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

  // For multi-segment (after LLM parse). We POST parsed segments and return
  // the fetch Response; the caller currently buffers it into a Blob for the
  // browser audio element. This keeps the client simple for the lightweight
  // TAVO bridge. MediaSource can be added later if true client-side streaming
  // is needed.
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
      if (cfg.llm.mode === 'server') {
        const res = await fetch(apiUrl('/parse_text'), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            text: rawText,
            endpoint: cfg.llm.endpoint,
            model: cfg.llm.model,
            api_key: cfg.llm.apiKey,
            system_prompt: cfg.llm.systemPrompt || defaultLlmPrompt(),
            temperature: 0.2,
          }),
        });
        if (!res.ok) throw new Error('/parse_text HTTP ' + res.status + ': ' + await res.text());
        return cleanSegments(await res.json(), rawText);
      }

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
      if (!res.ok) throw new Error('第三方解析接口返回 ' + res.status + ': ' + await res.text());
      const data = await res.json();
      const content = data.choices && data.choices[0] && data.choices[0].message
        ? data.choices[0].message.content
        : JSON.stringify(data);
      const parsed = parseJsonObject(content);
      return cleanSegments(parsed, rawText);
    } catch (e) {
      console.warn('[IndexTTS_TAVO] 多角色解析失败，回退为单音色朗读:', e);
      return [{ role: 'default', text: rawText }];
    }
  }

  function defaultLlmPrompt() {
    return [
      '你是 IndexTTS 的 TAVO 文本解析器。把用户给出的小说/正文切成可朗读片段。',
      '只输出一个 JSON 对象，不要 Markdown，不要解释，不要代码块。',
      '顶层格式必须是: {"segments":[...]}',
      '每个 segment 必须包含 role 和 text；可选字段是 emo_vec、emo_text、emo_alpha。',
      '旁白、正文叙述、环境描写的 role 固定为 narrator；人物台词 role 使用人物名或称呼。',
      '不要改写、润色、扩写或删减原文 text；不要合并不同说话人；不要输出空 text。',
      'emo_vec 如果输出，必须是 8 个 0 到 1 的数字；不确定时省略 emo_vec。',
      '同一个 segment 里 emo_vec 和 emo_text 尽量二选一；需要喘息、颤抖、耳语等细节时优先用 emo_text。',
      'emo_text 用自然语言描述 TTS 语气和状态，例如: 压低声音, 轻微喘息, 声音颤抖, 带哭腔, 贴近耳语。',
      '当情绪需要喘息、停顿、害怕、疲惫、亲密、愤怒等细节时，优先补充 emo_text。',
      '示例: {"segments":[{"role":"narrator","text":"雨声敲着窗。","emo_vec":[0.05,0,0,0,0.1,0,0.05,0.25]},{"role":"小明","text":"你怎么还不睡？","emo_text":"压低声音, 带着轻微喘息"}]}',
    ].join('\n');
  }

  function cleanSegments(data, rawText) {
    const segments = Array.isArray(data && data.segments) ? data.segments : [];
    const cleaned = segments
      .map(seg => ({
        role: normalizeRole(seg.role),
        text: String(seg.text || '').trim(),
        emo_vec: sanitizeEmotionVector(seg.emo_vec),
        emo_text: seg.emo_text ? String(seg.emo_text).trim() : undefined,
        emo_alpha: sanitizeOptionalNumber(seg.emo_alpha, 0, 1),
      }))
      .filter(seg => seg.text);
    return cleaned.length ? cleaned : [{ role: 'default', text: rawText }];
  }

  function normalizeRole(role) {
    const raw = String(role || '').trim();
    if (!raw) return 'narrator';
    if (/^(旁白|叙述|正文|环境|narration|narrator)$/i.test(raw)) return 'narrator';
    return raw;
  }

  function sanitizeEmotionVector(vec) {
    if (!Array.isArray(vec) || vec.length !== 8) return undefined;
    const cleaned = vec.map(v => Number(v));
    if (cleaned.some(v => !Number.isFinite(v))) return undefined;
    return cleaned.map(v => Math.max(0, Math.min(1, v)));
  }

  function sanitizeOptionalNumber(value, min, max) {
    if (value == null || value === '') return undefined;
    const n = Number(value);
    if (!Number.isFinite(n)) return undefined;
    return Math.max(min, Math.min(max, n));
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
    throw new Error('第三方解析没有返回 JSON');
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

  function compactText(text, maxLen) {
    const cleaned = String(text || '').replace(/\s+/g, ' ').trim();
    if (!cleaned) return '';
    const limit = maxLen || 72;
    return cleaned.length > limit ? cleaned.slice(0, limit - 1) + '...' : cleaned;
  }

  const STATUS_TEXT = {
    idle: '点击生成并播放',
    loading: '生成中...',
    ready: '音频已生成',
    error: '失败',
  };

  function injectMessageButton(msgEl) {
    if (msgEl.getAttribute(INJECTED_ATTR)) return;
    msgEl.setAttribute(INJECTED_ATTR, '1');

    const card = buildAudioCard();
    msgEl.appendChild(card.root);
    updateCardPreview(card, extractTextForTts(findMessageText(msgEl)));

    card.playBtn.addEventListener('click', async (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      if (card.state === 'error') {
        clearCardAudio(card);
        setCardState(card, 'idle');
      }
      if (card.audio) {
        if (card.audio.paused) {
          await playCardAudio(card).catch(() => {});
        } else {
          card.audio.pause();
        }
        return;
      }
      await loadMessageAudio(msgEl, card);
    });

    card.reloadBtn.addEventListener('click', async (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      clearCardAudio(card);
      setCardState(card, 'idle');
      await loadMessageAudio(msgEl, card);
    });

    if (cfg.autoPlay) {
      // best-effort: schedule a click after DOM settles
      setTimeout(() => card.playBtn.click(), 200);
    }
  }

  async function loadMessageAudio(msgEl, card) {
    const text = extractTextForTts(findMessageText(msgEl));
    if (!text) {
      setCardState(card, 'error', '没有可朗读文本');
      return;
    }
    await playForMessage(msgEl, text, card);
  }

  function buildAudioCard() {
    const root = document.createElement('div');
    root.className = '_itts_audio_card';
    Object.assign(root.style, {
      marginTop: '8px',
      maxWidth: '360px',
      border: '1px solid rgba(148, 163, 184, 0.28)',
      background: 'rgba(15, 23, 42, 0.82)',
      borderRadius: '8px',
      padding: '8px',
      color: '#e5e7eb',
      fontFamily: 'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
      fontSize: '12px',
      boxSizing: 'border-box',
    });

    const top = document.createElement('div');
    top.className = '_itts_audio_card_top';
    Object.assign(top.style, {
      display: 'grid',
      gridTemplateColumns: '34px minmax(0, 1fr)',
      gap: '8px',
      alignItems: 'center',
    });

    const btn = document.createElement('button');
    btn.type = 'button';
    btn.textContent = '▶';
    btn.title = 'IndexTTS: 朗读这条消息';
    btn.className = '_itts_play_btn _itts_card_play';
    Object.assign(btn.style, {
      width: '34px',
      height: '34px',
      borderRadius: '50%',
      border: '1px solid rgba(255, 255, 255, 0.2)',
      background: '#2563eb',
      color: '#fff',
      cursor: 'pointer',
      fontSize: '13px',
      lineHeight: '1',
      padding: '0',
      textAlign: 'center',
      boxShadow: '0 2px 8px rgba(37, 99, 235, 0.35)',
    });
    top.appendChild(btn);

    const meta = document.createElement('div');
    meta.className = '_itts_audio_meta';
    Object.assign(meta.style, {
      minWidth: '0',
      display: 'grid',
      gap: '4px',
    });

    const title = document.createElement('div');
    title.className = '_itts_audio_title';
    title.textContent = 'IndexTTS';
    Object.assign(title.style, {
      fontWeight: '650',
      lineHeight: '1.2',
      overflow: 'hidden',
      textOverflow: 'ellipsis',
      whiteSpace: 'nowrap',
    });
    meta.appendChild(title);

    const status = document.createElement('div');
    status.className = '_itts_audio_status';
    status.textContent = STATUS_TEXT.idle;
    Object.assign(status.style, {
      color: '#9ca3af',
      lineHeight: '1.2',
      overflow: 'hidden',
      textOverflow: 'ellipsis',
      whiteSpace: 'nowrap',
    });
    meta.appendChild(status);

    const preview = document.createElement('div');
    preview.className = '_itts_audio_preview';
    Object.assign(preview.style, {
      color: '#cbd5e1',
      lineHeight: '1.25',
      overflow: 'hidden',
      textOverflow: 'ellipsis',
      whiteSpace: 'nowrap',
      minHeight: '15px',
    });
    meta.appendChild(preview);

    const chips = document.createElement('div');
    chips.className = '_itts_audio_chips';
    Object.assign(chips.style, {
      display: 'flex',
      gap: '5px',
      alignItems: 'center',
      flexWrap: 'wrap',
    });

    const lazyChip = buildChip('懒加载');
    chips.appendChild(lazyChip);

    const cacheChip = buildChip(cfg.cache.enabled ? '缓存开' : '缓存关');
    chips.appendChild(cacheChip);

    meta.appendChild(chips);

    const actions = document.createElement('div');
    actions.className = '_itts_audio_actions';
    Object.assign(actions.style, {
      display: 'flex',
      gap: '6px',
      alignItems: 'center',
    });

    const reloadBtn = document.createElement('button');
    reloadBtn.type = 'button';
    reloadBtn.title = '重新载入这条音频';
    reloadBtn.textContent = '↻';
    Object.assign(reloadBtn.style, {
      width: '24px',
      height: '24px',
      borderRadius: '50%',
      border: '1px solid rgba(148, 163, 184, 0.28)',
      background: 'rgba(30, 41, 59, 0.78)',
      color: '#e5e7eb',
      cursor: 'pointer',
      lineHeight: '1',
      padding: '0',
    });
    actions.appendChild(reloadBtn);
    meta.appendChild(actions);

    const progressTrack = document.createElement('div');
    progressTrack.className = '_itts_progress_track';
    Object.assign(progressTrack.style, {
      width: '100%',
      height: '3px',
      overflow: 'hidden',
      borderRadius: '999px',
      background: 'rgba(148, 163, 184, 0.28)',
    });

    const progressBar = document.createElement('div');
    progressBar.className = '_itts_progress_bar';
    Object.assign(progressBar.style, {
      width: '0%',
      height: '100%',
      borderRadius: '999px',
      background: '#38bdf8',
      transition: 'width 120ms linear',
    });
    progressTrack.appendChild(progressBar);
    meta.appendChild(progressTrack);

    top.appendChild(meta);
    root.appendChild(top);

    const body = document.createElement('div');
    body.className = '_itts_audio_body';
    Object.assign(body.style, {
      marginTop: '7px',
      display: 'none',
    });
    root.appendChild(body);

    const card = {
      root,
      playBtn: btn,
      reloadBtn,
      title,
      status,
      preview,
      cacheChip,
      progressBar,
      body,
      audio: null,
      objectUrl: null,
      state: 'idle',
      disposed: false,
    };
    root._ittsCard = card;
    return card;
  }

  function buildChip(text) {
    const chip = document.createElement('span');
    chip.textContent = text;
    Object.assign(chip.style, {
      display: 'inline-block',
      padding: '1px 5px',
      borderRadius: '999px',
      border: '1px solid rgba(148, 163, 184, 0.24)',
      color: '#cbd5e1',
      background: 'rgba(30, 41, 59, 0.68)',
      fontSize: '10px',
      lineHeight: '1.4',
    });
    return chip;
  }

  function updateCardPreview(card, text) {
    if (!card.preview) return;
    card.preview.textContent = compactText(text, 88);
  }

  function updateCacheChip(card, value) {
    if (!card.cacheChip) return;
    if (!cfg.cache.enabled) {
      card.cacheChip.textContent = '缓存关';
      return;
    }
    const state = String(value || '').toUpperCase();
    card.cacheChip.textContent = state === 'HIT' ? '缓存命中' : state === 'MISS' ? '新生成' : '缓存开';
  }

  function setCardState(card, state, detail) {
    card.state = state;
    card.root.setAttribute('data-itts-state', state);
    card.status.textContent = detail || STATUS_TEXT[state] || state;
    card.playBtn.disabled = state === 'loading';
    card.playBtn.textContent = state === 'loading' ? '...' : '▶';
    card.playBtn.style.background = state === 'error' ? '#b91c1c' : '#2563eb';
    card.body.style.display = detail && state === 'error' ? 'block' : (card.audio ? 'block' : 'none');
    if (state !== 'error' && !card.audio) {
      card.body.textContent = '';
    }
    if (state === 'error') {
      if (card.audio) {
        if (window.__indextts_tavo_active_audio === card.audio) {
          window.__indextts_tavo_active_audio = null;
        }
        card.audio.pause();
        card.audio.removeAttribute('src');
        card.audio.load();
        card.audio = null;
      }
      if (card.objectUrl) {
        URL.revokeObjectURL(card.objectUrl);
        card.objectUrl = null;
      }
      card.body.textContent = detail || STATUS_TEXT.error;
      card.progressBar.style.width = '0%';
    }
  }

  function clearCardAudio(card) {
    if (card.audio) {
      if (window.__indextts_tavo_active_audio === card.audio) {
        window.__indextts_tavo_active_audio = null;
      }
      card.audio.pause();
      card.audio.removeAttribute('src');
      card.audio.load();
      card.audio = null;
    }
    if (card.objectUrl) {
      URL.revokeObjectURL(card.objectUrl);
      card.objectUrl = null;
    }
    card.body.innerHTML = '';
    card.progressBar.style.width = '0%';
  }

  function disposeCard(card) {
    if (!card || card.disposed) return;
    card.disposed = true;
    clearCardAudio(card);
  }

  function wireAudioToCard(card, audio) {
    card.audio = audio;
    audio.controls = true;
    audio.preload = 'none';
    audio.style.width = '100%';
    audio.style.display = 'block';

    audio.addEventListener('play', () => {
      const active = window.__indextts_tavo_active_audio;
      if (active && active !== audio) active.pause();
      window.__indextts_tavo_active_audio = audio;
      card.playBtn.textContent = '❚❚';
    });
    audio.addEventListener('pause', () => {
      if (window.__indextts_tavo_active_audio === audio) {
        window.__indextts_tavo_active_audio = null;
      }
      card.playBtn.textContent = '▶';
    });
    audio.addEventListener('ended', () => {
      card.playBtn.textContent = '▶';
      card.progressBar.style.width = '100%';
    });
    audio.addEventListener('timeupdate', () => {
      if (!audio.duration || !isFinite(audio.duration)) return;
      const pct = Math.max(0, Math.min(100, (audio.currentTime / audio.duration) * 100));
      card.progressBar.style.width = pct.toFixed(1) + '%';
    });
    audio.addEventListener('error', () => {
      setCardState(card, 'error', '音频加载失败');
    });
  }

  async function playCardAudio(card) {
    if (!card.audio) return;
    const active = window.__indextts_tavo_active_audio;
    if (active && active !== card.audio) active.pause();
    try {
      await card.audio.play();
    } catch (e) {
      if (window.__indextts_tavo_active_audio === card.audio) {
        window.__indextts_tavo_active_audio = null;
      }
      throw e;
    }
  }

  async function playForMessage(msgEl, text, card) {
    setCardState(card, 'loading');
    clearCardAudio(card);
    try {
      const segments = await parseTextToSegments(text);
      updateCardPreview(card, text);

      if (segments.length === 1 && segments[0].role === 'default') {
        // Fast path: single-segment via GET (browser handles WAV streaming)
        const voice = cfg.voiceMap.default;
        if (!voice) throw new Error('请先设置默认音色');
        const audio = document.createElement('audio');
        card.title.textContent = 'IndexTTS · 单段';
        updateCacheChip(card);
        wireAudioToCard(card, audio);
        audio.src = tts_stream_url(segments[0].text, voice);
        card.body.appendChild(audio);
        card.body.style.display = 'block';
        card.body.appendChild(buildInlineSettings(card, msgEl));
        setCardState(card, 'ready');
        await playCardAudio(card).catch(() => {});
      } else {
        // Multi-segment: POST and let the browser stream the response
        const res = await fetchDialogueStream(segments, cfg.voiceMap);
        updateCacheChip(card, res.headers.get('X-IndexTTS-Cache'));
        const blob = await res.blob();   // Keep simple; MediaSource can be added later.
        const url = URL.createObjectURL(blob);
        const audio = document.createElement('audio');
        card.objectUrl = url;
        card.title.textContent = 'IndexTTS · 多段';
        wireAudioToCard(card, audio);
        audio.src = url;
        card.body.appendChild(audio);
        card.body.style.display = 'block';
        card.body.appendChild(buildInlineSettings(card, msgEl));
        setCardState(card, 'ready');
        await playCardAudio(card).catch(() => {});
      }
    } catch (e) {
      console.error('[IndexTTS_TAVO]', e);
      setCardState(card, 'error', shortError(e));
    } finally {
      if (card.state !== 'loading') card.playBtn.disabled = false;
    }
  }

  function shortError(err) {
    const msg = err && err.message ? err.message : String(err || 'unknown error');
    return msg.replace(/\s+/g, ' ').slice(0, 120);
  }
  function getInlineHost(scriptEl) {
    const parent = scriptEl && scriptEl.parentElement;
    if (parent && parent !== document.head && parent !== document.body && parent !== document.documentElement) {
      return parent;
    }
    return document.body || document.documentElement;
  }

  async function getTavoCurrentMessageText(host) {
    try {
      if (window.tavo && window.tavo.message && typeof window.tavo.message.current === 'function') {
        const msg = await window.tavo.message.current();
        if (msg && typeof msg.content === 'string' && msg.content.trim()) return msg.content.trim();
      }
    } catch (_) {}
    try {
      const clone = host.cloneNode(true);
      clone.querySelectorAll('._itts_inline_widget, ._itts_audio_card, script').forEach((n) => n.remove());
      return (clone.innerText || clone.textContent || '').trim();
    } catch (_) {
      return (host && (host.innerText || host.textContent) || '').trim();
    }
  }

  function mountInlineWidget(scriptEl) {
    if (typeof document === 'undefined') return null;
    const host = getInlineHost(scriptEl || LOADER_SCRIPT);
    if (!host) return null;
    const existing = host.querySelector && host.querySelector('._itts_inline_widget');
    if (existing) return existing;

    const root = document.createElement('div');
    root.className = '_itts_inline_widget';
    root.style.cssText = 'display:block;width:100%;max-width:560px;margin:10px auto;padding:12px;border:1px solid rgba(148,163,184,.28);border-radius:10px;background:rgba(15,23,42,.96);color:#e5e7eb;font:13px/1.45 system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;box-shadow:0 14px 36px rgba(0,0,0,.32);box-sizing:border-box;';

    const head = document.createElement('div');
    head.style.cssText = 'display:flex;align-items:flex-start;justify-content:space-between;gap:8px;margin-bottom:10px;';
    const title = document.createElement('div');
    title.innerHTML = '<div style="font-weight:750;font-size:15px;color:#bfdbfe;">IndexTTS 语音控件</div><div style="font-size:11px;color:#94a3b8;">点击播放会读取当前这条 TAVO 消息</div>';
    const state = document.createElement('div');
    state.textContent = '已加载';
    state.style.cssText = 'flex:0 0 auto;padding:4px 8px;border-radius:999px;border:1px solid rgba(148,163,184,.22);background:rgba(30,41,59,.75);font-size:11px;color:#bfdbfe;';
    head.appendChild(title);
    head.appendChild(state);
    root.appendChild(head);

    const row = document.createElement('div');
    row.style.cssText = 'display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:6px;margin-bottom:10px;';
    function makeButton(label, bg, fn) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.textContent = label;
      btn.style.cssText = 'padding:9px 6px;border:0;border-radius:8px;background:' + bg + ';color:#fff;cursor:pointer;font-size:12px;font-weight:650;';
      btn.addEventListener('click', fn);
      return btn;
    }
    row.appendChild(makeButton('设置', '#4f46e5', () => {
      const settings = root.querySelector('details[data-itts-inline-settings]');
      if (settings) settings.open = !settings.open;
    }));
    row.appendChild(makeButton('检查', '#2563eb', async () => {
      state.textContent = '检查中';
      try {
        const r = await fetch(apiUrl('/health'), { cache: 'no-store' });
        if (!r.ok) throw new Error('/health ' + r.status);
        state.textContent = '服务在线';
      } catch (e) {
        state.textContent = '连接失败';
      }
    }));
    row.appendChild(makeButton('刷新', '#334155', () => {
      startObserver();
      state.textContent = '已刷新';
    }));
    root.appendChild(row);

    const card = buildAudioCard();
    card.root.style.maxWidth = '100%';
    root.appendChild(card.root);
    root.appendChild(buildInlineSettings(card, host));
    getTavoCurrentMessageText(host).then((text) => updateCardPreview(card, extractTextForTts(text)));

    card.playBtn.addEventListener('click', async (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      if (card.state === 'error') {
        clearCardAudio(card);
        setCardState(card, 'idle');
      }
      if (card.audio) {
        if (card.audio.paused) await playCardAudio(card).catch(() => {});
        else card.audio.pause();
        return;
      }
      const text = extractTextForTts(await getTavoCurrentMessageText(host));
      if (!text) {
        setCardState(card, 'error', '没有可朗读文本');
        return;
      }
      await playForMessage(host, text, card);
    });

    card.reloadBtn.addEventListener('click', async (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      clearCardAudio(card);
      setCardState(card, 'idle');
      const text = extractTextForTts(await getTavoCurrentMessageText(host));
      if (!text) {
        setCardState(card, 'error', '没有可朗读文本');
        return;
      }
      await playForMessage(host, text, card);
    });

    if (scriptEl && scriptEl.parentElement === host) host.insertBefore(root, scriptEl);
    else host.appendChild(root);
    return root;
  }
  function buildInlineSettings(card, host) {
    const details = document.createElement('details');
    details.setAttribute('data-itts-inline-settings', '1');
    details.style.cssText = 'margin-top:10px;border:1px solid rgba(148,163,184,.22);border-radius:8px;background:rgba(30,41,59,.62);padding:8px;';
    const summary = document.createElement('summary');
    summary.textContent = '播放设置';
    summary.style.cssText = 'cursor:pointer;font-size:12px;font-weight:650;color:#dbeafe;';
    details.appendChild(summary);

    const box = document.createElement('div');
    box.style.cssText = 'margin-top:8px;display:grid;gap:8px;';

    function row(label, el) {
      const wrap = document.createElement('div');
      wrap.style.cssText = 'display:grid;gap:4px;';
      const lab = document.createElement('div');
      lab.textContent = label;
      lab.style.cssText = 'font-size:11px;color:#94a3b8;';
      wrap.appendChild(lab);
      wrap.appendChild(el);
      return wrap;
    }

    const api = document.createElement('input');
    api.type = 'text';
    api.value = cfg.apiBase || '';
    api.placeholder = '服务地址';
    api.style.cssText = 'width:100%;padding:6px 8px;border-radius:6px;border:1px solid #334155;background:#0f172a;color:#e5e7eb;font-size:12px;';

    const defaultVoice = document.createElement('input');
    defaultVoice.type = 'text';
    defaultVoice.value = (cfg.voiceMap && cfg.voiceMap.default) || '';
    defaultVoice.placeholder = '默认音色';
    defaultVoice.style.cssText = 'width:100%;padding:6px 8px;border-radius:6px;border:1px solid #334155;background:#0f172a;color:#e5e7eb;font-size:12px;';

    const voiceMap = document.createElement('textarea');
    voiceMap.value = voiceMapToLines(cfg.voiceMap || {});
    voiceMap.rows = 4;
    voiceMap.placeholder = 'default=旁白音色\nnarrator=旁白音色\n小明=男声音色';
    voiceMap.style.cssText = 'width:100%;padding:6px 8px;border-radius:6px;border:1px solid #334155;background:#0f172a;color:#e5e7eb;font-size:12px;resize:vertical;';

    const cache = document.createElement('input');
    cache.type = 'checkbox';
    cache.checked = !!cfg.cache.enabled;

    const llm = document.createElement('input');
    llm.type = 'checkbox';
    llm.checked = !!cfg.llm.enabled;

    const llmMode = document.createElement('select');
    llmMode.style.cssText = 'width:100%;padding:6px 8px;border-radius:6px;border:1px solid #334155;background:#0f172a;color:#e5e7eb;font-size:12px;';
    [['client','浏览器直连第三方'],['server','本地代理 /parse_text']].forEach(([v,t]) => { const o=document.createElement('option'); o.value=v; o.textContent=t; llmMode.appendChild(o); });
    llmMode.value = cfg.llm.mode || 'client';

    const llmEndpoint = document.createElement('input');
    llmEndpoint.type = 'text';
    llmEndpoint.value = cfg.llm.endpoint || '';
    llmEndpoint.placeholder = '第三方模型接口地址';
    llmEndpoint.style.cssText = 'width:100%;padding:6px 8px;border-radius:6px;border:1px solid #334155;background:#0f172a;color:#e5e7eb;font-size:12px;';

    const llmKey = document.createElement('input');
    llmKey.type = 'password';
    llmKey.value = cfg.llm.apiKey || '';
    llmKey.placeholder = '第三方 API 密钥';
    llmKey.style.cssText = 'width:100%;padding:6px 8px;border-radius:6px;border:1px solid #334155;background:#0f172a;color:#e5e7eb;font-size:12px;';

    const save = document.createElement('button');
    save.type = 'button';
    save.textContent = '保存设置';
    save.style.cssText = 'padding:8px 10px;border:0;border-radius:8px;background:#4f46e5;color:#fff;cursor:pointer;font-size:12px;font-weight:650;';
    save.addEventListener('click', () => {
      cfg.apiBase = api.value.trim();
      cfg.voiceMap = parseVoiceMapLines(voiceMap.value);
      cfg.voiceMap.default = defaultVoice.value.trim() || cfg.voiceMap.default || '';
      cfg.cache.enabled = cache.checked;
      cfg.llm.enabled = llm.checked;
      cfg.llm.mode = llmMode.value;
      cfg.llm.endpoint = llmEndpoint.value.trim();
      cfg.llm.apiKey = llmKey.value.trim();
      saveConfig(cfg);
      updateCardPreview(card, extractTextForTts(host && (host.innerText || host.textContent) || ''));
      card.status.textContent = '设置已保存';
    });

    box.appendChild(row('服务地址', api));
    box.appendChild(row('默认音色', defaultVoice));
    box.appendChild(row('角色音色映射', voiceMap));
    box.appendChild(row('快照缓存', cache));
    box.appendChild(row('多角色解析', llm));
    box.appendChild(row('解析方式', llmMode));
    box.appendChild(row('第三方接口地址', llmEndpoint));
    box.appendChild(row('第三方 API 密钥', llmKey));
    box.appendChild(save);
    details.appendChild(box);
    return details;
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
        for (const node of r.removedNodes) {
          if (!(node instanceof HTMLElement)) continue;
          cleanupRemovedNode(node);
        }
      }
    });
    observer.observe(root, { childList: true, subtree: true });
  }

  function cleanupRemovedNode(node) {
    const cards = [];
    if (node.matches && node.matches('._itts_audio_card')) cards.push(node);
    node.querySelectorAll && node.querySelectorAll('._itts_audio_card').forEach(cardEl => cards.push(cardEl));
    for (const cardEl of cards) {
      if (cardEl._ittsCard) disposeCard(cardEl._ittsCard);
    }
  }

  function stopObserver() {
    if (observer) {
      observer.disconnect();
      observer = null;
    }
  }

  // -------------------------------------------------------------------------
  // Bootstrap
  // -------------------------------------------------------------------------
  const cfg = loadConfig();
  function init() {
    mountInlineWidget(LOADER_SCRIPT);
    startObserver();
    console.info('[IndexTTS_TAVO] 已加载。');
  }

  window.IndexTTS_TAVO = {
    init,
    getConfig: () => clonePlain(cfg),
    setConfig: (patch) => { mergeDeep(cfg, patch); saveConfig(cfg); startObserver(); },
    rescan: () => startObserver(),
    mountInline: (scriptEl) => mountInlineWidget(scriptEl),
  };

    window.addEventListener('beforeunload', () => {
    document.querySelectorAll('._itts_audio_card').forEach(cardEl => {
      if (cardEl._ittsCard) disposeCard(cardEl._ittsCard);
    });
  });

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
