;(function () {
  "use strict";

  var loaderScript = (typeof window !== "undefined" && window.__indextts_tavo_runtime_script_override) || document.currentScript;
  var RUNTIME_PARTS_VERSION = "20260608-mp3-cache-v49";
  var MANIFEST_FILE = "tavo.runtime.manifest.json";
  var FALLBACK_PARTS = [
    "tavo.runtime.parts/00_base_context.js",
    "tavo.runtime.parts/05_style_config.js",
    "tavo.runtime.parts/10_tracks_icons.js",
    "tavo.runtime.parts/20_generation_params.js",
    "tavo.runtime.parts/25_web_audio_stream.js",
    "tavo.runtime.parts/30_llm_parse.js",
    "tavo.runtime.parts/40_mount_shell.js",
    "tavo.runtime.parts/42_playback_header.js",
    "tavo.runtime.parts/44_element_audio.js",
    "tavo.runtime.parts/46_track_state.js",
    "tavo.runtime.parts/48_track_history.js",
    "tavo.runtime.parts/50_settings_fields.js",
    "tavo.runtime.parts/52_subtitle_media.js",
    "tavo.runtime.parts/54_voice_picker.js",
    "tavo.runtime.parts/60_generate_flow.js",
    "tavo.runtime.parts/62_events_boot.js"
  ];

  function runtimeBaseUrl() {
    try {
      if (loaderScript && loaderScript.src) return new URL(".", loaderScript.src).href;
    } catch (_) {}
    try { return new URL("/static/", location.href).href; } catch (_) { return ""; }
  }

  function withVersion(url) {
    try {
      var u = new URL(url, location.href);
      u.searchParams.set("runtime_part_v", RUNTIME_PARTS_VERSION);
      return u.href;
    } catch (_) {
      var sep = String(url || "").indexOf("?") >= 0 ? "&" : "?";
      return String(url || "") + sep + "runtime_part_v=" + encodeURIComponent(RUNTIME_PARTS_VERSION);
    }
  }

  function partUrl(name) {
    try { return withVersion(new URL(name, runtimeBaseUrl()).href); }
    catch (_) { return withVersion(runtimeBaseUrl() + name); }
  }

  function manifestUrl() {
    try { return withVersion(new URL(MANIFEST_FILE, runtimeBaseUrl()).href); }
    catch (_) { return withVersion(runtimeBaseUrl() + MANIFEST_FILE); }
  }

  function assertModuleFile(file, id) {
    file = String(file || "").replace(/\\/g, "/").trim();
    if (!file || file.charAt(0) === "/" || file.indexOf(":") >= 0) throw new Error("invalid module file for " + id + ": " + file);
    if (file.split("/").some(function (part) { return !part || part === ".."; })) throw new Error("unsafe module file for " + id + ": " + file);
    if (!/\.js$/i.test(file)) throw new Error("module file must be .js for " + id + ": " + file);
    return file;
  }

  function topoSortModules(modules) {
    var byId = {};
    modules.forEach(function (mod) { byId[mod.id] = mod; });
    var state = {};
    var sorted = [];
    function visit(id, stack) {
      if (state[id] === "done") return;
      if (state[id] === "visiting") throw new Error("runtime manifest has circular dependency: " + stack.concat(id).join(" -> "));
      var mod = byId[id];
      if (!mod) throw new Error("missing module " + id);
      state[id] = "visiting";
      mod.depends.forEach(function (dep) { visit(dep, stack.concat(id)); });
      state[id] = "done";
      sorted.push(mod);
    }
    modules.forEach(function (mod) { visit(mod.id, []); });
    return sorted;
  }

  function fallbackManifest(reason) {
    try { console.warn("[IndexTTS TAVO runtime loader] manifest fallback", reason || ""); } catch (_) {}
    return {
      schema: 1,
      runtimeVersion: RUNTIME_PARTS_VERSION,
      mode: "ordered-fragments-fallback",
      modules: FALLBACK_PARTS.map(function (file, index) {
        return { id: "fallback-" + String(index).padStart(2, "0"), file: file, depends: index ? ["fallback-" + String(index - 1).padStart(2, "0")] : [] };
      })
    };
  }

  function normalizeManifest(manifest) {
    if (!manifest || typeof manifest !== "object") throw new Error("runtime manifest is not an object");
    if (Number(manifest.schema) !== 1) throw new Error("unsupported runtime manifest schema: " + manifest.schema);
    var modules = Array.isArray(manifest.modules) ? manifest.modules : [];
    if (!modules.length) throw new Error("runtime manifest has no modules");
    var seen = {};
    var out = modules.map(function (mod, index) {
      if (!mod || typeof mod !== "object") throw new Error("invalid module at index " + index);
      var id = String(mod.id || "").trim();
      if (!id) throw new Error("module missing id at index " + index);
      if (seen[id]) throw new Error("duplicate module id: " + id);
      seen[id] = true;
      return {
        id: id,
        file: assertModuleFile(mod.file, id),
        phase: String(mod.phase || "runtime"),
        depends: Array.isArray(mod.depends) ? mod.depends.map(function (dep) { return String(dep || "").trim(); }).filter(Boolean) : []
      };
    });
    var byId = {};
    out.forEach(function (mod) { byId[mod.id] = mod; });
    out.forEach(function (mod) {
      mod.depends.forEach(function (dep) {
        if (!byId[dep]) throw new Error("module " + mod.id + " depends on missing module " + dep);
      });
    });
    return {
      schema: 1,
      runtimeVersion: String(manifest.runtimeVersion || RUNTIME_PARTS_VERSION),
      mode: String(manifest.mode || "ordered-fragments"),
      skin: manifest.skin || {},
      modules: topoSortModules(out)
    };
  }

  function fetchManifest() {
    return fetch(manifestUrl(), { cache: "no-store" }).then(function (res) {
      if (!res.ok) throw new Error("runtime manifest load failed: " + res.status);
      return res.json();
    }).then(normalizeManifest).catch(function (err) {
      return normalizeManifest(fallbackManifest(err && err.message ? err.message : String(err)));
    });
  }

  function fetchPart(name) {
    var url = partUrl(name);
    return fetch(url, { cache: "no-store" }).then(function (res) {
      if (!res.ok) throw new Error("runtime part load failed: " + res.status + " " + url);
      return res.text().then(function (text) {
        return "\n\n/* ---- " + name + " ---- */\n" + text;
      });
    });
  }

  function executeRuntime(source) {
    var previousOverride;
    try { previousOverride = window.__indextts_tavo_runtime_script_override; } catch (_) { previousOverride = undefined; }
    try { window.__indextts_tavo_runtime_script_override = loaderScript; } catch (_) {}
    try {
      (0, eval)(source + "\n//# sourceURL=indextts-tavo-runtime.parts.js");
      var appPromise = null;
      try { appPromise = window.__indextts_tavo_runtime_app_promise; } catch (_) {}
      if (appPromise && typeof appPromise.then === "function") return appPromise;
      return true;
    } finally {
      try {
        if (previousOverride === undefined) delete window.__indextts_tavo_runtime_script_override;
        else window.__indextts_tavo_runtime_script_override = previousOverride;
      } catch (_) {}
    }
  }

  window.__indextts_tavo_runtime_ready = fetchManifest().then(function (manifest) {
    try {
      window.__indextts_tavo_runtime_manifest = manifest;
      console.log("[IndexTTS TAVO runtime loader] manifest", manifest.mode, manifest.runtimeVersion, manifest.modules.length + " modules");
    } catch (_) {}
    return Promise.all(manifest.modules.map(function (mod) {
      return fetchPart(mod.file).then(function (source) {
        return { mod: mod, source: source };
      });
    })).then(function (items) {
      var sourceById = {};
      items.forEach(function (item) { sourceById[item.mod.id] = item.source; });
      return executeRuntime(manifest.modules.map(function (mod) { return sourceById[mod.id]; }).join("\n"));
    });
  }).catch(function (err) {
    try { console.error("[IndexTTS TAVO runtime loader]", err && err.stack ? err.stack : err); } catch (_) {}
    throw err;
  });
})();
