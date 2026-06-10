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
const STATUS_REFRESH_MS = 15000;
const LOG_REFRESH_MS = 12000;
const EMO_VEC_DEFAULT = [0, 0, 0, 0, 0, 0, 0, 0.85];
const DEFAULT_STYLE_SELECTION_RULES = [
    '- 旁白、动作描写、环境描写默认输出 style="neutral"。',
    '- 直接台词才根据语气选择声腔；长句优先低强度，短促反应用更明显的声腔。',
    '- 根据下方声腔映射的“适用场景”选择 style ID，不要输出不存在或已禁用的 ID。',
    '- 不确定时输出 style="neutral"，不要沿用上一段对白的声腔。'
].join('\n');
const DEFAULT_EMOTION_RULES = [
    '- LLM 主要负责选择 style ID；style 配置了声腔情绪向量时，后端优先使用配置值。',
    '- 只有某个 style 没配置情绪向量时，才让 LLM 按 happy/angry/sad/fear/hate/low/surprise/neutral 补 emo_vec。',
    '- 段级 emo_alpha 可以按语气微调，但不要覆盖声腔配置向量本身。'
].join('\n');
const EMOTION_FIELDS = [
    { key: 'happy', label: '高兴', hint: '轻松、笑意、愉悦' },
    { key: 'angry', label: '愤怒', hint: '生气、压迫、爆发' },
    { key: 'sad', label: '悲伤', hint: '伤心、哭腔、委屈' },
    { key: 'fear', label: '恐惧', hint: '紧张、害怕、惊慌' },
    { key: 'hate', label: '反感', hint: '厌恶、抗拒、不耐烦' },
    { key: 'low', label: '低落', hint: '压低、疲惫、克制' },
    { key: 'surprise', label: '惊讶', hint: '惊喘、意外、短促反应' },
    { key: 'neutral', label: '自然', hint: '平静、客观、旁白' }
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

    async getVoiceRefs() {
        if (tauriInvoke) return tauriInvoke('get_voice_refs');
        return window.tauri_mock.getVoiceRefs();
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
        this.voiceRefs = [];
        this.voiceRefMap = new Map();
        this.modalCloseHandler = null;

        this.init();
    }

    async init() {
        this.bindEvents();
        await this.refreshAll();
        await this.loadVoiceRefs();
        this.setupLogStream();
        this.statusInterval = setInterval(() => this.refreshServiceStatus(false), STATUS_REFRESH_MS);

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

        document.getElementById('btn-save-profile').addEventListener('click', () => {
            this.saveEditedProfile(false);
        });

        document.getElementById('btn-apply-edited-profile').addEventListener('click', () => {
            this.saveEditedProfile(true);
        });

        document.getElementById('btn-add-style').addEventListener('click', () => {
            this.openNewStyleModal();
        });

        document.addEventListener('click', (e) => {
            if (e.target.closest('.btn-delete-style')) {
                const row = e.target.closest('.style-row');
                if (row) this.confirmDeleteStyle(row);
            }
            const pickRefButton = e.target.closest('.btn-pick-ref');
            if (pickRefButton) {
                const row = pickRefButton.closest('.style-row');
                if (row) this.openRefPicker(row);
            }
            const clearRefsButton = e.target.closest('.btn-clear-refs');
            if (clearRefsButton) {
                const row = clearRefsButton.closest('.style-row');
                if (row) {
                    this.setRowRefs(row, []);
                    this.syncEditorToJson(false);
                }
            }
            const removeRefButton = e.target.closest('.btn-remove-ref');
            if (removeRefButton) {
                const row = removeRefButton.closest('.style-row');
                const ref = removeRefButton.dataset.ref;
                if (row && ref) {
                    this.setRowRefs(row, this.getRowRefs(row).filter(item => item !== ref));
                    this.syncEditorToJson(false);
                }
            }
            const editEmoButton = e.target.closest('.btn-edit-emo');
            if (editEmoButton) {
                const row = editEmoButton.closest('.style-row');
                if (row) this.openEmotionModal(row);
            }
            const modeButton = e.target.closest('.preset-mode-button');
            if (modeButton && this.editorProfile) {
                this.setEditorPresetMode(modeButton.dataset.mode);
            }
            const logVersionButton = e.target.closest('[data-log-version]');
            if (logVersionButton) {
                this.setLogVersion(logVersionButton.dataset.logVersion);
            }
            const logLevelButton = e.target.closest('[data-log-level]');
            if (logLevelButton) {
                this.setLogLevel(logLevelButton.dataset.logLevel);
            }
        });

        document.addEventListener('input', (e) => {
            if (e.target?.dataset?.styleField === 'ref') {
                const row = e.target.closest('.style-row');
                if (row) this.updateStyleRefHint(row);
            }
        });

        document.getElementById('page-editor')?.addEventListener('change', (e) => {
            if (!this.editorProfile || e.target?.id === 'editor-json') return;
            if (e.target?.matches?.('input, textarea, select')) {
                this.syncEditorToJson(false, { silent: true });
            }
        });

        document.getElementById('btn-clear-logs').addEventListener('click', () => {
            this.clearLogs();
        });

        document.getElementById('btn-refresh-logs').addEventListener('click', () => {
            this.loadLogSnapshot();
        });

        document.getElementById('log-version-select')?.addEventListener('change', () => {
            this.syncLogButtonState();
            if (this.currentPage === 'logs') {
                this.loadLogSnapshot();
            }
        });

        document.getElementById('log-level-filter')?.addEventListener('change', () => {
            this.syncLogButtonState();
            this.renderLogEntries();
        });

        document.getElementById('log-search').addEventListener('input', () => {
            this.renderLogEntries();
        });

        document.getElementById('btn-check-env').addEventListener('click', () => {
            this.loadEnvironment();
        });

        document.addEventListener('keydown', (event) => {
            if (event.key === 'Escape' && !event.altKey && !event.shiftKey && !event.ctrlKey) {
                if (this.closeModal()) {
                    event.preventDefault();
                }
                return;
            }
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
        this.syncLogButtonState();

        document.querySelector('.vllm-options')?.classList.toggle('hidden', normalized !== 'vllm');
        if (logChange) {
            this.addLog('info', `已选择 ${normalized === 'vllm' ? 'vLLM' : 'Fast6G'} 启动模式`);
            if (this.currentPage === 'logs') {
                this.loadLogSnapshot(true);
            }
        }
    }

    setLogVersion(version) {
        const normalized = version === 'fast6g' ? 'fast6g' : 'vllm';
        const select = document.getElementById('log-version-select');
        if (select) select.value = normalized;
        this.syncLogButtonState();
        if (this.currentPage === 'logs') {
            this.loadLogSnapshot(true);
        }
    }

    setLogLevel(level) {
        const normalized = ['all', 'issues', 'error', 'warning', 'success', 'info'].includes(level) ? level : 'all';
        const select = document.getElementById('log-level-filter');
        if (select) select.value = normalized;
        this.syncLogButtonState();
        this.renderLogEntries();
    }

    syncLogButtonState() {
        const version = document.getElementById('log-version-select')?.value || this.selectedVersion;
        const level = document.getElementById('log-level-filter')?.value || 'all';
        document.querySelectorAll('[data-log-version]').forEach(button => {
            button.classList.toggle('active', button.dataset.logVersion === version);
        });
        document.querySelectorAll('[data-log-level]').forEach(button => {
            button.classList.toggle('active', button.dataset.logLevel === level);
        });
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
        const value = Number(raw);
        if (!Number.isFinite(value)) {
            throw new Error('vLLM GPU 占比需要填写数字，例如 0.15');
        }
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

    async loadVoiceRefs() {
        try {
            this.voiceRefs = await api.getVoiceRefs();
            this.voiceRefMap = new Map();
            this.voiceRefs.forEach(item => {
                const key = normalizeRefKey(item.name);
                if (key) this.voiceRefMap.set(key, item);
                const relKey = normalizeRefKey(item.relativePath);
                if (relKey) this.voiceRefMap.set(relKey, item);
            });
            this.renderVoiceRefOptions();
        } catch (error) {
            this.voiceRefs = [];
            this.voiceRefMap = new Map();
            this.addLog('warning', `参考音频列表读取失败: ${formatError(error)}`);
        }
    }

    renderVoiceRefOptions() {
        const datalist = document.getElementById('voice-ref-options');
        if (!datalist) return;
        datalist.innerHTML = '';
        this.voiceRefs.slice(0, 900).forEach(item => {
            const option = document.createElement('option');
            option.value = item.name;
            option.label = item.relativePath || item.name;
            datalist.appendChild(option);
        });
    }

    findVoiceRef(value) {
        const key = normalizeRefKey(value);
        return key ? this.voiceRefMap.get(key) : null;
    }

    updateStyleRefHint(row) {
        const hint = row.querySelector('[data-ref-hint]');
        if (!hint) return;
        const styleId = row.dataset.styleId || '';
        const refs = this.getRowRefs(row);
        if (!refs.length) {
            hint.textContent = styleId === 'neutral'
                ? 'neutral 默认不叠加声腔参考。'
                : '非 neutral 声腔至少选择 1 个参考音频。';
            hint.className = 'style-ref-hint muted';
            return;
        }
        const missing = refs.filter(ref => !this.findVoiceRef(ref));
        if (!missing.length) {
            hint.textContent = refs.length === 1
                ? `将使用 ${this.findVoiceRef(refs[0])?.relativePath || refs[0]}`
                : `已选 ${refs.length} 个候选；后端按段落文本稳定选择其中一个。`;
            hint.className = 'style-ref-hint ok';
        } else if (this.voiceRefs.length) {
            hint.textContent = `未找到：${missing.slice(0, 2).join('、')}`;
            hint.className = 'style-ref-hint warn';
        } else {
            hint.textContent = '保存配置时会校验参考音频是否存在。';
            hint.className = 'style-ref-hint muted';
        }
    }

    getRowRefs(row) {
        const input = row.querySelector('[data-style-field="refs"]');
        try {
            const parsed = JSON.parse(input?.value || '[]');
            return Array.isArray(parsed) ? parsed.map(item => String(item || '').trim()).filter(Boolean) : [];
        } catch {
            return [];
        }
    }

    setRowRefs(row, refs) {
        const uniqueRefs = [...new Set((refs || []).map(item => String(item || '').trim()).filter(Boolean))];
        const input = row.querySelector('[data-style-field="refs"]');
        if (input) input.value = JSON.stringify(uniqueRefs);
        this.renderRowRefs(row);
        this.updateStyleRefHint(row);
    }

    renderRowRefs(row) {
        const list = row.querySelector('[data-ref-list]');
        if (!list) return;
        const refs = this.getRowRefs(row);
        if (!refs.length) {
            list.innerHTML = '<span class="ref-empty">未选择</span>';
            return;
        }
        list.innerHTML = refs.map(ref => `
            <span class="ref-chip">
                ${escapeHtml(ref)}
                <button type="button" class="btn-remove-ref" data-ref="${escapeAttribute(ref)}">×</button>
            </span>
        `).join('');
    }

    renderProfiles() {
        const container = document.getElementById('profiles-container');
        container.innerHTML = '';

        if (!this.profiles.length) {
            container.innerHTML = '<div class="empty-state">未找到配置文件</div>';
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

        const promptConfig = this.extractPromptConfig(profile, styles);

        document.getElementById('editor-title').textContent = profile.name || '配置详情';
        document.getElementById('editor-file').textContent = file;
        document.getElementById('editor-name').value = profile.name || '';
        document.getElementById('editor-description').value = profile.description || '';
        document.getElementById('editor-segment-rules').value = promptConfig.segmentRules;
        document.getElementById('editor-style-selection-rules').value = promptConfig.styleSelectionRules;
        document.getElementById('editor-emotion-rules').value = promptConfig.emotionRules;
        document.getElementById('editor-completeness-rules').value = promptConfig.completenessRules;
        document.getElementById('editor-custom-notes').value = promptConfig.customNotes;
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
            const enabled = style?.enabled !== false;
            const emoVec = Array.isArray(style?.emo_vec) ? style.emo_vec : EMO_VEC_DEFAULT;
            const refs = normalizeStyleRefs(style);
            row.innerHTML = `
                <div class="style-main">
                    <div class="style-title-row">
                        <span class="style-id">style="${escapeHtml(id)}"</span>
                        <label class="style-enabled">
                            <input data-style-field="enabled" type="checkbox" ${enabled ? 'checked' : ''}>
                            <span>启用</span>
                        </label>
                    </div>
                    <div class="style-row-grid">
                        <label>
                            <span>显示名</span>
                            <input data-style-field="label" value="${escapeAttribute(style?.label || '')}">
                        </label>
                        <label class="style-ref-field">
                            <span>参考音频</span>
                            <input data-style-field="refs" type="hidden" value="${escapeAttribute(JSON.stringify(refs))}">
                            <div class="style-ref-list" data-ref-list></div>
                            <div class="style-ref-actions">
                                <button type="button" class="btn-mini btn-pick-ref">选择声腔音频</button>
                                <button type="button" class="btn-mini btn-clear-refs">清空</button>
                            </div>
                            <em class="style-ref-hint" data-ref-hint></em>
                        </label>
                        <label class="style-description-field">
                            <span>适用场景</span>
                            <textarea data-style-field="description" rows="2" spellcheck="false">${escapeHtml(style?.description || '')}</textarea>
                        </label>
                    </div>
                </div>
                <div class="style-tuning">
                    <label>
                        <span>声腔强度</span>
                        <input data-style-field="style_alpha" type="number" step="0.01" min="0" max="1" value="${Number(style?.style_alpha ?? 0)}">
                    </label>
                    <label>
                        <span>声腔情绪权重</span>
                        <input data-style-field="emo_alpha" type="number" step="0.01" min="0" max="1" value="${Number(style?.emo_alpha ?? 0)}">
                    </label>
                    <label class="style-emo-vec-field">
                        <span>声腔情绪向量</span>
                        <input data-style-field="emo_vec" type="hidden" value="${escapeAttribute(formatEmoVec(emoVec))}">
                        <div class="emotion-summary" data-emo-summary>${escapeHtml(summarizeEmoVec(emoVec))}</div>
                        <button type="button" class="btn-mini btn-edit-emo">编辑情绪向量</button>
                    </label>
                    <button class="btn-delete-style">删除</button>
                </div>
            `;
            styleList.appendChild(row);
            this.renderRowRefs(row);
            this.updateStyleRefHint(row);
        });

        document.getElementById('editor-json').value = JSON.stringify(profile, null, 2);
    }

    openModal(html, onMount) {
        const backdrop = document.getElementById('modal-backdrop');
        const panel = document.getElementById('modal-panel');
        if (!backdrop || !panel) return false;

        this.closeModal();
        panel.innerHTML = html;
        backdrop.hidden = false;
        document.body.classList.add('modal-open');

        const backdropHandler = (event) => {
            if (event.target === backdrop) this.closeModal();
        };
        backdrop.addEventListener('mousedown', backdropHandler);

        this.modalCloseHandler = () => {
            backdrop.removeEventListener('mousedown', backdropHandler);
            backdrop.hidden = true;
            panel.innerHTML = '';
            document.body.classList.remove('modal-open');
            this.modalCloseHandler = null;
        };

        panel.querySelectorAll('.modal-close').forEach(button => {
            button.addEventListener('click', () => this.closeModal());
        });
        if (typeof onMount === 'function') onMount(panel);
        return true;
    }

    closeModal() {
        if (!this.modalCloseHandler) return false;
        this.modalCloseHandler();
        return true;
    }

    confirmDeleteStyle(row) {
        const id = row?.dataset?.styleId || '';
        if (!id) return;
        this.openModal(`
            <div class="modal-header">
                <div>
                    <h3>删除声腔</h3>
                    <p>删除后，LLM 再输出这个 style ID 会被后端拦截为配置错误。</p>
                </div>
                <button type="button" class="modal-close">×</button>
            </div>
            <div class="modal-body">
                <div class="delete-confirm-name">style="${escapeHtml(id)}"</div>
            </div>
            <div class="modal-actions">
                <button type="button" class="btn-secondary modal-close">取消</button>
                <button type="button" class="btn-secondary danger" id="btn-delete-style-confirm">删除</button>
            </div>
        `, (panel) => {
            panel.querySelector('#btn-delete-style-confirm')?.addEventListener('click', () => {
                row.remove();
                this.syncEditorToJson(false);
                this.closeModal();
            });
        });
    }

    openNewStyleModal() {
        if (!this.editorProfile) return;
        this.openModal(`
            <div class="modal-header">
                <div>
                    <h3>新增声腔</h3>
                    <p>Style ID 是 LLM 每段输出的名字，建议用英文、数字、下划线。</p>
                </div>
                <button type="button" class="modal-close">×</button>
            </div>
            <div class="modal-body modal-form">
                <label class="field">
                    <span>Style ID</span>
                    <input id="new-style-id" autocomplete="off" placeholder="例如 whisper_soft">
                </label>
                <label class="field">
                    <span>显示名</span>
                    <input id="new-style-label" autocomplete="off" placeholder="例如 耳语">
                </label>
                <label class="field full">
                    <span>适用场景</span>
                    <textarea id="new-style-description" rows="3" spellcheck="false" placeholder="这个声腔适合哪些文本。"></textarea>
                </label>
                <div class="modal-error" id="new-style-error"></div>
            </div>
            <div class="modal-actions">
                <button type="button" class="btn-secondary modal-close">取消</button>
                <button type="button" class="btn-secondary primary" id="btn-create-style-confirm">创建并选择参考音频</button>
            </div>
        `, (panel) => {
            const idInput = panel.querySelector('#new-style-id');
            const labelInput = panel.querySelector('#new-style-label');
            const error = panel.querySelector('#new-style-error');
            idInput?.focus();
            panel.querySelector('#btn-create-style-confirm')?.addEventListener('click', () => {
                const rawId = idInput.value.trim();
                const id = normalizeStyleId(rawId);
                if (!id) {
                    error.textContent = 'Style ID 不能为空。';
                    return;
                }
                if (!this.editorProfile.styles) this.editorProfile.styles = {};
                if (this.editorProfile.styles[id]) {
                    error.textContent = `style="${id}" 已存在。`;
                    return;
                }
                this.editorProfile.styles[id] = {
                    enabled: true,
                    label: labelInput.value.trim() || id,
                    ref: '',
                    refs: [],
                    style_alpha: 0.4,
                    emo_alpha: 0.3,
                    emo_vec: [...EMO_VEC_DEFAULT],
                    description: panel.querySelector('#new-style-description')?.value.trim() || ''
                };
                this.closeModal();
                this.renderProfileEditor();
                const row = document.querySelector(`#editor-styles .style-row[data-style-id="${CSS.escape(id)}"]`);
                if (row) this.openRefPicker(row);
            });
        });
    }

    async openRefPicker(row) {
        if (!row) return;
        if (!this.voiceRefs.length) await this.loadVoiceRefs();

        const styleId = row.dataset.styleId || '';
        const selected = new Set(this.getRowRefs(row));
        this.openModal(`
            <div class="modal-header">
                <div>
                    <h3>选择声腔参考音频</h3>
                    <p>只读取 prompts/library/声腔。一个 style 可以选多个候选，后端按段落文本稳定选择其中一个。</p>
                </div>
                <button type="button" class="modal-close">×</button>
            </div>
            <div class="modal-body ref-picker">
                <div class="ref-picker-top">
                    <input id="ref-picker-search" type="search" placeholder="搜索文件名、人物或分组" spellcheck="false">
                    <div class="ref-selected-count" id="ref-selected-count"></div>
                </div>
                <div class="ref-picker-list" id="ref-picker-list"></div>
            </div>
            <div class="modal-actions">
                <button type="button" class="btn-secondary modal-close">取消</button>
                <button type="button" class="btn-secondary primary" id="btn-apply-refs">使用选中的参考音频</button>
            </div>
        `, (panel) => {
            const search = panel.querySelector('#ref-picker-search');
            const list = panel.querySelector('#ref-picker-list');
            const count = panel.querySelector('#ref-selected-count');
            const order = new Map(this.voiceRefs.map((item, index) => [item.name, index]));

            const updateCount = () => {
                count.textContent = selected.size
                    ? `已选 ${selected.size} 个候选`
                    : (styleId === 'neutral' ? 'neutral 可以不选' : '至少选择 1 个');
            };
            const sortedSelected = () => [...selected].sort((a, b) => {
                const ai = order.has(a) ? order.get(a) : 99999;
                const bi = order.has(b) ? order.get(b) : 99999;
                return ai - bi || a.localeCompare(b, 'zh-Hans-CN');
            });

            const renderList = () => {
                const query = (search?.value || '').trim().toLowerCase();
                const filtered = this.voiceRefs.filter(item => {
                    if (!query) return true;
                    const group = voiceRefGroupName(item).toLowerCase();
                    return String(item.name || '').toLowerCase().includes(query)
                        || String(item.relativePath || '').toLowerCase().includes(query)
                        || group.includes(query);
                });

                const groups = groupVoiceRefs(filtered);
                const knownNames = new Set(this.voiceRefs.map(item => item.name));
                const unknownSelected = [...selected]
                    .filter(ref => !knownNames.has(ref))
                    .map(ref => ({ name: ref, relativePath: '当前配置中保留，但声腔目录未找到', subdir: '未找到' }));
                if (unknownSelected.length && !query) groups.unshift({ name: '当前配置中未找到', items: unknownSelected });

                if (!groups.length) {
                    list.innerHTML = '<div class="empty-state compact">prompts/library/声腔 下没有匹配音频。</div>';
                    updateCount();
                    return;
                }

                list.innerHTML = groups.map(group => `
                    <section class="ref-group">
                        <div class="ref-group-title">${escapeHtml(group.name)} <span>${group.items.length}</span></div>
                        <div class="ref-options">
                            ${group.items.map(item => `
                                <label class="ref-option">
                                    <input type="checkbox" value="${escapeAttribute(item.name)}" ${selected.has(item.name) ? 'checked' : ''}>
                                    <span>
                                        <b>${escapeHtml(stripAudioExt(item.name).split('/').pop() || item.name)}</b>
                                        <em>${escapeHtml(item.relativePath || item.name)}</em>
                                    </span>
                                </label>
                            `).join('')}
                        </div>
                    </section>
                `).join('');

                list.querySelectorAll('input[type="checkbox"]').forEach(checkbox => {
                    checkbox.addEventListener('change', () => {
                        if (checkbox.checked) selected.add(checkbox.value);
                        else selected.delete(checkbox.value);
                        updateCount();
                    });
                });
                updateCount();
            };

            search?.addEventListener('input', renderList);
            panel.querySelector('#btn-apply-refs')?.addEventListener('click', () => {
                this.setRowRefs(row, sortedSelected());
                this.syncEditorToJson(false);
                this.closeModal();
            });
            renderList();
            search?.focus();
        });
    }

    openEmotionModal(row) {
        const input = row?.querySelector('[data-style-field="emo_vec"]');
        if (!input) return;

        let values;
        try {
            values = parseEmoVec(input.value, 'emo_vec');
        } catch {
            values = [...EMO_VEC_DEFAULT];
        }

        this.openModal(`
            <div class="modal-header">
                <div>
                    <h3>编辑声腔情绪向量</h3>
                    <p>这个向量是 style 的硬配置。选中该 style 后优先使用它，LLM 不再猜这一段的情绪向量。</p>
                </div>
                <button type="button" class="modal-close">×</button>
            </div>
            <div class="modal-body emotion-editor">
                <div class="emotion-presets">
                    <button type="button" data-emo-preset="neutral">自然</button>
                    <button type="button" data-emo-preset="sad">悲伤</button>
                    <button type="button" data-emo-preset="happy">高兴</button>
                    <button type="button" data-emo-preset="fear">紧张</button>
                </div>
                <div class="emotion-current" id="emotion-current">${escapeHtml(summarizeEmoVec(values))}</div>
                <div class="emotion-grid">
                    ${EMOTION_FIELDS.map((field, index) => `
                        <label class="emotion-row">
                            <span>
                                <b>${escapeHtml(field.label)}</b>
                                <em>${escapeHtml(field.hint)}</em>
                            </span>
                            <input type="range" min="0" max="1" step="0.01" value="${escapeAttribute(values[index] ?? 0)}" data-emo-index="${index}">
                            <input type="number" min="0" max="1" step="0.01" value="${escapeAttribute(values[index] ?? 0)}" data-emo-number="${index}">
                        </label>
                    `).join('')}
                </div>
            </div>
            <div class="modal-actions">
                <button type="button" class="btn-secondary modal-close">取消</button>
                <button type="button" class="btn-secondary primary" id="btn-apply-emotion">保存情绪向量</button>
            </div>
        `, (panel) => {
            const current = panel.querySelector('#emotion-current');
            const clamp = value => Math.max(0, Math.min(1, Number(value) || 0));
            const updateValue = (index, value) => {
                values[index] = Number(clamp(value).toFixed(2));
                const range = panel.querySelector(`[data-emo-index="${index}"]`);
                const number = panel.querySelector(`[data-emo-number="${index}"]`);
                if (range) range.value = values[index];
                if (number) number.value = values[index];
                current.textContent = summarizeEmoVec(values);
            };

            panel.querySelectorAll('[data-emo-index]').forEach(range => {
                range.addEventListener('input', () => updateValue(Number(range.dataset.emoIndex), range.value));
            });
            panel.querySelectorAll('[data-emo-number]').forEach(number => {
                number.addEventListener('input', () => updateValue(Number(number.dataset.emoNumber), number.value));
            });
            panel.querySelectorAll('[data-emo-preset]').forEach(button => {
                button.addEventListener('click', () => {
                    emotionPreset(button.dataset.emoPreset).forEach((value, index) => updateValue(index, value));
                });
            });
            panel.querySelector('#btn-apply-emotion')?.addEventListener('click', () => {
                input.value = formatEmoVec(values);
                const summary = row.querySelector('[data-emo-summary]');
                if (summary) summary.textContent = summarizeEmoVec(values);
                this.syncEditorToJson(false);
                this.closeModal();
            });
        });
    }

    setEditorPresetMode(mode) {
        if (!mode || !this.editorProfile) return;
        this.syncPresetFieldsIntoProfile(this.editorProfile);
        this.editorProfile.quality = this.editorProfile.quality || {};
        this.editorProfile.quality.defaultMode = mode;
        this.editorPresetMode = mode;
        const select = document.getElementById('editor-default-mode');
        if (select) select.value = mode;
        this.renderPresetEditor(this.editorProfile);
        document.getElementById('editor-json').value = JSON.stringify(this.editorProfile, null, 2);
    }

    renderPresetEditor(profile) {
        const container = document.getElementById('editor-preset-fields');
        container.innerHTML = '';
        const mode = this.editorPresetMode || profile?.quality?.defaultMode;
        if (!mode) {
            container.innerHTML = '<div class="empty-state compact">未选择默认档位</div>';
            return;
        }
        const modes = Array.isArray(profile?.quality?.modes) ? profile.quality.modes.filter(item => item?.id && item.id !== 'custom') : [];

        const modePanel = document.createElement('div');
        modePanel.className = 'preset-mode-panel';
        modePanel.innerHTML = `
            <div class="preset-mode-copy">
                <strong>1. 选择默认档位</strong>
                <span>切换后，下方 LIVE/DISK 显示并保存这个档位的参数。</span>
            </div>
            <div class="preset-mode-buttons">
                ${modes.map(item => `
                    <button
                        type="button"
                        class="preset-mode-button ${item.id === mode ? 'active' : ''}"
                        data-mode="${escapeAttribute(item.id)}"
                    >${escapeHtml(item.label || item.id)}</button>
                `).join('')}
            </div>
        `;
        container.appendChild(modePanel);

        const groups = document.createElement('div');
        groups.className = 'preset-groups';

        PRESET_GROUPS.forEach(group => {
            const preset = profile?.quality?.presets?.[group.key]?.[mode] || {};
            const panel = document.createElement('div');
            panel.className = 'preset-group';
            panel.innerHTML = `
                <div class="preset-title">
                    <strong>${escapeHtml(group.label)}</strong>
                    <span>当前档位：${escapeHtml(mode)}</span>
                </div>
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
            groups.appendChild(panel);
        });
        container.appendChild(groups);
    }

    extractPromptConfig(profile, styles) {
        const config = profile.llmPromptConfig || {};
        const parsed = profile.llmPrompt ? this.parseLlmPrompt(profile.llmPrompt) : {};
        return {
            segmentRules: config.segmentRules || parsed.segmentRules || '',
            styleSelectionRules: config.styleSelectionRules || stripGeneratedStyleCatalog(parsed.styleSelectionRules) || defaultStyleRulesFor(styles),
            emotionRules: config.emotionRules || parsed.emotionRules || DEFAULT_EMOTION_RULES,
            completenessRules: config.completenessRules || parsed.completenessRules || '',
            customNotes: config.customNotes || parsed.customNotes || ''
        };
    }

    parseLlmPrompt(llmPrompt) {
        let segmentRules = '';
        let styleSelectionRules = '';
        let emotionRules = '';
        let completenessRules = '';
        let customNotes = '';

        const segmentMatch = llmPrompt.match(/(?:拆段与说话人规则|拆段规则):\n([\s\S]*?)(?:\n+声腔选择规则:|\n+{{style_rules}}|\n+完整性硬规则:)/);
        if (segmentMatch) {
            segmentRules = segmentMatch[1].trim();
        }

        const styleMatch = llmPrompt.match(/声腔选择规则:\n(?:{{style_rules}}\n)?([\s\S]*?)(?:\n+(?:情绪强度规则|段级情绪补充规则):|\n+{{emotion_rules}}|\n+完整性硬规则:)/);
        if (styleMatch) {
            styleSelectionRules = styleMatch[1].trim();
        }

        const emotionMatch = llmPrompt.match(/(?:情绪强度规则|段级情绪补充规则):\n(?:{{emotion_rules}}\n)?([\s\S]*?)(?:\n+完整性硬规则:|$)/);
        if (emotionMatch) {
            emotionRules = emotionMatch[1].trim();
        }

        const completenessMatch = llmPrompt.match(/完整性硬规则:\n([\s\S]*?)(?:\n\n示例输入:|$)/);
        if (completenessMatch) {
            completenessRules = completenessMatch[1].trim();
            const noteMatch = completenessRules.match(/([\s\S]*?)\n\n补充说明:\n([\s\S]*)$/);
            if (noteMatch) {
                completenessRules = noteMatch[1].trim();
                customNotes = noteMatch[2].trim();
            }
        }

        return { segmentRules, styleSelectionRules, emotionRules, completenessRules, customNotes };
    }

    buildLlmPrompt(config) {
        const segmentRules = config.segmentRules || '';
        const styleSelectionRules = config.styleSelectionRules || '';
        const emotionRules = config.emotionRules || '';
        const completenessRules = config.completenessRules || '';
        const customNotes = config.customNotes || '';
        let prompt = `你是中文小说→TTS 片段拆分器。只返回严格 JSON，不要任何解释，不要 \`\`\` 代码块。

{{roles_hint}}
{{user_alias_hint}}
{{character_hint}}
输出格式:
{{output_contract}}

拆段与说话人规则:
${segmentRules}

声腔选择规则:
{{style_rules}}
${styleSelectionRules ? `\n${styleSelectionRules}` : ''}

段级情绪补充规则:
{{emotion_rules}}
${emotionRules ? `\n${emotionRules}` : ''}

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

    syncEditorToJson(logResult, options = {}) {
        if (!this.editorProfile) {
            return null;
        }

        const silent = Boolean(options.silent);
        const profile = structuredClone(this.editorProfile || {});

        profile.name = document.getElementById('editor-name').value.trim();
        profile.description = document.getElementById('editor-description').value.trim();

        // 保存用户编辑的结构化字段
        const promptConfig = {
            segmentRules: document.getElementById('editor-segment-rules').value.trim(),
            styleSelectionRules: document.getElementById('editor-style-selection-rules').value.trim(),
            emotionRules: document.getElementById('editor-emotion-rules').value.trim(),
            completenessRules: document.getElementById('editor-completeness-rules').value.trim(),
            customNotes: document.getElementById('editor-custom-notes').value.trim()
        };

        profile.llmPromptConfig = promptConfig;

        // 自动构建完整的 llmPrompt（后端使用）
        profile.llmPrompt = this.buildLlmPrompt(promptConfig);

        profile.quality = profile.quality || {};
        profile.quality.defaultMode = document.getElementById('editor-default-mode').value;
        profile.styles = profile.styles && typeof profile.styles === 'object' ? profile.styles : {};

        try {
            document.querySelectorAll('#editor-styles .style-row').forEach(row => {
                const id = row.dataset.styleId;
                const style = profile.styles[id] || {};
                row.querySelectorAll('[data-style-field]').forEach(input => {
                    const field = input.dataset.styleField;
                    if (input.type === 'checkbox') {
                        style[field] = input.checked;
                    } else if (input.type === 'number') {
                        style[field] = Number(input.value);
                    } else if (field === 'refs') {
                        const refs = parseRefs(input.value, `styles.${id}.refs`);
                        style.refs = refs;
                        style.ref = refs[0] || '';
                    } else if (field === 'emo_vec') {
                        style[field] = parseEmoVec(input.value, `styles.${id}.emo_vec`);
                    } else {
                        style[field] = input.value;
                    }
                });
                profile.styles[id] = style;
            });
        } catch (error) {
            if (!silent) this.addLog('error', formatError(error));
            return null;
        }
        this.syncPresetFieldsIntoProfile(profile);

        this.editorProfile = profile;
        document.getElementById('editor-json').value = JSON.stringify(profile, null, 2);
        if (logResult && !silent) {
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
            this.closeProfileEditor();
        } catch (error) {
            this.addLog('error', `保存失败: ${formatError(error)}`);
        }
    }

    async validateProfile(filename) {
        try {
            const message = await api.validateProfile(filename);
            this.addLog('success', normalizeMessage(message));
        } catch (error) {
            this.addLog('error', `Profile 校验失败: ${formatError(error)}`);
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
        this.openModal(`
            <div class="modal-header">
                <div>
                    <h3>删除 Profile</h3>
                    <p>只删除源配置文件，不会删除 active.json。</p>
                </div>
                <button type="button" class="modal-close">×</button>
            </div>
            <div class="modal-body">
                <div class="delete-confirm-name">${escapeHtml(label || filename)}</div>
            </div>
            <div class="modal-actions">
                <button type="button" class="btn-secondary modal-close">取消</button>
                <button type="button" class="btn-secondary danger" id="btn-delete-profile-confirm">删除</button>
            </div>
        `, (panel) => {
            panel.querySelector('#btn-delete-profile-confirm')?.addEventListener('click', async () => {
                try {
                    const message = await api.deleteProfile(filename);
                    this.addLog('warning', normalizeMessage(message));
                    this.closeModal();
                    await this.loadProfiles();
                } catch (error) {
                    this.addLog('error', `删除失败: ${formatError(error)}`);
                }
            });
        });
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

        (snapshot.lines || []).filter(line => !isSelfPollLogLine(line)).forEach(line => {
            const parsed = parseLogSnapshotLine(line);
            this.addLog(parsed.level, parsed.message, parsed.timestamp);
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
        }, LOG_REFRESH_MS);
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

    addLog(level, message, timestampOverride = null) {
        const normalizedLevel = ['info', 'success', 'warning', 'error'].includes(level) ? level : 'info';
        const timestamp = timestampOverride || new Date().toLocaleTimeString('zh-CN', { hour12: false });
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

function defaultStyleRulesFor(styles) {
    return DEFAULT_STYLE_SELECTION_RULES;
}

function stripGeneratedStyleCatalog(value) {
    return String(value ?? '').replace(/\n*当前常用声腔：[\s\S]*$/u, '').trim();
}

function normalizeStyleId(raw) {
    return String(raw ?? '')
        .trim()
        .replace(/\s+/g, '_')
        .replace(/[^\w\-\u4e00-\u9fff]/g, '')
        .slice(0, 80);
}

function normalizeStyleRefs(style) {
    const refs = [];
    if (Array.isArray(style?.refs)) refs.push(...style.refs);
    if (style?.ref) refs.push(style.ref);
    return [...new Set(refs.map(item => String(item || '').trim()).filter(Boolean))];
}

function parseRefs(value, fieldName) {
    let parsed;
    try {
        parsed = JSON.parse(String(value ?? '[]'));
    } catch {
        throw new Error(`${fieldName} 必须是字符串数组`);
    }
    if (!Array.isArray(parsed)) {
        throw new Error(`${fieldName} 必须是字符串数组`);
    }
    return [...new Set(parsed.map(item => String(item || '').trim()).filter(Boolean))];
}

function summarizeEmoVec(vec) {
    const values = Array.isArray(vec) ? vec.map(item => Number(item || 0)) : EMO_VEC_DEFAULT;
    const active = values
        .map((value, index) => ({ value, label: EMOTION_FIELDS[index]?.label || `#${index + 1}` }))
        .filter(item => item.value > 0.015)
        .sort((a, b) => b.value - a.value)
        .slice(0, 3);
    if (!active.length) return '未设置；将由 LLM 提供';
    return active.map(item => `${item.label} ${formatRatio(item.value)}`).join(' · ');
}

function emotionPreset(name) {
    const presets = {
        neutral: [0, 0, 0, 0, 0, 0, 0, 0.85],
        sad: [0, 0, 0.55, 0.05, 0, 0.22, 0, 0.30],
        happy: [0.45, 0, 0, 0, 0, 0.04, 0.08, 0.50],
        fear: [0, 0, 0.08, 0.40, 0, 0.16, 0.22, 0.32],
    };
    return [...(presets[name] || presets.neutral)];
}

function voiceRefGroupName(item) {
    const leaf = stripAudioExt(String(item?.name || '').replaceAll('\\', '/').split('/').pop() || '');
    const parts = leaf.split('-').map(part => part.trim()).filter(Boolean);
    if (parts.length >= 2) return parts[parts.length - 1];
    return item?.subdir || '声腔素材';
}

function groupVoiceRefs(refs) {
    const map = new Map();
    refs.forEach(item => {
        const group = voiceRefGroupName(item);
        if (!map.has(group)) map.set(group, []);
        map.get(group).push(item);
    });
    return [...map.entries()]
        .map(([name, items]) => ({
            name,
            items: items.sort((a, b) => String(a.name || '').localeCompare(String(b.name || ''), 'zh-Hans-CN'))
        }))
        .sort((a, b) => a.name.localeCompare(b.name, 'zh-Hans-CN'));
}

function formatEmoVec(value) {
    const vec = Array.isArray(value) && value.length ? value : EMO_VEC_DEFAULT;
    return `[${vec.map(item => Number(item || 0)).join(', ')}]`;
}

function parseEmoVec(value, fieldName) {
    const text = String(value ?? '').trim();
    if (!text) {
        throw new Error(`${fieldName} 不能为空，必须是 8 维数组`);
    }
    const parsed = text
        .replace(/^\[/, '')
        .replace(/\]$/, '')
        .split(',')
        .map(item => Number(item.trim()));
    if (parsed.length !== 8 || parsed.some(item => !Number.isFinite(item))) {
        throw new Error(`${fieldName} 必须是 8 维数字数组`);
    }
    return parsed;
}

function normalizeRefKey(value) {
    const text = String(value ?? '')
        .trim()
        .replaceAll('\\', '/')
        .replace(/^.*?prompts\/library\//i, '')
        .replace(/^\.?\//, '');
    if (!text) return '';
    return stripAudioExt(text).toLowerCase();
}

function stripAudioExt(value) {
    return String(value ?? '').replace(/\.(wav|mp3|flac|ogg|m4a)$/i, '');
}

function isSelfPollLogLine(line) {
    const text = String(line ?? '').toLowerCase();
    return text.includes('get /health ')
        || text.includes('get /health?')
        || text.includes('/server_log/tail')
        || text.includes('error sending request for url') && text.includes('/health');
}

function parseLogSnapshotLine(line) {
    const text = String(line ?? '').trimEnd();
    const launcherMatch = text.match(/^\[(\d{2}:\d{2}:\d{2})\]\s+\[(INFO|SUCCESS|WARNING|ERROR)\]\s*(.*)$/i);
    if (launcherMatch) {
        return {
            timestamp: launcherMatch[1],
            level: launcherMatch[2].toLowerCase(),
            message: launcherMatch[3]
        };
    }
    const backendMatch = text.match(/^(INFO|WARNING|ERROR)\s+(\d{2}-\d{2}\s+\d{2}:\d{2}:\d{2})\s+(.*)$/i);
    if (backendMatch) {
        return {
            timestamp: backendMatch[2],
            level: backendMatch[1].toLowerCase(),
            message: backendMatch[3]
        };
    }
    return {
        timestamp: null,
        level: logLevelForLine(text),
        message: text
    };
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
