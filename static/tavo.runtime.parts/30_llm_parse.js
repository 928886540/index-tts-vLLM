// IndexTTS Tavo runtime part: 30_llm_parse.js // Role: LLM parse prompt and normalization // This fragment is concatenated by static/tavo.runtime.js; it is not a standalone script.
  async function parseWithLlm(text, cfg, setStatus, context) {
    var llmStart = Date.now();
    setStatus("步骤 1/3：连接 LLM…");
    debugLog("🤖 LLM 请求开始: model=" + cfg.llmModel + ", endpoint=" + cfg.llmEndpoint + ", textLen=" + text.length, "#ffd479");
    // 把当前角色映射的 role 名作为「已知角色」注入 prompt,让 LLM 输出的 role 字段
    // 跟前端 voicesMap 严格对齐(否则后端归一可能错位)。
    context = context || {};
    var userName = String(context.userName || "").trim();
    var currentCharacterName = String(context.characterName || "").trim();
    var knownRoles = ((cfg.roleVoiceList || []).map(function (r) { return String(r.role || "").trim(); }).filter(function (r) { return r && r !== "角色" && r !== "我"; }));
    if (knownRoles.indexOf("旁白") < 0) knownRoles.unshift("旁白");
    if (knownRoles.indexOf("用户") < 0) knownRoles.splice(1, 0, "用户");
    if (currentCharacterName && knownRoles.indexOf(currentCharacterName) < 0) knownRoles.push(currentCharacterName);
    var rolesHint = "已知角色名单(LLM 输出 role 字段必须从这里选,或者用剧情里出现的新人物名):\n  " + knownRoles.join(" / ") + "\n";
    var userAliasHint = "用户身份名: " + (userName || "未读取到") + "。只有原文中的「你」以及这个用户身份名明确指向玩家/读者时，role 才写 \"用户\"。";
    var characterHint = "当前角色名: " + (currentCharacterName || "未读取到") + "。原文第一人称「我」通常指当前角色或正在自述的人物，不要因为出现「我」就改成用户。";
    var prompt = [
      "你是中文小说→TTS 片段拆分器。只返回严格 JSON，不要任何解释，不要 ``` 代码块。",
      "",
      rolesHint,
      userAliasHint,
      characterHint,
      "输出格式：",
      "{\"segments\":[{\"role\":\"...\",\"text\":\"...\",\"style\":\"neutral\",\"style_alpha\":0.2,\"emo_vec\":[h,a,s,f,d,l,u,n]}]}",
      "",
      "拆段规则：",
      "1. 旁白（叙述、环境、动作描写、心理描写、所有无引号正文）→ role 固定为 \"旁白\"。",
      "   无论主语是不是用户身份名/当前角色名，只要不是引号里的直接台词，都必须写 \"旁白\"。",
      "   例如「白夜雨抱住她」「潘金莲低下头」「她笑了」「我低下头看着……」「白夜雨说道：」都写旁白，不要让用户或角色认领旁白。",
      "   ⚠️ 旁白的 style 永远写 neutral，style_alpha 写 0.15，emo_vec 永远写 [0,0,0,0,0,0,0,1]（纯 neutral）。",
      "       旁白是叙述者，本身没情绪，跟着剧情起伏会做作；后端也会强制覆盖成中性。",
      "   ⚠️ 旁白连续多个句子，要按句号/问号/感叹号/分号 拆成多个旁白 segments，每段≤2 句。",
      "       不要把整段旁白合并成一条 segment 偷懒。例：「她抬头看了我一眼。她哭了。」要拆成两条。",
      "2. 人物直接说出口的话 → role 用说话人的名字。",
      "   - 如果说话人是「你」或用户身份名，role 统一写 \"用户\"（不写 \"你\"、不写用户身份名）。",
      "   - 不要把「我」当作用户；无引号的「我……」默认是第一人称叙述，role 写 \"旁白\"。只有明确处在引号/对白里的「我……」才按说话人归属。",
      "   - 其他人物优先从「已知角色名单」里挑名字;名单外的新人物用原文里的名字（如「林老师」「兰绯」「她」）。",
      "3. 「他说：」「她笑道：」「白夜雨说道：」这类引导句本身永远是旁白；只有后面引号里的直接台词才按说话人分配。",
      "4. text 是要朗读的原文片段，保留标点和语气词（啊、嗯、……）。",
      "5. style 是段级声腔/呼吸参考，只能从这个枚举里选：" + styleIdsText(),
      "   - 旁白、客观描写、普通对白 → neutral。",
      "   - 只是轻微带气声/柔声 → breath_soft 或 whisper_soft。",
      "   - 语义里有急促呼吸、压抑紧张 → tense_breath。",
      "   - 明显呼吸加重但仍在说话 → breath_heavy。",
      "   - 亲密、贴耳、黏连、短促气声 → intimate_breath，style_alpha 0.42-0.60。",
      "   - 明显的「嗯、啊、唔、哈、呼、……」等短促气音/短吟，必须用 moan_soft 或 breath_heavy，不要写 neutral。",
      "   - 委屈、哭腔、鼻音 → sob_soft 或 cry_soft。",
      "   - 撒娇、轻笑、惊讶分别用 tease_soft / laugh_soft / gasp_surprise。",
      "   - 如果文本明显呈现亲密互动的强度变化，用阶段型 style：stage_warmup=轻微升温；stage_rising=呼吸变重；stage_peak=高潮峰值/尖叫；stage_afterglow=余韵/低声放松。",
      "   - 明确是尖叫、峰值、高潮爆发时，可直接用 scream_peak；普通短促呻吟用 moan_soft。",
      "   - 如果想指定某个参考来源，优先用「声腔-人名」格式，例如 喘息-AD学姐、耳语-JOK、哭腔-步非烟；没有合适人名版本再用通用英文 style。",
      "   - 普通对话才用 neutral；亲密/情色场景里的喘息、呻吟、娇喘、抽气、断续语气词绝不能用 neutral，必须选对应声腔。",
      "   - 情色/做爱场景按强度递进选 style：前戏轻喘 → intimate_breath / breath_heavy；动作中持续呻吟 → moan_soft 或 喘息-人名；临近高潮 → stage_rising；高潮 → scream_peak / stage_peak；事后余韵 → low_murmur / stage_afterglow。这类段 style_alpha 给足 0.50-0.70，让气声真正盖上去，别绵软。",
      "",
      "完整性硬规则：",
      "- 必须覆盖输入原文 100%，按原文顺序输出，不要总结、改写、删字、漏掉最后一段。",
      "- 每个原文片段只能出现一次，不要把多段无关尾巴合并成一条对白。",
      "- 如果最后一个引号后还有动作/叙述/心理描写，最后一段必须是 role=\"旁白\"。",
      "- 不确定说话人时用 role=\"旁白\"，不要沿用上一句对白角色。",
      "",
      "emo_vec 是 8 维向量，必须严格按这个顺序（与模型情绪矩阵一致，顺序错位会让整段情绪跑偏）：",
      "  [0]=happy 高兴    [1]=angry 愤怒    [2]=sad 悲伤     [3]=fear 恐惧",
      "  [4]=hate 反感     [5]=low 低落      [6]=surprise 惊讶 [7]=neutral 自然",
      "每个值 0-1。必须根据该段实际语义分析，不是随便填数。",
      "",
      "分析要求（极重要）：",
      "- 每段只激活 1-2 个最匹配的维度，其他全部写 0。多维齐动 = 模型会演得做作。",
      "  ❌ 错误示范：[0,0,0.4,0,0.5,0.6,0.3,0.1]（4 维齐动）",
      "  ✅ 正确示范：[0,0,0.7,0,0,0,0,0.3]（只 sad 主导 + 一点 neutral）",
      "- 平静叙述 / 客观描写 → [0,0,0,0,0,0,0,0.8]。不要混入别的。",
      "- 哭、自责 → sad 主导。例：[0,0,0.7,0,0,0,0,0.2]",
      "- 紧张、害怕 → fear 主导。例：[0,0,0,0.7,0,0,0,0.2]",
      "- 撒娇、温柔 → happy 适中。例：[0.4,0,0,0,0,0,0,0.5]",
      "- 愤怒、咆哮 → angry 主导。例：[0,0.8,0,0,0,0,0,0.1]",
      "- 不要每段写一样；不要全 0；维度数宁少勿多。",
      "",
      "每段可加 emo_alpha 字段（0.12-0.52），控制情绪向量强度：",
      "- 旁白固定 0.12-0.22，平静对白 0.20-0.30，正常带情绪对白 0.32-0.44，强烈台词 0.46-0.52。",
      "- 不要每段都高强度；只有明确哭、怒、恐惧、惊讶、亲密气声时才超过 0.6。",
      "style_alpha 控制声腔/情绪参考音频强度：neutral=0.12-0.20；轻微 style=0.34-0.46；明显 breath/moan/呻吟/喘息 参考=0.50-0.70；高潮 scream_peak/stage_peak 可到 0.70。",
      "",
      "示例输入：",
      "她低着头，眼角有泪。「对不起，我真的撑不住了。」",
      (userName ? userName : "你") + "叹了口气，把手放在她肩上：「别哭。」",
      "示例输出：",
      "{\"segments\":[",
      "  {\"role\":\"旁白\",\"text\":\"她低着头，眼角有泪。\",\"style\":\"neutral\",\"style_alpha\":0.15,\"emo_vec\":[0,0,0,0,0,0,0,1]},",
      "  {\"role\":\"她\",\"text\":\"对不起，我真的撑不住了。\",\"style\":\"sob_soft\",\"style_alpha\":0.42,\"emo_vec\":[0,0,0.48,0.05,0,0.12,0,0.35]},",
      "  {\"role\":\"旁白\",\"text\":\"" + (userName ? userName : "你") + "叹了口气，把手放在她肩上：\",\"style\":\"neutral\",\"style_alpha\":0.15,\"emo_vec\":[0,0,0,0,0,0,0,1]},",
      "  {\"role\":\"用户\",\"text\":\"别哭。\",\"style\":\"whisper_soft\",\"style_alpha\":0.45,\"emo_vec\":[0.2,0,0.3,0,0,0.2,0,0.5]}",
      "]}"
    ].join("\n");
    setStatus("AI 分析中…");
    var maxTokens = llmMaxTokensForText(text);
    var parseUrl = cleanBase(cfg.apiBase) + cfg.parseEndpoint;
    var llmTarget = "后端将访问的 LLM 地址: " + cfg.llmEndpoint;
    debugLog("🔎 LLM 解析代理: parseUrl=" + parseUrl + ", " + llmTarget, "#ffd479");
    var res;
    try {
      res = await fetch(parseUrl, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text: text, endpoint: cfg.llmEndpoint, model: cfg.llmModel, api_key: cfg.llmApiKey || "", system_prompt: prompt, temperature: 0.2, timeout: 90, max_tokens: maxTokens }) });
    } catch (e) {
      throw new Error(formatNetworkError("Tavo AR 到 /parse_text 的请求", parseUrl, e, [
        llmTarget,
        "判断: 不是 LLM 报错。请求没有到达 IndexTTS 的 /parse_text。"
      ]));
    }
    if (!res.ok) throw new Error(formatHttpError("IndexTTS /parse_text", parseUrl, res, await res.text(), [llmTarget]));
    var data;
    try {
      data = await res.json();
    } catch (e) {
      throw new Error([
        "IndexTTS 后端返回了无法解析的内容。",
        "这说明请求已经到达后端,但 /parse_text 没有按 JSON 格式返回;可能是后端代理崩了、LLM 返回格式不对,或后端把错误页/普通文本返回给了前端。",
        "",
        "技术细节:",
        "请求 URL: " + parseUrl,
        llmTarget,
        "解析错误: " + (e && e.message ? e.message : e)
      ].join("\n"));
    }
    if (!data || !Array.isArray(data.segments) || !data.segments.length) throw new Error("AI 没有返回可用片段");
    var llmSec = Math.floor((Date.now() - llmStart) / 1000);
    setStatus("拆分完成 " + data.segments.length + " 段");
    debugLog("✅ LLM 返回 " + data.segments.length + " 段, 用时 " + llmSec + "s", "#9f9");
    try {
      data.segments.forEach(function (s, i) {
        var ev = (s.emo_vec || []).map(function (v) { return Number(v).toFixed(2); }).join(",");
        debugLog("  [raw " + i + "] role=" + (s.role || "?") + "  style=" + normalizeStyleId(s.style || s.style_ref) + (s.style_alpha != null ? "  sα=" + s.style_alpha : "") + "  emo=[" + ev + "]" + (s.emo_alpha != null ? "  α=" + s.emo_alpha : "") + "  text=" + JSON.stringify(String(s.text || "").slice(0, 40)));
      });
    } catch (_) {}
    var normalizedSegments = data.segments.map(function (seg) {
      var style = normalizeStyleId(seg.style || seg.style_ref);
      var styleAlpha = Number(seg.style_alpha);
      if (!isFinite(styleAlpha)) styleAlpha = defaultStyleAlpha(style, cfg);
      styleAlpha = style === "neutral" ? Math.max(0.12, Math.min(0.20, styleAlpha)) : Math.max(0.30, Math.min(0.70, styleAlpha));
      var role = String(seg.role || "旁白").trim();
      if (role === "narrator") {
        role = "旁白";
      } else if (role === "你" || role === "user" || role === "User" || (userName && role === userName)) {
        role = "用户";
      } else if (isCharacterPlaceholderRole(role) && currentCharacterName) {
        role = currentCharacterName;
      }
      if (role === "旁白") {
        style = "neutral";
        styleAlpha = 0.15;
      }
      var emoAlpha = Number(seg.emo_alpha);
      if (!isFinite(emoAlpha)) emoAlpha = role === "旁白" ? 0.18 : (style === "neutral" ? 0.28 : Number(cfg.emoAlpha || 0.38));
      emoAlpha = role === "旁白" ? Math.max(0.12, Math.min(0.22, emoAlpha)) : Math.max(0.18, Math.min(0.52, emoAlpha));
      var emoVec = seg.emo_vec || [0,0,0,0,0,0,0,0.35];
      emoVec = stabilizeEmoVec(emoVec, role, style);
      return {
        role: role || "旁白",
        text: seg.text || "",
        style: style,
        style_alpha: styleAlpha,
        emo_vec: emoVec,
        emo_alpha: emoAlpha
      };
    }).filter(function (seg) { return seg.text.trim(); });
    assertLlmSegmentsCoverSource(text, normalizedSegments);
    return normalizedSegments;
  }
