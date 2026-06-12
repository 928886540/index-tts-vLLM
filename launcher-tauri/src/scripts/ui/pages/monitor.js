export function monitorPage() {
    return `
        <div id="page-monitor" class="page">
            <div class="monitor-grid generation-records-grid">
                <section class="monitor-card full-width">
                    <div class="card-header">
                        <div>
                            <h3>最近生成记录</h3>
                            <p class="card-subtitle" id="generation-record-version">手动刷新 · 不轮询</p>
                        </div>
                        <div class="card-header-actions">
                            <button class="btn-secondary compact" id="btn-refresh-monitor">刷新记录</button>
                        </div>
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
