#!/usr/bin/env node
"use strict";

const os = require("os");
const path = require("path");
const { createRequire } = require("module");

function loadPlaywright() {
  try {
    return require("playwright");
  } catch (_) {
    const runnerDir = process.env.IDX_PLAYWRIGHT_RUNNER || path.join(os.tmpdir(), "idx-playwright-runner");
    try {
      return createRequire(path.join(runnerDir, "package.json"))("playwright");
    } catch (err) {
      throw new Error(
        "Playwright runner not found. Use the fixed temp runner only:\n"
        + "  $tmp = Join-Path $env:TEMP 'idx-playwright-runner'\n"
        + "  New-Item -ItemType Directory -Force -Path $tmp | Out-Null\n"
        + "  Push-Location $tmp; npm init -y; npm install playwright@1.60.0 --no-audit --no-fund; npx playwright install chromium; Pop-Location\n"
        + "Do not install Playwright or browsers under the repo."
      );
    }
  }
}

function wavBufferSeconds(seconds) {
  const sampleRate = 8000;
  const samples = Math.max(1, Math.floor(sampleRate * (Number(seconds) || 0.1)));
  const dataSize = samples * 2;
  const buf = Buffer.alloc(44 + dataSize);
  buf.write("RIFF", 0);
  buf.writeUInt32LE(36 + dataSize, 4);
  buf.write("WAVE", 8);
  buf.write("fmt ", 12);
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20);
  buf.writeUInt16LE(1, 22);
  buf.writeUInt32LE(sampleRate, 24);
  buf.writeUInt32LE(sampleRate * 2, 28);
  buf.writeUInt16LE(2, 32);
  buf.writeUInt16LE(16, 34);
  buf.write("data", 36);
  buf.writeUInt32LE(dataSize, 40);
  for (let i = 0; i < samples; i += 1) {
    const sample = Math.round(Math.sin((i / sampleRate) * Math.PI * 2 * 440) * 1600);
    buf.writeInt16LE(sample, 44 + i * 2);
  }
  return buf;
}

function pcmBufferSeconds(seconds) {
  return wavBufferSeconds(seconds).slice(44);
}

function tinyWavBuffer() {
  return wavBufferSeconds(0.1);
}

async function runLlmReuseSmoke(browser, targetUrl) {
  const context = await browser.newContext();
  await context.addInitScript(() => {
    try { localStorage.clear(); } catch (_) {}
    try { if (indexedDB) indexedDB.deleteDatabase("indextts_tavo_audio_v1"); } catch (_) {}
  });

  const page = await context.newPage();
  const pageErrors = [];
  page.on("pageerror", (err) => pageErrors.push(err.message || String(err)));
  page.on("console", (msg) => {
    const text = msg.text();
    if (msg.type() === "error" && !/favicon|net::ERR|连不上 IndexTTS 后端|status of 404/i.test(text)) pageErrors.push(text);
  });

  let parseCount = 0;
  let jobCount = 0;
  const jobBodies = [];
  const wav = tinyWavBuffer();
  await page.route("**/parse_text", async (route) => {
    parseCount += 1;
    await route.abort("failed");
  });
  await page.route("**/tts_dialogue_stream_job", async (route) => {
    jobCount += 1;
    try { jobBodies.push(JSON.parse(route.request().postData() || "{}")); } catch (_) { jobBodies.push({}); }
    const key = String(jobCount).padStart(40, "0");
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        url: "/tts_dialogue_stream_job/" + key,
        cache_url: "/cache_audio/" + key,
        cache_key: key,
        cached: true,
        live: false
      })
    });
  });
  await page.route("**/cache_audio/**", async (route) => {
    await route.fulfill({ status: 200, contentType: "audio/wav", body: wav });
  });
  await page.route("**/tts_dialogue_job_status/**", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        state: "done",
        cache_url: "/cache_audio/" + String(jobCount || 1).padStart(40, "0"),
        sample_rate: 8000,
        duration_s: 0.1,
        segments_meta: [
          { idx: 0, role: "旁白", text: "白夜雨抱着潘金莲，低声说。", style: "neutral", start_s: 0, start_offset_bytes: 0, duration_s: 0.04 },
          { idx: 1, role: "潘金莲", text: "我只是有点紧张。", style: "neutral", start_s: 0.04, start_offset_bytes: 640, duration_s: 0.04 },
          { idx: 2, role: "用户", text: "慢慢来。", style: "neutral", start_s: 0.08, start_offset_bytes: 1280, duration_s: 0.02 }
        ],
        metrics: { state: "done", phase: "done", message: "音频已保存", segments_total: 3, segments_done: 3 }
      })
    });
  });

  try {
    await page.goto(targetUrl, { waitUntil: "domcontentloaded" });
    await page.waitForSelector(".idx-lazy-card", { timeout: 10000 });
    await page.evaluate(() => {
      localStorage.setItem("indextts_tavo_config_v3", JSON.stringify({
        configVersion: 11,
        mode: "ai",
        playbackMode: "live",
        llmEndpoint: "http://127.0.0.1:8317/v1",
        llmModel: "reuse-smoke-model",
        llmApiKey: "",
        parseEndpoint: "/parse_text",
        reuseLlmParse: true,
        intervalMs: 50,
        topP: 0.8,
        topK: 30,
        temperature: 0.7,
        repetitionPenalty: 1.2,
        emoAlpha: 0.38,
        speedFactor: 1.0,
        qualityMode: "balanced",
        offlineAudioEnabled: false
      }));
      localStorage.setItem("indextts_tavo_character_v1:34", JSON.stringify({
        defaultVoice: "女声/高圆圆.wav",
        characterName: "潘金莲",
        roleVoiceList: [
          { role: "旁白", voice: "女声/高圆圆.wav" },
          { role: "用户", voice: "男声/旁白.mp3" },
          { role: "潘金莲", voice: "女声/风韵少妇.wav" }
        ]
      }));
    });
    await page.click('[data-role="lazy-open"]');
    await page.waitForSelector(".idx-card", { timeout: 10000 });
    await page.evaluate(() => {
      const add = document.querySelector('[data-role="add"]');
      if (!add) throw new Error("missing add button");
      add.click();
    });
    await page.waitForFunction(() => {
      return window.__idxTest.getFetchLog().filter((r) => /tts_dialogue_stream_job/.test(r.url)).length >= 1;
    }, { timeout: 10000 });
    await page.evaluate(() => {
      document.querySelectorAll(".idx-tts,.idx-card,.idx-panel,.idx-picker,[data-indextts-host]").forEach((node) => {
        if (node.parentNode) node.parentNode.removeChild(node);
      });
      const box = document.getElementById("indextts-debug-body");
      if (box && box.parentElement && box.parentElement.parentElement) box.parentElement.parentElement.removeChild(box.parentElement);
      const slot = document.getElementById("scriptSlot");
      if (!slot) throw new Error("missing scriptSlot");
      slot.innerHTML = "";
      const script = document.createElement("script");
      script.src = location.origin + "/static/tavo.js?v=" + Date.now() + "&ttsDebug=1";
      slot.appendChild(script);
    });
    await page.waitForSelector(".idx-lazy-card", { timeout: 10000 });
    await page.click('[data-role="lazy-open"]');
    await page.waitForSelector(".idx-card", { timeout: 10000 });
    await page.evaluate(() => document.querySelector('[data-role="add"]').click());
    await page.waitForFunction(() => {
      return window.__idxTest.getFetchLog().filter((r) => /tts_dialogue_stream_job/.test(r.url)).length >= 2;
    }, { timeout: 10000 });
    await page.waitForTimeout(300);

    const result = await page.evaluate(() => {
      const fetches = window.__idxTest.getFetchLog();
      return {
        parseFetches: fetches.filter((r) => /\/parse_text(?:[?#]|$)/.test(r.url)).length,
        jobs: fetches.filter((r) => /\/tts_dialogue_stream_job(?:[?#]|$)/.test(r.url)).length,
        reuseToggle: !!document.querySelector('[data-field="reuseLlmParse"]'),
        status: (document.querySelector('[data-role="status"]') || {}).textContent || ""
      };
    });

    if (parseCount !== 0 || result.parseFetches !== 0) {
      throw new Error("frontend must not call /parse_text before job creation, parseCount=" + parseCount + " result=" + JSON.stringify(result));
    }
    if (jobCount !== 2 || result.jobs !== 2) {
      throw new Error("backend-owned parse smoke should submit two mocked dialogue jobs, jobCount=" + jobCount + " result=" + JSON.stringify(result));
    }
    if (!result.reuseToggle) throw new Error("reuseLlmParse setting toggle is missing");
    for (const body of jobBodies) {
      if (!body || typeof body.text !== "string" || !body.text.includes("潘金莲")) throw new Error("dialogue job body should include original text: " + JSON.stringify(body));
      if (body.parse_mode !== "ai") throw new Error("AI mode should submit parse_mode=ai: " + JSON.stringify(body));
      if (Array.isArray(body.segments)) throw new Error("frontend should not submit pre-parsed segments in AI path: " + JSON.stringify(body));
      if (!body.voices || body.voices["旁白"] !== "女声/高圆圆.wav" || body.voices["用户"] !== "男声/旁白.mp3" || body.voices["潘金莲"] !== "女声/风韵少妇.wav") {
        throw new Error("dialogue job body should include role voice map: " + JSON.stringify(body));
      }
      if (body.llm_endpoint !== "http://127.0.0.1:8317/v1" || body.llm_model !== "reuse-smoke-model") {
        throw new Error("dialogue job body should include LLM endpoint/model: " + JSON.stringify(body));
      }
      if (body.reuse_llm_parse !== true) throw new Error("dialogue job body should pass reuse_llm_parse=true: " + JSON.stringify(body));
      if (body.user_name !== "白夜雨" || body.character_name !== "潘金莲") {
        throw new Error("dialogue job body should include Tavo user/character context: " + JSON.stringify(body));
      }
    }
    if (pageErrors.length) throw new Error("LLM reuse smoke page error: " + pageErrors.join(" | "));

    return { parseCount, jobCount, result, firstJobBody: jobBodies[0] };
  } finally {
    await context.close();
  }
}

async function runLlmErrorCopySmoke(browser, targetUrl) {
  const context = await browser.newContext();
  await context.addInitScript(() => {
    try { localStorage.clear(); } catch (_) {}
    try { if (indexedDB) indexedDB.deleteDatabase("indextts_tavo_audio_v1"); } catch (_) {}
    window.__cachePlayCalls = [];
    try {
      const originalPlay = HTMLMediaElement.prototype.play;
      HTMLMediaElement.prototype.play = function () {
        try {
          window.__cachePlayCalls.push({
            src: this.currentSrc || this.src || "",
            kind: this.dataset ? (this.dataset.idxSourceKind || "") : ""
          });
        } catch (_) {}
        try {
          this.dispatchEvent(new Event("play"));
          this.dispatchEvent(new Event("playing"));
        } catch (_) {}
        if (originalPlay && this.dataset && this.dataset.idxSourceKind !== "saved") {
          try { return originalPlay.apply(this, arguments); } catch (_) {}
        }
        return Promise.resolve();
      };
    } catch (_) {}
  });

  const page = await context.newPage();
  const pageErrors = [];
  page.on("pageerror", (err) => pageErrors.push(err.message || String(err)));
  page.on("console", (msg) => {
    const text = msg.text();
    if (msg.type() === "error" && !/favicon|net::ERR|连不上 IndexTTS 后端|服务端任务失败|后端 LLM 拆段失败|生成失败|status of 404/i.test(text)) pageErrors.push(text);
  });

  let parseCount = 0;
  let jobCount = 0;
  let statusCount = 0;
  const errorKey = "f".repeat(40);
  await page.route("**/parse_text", async (route) => {
    parseCount += 1;
    await route.abort("failed");
  });
  await page.route("**/tts_dialogue_stream_job", async (route) => {
    jobCount += 1;
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        url: "/tts_dialogue_stream_job/error-copy-job",
        cache_url: "/cache_audio/" + errorKey,
        cache_key: errorKey,
        cached: false,
        live: true
      })
    });
  });
  await page.route("**/tts_dialogue_stream_job/**", async (route) => {
    await route.fulfill({ status: 200, contentType: "audio/wav", body: tinyWavBuffer() });
  });
  await page.route("**/tts_dialogue_job_status/**", async (route) => {
    statusCount += 1;
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        state: "failed",
        cache_key: errorKey,
        error: "LLM 连接失败: connect ECONNREFUSED 127.0.0.1:8317",
        metrics: {
          state: "failed",
          phase: "llm_parse_failed",
          message: "后端 LLM 拆段失败"
        }
      })
    });
  });

  try {
    await page.goto(targetUrl, { waitUntil: "domcontentloaded" });
    await page.waitForSelector(".idx-lazy-card", { timeout: 10000 });
    await page.evaluate(() => {
      localStorage.setItem("indextts_tavo_config_v3", JSON.stringify({
        configVersion: 11,
        mode: "ai",
        playbackMode: "live",
        llmEndpoint: "http://127.0.0.1:8317/v1",
        llmModel: "error-copy-model",
        llmApiKey: "",
        parseEndpoint: "/parse_text",
        reuseLlmParse: false,
        intervalMs: 50,
        topP: 0.8,
        topK: 30,
        temperature: 0.7,
        repetitionPenalty: 1.2,
        emoAlpha: 0.38,
        speedFactor: 1.0,
        qualityMode: "balanced",
        offlineAudioEnabled: false
      }));
      localStorage.setItem("indextts_tavo_character_v1:34", JSON.stringify({
        defaultVoice: "女声/高圆圆.wav",
        characterName: "潘金莲",
        roleVoiceList: [
          { role: "旁白", voice: "女声/高圆圆.wav" },
          { role: "用户", voice: "男声/旁白.mp3" },
          { role: "潘金莲", voice: "女声/风韵少妇.wav" }
        ]
      }));
    });
    await page.click('[data-role="lazy-open"]');
    await page.waitForSelector(".idx-card", { timeout: 10000 });
    await page.evaluate(() => {
      const add = document.querySelector('[data-role="add"]');
      if (!add) throw new Error("missing add button");
      add.click();
    });
    await page.waitForFunction(() => {
      const sub = document.querySelector(".idx-subtitle");
      return sub && /后端 LLM 拆段失败/.test(sub.textContent || "");
    }, { timeout: 10000 });

    const result = await page.evaluate(() => {
      const text = (document.querySelector(".idx-subtitle") || {}).textContent || "";
      const play = document.querySelector('[data-role="play"]');
      const liveExit = document.querySelector('[data-role="live-exit"]');
      const fetches = window.__idxTest.getFetchLog();
      return {
        parseFetches: fetches.filter((r) => /\/parse_text(?:[?#]|$)/.test(r.url)).length,
        jobs: fetches.filter((r) => /\/tts_dialogue_stream_job(?:[?#]|$)/.test(r.url)).length,
        statuses: fetches.filter((r) => /\/tts_dialogue_job_status\//.test(r.url)).length,
        playDisabled: !!(play && play.disabled),
        liveExitHidden: !!(liveExit && liveExit.classList.contains("idx-hidden")),
        text
      };
    });

    if (parseCount !== 0 || result.parseFetches !== 0) {
      throw new Error("backend-owned LLM failure smoke must not hit /parse_text, parseCount=" + parseCount + " result=" + JSON.stringify(result));
    }
    if (jobCount !== 1 || result.jobs !== 1 || statusCount < 1 || result.statuses < 1) {
      throw new Error("backend-owned LLM failure smoke should create a job then poll status: " + JSON.stringify({ jobCount, statusCount, result }));
    }
    if (!/后端 LLM 拆段失败/.test(result.text) || !/LLM 连接失败/.test(result.text)) {
      throw new Error("backend-owned LLM failure did not surface backend status/error clearly: " + result.text);
    }
    if (!result.playDisabled || !result.liveExitHidden) {
      throw new Error("failed live card should disable play and hide live-exit: " + JSON.stringify(result));
    }
    await page.evaluate(() => {
      const play = document.querySelector('[data-role="play"]');
      if (play) play.click();
    });
    await page.waitForTimeout(200);
    const afterFailedClick = await page.evaluate(() => {
      const sub = (document.querySelector(".idx-subtitle") || {}).textContent || "";
      const status = (document.querySelector('[data-role="status"]') || {}).textContent || "";
      const fetches = window.__idxTest.getFetchLog();
      return {
        sub,
        status,
        jobs: fetches.filter((r) => /\/tts_dialogue_stream_job(?:[?#]|$)/.test(r.url)).length,
        statuses: fetches.filter((r) => /\/tts_dialogue_job_status\//.test(r.url)).length
      };
    });
    if (/AI模式正在生成|连接实时音频|等待首段音频/.test(afterFailedClick.sub + afterFailedClick.status) || afterFailedClick.jobs !== 1) {
      throw new Error("failed live card play click should stay terminal: " + JSON.stringify(afterFailedClick));
    }
    if (pageErrors.length) throw new Error("LLM error copy smoke page error: " + pageErrors.join(" | "));
    return { parseCount, jobCount, statusCount, result, afterFailedClick };
  } finally {
    await context.close();
  }
}

async function runNormalGenerateCancelSmoke(browser, targetUrl) {
  const context = await browser.newContext();
  await context.addInitScript(() => {
    try { localStorage.clear(); } catch (_) {}
    try { if (indexedDB) indexedDB.deleteDatabase("indextts_tavo_audio_v1"); } catch (_) {}
  });

  const page = await context.newPage();
  const pageErrors = [];
  page.on("pageerror", (err) => pageErrors.push(err.message || String(err)));
  page.on("console", (msg) => {
    const text = msg.text();
    if (msg.type() === "error" && !/favicon|net::ERR|连不上 IndexTTS 后端|任务已取消|生成被中断|status of 404/i.test(text)) pageErrors.push(text);
  });

  const pendingKey = "b".repeat(40);
  let parseCount = 0;
  let jobCount = 0;
  let statusCount = 0;
  let streamGetCount = 0;
  let deleteCount = 0;
  const jobBodies = [];

  await page.route("**/parse_text", async (route) => {
    parseCount += 1;
    await route.abort("failed");
  });
  await page.route("**/tts_dialogue_stream_job", async (route) => {
    jobCount += 1;
    try { jobBodies.push(JSON.parse(route.request().postData() || "{}")); } catch (_) { jobBodies.push({}); }
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        url: "/tts_dialogue_stream_job/" + pendingKey,
        cache_url: "/cache_audio/" + pendingKey,
        cache_key: pendingKey,
        cached: false,
        live: true
      })
    });
  });
  await page.route("**/tts_dialogue_stream_job/**", async (route) => {
    const method = route.request().method().toUpperCase();
    if (method === "DELETE") {
      deleteCount += 1;
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ cancelled_live: true, deleted: false, cache_key: pendingKey })
      });
      return;
    }
    streamGetCount += 1;
    await route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ message: "generate mode should not open stream" }) });
  });
  await page.route("**/cache/**", async (route) => {
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ deleted: false }) });
  });
  await page.route("**/cache_audio/**", async (route) => {
    await route.fulfill({ status: 404, contentType: "text/plain", body: "" });
  });
  await page.route("**/tts_dialogue_job_status/**", async (route) => {
    statusCount += 1;
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        state: "running",
        cache_key: pendingKey,
        metrics: {
          state: "running",
          phase: "tts",
          message: "后端正在合成…"
        }
      })
    });
  });

  try {
    await page.goto(targetUrl, { waitUntil: "domcontentloaded" });
    await page.waitForSelector(".idx-lazy-card", { timeout: 10000 });
    await page.evaluate(() => {
      localStorage.setItem("indextts_tavo_config_v3", JSON.stringify({
        configVersion: 11,
        mode: "normal",
        playbackMode: "live",
        llmEndpoint: "http://127.0.0.1:8317/v1",
        llmModel: "normal-generate-smoke-model",
        llmApiKey: "",
        reuseLlmParse: true,
        intervalMs: 50,
        topP: 0.8,
        topK: 30,
        temperature: 0.7,
        repetitionPenalty: 1.2,
        emoAlpha: 0.38,
        speedFactor: 1.0,
        qualityMode: "balanced",
        offlineAudioEnabled: false
      }));
      localStorage.setItem("indextts_tavo_character_v1:34", JSON.stringify({
        defaultVoice: "女声/高圆圆.wav",
        characterName: "潘金莲",
        roleVoiceList: []
      }));
    });
    await page.click('[data-role="lazy-open"]');
    await page.waitForSelector(".idx-card", { timeout: 10000 });
    await page.waitForSelector('[data-role="playback-mode-toggle"]', { timeout: 5000 });
    await page.click('[data-role="playback-mode-toggle"]');
    await page.waitForFunction(() => {
      const b = document.querySelector('[data-role="playback-mode-toggle"]');
      return b && (b.textContent || "").trim() === "D" && b.dataset.mode === "generate";
    }, { timeout: 5000 });
    await page.evaluate(() => {
      const add = document.querySelector('[data-role="add"]');
      if (!add) throw new Error("missing add button");
      add.click();
    });
    await page.waitForFunction(() => {
      const fetches = window.__idxTest.getFetchLog();
      return fetches.filter((r) => /\/tts_dialogue_stream_job(?:[?#]|$)/.test(r.url)).length >= 1
        && fetches.filter((r) => /\/tts_dialogue_job_status\//.test(r.url)).length >= 1;
    }, { timeout: 10000 });
    await page.evaluate(() => {
      const btn = document.querySelector('[data-role="delete"]');
      if (!btn) throw new Error("missing delete button");
      btn.click();
    });
    await page.waitForFunction(() => {
      const fetches = window.__idxTest.getFetchLog();
      return fetches.some((r) => r.method === "DELETE" && /\/tts_dialogue_stream_job\//.test(r.url));
    }, { timeout: 10000 });
    await page.waitForTimeout(200);

    const result = await page.evaluate(() => {
      const fetches = window.__idxTest.getFetchLog();
      const status = (document.querySelector('[data-role="status"]') || {}).textContent || "";
      const notice = (document.querySelector(".idx-subtitle") || {}).textContent || "";
      const bucket = window.__idxTest.storageBucket();
      return {
        parseFetches: fetches.filter((r) => /\/parse_text(?:[?#]|$)/.test(r.url)).length,
        jobs: fetches.filter((r) => r.method === "POST" && /\/tts_dialogue_stream_job(?:[?#]|$)/.test(r.url)).length,
        streamGets: fetches.filter((r) => r.method === "GET" && /\/tts_dialogue_stream_job\//.test(r.url)).length,
        statuses: fetches.filter((r) => /\/tts_dialogue_job_status\//.test(r.url)).length,
        deletes: fetches.filter((r) => r.method === "DELETE" && /\/tts_dialogue_stream_job\//.test(r.url)).length,
        toggleText: (document.querySelector('[data-role="playback-mode-toggle"]') || {}).textContent || "",
        status,
        notice,
        pendingActive: Object.entries(bucket)
          .filter(([k]) => /indextts_pending_jobs_/.test(k))
          .flatMap(([, v]) => Array.isArray(v) ? v : [])
          .filter((x) => x && x.cacheKey).length
      };
    });

    if (parseCount !== 0 || result.parseFetches !== 0) {
      throw new Error("normal generate smoke must not hit /parse_text: " + JSON.stringify({ parseCount, result }));
    }
    if (jobCount !== 1 || result.jobs !== 1) {
      throw new Error("normal generate smoke should create exactly one dialogue job: " + JSON.stringify({ jobCount, result }));
    }
    if (statusCount < 1 || result.statuses < 1) {
      throw new Error("generate mode should poll job status: " + JSON.stringify({ statusCount, result }));
    }
    if (streamGetCount !== 0 || result.streamGets !== 0) {
      throw new Error("generate mode should not open the live stream: " + JSON.stringify({ streamGetCount, result }));
    }
    if (deleteCount < 1 || result.deletes < 1) {
      throw new Error("deleting pending generate job should call DELETE: " + JSON.stringify({ deleteCount, result }));
    }
    const body = jobBodies[0] || {};
    if (body.parse_mode !== "normal") throw new Error("normal mode should submit parse_mode=normal: " + JSON.stringify(body));
    if (body.llm_endpoint || body.llm_model || body.llm_api_key) throw new Error("normal mode should not submit LLM config: " + JSON.stringify(body));
    if (!body.voices || body.voices.default !== "女声/高圆圆.wav" || body.voices["旁白"] !== "女声/高圆圆.wav") {
      throw new Error("normal mode should map default/旁白 to the narrator voice: " + JSON.stringify(body));
    }
    if (Object.prototype.hasOwnProperty.call(body.voices || {}, "对白")) {
      throw new Error("blank normal dialogue voice should be omitted so backend inherits narrator: " + JSON.stringify(body));
    }
    if (result.pendingActive) throw new Error("pending job storage should be cleared after delete: " + JSON.stringify(result));
    if (result.toggleText.trim() !== "D") throw new Error("generate/落盘 mode should display the single-letter D button: " + JSON.stringify(result));
    if (pageErrors.length) throw new Error("normal generate smoke page error: " + pageErrors.join(" | "));
    return { parseCount, jobCount, statusCount, streamGetCount, deleteCount, result, body };
  } finally {
    await context.close();
  }
}

async function runNormalExplicitDialogueMappingSmoke(browser, targetUrl) {
  const context = await browser.newContext();
  await context.addInitScript(() => {
    try { localStorage.clear(); } catch (_) {}
    try { if (indexedDB) indexedDB.deleteDatabase("indextts_tavo_audio_v1"); } catch (_) {}
  });

  const page = await context.newPage();
  const pageErrors = [];
  page.on("pageerror", (err) => pageErrors.push(err.message || String(err)));
  page.on("console", (msg) => {
    const text = msg.text();
    if (msg.type() === "error" && !/favicon|net::ERR|连不上 IndexTTS 后端|status of 404/i.test(text)) pageErrors.push(text);
  });

  const explicitKey = "e".repeat(40);
  let jobCount = 0;
  const jobBodies = [];
  const wav = tinyWavBuffer();

  await page.route("**/tts_dialogue_stream_job", async (route) => {
    jobCount += 1;
    try { jobBodies.push(JSON.parse(route.request().postData() || "{}")); } catch (_) { jobBodies.push({}); }
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        url: "/tts_dialogue_stream_job/" + explicitKey,
        cache_url: "/cache_audio/" + explicitKey,
        cache_key: explicitKey,
        cached: true,
        live: false
      })
    });
  });
  await page.route("**/cache_audio/**", async (route) => {
    await route.fulfill({ status: 200, contentType: "audio/wav", body: wav });
  });
  await page.route("**/tts_dialogue_job_status/**", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        state: "done",
        cache_key: explicitKey,
        cache_url: "/cache_audio/" + explicitKey,
        sample_rate: 8000,
        duration_s: 0.1,
        segments_meta: [
          { idx: 0, role: "旁白", text: "潘金莲停了一下。", start_s: 0, duration_s: 0.05 },
          { idx: 1, role: "对白", text: "我在这里。", start_s: 0.05, duration_s: 0.05 }
        ],
        metrics: { state: "done", phase: "done", message: "音频已保存", segments_total: 2, segments_done: 2 }
      })
    });
  });

  try {
    await page.goto(targetUrl, { waitUntil: "domcontentloaded" });
    await page.waitForSelector(".idx-lazy-card", { timeout: 10000 });
    await page.evaluate(() => {
      const dirtyText = [
        "潘金莲停了一下。「我在这里。」",
        "<think>不要朗读这段推理</think>",
        "<div class=\"idx-ui\">UI按钮文字不要读</div>",
        "&lt;style&gt;坏样式不要读&lt;/style&gt;",
        "🙂"
      ].join("\n");
      const textarea = document.getElementById("messageText");
      if (textarea) textarea.value = dirtyText;
      const preview = document.getElementById("messagePreview");
      if (preview) preview.innerHTML = dirtyText;
      localStorage.setItem("indextts_tavo_config_v3", JSON.stringify({
        configVersion: 13,
        mode: "normal",
        playbackMode: "live",
        intervalMs: 50,
        topP: 0.8,
        topK: 30,
        temperature: 0.7,
        repetitionPenalty: 1.2,
        emoAlpha: 0.38,
        speedFactor: 1.0,
        qualityMode: "custom",
        diffusionSteps: 16,
        promptAudioSeconds: 12,
        segmentTokens: 72,
        firstTokens: 24,
        s2melCfgRate: 0.7,
        subtitleLeadSec: 0.25,
        offlineAudioEnabled: false
      }));
      localStorage.setItem("indextts_tavo_character_v1:34", JSON.stringify({
        defaultVoice: "女声/高圆圆.wav",
        characterName: "潘金莲",
        roleVoiceList: [
          { role: "dialogue", voice: "" },
          { role: "对话", voice: "女声/单独对白.wav" },
          { role: "对白", voice: "" }
        ]
      }));
    });
    await page.click('[data-role="lazy-open"]');
    await page.waitForSelector(".idx-card", { timeout: 10000 });
    await page.evaluate(() => {
      const add = document.querySelector('[data-role="add"]');
      if (!add) throw new Error("missing add button");
      add.click();
    });
    await page.waitForFunction(() => {
      return window.__idxTest.getFetchLog().filter((r) => /tts_dialogue_stream_job/.test(r.url)).length >= 1;
    }, { timeout: 10000 });
    await page.waitForTimeout(250);

    const body = jobBodies[0] || {};
    if (jobCount !== 1) throw new Error("explicit normal dialogue smoke should create one job: " + JSON.stringify({ jobCount, body }));
    if (body.parse_mode !== "normal") throw new Error("explicit dialogue mapping should stay in normal mode: " + JSON.stringify(body));
    if (!body.voices || body.voices.default !== "女声/高圆圆.wav" || body.voices["旁白"] !== "女声/高圆圆.wav") {
      throw new Error("normal explicit mapping should keep narrator/default voice: " + JSON.stringify(body));
    }
    if (body.voices["对白"] !== "女声/单独对白.wav" || body.voices["对话"] !== "女声/单独对白.wav" || body.voices["台词"] !== "女声/单独对白.wav" || body.voices.dialogue !== "女声/单独对白.wav") {
      throw new Error("normal explicit dialogue voice should be submitted under all dialogue aliases: " + JSON.stringify(body));
    }
    if (!body.text || !/潘金莲停了一下/.test(body.text) || !/我在这里/.test(body.text)) {
      throw new Error("cleaned normal text should keep readable story/dialogue text: " + JSON.stringify(body));
    }
    if (/不要朗读|UI按钮文字|坏样式|[<>]|🙂/.test(body.text)) {
      throw new Error("cleaned normal text leaked tag/internal/emoji content: " + JSON.stringify(body));
    }
    if (/assistant message mock|IndexTTS Tavo 测试页|用户身份名|角色名/.test(body.text)) {
      throw new Error("message text should prefer Tavo API content over DOM chrome: " + JSON.stringify(body));
    }
    if (body.diffusion_steps !== 16 || body.prompt_audio_seconds !== 12 || body.segment_tokens !== 72 || body.first_tokens !== 24 || body.s2mel_cfg_rate !== 0.7) {
      throw new Error("custom generation params should be submitted unchanged: " + JSON.stringify(body));
    }
    if (pageErrors.length) throw new Error("normal explicit dialogue smoke page error: " + pageErrors.join(" | "));
    return { jobCount, body };
  } finally {
    await context.close();
  }
}

async function runLivePlayClickSmoke(browser, targetUrl) {
  const context = await browser.newContext();
  await context.addInitScript(() => {
    try { localStorage.clear(); } catch (_) {}
    try { if (indexedDB) indexedDB.deleteDatabase("indextts_tavo_audio_v1"); } catch (_) {}
  });

  const page = await context.newPage();
  const pageErrors = [];
  page.on("pageerror", (err) => pageErrors.push(err.message || String(err)));
  page.on("console", (msg) => {
    const text = msg.text();
    if (msg.type() === "error" && !/favicon|net::ERR|连不上 IndexTTS 后端|status of 404/i.test(text)) pageErrors.push(text);
  });

  const liveKey = "c".repeat(40);
  let jobCount = 0;
  let headCount = 0;
  let cacheGetCount = 0;
  let statusCount = 0;
  let streamGetCount = 0;
  const streamUrls = [];
  const jobBodies = [];
  const pcm = pcmBufferSeconds(2.4);
  const cachedWav = wavBufferSeconds(2.4);

  await page.route("**/cache_audio/**", async (route) => {
    const method = route.request().method().toUpperCase();
    if (method === "HEAD") headCount += 1;
    else cacheGetCount += 1;
    const ready = statusCount >= 4 && streamGetCount >= 2;
    if (ready) {
      await route.fulfill({ status: 200, contentType: method === "HEAD" ? "text/plain" : "audio/wav", body: method === "HEAD" ? "" : cachedWav });
      return;
    }
    await route.fulfill({ status: 404, contentType: "text/plain", body: "" });
  });
  await page.route("**/tts_dialogue_job_status/**", async (route) => {
    statusCount += 1;
    const done = statusCount >= 4 && streamGetCount >= 2;
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        state: done ? "done" : "running",
        cache_key: liveKey,
        cache_url: "/cache_audio/" + liveKey,
        sample_rate: 8000,
        duration_s: 2.4,
        metrics: {
          state: done ? "done" : "running",
          phase: done ? "done" : "tts",
          message: done ? "音频已保存" : "后端正在合成…",
          segments_done: done ? 3 : 1,
          segments_total: 3
        },
        segments_meta: [
          { idx: 0, role: "旁白", text: "第一段正在合成。", style: "neutral", start_s: 0, duration_s: 0.4 },
          ...(done ? [
            { idx: 1, role: "对白", text: "第二段计划歌词。", style: "neutral", start_s: 0.4, duration_s: 0.6 },
            { idx: 2, role: "旁白", text: "第三段计划歌词。", style: "neutral", start_s: 1.0, duration_s: 0.6 }
          ] : [])
        ],
        segments_plan: [
          { idx: 0, role: "旁白", text: "第一段正在合成。", style: "neutral" },
          { idx: 1, role: "对白", text: "第二段计划歌词。", style: "neutral" },
          { idx: 2, role: "旁白", text: "第三段计划歌词。", style: "neutral" }
        ]
      })
    });
  });
  await page.route(/\/tts_dialogue_stream_job(?:\/[^/?#]+(?:\/pcm)?)?(?:[?#].*)?$/, async (route) => {
    const req = route.request();
    const method = req.method().toUpperCase();
    const pathname = new URL(req.url()).pathname;
    if (method === "POST" && /\/tts_dialogue_stream_job\/?$/.test(pathname)) {
      jobCount += 1;
      try { jobBodies.push(JSON.parse(req.postData() || "{}")); } catch (_) { jobBodies.push({}); }
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          url: "/tts_dialogue_stream_job/" + liveKey,
          cache_url: "/cache_audio/" + liveKey,
          cache_key: liveKey,
          cached: false,
          live: true
        })
      });
      return;
    }
    if (method === "GET" && pathname.indexOf("/tts_dialogue_stream_job/") >= 0) {
      streamGetCount += 1;
      streamUrls.push(req.url());
      if (streamGetCount === 1) {
        await route.abort("failed");
        return;
      }
      if (/\/pcm$/.test(pathname)) {
        await route.fulfill({
          status: 200,
          contentType: "application/octet-stream",
          headers: {
            "X-IndexTTS-Cache-Key": liveKey,
            "X-IndexTTS-Sample-Rate": "8000",
            "X-IndexTTS-PCM-Offset": "0",
            "X-IndexTTS-PCM-Next-Offset": String(pcm.length),
            "X-IndexTTS-PCM-Total": String(pcm.length),
            "X-IndexTTS-Live-Done": "1",
            "X-IndexTTS-Live-State": "done",
            "Access-Control-Expose-Headers": "X-IndexTTS-Cache-Key,X-IndexTTS-Sample-Rate,X-IndexTTS-PCM-Offset,X-IndexTTS-PCM-Next-Offset,X-IndexTTS-PCM-Total,X-IndexTTS-Live-Done,X-IndexTTS-Live-State"
          },
          body: pcm
        });
        return;
      }
      await route.fulfill({ status: 404, contentType: "application/json", body: JSON.stringify({ message: "chunked wav fallback not used in PCM smoke" }) });
      return;
    }
    await route.fulfill({ status: 405, contentType: "application/json", body: JSON.stringify({ message: "unexpected live smoke method" }) });
  });

  try {
    await page.goto(targetUrl, { waitUntil: "domcontentloaded" });
    await page.waitForSelector(".idx-lazy-card", { timeout: 10000 });
    await page.evaluate(() => {
      localStorage.setItem("indextts_tavo_config_v3", JSON.stringify({
        configVersion: 11,
        mode: "normal",
        playbackMode: "live",
        llmEndpoint: "http://127.0.0.1:8317/v1",
        llmModel: "live-play-smoke-model",
        llmApiKey: "",
        reuseLlmParse: true,
        intervalMs: 50,
        topP: 0.8,
        topK: 30,
        temperature: 0.7,
        repetitionPenalty: 1.2,
        emoAlpha: 0.38,
        speedFactor: 1.0,
        qualityMode: "balanced",
        offlineAudioEnabled: false
      }));
      localStorage.setItem("indextts_tavo_character_v1:34", JSON.stringify({
        defaultVoice: "女声/高圆圆.wav",
        characterName: "潘金莲",
        roleVoiceList: []
      }));
    });

    await page.click('[data-role="lazy-open"]');
    await page.waitForSelector(".idx-card", { timeout: 10000 });
    await page.evaluate(() => {
      window.__idxProgressSnapshots = [];
      const capture = () => {
        const progress = document.querySelector('[data-role="progress"]');
        const status = document.querySelector('[data-role="status"]');
        const subtitle = document.querySelector(".idx-subtitle");
        window.__idxProgressSnapshots.push({
          progressText: progress ? progress.textContent || "" : "",
          progressParentClass: progress && progress.parentElement ? progress.parentElement.className : "",
          progressInSubtitle: !!(progress && progress.closest(".idx-subtitle")),
          status: status ? status.textContent || "" : "",
          notice: subtitle ? subtitle.textContent || "" : ""
        });
        if (window.__idxProgressSnapshots.length > 60) window.__idxProgressSnapshots.shift();
      };
      const observer = new MutationObserver(capture);
      observer.observe(document.body, { childList: true, subtree: true, characterData: true, attributes: true });
      window.__idxProgressObserver = observer;
      capture();
    });
    const normalControlLayout = await page.evaluate(() => {
      const rectFor = (sel) => {
        const el = document.querySelector(sel);
        if (!el) return null;
        const r = el.getBoundingClientRect();
        return { left: r.left, top: r.top, width: r.width, height: r.height };
      };
      return {
        playRect: rectFor('[data-role="play"]'),
        addRect: rectFor('[data-role="add"]')
      };
    });
    await page.evaluate(() => {
      const add = document.querySelector('[data-role="add"]');
      if (!add) throw new Error("missing add button");
      add.click();
    });
    await page.waitForFunction(() => {
      const fetches = window.__idxTest.getFetchLog();
      return fetches.filter((r) => r.method === "POST" && /\/tts_dialogue_stream_job(?:[?#]|$)/.test(r.url)).length === 1
        && fetches.filter((r) => r.method === "GET" && /\/tts_dialogue_stream_job\//.test(r.url)).length >= 2;
    }, { timeout: 10000 });
    await page.waitForFunction(() => {
      const curText = (document.querySelector('[data-role="current"]') || {}).textContent || "00:00";
      const parts = curText.split(":").map((x) => Number(x) || 0);
      const sec = parts.length >= 2 ? parts[0] * 60 + parts[1] : 0;
      const subtitleText = (document.querySelector(".idx-subtitle") || {}).textContent || "";
      return sec >= 1 && /第二段计划歌词/.test(subtitleText);
    }, { timeout: 6000 });
    await page.waitForTimeout(250);

    const result = await page.evaluate(() => {
      const fetches = window.__idxTest.getFetchLog();
      const play = document.querySelector('[data-role="play"]');
      const status = (document.querySelector('[data-role="status"]') || {}).textContent || "";
      const notice = (document.querySelector(".idx-subtitle") || {}).textContent || "";
      const progress = document.querySelector('[data-role="progress"]');
      const subtitle = document.querySelector(".idx-subtitle");
      const curText = (document.querySelector('[data-role="current"]') || {}).textContent || "";
      const totalText = (document.querySelector('[data-role="total"]') || {}).textContent || "";
      const seek = document.querySelector('[data-role="seek"]');
      const audio = document.querySelector('[data-role="audio"]');
      const prev = document.querySelector('[data-role="prev"]');
      const next = document.querySelector('[data-role="next"]');
      const add = document.querySelector('[data-role="add"]');
      const liveExit = document.querySelector('[data-role="live-exit"]');
      const progressStyle = progress ? getComputedStyle(progress) : null;
      const rectFor = (el) => {
        if (!el) return null;
        const r = el.getBoundingClientRect();
        return { left: r.left, top: r.top, width: r.width, height: r.height };
      };
      return {
        playState: play ? play.dataset.state : "",
        status,
        notice,
        progressText: progress ? progress.textContent || "" : "",
        progressParentClass: progress && progress.parentElement ? progress.parentElement.className : "",
        progressInSubtitle: !!(progress && progress.closest(".idx-subtitle")),
        progressPosition: progressStyle ? progressStyle.position : "",
        progressBottom: progressStyle ? progressStyle.bottom : "",
        progressTop: progressStyle ? progressStyle.top : "",
        progressTextAlign: progressStyle ? progressStyle.textAlign : "",
        progressBackgroundColor: progressStyle ? progressStyle.backgroundColor : "",
        progressHeight: progress ? progress.getBoundingClientRect().height : 0,
        progressWhiteSpace: progressStyle ? progressStyle.whiteSpace : "",
        progressRect: progress ? {
          left: progress.getBoundingClientRect().left,
          top: progress.getBoundingClientRect().top,
          right: progress.getBoundingClientRect().right,
          bottom: progress.getBoundingClientRect().bottom,
          width: progress.getBoundingClientRect().width,
          height: progress.getBoundingClientRect().height
        } : null,
        subtitleRect: subtitle ? {
          left: subtitle.getBoundingClientRect().left,
          top: subtitle.getBoundingClientRect().top,
          right: subtitle.getBoundingClientRect().right,
          bottom: subtitle.getBoundingClientRect().bottom,
          width: subtitle.getBoundingClientRect().width,
          height: subtitle.getBoundingClientRect().height
        } : null,
        curText,
        totalText,
        seekValue: seek ? seek.value : "",
        counterText: (document.querySelector('[data-role="counter"]') || {}).textContent || "",
        audioKind: audio && audio.dataset ? audio.dataset.idxSourceKind || "" : "",
        audioCacheKey: audio && audio.dataset ? audio.dataset.idxCacheKey || "" : "",
        jobs: fetches.filter((r) => r.method === "POST" && /\/tts_dialogue_stream_job(?:[?#]|$)/.test(r.url)).length,
        cacheChecks: fetches.filter((r) => /\/cache_audio\//.test(r.url)).length,
        cacheGets: fetches.filter((r) => r.method !== "HEAD" && /\/cache_audio\//.test(r.url)).length,
        statuses: fetches.filter((r) => /\/tts_dialogue_job_status\//.test(r.url)).length,
        streamGets: fetches.filter((r) => r.method === "GET" && /\/tts_dialogue_stream_job\//.test(r.url)).length,
        liveExitVisible: liveExit ? getComputedStyle(liveExit).display !== "none" : false,
        playRect: rectFor(play),
        liveExitRect: rectFor(liveExit),
        prevVisibility: prev ? getComputedStyle(prev).visibility : "",
        nextVisibility: next ? getComputedStyle(next).visibility : "",
        addDisplay: add ? getComputedStyle(add).display : "",
        progressSnapshots: Array.isArray(window.__idxProgressSnapshots) ? window.__idxProgressSnapshots.slice() : [],
        cachePlays: (window.__cachePlayCalls || []).filter((x) => x && x.kind === "saved").length,
        allPlays: window.__cachePlayCalls || []
      };
    });
    await page.evaluate(() => {
      try { if (window.__idxProgressObserver) window.__idxProgressObserver.disconnect(); } catch (_) {}
      window.__idxProgressObserver = null;
    });

    if (/已暂停/.test(result.status) || /已暂停/.test(result.notice)) {
      throw new Error("clicking a waiting LIVE card should not immediately pause itself: " + JSON.stringify(result));
    }
    if (jobCount !== 1 || result.jobs !== 1) {
      throw new Error("LIVE generation should submit exactly one dialogue job, not re-POST during recovery: " + JSON.stringify({ jobCount, result, jobBodies }));
    }
    if (streamGetCount < 2 || result.streamGets < 2) {
      throw new Error("default LIVE should open live buffer and recovery should reconnect the same stream: " + JSON.stringify({ streamGetCount, streamUrls, result }));
    }
    if (streamUrls.some((u) => !u.includes(liveKey))) {
      throw new Error("LIVE recovery must reuse the same cache key: " + JSON.stringify({ liveKey, streamUrls }));
    }
    if (result.cachePlays || result.audioKind === "saved") {
      throw new Error("cache landing must not steal a currently audible LIVE stream into saved audio: " + JSON.stringify({ result, cacheGetCount }));
    }
    const transientProgressPattern = /等待音频|后端处理中|后端正在(?:调用\s*)?LLM|后端正在合成|正在连接音频|连接实时音频|连接断点音频|收到音频|网络缓冲中|实时音频重连中|正在加载音频|合成(?:第)?\s*\d+\/\d+(?:\s*段)?/;
    const progressBgTransparent = !result.progressBackgroundColor || /rgba?\(\s*0\s*,\s*0\s*,\s*0\s*,\s*0\s*\)|transparent/i.test(result.progressBackgroundColor);
    const progressSnapshots = Array.isArray(result.progressSnapshots) ? result.progressSnapshots : [];
    const hadFloatingProgress = progressSnapshots.some((item) => transientProgressPattern.test(item.progressText || "") && /idx-card/.test(item.progressParentClass || "") && !item.progressInSubtitle);
    const hadPlaybackSegment = progressSnapshots.some((item) => /(?:当前在播第|播第)\s*\d+(?:\s*\/\s*\d+)?\s*段/.test(item.progressText || "")) || /(?:当前在播第|播第)\s*\d+(?:\s*\/\s*\d+)?\s*段/.test(result.progressText || "");
    if (!hadFloatingProgress && !transientProgressPattern.test(result.progressText)) {
      throw new Error("transient LIVE progress should render in the floating player hint while generation is active: " + JSON.stringify(result));
    }
    if (!hadPlaybackSegment) {
      throw new Error("LIVE progress should include the current playing segment when timing is known: " + JSON.stringify(result));
    }
    if (transientProgressPattern.test(result.notice) || result.progressInSubtitle || progressSnapshots.some((item) => transientProgressPattern.test(item.notice || "") || item.progressInSubtitle)) {
      throw new Error("transient LIVE progress must stay out of the lyric panel: " + JSON.stringify(result));
    }
    if (!/idx-card/.test(result.progressParentClass) || result.progressPosition !== "absolute" || result.progressWhiteSpace !== "nowrap" || result.progressTextAlign !== "center" || !progressBgTransparent || result.progressHeight > 24 || !result.progressRect || !result.subtitleRect || result.progressRect.bottom > result.subtitleRect.top + 2 || result.progressRect.top < result.subtitleRect.top - 44 || result.progressRect.left < result.subtitleRect.left + 56 || result.progressRect.right > result.subtitleRect.right - 56) {
      throw new Error("LIVE progress should be a one-line transparent hint floating above the lyric panel: " + JSON.stringify(result));
    }
    if (transientProgressPattern.test(result.status)) {
      throw new Error("transient LIVE progress must stay out of the avatar-side status: " + JSON.stringify(result));
    }
    if (!/第二段计划歌词/.test(result.notice) || !/第三段计划歌词/.test(result.notice)) {
      throw new Error("LIVE subtitle should render planned later lyrics before all segments are synthesized: " + JSON.stringify(result));
    }
    if (!/^00:0[1-9]/.test(result.curText) || Number(result.seekValue || 0) <= 0) {
      throw new Error("LIVE progress should keep moving beyond the first known segment: " + JSON.stringify(result));
    }
    if (!/^\d+\/\d+$/.test(result.counterText) || result.counterText === "L") {
      throw new Error("LIVE card counter should stay as page text, not the L mode badge: " + JSON.stringify(result));
    }
    if (!normalControlLayout.playRect || !normalControlLayout.addRect || !result.playRect || !result.liveExitRect || Math.abs(result.playRect.left - normalControlLayout.playRect.left) > 2 || Math.abs(result.liveExitRect.left - normalControlLayout.addRect.left) > 2 || result.prevVisibility !== "hidden" || result.nextVisibility !== "hidden" || result.addDisplay !== "none") {
      throw new Error("LIVE controls should keep play at the saved-audio position and put exit where the music-note button was: " + JSON.stringify({ normalControlLayout, result }));
    }
    if (pageErrors.length) throw new Error("LIVE play-click smoke page error: " + pageErrors.join(" | "));
    return { jobCount, headCount, statusCount, streamGetCount, streamUrls, result, body: jobBodies[0] };
  } finally {
    await context.close();
  }
}

async function runLiveResumableAfterFailuresSmoke(browser, targetUrl) {
  const context = await browser.newContext();
  await context.addInitScript(() => {
    try { localStorage.clear(); } catch (_) {}
    try { if (indexedDB) indexedDB.deleteDatabase("indextts_tavo_audio_v1"); } catch (_) {}
    window.__cachePlayCalls = [];
    try {
      const originalPlay = HTMLMediaElement.prototype.play;
      HTMLMediaElement.prototype.play = function () {
        try {
          window.__cachePlayCalls.push({
            src: this.currentSrc || this.src || "",
            kind: this.dataset ? (this.dataset.idxSourceKind || "") : ""
          });
        } catch (_) {}
        try {
          this.dispatchEvent(new Event("play"));
          this.dispatchEvent(new Event("playing"));
        } catch (_) {}
        if (originalPlay && this.dataset && this.dataset.idxSourceKind !== "saved") {
          try { return originalPlay.apply(this, arguments); } catch (_) {}
        }
        return Promise.resolve();
      };
    } catch (_) {}
  });

  const page = await context.newPage();
  const pageErrors = [];
  page.on("pageerror", (err) => pageErrors.push(err.message || String(err)));
  page.on("console", (msg) => {
    const text = msg.text();
    if (msg.type() === "error" && !/favicon|net::ERR|连不上 IndexTTS 后端|status of 404|Web Audio 流式异常|实时流暂不可用/i.test(text)) pageErrors.push(text);
  });

  const liveKey = "d".repeat(40);
  let jobCount = 0;
  let headCount = 0;
  let cacheGetCount = 0;
  let statusCount = 0;
  let streamGetCount = 0;
  let pcmPollCount = 0;
  let deleteCount = 0;
  const streamUrls = [];
  const jobBodies = [];

  await page.route("**/cache_audio/**", async (route) => {
    const method = route.request().method().toUpperCase();
    if (method === "HEAD") {
      headCount += 1;
      await route.fulfill({ status: 404, contentType: "text/plain", body: "" });
      return;
    }
    cacheGetCount += 1;
    await route.fulfill({ status: 404, contentType: "text/plain", body: "" });
  });
  await page.route("**/tts_dialogue_job_status/**", async (route) => {
    statusCount += 1;
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        state: "running",
        cache_key: liveKey,
        cache_url: "/cache_audio/" + liveKey,
        sample_rate: 8000,
        duration_s: 0.1,
        metrics: {
          state: "running",
          phase: "tts",
          message: "后端正在合成…",
          segments_done: 1,
          segments_total: 1
        },
        segments_meta: [
          { idx: 0, role: "旁白", text: "兜底自动播放。", style: "neutral", start_s: 0, duration_s: 0.1 }
        ]
      })
    });
  });
  await page.route(/\/tts_dialogue_stream_job(?:\/[^/?#]+(?:\/pcm)?)?(?:[?#].*)?$/, async (route) => {
    const req = route.request();
    const method = req.method().toUpperCase();
    const pathname = new URL(req.url()).pathname;
    if (method === "POST" && /\/tts_dialogue_stream_job\/?$/.test(pathname)) {
      jobCount += 1;
      try { jobBodies.push(JSON.parse(req.postData() || "{}")); } catch (_) { jobBodies.push({}); }
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          url: "/tts_dialogue_stream_job/" + liveKey,
          cache_url: "/cache_audio/" + liveKey,
          cache_key: liveKey,
          cached: false,
          live: true
        })
      });
      return;
    }
    if (method === "GET" && pathname.indexOf("/tts_dialogue_stream_job/") >= 0) {
      streamGetCount += 1;
      streamUrls.push(req.url());
      if (/\/pcm$/.test(pathname)) {
        pcmPollCount += 1;
        await route.fulfill({
          status: 204,
          headers: {
            "X-IndexTTS-Cache-Key": liveKey,
            "X-IndexTTS-Sample-Rate": "8000",
            "X-IndexTTS-PCM-Offset": "0",
            "X-IndexTTS-PCM-Next-Offset": "0",
            "X-IndexTTS-PCM-Total": "0",
            "X-IndexTTS-Live-Done": "0",
            "X-IndexTTS-Live-State": "live",
            "Access-Control-Expose-Headers": "X-IndexTTS-Cache-Key,X-IndexTTS-Sample-Rate,X-IndexTTS-PCM-Offset,X-IndexTTS-PCM-Next-Offset,X-IndexTTS-PCM-Total,X-IndexTTS-Live-Done,X-IndexTTS-Live-State"
          },
          body: ""
        });
        return;
      }
      await route.abort("failed");
      return;
    }
    if (method === "DELETE" && pathname.indexOf("/tts_dialogue_stream_job/") >= 0) {
      deleteCount += 1;
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ deleted: true }) });
      return;
    }
    await route.fulfill({ status: 405, contentType: "application/json", body: JSON.stringify({ message: "unexpected live fallback method" }) });
  });

  try {
    await page.goto(targetUrl, { waitUntil: "domcontentloaded" });
    await page.waitForSelector(".idx-lazy-card", { timeout: 10000 });
    await page.evaluate(() => {
      localStorage.setItem("indextts_tavo_config_v3", JSON.stringify({
        configVersion: 12,
        mode: "normal",
        playbackMode: "live",
        llmEndpoint: "http://127.0.0.1:8317/v1",
        llmModel: "live-fallback-smoke-model",
        llmApiKey: "",
        reuseLlmParse: true,
        intervalMs: 50,
        topP: 0.8,
        topK: 30,
        temperature: 0.7,
        repetitionPenalty: 1.2,
        emoAlpha: 0.38,
        speedFactor: 1.0,
        qualityMode: "balanced",
        offlineAudioEnabled: false
      }));
      localStorage.setItem("indextts_tavo_character_v1:34", JSON.stringify({
        defaultVoice: "女声/高圆圆.wav",
        characterName: "潘金莲",
        roleVoiceList: []
      }));
    });

    await page.click('[data-role="lazy-open"]');
    await page.waitForSelector(".idx-card", { timeout: 10000 });
    await page.evaluate(() => {
      const add = document.querySelector('[data-role="add"]');
      if (!add) throw new Error("missing add button");
      add.click();
    });
    await page.waitForFunction(() => {
      const fetches = window.__idxTest.getFetchLog();
      const pcmPolls = fetches.filter((r) => r.method === "GET" && /\/tts_dialogue_stream_job\/[^/?#]+\/pcm/.test(r.url)).length;
      const play = document.querySelector('[data-role="play"]');
      return pcmPolls >= 3 && play && play.dataset.state === "loading";
    }, { timeout: 15000 });
    await page.waitForTimeout(250);

    const beforeResume = await page.evaluate(() => {
      const fetches = window.__idxTest.getFetchLog();
      const play = document.querySelector('[data-role="play"]');
      const audio = document.querySelector("audio");
      const notice = (document.querySelector(".idx-subtitle") || {}).textContent || "";
      const status = (document.querySelector('[data-role="status"]') || {}).textContent || "";
      return {
        playState: play ? play.dataset.state : "",
        status,
        notice,
        audioKind: audio && audio.dataset ? audio.dataset.idxSourceKind || "" : "",
        audioCacheKey: audio && audio.dataset ? audio.dataset.idxCacheKey || "" : "",
        jobs: fetches.filter((r) => r.method === "POST" && /\/tts_dialogue_stream_job(?:[?#]|$)/.test(r.url)).length,
        statuses: fetches.filter((r) => /\/tts_dialogue_job_status\//.test(r.url)).length,
        streamGets: fetches.filter((r) => r.method === "GET" && /\/tts_dialogue_stream_job\//.test(r.url)).length,
        pcmPolls: fetches.filter((r) => r.method === "GET" && /\/tts_dialogue_stream_job\/[^/?#]+\/pcm/.test(r.url)).length,
        deletes: fetches.filter((r) => r.method === "DELETE" && /\/tts_dialogue_stream_job\//.test(r.url)).length,
        cacheChecks: fetches.filter((r) => /\/cache_audio\//.test(r.url)).length,
        cachePlays: (window.__cachePlayCalls || []).filter((x) => x && x.kind === "saved").length,
        allPlays: window.__cachePlayCalls || []
      };
    });

    if (jobCount !== 1 || beforeResume.jobs !== 1) {
      throw new Error("LIVE failures must not create a second job: " + JSON.stringify({ jobCount, beforeResume, jobBodies }));
    }
    if (pcmPollCount < 3 || beforeResume.pcmPolls < 3 || streamUrls.some((u) => !u.includes(liveKey))) {
      throw new Error("LIVE waiting should poll the same cache-key PCM before cache is saved: " + JSON.stringify({ streamGetCount, pcmPollCount, streamUrls, beforeResume }));
    }
    if (beforeResume.playState !== "loading") {
      throw new Error("LIVE waiting with no PCM should stay loading instead of failing early: " + JSON.stringify(beforeResume));
    }
    if (beforeResume.cachePlays || beforeResume.audioKind === "saved") {
      throw new Error("LIVE waiting must not force autoplay saved-cache fallback: " + JSON.stringify(beforeResume));
    }
    if (deleteCount || beforeResume.deletes) {
      throw new Error("LIVE waiting must not delete the backend job: " + JSON.stringify({ deleteCount, beforeResume }));
    }
    if (/还没收到|跟不上|手动续播|失败|暂不可用/.test(beforeResume.status + beforeResume.notice)) {
      throw new Error("LIVE waiting must not show failure-style prompts: " + JSON.stringify(beforeResume));
    }
    if (pageErrors.length) throw new Error("LIVE resumable-after-failures smoke page error: " + pageErrors.join(" | "));
    return { jobCount, headCount, cacheGetCount, statusCount, streamGetCount, pcmPollCount, streamUrls, beforeResume, body: jobBodies[0] };
  } finally {
    await context.close();
  }
}

async function runLiveResumeStartOffsetSmoke(browser, targetUrl) {
  const context = await browser.newContext();
  await context.addInitScript(() => {
    try { localStorage.clear(); } catch (_) {}
    try { if (indexedDB) indexedDB.deleteDatabase("indextts_tavo_audio_v1"); } catch (_) {}
  });

  const page = await context.newPage();
  const pageErrors = [];
  page.on("pageerror", (err) => pageErrors.push(err.message || String(err)));
  page.on("console", (msg) => {
    const text = msg.text();
    if (msg.type() === "error" && !/favicon|net::ERR|连不上 IndexTTS 后端|status of 404|Web Audio 流式异常/i.test(text)) pageErrors.push(text);
  });

  const liveKey = "f".repeat(40);
  const streamUrls = [];
  let jobCount = 0;
  let statusCount = 0;

  await page.route("**/cache_audio/**", async (route) => {
    await route.fulfill({ status: 404, contentType: "text/plain", body: "" });
  });
  await page.route("**/tts_dialogue_job_status/**", async (route) => {
    statusCount += 1;
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        state: "running",
        cache_key: liveKey,
        cache_url: "/cache_audio/" + liveKey,
        sample_rate: 8000,
        duration_s: 8,
        metrics: { state: "running", phase: "tts", message: "后端正在合成…", segments_done: 1, segments_total: 2 },
        segments_meta: [
          { idx: 0, role: "旁白", text: "第一句。", start_s: 0, duration_s: 3 },
          { idx: 1, role: "对白", text: "第二句。", start_s: 3, duration_s: 5 }
        ]
      })
    });
  });
  await page.route(/\/tts_dialogue_stream_job(?:\/[^/?#]+(?:\/pcm)?)?(?:[?#].*)?$/, async (route) => {
    const req = route.request();
    const method = req.method().toUpperCase();
    const pathname = new URL(req.url()).pathname;
    if (method === "POST" && /\/tts_dialogue_stream_job\/?$/.test(pathname)) {
      jobCount += 1;
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ cache_key: liveKey, url: "/tts_dialogue_stream_job/" + liveKey }) });
      return;
    }
    if (method === "GET" && pathname.indexOf("/tts_dialogue_stream_job/") >= 0) {
      streamUrls.push(req.url());
      await route.abort("failed");
      return;
    }
    await route.fulfill({ status: 405, contentType: "application/json", body: JSON.stringify({ message: "unexpected live resume method" }) });
  });

  try {
    await page.goto(targetUrl, { waitUntil: "domcontentloaded" });
    await page.waitForSelector(".idx-lazy-card", { timeout: 10000 });
    await page.evaluate(async (key) => {
      await window.tavo.set("indextts_tavo_config_v3", {
        configVersion: 13,
        mode: "normal",
        playbackMode: "live",
        intervalMs: 50,
        qualityMode: "balanced",
        offlineAudioEnabled: false
      }, "global");
      await window.tavo.set("indextts_tavo_character_config_v1", {
        defaultVoice: "女声/高圆圆.wav",
        characterName: "潘金莲",
        roleVoiceList: []
      }, "character");
      await window.tavo.set("indextts_tavo_character_v1:34", {
        defaultVoice: "女声/高圆圆.wav",
        characterName: "潘金莲",
        roleVoiceList: []
      }, "global");
      await window.tavo.set("indextts_pending_jobs_test-message-1", [{
        cacheKey: key,
        cacheUrl: "/cache_audio/" + key,
        streamUrl: "/tts_dialogue_stream_job/" + key,
        createdAt: Date.now(),
        voice: "女声/高圆圆.wav",
        mode: "normal",
        parseMode: "normal",
        playbackMode: "live",
        backgroundOnly: false,
        state: "live",
        status: "running",
        pendingBlob: true,
        streaming: true,
        voicesMap: { default: "女声/高圆圆.wav", "旁白": "女声/高圆圆.wav" },
        lastWebAudioSec: 2.75,
        lastElementSec: 2.75,
        segments: []
      }], "chat");
    }, liveKey);

    await page.click('[data-role="lazy-open"]');
    await page.waitForSelector(".idx-card", { timeout: 10000 });
    await page.click('[data-role="play"]');
    await page.waitForFunction(() => {
      const fetches = window.__idxTest.getFetchLog();
      return fetches.some((r) => r.method === "GET" && /\/tts_dialogue_stream_job\//.test(r.url));
    }, { timeout: 10000 });
    await page.waitForTimeout(150);

    const result = await page.evaluate(() => {
      const fetches = window.__idxTest.getFetchLog();
      return {
        jobs: fetches.filter((r) => r.method === "POST" && /\/tts_dialogue_stream_job(?:[?#]|$)/.test(r.url)).length,
        streamUrls: fetches.filter((r) => r.method === "GET" && /\/tts_dialogue_stream_job\//.test(r.url)).map((r) => r.url),
        statuses: fetches.filter((r) => /\/tts_dialogue_job_status\//.test(r.url)).length,
        status: (document.querySelector('[data-role="status"]') || {}).textContent || ""
      };
    });
    if (jobCount || result.jobs) {
      throw new Error("restored LIVE resume must not POST a new job: " + JSON.stringify({ jobCount, result }));
    }
    const firstStream = streamUrls[0] || (result.streamUrls && result.streamUrls[0]) || "";
    if (!firstStream.includes(liveKey)) {
      throw new Error("restored LIVE resume should GET the original cache-key live PCM stream: " + JSON.stringify({ streamUrls, result }));
    }
    const parsed = new URL(firstStream);
    const startS = Number(parsed.searchParams.get("start_s"));
    if (!Number.isFinite(startS) || Math.abs(startS - 2.75) > 0.02) {
      throw new Error("restored LIVE resume should request backend live PCM with start_s from last WebAudio second: " + JSON.stringify({ firstStream, result, statusCount }));
    }
    if (pageErrors.length) throw new Error("LIVE resume start offset smoke page error: " + pageErrors.join(" | "));
    return { streamUrls, result, statusCount };
  } finally {
    await context.close();
  }
}

(async () => {
  const { chromium } = loadPlaywright();
  const targetUrl = process.env.TAVO_TEST_URL || "http://127.0.0.1:9880/tavo_test";
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  await context.addInitScript(() => {
    try { localStorage.clear(); } catch (_) {}
    try { if (indexedDB) indexedDB.deleteDatabase("indextts_tavo_audio_v1"); } catch (_) {}
  });

  const page = await context.newPage();
  const consoleLines = [];
  const pageErrors = [];
  page.on("console", (msg) => consoleLines.push(msg.type() + ": " + msg.text()));
  page.on("pageerror", (err) => pageErrors.push(err.message || String(err)));
  await page.route(/\/voices(?:[?#].*)?$/, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        voices: [
          { name: "女声/高圆圆.wav", subdir: "女声" },
          { name: "男声/旁白.mp3", subdir: "男声" },
          { name: "女声/风韵少妇.wav", subdir: "女声" },
          { name: "女声/单独对白.wav", subdir: "女声" }
        ]
      })
    });
  });

  try {
    await page.goto(targetUrl, { waitUntil: "domcontentloaded" });
    await page.waitForSelector(".idx-lazy-card", { timeout: 10000 });
    await page.waitForTimeout(800);

    const initialLazy = await page.evaluate(() => {
      const fetches = window.__idxTest && window.__idxTest.getFetchLog ? window.__idxTest.getFetchLog() : [];
      return {
        voices: fetches.filter((r) => /\/voices(?:[?#]|$)/.test(r.url)).length,
        jobs: fetches.filter((r) => /\/tts_(?:stream|dialogue).*job/.test(r.url)).length,
        runtimeManifest: fetches.filter((r) => /\/static\/tavo\.runtime\.manifest\.json(?:[?#]|$)/.test(r.url)).length,
        runtimeParts: fetches.filter((r) => /\/static\/tavo\.runtime\.parts\//.test(r.url)).length,
        lazyCard: !!document.querySelector(".idx-lazy-card"),
        lazyStatus: (document.querySelector('[data-role="lazy-status"]') || {}).textContent || "",
        lazyGear: !!document.querySelector('[data-role="lazy-gear"]'),
        runtimeScript: !!document.querySelector('script[src*="tavo.runtime.js"]'),
        runtimeReady: !!window.__indextts_tavo_runtime_ready,
        card: !!document.querySelector(".idx-card"),
        panelCount: document.querySelectorAll(".idx-panel").length,
        pickerCount: document.querySelectorAll(".idx-picker").length
      };
    });

    if (!initialLazy.lazyCard) throw new Error("lazy entry card was not mounted");
    if (initialLazy.lazyGear) throw new Error("lazy snapshot card should not expose a settings button");
    if (initialLazy.card) throw new Error("runtime player mounted before user interaction");
    if (initialLazy.runtimeScript || initialLazy.runtimeReady || initialLazy.runtimeManifest || initialLazy.runtimeParts) {
      throw new Error("runtime loaded before user interaction: " + JSON.stringify(initialLazy));
    }
    if (initialLazy.voices !== 0) throw new Error("lazy-load failed: /voices was requested on mount, count=" + initialLazy.voices);
    if (initialLazy.jobs !== 0) throw new Error("mount should not create TTS jobs, count=" + initialLazy.jobs);

    const immediateShell = await page.evaluate(() => {
      const open = document.querySelector('[data-role="lazy-open"]');
      if (!open) throw new Error("missing lazy open button");
      open.click();
      const fetches = window.__idxTest && window.__idxTest.getFetchLog ? window.__idxTest.getFetchLog() : [];
      const shell = document.querySelector('[data-role="loader-shell"]');
      return {
        shell: !!shell,
        card: !!document.querySelector(".idx-card"),
        status: (document.querySelector('[data-role="status"]') || {}).textContent || "",
        notice: (document.querySelector(".idx-sub-notice") || {}).textContent || "",
        loaderSeek: !!(shell && shell.querySelector(".idx-seek")),
        loaderGap: !!(shell && shell.querySelector(".idx-loader-gap")),
        coverBg: shell ? getComputedStyle(shell.querySelector('[data-role="cover"]') || shell).backgroundImage : "",
        coverText: (shell && shell.querySelector('[data-role="cover"]') ? shell.querySelector('[data-role="cover"]').textContent : "") || "",
        voices: fetches.filter((r) => /\/voices(?:[?#]|$)/.test(r.url)).length,
        jobs: fetches.filter((r) => /\/tts_(?:stream|dialogue).*job/.test(r.url)).length
      };
    });
    if (!immediateShell.shell || !immediateShell.card) {
      throw new Error("lazy click should show a full player shell immediately: " + JSON.stringify(immediateShell));
    }
    if (immediateShell.voices !== 0 || immediateShell.jobs !== 0) {
      throw new Error("loader shell must not request voices or create jobs: " + JSON.stringify(immediateShell));
    }
    if (!/播放器打开中/.test(immediateShell.status + immediateShell.notice)) {
      throw new Error("loader shell should show visible loading status: " + JSON.stringify(immediateShell));
    }
    if (immediateShell.loaderSeek || !immediateShell.loaderGap) {
      throw new Error("loader shell must not expose a fake seek/progress bar: " + JSON.stringify(immediateShell));
    }
    if (!/narrator\.png/.test(immediateShell.coverBg || "")) {
      throw new Error("loader shell should use narrator avatar as default cover: " + JSON.stringify(immediateShell));
    }
    await page.waitForSelector(".idx-card:not([data-loader-shell])", { timeout: 10000 });
    await page.click('[data-role="gear"]');
    await page.waitForSelector('[data-role="panel"][open]', { timeout: 5000 });
    const afterRuntime = await page.evaluate(() => {
      const fetches = window.__idxTest && window.__idxTest.getFetchLog ? window.__idxTest.getFetchLog() : [];
      const sub = document.querySelector(".idx-subtitle");
      const status = document.querySelector('[data-role="status"]');
      const card = document.querySelector(".idx-card");
      const panel = document.querySelector('[data-role="panel"]');
      const close = document.querySelector(".idx-close");
      const panelStyle = panel ? getComputedStyle(panel) : null;
      const cardRect = card ? card.getBoundingClientRect() : null;
      const panelRect = panel ? panel.getBoundingClientRect() : null;
      const closeRect = close ? close.getBoundingClientRect() : null;
      const gear = document.querySelector('[data-role="gear"]');
      const playbackToggle = document.querySelector('[data-role="playback-mode-toggle"]');
      const headerCounter = document.querySelector('[data-role="counter"]');
      const subtitleDelete = document.querySelector('.idx-subtitle [data-role="delete"]');
      const subtitleToolbar = document.querySelector('.idx-subtitle [data-role="subtitle-toolbar"]');
      const subtitleProgress = document.querySelector('.idx-subtitle [data-role="progress"]');
      const cardProgress = document.querySelector('.idx-card > [data-role="progress"]');
      const playBtn = document.querySelector('[data-role="play"]');
      const addBtn = document.querySelector('[data-role="add"]');
      const rewind10 = document.querySelector('[data-role="rewind10"]');
      const forward10 = document.querySelector('[data-role="forward10"]');
      const liveExit = document.querySelector('[data-role="live-exit"]');
      let liveExitDisplay = "";
      if (card && liveExit) {
        card.setAttribute("data-live-active", "1");
        liveExit.classList.add("idx-hidden");
        liveExitDisplay = getComputedStyle(liveExit).display;
        card.removeAttribute("data-live-active");
        liveExit.classList.remove("idx-hidden");
        liveExit.style.display = "flex";
      }
      const settingTitles = Array.from(document.querySelectorAll('[data-role="panel"] .idx-section-title')).map((x) => (x.textContent || "").trim());
      const normalRows = Array.from(document.querySelectorAll('[data-role="normal-voices"] .idx-normal-voice-row')).map((row) => {
        const name = row.querySelector(".idx-role-name");
        const btn = row.querySelector(".idx-voice-btn");
        return {
          role: name ? name.value : "",
          readonly: !!(name && name.readOnly),
          deletable: !!row.querySelector(".idx-role-del"),
          locked: !!row.querySelector(".idx-role-lock"),
          voiceRole: btn ? (btn.getAttribute("data-role") || "") : "",
          voiceTag: btn ? btn.tagName : "",
          buttonText: btn ? (btn.textContent || "").trim() : ""
        };
      });
      return Array.from(document.querySelectorAll('[data-role="roles-list"] .idx-role-row')).map((row) => {
        const name = row.querySelector(".idx-role-name");
        return {
          role: name ? name.value : "",
          readonly: !!(name && name.readOnly),
          deletable: !!row.querySelector(".idx-role-del")
        };
      }).reduce((acc, row) => {
        acc.roleMapping.push(row);
        return acc;
      }, {
        voices: fetches.filter((r) => /\/voices(?:[?#]|$)/.test(r.url)).length,
        jobs: fetches.filter((r) => /\/tts_(?:stream|dialogue).*job/.test(r.url)).length,
        runtimeManifest: fetches.filter((r) => /\/static\/tavo\.runtime\.manifest\.json(?:[?#]|$)/.test(r.url)).length,
        runtimeParts: fetches.filter((r) => /\/static\/tavo\.runtime\.parts\//.test(r.url)).length,
        subtitleHeight: sub ? getComputedStyle(sub).height : null,
        status: status ? status.textContent : "",
        playbackToggleText: (playbackToggle || {}).textContent || "",
        playbackMenuCount: document.querySelectorAll(".idx-playback-menu,.idx-playback-option").length,
        modeLabels: Array.from(document.querySelectorAll(".idx-mode")).map((b) => (b.textContent || "").trim()),
        headerControls: [playbackToggle, gear].map((el) => {
          if (!el) return null;
          const r = el.getBoundingClientRect();
          const s = getComputedStyle(el);
          return {
            left: r.left,
            top: r.top,
            width: r.width,
            height: r.height,
            borderColor: s.borderColor,
            backgroundColor: s.backgroundColor
          };
        }),
        homeControls: {
          hasRewind10: !!rewind10,
          hasForward10: !!forward10,
          playDisabled: !!(playBtn && playBtn.disabled),
          addDisabled: !!(addBtn && addBtn.disabled),
          playRect: playBtn ? { width: playBtn.getBoundingClientRect().width, height: playBtn.getBoundingClientRect().height } : null,
          addRect: addBtn ? { width: addBtn.getBoundingClientRect().width, height: addBtn.getBoundingClientRect().height } : null,
          liveExitRect: liveExit ? { width: liveExit.getBoundingClientRect().width, height: liveExit.getBoundingClientRect().height } : null,
          deleteRect: subtitleDelete ? {
            left: subtitleDelete.getBoundingClientRect().left,
            top: subtitleDelete.getBoundingClientRect().top,
            right: subtitleDelete.getBoundingClientRect().right,
            bottom: subtitleDelete.getBoundingClientRect().bottom,
            width: subtitleDelete.getBoundingClientRect().width,
            height: subtitleDelete.getBoundingClientRect().height
          } : null,
          deleteParentClass: subtitleDelete && subtitleDelete.parentElement ? subtitleDelete.parentElement.className : "",
          deleteInSubtitle: !!(subtitleDelete && subtitleDelete.closest(".idx-subtitle")),
          counterRect: headerCounter ? {
            left: headerCounter.getBoundingClientRect().left,
            top: headerCounter.getBoundingClientRect().top,
            right: headerCounter.getBoundingClientRect().right,
            bottom: headerCounter.getBoundingClientRect().bottom,
            width: headerCounter.getBoundingClientRect().width,
            height: headerCounter.getBoundingClientRect().height
          } : null,
          subtitleRect: sub ? {
            left: sub.getBoundingClientRect().left,
            top: sub.getBoundingClientRect().top,
            right: sub.getBoundingClientRect().right,
            bottom: sub.getBoundingClientRect().bottom,
            width: sub.getBoundingClientRect().width,
            height: sub.getBoundingClientRect().height
          } : null,
          counterParentClass: headerCounter && headerCounter.parentElement ? headerCounter.parentElement.className : "",
          counterInSubtitle: !!(headerCounter && headerCounter.closest(".idx-subtitle")),
          toolbarRect: subtitleToolbar ? {
            left: subtitleToolbar.getBoundingClientRect().left,
            top: subtitleToolbar.getBoundingClientRect().top,
            right: subtitleToolbar.getBoundingClientRect().right,
            bottom: subtitleToolbar.getBoundingClientRect().bottom,
            width: subtitleToolbar.getBoundingClientRect().width,
            height: subtitleToolbar.getBoundingClientRect().height
          } : null,
          toolbarPosition: subtitleToolbar ? getComputedStyle(subtitleToolbar).position : "",
          toolbarBackgroundColor: subtitleToolbar ? getComputedStyle(subtitleToolbar).backgroundColor : "",
          progressRect: cardProgress ? {
            left: cardProgress.getBoundingClientRect().left,
            top: cardProgress.getBoundingClientRect().top,
            right: cardProgress.getBoundingClientRect().right,
            bottom: cardProgress.getBoundingClientRect().bottom,
            width: cardProgress.getBoundingClientRect().width,
            height: cardProgress.getBoundingClientRect().height
          } : null,
          progressParentClass: cardProgress && cardProgress.parentElement ? cardProgress.parentElement.className : "",
          progressInSubtitle: !!subtitleProgress,
          progressPosition: cardProgress ? getComputedStyle(cardProgress).position : "",
          progressBottom: cardProgress ? getComputedStyle(cardProgress).bottom : "",
          progressWhiteSpace: cardProgress ? getComputedStyle(cardProgress).whiteSpace : "",
          progressTextAlign: cardProgress ? getComputedStyle(cardProgress).textAlign : "",
          progressBackgroundColor: cardProgress ? getComputedStyle(cardProgress).backgroundColor : "",
          progressPointerEvents: cardProgress ? getComputedStyle(cardProgress).pointerEvents : "",
          counterPointerEvents: headerCounter ? getComputedStyle(headerCounter).pointerEvents : "",
          subtitleMaskImage: sub ? (getComputedStyle(sub).maskImage || getComputedStyle(sub).webkitMaskImage || "") : "",
          statusWhiteSpace: status ? getComputedStyle(status).whiteSpace : "",
          statusLineClamp: status ? (getComputedStyle(status).webkitLineClamp || "") : ""
        },
        card: !!document.querySelector(".idx-card"),
        panelOpen: !!document.querySelector('[data-role="panel"][open]'),
        panelOutlineStyle: panelStyle ? panelStyle.outlineStyle : "",
        panelOutlineWidth: panelStyle ? panelStyle.outlineWidth : "",
        cardRect: cardRect ? { left: cardRect.left, top: cardRect.top, width: cardRect.width, height: cardRect.height } : null,
        panelRect: panelRect ? { left: panelRect.left, top: panelRect.top, width: panelRect.width, height: panelRect.height } : null,
        closeRect: closeRect ? { width: closeRect.width, height: closeRect.height } : null,
        cardMinHeight: card ? getComputedStyle(card).minHeight : "",
        liveExitDisplay,
        settingTitles,
        normalRows,
        roleMapping: []
      });
    });

    if (!afterRuntime.card || !afterRuntime.panelOpen) throw new Error("runtime player/settings was not mounted: " + JSON.stringify(afterRuntime));
    if (afterRuntime.panelOutlineStyle !== "none" || afterRuntime.panelOutlineWidth !== "0px") {
      throw new Error("settings panel should have one outer border and no dialog focus outline: " + JSON.stringify({
        outlineStyle: afterRuntime.panelOutlineStyle,
        outlineWidth: afterRuntime.panelOutlineWidth
      }));
    }
    if (afterRuntime.runtimeManifest !== 1) throw new Error("runtime manifest should load exactly once, got " + afterRuntime.runtimeManifest);
    if (afterRuntime.runtimeParts < 16) throw new Error("runtime parts were not loaded, count=" + afterRuntime.runtimeParts);
    if (afterRuntime.voices !== 0) throw new Error("opening settings should not request /voices before the picker, count=" + afterRuntime.voices);
    if (afterRuntime.jobs !== 0) throw new Error("opening settings should not create TTS jobs, count=" + afterRuntime.jobs);
    if (afterRuntime.subtitleHeight !== "172px") throw new Error("subtitle height should stay fixed at 172px for four lyric rows, got " + afterRuntime.subtitleHeight);
    if (parseFloat(afterRuntime.cardMinHeight || "0") < 350) throw new Error("player card should keep a stable minimum height: " + JSON.stringify(afterRuntime));
    if (afterRuntime.liveExitDisplay !== "flex") throw new Error("LIVE exit button must stay visible under live-active CSS: " + JSON.stringify(afterRuntime));
    if (!afterRuntime.cardRect || !afterRuntime.panelRect) throw new Error("missing panel/card rects: " + JSON.stringify(afterRuntime));
    if (Math.abs(afterRuntime.panelRect.left - afterRuntime.cardRect.left) > 24) {
      throw new Error("settings panel should follow the player card horizontally: " + JSON.stringify({ card: afterRuntime.cardRect, panel: afterRuntime.panelRect }));
    }
    if (afterRuntime.panelRect.top < 0 || afterRuntime.panelRect.top > afterRuntime.cardRect.top + 24) {
      throw new Error("settings panel opened in an unexpected vertical position: " + JSON.stringify({ card: afterRuntime.cardRect, panel: afterRuntime.panelRect }));
    }
    if (!afterRuntime.closeRect || afterRuntime.closeRect.width < 30 || afterRuntime.closeRect.height < 30) {
      throw new Error("settings close button should be a compact icon button: " + JSON.stringify(afterRuntime.closeRect));
    }
    if (afterRuntime.playbackToggleText.trim() !== "L") throw new Error("playback toggle should default to single-letter L: " + JSON.stringify(afterRuntime));
    if (afterRuntime.playbackMenuCount !== 0) throw new Error("playback mode should be a direct L/D toggle, not a dropdown menu: " + JSON.stringify(afterRuntime));
    if (!afterRuntime.headerControls || afterRuntime.headerControls.some((x) => !x)) {
      throw new Error("top controls should include only playback mode and settings: " + JSON.stringify(afterRuntime.headerControls));
    }
    const headerHeights = afterRuntime.headerControls.map((x) => x.height);
    const headerTops = afterRuntime.headerControls.map((x) => x.top);
    if (Math.max(...headerHeights) - Math.min(...headerHeights) > 2 || Math.max(...headerTops) - Math.min(...headerTops) > 2) {
      throw new Error("top controls should share height and vertical alignment: " + JSON.stringify(afterRuntime.headerControls));
    }
    if (afterRuntime.headerControls[1].width <= afterRuntime.headerControls[1].height || afterRuntime.headerControls[1].width - afterRuntime.headerControls[1].height > 10) {
      throw new Error("settings button should be slightly wider than square without becoming bulky: " + JSON.stringify(afterRuntime.headerControls[1]));
    }
    const home = afterRuntime.homeControls || {};
    if (home.hasRewind10 || home.hasForward10) {
      throw new Error("home player should not expose 10-second skip buttons: " + JSON.stringify(home));
    }
    if (!home.playDisabled || home.addDisabled) {
      throw new Error("empty player should disable play and keep the music-note generate button enabled: " + JSON.stringify(home));
    }
    if (!home.playRect || !home.addRect || Math.abs(home.playRect.width - home.addRect.width) > 2 || Math.abs(home.playRect.height - home.addRect.height) > 2) {
      throw new Error("music/add button should match the main play button size: " + JSON.stringify(home));
    }
    if (!home.liveExitRect || Math.abs(home.playRect.width - home.liveExitRect.width) > 2 || Math.abs(home.playRect.height - home.liveExitRect.height) > 2) {
      throw new Error("live exit button should be circular and match the main play button size: " + JSON.stringify(home));
    }
    if (!home.deleteRect || !home.deleteInSubtitle || !/idx-sub-toolbar/.test(home.deleteParentClass)) {
      throw new Error("delete button should live inside the subtitle toolbar: " + JSON.stringify(home));
    }
    if (!home.counterRect || !home.subtitleRect || !home.counterInSubtitle || !/idx-sub-toolbar/.test(home.counterParentClass)) {
      throw new Error("history page counter should live inside the subtitle toolbar: " + JSON.stringify(home));
    }
    if (!home.toolbarRect || home.toolbarPosition !== "sticky") {
      throw new Error("subtitle toolbar should stay sticky while lyrics scroll: " + JSON.stringify(home));
    }
    const toolbarBgTransparent = !home.toolbarBackgroundColor || /rgba?\(\s*0\s*,\s*0\s*,\s*0\s*,\s*0\s*\)|transparent/i.test(home.toolbarBackgroundColor);
    const progressBgTransparent = !home.progressBackgroundColor || /rgba?\(\s*0\s*,\s*0\s*,\s*0\s*,\s*0\s*\)|transparent/i.test(home.progressBackgroundColor);
    if (!toolbarBgTransparent) {
      throw new Error("subtitle toolbar should stay transparent behind delete/page controls: " + JSON.stringify(home));
    }
    if (!home.progressRect || !home.subtitleRect || home.progressInSubtitle || !/idx-card/.test(home.progressParentClass) || home.progressPosition !== "absolute" || home.progressWhiteSpace !== "nowrap" || home.progressTextAlign !== "center" || home.progressPointerEvents !== "none" || !progressBgTransparent || home.progressRect.height > 24 || home.progressRect.bottom > home.subtitleRect.top + 2 || home.progressRect.top < home.subtitleRect.top - 44 || home.progressRect.left < home.subtitleRect.left + 56 || home.progressRect.right > home.subtitleRect.right - 56) {
      throw new Error("generation progress should be a transparent one-line hint above the lyric panel: " + JSON.stringify(home));
    }
    if (home.counterRect.top < home.subtitleRect.top || home.counterRect.right > home.subtitleRect.right + 1 || home.counterRect.bottom > home.subtitleRect.top + 42) {
      throw new Error("history page counter should stay at the subtitle toolbar right without covering the lyric body: " + JSON.stringify(home));
    }
    if (home.counterPointerEvents !== "none") {
      throw new Error("floating subtitle counter should not intercept subtitle/settings/picker taps: " + JSON.stringify(home));
    }
    if (home.subtitleMaskImage && home.subtitleMaskImage !== "none") {
      throw new Error("subtitle mask should not fade floating delete/counter controls: " + JSON.stringify(home));
    }
    if (home.statusWhiteSpace !== "nowrap" || String(home.statusLineClamp) === "2") {
      throw new Error("role hint/status should stay one-line ellipsis after freeing header space: " + JSON.stringify(home));
    }
    if (!afterRuntime.modeLabels.some((x) => /普通模式/.test(x)) || !afterRuntime.modeLabels.some((x) => /AI模式/.test(x))) {
      throw new Error("settings should expose 普通模式/AI模式 labels: " + JSON.stringify(afterRuntime.modeLabels));
    }
    const settingTitles = afterRuntime.settingTitles || [];
    if (settingTitles.includes("文本模式")) {
      throw new Error("settings should not show the redundant 文本模式 section title: " + JSON.stringify(settingTitles));
    }
    const qualityIdx = settingTitles.indexOf("合成质量");
    const normalVoiceIdx = settingTitles.indexOf("普通模式音色");
    const aiVoiceIdx = settingTitles.indexOf("角色音色映射");
    const offlineIdx = settingTitles.indexOf("播放 / 离线");
    if (qualityIdx < 0 || normalVoiceIdx < 0 || aiVoiceIdx < 0 || offlineIdx < 0 || normalVoiceIdx <= qualityIdx || aiVoiceIdx <= qualityIdx || offlineIdx <= normalVoiceIdx) {
      throw new Error("voice mapping sections should be directly below quality and above playback/offline: " + JSON.stringify(settingTitles));
    }
    const normalRows = afterRuntime.normalRows || [];
    if (normalRows.length !== 2 || normalRows.map((r) => r.role).join("/") !== "旁白/对白") {
      throw new Error("normal mode voices should use only narrator/dialogue rows: " + JSON.stringify(normalRows));
    }
    if (normalRows.some((r) => !r.readonly)) {
      throw new Error("normal mode role names should be readonly: " + JSON.stringify(normalRows));
    }
    if (normalRows[0].voiceRole !== "normal-narrator-voice-btn" || normalRows[0].voiceTag !== "BUTTON" || !normalRows[0].locked || normalRows[0].deletable) {
      throw new Error("normal narrator row should be locked and expose narrator picker only: " + JSON.stringify(normalRows));
    }
    if (normalRows[1].voiceRole !== "normal-dialogue-voice-btn" || normalRows[1].voiceTag !== "BUTTON" || !normalRows[1].deletable) {
      throw new Error("normal dialogue row should expose dialogue picker and a clear-to-inherit action: " + JSON.stringify(normalRows));
    }
    if (await page.locator('[data-role="default-voice-btn"]').count()) {
      throw new Error("normal mode should not expose a separate default voice row");
    }

    const roleMapping = afterRuntime.roleMapping;
    if (!roleMapping.some((r) => r.role === "潘金莲" && r.deletable && !r.readonly)) {
      throw new Error("default character role should use current Tavo character name and be deletable: " + JSON.stringify(roleMapping));
    }
    if (roleMapping.some((r) => r.role === "角色")) {
      throw new Error("default role mapping still contains literal placeholder '角色': " + JSON.stringify(roleMapping));
    }

    await page.click('[data-role="normal-narrator-voice-btn"]');
    await page.waitForSelector('[data-role="voice-picker"][open]', { timeout: 5000 });
    await page.waitForSelector('[data-role="picker-grid"] .idx-picker-item', { timeout: 5000 });

    const afterPicker = await page.evaluate(() => {
      const fetches = window.__idxTest.getFetchLog();
      const grid = document.querySelector('[data-role="picker-grid"]');
      const narratorBtn = document.querySelector('[data-role="normal-narrator-voice-btn"]');
      const picker = document.querySelector('[data-role="voice-picker"][open]') || document.querySelector('[data-role="voice-picker"]');
      const pickerRect = picker ? picker.getBoundingClientRect() : null;
      const pickerStyle = picker ? getComputedStyle(picker) : null;
      return {
        voices: fetches.filter((r) => /\/voices(?:[?#]|$)/.test(r.url)).length,
        items: grid ? grid.querySelectorAll(".idx-picker-item").length : 0,
        gridText: grid ? grid.textContent.trim().slice(0, 80) : "",
        narratorVoiceText: narratorBtn ? narratorBtn.textContent.trim() : "",
        pickerOpen: !!(picker && picker.open),
        pickerDisplay: pickerStyle ? pickerStyle.display : "",
        pickerOutlineStyle: pickerStyle ? pickerStyle.outlineStyle : "",
        pickerOutlineWidth: pickerStyle ? pickerStyle.outlineWidth : "",
        pickerRect: pickerRect ? { left: pickerRect.left, top: pickerRect.top, width: pickerRect.width, height: pickerRect.height } : null
      };
    });

    if (afterPicker.voices < 1) throw new Error("opening the voice picker did not request /voices");
    if (afterPicker.items < 1) throw new Error("voice picker rendered no voice items: " + afterPicker.gridText);
    if (!afterPicker.pickerOpen || afterPicker.pickerDisplay === "none") {
      throw new Error("voice picker should be visibly open: " + JSON.stringify(afterPicker));
    }
    if (afterPicker.pickerOutlineStyle !== "none" || afterPicker.pickerOutlineWidth !== "0px") {
      throw new Error("voice picker should have one outer border and no dialog focus outline: " + JSON.stringify(afterPicker));
    }
    if (!afterPicker.pickerRect || afterPicker.pickerRect.height < 540) {
      throw new Error("voice picker should be slightly taller for one page of voices: " + JSON.stringify(afterPicker.pickerRect));
    }
    if (pageErrors.length) throw new Error("pageerror: " + pageErrors.join(" | "));
    const badConsole = consoleLines.filter((x) => /^error:/i.test(x) && !/favicon|net::ERR/i.test(x));
    if (badConsole.length) throw new Error("console error: " + badConsole.slice(0, 5).join(" | "));

    const llmReuse = await runLlmReuseSmoke(browser, targetUrl);
    const llmErrorCopy = await runLlmErrorCopySmoke(browser, targetUrl);
    const normalGenerateCancel = await runNormalGenerateCancelSmoke(browser, targetUrl);
    const normalExplicitDialogueMapping = await runNormalExplicitDialogueMappingSmoke(browser, targetUrl);
    const livePlayClick = await runLivePlayClickSmoke(browser, targetUrl);
    const liveResumableAfterFailures = await runLiveResumableAfterFailuresSmoke(browser, targetUrl);
    const liveResumeStartOffset = await runLiveResumeStartOffsetSmoke(browser, targetUrl);

    console.log(JSON.stringify({
      ok: true,
      targetUrl,
      initialLazy,
      afterRuntime,
      roleMapping,
      afterPicker,
      llmReuse,
      llmErrorCopy,
      normalGenerateCancel,
      normalExplicitDialogueMapping,
      livePlayClick,
      liveResumableAfterFailures,
      liveResumeStartOffset,
      consoleCount: consoleLines.length
    }, null, 2));
  } finally {
    await browser.close();
  }
})().catch((err) => {
  console.error(err && err.stack ? err.stack : err);
  process.exit(1);
});
