export function voicesPage() {
    return `
        <div id="page-voices" class="page">
            <div class="page-header">
                <h2 class="page-title">音色库</h2>
                <div class="page-actions">
                    <button class="btn-secondary" id="btn-import-voice">导入音色</button>
                </div>
            </div>
            <div class="voices-layout">
                <aside class="voices-groups">
                    <div class="group-header">
                        <span>分组</span>
                        <button class="btn-icon" id="btn-add-group" title="新建分组">+</button>
                    </div>
                    <div class="group-list" id="voice-groups"></div>
                </aside>
                <section class="voices-content">
                    <div class="voices-toolbar">
                        <input id="voice-search" type="search" placeholder="搜索音色" spellcheck="false">
                        <span id="voice-count">0 个音色</span>
                    </div>
                    <div class="voices-grid" id="voices-grid"></div>
                </section>
            </div>
        </div>
    `;
}
