export function logsPage() {
    return `
        <div id="page-logs" class="page">
            <div class="page-header">
                <h2 class="page-title">日志</h2>
                <div class="page-actions">
                    <select id="log-version-select" class="select-version compact" hidden>
                        <option value="vllm">vLLM</option>
                        <option value="fast6g">Fast6G</option>
                    </select>
                    <div class="segmented compact" aria-label="日志版本">
                        <button type="button" data-log-version="vllm" class="active">vLLM</button>
                        <button type="button" data-log-version="fast6g">6G</button>
                    </div>
                    <select id="log-category-filter" class="select-version compact" hidden>
                        <option value="useful">重点</option>
                        <option value="startup">启动</option>
                        <option value="error">错误</option>
                        <option value="rtf">RTF</option>
                        <option value="all">全部</option>
                    </select>
                    <div class="segmented log-kind" aria-label="日志分类">
                        <button type="button" data-log-category="useful" class="active">重点</button>
                        <button type="button" data-log-category="startup">启动</button>
                        <button type="button" data-log-category="error">错误</button>
                        <button type="button" data-log-category="rtf">RTF</button>
                        <button type="button" data-log-category="all">全部</button>
                    </div>
                    <select id="log-level-filter" class="select-version compact" hidden>
                        <option value="all">全部</option>
                        <option value="issues">错误+警告</option>
                        <option value="error">错误</option>
                        <option value="warning">警告</option>
                        <option value="success">成功</option>
                        <option value="info">信息</option>
                    </select>
                    <div class="segmented wide" aria-label="日志级别">
                        <button type="button" data-log-level="all" class="active">全部</button>
                        <button type="button" data-log-level="issues">问题</button>
                        <button type="button" data-log-level="error">错误</button>
                        <button type="button" data-log-level="warning">警告</button>
                        <button type="button" data-log-level="success">成功</button>
                        <button type="button" data-log-level="info">信息</button>
                    </div>
                    <input
                        id="log-search"
                        class="log-search"
                        type="search"
                        placeholder="搜索日志"
                        spellcheck="false"
                    >
                    <span id="log-visible-count" class="log-count">0/0</span>
                    <button class="btn-secondary" id="btn-refresh-logs">读取日志</button>
                    <button class="btn-secondary" id="btn-clear-logs">清空</button>
                </div>
            </div>
            <div class="log-summary" id="log-summary"></div>
            <div class="log-container">
                <div class="log-output" id="log-output">
                    <div class="log-entry log-info">[INFO] LEON 启动器已初始化</div>
                    <div class="log-entry log-info">[INFO] 等待用户操作...</div>
                </div>
            </div>
        </div>
    `;
}
