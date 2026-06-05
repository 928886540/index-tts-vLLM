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

function tinyWavBuffer() {
  const sampleRate = 8000;
  const samples = 800;
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
  return buf;
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
    if (msg.type() === "error" && !/favicon|net::ERR|连不上 IndexTTS 后端/i.test(text)) pageErrors.push(text);
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
  });

  const page = await context.newPage();
  const pageErrors = [];
  page.on("pageerror", (err) => pageErrors.push(err.message || String(err)));
  page.on("console", (msg) => {
    const text = msg.text();
    if (msg.type() === "error" && !/favicon|net::ERR|连不上 IndexTTS 后端|服务端任务失败|后端 LLM 拆段失败|生成失败/i.test(text)) pageErrors.push(text);
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
      const fetches = window.__idxTest.getFetchLog();
      return {
        parseFetches: fetches.filter((r) => /\/parse_text(?:[?#]|$)/.test(r.url)).length,
        jobs: fetches.filter((r) => /\/tts_dialogue_stream_job(?:[?#]|$)/.test(r.url)).length,
        statuses: fetches.filter((r) => /\/tts_dialogue_job_status\//.test(r.url)).length,
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
    if (pageErrors.length) throw new Error("LLM error copy smoke page error: " + pageErrors.join(" | "));
    return { parseCount, jobCount, statusCount, result };
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
    if (msg.type() === "error" && !/favicon|net::ERR|连不上 IndexTTS 后端|任务已取消|生成被中断/i.test(text)) pageErrors.push(text);
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
      return b && /生成/.test(b.textContent || "") && b.dataset.mode === "generate";
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
    if (!body.voices || body.voices.default !== "女声/高圆圆.wav" || body.voices["旁白"] !== "女声/高圆圆.wav" || body.voices["对白"] !== "女声/高圆圆.wav") {
      throw new Error("normal mode should map default/旁白/对白 to the default voice: " + JSON.stringify(body));
    }
    if (result.pendingActive) throw new Error("pending job storage should be cleared after delete: " + JSON.stringify(result));
    if (pageErrors.length) throw new Error("normal generate smoke page error: " + pageErrors.join(" | "));
    return { parseCount, jobCount, statusCount, streamGetCount, deleteCount, result, body };
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

    await page.click('[data-role="lazy-open"]');
    await page.waitForSelector(".idx-card", { timeout: 10000 });
    await page.click('[data-role="gear"]');
    await page.waitForSelector('[data-role="panel"][open]', { timeout: 5000 });
    const afterRuntime = await page.evaluate(() => {
      const fetches = window.__idxTest && window.__idxTest.getFetchLog ? window.__idxTest.getFetchLog() : [];
      const sub = document.querySelector(".idx-subtitle");
      const status = document.querySelector('[data-role="status"]');
      const card = document.querySelector(".idx-card");
      const panel = document.querySelector('[data-role="panel"]');
      const close = document.querySelector(".idx-close");
      const cardRect = card ? card.getBoundingClientRect() : null;
      const panelRect = panel ? panel.getBoundingClientRect() : null;
      const closeRect = close ? close.getBoundingClientRect() : null;
      const gear = document.querySelector('[data-role="gear"]');
      const playbackToggle = document.querySelector('[data-role="playback-mode-toggle"]');
      const headerCounter = document.querySelector('[data-role="counter"]');
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
        modeLabels: Array.from(document.querySelectorAll(".idx-mode")).map((b) => (b.textContent || "").trim()),
        headerControls: [headerCounter, playbackToggle, gear].map((el) => {
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
        card: !!document.querySelector(".idx-card"),
        panelOpen: !!document.querySelector('[data-role="panel"][open]'),
        cardRect: cardRect ? { left: cardRect.left, top: cardRect.top, width: cardRect.width, height: cardRect.height } : null,
        panelRect: panelRect ? { left: panelRect.left, top: panelRect.top, width: panelRect.width, height: panelRect.height } : null,
        closeRect: closeRect ? { width: closeRect.width, height: closeRect.height } : null,
        normalRows,
        roleMapping: []
      });
    });

    if (!afterRuntime.card || !afterRuntime.panelOpen) throw new Error("runtime player/settings was not mounted: " + JSON.stringify(afterRuntime));
    if (afterRuntime.runtimeManifest !== 1) throw new Error("runtime manifest should load exactly once, got " + afterRuntime.runtimeManifest);
    if (afterRuntime.runtimeParts < 16) throw new Error("runtime parts were not loaded, count=" + afterRuntime.runtimeParts);
    if (afterRuntime.voices !== 0) throw new Error("opening settings should not request /voices before the picker, count=" + afterRuntime.voices);
    if (afterRuntime.jobs !== 0) throw new Error("opening settings should not create TTS jobs, count=" + afterRuntime.jobs);
    if (afterRuntime.subtitleHeight !== "136px") throw new Error("subtitle height should stay fixed at 136px, got " + afterRuntime.subtitleHeight);
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
    if (afterRuntime.playbackToggleText.trim() !== "LIVE") throw new Error("playback toggle should default to LIVE: " + JSON.stringify(afterRuntime));
    if (!afterRuntime.headerControls || afterRuntime.headerControls.some((x) => !x)) {
      throw new Error("header controls should all exist: " + JSON.stringify(afterRuntime.headerControls));
    }
    const headerHeights = afterRuntime.headerControls.map((x) => x.height);
    const headerTops = afterRuntime.headerControls.map((x) => x.top);
    if (Math.max(...headerHeights) - Math.min(...headerHeights) > 2 || Math.max(...headerTops) - Math.min(...headerTops) > 2) {
      throw new Error("header controls should share height and vertical alignment: " + JSON.stringify(afterRuntime.headerControls));
    }
    if (afterRuntime.headerControls[2].width - afterRuntime.headerControls[2].height > 2) {
      throw new Error("settings button should stay a compact square icon button: " + JSON.stringify(afterRuntime.headerControls[2]));
    }
    if (!afterRuntime.modeLabels.some((x) => /普通模式/.test(x)) || !afterRuntime.modeLabels.some((x) => /AI模式/.test(x))) {
      throw new Error("settings should expose 普通模式/AI模式 labels: " + JSON.stringify(afterRuntime.modeLabels));
    }
    const normalRows = afterRuntime.normalRows || [];
    if (normalRows.length !== 3 || normalRows.map((r) => r.role).join("/") !== "默认/旁白/对话") {
      throw new Error("normal mode voices should use fixed role-style rows: " + JSON.stringify(normalRows));
    }
    if (normalRows.some((r) => !r.readonly || r.deletable || !r.locked)) {
      throw new Error("normal mode voice rows should be locked and non-deletable: " + JSON.stringify(normalRows));
    }
    if (normalRows[0].voiceRole !== "default-voice-label" || normalRows[0].voiceTag === "BUTTON") {
      throw new Error("default normal voice row should be locked display-only: " + JSON.stringify(normalRows));
    }
    if (normalRows[1].voiceRole !== "normal-narrator-voice-btn" || normalRows[2].voiceRole !== "normal-dialogue-voice-btn") {
      throw new Error("only narrator/dialogue normal rows should expose voice picker buttons: " + JSON.stringify(normalRows));
    }
    if (await page.locator('[data-role="default-voice-btn"]').count()) {
      throw new Error("default normal voice should not expose a picker button");
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
    await page.waitForFunction(() => {
      const fetches = window.__idxTest && window.__idxTest.getFetchLog ? window.__idxTest.getFetchLog() : [];
      return fetches.some((r) => /\/voices(?:[?#]|$)/.test(r.url));
    }, { timeout: 10000 });
    await page.waitForFunction(() => {
      const grid = document.querySelector('[data-role="picker-grid"]');
      return grid && (grid.querySelector(".idx-picker-item") || /没有找到|没有匹配|读取失败/.test(grid.textContent || ""));
    }, { timeout: 10000 });

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
        pickerRect: pickerRect ? { left: pickerRect.left, top: pickerRect.top, width: pickerRect.width, height: pickerRect.height } : null
      };
    });

    if (afterPicker.voices < 1) throw new Error("opening the voice picker did not request /voices");
    if (afterPicker.items < 1) throw new Error("voice picker rendered no voice items: " + afterPicker.gridText);
    if (!afterPicker.pickerOpen || afterPicker.pickerDisplay === "none") {
      throw new Error("voice picker should be visibly open: " + JSON.stringify(afterPicker));
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
      consoleCount: consoleLines.length
    }, null, 2));
  } finally {
    await browser.close();
  }
})().catch((err) => {
  console.error(err && err.stack ? err.stack : err);
  process.exit(1);
});
