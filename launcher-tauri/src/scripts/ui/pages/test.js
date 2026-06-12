export function testPage() {
    return `
        <div id="page-test" class="page">
            <div class="page-header">
                <h2 class="page-title">快速测试</h2>
                <div class="page-actions">
                    <button class="btn-secondary" id="btn-clear-history">清空历史</button>
                </div>
            </div>
            <div class="test-layout">
                <section class="test-panel">
                    <div class="test-form">
                        <div class="field">
                            <span>音色</span>
                            <div class="voice-selector">
                                <button class="btn-select" id="btn-select-voice">
                                    <span id="selected-voice-name">点击选择音色</span>
                                </button>
                                <audio id="voice-preview" controls style="display:none;"></audio>
                            </div>
                        </div>
                        <div class="field">
                            <span>声腔</span>
                            <div class="style-selector">
                                <button class="btn-select" id="btn-select-style">
                                    <span id="selected-style-name">点击选择声腔</span>
                                </button>
                                <audio id="style-preview" controls style="display:none;"></audio>
                            </div>
                        </div>
                        <label class="field full">
                            <span>测试文本</span>
                            <textarea id="test-text-input" rows="4" placeholder="输入要测试的文本">你好，这是一段测试语音。</textarea>
                        </label>
                        <div class="test-presets">
                            <span>快速填充：</span>
                            <button class="btn-preset" data-text="你好，很高兴见到你。">问候</button>
                            <button class="btn-preset" data-text="对不起，我错了，请原谅我。">道歉</button>
                            <button class="btn-preset" data-text="太好了！我真的很开心！">兴奋</button>
                            <button class="btn-preset" data-text="呜呜……为什么会这样……">哭泣</button>
                            <button class="btn-preset" data-text="嗯……啊……这个……">犹豫</button>
                        </div>
                        <div class="test-service-note" id="test-service-note">
                            <b>生成试听需要先启动 vLLM 或 6G 服务</b>
                            <span>音色/声腔按钮只试听本地参考音频；生成新语音会调用当前运行中的 API/TTS 服务，它不是离线生成功能。</span>
                        </div>
                        <button class="btn-primary btn-large" id="btn-test-generate" disabled>
                            <span>生成试听</span>
                        </button>
                        <div id="test-current-result"></div>
                    </div>
                </section>
                <aside class="test-history">
                    <div class="history-header">
                        <span>测试历史</span>
                        <span id="history-count">0 条</span>
                    </div>
                    <div class="history-list" id="test-history-list"></div>
                </aside>
            </div>
        </div>
    `;
}
