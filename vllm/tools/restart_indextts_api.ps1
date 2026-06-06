param(
    [int]$Port = 9880,
    [string]$HostAddress = "0.0.0.0",
    [int]$MaxWaitSeconds = 240,
    [int]$Retries = 3,
    [double]$VllmGpuMemoryUtilization = -1,
    [string]$LeonRoot = ""
)

$ErrorActionPreference = "Stop"

$Root = Resolve-Path (Join-Path $PSScriptRoot "..")
$WorkspaceRoot = if (-not [string]::IsNullOrWhiteSpace($LeonRoot)) {
    (Resolve-Path $LeonRoot).Path
}
else {
    (Resolve-Path (Join-Path $Root "..")).Path
}
$StaticDir = Join-Path $WorkspaceRoot "static"
$LogDir = Join-Path $WorkspaceRoot "logs\vllm"
New-Item -ItemType Directory -Force -Path $LogDir | Out-Null
Set-Location $Root

$InvariantCulture = [System.Globalization.CultureInfo]::InvariantCulture
if ($VllmGpuMemoryUtilization -le 0) {
    $configuredGpuUtil = $env:INDEXTTS_VLLM_GPU_MEMORY_UTILIZATION
    if (-not [string]::IsNullOrWhiteSpace($configuredGpuUtil)) {
        $parsedGpuUtil = 0.0
        if ([double]::TryParse($configuredGpuUtil, [System.Globalization.NumberStyles]::Float, $InvariantCulture, [ref]$parsedGpuUtil) -and $parsedGpuUtil -gt 0) {
            $VllmGpuMemoryUtilization = $parsedGpuUtil
        }
        else {
            Write-Host "[indextts-restart] Ignoring invalid INDEXTTS_VLLM_GPU_MEMORY_UTILIZATION=$configuredGpuUtil"
        }
    }
}
if ($VllmGpuMemoryUtilization -le 0) {
    $VllmGpuMemoryUtilization = 0.18
}
$VllmGpuMemoryUtilizationText = $VllmGpuMemoryUtilization.ToString("0.###", $InvariantCulture)

function Write-Step {
    param([string]$Message)
    Write-Host ("[indextts-restart] " + $Message)
}

function Get-FreeTcpPort {
    $listener = [System.Net.Sockets.TcpListener]::new([System.Net.IPAddress]::Parse("127.0.0.1"), 0)
    $listener.Start()
    try {
        return [int]$listener.LocalEndpoint.Port
    }
    finally {
        $listener.Stop()
    }
}

function Get-ListeningPidsForPort {
    param([int]$TargetPort)

    $pattern = ":" + $TargetPort + "$"
    $pids = @()
    netstat -ano -p tcp | Select-String "LISTENING" | ForEach-Object {
        $parts = $_.ToString().Trim() -split "\s+"
        if ($parts.Length -ge 5 -and $parts[1] -match $pattern) {
            $pids += [int]$parts[-1]
        }
    }
    return $pids | Sort-Object -Unique
}

function Get-ProcessInfo {
    param([int]$ProcessId)
    try {
        return Get-CimInstance Win32_Process -Filter "ProcessId = $ProcessId" -ErrorAction Stop
    }
    catch {
        return $null
    }
}

function Test-IsProjectProcess {
    param($ProcessInfo)
    if ($null -eq $ProcessInfo -or [string]::IsNullOrWhiteSpace($ProcessInfo.CommandLine)) {
        return $false
    }
    $rootPattern = [regex]::Escape($Root.Path)
    return ($ProcessInfo.CommandLine -match $rootPattern)
}

function Get-ChildProcessIds {
    param([int]$ParentProcessId)
    try {
        $children = Get-CimInstance Win32_Process -ErrorAction Stop |
            Where-Object { $_.ParentProcessId -eq $ParentProcessId }
    }
    catch {
        return
    }
    foreach ($child in $children) {
        Get-ChildProcessIds -ParentProcessId $child.ProcessId
        [int]$child.ProcessId
    }
}

function Stop-ProcessTree {
    param([int]$ProcessId)

    $childIds = @(Get-ChildProcessIds -ParentProcessId $ProcessId)
    foreach ($childId in $childIds | Sort-Object -Descending) {
        Stop-Process -Id $childId -Force -ErrorAction SilentlyContinue
    }
    Stop-Process -Id $ProcessId -Force -ErrorAction SilentlyContinue
}

function Get-GpuProjectPythonPids {
    if (-not (Get-Command nvidia-smi -ErrorAction SilentlyContinue)) {
        return @()
    }

    $pids = @()
    try {
        $lines = & nvidia-smi 2>$null
        foreach ($line in $lines) {
            if ($line -match "^\|\s*\d+\s+\S+\s+\S+\s+(\d+)\s+C\s+.*indextts2runtime\\python\.exe") {
                $pids += [int]$Matches[1]
            }
        }
    }
    catch {
        return @()
    }
    return $pids | Sort-Object -Unique
}

function Stop-OldProjectApi {
    $targets = @{}

    try {
        Get-CimInstance Win32_Process -Filter "name = 'python.exe'" -ErrorAction Stop |
            Where-Object { Test-IsProjectProcess $_ } |
            ForEach-Object { $targets[[int]$_.ProcessId] = "project python" }
    }
    catch {
        Write-Step "Win32_Process scan unavailable; using port/GPU fallbacks."
    }

    foreach ($gpuPid in @(Get-GpuProjectPythonPids)) {
        $targets[$gpuPid] = "project GPU python"
    }

    foreach ($checkPort in @($Port, 29550)) {
        foreach ($listenerPid in @(Get-ListeningPidsForPort -TargetPort $checkPort)) {
            $info = Get-ProcessInfo -ProcessId $listenerPid
            if (Test-IsProjectProcess $info) {
                $targets[$listenerPid] = "project listener :$checkPort"
            }
            else {
                Write-Step "Port $checkPort is owned by non-project PID $listenerPid; leaving it alone."
            }
        }
    }

    foreach ($targetPid in ($targets.Keys | Sort-Object -Descending)) {
        Write-Step "Stopping PID $targetPid ($($targets[$targetPid]))"
        Stop-ProcessTree -ProcessId $targetPid
    }

    if ($targets.Count -gt 0) {
        Start-Sleep -Seconds 3
    }
}

function Clear-StaleTorchExtensionLocks {
    $lockPaths = @(
        (Join-Path $Root "indextts\BigVGAN\alias_free_activation\cuda\build\lock"),
        (Join-Path $Root "indextts\s2mel\modules\bigvgan\alias_free_activation\cuda\build\lock")
    )

    foreach ($lockPath in $lockPaths) {
        if (Test-Path -LiteralPath $lockPath) {
            Write-Step "Removing stale torch extension lock: $lockPath"
            Remove-Item -LiteralPath $lockPath -Force -ErrorAction SilentlyContinue
        }
    }
}

function Initialize-ApiEnvironment {
    $scriptsPath = Join-Path $Root "indextts2runtime\Scripts"
    $env:LEON_ROOT = $WorkspaceRoot
    $env:LEON_VERSION_ROOT = $Root.Path
    $env:LEON_STATIC_DIR = $StaticDir
    $env:HF_HOME = Join-Path $Root "checkpoints"
    $env:PATH = $scriptsPath + ";" + $env:PATH

    $vswhere = "C:\Program Files (x86)\Microsoft Visual Studio\Installer\vswhere.exe"
    $vsInstallPath = $null
    if (Test-Path $vswhere) {
        $vsInstallPath = & $vswhere -latest -products * `
            -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 `
            -property installationPath
    }

    if ([string]::IsNullOrWhiteSpace($vsInstallPath)) {
        $candidateRoots = @(
            "C:\Program Files\Microsoft Visual Studio\2022\Community",
            "C:\Program Files\Microsoft Visual Studio\2022\BuildTools",
            "C:\Program Files (x86)\Microsoft Visual Studio\2022\Community",
            "C:\Program Files (x86)\Microsoft Visual Studio\2022\BuildTools"
        )
        $vsInstallPath = $candidateRoots | Where-Object { Test-Path $_ } | Select-Object -First 1
    }

    if ([string]::IsNullOrWhiteSpace($vsInstallPath)) {
        Write-Step "MSVC not found; BigVGAN CUDA kernel may fall back to torch."
        return
    }

    $vsDevCmd = Join-Path $vsInstallPath "Common7\Tools\VsDevCmd.bat"
    if (Test-Path $vsDevCmd) {
        $cmd = "`"$vsDevCmd`" -arch=x64 -host_arch=x64 >nul && set"
        $envLines = & cmd.exe /s /c $cmd
        foreach ($line in $envLines) {
            $idx = $line.IndexOf("=")
            if ($idx -gt 0) {
                $name = $line.Substring(0, $idx)
                $value = $line.Substring($idx + 1)
                Set-Item -Path ("Env:" + $name) -Value $value
            }
        }
        Write-Step "MSVC environment loaded: $vsInstallPath"
        return
    }

    $msvcRoot = Join-Path $vsInstallPath "VC\Tools\MSVC"
    $msvc = Get-ChildItem $msvcRoot -Directory -ErrorAction SilentlyContinue |
        Sort-Object Name -Descending |
        Select-Object -First 1
    if ($null -ne $msvc) {
        $msvcBin = Join-Path $msvc.FullName "bin\Hostx64\x64"
        $env:PATH = $env:PATH + ";" + $msvcBin
        Write-Step "MSVC bin loaded: $($msvc.Name)"
        return
    }

    Write-Step "MSVC install found, but no x64 compiler path was detected."
}

function Start-ApiProcess {
    param([int]$Attempt)

    $ts = Get-Date -Format "yyyyMMdd_HHmmss"
    $stdout = Join-Path $LogDir "api_restart_stable_${ts}_try${Attempt}.log"
    $stderr = Join-Path $LogDir "api_restart_stable_${ts}_try${Attempt}.err"
    $python = Join-Path $Root "indextts2runtime\python.exe"

    $env:INDEXTTS_VLLM_RPC_PORT = [string](Get-FreeTcpPort)
    $env:LEON_ROOT = $WorkspaceRoot
    $env:LEON_VERSION_ROOT = $Root.Path
    $env:LEON_STATIC_DIR = $StaticDir
    Write-Step "Using vLLM RPC port $env:INDEXTTS_VLLM_RPC_PORT"
    Write-Step "Using vLLM gpu_memory_utilization $VllmGpuMemoryUtilizationText"
    Write-Step "Using shared static dir $StaticDir"

    $args = @(
        "indextts2_api.py",
        "-a", $HostAddress,
        "-p", [string]$Port,
        "--vllm_gpu_memory_utilization", $VllmGpuMemoryUtilizationText,
        "--cuda_kernel",
        "--fp16"
    )
    if ($env:LEON_ENABLE_QWEN_EMO -eq "1") {
        $args += "--qwen_emo"
        Write-Step "Qwen emotion auto mode enabled."
    }
    else {
        $args += "--no_qwen_emo"
        Write-Step "Qwen emotion disabled."
    }

    $proc = Start-Process -FilePath $python `
        -ArgumentList $args `
        -WorkingDirectory $Root `
        -RedirectStandardOutput $stdout `
        -RedirectStandardError $stderr `
        -WindowStyle Hidden `
        -PassThru

    Write-Step "Started PID $($proc.Id)"
    Write-Step "stdout: $stdout"
    Write-Step "stderr: $stderr"

    return [pscustomobject]@{
        Process = $proc
        Stdout = $stdout
        Stderr = $stderr
    }
}

function Test-ApiHealth {
    try {
        $resp = Invoke-WebRequest -Uri "http://127.0.0.1:$Port/health" -UseBasicParsing -TimeoutSec 2
        return ($resp.StatusCode -eq 200)
    }
    catch {
        return $false
    }
}

function Get-FatalStartupError {
    param([string]$StderrPath)

    if (-not (Test-Path $StderrPath)) {
        return $null
    }

    $content = Get-Content $StderrPath -Raw -ErrorAction SilentlyContinue
    if ([string]::IsNullOrWhiteSpace($content)) {
        return $null
    }

    if ($content -match "Address in use") {
        return "internal port address-in-use"
    }
    if ($content -match "Error in memory profiling") {
        return "vLLM GPU memory profiling changed during startup"
    }
    if ($content -match "EngineCore failed to start|EngineCore encountered an issue") {
        return "vLLM engine core failed"
    }
    return $null
}

function Wait-ApiReady {
    param($Run)

    $lastNotice = -10
    for ($elapsed = 0; $elapsed -le $MaxWaitSeconds; $elapsed += 2) {
        if (Test-ApiHealth) {
            return $true
        }

        $Run.Process.Refresh()
        if ($Run.Process.HasExited) {
            Write-Step "Process exited before health check passed."
            return $false
        }

        $fatal = Get-FatalStartupError -StderrPath $Run.Stderr
        if ($null -ne $fatal) {
            Write-Step "Startup failed: $fatal"
            return $false
        }

        if (($elapsed - $lastNotice) -ge 10) {
            Write-Step "Waiting for health check... ${elapsed}s"
            $lastNotice = $elapsed
        }
        Start-Sleep -Seconds 2
    }

    Write-Step "Health check timed out after ${MaxWaitSeconds}s."
    return $false
}

$restartMutexName = "Local\LEON.IndexTTS2.ApiRestart.$Port"
$restartMutex = New-Object System.Threading.Mutex($false, $restartMutexName)
$restartMutexAcquired = $false

try {
    try {
        $restartMutexAcquired = $restartMutex.WaitOne(0)
    }
    catch [System.Threading.AbandonedMutexException] {
        $restartMutexAcquired = $true
    }
    if (-not $restartMutexAcquired) {
        Write-Step "Startup mutex is already held; clearing old project processes and continuing."
    }

    Initialize-ApiEnvironment

    for ($attempt = 1; $attempt -le $Retries; $attempt++) {
        Write-Step "Restart attempt $attempt/$Retries"
        Stop-OldProjectApi
        Clear-StaleTorchExtensionLocks
        $run = Start-ApiProcess -Attempt $attempt

        if (Wait-ApiReady -Run $run) {
            Write-Step "API ready: http://127.0.0.1:$Port/health"
            Write-Step "LAN script URL example: http://192.168.8.100:$Port/static/tavo.js"
            exit 0
        }

        Stop-ProcessTree -ProcessId $run.Process.Id
        if ($attempt -lt $Retries) {
            Write-Step "Retrying in 6 seconds..."
            Start-Sleep -Seconds 6
        }
    }

    Write-Error "API failed to start after $Retries attempts. Check latest api_restart_stable_*.err under $LogDir."
    exit 1
}
finally {
    if ($restartMutexAcquired) {
        try { $restartMutex.ReleaseMutex() } catch {}
    }
    if ($restartMutex) {
        $restartMutex.Dispose()
    }
}
