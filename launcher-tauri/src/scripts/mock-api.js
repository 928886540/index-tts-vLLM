const mockProfiles = [
    {
        version: 3,
        name: "LEON default",
        file: "leon-default.json",
        active: true,
        description: "默认配置，适合日常对话",
        updatedAt: "2026-06-09",
        llmPrompt: "你是中文小说到 TTS 片段拆分器。只返回严格 JSON。",
        quality: {
            defaultMode: "balanced",
            customLabel: "自定义",
            modes: [
                { id: "fast", label: "极速模式" },
                { id: "balanced", label: "平衡模式" },
                { id: "expressive", label: "质量优先" }
            ],
            presets: {
                live: {
                    fast: { diffusion_steps: 8, prompt_audio_seconds: 6, segment_tokens: 40, first_tokens: 10, s2mel_cfg_rate: 0.7, interval_ms: 50, top_p: 0.8, top_k: 30, temperature: 0.7, repetition_penalty: 1.2 },
                    balanced: { diffusion_steps: 14, prompt_audio_seconds: 10, segment_tokens: 60, first_tokens: 18, s2mel_cfg_rate: 0.7, interval_ms: 50, top_p: 0.8, top_k: 30, temperature: 0.7, repetition_penalty: 1.2 },
                    expressive: { diffusion_steps: 16, prompt_audio_seconds: 12, segment_tokens: 72, first_tokens: 24, s2mel_cfg_rate: 0.7, interval_ms: 50, top_p: 0.8, top_k: 30, temperature: 0.7, repetition_penalty: 1.2 }
                },
                generate: {
                    fast: { diffusion_steps: 8, prompt_audio_seconds: 6, segment_tokens: 40, first_tokens: 10, s2mel_cfg_rate: 0.7, interval_ms: 50, top_p: 0.8, top_k: 30, temperature: 0.7, repetition_penalty: 1.2 },
                    balanced: { diffusion_steps: 14, prompt_audio_seconds: 10, segment_tokens: 60, first_tokens: 18, s2mel_cfg_rate: 0.7, interval_ms: 50, top_p: 0.8, top_k: 30, temperature: 0.7, repetition_penalty: 1.2 },
                    expressive: { diffusion_steps: 16, prompt_audio_seconds: 12, segment_tokens: 72, first_tokens: 24, s2mel_cfg_rate: 0.7, interval_ms: 50, top_p: 0.8, top_k: 30, temperature: 0.7, repetition_penalty: 1.2 }
                }
            }
        },
        styles: {
            neutral: {
                label: "普通/平静",
                ref: "",
                refs: [],
                style_alpha: 0.15,
                emo_alpha: 0.18,
                emo_vec: [0, 0, 0, 0, 0, 0, 0, 0.85],
                description: "稳定自然。"
            },
            whisper_soft: {
                label: "耳语",
                ref: "声腔/耳语-AD学姐",
                refs: ["声腔/耳语-AD学姐", "声腔/低语-AD学姐"],
                style_alpha: 0.44,
                emo_alpha: 0.36,
                emo_vec: [0.08, 0, 0.08, 0.03, 0, 0.24, 0, 0.62],
                description: "轻声耳语。"
            }
        }
    },
    {
        version: 3,
        name: "耳语恋爱",
        file: "whisper-love.json",
        active: false,
        description: "温柔亲密的恋爱模式",
        updatedAt: "2026-06-09",
        llmPrompt: "按温柔耳语风格拆分台词。",
        quality: {
            defaultMode: "fast",
            customLabel: "自定义",
            modes: [{ id: "fast", label: "极速模式" }],
            presets: {
                live: {
                    fast: { diffusion_steps: 8, prompt_audio_seconds: 6, segment_tokens: 40, first_tokens: 10, s2mel_cfg_rate: 0.7, interval_ms: 50, top_p: 0.8, top_k: 30, temperature: 0.7, repetition_penalty: 1.2 }
                },
                generate: {
                    fast: { diffusion_steps: 8, prompt_audio_seconds: 6, segment_tokens: 40, first_tokens: 10, s2mel_cfg_rate: 0.7, interval_ms: 50, top_p: 0.8, top_k: 30, temperature: 0.7, repetition_penalty: 1.2 }
                }
            }
        },
        styles: {
            whisper_soft: {
                label: "耳语",
                ref: "声腔/耳语-AD学姐",
                refs: ["声腔/耳语-AD学姐"],
                style_alpha: 0.44,
                emo_alpha: 0.36,
                emo_vec: [0.08, 0, 0.08, 0.03, 0, 0.24, 0, 0.62],
                description: "轻声耳语。"
            }
        }
    }
];

// Mock API - 模拟后端数据和接口
window.tauri_mock = {
    // 获取 Profile 列表
    getProfiles: () => {
        return new Promise((resolve) => {
            setTimeout(() => {
                resolve(mockProfiles.map(profile => ({
                    name: profile.name,
                    file: profile.file,
                    active: profile.active,
                    description: profile.description,
                    updatedAt: profile.updatedAt
                })));
            }, 300);
        });
    },

    getProfile: (filename) => {
        const profile = mockProfiles.find(item => item.file === filename) || mockProfiles[0];
        return Promise.resolve(structuredClone(profile));
    },

    getVoiceRefs: () => Promise.resolve([
        {
            name: "声腔/耳语-AD学姐",
            relativePath: "prompts/library/声腔/耳语-AD学姐.MP3",
            subdir: "声腔"
        },
        {
            name: "声腔/轻喘-AD学姐",
            relativePath: "prompts/library/声腔/轻喘-AD学姐.MP3",
            subdir: "声腔"
        },
        {
            name: "声腔/低语-AD学姐",
            relativePath: "prompts/library/声腔/低语-AD学姐.MP3",
            subdir: "声腔"
        },
        {
            name: "声腔/哭腔-AD学姐",
            relativePath: "prompts/library/声腔/哭腔-AD学姐.MP3",
            subdir: "声腔"
        },
        {
            name: "声腔/耳语-步非烟",
            relativePath: "prompts/library/声腔/耳语-步非烟.wav",
            subdir: "声腔"
        },
        {
            name: "声腔/惊喘-步非烟",
            relativePath: "prompts/library/声腔/惊喘-步非烟.wav",
            subdir: "声腔"
        },
        {
            name: "声腔/轻笑-JOK",
            relativePath: "prompts/library/声腔/轻笑-JOK.flac",
            subdir: "声腔"
        }
    ]),

    getVoiceRefAudio: () => Promise.resolve(
        "data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAQB8AAIA+AAACABAAZGF0YQAAAAA="
    ),

    createProfile: () => {
        const template = structuredClone(mockProfiles[0]);
        const index = mockProfiles.length + 1;
        const filename = `leon-new-profile-${index}.json`;
        template.file = filename;
        template.active = false;
        template.name = "New LEON Profile";
        template.description = "New profile created by the Tauri launcher.";
        template.displayOrder = 9999;
        template.updatedAt = new Date().toISOString();
        delete template.appliedAt;
        delete template.appliedFrom;
        mockProfiles.push(template);
        return Promise.resolve(filename);
    },

    saveProfile: (filename, profile) => {
        const index = mockProfiles.findIndex(item => item.file === filename);
        const nextProfile = {
            ...structuredClone(profile),
            file: filename,
            active: index >= 0 ? mockProfiles[index].active : false,
            updatedAt: new Date().toISOString()
        };
        if (index >= 0) {
            mockProfiles[index] = nextProfile;
        } else {
            mockProfiles.push(nextProfile);
        }
        return Promise.resolve({
            file: filename,
            success: true,
            message: `已保存配置: ${filename}`
        });
    },

    // 启动服务
    startService: (version, gpuRatio, enableMsvc) => {
        return new Promise((resolve) => {
            setTimeout(() => {
                const detail = version === 'vllm'
                    ? `gpu_memory_utilization=${gpuRatio}, MSVC=${enableMsvc ? 'on' : 'off'}`
                    : 'Fast6G';
                resolve({
                    success: true,
                    message: `${version} 服务启动成功 (${detail})`,
                    version: version,
                    port: 9880
                });
            }, 1500);
        });
    },

    // 停止服务
    stopService: () => {
        return new Promise((resolve) => {
            setTimeout(() => {
                resolve({
                    success: true,
                    message: "服务已停止"
                });
            }, 800);
        });
    },

    // 激活 Profile
    activateProfile: (filename) => {
        return new Promise((resolve) => {
            setTimeout(() => {
                mockProfiles.forEach(profile => {
                    profile.active = profile.file === filename;
                });
                resolve({
                    success: true,
                    message: `已激活配置: ${filename}`
                });
            }, 500);
        });
    },

    copyProfile: (filename) => {
        const source = mockProfiles.find(item => item.file === filename) || mockProfiles[0];
        const copy = structuredClone(source);
        const copyName = nextMockCopyFileName(filename);
        copy.file = copyName;
        copy.active = false;
        copy.name = `${source.name} copy`;
        copy.updatedAt = new Date().toISOString();
        delete copy.appliedAt;
        delete copy.appliedFrom;
        mockProfiles.push(copy);
        return Promise.resolve({
            success: true,
            message: `已复制为: ${copyName}`
        });
    },

    deleteProfile: (filename) => {
        const index = mockProfiles.findIndex(item => item.file === filename);
        if (index >= 0 && !mockProfiles[index].active) {
            mockProfiles.splice(index, 1);
        }
        return Promise.resolve({
            success: true,
            message: `已删除配置: ${filename}`
        });
    },

    validateProfile: (filename) => {
        return Promise.resolve({
            success: true,
            message: `Profile 测试通过: ${filename}`
        });
    },

    warmupService: () => {
        return Promise.resolve({
            success: true,
            message: "Mock 模型预热完成"
        });
    },

    // 获取环境信息
    getEnvironment: () => {
        return new Promise((resolve) => {
            setTimeout(() => {
                resolve({
                    os: "Windows 11 Pro 10.0.22000",
                    python: "Python 3.11.5",
                    network: "已连接",
                    cuda: "CUDA 12.1 (RTX 4090)"
                });
            }, 800);
        });
    },

    getEnvironmentReport: () => {
        return Promise.resolve({
            status: "warn",
            summary: "6G 具备启动条件；vLLM 显存不足",
            root: "D:\\apiWorkSpace\\leon_api",
            canStartVllm: false,
            canStartFast6g: true,
            fixableCount: 1,
            checks: [
                {
                    id: "common",
                    title: "Common 包",
                    status: "ok",
                    summary: "公共文件完整",
                    detail: "static/tavo.js=ok · scripts/restart-leon-api.ps1=ok · config/profiles=ok · prompts/library=ok",
                    fixable: false
                },
                {
                    id: "active_profile",
                    title: "Active Profile",
                    status: "ok",
                    summary: "active.json 可用",
                    detail: "config/profiles/active.json",
                    fixable: false
                },
                {
                    id: "gpu",
                    title: "NVIDIA GPU",
                    status: "warn",
                    summary: "GPU 空闲显存偏低",
                    detail: "RTX 3060 · total=12288 MiB · free=6200 MiB",
                    fixable: false
                },
                {
                    id: "port",
                    title: "API 端口 9880",
                    status: "warn",
                    summary: "发现 LEON 端口残留",
                    detail: "可清理 PID: [12345]",
                    fixable: true
                },
                {
                    id: "engine_vllm",
                    title: "vllm engine",
                    status: "warn",
                    summary: "文件完整但显存不足",
                    detail: "runtime=ok · api=ok · missing_checkpoints=none · required_free=9000 MiB · current_free=6200 MiB",
                    fixable: false
                },
                {
                    id: "engine_fast6g",
                    title: "fast6g engine",
                    status: "ok",
                    summary: "具备启动条件",
                    detail: "runtime=ok · api=ok · missing_checkpoints=none · required_free=5500 MiB · current_free=6200 MiB",
                    fixable: false
                }
            ]
        });
    },

    repairEnvironment: () => {
        return Promise.resolve({
            fixed: ["清理 LEON API 端口残留进程: 1"],
            skipped: [],
            report: {
                status: "warn",
                summary: "6G 具备启动条件；vLLM 显存不足",
                root: "D:\\apiWorkSpace\\leon_api",
                canStartVllm: false,
                canStartFast6g: true,
                fixableCount: 0,
                checks: [
                    {
                        id: "common",
                        title: "Common 包",
                        status: "ok",
                        summary: "公共文件完整",
                        detail: "static/tavo.js=ok · scripts/restart-leon-api.ps1=ok · config/profiles=ok · prompts/library=ok",
                        fixable: false
                    },
                    {
                        id: "port",
                        title: "API 端口 9880",
                        status: "ok",
                        summary: "端口可用",
                        detail: "127.0.0.1:9880 未被监听。",
                        fixable: false
                    },
                    {
                        id: "engine_fast6g",
                        title: "fast6g engine",
                        status: "ok",
                        summary: "具备启动条件",
                        detail: "runtime=ok · api=ok · missing_checkpoints=none · required_free=5500 MiB · current_free=6200 MiB",
                        fixable: false
                    },
                    {
                        id: "engine_vllm",
                        title: "vllm engine",
                        status: "warn",
                        summary: "文件完整但显存不足",
                        detail: "runtime=ok · api=ok · missing_checkpoints=none · required_free=9000 MiB · current_free=6200 MiB",
                        fixable: false
                    }
                ]
            }
        });
    },

    // 获取系统状态
    getSystemStatus: () => {
        return new Promise((resolve) => {
            setTimeout(() => {
                resolve({
                    running: false,
                    uptime: 0,
                    activeProfiles: 1,
                    totalProfiles: 4
                });
            }, 200);
        });
    },

    getLogSnapshot: (version) => {
        return Promise.resolve({
            version,
            files: [
                { file: `launcher-preview-${version}.log`, bytes: 128, modified: new Date().toISOString() }
            ],
            activeFile: `launcher-preview-${version}.log`,
            lines: [
                '[12:00:01] [INFO] 启动配置: Fast6G',
                '[12:00:04] [SUCCESS] API ready on port 9880',
                'metrics: audio_duration_s=4.817 total_wall_s=13.564 rtf=2.816 s2mel_s=1.928 bigvgan_s=0.577',
                'WARNING 06-12 12:00:07 prompt audio was clipped'
            ]
        });
    },

    getRecentGenerations: (version, page = 1, pageSize = 10) => {
        const items = [
            {
                version,
                key: 'bc3845c69e36ddedd6a4c828c677c463204357be',
                createdAt: new Date().toISOString(),
                modified: new Date().toISOString(),
                audioFormat: 'mp3',
                audioBytes: 78158,
                durationS: 4.817,
                wallS: 13.564,
                rtf: 2.816,
                segmentsDone: 4,
                segmentsTotal: 4,
                parseMode: 'ai',
                performanceMode: 'fast',
                role: '用户',
                firstText: '白夜雨停在门口，轻声说：',
                segments: [
                    { index: 0, role: '旁白', text: '白夜雨停在门口，轻声说：', style: 'neutral', durationS: 2.03 },
                    { index: 1, role: '用户', text: '我到了。', style: 'whisper_soft', durationS: 0.56 }
                ],
                status: 'done'
            }
        ];
        return Promise.resolve({
            version,
            page,
            pageSize,
            total: items.length,
            hasMore: page * pageSize < items.length,
            items: items.slice((page - 1) * pageSize, page * pageSize)
        });
    }
};

function nextMockCopyFileName(filename) {
    const stem = filename.replace(/\.json$/i, '');
    for (let index = 1; index < 1000; index++) {
        const suffix = index === 1 ? '-copy' : `-copy-${index}`;
        const candidate = `${stem}${suffix}.json`;
        if (!mockProfiles.some(profile => profile.file === candidate)) {
            return candidate;
        }
    }
    return `${stem}-copy-${Date.now()}.json`;
}

// 模拟日志流
window.tauri_mock.logStream = {
    listeners: [],

    addListener: (callback) => {
        window.tauri_mock.logStream.listeners.push(callback);
    },

    emit: (level, message) => {
        const entry = {
            level: level,
            message: message,
            timestamp: new Date().toLocaleTimeString('zh-CN', { hour12: false })
        };
        window.tauri_mock.logStream.listeners.forEach(cb => cb(entry));
    }
};
