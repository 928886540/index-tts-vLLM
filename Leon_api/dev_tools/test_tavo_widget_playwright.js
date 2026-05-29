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

function countFetches(fetches, pattern) {
  return fetches.filter((r) => pattern.test(r.url)).length;
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
    await page.waitForSelector(".idx-card", { timeout: 10000 });
    await page.waitForTimeout(800);

    const initial = await page.evaluate(() => {
      const fetches = window.__idxTest && window.__idxTest.getFetchLog ? window.__idxTest.getFetchLog() : [];
      const sub = document.querySelector(".idx-subtitle");
      const status = document.querySelector('[data-role="status"]');
      return {
        voices: fetches.filter((r) => /\/voices(?:[?#]|$)/.test(r.url)).length,
        jobs: fetches.filter((r) => /\/tts_(?:stream|dialogue).*job/.test(r.url)).length,
        subtitleHeight: sub ? getComputedStyle(sub).height : null,
        status: status ? status.textContent : "",
        card: !!document.querySelector(".idx-card"),
        panelCount: document.querySelectorAll(".idx-panel").length,
        pickerCount: document.querySelectorAll(".idx-picker").length
      };
    });

    if (!initial.card) throw new Error("player was not mounted");
    if (initial.voices !== 0) throw new Error("lazy-load failed: /voices was requested on mount, count=" + initial.voices);
    if (initial.jobs !== 0) throw new Error("mount should not create TTS jobs, count=" + initial.jobs);
    if (initial.subtitleHeight !== "136px") throw new Error("subtitle height should stay fixed at 136px, got " + initial.subtitleHeight);

    await page.click('[data-role="gear"]');
    await page.waitForSelector('[data-role="panel"][open]', { timeout: 5000 });
    const roleMapping = await page.evaluate(() => {
      return Array.from(document.querySelectorAll(".idx-role-row")).map((row) => {
        const name = row.querySelector(".idx-role-name");
        return {
          role: name ? name.value : "",
          readonly: !!(name && name.readOnly),
          deletable: !!row.querySelector(".idx-role-del")
        };
      });
    });

    if (!roleMapping.some((r) => r.role === "潘金莲" && r.deletable && !r.readonly)) {
      throw new Error("default character role should use current Tavo character name and be deletable: " + JSON.stringify(roleMapping));
    }
    if (roleMapping.some((r) => r.role === "角色")) {
      throw new Error("default role mapping still contains literal placeholder '角色': " + JSON.stringify(roleMapping));
    }

    await page.click('[data-role="default-voice-btn"]');
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
      const defBtn = document.querySelector('[data-role="default-voice-btn"]');
      return {
        voices: fetches.filter((r) => /\/voices(?:[?#]|$)/.test(r.url)).length,
        items: grid ? grid.querySelectorAll(".idx-picker-item").length : 0,
        gridText: grid ? grid.textContent.trim().slice(0, 80) : "",
        defaultVoiceText: defBtn ? defBtn.textContent.trim() : ""
      };
    });

    if (afterPicker.voices < 1) throw new Error("opening the voice picker did not request /voices");
    if (afterPicker.items < 1) throw new Error("voice picker rendered no voice items: " + afterPicker.gridText);
    if (pageErrors.length) throw new Error("pageerror: " + pageErrors.join(" | "));
    const badConsole = consoleLines.filter((x) => /^error:/i.test(x) && !/favicon|net::ERR/i.test(x));
    if (badConsole.length) throw new Error("console error: " + badConsole.slice(0, 5).join(" | "));

    console.log(JSON.stringify({
      ok: true,
      targetUrl,
      initial,
      roleMapping,
      afterPicker,
      consoleCount: consoleLines.length
    }, null, 2));
  } finally {
    await browser.close();
  }
})().catch((err) => {
  console.error(err && err.stack ? err.stack : err);
  process.exit(1);
});
