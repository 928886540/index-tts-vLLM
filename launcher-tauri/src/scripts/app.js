// ==================== 应用主逻辑 ====================

const tauriInvoke = window.__TAURI__?.core?.invoke;
const PRESET_FIELDS = [
    { key: 'diffusion_steps', label: '扩散步数', step: '1' },
    { key: 'prompt_audio_seconds', label: '参考秒数', step: '1' },
    { key: 'segment_tokens', label: '分段 tokens', step: '1' },
    { key: 'first_tokens', label: '首段 tokens', step: '1' },
    { key: 's2mel_cfg_rate', label: 'CFG rate', step: '0.01' }
];
const PRESET_GROUPS = [
    { key: 'live', label: 'LIVE' },
    { key: 'generate', label: 'DISK' }
];

const api = {
    async getProfiles() {
        if (tauriInvoke) return tauriInvoke('get_profiles');
        return window.tauri_mock.getProfiles();
    },

    async getProfile(file) {
        if (tauriInvoke) return tauriInvoke('get_profile', { file });
        return window.tauri_mock.getProfile(file);
    },

    async createProfile() {
        if (tauriInvoke) return tauriInvoke('create_profile');
        return window.tauri_mock.createProfile();
    },

    async saveProfile(file, profile) {
        if (tauriInvoke) return tauriInvoke('save_profile', { file, profile });
        return window.tauri_mock.saveProfile(file, profile);
    },

    async applyProfile(file) {
        if (tauriInvoke) return tauriInvoke('apply_profile', { file });
        return window.tauri_mock.activateProfile(file);
    },

    async copyProfile(file) {
        if (tauriInvoke) return tauriInvoke('copy_profile', { file });
        return window.tauri_mock.copyProfile(file);
    },

    async deleteProfile(file) {
        if (tauriInvoke) return tauriInvoke('delete_profile', { file });
        return window.tauri_mock.deleteProfile(file);
    },

    async validateProfile(file) {
        if (tauriInvoke) return tauriInvoke('validate_profile', { file });
        return window.tauri_mock.validateProfile(file);
    },

    async startService(version, gpuRatio, enableMsvc) {
        if (tauriInvoke) {
            return tauriInvoke('start_service', {
                version,
                gpuRatio: Number.isFinite(gpuRatio) ? gpuRatio : null,
                enableMsvc: Boolean(enableMsvc)
            });
        }
        return window.tauri_mock.startService(version, gpuRatio, enableMsvc);
    },

    async stopService() {
        if (tauriInvoke) return tauriInvoke('stop_service');
        return window.tauri_mock.stopService();
    },

    async warmupService(force) {
        if (tauriInvoke) return tauriInvoke('warmup_service', { force });
        return window.tauri_mock.warmupService(force);
    },

    async getServiceStatus() {
        if (tauriInvoke) return tauriInvoke('get_service_status');
        const status = await window.tauri_mock.getSystemStatus();
        return {
            running: status.running,
            state: status.running ? 'running' : 'stopped',
            health: {
                reachable: status.running,
                status: status.running ? 'healthy' : 'stopped',
                version: null,
                message: status.running ? '服务运行中' : '服务未运行'
            }
        };
    },

    async getEnvironment() {
        if (tauriInvoke) return tauriInvoke('get_environment');
        return window.tauri_mock.getEnvironment();
    },

    async getLogSnapshot(version, maxLines) {
        if (tauriInvoke) return tauriInvoke('get_log_snapshot', { version, maxLines });
        return window.tauri_mock.getLogSnapshot(version, maxLines);
    }
};

class LeonLauncher {
    constructor() {
        this.currentPage = 'home';
        this.isRunning = false;
        this.uptime = 0;
        this.uptimeInterval = null;
        this.statusInterval = null;
        this.logRefreshInterval = null;
        this.profiles = [];
        this.editorFile = null;
        this.editorProfile = null;
        this.editorPresetMode = null;
        this.logEntries = [];
        this.selectedVersion = 'vllm';

        this.init();
    }

    async init() {
        this.bindEvents();
        await this.refreshAll();
        this.setupLogStream();
        this.statusInterval = setInterval(() => this.refreshServiceStatus(false), 5000);

        this.addLog('info', tauriInvoke ? 'LEON Tauri 启动器初始化完成' : '浏览器预览模式：使用 Mock API');
    }

    async refreshAll() {
        await Promise.allSettled([
            this.loadProfiles(),
            this.loadEnvironment(),
            this.refreshServiceStatus(false)
        ]);
        this.updateStats();
    }

    bindEvents() {
        document.querySelectorAll('.nav-item').forEach(item => {
            item.addEventListener('click', (e) => {
                const page = e.currentTarget.dataset.page;
                this.switchPage(page);
            });
        });

        document.getElementById('btn-start').addEventListener('click', () => {
            this.toggleService();
        });

        document.getElementById('btn-warmup')?.addEventListener('click', () => {
            this.warmupService();
        });

        document.querySelectorAll('.btn-version').forEach(button => {
            button.addEventListener('click', () => {
                this.setVersion(button.dataset.version || 'vllm', true);
            });
        });

        document.getElementById('btn-create-profile').addEventListener('click', () => {
            this.createProfile();
        });

        document.getElementById('editor-default-mode').addEventListener('change', () => {
            if (!this.editorProfile) return;
            this.syncPresetFieldsIntoProfile(this.editorProfile);
            this.editorProfile.quality = this.editorProfile.quality || {};
            this.editorProfile.quality.defaultMode = document.getElementById('editor-default-mode').value;
            this.editorPresetMode = this.editorProfile.quality.defaultMode;
            this.renderPresetEditor(this.editorProfile);
            document.getElementById('editor-json').value = JSON.stringify(this.editorProfile, null, 2);
        });

        document.getElementById('btn-close-editor')?.addEventListener('click', () => {
            this.closeProfileEditor();
        });

        document.getElementById('btn-back-to-mixer').addEventListener('click', () => {
            this.switchPage('mixer');
        });

        document.getElementById('btn-sync-json').addEventListener('click', () => {
            this.syncEditorToJson(true);
        });

        document.getElementById('btn-save-profile').addEventListener('click', () => {
            this.saveEditedProfile(false);
        });

        document.getElementById('btn-apply-edited-profile').addEventListener('click', () => {
            this.saveEditedProfile(true);
        });

        document.getElementById('btn-add-style').addEventListener('click', () => {
            this.addNewStyle();
        });

        document.addEventListener('click', (e) => {
            if (e.target.closest('.btn-delete-style')) {
                const row = e.target.closest('.style-row');
                if (row && confirm(`确定删除声腔 "${row.dataset.styleId}"？`)) {
                    row.remove();
                    this.syncEditorToJson(false);
                }
            }
        });

        document.getElementById('btn-clear-logs').addEventListener('click', () => {
            this.clearLogs();
        });

        document.getElementById('btn-refresh-logs').addEventListener('click', () => {
            this.loadLogSnapshot();
        });

        document.getElementById('log-version-select').addEventListener('change', () => {
            if (this.currentPage === 'logs') {
                this.loadLogSnapshot();
            }
        });

        document.getElementById('log-level-filter').addEventListener('change', () => {
            this.renderLogEntries();
        });

        document.getElementById('log-search').addEventListener('input', () => {
            this.renderLogEntries();
        });

        document.getElementById('btn-check-env').addEventListener('click', () => {
            this.loadEnvironment();
        });

        document.addEventListener('keydown', (event) => {
            if (!event.ctrlKey || event.altKey || event.shiftKey) return;
            if (isTextEditingTarget(event.target)) return;
            const key = event.key.toLowerCase();
            if (key === 'r') {
                event.preventDefault();
                this.refreshCurrentPage();
            } else if (key === 'l') {
                event.preventDefault();
                this.clearLogs();
            }
        });

        this.setVersion(this.selectedVersion, false);
    }

    setVersion(version, logChange) {
        const normalized = version === 'fast6g' ? 'fast6g' : 'vllm';
        this.selectedVersion = normalized;

        document.querySelectorAll('.btn-version').forEach(button => {
            button.classList.toggle('active', button.dataset.version === normalized);
        });

        const logVersionSelect = document.getElementById('log-version-select');
        if (logVersionSelect && logVersionSelect.value !== normalized) {
            logVersionSelect.value = normalized;
        }

        document.querySelector('.vllm-options')?.classList.toggle('hidden', normalized !== 'vllm');
        if (logChange) {
            this.addLog('info', `已选择 ${normalized === 'vllm' ? 'vLLM' : 'Fast6G'} 启动模式`);
            if (this.currentPage === 'logs') {
                this.loadLogSnapshot(true);
            }
        }
    }

    switchPage(pageName) {
        document.querySelectorAll('.nav-item').forEach(item => {
            item.classList.toggle('active', item.dataset.page === pageName);
        });

        document.querySelectorAll('.page').forEach(page => {
            page.classList.remove('active');
        });
        document.getElementById(`page-${pageName}`).classList.add('active');

        this.currentPage = pageName;
        if (pageName === 'logs') {
            this.startLogAutoRefresh();
        } else {
            this.stopLogAutoRefresh();
        }
        if (pageName === 'mixer') {
            this.loadProfiles();
        }
    }

    async toggleService() {
        const btn = document.getElementById('btn-start');

        if (this.isRunning) {
            await this.stopService(btn);
        } else {
            await this.startService(btn);
        }

        this.updateStats();
    }

    async startService(btn) {
        btn.disabled = true;
        const version = this.selectedVersion;
        let gpuRatio = null;
        let enableMsvc = true;

        try {
            if (version === 'vllm') {
                gpuRatio = this.readVllmGpuRatio();
                enableMsvc = document.getElementById('enable-msvc')?.checked ?? true;
                this.addLog('info', `启动配置: vLLM, gpu_memory_utilization=${formatRatio(gpuRatio)}, MSVC=${enableMsvc ? 'on' : 'off'}`);
            } else {
                this.addLog('info', '启动配置: Fast6G');
            }
        } catch (error) {
            this.addLog('error', `启动参数错误: ${formatError(error)}`);
            btn.disabled = false;
            return;
        }

        this.addLog('info', `正在启动 ${version} 服务...`);
        this.setSystemStatus('starting', '服务启动中');

        try {
            const message = await api.startService(version, gpuRatio, enableMsvc);
            this.addLog('success', normalizeMessage(message));
            this.addLog('info', '正在加载模型，请等待 20-30 秒...');
            this.setRunningUi(true);
            this.startUptimeCounter();
            setTimeout(() => this.refreshServiceStatus(true), 30000);
        } catch (error) {
            this.addLog('error', `启动失败: ${formatError(error)}`);
            this.setRunningUi(false);
            this.setSystemStatus('error', '启动失败');
        } finally {
            btn.disabled = false;
        }
    }

    readVllmGpuRatio() {
        const input = document.getElementById('gpu-ratio');
        const raw = input?.value?.trim() || '';
        const value = Number.parseFloat(raw);
        if (!Number.isFinite(value) || value <= 0 || value > 1) {
            throw new Error('vLLM GPU 占比必须是 0 到 1 之间的数字');
        }
        input.value = formatRatio(value);
        return value;
    }

    async stopService(btn) {
        btn.disabled = true;
        this.addLog('warning', '正在停止服务...');
        this.setSystemStatus('starting', '服务停止中');

        try {
            const message = await api.stopService();
            this.addLog('success', normalizeMessage(message));
            this.setRunningUi(false);
            this.stopUptimeCounter();
            setTimeout(() => this.refreshServiceStatus(false), 1500);
        } catch (error) {
            this.addLog('error', `停止失败: ${formatError(error)}`);
            await this.refreshServiceStatus(false);
        } finally {
            btn.disabled = false;
        }
    }

    async refreshServiceStatus(logChanges) {
        try {
            const status = await api.getServiceStatus();
            const running = Boolean(status.running || status.health?.reachable);
            const label = status.health?.version
                ? `服务运行中 · ${status.health.version}`
                : cleanStatusMessage(status.health?.message) || (running ? '服务运行中' : '服务未运行');

            if (running !== this.isRunning && logChanges) {
                this.addLog(running ? 'success' : 'warning', label);
            }

            this.setRunningUi(running);
            this.setSystemStatus(status.state || (running ? 'running' : 'stopped'), label);
        } catch (error) {
            this.setSystemStatus('stopped', '服务未运行');
        }
    }

    setRunningUi(running) {
        this.isRunning = running;
        const btn = document.getElementById('btn-start');
        const btnText = btn.querySelector('span');
        const btnIcon = btn.querySelector('.btn-icon path');

        btn.classList.toggle('running', running);
        btnText.textContent = running ? '停止 LEON 服务' : '启动 LEON 服务';
        btnIcon.setAttribute('d', running ? 'M6 4h4v16H6zM14 4h4v16h-4z' : 'M8 5v14l11-7z');

        if (running && !this.uptimeInterval) this.startUptimeCounter();
        if (!running && this.uptimeInterval) this.stopUptimeCounter();
    }

    setSystemStatus(state, text) {
        const dot = document.querySelector('.status-dot');
        const label = document.querySelector('.status-text');
        if (dot) dot.dataset.state = state || 'stopped';
        if (label) label.textContent = text || '系统就绪';
    }

    async loadProfiles() {
        this.addLog('info', '加载配置文件...');

        try {
            this.profiles = await api.getProfiles();
            this.renderProfiles();
            this.updateStats();
            this.addLog('success', `已加载 ${this.profiles.length} 个配置文件`);
        } catch (error) {
            this.addLog('error', `加载配置失败: ${formatError(error)}`);
        }
    }

    renderProfiles() {
        const container = document.getElementById('profiles-container');
        container.innerHTML = '';

        if (!this.profiles.length) {
            container.innerHTML = '<div class="empty-state">未找到 Profile 配置</div>';
            return;
        }

        this.profiles.forEach(profile => {
            const card = document.createElement('div');
            card.className = `profile-card ${profile.active ? 'active' : ''}`;

            const name = escapeHtml(profile.name || profile.file);
            const description = escapeHtml(profile.description || '无描述');
            const file = escapeHtml(profile.file);
            const updated = profile.updatedAt ? `<div class="profile-updated">${escapeHtml(profile.updatedAt)}</div>` : '';

            card.innerHTML = `
                <div class="profile-header">
                    <div>
                        <div class="profile-name">${name}</div>
                        <div class="profile-description">${description}</div>
                    </div>
                    <span class="profile-badge ${profile.active ? 'active' : 'inactive'}">
                        ${profile.active ? 'ACTIVE' : 'READY'}
                    </span>
                </div>
                <div class="profile-file">${file}</div>
                ${updated}
                <div class="profile-actions">
                    ${!profile.active ? `<button class="btn-profile btn-activate" data-file="${file}">启用</button>` : ''}
                    <button class="btn-profile btn-test" data-file="${file}">测试</button>
                    <button class="btn-profile btn-copy" data-file="${file}">复制</button>
                    ${!profile.active ? `<button class="btn-profile btn-delete" data-file="${file}">删除</button>` : ''}
                    <button class="btn-profile btn-edit" data-file="${file}">详情</button>
                </div>
            `;

            const activateBtn = card.querySelector('.btn-activate');
            if (activateBtn) {
                activateBtn.addEventListener('click', (e) => {
                    e.stopPropagation();
                    this.activateProfile(profile.file);
                });
            }

            const editBtn = card.querySelector('.btn-edit');
            editBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                this.openProfileEditor(profile.file);
            });

            const testBtn = card.querySelector('.btn-test');
            testBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                this.validateProfile(profile.file);
            });

            const copyBtn = card.querySelector('.btn-copy');
            copyBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                this.copyProfile(profile.file);
            });

            const deleteBtn = card.querySelector('.btn-delete');
            if (deleteBtn) {
                deleteBtn.addEventListener('click', (e) => {
                    e.stopPropagation();
                    this.deleteProfile(profile.file, profile.name || profile.file);
                });
            }

            container.appendChild(card);
        });
    }

    async activateProfile(filename) {
        this.addLog('info', `启用配置: ${filename}`);

        try {
            const message = await api.applyProfile(filename);
            this.profiles.forEach(p => {
                p.active = p.file === filename;
            });

            this.renderProfiles();
            this.updateStats();
            this.addLog('success', normalizeMessage(message));
        } catch (error) {
            this.addLog('error', `启用失败: ${formatError(error)}`);
        }
    }

    async createProfile() {
        this.addLog('info', '创建新 Profile...');

        try {
            const filename = await api.createProfile();
            this.addLog('success', `已创建 Profile：${normalizeMessage(filename)}`);
            await this.loadProfiles();
            await this.openProfileEditor(normalizeMessage(filename));
        } catch (error) {
            this.addLog('error', `创建失败: ${formatError(error)}`);
        }
    }

    async openProfileEditor(filename) {
        try {
            const profile = await api.getProfile(filename);
            this.editorFile = filename;
            this.editorProfile = structuredClone(profile);
            this.renderProfileEditor();
            this.switchPage('editor');
        } catch (error) {
            this.addLog('error', `读取详情失败: ${formatError(error)}`);
        }
    }

    closeProfileEditor() {
        this.editorFile = null;
        this.editorProfile = null;
        this.editorPresetMode = null;
        this.switchPage('mixer');
    }

    renderProfileEditor() {
        const profile = this.editorProfile || {};
        const file = this.editorFile || '';
        const modes = Array.isArray(profile.quality?.modes) ? profile.quality.modes : [];
        const styles = profile.styles && typeof profile.styles === 'object' ? profile.styles : {};

        // 解析 llmPrompt 或使用 llmPromptConfig
        let segmentRules = '', completenessRules = '', customNotes = '';
        if (profile.llmPromptConfig) {
            segmentRules = profile.llmPromptConfig.segmentRules || '';
            completenessRules = profile.llmPromptConfig.completenessRules || '';
            customNotes = profile.llmPromptConfig.customNotes || '';
        } else if (profile.llmPrompt) {
            // 旧格式：尝试从 llmPrompt 提取
            const parsed = this.parseLlmPrompt(profile.llmPrompt);
            segmentRules = parsed.segmentRules;
            completenessRules = parsed.completenessRules;
        }

        document.getElementById('editor-title').textContent = profile.name || 'Profile 详情';
        document.getElementById('editor-file').textContent = file;
        document.getElementById('editor-name').value = profile.name || '';
        document.getElementById('editor-description').value = profile.description || '';
        document.getElementById('editor-segment-rules').value = segmentRules;
        document.getElementById('editor-completeness-rules').value = completenessRules;
        document.getElementById('editor-custom-notes').value = customNotes;
        document.getElementById('editor-style-count').value = `${Object.keys(styles).length} 个声腔`;

        const defaultMode = document.getElementById('editor-default-mode');
        defaultMode.innerHTML = '';
        modes.filter(mode => mode?.id && mode.id !== 'custom').forEach(mode => {
            const option = document.createElement('option');
            option.value = mode.id;
            option.textContent = `${mode.label || mode.id} (${mode.id})`;
            option.selected = mode.id === profile.quality?.defaultMode;
            defaultMode.appendChild(option);
        });
        if (!defaultMode.options.length && profile.quality?.defaultMode) {
            const option = document.createElement('option');
            option.value = profile.quality.defaultMode;
            option.textContent = profile.quality.defaultMode;
            option.selected = true;
            defaultMode.appendChild(option);
        }
        this.editorPresetMode = defaultMode.value || profile.quality?.defaultMode || null;
        this.renderPresetEditor(profile);

        const styleList = document.getElementById('editor-styles');
        styleList.innerHTML = '';
        Object.entries(styles).forEach(([id, style]) => {
            const row = document.createElement('div');
            row.className = 'style-row';
            row.dataset.styleId = id;
            row.innerHTML = `
                <div class="style-id">${escapeHtml(id)}</div>
                <label>
                    <span>标签</span>
                    <input data-style-field="label" value="${escapeAttribute(style?.label || '')}">
                </label>
                <label>
                    <span>参考音频</span>
                    <input data-style-field="ref" value="${escapeAttribute(style?.ref || '')}">
                </label>
                <label>
                    <span>style_alpha</span>
                    <input data-style-field="style_alpha" type="number" step="0.01" min="0" max="1" value="${Number(style?.style_alpha ?? 0)}">
                </label>
                <label>
                    <span>emo_alpha</span>
                    <input data-style-field="emo_alpha" type="number" step="0.01" min="0" max="1" value="${Number(style?.emo_alpha ?? 0)}">
                </label>
                <button class="btn-delete-style">删除</button>
            `;
            styleList.appendChild(row);
        });

        document.getElementById('editor-json').value = JSON.stringify(profile, null, 2);
    }

    addNewStyle() {
        const newId = prompt('输入新声腔 ID（英文/数字/下划线）：');
        if (!newId || !newId.trim()) return;

        const id = newId.trim().toLowerCase().replace(/[^a-z0-9_]/g, '_');
        if (!this.editorProfile.styles) this.editorProfile.styles = {};
        if (this.editorProfile.styles[id]) {
            alert(`声腔 "${id}" 已存在`);
            return;
        }

        this.editorProfile.styles[id] = {
            label: '',
            ref: '',
            style_alpha: 0.4,
            emo_alpha: 0.3,
            emo_vec: [0, 0, 0, 0, 0, 0, 0, 0.85],
            description: ''
        };

        this.renderProfileEditor();
    }

    renderPresetEditor(profile) {
        const container = document.getElementById('editor-preset-fields');
        container.innerHTML = '';
        const mode = this.editorPresetMode || profile?.quality?.defaultMode;
        if (!mode) {
            container.innerHTML = '<div class="empty-state compact">未选择默认档位</div>';
            return;
        }

        PRESET_GROUPS.forEach(group => {
            const preset = profile?.quality?.presets?.[group.key]?.[mode] || {};
            const panel = document.createElement('div');
            panel.className = 'preset-group';
            panel.innerHTML = `
                <div class="preset-title">${escapeHtml(group.label)} · ${escapeHtml(mode)}</div>
                <div class="preset-grid">
                    ${PRESET_FIELDS.map(field => `
                        <label>
                            <span>${escapeHtml(field.label)}</span>
                            <input
                                data-preset-group="${escapeAttribute(group.key)}"
                                data-preset-field="${escapeAttribute(field.key)}"
                                type="number"
                                step="${escapeAttribute(field.step)}"
                                value="${escapeAttribute(preset[field.key] ?? '')}"
                            >
                        </label>
                    `).join('')}
                </div>
            `;
            container.appendChild(panel);
        });
    }

    parseLlmPrompt(llmPrompt) {
        // 从旧格式 llmPrompt 提取用户可编辑部分
        let segmentRules = '', completenessRules = '';

        const segmentMatch = llmPrompt.match(/拆段规则:\n([\s\S]*?)(?:\n\n{{style_rules}}|完整性硬规则:)/);
        if (segmentMatch) {
            segmentRules = segmentMatch[1].trim();
        }

        const completenessMatch = llmPrompt.match(/完整性硬规则:\n([\s\S]*?)(?:\n\n示例输入:|$)/);
        if (completenessMatch) {
            completenessRules = completenessMatch[1].trim();
        }

        return { segmentRules, completenessRules };
    }

    buildLlmPrompt(segmentRules, completenessRules, customNotes) {
        // 构建完整的 llmPrompt，保护所有 {{}} 占位符
        let prompt = `你是中文小说→TTS 片段拆分器。只返回严格 JSON，不要任何解释，不要 \`\`\` 代码块。

{{roles_hint}}
{{user_alias_hint}}
{{character_hint}}
输出格式:
{{output_contract}}

拆段规则:
${segmentRules}

{{style_rules}}

{{emotion_rules}}

完整性硬规则:
${completenessRules}`;

        if (customNotes && customNotes.trim()) {
            prompt += `\n\n补充说明:\n${customNotes.trim()}`;
        }

        prompt += `\n\n示例输入:
她低着头，眼角有泪。「对不起，我真的撑不住了。」
{{example_user}}叹了口气，把手放在她肩上：「别哭。」
示例输出:
{{example_output}}`;

        return prompt;
    }

    syncEditorToJson(logResult) {
        if (!this.editorProfile) {
            return null;
        }

        let profile;
        try {
            profile = JSON.parse(document.getElementById('editor-json').value || '{}');
        } catch (error) {
            this.addLog('error', `JSON 解析失败: ${formatError(error)}`);
            return null;
        }

        profile.name = document.getElementById('editor-name').value.trim();
        profile.description = document.getElementById('editor-description').value.trim();

        // 保存用户编辑的结构化字段
        const segmentRules = document.getElementById('editor-segment-rules').value.trim();
        const completenessRules = document.getElementById('editor-completeness-rules').value.trim();
        const customNotes = document.getElementById('editor-custom-notes').value.trim();

        profile.llmPromptConfig = {
            segmentRules,
            completenessRules,
            customNotes
        };

        // 自动构建完整的 llmPrompt（后端使用）
        profile.llmPrompt = this.buildLlmPrompt(segmentRules, completenessRules, customNotes);

        profile.quality = profile.quality || {};
        profile.quality.defaultMode = document.getElementById('editor-default-mode').value;
        profile.styles = profile.styles && typeof profile.styles === 'object' ? profile.styles : {};

        document.querySelectorAll('#editor-styles .style-row').forEach(row => {
            const id = row.dataset.styleId;
            const style = profile.styles[id] || {};
            row.querySelectorAll('[data-style-field]').forEach(input => {
                const field = input.dataset.styleField;
                if (input.type === 'number') {
                    style[field] = Number(input.value);
                } else {
                    style[field] = input.value;
                }
            });
            profile.styles[id] = style;
        });
        this.syncPresetFieldsIntoProfile(profile);

        this.editorProfile = profile;
        document.getElementById('editor-json').value = JSON.stringify(profile, null, 2);
        if (logResult) {
            this.addLog('info', `已同步 ${this.editorFile} 表单到 JSON`);
        }
        return profile;
    }

    syncPresetFieldsIntoProfile(profile) {
        const mode = this.editorPresetMode || document.getElementById('editor-default-mode').value;
        if (!mode) return;

        profile.quality = profile.quality || {};
        profile.quality.presets = profile.quality.presets || {};
        PRESET_GROUPS.forEach(group => {
            profile.quality.presets[group.key] = profile.quality.presets[group.key] || {};
            const preset = profile.quality.presets[group.key][mode] || {};
            document.querySelectorAll(`[data-preset-group="${group.key}"]`).forEach(input => {
                const key = input.dataset.presetField;
                const raw = input.value.trim();
                preset[key] = raw === '' ? null : Number(raw);
            });
            profile.quality.presets[group.key][mode] = preset;
        });
    }

    async saveEditedProfile(applyAfterSave) {
        const profile = this.syncEditorToJson(false);
        if (!profile || !this.editorFile) {
            return;
        }

        try {
            const message = await api.saveProfile(this.editorFile, profile);
            this.addLog('success', normalizeMessage(message));
            if (applyAfterSave) {
                const applyMessage = await api.applyProfile(this.editorFile);
                this.addLog('success', normalizeMessage(applyMessage));
            }
            await this.loadProfiles();
            await this.openProfileEditor(this.editorFile);
        } catch (error) {
            this.addLog('error', `保存失败: ${formatError(error)}`);
        }
    }

    async validateProfile(filename) {
        try {
            const message = await api.validateProfile(filename);
            this.addLog('success', normalizeMessage(message));
        } catch (error) {
            this.addLog('error', `Profile 测试失败: ${formatError(error)}`);
        }
    }

    async copyProfile(filename) {
        try {
            const message = await api.copyProfile(filename);
            this.addLog('success', normalizeMessage(message));
            await this.loadProfiles();
        } catch (error) {
            this.addLog('error', `复制失败: ${formatError(error)}`);
        }
    }

    async deleteProfile(filename, label) {
        if (!confirm(`删除 Profile「${label}」？此操作不会删除 active.json。`)) {
            return;
        }

        try {
            const message = await api.deleteProfile(filename);
            this.addLog('warning', normalizeMessage(message));
            await this.loadProfiles();
        } catch (error) {
            this.addLog('error', `删除失败: ${formatError(error)}`);
        }
    }

    async warmupService() {
        const btn = document.getElementById('btn-warmup');
        btn.disabled = true;
        this.addLog('info', '请求模型预热...');

        try {
            const message = await api.warmupService(false);
            this.addLog('success', normalizeMessage(message));
        } catch (error) {
            this.addLog('warning', `预热未完成: ${formatError(error)}`);
        } finally {
            btn.disabled = false;
        }
    }

    async loadEnvironment() {
        this.addLog('info', '检测系统环境...');

        this.setEnvValue('env-os', '检测中...');
        this.setEnvValue('env-python', '检测中...');
        this.setEnvValue('env-network', '检测中...');
        this.setEnvValue('env-cuda', '检测中...');

        try {
            const env = await api.getEnvironment();

            this.setEnvValue('env-os', env.os || '未知', 'success');
            this.setEnvValue('env-python', env.python || '未检测到', env.python?.includes('未检测') ? 'error' : 'success');
            this.setEnvValue('env-network', env.port || env.network || '未检测', 'success');
            this.setEnvValue('env-cuda', env.cuda || '未检测到', env.cuda?.includes('未检测') ? 'error' : 'success');

            this.addLog('success', `环境检测完成 · ${env.root || '浏览器预览'}`);
        } catch (error) {
            this.addLog('error', `环境检测失败: ${formatError(error)}`);
        }
    }

    setEnvValue(id, text, state) {
        const el = document.getElementById(id);
        el.textContent = text;
        el.className = `env-value ${state || ''}`.trim();
    }

    async loadLogSnapshot(silent = false) {
        const version = document.getElementById('log-version-select').value || this.selectedVersion;
        if (!silent) {
            this.addLog('info', `读取 ${version} 最新日志...`);
        }

        try {
            const snapshot = await api.getLogSnapshot(version, 260);
            this.renderLogSnapshot(snapshot);
        } catch (error) {
            this.addLog('error', `读取日志失败: ${formatError(error)}`);
        }
    }

    refreshCurrentPage() {
        if (this.currentPage === 'mixer') {
            this.loadProfiles();
        } else if (this.currentPage === 'logs') {
            this.loadLogSnapshot();
        } else if (this.currentPage === 'environment') {
            this.loadEnvironment();
        } else {
            this.refreshAll();
        }
    }

    renderLogSnapshot(snapshot) {
        const logOutput = document.getElementById('log-output');
        this.replaceLogs([]);

        const fileLabel = snapshot.activeFile || '无日志文件';
        this.addLog('info', `${snapshot.version} · ${fileLabel}`);

        if (snapshot.files?.length) {
            const summary = snapshot.files.slice(0, 5).map(file => `${file.file} (${file.bytes} B)`).join(' · ');
            this.addLog('info', `最近日志: ${summary}`);
        }

        (snapshot.lines || []).forEach(line => {
            const level = logLevelForLine(line);
            this.addLog(level, line);
        });
    }

    updateStats() {
        const activeCount = this.profiles.filter(p => p.active).length;

        document.getElementById('stat-profiles').textContent = this.profiles.length;
        document.getElementById('stat-active').textContent = activeCount;
    }

    startUptimeCounter() {
        this.uptime = 0;
        clearInterval(this.uptimeInterval);
        this.uptimeInterval = setInterval(() => {
            this.uptime++;
            this.updateUptime();
        }, 1000);
    }

    stopUptimeCounter() {
        if (this.uptimeInterval) {
            clearInterval(this.uptimeInterval);
            this.uptimeInterval = null;
        }
        this.uptime = 0;
        this.updateUptime();
    }

    updateUptime() {
        const hours = Math.floor(this.uptime / 3600);
        const minutes = Math.floor((this.uptime % 3600) / 60);
        const seconds = this.uptime % 60;

        const display = hours > 0
            ? `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`
            : `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;

        document.getElementById('stat-uptime').textContent = display;
    }

    startLogAutoRefresh() {
        this.loadLogSnapshot(true);
        clearInterval(this.logRefreshInterval);
        this.logRefreshInterval = setInterval(() => {
            if (this.currentPage === 'logs') {
                this.loadLogSnapshot(true);
            }
        }, 5000);
    }

    stopLogAutoRefresh() {
        if (this.logRefreshInterval) {
            clearInterval(this.logRefreshInterval);
            this.logRefreshInterval = null;
        }
    }

    setupLogStream() {
        window.tauri_mock?.logStream?.addListener((entry) => {
            this.addLog(entry.level, `[${entry.timestamp}] ${entry.message}`);
        });
    }

    replaceLogs(entries) {
        this.logEntries = entries;
        this.renderLogEntries();
    }

    addLog(level, message) {
        const normalizedLevel = ['info', 'success', 'warning', 'error'].includes(level) ? level : 'info';
        const timestamp = new Date().toLocaleTimeString('zh-CN', { hour12: false });
        this.logEntries.push({
            level: normalizedLevel,
            message: String(message ?? ''),
            timestamp
        });
        if (this.logEntries.length > 1200) {
            this.logEntries.splice(0, this.logEntries.length - 1200);
        }
        this.renderLogEntries();
    }

    renderLogEntries() {
        const logOutput = document.getElementById('log-output');
        const levelFilter = document.getElementById('log-level-filter')?.value || 'all';
        const query = (document.getElementById('log-search')?.value || '').trim();
        const visibleEntries = this.logEntries.filter(entry => this.logEntryMatches(entry, levelFilter, query));

        logOutput.innerHTML = '';
        visibleEntries.forEach(entry => {
            const line = `[${entry.timestamp}] [${entry.level.toUpperCase()}] ${entry.message}`;
            const row = document.createElement('div');
            row.className = `log-entry log-${entry.level}`;
            row.innerHTML = highlightQuery(line, query);
            logOutput.appendChild(row);
        });

        if (!visibleEntries.length) {
            const empty = document.createElement('div');
            empty.className = 'log-empty';
            empty.textContent = this.logEntries.length ? '没有匹配当前筛选条件的日志' : '暂无日志';
            logOutput.appendChild(empty);
        }

        const count = document.getElementById('log-visible-count');
        if (count) {
            count.textContent = `${visibleEntries.length}/${this.logEntries.length}`;
        }
        logOutput.scrollTop = logOutput.scrollHeight;
    }

    logEntryMatches(entry, levelFilter, query) {
        const levelMatches = levelFilter === 'all'
            || (levelFilter === 'issues' && ['warning', 'error'].includes(entry.level))
            || entry.level === levelFilter;
        const text = `[${entry.timestamp}] [${entry.level.toUpperCase()}] ${entry.message}`.toLowerCase();
        return levelMatches && (!query || text.includes(query.toLowerCase()));
    }

    clearLogs() {
        this.replaceLogs([]);
        this.addLog('info', '日志已清空');
    }
}

function normalizeMessage(value) {
    if (typeof value === 'string') return value;
    return value?.message || JSON.stringify(value);
}

function formatError(error) {
    if (typeof error === 'string') return error;
    return error?.message || JSON.stringify(error);
}

function cleanStatusMessage(message) {
    const text = String(message ?? '').trim();
    if (!text) return '';
    if (text.includes('/health') || text.toLowerCase().includes('error sending request')) {
        return '服务未运行';
    }
    return text;
}

function formatRatio(value) {
    return Number(value).toFixed(3).replace(/0+$/, '').replace(/\.$/, '');
}

function escapeHtml(value) {
    return String(value ?? '')
        .replaceAll('&', '&amp;')
        .replaceAll('<', '&lt;')
        .replaceAll('>', '&gt;')
        .replaceAll('"', '&quot;')
        .replaceAll("'", '&#39;');
}

function escapeAttribute(value) {
    return escapeHtml(value).replaceAll('`', '&#96;');
}

function highlightQuery(value, query) {
    const text = String(value ?? '');
    const normalizedQuery = String(query ?? '').trim().toLowerCase();
    if (!normalizedQuery) return escapeHtml(text);

    const lower = text.toLowerCase();
    let cursor = 0;
    let output = '';
    while (cursor < text.length) {
        const index = lower.indexOf(normalizedQuery, cursor);
        if (index < 0) break;
        output += escapeHtml(text.slice(cursor, index));
        output += `<mark>${escapeHtml(text.slice(index, index + normalizedQuery.length))}</mark>`;
        cursor = index + normalizedQuery.length;
    }
    return output + escapeHtml(text.slice(cursor));
}

function logLevelForLine(line) {
    const text = String(line).toLowerCase();
    if (text.includes('error') || text.includes('traceback') || text.includes('failed') || text.includes('fatal') || text.includes('panic') || text.includes('exception')) return 'error';
    if (text.includes('warn') || text.includes('timeout') || text.includes('retry')) return 'warning';
    if (text.includes('ready') || text.includes('success') || text.includes('ok')) return 'success';
    return 'info';
}

function isTextEditingTarget(target) {
    const tagName = target?.tagName?.toLowerCase();
    return tagName === 'input' || tagName === 'textarea' || tagName === 'select' || Boolean(target?.isContentEditable);
}

document.addEventListener('DOMContentLoaded', () => {
    window.leonLauncher = new LeonLauncher();
});
