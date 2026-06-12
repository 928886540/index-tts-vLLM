// ==================== 应用主逻辑 ====================

const tauriInvoke = window.__TAURI__?.core?.invoke;
const PRESET_FIELDS = [
    { key: 'diffusion_steps', label: '扩散步数', step: '1', defaultValue: 14 },
    { key: 'prompt_audio_seconds', label: '参考秒数', step: '0.5', defaultValue: 10 },
    { key: 'segment_tokens', label: '分段 tokens', step: '1', defaultValue: 60 },
    { key: 'first_tokens', label: '首段 tokens', step: '1', defaultValue: 18 },
    { key: 's2mel_cfg_rate', label: 'CFG rate', step: '0.01', defaultValue: 0.7 },
    { key: 'interval_ms', label: '段间隔 ms', step: '1', defaultValue: 50 },
    { key: 'top_p', label: 'Top P', step: '0.01', defaultValue: 0.8 },
    { key: 'top_k', label: 'Top K', step: '1', defaultValue: 30 },
    { key: 'temperature', label: 'Temperature', step: '0.01', defaultValue: 0.7 },
    { key: 'repetition_penalty', label: '重复惩罚', step: '0.01', defaultValue: 1.2 }
];
const PRESET_GROUPS = [
    { key: 'live', label: 'LIVE' },
    { key: 'generate', label: 'DISK' }
];
const STATUS_REFRESH_MS = 15000;
const LOG_REFRESH_MS = 12000;
const EMO_VEC_DEFAULT = [0, 0, 0, 0, 0, 0, 0, 0.85];
const DEFAULT_STYLE_SELECTION_RULES = [
    '- 根据语气强度选择声腔，不要把“旁白”固定等同于 style="neutral"。',
    '- 只有纯环境、普通动作、平铺过渡、信息说明，或完全无法判断情绪时，才使用 style="neutral"。',
    '- 旁白如果包含贴近低声、呼吸/喘息、紧张、害羞、哭腔、惊讶、暧昧、身体反应、阶段升温/高点/余韵等明确语气，也必须选择对应声腔。',
    '- 可优先参考这些映射：轻微呼吸/贴近=breath_soft；紧张惊讶=tense_breath 或 gasp_surprise；压抑哭意=sob_soft 或 cry_soft；低声/耳语=low_murmur 或 whisper_soft；升温/高点/余韵=stage_warmup / stage_rising / stage_peak / stage_afterglow。',
    '- 长句优先低强度 style 或 stage_*，短促反应用更明显的声腔；不要连续大段无脑 neutral。',
    '- 根据下方声腔映射的“适用场景”选择 style ID，不要输出不存在或已禁用的 ID；不确定时才用 neutral，且不要沿用上一段对白的声腔。',
    '- 示例输出只演示 JSON 格式，不代表旁白必须 neutral。'
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

    async getVoiceRefAudio(refName) {
        if (tauriInvoke) return tauriInvoke('get_voice_ref_audio', { refName });
        return window.tauri_mock.getVoiceRefAudio(refName);
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
    },

    async getRecentGenerations(version, page = 1, pageSize = 12) {
        if (tauriInvoke) return tauriInvoke('get_recent_generations', { version, page, pageSize });
        return window.tauri_mock.getRecentGenerations(version, page, pageSize);
    },

    async uploadVoice(name, data, ext) {
        if (tauriInvoke) return tauriInvoke('upload_voice', { name, data, ext });
        return Promise.resolve('prompts/library/' + name + ext);
    },

    async deleteVoice(name) {
        if (tauriInvoke) return tauriInvoke('delete_voice', { name });
        return Promise.resolve('已删除: ' + name);
    },

    async moveVoice(name, newGroup) {
        if (tauriInvoke) return tauriInvoke('move_voice', { name, newGroup });
        return Promise.resolve('已移动');
    },

    async testVoiceGeneration(voice, style, text, profile) {
        if (tauriInvoke) return tauriInvoke('test_voice_generation', { voice, style, text, profile });
        return Promise.resolve('data:audio/wav;base64,UklGRi...');
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
        this.logSnapshotDropped = 0;
        this.logSnapshotFiles = [];
        this.selectedVersion = 'vllm';
        this.serviceUiState = 'stopped';
        this.voiceRefs = [];
        this.voiceRefMap = new Map();
        this.modalCloseHandler = null;
        this.voices = [];
        this.voiceGroups = [];
        this.selectedGroup = null;
        this.testHistory = [];
        this.currentAudio = null;
        this.currentAudioName = null;
        this.monitorInterval = null;
        this.generationRecords = [];
        this.generationRecordsPage = 1;
        this.generationRecordsPageSize = 10;
        this.generationRecordsTotal = 0;
        this.selectedTestVoice = null;
        this.selectedTestStyle = null;

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

        const saveBtn = document.getElementById('btn-save-profile');
        const applyBtn = document.getElementById('btn-apply-edited-profile');

        saveBtn?.addEventListener('click', () => {
            this.saveEditedProfile(false);
        });

        applyBtn?.addEventListener('click', () => {
            this.saveEditedProfile(true);
        });

        document.getElementById('btn-add-style').addEventListener('click', () => {
            this.openNewStyleModal();
        });

        document.addEventListener('click', (e) => {
            if (e.target.closest('.btn-delete-style') || e.target.closest('.btn-delete-style-mini')) {
                e.preventDefault();
                e.stopPropagation();
                const row = e.target.closest('.style-row');
                if (row) this.confirmDeleteStyle(row);
                return;
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
            const styleMiniCard = e.target.closest('.style-mini-card');
            if (styleMiniCard) {
                const row = styleMiniCard.closest('.style-row');
                if (row) this.openStyleEditorModal(row);
            }
            const expandButton = e.target.closest('.btn-expand-style');
            if (expandButton) {
                const row = expandButton.closest('.style-row');
                if (row) {
                    const detail = row.querySelector('.style-card-detail');
                    const isExpanded = !detail.hidden;
                    detail.hidden = isExpanded;
                    expandButton.textContent = isExpanded ? '展开' : '收起';
                }
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
            const logCategoryButton = e.target.closest('[data-log-category]');
            if (logCategoryButton) {
                this.setLogCategory(logCategoryButton.dataset.logCategory);
            }
            const generationPageButton = e.target.closest('[data-generation-page]');
            if (generationPageButton) {
                const targetPage = Number(generationPageButton.dataset.generationPage);
                if (Number.isFinite(targetPage)) {
                    this.refreshGenerationRecords(targetPage);
                }
            }
            const generationDetailButton = e.target.closest('[data-generation-detail]');
            if (generationDetailButton) {
                const index = Number(generationDetailButton.dataset.generationDetail);
                if (Number.isFinite(index)) this.openGenerationRecordModal(index);
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

        document.getElementById('log-category-filter')?.addEventListener('change', () => {
            this.syncLogButtonState();
            this.renderLogEntries();
        });

        document.getElementById('log-search').addEventListener('input', () => {
            this.renderLogEntries();
        });

        document.getElementById('btn-check-env').addEventListener('click', () => {
            this.loadEnvironment();
        });

        document.getElementById('btn-import-voice')?.addEventListener('click', () => {
            this.openImportVoiceModal();
        });

        document.getElementById('btn-test-voice')?.addEventListener('click', () => {
            this.openTestVoiceModal();
        });

        document.getElementById('btn-add-group')?.addEventListener('click', () => {
            this.openAddGroupModal();
        });

        document.getElementById('voice-search')?.addEventListener('input', () => {
            this.renderVoices();
        });

        document.getElementById('btn-test-generate')?.addEventListener('click', () => {
            this.generateTest();
        });

        document.getElementById('btn-select-voice')?.addEventListener('click', () => {
            this.openSelectVoiceModal();
        });

        document.getElementById('btn-select-style')?.addEventListener('click', () => {
            this.openSelectStyleModal();
        });

        document.getElementById('btn-clear-history')?.addEventListener('click', () => {
            this.testHistory = [];
            this.renderTestHistory();
        });

        document.querySelectorAll('.btn-preset').forEach(btn => {
            btn.addEventListener('click', () => {
                const text = btn.dataset.text;
                const input = document.getElementById('test-text-input');
                if (input) input.value = text;
            });
        });

        document.getElementById('btn-refresh-monitor')?.addEventListener('click', () => {
            this.refreshGenerationRecords(this.generationRecordsPage);
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
            } else if (this.currentPage === 'monitor') {
                this.refreshGenerationRecords(1);
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

    setLogCategory(category) {
        const normalized = ['useful', 'startup', 'error', 'rtf', 'all'].includes(category) ? category : 'useful';
        const select = document.getElementById('log-category-filter');
        if (select) select.value = normalized;
        this.syncLogButtonState();
        this.renderLogEntries();
    }

    syncLogButtonState() {
        const version = document.getElementById('log-version-select')?.value || this.selectedVersion;
        const level = document.getElementById('log-level-filter')?.value || 'all';
        const category = document.getElementById('log-category-filter')?.value || 'useful';
        document.querySelectorAll('[data-log-version]').forEach(button => {
            button.classList.toggle('active', button.dataset.logVersion === version);
        });
        document.querySelectorAll('[data-log-level]').forEach(button => {
            button.classList.toggle('active', button.dataset.logLevel === level);
        });
        document.querySelectorAll('[data-log-category]').forEach(button => {
            button.classList.toggle('active', button.dataset.logCategory === category);
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
        if (pageName === 'voices') {
            this.loadVoices();
        }
        if (pageName === 'test') {
            this.loadTestPage();
        }
        if (pageName === 'monitor') {
            this.startMonitor();
        } else {
            this.stopMonitor();
        }
    }

    async toggleService() {
        const btn = document.getElementById('btn-start');

        if (this.isRunning || this.serviceUiState === 'starting') {
            await this.stopService(btn);
        } else if (this.serviceUiState === 'stopping') {
            return;
        } else {
            await this.startService(btn);
        }

        this.updateStats();
    }

    async startService(btn) {
        btn.disabled = true;
        this.setServiceButtonState('starting');
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
            this.setRunningUi(false);
            btn.disabled = false;
            return;
        }

        this.addLog('info', `正在启动 ${version} 服务...`);
        this.setSystemStatus('starting', '服务启动中');

        try {
            const message = await api.startService(version, gpuRatio, enableMsvc);
            this.addLog('success', normalizeMessage(message));
            this.addLog('info', '启动命令已发送，正在加载模型并等待 API ready...');
            this.setServiceButtonState('starting');
            this.setSystemStatus('starting', '模型加载中');
            setTimeout(() => this.refreshServiceStatus(true), 1500);
            setTimeout(() => this.refreshServiceStatus(true), 6000);
            setTimeout(() => this.refreshServiceStatus(true), 15000);
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
        this.setServiceButtonState('stopping');
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
            const state = status.state || (running ? 'running' : 'stopped');

            if (running !== this.isRunning && logChanges) {
                this.addLog(running ? 'success' : 'warning', label);
            }

            if (!running && state === 'starting') {
                this.setServiceButtonState('starting');
                this.setSystemStatus('starting', '模型加载中');
                return;
            }

            this.setRunningUi(running);
            this.setSystemStatus(state, label);
        } catch (error) {
            this.setSystemStatus('stopped', '服务未运行');
        }
    }

    setRunningUi(running) {
        this.isRunning = running;
        this.setServiceButtonState(running ? 'running' : 'stopped');

        if (running && !this.uptimeInterval) this.startUptimeCounter();
        if (!running && this.uptimeInterval) this.stopUptimeCounter();
    }

    setServiceButtonState(state) {
        this.serviceUiState = state || 'stopped';
        const btn = document.getElementById('btn-start');
        if (!btn) return;
        const btnText = btn.querySelector('span');
        const btnIcon = btn.querySelector('.btn-icon path');
        const running = state === 'running';
        const pending = state === 'starting' || state === 'stopping';

        btn.classList.toggle('running', running);
        btn.classList.toggle('pending', pending);
        btn.classList.toggle('stopping', state === 'stopping');
        if (btnText) {
            btnText.textContent = state === 'starting'
                ? '启动中...'
                : state === 'stopping'
                    ? '停止中...'
                    : running
                        ? '停止 LEON 服务'
                        : '启动 LEON 服务';
        }
        if (btnIcon) {
            btnIcon.setAttribute('d', running || state === 'stopping' ? 'M6 4h4v16H6zM14 4h4v16h-4z' : 'M8 5v14l11-7z');
        }
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
        this.voiceCavityRefs().slice(0, 900).forEach(item => {
            const option = document.createElement('option');
            option.value = item.name;
            option.label = item.relativePath || item.name;
            datalist.appendChild(option);
        });
    }

    voiceCavityRefs() {
        return this.voiceRefs.filter(isVoiceCavityRef);
    }

    voiceCavityItems() {
        return this.voices.filter(isVoiceCavityRef);
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

            // 格式化时间为人类可读格式（东八区）
            let timeDisplay = '';
            const timestamp = profile.appliedAt || profile.updatedAt;
            if (timestamp) {
                const date = new Date(timestamp);
                const year = date.getFullYear();
                const month = String(date.getMonth() + 1).padStart(2, '0');
                const day = String(date.getDate()).padStart(2, '0');
                const hour = String(date.getHours()).padStart(2, '0');
                const minute = String(date.getMinutes()).padStart(2, '0');
                const second = String(date.getSeconds()).padStart(2, '0');
                timeDisplay = `${year}-${month}-${day} ${hour}:${minute}:${second}`;
            }
            const updated = timeDisplay ? `<div class="profile-updated">${timeDisplay}</div>` : '';

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
        document.getElementById('editor-style-count').textContent = `${Object.keys(styles).length} 个`;

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
                <div class="style-mini-card" data-style-id="${escapeAttribute(id)}">
                    <div class="style-mini-header">
                        <div class="style-mini-id">${escapeHtml(id)}</div>
                        <div class="style-mini-actions" onclick="event.stopPropagation()">
                            <label class="style-mini-toggle" title="启用">
                                <input data-style-field="enabled" type="checkbox" ${enabled ? 'checked' : ''}>
                            </label>
                            <button type="button" class="btn-delete-style-mini" title="删除声腔">×</button>
                        </div>
                    </div>
                    <div class="style-mini-label">${escapeHtml(style?.label || '未命名')}</div>
                    <div class="style-mini-meta">${refs.length} 个参考音频</div>
                </div>
                <input data-style-field="label" type="hidden" value="${escapeAttribute(style?.label || '')}">
                <input data-style-field="refs" type="hidden" value="${escapeAttribute(JSON.stringify(refs))}">
                <input data-style-field="style_alpha" type="hidden" value="${style?.style_alpha ?? ''}">
                <input data-style-field="emo_alpha" type="hidden" value="${style?.emo_alpha ?? ''}">
                <input data-style-field="emo_vec" type="hidden" value="${escapeAttribute(formatEmoVec(emoVec))}">
                <textarea data-style-field="description" hidden>${escapeHtml(style?.description || '')}</textarea>
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

        let cleanup = null;
        this.modalCloseHandler = () => {
            if (typeof cleanup === 'function') {
                try { cleanup(); } catch (error) { console.warn('modal cleanup failed', error); }
            }
            backdrop.removeEventListener('mousedown', backdropHandler);
            backdrop.hidden = true;
            panel.innerHTML = '';
            document.body.classList.remove('modal-open');
            this.modalCloseHandler = null;
        };

        panel.querySelectorAll('.modal-close').forEach(button => {
            button.addEventListener('click', () => this.closeModal());
        });
        if (typeof onMount === 'function') {
            const maybeCleanup = onMount(panel);
            if (typeof maybeCleanup === 'function') cleanup = maybeCleanup;
        }
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

    async openRefPicker(row, options = {}) {
        if (!row) return;
        if (!this.voiceRefs.length) await this.loadVoiceRefs();
        const cavityRefs = this.voiceCavityRefs();

        const styleId = row.dataset.styleId || '';
        const selected = new Set(this.getRowRefs(row));
        const reopenStyleEditor = Boolean(options.reopenStyleEditor);
        const reopenParent = () => {
            if (reopenStyleEditor && row.isConnected) {
                setTimeout(() => this.openStyleEditorModal(row), 0);
            }
        };
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
            const order = new Map(cavityRefs.map((item, index) => [item.name, index]));
            let previewAudio = null;
            let previewRef = '';
            let previewToken = 0;
            panel.querySelectorAll('.modal-close').forEach(button => {
                button.addEventListener('click', reopenParent);
            });

            const updatePreviewButtons = () => {
                list.querySelectorAll('.btn-preview-ref').forEach(button => {
                    const isActive = previewRef && button.dataset.ref === previewRef;
                    button.textContent = isActive ? '停止' : '试听';
                    button.classList.toggle('playing', Boolean(isActive));
                    button.disabled = button.dataset.loading === '1';
                });
            };
            const stopPreview = () => {
                previewToken += 1;
                if (previewAudio) {
                    try { previewAudio.pause(); } catch {}
                    try { previewAudio.removeAttribute('src'); previewAudio.load(); } catch {}
                }
                previewAudio = null;
                previewRef = '';
                list.querySelectorAll('.btn-preview-ref').forEach(button => {
                    delete button.dataset.loading;
                    button.disabled = false;
                });
                updatePreviewButtons();
            };
            const playPreview = async (refName, button) => {
                if (!refName) return;
                if (previewRef === refName && previewAudio && !previewAudio.paused) {
                    stopPreview();
                    return;
                }
                stopPreview();
                const token = ++previewToken;
                if (button) {
                    button.dataset.loading = '1';
                    button.disabled = true;
                    button.textContent = '读取中';
                }
                try {
                    const dataUrl = await api.getVoiceRefAudio(refName);
                    if (token !== previewToken) return;
                    const audio = new Audio(dataUrl);
                    previewAudio = audio;
                    previewRef = refName;
                    audio.addEventListener('ended', stopPreview, { once: true });
                    audio.addEventListener('error', () => {
                        this.addLog('warning', `试听失败: ${refName}`);
                        stopPreview();
                    }, { once: true });
                    if (button) delete button.dataset.loading;
                    updatePreviewButtons();
                    const playResult = audio.play();
                    if (playResult && typeof playResult.catch === 'function') {
                        await playResult;
                    }
                } catch (error) {
                    if (token === previewToken) {
                        this.addLog('error', `试听失败 ${refName}: ${formatError(error)}`);
                        stopPreview();
                    }
                }
            };

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
                const filtered = cavityRefs.filter(item => {
                    if (!query) return true;
                    const group = voiceRefGroupName(item).toLowerCase();
                    return String(item.name || '').toLowerCase().includes(query)
                        || String(item.relativePath || '').toLowerCase().includes(query)
                        || group.includes(query);
                });

                const groups = groupVoiceRefs(filtered);
                const knownNames = new Set(cavityRefs.map(item => item.name));
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
                                    <button type="button" class="btn-preview-ref" data-ref="${escapeAttribute(item.name)}">试听</button>
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
                list.querySelectorAll('.btn-preview-ref').forEach(button => {
                    button.addEventListener('click', (event) => {
                        event.preventDefault();
                        event.stopPropagation();
                        playPreview(button.dataset.ref || '', button);
                    });
                });
                updateCount();
                updatePreviewButtons();
            };

            search?.addEventListener('input', renderList);
            panel.querySelector('#btn-apply-refs')?.addEventListener('click', () => {
                this.setRowRefs(row, sortedSelected());
                this.syncEditorToJson(false, { silent: true });
                this.closeModal();
                reopenParent();
            });
            renderList();
            search?.focus();
            return stopPreview;
        });
    }

    async openStyleEditorModal(row) {
        if (!row) return;
        const styleId = row.dataset.styleId || '';
        const profile = this.editorProfile;
        if (!profile?.styles?.[styleId]) return;

        const style = profile.styles[styleId];
        const refs = normalizeStyleRefs(style);
        const emoVec = Array.isArray(style?.emo_vec) ? style.emo_vec : EMO_VEC_DEFAULT;

        if (!this.voiceRefs.length) await this.loadVoiceRefs();

        this.openModal(`
            <div class="modal-header">
                <div>
                    <h3>编辑声腔：${escapeHtml(styleId)}</h3>
                    <p>配置该声腔的显示名、参考音频、强度和情绪参数</p>
                </div>
                <button type="button" class="modal-close">×</button>
            </div>
            <div class="modal-body style-editor-modal">
                <label class="field">
                    <span>显示名</span>
                    <input id="style-edit-label" type="text" value="${escapeAttribute(style?.label || '')}" placeholder="例如：耳语">
                </label>
                <label class="field">
                    <span>适用场景</span>
                    <textarea id="style-edit-desc" rows="2" placeholder="例如：耳语、哭腔、惊喘...">${escapeHtml(style?.description || '')}</textarea>
                </label>
                <div class="field">
                    <span>参考音频 <small id="style-edit-ref-count">${refs.length} 个</small></span>
                    <div class="style-ref-list" id="style-edit-refs"></div>
                    <button type="button" class="btn-secondary compact" id="btn-pick-refs-modal">选择参考音频</button>
                </div>
                <div class="style-params-grid">
                    <label>
                        <span>强度</span>
                        <input id="style-edit-alpha" type="number" step="0.01" min="0" max="1" value="${Number(style?.style_alpha ?? 0)}">
                    </label>
                    <label>
                        <span>情绪权重</span>
                        <input id="style-edit-emo-alpha" type="number" step="0.01" min="0" max="1" value="${Number(style?.emo_alpha ?? 0)}">
                    </label>
                </div>
                <div class="field">
                    <span>情绪向量</span>
                    <div class="emotion-summary" id="style-edit-emo-summary">${escapeHtml(summarizeEmoVec(emoVec))}</div>
                    <button type="button" class="btn-secondary compact" id="btn-edit-emo-modal">编辑情绪向量</button>
                </div>
            </div>
            <div class="modal-actions">
                <button type="button" class="btn-secondary modal-close">取消</button>
                <button type="button" class="btn-secondary primary" id="btn-save-style-edit">保存</button>
            </div>
        `, (panel) => {
            let currentRefs = [...refs];
            let currentEmoVec = [...emoVec];

            const renderRefs = () => {
                const container = panel.querySelector('#style-edit-refs');
                const count = panel.querySelector('#style-edit-ref-count');
                count.textContent = `${currentRefs.length} 个`;
                if (!currentRefs.length) {
                    container.innerHTML = '<div class="empty-state compact">未选择参考音频</div>';
                    return;
                }
                container.innerHTML = currentRefs.map(ref => `
                    <div class="ref-chip">
                        <span>${escapeHtml(stripAudioExt(ref).split('/').pop() || ref)}</span>
                        <button type="button" class="ref-chip-remove" data-ref="${escapeAttribute(ref)}">×</button>
                    </div>
                `).join('');
            };

            renderRefs();

            const commitStyleEditor = ({ sync = true, close = false } = {}) => {
                const nextRefs = [...currentRefs];
                style.label = panel.querySelector('#style-edit-label')?.value.trim() || '';
                style.description = panel.querySelector('#style-edit-desc')?.value.trim() || '';
                style.ref = nextRefs[0] || '';
                style.refs = nextRefs;
                style.style_alpha = Number(panel.querySelector('#style-edit-alpha')?.value ?? 0);
                style.emo_alpha = Number(panel.querySelector('#style-edit-emo-alpha')?.value ?? 0);
                style.emo_vec = currentEmoVec;

                row.querySelector('[data-style-field="label"]').value = style.label;
                row.querySelector('[data-style-field="refs"]').value = JSON.stringify(nextRefs);
                row.querySelector('[data-style-field="style_alpha"]').value = style.style_alpha;
                row.querySelector('[data-style-field="emo_alpha"]').value = style.emo_alpha;
                row.querySelector('[data-style-field="emo_vec"]').value = formatEmoVec(currentEmoVec);
                row.querySelector('[data-style-field="description"]').value = style.description;

                const card = row.querySelector('.style-mini-card');
                if (card) {
                    card.querySelector('.style-mini-label').textContent = style.label || '未命名';
                    card.querySelector('.style-mini-meta').textContent = `${nextRefs.length} 个参考音频`;
                }

                if (sync) this.syncEditorToJson(false, { silent: true });
                if (close) this.closeModal();
            };

            panel.querySelector('#btn-pick-refs-modal')?.addEventListener('click', async () => {
                commitStyleEditor({ sync: true });
                await this.openRefPicker(row, { reopenStyleEditor: true });
            });

            panel.querySelector('#style-edit-refs')?.addEventListener('click', (e) => {
                const removeBtn = e.target.closest('.ref-chip-remove');
                if (removeBtn) {
                    const ref = removeBtn.dataset.ref;
                    currentRefs = currentRefs.filter(r => r !== ref);
                    renderRefs();
                }
            });

            panel.querySelector('#btn-edit-emo-modal')?.addEventListener('click', () => {
                commitStyleEditor({ sync: true });
                this.openEmotionModal(row, { reopenStyleEditor: true });
            });

            panel.querySelector('#btn-save-style-edit')?.addEventListener('click', () => {
                commitStyleEditor({ sync: true, close: true });
            });
        });
    }

    openEmotionModal(row, options = {}) {
        const input = row?.querySelector('[data-style-field="emo_vec"]');
        if (!input) return;
        const reopenStyleEditor = Boolean(options.reopenStyleEditor);
        const reopenParent = () => {
            if (reopenStyleEditor && row.isConnected) {
                setTimeout(() => this.openStyleEditorModal(row), 0);
            }
        };

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
            panel.querySelectorAll('.modal-close').forEach(button => {
                button.addEventListener('click', reopenParent);
            });
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
                this.syncEditorToJson(false, { silent: true });
                this.closeModal();
                reopenParent();
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
                                value="${escapeAttribute(presetFieldValue(preset, field))}"
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
                const originalStyle = this.editorProfile?.styles?.[id] || {};
                row.querySelectorAll('[data-style-field]').forEach(input => {
                    const field = input.dataset.styleField;
                    try {
                        if (input.type === 'checkbox') {
                            style[field] = input.checked;
                        } else if (input.type === 'number' || field === 'style_alpha' || field === 'emo_alpha') {
                            const val = input.value?.trim();
                            if (val === '' || val === undefined || val === null) {
                                // 空值：保持原始值
                                if (originalStyle[field] !== undefined) {
                                    style[field] = originalStyle[field];
                                }
                            } else {
                                const num = Number(val);
                                style[field] = Number.isFinite(num) ? num : (originalStyle[field] || 0);
                            }
                        } else if (field === 'refs') {
                            const refs = parseRefs(input.value, `styles.${id}.refs`);
                            style.refs = refs;
                            style.ref = refs[0] || '';
                        } else if (field === 'emo_vec') {
                            style[field] = parseEmoVec(input.value, `styles.${id}.emo_vec`);
                        } else {
                            style[field] = input.value;
                        }
                    } catch (err) {
                        if (!silent) this.addLog('error', `解析 ${id}.${field} 失败: ${formatError(err)}`);
                    }
                });
                profile.styles[id] = style;
            });
        } catch (error) {
            if (!silent) this.addLog('error', formatError(error));
            return null;
        }
        try {
            this.syncPresetFieldsIntoProfile(profile);
        } catch (error) {
            if (!silent) this.addLog('error', formatError(error));
            return null;
        }

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
                const field = PRESET_FIELDS.find(item => item.key === key);
                const raw = input.value.trim();
                const value = raw === '' ? field?.defaultValue : Number(raw);
                if (!Number.isFinite(value)) {
                    throw new Error(`${group.label}.${mode}.${key} 必须是数字`);
                }
                preset[key] = value;
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
            const editedProfileWasActive = this.profiles.some(item => item.file === this.editorFile && item.active);
            const result = await api.saveProfile(this.editorFile, profile);
            const savedFile = result?.file || this.editorFile;
            this.editorFile = savedFile;
            this.addLog('success', normalizeMessage(result?.message || result));
            if (applyAfterSave || editedProfileWasActive) {
                const applyMessage = await api.applyProfile(savedFile);
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
                    <p>只删除源配置文件，不会删除当前运行快照。</p>
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
        } else if (this.currentPage === 'monitor') {
            this.refreshGenerationRecords(this.generationRecordsPage);
        } else {
            this.refreshAll();
        }
    }

    renderLogSnapshot(snapshot) {
        this.replaceLogs([]);
        this.logSnapshotFiles = snapshot.files || [];

        const fileLabel = snapshot.activeFile || '无日志文件';
        this.addLog('info', `${snapshot.version} · ${fileLabel}`, null, { category: 'startup' });

        let snapshotFallbackTimestamp = null;
        if (snapshot.files?.length && snapshot.activeFile) {
            const activeInfo = snapshot.files.find(file => file.file === snapshot.activeFile);
            snapshotFallbackTimestamp = logTimeFromDate(activeInfo?.modified);
            const size = activeInfo ? ` (${formatBytes(activeInfo.bytes)})` : '';
            const modified = activeInfo?.modified ? ` · 修改 ${formatDateTime(activeInfo.modified)}` : '';
            this.addLog('info', `当前日志文件: ${snapshot.activeFile}${size}${modified}`, null, { category: 'startup' });
        }

        let lastSnapshotTimestamp = null;
        const rawLines = snapshot.lines || [];
        const usefulLines = rawLines.filter(line => !isNoisySnapshotLogLine(line));
        this.logSnapshotDropped = rawLines.length - usefulLines.length;
        usefulLines.forEach(line => {
            const parsed = parseLogSnapshotLine(line);
            if (parsed.timestamp) {
                lastSnapshotTimestamp = parsed.timestamp;
            }
            this.addLog(parsed.level, parsed.message, parsed.timestamp || lastSnapshotTimestamp || snapshotFallbackTimestamp || '日志');
        });
        this.renderLogSummary();
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

    addLog(level, message, timestampOverride = null, options = {}) {
        const normalizedLevel = ['info', 'success', 'warning', 'error'].includes(level) ? level : 'info';
        const timestamp = timestampOverride || new Date().toLocaleTimeString('zh-CN', { hour12: false });
        const text = String(message ?? '');
        this.logEntries.push({
            level: normalizedLevel,
            message: text,
            timestamp,
            category: options.category || logCategoryForLine(text, normalizedLevel)
        });
        if (this.logEntries.length > 1200) {
            this.logEntries.splice(0, this.logEntries.length - 1200);
        }
        this.renderLogEntries();
    }

    renderLogEntries() {
        const logOutput = document.getElementById('log-output');
        const levelFilter = document.getElementById('log-level-filter')?.value || 'all';
        const categoryFilter = document.getElementById('log-category-filter')?.value || 'useful';
        const query = (document.getElementById('log-search')?.value || '').trim();
        const visibleEntries = this.logEntries.filter(entry => this.logEntryMatches(entry, levelFilter, categoryFilter, query));

        logOutput.innerHTML = '';
        visibleEntries.forEach(entry => {
            const line = `[${entry.timestamp}] [${entry.level.toUpperCase()}] ${entry.message}`;
            const row = document.createElement('div');
            row.className = `log-entry log-${entry.level} log-kind-${entry.category || 'other'}`;
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
        this.renderLogSummary();
        logOutput.scrollTop = logOutput.scrollHeight;
    }

    renderLogSummary() {
        const container = document.getElementById('log-summary');
        if (!container) return;
        const counts = this.logEntries.reduce((acc, entry) => {
            const category = entry.category || 'other';
            acc[category] = (acc[category] || 0) + 1;
            if (entry.level === 'error') acc.errorLevel = (acc.errorLevel || 0) + 1;
            if (entry.level === 'warning') acc.warningLevel = (acc.warningLevel || 0) + 1;
            return acc;
        }, {});
        container.innerHTML = [
            ['启动', counts.startup || 0],
            ['错误', counts.error || counts.errorLevel || 0],
            ['警告', counts.warningLevel || 0],
            ['RTF', counts.rtf || 0],
            ['隐藏噪声', this.logSnapshotDropped || 0]
        ].map(([label, value]) => `
            <span class="log-summary-chip">
                <b>${escapeHtml(label)}</b>
                <strong>${escapeHtml(value)}</strong>
            </span>
        `).join('');
    }

    logEntryMatches(entry, levelFilter, categoryFilter, query) {
        const levelMatches = levelFilter === 'all'
            || (levelFilter === 'issues' && ['warning', 'error'].includes(entry.level))
            || entry.level === levelFilter;
        const category = entry.category || 'other';
        const categoryMatches = categoryFilter === 'all'
            || (categoryFilter === 'useful' && ((category !== 'other' && category !== 'advisory')
                || (['warning', 'error', 'success'].includes(entry.level) && category !== 'advisory')))
            || category === categoryFilter
            || (categoryFilter === 'error' && entry.level === 'error');
        const text = `[${entry.timestamp}] [${entry.level.toUpperCase()}] ${entry.message}`.toLowerCase();
        return levelMatches && categoryMatches && (!query || text.includes(query.toLowerCase()));
    }

    clearLogs() {
        this.logSnapshotDropped = 0;
        this.logSnapshotFiles = [];
        this.replaceLogs([]);
        this.addLog('info', '日志已清空', null, { category: 'startup' });
    }

    async loadVoices() {
        try {
            const voices = await api.getVoiceRefs();
            this.voices = voices;
            this.voiceGroups = this.extractVoiceGroups(voices);
            this.renderVoiceGroups();
            this.renderVoices();
        } catch (error) {
            this.addLog('error', `加载音色库失败: ${formatError(error)}`);
        }
    }

    extractVoiceGroups(voices) {
        const groups = new Set();
        voices.forEach(voice => {
            if (voice.subdir) groups.add(voice.subdir);
        });
        return ['全部', ...Array.from(groups).sort()];
    }

    renderVoiceGroups() {
        const container = document.getElementById('voice-groups');
        if (!container) return;
        const counts = this.voiceGroupCounts();
        container.innerHTML = this.voiceGroups.map(group => `
            <div class="group-item ${((!this.selectedGroup && group === '全部') || this.selectedGroup === group) ? 'active' : ''}" data-group="${escapeAttribute(group)}">
                <span>${escapeHtml(group)}</span>
                <b>${counts.get(group) || 0}</b>
            </div>
        `).join('');
        container.querySelectorAll('.group-item').forEach(item => {
            item.addEventListener('click', () => {
                this.selectedGroup = item.dataset.group === '全部' ? null : item.dataset.group;
                this.renderVoiceGroups();
                this.renderVoices();
            });
        });
    }

    voiceGroupCounts(items = this.voices) {
        const counts = new Map([['全部', items.length]]);
        items.forEach(voice => {
            const group = voice.subdir || '根目录';
            counts.set(group, (counts.get(group) || 0) + 1);
        });
        return counts;
    }

    renderVoices() {
        const container = document.getElementById('voices-grid');
        const search = document.getElementById('voice-search')?.value.toLowerCase() || '';
        const filtered = this.voices.filter(voice => {
            if (this.selectedGroup && voice.subdir !== this.selectedGroup) return false;
            const haystack = [voice.name, voice.subdir, voice.relativePath].join(' ').toLowerCase();
            if (search && !haystack.includes(search)) return false;
            return true;
        });

        document.getElementById('voice-count').textContent = `${filtered.length}/${this.voices.length} 个音色`;

        if (!filtered.length) {
            container.innerHTML = '<div class="empty-state">未找到音色</div>';
            return;
        }

        container.innerHTML = filtered.map(voice => `
            <div class="voice-item" data-voice="${escapeAttribute(voice.name)}">
                <div class="voice-main">
                    <div class="voice-name">${escapeHtml(stripAudioExt(voice.name.split('/').pop()))}</div>
                    <div class="voice-path">${escapeHtml(voice.relativePath || voice.name)}</div>
                </div>
                <div class="voice-meta">
                    <span>${escapeHtml(voice.subdir || '根目录')}</span>
                    <b>${escapeHtml(voiceFileExt(voice))}</b>
                </div>
                <div class="voice-actions">
                    <button class="btn-icon" data-action="play" title="试听">▶</button>
                    <button class="btn-icon" data-action="move" title="移动">→</button>
                    <button class="btn-icon" data-action="delete" title="删除">×</button>
                </div>
            </div>
        `).join('');

        container.querySelectorAll('.voice-item').forEach(card => {
            const voiceName = card.dataset.voice;
            card.querySelector('[data-action="play"]')?.addEventListener('click', (e) => {
                e.stopPropagation();
                this.playVoice(voiceName);
            });
            card.querySelector('[data-action="move"]')?.addEventListener('click', (e) => {
                e.stopPropagation();
                this.openMoveVoiceModal(voiceName);
            });
            card.querySelector('[data-action="delete"]')?.addEventListener('click', (e) => {
                e.stopPropagation();
                this.confirmDeleteVoice(voiceName);
            });
        });
    }

    async playVoice(name) {
        try {
            if (this.currentAudio && !this.currentAudio.paused && this.currentAudioName === name) {
                this.currentAudio.pause();
                this.currentAudio = null;
                this.currentAudioName = null;
                this.updatePlayButtons();
                return;
            }
            if (this.currentAudio) {
                this.currentAudio.pause();
                this.currentAudio = null;
                this.currentAudioName = null;
            }

            const dataUrl = await api.getVoiceRefAudio(name);
            const audio = new Audio(dataUrl);
            this.currentAudio = audio;
            this.currentAudioName = name;

            audio.addEventListener('ended', () => {
                this.currentAudio = null;
                this.currentAudioName = null;
                this.updatePlayButtons();
            });

            audio.addEventListener('error', () => {
                this.currentAudio = null;
                this.currentAudioName = null;
                this.updatePlayButtons();
            });

            await audio.play();
            this.updatePlayButtons(name);
        } catch (error) {
            this.currentAudio = null;
            this.currentAudioName = null;
            this.updatePlayButtons();
            this.addLog('error', `试听失败: ${formatError(error)}`);
        }
    }

    updatePlayButtons(playingName = null) {
        document.querySelectorAll('.voice-item [data-action="play"]').forEach(btn => {
            const card = btn.closest('.voice-item');
            const voiceName = card?.dataset.voice;
            if (voiceName === playingName && this.currentAudio && !this.currentAudio.paused) {
                btn.textContent = '⏸';
                btn.classList.add('playing');
            } else {
                btn.textContent = '▶';
                btn.classList.remove('playing');
            }
        });
    }

    openImportVoiceModal() {
        this.openModal(`
            <div class="modal-header">
                <h3>导入音色</h3>
                <button type="button" class="modal-close">×</button>
            </div>
            <div class="modal-body modal-form">
                <label class="field">
                    <span>音色名称</span>
                    <input id="import-voice-name" placeholder="例如：角色A">
                </label>
                <label class="field">
                    <span>分组（可选）</span>
                    <select id="import-voice-group">
                        <option value="">根目录</option>
                        ${this.voiceGroups.filter(g => g !== '全部').map(g => `
                            <option value="${escapeAttribute(g)}">${escapeHtml(g)}</option>
                        `).join('')}
                    </select>
                </label>
                <label class="field">
                    <span>音频文件</span>
                    <input type="file" id="import-voice-file" accept=".wav,.mp3,.flac,.ogg,.m4a">
                </label>
            </div>
            <div class="modal-actions">
                <button type="button" class="btn-secondary modal-close">取消</button>
                <button type="button" class="btn-secondary primary" id="btn-import-confirm">导入</button>
            </div>
        `, (panel) => {
            panel.querySelector('#btn-import-confirm')?.addEventListener('click', async () => {
                const name = panel.querySelector('#import-voice-name')?.value.trim();
                const group = panel.querySelector('#import-voice-group')?.value.trim();
                const file = panel.querySelector('#import-voice-file')?.files[0];

                if (!name || !file) {
                    this.addLog('error', '请填写音色名称并选择文件');
                    return;
                }

                const fullName = group ? `${group}/${name}` : name;
                const ext = '.' + file.name.split('.').pop();

                try {
                    const arrayBuffer = await file.arrayBuffer();
                    const data = Array.from(new Uint8Array(arrayBuffer));
                    await api.uploadVoice(fullName, data, ext);
                    this.addLog('success', `导入成功: ${fullName}`);
                    this.closeModal();
                    await this.loadVoices();
                } catch (error) {
                    this.addLog('error', `导入失败: ${formatError(error)}`);
                }
            });
        });
    }

    openMoveVoiceModal(name) {
        const currentGroup = name.includes('/') ? name.split('/')[0] : '';
        this.openModal(`
            <div class="modal-header">
                <h3>移动音色</h3>
                <button type="button" class="modal-close">×</button>
            </div>
            <div class="modal-body modal-form">
                <div class="field">
                    <span>当前: ${escapeHtml(name)}</span>
                </div>
                <label class="field">
                    <span>目标分组</span>
                    <select id="move-voice-group">
                        <option value="">根目录</option>
                        ${this.voiceGroups.filter(g => g !== '全部').map(g => `
                            <option value="${escapeAttribute(g)}" ${g === currentGroup ? 'selected' : ''}>${escapeHtml(g)}</option>
                        `).join('')}
                    </select>
                </label>
            </div>
            <div class="modal-actions">
                <button type="button" class="btn-secondary modal-close">取消</button>
                <button type="button" class="btn-secondary primary" id="btn-move-confirm">移动</button>
            </div>
        `, (panel) => {
            panel.querySelector('#btn-move-confirm')?.addEventListener('click', async () => {
                const newGroup = panel.querySelector('#move-voice-group')?.value || '';
                try {
                    await api.moveVoice(name, newGroup);
                    this.addLog('success', `移动成功`);
                    this.closeModal();
                    await this.loadVoices();
                } catch (error) {
                    this.addLog('error', `移动失败: ${formatError(error)}`);
                }
            });
        });
    }

    confirmDeleteVoice(name) {
        this.openModal(`
            <div class="modal-header">
                <h3>删除音色</h3>
                <button type="button" class="modal-close">×</button>
            </div>
            <div class="modal-body">
                <p>确定要删除音色吗？</p>
                <div class="delete-confirm-name">${escapeHtml(name)}</div>
            </div>
            <div class="modal-actions">
                <button type="button" class="btn-secondary modal-close">取消</button>
                <button type="button" class="btn-secondary danger" id="btn-delete-confirm">删除</button>
            </div>
        `, (panel) => {
            panel.querySelector('#btn-delete-confirm')?.addEventListener('click', async () => {
                try {
                    await api.deleteVoice(name);
                    this.addLog('success', `删除成功`);
                    this.closeModal();
                    await this.loadVoices();
                } catch (error) {
                    this.addLog('error', `删除失败: ${formatError(error)}`);
                }
            });
        });
    }

    openAddGroupModal() {
        this.openModal(`
            <div class="modal-header">
                <h3>新建分组</h3>
                <button type="button" class="modal-close">×</button>
            </div>
            <div class="modal-body modal-form">
                <label class="field">
                    <span>分组名称</span>
                    <input id="new-group-name" placeholder="例如：女声">
                </label>
            </div>
            <div class="modal-actions">
                <button type="button" class="btn-secondary modal-close">取消</button>
                <button type="button" class="btn-secondary primary" id="btn-group-confirm">创建</button>
            </div>
        `, (panel) => {
            panel.querySelector('#btn-group-confirm')?.addEventListener('click', () => {
                const name = panel.querySelector('#new-group-name')?.value.trim();
                if (!name) {
                    this.addLog('error', '请填写分组名称');
                    return;
                }
                if (!this.voiceGroups.includes(name)) {
                    this.voiceGroups.push(name);
                    this.voiceGroups.sort();
                }
                this.closeModal();
                this.renderVoiceGroups();
                this.addLog('info', `分组 ${name} 已添加（导入音色时使用）`);
            });
        });
    }

    openTestVoiceModal() {
        this.openModal(`
            <div class="modal-header">
                <h3>测试生成</h3>
                <button type="button" class="modal-close">×</button>
            </div>
            <div class="modal-body modal-form">
                <label class="field">
                    <span>音色</span>
                    <select id="test-voice">
                        <option value="">默认</option>
                        ${this.voices.map(v => `<option value="${escapeAttribute(v.name)}">${escapeHtml(v.name)}</option>`).join('')}
                    </select>
                </label>
                <label class="field">
                    <span>声腔</span>
                    <input id="test-style" value="neutral">
                </label>
                <label class="field full">
                    <span>测试文本</span>
                    <textarea id="test-text" rows="3">你好，这是一段测试语音。</textarea>
                </label>
                <div id="test-result"></div>
            </div>
            <div class="modal-actions">
                <button type="button" class="btn-secondary modal-close">关闭</button>
                <button type="button" class="btn-secondary primary" id="btn-test-generate">生成</button>
            </div>
        `, (panel) => {
            panel.querySelector('#btn-test-generate')?.addEventListener('click', async () => {
                const voice = panel.querySelector('#test-voice')?.value || '';
                const style = panel.querySelector('#test-style')?.value || 'neutral';
                const text = panel.querySelector('#test-text')?.value.trim();
                const result = panel.querySelector('#test-result');

                if (!text) {
                    this.addLog('error', '请输入测试文本');
                    return;
                }

                result.textContent = '生成中...';
                try {
                    const audioData = await api.testVoiceGeneration(voice, style, text, '');
                    result.innerHTML = `<audio controls src="${escapeAttribute(audioData)}" autoplay></audio>`;
                    this.addLog('success', '生成成功');
                } catch (error) {
                    result.textContent = '';
                    this.addLog('error', `生成失败: ${formatError(error)}`);
                }
            });
        });
    }

    async loadTestPage() {
        try {
            const voices = await api.getVoiceRefs();
            this.voices = voices;
            this.voiceGroups = this.extractVoiceGroups(voices);
            this.renderTestHistory();
        } catch (error) {
            this.addLog('error', `加载测试页面失败: ${formatError(error)}`);
        }
    }

    async generateTest() {
        const text = document.getElementById('test-text-input')?.value.trim() || '';
        const result = document.getElementById('test-current-result');

        if (!text) {
            this.addLog('error', '请输入测试文本');
            return;
        }

        if (!this.selectedTestVoice || !this.selectedTestStyle) {
            this.addLog('error', '请选择音色和声腔');
            return;
        }
        if (!isVoiceCavityRef(this.selectedTestStyle)) {
            this.addLog('error', '声腔必须选择 prompts/library/声腔 下的音频');
            return;
        }

        result.innerHTML = '<div class="test-loading">生成中...</div>';
        try {
            const audioData = await api.testVoiceGeneration(
                this.selectedTestVoice.name || '',
                this.selectedTestStyle.name || '',
                text,
                ''
            );
            const timestamp = new Date().toLocaleTimeString('zh-CN', { hour12: false });
            result.innerHTML = `
                <div class="test-result-card">
                    <div class="result-info">
                        <span>${timestamp}</span>
                        <span>音色: ${escapeHtml(this.selectedTestVoice.name)}</span>
                        <span>声腔: ${escapeHtml(this.selectedTestStyle.name)}</span>
                    </div>
                    <audio controls src="${escapeAttribute(audioData)}" autoplay></audio>
                </div>
            `;
            this.testHistory.unshift({
                voice: this.selectedTestVoice.name,
                style: this.selectedTestStyle.name,
                text,
                audioData,
                timestamp
            });
            if (this.testHistory.length > 20) this.testHistory = this.testHistory.slice(0, 20);
            this.renderTestHistory();
            this.addLog('success', '生成成功');
        } catch (error) {
            result.innerHTML = '<div class="test-error">生成失败</div>';
            this.addLog('error', `生成失败: ${formatError(error)}`);
        }
    }

    renderTestHistory() {
        const container = document.getElementById('test-history-list');
        const count = document.getElementById('history-count');
        if (!container || !count) return;

        count.textContent = `${this.testHistory.length} 条`;

        if (!this.testHistory.length) {
            container.innerHTML = '<div class="empty-state compact">暂无测试记录</div>';
            return;
        }

        container.innerHTML = this.testHistory.map((item, index) => `
            <div class="history-item">
                <div class="history-meta">
                    <span>${item.timestamp}</span>
                    <button class="btn-icon-small" data-action="replay" data-index="${index}" title="重新生成">↻</button>
                </div>
                <div class="history-params">
                    <div>音色: ${escapeHtml(item.voice || '默认')}</div>
                    <div>声腔: ${escapeHtml(item.style)}</div>
                </div>
                <div class="history-text">${escapeHtml(item.text.substring(0, 50))}${item.text.length > 50 ? '...' : ''}</div>
                <audio controls src="${escapeAttribute(item.audioData)}"></audio>
            </div>
        `).join('');

        container.querySelectorAll('[data-action="replay"]').forEach(btn => {
            btn.addEventListener('click', () => {
                const index = parseInt(btn.dataset.index);
                const item = this.testHistory[index];
                if (item) {
                    this.selectedTestVoice = this.voices.find(voice => voice.name === item.voice) || { name: item.voice };
                    this.selectedTestStyle = this.voices.find(voice => voice.name === item.style) || { name: item.style };
                    document.getElementById('selected-voice-name').textContent = item.voice;
                    document.getElementById('selected-style-name').textContent = item.style;
                    document.getElementById('test-text-input').value = item.text;
                }
            });
        });
    }

    startMonitor() {
        this.stopMonitor();
        this.refreshGenerationRecords(this.generationRecordsPage || 1);
    }

    stopMonitor() {
        if (this.monitorInterval) {
            clearInterval(this.monitorInterval);
            this.monitorInterval = null;
        }
    }

    async refreshMonitor() {
        return this.refreshGenerationRecords(this.generationRecordsPage || 1);
    }

    async refreshGenerationRecords(page = 1) {
        const targetPage = Math.max(1, Number(page) || 1);
        try {
            const result = await api.getRecentGenerations(this.selectedVersion, targetPage, this.generationRecordsPageSize);
            const pageData = normalizeGenerationPage(result, this.selectedVersion, targetPage, this.generationRecordsPageSize);
            if (!pageData.items.length && pageData.total > 0 && targetPage > 1) {
                return this.refreshGenerationRecords(targetPage - 1);
            }

            this.generationRecords = pageData.items;
            this.generationRecordsPage = pageData.page;
            this.generationRecordsPageSize = pageData.pageSize;
            this.generationRecordsTotal = pageData.total;

            const versionLabel = document.getElementById('generation-record-version');
            if (versionLabel) {
                versionLabel.textContent = `${pageData.version === 'fast6g' ? 'Fast6G' : 'vLLM'} · 手动刷新 · 第 ${pageData.page} 页`;
            }
            this.renderMonitorRecentGenerations(pageData.items, pageData);
        } catch (error) {
            this.addLog('error', `刷新生成记录失败: ${formatError(error)}`);
            const container = document.getElementById('monitor-recent-tasks');
            if (container) container.innerHTML = '<div class="empty-state compact">生成记录加载失败</div>';
            this.renderGenerationPager({ page: targetPage, pageSize: this.generationRecordsPageSize, total: 0, hasMore: false });
        }
    }

    extractPID(portInfo) {
        const match = String(portInfo || '').match(/PID:\s*(\d+)/);
        return match ? match[1] : null;
    }

    renderMonitorRecentGenerations(items, pageData = {}) {
        const container = document.getElementById('monitor-recent-tasks');
        const count = document.getElementById('monitor-generation-count');
        if (!container) return;
        const total = Number(pageData.total || items.length || 0);
        const start = total && items.length ? ((Number(pageData.page || 1) - 1) * Number(pageData.pageSize || items.length) + 1) : 0;
        const end = start ? start + items.length - 1 : 0;
        if (count) count.textContent = total ? `${start}-${end}/${total} 条` : '0 条';

        if (!items.length) {
            container.innerHTML = '<div class="empty-state compact">没有生成记录</div>';
            this.renderGenerationPager(pageData);
            return;
        }

        container.innerHTML = items.map((item, index) => `
                <div class="generation-row">
                    <div class="generation-main">
                        <div class="generation-title">
                            <b>${escapeHtml(generationRoleLabel(item))}</b>
                            <span>${escapeHtml(shortKey(item.key))}</span>
                        </div>
                        <p>${escapeHtml(truncateText(item.firstText || '-', 88))}</p>
                    </div>
                    <div class="generation-metrics">
                        <span class="generation-quality-metric">档位名称 <b>${escapeHtml(generationQualityLabel(item.performanceMode))}</b></span>
                        <span>RTF <b>${escapeHtml(formatRtf(item.rtf))}</b></span>
                        <span>音频 <b>${escapeHtml(formatSeconds(item.durationS))}</b></span>
                        <span>总耗时 <b>${escapeHtml(formatSeconds(item.wallS))}</b></span>
                        <span>${escapeHtml((item.audioFormat || '-').toUpperCase())} <b>${escapeHtml(formatBytes(item.audioBytes))}</b></span>
                    </div>
                    <div class="generation-actions">
                        <div class="generation-time">${escapeHtml(formatDateTime(item.createdAt || item.modified))}</div>
                        <button type="button" class="btn-secondary compact" data-generation-detail="${index}">查看</button>
                    </div>
                </div>
        `).join('');
        this.renderGenerationPager(pageData);
    }

    renderGenerationPager(pageData = {}) {
        const pager = document.getElementById('generation-record-pager');
        if (!pager) return;
        const page = Math.max(1, Number(pageData.page || 1));
        const pageSize = Math.max(1, Number(pageData.pageSize || this.generationRecordsPageSize || 10));
        const total = Math.max(0, Number(pageData.total || 0));
        const totalPages = Math.max(1, Math.ceil(total / pageSize));
        const hasMore = Boolean(pageData.hasMore);
        pager.innerHTML = `
            <button type="button" class="btn-secondary compact" data-generation-page="${page - 1}" ${page <= 1 ? 'disabled' : ''}>上一页</button>
            <span>${total ? `第 ${page}/${totalPages} 页` : '第 1/1 页'}</span>
            <button type="button" class="btn-secondary compact" data-generation-page="${page + 1}" ${!hasMore ? 'disabled' : ''}>下一页</button>
        `;
    }

    openGenerationRecordModal(index) {
        const item = this.generationRecords[index];
        if (!item) return;
        const segments = Array.isArray(item.segments) ? item.segments : [];
        this.openModal(`
            <div class="modal-header">
                <div>
                    <h3>生成详情</h3>
                    <p>${escapeHtml(item.key || '-')}</p>
                </div>
                <button type="button" class="modal-close">×</button>
            </div>
            <div class="modal-body generation-detail">
                    <div class="generation-detail-grid">
                    <div><span>角色</span>${rolePillHtml(generationRoleLabel(item))}</div>
                    <div><span>状态</span><b>${escapeHtml(item.status || '-')}</b></div>
                    <div><span>解析</span><b>${escapeHtml(item.parseMode || '-')}</b></div>
                    <div><span>档位名称</span><b>${escapeHtml(generationQualityLabel(item.performanceMode))}</b></div>
                    <div><span>RTF</span><b>${escapeHtml(formatRtf(item.rtf))}</b></div>
                    <div><span>Wall RTF</span><b>${escapeHtml(formatRtf(item.wallRtf))}</b></div>
                    <div><span>音频时长</span><b>${escapeHtml(formatSeconds(item.durationS))}</b></div>
                    <div><span>总耗时</span><b>${escapeHtml(formatSeconds(item.wallS))}</b></div>
                    <div><span>首段出声</span><b>${escapeHtml(formatSeconds(item.firstPcmS))}</b></div>
                    <div><span>排队等待</span><b>${escapeHtml(formatSeconds(item.queueWaitS))}</b></div>
                    <div><span>LLM解析</span><b>${escapeHtml(formatSeconds(item.llmParseS))}</b></div>
                    <div><span>GPT生成</span><b>${escapeHtml(formatSeconds(item.gptGenS))}</b></div>
                    <div><span>S2Mel</span><b>${escapeHtml(formatSeconds(item.s2melS))}</b></div>
                    <div><span>BigVGAN</span><b>${escapeHtml(formatSeconds(item.bigvganS))}</b></div>
                    <div><span>音频文件</span><b>${escapeHtml((item.audioFormat || '-').toUpperCase())} · ${escapeHtml(formatBytes(item.audioBytes))}</b></div>
                    <div><span>分段</span><b>${escapeHtml(formatGenerationSegmentCount(item))}</b></div>
                    <div><span>创建时间</span><b>${escapeHtml(formatDateTime(item.createdAt || item.modified))}</b></div>
                </div>
                <section class="generation-detail-section">
                    <h4>分段文本与耗时</h4>
                    <div class="generation-segment-list">
                        ${segments.length ? segments.map(segment => `
                            <div class="generation-segment-row ${segmentRoleClass(segment.role)}"${roleStyleAttribute(segment.role)}>
                                <span class="segment-index">${escapeHtml(`${Number(segment.index ?? 0) + 1}`)}</span>
                                ${rolePillHtml(segment.role || '-')}
                                <p>${escapeHtml(segment.text || '-')}</p>
                                <div class="segment-metrics">
                                    <em>RTF ${escapeHtml(formatRtf(segment.rtf ?? segment.inferRtf))}</em>
                                    <em>音频 ${escapeHtml(formatSeconds(segment.durationS))}</em>
                                    <em>耗时 ${escapeHtml(formatSeconds(segment.wallS))}</em>
                                    <em>GPT ${escapeHtml(formatSeconds(segment.gptGenS))}</em>
                                    <em>S2Mel ${escapeHtml(formatSeconds(segment.s2melS))}</em>
                                    <em>BigVGAN ${escapeHtml(formatSeconds(segment.bigvganS))}</em>
                                    <em>${escapeHtml(segment.style || '-')}</em>
                                    <em>${escapeHtml(segmentCacheLabel(segment))}</em>
                                </div>
                            </div>
                        `).join('') : '<div class="empty-state compact">没有分段详情</div>'}
                    </div>
                </section>
            </div>
            <div class="modal-actions">
                <button type="button" class="btn-secondary modal-close">关闭</button>
            </div>
        `);
    }

    openSelectVoiceModal() {
        this.openAudioRefSelectModal({
            title: '选择音色',
            searchPlaceholder: '搜索音色、分组或路径',
            current: this.selectedTestVoice,
            confirmId: 'btn-confirm-voice',
            onConfirm: (selected) => {
                this.selectedTestVoice = selected;
                document.getElementById('selected-voice-name').textContent = selected.name;
            }
        });
    }

    openSelectStyleModal() {
        const cavityItems = this.voiceCavityItems();
        const current = isVoiceCavityRef(this.selectedTestStyle) ? this.selectedTestStyle : null;
        this.openAudioRefSelectModal({
            title: '选择声腔',
            searchPlaceholder: '搜索 prompts/library/声腔 下的声腔',
            current,
            items: cavityItems,
            confirmId: 'btn-confirm-style',
            onConfirm: (selected) => {
                this.selectedTestStyle = selected;
                document.getElementById('selected-style-name').textContent = selected.name;
            }
        });
    }

    openAudioRefSelectModal({ title, searchPlaceholder, current, confirmId, onConfirm, items = null }) {
        const sourceItems = Array.isArray(items) ? items : this.voices;
        const sourceGroups = this.extractVoiceGroups(sourceItems);
        let selectedGroup = current?.subdir || null;
        let selected = current || null;
        let currentAudio = null;
        let currentAudioName = null;
        const counts = this.voiceGroupCounts(sourceItems);

        this.openModal(`
            <div class="modal-header">
                <h3>${escapeHtml(title)}</h3>
                <button type="button" class="modal-close">×</button>
            </div>
            <div class="modal-body modal-select refined-select">
                <aside class="select-sidebar">
                    <div id="select-audio-groups"></div>
                </aside>
                <section class="select-content">
                    <input type="search" id="select-audio-search" placeholder="${escapeAttribute(searchPlaceholder)}" spellcheck="false">
                    <div class="select-current" id="select-audio-current"></div>
                    <div class="select-list" id="select-audio-list"></div>
                </section>
            </div>
            <div class="modal-actions">
                <button type="button" class="btn-secondary modal-close">取消</button>
                <button type="button" class="btn-secondary primary" id="${escapeAttribute(confirmId)}">确定</button>
            </div>
        `, (panel) => {
            const confirmButton = panel.querySelector(`#${confirmId}`);

            const stopAudio = () => {
                if (currentAudio) currentAudio.pause();
                currentAudio = null;
                currentAudioName = null;
            };

            const renderGroups = () => {
                const container = panel.querySelector('#select-audio-groups');
                container.innerHTML = sourceGroups.map(group => `
                    <button type="button" class="select-group-item ${((!selectedGroup && group === '全部') || selectedGroup === group) ? 'active' : ''}" data-group="${escapeAttribute(group)}">
                        <span>${escapeHtml(group)}</span>
                        <b>${counts.get(group) || 0}</b>
                    </button>
                `).join('');
                container.querySelectorAll('.select-group-item').forEach(item => {
                    item.addEventListener('click', () => {
                        selectedGroup = item.dataset.group === '全部' ? null : item.dataset.group;
                        renderGroups();
                        renderList();
                    });
                });
            };

            const renderCurrent = () => {
                const currentBox = panel.querySelector('#select-audio-current');
                currentBox.innerHTML = selected
                    ? `<b>${escapeHtml(stripAudioExt(selected.name.split('/').pop()))}</b><span>${escapeHtml(selected.relativePath || selected.name)}</span>`
                    : '<b>未选择</b><span>-</span>';
                if (confirmButton) confirmButton.disabled = !selected;
            };

            const filteredItems = () => {
                const search = panel.querySelector('#select-audio-search')?.value.toLowerCase() || '';
                return sourceItems.filter(item => {
                    if (selectedGroup && item.subdir !== selectedGroup) return false;
                    const haystack = [item.name, item.subdir, item.relativePath].join(' ').toLowerCase();
                    return !search || haystack.includes(search);
                });
            };

            const renderList = () => {
                const container = panel.querySelector('#select-audio-list');
                const filtered = filteredItems();
                if (!filtered.length) {
                    container.innerHTML = '<div class="empty-state compact">未找到匹配项</div>';
                    renderCurrent();
                    return;
                }

                container.innerHTML = filtered.map(item => `
                    <div class="select-row ${selected?.name === item.name ? 'selected' : ''}" data-name="${escapeAttribute(item.name)}">
                        <div class="select-row-main">
                            <b>${escapeHtml(stripAudioExt(item.name.split('/').pop()))}</b>
                            <span>${escapeHtml(item.relativePath || item.name)}</span>
                        </div>
                        <div class="select-row-meta">
                            <span>${escapeHtml(item.subdir || '根目录')}</span>
                            <em>${escapeHtml(voiceFileExt(item))}</em>
                        </div>
                        <button type="button" class="btn-icon-small" data-action="preview" title="试听">${currentAudioName === item.name ? '⏸' : '▶'}</button>
                    </div>
                `).join('');

                container.querySelectorAll('.select-row').forEach(row => {
                    row.addEventListener('click', () => {
                        selected = sourceItems.find(item => item.name === row.dataset.name) || selected;
                        renderCurrent();
                        renderList();
                    });
                    row.querySelector('[data-action="preview"]')?.addEventListener('click', async (event) => {
                        event.stopPropagation();
                        const name = row.dataset.name;
                        if (currentAudio && currentAudioName === name && !currentAudio.paused) {
                            stopAudio();
                            renderList();
                            return;
                        }
                        stopAudio();
                        try {
                            const dataUrl = await api.getVoiceRefAudio(name);
                            currentAudio = new Audio(dataUrl);
                            currentAudioName = name;
                            currentAudio.addEventListener('ended', () => {
                                stopAudio();
                                renderList();
                            });
                            currentAudio.addEventListener('error', () => {
                                stopAudio();
                                renderList();
                            });
                            await currentAudio.play();
                            renderList();
                        } catch (error) {
                            stopAudio();
                            this.addLog('error', `试听失败: ${formatError(error)}`);
                            renderList();
                        }
                    });
                });
                renderCurrent();
            };

            panel.querySelector('#select-audio-search')?.addEventListener('input', renderList);
            confirmButton?.addEventListener('click', () => {
                if (!selected) return;
                onConfirm(selected);
                this.closeModal();
            });

            renderGroups();
            renderList();
            return stopAudio;
        });
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

function isVoiceCavityRef(item) {
    const subdir = String(item?.subdir || '').trim().replaceAll('\\', '/');
    const name = String(item?.name || '').trim().replaceAll('\\', '/');
    const relativePath = String(item?.relativePath || '').trim().replaceAll('\\', '/');
    return subdir === '声腔'
        || name.startsWith('声腔/')
        || relativePath.includes('/prompts/library/声腔/')
        || relativePath.startsWith('prompts/library/声腔/');
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

function presetFieldValue(preset, field) {
    const value = preset?.[field.key];
    return value === undefined || value === null || value === '' ? field.defaultValue : value;
}

function parseEmoVec(value, fieldName) {
    const text = String(value ?? '').trim();
    if (!text) {
        return EMO_VEC_DEFAULT;
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

function voiceFileExt(item) {
    const source = String(item?.relativePath || item?.name || '');
    const match = source.match(/\.([a-z0-9]+)$/i);
    return match ? match[1].toUpperCase() : '-';
}

function truncateText(value, maxLength) {
    const text = String(value ?? '');
    if (text.length <= maxLength) return text;
    return `${text.slice(0, Math.max(0, maxLength - 1))}…`;
}

function shortKey(value) {
    const text = String(value ?? '');
    if (text.length <= 12) return text || '-';
    return `${text.slice(0, 8)}…${text.slice(-4)}`;
}

function normalizeGenerationPage(result, version, page, pageSize) {
    if (Array.isArray(result)) {
        return {
            version,
            page,
            pageSize,
            total: result.length,
            hasMore: false,
            items: result
        };
    }
    const items = Array.isArray(result?.items) ? result.items : [];
    return {
        version: result?.version || version,
        page: Number(result?.page || page || 1),
        pageSize: Number(result?.pageSize || pageSize || items.length || 10),
        total: Number(result?.total ?? items.length),
        hasMore: Boolean(result?.hasMore),
        items
    };
}

function generationRoleLabel(item) {
    const direct = String(item?.role || '').trim();
    if (direct) return direct;
    return roleSummaryFromSegments(item?.segments) || item?.parseMode || '生成';
}

function roleSummaryFromSegments(segments) {
    if (!Array.isArray(segments)) return '';
    const roles = [];
    segments.forEach(segment => {
        const role = String(segment?.role || '').trim();
        if (!role || role === '旁白' || roles.includes(role)) return;
        roles.push(role);
    });
    if (roles.length) {
        const head = roles.slice(0, 3).join(' / ');
        return roles.length > 3 ? `${head} 等 ${roles.length} 个角色` : head;
    }
    return segments.some(segment => String(segment?.role || '').trim() === '旁白') ? '旁白' : '';
}

function generationQualityLabel(mode) {
    const text = String(mode || '').trim();
    const labels = {
        fast: '极速',
        balanced: '平衡',
        expressive: '质量优先',
        ultra: '落盘高质量',
        custom: '自定义'
    };
    return labels[text] || text || '-';
}

function formatGenerationSegmentCount(item) {
    const done = Number(item?.segmentsDone);
    const total = Number(item?.segmentsTotal);
    if (Number.isFinite(done) && Number.isFinite(total) && total > 0) {
        return `完成 ${done} / 计划 ${total}`;
    }
    if (Number.isFinite(done) && done > 0) return `完成 ${done}`;
    const segments = Array.isArray(item?.segments) ? item.segments.length : 0;
    return segments ? `${segments} 段` : '-';
}

function segmentRoleClass(role) {
    return String(role || '').trim() === '旁白' ? 'is-narrator' : 'is-character';
}

function rolePillHtml(role) {
    const text = String(role || '-').trim() || '-';
    const narrator = text === '旁白';
    const style = narrator ? '' : ` style="--role-color:${roleColor(text)}"`;
    return `<b class="role-pill ${narrator ? 'narrator' : 'character'}"${style}>${escapeHtml(text)}</b>`;
}

function roleStyleAttribute(role) {
    const text = String(role || '').trim();
    if (!text || text === '旁白') return '';
    return ` style="--role-color:${roleColor(text)}"`;
}

function roleColor(role) {
    let hash = 0;
    const text = String(role || '');
    for (let index = 0; index < text.length; index++) {
        hash = (hash * 31 + text.charCodeAt(index)) >>> 0;
    }
    const hue = 185 + (hash % 125);
    return `hsl(${hue} 78% 66%)`;
}

function segmentCacheLabel(segment) {
    const parts = [];
    if (segment?.spkCacheHit === true) parts.push('音色缓存');
    if (segment?.emoCacheHit === true) parts.push('情绪缓存');
    if (segment?.usesStyleAudio === true) parts.push('声腔');
    return parts.length ? parts.join(' / ') : '无缓存';
}

function logTimeFromDate(value) {
    if (!value) return null;
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return null;
    return date.toLocaleTimeString('zh-CN', { hour12: false });
}

function formatUptime(seconds) {
    const total = Math.max(0, Math.floor(Number(seconds) || 0));
    const hours = Math.floor(total / 3600);
    const minutes = Math.floor((total % 3600) / 60);
    const rest = total % 60;
    return hours > 0
        ? `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${rest.toString().padStart(2, '0')}`
        : `${minutes.toString().padStart(2, '0')}:${rest.toString().padStart(2, '0')}`;
}

function isSelfPollLogLine(line) {
    const text = String(line ?? '').toLowerCase();
    return text.includes('get /health ')
        || text.includes('get /health?')
        || text.includes('/server_log/tail')
        || text.includes('/tts_dialogue_job_status/')
        || text.includes('get /favicon.ico')
        || text.includes('error sending request for url') && text.includes('/health');
}

function isProgressBarLogLine(line) {
    const text = stripAnsi(String(line ?? '')).replace(/\r/g, '\n');
    return text
        .split('\n')
        .map(part => part.trim())
        .filter(Boolean)
        .every(isProgressBarLogPart);
}

function isProgressBarLogPart(part) {
    if (/^\(?EngineCore_[^)]+\)?$/i.test(part)) return true;
    if (/loading .*checkpoint shards:/i.test(part)) return true;
    return /^\d{1,3}%\|.+\|\s+\d+\/\d+\s+\[.*(?:\?|[\d.]+)it\/s\]/i.test(part);
}

function isNoisySnapshotLogLine(line) {
    const text = stripAnsi(String(line ?? '')).trim();
    if (!text) return true;
    return isSelfPollLogLine(text) || isProgressBarLogLine(text);
}

function stripAnsi(value) {
    return String(value ?? '').replace(/\x1b\[[0-9;?]*[ -/]*[@-~]/g, '');
}

function parseLogSnapshotLine(line) {
    const text = String(line ?? '').trimEnd();
    const launcherMatch = text.match(/^\[(\d{2}:\d{2}:\d{2})\]\s+\[(INFO|SUCCESS|WARNING|ERROR)\]\s*(.*)$/i);
    if (launcherMatch) {
        const message = launcherMatch[3];
        return {
            timestamp: launcherMatch[1],
            level: isBigVganCudaAdvisory(message) ? 'info' : launcherMatch[2].toLowerCase(),
            message
        };
    }
    const bracketDateMatch = text.match(/^\[(\d{2}-\d{2}\s+\d{2}:\d{2}:\d{2})\]\s+\[(INFO|SUCCESS|WARNING|ERROR)\]\s*(.*)$/i);
    if (bracketDateMatch) {
        const message = bracketDateMatch[3];
        return {
            timestamp: bracketDateMatch[1],
            level: isBigVganCudaAdvisory(message) ? 'info' : bracketDateMatch[2].toLowerCase(),
            message
        };
    }
    const backendMatch = text.match(/^(INFO|WARNING|ERROR)\s+(\d{2}-\d{2}\s+\d{2}:\d{2}:\d{2})\s+(.*)$/i);
    if (backendMatch) {
        const message = backendMatch[3];
        return {
            timestamp: backendMatch[2],
            level: isBigVganCudaAdvisory(message) ? 'info' : backendMatch[1].toLowerCase(),
            message
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
    if (isBigVganCudaAdvisory(text)) return 'info';
    if (text.includes('error') || text.includes('traceback') || text.includes('failed') || text.includes('fatal') || text.includes('panic') || text.includes('exception')) return 'error';
    if (text.includes('warn') || text.includes('timeout') || text.includes('retry')) return 'warning';
    if (text.includes('ready') || text.includes('success') || text.includes('ok')) return 'success';
    return 'info';
}

function logCategoryForLine(line, level = 'info') {
    const text = stripAnsi(String(line ?? '')).toLowerCase();
    if (isBigVganCudaAdvisory(text)) return 'advisory';
    if (level === 'error'
        || /\b(error|traceback|exception|failed|fatal|panic)\b/i.test(text)
        || text.includes('配置错误')
        || text.includes('启动失败')) {
        return 'error';
    }
    if (isRtfLogLine(text)) return 'rtf';
    if (isStartupLogLine(text)) return 'startup';
    return 'other';
}

function isRtfLogLine(line) {
    const text = String(line ?? '').toLowerCase();
    return /\brtf\b/.test(text)
        || text.includes('real-time factor')
        || text.includes('audio_duration')
        || text.includes('total_wall')
        || text.includes('first_pcm')
        || text.includes('first audio')
        || text.includes('infer_total')
        || text.includes('infer_rtf')
        || text.includes('s2mel')
        || text.includes('bigvgan')
        || text.includes('gpt_gen')
        || text.includes('mp3_bytes')
        || text.includes('音频已保存')
        || text.includes('耗时');
}

function isBigVganCudaAdvisory(line) {
    const text = stripAnsi(String(line ?? '')).toLowerCase();
    return text.includes('use_cuda_kernel=true during bigvgan.from_pretrained')
        || text.includes('only inference is supported')
        || (text.includes('nvcc') && text.includes('ninja') && text.includes('build the kernel'))
        || (text.includes('github.com/nvidia/bigvgan') && text.includes('custom-cuda-kernel'));
}

function isStartupLogLine(line) {
    const text = String(line ?? '').toLowerCase();
    return text.includes('launcher')
        || text.includes('启动')
        || text.includes('wrapper pid')
        || text.includes('restart-leon-api')
        || text.includes('leon root')
        || text.includes('active profile')
        || text.includes('启动配置')
        || text.includes('gpu')
        || text.includes('cuda')
        || text.includes('port')
        || text.includes('9880')
        || text.includes('uvicorn')
        || text.includes('application startup')
        || text.includes('模型')
        || text.includes('加载')
        || text.includes('warmup')
        || text.includes('预热');
}

function formatBytes(bytes) {
    const value = Number(bytes);
    if (!Number.isFinite(value) || value < 0) return '-';
    if (value < 1024) return `${value} B`;
    if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
    return `${(value / 1024 / 1024).toFixed(1)} MB`;
}

function formatSeconds(value) {
    const number = Number(value);
    if (!Number.isFinite(number)) return '-';
    if (number < 10) return `${number.toFixed(2)}s`;
    return `${number.toFixed(1)}s`;
}

function formatRtf(value) {
    const number = Number(value);
    if (!Number.isFinite(number)) return '-';
    return number.toFixed(3).replace(/0+$/, '').replace(/\.$/, '');
}

function formatDateTime(value) {
    if (!value) return '-';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return String(value);
    return date.toLocaleString('zh-CN', { hour12: false });
}

function isTextEditingTarget(target) {
    const tagName = target?.tagName?.toLowerCase();
    return tagName === 'input' || tagName === 'textarea' || tagName === 'select' || Boolean(target?.isContentEditable);
}

function bootLeonLauncher() {
    if (window.leonLauncher) return;
    window.leonLauncher = new LeonLauncher();
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', bootLeonLauncher);
} else {
    bootLeonLauncher();
}
