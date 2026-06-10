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
                    fast: { diffusion_steps: 8, prompt_audio_seconds: 6, segment_tokens: 40, first_tokens: 10, s2mel_cfg_rate: 0.7 },
                    balanced: { diffusion_steps: 14, prompt_audio_seconds: 10, segment_tokens: 60, first_tokens: 18, s2mel_cfg_rate: 0.7 },
                    expressive: { diffusion_steps: 16, prompt_audio_seconds: 12, segment_tokens: 72, first_tokens: 24, s2mel_cfg_rate: 0.7 }
                },
                generate: {
                    fast: { diffusion_steps: 8, prompt_audio_seconds: 6, segment_tokens: 40, first_tokens: 10, s2mel_cfg_rate: 0.7 },
                    balanced: { diffusion_steps: 14, prompt_audio_seconds: 10, segment_tokens: 60, first_tokens: 18, s2mel_cfg_rate: 0.7 },
                    expressive: { diffusion_steps: 16, prompt_audio_seconds: 12, segment_tokens: 72, first_tokens: 24, s2mel_cfg_rate: 0.7 }
                }
            }
        },
        styles: {
            neutral: {
                label: "普通/平静",
                ref: "",
                style_alpha: 0.15,
                emo_alpha: 0.18,
                emo_vec: [0, 0, 0, 0, 0, 0, 0, 0.85],
                description: "稳定自然。"
            },
            whisper_soft: {
                label: "耳语",
                ref: "声腔/耳语-AD学姐",
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
                    fast: { diffusion_steps: 8, prompt_audio_seconds: 6, segment_tokens: 40, first_tokens: 10, s2mel_cfg_rate: 0.7 }
                },
                generate: {
                    fast: { diffusion_steps: 8, prompt_audio_seconds: 6, segment_tokens: 40, first_tokens: 10, s2mel_cfg_rate: 0.7 }
                }
            }
        },
        styles: {
            whisper_soft: {
                label: "耳语",
                ref: "声腔/耳语-AD学姐",
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
                'Mock 日志预览模式',
                `${version} 服务日志会在 Tauri 环境中读取 logs/${version}/ 最新文件`
            ]
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
