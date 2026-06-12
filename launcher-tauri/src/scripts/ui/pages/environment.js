export function environmentPage() {
    return `
        <div id="page-environment" class="page">
            <div class="page-header">
                <h2 class="page-title">环境检测</h2>
                <div class="page-actions">
                    <button class="btn-secondary" id="btn-check-env" type="button">
                        <svg class="btn-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <polyline points="23 4 23 10 17 10"></polyline>
                            <polyline points="1 20 1 14 7 14"></polyline>
                            <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10"></path>
                            <path d="M20.49 15a9 9 0 0 1-14.85 3.36L1 14"></path>
                        </svg>
                        重新检测
                    </button>
                    <button class="btn-secondary primary" id="btn-repair-env" type="button">
                        <svg class="btn-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.3-3.3a6 6 0 0 1-7.9 7.9l-6.4 6.4a2.1 2.1 0 0 1-3-3l6.4-6.4a6 6 0 0 1 7.9-7.9l-3.3 3.3z"></path>
                        </svg>
                        自动修复安全项
                    </button>
                </div>
            </div>

            <section class="env-summary" id="env-summary">
                <div class="env-summary-main">
                    <span class="env-status-pill loading">检测中</span>
                    <div>
                        <h3>正在检测启动环境</h3>
                        <p>等待检测结果...</p>
                    </div>
                </div>
                <div class="env-summary-meta" id="env-root">根目录检测中...</div>
            </section>

            <section class="env-readiness" id="env-startability">
                <div class="env-ready-item loading">
                    <span>vLLM</span>
                    <strong>检测中</strong>
                </div>
                <div class="env-ready-item loading">
                    <span>6G</span>
                    <strong>检测中</strong>
                </div>
                <div class="env-ready-item loading">
                    <span>可修复项</span>
                    <strong>检测中</strong>
                </div>
            </section>

            <section class="env-check-list" id="env-check-list">
                <div class="env-check-row loading">
                    <div class="env-check-mark">...</div>
                    <div class="env-check-body">
                        <div class="env-check-title">检测中</div>
                        <div class="env-check-detail">等待环境报告...</div>
                    </div>
                </div>
            </section>
        </div>
    `;
}
