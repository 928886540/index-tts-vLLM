param(
    [Parameter(Mandatory = $true)]
    [ValidateSet("vllm", "fast6g")]
    [string]$Version,
    [int]$Port = 9880,
    [string]$HostAddress = "0.0.0.0",
    [int]$MaxWaitSeconds = 240,
    [int]$Retries = 3,
    [double]$VllmGpuMemoryUtilization = -1,
    [string]$EnableMsvc = "",
    [string]$LeonRoot = "",
    [switch]$ValidateOnly
)

$ErrorActionPreference = "Stop"

$Utf8NoBomEncoding = New-Object System.Text.UTF8Encoding($false)
try {
    [Console]::OutputEncoding = $Utf8NoBomEncoding
    [Console]::InputEncoding = $Utf8NoBomEncoding
    $OutputEncoding = $Utf8NoBomEncoding
}
catch {
}

$Version = $Version.ToLowerInvariant()
$env:PYTHONUTF8 = "1"
$env:PYTHONIOENCODING = "utf-8"
$env:LEON_ENABLE_QWEN_EMO = "0"

function Write-Step {
    param([string]$Message)
    Write-Host ("[leon-restart] " + $Message)
}

function Resolve-DirectoryPath {
    param(
        [string]$Path,
        [string]$Label
    )
    if ([string]::IsNullOrWhiteSpace($Path) -or -not (Test-Path -LiteralPath $Path -PathType Container)) {
        throw "$Label missing: $Path"
    }
    return (Resolve-Path -LiteralPath $Path).Path
}

function Resolve-FilePath {
    param(
        [string]$Path,
        [string]$Label
    )
    if ([string]::IsNullOrWhiteSpace($Path) -or -not (Test-Path -LiteralPath $Path -PathType Leaf)) {
        throw "$Label missing: $Path"
    }
    return (Resolve-Path -LiteralPath $Path).Path
}

$WorkspaceRoot = if (-not [string]::IsNullOrWhiteSpace($LeonRoot)) {
    Resolve-DirectoryPath -Path $LeonRoot -Label "LEON root"
}
else {
    Resolve-DirectoryPath -Path (Join-Path $PSScriptRoot "..") -Label "LEON root"
}
$VersionRoot = Resolve-DirectoryPath -Path (Join-Path $WorkspaceRoot $Version) -Label "engine root"
$StaticDir = Resolve-DirectoryPath -Path (Join-Path $WorkspaceRoot "static") -Label "shared static dir"
$VoiceLibraryRoot = Resolve-DirectoryPath -Path (Join-Path $WorkspaceRoot "prompts\library") -Label "shared voice library"
$LogDir = Join-Path $WorkspaceRoot ("logs\" + $Version)
$ActiveProfilePath = Join-Path $WorkspaceRoot "config\profiles\active.json"
New-Item -ItemType Directory -Force -Path $LogDir | Out-Null

function Get-JsonProperty {
    param(
        $Object,
        [string]$Name
    )
    if ($null -eq $Object) {
        return $null
    }
    $property = $Object.PSObject.Properties[$Name]
    if ($null -eq $property) {
        return $null
    }
    return $property.Value
}

function Test-FalseValue {
    param($Value)
    if ($null -eq $Value) {
        return $false
    }
    $text = [string]$Value
    return @("0", "false", "no", "off") -contains $text.Trim().ToLowerInvariant()
}

function Assert-ObjectProperty {
    param(
        $Object,
        [string]$Name,
        [string]$Label
    )
    $value = Get-JsonProperty -Object $Object -Name $Name
    if ($null -eq $value -or $value -isnot [System.Management.Automation.PSCustomObject]) {
        throw "$Label must contain object property '$Name'."
    }
    return $value
}

function Assert-Preset {
    param(
        $Presets,
        [string]$Stream,
        [string]$Mode
    )
    $streamObject = Get-JsonProperty -Object $Presets -Name $Stream
    if ($null -eq $streamObject -or $streamObject -isnot [System.Management.Automation.PSCustomObject]) {
        throw "active profile missing quality.presets.$Stream."
    }
    $preset = Get-JsonProperty -Object $streamObject -Name $Mode
    if ($null -eq $preset -or $preset -isnot [System.Management.Automation.PSCustomObject]) {
        throw "active profile missing quality.presets.$Stream.$Mode."
    }
}

function Resolve-StyleReferencePath {
    param([string]$Reference)

    if ([string]::IsNullOrWhiteSpace($Reference)) {
        return $null
    }

    $candidate = if ([System.IO.Path]::IsPathRooted($Reference)) {
        $Reference
    }
    else {
        Join-Path $VoiceLibraryRoot $Reference
    }
    if (Test-Path -LiteralPath $candidate -PathType Leaf) {
        return (Resolve-Path -LiteralPath $candidate).Path
    }

    if ([string]::IsNullOrWhiteSpace([System.IO.Path]::GetExtension($candidate))) {
        foreach ($extension in @(".wav", ".mp3", ".flac", ".ogg", ".m4a")) {
            $withExtension = $candidate + $extension
            if (Test-Path -LiteralPath $withExtension -PathType Leaf) {
                return (Resolve-Path -LiteralPath $withExtension).Path
            }
        }
    }

    return $null
}

function Assert-ActiveProfile {
    $profilePath = Resolve-FilePath -Path $ActiveProfilePath -Label "active profile"
    try {
        $profile = Get-Content -LiteralPath $profilePath -Raw -Encoding UTF8 | ConvertFrom-Json
    }
    catch {
        throw "active profile JSON is invalid: $profilePath :: $($_.Exception.Message)"
    }

    if ($profile -isnot [System.Management.Automation.PSCustomObject]) {
        throw "active profile must be a JSON object: $profilePath"
    }

    $versionValue = Get-JsonProperty -Object $profile -Name "version"
    if ([int]$versionValue -lt 3) {
        throw "active profile schema version must be >= 3: $profilePath"
    }

    $quality = Assert-ObjectProperty -Object $profile -Name "quality" -Label "active profile"
    $defaultMode = [string](Get-JsonProperty -Object $quality -Name "defaultMode")
    if ([string]::IsNullOrWhiteSpace($defaultMode)) {
        throw "active profile missing quality.defaultMode."
    }
    $presets = Assert-ObjectProperty -Object $quality -Name "presets" -Label "active profile quality"
    Assert-Preset -Presets $presets -Stream "live" -Mode $defaultMode
    Assert-Preset -Presets $presets -Stream "generate" -Mode $defaultMode

    $modesValue = Get-JsonProperty -Object $quality -Name "modes"
    $modes = @()
    if ($null -ne $modesValue) {
        $modes = @($modesValue)
    }
    if ($modes.Count -eq 0) {
        throw "active profile missing quality.modes."
    }
    foreach ($mode in $modes) {
        $modeId = [string](Get-JsonProperty -Object $mode -Name "id")
        if ([string]::IsNullOrWhiteSpace($modeId) -or $modeId -eq "custom") {
            continue
        }
        Assert-Preset -Presets $presets -Stream "live" -Mode $modeId
        Assert-Preset -Presets $presets -Stream "generate" -Mode $modeId
    }

    $styles = Assert-ObjectProperty -Object $profile -Name "styles" -Label "active profile"
    foreach ($styleProperty in $styles.PSObject.Properties) {
        $styleId = $styleProperty.Name
        $style = $styleProperty.Value
        if ($style -isnot [System.Management.Automation.PSCustomObject]) {
            throw "active profile style '$styleId' must be an object."
        }
        if ($styleId -eq "neutral" -or (Test-FalseValue (Get-JsonProperty -Object $style -Name "enabled"))) {
            continue
        }

        $references = @()
        $refsValue = Get-JsonProperty -Object $style -Name "refs"
        if ($null -ne $refsValue) {
            $references += @($refsValue)
        }
        $singleRef = Get-JsonProperty -Object $style -Name "ref"
        if ($null -ne $singleRef) {
            $references += @($singleRef)
        }
        $references = @($references | Where-Object { -not [string]::IsNullOrWhiteSpace([string]$_) } | Select-Object -Unique)
        if ($references.Count -eq 0) {
            throw "enabled non-neutral style '$styleId' has no refs."
        }
        foreach ($reference in $references) {
            $resolved = Resolve-StyleReferencePath -Reference ([string]$reference)
            if ([string]::IsNullOrWhiteSpace($resolved)) {
                throw "style '$styleId' ref does not resolve under prompts/library: $reference"
            }
        }
    }

    Write-Step "Active profile OK: $profilePath"
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
    $rootPattern = [regex]::Escape($WorkspaceRoot)
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
        $info = Get-ProcessInfo -ProcessId $gpuPid
        if (Test-IsProjectProcess $info) {
            $targets[$gpuPid] = "project GPU python"
        }
    }

    $ports = @($Port)
    if ($Version -eq "vllm") {
        $ports += 29550
    }
    foreach ($checkPort in $ports) {
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

function Write-GpuSummary {
    if (-not (Get-Command nvidia-smi -ErrorAction SilentlyContinue)) {
        Write-Step "GPU summary unavailable: nvidia-smi not found."
        return
    }

    try {
        $gpuLines = & nvidia-smi --query-gpu=name,memory.total,memory.free --format=csv,noheader,nounits 2>$null
        foreach ($line in $gpuLines) {
            if (-not [string]::IsNullOrWhiteSpace($line)) {
                Write-Step "GPU: $line MiB total/free"
            }
        }
    }
    catch {
        Write-Step "GPU summary failed: $($_.Exception.Message)"
    }
}

function Initialize-CommonEnvironment {
    $scriptsPath = Join-Path $VersionRoot "indextts2runtime\Scripts"
    $env:LEON_ROOT = $WorkspaceRoot
    $env:LEON_VERSION_ROOT = $VersionRoot
    $env:LEON_STATIC_DIR = $StaticDir
    $env:LEON_LAUNCHER_VERSION = $Version
    $env:LEON_ACTIVE_PROFILE_PATH = $ActiveProfilePath
    $env:HF_HOME = Join-Path $VersionRoot "checkpoints"
    if (Test-Path -LiteralPath $scriptsPath -PathType Container) {
        $env:PATH = $scriptsPath + ";" + $env:PATH
    }

    Write-Step "Version: $Version"
    Write-Step "Root: $WorkspaceRoot"
    Write-Step "Engine root: $VersionRoot"
    Write-Step "Static dir: $StaticDir"
    Write-Step "Voice library: $VoiceLibraryRoot"
    Write-Step "Log dir: $LogDir"
}

function Start-Fast6gApiProcess {
    param([int]$Attempt)

    $ts = Get-Date -Format "yyyyMMdd_HHmmss"
    $stdout = Join-Path $LogDir "api_restart_stable_${ts}_try${Attempt}.log"
    $stderr = Join-Path $LogDir "api_restart_stable_${ts}_try${Attempt}.err"
    $python = Resolve-FilePath -Path (Join-Path $VersionRoot "indextts2runtime\python.exe") -Label "fast6g Python runtime"
    $entry = Resolve-FilePath -Path (Join-Path $VersionRoot "indextts2_api.py") -Label "fast6g API entry"

    Write-Step "Using shared static dir $StaticDir"
    Write-Step "Qwen emotion disabled (deprecated for LEON voice-cavity mode)."

    $args = @(
        $entry,
        "-a", $HostAddress,
        "-p", [string]$Port,
        "--fp16",
        "--no_qwen_emo"
    )

    $proc = Start-Process -FilePath $python `
        -ArgumentList $args `
        -WorkingDirectory $VersionRoot `
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

    if (-not (Test-Path -LiteralPath $StderrPath)) {
        return $null
    }

    $content = Get-Content -LiteralPath $StderrPath -Raw -ErrorAction SilentlyContinue
    if ([string]::IsNullOrWhiteSpace($content)) {
        return $null
    }

    if ($content -match "Address in use") {
        return "API port address-in-use"
    }
    if ($content -match "No module named|ModuleNotFoundError|ImportError") {
        return "runtime import failed"
    }
    if ($content -match "active profile|Profile|profile") {
        return "active profile configuration failed"
    }
    if ($content -match "Traceback") {
        return "Python traceback during startup"
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

function Invoke-VllmRestart {
    $legacyEntry = Resolve-FilePath -Path (Join-Path $VersionRoot "tools\restart_indextts_api.ps1") -Label "vLLM restart entry"
    $legacyArgs = @(
        "-Port", [string]$Port,
        "-HostAddress", $HostAddress,
        "-MaxWaitSeconds", [string]$MaxWaitSeconds,
        "-Retries", [string]$Retries,
        "-LeonRoot", $WorkspaceRoot
    )
    if ($VllmGpuMemoryUtilization -gt 0) {
        $legacyArgs += @("-VllmGpuMemoryUtilization", [string]$VllmGpuMemoryUtilization)
    }
    if (-not [string]::IsNullOrWhiteSpace($EnableMsvc)) {
        $legacyArgs += @("-EnableMsvc", $EnableMsvc)
    }
    Write-Step "Delegating vLLM engine startup: $legacyEntry"
    & $legacyEntry @legacyArgs
    exit $LASTEXITCODE
}

$restartMutexName = "Local\LEON.IndexTTS2.CommonApiRestart.$Port"
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
        if ($ValidateOnly) {
            Write-Step "Startup mutex is already held; validate-only continues without cleanup."
        }
        else {
            Write-Step "Startup mutex is already held; clearing old project processes and continuing."
        }
    }

    Initialize-CommonEnvironment
    Assert-ActiveProfile
    Write-GpuSummary
    if ($ValidateOnly) {
        Write-Step "Validation complete; not starting API because -ValidateOnly was set."
        exit 0
    }
    Stop-OldProjectApi

    if ($Version -eq "vllm") {
        Invoke-VllmRestart
    }

    for ($attempt = 1; $attempt -le $Retries; $attempt++) {
        Write-Step "Restart attempt $attempt/$Retries"
        $run = Start-Fast6gApiProcess -Attempt $attempt

        if (Wait-ApiReady -Run $run) {
            Write-Step "API ready: http://127.0.0.1:$Port/health"
            Write-Step "LAN script URL example: http://<LAN-IP>:$Port/static/tavo.js"
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
