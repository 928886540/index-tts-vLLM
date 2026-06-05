$ErrorActionPreference = "Continue"

Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing

[System.Windows.Forms.Application]::EnableVisualStyles()

$Script:LauncherScriptPath = if ($env:LEON_LAUNCHER_SCRIPT) { $env:LEON_LAUNCHER_SCRIPT } else { $MyInvocation.MyCommand.Path }
$Script:LauncherDir = if ($Script:LauncherScriptPath) { Split-Path -Parent $Script:LauncherScriptPath } else { (Get-Location).Path }
$Script:RepoRoot = (Resolve-Path (Join-Path $Script:LauncherDir "..\..")).Path
$Script:ApiPort = 9880
$Script:ApiBase = "http://127.0.0.1:$Script:ApiPort"
$Script:WebUiPort = 7860
$Script:WebUiBase = "http://127.0.0.1:$Script:WebUiPort"
$Script:LanHost = "192.168.8.100"
$Script:PublicHost = "https://index-tts.928886540.xyz"
$Script:StartupBat = Join-Path $Script:RepoRoot "go-API-VLLM-NoQwen.bat"
$Script:WebUiStartupBat = Join-Path $Script:RepoRoot "go-webui-VLLM-NoQwen.bat"
$Script:RuntimePython = Join-Path $Script:RepoRoot "indextts2runtime\python.exe"
$Script:RuntimeScripts = Join-Path $Script:RepoRoot "indextts2runtime\Scripts"
$Script:LogDir = Join-Path $Script:LauncherDir "logs"
$Script:BannerPath = Join-Path $Script:LauncherDir "leon-launcher-banner-avatar-ai.png"
$Script:AvatarPath = Join-Path $Script:LauncherDir "leon-avatar.jpeg"
$Script:IconPath = Join-Path $Script:LauncherDir "leon-launcher.ico"
$Script:SvmlSource = Join-Path $Script:RepoRoot "Leon_api\LLVM ERROR报错解决\svml_dispmd.dll"
$Script:VoiceItems = @()
$Script:SelectedVoices = @{
    default = ""
    "旁白" = ""
    "对白" = ""
    "用户" = ""
}
$Script:LastJobKey = $null
$Script:LatestStartupLog = $null
$Script:LatestStartupErr = $null
$Script:FirstCheckDone = $false
$Script:RuntimeImportProbe = $null
$Script:LauncherIcon = $null
$Script:StartButton = $null
$Script:Tabs = $null
$Script:BackendLogTimer = $null
$Script:WarmupStarted = $false
$Script:WebUiBrowser = $null
$Script:WebUiStatusLabel = $null

try {
    if (-not ([System.Management.Automation.PSTypeName]'LeonTaskbarIdentity').Type) {
        Add-Type @"
using System.Runtime.InteropServices;
public static class LeonTaskbarIdentity
{
    [DllImport("shell32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    public static extern int SetCurrentProcessExplicitAppUserModelID(string appID);
}
"@
    }
    [void][LeonTaskbarIdentity]::SetCurrentProcessExplicitAppUserModelID("LEON.IndexTTS2.Launcher")
}
catch {
    # Older Windows shells can ignore this; Form.Icon below still controls the window icon.
}

function New-Font {
    param([float]$Size, [System.Drawing.FontStyle]$Style = [System.Drawing.FontStyle]::Regular)
    return New-Object System.Drawing.Font("Microsoft YaHei UI", $Size, $Style)
}

function Add-Log {
    param([string]$Message, [string]$Level = "INFO")
    $line = "[{0}] [{1}] {2}" -f (Get-Date -Format "HH:mm:ss"), $Level, $Message
    if ($Script:LogBox) {
        $Script:LogBox.AppendText($line + [Environment]::NewLine)
        $Script:LogBox.SelectionStart = $Script:LogBox.TextLength
        $Script:LogBox.ScrollToCaret()
    }
    New-Item -ItemType Directory -Force -Path $Script:LogDir | Out-Null
    $logFile = Join-Path $Script:LogDir ("launcher-" + (Get-Date -Format "yyyyMMdd") + ".log")
    Add-Content -LiteralPath $logFile -Value $line -Encoding UTF8
}

function Show-HomeLog {
    if ($Script:Tabs) {
        $Script:Tabs.SelectedIndex = 0
    }
    Refresh-BackendLogTail
}

function Set-StatusText {
    param([string]$Message, [string]$ColorName = "White")
    if ($Script:StatusLabel) {
        $Script:StatusLabel.Text = $Message
        $Script:StatusLabel.ForeColor = [System.Drawing.Color]::$ColorName
    }
}

function Set-Progress {
    param([int]$Value, [string]$Message = $null)
    if ($Script:ProgressBar) {
        $Script:ProgressBar.Value = [Math]::Max(0, [Math]::Min(100, $Value))
    }
    if ($Message) {
        Set-StatusText $Message
    }
    [System.Windows.Forms.Application]::DoEvents()
}

function Update-StartButtonState {
    param([bool]$Running)
    if (-not $Script:StartButton) { return }
    if ($Running) {
        $Script:StartButton.Text = "服务已运行"
        $Script:StartButton.BackColor = [System.Drawing.Color]::FromArgb(52, 116, 78)
    }
    else {
        $Script:StartButton.Text = "启动 LEON 服务"
        $Script:StartButton.BackColor = [System.Drawing.Color]::FromArgb(25, 126, 89)
    }
}

function Test-IsAdmin {
    $identity = [Security.Principal.WindowsIdentity]::GetCurrent()
    $principal = New-Object Security.Principal.WindowsPrincipal($identity)
    return $principal.IsInRole([Security.Principal.WindowsBuiltinRole]::Administrator)
}

function Test-PathHasChinese {
    param([string]$Path)
    return [regex]::IsMatch($Path, "[\u4e00-\u9fff]")
}

function Get-CommandPath {
    param([string]$Name)
    try {
        $cmd = Get-Command $Name -ErrorAction Stop
        return $cmd.Source
    }
    catch {
        return $null
    }
}

function Join-ProcessArguments {
    param([string[]]$Arguments = @())
    $escaped = foreach ($arg in $Arguments) {
        $s = [string]$arg
        if ($s -match '[\s"]') {
            '"' + ($s -replace '\\(?=\\*")', '$&$&' -replace '"', '\"') + '"'
        }
        else {
            $s
        }
    }
    return ($escaped -join " ")
}

function Invoke-Capture {
    param(
        [string]$FilePath,
        [string[]]$Arguments = @(),
        [int]$TimeoutSeconds = 30,
        [hashtable]$Env = @{}
    )
    $psi = New-Object System.Diagnostics.ProcessStartInfo
    $psi.FileName = $FilePath
    $psi.Arguments = Join-ProcessArguments $Arguments
    $psi.WorkingDirectory = $Script:RepoRoot
    $psi.UseShellExecute = $false
    $psi.RedirectStandardOutput = $true
    $psi.RedirectStandardError = $true
    $psi.CreateNoWindow = $true
    foreach ($key in $Env.Keys) {
        $psi.EnvironmentVariables[$key] = [string]$Env[$key]
    }
    $proc = New-Object System.Diagnostics.Process
    $proc.StartInfo = $psi
    [void]$proc.Start()
    if (-not $proc.WaitForExit($TimeoutSeconds * 1000)) {
        try { $proc.Kill() } catch {}
        return [pscustomobject]@{ ExitCode = -999; Stdout = ""; Stderr = "timeout after ${TimeoutSeconds}s" }
    }
    return [pscustomobject]@{
        ExitCode = $proc.ExitCode
        Stdout = $proc.StandardOutput.ReadToEnd()
        Stderr = $proc.StandardError.ReadToEnd()
    }
}

function Invoke-PythonSnippet {
    param([string]$Code, [int]$TimeoutSeconds = 45)
    if (-not (Test-Path $Script:RuntimePython)) {
        return [pscustomobject]@{ ExitCode = 127; Stdout = ""; Stderr = "runtime python missing" }
    }
    $runtimePathPrefix = @(Get-RuntimeDllSearchDirs) -join ";"
    $env = @{
        "HF_HOME" = (Join-Path $Script:RepoRoot "checkpoints")
        "PATH" = "$runtimePathPrefix;$env:PATH"
    }
    return Invoke-Capture -FilePath $Script:RuntimePython -Arguments @("-c", $Code) -TimeoutSeconds $TimeoutSeconds -Env $env
}

function Get-RuntimeDllSearchDirs {
    $dirs = @()
    if ($Script:RuntimePython) {
        $runtimeRoot = Split-Path -Parent $Script:RuntimePython
        $dirs += $runtimeRoot
        $dirs += $Script:RuntimeScripts
        $dirs += (Join-Path $runtimeRoot "DLLs")
        $dirs += (Join-Path $runtimeRoot "Library\bin")
        $dirs += (Join-Path $runtimeRoot "Lib\site-packages\torch\lib")
        $dirs += (Join-Path $runtimeRoot "Lib\site-packages\nvidia\cublas\bin")
        $dirs += (Join-Path $runtimeRoot "Lib\site-packages\nvidia\cuda_runtime\bin")
        $dirs += (Join-Path $runtimeRoot "Lib\site-packages\nvidia\cudnn\bin")
    }
    $dirs += $Script:RepoRoot
    $dirs += "C:\Windows\System32"
    if ($env:PATH) {
        $dirs += ($env:PATH -split ";")
    }
    return $dirs |
        Where-Object { -not [string]::IsNullOrWhiteSpace($_) } |
        ForEach-Object { $_.Trim('"') } |
        Where-Object { Test-Path $_ } |
        Select-Object -Unique
}

function Find-SvmlDll {
    foreach ($dir in Get-RuntimeDllSearchDirs) {
        $candidate = Join-Path $dir "svml_dispmd.dll"
        if (Test-Path $candidate) {
            return $candidate
        }
    }
    try {
        $hit = & where.exe svml_dispmd.dll 2>$null | Select-Object -First 1
        if (-not [string]::IsNullOrWhiteSpace($hit)) { return $hit.Trim() }
    }
    catch {}
    return $null
}

function Get-RuntimeImportProbe {
    if ($Script:RuntimeImportProbe) { return $Script:RuntimeImportProbe }
    $pkgCode = @'
import importlib, json
mods = ["torch", "torchaudio", "vllm", "fastapi", "uvicorn", "ninja", "triton"]
out = {}
for m in mods:
    try:
        mod = importlib.import_module(m)
        out[m] = getattr(mod, "__version__", "installed")
    except Exception as e:
        out[m] = "ERROR: " + str(e)
try:
    import torch
    out["torch_cuda_available"] = bool(torch.cuda.is_available())
    out["torch_cuda_version"] = getattr(torch.version, "cuda", None)
    out["torch_gpu"] = torch.cuda.get_device_name(0) if torch.cuda.is_available() else ""
except Exception as e:
    out["torch_cuda_available"] = "ERROR: " + str(e)
print(json.dumps(out, ensure_ascii=False))
'@
    $pkg = Invoke-PythonSnippet -Code $pkgCode -TimeoutSeconds 60
    $info = $null
    if ($pkg.ExitCode -eq 0) {
        try { $info = $pkg.Stdout | ConvertFrom-Json } catch { $info = $null }
    }
    $Script:RuntimeImportProbe = [pscustomobject]@{
        ExitCode = $pkg.ExitCode
        Stdout = $pkg.Stdout
        Stderr = $pkg.Stderr
        Text = (($pkg.Stdout + "`n" + $pkg.Stderr).Trim())
        Info = $info
    }
    return $Script:RuntimeImportProbe
}

function Test-RuntimeImportOk {
    $probe = Get-RuntimeImportProbe
    if ($probe.ExitCode -ne 0 -or -not $probe.Info) { return $false }
    return (([string]$probe.Info.torch -notlike "ERROR:*") -and ([string]$probe.Info.vllm -notlike "ERROR:*"))
}

function Test-SvmlRepairNeeded {
    if (Find-SvmlDll) { return $false }
    if (-not (Test-Path $Script:RuntimePython)) { return $false }
    if (Test-RuntimeImportOk) { return $false }
    $probe = Get-RuntimeImportProbe
    return ($probe.Text -match "(?i)svml_dispmd|LLVM ERROR|dll load failed|找不到指定的模块|specified module")
}

function Get-SvmlRepairTarget {
    if (-not (Test-Path $Script:RuntimePython)) { return $null }
    $runtimeRoot = Split-Path -Parent $Script:RuntimePython
    foreach ($dir in @((Join-Path $runtimeRoot "Library\bin"), $runtimeRoot)) {
        if (Test-Path $dir) { return (Join-Path $dir "svml_dispmd.dll") }
    }
    return $null
}

function Add-CheckResult {
    param(
        [string]$Name,
        [string]$Status,
        [string]$Detail
    )
    $icon = switch ($Status) {
        "OK" { "通过" }
        "WARN" { "警告" }
        "FAIL" { "失败" }
        default { $Status }
    }
    $item = New-Object System.Windows.Forms.ListViewItem($Name)
    [void]$item.SubItems.Add($icon)
    [void]$item.SubItems.Add($Detail)
    switch ($Status) {
        "OK" { $item.ForeColor = [System.Drawing.Color]::FromArgb(76, 220, 132) }
        "WARN" { $item.ForeColor = [System.Drawing.Color]::FromArgb(245, 190, 85) }
        "FAIL" { $item.ForeColor = [System.Drawing.Color]::FromArgb(255, 110, 110) }
    }
    [void]$Script:CheckList.Items.Add($item)
}

function Test-ApiHealth {
    try {
        $resp = Invoke-RestMethod -Uri "$Script:ApiBase/health" -TimeoutSec 2
        return $resp
    }
    catch {
        return $null
    }
}

function Test-WebUiHealth {
    try {
        $resp = Invoke-WebRequest -Uri $Script:WebUiBase -UseBasicParsing -TimeoutSec 2
        return ($resp.StatusCode -ge 200 -and $resp.StatusCode -lt 500)
    }
    catch {
        return $false
    }
}

function Get-ListeningPidsForPort {
    param([int]$Port)
    $pids = @()
    try {
        netstat -ano -p tcp | Select-String "LISTENING" | ForEach-Object {
            $parts = $_.ToString().Trim() -split "\s+"
            if ($parts.Length -ge 5 -and $parts[1] -match (":" + $Port + "$")) {
                $pids += [int]$parts[-1]
            }
        }
    }
    catch {}
    return $pids | Sort-Object -Unique
}

function Get-VsInstallPath {
    $vswhere = "C:\Program Files (x86)\Microsoft Visual Studio\Installer\vswhere.exe"
    if (Test-Path $vswhere) {
        try {
            $path = & $vswhere -latest -products * -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 -property installationPath
            if (-not [string]::IsNullOrWhiteSpace($path)) { return $path.Trim() }
        }
        catch {}
    }
    $candidates = @(
        "C:\Program Files\Microsoft Visual Studio\2022\BuildTools",
        "C:\Program Files\Microsoft Visual Studio\2022\Community",
        "C:\Program Files\Microsoft Visual Studio\2022\Professional",
        "C:\Program Files\Microsoft Visual Studio\2022\Enterprise",
        "C:\Program Files (x86)\Microsoft Visual Studio\2022\BuildTools",
        "C:\Program Files (x86)\Microsoft Visual Studio\2022\Community"
    )
    return $candidates | Where-Object { Test-Path $_ } | Select-Object -First 1
}

function Get-CudaToolkitPath {
    if ($env:CUDA_PATH -and (Test-Path (Join-Path $env:CUDA_PATH "bin\nvcc.exe"))) {
        return $env:CUDA_PATH
    }
    $roots = @("C:\Program Files\NVIDIA GPU Computing Toolkit\CUDA")
    foreach ($root in $roots) {
        if (Test-Path $root) {
            $hit = Get-ChildItem -LiteralPath $root -Directory -ErrorAction SilentlyContinue |
                Sort-Object Name -Descending |
                Where-Object { Test-Path (Join-Path $_.FullName "bin\nvcc.exe") } |
                Select-Object -First 1
            if ($hit) { return $hit.FullName }
        }
    }
    return $null
}

function Run-EnvironmentCheck {
    param([switch]$Silent)

    $Script:CheckList.Items.Clear()
    Set-Progress 2 "正在检测环境..."
    Add-Log "开始环境检测。项目目录: $Script:RepoRoot"

    $Script:EnvCheckFail = 0
    $Script:EnvCheckWarn = 0

    function Count-Result([string]$Status) {
        if ($Status -eq "FAIL") { $Script:EnvCheckFail++ }
        elseif ($Status -eq "WARN") { $Script:EnvCheckWarn++ }
    }

    $status = if (Test-IsAdmin) { "OK" } else { "WARN" }
    Count-Result $status
    Add-CheckResult "管理员权限" $status ($(if ($status -eq "OK") { "已用管理员权限运行，可安装系统组件。" } else { "不是管理员。检测可用，winget 安装或系统级修复可能需要提权。" }))
    Set-Progress 8

    $status = if (Test-PathHasChinese $Script:RepoRoot) { "FAIL" } else { "OK" }
    Count-Result $status
    Add-CheckResult "项目路径中文检查" $status ($(if ($status -eq "OK") { "路径未包含中文，适合 vLLM / CUDA / ninja 编译。" } else { "当前路径包含中文，LLVM/ninja/CUDA 编译很容易失败。请移动到纯英文路径，例如 D:\LEON_IndexTTS2。" }))
    Set-Progress 14

    $runtimeOk = Test-Path $Script:RuntimePython
    $status = if ($runtimeOk) { "OK" } else { "FAIL" }
    Count-Result $status
    $pyDetail = if ($runtimeOk) {
        $ver = Invoke-Capture -FilePath $Script:RuntimePython -Arguments @("--version") -TimeoutSeconds 10
        (($ver.Stdout + $ver.Stderr).Trim())
    } else {
        "缺少 indextts2runtime\python.exe。请使用完整包，或先解压随包 runtime。"
    }
    Add-CheckResult "项目 Python Runtime" $status $pyDetail
    Set-Progress 20

    $nvidiaPath = Get-CommandPath "nvidia-smi.exe"
    if ($nvidiaPath) {
        $gpu = Invoke-Capture -FilePath $nvidiaPath -Arguments @("--query-gpu=name,memory.total,driver_version", "--format=csv,noheader") -TimeoutSeconds 10
        $status = if ($gpu.ExitCode -eq 0) { "OK" } else { "FAIL" }
        Count-Result $status
        Add-CheckResult "NVIDIA 显卡/驱动" $status ($(if ($gpu.ExitCode -eq 0) { $gpu.Stdout.Trim() } else { $gpu.Stderr.Trim() }))
    }
    else {
        $status = "FAIL"; Count-Result $status
        Add-CheckResult "NVIDIA 显卡/驱动" $status "找不到 nvidia-smi。需要 NVIDIA 显卡和正常驱动。"
    }
    Set-Progress 28

    $cudaPath = Get-CudaToolkitPath
    if ($cudaPath) {
        $nvcc = Join-Path $cudaPath "bin\nvcc.exe"
        $out = Invoke-Capture -FilePath $nvcc -Arguments @("-V") -TimeoutSeconds 10
        $status = if ($out.ExitCode -eq 0) { "OK" } else { "WARN" }
        Count-Result $status
        Add-CheckResult "CUDA Toolkit / nvcc" $status ($(if ($out.ExitCode -eq 0) { (($out.Stdout + $out.Stderr) -split "`n" | Where-Object { $_ -match "release" } | Select-Object -First 1).Trim() } else { "找到 CUDA 目录但 nvcc 执行失败: $cudaPath" }))
    }
    else {
        $status = "WARN"; Count-Result $status
        Add-CheckResult "CUDA Toolkit / nvcc" $status "未找到 CUDA Toolkit。Torch 自带 CUDA 可运行，但 BigVGAN CUDA kernel 编译需要 nvcc，建议安装 CUDA 12.8。"
    }
    Set-Progress 36

    $vsPath = Get-VsInstallPath
    $clPath = Get-CommandPath "cl.exe"
    if (-not $clPath -and $vsPath) {
        $msvcRoot = Join-Path $vsPath "VC\Tools\MSVC"
        $msvc = Get-ChildItem $msvcRoot -Directory -ErrorAction SilentlyContinue | Sort-Object Name -Descending | Select-Object -First 1
        if ($msvc) {
            $candidate = Join-Path $msvc.FullName "bin\Hostx64\x64\cl.exe"
            if (Test-Path $candidate) { $clPath = $candidate }
        }
    }
    $status = if ($clPath) { "OK" } else { "WARN" }
    Count-Result $status
    Add-CheckResult "MSVC C++ Build Tools" $status ($(if ($clPath) { "cl.exe: $clPath" } else { "未找到 cl.exe。BigVGAN CUDA kernel 编译会失败，可用一键修复安装 Build Tools。" }))
    Set-Progress 44

    $svmlPath = Find-SvmlDll
    if ($svmlPath) {
        $status = "OK"
        $detail = "运行时可解析 svml_dispmd.dll: $svmlPath"
    }
    elseif ($runtimeOk -and (Test-RuntimeImportOk)) {
        $status = "OK"
        $detail = "未发现独立 svml_dispmd.dll，但当前 runtime 可 import torch/vllm；此机器无需修复该 DLL。"
    }
    elseif ($runtimeOk -and (Test-SvmlRepairNeeded)) {
        $status = "FAIL"
        $detail = "runtime import 失败且日志命中 SVML/LLVM/DLL 加载问题，可用一键修复复制随包 DLL 到项目 runtime。"
    }
    else {
        $status = "WARN"
        $detail = "未发现独立 svml_dispmd.dll，但当前未证明它是启动阻塞项；如果 vLLM import 正常可忽略。"
    }
    Count-Result $status
    Add-CheckResult "Intel SVML 兼容兜底" $status $detail
    Set-Progress 52

    if ($runtimeOk) {
        $pkg = Get-RuntimeImportProbe
        if ($pkg.ExitCode -eq 0) {
            $info = $pkg.Info
            if ($info) {
                $bad = @()
                foreach ($name in @("torch", "torchaudio", "vllm", "fastapi", "uvicorn", "ninja")) {
                    if ([string]$info.$name -like "ERROR:*") { $bad += "$name=$($info.$name)" }
                }
                $status = if ($bad.Count -eq 0 -and $info.torch_cuda_available -eq $true) { "OK" } elseif ($bad.Count -eq 0) { "WARN" } else { "FAIL" }
                Count-Result $status
                $detail = "torch=$($info.torch); cuda=$($info.torch_cuda_version); gpu=$($info.torch_gpu); vllm=$($info.vllm); ninja=$($info.ninja)"
                if ($bad.Count -gt 0) { $detail = $bad -join "; " }
                Add-CheckResult "Python 包 / Torch CUDA / vLLM" $status $detail
            }
            else {
                $status = "FAIL"; Count-Result $status
                Add-CheckResult "Python 包 / Torch CUDA / vLLM" $status "包检测输出无法解析: $($pkg.Stdout.Trim())"
            }
        }
        else {
            $status = "FAIL"; Count-Result $status
            Add-CheckResult "Python 包 / Torch CUDA / vLLM" $status $pkg.Stderr.Trim()
        }
    }
    Set-Progress 62

    if ($runtimeOk) {
        $patchCode = "import patch_vllm; print('patch_vllm OK')"
        $patch = Invoke-PythonSnippet -Code $patchCode -TimeoutSeconds 60
        $status = if ($patch.ExitCode -eq 0 -and ($patch.Stdout -match "OK")) { "OK" } else { "FAIL" }
        Count-Result $status
        Add-CheckResult "vLLM 插件 / GPT2TTSModel 注册" $status ($(if ($status -eq "OK") { ($patch.Stdout.Trim() -replace "`r?`n", " | ") } else { (($patch.Stdout + $patch.Stderr).Trim()) }))
    }
    Set-Progress 70

    $requiredModels = @("checkpoints\config.yaml", "checkpoints\gpt.pth", "checkpoints\s2mel.pth", "checkpoints\bpe.model", "checkpoints\wav2vec2bert_stats.pt")
    $missingModels = @()
    foreach ($rel in $requiredModels) {
        if (-not (Test-Path (Join-Path $Script:RepoRoot $rel))) { $missingModels += $rel }
    }
    $status = if ($missingModels.Count -eq 0) { "OK" } else { "FAIL" }
    Count-Result $status
    Add-CheckResult "IndexTTS2 模型文件" $status ($(if ($missingModels.Count -eq 0) { "checkpoints 基础模型文件存在。" } else { "缺少: " + ($missingModels -join ", ") }))
    Set-Progress 78

    $voiceCount = 0
    try {
        $voiceFiles = Get-ChildItem -LiteralPath (Join-Path $Script:RepoRoot "prompts\library") -Recurse -File -Include *.wav,*.mp3,*.flac,*.ogg,*.m4a -ErrorAction SilentlyContinue
        $voiceCount = @($voiceFiles).Count
    }
    catch {}
    $status = if ($voiceCount -gt 0) { "OK" } else { "WARN" }
    Count-Result $status
    Add-CheckResult "本地音色库" $status ($(if ($voiceCount -gt 0) { "发现 $voiceCount 个音频素材。" } else { "prompts/library 下没有发现音色音频。" }))
    Set-Progress 84

    $portPids = @(Get-ListeningPidsForPort -Port $Script:ApiPort)
    $health = Test-ApiHealth
    if ($health) {
        $status = "OK"; Count-Result $status
        Add-CheckResult "API 端口 $Script:ApiPort" $status "服务已运行: $($health.local_url)"
    }
    elseif ($portPids.Count -gt 0) {
        $status = "WARN"; Count-Result $status
        Add-CheckResult "API 端口 $Script:ApiPort" $status "端口被占用，PID: $($portPids -join ', ')。若不是本项目进程，启动会失败。"
    }
    else {
        $status = "OK"; Count-Result $status
        Add-CheckResult "API 端口 $Script:ApiPort" $status "端口空闲。"
    }
    Set-Progress 92

    $startupOk = Test-Path $Script:StartupBat
    $status = if ($startupOk) { "OK" } else { "FAIL" }
    Count-Result $status
    Add-CheckResult "启动入口 BAT" $status ($(if ($startupOk) { $Script:StartupBat } else { "缺少 go-API-VLLM-NoQwen.bat。" }))

    Set-Progress 100
    if ($Script:EnvCheckFail -gt 0) {
        Set-StatusText "环境检测完成：$Script:EnvCheckFail 个失败，$Script:EnvCheckWarn 个警告。" "LightCoral"
    }
    elseif ($Script:EnvCheckWarn -gt 0) {
        Set-StatusText "环境检测完成：0 个失败，$Script:EnvCheckWarn 个警告。" "Khaki"
    }
    else {
        Set-StatusText "环境检测通过，点击左下角“启动 LEON 服务”。" "LightGreen"
    }
    Add-Log "环境检测完成：FAIL=$Script:EnvCheckFail, WARN=$Script:EnvCheckWarn"
}

function Install-WithWinget {
    param([string[]]$Args, [string]$Name)
    $winget = Get-CommandPath "winget.exe"
    if (-not $winget) {
        Add-Log "找不到 winget，无法自动安装 $Name。" "ERROR"
        [System.Windows.Forms.MessageBox]::Show("找不到 winget。请先安装 App Installer，或手动安装 $Name。", "无法自动安装", "OK", "Warning") | Out-Null
        return
    }
    Add-Log "开始通过 winget 安装/修复: $Name"
    $psi = New-Object System.Diagnostics.ProcessStartInfo
    $psi.FileName = $winget
    $psi.Arguments = Join-ProcessArguments $Args
    $psi.UseShellExecute = $true
    $psi.Verb = "runas"
    try {
        [System.Diagnostics.Process]::Start($psi) | Out-Null
    }
    catch {
        Add-Log "winget 启动失败: $($_.Exception.Message)" "ERROR"
    }
}

function Repair-Environment {
    Add-Log "用户触发一键修复。"
    Set-Progress 5 "正在执行可自动修复项..."

    if ((Test-Path $Script:SvmlSource) -and (Test-SvmlRepairNeeded)) {
        try {
            $svmlTarget = Get-SvmlRepairTarget
            if (-not $svmlTarget) { throw "找不到可写入的项目 runtime 目录" }
            Copy-Item -LiteralPath $Script:SvmlSource -Destination $svmlTarget -Force
            Add-Log "已复制 svml_dispmd.dll 到项目 runtime: $svmlTarget"
        }
        catch {
            Add-Log "复制 svml_dispmd.dll 失败: $($_.Exception.Message)" "WARN"
        }
    }
    else {
        Add-Log "SVML 当前不是明确阻塞项，跳过 svml_dispmd.dll 复制。"
    }
    Set-Progress 25

    if (-not (Get-VsInstallPath)) {
        Install-WithWinget -Name "Visual Studio 2022 Build Tools" -Args @(
            "install", "-e", "--id", "Microsoft.VisualStudio.2022.BuildTools",
            "--override", "--quiet --wait --norestart --add Microsoft.VisualStudio.Workload.VCTools --includeRecommended",
            "--accept-package-agreements", "--accept-source-agreements"
        )
    }
    else {
        Add-Log "MSVC Build Tools 已存在，跳过安装。"
    }
    Set-Progress 45

    if (-not (Get-CudaToolkitPath)) {
        Install-WithWinget -Name "NVIDIA CUDA Toolkit" -Args @("install", "-e", "--id", "Nvidia.CUDA", "--accept-package-agreements", "--accept-source-agreements")
    }
    else {
        Add-Log "CUDA Toolkit 已存在，跳过安装。"
    }
    Set-Progress 65

    if (Test-Path $Script:RuntimePython) {
        $ninja = Invoke-PythonSnippet -Code "import ninja; print('ninja OK')" -TimeoutSeconds 30
        if ($ninja.ExitCode -ne 0) {
            Add-Log "runtime 内缺 ninja，尝试 pip 安装 ninja。"
            $pip = Invoke-Capture -FilePath $Script:RuntimePython -Arguments @("-m", "pip", "install", "ninja") -TimeoutSeconds 240 -Env @{ "PATH" = "$Script:RuntimeScripts;$env:PATH" }
            Add-Log ("pip install ninja exit=" + $pip.ExitCode)
            if ($pip.ExitCode -ne 0) { Add-Log $pip.Stderr "WARN" }
        }
        else {
            Add-Log "runtime 内 ninja 已可导入。"
        }
    }
    Set-Progress 82

    if (Test-PathHasChinese $Script:RepoRoot) {
        Add-Log "项目路径包含中文，无法自动安全搬迁。请把整个项目移动到纯英文路径后再运行。" "ERROR"
    }
    Set-Progress 100 "修复流程已执行，建议重新检测环境。"
    [System.Windows.Forms.MessageBox]::Show("自动修复已执行。系统组件安装完成后，可能需要重启电脑或重新打开启动器。", "修复完成", "OK", "Information") | Out-Null
}

function Start-LeonService {
    if (-not (Test-Path $Script:StartupBat)) {
        Add-Log "缺少启动 BAT: $Script:StartupBat" "ERROR"
        return
    }
    $health = Test-ApiHealth
    if ($health) {
        Add-Log "API 已经在运行: $Script:ApiBase"
        Set-StatusText "API 已运行：$Script:ApiBase" "LightGreen"
        Update-StartButtonState $true
        return
    }
    Add-Log "调用启动入口: $Script:StartupBat"
    try {
        Start-Process -FilePath "cmd.exe" -ArgumentList @("/c", "`"$Script:StartupBat`"") -WorkingDirectory $Script:RepoRoot -WindowStyle Normal | Out-Null
        Set-StatusText "服务启动中，首次加载模型可能需要几分钟..." "Khaki"
        Start-Sleep -Milliseconds 600
        Refresh-StartupLogPaths
        Wait-ApiReadyAsync
    }
    catch {
        Add-Log "启动失败: $($_.Exception.Message)" "ERROR"
    }
}

function Refresh-StartupLogPaths {
    $devLogDir = Join-Path $Script:RepoRoot "Leon_api\dev_tools"
    if (Test-Path $devLogDir) {
        $Script:LatestStartupLog = Get-ChildItem -LiteralPath $devLogDir -Filter "api_restart_stable_*.log" -ErrorAction SilentlyContinue | Sort-Object LastWriteTime -Descending | Select-Object -First 1
        $Script:LatestStartupErr = Get-ChildItem -LiteralPath $devLogDir -Filter "api_restart_stable_*.err" -ErrorAction SilentlyContinue | Sort-Object LastWriteTime -Descending | Select-Object -First 1
    }
}

function Wait-ApiReadyAsync {
    $timer = New-Object System.Windows.Forms.Timer
    $timer.Interval = 3000
    $start = Get-Date
    $timer.Add_Tick({
        $health = Test-ApiHealth
        if ($health) {
            $timer.Stop()
            $timer.Dispose()
            Set-StatusText "API 已启动：$Script:ApiBase" "LightGreen"
            Add-Log "API ready: $Script:ApiBase"
            Update-StartButtonState $true
            Refresh-BackendLogTail
            Refresh-Voices
            Start-WarmupAsync
            return
        }
        $elapsed = [int]((Get-Date) - $start).TotalSeconds
        Set-StatusText "服务启动中... ${elapsed}s" "Khaki"
        Add-Log "等待 API /health... ${elapsed}s"
        if ($elapsed -gt 300) {
            $timer.Stop()
            $timer.Dispose()
            Set-StatusText "API 启动超时，请查看日志。" "LightCoral"
            Add-Log "API 启动等待超时。" "ERROR"
        }
    })
    $timer.Start()
}

function Start-WarmupAsync {
    if ($Script:WarmupStarted) { return }
    $Script:WarmupStarted = $true
    Add-Log "开始请求后端模型预热..."
    Set-StatusText "API 已启动，正在预热模型..." "Khaki"

    $timer = New-Object System.Windows.Forms.Timer
    $timer.Interval = 400
    $timer.Add_Tick({
        $timer.Stop()
        $timer.Dispose()
        try {
            $resp = Invoke-RestMethod -Uri "$Script:ApiBase/warmup" -Method Post -TimeoutSec 180
            if ($resp.status -eq "ok" -or $resp.status -eq "already_warmed") {
                Set-StatusText "模型预热完成，默认 API：$Script:ApiBase" "LightGreen"
                Add-Log "模型预热完成: status=$($resp.status), elapsed=$($resp.elapsed_s)s, voice=$($resp.voice)"
            }
            else {
                Set-StatusText "预热返回: $($resp.status)" "Khaki"
                Add-Log "模型预热返回: $($resp | ConvertTo-Json -Depth 4)" "WARN"
            }
        }
        catch {
            Set-StatusText "服务已启动，预热未完成，可稍后重试或直接使用。" "Khaki"
            Add-Log "模型预热未完成: $($_.Exception.Message)。如果当前 API 是旧进程，/warmup 会在下次重启后生效。" "WARN"
        }
        Refresh-BackendLogTail
    })
    $timer.Start()
}

function Stop-LeonService {
    $pids = @(Get-ListeningPidsForPort -Port $Script:ApiPort)
    if ($pids.Count -eq 0) {
        Add-Log "端口 $Script:ApiPort 没有监听进程。"
        return
    }
    foreach ($pid in $pids) {
        try {
            $proc = Get-CimInstance Win32_Process -Filter "ProcessId = $pid" -ErrorAction SilentlyContinue
            if ($proc -and $proc.CommandLine -and ($proc.CommandLine -like "*index-tts2-vLLM*")) {
                Stop-Process -Id $pid -Force
                Add-Log "已停止项目 API 进程 PID $pid"
                Update-StartButtonState $false
            }
            else {
                Add-Log "PID $pid 不像本项目进程，未停止。" "WARN"
            }
        }
        catch {
            Add-Log "停止 PID $pid 失败: $($_.Exception.Message)" "WARN"
        }
    }
}

function Refresh-Voices {
    Add-Log "刷新音色列表..."
    try {
        $resp = Invoke-RestMethod -Uri "$Script:ApiBase/voices" -TimeoutSec 10
        $Script:VoiceItems = @($resp.voices)
        $names = @($Script:VoiceItems | ForEach-Object { $_.name })
        foreach ($cb in @($Script:VoiceDefaultBox, $Script:VoiceNarratorBox, $Script:VoiceDialogueBox, $Script:VoiceUserBox)) {
            if ($cb) {
                $old = $cb.Text
                $cb.Items.Clear()
        foreach ($name in $names) { [void]$cb.Items.Add($name) }
                if ($old -and $names -contains $old) { $cb.Text = $old }
                elseif ($names.Count -gt 0) { $cb.SelectedIndex = 0 }
            }
        }
        Set-StatusText "音色已刷新。" "LightGreen"
        Add-Log "音色列表已刷新。"
    }
    catch {
        Add-Log "刷新音色失败，请先启动 API: $($_.Exception.Message)" "WARN"
        Set-StatusText "刷新音色失败，请先启动 API。" "Khaki"
    }
}

function Open-VoicePreview {
    $name = $Script:VoiceDefaultBox.Text
    if ([string]::IsNullOrWhiteSpace($name)) {
        Add-Log "没有选中音色。" "WARN"
        return
    }
    $url = "$Script:ApiBase/voice_preview?name=$([uri]::EscapeDataString($name))"
    try {
        Start-Process $url | Out-Null
        Add-Log "打开试听: $name"
    }
    catch {
        Add-Log "打开试听失败: $($_.Exception.Message)" "WARN"
    }
}

function Start-MultiVoiceTest {
    $health = Test-ApiHealth
    if (-not $health) {
        Add-Log "API 未运行，无法多音色测试。" "WARN"
        return
    }
    $default = $Script:VoiceDefaultBox.Text
    $narrator = $Script:VoiceNarratorBox.Text
    $dialogue = $Script:VoiceDialogueBox.Text
    $userVoice = $Script:VoiceUserBox.Text
    if ([string]::IsNullOrWhiteSpace($default)) { $default = $narrator }
    if ([string]::IsNullOrWhiteSpace($narrator)) { $narrator = $default }
    if ([string]::IsNullOrWhiteSpace($dialogue)) { $dialogue = $default }
    if ([string]::IsNullOrWhiteSpace($userVoice)) { $userVoice = $dialogue }
    if ([string]::IsNullOrWhiteSpace($default)) {
        Add-Log "请至少选择一个音色。" "WARN"
        return
    }
    $text = $Script:TestTextBox.Text
    if ([string]::IsNullOrWhiteSpace($text)) {
        $text = @'
夜色压下来，街边的灯一盏盏亮起。
“你终于来了。”
我低声回答：“开始测试吧。”
'@
    }
    $body = @{
        text = $text
        parse_mode = "normal"
        voices = @{
            default = $default
            "旁白" = $narrator
            "对白" = $dialogue
            "用户" = $userVoice
        }
        performance_mode = "balanced"
        interval_ms = 260
        top_p = 0.8
        top_k = 30
        temperature = 0.7
        repetition_penalty = 1.2
        bypass_cache = $true
        cache_nonce = [guid]::NewGuid().ToString("N")
    } | ConvertTo-Json -Depth 8
    try {
        Add-Log "提交普通模式多音色测试..."
        $resp = Invoke-RestMethod -Uri "$Script:ApiBase/tts_dialogue_stream_job" -Method Post -ContentType "application/json; charset=utf-8" -Body $body -TimeoutSec 20
        $Script:LastJobKey = $resp.cache_key
        $Script:LastJobLabel.Text = "测试任务: $Script:LastJobKey"
        Add-Log "测试任务已创建: $Script:LastJobKey"
        Poll-TestJob
    }
    catch {
        Add-Log "提交测试失败: $($_.Exception.Message)" "ERROR"
    }
}

function Poll-TestJob {
    if (-not $Script:LastJobKey) { return }
    $timer = New-Object System.Windows.Forms.Timer
    $timer.Interval = 2500
    $start = Get-Date
    $timer.Add_Tick({
        try {
            $status = Invoke-RestMethod -Uri "$Script:ApiBase/tts_dialogue_job_status/$Script:LastJobKey" -TimeoutSec 5
            $state = [string]$status.state
            $segments = [int]($status.segments_done)
            $phase = ""
            if ($status.metrics -and $status.metrics.phase) { $phase = [string]$status.metrics.phase }
            Set-StatusText "多音色测试: $state $phase segments=$segments" "Khaki"
            Add-Log "测试状态: state=$state phase=$phase segments=$segments"
            if ($state -eq "done") {
                $timer.Stop(); $timer.Dispose()
                Set-StatusText "多音色测试完成，可以打开音频。" "LightGreen"
                Add-Log "测试完成: $Script:ApiBase/cache_audio/$Script:LastJobKey"
            }
            elseif ($state -eq "failed" -or $state -eq "cancelled" -or $state -eq "missing") {
                $timer.Stop(); $timer.Dispose()
                Set-StatusText "多音色测试失败: $state" "LightCoral"
                Add-Log "测试失败: $($status.error)" "ERROR"
            }
        }
        catch {
            $elapsed = [int]((Get-Date) - $start).TotalSeconds
            Add-Log "轮询测试状态失败: $($_.Exception.Message)" "WARN"
            if ($elapsed -gt 240) {
                $timer.Stop(); $timer.Dispose()
                Set-StatusText "多音色测试超时。" "LightCoral"
            }
        }
    })
    $timer.Start()
}

function Open-LastAudio {
    if (-not $Script:LastJobKey) {
        Add-Log "还没有测试任务。" "WARN"
        return
    }
    Start-Process "$Script:ApiBase/cache_audio/$Script:LastJobKey" | Out-Null
}

function Copy-TavoScript {
    $text = "<script src=`"$Script:PublicHost/static/tavo.js?v=20260605-ui-unify-v2`"></script>"
    [System.Windows.Forms.Clipboard]::SetText($text)
    Add-Log "已复制 Tavo 注入脚本。"
}

function Copy-LocalTavoScript {
    $text = "<script src=`"http://$Script:LanHost`:$Script:ApiPort/static/tavo.js?v=20260605-ui-unify-v2`"></script>"
    [System.Windows.Forms.Clipboard]::SetText($text)
    Add-Log "已复制局域网 Tavo 注入脚本。"
}

function Copy-ApiUrl {
    [System.Windows.Forms.Clipboard]::SetText($Script:ApiBase)
    Add-Log "已复制 API 地址: $Script:ApiBase"
}

function Open-ApiHome {
    Start-Process $Script:ApiBase | Out-Null
}

function Open-WebUiExternal {
    Start-Process $Script:WebUiBase | Out-Null
    Add-Log "已在浏览器打开 WebUI: $Script:WebUiBase"
}

function Refresh-WebUiPanel {
    $running = Test-WebUiHealth
    if ($Script:WebUiStatusLabel) {
        if ($running) {
            $Script:WebUiStatusLabel.Text = "WebUI 已运行：$Script:WebUiBase"
            $Script:WebUiStatusLabel.ForeColor = [System.Drawing.Color]::LightGreen
        }
        else {
            $Script:WebUiStatusLabel.Text = "WebUI 未运行。点击启动 WebUI 会调用 go-webui-VLLM-NoQwen.bat。"
            $Script:WebUiStatusLabel.ForeColor = [System.Drawing.Color]::Khaki
        }
    }
    return $running
}

function Start-WebUiService {
    if (Test-WebUiHealth) {
        Add-Log "WebUI 已经在运行: $Script:WebUiBase"
        Refresh-WebUiPanel | Out-Null
        return
    }
    if (-not (Test-Path $Script:WebUiStartupBat)) {
        Add-Log "缺少 WebUI 启动 BAT: $Script:WebUiStartupBat" "ERROR"
        return
    }
    Add-Log "调用 WebUI 启动入口: $Script:WebUiStartupBat"
    try {
        Start-Process -FilePath "cmd.exe" -ArgumentList @("/c", "`"$Script:WebUiStartupBat`"") -WorkingDirectory $Script:RepoRoot -WindowStyle Normal | Out-Null
        if ($Script:WebUiStatusLabel) {
            $Script:WebUiStatusLabel.Text = "WebUI 启动中，Gradio 首次加载可能需要几分钟..."
            $Script:WebUiStatusLabel.ForeColor = [System.Drawing.Color]::Khaki
        }
        Wait-WebUiReadyAsync
    }
    catch {
        Add-Log "WebUI 启动失败: $($_.Exception.Message)" "ERROR"
    }
}

function Wait-WebUiReadyAsync {
    $timer = New-Object System.Windows.Forms.Timer
    $timer.Interval = 3000
    $start = Get-Date
    $timer.Add_Tick({
        if (Test-WebUiHealth) {
            $timer.Stop()
            $timer.Dispose()
            Add-Log "WebUI ready: $Script:WebUiBase"
            Refresh-WebUiPanel | Out-Null
            Load-WebUiEmbedded
            return
        }
        $elapsed = [int]((Get-Date) - $start).TotalSeconds
        if ($Script:WebUiStatusLabel) {
            $Script:WebUiStatusLabel.Text = "WebUI 启动中... ${elapsed}s"
            $Script:WebUiStatusLabel.ForeColor = [System.Drawing.Color]::Khaki
        }
        if ($elapsed -gt 300) {
            $timer.Stop()
            $timer.Dispose()
            Add-Log "WebUI 启动等待超时。" "WARN"
            Refresh-WebUiPanel | Out-Null
        }
    })
    $timer.Start()
}

function Load-WebUiEmbedded {
    Refresh-WebUiPanel | Out-Null
    if (-not $Script:WebUiBrowser) { return }
    try {
        $Script:WebUiBrowser.Navigate($Script:WebUiBase)
        Add-Log "尝试在启动器内嵌 WebUI: $Script:WebUiBase"
    }
    catch {
        Add-Log "内嵌 WebUI 失败，建议用浏览器打开: $($_.Exception.Message)" "WARN"
    }
}

function Open-TavoTest {
    Start-Process "$Script:ApiBase/tavo_test" | Out-Null
}

function Open-LogsFolder {
    Start-Process $Script:LogDir | Out-Null
}

function Refresh-BackendLogTail {
    Refresh-StartupLogPaths
    $text = ""
    try {
        $apiTail = Invoke-RestMethod -Uri "$Script:ApiBase/server_log/tail?n=220" -TimeoutSec 2
        if ($apiTail -and $apiTail.lines) {
            $text += "=== API RUNTIME /server_log/tail ===`r`n"
            foreach ($line in @($apiTail.lines)) {
                $ts = ""
                try { $ts = ([DateTimeOffset]::FromUnixTimeSeconds([int64]$line.ts).ToLocalTime().ToString("HH:mm:ss")) } catch { $ts = "--:--:--" }
                $text += "[$ts] [$($line.stream)] $($line.line)`r`n"
            }
            $text += "`r`n"
        }
    }
    catch {}
    if ($Script:LatestStartupLog -and (Test-Path $Script:LatestStartupLog.FullName)) {
        $text += "=== STDOUT $($Script:LatestStartupLog.Name) ===`r`n"
        $text += ((Get-Content -LiteralPath $Script:LatestStartupLog.FullName -Tail 120 -ErrorAction SilentlyContinue) -join "`r`n")
        $text += "`r`n`r`n"
    }
    if ($Script:LatestStartupErr -and (Test-Path $Script:LatestStartupErr.FullName)) {
        $text += "=== STDERR $($Script:LatestStartupErr.Name) ===`r`n"
        $text += ((Get-Content -LiteralPath $Script:LatestStartupErr.FullName -Tail 120 -ErrorAction SilentlyContinue) -join "`r`n")
    }
    if ([string]::IsNullOrWhiteSpace($text)) {
        $text = '还没有发现后端启动日志。先点击左下角“启动 LEON 服务”。'
    }
    $Script:BackendLogBox.Text = $text
    $Script:BackendLogBox.SelectionStart = $Script:BackendLogBox.TextLength
    $Script:BackendLogBox.ScrollToCaret()
}

function Build-LauncherForm {
    $form = New-Object System.Windows.Forms.Form
    $form.Text = "LEON 启动器 - IndexTTS2 vLLM"
    $form.StartPosition = "CenterScreen"
    $form.Size = New-Object System.Drawing.Size(1240, 820)
    $form.MinimumSize = New-Object System.Drawing.Size(1120, 720)
    $form.BackColor = [System.Drawing.Color]::FromArgb(15, 18, 22)
    $form.Font = New-Font 9
    if (Test-Path $Script:IconPath) {
        try {
            $Script:LauncherIcon = New-Object System.Drawing.Icon($Script:IconPath)
            $form.Icon = $Script:LauncherIcon
            $form.ShowIcon = $true
        }
        catch {
            Add-Log "加载启动器图标失败: $($_.Exception.Message)" "WARN"
        }
    }

    $header = New-Object System.Windows.Forms.Panel
    $header.Dock = "Top"
    $header.Height = 132
    $header.BackColor = [System.Drawing.Color]::FromArgb(16, 20, 25)
    $form.Controls.Add($header)

    if (Test-Path $Script:BannerPath) {
        $banner = New-Object System.Windows.Forms.PictureBox
        $banner.Dock = "Fill"
        $banner.SizeMode = "Zoom"
        $banner.BackColor = [System.Drawing.Color]::FromArgb(10, 13, 17)
        $banner.Image = [System.Drawing.Image]::FromFile($Script:BannerPath)
        $header.Controls.Add($banner)
    }

    $title = New-Object System.Windows.Forms.Label
    $title.Text = "LEON 启动器"
    $title.Font = New-Font 23 ([System.Drawing.FontStyle]::Bold)
    $title.ForeColor = [System.Drawing.Color]::White
    $title.BackColor = [System.Drawing.Color]::Transparent
    $title.Location = New-Object System.Drawing.Point(26, 18)
    $title.Size = New-Object System.Drawing.Size(420, 42)
    $header.Controls.Add($title)
    $title.BringToFront()

    $sub = New-Object System.Windows.Forms.Label
    $sub.Text = "IndexTTS2 + vLLM 本地语音服务"
    $sub.Font = New-Font 10
    $sub.ForeColor = [System.Drawing.Color]::Gainsboro
    $sub.BackColor = [System.Drawing.Color]::Transparent
    $sub.Location = New-Object System.Drawing.Point(29, 62)
    $sub.Size = New-Object System.Drawing.Size(560, 24)
    $header.Controls.Add($sub)
    $sub.BringToFront()

    $Script:StatusLabel = New-Object System.Windows.Forms.Label
    $Script:StatusLabel.Text = "首次启动会自动检测环境。"
    $Script:StatusLabel.Font = New-Font 9
    $Script:StatusLabel.ForeColor = [System.Drawing.Color]::Khaki
    $Script:StatusLabel.BackColor = [System.Drawing.Color]::Transparent
    $Script:StatusLabel.Location = New-Object System.Drawing.Point(29, 92)
    $Script:StatusLabel.Size = New-Object System.Drawing.Size(640, 24)
    $header.Controls.Add($Script:StatusLabel)
    $Script:StatusLabel.BringToFront()

    $Script:ProgressBar = New-Object System.Windows.Forms.ProgressBar
    $Script:ProgressBar.Anchor = [System.Windows.Forms.AnchorStyles]::Top -bor [System.Windows.Forms.AnchorStyles]::Right
    $Script:ProgressBar.Location = New-Object System.Drawing.Point(850, 104)
    $Script:ProgressBar.Size = New-Object System.Drawing.Size(340, 12)
    $header.Controls.Add($Script:ProgressBar)
    $Script:ProgressBar.BringToFront()

    $main = New-Object System.Windows.Forms.SplitContainer
    $main.Dock = "Fill"
    $main.SplitterDistance = 220
    $main.FixedPanel = [System.Windows.Forms.FixedPanel]::Panel1
    $main.IsSplitterFixed = $true
    $main.BackColor = [System.Drawing.Color]::FromArgb(15, 18, 22)
    $main.Panel1.BackColor = [System.Drawing.Color]::FromArgb(21, 25, 31)
    $main.Panel2.BackColor = [System.Drawing.Color]::FromArgb(15, 18, 22)
    $form.Controls.Add($main)
    $main.BringToFront()

    $tabs = New-Object System.Windows.Forms.TabControl
    $tabs.Dock = "Fill"
    $tabs.Font = New-Font 9
    $tabs.BackColor = [System.Drawing.Color]::FromArgb(15, 18, 22)
    $main.Panel2.Controls.Add($tabs)
    $Script:Tabs = $tabs

    $buttons = @(
        @("首页 / 日志", { Show-HomeLog }),
        @("环境检测", { $tabs.SelectedIndex = 1; Run-EnvironmentCheck }),
        @("一键修复", { $tabs.SelectedIndex = 1; Repair-Environment }),
        @("停止服务", { Stop-LeonService }),
        @("刷新音色", { $tabs.SelectedIndex = 2; Refresh-Voices }),
        @("WebUI", { $tabs.SelectedIndex = 3; Refresh-WebUiPanel | Out-Null }),
        @("Tavo 说明", { $tabs.SelectedIndex = 4 }),
        @("打开 API", { Open-ApiHome }),
        @("打开日志", { Open-LogsFolder })
    )
    $y = 20
    foreach ($b in $buttons) {
        $btn = New-Object System.Windows.Forms.Button
        $btn.Text = $b[0]
        $btn.Location = New-Object System.Drawing.Point(20, $y)
        $btn.Size = New-Object System.Drawing.Size(178, 36)
        $btn.FlatStyle = "Flat"
        $btn.ForeColor = [System.Drawing.Color]::White
        $btn.BackColor = [System.Drawing.Color]::FromArgb(34, 41, 50)
        $btn.FlatAppearance.BorderColor = [System.Drawing.Color]::FromArgb(54, 66, 78)
        $handler = $b[1]
        $btn.Add_Click($handler)
        $main.Panel1.Controls.Add($btn)
        $y += 44
    }

    $info = New-Object System.Windows.Forms.Label
    $info.Text = "默认 API: $Script:ApiBase`r`n打开后只检测环境，不会自动启动服务。"
    $info.ForeColor = [System.Drawing.Color]::Silver
    $info.Location = New-Object System.Drawing.Point(18, 320)
    $info.Size = New-Object System.Drawing.Size(176, 80)
    $main.Panel1.Controls.Add($info)

    $Script:StartButton = New-Object System.Windows.Forms.Button
    $Script:StartButton.Text = "启动 LEON 服务"
    $Script:StartButton.Location = New-Object System.Drawing.Point(18, 420)
    $Script:StartButton.Size = New-Object System.Drawing.Size(178, 76)
    $Script:StartButton.Anchor = [System.Windows.Forms.AnchorStyles]::Left -bor [System.Windows.Forms.AnchorStyles]::Right -bor [System.Windows.Forms.AnchorStyles]::Bottom
    $Script:StartButton.FlatStyle = "Flat"
    $Script:StartButton.Font = New-Font 14 ([System.Drawing.FontStyle]::Bold)
    $Script:StartButton.ForeColor = [System.Drawing.Color]::White
    $Script:StartButton.BackColor = [System.Drawing.Color]::FromArgb(25, 126, 89)
    $Script:StartButton.FlatAppearance.BorderColor = [System.Drawing.Color]::FromArgb(110, 210, 160)
    $Script:StartButton.FlatAppearance.BorderSize = 1
    $Script:StartButton.Add_Click({ Start-LeonService })
    $main.Panel1.Controls.Add($Script:StartButton)

    $layoutSidebar = {
        if (-not $Script:StartButton) { return }
        $panelWidth = [Math]::Max(190, [Math]::Min(240, $main.SplitterDistance))
        $startHeight = 76
        $startY = [Math]::Max(312, $main.Panel1.ClientSize.Height - $startHeight - 18)
        $Script:StartButton.Location = New-Object System.Drawing.Point(18, $startY)
        $Script:StartButton.Size = New-Object System.Drawing.Size([Math]::Max(160, $panelWidth - 36), $startHeight)
        $infoTop = $y + 8
        $infoSpace = $startY - $infoTop - 8
        if ($infoSpace -ge 52) {
            $info.Visible = $true
            $info.Location = New-Object System.Drawing.Point(18, $infoTop)
            $info.Size = New-Object System.Drawing.Size([Math]::Max(150, $panelWidth - 36), [Math]::Min(84, $infoSpace))
        }
        else {
            $info.Visible = $false
        }
    }
    & $layoutSidebar
    $main.Panel1.Add_Resize($layoutSidebar)

    $tabLog = New-Object System.Windows.Forms.TabPage
    $tabLog.Text = "首页日志"
    $tabLog.BackColor = [System.Drawing.Color]::FromArgb(15, 18, 22)
    $tabs.TabPages.Add($tabLog)

    $logShell = New-Object System.Windows.Forms.Panel
    $logShell.Dock = "Fill"
    $logShell.Padding = New-Object System.Windows.Forms.Padding(16, 12, 16, 16)
    $logShell.BackColor = [System.Drawing.Color]::FromArgb(15, 18, 22)
    $tabLog.Controls.Add($logShell)

    $logTop = New-Object System.Windows.Forms.Panel
    $logTop.Dock = "Top"
    $logTop.Height = 42
    $logTop.BackColor = [System.Drawing.Color]::FromArgb(15, 18, 22)
    $logShell.Controls.Add($logTop)

    $refreshLogBtn = New-Object System.Windows.Forms.Button
    $refreshLogBtn.Text = "刷新日志"
    $refreshLogBtn.Location = New-Object System.Drawing.Point(0, 4)
    $refreshLogBtn.Size = New-Object System.Drawing.Size(110, 30)
    $refreshLogBtn.FlatStyle = "Flat"
    $refreshLogBtn.ForeColor = [System.Drawing.Color]::White
    $refreshLogBtn.BackColor = [System.Drawing.Color]::FromArgb(35, 45, 56)
    $refreshLogBtn.FlatAppearance.BorderColor = [System.Drawing.Color]::FromArgb(64, 78, 92)
    $refreshLogBtn.Add_Click({ Refresh-BackendLogTail })
    $logTop.Controls.Add($refreshLogBtn)

    $warmupBtn = New-Object System.Windows.Forms.Button
    $warmupBtn.Text = "手动预热"
    $warmupBtn.Location = New-Object System.Drawing.Point(120, 4)
    $warmupBtn.Size = New-Object System.Drawing.Size(110, 30)
    $warmupBtn.FlatStyle = "Flat"
    $warmupBtn.ForeColor = [System.Drawing.Color]::White
    $warmupBtn.BackColor = [System.Drawing.Color]::FromArgb(35, 45, 56)
    $warmupBtn.FlatAppearance.BorderColor = [System.Drawing.Color]::FromArgb(64, 78, 92)
    $warmupBtn.Add_Click({ Start-WarmupAsync })
    $logTop.Controls.Add($warmupBtn)

    $logHint = New-Object System.Windows.Forms.Label
    $logHint.Text = "启动器日志 + 后端运行日志"
    $logHint.ForeColor = [System.Drawing.Color]::Silver
    $logHint.Location = New-Object System.Drawing.Point(246, 9)
    $logHint.Size = New-Object System.Drawing.Size(360, 22)
    $logTop.Controls.Add($logHint)

    $Script:BackendLogBox = New-Object System.Windows.Forms.TextBox
    $Script:BackendLogBox.Multiline = $true
    $Script:BackendLogBox.Dock = "Fill"
    $Script:BackendLogBox.ScrollBars = "Both"
    $Script:BackendLogBox.WordWrap = $false
    $Script:BackendLogBox.BackColor = [System.Drawing.Color]::FromArgb(9, 12, 16)
    $Script:BackendLogBox.ForeColor = [System.Drawing.Color]::FromArgb(220, 226, 232)
    $Script:BackendLogBox.Font = New-Object System.Drawing.Font("Consolas", 9)
    $Script:BackendLogBox.BorderStyle = "FixedSingle"
    $logShell.Controls.Add($Script:BackendLogBox)
    $Script:LogBox = $Script:BackendLogBox

    $tabEnv = New-Object System.Windows.Forms.TabPage
    $tabEnv.Text = "环境"
    $tabEnv.BackColor = [System.Drawing.Color]::FromArgb(18, 22, 27)
    $tabs.TabPages.Add($tabEnv)

    $Script:CheckList = New-Object System.Windows.Forms.ListView
    $Script:CheckList.Dock = "Fill"
    $Script:CheckList.View = "Details"
    $Script:CheckList.FullRowSelect = $true
    $Script:CheckList.GridLines = $true
    $Script:CheckList.BackColor = [System.Drawing.Color]::FromArgb(13, 17, 22)
    $Script:CheckList.ForeColor = [System.Drawing.Color]::WhiteSmoke
    [void]$Script:CheckList.Columns.Add("检查项", 210)
    [void]$Script:CheckList.Columns.Add("状态", 70)
    [void]$Script:CheckList.Columns.Add("详情", 650)
    $tabEnv.Controls.Add($Script:CheckList)

    $tabVoice = New-Object System.Windows.Forms.TabPage
    $tabVoice.Text = "音色测试"
    $tabVoice.BackColor = [System.Drawing.Color]::FromArgb(15, 18, 22)
    $tabs.TabPages.Add($tabVoice)

    $voicePanel = New-Object System.Windows.Forms.Panel
    $voicePanel.Dock = "Top"
    $voicePanel.Height = 168
    $voicePanel.Padding = New-Object System.Windows.Forms.Padding(8)
    $tabVoice.Controls.Add($voicePanel)

    function Add-VoiceCombo($labelText, $x, $y) {
        $ix = [int]$x
        $iy = [int]$y
        $label = New-Object System.Windows.Forms.Label
        $label.Text = $labelText
        $label.ForeColor = [System.Drawing.Color]::Gainsboro
        $label.Location = New-Object System.Drawing.Point -ArgumentList $ix, $iy
        $label.Size = New-Object System.Drawing.Size(90, 24)
        [void]$voicePanel.Controls.Add($label)
        $cb = New-Object System.Windows.Forms.ComboBox
        $cb.DropDownStyle = "DropDown"
        $cb.Location = New-Object System.Drawing.Point -ArgumentList ($ix + 90), ($iy - 2)
        $cb.Size = New-Object System.Drawing.Size(310, 28)
        [void]$voicePanel.Controls.Add($cb)
        return $cb
    }
    $Script:VoiceDefaultBox = Add-VoiceCombo "默认音色" 24 26
    $Script:VoiceNarratorBox = Add-VoiceCombo "旁白音色" 24 66
    $Script:VoiceDialogueBox = Add-VoiceCombo "对白音色" 460 26
    $Script:VoiceUserBox = Add-VoiceCombo "用户音色" 460 66

    $refreshVoiceBtn = New-Object System.Windows.Forms.Button
    $refreshVoiceBtn.Text = "刷新"
    $refreshVoiceBtn.Location = New-Object System.Drawing.Point(24, 116)
    $refreshVoiceBtn.Size = New-Object System.Drawing.Size(120, 34)
    $refreshVoiceBtn.Add_Click({ Refresh-Voices })
    $voicePanel.Controls.Add($refreshVoiceBtn)

    $previewBtn = New-Object System.Windows.Forms.Button
    $previewBtn.Text = "试听默认音色"
    $previewBtn.Location = New-Object System.Drawing.Point(154, 116)
    $previewBtn.Size = New-Object System.Drawing.Size(130, 34)
    $previewBtn.Add_Click({ Open-VoicePreview })
    $voicePanel.Controls.Add($previewBtn)

    $testBtn = New-Object System.Windows.Forms.Button
    $testBtn.Text = "开始多音色测试"
    $testBtn.Location = New-Object System.Drawing.Point(294, 116)
    $testBtn.Size = New-Object System.Drawing.Size(150, 34)
    $testBtn.Add_Click({ Start-MultiVoiceTest })
    $voicePanel.Controls.Add($testBtn)

    $openAudioBtn = New-Object System.Windows.Forms.Button
    $openAudioBtn.Text = "打开最近音频"
    $openAudioBtn.Location = New-Object System.Drawing.Point(454, 116)
    $openAudioBtn.Size = New-Object System.Drawing.Size(130, 34)
    $openAudioBtn.Add_Click({ Open-LastAudio })
    $voicePanel.Controls.Add($openAudioBtn)

    $Script:LastJobLabel = New-Object System.Windows.Forms.Label
    $Script:LastJobLabel.Text = "测试任务: 无"
    $Script:LastJobLabel.ForeColor = [System.Drawing.Color]::Silver
    $Script:LastJobLabel.Location = New-Object System.Drawing.Point(24, 150)
    $Script:LastJobLabel.Size = New-Object System.Drawing.Size(880, 24)
    $voicePanel.Controls.Add($Script:LastJobLabel)

    $Script:TestTextBox = New-Object System.Windows.Forms.TextBox
    $Script:TestTextBox.Multiline = $true
    $Script:TestTextBox.Dock = "Fill"
    $Script:TestTextBox.ScrollBars = "Vertical"
    $Script:TestTextBox.BackColor = [System.Drawing.Color]::FromArgb(13, 17, 22)
    $Script:TestTextBox.ForeColor = [System.Drawing.Color]::WhiteSmoke
    $Script:TestTextBox.Font = New-Font 10
    $Script:TestTextBox.Text = @'
夜色压下来，街边的灯一盏盏亮起。
“你终于来了。”
我低声回答：“开始测试吧。”
'@
    $tabVoice.Controls.Add($Script:TestTextBox)

    $tabWebUi = New-Object System.Windows.Forms.TabPage
    $tabWebUi.Text = "WebUI"
    $tabWebUi.BackColor = [System.Drawing.Color]::FromArgb(15, 18, 22)
    $tabs.TabPages.Add($tabWebUi)

    $webUiTop = New-Object System.Windows.Forms.Panel
    $webUiTop.Dock = "Top"
    $webUiTop.Height = 74
    $webUiTop.Padding = New-Object System.Windows.Forms.Padding(16, 10, 16, 8)
    $webUiTop.BackColor = [System.Drawing.Color]::FromArgb(15, 18, 22)
    $tabWebUi.Controls.Add($webUiTop)

    $startWebUiBtn = New-Object System.Windows.Forms.Button
    $startWebUiBtn.Text = "启动 WebUI"
    $startWebUiBtn.Location = New-Object System.Drawing.Point(16, 10)
    $startWebUiBtn.Size = New-Object System.Drawing.Size(116, 32)
    $startWebUiBtn.FlatStyle = "Flat"
    $startWebUiBtn.ForeColor = [System.Drawing.Color]::White
    $startWebUiBtn.BackColor = [System.Drawing.Color]::FromArgb(25, 126, 89)
    $startWebUiBtn.FlatAppearance.BorderColor = [System.Drawing.Color]::FromArgb(110, 210, 160)
    $startWebUiBtn.Add_Click({ Start-WebUiService })
    $webUiTop.Controls.Add($startWebUiBtn)

    $openWebUiBtn = New-Object System.Windows.Forms.Button
    $openWebUiBtn.Text = "浏览器打开"
    $openWebUiBtn.Location = New-Object System.Drawing.Point(144, 10)
    $openWebUiBtn.Size = New-Object System.Drawing.Size(116, 32)
    $openWebUiBtn.FlatStyle = "Flat"
    $openWebUiBtn.ForeColor = [System.Drawing.Color]::White
    $openWebUiBtn.BackColor = [System.Drawing.Color]::FromArgb(35, 45, 56)
    $openWebUiBtn.FlatAppearance.BorderColor = [System.Drawing.Color]::FromArgb(64, 78, 92)
    $openWebUiBtn.Add_Click({ Open-WebUiExternal })
    $webUiTop.Controls.Add($openWebUiBtn)

    $embedWebUiBtn = New-Object System.Windows.Forms.Button
    $embedWebUiBtn.Text = "内嵌刷新"
    $embedWebUiBtn.Location = New-Object System.Drawing.Point(272, 10)
    $embedWebUiBtn.Size = New-Object System.Drawing.Size(104, 32)
    $embedWebUiBtn.FlatStyle = "Flat"
    $embedWebUiBtn.ForeColor = [System.Drawing.Color]::White
    $embedWebUiBtn.BackColor = [System.Drawing.Color]::FromArgb(35, 45, 56)
    $embedWebUiBtn.FlatAppearance.BorderColor = [System.Drawing.Color]::FromArgb(64, 78, 92)
    $embedWebUiBtn.Add_Click({ Load-WebUiEmbedded })
    $webUiTop.Controls.Add($embedWebUiBtn)

    $Script:WebUiStatusLabel = New-Object System.Windows.Forms.Label
    $Script:WebUiStatusLabel.Text = "WebUI 未运行。"
    $Script:WebUiStatusLabel.ForeColor = [System.Drawing.Color]::Khaki
    $Script:WebUiStatusLabel.Location = New-Object System.Drawing.Point(16, 48)
    $Script:WebUiStatusLabel.Size = New-Object System.Drawing.Size(840, 22)
    $webUiTop.Controls.Add($Script:WebUiStatusLabel)

    $webUiShell = New-Object System.Windows.Forms.Panel
    $webUiShell.Dock = "Fill"
    $webUiShell.Padding = New-Object System.Windows.Forms.Padding(16, 8, 16, 16)
    $webUiShell.BackColor = [System.Drawing.Color]::FromArgb(15, 18, 22)
    $tabWebUi.Controls.Add($webUiShell)

    $Script:WebUiBrowser = New-Object System.Windows.Forms.WebBrowser
    $Script:WebUiBrowser.Dock = "Fill"
    $Script:WebUiBrowser.ScriptErrorsSuppressed = $true
    $webUiShell.Controls.Add($Script:WebUiBrowser)
    Refresh-WebUiPanel | Out-Null

    $tabTavo = New-Object System.Windows.Forms.TabPage
    $tabTavo.Text = "Tavo 接入"
    $tabTavo.BackColor = [System.Drawing.Color]::FromArgb(18, 22, 27)
    $tabs.TabPages.Add($tabTavo)

    $tavoPanel = New-Object System.Windows.Forms.Panel
    $tavoPanel.Dock = "Top"
    $tavoPanel.Height = 52
    $tabTavo.Controls.Add($tavoPanel)

    $copyPublic = New-Object System.Windows.Forms.Button
    $copyPublic.Text = "复制域名脚本"
    $copyPublic.Location = New-Object System.Drawing.Point(16, 10)
    $copyPublic.Size = New-Object System.Drawing.Size(120, 32)
    $copyPublic.Add_Click({ Copy-TavoScript })
    $tavoPanel.Controls.Add($copyPublic)

    $copyLocal = New-Object System.Windows.Forms.Button
    $copyLocal.Text = "复制局域网脚本"
    $copyLocal.Location = New-Object System.Drawing.Point(146, 10)
    $copyLocal.Size = New-Object System.Drawing.Size(130, 32)
    $copyLocal.Add_Click({ Copy-LocalTavoScript })
    $tavoPanel.Controls.Add($copyLocal)

    $copyApi = New-Object System.Windows.Forms.Button
    $copyApi.Text = "复制 API 地址"
    $copyApi.Location = New-Object System.Drawing.Point(286, 10)
    $copyApi.Size = New-Object System.Drawing.Size(120, 32)
    $copyApi.Add_Click({ Copy-ApiUrl })
    $tavoPanel.Controls.Add($copyApi)

    $openTavoTest = New-Object System.Windows.Forms.Button
    $openTavoTest.Text = "打开本地测试页"
    $openTavoTest.Location = New-Object System.Drawing.Point(416, 10)
    $openTavoTest.Size = New-Object System.Drawing.Size(130, 32)
    $openTavoTest.Add_Click({ Open-TavoTest })
    $tavoPanel.Controls.Add($openTavoTest)

    $tavoText = New-Object System.Windows.Forms.TextBox
    $tavoText.Multiline = $true
    $tavoText.Dock = "Fill"
    $tavoText.ReadOnly = $true
    $tavoText.ScrollBars = "Vertical"
    $tavoText.BackColor = [System.Drawing.Color]::FromArgb(13, 17, 22)
    $tavoText.ForeColor = [System.Drawing.Color]::WhiteSmoke
    $tavoText.Font = New-Font 10
    $tavoText.Text = @"
Tavo 接入步骤

1. 先在这个启动器里点击“环境检测”，确认没有失败项。
2. 点击左下角“启动 LEON 服务”，等待状态显示 API 已启动。
3. Tavo 里打开高级前端渲染：
   左侧边栏 -> 更多 -> 设置 -> 高级前端渲染 -> 打开。
4. 在 Tavo 正则里新增显示时注入规则，把替换内容设为：

   <script src="$Script:PublicHost/static/tavo.js?v=20260605-ui-unify-v2"></script>

   如果手机和电脑在同一个局域网，也可以用：

   <script src="http://$Script:LanHost`:$Script:ApiPort/static/tavo.js?v=20260605-ui-unify-v2"></script>

5. 正则建议：
   - 作用范围：角色消息 / 显示时。
   - 替换参数：原文替换。
   - 如果只是追加播放器脚本，Find Regex 可以匹配整条消息，再在 Replace With 末尾追加 script。

常用地址

默认 API: $Script:ApiBase
本地测试页: $Script:ApiBase/tavo_test
脚本地址: $Script:ApiBase/static/tavo.js
域名脚本: $Script:PublicHost/static/tavo.js

注意

- Tavo 前端智能模式由后端创建任务并解析，不应该让 WebView 先调用 /parse_text。
- 如果修改 static/tavo.js，需要更新 v= 后面的缓存参数，否则 Tavo 可能继续用旧脚本。
- 真实手机/Tavo App 验证比浏览器测试更重要，尤其是后台播放、锁屏播放和历史音频恢复。
"@
    $tabTavo.Controls.Add($tavoText)

    $form.Add_Shown({
        if (-not $Script:FirstCheckDone) {
            $Script:FirstCheckDone = $true
            $Script:Tabs.SelectedIndex = 0
            Run-EnvironmentCheck -Silent
            $health = Test-ApiHealth
            Update-StartButtonState $health
            if ($health) { Refresh-Voices; Refresh-BackendLogTail }
        }
    })
    $form.Add_FormClosed({
        if ($banner -and $banner.Image) { $banner.Image.Dispose() }
        if ($Script:LauncherIcon) {
            $Script:LauncherIcon.Dispose()
            $Script:LauncherIcon = $null
        }
    })
    return $form
}

$form = Build-LauncherForm
if ($env:LEON_LAUNCHER_SMOKE_TEST -eq "1") {
    $form.Dispose()
    Write-Output "LEON launcher smoke OK"
    exit 0
}
Add-Log "LEON 启动器已打开。"
[void][System.Windows.Forms.Application]::Run($form)
