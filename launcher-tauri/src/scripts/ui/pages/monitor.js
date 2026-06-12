export function monitorPage() {
    return `
        <div id="page-monitor" class="page">
            <div class="page-header">
                <h2 class="page-title">生成记录</h2>
                <div class="page-actions">
                    <button class="btn-secondary" id="btn-refresh-monitor">刷新记录</button>
                </div>
            </div>
            <div class="monitor-grid generation-records-grid">
                <section class="monitor-card full-width">
                    <div class="card-header">
                        <div>
                            <h3>最近生成记录</h3>
                            <p class="card-subtitle" id="generation-record-version">-</p>
                        </div>
                        <span id="monitor-generation-count" class="card-count">0 条</span>
                    </div>
                    <div class="card-body">
                        <div id="monitor-recent-tasks"></div>
                        <div class="generation-pager" id="generation-record-pager"></div>
                    </div>
                </section>
            </div>
        </div>
    `;
}
