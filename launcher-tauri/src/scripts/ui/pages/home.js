export function homePage() {
    return `
        <div id="page-home" class="page active">
            <div class="hero-section">
                <div class="hero-background">
                    <div class="gradient-overlay"></div>
                </div>
                <div class="hero-content">
                    <h1 class="hero-title">LEON 启动器</h1>
                    <p class="hero-subtitle">智能语音助理系统</p>
                    <div class="quick-stats">
                        <div class="stat-card">
                            <div class="stat-value" id="stat-profiles">0</div>
                            <div class="stat-label">配置文件</div>
                        </div>
                        <div class="stat-card">
                            <div class="stat-value" id="stat-active">0</div>
                            <div class="stat-label">激活数</div>
                        </div>
                        <div class="stat-card">
                            <div class="stat-value" id="stat-uptime">00:00</div>
                            <div class="stat-label">运行时间</div>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    `;
}
