#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use base64::{engine::general_purpose, Engine as _};
use chrono::{Local, Utc};
use serde::Serialize;
use serde_json::{json, Value};
use std::{
    collections::HashSet,
    fs,
    io::Write,
    net::{SocketAddr, TcpListener, TcpStream},
    path::{Path, PathBuf},
    process::{Child, Command, Stdio},
    sync::Mutex,
    time::Duration,
};
use tauri::{Manager, State};

const API_BASE: &str = "http://127.0.0.1:9880";

struct AppState {
    service_process: Mutex<Option<Child>>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct ProfileListItem {
    file: String,
    name: String,
    description: String,
    display_order: i64,
    updated_at: Option<String>,
    active: bool,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct SaveProfileResult {
    file: String,
    message: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct ServiceHealth {
    reachable: bool,
    status: String,
    version: Option<String>,
    message: Option<String>,
    raw: Option<Value>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct ServiceStatus {
    running: bool,
    state: String,
    health: ServiceHealth,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct EnvironmentInfo {
    os: String,
    python: String,
    cuda: String,
    port: String,
    root: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct EnvironmentReport {
    status: String,
    summary: String,
    root: String,
    can_start_vllm: bool,
    can_start_fast6g: bool,
    fixable_count: usize,
    checks: Vec<EnvironmentCheck>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct EnvironmentCheck {
    id: String,
    title: String,
    status: String,
    summary: String,
    detail: String,
    fixable: bool,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct EnvironmentRepairResult {
    fixed: Vec<String>,
    skipped: Vec<String>,
    report: EnvironmentReport,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct LogFileInfo {
    file: String,
    bytes: u64,
    modified: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct LogSnapshot {
    version: String,
    files: Vec<LogFileInfo>,
    active_file: Option<String>,
    lines: Vec<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct RecentGenerationItem {
    version: String,
    key: String,
    created_at: Option<String>,
    modified: Option<String>,
    audio_format: Option<String>,
    audio_bytes: Option<u64>,
    duration_s: Option<f64>,
    wall_s: Option<f64>,
    rtf: Option<f64>,
    wall_rtf: Option<f64>,
    first_pcm_s: Option<f64>,
    queue_wait_s: Option<f64>,
    llm_parse_s: Option<f64>,
    gpt_gen_s: Option<f64>,
    s2mel_s: Option<f64>,
    bigvgan_s: Option<f64>,
    cache_write_s: Option<f64>,
    segments_done: Option<u64>,
    segments_total: Option<u64>,
    parse_mode: Option<String>,
    performance_mode: Option<String>,
    role: Option<String>,
    first_text: Option<String>,
    segments: Vec<GenerationSegmentSummary>,
    status: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct GenerationSegmentSummary {
    index: u64,
    role: Option<String>,
    text: Option<String>,
    style: Option<String>,
    style_alpha: Option<f64>,
    start_s: Option<f64>,
    duration_s: Option<f64>,
    wall_s: Option<f64>,
    rtf: Option<f64>,
    infer_rtf: Option<f64>,
    gpt_gen_s: Option<f64>,
    s2mel_s: Option<f64>,
    bigvgan_s: Option<f64>,
    spk_condition_s: Option<f64>,
    emo_condition_s: Option<f64>,
    text_len: Option<u64>,
    text_token_count: Option<u64>,
    spk_cache_hit: Option<bool>,
    emo_cache_hit: Option<bool>,
    uses_style_audio: Option<bool>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct RecentGenerationsPage {
    version: String,
    page: usize,
    page_size: usize,
    total: usize,
    has_more: bool,
    items: Vec<RecentGenerationItem>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct VoiceRefItem {
    name: String,
    relative_path: String,
    subdir: String,
}

#[cfg(windows)]
struct SingleInstanceGuard(windows_sys::Win32::Foundation::HANDLE);

#[cfg(windows)]
impl Drop for SingleInstanceGuard {
    fn drop(&mut self) {
        if !self.0.is_null() {
            unsafe {
                windows_sys::Win32::Foundation::CloseHandle(self.0);
            }
        }
    }
}

#[cfg(windows)]
fn acquire_single_instance() -> Result<Option<SingleInstanceGuard>, String> {
    use std::{ffi::OsStr, os::windows::ffi::OsStrExt};
    use windows_sys::Win32::{
        Foundation::{GetLastError, ERROR_ALREADY_EXISTS},
        System::Threading::CreateMutexW,
    };

    let name: Vec<u16> = OsStr::new(r"Local\LEON.Launcher.Tauri.IndexTTS2")
        .encode_wide()
        .chain(Some(0))
        .collect();
    let handle = unsafe { CreateMutexW(std::ptr::null_mut(), 1, name.as_ptr()) };
    if handle.is_null() {
        return Err("创建启动器单实例锁失败".to_string());
    }
    if unsafe { GetLastError() } == ERROR_ALREADY_EXISTS {
        unsafe {
            windows_sys::Win32::Foundation::CloseHandle(handle);
        }
        return Ok(None);
    }
    Ok(Some(SingleInstanceGuard(handle)))
}

#[cfg(not(windows))]
struct SingleInstanceGuard;

#[cfg(not(windows))]
fn acquire_single_instance() -> Result<Option<SingleInstanceGuard>, String> {
    Ok(Some(SingleInstanceGuard))
}

fn main() {
    if std::env::var("LEON_LAUNCHER_SMOKE_TEST").ok().as_deref() == Some("1") {
        if let Err(error) = smoke_test() {
            eprintln!("LEON Tauri smoke failed: {}", error);
            std::process::exit(1);
        }
        std::process::exit(0);
    }

    let _single_instance = match acquire_single_instance() {
        Ok(Some(guard)) => guard,
        Ok(None) => return,
        Err(error) => {
            eprintln!("LEON Tauri single-instance failed: {}", error);
            std::process::exit(1);
        }
    };

    tauri::Builder::default()
        .manage(AppState {
            service_process: Mutex::new(None),
        })
        .on_window_event(|window, event| {
            if matches!(event, tauri::WindowEvent::CloseRequested { .. }) {
                let state = window.state::<AppState>();
                cleanup_service_on_exit(&state);
            }
        })
        .invoke_handler(tauri::generate_handler![
            get_profiles,
            get_profile,
            get_voice_refs,
            get_voice_ref_audio,
            create_profile,
            save_profile,
            apply_profile,
            copy_profile,
            delete_profile,
            validate_profile,
            start_service,
            stop_service,
            warmup_service,
            health_check,
            get_service_status,
            get_environment,
            get_environment_report,
            repair_environment,
            get_log_snapshot,
            get_recent_generations,
            upload_voice,
            delete_voice,
            move_voice,
            test_voice_generation
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

fn smoke_test() -> Result<(), String> {
    let root = leon_root()?;
    let profile_dir = root.join("config").join("profiles");
    let profiles = get_profiles()?;
    if profiles.is_empty() {
        return Err(format!("未找到可用 Profile: {}", profile_dir.display()));
    }
    validate_profile(profiles[0].file.clone())?;
    get_log_snapshot("fast6g".to_string(), Some(5))?;
    get_recent_generations("fast6g".to_string(), Some(1), Some(3), None)?;
    let active_path = profile_dir.join("active.json");
    if !active_path.exists() {
        return Err(format!("缺少 active profile: {}", active_path.display()));
    }
    Ok(())
}

#[tauri::command]
fn get_profiles() -> Result<Vec<ProfileListItem>, String> {
    let root = leon_root()?;
    let profile_dir = root.join("config").join("profiles");
    let active_from = active_profile_source(&profile_dir);
    let mut profiles = Vec::new();

    let entries = fs::read_dir(&profile_dir)
        .map_err(|e| format!("读取 Profile 目录失败 {}: {}", profile_dir.display(), e))?;

    for entry in entries {
        let entry = entry.map_err(|e| format!("读取 Profile 文件失败: {}", e))?;
        let path = entry.path();
        if path.extension().and_then(|s| s.to_str()) != Some("json") {
            continue;
        }

        let file = path
            .file_name()
            .and_then(|s| s.to_str())
            .unwrap_or_default()
            .to_string();
        if file.eq_ignore_ascii_case("active.json") {
            continue;
        }

        let value = read_json(&path)?;
        let name = value
            .get("name")
            .and_then(Value::as_str)
            .unwrap_or(file.as_str())
            .to_string();
        let description = value
            .get("description")
            .and_then(Value::as_str)
            .unwrap_or("")
            .to_string();
        let display_order = value
            .get("displayOrder")
            .or_else(|| value.get("display_order"))
            .and_then(Value::as_i64)
            .unwrap_or(9999);
        let updated_at = value
            .get("updatedAt")
            .or_else(|| value.get("updated_at"))
            .and_then(Value::as_str)
            .map(str::to_string);

        profiles.push(ProfileListItem {
            active: active_from
                .as_deref()
                .map(|active| active.eq_ignore_ascii_case(&file))
                .unwrap_or(false),
            file,
            name,
            description,
            display_order,
            updated_at,
        });
    }

    profiles.sort_by(|a, b| {
        a.display_order
            .cmp(&b.display_order)
            .then_with(|| a.file.to_lowercase().cmp(&b.file.to_lowercase()))
    });
    Ok(profiles)
}

#[tauri::command]
fn get_profile(file: String) -> Result<Value, String> {
    let profile_path = profile_file_path(&file)?;
    read_json(&profile_path)
}

#[tauri::command]
fn get_voice_refs() -> Result<Vec<VoiceRefItem>, String> {
    let root = leon_root()?;
    let mut items = Vec::new();
    for library_root in voice_library_roots(&root) {
        collect_voice_refs(&root, &library_root, &library_root, &mut items)?;
    }
    items.sort_by(|a, b| {
        a.subdir
            .cmp(&b.subdir)
            .then_with(|| a.name.to_lowercase().cmp(&b.name.to_lowercase()))
    });
    Ok(items)
}

#[tauri::command]
fn get_voice_ref_audio(ref_name: String) -> Result<String, String> {
    let root = leon_root()?;
    let path = resolve_voice_ref(&root, &ref_name)
        .ok_or_else(|| format!("参考音频不存在: {}", ref_name.trim()))?;
    let canonical = path
        .canonicalize()
        .map_err(|e| format!("解析参考音频路径失败 {}: {}", path.display(), e))?;
    if !is_voice_file(&canonical) {
        return Err(format!("不是支持的音频文件: {}", canonical.display()));
    }

    let inside_voice_library = voice_library_roots(&root)
        .into_iter()
        .any(|library_root| canonical.starts_with(library_root));
    if !inside_voice_library {
        return Err("试听只允许读取 prompts/library 下的参考音频".to_string());
    }

    let meta = fs::metadata(&canonical)
        .map_err(|e| format!("读取参考音频信息失败 {}: {}", canonical.display(), e))?;
    const MAX_PREVIEW_BYTES: u64 = 25 * 1024 * 1024;
    if meta.len() > MAX_PREVIEW_BYTES {
        return Err(format!(
            "参考音频过大，无法试听: {:.1} MB",
            meta.len() as f64 / 1024.0 / 1024.0
        ));
    }

    let bytes = fs::read(&canonical)
        .map_err(|e| format!("读取参考音频失败 {}: {}", canonical.display(), e))?;
    Ok(format!(
        "data:{};base64,{}",
        media_type_for_voice_path(&canonical),
        general_purpose::STANDARD.encode(bytes)
    ))
}

#[tauri::command]
fn create_profile() -> Result<String, String> {
    let root = leon_root()?;
    let profile_dir = root.join("config").join("profiles");
    let template_path = preferred_profile_template(&profile_dir)?;
    let mut profile = read_json(&template_path)?;

    let Some(object) = profile.as_object_mut() else {
        return Err("Profile 模板根节点必须是 JSON object".to_string());
    };
    object.remove("appliedAt");
    object.remove("appliedFrom");
    object.insert("name".to_string(), json!("New LEON Profile"));
    object.insert(
        "description".to_string(),
        json!("New profile created by the Tauri launcher."),
    );
    object.insert("displayOrder".to_string(), json!(9999));
    object.insert("updatedAt".to_string(), json!(Utc::now().to_rfc3339()));

    validate_profile_value(&profile)?;

    let target_name = next_new_profile_file_name(&profile_dir)?;
    let target_path = profile_dir.join(&target_name);
    let content = serde_json::to_string_pretty(&profile)
        .map_err(|e| format!("序列化 Profile 失败: {}", e))?;
    fs::write(&target_path, content)
        .map_err(|e| format!("写入 {} 失败: {}", target_path.display(), e))?;

    Ok(target_name)
}

#[tauri::command]
fn save_profile(file: String, mut profile: Value) -> Result<SaveProfileResult, String> {
    let safe_name = safe_profile_file_name(&file)?;
    validate_profile_value(&profile)?;
    let Some(object) = profile.as_object_mut() else {
        return Err("Profile 根节点必须是 JSON object".to_string());
    };

    object.remove("appliedAt");
    object.remove("appliedFrom");
    object.insert("updatedAt".to_string(), json!(Utc::now().to_rfc3339()));

    let root = leon_root()?;
    let profile_dir = root.join("config").join("profiles");
    let target_name = profile_file_name_for_profile(&profile, &safe_name, &profile_dir)?;
    let source_path = profile_dir.join(&safe_name);
    let target_path = profile_dir.join(&target_name);
    let content = serde_json::to_string_pretty(&profile)
        .map_err(|e| format!("序列化 Profile 失败: {}", e))?;

    if !target_name.eq_ignore_ascii_case(&safe_name) && source_path.exists() {
        fs::rename(&source_path, &target_path).map_err(|e| {
            format!(
                "重命名 Profile {} -> {} 失败: {}",
                source_path.display(),
                target_path.display(),
                e
            )
        })?;
    }
    fs::write(&target_path, content)
        .map_err(|e| format!("写入 {} 失败: {}", target_path.display(), e))?;

    let message = if target_name.eq_ignore_ascii_case(&safe_name) {
        format!("已保存 Profile：{}", target_name)
    } else {
        format!("已保存 Profile：{}（文件名已跟随名称更新）", target_name)
    };
    Ok(SaveProfileResult {
        file: target_name,
        message,
    })
}

#[tauri::command]
fn apply_profile(file: String) -> Result<String, String> {
    let root = leon_root()?;
    let profile_dir = root.join("config").join("profiles");
    let source_path = profile_file_path(&file)?;
    let mut profile = read_json(&source_path)?;

    profile["appliedAt"] = json!(Utc::now().to_rfc3339());
    profile["appliedFrom"] = json!(safe_profile_file_name(&file)?);

    let active_path = profile_dir.join("active.json");
    let content = serde_json::to_string_pretty(&profile)
        .map_err(|e| format!("序列化 active profile 失败: {}", e))?;
    fs::write(&active_path, content)
        .map_err(|e| format!("写入 {} 失败: {}", active_path.display(), e))?;
    hide_file_best_effort(&active_path);

    Ok(format!("已启用配置：{}", safe_profile_file_name(&file)?))
}

#[tauri::command]
fn copy_profile(file: String) -> Result<String, String> {
    let source_path = profile_file_path(&file)?;
    let source_name = safe_profile_file_name(&file)?;
    let mut profile = read_json(&source_path)?;
    profile.as_object_mut().map(|object| {
        object.remove("appliedAt");
        object.remove("appliedFrom");
    });

    if let Some(object) = profile.as_object_mut() {
        if let Some(name) = object.get("name").and_then(Value::as_str) {
            object.insert("name".to_string(), json!(format!("{} copy", name)));
        }
        object.insert("updatedAt".to_string(), json!(Utc::now().to_rfc3339()));
    }

    let root = leon_root()?;
    let profile_dir = root.join("config").join("profiles");
    let target_name = next_copy_file_name(&profile_dir, &source_name)?;
    let target_path = profile_dir.join(&target_name);
    let content = serde_json::to_string_pretty(&profile)
        .map_err(|e| format!("序列化 Profile 失败: {}", e))?;
    fs::write(&target_path, content)
        .map_err(|e| format!("写入 {} 失败: {}", target_path.display(), e))?;

    Ok(format!("已复制为：{}", target_name))
}

#[tauri::command]
fn delete_profile(file: String) -> Result<String, String> {
    let safe_name = safe_profile_file_name(&file)?;
    let root = leon_root()?;
    let profile_dir = root.join("config").join("profiles");
    if active_profile_source(&profile_dir)
        .as_deref()
        .map(|active| active.eq_ignore_ascii_case(&safe_name))
        .unwrap_or(false)
    {
        return Err("不能删除当前启用的 Profile，请先启用其他配置".to_string());
    }

    let path = profile_dir.join(&safe_name);
    fs::remove_file(&path).map_err(|e| format!("删除 {} 失败: {}", path.display(), e))?;
    Ok(format!("已删除：{}", safe_name))
}

#[tauri::command]
fn validate_profile(file: String) -> Result<String, String> {
    let value = read_json(&profile_file_path(&file)?)?;
    validate_profile_value(&value)?;
    Ok(format!(
        "Profile 校验通过：{}",
        safe_profile_file_name(&file)?
    ))
}

#[tauri::command]
async fn start_service(
    version: String,
    gpu_ratio: Option<f32>,
    enable_msvc: Option<bool>,
    state: State<'_, AppState>,
) -> Result<String, String> {
    let root = leon_root()?;
    let normalized = normalize_version(&version);

    if health_check_internal().await.reachable {
        return Ok(format!("LEON 服务已在运行：{}", API_BASE));
    }

    {
        let mut guard = state
            .service_process
            .lock()
            .map_err(|_| "服务状态锁已损坏".to_string())?;
        if let Some(child) = guard.as_mut() {
            if child
                .try_wait()
                .map_err(|e| format!("检查启动进程失败: {}", e))?
                .is_none()
            {
                return Err("服务启动进程仍在运行，请稍后再试".to_string());
            }
            *guard = None;
        }
    }

    let version_root = root.join(&normalized);
    let active_profile = root.join("config").join("profiles").join("active.json");
    let launcher_log = launcher_log_path(&root, &normalized)?;
    let shared_entry = root.join("scripts").join("restart-leon-api.ps1");
    if !shared_entry.exists() {
        return Err(format!("缺少共享启动脚本: {}", shared_entry.display()));
    }
    append_launcher_log(
        &launcher_log,
        "INFO",
        &format!("调用启动入口: {}", shell_path(&shared_entry)),
    )?;
    if normalized == "vllm" {
        let ratio = gpu_ratio.unwrap_or(0.15);
        let use_msvc = enable_msvc.unwrap_or(true);
        append_launcher_log(
            &launcher_log,
            "INFO",
            &format!(
                "启动配置: vLLM, gpu_memory_utilization={}, MSVC={}",
                format_ratio(ratio),
                if use_msvc { "on" } else { "off" }
            ),
        )?;
    } else {
        append_launcher_log(&launcher_log, "INFO", "启动配置: Fast6G")?;
    }
    let stdout = fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(&launcher_log)
        .map_err(|e| format!("打开启动日志失败 {}: {}", launcher_log.display(), e))?;
    let stderr = stdout
        .try_clone()
        .map_err(|e| format!("复制启动日志句柄失败: {}", e))?;

    let mut cmd = Command::new("powershell.exe");
    cmd.args([
        "-NoProfile",
        "-WindowStyle",
        "Hidden",
        "-ExecutionPolicy",
        "Bypass",
        "-File",
    ])
    .arg(shell_path(&shared_entry))
    .args([
        "-Version",
        normalized.as_str(),
        "-Port",
        "9880",
        "-HostAddress",
        "0.0.0.0",
        "-LeonRoot",
    ])
    .arg(shell_path(&root));
    if normalized == "vllm" {
        cmd.args(["-VllmGpuMemoryUtilization"])
            .arg(format_ratio(gpu_ratio.unwrap_or(0.15)))
            .args([
                "-EnableMsvc",
                if enable_msvc.unwrap_or(true) {
                    "1"
                } else {
                    "0"
                },
            ]);
    }

    cmd.current_dir(shell_path(&root))
        .env("LEON_LAUNCHER_NO_PAUSE", "1")
        .env("LEON_ROOT", shell_path(&root))
        .env("LEON_VERSION_ROOT", shell_path(&version_root))
        .env("LEON_STATIC_DIR", shell_path(&root.join("static")))
        .env("LEON_LAUNCHER_VERSION", &normalized)
        .env("LEON_ENABLE_QWEN_EMO", "0")
        .env("LEON_ACTIVE_PROFILE_PATH", shell_path(&active_profile))
        .env("HF_HOME", shell_path(&version_root.join("checkpoints")))
        .env("PYTHONUTF8", "1")
        .env("PYTHONIOENCODING", "utf-8")
        .stdout(Stdio::from(stdout))
        .stderr(Stdio::from(stderr));

    if normalized == "vllm" {
        let ratio = gpu_ratio.unwrap_or(0.15);
        cmd.env("INDEXTTS_VLLM_GPU_MEMORY_UTILIZATION", format_ratio(ratio));
        let use_msvc = enable_msvc.unwrap_or(true);
        cmd.env("LEON_ENABLE_MSVC", if use_msvc { "1" } else { "0" });
    }
    hide_child_window(&mut cmd);

    let mut child = match cmd.spawn() {
        Ok(child) => child,
        Err(e) => {
            let message = format!("启动 {} 服务失败: {}", normalized, e);
            let _ = append_launcher_log(&launcher_log, "ERROR", &message);
            return Err(message);
        }
    };
    let pid = child.id();
    append_launcher_log(&launcher_log, "INFO", &format!("启动 wrapper PID: {}", pid))?;

    std::thread::sleep(Duration::from_millis(700));
    if let Some(status) = child
        .try_wait()
        .map_err(|e| format!("检查启动进程失败: {}", e))?
    {
        if !status.success() {
            let tail = read_tail_lines(&launcher_log, 40)
                .unwrap_or_else(|_| vec!["启动日志读取失败".to_string()])
                .join("\n");
            let _ = append_launcher_log(
                &launcher_log,
                "ERROR",
                &format!("启动 wrapper 异常退出，exit={}", status),
            );
            return Err(format!(
                "{} 启动进程已退出，exit={}。\n{}",
                normalized, status, tail
            ));
        }
        append_launcher_log(
            &launcher_log,
            "INFO",
            &format!("启动 wrapper 已退出，exit={}", status),
        )?;
    }

    let mut guard = state
        .service_process
        .lock()
        .map_err(|_| "服务状态锁已损坏".to_string())?;
    *guard = Some(child);

    Ok(format!(
        "{} 启动命令已发送，wrapper PID: {}，日志: {}",
        normalized,
        pid,
        launcher_log.display()
    ))
}

#[tauri::command]
async fn stop_service(state: State<'_, AppState>) -> Result<String, String> {
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(2))
        .build()
        .map_err(|e| format!("创建 HTTP client 失败: {}", e))?;

    let _ = client
        .get(format!("{}/control?command=exit", API_BASE))
        .send()
        .await;

    tokio::time::sleep(Duration::from_millis(1200)).await;
    let killed_wrapper = cleanup_service_wrapper(&state)?;
    let killed_project_listeners = kill_project_api_listeners(9880)?;
    let killed_project_gpu_workers = kill_project_gpu_runtime_processes()?;

    if killed_wrapper || killed_project_listeners > 0 || killed_project_gpu_workers > 0 {
        Ok(format!(
            "已发送退出请求，并清理残留进程：wrapper={}，API={}，GPU worker={}",
            if killed_wrapper { 1 } else { 0 },
            killed_project_listeners,
            killed_project_gpu_workers
        ))
    } else {
        Ok("已发送退出请求".to_string())
    }
}

#[tauri::command]
async fn warmup_service(force: Option<bool>) -> Result<String, String> {
    let health = health_check_internal().await;
    if !health.reachable {
        return Err("LEON 服务未运行，无法预热模型".to_string());
    }

    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(180))
        .build()
        .map_err(|e| format!("创建 HTTP client 失败: {}", e))?;

    let body = json!({
        "voice": "400个火爆音色/短剧解说",
        "text": "你好。",
        "force": force.unwrap_or(false),
    });

    let resp = client
        .post(format!("{}/warmup", API_BASE))
        .json(&body)
        .send()
        .await
        .map_err(|e| format!("预热请求失败: {}", e))?;
    let status = resp.status();
    let value = resp
        .json::<Value>()
        .await
        .map_err(|e| format!("预热响应不是 JSON: {}", e))?;

    if !status.is_success() {
        return Err(format!("预热失败 HTTP {}: {}", status, value));
    }

    let state = value
        .get("status")
        .and_then(Value::as_str)
        .unwrap_or("unknown");
    let voice = value
        .get("voice")
        .and_then(Value::as_str)
        .unwrap_or("unknown");
    Ok(format!("模型预热返回：status={} voice={}", state, voice))
}

#[tauri::command]
async fn health_check() -> Result<ServiceHealth, String> {
    Ok(health_check_internal().await)
}

#[tauri::command]
async fn get_service_status(state: State<'_, AppState>) -> Result<ServiceStatus, String> {
    let health = health_check_internal().await;
    let mut has_wrapper = false;
    {
        let mut guard = state
            .service_process
            .lock()
            .map_err(|_| "服务状态锁已损坏".to_string())?;
        if let Some(child) = guard.as_mut() {
            has_wrapper = child
                .try_wait()
                .map_err(|e| format!("检查启动进程失败: {}", e))?
                .is_none();
            if !has_wrapper {
                *guard = None;
            }
        }
    }

    let state = if health.reachable {
        "running"
    } else if has_wrapper {
        "starting"
    } else {
        "stopped"
    };

    Ok(ServiceStatus {
        running: health.reachable,
        state: state.to_string(),
        health,
    })
}

#[tauri::command]
fn get_environment() -> Result<EnvironmentInfo, String> {
    let root = leon_root()?;
    Ok(EnvironmentInfo {
        os: format!("{} {}", std::env::consts::OS, std::env::consts::ARCH),
        python: command_first_line("python", &["--version"])
            .unwrap_or_else(|| "未检测到".to_string()),
        cuda: command_first_line(
            "nvidia-smi",
            &[
                "--query-gpu=name,memory.total,memory.free",
                "--format=csv,noheader,nounits",
            ],
        )
        .unwrap_or_else(|| "未检测到 NVIDIA GPU".to_string()),
        port: check_port_text(9880),
        root: root.display().to_string(),
    })
}

#[tauri::command]
fn get_environment_report() -> Result<EnvironmentReport, String> {
    build_environment_report()
}

#[tauri::command]
fn repair_environment() -> Result<EnvironmentRepairResult, String> {
    let root = leon_root()?;
    let mut fixed = Vec::new();
    let mut skipped = Vec::new();

    match ensure_active_profile(&root) {
        Ok(Some(message)) => fixed.push(message),
        Ok(None) => {}
        Err(error) => skipped.push(error),
    }

    for dir in release_runtime_dirs(&root) {
        match fs::create_dir_all(&dir) {
            Ok(_) => fixed.push(format!("确认目录存在: {}", dir.display())),
            Err(error) => skipped.push(format!("创建目录失败 {}: {}", dir.display(), error)),
        }
    }

    match kill_project_api_listeners(9880) {
        Ok(count) if count > 0 => fixed.push(format!("清理 LEON API 端口残留进程: {}", count)),
        Ok(_) => {}
        Err(error) => skipped.push(format!("API 端口残留清理失败: {}", error)),
    }
    match kill_project_gpu_runtime_processes() {
        Ok(count) if count > 0 => fixed.push(format!("清理 LEON GPU worker 残留进程: {}", count)),
        Ok(_) => {}
        Err(error) => skipped.push(format!("GPU worker 残留清理失败: {}", error)),
    }

    Ok(EnvironmentRepairResult {
        fixed,
        skipped,
        report: build_environment_report()?,
    })
}

#[tauri::command]
fn get_log_snapshot(version: String, max_lines: Option<usize>) -> Result<LogSnapshot, String> {
    let root = leon_root()?;
    let normalized = normalize_version(&version);
    let log_dir = root.join("logs").join(&normalized);
    let max_lines = max_lines.unwrap_or(220).clamp(20, 1000);

    if !log_dir.is_dir() {
        return Ok(LogSnapshot {
            version: normalized,
            files: Vec::new(),
            active_file: None,
            lines: vec![format!("日志目录不存在：{}", log_dir.display())],
        });
    }

    let mut files = Vec::new();
    let mut candidates = Vec::new();
    for entry in fs::read_dir(&log_dir)
        .map_err(|e| format!("读取日志目录失败 {}: {}", log_dir.display(), e))?
    {
        let entry = entry.map_err(|e| format!("读取日志文件失败: {}", e))?;
        let path = entry.path();
        if !path.is_file() || !is_log_file(&path) {
            continue;
        }
        let metadata = entry
            .metadata()
            .map_err(|e| format!("读取日志元数据失败 {}: {}", path.display(), e))?;
        let modified = metadata.modified().ok();
        let file = path
            .file_name()
            .and_then(|s| s.to_str())
            .unwrap_or_default()
            .to_string();
        files.push(LogFileInfo {
            file: file.clone(),
            bytes: metadata.len(),
            modified: modified.and_then(system_time_to_rfc3339),
        });
        candidates.push((path, modified));
    }

    files.sort_by(|a, b| {
        b.modified
            .cmp(&a.modified)
            .then_with(|| b.file.cmp(&a.file))
    });
    candidates.sort_by(|a, b| b.1.cmp(&a.1));

    let latest_modified = candidates.first().and_then(|(_, modified)| *modified);
    let Some((active_path, _)) = candidates
        .iter()
        .find(|(path, modified)| {
            is_launcher_log_file(path)
                && modified_is_close_to_latest(*modified, latest_modified, Duration::from_secs(180))
        })
        .or_else(|| candidates.first())
    else {
        return Ok(LogSnapshot {
            version: normalized,
            files,
            active_file: None,
            lines: vec![format!("没有找到日志文件：{}", log_dir.display())],
        });
    };

    let lines = read_tail_lines(active_path, max_lines)?;

    Ok(LogSnapshot {
        version: normalized,
        files,
        active_file: active_path
            .file_name()
            .and_then(|s| s.to_str())
            .map(str::to_string),
        lines,
    })
}

#[tauri::command]
fn get_recent_generations(
    version: String,
    page: Option<usize>,
    page_size: Option<usize>,
    max_items: Option<usize>,
) -> Result<RecentGenerationsPage, String> {
    let root = leon_root()?;
    let normalized = normalize_version(&version);
    let cache_dir = root.join(&normalized).join("outputs").join("cache");
    let page = page.unwrap_or(1).max(1);
    let page_size = page_size.or(max_items).unwrap_or(12).clamp(1, 50);

    if !cache_dir.is_dir() {
        return Ok(RecentGenerationsPage {
            version: normalized,
            page,
            page_size,
            total: 0,
            has_more: false,
            items: Vec::new(),
        });
    }

    let mut candidates = collect_generation_json_candidates(&cache_dir)?;
    candidates.sort_by(|a, b| b.1.cmp(&a.1).then_with(|| b.2.cmp(&a.2)));

    let mut unique_items = Vec::new();
    let mut seen_keys = HashSet::new();
    for (path, modified_time, _) in candidates {
        let item = match recent_generation_from_json(&normalized, &cache_dir, &path, modified_time)
        {
            Ok(item) => item,
            Err(_) => continue,
        };
        if seen_keys.insert(item.key.clone()) {
            unique_items.push(item);
        }
    }

    let start = page.saturating_sub(1).saturating_mul(page_size);
    let total = unique_items.len();
    let items = unique_items
        .into_iter()
        .skip(start)
        .take(page_size)
        .collect::<Vec<_>>();

    Ok(RecentGenerationsPage {
        version: normalized,
        page,
        page_size,
        total,
        has_more: start.saturating_add(items.len()) < total,
        items,
    })
}

async fn health_check_internal() -> ServiceHealth {
    let client = match reqwest::Client::builder()
        .timeout(Duration::from_secs(3))
        .build()
    {
        Ok(client) => client,
        Err(e) => {
            return ServiceHealth {
                reachable: false,
                status: "error".to_string(),
                version: None,
                message: Some(format!("创建 HTTP client 失败: {}", e)),
                raw: None,
            }
        }
    };

    match client.get(format!("{}/health", API_BASE)).send().await {
        Ok(resp) if resp.status().is_success() => match resp.json::<Value>().await {
            Ok(value) => ServiceHealth {
                reachable: true,
                status: "healthy".to_string(),
                version: value
                    .get("version")
                    .and_then(Value::as_str)
                    .map(str::to_string),
                message: Some("服务运行中".to_string()),
                raw: Some(value),
            },
            Err(e) => ServiceHealth {
                reachable: true,
                status: "healthy".to_string(),
                version: None,
                message: Some(format!("健康检查返回非 JSON: {}", e)),
                raw: None,
            },
        },
        Ok(resp) => ServiceHealth {
            reachable: false,
            status: "unhealthy".to_string(),
            version: None,
            message: Some(format!("HTTP {}", resp.status())),
            raw: None,
        },
        Err(_) => ServiceHealth {
            reachable: false,
            status: "stopped".to_string(),
            version: None,
            message: Some("服务未运行".to_string()),
            raw: None,
        },
    }
}

fn leon_root() -> Result<PathBuf, String> {
    if let Ok(raw) = std::env::var("LEON_ROOT") {
        let path = PathBuf::from(raw);
        if is_leon_root(&path) {
            return canonical(path);
        }
    }

    let mut candidates = Vec::new();
    if let Ok(current_dir) = std::env::current_dir() {
        candidates.extend(ancestors(&current_dir));
    }
    if let Ok(exe) = std::env::current_exe() {
        if let Some(parent) = exe.parent() {
            candidates.extend(ancestors(parent));
        }
    }
    candidates.extend(ancestors(Path::new(env!("CARGO_MANIFEST_DIR"))));

    for candidate in candidates {
        if is_leon_root(&candidate) {
            return canonical(candidate);
        }
    }

    Err("无法定位 LEON 根目录：需要包含 config/profiles 和 scripts".to_string())
}

fn ancestors(path: &Path) -> Vec<PathBuf> {
    path.ancestors().map(Path::to_path_buf).collect()
}

fn is_leon_root(path: &Path) -> bool {
    path.join("config").join("profiles").is_dir() && path.join("scripts").is_dir()
}

fn canonical(path: PathBuf) -> Result<PathBuf, String> {
    path.canonicalize()
        .map_err(|e| format!("解析路径 {} 失败: {}", path.display(), e))
}

fn shell_path(path: &Path) -> String {
    let text = path.to_string_lossy();
    if let Some(rest) = text.strip_prefix(r"\\?\UNC\") {
        format!(r"\\{}", rest)
    } else if let Some(rest) = text.strip_prefix(r"\\?\") {
        rest.to_string()
    } else {
        text.to_string()
    }
}

fn profile_file_path(file: &str) -> Result<PathBuf, String> {
    let root = leon_root()?;
    Ok(root
        .join("config")
        .join("profiles")
        .join(safe_profile_file_name(file)?))
}

fn safe_profile_file_name(file: &str) -> Result<String, String> {
    let name = Path::new(file)
        .file_name()
        .and_then(|s| s.to_str())
        .ok_or_else(|| "Profile 文件名无效".to_string())?;
    if !name.ends_with(".json") || name.eq_ignore_ascii_case("active.json") {
        return Err("Profile 文件必须是非 active.json 的 .json 文件".to_string());
    }
    Ok(name.to_string())
}

fn profile_file_name_for_profile(
    profile: &Value,
    current_name: &str,
    profile_dir: &Path,
) -> Result<String, String> {
    let display_name = profile
        .get("name")
        .and_then(Value::as_str)
        .unwrap_or("")
        .trim();
    let mut stem = profile_name_slug(display_name);
    if stem.is_empty() {
        stem = profile_name_slug(current_name.trim_end_matches(".json"));
    }
    if stem.is_empty() {
        stem = "leon-profile".to_string();
    }
    if !stem.eq_ignore_ascii_case("leon") && !stem.starts_with("leon-") {
        stem = format!("leon-{}", stem);
    }

    for index in 0..1000 {
        let candidate = if index == 0 {
            format!("{}.json", stem)
        } else {
            format!("{}-{}.json", stem, index + 1)
        };
        if candidate.eq_ignore_ascii_case("active.json") {
            continue;
        }
        if candidate.eq_ignore_ascii_case(current_name) || !profile_dir.join(&candidate).exists() {
            return Ok(candidate);
        }
    }

    Err("无法生成可用的 Profile 文件名".to_string())
}

fn profile_name_slug(name: &str) -> String {
    let mut output = String::new();
    let mut pending_separator = false;
    for ch in name.chars() {
        if ch.is_ascii_alphanumeric() {
            if pending_separator && !output.is_empty() {
                output.push('-');
            }
            output.push(ch.to_ascii_lowercase());
            pending_separator = false;
            continue;
        }

        if let Some(piece) = slug_char_piece(ch) {
            if pending_separator && !output.is_empty() {
                output.push('-');
            }
            output.push_str(&piece);
            pending_separator = false;
            continue;
        }

        if !output.is_empty() {
            pending_separator = true;
        }
    }
    output.trim_matches('-').to_string()
}

fn slug_char_piece(ch: char) -> Option<String> {
    let piece = match ch {
        '步' => "bu",
        '非' => "fei",
        '烟' => "yan",
        '默' => "mo",
        '认' => "ren",
        '耳' => "er",
        '语' => "yu",
        '恋' => "lian",
        '爱' => "ai",
        '声' => "sheng",
        '腔' => "qiang",
        '喘' => "chuan",
        '息' => "xi",
        '低' => "di",
        '吟' => "yin",
        '哭' => "ku",
        '惊' => "jing",
        '笑' => "xiao",
        '挑' => "tiao",
        '逗' => "dou",
        '轻' => "qing",
        '微' => "wei",
        '明' => "ming",
        '显' => "xian",
        '紧' => "jin",
        '张' => "zhang",
        '害' => "hai",
        '羞' => "xiu",
        '阶' => "jie",
        '段' => "duan",
        '开' => "kai",
        '场' => "chang",
        '升' => "sheng",
        '温' => "wen",
        '高' => "gao",
        '点' => "dian",
        '余' => "yu",
        '韵' => "yun",
        '普' => "pu",
        '通' => "tong",
        '平' => "ping",
        '静' => "jing",
        '新' => "xin",
        '配' => "pei",
        '置' => "zhi",
        '宫' => "gong",
        '本' => "ben",
        '留' => "liu",
        '衣' => "yi",
        _ => {
            if is_cjk(ch) {
                return Some(format!("u{:x}", ch as u32));
            }
            return None;
        }
    };
    Some(piece.to_string())
}

fn is_cjk(ch: char) -> bool {
    matches!(
        ch as u32,
        0x3400..=0x4dbf | 0x4e00..=0x9fff | 0xf900..=0xfaff | 0x20000..=0x2a6df | 0x2a700..=0x2b73f | 0x2b740..=0x2b81f | 0x2b820..=0x2ceaf
    )
}

fn hide_file_best_effort(path: &Path) {
    #[cfg(windows)]
    {
        let _ = Command::new("attrib")
            .arg("+H")
            .arg(shell_path(path))
            .status();
    }
    #[cfg(not(windows))]
    {
        let _ = path;
    }
}

fn next_copy_file_name(profile_dir: &Path, source_name: &str) -> Result<String, String> {
    let stem = source_name.trim_end_matches(".json");
    for index in 1..1000 {
        let suffix = if index == 1 {
            "-copy".to_string()
        } else {
            format!("-copy-{}", index)
        };
        let candidate = format!("{}{}.json", stem, suffix);
        if !profile_dir.join(&candidate).exists() {
            return Ok(candidate);
        }
    }
    Err("无法生成可用的复制文件名".to_string())
}

fn next_new_profile_file_name(profile_dir: &Path) -> Result<String, String> {
    for index in 1..1000 {
        let candidate = if index == 1 {
            "leon-new-profile.json".to_string()
        } else {
            format!("leon-new-profile-{}.json", index)
        };
        if !profile_dir.join(&candidate).exists() {
            return Ok(candidate);
        }
    }
    Err("无法生成可用的新 Profile 文件名".to_string())
}

fn preferred_profile_template(profile_dir: &Path) -> Result<PathBuf, String> {
    let default_path = profile_dir.join("leon-default.json");
    if default_path.is_file() {
        return Ok(default_path);
    }

    let active_path = profile_dir.join("active.json");
    if active_path.is_file() {
        return Ok(active_path);
    }

    Err("无法创建 Profile：缺少 leon-default.json 或 active.json 模板".to_string())
}

fn validate_profile_value(value: &Value) -> Result<(), String> {
    if value.get("version").and_then(Value::as_i64).unwrap_or(0) < 3 {
        return Err("Profile version 必须 >= 3".to_string());
    }
    required_str(value, "name")?;
    let quality = value
        .get("quality")
        .ok_or_else(|| "缺少 quality".to_string())?;
    let default_mode = required_str(quality, "defaultMode")?;
    let presets = quality
        .get("presets")
        .ok_or_else(|| "缺少 quality.presets".to_string())?;
    let live = presets
        .get("live")
        .ok_or_else(|| "缺少 quality.presets.live".to_string())?;
    let generate = presets
        .get("generate")
        .ok_or_else(|| "缺少 quality.presets.generate".to_string())?;
    validate_preset(live, default_mode, "live")?;
    validate_preset(generate, default_mode, "generate")?;
    let styles = value
        .get("styles")
        .and_then(Value::as_object)
        .ok_or_else(|| "缺少 styles".to_string())?;
    if styles.is_empty() {
        return Err("styles 不能为空".to_string());
    }
    validate_styles(styles)?;
    Ok(())
}

fn required_str<'a>(value: &'a Value, key: &str) -> Result<&'a str, String> {
    value
        .get(key)
        .and_then(Value::as_str)
        .filter(|text| !text.trim().is_empty())
        .ok_or_else(|| format!("缺少字段 {}", key))
}

fn validate_preset(value: &Value, mode: &str, group: &str) -> Result<(), String> {
    let preset = value
        .get(mode)
        .ok_or_else(|| format!("缺少 quality.presets.{}.{}", group, mode))?;
    for key in [
        "diffusion_steps",
        "prompt_audio_seconds",
        "segment_tokens",
        "first_tokens",
        "s2mel_cfg_rate",
        "interval_ms",
        "top_p",
        "top_k",
        "temperature",
        "repetition_penalty",
    ] {
        if !preset.get(key).is_some_and(Value::is_number) {
            return Err(format!(
                "quality.presets.{}.{}.{} 缺少或不是数字",
                group, mode, key
            ));
        }
    }
    Ok(())
}

fn validate_styles(styles: &serde_json::Map<String, Value>) -> Result<(), String> {
    let root = leon_root()?;
    let mut neutral_enabled = false;
    for (style_id, value) in styles {
        let id = style_id.trim();
        if !valid_style_id(id) {
            return Err(format!("非法 style id: {}", style_id));
        }
        let style = value
            .as_object()
            .ok_or_else(|| format!("styles.{} 必须是 object", id))?;
        let enabled = style
            .get("enabled")
            .and_then(Value::as_bool)
            .unwrap_or(true);
        if !enabled {
            if id.eq_ignore_ascii_case("neutral") {
                return Err("styles.neutral 不能禁用".to_string());
            }
            continue;
        }
        if id.eq_ignore_ascii_case("neutral") {
            neutral_enabled = true;
        }

        required_str(value, "label").map_err(|_| format!("styles.{}.label 不能为空", id))?;
        let refs = style_refs(style);
        if !id.eq_ignore_ascii_case("neutral") && !id.eq_ignore_ascii_case("none") {
            if refs.is_empty() {
                return Err(format!("styles.{}.refs 至少选择 1 个参考音频", id));
            }
            for ref_path in refs {
                if resolve_voice_ref(&root, &ref_path).is_none() {
                    return Err(format!("styles.{}.refs 不可用: {}", id, ref_path));
                }
            }
        }

        validate_number(
            style.get("style_alpha"),
            0.12,
            0.78,
            &format!("styles.{}.style_alpha", id),
        )?;
        validate_number(
            style.get("emo_alpha"),
            0.12,
            0.62,
            &format!("styles.{}.emo_alpha", id),
        )?;
        if let Some(vec_value) = style.get("emo_vec") {
            let vec = vec_value
                .as_array()
                .ok_or_else(|| format!("styles.{}.emo_vec 必须是 8 维数组", id))?;
            if vec.len() != 8 {
                return Err(format!("styles.{}.emo_vec 必须是 8 维数组", id));
            }
            for (index, item) in vec.iter().enumerate() {
                validate_number(
                    Some(item),
                    0.0,
                    1.0,
                    &format!("styles.{}.emo_vec[{}]", id, index),
                )?;
            }
        }
    }
    if !neutral_enabled {
        return Err("styles 必须启用 neutral".to_string());
    }
    Ok(())
}

fn style_refs(style: &serde_json::Map<String, Value>) -> Vec<String> {
    let mut refs = Vec::new();
    if let Some(items) = style.get("refs").and_then(Value::as_array) {
        for item in items {
            if let Some(text) = item.as_str() {
                let trimmed = text.trim();
                if !trimmed.is_empty() && !refs.iter().any(|value| value == trimmed) {
                    refs.push(trimmed.to_string());
                }
            }
        }
    }
    if let Some(text) = style.get("ref").and_then(Value::as_str) {
        let trimmed = text.trim();
        if !trimmed.is_empty() && !refs.iter().any(|value| value == trimmed) {
            refs.push(trimmed.to_string());
        }
    }
    refs
}

fn valid_style_id(value: &str) -> bool {
    !value.is_empty()
        && value.chars().count() <= 80
        && value.chars().all(|ch| {
            ch.is_ascii_alphanumeric()
                || ch == '_'
                || ch == '-'
                || ('\u{4e00}'..='\u{9fff}').contains(&ch)
        })
}

fn validate_number(value: Option<&Value>, low: f64, high: f64, field: &str) -> Result<(), String> {
    let parsed = value
        .and_then(Value::as_f64)
        .ok_or_else(|| format!("{} 必须是数字", field))?;
    if parsed < low || parsed > high {
        return Err(format!("{} 超出范围 {}-{}: {}", field, low, high, parsed));
    }
    Ok(())
}

fn collect_voice_refs(
    root: &Path,
    library_root: &Path,
    scan_root: &Path,
    items: &mut Vec<VoiceRefItem>,
) -> Result<(), String> {
    collect_voice_refs_inner(root, library_root, scan_root, items)
}

fn collect_voice_refs_inner(
    root: &Path,
    library_root: &Path,
    current_dir: &Path,
    items: &mut Vec<VoiceRefItem>,
) -> Result<(), String> {
    if !library_root.is_dir() || !current_dir.is_dir() {
        return Ok(());
    }
    let entries = fs::read_dir(current_dir)
        .map_err(|e| format!("读取参考音频目录失败 {}: {}", current_dir.display(), e))?;
    for entry in entries {
        let entry = entry.map_err(|e| format!("读取参考音频失败: {}", e))?;
        let path = entry.path();
        if path.is_dir() {
            collect_voice_refs_inner(root, library_root, &path, items)?;
            continue;
        }
        if !is_voice_file(&path) {
            continue;
        }
        let rel_from_library = path.strip_prefix(library_root).unwrap_or(path.as_path());
        let rel_name = strip_extension(rel_from_library).replace('\\', "/");
        let rel_from_root = path.strip_prefix(root).unwrap_or(path.as_path());
        let relative_path = rel_from_root.to_string_lossy().replace('\\', "/");
        let subdir = rel_from_library
            .components()
            .next()
            .map(|component| component.as_os_str().to_string_lossy().to_string())
            .unwrap_or_default();
        items.push(VoiceRefItem {
            name: rel_name,
            relative_path,
            subdir,
        });
    }
    Ok(())
}

fn strip_extension(path: &Path) -> String {
    let text = path.to_string_lossy();
    match path.extension().and_then(|ext| ext.to_str()) {
        Some(ext) if !ext.is_empty() => {
            let suffix_len = ext.len() + 1;
            text[..text.len().saturating_sub(suffix_len)].to_string()
        }
        _ => text.to_string(),
    }
}

fn resolve_voice_ref(root: &Path, ref_path: &str) -> Option<PathBuf> {
    let raw = ref_path.trim();
    if raw.is_empty() {
        return None;
    }
    let normalized: String = raw
        .chars()
        .map(|ch| {
            if ch == '/' || ch == '\\' {
                std::path::MAIN_SEPARATOR
            } else {
                ch
            }
        })
        .collect();
    let raw_path = PathBuf::from(&normalized);

    let mut candidates = Vec::new();
    candidates.push(PathBuf::from(raw));
    candidates.push(root.join(&raw_path));
    for library_root in voice_library_roots(root) {
        candidates.push(library_root.join(&raw_path));
    }

    for candidate in candidates {
        if candidate.is_file() {
            return Some(candidate);
        }
        if candidate.extension().is_none() {
            for extension in voice_extensions() {
                let mut with_ext = candidate.clone();
                with_ext.set_extension(extension);
                if with_ext.is_file() {
                    return Some(with_ext);
                }
            }
        }
    }
    None
}

fn voice_library_roots(root: &Path) -> Vec<PathBuf> {
    let mut roots = Vec::new();
    for candidate in [
        root.join("prompts").join("library"),
        root.join("vllm").join("prompts").join("library"),
        root.join("fast6g").join("prompts").join("library"),
    ] {
        add_unique_existing_dir(&mut roots, candidate);
    }
    roots
}

fn add_unique_existing_dir(roots: &mut Vec<PathBuf>, candidate: PathBuf) {
    if !candidate.is_dir() {
        return;
    }
    let canonical = candidate.canonicalize().unwrap_or(candidate);
    if !roots.iter().any(|item| item == &canonical) {
        roots.push(canonical);
    }
}

fn is_voice_file(path: &Path) -> bool {
    path.extension()
        .and_then(|ext| ext.to_str())
        .map(|ext| {
            voice_extensions()
                .iter()
                .any(|item| ext.eq_ignore_ascii_case(item))
        })
        .unwrap_or(false)
}

fn voice_extensions() -> &'static [&'static str] {
    &["wav", "mp3", "flac", "ogg", "m4a"]
}

fn media_type_for_voice_path(path: &Path) -> &'static str {
    match path
        .extension()
        .and_then(|ext| ext.to_str())
        .map(|ext| ext.to_ascii_lowercase())
        .as_deref()
    {
        Some("mp3") => "audio/mpeg",
        Some("flac") => "audio/flac",
        Some("ogg") => "audio/ogg",
        Some("m4a") => "audio/mp4",
        _ => "audio/wav",
    }
}

fn read_json(path: &Path) -> Result<Value, String> {
    let content =
        fs::read_to_string(path).map_err(|e| format!("读取 {} 失败: {}", path.display(), e))?;
    serde_json::from_str(&content).map_err(|e| format!("解析 {} 失败: {}", path.display(), e))
}

fn active_profile_source(profile_dir: &Path) -> Option<String> {
    let active_path = profile_dir.join("active.json");
    let value = read_json(&active_path).ok()?;
    value
        .get("appliedFrom")
        .and_then(Value::as_str)
        .map(str::to_string)
}

fn normalize_version(version: &str) -> String {
    if version.eq_ignore_ascii_case("fast6g") {
        "fast6g".to_string()
    } else {
        "vllm".to_string()
    }
}

fn collect_generation_json_candidates(
    cache_dir: &Path,
) -> Result<Vec<(PathBuf, Option<std::time::SystemTime>, bool)>, String> {
    let mut candidates = Vec::new();
    collect_generation_json_candidates_inner(cache_dir, cache_dir, &mut candidates)?;
    Ok(candidates)
}

fn collect_generation_json_candidates_inner(
    cache_dir: &Path,
    current_dir: &Path,
    candidates: &mut Vec<(PathBuf, Option<std::time::SystemTime>, bool)>,
) -> Result<(), String> {
    for entry in fs::read_dir(current_dir)
        .map_err(|e| format!("读取生成记录目录失败 {}: {}", current_dir.display(), e))?
    {
        let entry = entry.map_err(|e| format!("读取生成记录失败: {}", e))?;
        let path = entry.path();
        if path.is_dir() {
            collect_generation_json_candidates_inner(cache_dir, &path, candidates)?;
            continue;
        }
        let is_json = path
            .extension()
            .and_then(|s| s.to_str())
            .map(|ext| ext.eq_ignore_ascii_case("json"))
            .unwrap_or(false);
        if !path.is_file() || !is_json {
            continue;
        }
        let metadata = entry
            .metadata()
            .map_err(|e| format!("读取生成记录元数据失败 {}: {}", path.display(), e))?;
        let is_top_level = path
            .parent()
            .map(|parent| parent == cache_dir)
            .unwrap_or(false);
        candidates.push((path, metadata.modified().ok(), is_top_level));
    }
    Ok(())
}

fn recent_generation_from_json(
    version: &str,
    cache_dir: &Path,
    path: &Path,
    modified_time: Option<std::time::SystemTime>,
) -> Result<RecentGenerationItem, String> {
    let value = read_json(path)?;
    let metrics = value.get("metrics").unwrap_or(&Value::Null);
    let key = value
        .get("key")
        .and_then(Value::as_str)
        .map(str::to_string)
        .or_else(|| {
            path.file_stem()
                .and_then(|s| s.to_str())
                .map(str::to_string)
        })
        .ok_or_else(|| format!("生成记录文件名无效: {}", path.display()))?;

    let (audio_format, audio_bytes) = generation_audio_info(cache_dir, &key, path, &value);
    let status = value_string(metrics, "state")
        .or_else(|| value_string(metrics, "phase"))
        .unwrap_or_else(|| "done".to_string());
    let role = generation_display_role(&value);
    let first_text = role
        .as_deref()
        .and_then(|role| first_segment_text_for_role(&value, role))
        .or_else(|| first_segment_string(&value, "text"));

    Ok(RecentGenerationItem {
        version: version.to_string(),
        key,
        created_at: value_string(&value, "created_at")
            .or_else(|| readable_cache_created_at(&value)),
        modified: modified_time.and_then(system_time_to_rfc3339),
        audio_format,
        audio_bytes,
        duration_s: value_f64(&value, "duration_s")
            .or_else(|| value_f64(metrics, "audio_duration_s")),
        wall_s: value_f64(metrics, "total_wall_s").or_else(|| value_f64(metrics, "infer_total_s")),
        rtf: value_f64(metrics, "rtf"),
        wall_rtf: value_f64(metrics, "wall_rtf"),
        first_pcm_s: value_f64(metrics, "first_pcm_s"),
        queue_wait_s: value_f64(metrics, "queue_wait_s"),
        llm_parse_s: value_f64(metrics, "llm_parse_s")
            .or_else(|| value_f64(metrics, "llm_elapsed_s")),
        gpt_gen_s: value_f64(metrics, "gpt_gen_s"),
        s2mel_s: value_f64(metrics, "s2mel_s"),
        bigvgan_s: value_f64(metrics, "bigvgan_s"),
        cache_write_s: value_f64(metrics, "cache_write_s"),
        segments_done: value_u64(metrics, "segments_done")
            .or_else(|| array_len_u64(value.get("segments_meta"))),
        segments_total: value_u64(metrics, "segments_total")
            .or_else(|| array_len_u64(value.get("segments_plan")))
            .or_else(|| array_len_u64(value.get("segments_meta"))),
        parse_mode: value_string(metrics, "parse_mode"),
        performance_mode: value_string(metrics, "performance_mode"),
        role,
        first_text,
        segments: generation_segment_summaries(&value),
        status,
    })
}

fn generation_audio_info(
    cache_dir: &Path,
    key: &str,
    metadata_path: &Path,
    value: &Value,
) -> (Option<String>, Option<u64>) {
    let mut extensions = Vec::new();
    if let Some(ext) = value.get("audio_ext").and_then(Value::as_str) {
        extensions.push(ext.trim_start_matches('.').to_ascii_lowercase());
    }
    if let Some(format) = value.get("audio_format").and_then(Value::as_str) {
        extensions.push(format.trim_start_matches('.').to_ascii_lowercase());
    }
    extensions.extend(["mp3", "wav", "flac", "ogg", "m4a"].map(str::to_string));
    extensions.dedup();

    let known_format = extensions.first().cloned();
    for ext in extensions {
        let candidates = [
            cache_dir.join(format!("{}.{}", key, ext)),
            metadata_path.with_extension(&ext),
        ];
        for candidate in candidates {
            if let Ok(metadata) = fs::metadata(&candidate) {
                return (Some(ext), Some(metadata.len()));
            }
        }
    }

    (known_format, None)
}

fn value_string(value: &Value, key: &str) -> Option<String> {
    value
        .get(key)
        .and_then(Value::as_str)
        .filter(|text| !text.is_empty())
        .map(str::to_string)
}

fn value_f64(value: &Value, key: &str) -> Option<f64> {
    value.get(key).and_then(Value::as_f64)
}

fn value_u64(value: &Value, key: &str) -> Option<u64> {
    value.get(key).and_then(Value::as_u64)
}

fn value_bool(value: &Value, key: &str) -> Option<bool> {
    value.get(key).and_then(Value::as_bool)
}

fn array_len_u64(value: Option<&Value>) -> Option<u64> {
    value
        .and_then(Value::as_array)
        .map(|items| items.len() as u64)
}

fn first_segment_string(value: &Value, key: &str) -> Option<String> {
    segment_items(value)
        .and_then(|items| items.first())
        .and_then(|item| value_string(item, key))
}

fn first_segment_text_for_role(value: &Value, role: &str) -> Option<String> {
    if role.contains(" / ") {
        return None;
    }
    segment_items(value)?
        .iter()
        .find(|item| value_string(item, "role").as_deref() == Some(role))
        .and_then(|item| value_string(item, "text"))
}

fn segment_items(value: &Value) -> Option<&Vec<Value>> {
    let metrics = value.get("metrics").unwrap_or(&Value::Null);
    [
        metrics.get("segments"),
        value.get("segments_meta"),
        value.get("segments_plan"),
    ]
    .iter()
    .find_map(|section| section.and_then(Value::as_array))
}

fn generation_segment_summaries(value: &Value) -> Vec<GenerationSegmentSummary> {
    let Some(items) = segment_items(value) else {
        return Vec::new();
    };
    items
        .iter()
        .enumerate()
        .map(|(index, item)| GenerationSegmentSummary {
            index: value_u64(item, "idx").unwrap_or(index as u64),
            role: value_string(item, "role"),
            text: value_string(item, "text"),
            style: value_string(item, "style"),
            style_alpha: value_f64(item, "style_alpha"),
            start_s: value_f64(item, "start_s"),
            duration_s: value_f64(item, "duration_s"),
            wall_s: value_f64(item, "wall_s"),
            rtf: value_f64(item, "rtf"),
            infer_rtf: value_f64(item, "infer_rtf"),
            gpt_gen_s: value_f64(item, "gpt_gen_s"),
            s2mel_s: value_f64(item, "s2mel_s"),
            bigvgan_s: value_f64(item, "bigvgan_s"),
            spk_condition_s: value_f64(item, "spk_condition_s"),
            emo_condition_s: value_f64(item, "emo_condition_s"),
            text_len: value_u64(item, "text_len"),
            text_token_count: value_u64(item, "text_token_count"),
            spk_cache_hit: value_bool(item, "spk_cache_hit"),
            emo_cache_hit: value_bool(item, "emo_cache_hit"),
            uses_style_audio: value_bool(item, "uses_style_audio"),
        })
        .collect()
}

fn generation_display_role(value: &Value) -> Option<String> {
    let roles = readable_cache_roles(value);
    if !roles.is_empty() {
        return Some(roles.join(" / "));
    }
    first_non_narrator_segment_role(value).or_else(|| first_segment_string(value, "role"))
}

fn first_non_narrator_segment_role(value: &Value) -> Option<String> {
    segment_items(value)?
        .iter()
        .filter_map(|item| value_string(item, "role"))
        .find(|role| role != "旁白")
}

fn readable_cache_roles(value: &Value) -> Vec<String> {
    let mut roles = Vec::new();
    let Some(readable) = value.get("readable_cache") else {
        return roles;
    };
    match readable {
        Value::Array(items) => {
            for item in items {
                push_unique_role(&mut roles, role_from_readable_cache_item(item));
            }
        }
        Value::Object(_) => push_unique_role(&mut roles, role_from_readable_cache_item(readable)),
        _ => {}
    }
    roles
}

fn push_unique_role(roles: &mut Vec<String>, role: Option<String>) {
    let Some(role) = role
        .map(|text| text.trim().to_string())
        .filter(|text| !text.is_empty())
    else {
        return;
    };
    if !roles.iter().any(|item| item == &role) {
        roles.push(role);
    }
}

fn role_from_readable_cache_item(item: &Value) -> Option<String> {
    value_string(item, "role").or_else(|| {
        ["path", "metadata_path"]
            .iter()
            .filter_map(|key| item.get(*key).and_then(Value::as_str))
            .find_map(role_from_by_role_path)
    })
}

fn readable_cache_created_at(value: &Value) -> Option<String> {
    let readable = value.get("readable_cache")?;
    match readable {
        Value::Array(items) => items
            .iter()
            .filter_map(|item| value_string(item, "created_at"))
            .next(),
        Value::Object(_) => value_string(readable, "created_at"),
        _ => None,
    }
}

fn role_from_by_role_path(path: &str) -> Option<String> {
    let parts: Vec<&str> = path
        .split(|ch| ch == '\\' || ch == '/')
        .filter(|part| !part.is_empty())
        .collect();
    parts
        .windows(2)
        .find(|pair| pair[0].eq_ignore_ascii_case("by_role"))
        .map(|pair| pair[1].to_string())
}

fn format_ratio(ratio: f32) -> String {
    let mut text = format!("{:.3}", ratio);
    while text.contains('.') && text.ends_with('0') {
        text.pop();
    }
    if text.ends_with('.') {
        text.pop();
    }
    text
}

fn command_first_line(program: &str, args: &[&str]) -> Option<String> {
    let output = Command::new(program).args(args).output().ok()?;
    if !output.status.success() {
        return None;
    }
    let stdout = String::from_utf8_lossy(&output.stdout);
    let stderr = String::from_utf8_lossy(&output.stderr);
    stdout
        .lines()
        .chain(stderr.lines())
        .map(str::trim)
        .find(|line| !line.is_empty())
        .map(str::to_string)
}

fn check_port_text(port: u16) -> String {
    if TcpListener::bind(("127.0.0.1", port)).is_ok() {
        format!("{} 可用", port)
    } else {
        let pids = listening_pids(port);
        if pids.is_empty() {
            format!("{} 已被占用或服务运行中", port)
        } else {
            format!("{} 已监听，PID: {}", port, pids.join(", "))
        }
    }
}

fn build_environment_report() -> Result<EnvironmentReport, String> {
    let root = leon_root()?;
    let mut checks = Vec::new();

    let static_ok = root.join("static").join("tavo.js").is_file();
    let script_ok = root.join("scripts").join("restart-leon-api.ps1").is_file();
    let profiles_ok = root.join("config").join("profiles").is_dir();
    let voices_ok = root.join("prompts").join("library").is_dir();
    let common_ok = static_ok && script_ok && profiles_ok && voices_ok;
    checks.push(env_check(
        "common",
        "Common 包",
        if common_ok { "ok" } else { "error" },
        if common_ok {
            "公共文件完整"
        } else {
            "公共包不完整"
        },
        format!(
            "static/tavo.js={} · scripts/restart-leon-api.ps1={} · config/profiles={} · prompts/library={}",
            yes_no(static_ok),
            yes_no(script_ok),
            yes_no(profiles_ok),
            yes_no(voices_ok)
        ),
        false,
    ));

    let profile_status = active_profile_status(&root);
    checks.push(profile_status.check);

    let gpu = gpu_status();
    checks.push(gpu.check);

    let port = port_status(&root, 9880);
    checks.push(port.check);

    let stale_gpu_count = project_gpu_runtime_process_count(&root);
    checks.push(env_check(
        "stale_gpu",
        "LEON GPU 残留",
        if stale_gpu_count > 0 { "warn" } else { "ok" },
        if stale_gpu_count > 0 {
            "发现可清理的残留 worker"
        } else {
            "没有 LEON GPU 残留"
        },
        if stale_gpu_count > 0 {
            format!(
                "检测到 {} 个 LEON indextts2runtime GPU 进程。",
                stale_gpu_count
            )
        } else {
            "nvidia-smi 中未发现 LEON indextts2runtime GPU 进程。".to_string()
        },
        stale_gpu_count > 0,
    ));

    let vllm = engine_status(&root, "vllm", gpu.free_mib, 9000);
    let fast6g = engine_status(&root, "fast6g", gpu.free_mib, 5500);
    let any_engine_installed = vllm.installed || fast6g.installed;
    let can_start_vllm = common_ok
        && profile_status.ready
        && port.ready
        && gpu.available
        && vllm.ready
        && gpu.free_mib.unwrap_or(0) >= 9000;
    let can_start_fast6g = common_ok
        && profile_status.ready
        && port.ready
        && gpu.available
        && fast6g.ready
        && gpu.free_mib.unwrap_or(0) >= 5500;

    checks.push(vllm.check);
    checks.push(fast6g.check);
    checks.push(env_check(
        "engine_choice",
        "启动组合",
        if any_engine_installed { "ok" } else { "error" },
        if any_engine_installed {
            "至少安装了一个 engine"
        } else {
            "缺少 engine 包"
        },
        "common 必装；vllm 和 fast6g 至少解压一个到同级目录。".to_string(),
        false,
    ));

    let has_error = checks.iter().any(|check| check.status == "error");
    let has_warn = checks.iter().any(|check| check.status == "warn");
    let fixable_count = checks.iter().filter(|check| check.fixable).count();
    let status = if has_error {
        "error"
    } else if has_warn {
        "warn"
    } else {
        "ok"
    }
    .to_string();
    let summary = if can_start_vllm && can_start_fast6g {
        "vLLM 和 6G 都具备启动条件".to_string()
    } else if can_start_vllm {
        "vLLM 具备启动条件；6G 未就绪或显存不足".to_string()
    } else if can_start_fast6g {
        "6G 具备启动条件；vLLM 未就绪或显存不足".to_string()
    } else if fixable_count > 0 {
        "存在可自动修复项，修复后再检测".to_string()
    } else {
        "当前环境还不能保证一键启动".to_string()
    };

    Ok(EnvironmentReport {
        status,
        summary,
        root: root.display().to_string(),
        can_start_vllm,
        can_start_fast6g,
        fixable_count,
        checks,
    })
}

struct CheckState {
    check: EnvironmentCheck,
    ready: bool,
}

struct GpuState {
    check: EnvironmentCheck,
    available: bool,
    free_mib: Option<u64>,
}

struct EngineState {
    check: EnvironmentCheck,
    installed: bool,
    ready: bool,
}

fn active_profile_status(root: &Path) -> CheckState {
    let profile_dir = root.join("config").join("profiles");
    let active = profile_dir.join("active.json");
    if active.is_file() {
        match read_json(&active).and_then(|value| validate_profile_value(&value).map(|_| value)) {
            Ok(_) => CheckState {
                check: env_check(
                    "active_profile",
                    "Active Profile",
                    "ok",
                    "active.json 可用",
                    active.display().to_string(),
                    false,
                ),
                ready: true,
            },
            Err(error) => CheckState {
                check: env_check(
                    "active_profile",
                    "Active Profile",
                    "error",
                    "active.json 无效",
                    error,
                    false,
                ),
                ready: false,
            },
        }
    } else {
        let template = preferred_profile_template(&profile_dir).ok();
        CheckState {
            check: env_check(
                "active_profile",
                "Active Profile",
                "error",
                "缺少 active.json",
                template
                    .map(|path| format!("可从模板创建: {}", path.display()))
                    .unwrap_or_else(|| {
                        "缺少 leon-default.json，无法自动创建 active.json。".to_string()
                    }),
                profile_dir.join("leon-default.json").is_file(),
            ),
            ready: false,
        }
    }
}

fn gpu_status() -> GpuState {
    let Some((name, total_mib, free_mib)) = query_gpu_summary() else {
        return GpuState {
            check: env_check(
                "gpu",
                "NVIDIA GPU",
                "error",
                "未检测到 nvidia-smi",
                "需要安装可用的 NVIDIA 驱动；此项不能由 LEON 自动修复。".to_string(),
                false,
            ),
            available: false,
            free_mib: None,
        };
    };
    let status = if free_mib < 5500 { "warn" } else { "ok" };
    GpuState {
        check: env_check(
            "gpu",
            "NVIDIA GPU",
            status,
            if free_mib < 5500 {
                "GPU 空闲显存偏低"
            } else {
                "GPU 可用"
            },
            format!("{} · total={} MiB · free={} MiB", name, total_mib, free_mib),
            false,
        ),
        available: true,
        free_mib: Some(free_mib),
    }
}

fn query_gpu_summary() -> Option<(String, u64, u64)> {
    let mut command = Command::new("nvidia-smi");
    command.args([
        "--query-gpu=name,memory.total,memory.free",
        "--format=csv,noheader,nounits",
    ]);
    hide_child_window(&mut command);
    let output = command.output().ok()?;
    if !output.status.success() {
        return None;
    }
    let text = String::from_utf8_lossy(&output.stdout);
    let first = text.lines().find(|line| !line.trim().is_empty())?;
    let parts: Vec<&str> = first.split(',').map(str::trim).collect();
    if parts.len() < 3 {
        return None;
    }
    Some((
        parts[0].to_string(),
        parts[1].parse::<u64>().ok()?,
        parts[2].parse::<u64>().ok()?,
    ))
}

fn port_status(root: &Path, port: u16) -> CheckState {
    let pids = listening_pids(port);
    if pids.is_empty() {
        return CheckState {
            check: env_check(
                "port",
                "API 端口 9880",
                "ok",
                "端口可用",
                "127.0.0.1:9880 未被监听。".to_string(),
                false,
            ),
            ready: true,
        };
    }
    let mut project = Vec::new();
    let mut foreign = Vec::new();
    for pid_text in pids {
        match pid_text.parse::<u32>() {
            Ok(pid) if project_process_matches_root(pid, root) => project.push(pid),
            Ok(pid) => foreign.push(pid),
            Err(_) => {}
        }
    }
    if !foreign.is_empty() {
        CheckState {
            check: env_check(
                "port",
                "API 端口 9880",
                "error",
                "端口被非 LEON 进程占用",
                format!("占用 PID: {:?}", foreign),
                false,
            ),
            ready: false,
        }
    } else {
        CheckState {
            check: env_check(
                "port",
                "API 端口 9880",
                "warn",
                "发现 LEON 端口残留",
                format!("可清理 PID: {:?}", project),
                true,
            ),
            ready: true,
        }
    }
}

fn engine_status(
    root: &Path,
    engine: &str,
    free_mib: Option<u64>,
    min_free_mib: u64,
) -> EngineState {
    let engine_root = root.join(engine);
    if !engine_root.is_dir() {
        return EngineState {
            check: env_check(
                &format!("engine_{}", engine),
                &format!("{} engine", engine),
                "warn",
                "未安装",
                format!("未找到目录: {}", engine_root.display()),
                false,
            ),
            installed: false,
            ready: false,
        };
    }

    let runtime_ok = engine_root
        .join("indextts2runtime")
        .join("python.exe")
        .is_file();
    let api_ok = engine_root.join("indextts2_api.py").is_file();
    let checkpoint_files = ["gpt.pth", "s2mel.pth", "bpe.model", "config.yaml"];
    let missing_checkpoints: Vec<&str> = checkpoint_files
        .iter()
        .copied()
        .filter(|name| !engine_root.join("checkpoints").join(name).is_file())
        .collect();
    let files_ok = runtime_ok && api_ok && missing_checkpoints.is_empty();
    let free_ok = free_mib.map(|value| value >= min_free_mib).unwrap_or(false);
    let ready = files_ok && free_ok;
    let status = if !files_ok {
        "error"
    } else if !free_ok {
        "warn"
    } else {
        "ok"
    };
    let detail = format!(
        "runtime={} · api={} · missing_checkpoints={} · required_free={} MiB · current_free={}",
        yes_no(runtime_ok),
        yes_no(api_ok),
        if missing_checkpoints.is_empty() {
            "none".to_string()
        } else {
            missing_checkpoints.join(",")
        },
        min_free_mib,
        free_mib
            .map(|value| format!("{} MiB", value))
            .unwrap_or_else(|| "unknown".to_string())
    );
    EngineState {
        check: env_check(
            &format!("engine_{}", engine),
            &format!("{} engine", engine),
            status,
            if ready {
                "具备启动条件"
            } else if files_ok {
                "文件完整但显存不足"
            } else {
                "engine 包不完整"
            },
            detail,
            false,
        ),
        installed: true,
        ready: files_ok,
    }
}

fn ensure_active_profile(root: &Path) -> Result<Option<String>, String> {
    let profile_dir = root.join("config").join("profiles");
    let active = profile_dir.join("active.json");
    if active.is_file() {
        return Ok(None);
    }
    let template = profile_dir.join("leon-default.json");
    if !template.is_file() {
        return Err("缺少 leon-default.json，无法创建 active.json".to_string());
    }
    fs::copy(&template, &active).map_err(|e| format!("创建 active.json 失败: {}", e))?;
    Ok(Some("已从 leon-default.json 创建 active.json".to_string()))
}

fn release_runtime_dirs(root: &Path) -> Vec<PathBuf> {
    let mut dirs = vec![
        root.join("logs").join("vllm"),
        root.join("logs").join("fast6g"),
    ];
    for engine in ["vllm", "fast6g"] {
        let engine_root = root.join(engine);
        if engine_root.is_dir() {
            dirs.push(engine_root.join("outputs").join("cache"));
            dirs.push(engine_root.join("outputs").join("tmp"));
        }
    }
    dirs
}

fn project_gpu_runtime_process_count(root: &Path) -> usize {
    gpu_process_pids()
        .into_iter()
        .filter(|pid| project_runtime_python_matches_root(*pid, root))
        .count()
}

fn env_check(
    id: &str,
    title: &str,
    status: &str,
    summary: &str,
    detail: String,
    fixable: bool,
) -> EnvironmentCheck {
    EnvironmentCheck {
        id: id.to_string(),
        title: title.to_string(),
        status: status.to_string(),
        summary: summary.to_string(),
        detail,
        fixable,
    }
}

fn yes_no(value: bool) -> &'static str {
    if value {
        "ok"
    } else {
        "missing"
    }
}

fn listening_pids(port: u16) -> Vec<String> {
    let output = Command::new("netstat").args(["-ano"]).output();
    let Ok(output) = output else {
        return Vec::new();
    };
    let text = String::from_utf8_lossy(&output.stdout);
    let needle = format!(":{}", port);
    let mut pids = Vec::new();
    for line in text.lines() {
        if line.contains(&needle) && line.contains("LISTENING") {
            if let Some(pid) = line.split_whitespace().last() {
                if !pids.iter().any(|existing| existing == pid) {
                    pids.push(pid.to_string());
                }
            }
        }
    }
    pids
}

fn cleanup_service_on_exit(state: &AppState) {
    let _ = request_api_exit_blocking();
    wait_for_api_port_closed(Duration::from_millis(1500));
    let _ = cleanup_service_wrapper(state);
    let _ = kill_project_api_listeners(9880);
    let _ = kill_project_gpu_runtime_processes();
}

fn request_api_exit_blocking() -> Result<(), String> {
    let addr: SocketAddr = "127.0.0.1:9880"
        .parse()
        .map_err(|e| format!("解析 API 地址失败: {}", e))?;
    let mut stream = TcpStream::connect_timeout(&addr, Duration::from_millis(700))
        .map_err(|e| format!("连接 API 退出接口失败: {}", e))?;
    stream
        .set_write_timeout(Some(Duration::from_millis(700)))
        .map_err(|e| format!("设置 API 退出写超时失败: {}", e))?;
    stream
        .write_all(b"GET /control?command=exit HTTP/1.1\r\nHost: 127.0.0.1:9880\r\nConnection: close\r\n\r\n")
        .map_err(|e| format!("发送 API 退出请求失败: {}", e))
}

fn wait_for_api_port_closed(timeout: Duration) -> bool {
    let addr: SocketAddr = match "127.0.0.1:9880".parse() {
        Ok(addr) => addr,
        Err(_) => return false,
    };
    let started = std::time::Instant::now();
    while started.elapsed() < timeout {
        if TcpStream::connect_timeout(&addr, Duration::from_millis(150)).is_err() {
            return true;
        }
        std::thread::sleep(Duration::from_millis(150));
    }
    false
}

fn kill_project_api_listeners(port: u16) -> Result<usize, String> {
    let root = leon_root()?;
    let mut killed = 0usize;
    for pid_text in listening_pids(port) {
        let Ok(pid) = pid_text.parse::<u32>() else {
            continue;
        };
        if project_process_matches_root(pid, &root) {
            kill_process_tree(pid);
            killed += 1;
        }
    }
    Ok(killed)
}

fn kill_project_gpu_runtime_processes() -> Result<usize, String> {
    let root = leon_root()?;
    let mut killed = 0usize;
    for pid in gpu_process_pids() {
        if project_runtime_python_matches_root(pid, &root) {
            kill_process_tree(pid);
            killed += 1;
        }
    }
    Ok(killed)
}

fn gpu_process_pids() -> Vec<u32> {
    let mut command = Command::new("nvidia-smi");
    command.args(["--query-compute-apps=pid", "--format=csv,noheader,nounits"]);
    hide_child_window(&mut command);
    let Ok(output) = command.output() else {
        return Vec::new();
    };
    if !output.status.success() {
        return Vec::new();
    }

    let mut pids = Vec::new();
    for line in String::from_utf8_lossy(&output.stdout).lines() {
        let Some(first) = line.split([',', ' ']).find(|part| !part.trim().is_empty()) else {
            continue;
        };
        let Ok(pid) = first.trim().parse::<u32>() else {
            continue;
        };
        if !pids.contains(&pid) {
            pids.push(pid);
        }
    }
    pids
}

fn project_process_matches_root(pid: u32, root: &Path) -> bool {
    let Some(command_line) = process_command_line(pid) else {
        return false;
    };
    let root_text = shell_path(root).to_ascii_lowercase();
    command_line.to_ascii_lowercase().contains(&root_text)
}

fn project_runtime_python_matches_root(pid: u32, root: &Path) -> bool {
    let Some(command_line) = process_command_line(pid) else {
        return false;
    };
    let root_text = normalize_windows_path_text(&shell_path(root));
    let command_text = normalize_windows_path_text(&command_line);
    command_text.contains(&root_text) && command_text.contains(r"indextts2runtime\python.exe")
}

fn normalize_windows_path_text(text: &str) -> String {
    text.replace('/', "\\").to_ascii_lowercase()
}

fn process_command_line(pid: u32) -> Option<String> {
    let script = format!(
        "$p=Get-CimInstance Win32_Process -Filter \"ProcessId = {}\"; if ($p) {{ $p.CommandLine }}",
        pid
    );
    let mut command = Command::new("powershell.exe");
    command.arg("-NoProfile").arg("-Command").arg(&script);
    hide_child_window(&mut command);
    let output = command.output().ok()?;
    if !output.status.success() {
        return None;
    }
    let text = String::from_utf8_lossy(&output.stdout).trim().to_string();
    if text.is_empty() {
        None
    } else {
        Some(text)
    }
}

fn is_log_file(path: &Path) -> bool {
    matches!(
        path.extension().and_then(|s| s.to_str()),
        Some("log" | "err" | "txt")
    )
}

fn is_launcher_log_file(path: &Path) -> bool {
    path.file_name()
        .and_then(|s| s.to_str())
        .map(|name| name.starts_with("launcher-") && name.ends_with(".log"))
        .unwrap_or(false)
}

fn modified_is_close_to_latest(
    candidate: Option<std::time::SystemTime>,
    latest: Option<std::time::SystemTime>,
    tolerance: Duration,
) -> bool {
    match (candidate, latest) {
        (Some(candidate), Some(latest)) => {
            candidate >= latest
                || latest
                    .duration_since(candidate)
                    .map(|elapsed| elapsed <= tolerance)
                    .unwrap_or(true)
        }
        _ => true,
    }
}

fn launcher_log_path(root: &Path, version: &str) -> Result<PathBuf, String> {
    let log_dir = root.join("logs").join(version);
    fs::create_dir_all(&log_dir)
        .map_err(|e| format!("创建日志目录失败 {}: {}", log_dir.display(), e))?;
    Ok(log_dir.join(format!("launcher-{}.log", Local::now().format("%Y%m%d"))))
}

fn append_launcher_log(path: &Path, level: &str, message: &str) -> Result<(), String> {
    let mut file = fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(path)
        .map_err(|e| format!("打开启动器日志失败 {}: {}", path.display(), e))?;
    writeln!(
        file,
        "[{}] [{}] {}",
        Local::now().format("%H:%M:%S"),
        level,
        message
    )
    .map_err(|e| format!("写入启动器日志失败 {}: {}", path.display(), e))
}

fn read_tail_lines(path: &Path, max_lines: usize) -> Result<Vec<String>, String> {
    let bytes = fs::read(path).map_err(|e| format!("读取日志失败 {}: {}", path.display(), e))?;
    let mut lines = Vec::new();
    for raw_line in bytes.split(|byte| *byte == b'\n' || *byte == b'\r') {
        if raw_line.is_empty() {
            continue;
        }
        lines.push(decode_log_bytes(raw_line));
        if lines.len() > max_lines {
            lines.remove(0);
        }
    }
    Ok(lines)
}

fn decode_log_bytes(bytes: &[u8]) -> String {
    match std::str::from_utf8(bytes) {
        Ok(text) => text.to_string(),
        Err(_) => {
            let (text, _, _) = encoding_rs::GBK.decode(bytes);
            text.into_owned()
        }
    }
}

fn cleanup_service_wrapper(state: &AppState) -> Result<bool, String> {
    let mut guard = state
        .service_process
        .lock()
        .map_err(|_| "服务状态锁已损坏".to_string())?;
    let Some(mut child) = guard.take() else {
        return Ok(false);
    };
    if child
        .try_wait()
        .map_err(|e| format!("检查启动进程失败: {}", e))?
        .is_none()
    {
        kill_process_tree(child.id());
        let _ = child.kill();
        let _ = child.wait();
        return Ok(true);
    }
    Ok(false)
}

fn kill_process_tree(pid: u32) {
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x08000000;
        let _ = Command::new("taskkill")
            .args(["/PID", &pid.to_string(), "/T", "/F"])
            .creation_flags(CREATE_NO_WINDOW)
            .output();
    }

    #[cfg(not(windows))]
    {
        let _ = pid;
    }
}

fn hide_child_window(command: &mut Command) {
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x08000000;
        command.creation_flags(CREATE_NO_WINDOW);
    }

    #[cfg(not(windows))]
    {
        let _ = command;
    }
}

fn system_time_to_rfc3339(time: std::time::SystemTime) -> Option<String> {
    let datetime: chrono::DateTime<Utc> = time.into();
    Some(datetime.to_rfc3339())
}

#[tauri::command]
async fn upload_voice(name: String, data: Vec<u8>, ext: String) -> Result<String, String> {
    let client = reqwest::Client::new();
    let form = reqwest::multipart::Form::new()
        .text("name", name)
        .text("ext", ext)
        .part("file", reqwest::multipart::Part::bytes(data));

    let resp = client
        .post(format!("{}/voice/upload", API_BASE))
        .multipart(form)
        .send()
        .await
        .map_err(|e| format!("上传音色失败: {}", e))?;

    if !resp.status().is_success() {
        return Err(format!("上传音色失败: HTTP {}", resp.status()));
    }

    let result: Value = resp
        .json()
        .await
        .map_err(|e| format!("解析响应失败: {}", e))?;
    Ok(result
        .get("path")
        .and_then(Value::as_str)
        .unwrap_or("")
        .to_string())
}

#[tauri::command]
async fn delete_voice(name: String) -> Result<String, String> {
    let client = reqwest::Client::new();
    let resp = client
        .delete(format!("{}/voice/{}", API_BASE, urlencoding::encode(&name)))
        .send()
        .await
        .map_err(|e| format!("删除音色失败: {}", e))?;

    if !resp.status().is_success() {
        return Err(format!("删除音色失败: HTTP {}", resp.status()));
    }

    Ok(format!("已删除音色: {}", name))
}

#[tauri::command]
async fn move_voice(name: String, new_group: String) -> Result<String, String> {
    let old_parts: Vec<&str> = name.rsplitn(2, '/').collect();
    let base_name = old_parts[0];
    let new_name = if new_group.is_empty() {
        base_name.to_string()
    } else {
        format!("{}/{}", new_group.trim_matches('/'), base_name)
    };

    let client = reqwest::Client::new();
    let body = serde_json::json!({
        "old_name": name,
        "new_name": new_name
    });

    let resp = client
        .post(format!("{}/voice/move", API_BASE))
        .json(&body)
        .send()
        .await
        .map_err(|e| format!("移动音色失败: {}", e))?;

    if !resp.status().is_success() {
        return Err(format!("移动音色失败: HTTP {}", resp.status()));
    }

    Ok(format!("已移动到: {}", new_name))
}

#[tauri::command]
async fn test_voice_generation(
    voice: String,
    style: String,
    text: String,
    profile: String,
) -> Result<String, String> {
    let client = reqwest::Client::new();
    let body = serde_json::json!({
        "voice": voice,
        "style": style,
        "text": text,
        "profile": profile,
        "mode": "test"
    });

    let resp = client
        .post(format!("{}/test_generate", API_BASE))
        .json(&body)
        .send()
        .await
        .map_err(|e| format!("测试生成失败: {}", e))?;

    if !resp.status().is_success() {
        let status = resp.status();
        let error_text = resp.text().await.unwrap_or_default();
        return Err(format!("测试生成失败: HTTP {} - {}", status, error_text));
    }

    let bytes = resp
        .bytes()
        .await
        .map_err(|e| format!("读取音频失败: {}", e))?;
    let encoded = general_purpose::STANDARD.encode(&bytes);
    Ok(format!("data:audio/wav;base64,{}", encoded))
}
