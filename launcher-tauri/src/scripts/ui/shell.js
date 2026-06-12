import headUrl from '../../assets/head.png';
import leftUrl from '../../assets/left.png';
import {
    editorPage,
    environmentPage,
    homePage,
    logsPage,
    mixerPage,
    monitorPage,
    testPage,
    voicesPage
} from './pages.js';

export function renderAppShell(root) {
    if (!root) {
        throw new Error('Missing launcher app root');
    }

    root.innerHTML = `
        <header class="top-bar">
            <img src="${headUrl}" alt="Characters" class="top-banner">
        </header>
        <div class="main-container">
            ${sidebarTemplate()}
            <main class="content-area">
                ${homePage()}
                ${mixerPage()}
                ${editorPage()}
                ${logsPage()}
                ${voicesPage()}
                ${testPage()}
                ${monitorPage()}
                ${environmentPage()}
            </main>
        </div>

        <div class="modal-backdrop" id="modal-backdrop" hidden>
            <div class="modal-panel" id="modal-panel"></div>
        </div>
    `;
}

function sidebarTemplate() {
    return `
        <nav class="sidebar">
            <div class="sidebar-character-art">
                <img src="${leftUrl}" alt="Characters" class="character-bg">
            </div>
            <div class="nav-items">
                ${navItem('home', '首页', `
                    <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"></path>
                    <polyline points="9 22 9 12 15 12 15 22"></polyline>
                `, true)}
                ${navItem('logs', '日志', `
                    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
                    <polyline points="14 2 14 8 20 8"></polyline>
                    <line x1="16" y1="13" x2="8" y2="13"></line>
                    <line x1="16" y1="17" x2="8" y2="17"></line>
                    <line x1="10" y1="9" x2="8" y2="9"></line>
                `)}
                ${navItem('mixer', '调音台', `
                    <line x1="4" y1="21" x2="4" y2="14"></line>
                    <line x1="4" y1="10" x2="4" y2="3"></line>
                    <line x1="12" y1="21" x2="12" y2="12"></line>
                    <line x1="12" y1="8" x2="12" y2="3"></line>
                    <line x1="20" y1="21" x2="20" y2="16"></line>
                    <line x1="20" y1="12" x2="20" y2="3"></line>
                    <circle cx="4" cy="14" r="2"></circle>
                    <circle cx="12" cy="8" r="2"></circle>
                    <circle cx="20" cy="16" r="2"></circle>
                `)}
                ${navItem('voices', '音色库', `
                    <path d="M9 18V5l12-2v13"></path>
                    <circle cx="6" cy="18" r="3"></circle>
                    <circle cx="18" cy="16" r="3"></circle>
                `)}
                ${navItem('test', '快速测试', `
                    <path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3z"></path>
                    <path d="M19 10v2a7 7 0 0 1-14 0v-2"></path>
                    <line x1="12" y1="19" x2="12" y2="23"></line>
                    <line x1="8" y1="23" x2="16" y2="23"></line>
                `)}
                ${navItem('monitor', '生成记录', `
                    <polyline points="22 12 18 12 15 21 9 3 6 12 2 12"></polyline>
                `)}
                ${navItem('environment', '环境检测', `
                    <rect x="2" y="3" width="20" height="14" rx="2" ry="2"></rect>
                    <line x1="8" y1="21" x2="16" y2="21"></line>
                    <line x1="12" y1="17" x2="12" y2="21"></line>
                `)}
            </div>
            <div class="bottom-panel">
                <div class="config-row vllm-options">
                    <label class="msvc-toggle">
                        <input type="checkbox" id="enable-msvc" checked>
                        <span>启用 MSVC</span>
                    </label>
                    <label class="gpu-ratio-label">
                        <span>
                            <b>GPU占比</b>
                            <em>vLLM 显存比例</em>
                        </span>
                        <input
                            type="text"
                            id="gpu-ratio"
                            value="0.15"
                            inputmode="decimal"
                            autocomplete="off"
                            title="传给 vLLM 的 gpu_memory_utilization；0.15 表示大约使用 15% 显存预算。"
                        >
                    </label>
                </div>
                <div class="version-selector">
                    <button class="btn-version active" id="btn-version-vllm" data-version="vllm">vLLM</button>
                    <button class="btn-version" id="btn-version-fast6g" data-version="fast6g">6G</button>
                </div>
                <div class="system-status">
                    <span class="status-dot" data-state="stopped"></span>
                    <span class="status-text">系统就绪</span>
                </div>
                <button class="btn-launch" id="btn-start">
                    <svg class="btn-icon" viewBox="0 0 24 24" fill="currentColor">
                        <path d="M8 5v14l11-7z"></path>
                    </svg>
                    <span>启动 LEON 服务</span>
                </button>
            </div>
        </nav>
    `;
}

function navItem(page, label, icon, active = false) {
    return `
        <div class="nav-item ${active ? 'active' : ''}" data-page="${page}">
            <svg class="nav-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                ${icon}
            </svg>
            <span class="nav-label">${label}</span>
        </div>
    `;
}
