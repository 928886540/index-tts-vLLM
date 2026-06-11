export function editorPage() {
    return `
        <div id="page-editor" class="page">
            <div class="page-header">
                <button class="btn-secondary" id="btn-back-to-mixer">
                    <svg class="btn-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <line x1="19" y1="12" x2="5" y2="12"></line>
                        <polyline points="12 19 5 12 12 5"></polyline>
                    </svg>
                    返回列表
                </button>
                <h2 class="page-title" id="editor-title">配置详情</h2>
                <div class="editor-file" id="editor-file"></div>
            </div>
            <section class="profile-editor">
                <details class="mixer-guide">
                    <summary>
                        <span class="mixer-guide-title">调音流程</span>
                        <span class="mixer-guide-brief">文本 -> AI 拆段/选声腔 -> 参考音频 -> 合成</span>
                    </summary>
                    <div class="mixer-flow">
                        <div class="flow-step">
                            <b>输入文本</b>
                            <span>Tavo 把消息发给后端</span>
                        </div>
                        <div class="flow-step">
                            <b>AI 分析</b>
                            <span>按规则拆段、选角色和声腔</span>
                        </div>
                        <div class="flow-step">
                            <b>声腔查找</b>
                            <span>用声腔 ID 匹配参考音频</span>
                        </div>
                        <div class="flow-step">
                            <b>合成播放</b>
                            <span>角色音色叠加声腔情绪</span>
                        </div>
                    </div>
                    <div class="mixer-note">
                        先改“声腔选择规则”，再到“声腔库”配置参考音频和强度。
                    </div>
                </details>
                <div class="editor-grid">
                    <label class="field">
                        <span>名称</span>
                        <input id="editor-name" type="text" autocomplete="off">
                    </label>
                    <label class="field">
                        <span>描述</span>
                        <input id="editor-description" type="text" autocomplete="off">
                    </label>
                    <select id="editor-default-mode" hidden></select>
                    <div class="field full">
                        <span>档位与参数</span>
                        <div class="preset-editor" id="editor-preset-fields"></div>
                    </div>
                    <div class="field full section-divider">
                        <div class="section-header">
                            <h3>AI 声腔调教</h3>
                            <p>教 AI 什么时候用哪种声腔、怎么拆段和分配角色</p>
                        </div>
                    </div>
                    <div class="field full">
                        <div class="rules-panel">
                            <label class="field">
                                <span>拆段与说话人规则</span>
                                <textarea id="editor-segment-rules" rows="6" spellcheck="false" placeholder="旁白、对白、引导句怎么拆。"></textarea>
                            </label>
                            <label class="field">
                                <span>声腔选择规则</span>
                                <textarea id="editor-style-selection-rules" rows="5" spellcheck="false" placeholder="什么时候用 neutral、耳语、哭腔、惊喘等声腔。"></textarea>
                            </label>
                            <label class="field">
                                <span>段级情绪补充规则</span>
                                <textarea id="editor-emotion-rules" rows="5" spellcheck="false" placeholder="仅在 style 没配置情绪向量时，才让 LLM 补 emo_vec。"></textarea>
                            </label>
                            <label class="field">
                                <span>完整性规则</span>
                                <textarea id="editor-completeness-rules" rows="5" spellcheck="false" placeholder="必须覆盖原文、不漏段、不乱合并。"></textarea>
                            </label>
                            <label class="field full">
                                <span>补充说明</span>
                                <textarea id="editor-custom-notes" rows="2" spellcheck="false" placeholder="额外规则或注意事项。"></textarea>
                            </label>
                        </div>
                    </div>
                    <div class="field full section-divider">
                        <div class="section-header">
                            <h3>声腔库</h3>
                            <p>每个声腔 ID 对应的参考音频和强度设置</p>
                        </div>
                    </div>
                    <div class="field full">
                        <div class="style-toolbar">
                            <span>声腔列表 <small id="editor-style-count" class="style-count-badge">0 个</small></span>
                            <button class="btn-secondary compact" id="btn-add-style">+ 新增声腔</button>
                        </div>
                        <div class="style-help">
                            例：LLM 把某段标成 <code>style="whisper_soft"</code>，合成时就会使用下方 <code>whisper_soft</code> 卡片配置的参考音频。
                        </div>
                        <datalist id="voice-ref-options"></datalist>
                        <div class="style-list" id="editor-styles"></div>
                    </div>
                    <details class="field full json-details">
                        <summary>JSON 预览</summary>
                        <textarea id="editor-json" rows="12" spellcheck="false" readonly></textarea>
                    </details>
                </div>
                <div class="editor-actions">
                    <button class="btn-secondary" id="btn-save-profile">保存并返回</button>
                    <button class="btn-secondary" id="btn-apply-edited-profile">保存启用并返回</button>
                </div>
            </section>
        </div>
    `;
}
