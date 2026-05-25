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

  if (window.IndexTTS_TAVO) {
    console.warn('[IndexTTS_TAVO] already loaded, skipping re-init');
    return;
  }

  // -------------------------------------------------------------------------
  // Config & storage
  // -------------------------------------------------------------------------
  const STORAGE_KEY = 'indextts_tavo_config';
  const SECRET_STORAGE_KEY = 'indextts_tavo_secret';
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
      if (!res.ok) throw new Error('LLM HTTP ' + res.status + ': ' + await res.text());
      const data = await res.json();
      const content = data.choices && data.choices[0] && data.choices[0].message
        ? data.choices[0].message.content
        : JSON.stringify(data);
      const parsed = parseJsonObject(content);
      return cleanSegments(parsed, rawText);
    } catch (e) {
      console.warn('[IndexTTS_TAVO] LLM parse failed, falling back to single segment:', e);
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
      const text = extractTextForTts(findMessageText(msgEl));
      if (!text) {
        setCardState(card, 'error', '没有可朗读文本');
        return;
      }
      await playForMessage(msgEl, text, card);
    });

    if (cfg.autoPlay) {
      // best-effort: schedule a click after DOM settles
      setTimeout(() => card.playBtn.click(), 200);
    }
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

    const lazyChip = buildChip('lazy');
    chips.appendChild(lazyChip);

    const cacheChip = buildChip(cfg.cache.enabled ? 'cache:on' : 'cache:off');
    chips.appendChild(cacheChip);

    meta.appendChild(chips);

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
      card.cacheChip.textContent = 'cache:off';
      return;
    }
    const state = String(value || '').toUpperCase();
    card.cacheChip.textContent = state === 'HIT' ? 'cache:hit' : state === 'MISS' ? 'cache:miss' : 'cache:on';
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
        if (!voice) throw new Error('default voice not configured');
        const audio = document.createElement('audio');
        card.title.textContent = 'IndexTTS · 单段';
        updateCacheChip(card);
        wireAudioToCard(card, audio);
        audio.src = tts_stream_url(segments[0].text, voice);
        card.body.appendChild(audio);
        card.body.style.display = 'block';
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

    let fieldTarget = panel;

    function createSection(titleText, open) {
      const section = document.createElement('details');
      section.open = !!open;
      section.style.cssText = 'margin:10px 0;padding:10px;border:1px solid #333;border-radius:8px;background:#14141c;';
      const summary = document.createElement('summary');
      summary.textContent = titleText;
      summary.style.cssText = 'cursor:pointer;font-size:12px;font-weight:650;color:#dbeafe;margin:-2px 0 8px;';
      const body = document.createElement('div');
      section.appendChild(summary);
      section.appendChild(body);
      panel.appendChild(section);
      return body;
    }

    function fieldRow(labelText, inputEl) {
      const row = document.createElement('div');
      row.style.cssText = 'margin-bottom:8px;';
      const lbl = document.createElement('div');
      lbl.textContent = labelText;
      lbl.style.cssText = 'font-size:12px;opacity:0.8;margin-bottom:2px;';
      row.appendChild(lbl);
      row.appendChild(inputEl);
      fieldTarget.appendChild(row);
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

    const basicSection = createSection('基础设置', true);
    const voiceSection = createSection('音色库', true);
    const advancedSection = createSection('高级设置', false);

    fieldTarget = basicSection;

    const apiBaseInput = textInput(cfg.apiBase, 'http://192.168.1.100:9880');
    fieldRow('API Base URL', apiBaseInput);

    fieldTarget = advancedSection;

    const chatSelInput = textInput(cfg.chatSelector, '#chat');
    fieldRow('Chat 容器选择器', chatSelInput);

    const msgSelInput = textInput(cfg.messageSelector, '.mes');
    fieldRow('单条消息选择器', msgSelInput);

    const textSelInput = textInput(cfg.textSelector, '.mes_text');
    fieldRow('消息文本选择器', textSelInput);

    fieldTarget = basicSection;

    const defaultVoiceInput = textInput(cfg.voiceMap.default, 'voice library name or absolute path');
    fieldRow('默认音色 (default)', defaultVoiceInput);

    const voiceMapInput = textAreaInput(voiceMapToLines(cfg.voiceMap), 'default=voice_a\nnarrator=voice_a\n小明=voice_b', 72);
    fieldRow('角色音色映射(role=voice,每行一条)', voiceMapInput);

    fieldTarget = voiceSection;

    const voiceLibBox = document.createElement('div');
    voiceLibBox.style.cssText = 'margin:0 0 2px;';
    const voiceLibTitle = document.createElement('div');
    voiceLibTitle.textContent = '音色库';
    voiceLibTitle.style.cssText = 'font-size:12px;font-weight:600;color:#93c5fd;margin-bottom:8px;';
    voiceLibBox.appendChild(voiceLibTitle);

    const voiceSelect = document.createElement('select');
    voiceSelect.style.cssText = 'width:100%;padding:4px 6px;background:#0d0d14;color:#eee;border:1px solid #333;border-radius:4px;font-size:12px;margin-bottom:8px;';
    const emptyVoiceOption = document.createElement('option');
    emptyVoiceOption.value = '';
    emptyVoiceOption.textContent = '未加载音色';
    voiceSelect.appendChild(emptyVoiceOption);
    voiceLibBox.appendChild(voiceSelect);

    const voiceRoleInput = textInput('narrator', 'role name');
    voiceRoleInput.style.marginBottom = '8px';
    voiceLibBox.appendChild(voiceRoleInput);

    const voiceBtnRow = document.createElement('div');
    voiceBtnRow.style.cssText = 'display:flex;gap:8px;';

    const voiceRefreshBtn = document.createElement('button');
    voiceRefreshBtn.textContent = '刷新音色';
    voiceRefreshBtn.style.cssText = 'flex:1;padding:6px;background:#333;color:#eee;border:0;border-radius:4px;cursor:pointer;';
    voiceBtnRow.appendChild(voiceRefreshBtn);

    const voiceDefaultBtn = document.createElement('button');
    voiceDefaultBtn.textContent = '设为默认';
    voiceDefaultBtn.style.cssText = 'flex:1;padding:6px;background:#2563eb;color:#fff;border:0;border-radius:4px;cursor:pointer;';
    voiceBtnRow.appendChild(voiceDefaultBtn);

    const voiceInsertBtn = document.createElement('button');
    voiceInsertBtn.textContent = '插入映射';
    voiceInsertBtn.style.cssText = 'flex:1;padding:6px;background:#4f46e5;color:#fff;border:0;border-radius:4px;cursor:pointer;';
    voiceBtnRow.appendChild(voiceInsertBtn);
    voiceLibBox.appendChild(voiceBtnRow);

    const voiceStatus = document.createElement('div');
    voiceStatus.style.cssText = 'margin-top:7px;font-size:11px;opacity:0.75;min-height:16px;';
    voiceLibBox.appendChild(voiceStatus);
    voiceSection.appendChild(voiceLibBox);

    function selectedVoiceName() {
      return (voiceSelect.value || '').trim();
    }

    function setVoiceStatus(text) {
      voiceStatus.textContent = text || '';
    }

    function upsertVoiceMapLine(role, voiceName) {
      const next = parseVoiceMapLines(voiceMapInput.value);
      next[role] = voiceName;
      voiceMapInput.value = voiceMapToLines(next);
    }

    async function refreshVoiceList() {
      setVoiceStatus('读取音色库...');
      try {
        const voices = await listVoices();
        voiceSelect.innerHTML = '';
        if (!voices.length) {
          const opt = document.createElement('option');
          opt.value = '';
          opt.textContent = '暂无音色';
          voiceSelect.appendChild(opt);
          setVoiceStatus('暂无音色');
          return;
        }
        voices.forEach((voice) => {
          const name = String(voice.name || '').trim();
          if (!name) return;
          const opt = document.createElement('option');
          opt.value = name;
          const size = Number(voice.size_bytes || 0);
          const sizeText = size ? ' · ' + Math.round(size / 1024) + ' KB' : '';
          opt.textContent = name + (voice.ext || '') + sizeText;
          voiceSelect.appendChild(opt);
        });
        setVoiceStatus('已刷新 ' + voiceSelect.options.length + ' 个音色');
      } catch (e) {
        setVoiceStatus('音色库不可用: ' + shortError(e));
      }
    }

    voiceRefreshBtn.addEventListener('click', refreshVoiceList);
    voiceDefaultBtn.addEventListener('click', () => {
      const name = selectedVoiceName();
      if (!name) { setVoiceStatus('请先选择音色'); return; }
      defaultVoiceInput.value = name;
      setVoiceStatus('默认音色 = ' + name);
    });
    voiceInsertBtn.addEventListener('click', () => {
      const name = selectedVoiceName();
      const role = (voiceRoleInput.value || 'narrator').trim();
      if (!name) { setVoiceStatus('请先选择音色'); return; }
      if (!role) { setVoiceStatus('请输入 role'); return; }
      upsertVoiceMapLine(role, name);
      setVoiceStatus('已写入: ' + role + '=' + name);
    });

    const regexInput = textAreaInput((cfg.localRegex.rules || []).join('\n'), '\\[TTS\\]([\\s\\S]*?)\\[/TTS\\]', 64);
    fieldTarget = advancedSection;
    fieldRow('本地正则(每行一条,第一个捕获组为朗读正文)', regexInput);

    const cacheToggle = document.createElement('input');
    cacheToggle.type = 'checkbox';
    cacheToggle.checked = !!cfg.cache.enabled;
    fieldRow('启用快照缓存(重复文本直接复用本地音频)', cacheToggle);

    const llmToggle = document.createElement('input');
    llmToggle.type = 'checkbox';
    llmToggle.checked = !!cfg.llm.enabled;
    fieldRow('启用第三方 LLM 解析多角色/情绪', llmToggle);

    const llmModeInput = document.createElement('select');
    llmModeInput.style.cssText = 'width:100%;padding:4px 6px;background:#0d0d14;color:#eee;border:1px solid #333;border-radius:4px;font-size:12px;';
    [
      ['client', '浏览器直连第三方 API'],
      ['server', '本地服务代理 /parse_text'],
    ].forEach(([value, label]) => {
      const opt = document.createElement('option');
      opt.value = value;
      opt.textContent = label;
      llmModeInput.appendChild(opt);
    });
    llmModeInput.value = cfg.llm.mode || 'client';
    fieldRow('LLM 调用方式', llmModeInput);

    const llmEndpointInput = textInput(cfg.llm.endpoint, 'https://api.openai.com/v1/chat/completions');
    fieldRow('LLM Endpoint(OpenAI-compatible)', llmEndpointInput);

    const llmModelInput = textInput(cfg.llm.model, 'gpt-4o-mini');
    fieldRow('LLM Model', llmModelInput);

    const llmKeyInput = textInput(cfg.llm.apiKey, 'sk-...');
    llmKeyInput.type = 'password';
    fieldRow('LLM API Key(仅本地保存；代理模式会随请求转发)', llmKeyInput);

    const llmPromptInput = textAreaInput(cfg.llm.systemPrompt, defaultLlmPrompt(), 120);
    fieldRow('LLM System Prompt(可留空)', llmPromptInput);

    function applyInputsToConfig() {
      cfg.apiBase = apiBaseInput.value.trim();
      cfg.chatSelector = chatSelInput.value.trim() || '#chat';
      cfg.messageSelector = msgSelInput.value.trim() || '.mes';
      cfg.textSelector = textSelInput.value.trim() || '.mes_text';
      cfg.voiceMap = parseVoiceMapLines(voiceMapInput.value);
      cfg.voiceMap.default = defaultVoiceInput.value.trim() || cfg.voiceMap.default || '';
      cfg.localRegex.rules = regexInput.value.split(/\r?\n/).map(s => s.trim()).filter(Boolean);
      cfg.cache.enabled = cacheToggle.checked;
      cfg.llm.enabled = llmToggle.checked;
      cfg.llm.mode = llmModeInput.value || 'client';
      cfg.llm.endpoint = llmEndpointInput.value.trim();
      cfg.llm.model = llmModelInput.value.trim();
      cfg.llm.apiKey = llmKeyInput.value.trim();
      cfg.llm.systemPrompt = llmPromptInput.value.trim();
    }

    const profileBox = document.createElement('div');
    profileBox.style.cssText = 'margin:12px 0 10px;padding:10px;border:1px solid #333;border-radius:6px;background:#14141c;';
    const profileTitle = document.createElement('div');
    profileTitle.textContent = '配置预设/Profile';
    profileTitle.style.cssText = 'font-size:12px;font-weight:600;color:#c4b5fd;margin-bottom:8px;';
    profileBox.appendChild(profileTitle);

    const profileNameInput = textInput('', 'profile name');
    profileNameInput.style.marginBottom = '8px';
    profileBox.appendChild(profileNameInput);

    const profileSelect = document.createElement('select');
    profileSelect.style.cssText = 'width:100%;padding:4px 6px;background:#0d0d14;color:#eee;border:1px solid #333;border-radius:4px;font-size:12px;margin-bottom:8px;';
    const emptyProfileOption = document.createElement('option');
    emptyProfileOption.value = '';
    emptyProfileOption.textContent = '未加载列表';
    profileSelect.appendChild(emptyProfileOption);
    profileBox.appendChild(profileSelect);

    const profileBtnRow = document.createElement('div');
    profileBtnRow.style.cssText = 'display:flex;gap:8px;';

    const profileSaveBtn = document.createElement('button');
    profileSaveBtn.textContent = '保存';
    profileSaveBtn.style.cssText = 'flex:1;padding:6px;background:#4f46e5;color:#fff;border:0;border-radius:4px;cursor:pointer;';
    profileBtnRow.appendChild(profileSaveBtn);

    const profileRefreshBtn = document.createElement('button');
    profileRefreshBtn.textContent = '刷新列表';
    profileRefreshBtn.style.cssText = 'flex:1;padding:6px;background:#333;color:#eee;border:0;border-radius:4px;cursor:pointer;';
    profileBtnRow.appendChild(profileRefreshBtn);

    const profileLoadBtn = document.createElement('button');
    profileLoadBtn.textContent = '加载';
    profileLoadBtn.style.cssText = 'flex:1;padding:6px;background:#2563eb;color:#fff;border:0;border-radius:4px;cursor:pointer;';
    profileBtnRow.appendChild(profileLoadBtn);
    profileBox.appendChild(profileBtnRow);

    const profileStatus = document.createElement('div');
    profileStatus.style.cssText = 'margin-top:7px;font-size:11px;opacity:0.75;min-height:16px;';
    profileBox.appendChild(profileStatus);
    advancedSection.appendChild(profileBox);

    function setProfileStatus(text) {
      profileStatus.textContent = text || '';
    }

    async function refreshProfileList() {
      setProfileStatus('读取预设列表...');
      try {
        const profiles = await fetchProfiles();
        profileSelect.innerHTML = '';
        if (!profiles.length) {
          const opt = document.createElement('option');
          opt.value = '';
          opt.textContent = '暂无预设';
          profileSelect.appendChild(opt);
          setProfileStatus('暂无预设');
          return;
        }
        profiles.forEach((profile) => {
          const name = String(profile.name || '').trim();
          if (!name) return;
          const opt = document.createElement('option');
          opt.value = name;
          opt.textContent = name;
          profileSelect.appendChild(opt);
        });
        setProfileStatus('已刷新 ' + profileSelect.options.length + ' 个预设');
      } catch (e) {
        setProfileStatus('Profile 不可用: ' + shortError(e));
      }
    }

    profileRefreshBtn.addEventListener('click', refreshProfileList);

    profileSaveBtn.addEventListener('click', async () => {
      const name = profileNameInput.value.trim();
      if (!name) { setProfileStatus('请输入 profile name'); return; }
      try {
        applyInputsToConfig();
        saveConfig(cfg);
        setProfileStatus('保存预设...');
        await saveProfile(name);
        profileSelect.value = name;
        setProfileStatus('已保存: ' + name);
        await refreshProfileList();
        profileSelect.value = name;
      } catch (e) {
        setProfileStatus('保存失败: ' + shortError(e));
      }
    });

    profileLoadBtn.addEventListener('click', async () => {
      const name = (profileSelect.value || profileNameInput.value).trim();
      if (!name) { setProfileStatus('请选择或输入 profile name'); return; }
      try {
        setProfileStatus('加载预设...');
        await loadProfile(name);
        setProfileStatus('已加载: ' + name);
        renderPanel(panel);
      } catch (e) {
        setProfileStatus('加载失败: ' + shortError(e));
      }
    });

    const cacheBox = document.createElement('div');
    cacheBox.style.cssText = 'margin:12px 0 10px;padding:10px;border:1px solid #333;border-radius:6px;background:#14141c;';
    const cacheTitle = document.createElement('div');
    cacheTitle.textContent = '快照缓存';
    cacheTitle.style.cssText = 'font-size:12px;font-weight:600;color:#86efac;margin-bottom:8px;';
    cacheBox.appendChild(cacheTitle);

    const cacheSelect = document.createElement('select');
    cacheSelect.style.cssText = 'width:100%;padding:4px 6px;background:#0d0d14;color:#eee;border:1px solid #333;border-radius:4px;font-size:12px;margin-bottom:8px;';
    const emptyCacheOption = document.createElement('option');
    emptyCacheOption.value = '';
    emptyCacheOption.textContent = '未加载缓存';
    cacheSelect.appendChild(emptyCacheOption);
    cacheBox.appendChild(cacheSelect);

    const pruneInput = textInput('5000', 'max cache items');
    pruneInput.style.marginBottom = '8px';
    cacheBox.appendChild(pruneInput);

    const cacheBtnRow = document.createElement('div');
    cacheBtnRow.style.cssText = 'display:flex;gap:8px;';

    const cacheRefreshBtn = document.createElement('button');
    cacheRefreshBtn.textContent = '刷新缓存';
    cacheRefreshBtn.style.cssText = 'flex:1;padding:6px;background:#333;color:#eee;border:0;border-radius:4px;cursor:pointer;';
    cacheBtnRow.appendChild(cacheRefreshBtn);

    const cacheDeleteBtn = document.createElement('button');
    cacheDeleteBtn.textContent = '删除选中';
    cacheDeleteBtn.style.cssText = 'flex:1;padding:6px;background:#7f1d1d;color:#fff;border:0;border-radius:4px;cursor:pointer;';
    cacheBtnRow.appendChild(cacheDeleteBtn);

    const cachePruneBtn = document.createElement('button');
    cachePruneBtn.textContent = '清理旧缓存';
    cachePruneBtn.style.cssText = 'flex:1;padding:6px;background:#166534;color:#fff;border:0;border-radius:4px;cursor:pointer;';
    cacheBtnRow.appendChild(cachePruneBtn);
    cacheBox.appendChild(cacheBtnRow);

    const cacheStatus = document.createElement('div');
    cacheStatus.style.cssText = 'margin-top:7px;font-size:11px;opacity:0.75;min-height:16px;';
    cacheBox.appendChild(cacheStatus);
    advancedSection.appendChild(cacheBox);

    function setCacheStatus(text) {
      cacheStatus.textContent = text || '';
    }

    function selectedCacheKey() {
      return (cacheSelect.value || '').trim();
    }

    async function refreshCacheList() {
      setCacheStatus('读取缓存...');
      try {
        const items = await fetchCacheItems(80);
        cacheSelect.innerHTML = '';
        if (!items.length) {
          const opt = document.createElement('option');
          opt.value = '';
          opt.textContent = '暂无缓存';
          cacheSelect.appendChild(opt);
          setCacheStatus('暂无缓存');
          return;
        }
        items.forEach((item) => {
          const key = String(item.key || '').trim();
          if (!key) return;
          const opt = document.createElement('option');
          opt.value = key;
          const hits = item.hit_count == null ? 0 : Number(item.hit_count || 0);
          const preview = String(item.text_preview || key).replace(/\s+/g, ' ').slice(0, 42);
          opt.textContent = hits + 'x · ' + preview;
          cacheSelect.appendChild(opt);
        });
        setCacheStatus('已刷新 ' + cacheSelect.options.length + ' 条缓存');
      } catch (e) {
        setCacheStatus('缓存不可用: ' + shortError(e));
      }
    }

    cacheRefreshBtn.addEventListener('click', refreshCacheList);
    cacheDeleteBtn.addEventListener('click', async () => {
      const key = selectedCacheKey();
      if (!key) { setCacheStatus('请先选择缓存'); return; }
      try {
        setCacheStatus('删除缓存...');
        const result = await deleteCacheItem(key);
        setCacheStatus(result.deleted ? '已删除' : '未找到缓存');
        await refreshCacheList();
      } catch (e) {
        setCacheStatus('删除失败: ' + shortError(e));
      }
    });
    cachePruneBtn.addEventListener('click', async () => {
      try {
        const maxItems = Number(pruneInput.value || 5000);
        setCacheStatus('清理缓存...');
        const result = await pruneCache(maxItems);
        setCacheStatus('已清理 ' + (result.deleted || 0) + ' 条');
        await refreshCacheList();
      } catch (e) {
        setCacheStatus('清理失败: ' + shortError(e));
      }
    });

    const btnRow = document.createElement('div');
    btnRow.style.cssText = 'display:flex;gap:8px;margin-top:8px;';

    const saveBtn = document.createElement('button');
    saveBtn.textContent = '保存并应用';
    saveBtn.style.cssText = 'flex:1;padding:6px;background:#7b3cff;color:#fff;border:0;border-radius:4px;cursor:pointer;';
    saveBtn.addEventListener('click', () => {
      applyInputsToConfig();
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
    getConfig: () => clonePlain(cfg),
    setConfig: (patch) => { mergeDeep(cfg, patch); saveConfig(cfg); startObserver(); },
    rescan: () => startObserver(),
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
