// IndexTTS Tavo runtime part: 05_style_config.js // Role: style loading, global config, message context // This fragment is concatenated by static/tavo.runtime.js; it is not a standalone script.
  function ensureStyle() {
    if (document.getElementById(STYLE_ID)) { ensureSkinStyle(); return; }
    var style = document.createElement("style");
    style.id = STYLE_ID;
    style.textContent = [
      ".idx-tts *{box-sizing:border-box;letter-spacing:0}",
      ".idx-tts{max-width:760px;margin:12px 0;color:#eee7f4;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI','Microsoft YaHei',sans-serif;line-height:1.45;letter-spacing:0}.idx-hidden{display:none!important}",
      ".idx-card{position:relative;overflow:hidden;min-height:360px;border-radius:18px;background:radial-gradient(circle at 88% 8%,rgba(216,167,255,.22),transparent 40%),linear-gradient(160deg,rgba(27,21,34,.55) 0%,rgba(18,14,24,.48) 54%,rgba(12,9,16,.55) 100%);backdrop-filter:blur(22px) saturate(140%);-webkit-backdrop-filter:blur(22px) saturate(140%);border:1px solid rgba(206,170,230,.22);padding:16px}",
      ".idx-top{display:flex;align-items:center;gap:12px;min-width:0;padding-top:38px}.idx-cover{width:56px;height:56px;flex:0 0 56px;border-radius:14px;background:#241a2c;box-shadow:inset 0 0 0 1px rgba(255,255,255,.08),0 10px 24px rgba(0,0,0,.34);display:flex;align-items:center;justify-content:center;color:#e9c8ff;font-size:18px;font-weight:800;background-size:cover;background-position:center}.idx-cover[data-playing='1']{animation:none}",
      ".idx-info{flex:1;min-width:0;padding-right:0}.idx-title-row{display:flex;align-items:center;gap:8px;min-width:0}.idx-name{font-size:18px;font-weight:800;color:#e9c8ff;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.idx-format{flex:0 0 auto;border:1px solid rgba(206,170,230,.34);background:rgba(206,170,230,.12);color:#d9b7f0;border-radius:999px;padding:2px 7px;font-size:10px;font-weight:800}.idx-status{margin-top:4px;font-size:12px;line-height:1.35;max-height:34px;color:rgba(238,231,244,.62);white-space:normal;overflow:hidden;text-overflow:clip;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow-wrap:anywhere}.idx-gear{position:absolute;right:14px;top:14px;width:38px;height:36px;border-radius:999px;border:1px solid rgba(206,170,230,.30);background:rgba(20,14,28,.55);-webkit-backdrop-filter:blur(8px);backdrop-filter:blur(8px);color:#eee7f4;display:flex;align-items:center;justify-content:center;cursor:pointer;padding:0;z-index:2;transition:background .15s,transform .12s}.idx-gear:active{transform:scale(.92)}.idx-gear svg{width:18px;height:18px;fill:currentColor}@media(hover:hover){.idx-gear:hover{background:rgba(60,38,80,.65)}}",
      ".idx-seek-wrap{margin:14px 0 0;background:transparent;border:0;border-radius:0;padding:0}.idx-seek{width:100%;height:24px;margin:0;accent-color:#c88ee9;cursor:pointer}.idx-time{display:flex;justify-content:space-between;font-size:12px;color:rgba(238,231,244,.68);font-variant-numeric:tabular-nums;margin-top:4px}.idx-progress-line{height:20px;min-height:20px;margin-top:6px;color:rgba(238,231,244,.62);font-size:12px;line-height:20px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;text-align:center}.idx-progress-line.idx-progress-empty{visibility:hidden}",
      ".idx-subtitle{position:relative;display:flex;flex-direction:column;gap:3px;margin:12px 0 0;padding:28px 10px 9px;background:linear-gradient(180deg,rgba(60,36,84,.30) 0%,rgba(40,24,56,.48) 50%,rgba(60,36,84,.30) 100%);border:1px solid rgba(206,170,230,.18);border-radius:14px;height:172px;min-height:172px;max-height:172px;overflow-y:auto;scroll-behavior:auto;-webkit-overflow-scrolling:touch;mask-image:linear-gradient(to bottom,transparent 0,#000 14%,#000 86%,transparent 100%);-webkit-mask-image:linear-gradient(to bottom,transparent 0,#000 14%,#000 86%,transparent 100%)}.idx-subtitle.idx-hidden{display:none}.idx-sub-row{display:flex;align-items:center;justify-content:center;min-height:31px;padding:5px 8px;border-radius:10px;flex-shrink:0;text-align:center;cursor:pointer;color:rgba(244,231,255,.42);font-size:13px;line-height:1.32;font-weight:500;transition:color .18s,background .18s,box-shadow .18s}.idx-sub-row:hover{background:rgba(255,255,255,.04)}.idx-sub-row.is-current{color:#fff;font-size:13px;font-weight:800;background:rgba(216,167,255,.10);box-shadow:inset 3px 0 0 rgba(216,167,255,.75)}.idx-sub-row.is-past{color:rgba(244,231,255,.30)}.idx-sub-notice{margin:auto;text-align:center;color:rgba(244,231,255,.78);font-size:13px;line-height:1.45;max-width:92%;padding:10px 8px}.idx-sub-notice strong{display:block;color:#fff;font-size:15px;margin-bottom:4px}.idx-sub-notice span{display:block;color:rgba(244,231,255,.56);font-size:12px}.idx-sub-avatar{width:24px;height:24px;border-radius:50%;background:#241a2c;object-fit:cover;border:1.5px solid rgba(206,170,230,.40);opacity:.85}.idx-sub-avatar.idx-hidden{display:none}.idx-sub-text{display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;word-break:break-word;max-width:100%}",
      ".idx-controls{display:flex;align-items:center;justify-content:center;gap:12px;margin-top:14px;margin-bottom:6px;min-height:66px;flex-wrap:wrap}.idx-ctrl{border:1px solid rgba(206,170,230,.16);border-radius:50%;background:rgba(206,170,230,.08);color:#eee7f4;cursor:pointer;display:flex;align-items:center;justify-content:center;padding:0;-webkit-tap-highlight-color:transparent;transition:background-color .12s ease}@media(hover:hover){.idx-ctrl:hover{background:rgba(206,170,230,.16)}}.idx-ctrl:focus{outline:none}.idx-ctrl svg{width:20px;height:20px;fill:none;stroke:currentColor;stroke-width:2.3;stroke-linecap:round;stroke-linejoin:round;transform-origin:center;transform-box:fill-box}.idx-ctrl-sm{width:42px;height:42px}.idx-ctrl-skip{width:42px;height:42px;background:rgba(130,190,255,.10);color:#cfe6ff}.idx-ctrl-skip svg{width:22px;height:22px}.idx-ctrl-main{width:66px;height:66px;background:#c890e8;color:#170e20;border-color:rgba(255,255,255,.18);box-shadow:0 10px 24px rgba(200,144,232,.25)}.idx-ctrl-main[data-state='playing']{background:#e1b0f5}.idx-ctrl-main svg{width:28px;height:28px;fill:currentColor;stroke:none}.idx-ctrl-main[data-state='loading'] svg{animation:idx-spin .9s linear infinite;will-change:transform}@keyframes idx-spin{to{transform:rotate(360deg)}}.idx-ctrl-add{width:66px;height:66px;background:rgba(154,94,182,.42);color:#f4e7ff;box-shadow:0 10px 24px rgba(154,94,182,.18)}.idx-ctrl-add svg,.idx-ctrl-delete svg,.idx-header-delete svg{width:28px;height:28px;fill:currentColor;stroke:none}.idx-ctrl-delete{width:48px;height:48px;background:rgba(120,38,52,.46);color:#ffd5dd}.idx-live-exit{width:56px;height:56px;background:rgba(150,38,58,.70);color:#ffe6ea;border-color:rgba(255,150,170,.32);box-shadow:0 10px 24px rgba(150,38,58,.18)}.idx-live-exit svg{width:24px;height:24px}.idx-ctrl:disabled,.idx-header-delete:disabled{opacity:.42;cursor:not-allowed;filter:grayscale(.25)}",
      ".idx-meta{display:flex;align-items:center;justify-content:center;gap:8px;flex-wrap:wrap;margin-top:12px}.idx-pill{font-size:11px;color:rgba(238,231,244,.75);background:rgba(255,255,255,.06);border:1px solid rgba(206,170,230,.14);border-radius:999px;padding:4px 9px;max-width:100%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.idx-playback-toggle{position:absolute;right:102px;top:14px;height:32px;min-width:70px;padding:0 10px;border:1px solid rgba(126,205,255,.34);border-radius:999px;background:rgba(40,94,128,.38);color:#d8f1ff;font-size:11px;font-weight:900;font-family:inherit;cursor:pointer;z-index:2}.idx-playback-toggle[data-mode='generate']{border-color:rgba(255,202,126,.38);background:rgba(128,86,32,.42);color:#ffe5b8}",
      ".idx-panel,.idx-panel *{box-sizing:border-box}.idx-panel:focus,.idx-picker:focus,.idx-panel:focus-visible,.idx-picker:focus-visible{outline:none!important;outline-width:0!important;outline-offset:0!important}.idx-panel{margin:auto auto 8px auto;border:1px solid rgba(206,170,230,.22);border-top-left-radius:18px;border-top-right-radius:18px;border-bottom-left-radius:0;border-bottom-right-radius:0;background:rgba(12,8,18,.985);color:#eee7f4;width:100%;max-width:100vw;height:auto;max-height:min(88dvh,calc(100dvh - 12px));overflow-y:auto;overscroll-behavior:contain;-webkit-overflow-scrolling:touch;box-shadow:0 -8px 32px rgba(0,0,0,.45),inset 0 1px 0 rgba(255,255,255,.05);padding:14px;padding-bottom:calc(18px + env(safe-area-inset-bottom,0px))}.idx-panel::backdrop{background:rgba(0,0,0,.55);backdrop-filter:blur(3px)}.idx-panel-head{display:flex;align-items:center;justify-content:space-between;gap:10px;margin:-14px -14px 10px;padding:12px 14px 10px;position:sticky;top:-14px;background:linear-gradient(180deg,#120e18 0%,rgba(18,14,24,.94) 100%);z-index:2}.idx-panel-title{font-size:14px;font-weight:800;color:#e9c8ff}.idx-close{border:0;background:transparent;color:rgba(238,231,244,.70);font-size:22px;line-height:1;cursor:pointer;padding:0 6px}",
      ".idx-section-title{font-size:12px;font-weight:700;color:#d9b7f0;margin:10px 0 5px}.idx-voices{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px}.idx-voice{min-height:58px;border:1px solid rgba(206,170,230,.16);border-radius:8px;background:rgba(255,255,255,.06);color:#eee7f4;text-align:left;padding:9px;cursor:pointer;font-family:inherit;position:relative;overflow:hidden}.idx-voice:before{content:'';position:absolute;left:0;right:0;bottom:0;height:4px;background:linear-gradient(90deg,#c890e8,#d8a7ff);opacity:.30}.idx-voice strong{display:block;font-size:13px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.idx-voice span{display:block;margin-top:4px;font-size:11px;color:rgba(238,231,244,.56)}.idx-voice.is-active{border-color:#c890e8;background:rgba(200,144,232,.16);box-shadow:0 0 0 2px rgba(200,144,232,.12)}",
      ".idx-modes{display:grid;grid-template-columns:repeat(2,1fr);gap:7px}.idx-mode{border:1px solid rgba(206,170,230,.16);border-radius:8px;background:rgba(255,255,255,.06);color:#eee7f4;text-align:left;padding:9px;cursor:pointer;font-family:inherit}.idx-mode strong{display:block;font-size:12px}.idx-mode span{display:block;margin-top:3px;font-size:11px;color:rgba(238,231,244,.56)}.idx-mode.is-active{border-color:#c890e8;background:rgba(200,144,232,.16);box-shadow:0 0 0 2px rgba(200,144,232,.10)}",
      ".idx-check{display:flex;align-items:flex-start;gap:8px;margin:10px 0 4px;padding:9px;border:1px solid rgba(206,170,230,.16);border-radius:9px;background:rgba(255,255,255,.04);cursor:pointer}.idx-check input{margin:2px 0 0;accent-color:#c890e8}.idx-check strong{display:block;font-size:12px;color:#eee7f4}.idx-check span{display:block;margin-top:3px;font-size:11px;color:rgba(238,231,244,.56);line-height:1.35}",
      ".idx-label{font-size:11px;color:rgba(238,231,244,.66)}.idx-input,.idx-textarea{width:100%;border:1px solid rgba(206,170,230,.16);border-radius:9px;background:#0b0810;color:#eee7f4;padding:8px;font-size:12px;font-family:inherit;outline:none}.idx-btn{height:32px;border:1px solid rgba(206,170,230,.20);border-radius:9px;background:rgba(255,255,255,.06);color:#eee7f4;padding:0 10px;font-size:12px;cursor:pointer;font-family:inherit}.idx-error{margin-top:10px;color:#ffd5dd;background:rgba(120,38,52,.22);border:1px solid rgba(255,120,145,.28);border-radius:10px;padding:8px;font-size:12px;white-space:pre-wrap;overflow-wrap:anywhere}",
      // 结构化角色映射 UI
      ".idx-roles{display:flex;flex-direction:column;gap:6px;margin-bottom:8px}.idx-role-row{display:grid;grid-template-columns:96px 1fr 28px;gap:6px;align-items:center}.idx-role-name{min-width:0;border:1px solid rgba(206,170,230,.16);background:#0b0810;color:#eee7f4;border-radius:8px;padding:6px 8px;font-size:12px;font-family:inherit;outline:none}.idx-voice-btn{min-width:0;border:1px solid rgba(206,170,230,.20);background:rgba(206,170,230,.08);color:#eee7f4;border-radius:8px;padding:6px 10px;font-size:12px;cursor:pointer;text-align:left;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;font-family:inherit}.idx-voice-btn:hover{background:rgba(206,170,230,.16)}.idx-role-del{width:28px;height:28px;border:1px solid rgba(255,120,145,.28);background:rgba(120,38,52,.22);color:#ffd5dd;border-radius:8px;cursor:pointer;font-size:14px;line-height:1;font-family:inherit}.idx-role-lock{width:28px;height:28px;display:flex;align-items:center;justify-content:center;color:rgba(238,231,244,.45);font-size:13px;user-select:none;cursor:default}.idx-add-role{margin-top:4px;width:100%;border:1px dashed rgba(206,170,230,.30);background:transparent;color:#d9b7f0;padding:8px;border-radius:9px;cursor:pointer;font-size:12px;font-family:inherit}.idx-add-role:hover{background:rgba(206,170,230,.06)}.idx-llm-details{margin-top:10px;border:1px solid rgba(206,170,230,.16);border-radius:9px;background:rgba(255,255,255,.03);overflow:hidden}.idx-llm-details>summary{list-style:none;cursor:pointer;padding:9px 12px;font-size:12px;font-weight:700;color:#d9b7f0;display:flex;align-items:center;justify-content:space-between;user-select:none}.idx-llm-details>summary::-webkit-details-marker{display:none}.idx-llm-details>summary::after{content:'▾';font-size:10px;color:rgba(238,231,244,.55);transition:transform .2s}.idx-llm-details[open]>summary::after{transform:rotate(180deg)}.idx-llm-details>.idx-grid{padding:8px 12px 12px;border-top:1px solid rgba(206,170,230,.12)}",
      // 音色选择器弹窗
      ".idx-picker{margin:auto auto 0 auto;border:1px solid rgba(206,170,230,.22);border-top-left-radius:18px;border-top-right-radius:18px;border-bottom-left-radius:0;border-bottom-right-radius:0;background:rgba(12,8,18,.985);color:#eee7f4;width:100%;max-width:100vw;height:fit-content;max-height:80vh;box-shadow:0 -8px 32px rgba(0,0,0,.45);padding:14px;padding-bottom:calc(14px + env(safe-area-inset-bottom,0px));display:flex;flex-direction:column;min-height:0}.idx-picker::backdrop{background:rgba(0,0,0,.55);backdrop-filter:blur(3px)}.idx-picker-head{display:flex;align-items:center;justify-content:space-between;padding-bottom:8px;border-bottom:1px solid rgba(206,170,230,.18);margin-bottom:8px}.idx-picker-title{font-size:14px;font-weight:800;color:#e9c8ff}.idx-picker-close{border:0;background:transparent;color:#eee7f4;font-size:22px;cursor:pointer;padding:0 6px;line-height:1}.idx-picker-tabs{display:flex;gap:6px;overflow-x:auto;margin-bottom:8px;flex-wrap:wrap}.idx-picker-tab{flex:0 0 auto;border:1px solid rgba(206,170,230,.16);background:rgba(255,255,255,.04);color:#eee7f4;border-radius:999px;padding:5px 11px;cursor:pointer;font-size:11px;font-family:inherit;white-space:nowrap}.idx-picker-tab.is-active{border-color:#c890e8;background:rgba(200,144,232,.20);color:#fff}.idx-picker-search{margin-bottom:8px}.idx-picker-grid{flex:1 1 auto;min-height:200px;max-height:50vh;overflow-y:auto;display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:6px;align-content:start;padding:2px;width:100%}.idx-picker-item{min-width:0;overflow:hidden;min-height:54px;border:1px solid rgba(206,170,230,.16);border-radius:10px;background:rgba(255,255,255,.05);color:#eee7f4;text-align:left;padding:8px 8px 8px 12px;cursor:pointer;font-family:inherit;font-size:12px;line-height:1.35;display:flex;align-items:center;gap:6px;justify-content:space-between;transition:background .15s,border-color .15s}.idx-picker-item:hover{background:rgba(206,170,230,.14);border-color:rgba(206,170,230,.34)}.idx-picker-item.is-playing{border-color:#c890e8;background:rgba(200,144,232,.18);box-shadow:0 0 0 1px rgba(200,144,232,.22) inset}.idx-picker-item-info{flex:1;min-width:0;overflow:hidden;display:flex;flex-direction:column;justify-content:center}.idx-picker-item-name{font-size:13px;font-weight:600;white-space:nowrap;overflow-x:auto;overflow-y:hidden;text-overflow:clip;display:block;scrollbar-width:none}.idx-picker-item-name::-webkit-scrollbar{display:none}.idx-picker-item-sub{font-size:10px;color:rgba(238,231,244,.55);margin-top:2px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.idx-picker-apply{flex:0 0 auto;width:30px;height:30px;border-radius:50%;border:1px solid rgba(200,144,232,.45);background:rgba(200,144,232,.18);color:#fff;cursor:pointer;font-size:14px;font-weight:700;display:flex;align-items:center;justify-content:center;font-family:inherit;padding:0;line-height:1}.idx-picker-apply:hover{background:#c890e8;color:#170e20;border-color:#c890e8;transform:scale(1.05)}.idx-picker-apply:active{transform:scale(.95)}.idx-picker-pager{display:flex;align-items:center;justify-content:center;gap:12px;padding-top:8px;border-top:1px solid rgba(206,170,230,.14);color:rgba(238,231,244,.72);font-size:11px}.idx-picker-pager button{border:1px solid rgba(206,170,230,.20);background:rgba(255,255,255,.06);color:#eee7f4;border-radius:7px;padding:3px 10px;cursor:pointer;font-family:inherit;font-size:11px}.idx-picker-pager button:disabled{opacity:.4;cursor:not-allowed}",
      ".idx-card audio{display:none!important}.idx-info{padding-right:0}.idx-card-counter{position:absolute;right:10px;top:8px;min-width:48px;height:24px;padding:0 9px;border:1px solid rgba(206,170,230,.20);border-radius:999px;background:rgba(20,14,28,.58);color:rgba(238,231,244,.78);font-size:11px;font-weight:800;font-variant-numeric:tabular-nums;display:flex;align-items:center;justify-content:center;z-index:1;pointer-events:none;-webkit-backdrop-filter:blur(8px);backdrop-filter:blur(8px)}.idx-header-delete{position:absolute;right:142px;top:14px;width:42px;height:32px;border:1px solid rgba(255,120,145,.28);border-radius:999px;background:rgba(120,38,52,.32);color:#ffd5dd;display:flex;align-items:center;justify-content:center;cursor:pointer;padding:0;z-index:2;-webkit-backdrop-filter:blur(8px);backdrop-filter:blur(8px);box-shadow:inset 0 1px 0 rgba(255,255,255,.06)}.idx-normal-voices{display:grid;grid-template-columns:1fr;gap:7px}.idx-gear svg{width:19px;height:19px;fill:none!important;stroke:currentColor}",
      ".idx-seek{-webkit-appearance:none;appearance:none;height:36px;background:transparent;accent-color:auto}.idx-seek::-webkit-slider-runnable-track{height:9px;border-radius:999px;background:linear-gradient(90deg,rgba(216,167,255,.85),rgba(130,190,255,.72));box-shadow:inset 0 0 0 1px rgba(255,255,255,.10)}.idx-seek::-webkit-slider-thumb{-webkit-appearance:none;appearance:none;width:28px;height:28px;margin-top:-9.5px;border-radius:50%;border:3px solid #fff;background:#c890e8;box-shadow:0 0 0 6px rgba(200,144,232,.20),0 5px 16px rgba(0,0,0,.42)}.idx-seek::-moz-range-track{height:9px;border-radius:999px;background:linear-gradient(90deg,rgba(216,167,255,.85),rgba(130,190,255,.72))}.idx-seek::-moz-range-thumb{width:26px;height:26px;border-radius:50%;border:3px solid #fff;background:#c890e8;box-shadow:0 0 0 6px rgba(200,144,232,.20)}",
      ".idx-panel{width:min(760px,calc(100vw - 24px));max-width:760px;max-height:min(88dvh,calc(100dvh - 12px));margin:auto auto 8px auto;border-top-left-radius:18px;border-top-right-radius:18px;border-bottom-left-radius:0;border-bottom-right-radius:0;background:rgba(12,8,18,.985);scrollbar-width:thin}.idx-panel::-webkit-scrollbar{width:6px}.idx-panel::-webkit-scrollbar-thumb{background:rgba(216,167,255,.28);border-radius:999px}.idx-panel-head{top:-14px}.idx-grid{display:grid;grid-template-columns:1fr 1fr;gap:12px}.idx-field{display:flex;flex-direction:column;gap:5px;min-width:0}.idx-field.idx-wide{grid-column:1/-1}.idx-actions{position:sticky;bottom:-18px;z-index:2;display:flex;justify-content:flex-end;gap:12px;margin:14px -14px -18px;padding:12px 14px calc(14px + env(safe-area-inset-bottom,0px));border-top:1px solid rgba(206,170,230,.12);background:linear-gradient(180deg,rgba(12,8,18,.74) 0%,rgba(12,8,18,.985) 34%,rgba(12,8,18,.985) 100%);backdrop-filter:blur(8px)}",
      ".idx-picker,.idx-picker-grid{scrollbar-width:none}.idx-picker::-webkit-scrollbar,.idx-picker-grid::-webkit-scrollbar,.idx-subtitle::-webkit-scrollbar{display:none}.idx-picker-item.is-selected{border-color:#d8a7ff;background:rgba(200,144,232,.20);box-shadow:0 0 0 1px rgba(216,167,255,.24) inset,0 0 18px rgba(200,144,232,.14)}.idx-picker-selected{flex:0 0 auto;width:20px;height:20px;border-radius:50%;background:#d8a7ff;color:#160d1f;font-size:12px;font-weight:900;display:none;align-items:center;justify-content:center}.idx-picker-item.is-selected .idx-picker-selected{display:flex}.idx-picker-wave{flex:0 0 auto;width:24px;height:18px;display:none;align-items:center;justify-content:center;gap:2px}.idx-picker-item.is-selected .idx-picker-wave,.idx-picker-item.is-playing .idx-picker-wave{display:flex}.idx-picker-wave i{width:3px;border-radius:999px;background:#d8a7ff;opacity:.85;animation:idx-wave .78s ease-in-out infinite}.idx-picker-wave i:nth-child(2){animation-delay:.12s}.idx-picker-wave i:nth-child(3){animation-delay:.24s}@keyframes idx-wave{0%,100%{height:5px;opacity:.45}50%{height:17px;opacity:1}}",
      ".idx-close,.idx-picker-close{width:32px;height:32px;flex:0 0 32px;border:1px solid rgba(206,170,230,.22);border-radius:50%;background:rgba(255,255,255,.06);color:rgba(238,231,244,.82);font-size:20px;line-height:1;cursor:pointer;padding:0;display:flex;align-items:center;justify-content:center;font-family:Arial,'Microsoft YaHei',sans-serif}.idx-close:hover,.idx-picker-close:hover{background:rgba(206,170,230,.14);color:#fff}.idx-close:active,.idx-picker-close:active{transform:scale(.94)}.idx-panel{position:fixed;left:var(--idx-layer-left,max(12px,env(safe-area-inset-left,0px)));right:auto;top:var(--idx-layer-top,max(12px,env(safe-area-inset-top,0px)));bottom:auto;transform:none;width:var(--idx-layer-width,min(760px,calc(100vw - 24px)));max-width:calc(100vw - 16px);height:var(--idx-layer-height,560px);max-height:calc(100vh - 16px);margin:0;overflow-x:hidden;overflow-y:auto;border-radius:18px}.idx-picker{position:fixed;left:var(--idx-layer-left,max(12px,env(safe-area-inset-left,0px)));right:auto;top:var(--idx-layer-top,max(12px,env(safe-area-inset-top,0px)));bottom:auto;transform:none;width:var(--idx-layer-width,min(760px,calc(100vw - 24px)));max-width:calc(100vw - 16px);height:var(--idx-layer-height,570px);max-height:calc(100vh - 16px);margin:0;border-radius:18px}",
      "@media(max-width:520px){.idx-card{min-height:354px;padding:14px;border-radius:16px}.idx-top{padding-top:36px}.idx-info{padding-right:0}.idx-card-counter{right:8px;top:8px;height:22px;min-width:40px;padding:0 8px}.idx-header-delete{right:138px;top:16px;width:40px;height:30px}.idx-playback-toggle{right:56px;top:16px;height:30px;min-width:74px;padding:0 8px}.idx-panel{width:calc(100vw - 16px);max-height:min(90dvh,calc(100dvh - 10px));border-top-left-radius:16px;border-top-right-radius:16px;border-bottom-left-radius:0;border-bottom-right-radius:0}.idx-actions{justify-content:stretch}.idx-actions .idx-btn{flex:1;min-width:0}.idx-controls{gap:10px}.idx-ctrl-sm{width:40px;height:40px}.idx-ctrl-main,.idx-ctrl-add{width:62px;height:62px}.idx-grid{grid-template-columns:1fr}.idx-voices{grid-template-columns:1fr 1fr}.idx-role-row{grid-template-columns:84px 1fr 26px}.idx-picker-grid{grid-template-columns:1fr 1fr}}",
      ".idx-gear,.idx-playback-toggle,.idx-header-delete{top:14px;height:32px;border:1px solid rgba(206,170,230,.24);background:rgba(20,14,28,.46);-webkit-backdrop-filter:blur(8px);backdrop-filter:blur(8px);color:rgba(238,231,244,.86);box-shadow:inset 0 1px 0 rgba(255,255,255,.06);z-index:2}.idx-gear{right:14px;width:38px}.idx-playback-toggle{right:60px;min-width:74px;padding:0 10px;font-size:11px;font-weight:850}.idx-header-delete{right:142px;width:42px;border-color:rgba(255,120,145,.28);background:rgba(120,38,52,.32);color:#ffd5dd}.idx-playback-toggle[data-mode='live']{border-color:rgba(126,205,255,.22);background:rgba(20,14,28,.46);color:rgba(216,241,255,.88)}.idx-playback-toggle[data-mode='generate']{border-color:rgba(255,202,126,.24);background:rgba(20,14,28,.46);color:rgba(255,229,184,.88)}.idx-gear svg{width:16px;height:16px;opacity:.86;stroke-width:1.8}.idx-header-delete svg{width:18px;height:18px}.idx-normal-voices{display:flex;flex-direction:column;gap:6px}.idx-normal-voice-row .idx-role-name{cursor:default;color:rgba(238,231,244,.74)}.idx-normal-voice-row .idx-voice-btn{font-weight:650;color:rgba(238,231,244,.88)}.idx-normal-voice-row .idx-voice-readonly{cursor:default;color:rgba(238,231,244,.62);background:rgba(206,170,230,.05)}.idx-normal-voice-row .idx-voice-readonly:hover{background:rgba(206,170,230,.05)}@media(max-width:520px){.idx-gear,.idx-playback-toggle,.idx-header-delete{top:16px;height:30px}.idx-gear{right:14px;width:34px}.idx-playback-toggle{right:56px;min-width:74px;padding:0 8px}.idx-header-delete{right:138px;width:40px}.idx-gear svg{width:15px;height:15px}}"
    ].join("");
    style.textContent += [
      ".idx-top{padding-top:0!important;padding-right:94px;min-height:56px}",
      ".idx-info{padding-right:0!important}",
      ".idx-status{white-space:nowrap!important;display:block!important;max-height:18px!important;overflow:hidden!important;text-overflow:ellipsis!important;-webkit-line-clamp:initial!important;overflow-wrap:normal!important}",
      ".idx-subtitle{mask-image:none!important;-webkit-mask-image:none!important}",
      ".idx-gear,.idx-playback-toggle{top:26px!important;height:36px!important;border-radius:999px!important}",
      ".idx-gear{right:14px!important;width:42px!important}",
      ".idx-playback-toggle{right:60px!important;width:38px!important;min-width:38px!important;padding:0!important;display:flex!important;align-items:center!important;justify-content:center!important}",
      ".idx-sub-delete{position:absolute;left:10px;top:8px;width:26px;height:24px;border:1px solid rgba(255,120,145,.26);border-radius:999px;background:rgba(120,38,52,.30);color:#ffd5dd;display:flex;align-items:center;justify-content:center;cursor:pointer;padding:0;z-index:2;-webkit-backdrop-filter:blur(8px);backdrop-filter:blur(8px)}",
      ".idx-sub-delete svg{width:14px;height:14px;fill:currentColor;stroke:none}",
      ".idx-sub-delete:disabled{opacity:.42;cursor:not-allowed}",
      ".idx-card-counter{right:10px!important;top:8px!important}",
      ".idx-live-exit{width:66px!important;height:66px!important;min-width:66px!important;min-height:66px!important;border-radius:50%!important;padding:0!important;font-size:0!important;box-shadow:0 10px 24px rgba(150,38,58,.18)!important}",
      ".idx-live-exit svg{width:26px!important;height:26px!important}",
      ".idx-card{height:470px!important;min-height:470px!important;display:flex!important;flex-direction:column!important}",
      ".idx-seek-wrap{flex:0 0 auto!important}.idx-progress-line{flex:0 0 20px!important}.idx-subtitle{height:172px!important;min-height:172px!important;max-height:172px!important;flex:0 0 172px!important;padding:28px 10px 9px!important}.idx-sub-row{min-height:31px!important;padding:5px 8px!important}.idx-controls{flex:0 0 74px!important;gap:16px!important;flex-wrap:nowrap!important;margin-top:18px!important;margin-bottom:6px!important}.idx-ctrl-add{margin-left:22px!important}",
      "@media(max-width:520px){.idx-card{height:450px!important;min-height:450px!important}.idx-top{padding-top:0!important;padding-right:84px;min-height:56px}.idx-status{max-height:18px!important}.idx-gear,.idx-playback-toggle{top:25px!important;height:34px!important}.idx-gear{right:14px!important;width:40px!important}.idx-playback-toggle{right:58px!important;width:34px!important;min-width:34px!important}.idx-sub-delete{left:8px;top:8px;width:24px;height:22px}.idx-controls{gap:13px!important}.idx-ctrl-add{margin-left:16px!important}.idx-live-exit{width:62px!important;height:62px!important;min-width:62px!important;min-height:62px!important}}"
    ].join("");
    document.head.appendChild(style);
    ensureSkinStyle();
  }

  async function getConfig() {
    var saved = null;
    try { if (window.tavo && typeof tavo.get === "function") saved = await tavo.get(CONFIG_KEY, "global"); } catch (_) {}
    if (!saved) { try { saved = JSON.parse(localStorage.getItem(CONFIG_KEY) || "null"); } catch (_) {} }
    var savedVersion = Number(saved && saved.configVersion || 0) || 0;
    var cfg = Object.assign({}, DEFAULT_CONFIG, pickGlobalConfig(saved || {}));
    if (savedVersion < CONFIG_VERSION) {
      if (savedVersion < 7 && cfg.qualityMode === "fast") cfg.qualityMode = "balanced";
      if (Number(cfg.topP) === 0.72 || Number(cfg.topP) === 0.78 || Number(cfg.topP) === 0.85) cfg.topP = 0.8;
      if (Number(cfg.temperature) === 0.62 || Number(cfg.temperature) === 0.72 || Number(cfg.temperature) === 0.78 || Number(cfg.temperature) === 0.8 || Number(cfg.temperature) === 0.85) cfg.temperature = 0.7;
      if (Number(cfg.repetitionPenalty) === 2 || Number(cfg.repetitionPenalty) === 8 || Number(cfg.repetitionPenalty) === 10) cfg.repetitionPenalty = 1.2;
      if (Number(cfg.emoAlpha) === 0.7 || Number(cfg.emoAlpha) === 0.75 || Number(cfg.emoAlpha) === 0.55) cfg.emoAlpha = 0.38;
      if (Number(cfg.speedFactor) === 1.08) cfg.speedFactor = 1.0;
      if (savedVersion < 12) cfg.playbackMode = "live";
    }
    cfg.configVersion = CONFIG_VERSION;
    cfg.mode = normalizeModeName(cfg.mode);
    cfg.playbackMode = normalizePlaybackMode(cfg.playbackMode);
    // 强制把 apiBase 锁死成本次加载脚本的来源 —— 用户换 LAN/外网/隧道 URL 时
    // 不会被 localStorage 里残留的旧 apiBase 拖累，所有请求一定打回脚本同源。
    cfg.apiBase = scriptOrigin();
    if (cfg.roleVoicesText && !/^\s*旁白\s*[=:：]/m.test(cfg.roleVoicesText)) {
      var m = String(cfg.roleVoicesText).match(/^\s*narrator\s*[=:：]\s*(.+)$/m);
      if (m && m[1]) cfg.roleVoicesText = "旁白=" + m[1].trim() + "\n" + cfg.roleVoicesText;
    }
    // 旧版用户的 cfg 没有 roleVoiceList —— 从 roleVoicesText 迁移过来
    if (!Array.isArray(cfg.roleVoiceList) || cfg.roleVoiceList.length === 0) {
      cfg.roleVoiceList = parseRoleVoiceText(cfg.roleVoicesText || "");
    }
    return cfg;
  }
  function pickGlobalConfig(cfg) {
    var out = {};
    if (!cfg || typeof cfg !== "object") return out;
    GLOBAL_CONFIG_FIELDS.forEach(function (key) {
      if (cfg[key] !== undefined) out[key] = cfg[key];
    });
    return out;
  }
  function pickCharacterConfig(cfg) {
    return {
      defaultVoice: cfg.defaultVoice || "",
      characterName: cfg.currentCharacterName || "",
      roleVoiceList: normalizeRoleVoiceList(cfg.roleVoiceList || [], cfg.currentCharacterName),
    };
  }
  // 把旧 textarea 文本(每行/逗号分隔的 role=voice)转成结构化数组
  function parseRoleVoiceText(text) {
    var out = [];
    String(text || "").split(/[\r\n,，;；]+/).forEach(function (line) {
      var m = line.trim().match(/^(.+?)[=:：]\s*(.+)$/);
      if (m) out.push({ role: m[1].trim(), voice: m[2].trim() });
    });
    return out.length ? out : [
      { role: "旁白", voice: "" },
      { role: "用户", voice: "" },
    ];
  }
  // 反向序列化:给老路径(parseRoleVoices)和后端 voices 字典提供数据
  function serializeRoleVoiceList(list) {
    return (list || []).filter(function (r) { return r.role && r.voice; })
      .map(function (r) { return r.role + "=" + r.voice; }).join("\n");
  }
  function rolesListToVoicesMap(list, defaultVoice, characterRoleName) {
    var normalized = normalizeAiRoleVoiceList(list || [], characterRoleName);
    var out = {};
    (normalized || []).forEach(function (r) {
      if (r.role && r.voice) out[r.role] = r.voice;
    });
    return out;
  }
  function voiceForRoleInList(list, names, defaultVoice, characterRoleName) {
    var voice = voiceForRoleNames(normalizeRoleVoiceList(list || [], characterRoleName), names || [], characterRoleName);
    return String(voice || defaultVoice || "").trim();
  }
  function setVoiceForRoleInList(list, role, voice, characterRoleName) {
    list = normalizeRoleVoiceList(list || [], characterRoleName);
    role = canonicalDialogueRoleName(role);
    voice = String(voice || "").trim();
    var found = false;
    list.forEach(function (item) {
      if (String(item.role || "").trim() === role) {
        if (voice || !String(item.voice || "").trim()) item.voice = voice;
        found = true;
      }
    });
    if (!found && role) list.push({ role: role, voice: voice });
    return normalizeRoleVoiceList(list, characterRoleName);
  }
  function normalModeVoicesMap(cfg) {
    var narrator = String((cfg && cfg.defaultVoice) || "").trim();
    var dialogue = "";
    normalizeRoleVoiceList((cfg && cfg.roleVoiceList) || [], cfg && cfg.currentCharacterName).some(function (item) {
      if (!item || !isNormalDialogueRole(item.role)) return false;
      dialogue = String(item.voice || "").trim();
      return !!dialogue;
    });
    var out = {
      default: narrator,
      "旁白": narrator
    };
    if (dialogue) {
      out["对白"] = dialogue;
      out["对话"] = dialogue;
      out["台词"] = dialogue;
      out.dialogue = dialogue;
    }
    return out;
  }
  var OFFLINE_DB_NAME = "indextts_tavo_audio_v1";
  var OFFLINE_DB_STORE = "audio";
  var OFFLINE_DB_PROMISE = null;
  function offlineAudioKey(cacheKey) {
    cacheKey = String(cacheKey || "").trim();
    return cacheKey ? "cache:" + cacheKey : "";
  }
  function openOfflineAudioDb() {
    if (!("indexedDB" in window)) return Promise.reject(new Error("当前 WebView 不支持 IndexedDB"));
    if (OFFLINE_DB_PROMISE) return OFFLINE_DB_PROMISE;
    OFFLINE_DB_PROMISE = new Promise(function (resolve, reject) {
      var req;
      try { req = indexedDB.open(OFFLINE_DB_NAME, 1); }
      catch (e) { reject(e); return; }
      req.onupgradeneeded = function () {
        var db = req.result;
        if (!db.objectStoreNames.contains(OFFLINE_DB_STORE)) db.createObjectStore(OFFLINE_DB_STORE, { keyPath: "key" });
      };
      req.onsuccess = function () { resolve(req.result); };
      req.onerror = function () { reject(req.error || new Error("IndexedDB 打开失败")); };
      req.onblocked = function () { reject(new Error("IndexedDB 被旧页面占用")); };
    });
    return OFFLINE_DB_PROMISE;
  }
  function offlineDbRequest(mode, fn) {
    return openOfflineAudioDb().then(function (db) {
      return new Promise(function (resolve, reject) {
        var tx = db.transaction(OFFLINE_DB_STORE, mode);
        var store = tx.objectStore(OFFLINE_DB_STORE);
        var req;
        try { req = fn(store); } catch (e) { reject(e); return; }
        req.onsuccess = function () { resolve(req.result); };
        req.onerror = function () { reject(req.error || tx.error || new Error("IndexedDB 操作失败")); };
      });
    });
  }
  function getOfflineAudioRecord(key) {
    if (!key) return Promise.resolve(null);
    return offlineDbRequest("readonly", function (store) { return store.get(key); }).catch(function () { return null; });
  }
  function putOfflineAudioRecord(record) {
    return offlineDbRequest("readwrite", function (store) { return store.put(record); });
  }
  function deleteOfflineAudioRecord(key) {
    if (!key) return Promise.resolve(false);
    return offlineDbRequest("readwrite", function (store) { return store.delete(key); }).then(function () { return true; }).catch(function () { return false; });
  }
  async function saveConfig(cfg, characterId) {
    // 写入前 normalize 一次,杜绝脏数据回到 storage
    if (Array.isArray(cfg.roleVoiceList)) cfg.roleVoiceList = normalizeRoleVoiceList(cfg.roleVoiceList, cfg.currentCharacterName);
    // 全局只保存 LLM/api/mode/推理参数，不保存任何音色。
    var globalCfg = pickGlobalConfig(cfg);
    if (window.tavo && typeof tavo.set === "function") await tavo.set(CONFIG_KEY, globalCfg, "global");
    try { localStorage.setItem(CONFIG_KEY, JSON.stringify(globalCfg)); } catch (_) {}
    // 角色级: defaultVoice + roleVoiceList 写 TAVO character scope。
    await saveCharacterCfg(characterId, pickCharacterConfig(cfg));
  }
  function pickAvatarUrl(obj) {
    if (!obj || typeof obj !== "object") return "";
    var keys = ["avatar", "avatarUrl", "avatar_url", "icon", "iconUrl", "image", "imageUrl", "photo", "profileImage", "profile_image"];
    for (var i = 0; i < keys.length; i++) {
      var v = obj[keys[i]];
      if (typeof v === "string" && v.trim()) return v.trim();
      if (v && typeof v === "object") {
        var nested = pickAvatarUrl(v);
        if (nested) return nested;
      }
    }
    return "";
  }

  function decodeHtmlEntitiesForTts(value) {
    var text = String(value == null ? "" : value);
    if (!/[&][A-Za-z#0-9]+;/.test(text)) return text;
    try {
      var textarea = document.createElement("textarea");
      textarea.innerHTML = text;
      return textarea.value || text;
    } catch (_) {
      return text;
    }
  }
  function normalizeMessageTextForTts(value) {
    return String(value == null ? "" : value)
      .replace(/\[IndexTTS_TAVO_SCRIPT\]/g, "")
      .replace(/https?:\/\/\S+\/static\/tavo\.js(?:\?\S*)?/gi, "")
      .replace(/\u200b|\u200c|\u200d|\ufeff/g, "")
      .replace(/\r/g, "\n")
      .replace(/[ \t]+\n/g, "\n")
      .replace(/\n{3,}/g, "\n\n")
      .replace(/[ \t]{2,}/g, " ")
      .trim();
  }
  function removeEmojiSymbolsForTts(value) {
    var text = String(value == null ? "" : value);
    try {
      return text
        .replace(new RegExp("[\\p{Extended_Pictographic}\\p{Emoji_Presentation}\\uFE0F]", "gu"), "")
        .replace(/\u200d/g, "");
    } catch (_) {
      return text
        .replace(/[\u2600-\u27BF]\uFE0F?/g, "")
        .replace(/[\uD83C-\uDBFF][\uDC00-\uDFFF]/g, "")
        .replace(/\uFE0F|\u200d/g, "");
    }
  }
  function stripTagBlocksForTts(value) {
    var text = String(value == null ? "" : value);
    for (var i = 0; i < 12; i += 1) {
      var before = text;
      text = decodeHtmlEntitiesForTts(text);
      text = text.replace(/<!--[\s\S]*?-->/g, "\n");
      text = text.replace(/<([A-Za-z][A-Za-z0-9:_-]*)(?:\s[^>]*)?>[\s\S]*?<\/\1\s*>/gi, "\n");
      text = text.replace(/<\s*(?:br|hr|img|input|meta|link|source|track|wbr|area|base|col|embed|param)\b[^>]*\/?\s*>/gi, "\n");
      text = text.replace(/<[^>]+>/g, "\n");
      if (text === before) break;
    }
    return text;
  }
  function stripResidualTagNoiseForTts(value) {
    var text = String(value == null ? "" : value);
    for (var i = 0; i < 8; i += 1) {
      var before = text;
      text = decodeHtmlEntitiesForTts(text);
      text = text.replace(/<\/?[^<>\s]+(?:\s[^<>]*)?>/g, "\n");
      text = text.replace(/[<>]/g, "\n");
      if (text === before) break;
    }
    return text;
  }
  function cleanRawMessageText(value) {
    var text = stripTagBlocksForTts(value);
    text = text.replace(/\[[A-Za-z0-9_-]*TAVO[A-Za-z0-9_-]*\]/gi, "\n");
    text = text.replace(/\[IndexTTS_TAVO_SCRIPT\]/gi, "\n");
    text = stripResidualTagNoiseForTts(text);
    text = removeEmojiSymbolsForTts(text);
    return normalizeMessageTextForTts(text);
  }
  function cleanDomMessageText(el) {
    if (!el) return "";
    try {
      var clone = el.cloneNode(true);
      clone.querySelectorAll([
        '.idx-tts',
        '.idx-card',
        '.idx-panel',
        '.idx-picker',
        '.idx-global-gear',
        '[data-indextts-host]',
        '[data-loader-shell]',
        'script',
        'style',
        'template',
        'noscript',
        'svg',
        'canvas',
        'audio',
        'video',
        'button',
        'input',
        'select',
        'textarea',
        'dialog',
        '[hidden]',
        '[aria-hidden="true"]'
      ].join(',')).forEach(function (n) { n.remove(); });
      return cleanRawMessageText(clone.innerText || clone.textContent || "");
    } catch (_) {
      return cleanRawMessageText((el.innerText || el.textContent || ""));
    }
  }
  function usefulMessageText(text) {
    text = normalizeMessageTextForTts(text);
    return /[\u4e00-\u9fffA-Za-z0-9]/.test(text) ? text : "";
  }

  async function currentMessageContext() {
    var apiText = "";
    var domText = "";
    var msgEl = messageElement(script);
    var avatarUrl = domAvatarUrl(msgEl);
    var characterName = "";
    var characterId = "";
    var messageId = "";
    var userName = "";
    var userAvatarUrl = "";
    try {
      if (window.tavo && tavo.message && typeof tavo.message.current === "function") {
        var msg = await tavo.message.current();
        if (msg && msg.content) {
          apiText = cleanRawMessageText(msg.content);
        }
        if (msg && msg.id != null) messageId = String(msg.id);
        if (msg && msg.characterId != null) {
          characterId = String(msg.characterId);
          if (window.tavo && tavo.character && typeof tavo.character.get === "function") {
            var character = await tavo.character.get(msg.characterId);
            if (character) {
              characterName = character.nickname || character.name || "";
              avatarUrl = avatarUrl || character.avatar || pickAvatarUrl(character);
            }
          }
        }
        avatarUrl = avatarUrl || pickAvatarUrl(msg) || pickAvatarUrl(msg && (msg.character || msg.role || msg.sender || msg.author));
      }
    } catch (_) {}
    try {
      if (window.tavo && tavo.chat && typeof tavo.chat.current === "function") {
        var chat = await tavo.chat.current();
        if (chat && chat.persona) {
          userName = String(chat.persona.name || "").trim();
          userAvatarUrl = userAvatarUrl || pickAvatarUrl(chat.persona);
          if (chat.persona.id != null && window.tavo && tavo.persona && typeof tavo.persona.get === "function") {
            var persona = await tavo.persona.get(chat.persona.id);
            if (persona) {
              userName = String(persona.name || userName || "").trim();
              userAvatarUrl = userAvatarUrl || pickAvatarUrl(persona);
            }
          }
        }
      }
    } catch (_) {}
    try {
      if (!avatarUrl && window.tavo && tavo.character && typeof tavo.character.current === "function") avatarUrl = pickAvatarUrl(await tavo.character.current());
      if (!avatarUrl && window.tavo && tavo.role && typeof tavo.role.current === "function") avatarUrl = pickAvatarUrl(await tavo.role.current());
    } catch (_) {}
    if (!avatarUrl) avatarUrl = domAvatarUrl(script && script.parentElement);
    avatarUrl = normalizeTavoAssetUrl(avatarUrl);
    userAvatarUrl = normalizeTavoAssetUrl(userAvatarUrl);
    if (msgEl) domText = cleanDomMessageText(msgEl);
    var finalText = usefulMessageText(apiText) || usefulMessageText(domText) || "";
    return { text: finalText, avatarUrl: avatarUrl, characterName: characterName, characterId: characterId, messageId: messageId, userName: userName, userAvatarUrl: userAvatarUrl };
  }
  // 每条消息的播放历史持久化：key = "indextts_tracks_<messageId>"。
  // 只存可重建的元信息（cacheKey + voice + mode + offlineKey），不存 blob。
  // 重新进页面时优先从 IndexedDB 读离线音频；缺失时通过 /cache_audio/{cacheKey} 接上。
