export function mixerPage() {
    return `
        <div id="page-mixer" class="page">
            <div class="page-header">
                <h2 class="page-title">调音台</h2>
                <div class="page-actions">
                    <button class="btn-secondary" id="btn-create-profile">新建配置</button>
                </div>
            </div>
            <div class="profiles-grid" id="profiles-container"></div>
        </div>
    `;
}
