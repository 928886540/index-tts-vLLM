export function environmentPage() {
    return `
        <div id="page-environment" class="page">
            <div class="page-header">
                <h2 class="page-title">环境检测</h2>
                <button class="btn-secondary" id="btn-check-env">重新检测</button>
            </div>
            <div class="env-grid">
                <div class="env-card">
                    <div class="env-header">
                        <svg class="env-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <rect x="2" y="3" width="20" height="14" rx="2" ry="2"></rect>
                            <line x1="8" y1="21" x2="16" y2="21"></line>
                            <line x1="12" y1="17" x2="12" y2="21"></line>
                        </svg>
                        <h3 class="env-title">操作系统</h3>
                    </div>
                    <div class="env-value" id="env-os">检测中...</div>
                </div>
                <div class="env-card">
                    <div class="env-header">
                        <svg class="env-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <rect x="4" y="4" width="16" height="16" rx="2" ry="2"></rect>
                            <rect x="9" y="9" width="6" height="6"></rect>
                            <line x1="9" y1="1" x2="9" y2="4"></line>
                            <line x1="15" y1="1" x2="15" y2="4"></line>
                            <line x1="9" y1="20" x2="9" y2="23"></line>
                            <line x1="15" y1="20" x2="15" y2="23"></line>
                            <line x1="20" y1="9" x2="23" y2="9"></line>
                            <line x1="20" y1="14" x2="23" y2="14"></line>
                            <line x1="1" y1="9" x2="4" y2="9"></line>
                            <line x1="1" y1="14" x2="4" y2="14"></line>
                        </svg>
                        <h3 class="env-title">Python 版本</h3>
                    </div>
                    <div class="env-value" id="env-python">检测中...</div>
                </div>
                <div class="env-card">
                    <div class="env-header">
                        <svg class="env-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <circle cx="12" cy="12" r="10"></circle>
                            <line x1="2" y1="12" x2="22" y2="12"></line>
                            <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"></path>
                        </svg>
                        <h3 class="env-title">网络连接</h3>
                    </div>
                    <div class="env-value" id="env-network">检测中...</div>
                </div>
                <div class="env-card">
                    <div class="env-header">
                        <svg class="env-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"></path>
                            <polyline points="3.27 6.96 12 12.01 20.73 6.96"></polyline>
                            <line x1="12" y1="22.08" x2="12" y2="12"></line>
                        </svg>
                        <h3 class="env-title">CUDA 可用</h3>
                    </div>
                    <div class="env-value" id="env-cuda">检测中...</div>
                </div>
            </div>
        </div>
    `;
}
