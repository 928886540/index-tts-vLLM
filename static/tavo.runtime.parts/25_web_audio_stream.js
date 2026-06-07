// IndexTTS Tavo runtime part: 25_web_audio_stream.js // Role: Web Audio WAV streaming // This fragment is concatenated by static/tavo.runtime.js; it is not a standalone script.
  async function streamWavViaWebAudio(streamUrl, hooks) {
    hooks = hooks || {};
    var playbackRate = Math.max(0.85, Math.min(1.25, Number(hooks.playbackRate || 1) || 1));
    var startOffsetSec = Math.max(0, Number(hooks.startOffsetSec || 0) || 0);
    var skipOffsetSec = hooks.skipOffsetSec == null ? startOffsetSec : Math.max(0, Number(hooks.skipOffsetSec || 0) || 0);
    var prebufferSec = Math.max(0.5, Math.min(4.0, Number(hooks.prebufferSec || 1.25) || 1.25));
    var flushSec = Math.max(0.25, Math.min(1.0, Number(hooks.flushSec || 0.5) || 0.5));
    var AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) throw new Error("浏览器不支持 Web Audio API");
    hooks.onStateChange && hooks.onStateChange("connecting");
    // 优先复用 user-gesture 里 prime 出来的 ctx；没有再 new 一个（桌面/file://
    // 这种没经过 gesture 的场景也能跑）。
    var ctx = (typeof takePreprimedAudioContext === "function" ? takePreprimedAudioContext() : null) || PRIMED_CTX || new AC();
    try { if (ctx.state === "suspended") await ctx.resume(); }
    catch (e) { throw new Error("[step:resume] " + (e && e.message ? e.message : e)); }
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
    if (hooks.onController) hooks.onController({ stop: stopWebAudio, getTimeSec: getPlaybackTimeSec });
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
    if (hooks.debug) hooks.debug("AudioContext state=" + ctx.state + " sr=" + ctx.sampleRate);

    var res;
    try { res = await fetch(streamUrl); }
    catch (e) { throw new Error("[step:fetch] " + (e && e.message ? e.message : e)); }
    if (!res.ok) throw new Error("[step:fetch] HTTP " + res.status + " " + (await res.text().catch(function(){return"";})));
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
        if (ctx.state === "suspended") {
          await ctx.resume();
          hooks.debug && hooks.debug(step + " resume AudioContext -> " + ctx.state);
        }
      } catch (e) {
        throw new Error("[step:" + step + ".resume] " + (e && e.message ? e.message : e));
      }
    }

    async function schedulePcm(bytes) {
      if (bytes.length < 2 * channels) return;
      try {
        if (stopped) throw makeAbortError(stopReason);
        await ensureAudioContextRunning("schedulePcm");
        var samples = Math.floor(bytes.length / (2 * channels));
        var aBuf = ctx.createBuffer(channels, samples, sampleRate);
        var view = new DataView(bytes.buffer, bytes.byteOffset, samples * 2 * channels);
        for (var c = 0; c < channels; c++) {
          var chan = aBuf.getChannelData(c);
          for (var i = 0; i < samples; i++) {
            chan[i] = view.getInt16((i * channels + c) * 2, true) / 32768;
          }
        }
        var src = ctx.createBufferSource();
        src.buffer = aBuf;
        try { src.playbackRate.value = playbackRate; } catch (_) {}
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
