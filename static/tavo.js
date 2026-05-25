;(async function () {
  "use strict";

  var script = document.currentScript;
  var STYLE_ID = "indextts-tavo-style-v1";
  var CONFIG_KEY = "indextts_tavo_config_v1";

  function apiBase() {
    try {
      return new URL(script && script.src ? script.src : location.href).origin;
    } catch (_) {
      return "http://127.0.0.1:9880";
    }
  }

  var DEFAULT_CONFIG = {
    apiBase: apiBase(),
    mode: "single",
    endpoint: "/tts_cache_stream",
    dialogueEndpoint: "/tts_dialogue_cache_stream",
    parseEndpoint: "/parse_text",
    defaultVoice: "",
    roleVoicesText: "",
    useLlmParse: false,
    llmEndpoint: "",
    llmModel: "",
    llmApiKey: "",
    emotionText: "自然、有情绪，贴合上下文；旁白稳定，人物台词带呼吸感和情绪起伏",
    intervalMs: 350,
    topP: 0.8,
    topK: 30,
    temperature: 0.8,
    repetitionPenalty: 10,
    emoAlpha: 0.7
  };

  function $(root, sel) { return root.querySelector(sel); }

  function escapeHtml(value) {
    return String(value == null ? "" : value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function ensureStyle() {
    if (document.getElementById(STYLE_ID)) return;
    var style = document.createElement("style");
    style.id = STYLE_ID;
    style.textContent = [
      ".idx-tts{max-width:760px;margin:12px 0;padding:14px;border:1px solid rgba(120,130,150,.25);border-radius:8px;background:#101318;color:#f3f5f7;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI','Microsoft YaHei',sans-serif;box-sizing:border-box;line-height:1.45}",
      ".idx-tts *{box-sizing:border-box;letter-spacing:0}",
      ".idx-row{display:flex;align-items:center;gap:12px}",
      ".idx-main{flex:1;min-width:0}",
      ".idx-title{font-size:15px;font-weight:700;color:#fff;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}",
      ".idx-sub{margin-top:3px;font-size:12px;color:#a8b0bd;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}",
      ".idx-play{width:54px;height:54px;flex:0 0 54px;border:0;border-radius:50%;background:#ffffff;color:#111827;display:flex;align-items:center;justify-content:center;cursor:pointer;box-shadow:0 8px 22px rgba(0,0,0,.28);padding:0}",
      ".idx-play:disabled{opacity:.55;cursor:progress}",
      ".idx-play svg{width:24px;height:24px;fill:currentColor}",
      ".idx-play[data-state='playing']{background:#4ade80;color:#052e16}",
      ".idx-progress{margin-top:12px}",
      ".idx-time{display:flex;justify-content:space-between;color:#a8b0bd;font-size:11px;font-variant-numeric:tabular-nums;margin-bottom:5px}",
      ".idx-bar{height:6px;border-radius:999px;background:#283040;overflow:hidden}",
      ".idx-fill{height:100%;width:0%;background:linear-gradient(90deg,#4ade80,#60a5fa);transition:width .18s linear}",
      ".idx-actions{display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-top:12px}",
      ".idx-btn{height:32px;border:1px solid rgba(170,180,200,.28);border-radius:7px;background:#171c25;color:#e8edf4;padding:0 10px;font-size:12px;cursor:pointer;font-family:inherit}",
      ".idx-btn:disabled{opacity:.5;cursor:not-allowed}",
      ".idx-btn:hover:not(:disabled){background:#202838}",
      ".idx-pill{font-size:11px;color:#a8b0bd;border:1px solid rgba(170,180,200,.18);border-radius:999px;padding:4px 8px;max-width:100%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}",
      ".idx-settings{margin-top:12px;border-top:1px solid rgba(170,180,200,.16);padding-top:10px}",
      ".idx-settings summary{cursor:pointer;color:#dbe4ef;font-size:13px;user-select:none}",
      ".idx-grid{display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-top:10px}",
      ".idx-field{display:flex;flex-direction:column;gap:5px;min-width:0}",
      ".idx-field.idx-wide{grid-column:1/-1}",
      ".idx-label{font-size:12px;color:#a8b0bd}",
      ".idx-input,.idx-textarea,.idx-select{width:100%;border:1px solid rgba(170,180,200,.22);border-radius:7px;background:#0b0f15;color:#eef3f8;padding:8px;font-size:12px;font-family:inherit;outline:none}",
      ".idx-textarea{min-height:64px;resize:vertical;line-height:1.45}",
      ".idx-help{font-size:11px;color:#8993a3;margin-top:6px}",
      ".idx-error{margin-top:10px;color:#fecaca;background:rgba(127,29,29,.28);border:1px solid rgba(248,113,113,.22);border-radius:7px;padding:8px;font-size:12px;white-space:pre-wrap}",
      ".idx-hidden{display:none!important}",
      "@media (max-width:520px){.idx-tts{margin:10px 0;padding:12px}.idx-grid{grid-template-columns:1fr}.idx-play{width:48px;height:48px;flex-basis:48px}.idx-title{font-size:14px}}"
    ].join("");
    document.head.appendChild(style);
  }

  async function getStoredConfig() {
    var saved = null;
    try {
      if (window.tavo && typeof tavo.get === "function") saved = await tavo.get(CONFIG_KEY, "global");
    } catch (_) {}
    if (!saved) {
      try { saved = JSON.parse(localStorage.getItem(CONFIG_KEY) || "null"); } catch (_) {}
    }
    return Object.assign({}, DEFAULT_CONFIG, saved || {});
  }

  async function saveConfig(cfg) {
    var data = Object.assign({}, cfg);
    try {
      if (window.tavo && typeof tavo.set === "function") await tavo.set(CONFIG_KEY, data, "global");
    } catch (_) {}
    try { localStorage.setItem(CONFIG_KEY, JSON.stringify(data)); } catch (_) {}
  }

  async function currentMessageText() {
    var text = "";
    try {
      if (window.tavo && tavo.message && typeof tavo.message.current === "function") {
        var msg = await tavo.message.current();
        if (msg && msg.content) text = String(msg.content);
      }
    } catch (_) {}
    if (!text && script && script.parentElement) text = script.parentElement.innerText || "";
    text = text.replace(/<script[\s\S]*?<\/script>/gi, "");
    text = text.replace(/\[IndexTTS_TAVO_SCRIPT\]/g, "");
    return text.trim();
  }

  function icon(state) {
    if (state === "playing") return '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 5h4v14H7zm6 0h4v14h-4z"/></svg>';
    if (state === "loading") return '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2a10 10 0 1 0 10 10h-3a7 7 0 1 1-7-7z"/></svg>';
    return '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5v14l11-7z"/></svg>';
  }

  function formatTime(sec) {
    sec = Math.max(0, Number(sec || 0));
    if (!isFinite(sec)) return "--:--";
    var m = Math.floor(sec / 60);
    var s = Math.floor(sec % 60);
    return String(m).padStart(2, "0") + ":" + String(s).padStart(2, "0");
  }

  function parseRoleVoices(text, defaultVoice) {
    var voices = {};
    if (defaultVoice) voices.default = defaultVoice;
    String(text || "").split(/\r?\n/).forEach(function (line) {
      var cleaned = line.trim();
      if (!cleaned) return;
      var m = cleaned.match(/^(.+?)[=:：]\s*(.+)$/);
      if (m) voices[m[1].trim()] = m[2].trim();
    });
    return voices;
  }

  async function listVoices(base) {
    try {
      var res = await fetch(base.replace(/\/+$/, "") + "/voices", { cache: "no-store" });
      if (!res.ok) return [];
      var data = await res.json();
      return Array.isArray(data.voices) ? data.voices : [];
    } catch (_) { return []; }
  }

  async function buildSegments(text, cfg, setStatus) {
    if (cfg.useLlmParse && cfg.llmEndpoint && cfg.llmModel) {
      setStatus("正在解析旁白和人物音色...");
      var prompt = [
        "把小说正文拆成适合 TTS 的片段。旁白 role 固定为 narrator；人物台词使用人物名。",
        "每段输出 role、text，并给 emo_vec 八个 0-1 情绪值或 emo_text 中文情绪描述。",
        "只返回 JSON：{\"segments\":[{\"role\":\"narrator\",\"text\":\"...\",\"emo_vec\":[0,0,0,0,0,0,0,0.4]}]}。",
        "情绪要求：" + cfg.emotionText
      ].join("\n");
      var res = await fetch(cfg.apiBase.replace(/\/+$/, "") + cfg.parseEndpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          text: text,
          endpoint: cfg.llmEndpoint,
          model: cfg.llmModel,
          api_key: cfg.llmApiKey || "",
          system_prompt: prompt,
          temperature: 0.2,
          timeout: 90
        })
      });
      if (!res.ok) throw new Error(await res.text());
      var parsed = await res.json();
      if (parsed && Array.isArray(parsed.segments) && parsed.segments.length) return parsed.segments;
    }
    return [{ role: "narrator", text: text, emo_text: cfg.emotionText, emo_alpha: Number(cfg.emoAlpha) || 0.7 }];
  }

  function mount(root, initialConfig, messageText) {
    root.innerHTML = [
      '<div class="idx-row">',
      '  <button class="idx-play" type="button" data-role="play" data-state="idle" aria-label="生成并播放">' + icon("idle") + '</button>',
      '  <div class="idx-main">',
      '    <div class="idx-title">IndexTTS 语音播放器</div>',
      '    <div class="idx-sub" data-role="status">点播放后生成当前消息音频</div>',
      '  </div>',
      '</div>',
      '<div class="idx-progress">',
      '  <div class="idx-time"><span data-role="current">00:00</span><span data-role="total">--:--</span></div>',
      '  <div class="idx-bar"><div class="idx-fill" data-role="fill"></div></div>',
      '</div>',
      '<div class="idx-actions">',
      '  <button class="idx-btn" type="button" data-role="regen">重新生成</button>',
      '  <button class="idx-btn" type="button" data-role="stop">停止</button>',
      '  <span class="idx-pill" data-role="voice-pill">音色：自动</span>',
      '  <span class="idx-pill">字数：' + escapeHtml(String(messageText.length)) + '</span>',
      '</div>',
      '<details class="idx-settings">',
      '  <summary>语音设置</summary>',
      '  <div class="idx-grid">',
      '    <label class="idx-field"><span class="idx-label">API 地址</span><input class="idx-input" data-field="apiBase"></label>',
      '    <label class="idx-field"><span class="idx-label">默认音色</span><select class="idx-select" data-field="defaultVoice"></select></label>',
      '    <label class="idx-field"><span class="idx-label">模式</span><select class="idx-select" data-field="mode"><option value="single">单音色</option><option value="dialogue">多角色</option></select></label>',
      '    <label class="idx-field"><span class="idx-label">片段间隔 ms</span><input class="idx-input" type="number" min="0" max="3000" data-field="intervalMs"></label>',
      '    <label class="idx-field idx-wide"><span class="idx-label">角色音色映射（每行：人物=音色名）</span><textarea class="idx-textarea" data-field="roleVoicesText" placeholder="旁白=旁白音色\n李明=男声音色\n小雨=女声音色"></textarea></label>',
      '    <label class="idx-field idx-wide"><span class="idx-label">情绪提示</span><textarea class="idx-textarea" data-field="emotionText"></textarea></label>',
      '    <label class="idx-field"><span class="idx-label">LLM 解析</span><select class="idx-select" data-field="useLlmParse"><option value="false">关闭</option><option value="true">开启</option></select></label>',
      '    <label class="idx-field"><span class="idx-label">LLM 模型</span><input class="idx-input" data-field="llmModel" placeholder="gpt-4o-mini"></label>',
      '    <label class="idx-field idx-wide"><span class="idx-label">LLM 接口地址</span><input class="idx-input" data-field="llmEndpoint" placeholder="https://.../v1/chat/completions"></label>',
      '    <label class="idx-field idx-wide"><span class="idx-label">LLM Key（只保存在本机 TAVO）</span><input class="idx-input" type="password" data-field="llmApiKey"></label>',
      '  </div>',
      '  <div class="idx-actions"><button class="idx-btn" type="button" data-role="save">保存设置</button><button class="idx-btn" type="button" data-role="reload-voices">刷新音色</button></div>',
      '  <div class="idx-help">不配置 LLM 时使用单音色朗读；开启 LLM 后会把正文拆成旁白和人物片段，再按角色音色播放。</div>',
      '</details>',
      '<audio data-role="audio" preload="none"></audio>',
      '<div class="idx-error idx-hidden" data-role="error"></div>'
    ].join("");

    var cfg = Object.assign({}, initialConfig);
    var audio = $(root, '[data-role="audio"]');
    var play = $(root, '[data-role="play"]');
    var status = $(root, '[data-role="status"]');
    var err = $(root, '[data-role="error"]');
    var fill = $(root, '[data-role="fill"]');
    var cur = $(root, '[data-role="current"]');
    var total = $(root, '[data-role="total"]');
    var voicePill = $(root, '[data-role="voice-pill"]');

    function setStatus(text) { status.textContent = text; }
    function setError(text) {
      if (!text) { err.classList.add("idx-hidden"); err.textContent = ""; return; }
      err.textContent = text;
      err.classList.remove("idx-hidden");
    }
    function setButton(state) {
      play.dataset.state = state;
      play.innerHTML = icon(state);
      play.disabled = state === "loading";
    }
    function readFields() {
      cfg.apiBase = $('[data-field="apiBase"]', root).value.trim() || DEFAULT_CONFIG.apiBase;
      cfg.defaultVoice = $('[data-field="defaultVoice"]', root).value.trim();
      cfg.mode = $('[data-field="mode"]', root).value;
      cfg.intervalMs = Number($('[data-field="intervalMs"]', root).value || 350);
      cfg.roleVoicesText = $('[data-field="roleVoicesText"]', root).value;
      cfg.emotionText = $('[data-field="emotionText"]', root).value;
      cfg.useLlmParse = $('[data-field="useLlmParse"]', root).value === "true";
      cfg.llmModel = $('[data-field="llmModel"]', root).value.trim();
      cfg.llmEndpoint = $('[data-field="llmEndpoint"]', root).value.trim();
      cfg.llmApiKey = $('[data-field="llmApiKey"]', root).value.trim();
    }
    function writeFields(voices) {
      $('[data-field="apiBase"]', root).value = cfg.apiBase;
      $('[data-field="mode"]', root).value = cfg.mode;
      $('[data-field="intervalMs"]', root).value = cfg.intervalMs;
      $('[data-field="roleVoicesText"]', root).value = cfg.roleVoicesText || "";
      $('[data-field="emotionText"]', root).value = cfg.emotionText || "";
      $('[data-field="useLlmParse"]', root).value = cfg.useLlmParse ? "true" : "false";
      $('[data-field="llmModel"]', root).value = cfg.llmModel || "";
      $('[data-field="llmEndpoint"]', root).value = cfg.llmEndpoint || "";
      $('[data-field="llmApiKey"]', root).value = cfg.llmApiKey || "";
      var select = $('[data-field="defaultVoice"]', root);
      var opts = ['<option value="">自动选择</option>'];
      voices.forEach(function (v) { opts.push('<option value="' + escapeHtml(v.name) + '">' + escapeHtml(v.name) + '</option>'); });
      select.innerHTML = opts.join("");
      select.value = cfg.defaultVoice || "";
      var shown = cfg.defaultVoice || (voices[0] && voices[0].name) || "自动";
      voicePill.textContent = "音色：" + shown;
    }
    async function refreshVoices() {
      setStatus("正在读取音色库...");
      var voices = await listVoices(cfg.apiBase);
      if (!cfg.defaultVoice && voices[0]) cfg.defaultVoice = voices[0].name;
      writeFields(voices);
      setStatus(voices.length ? "已读取 " + voices.length + " 个音色，点播放开始" : "未发现音色，请先把参考音频放入音色库");
    }
    async function generateAndPlay(force) {
      readFields();
      await saveConfig(cfg);
      setError("");
      if (!messageText) { setError("当前消息没有可朗读的正文。"); return; }
      if (audio.src && !force) {
        if (audio.paused) await audio.play(); else audio.pause();
        return;
      }
      setButton("loading");
      setStatus("正在生成音频...");
      try {
        var base = cfg.apiBase.replace(/\/+$/, "");
        var voices = await listVoices(base);
        if (!cfg.defaultVoice && voices[0]) cfg.defaultVoice = voices[0].name;
        if (!cfg.defaultVoice) throw new Error("没有可用音色。请先在服务端音色库添加参考音频。");
        var url, body;
        if (cfg.mode === "dialogue" || cfg.useLlmParse) {
          var segments = await buildSegments(messageText, cfg, setStatus);
          body = {
            segments: segments,
            voices: parseRoleVoices(cfg.roleVoicesText, cfg.defaultVoice),
            interval_ms: cfg.intervalMs,
            top_p: Number(cfg.topP), top_k: Number(cfg.topK), temperature: Number(cfg.temperature),
            repetition_penalty: Number(cfg.repetitionPenalty), emo_alpha: Number(cfg.emoAlpha)
          };
          url = base + cfg.dialogueEndpoint;
        } else {
          body = {
            text: messageText,
            ref_audio_path: cfg.defaultVoice,
            emo_text: cfg.emotionText,
            use_emo_text: true,
            top_p: Number(cfg.topP), top_k: Number(cfg.topK), temperature: Number(cfg.temperature),
            repetition_penalty: Number(cfg.repetitionPenalty), emo_alpha: Number(cfg.emoAlpha)
          };
          url = base + cfg.endpoint;
        }
        var res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
        if (!res.ok) throw new Error(await res.text());
        var blob = await res.blob();
        if (audio.src) URL.revokeObjectURL(audio.src);
        audio.src = URL.createObjectURL(blob);
        setStatus(res.headers.get("X-IndexTTS-Cache") === "HIT" ? "已读取缓存，开始播放" : "生成完成，开始播放");
        await audio.play();
      } catch (e) {
        setButton("idle");
        setStatus("生成失败");
        setError(e && e.message ? e.message : String(e));
      }
    }

    play.addEventListener("click", function () { generateAndPlay(false); });
    $('[data-role="regen"]', root).addEventListener("click", function () { generateAndPlay(true); });
    $('[data-role="stop"]', root).addEventListener("click", function () { audio.pause(); audio.currentTime = 0; });
    $('[data-role="save"]', root).addEventListener("click", async function () { readFields(); await saveConfig(cfg); voicePill.textContent = "音色：" + (cfg.defaultVoice || "自动"); setStatus("设置已保存"); });
    $('[data-role="reload-voices"]', root).addEventListener("click", refreshVoices);
    audio.addEventListener("play", function () { setButton("playing"); setStatus("正在播放"); });
    audio.addEventListener("pause", function () { setButton("idle"); if (audio.currentTime > 0 && !audio.ended) setStatus("已暂停"); });
    audio.addEventListener("ended", function () { setButton("idle"); setStatus("播放完成"); });
    audio.addEventListener("timeupdate", function () {
      cur.textContent = formatTime(audio.currentTime);
      total.textContent = audio.duration ? formatTime(audio.duration) : "--:--";
      fill.style.width = audio.duration ? Math.min(100, (audio.currentTime / audio.duration) * 100) + "%" : "0%";
    });

    refreshVoices();
  }

  try {
    ensureStyle();
    if (script && script.dataset.indexttsMounted === "1") return;
    if (script) script.dataset.indexttsMounted = "1";
    var text = await currentMessageText();
    var cfg = await getStoredConfig();
    var root = document.createElement("div");
    root.className = "idx-tts";
    root.setAttribute("data-indextts-widget", "1");
    if (script && script.parentNode) script.parentNode.insertBefore(root, script.nextSibling);
    else document.body.appendChild(root);
    mount(root, cfg, text);
  } catch (e) {
    try { console.error("[IndexTTS TAVO]", e); } catch (_) {}
  }
})();
