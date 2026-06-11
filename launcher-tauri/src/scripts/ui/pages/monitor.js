export function monitorPage() {
    return `
        <div id="page-monitor" class="page">
            <div class="page-header">
                <h2 class="page-title">监控</h2>
                <div class="page-actions">
                    <button class="btn-secondary" id="btn-refresh-monitor">刷新</button>
                </div>
            </div>
            <div class="monitor-grid">
                <section class="monitor-card">
                    <div class="card-header">
                        <h3>服务状态</h3>
                        <span class="status-indicator" id="monitor-service-status">-</span>
                    </div>
                    <div class="card-body">
                        <div class="stat-row">
                            <span>版本</span>
                            <span id="monitor-version">-</span>
                        </div>
                        <div class="stat-row">
                            <span>API 状态</span>
                            <span id="monitor-api-message">-</span>
                        </div>
                        <div class="stat-row">
                            <span>运行时间</span>
                            <span id="monitor-uptime">-</span>
                        </div>
                        <div class="stat-row">
                            <span>端口</span>
                            <span id="monitor-port">9880</span>
                        </div>
                    </div>
                </section>

                <section class="monitor-card">
                    <div class="card-header">
                        <h3>系统资源</h3>
                    </div>
                    <div class="card-body">
                        <div class="stat-row">
                            <span>GPU 显存</span>
                            <span id="monitor-gpu">-</span>
                        </div>
                        <div class="stat-row">
                            <span>进程 PID</span>
                            <span id="monitor-pid">-</span>
                        </div>
                    </div>
                </section>

                <section class="monitor-card full-width">
                    <div class="card-header">
                        <h3>最近生成记录</h3>
                        <span id="monitor-generation-count" class="card-count">0 条</span>
                    </div>
                    <div class="card-body">
                        <div id="monitor-recent-tasks"></div>
                    </div>
                </section>

                <section class="monitor-card full-width">
                    <div class="card-header">
                        <h3>RTF / 耗时日志</h3>
                    </div>
                    <div class="card-body">
                        <div id="monitor-rtf-logs"></div>
                    </div>
                </section>

                <section class="monitor-card full-width">
                    <div class="card-header">
                        <h3>错误日志</h3>
                    </div>
                    <div class="card-body">
                        <div id="monitor-errors"></div>
                    </div>
                </section>
            </div>
        </div>
    `;
}
