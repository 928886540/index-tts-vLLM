// IndexTTS Tavo runtime part: 25_web_audio_stream.js // Role: Web Audio WAV streaming // This fragment is concatenated by static/tavo.runtime.js; it is not a standalone script.
  async function streamWavViaWebAudio(streamUrl, hooks) {
    hooks = hooks || {};
    var playbackRate = Math.max(0.85, Math.min(1.25, Number(hooks.playbackRate || 1) || 1));
    var startOffsetSec = Math.max(0, Number(hooks.startOffsetSec || 0) || 0);
    var skipOffsetExplicit = hooks.skipOffsetSec != null;
    var skipOffsetSec = skipOffsetExplicit ? Math.max(0, Number(hooks.skipOffsetSec || 0) || 0) : startOffsetSec;
    var ownerMessageId = String(hooks.ownerMessageId || "").trim();
    var ownerCacheKey = String(hooks.ownerCacheKey || "").trim();
    var prebufferSec = Math.max(0.5, Math.min(4.0, Number(hooks.prebufferSec || 1.25) || 1.25));
    var flushSec = Math.max(0.25, Math.min(1.0, Number(hooks.flushSec || 0.5) || 0.5));
    var AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) throw new Error("浏览器不支持 Web Audio API");
    hooks.onStateChange && hooks.onStateChange("connecting");
    // 优先复用 user-gesture 里 prime 出来的 ctx；没有再 new 一个（桌面/file://
    // 这种没经过 gesture 的场景也能跑）。
    var ctx = (typeof takePreprimedAudioContext === "function" ? takePreprimedAudioContext(ownerMessageId) : null) || new AC();
    try { if (ctx.state === "suspended") await ctx.resume(); }
    catch (e) { throw new Error("[step:resume] " + (e && e.message ? e.message : e)); }
    try {
      ctx.onstatechange = function () {
        hooks.debug && hooks.debug("AudioContext statechange -> " + ctx.state);
        if (ctx.state === "suspended" || ctx.state === "interrupted") {
          hooks.onStateChange && hooks.onStateChange("audio_suspended");
        }
      };
    } catch (_) {}
    try { if (typeof startRuntimeAudioKeepalive === "function") startRuntimeAudioKeepalive(ctx); } catch (_) {}
    var output = ctx.createGain ? ctx.createGain() : null;
    if (output) {
      output.gain.value = 1;
      output.connect(ctx.destination);
    }
    var activeSources = [];
    var reader = null;
    var stopped = false;
    var stopReason = "";
    var endTimer = null;
    var started = false;
    var nextAt = 0;
    var playbackStartCtxTime = null;
    var readEnded = false;
    var bufferTimer = null;
    var playNotifyTimer = null;
    var stableNotifyTimer = null;
    var bufferingState = false;
    var scheduledSpans = [];
    var scheduledAudioSec = 0;
    var reportedFirstPcmStats = false;
    function getPlaybackTimeSec() {
      if (!started || !scheduledSpans.length) return 0;
      var now = 0;
      try { now = ctx.currentTime || 0; } catch (_) { now = 0; }
      for (var i = 0; i < scheduledSpans.length; i++) {
        var sp = scheduledSpans[i];
        if (now < sp.start) return sp.audioStart;
        if (now >= sp.start && now <= sp.end) return sp.audioStart + ((now - sp.start) * playbackRate);
      }
      return scheduledSpans[scheduledSpans.length - 1].audioEnd;
    }
    function armEndedWatcher() {
      if (endTimer) { try { clearInterval(endTimer); } catch (_) {} endTimer = null; }
      if (bufferTimer) { try { clearInterval(bufferTimer); } catch (_) {} bufferTimer = null; }
      endTimer = setInterval(function () {
        if (stopped) {
          try { clearInterval(endTimer); } catch (_) {}
          endTimer = null;
          return;
        }
        var now = 0;
        try { now = ctx.currentTime || 0; } catch (_) { now = 0; }
        // 用 AudioContext 时钟判断结束；WebView 暂停/弱网卡住时 currentTime 不会乱跑。
        if (nextAt && now + 0.03 >= nextAt) {
          try { clearInterval(endTimer); } catch (_) {}
          endTimer = null;
          hooks.onStateChange && hooks.onStateChange("ended");
        }
      }, 120);
    }
    function armBufferWatcher() {
      if (bufferTimer) return;
      bufferTimer = setInterval(function () {
        if (stopped || readEnded || !started) return;
        var now = 0;
        try { now = ctx.currentTime || 0; } catch (_) { now = 0; }
        var ahead = nextAt - now;
        if (ahead <= 0.12 && !bufferingState) {
          bufferingState = true;
          hooks.onStateChange && hooks.onStateChange("buffering");
        } else if (bufferingState && ahead >= 0.65) {
          bufferingState = false;
          hooks.onStateChange && hooks.onStateChange("resumed");
        }
      }, 120);
    }
    function bufferedAheadSec() {
      var now = 0;
      try { now = ctx.currentTime || 0; } catch (_) { now = 0; }
      return Math.max(0, nextAt - now);
    }
    function notifyStableWhenBuffered(delayMs, minAheadSec) {
      if (stableNotifyTimer) { try { clearTimeout(stableNotifyTimer); } catch (_) {} stableNotifyTimer = null; }
      delayMs = Math.max(0, Number(delayMs || 0) || 0);
      minAheadSec = Math.max(0.25, Number(minAheadSec || 0.65) || 0.65);
      stableNotifyTimer = setTimeout(function () {
        stableNotifyTimer = null;
        if (stopped || String(ctx.state || "running") !== "running") return;
        var ahead = bufferedAheadSec();
        if (!bufferingState && ahead >= minAheadSec) {
          hooks.onStateChange && hooks.onStateChange("stable_playing");
          return;
        }
        if (!readEnded && !stopped) notifyStableWhenBuffered(500, minAheadSec);
      }, delayMs);
    }
    function makeAbortError(reason) {
      var e = new Error(reason || "播放已停止");
      e.name = "AbortError";
      return e;
    }
    function stopWebAudio(reason) {
      stopped = true;
      stopReason = reason || "播放已停止";
      if (endTimer) { try { clearInterval(endTimer); } catch (_) {} endTimer = null; }
      if (bufferTimer) { try { clearInterval(bufferTimer); } catch (_) {} bufferTimer = null; }
      if (playNotifyTimer) { try { clearTimeout(playNotifyTimer); } catch (_) {} playNotifyTimer = null; }
      if (stableNotifyTimer) { try { clearTimeout(stableNotifyTimer); } catch (_) {} stableNotifyTimer = null; }
      activeSources.slice().forEach(function (node) { try { node.stop(0); } catch (_) {} });
      if (reader && typeof reader.cancel === "function") {
        try { reader.cancel(stopReason).catch(function () {}); } catch (_) {}
      }
      hooks.onStateChange && hooks.onStateChange("stopped");
    }
    if (hooks.onController) hooks.onController({
      stop: stopWebAudio,
      getTimeSec: getPlaybackTimeSec,
      ctx: ctx,
      outputNode: output,
      activeSources: activeSources,
      messageId: ownerMessageId,
      cacheKey: ownerCacheKey
    });
    function connectNode(node) {
      node.connect(output || ctx.destination);
    }
    function keepSource(node) {
      activeSources.push(node);
      node.onended = function () {
        var idx = activeSources.indexOf(node);
        if (idx >= 0) activeSources.splice(idx, 1);
      };
    }
    if (hooks.debug) hooks.debug("AudioContext state=" + ctx.state + " sr=" + ctx.sampleRate + (ownerMessageId ? " owner=" + ownerMessageId : "") + (ownerCacheKey ? " cacheKey=" + ownerCacheKey : ""));

    var res;
    try { res = await fetch(streamUrl); }
    catch (e) { throw new Error("[step:fetch] " + (e && e.message ? e.message : e)); }
    if (!res.ok) throw new Error("[step:fetch] HTTP " + res.status + " " + (await res.text().catch(function(){return"";})));
    var cacheHeader = "";
    try { cacheHeader = String(res.headers && res.headers.get && res.headers.get("X-IndexTTS-Cache") || "").toUpperCase(); } catch (_) { cacheHeader = ""; }
    if (cacheHeader === "HIT" && startOffsetSec > 0.01 && (!skipOffsetExplicit || skipOffsetSec <= 0.01)) {
      skipOffsetSec = startOffsetSec;
      hooks.debug && hooks.debug("cache HIT 完整 WAV，前端按 startOffset 跳过 " + skipOffsetSec.toFixed(2) + "s PCM");
    }
    hooks.onStateChange && hooks.onStateChange("connected");

    // 试 ReadableStream 真流式；如果 WebView 不支持 (常见于 iOS 老版 / 部分
    // Android WebView)，退回 arrayBuffer 全下载后整段解码播。
    var canStream = !!(res.body && typeof res.body.getReader === "function");
    if (canStream) {
      try { reader = res.body.getReader(); }
      catch (e) { canStream = false; hooks.debug && hooks.debug("getReader 抛异常, 退回 arrayBuffer: " + (e && e.message ? e.message : e)); }
    }

    if (!canStream) {
      hooks.debug && hooks.debug("无 ReadableStream 支持，走 arrayBuffer 整段解码");
      var ab;
      try { ab = await res.arrayBuffer(); }
      catch (e) { throw new Error("[step:arrayBuffer] " + (e && e.message ? e.message : e)); }
      var audioBuf;
      try { audioBuf = await ctx.decodeAudioData(ab.slice(0)); }
      catch (e) { throw new Error("[step:decodeAudioData] " + (e && e.message ? e.message : e)); }
      var src;
      try {
        src = ctx.createBufferSource();
        src.buffer = audioBuf;
        try { src.playbackRate.value = playbackRate; } catch (_) {}
        connectNode(src);
        keepSource(src);
        var audioOffset = Math.min(skipOffsetSec, Math.max(0, audioBuf.duration - 0.05));
        try {
          if (typeof wakeRuntimeAudioOutput === "function") wakeRuntimeAudioOutput(ctx, output || ctx.destination, "buffered-start");
        } catch (_) {}
        var fallbackStartAt = ctx.currentTime + 0.03;
        var dur = Math.max(0, audioBuf.duration - audioOffset) / playbackRate;
        var timelineStart = startOffsetSec;
        var timelineEnd = timelineStart + Math.max(0, audioBuf.duration - audioOffset);
        playbackStartCtxTime = fallbackStartAt;
        nextAt = fallbackStartAt + dur;
        scheduledSpans.push({ start: fallbackStartAt, end: nextAt, audioStart: timelineStart, audioEnd: timelineEnd });
        scheduledAudioSec = timelineEnd;
        started = true;
        src.start(fallbackStartAt, audioOffset);
      } catch (e) { throw new Error("[step:bufferSource.start] " + (e && e.message ? e.message : e)); }
      hooks.onStateChange && hooks.onStateChange("scheduled");
      playNotifyTimer = setTimeout(function () {
        playNotifyTimer = null;
        if (stopped) return;
        ensureAudioContextRunning("playNotify").then(function () {
          if (!stopped && String(ctx.state || "running") === "running") hooks.onStateChange && hooks.onStateChange("playing");
          else if (!stopped) hooks.onStateChange && hooks.onStateChange("audio_suspended");
        }).catch(function (e) {
          hooks.onError && hooks.onError(e);
          if (!stopped) hooks.onStateChange && hooks.onStateChange("audio_suspended");
        });
      }, Math.max(0, (fallbackStartAt - (ctx.currentTime || 0)) * 1000 + 40));
      notifyStableWhenBuffered(Math.max(0, (fallbackStartAt - (ctx.currentTime || 0)) * 1000 + 1200), 0.65);
      armEndedWatcher();
      return { ctx: ctx, duration: dur, mode: "buffered" };
    }

    var pending = new Uint8Array(0);
    function appendPending(chunk) {
      if (!chunk || !chunk.length) return;
      var nb = new Uint8Array(pending.length + chunk.length);
      nb.set(pending); nb.set(chunk, pending.length); pending = nb;
    }
    async function pullMore() {
      try {
        if (stopped) throw makeAbortError(stopReason);
        var r = await reader.read();
        if (r.done) return false;
        appendPending(r.value);
        return true;
      } catch (e) { throw new Error("[step:reader.read] " + (e && e.message ? e.message : e)); }
    }
    function findDataOffset(arr) {
      for (var i = 12; i + 8 <= arr.length; i++) {
        if (arr[i] === 0x64 && arr[i+1] === 0x61 && arr[i+2] === 0x74 && arr[i+3] === 0x61) return i + 8;
      }
      return -1;
    }

    while (pending.length < 44) {
      if (stopped) throw makeAbortError(stopReason);
      if (!(await pullMore())) throw new Error("[step:wavHeader] WAV 头未到先断流");
    }
    var hv = new DataView(pending.buffer, pending.byteOffset, pending.byteLength);
    var channels = hv.getUint16(22, true);
    var sampleRate = hv.getUint32(24, true);
    var bitsPerSample = hv.getUint16(34, true);
    if (bitsPerSample !== 16) throw new Error("[step:wavHeader] 只支持 16-bit PCM, 实际 bits=" + bitsPerSample);
    var dataOff = findDataOffset(pending);
    while (dataOff < 0) {
      if (!(await pullMore())) throw new Error("[step:wavHeader] 没找到 WAV data 段就断流");
      dataOff = findDataOffset(pending);
    }
    if (hooks.debug) hooks.debug("WAV header parsed: sr=" + sampleRate + " ch=" + channels + " bits=" + bitsPerSample);
    hooks.onStateChange && hooks.onStateChange("waiting_pcm");
    var pcm = pending.slice(dataOff);
    pending = null;

    var startAt = ctx.currentTime + 0.06;
    nextAt = startAt;
    started = false;
    playbackStartCtxTime = null;
    var bytesPerSec = sampleRate * channels * 2;
    var blockAlign = Math.max(2 * channels, 2);
    var skipBytesRemaining = Math.floor(skipOffsetSec * bytesPerSec);
    skipBytesRemaining = skipBytesRemaining - (skipBytesRemaining % blockAlign);
    if (skipBytesRemaining > 0 && hooks.debug) hooks.debug("local skip offset " + skipOffsetSec.toFixed(2) + "s, skip " + skipBytesRemaining + " PCM bytes");
    scheduledAudioSec = startOffsetSec;
    // 本机/LAN 也可能因为首段内部 chunk 间隔出现 underrun。起播前多攒一点
    // PCM，避免刚显示 playing 就立刻 buffering。
    var flushBytes = Math.max(8192, Math.floor(bytesPerSec * flushSec));
    flushBytes = flushBytes - (flushBytes % blockAlign);
    if (flushBytes < blockAlign) flushBytes = blockAlign;
    var startBufferBytes = Math.max(flushBytes, Math.floor(bytesPerSec * prebufferSec));
    startBufferBytes = startBufferBytes - (startBufferBytes % blockAlign);
    if (startBufferBytes < flushBytes) startBufferBytes = flushBytes;
    if (hooks.debug) hooks.debug("WebAudio prebuffer=" + prebufferSec.toFixed(2) + "s flush=" + flushSec.toFixed(2) + "s");
    var interrupted = false;
    startAt = ctx.currentTime + 0.12;
    nextAt = startAt;

    async function ensureAudioContextRunning(step) {
      try {
        if (ctx.state === "suspended" || ctx.state === "interrupted") {
          await ctx.resume();
          hooks.debug && hooks.debug(step + " resume AudioContext -> " + ctx.state);
        }
        if (ctx.state === "suspended" || ctx.state === "interrupted") {
          await new Promise(function (r) { setTimeout(r, 80); });
          await ctx.resume();
          hooks.debug && hooks.debug(step + " resume retry AudioContext -> " + ctx.state);
        }
      } catch (e) {
        throw new Error("[step:" + step + ".resume] " + (e && e.message ? e.message : e));
      }
      if (ctx.state === "closed") throw new Error("[step:" + step + ".resume] AudioContext closed");
    }

    async function schedulePcm(bytes) {
      if (bytes.length < 2 * channels) return;
      try {
        if (stopped) throw makeAbortError(stopReason);
        await ensureAudioContextRunning("schedulePcm");
        var samples = Math.floor(bytes.length / (2 * channels));
        var aBuf = ctx.createBuffer(channels, samples, sampleRate);
        var view = new DataView(bytes.buffer, bytes.byteOffset, samples * 2 * channels);
        var maxAbs = 0;
        var sumSq = 0;
        var statCount = 0;
        for (var c = 0; c < channels; c++) {
          var chan = aBuf.getChannelData(c);
          for (var i = 0; i < samples; i++) {
            var sample = view.getInt16((i * channels + c) * 2, true) / 32768;
            chan[i] = sample;
            if (!reportedFirstPcmStats) {
              var abs = Math.abs(sample);
              if (abs > maxAbs) maxAbs = abs;
              sumSq += sample * sample;
              statCount += 1;
            }
          }
        }
        if (!reportedFirstPcmStats) {
          reportedFirstPcmStats = true;
          var rms = statCount ? Math.sqrt(sumSq / statCount) : 0;
          hooks.debug && hooks.debug("first PCM stats peak=" + maxAbs.toFixed(4) + " rms=" + rms.toFixed(4) + " bytes=" + bytes.length);
        }
        var src = ctx.createBufferSource();
        src.buffer = aBuf;
        try { src.playbackRate.value = playbackRate; } catch (_) {}
        if (!started) {
          try {
            if (typeof wakeRuntimeAudioOutput === "function") wakeRuntimeAudioOutput(ctx, output || ctx.destination, "first-pcm");
          } catch (_) {}
        }
        connectNode(src);
        keepSource(src);
        var t = Math.max(nextAt, ctx.currentTime + 0.02);
        src.start(t);
        var realDur = aBuf.duration / playbackRate;
        var audioStart = scheduledAudioSec;
        var audioEnd = audioStart + aBuf.duration;
        nextAt = t + realDur;
        scheduledSpans.push({ start: t, end: nextAt, audioStart: audioStart, audioEnd: audioEnd });
        scheduledAudioSec = audioEnd;
        if (!started) {
          playbackStartCtxTime = t;
          started = true;
          hooks.onStateChange && hooks.onStateChange("scheduled");
          playNotifyTimer = setTimeout(function () {
            playNotifyTimer = null;
            if (stopped) return;
            ensureAudioContextRunning("playNotify").then(function () {
              if (!stopped && String(ctx.state || "running") === "running") hooks.onStateChange && hooks.onStateChange("playing");
              else if (!stopped) hooks.onStateChange && hooks.onStateChange("audio_suspended");
            }).catch(function (e) {
              hooks.onError && hooks.onError(e);
              if (!stopped) hooks.onStateChange && hooks.onStateChange("audio_suspended");
            });
          }, Math.max(0, (t - (ctx.currentTime || 0)) * 1000 + 40));
          notifyStableWhenBuffered(Math.max(0, (t - (ctx.currentTime || 0)) * 1000 + Math.max(1400, prebufferSec * 900)), 0.65);
          armBufferWatcher();
        } else if (bufferingState && nextAt - (ctx.currentTime || 0) >= 0.65) {
          bufferingState = false;
          hooks.onStateChange && hooks.onStateChange("resumed");
        }
      } catch (e) {
        throw new Error("[step:schedulePcm] " + (e && e.message ? e.message : e));
      }
    }

    function alignedLength(n) {
      n = Math.max(0, Math.floor(n || 0));
      return n - (n % blockAlign);
    }
    function applyStartOffsetSkip() {
      if (!skipBytesRemaining || !pcm || !pcm.length) return;
      var canDrop = Math.min(alignedLength(pcm.length), skipBytesRemaining);
      if (canDrop <= 0) return;
      pcm = pcm.slice(canDrop);
      skipBytesRemaining -= canDrop;
      if (skipBytesRemaining <= 0) {
        skipBytesRemaining = 0;
        if (hooks.debug) hooks.debug("local skip offset reached, scheduling from " + startOffsetSec.toFixed(2) + "s");
      }
    }
    async function scheduleStartIfReady(force) {
      if (started || !pcm) return false;
      applyStartOffsetSkip();
      if (skipBytesRemaining > 0) return false;
      var needBytes = force ? blockAlign : startBufferBytes;
      if (pcm.length < needBytes) return false;
      var firstChunkBytes = force ? alignedLength(pcm.length) : alignedLength(Math.min(pcm.length, Math.max(startBufferBytes, flushBytes)));
      if (firstChunkBytes <= 0) return false;
      hooks.onStateChange && hooks.onStateChange("first_pcm");
      var firstSlice = pcm.slice(0, firstChunkBytes);
      pcm = pcm.slice(firstChunkBytes);
      await schedulePcm(firstSlice);
      return true;
    }

    while (true) {
      var r;
      try { r = await reader.read(); }
      catch (e) {
        if (stopped) throw makeAbortError(stopReason);
        if (started) {
          // 已经起播后读流失败，按真实失败处理；不再继续播放残留 buffer，
          // 也不做断线恢复，避免弱网下重复尾段/乱跳。
          interrupted = true;
          readEnded = true;
          hooks.onStateChange && hooks.onStateChange("interrupted");
          hooks.debug && hooks.debug("流中断，停止 Web Audio: " + (e && e.message ? e.message : e));
          stopWebAudio("stream interrupted");
          throw new Error("[step:reader.read.loop] " + (e && e.message ? e.message : e));
        }
        hooks.onError && hooks.onError(e);
        throw new Error("[step:reader.read.loop] " + (e && e.message ? e.message : e));
      }
      if (r.done) { readEnded = true; break; }
      if (r.value && r.value.length) {
        var nb = new Uint8Array(pcm.length + r.value.length);
        nb.set(pcm); nb.set(r.value, pcm.length); pcm = nb;
      }
      applyStartOffsetSkip();
      await scheduleStartIfReady(false);
      while (started && pcm.length >= flushBytes) {
        var slice = pcm.slice(0, flushBytes);
        pcm = pcm.slice(flushBytes);
        await schedulePcm(slice);
      }
    }
    if (!started) await scheduleStartIfReady(true);
    applyStartOffsetSkip();
    if (skipBytesRemaining > 0) {
      pcm = null;
    } else if (pcm && pcm.length >= blockAlign) {
      var remainLen = alignedLength(pcm.length);
      if (remainLen > 0) await schedulePcm(pcm.slice(0, remainLen));
    }
    pcm = null;
    if (!started) throw new Error("[step:noAudio] 后端没有返回可播放音频");
    if (stopped) return { ctx: ctx, duration: Math.max(0, nextAt - startAt), mode: "streaming", stopped: true, interrupted: interrupted };

    var totalDur = Math.max(0, nextAt - startAt);
    armEndedWatcher();
    return { ctx: ctx, duration: totalDur, mode: "streaming", interrupted: interrupted };
  }

  async function streamLivePcmViaWebAudio(pcmUrl, hooks) {
    hooks = hooks || {};
    var playbackRate = Math.max(0.85, Math.min(1.25, Number(hooks.playbackRate || 1) || 1));
    var startOffsetSec = Math.max(0, Number(hooks.startOffsetSec || 0) || 0);
    var ownerMessageId = String(hooks.ownerMessageId || "").trim();
    var ownerCacheKey = String(hooks.ownerCacheKey || "").trim();
    var prebufferSec = Math.max(0.5, Math.min(4.0, Number(hooks.prebufferSec || 1.25) || 1.25));
    var flushSec = Math.max(0.25, Math.min(1.0, Number(hooks.flushSec || 0.5) || 0.5));
    var AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) throw new Error("浏览器不支持 Web Audio API");
    hooks.onStateChange && hooks.onStateChange("connecting");
    var ctx = (typeof takePreprimedAudioContext === "function" ? takePreprimedAudioContext(ownerMessageId) : null) || new AC();
    try { if (ctx.state === "suspended") await ctx.resume(); }
    catch (e) { throw new Error("[step:pcm.resume] " + (e && e.message ? e.message : e)); }
    try {
      ctx.onstatechange = function () {
        hooks.debug && hooks.debug("PCM AudioContext statechange -> " + ctx.state);
        if (ctx.state === "suspended" || ctx.state === "interrupted") {
          hooks.onStateChange && hooks.onStateChange("audio_suspended");
        }
      };
    } catch (_) {}
    try { if (typeof startRuntimeAudioKeepalive === "function") startRuntimeAudioKeepalive(ctx); } catch (_) {}
    var output = ctx.createGain ? ctx.createGain() : null;
    if (output) {
      output.gain.value = 1;
      output.connect(ctx.destination);
    }
    var activeSources = [];
    var stopped = false;
    var stopReason = "";
    var endTimer = null;
    var bufferTimer = null;
    var playNotifyTimer = null;
    var stableNotifyTimer = null;
    var bufferingState = false;
    var started = false;
    var nextAt = 0;
    var playbackStartCtxTime = null;
    var readEnded = false;
    var scheduledSpans = [];
    var scheduledAudioSec = startOffsetSec;
    var sampleRate = 22050;
    var channels = 1;
    var blockAlign = 2;
    var bytesPerSec = sampleRate * channels * 2;
    var flushBytes = 0;
    var startBufferBytes = 0;
    var pending = new Uint8Array(0);
    var nextOffset = -1;
    var reportedFirstPcmStats = false;
    var pollCount = 0;
    var queuedPlayer = null;

    function recalcBufferSizes() {
      bytesPerSec = sampleRate * channels * 2;
      blockAlign = Math.max(2 * channels, 2);
      flushBytes = Math.max(8192, Math.floor(bytesPerSec * flushSec));
      flushBytes = flushBytes - (flushBytes % blockAlign);
      if (flushBytes < blockAlign) flushBytes = blockAlign;
      startBufferBytes = Math.max(flushBytes, Math.floor(bytesPerSec * prebufferSec));
      startBufferBytes = startBufferBytes - (startBufferBytes % blockAlign);
      if (startBufferBytes < flushBytes) startBufferBytes = flushBytes;
    }
    recalcBufferSizes();
    function canUseScriptFlag(name) {
      try { return typeof scriptFlagEnabled === "function" && scriptFlagEnabled(name); }
      catch (_) { return false; }
    }
    function pcmStats(bytes, label) {
      if (reportedFirstPcmStats || !bytes || bytes.length < blockAlign) return;
      var samples = Math.floor(bytes.length / blockAlign);
      var view = new DataView(bytes.buffer, bytes.byteOffset, samples * blockAlign);
      var maxAbs = 0;
      var sumSq = 0;
      var statCount = 0;
      for (var c = 0; c < channels; c++) {
        for (var i = 0; i < samples; i++) {
          var sample = view.getInt16((i * channels + c) * 2, true) / 32768;
          var abs = Math.abs(sample);
          if (abs > maxAbs) maxAbs = abs;
          sumSq += sample * sample;
          statCount += 1;
        }
      }
      reportedFirstPcmStats = true;
      var rms = statCount ? Math.sqrt(sumSq / statCount) : 0;
      hooks.debug && hooks.debug((label || "poll first PCM stats") + " peak=" + maxAbs.toFixed(4) + " rms=" + rms.toFixed(4) + " bytes=" + bytes.length);
    }
    function pcmBytesToOutputFloat32(bytes, outRate) {
      outRate = Math.max(8000, Math.round(outRate || (ctx.sampleRate || sampleRate || 44100)));
      var inputSamples = Math.floor((bytes && bytes.length ? bytes.length : 0) / blockAlign);
      if (inputSamples <= 0) return new Float32Array(0);
      var outputSamples = Math.max(1, Math.floor(inputSamples * outRate / Math.max(1, sampleRate * playbackRate)));
      var view = new DataView(bytes.buffer, bytes.byteOffset, inputSamples * blockAlign);
      var out = new Float32Array(outputSamples);
      for (var i = 0; i < outputSamples; i++) {
        var srcPos = i * sampleRate * playbackRate / outRate;
        var idx = Math.floor(srcPos);
        var frac = srcPos - idx;
        if (idx >= inputSamples - 1) idx = inputSamples - 1;
        var off0 = idx * blockAlign;
        var s0 = view.getInt16(off0, true) / 32768;
        var s1 = s0;
        if (idx + 1 < inputSamples) s1 = view.getInt16((idx + 1) * blockAlign, true) / 32768;
        out[i] = s0 + (s1 - s0) * frac;
      }
      return out;
    }
    async function createQueuedPcmPlayer() {
      var outRate = Math.max(8000, Math.round(ctx.sampleRate || sampleRate || 44100));
      var useWorklet = !!(ctx.audioWorklet && window.Blob && window.URL && !canUseScriptFlag("scriptProcessorPcm"));
      if (useWorklet) {
        try {
          var processorName = "idx-live-pcm-player-" + Math.random().toString(36).slice(2);
          var code = [
            "class P extends AudioWorkletProcessor{",
            "constructor(){super();this.q=[];this.cur=null;this.off=0;this.played=0;this.total=0;this.stopped=false;this.started=false;this.under=false;this.tick=0;this.port.onmessage=e=>{const d=e.data||{};if(d.type==='push'&&d.samples){this.q.push(d.samples);this.total+=d.samples.length;}else if(d.type==='stop'){this.stopped=true;}}}",
            "process(i,o){const outs=o[0]||[];const n=outs[0]?outs[0].length:128;let had=false,under=false;for(let x=0;x<n;x++){let s=0;if(!this.cur&&this.q.length){this.cur=this.q.shift();this.off=0;}if(this.cur){s=this.cur[this.off++]||0;had=true;this.played++;if(this.off>=this.cur.length){this.cur=null;this.off=0;}}else{under=true;}for(let c=0;c<outs.length;c++)outs[c][x]=s;}if(had&&!this.started){this.started=true;this.port.postMessage({type:'started'});}if(under&&!this.under){this.under=true;this.port.postMessage({type:'underrun',played:this.played,total:this.total});}if(!under&&this.under){this.under=false;this.port.postMessage({type:'recovered',played:this.played,total:this.total});}this.tick+=n;if(this.tick>=sampleRate/4){this.tick=0;this.port.postMessage({type:'progress',played:this.played,total:this.total});}return !this.stopped;}",
            "}",
            "registerProcessor('" + processorName + "',P);"
          ].join("");
          var url = URL.createObjectURL(new Blob([code], { type: "application/javascript" }));
          try { await ctx.audioWorklet.addModule(url); } finally { try { URL.revokeObjectURL(url); } catch (_) {} }
          var node = new AudioWorkletNode(ctx, processorName, { numberOfInputs: 0, numberOfOutputs: 1, outputChannelCount: [1] });
          var player = {
            kind: "audioWorklet",
            sampleRate: outRate,
            node: node,
            connected: false,
            queuedSamples: 0,
            playedSamples: 0,
            push: function (samples) {
              if (!samples || !samples.length) return;
              this.queuedSamples += samples.length;
              node.port.postMessage({ type: "push", samples: samples }, [samples.buffer]);
            },
            start: function () {
              if (this.connected) return;
              connectNode(node);
              this.connected = true;
            },
            stop: function () {
              try { node.port.postMessage({ type: "stop" }); } catch (_) {}
              try { node.disconnect(); } catch (_) {}
              this.connected = false;
            },
            playedSec: function () { return Math.max(0, this.playedSamples / Math.max(1, this.sampleRate)); },
            bufferedSec: function () { return Math.max(0, (this.queuedSamples - this.playedSamples) / Math.max(1, this.sampleRate)); }
          };
          node.port.onmessage = function (ev) {
            var d = (ev && ev.data) || {};
            if (isFinite(Number(d.played))) player.playedSamples = Math.max(player.playedSamples, Number(d.played) || 0);
            if (d.type === "started") hooks.onStateChange && hooks.onStateChange("playing");
            else if (d.type === "underrun" && started && !readEnded) hooks.onStateChange && hooks.onStateChange("buffering");
            else if (d.type === "recovered") hooks.onStateChange && hooks.onStateChange("resumed");
          };
          hooks.debug && hooks.debug("PCM queued output=AudioWorklet sr=" + outRate);
          return player;
        } catch (e) {
          hooks.debug && hooks.debug("AudioWorklet PCM 不可用，尝试 ScriptProcessor: " + (e && e.message ? e.message : e));
        }
      }
      if (ctx.createScriptProcessor && !canUseScriptFlag("noScriptProcessorPcm")) {
        try {
          var node2 = ctx.createScriptProcessor(4096, 0, 1);
          var player2 = {
            kind: "scriptProcessor",
            sampleRate: outRate,
            node: node2,
            connected: false,
            queue: [],
            current: null,
            offset: 0,
            queuedSamples: 0,
            playedSamples: 0,
            underrun: false,
            push: function (samples) {
              if (!samples || !samples.length) return;
              this.queue.push(samples);
              this.queuedSamples += samples.length;
            },
            start: function () {
              if (this.connected) return;
              connectNode(node2);
              this.connected = true;
            },
            stop: function () {
              try { node2.disconnect(); } catch (_) {}
              this.connected = false;
              this.queue = [];
              this.current = null;
              this.offset = 0;
            },
            playedSec: function () { return Math.max(0, this.playedSamples / Math.max(1, this.sampleRate)); },
            bufferedSec: function () { return Math.max(0, (this.queuedSamples - this.playedSamples) / Math.max(1, this.sampleRate)); }
          };
          node2.onaudioprocess = function (ev) {
            var out = ev.outputBuffer.getChannelData(0);
            var had = false;
            var under = false;
            for (var i = 0; i < out.length; i++) {
              var sample = 0;
              if (!player2.current && player2.queue.length) {
                player2.current = player2.queue.shift();
                player2.offset = 0;
              }
              if (player2.current) {
                sample = player2.current[player2.offset++] || 0;
                had = true;
                player2.playedSamples += 1;
                if (player2.offset >= player2.current.length) {
                  player2.current = null;
                  player2.offset = 0;
                }
              } else {
                under = true;
              }
              out[i] = sample;
            }
            if (had && !player2.startedNotified) {
              player2.startedNotified = true;
              hooks.onStateChange && hooks.onStateChange("playing");
            }
            if (under && !player2.underrun && started && !readEnded) {
              player2.underrun = true;
              hooks.onStateChange && hooks.onStateChange("buffering");
            } else if (!under && player2.underrun) {
              player2.underrun = false;
              hooks.onStateChange && hooks.onStateChange("resumed");
            }
          };
          hooks.debug && hooks.debug("PCM queued output=ScriptProcessor sr=" + outRate);
          return player2;
        } catch (e2) {
          hooks.debug && hooks.debug("ScriptProcessor PCM 不可用，退回 BufferSource: " + (e2 && e2.message ? e2.message : e2));
        }
      }
      return null;
    }
    try {
      if (!canUseScriptFlag("bufferSourcePcm")) queuedPlayer = await createQueuedPcmPlayer();
    } catch (e) {
      queuedPlayer = null;
      hooks.debug && hooks.debug("PCM queued output 初始化失败，退回 BufferSource: " + (e && e.message ? e.message : e));
    }
    function getPlaybackTimeSec() {
      if (queuedPlayer && started) return startOffsetSec + (queuedPlayer.playedSec() * playbackRate);
      if (!started || !scheduledSpans.length) return 0;
      var now = 0;
      try { now = ctx.currentTime || 0; } catch (_) { now = 0; }
      for (var i = 0; i < scheduledSpans.length; i++) {
        var sp = scheduledSpans[i];
        if (now < sp.start) return sp.audioStart;
        if (now >= sp.start && now <= sp.end) return sp.audioStart + ((now - sp.start) * playbackRate);
      }
      return scheduledSpans[scheduledSpans.length - 1].audioEnd;
    }
    function armEndedWatcher() {
      if (endTimer) { try { clearInterval(endTimer); } catch (_) {} endTimer = null; }
      if (bufferTimer) { try { clearInterval(bufferTimer); } catch (_) {} bufferTimer = null; }
      endTimer = setInterval(function () {
        if (stopped) {
          try { clearInterval(endTimer); } catch (_) {}
          endTimer = null;
          return;
        }
        var now = 0;
        try { now = ctx.currentTime || 0; } catch (_) { now = 0; }
        if (queuedPlayer && started) {
          if (!(readEnded && queuedPlayer.bufferedSec() <= 0.05)) return;
        } else if (!(nextAt && now + 0.03 >= nextAt)) {
          return;
        }
        try { clearInterval(endTimer); } catch (_) {}
        endTimer = null;
        hooks.onStateChange && hooks.onStateChange("ended");
      }, 120);
    }
    function armBufferWatcher() {
      if (bufferTimer) return;
      bufferTimer = setInterval(function () {
        if (stopped || readEnded || !started) return;
        var now = 0;
        try { now = ctx.currentTime || 0; } catch (_) { now = 0; }
        var ahead = queuedPlayer ? queuedPlayer.bufferedSec() : (nextAt - now);
        if (ahead <= 0.12 && !bufferingState) {
          bufferingState = true;
          hooks.onStateChange && hooks.onStateChange("buffering");
        } else if (bufferingState && ahead >= 0.65) {
          bufferingState = false;
          hooks.onStateChange && hooks.onStateChange("resumed");
        }
      }, 120);
    }
    function bufferedAheadSec() {
      if (queuedPlayer && started) return queuedPlayer.bufferedSec();
      var now = 0;
      try { now = ctx.currentTime || 0; } catch (_) { now = 0; }
      return Math.max(0, nextAt - now);
    }
    function notifyStableWhenBuffered(delayMs, minAheadSec) {
      if (stableNotifyTimer) { try { clearTimeout(stableNotifyTimer); } catch (_) {} stableNotifyTimer = null; }
      delayMs = Math.max(0, Number(delayMs || 0) || 0);
      minAheadSec = Math.max(0.25, Number(minAheadSec || 0.65) || 0.65);
      stableNotifyTimer = setTimeout(function () {
        stableNotifyTimer = null;
        if (stopped || String(ctx.state || "running") !== "running") return;
        var ahead = bufferedAheadSec();
        if (!bufferingState && ahead >= minAheadSec) {
          hooks.onStateChange && hooks.onStateChange("stable_playing");
          return;
        }
        if (!readEnded && !stopped) notifyStableWhenBuffered(500, minAheadSec);
      }, delayMs);
    }
    function stopWebAudio(reason) {
      stopped = true;
      stopReason = reason || "播放已停止";
      if (endTimer) { try { clearInterval(endTimer); } catch (_) {} endTimer = null; }
      if (bufferTimer) { try { clearInterval(bufferTimer); } catch (_) {} bufferTimer = null; }
      if (playNotifyTimer) { try { clearTimeout(playNotifyTimer); } catch (_) {} playNotifyTimer = null; }
      if (stableNotifyTimer) { try { clearTimeout(stableNotifyTimer); } catch (_) {} stableNotifyTimer = null; }
      if (queuedPlayer) { try { queuedPlayer.stop(); } catch (_) {} }
      activeSources.slice().forEach(function (node) { try { node.stop(0); } catch (_) {} });
      hooks.onStateChange && hooks.onStateChange("stopped");
    }
    if (hooks.onController) hooks.onController({
      stop: stopWebAudio,
      getTimeSec: getPlaybackTimeSec,
      ctx: ctx,
      outputNode: output,
      activeSources: activeSources,
      messageId: ownerMessageId,
      cacheKey: ownerCacheKey
    });
    function connectNode(node) {
      node.connect(output || ctx.destination);
    }
    function keepSource(node) {
      activeSources.push(node);
      node.onended = function () {
        var idx = activeSources.indexOf(node);
        if (idx >= 0) activeSources.splice(idx, 1);
      };
    }
    async function ensureAudioContextRunning(step) {
      try {
        if (ctx.state === "suspended" || ctx.state === "interrupted") {
          await ctx.resume();
          hooks.debug && hooks.debug(step + " resume AudioContext -> " + ctx.state);
        }
        if (ctx.state === "suspended" || ctx.state === "interrupted") {
          await new Promise(function (r) { setTimeout(r, 80); });
          await ctx.resume();
          hooks.debug && hooks.debug(step + " resume retry AudioContext -> " + ctx.state);
        }
      } catch (e) {
        throw new Error("[step:" + step + ".resume] " + (e && e.message ? e.message : e));
      }
      if (ctx.state === "closed") throw new Error("[step:" + step + ".resume] AudioContext closed");
    }
    function appendPending(chunk) {
      if (!chunk || !chunk.length) return;
      var nb = new Uint8Array(pending.length + chunk.length);
      nb.set(pending);
      nb.set(chunk, pending.length);
      pending = nb;
    }
    function alignedLength(n) {
      n = Math.max(0, Math.floor(n || 0));
      return n - (n % blockAlign);
    }
    async function schedulePcm(bytes) {
      if (!bytes || bytes.length < blockAlign) return;
      if (queuedPlayer) {
        await scheduleQueuedPcm(bytes);
        return;
      }
      try {
        if (stopped) throw new Error(stopReason || "播放已停止");
        await ensureAudioContextRunning("pcm.schedulePcm");
        var samples = Math.floor(bytes.length / blockAlign);
        var aBuf = ctx.createBuffer(channels, samples, sampleRate);
        var view = new DataView(bytes.buffer, bytes.byteOffset, samples * blockAlign);
        var maxAbs = 0;
        var sumSq = 0;
        var statCount = 0;
        for (var c = 0; c < channels; c++) {
          var chan = aBuf.getChannelData(c);
          for (var i = 0; i < samples; i++) {
            var sample = view.getInt16((i * channels + c) * 2, true) / 32768;
            chan[i] = sample;
            if (!reportedFirstPcmStats) {
              var abs = Math.abs(sample);
              if (abs > maxAbs) maxAbs = abs;
              sumSq += sample * sample;
              statCount += 1;
            }
          }
        }
        if (!reportedFirstPcmStats) {
          reportedFirstPcmStats = true;
          var rms = statCount ? Math.sqrt(sumSq / statCount) : 0;
          hooks.debug && hooks.debug("poll first PCM stats peak=" + maxAbs.toFixed(4) + " rms=" + rms.toFixed(4) + " bytes=" + bytes.length);
        }
        var src = ctx.createBufferSource();
        src.buffer = aBuf;
        try { src.playbackRate.value = playbackRate; } catch (_) {}
        if (!started) {
          try {
            if (typeof wakeRuntimeAudioOutput === "function") wakeRuntimeAudioOutput(ctx, output || ctx.destination, "pcm-poll-first");
          } catch (_) {}
        }
        connectNode(src);
        keepSource(src);
        var t = Math.max(nextAt, ctx.currentTime + 0.02);
        src.start(t);
        var realDur = aBuf.duration / playbackRate;
        var audioStart = scheduledAudioSec;
        var audioEnd = audioStart + aBuf.duration;
        nextAt = t + realDur;
        scheduledSpans.push({ start: t, end: nextAt, audioStart: audioStart, audioEnd: audioEnd });
        scheduledAudioSec = audioEnd;
        if (!started) {
          playbackStartCtxTime = t;
          started = true;
          hooks.onStateChange && hooks.onStateChange("scheduled");
          playNotifyTimer = setTimeout(function () {
            playNotifyTimer = null;
            if (stopped) return;
            ensureAudioContextRunning("pcm.playNotify").then(function () {
              if (!stopped && String(ctx.state || "running") === "running") hooks.onStateChange && hooks.onStateChange("playing");
              else if (!stopped) hooks.onStateChange && hooks.onStateChange("audio_suspended");
            }).catch(function (e) {
              hooks.onError && hooks.onError(e);
              if (!stopped) hooks.onStateChange && hooks.onStateChange("audio_suspended");
            });
          }, Math.max(0, (t - (ctx.currentTime || 0)) * 1000 + 40));
          notifyStableWhenBuffered(Math.max(0, (t - (ctx.currentTime || 0)) * 1000 + Math.max(1400, prebufferSec * 900)), 0.65);
          armBufferWatcher();
        } else if (bufferingState && nextAt - (ctx.currentTime || 0) >= 0.65) {
          bufferingState = false;
          hooks.onStateChange && hooks.onStateChange("resumed");
        }
      } catch (e) {
        throw new Error("[step:pcm.schedulePcm] " + (e && e.message ? e.message : e));
      }
    }
    async function scheduleQueuedPcm(bytes) {
      try {
        if (stopped) throw new Error(stopReason || "播放已停止");
        await ensureAudioContextRunning("pcm.queue");
        pcmStats(bytes, "poll first PCM stats");
        var inputSamples = Math.floor(bytes.length / blockAlign);
        var inputDur = inputSamples / Math.max(1, sampleRate);
        var out = pcmBytesToOutputFloat32(bytes, queuedPlayer.sampleRate);
        if (!out.length) return;
        queuedPlayer.push(out);
        scheduledAudioSec += inputDur;
        nextAt = (ctx.currentTime || 0) + queuedPlayer.bufferedSec();
        if (!started) {
          try {
            if (typeof wakeRuntimeAudioOutput === "function") wakeRuntimeAudioOutput(ctx, output || ctx.destination, "pcm-queue-first");
          } catch (_) {}
          queuedPlayer.start();
          playbackStartCtxTime = ctx.currentTime || 0;
          started = true;
          hooks.onStateChange && hooks.onStateChange("scheduled");
          playNotifyTimer = setTimeout(function () {
            playNotifyTimer = null;
            if (!stopped && String(ctx.state || "running") === "running") hooks.onStateChange && hooks.onStateChange("playing");
            else if (!stopped) hooks.onStateChange && hooks.onStateChange("audio_suspended");
          }, 80);
          notifyStableWhenBuffered(Math.max(900, prebufferSec * 700), 0.65);
          armBufferWatcher();
        } else if (bufferingState && queuedPlayer.bufferedSec() >= 0.65) {
          bufferingState = false;
          hooks.onStateChange && hooks.onStateChange("resumed");
        }
      } catch (e) {
        throw new Error("[step:pcm.queuePcm] " + (e && e.message ? e.message : e));
      }
    }
    async function scheduleStartIfReady(force) {
      if (started) return false;
      var needBytes = force ? blockAlign : startBufferBytes;
      if (pending.length < needBytes) return false;
      var firstChunkBytes = force ? alignedLength(pending.length) : alignedLength(Math.min(pending.length, Math.max(startBufferBytes, flushBytes)));
      if (firstChunkBytes <= 0) return false;
      hooks.onStateChange && hooks.onStateChange("first_pcm");
      var firstSlice = pending.slice(0, firstChunkBytes);
      pending = pending.slice(firstChunkBytes);
      await schedulePcm(firstSlice);
      return true;
    }
    function pollUrl() {
      var u = new URL(pcmUrl, location.href);
      if (nextOffset >= 0) u.searchParams.set("offset", String(nextOffset));
      else u.searchParams.set("start_s", startOffsetSec.toFixed(3));
      u.searchParams.set("max_bytes", String(Math.max(startBufferBytes, flushBytes * 2)));
      u.searchParams.set("wait_ms", "450");
      u.searchParams.set("_", String(Date.now()));
      return u.href;
    }
    if (hooks.debug) hooks.debug("PCM polling AudioContext state=" + ctx.state + " sr=" + ctx.sampleRate + (ownerMessageId ? " owner=" + ownerMessageId : "") + (ownerCacheKey ? " cacheKey=" + ownerCacheKey : ""));
    hooks.onStateChange && hooks.onStateChange("connected");
    nextAt = ctx.currentTime + 0.12;
    while (!stopped) {
      var res;
      pollCount += 1;
      try { res = await fetch(pollUrl(), { cache: "no-store" }); }
      catch (e) { throw new Error("[step:pcm.fetch] " + (e && e.message ? e.message : e)); }
      if (res.status === 204) {
        var done204 = false;
        try { done204 = String(res.headers.get("X-IndexTTS-Live-Done") || "") === "1"; } catch (_) {}
        try {
          var noDataNext = Number(res.headers.get("X-IndexTTS-PCM-Next-Offset"));
          if (isFinite(noDataNext) && noDataNext >= 0) nextOffset = noDataNext;
        } catch (_) {}
        if (!started) hooks.onStateChange && hooks.onStateChange("waiting_pcm");
        if (done204) { readEnded = true; break; }
        await new Promise(function (r) { setTimeout(r, 120); });
        continue;
      }
      if (!res.ok) throw new Error("[step:pcm.fetch] HTTP " + res.status + " " + (await res.text().catch(function(){return"";})));
      try {
        var sr = Number(res.headers.get("X-IndexTTS-Sample-Rate"));
        if (isFinite(sr) && sr > 0 && sr !== sampleRate && !started) {
          sampleRate = Math.round(sr);
          recalcBufferSizes();
        }
      } catch (_) {}
      var ab;
      try { ab = await res.arrayBuffer(); }
      catch (e) { throw new Error("[step:pcm.arrayBuffer] " + (e && e.message ? e.message : e)); }
      var chunk = new Uint8Array(ab);
      try {
        var headerNext = Number(res.headers.get("X-IndexTTS-PCM-Next-Offset"));
        if (isFinite(headerNext) && headerNext >= 0) nextOffset = headerNext;
        else nextOffset = (nextOffset >= 0 ? nextOffset : 0) + chunk.length;
      } catch (_) {
        nextOffset = (nextOffset >= 0 ? nextOffset : 0) + chunk.length;
      }
      var done = false;
      try { done = String(res.headers.get("X-IndexTTS-Live-Done") || "") === "1"; } catch (_) {}
      if (chunk.length) {
        if (pollCount <= 3 || !reportedFirstPcmStats) hooks.debug && hooks.debug("PCM poll chunk bytes=" + chunk.length + " next=" + nextOffset + " done=" + (done ? "1" : "0"));
        appendPending(chunk);
        await scheduleStartIfReady(false);
        while (started && pending.length >= flushBytes) {
          var len = alignedLength(flushBytes);
          var slice = pending.slice(0, len);
          pending = pending.slice(len);
          await schedulePcm(slice);
        }
      } else if (!started) {
        hooks.onStateChange && hooks.onStateChange("waiting_pcm");
      }
      if (done) { readEnded = true; break; }
    }
    if (!started) await scheduleStartIfReady(true);
    if (pending && pending.length >= blockAlign) {
      var remainLen = alignedLength(pending.length);
      if (remainLen > 0) await schedulePcm(pending.slice(0, remainLen));
    }
    pending = null;
    if (!started) throw new Error("[step:pcm.noAudio] 后端没有返回可播放 PCM");
    if (stopped) return { ctx: ctx, duration: Math.max(0, nextAt - (playbackStartCtxTime || 0)), mode: "pcm-poll", stopped: true };
    var totalDur = Math.max(0, nextAt - (playbackStartCtxTime || 0));
    armEndedWatcher();
    return { ctx: ctx, duration: totalDur, mode: "pcm-poll" };
  }
