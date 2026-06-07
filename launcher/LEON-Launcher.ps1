$ErrorActionPreference = "Continue"

Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing

[System.Windows.Forms.Application]::EnableVisualStyles()

$Script:Utf8NoBomEncoding = New-Object System.Text.UTF8Encoding($false)
try {
    [Console]::OutputEncoding = $Script:Utf8NoBomEncoding
    [Console]::InputEncoding = $Script:Utf8NoBomEncoding
    $OutputEncoding = $Script:Utf8NoBomEncoding
}
catch {
}

function Get-PreferredLanHost {
    try {
        $addresses = [System.Net.NetworkInformation.NetworkInterface]::GetAllNetworkInterfaces() |
            Where-Object { $_.OperationalStatus -eq [System.Net.NetworkInformation.OperationalStatus]::Up -and $_.NetworkInterfaceType -ne [System.Net.NetworkInformation.NetworkInterfaceType]::Loopback } |
            ForEach-Object { $_.GetIPProperties().UnicastAddresses } |
            Where-Object { $_.Address.AddressFamily -eq [System.Net.Sockets.AddressFamily]::InterNetwork } |
            ForEach-Object { $_.Address.IPAddressToString } |
            Where-Object { $_ -and $_ -notmatch '^169\.254\.' -and $_ -ne '127.0.0.1' }
        $preferred = @($addresses | Where-Object { $_ -match '^(192\.168\.|10\.|172\.(1[6-9]|2[0-9]|3[0-1])\.)' } | Select-Object -First 1)
        if ($preferred.Count -gt 0) { return [string]$preferred[0] }
        $fallback = @($addresses | Select-Object -First 1)
        if ($fallback.Count -gt 0) { return [string]$fallback[0] }
    }
    catch {
    }
    return "127.0.0.1"
}

$Script:LauncherScriptPath = if ($env:LEON_LAUNCHER_SCRIPT) { $env:LEON_LAUNCHER_SCRIPT } else { $MyInvocation.MyCommand.Path }
$Script:LauncherDir = if ($Script:LauncherScriptPath) { Split-Path -Parent $Script:LauncherScriptPath } else { (Get-Location).Path }
$Script:WorkspaceRoot = (Resolve-Path (Join-Path $Script:LauncherDir "..")).Path
$Script:LauncherWindowTitle = "LEON 启动器 - IndexTTS2"
$Script:SingleInstanceMutexName = "Local\LEON.IndexTTS2.Launcher"
$Script:SingleInstanceMutex = $null
$Script:ApiPort = 9880
$Script:ApiBase = "http://127.0.0.1:$Script:ApiPort"
$Script:WebUiPort = 7860
$Script:WebUiBase = "http://127.0.0.1:$Script:WebUiPort"
$Script:LanHost = if ($env:LEON_LAN_HOST) { $env:LEON_LAN_HOST } else { Get-PreferredLanHost }
$Script:TavoCacheBust = "20260606-live-audio-v7"
$Script:VersionKey = if ($env:LEON_LAUNCHER_VERSION) { $env:LEON_LAUNCHER_VERSION } else { "vllm" }
$Script:EnableQwenEmotion = $false
$Script:InvariantCulture = [System.Globalization.CultureInfo]::InvariantCulture
$Script:VllmGpuMemoryUtilization = 0.15
if (-not [string]::IsNullOrWhiteSpace($env:INDEXTTS_VLLM_GPU_MEMORY_UTILIZATION)) {
    $configuredGpuUtil = 0.0
    if ([double]::TryParse($env:INDEXTTS_VLLM_GPU_MEMORY_UTILIZATION, [System.Globalization.NumberStyles]::Float, $Script:InvariantCulture, [ref]$configuredGpuUtil) -and $configuredGpuUtil -gt 0) {
        $Script:VllmGpuMemoryUtilization = $configuredGpuUtil
    }
}
$Script:RepoRoot = $null
$Script:StartupBat = $null
$Script:WebUiStartupBat = $null
$Script:RuntimePython = $null
$Script:RuntimeScripts = $null
$Script:LogDir = $null
$Script:BannerPath = Join-Path $Script:LauncherDir "head.png"
$Script:HeroPath = Join-Path $Script:LauncherDir "head.png"
$Script:HomeImagePath = Join-Path $Script:LauncherDir "home.png"
$Script:SideImagePath = Join-Path $Script:LauncherDir "left.png"
$Script:AvatarPath = Join-Path $Script:LauncherDir "leon-avatar.jpeg"
$Script:IconPath = Join-Path $Script:LauncherDir "leon-launcher.ico"
$Script:SvmlSource = $null
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
$Script:VersionCombo = $null
$Script:QwenEmotionCheck = $null
$Script:VllmGpuCombo = $null
$Script:Tabs = $null
$Script:BackendLogTimer = $null
$Script:WarmupStarted = $false
$Script:ApiReadyWaitActive = $false
$Script:WebUiBrowser = $null
$Script:WebUiStatusLabel = $null
$Script:HomePanel = $null
$Script:LogPanel = $null
$Script:EnvPanel = $null
$Script:RepairPanel = $null
$Script:EnvVersionLabel = $null
$Script:LauncherLogBox = $null
$Script:ApiLogBox = $null
$Script:StartupOutLogBox = $null
$Script:StartupErrLogBox = $null
$Script:BackendLogBox = $null
$Script:LogBox = $null
$Script:LogViewport = $null
$Script:LogContentLabel = $null
$Script:LogScrollTrack = $null
$Script:LogScrollThumb = $null
$Script:LogScrollOffset = 0
$Script:LogScrollDragging = $false
$Script:LogScrollDragScreenY = 0
$Script:LogScrollDragOffset = 0
$Script:EnvCheckRows = @{}
$Script:EnvCheckResults = @{}
$Script:EnvCheckStateByVersion = @{}
$Script:EnvCheckVersion = ""
$Script:EnvCheckCompleted = $false
$Script:EnvCheckLastRun = $null
$Script:EnvCheckFail = 0
$Script:EnvCheckWarn = 0
$Script:EnvCheckRecording = $false
$Script:RepairStatusLabels = @{}
$Script:RepairDetailLabels = @{}
$Script:RepairSummaryLabel = $null
$Script:VllmGpuShell = $null
$Script:VllmGpuTooltip = $null
$Script:NavButtons = @{}
$Script:LogTabButtons = @{}
$Script:LogTexts = @{}
$Script:ActiveLogTab = "launcher"
$Script:ServiceTransition = $false
$Script:ServiceTransitionText = ""
$Script:LauncherResizeActive = $false

function Get-VllmGpuMemoryUtilizationText {
    return $Script:VllmGpuMemoryUtilization.ToString("0.###", $Script:InvariantCulture)
}

function Get-VllmGpuMemoryLabel {
    $text = Get-VllmGpuMemoryUtilizationText
    if ([Math]::Abs($Script:VllmGpuMemoryUtilization - 0.15) -lt 0.0001) { return "0.15 默认" }
    if ([Math]::Abs($Script:VllmGpuMemoryUtilization - 0.11) -lt 0.0001) { return "0.11 保守" }
    return "$text 自定义"
}

function Set-VllmGpuMemoryUtilization {
    param([string]$Value)
    if ([string]::IsNullOrWhiteSpace($Value)) { return }
    if ($Value -match "([0-9]+(?:\.[0-9]+)?)") {
        $parsed = 0.0
        if ([double]::TryParse($Matches[1], [System.Globalization.NumberStyles]::Float, $Script:InvariantCulture, [ref]$parsed) -and $parsed -gt 0) {
            $Script:VllmGpuMemoryUtilization = $parsed
        }
    }
}

function Sync-VllmGpuControls {
    if (-not $Script:VllmGpuCombo) { return }
    $showRatio = ($Script:VersionKey -eq "vllm")
    if ($Script:VllmGpuCombo -is [System.Windows.Forms.ComboBox]) {
        $label = Get-VllmGpuMemoryLabel
        if (-not $Script:VllmGpuCombo.Items.Contains($label)) {
            [void]$Script:VllmGpuCombo.Items.Add($label)
        }
        $Script:VllmGpuCombo.Text = $label
    }
    else {
        $Script:VllmGpuCombo.Text = Get-VllmGpuMemoryUtilizationText
    }
    $Script:VllmGpuCombo.Enabled = $showRatio
    $Script:VllmGpuCombo.Visible = $showRatio
    if ($Script:VllmGpuShell) {
        $Script:VllmGpuShell.Visible = $showRatio
        $Script:VllmGpuShell.Enabled = $showRatio
    }
    if ($Script:VersionCombo -and $Script:VersionCombo.Tag -eq "segmented-version") {
        foreach ($ctrl in $Script:VersionCombo.Controls) {
            if (-not ($ctrl -is [System.Windows.Forms.Button])) { continue }
            $isActive = ([string]$ctrl.Tag -eq $Script:VersionKey)
            if ($isActive) {
                $ctrl.BackColor = [System.Drawing.Color]::FromArgb(48, 68, 88)
                $ctrl.ForeColor = [System.Drawing.Color]::White
                $ctrl.FlatAppearance.BorderColor = [System.Drawing.Color]::FromArgb(110, 145, 175)
            }
            else {
                $ctrl.BackColor = [System.Drawing.Color]::FromArgb(24, 31, 39)
                $ctrl.ForeColor = [System.Drawing.Color]::FromArgb(202, 212, 222)
                $ctrl.FlatAppearance.BorderColor = [System.Drawing.Color]::FromArgb(46, 56, 68)
            }
        }
    }
    elseif ($Script:VersionCombo -and $Script:VersionCombo.Tag -eq "compact-version") {
        if ($showRatio) { $Script:VersionCombo.Width = 112 } else { $Script:VersionCombo.Width = 204 }
    }
}

function Get-LeonVersionLabelText {
    param([string]$VersionKey = $Script:VersionKey)
    if ([string]$VersionKey -eq "fast6g") { return "fast6g 双加速 6G" }
    return "vllm 质量版"
}

function Get-LeonRuntimePackageNames {
    param([string]$VersionKey = $Script:VersionKey)
    if ([string]$VersionKey -eq "vllm") {
        return @("torch", "torchaudio", "vllm", "fastapi", "uvicorn", "ninja", "triton")
    }
    return @("torch", "torchaudio", "fastapi", "uvicorn", "modelscope", "transformers")
}

function Get-Fast6gDeepSpeedWheelPath {
    return (Join-Path $Script:RepoRoot "deepspeed-0.17.1+unknown-cp312-cp312-win_amd64.whl")
}

function Set-LeonVersion {
    param([string]$VersionKey)
    $key = [string]$VersionKey
    if ($key -notin @("vllm", "fast6g")) { $key = "vllm" }
    $Script:VersionKey = $key
    $Script:RepoRoot = Join-Path $Script:WorkspaceRoot $key
    $Script:RuntimePython = Join-Path $Script:RepoRoot "indextts2runtime\python.exe"
    $Script:RuntimeScripts = Join-Path $Script:RepoRoot "indextts2runtime\Scripts"
    $Script:LogDir = Join-Path $Script:WorkspaceRoot ("logs\" + $key)
    $Script:SvmlSource = Join-Path $Script:WorkspaceRoot "dev_workspace\llvm_error_fix\svml_dispmd.dll"
    if ($key -eq "fast6g") {
        $Script:StartupBat = Join-Path $Script:WorkspaceRoot "scripts\start-fast6g-api.bat"
        $Script:WebUiStartupBat = Join-Path $Script:WorkspaceRoot "scripts\start-fast6g-webui.bat"
    }
    else {
        $Script:StartupBat = Join-Path $Script:WorkspaceRoot "scripts\start-vllm-api.bat"
        $Script:WebUiStartupBat = Join-Path $Script:WorkspaceRoot "scripts\start-vllm-webui.bat"
    }
    if ($Script:VersionCombo -and $Script:VersionCombo -is [System.Windows.Forms.ComboBox]) {
        $Script:VersionCombo.SelectedItem = $key
    }
    if ($Script:QwenEmotionCheck) {
        $Script:QwenEmotionCheck.Checked = [bool]$Script:EnableQwenEmotion
    }
    Sync-VllmGpuControls
    $Script:RuntimeImportProbe = $null
    if ($Script:EnvVersionLabel) {
        $Script:EnvVersionLabel.Text = "当前检测 / 修复：$(Get-LeonVersionLabelText $key)"
    }
    if ($Script:CheckList) {
        Restore-EnvironmentCheckState -VersionKey $key
    }
}

Set-LeonVersion $Script:VersionKey

function Get-LeonVersionLabel {
    return (Get-LeonVersionLabelText $Script:VersionKey)
}

function Get-VoiceAudioFiles {
    param([string]$Directory)
    if ([string]::IsNullOrWhiteSpace($Directory) -or -not (Test-Path -LiteralPath $Directory -PathType Container)) {
        return @()
    }
    try {
        return @(Get-ChildItem -LiteralPath $Directory -Recurse -File -Include *.wav,*.mp3,*.flac,*.ogg,*.m4a -ErrorAction SilentlyContinue)
    }
    catch {
        return @()
    }
}

function Get-VoiceLibraryDir {
    $explicit = [string]$env:LEON_VOICE_LIB_DIR
    if (-not [string]::IsNullOrWhiteSpace($explicit) -and (Test-Path -LiteralPath $explicit -PathType Container)) {
        return (Resolve-Path -LiteralPath $explicit).Path
    }
    $candidates = @(
        (Join-Path $Script:RepoRoot "prompts\library"),
        (Join-Path $Script:WorkspaceRoot "prompts\library"),
        (Join-Path $Script:WorkspaceRoot "vllm\prompts\library")
    )
    $existing = @()
    foreach ($candidate in $candidates) {
        if ([string]::IsNullOrWhiteSpace($candidate) -or -not (Test-Path -LiteralPath $candidate -PathType Container)) {
            continue
        }
        $resolved = (Resolve-Path -LiteralPath $candidate).Path
        $existing += $resolved
        if (@(Get-VoiceAudioFiles -Directory $resolved).Count -gt 0) {
            return $resolved
        }
    }
    if ($existing.Count -gt 0) { return [string]$existing[0] }
    return (Join-Path $Script:RepoRoot "prompts\library")
}

function Sync-LeonVersionControls {
    if ($Script:VersionCombo -and $Script:VersionCombo -is [System.Windows.Forms.ComboBox]) {
        $Script:VersionCombo.SelectedItem = $Script:VersionKey
    }
    if ($Script:QwenEmotionCheck) {
        $Script:QwenEmotionCheck.Checked = [bool]$Script:EnableQwenEmotion
    }
    Sync-VllmGpuControls
}

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

try {
    if (-not ([System.Management.Automation.PSTypeName]'LeonLauncherNative').Type) {
        Add-Type @"
using System;
using System.Runtime.InteropServices;

public static class LeonLauncherNative
{
    [DllImport("user32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    public static extern IntPtr FindWindow(string lpClassName, string lpWindowName);

    [DllImport("user32.dll")]
    public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);

    [DllImport("user32.dll")]
    public static extern bool SetForegroundWindow(IntPtr hWnd);
}
"@
    }
}
catch {
}

function Show-ExistingLauncherWindow {
    try {
        $hwnd = [LeonLauncherNative]::FindWindow($null, $Script:LauncherWindowTitle)
        if ($hwnd -and $hwnd -ne [IntPtr]::Zero) {
            [void][LeonLauncherNative]::ShowWindow($hwnd, 9)
            [void][LeonLauncherNative]::SetForegroundWindow($hwnd)
            return $true
        }
    }
    catch {
    }
    return $false
}

function Initialize-LauncherSingleInstance {
    if ($env:LEON_LAUNCHER_SMOKE_TEST -eq "1") { return }
    if (Show-ExistingLauncherWindow) {
        exit 0
    }
    $createdNew = $false
    try {
        $Script:SingleInstanceMutex = New-Object System.Threading.Mutex($true, $Script:SingleInstanceMutexName, [ref]$createdNew)
        if (-not $createdNew) {
            [void](Show-ExistingLauncherWindow)
            if ($Script:SingleInstanceMutex) {
                $Script:SingleInstanceMutex.Dispose()
                $Script:SingleInstanceMutex = $null
            }
            exit 0
        }
    }
    catch {
    }
}

function Release-LauncherSingleInstance {
    if (-not $Script:SingleInstanceMutex) { return }
    try {
        $Script:SingleInstanceMutex.ReleaseMutex()
    }
    catch {
    }
    try {
        $Script:SingleInstanceMutex.Dispose()
    }
    catch {
    }
    $Script:SingleInstanceMutex = $null
}

function New-Font {
    param([float]$Size, [System.Drawing.FontStyle]$Style = [System.Drawing.FontStyle]::Regular)
    return New-Object System.Drawing.Font("Microsoft YaHei UI", $Size, $Style)
}

function Get-CoverImageRectangle {
    param(
        [System.Drawing.Image]$Image,
        [System.Drawing.Rectangle]$Bounds,
        [string]$HorizontalAlign = "Center",
        [string]$VerticalAlign = "Center"
    )
    if (-not $Image -or $Bounds.Width -le 0 -or $Bounds.Height -le 0 -or $Image.Width -le 0 -or $Image.Height -le 0) {
        return [System.Drawing.Rectangle]::Empty
    }
    $scale = [Math]::Max($Bounds.Width / [double]$Image.Width, $Bounds.Height / [double]$Image.Height)
    $drawWidth = [int][Math]::Ceiling($Image.Width * $scale)
    $drawHeight = [int][Math]::Ceiling($Image.Height * $scale)
    switch ($HorizontalAlign) {
        "Left" { $x = $Bounds.Left }
        "Right" { $x = $Bounds.Right - $drawWidth }
        default { $x = $Bounds.Left + [int][Math]::Floor(($Bounds.Width - $drawWidth) / 2) }
    }
    switch ($VerticalAlign) {
        "Top" { $y = $Bounds.Top }
        "Bottom" { $y = $Bounds.Bottom - $drawHeight }
        default { $y = $Bounds.Top + [int][Math]::Floor(($Bounds.Height - $drawHeight) / 2) }
    }
    return (New-Object System.Drawing.Rectangle -ArgumentList @($x, $y, $drawWidth, $drawHeight))
}

function Get-FitWidthImageRectangle {
    param(
        [System.Drawing.Image]$Image,
        [System.Drawing.Rectangle]$Bounds,
        [string]$VerticalAlign = "Center"
    )
    if (-not $Image -or $Bounds.Width -le 0 -or $Bounds.Height -le 0 -or $Image.Width -le 0 -or $Image.Height -le 0) {
        return [System.Drawing.Rectangle]::Empty
    }
    $scale = $Bounds.Width / [double]$Image.Width
    $drawWidth = $Bounds.Width
    $drawHeight = [int][Math]::Ceiling($Image.Height * $scale)
    $x = $Bounds.Left
    switch ($VerticalAlign) {
        "Top" { $y = $Bounds.Top }
        "Bottom" { $y = $Bounds.Bottom - $drawHeight }
        default { $y = $Bounds.Top + [int][Math]::Floor(($Bounds.Height - $drawHeight) / 2) }
    }
    return (New-Object System.Drawing.Rectangle -ArgumentList @($x, $y, $drawWidth, $drawHeight))
}

function Enable-DoubleBuffer {
    param([System.Windows.Forms.Control]$Control)
    if (-not $Control) { return }
    try {
        $prop = [System.Windows.Forms.Control].GetProperty("DoubleBuffered", [System.Reflection.BindingFlags] "NonPublic,Instance")
        $prop.SetValue($Control, $true, $null)
    }
    catch {
    }
}

function Add-CoverImageBackground {
    param(
        [System.Windows.Forms.Control]$Control,
        [string]$ImagePath,
        [string]$Description,
        [string]$HorizontalAlign = "Center",
        [string]$VerticalAlign = "Center",
        [int]$OverlayAlpha = 0,
        [string]$ScaleMode = "Cover"
    )
    if (-not (Test-Path -LiteralPath $ImagePath)) { return $null }
    try {
        Enable-DoubleBuffer $Control
        $image = [System.Drawing.Image]::FromFile($ImagePath)
        $cache = @{
            Bitmap = $null
            Width = 0
            Height = 0
            PendingWidth = 0
            PendingHeight = 0
        }
        $Control.Add_Paint({
            param($sender, $e)
            if (-not $image) { return }
            $bounds = $sender.ClientRectangle
            if ($bounds.Width -le 0 -or $bounds.Height -le 0) { return }
            try {
                if (-not $cache.Bitmap -or $cache.Width -ne $bounds.Width -or $cache.Height -ne $bounds.Height) {
                    if ($Script:LauncherResizeActive -and $cache.Bitmap) {
                        $cache.PendingWidth = $bounds.Width
                        $cache.PendingHeight = $bounds.Height
                        $e.Graphics.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::Low
                        $e.Graphics.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::Half
                        $e.Graphics.DrawImage($cache.Bitmap, $bounds)
                        return
                    }
                    if ($cache.Bitmap) {
                        $cache.Bitmap.Dispose()
                        $cache.Bitmap = $null
                    }
                    $rendered = New-Object System.Drawing.Bitmap($bounds.Width, $bounds.Height)
                    $graphics = [System.Drawing.Graphics]::FromImage($rendered)
                    try {
                        $imageBounds = New-Object System.Drawing.Rectangle -ArgumentList @(0, 0, $bounds.Width, $bounds.Height)
                        if ($ScaleMode -eq "FitWidth") {
                            $rect = Get-FitWidthImageRectangle -Image $image -Bounds $imageBounds -VerticalAlign $VerticalAlign
                        }
                        else {
                            $rect = Get-CoverImageRectangle -Image $image -Bounds $imageBounds -HorizontalAlign $HorizontalAlign -VerticalAlign $VerticalAlign
                        }
                        if ($rect.IsEmpty) { return }
                        $graphics.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBilinear
                        $graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighSpeed
                        $graphics.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::Half
                        $graphics.DrawImage($image, $rect)
                        if ($OverlayAlpha -gt 0) {
                            $alpha = [Math]::Max(0, [Math]::Min(255, $OverlayAlpha))
                            $brush = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb($alpha, 8, 11, 15))
                            try {
                                $graphics.FillRectangle($brush, 0, 0, $bounds.Width, $bounds.Height)
                            }
                            finally {
                                $brush.Dispose()
                            }
                        }
                        $cache.Bitmap = $rendered
                        $cache.Width = $bounds.Width
                        $cache.Height = $bounds.Height
                    }
                    finally {
                        $graphics.Dispose()
                    }
                }
                if ($cache.Bitmap) {
                    $e.Graphics.DrawImageUnscaled($cache.Bitmap, $bounds.Left, $bounds.Top)
                }
            }
            catch {
                Add-Log "绘制$Description 失败: $($_.Exception.Message)" "WARN"
            }
        }.GetNewClosure())
        $Control.Add_Resize({
            param($sender, $e)
            if ($Script:LauncherResizeActive -and $cache.Bitmap) {
                $cache.PendingWidth = $sender.ClientSize.Width
                $cache.PendingHeight = $sender.ClientSize.Height
            }
            elseif ($cache.Bitmap) {
                $cache.Bitmap.Dispose()
                $cache.Bitmap = $null
                $cache.Width = 0
                $cache.Height = 0
            }
            $sender.Invalidate()
        }.GetNewClosure())
        $Control.Add_Disposed({
            if ($cache.Bitmap) {
                $cache.Bitmap.Dispose()
                $cache.Bitmap = $null
            }
        }.GetNewClosure())
        return $image
    }
    catch {
        Add-Log "加载$Description 失败: $($_.Exception.Message)" "WARN"
        return $null
    }
}

function Add-Log {
    param([string]$Message, [string]$Level = "INFO")
    $line = "[{0}] [{1}] {2}" -f (Get-Date -Format "HH:mm:ss"), $Level, $Message
    if (-not $Script:LogTexts) { $Script:LogTexts = @{} }
    $existing = if ($Script:LogTexts.ContainsKey("launcher")) { [string]$Script:LogTexts["launcher"] } else { "" }
    $Script:LogTexts["launcher"] = ($existing + $line + [Environment]::NewLine)
    if ($Script:ActiveLogTab -eq "launcher" -and $Script:LogBox -and -not (Test-LogTextSelected)) {
        Set-LogTabActive "launcher"
    }
    New-Item -ItemType Directory -Force -Path $Script:LogDir | Out-Null
    $logFile = Join-Path $Script:LogDir ("launcher-" + (Get-Date -Format "yyyyMMdd") + ".log")
    Add-Content -LiteralPath $logFile -Value $line -Encoding UTF8
}

function Request-BackendLogRefreshAsync {
    param([int]$DelayMs = 120)
    if ($Script:BackendLogTimer) {
        $oldTimer = $Script:BackendLogTimer
        $Script:BackendLogTimer = $null
        try {
            $oldTimer.Stop()
            $oldTimer.Dispose()
        }
        catch {
        }
    }
    $timer = New-Object System.Windows.Forms.Timer
    $timer.Interval = [Math]::Max(1, $DelayMs)
    $timer.Add_Tick({
        try {
            if ($timer) {
                $timer.Stop()
                $timer.Dispose()
            }
            if ($Script:BackendLogTimer -eq $timer) {
                $Script:BackendLogTimer = $null
            }
            if (-not $Script:LogPanel -or $Script:LogPanel.Visible) {
                Refresh-BackendLogTail
            }
        }
        catch {
            Add-Log "刷新后端日志失败: $($_.Exception.Message)" "WARN"
        }
    }.GetNewClosure())
    $Script:BackendLogTimer = $timer
    $timer.Start()
}

function Hide-LauncherContentPanels {
    foreach ($panel in @($Script:HomePanel, $Script:LogPanel, $Script:EnvPanel)) {
        if ($panel) { $panel.Visible = $false }
    }
}

function Show-LauncherHome {
    if ($Script:HomePanel -and $Script:EnvPanel) {
        Set-LauncherNavActive "home"
        Hide-LauncherContentPanels
        $Script:HomePanel.Visible = $true
        $Script:HomePanel.BringToFront()
        return
    }
    if ($Script:Tabs) {
        $Script:Tabs.SelectedIndex = 0
    }
}

function Show-HomeLog {
    if ($Script:LogPanel -and $Script:EnvPanel) {
        Set-LauncherNavActive "log"
        Hide-LauncherContentPanels
        $Script:LogPanel.Visible = $true
        $Script:LogPanel.BringToFront()
        Request-BackendLogRefreshAsync
        return
    }
    if ($Script:HomePanel -and $Script:EnvPanel) {
        Set-LauncherNavActive "home"
        Hide-LauncherContentPanels
        $Script:HomePanel.Visible = $true
        $Script:HomePanel.BringToFront()
        Request-BackendLogRefreshAsync
        return
    }
    if ($Script:Tabs) {
        $Script:Tabs.SelectedIndex = 0
    }
    Request-BackendLogRefreshAsync
}

function Show-EnvironmentPanel {
    param([string]$NavKey = "env")
    Set-LauncherNavActive $NavKey
    if ($Script:HomePanel -and $Script:EnvPanel) {
        Hide-LauncherContentPanels
        $Script:EnvPanel.Visible = $true
        $Script:EnvPanel.BringToFront()
    }
}

function Show-RepairPanel {
    Show-EnvironmentPanel
}

function Test-LogTextSelected {
    if (-not $Script:LogBox) { return $false }
    try {
        return ($Script:LogBox.PSObject.Properties.Name -contains "SelectionLength" -and $Script:LogBox.SelectionLength -gt 0)
    }
    catch {
        return $false
    }
}

function Invoke-LeonJson {
    param(
        [string]$Uri,
        [string]$Method = "GET",
        [string]$Body = $null,
        [string]$ContentType = "application/json; charset=utf-8",
        [int]$TimeoutSec = 30
    )
    $request = [System.Net.HttpWebRequest][System.Net.WebRequest]::Create($Uri)
    $request.Method = $Method
    $request.Accept = "application/json"
    $request.Timeout = [Math]::Max(1, $TimeoutSec) * 1000
    $request.ReadWriteTimeout = [Math]::Max(1, $TimeoutSec) * 1000
    if ($PSBoundParameters.ContainsKey("Body") -and $null -ne $Body) {
        $bodyBytes = $Script:Utf8NoBomEncoding.GetBytes($Body)
        $request.ContentType = $ContentType
        $request.ContentLength = $bodyBytes.Length
        $requestStream = $null
        try {
            $requestStream = $request.GetRequestStream()
            $requestStream.Write($bodyBytes, 0, $bodyBytes.Length)
        }
        finally {
            if ($requestStream) { $requestStream.Dispose() }
        }
    }
    elseif ($Method -ne "GET" -and $Method -ne "HEAD") {
        $request.ContentType = $ContentType
        $request.ContentLength = 0
    }

    $response = $null
    $stream = $null
    $memory = $null
    try {
        $response = $request.GetResponse()
        $stream = $response.GetResponseStream()
        $memory = New-Object System.IO.MemoryStream
        $stream.CopyTo($memory)
        $text = $Script:Utf8NoBomEncoding.GetString($memory.ToArray())
        if ([string]::IsNullOrWhiteSpace($text)) { return $null }
        return ($text | ConvertFrom-Json)
    }
    finally {
        if ($memory) { $memory.Dispose() }
        if ($stream) { $stream.Dispose() }
        if ($response) { $response.Dispose() }
    }
}

function Scroll-LogBoxToEnd {
    param([bool]$Defer = $true)
    if (-not $Script:LogBox) { return }
    try {
        if ($Script:LogBox.PSObject.Properties.Name -contains "SelectionStart") {
            $Script:LogBox.SelectionStart = $Script:LogBox.TextLength
            if ($Script:LogBox.PSObject.Properties.Name -contains "SelectionLength") {
                $Script:LogBox.SelectionLength = 0
            }
            $Script:LogBox.ScrollToCaret()
        }
        if ($Defer -and $Script:LogBox.IsHandleCreated -and -not $Script:LogBox.IsDisposed) {
            [void]$Script:LogBox.BeginInvoke([System.Windows.Forms.MethodInvoker]{
                if ($Script:LogBox -and -not $Script:LogBox.IsDisposed -and -not (Test-LogTextSelected)) {
                    try {
                        $Script:LogBox.SelectionStart = $Script:LogBox.TextLength
                        $Script:LogBox.SelectionLength = 0
                        $Script:LogBox.ScrollToCaret()
                    }
                    catch {
                    }
                }
            })
        }
    }
    catch {
    }
}

function Test-NoisyLauncherLogLine {
    param([string]$Line)
    if ([string]::IsNullOrWhiteSpace($Line)) { return $false }
    if ($Line -match "�") { return $true }
    if ($Line -match "space\.bilibili\.com|Integrated package Author|Redistribution and reselling|strictly prohibited|solely responsible|do not have any control|bilibili@") {
        return $true
    }
    return $false
}

function Test-NoisyServerLogLine {
    param([string]$Line)
    if ([string]::IsNullOrWhiteSpace($Line)) { return $false }
    return ($Line -match 'INFO:\s+.*"\s*(GET|HEAD)\s+/(health|server_log/tail)(\?|\s|/)')
}

function Repair-Utf8MojibakeRuns {
    param([string]$Text)
    if ([string]::IsNullOrEmpty($Text)) { return $Text }
    if ($Text -notmatch '[\u0080-\u00ff]{2,}') { return $Text }

    $latin1 = $null
    $cp1252 = $null
    try { $latin1 = [System.Text.Encoding]::GetEncoding("iso-8859-1") } catch {}
    try { $cp1252 = [System.Text.Encoding]::GetEncoding(1252) } catch {}
    $encodings = @($latin1, $cp1252) | Where-Object { $null -ne $_ }
    if ($encodings.Count -eq 0) { return $Text }

    return [regex]::Replace($Text, '[\u0080-\u00ff]{2,}', [System.Text.RegularExpressions.MatchEvaluator]{
        param($match)
        $value = [string]$match.Value
        $best = $value
        $valueCjk = ([regex]::Matches($value, '[\u4e00-\u9fff]')).Count
        $valueLatin1 = ([regex]::Matches($value, '[\u0080-\u00ff]')).Count
        foreach ($encoding in $encodings) {
            try {
                $decoded = $Script:Utf8NoBomEncoding.GetString($encoding.GetBytes($value))
                if ($decoded -match [string][char]0xFFFD) { continue }
                $decodedCjk = ([regex]::Matches($decoded, '[\u4e00-\u9fff]')).Count
                $decodedLatin1 = ([regex]::Matches($decoded, '[\u0080-\u00ff]')).Count
                if ($decodedCjk -gt $valueCjk -or ($decodedLatin1 -lt $valueLatin1 -and $decoded.Length -lt $value.Length)) {
                    $best = $decoded
                    break
                }
            }
            catch {
            }
        }
        return $best
    })
}

function Normalize-LauncherLogText {
    param([string]$Text)
    if ($null -eq $Text) { return "" }
    $text = Repair-Utf8MojibakeRuns ([string]$Text)
    $lines = $text -split "`r?`n"
    $lines = @($lines | Where-Object { -not (Test-NoisyLauncherLogLine $_) })
    $text = $lines -join "`n"
    $esc = [string][char]27
    $text = [regex]::Replace($text, [regex]::Escape($esc) + "\[[0-?]*[ -/]*[@-~]", "")
    $text = $text -replace "`0", ""
    $text = [regex]::Replace($text, "`r(?!`n)", "`n")
    $text = $text -replace "`r`n", "`n"
    $text = [regex]::Replace($text, "(\d{1,3})%\|[^\n]*?\|\s*", '$1% ')
    $text = $text -replace "[█▉▊▋▌▍▎▏▓▒░■□▇▆▅▄▃▂▁�]", ""
    $text = [regex]::Replace($text, "\n{3,}", "`n`n")
    return ($text -replace "`n", "`r`n").TrimEnd()
}

function Get-LogDecodeScore {
    param([string]$Text)
    if ($null -eq $Text) { return -1000000 }

    $score = 0
    $replacementCount = ([regex]::Matches($Text, [string][char]0xFFFD)).Count
    $nulCount = ([regex]::Matches($Text, "`0")).Count
    $score -= ($replacementCount * 1000)
    $score -= ($nulCount * 500)

    $cjkCount = ([regex]::Matches($Text, '[\u4e00-\u9fff]')).Count
    $score += [Math]::Min(300, $cjkCount * 2)

    $commonChineseCount = ([regex]::Matches($Text, '启动|服务|日志|检测|环境|错误|等待|加载|模型|音色|完成|失败|成功|端口|路径')).Count
    $score += ($commonChineseCount * 60)

    $mojibakeCount = ([regex]::Matches($Text, '锟斤拷|Ã|Â|鍚|榯|浣|妗|鐧|涓|鏃|璇|鎴|绋|杩|鍔|姝|澶|犳|栨|锛')).Count
    $score -= ($mojibakeCount * 180)

    $controlCount = ([regex]::Matches($Text, '[\x00-\x08\x0B\x0C\x0E-\x1F]')).Count
    $score -= ($controlCount * 120)

    return $score
}

function Read-SharedFileBytes {
    param([string]$Path)
    if (-not $Path -or -not (Test-Path $Path)) { return $null }
    $stream = $null
    try {
        $stream = [System.IO.File]::Open($Path, [System.IO.FileMode]::Open, [System.IO.FileAccess]::Read, ([System.IO.FileShare]::ReadWrite -bor [System.IO.FileShare]::Delete))
        $buffer = New-Object byte[] $stream.Length
        $offset = 0
        while ($offset -lt $buffer.Length) {
            $read = $stream.Read($buffer, $offset, ($buffer.Length - $offset))
            if ($read -le 0) { break }
            $offset += $read
        }
        if ($offset -lt $buffer.Length) {
            $trimmed = New-Object byte[] $offset
            [Array]::Copy($buffer, $trimmed, $offset)
            return $trimmed
        }
        return $buffer
    }
    finally {
        if ($stream) { $stream.Dispose() }
    }
}

function Add-LogDecodeCandidate {
    param(
        [System.Collections.ArrayList]$Candidates,
        [string]$Name,
        [System.Text.Encoding]$Encoding,
        [byte[]]$Bytes
    )
    if ($null -eq $Candidates -or $null -eq $Encoding -or $null -eq $Bytes) { return }
    try {
        $text = $Encoding.GetString($Bytes)
        [void]$Candidates.Add([pscustomobject]@{
            Name = $Name
            Text = $text
            Score = Get-LogDecodeScore $text
        })
    }
    catch {
    }
}

function Convert-LogBytesToText {
    param([byte[]]$Bytes)
    if (-not $Bytes -or $Bytes.Length -eq 0) { return "" }

    $candidates = New-Object System.Collections.ArrayList
    Add-LogDecodeCandidate $candidates "utf-8" (New-Object System.Text.UTF8Encoding($false, $false)) $Bytes
    try { Add-LogDecodeCandidate $candidates "gb18030" ([System.Text.Encoding]::GetEncoding("gb18030")) $Bytes } catch {}
    try { Add-LogDecodeCandidate $candidates "gbk" ([System.Text.Encoding]::GetEncoding(936)) $Bytes } catch {}
    try { Add-LogDecodeCandidate $candidates "default" ([System.Text.Encoding]::Default) $Bytes } catch {}
    try {
        $oemCodePage = [System.Globalization.CultureInfo]::CurrentCulture.TextInfo.OEMCodePage
        if ($oemCodePage -gt 0) {
            Add-LogDecodeCandidate $candidates "oem-$oemCodePage" ([System.Text.Encoding]::GetEncoding($oemCodePage)) $Bytes
        }
    }
    catch {}

    $best = $candidates | Sort-Object Score -Descending | Select-Object -First 1
    if ($best) { return [string]$best.Text }
    return [System.Text.Encoding]::Default.GetString($Bytes)
}

function Read-LauncherLogTail {
    param([string]$Path, [int]$Tail = 160)
    if (-not $Path -or -not (Test-Path $Path)) { return "" }
    try {
        $bytes = Read-SharedFileBytes $Path
        $raw = Convert-LogBytesToText $bytes
    }
    catch {
        try {
            $raw = [System.IO.File]::ReadAllText($Path, [System.Text.Encoding]::Default)
        }
        catch {
            $raw = ((Get-Content -LiteralPath $Path -Tail $Tail -ErrorAction SilentlyContinue) -join "`n")
        }
    }
    $normalized = Normalize-LauncherLogText $raw
    $lines = $normalized -split "`r?`n"
    if ($lines.Count -gt $Tail) {
        $lines = $lines | Select-Object -Last $Tail
    }
    return ($lines -join "`r`n").TrimEnd()
}

function Set-StatusText {
    param([string]$Message, [string]$ColorName = "White")
    if ($Script:StatusLabel) {
        if ($Script:StatusLabel.Tag -eq "hidden-header-status") {
            $Script:StatusLabel.Text = ""
            return
        }
        $displayMessage = $Message
        if ($Script:StatusLabel.Tag -eq "muted-header") {
            $displayMessage = $displayMessage -replace "API 已运行：http://127\.0\.0\.1:\d+", "服务已运行"
            $displayMessage = $displayMessage -replace "API 已启动：http://127\.0\.0\.1:\d+", "服务已启动"
            $displayMessage = $displayMessage -replace "默认 API：http://127\.0\.0\.1:\d+", "服务可用"
            if ($displayMessage -match "^(vLLM|fast6g).*(质量版|6G|双加速)") {
                $displayMessage = ""
            }
            if ($displayMessage.Length -gt 44) {
                $displayMessage = $displayMessage.Substring(0, 44) + "..."
            }
        }
        $Script:StatusLabel.Text = $displayMessage
        if ($Script:StatusLabel.Tag -eq "muted-header" -and $ColorName -eq "LightGreen") {
            $Script:StatusLabel.ForeColor = [System.Drawing.Color]::FromArgb(178, 188, 198)
        }
        else {
            $Script:StatusLabel.ForeColor = [System.Drawing.Color]::$ColorName
        }
    }
}

function Set-LauncherNavActive {
    param([string]$Key)
    if (-not $Script:NavButtons) { return }
    foreach ($navKey in $Script:NavButtons.Keys) {
        $btn = $Script:NavButtons[$navKey]
        if (-not $btn) { continue }
        if ($navKey -eq $Key) {
            $btn.BackColor = [System.Drawing.Color]::FromArgb(48, 68, 88)
            $btn.ForeColor = [System.Drawing.Color]::White
            $btn.FlatAppearance.BorderColor = [System.Drawing.Color]::FromArgb(110, 145, 175)
        }
        else {
            $btn.BackColor = [System.Drawing.Color]::FromArgb(30, 39, 49)
            $btn.ForeColor = [System.Drawing.Color]::FromArgb(218, 226, 234)
            $btn.FlatAppearance.BorderColor = [System.Drawing.Color]::FromArgb(52, 64, 78)
        }
    }
}

function Set-RoundedControlRegion {
    param(
        [System.Windows.Forms.Control]$Control,
        [int]$Radius = 6
    )
    if (-not $Control -or $Control.Width -le 0 -or $Control.Height -le 0) { return }
    $diameter = [Math]::Max(2, $Radius * 2)
    $path = New-Object System.Drawing.Drawing2D.GraphicsPath
    $path.AddArc(0, 0, $diameter, $diameter, 180, 90)
    $path.AddArc($Control.Width - $diameter - 1, 0, $diameter, $diameter, 270, 90)
    $path.AddArc($Control.Width - $diameter - 1, $Control.Height - $diameter - 1, $diameter, $diameter, 0, 90)
    $path.AddArc(0, $Control.Height - $diameter - 1, $diameter, $diameter, 90, 90)
    $path.CloseFigure()
    $oldRegion = $Control.Region
    $Control.Region = New-Object System.Drawing.Region($path)
    if ($oldRegion) { $oldRegion.Dispose() }
    $path.Dispose()
}

function Get-LogViewerMaxOffset {
    if (-not $Script:LogViewport -or -not $Script:LogContentLabel) { return 0 }
    $visibleHeight = [Math]::Max(20, $Script:LogViewport.ClientSize.Height - 20)
    return [Math]::Max(0, $Script:LogContentLabel.Height - $visibleHeight)
}

function Update-LogViewerLayout {
    if (-not $Script:LogViewport -or -not $Script:LogContentLabel) { return }

    $contentWidth = [Math]::Max(80, $Script:LogViewport.ClientSize.Width - 28)
    $Script:LogContentLabel.MaximumSize = New-Object System.Drawing.Size($contentWidth, 0)
    $Script:LogContentLabel.Width = $contentWidth

    $maxOffset = Get-LogViewerMaxOffset
    $Script:LogScrollOffset = [Math]::Max(0, [Math]::Min($Script:LogScrollOffset, $maxOffset))
    $Script:LogContentLabel.Location = New-Object System.Drawing.Point(12, (10 - $Script:LogScrollOffset))

    if ($Script:LogScrollTrack -and $Script:LogScrollThumb) {
        $showScroll = ($maxOffset -gt 0)
        $Script:LogScrollTrack.Visible = $showScroll
        if ($showScroll) {
            $trackHeight = [Math]::Max(20, $Script:LogViewport.ClientSize.Height - 16)
            $Script:LogScrollTrack.Location = New-Object System.Drawing.Point(($Script:LogViewport.ClientSize.Width - 13), 8)
            $Script:LogScrollTrack.Size = New-Object System.Drawing.Size(8, $trackHeight)
            $thumbHeight = [Math]::Max(28, [int]($trackHeight * ([Math]::Max(1, $Script:LogViewport.ClientSize.Height) / [Math]::Max(1, $Script:LogContentLabel.Height))))
            $thumbHeight = [Math]::Min($trackHeight, $thumbHeight)
            $thumbRange = [Math]::Max(1, $trackHeight - $thumbHeight)
            $thumbY = if ($maxOffset -gt 0) { [int]($Script:LogScrollOffset * $thumbRange / $maxOffset) } else { 0 }
            $Script:LogScrollThumb.Location = New-Object System.Drawing.Point(0, $thumbY)
            $Script:LogScrollThumb.Size = New-Object System.Drawing.Size(8, $thumbHeight)
        }
    }
}

function Set-LogViewerText {
    param([string]$Text)
    if (-not $Script:LogContentLabel) { return $false }
    $Script:LogContentLabel.Text = $Text
    $Script:LogScrollOffset = 0
    Update-LogViewerLayout
    return $true
}

function Scroll-LogViewer {
    param([int]$Delta)
    $maxOffset = Get-LogViewerMaxOffset
    if ($maxOffset -le 0) { return }
    $Script:LogScrollOffset = [Math]::Max(0, [Math]::Min(($Script:LogScrollOffset + $Delta), $maxOffset))
    Update-LogViewerLayout
}

function Set-LogTabActive {
    param([string]$Key)
    if ([string]::IsNullOrWhiteSpace($Key)) { $Key = "launcher" }
    $tabChanged = ($Script:ActiveLogTab -ne $Key)
    $Script:ActiveLogTab = $Key
    foreach ($tabKey in $Script:LogTabButtons.Keys) {
        $btn = $Script:LogTabButtons[$tabKey]
        if (-not $btn) { continue }
        if ($tabKey -eq $Key) {
            $btn.BackColor = [System.Drawing.Color]::FromArgb(48, 68, 88)
            $btn.ForeColor = [System.Drawing.Color]::White
            $btn.FlatAppearance.BorderColor = [System.Drawing.Color]::FromArgb(110, 145, 175)
        }
        else {
            $btn.BackColor = [System.Drawing.Color]::FromArgb(24, 31, 39)
            $btn.ForeColor = [System.Drawing.Color]::FromArgb(205, 214, 224)
            $btn.FlatAppearance.BorderColor = [System.Drawing.Color]::FromArgb(46, 56, 68)
        }
    }
    if ($Script:LogBox) {
        $text = ""
        if ($Script:LogTexts -and $Script:LogTexts.ContainsKey($Key)) {
            $text = [string]$Script:LogTexts[$Key]
        }
        if ([string]::IsNullOrWhiteSpace($text)) {
            $text = "暂无日志。"
        }
        $hadSelection = ($Script:LogBox.PSObject.Properties.Name -contains "SelectionLength" -and $Script:LogBox.SelectionLength -gt 0)
        $preserveSelection = ($hadSelection -and -not $tabChanged)
        if ($preserveSelection) {
            return
        }
        $sameText = ($Script:LogBox.Text -eq $text)
        if (-not $sameText) {
            $Script:LogBox.Text = $text
        }
        if ($Script:LogBox.PSObject.Properties.Name -contains "SelectionStart") {
            if (-not $preserveSelection) {
                Scroll-LogBoxToEnd
            }
        }
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
    if ($Script:ServiceTransition) { return }
    $Script:StartButton.Enabled = $true
    if ($Running) {
        $Script:StartButton.Text = "停止 LEON 服务"
        $Script:StartButton.BackColor = [System.Drawing.Color]::FromArgb(86, 47, 50)
        $Script:StartButton.FlatAppearance.BorderColor = [System.Drawing.Color]::FromArgb(156, 84, 90)
    }
    else {
        $Script:StartButton.Text = "启动 LEON 服务"
        $Script:StartButton.BackColor = [System.Drawing.Color]::FromArgb(32, 94, 72)
        $Script:StartButton.FlatAppearance.BorderColor = [System.Drawing.Color]::FromArgb(90, 168, 130)
    }
}

function Set-ServiceButtonBusy {
    param([string]$Text)
    if (-not $Script:StartButton) { return }
    $Script:StartButton.Text = $Text
    $Script:StartButton.Enabled = $false
    $Script:StartButton.BackColor = [System.Drawing.Color]::FromArgb(104, 83, 38)
    $Script:StartButton.FlatAppearance.BorderColor = [System.Drawing.Color]::FromArgb(176, 140, 62)
    [System.Windows.Forms.Application]::DoEvents()
}

function Toggle-LeonService {
    if ($Script:ServiceTransition) {
        $msg = if ($Script:ServiceTransitionText) { $Script:ServiceTransitionText } else { "服务操作进行中..." }
        Set-StatusText $msg "Khaki"
        Add-Log "忽略重复点击：$msg" "WARN"
        return
    }
    if (Test-ApiHealth) {
        $Script:ServiceTransition = $true
        $Script:ServiceTransitionText = "正在停止 LEON 服务..."
        Set-ServiceButtonBusy "停止中..."
        try {
            Stop-LeonService
            Start-Sleep -Milliseconds 300
            $health = Test-ApiHealth
            if ($health) { Set-StatusText "服务仍在运行，请稍后再试。" "Khaki" }
            else { Set-StatusText "服务已停止。" "Khaki" }
        }
        finally {
            $Script:ServiceTransition = $false
            $Script:ServiceTransitionText = ""
            Update-StartButtonState ($null -ne (Test-ApiHealth))
        }
        return
    }
    Start-LeonService
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
    $mods = @(Get-LeonRuntimePackageNames -VersionKey $Script:VersionKey)
    $modsJson = ($mods | ConvertTo-Json -Compress)
    $pkgCode = @"
import importlib, json
mods = $modsJson
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
print("LEON_IMPORT_PROBE_JSON=" + json.dumps(out, ensure_ascii=False))
"@
    $pkg = Invoke-PythonSnippet -Code $pkgCode -TimeoutSeconds 60
    $info = $null
    $jsonText = ""
    if ($pkg.ExitCode -eq 0) {
        $probeMarker = "LEON_IMPORT_PROBE_JSON="
        foreach ($line in @(([string]$pkg.Stdout) -split "`r?`n")) {
            $trimmed = $line.Trim()
            if ($trimmed.StartsWith($probeMarker)) {
                $jsonText = $trimmed.Substring($probeMarker.Length)
            }
        }
        if ([string]::IsNullOrWhiteSpace($jsonText)) {
            foreach ($line in @(([string]$pkg.Stdout) -split "`r?`n")) {
                $trimmed = $line.Trim()
                if ($trimmed.StartsWith("{") -and $trimmed.EndsWith("}")) {
                    $jsonText = $trimmed
                }
            }
        }
        if (-not [string]::IsNullOrWhiteSpace($jsonText)) {
            try { $info = $jsonText | ConvertFrom-Json } catch { $info = $null }
        }
    }
    $Script:RuntimeImportProbe = [pscustomobject]@{
        ExitCode = $pkg.ExitCode
        Stdout = $pkg.Stdout
        Stderr = $pkg.Stderr
        Text = (($pkg.Stdout + "`n" + $pkg.Stderr).Trim())
        JsonText = $jsonText
        Info = $info
    }
    return $Script:RuntimeImportProbe
}

function Test-RuntimeImportOk {
    $probe = Get-RuntimeImportProbe
    if ($probe.ExitCode -ne 0 -or -not $probe.Info) { return $false }
    if ([string]$probe.Info.torch -like "ERROR:*") { return $false }
    if ($Script:VersionKey -eq "vllm" -and [string]$probe.Info.vllm -like "ERROR:*") { return $false }
    return $true
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
        [string]$Detail,
        [switch]$Record
    )
    if ($Record -or $Script:EnvCheckRecording) {
        if (-not $Script:EnvCheckResults) { $Script:EnvCheckResults = @{} }
        $Script:EnvCheckResults[$Name] = [pscustomobject]@{
            Name = $Name
            Status = $Status
            Detail = $Detail
            Time = Get-Date
        }
    }
    $icon = switch ($Status) {
        "OK" { "通过" }
        "WARN" { "警告" }
        "FAIL" { "失败" }
        "WAIT" { "待检测" }
        default { $Status }
    }
    $color = switch ($Status) {
        "OK" { [System.Drawing.Color]::FromArgb(76, 220, 132) }
        "WARN" { [System.Drawing.Color]::FromArgb(245, 190, 85) }
        "FAIL" { [System.Drawing.Color]::FromArgb(255, 110, 110) }
        "WAIT" { [System.Drawing.Color]::FromArgb(150, 162, 174) }
        default { [System.Drawing.Color]::WhiteSmoke }
    }
    if ($Script:CheckList -is [System.Windows.Forms.DataGridView]) {
        $row = $null
        if ($Script:EnvCheckRows -and $Script:EnvCheckRows.ContainsKey($Name)) {
            $row = $Script:EnvCheckRows[$Name]
        }
        if (-not $row) {
            $idx = $Script:CheckList.Rows.Add($Name, $icon, $Detail)
            $row = $Script:CheckList.Rows[$idx]
            $Script:EnvCheckRows[$Name] = $row
        }
        $row.Cells["name"].Value = $Name
        $row.Cells["status"].Value = $icon
        $row.Cells["detail"].Value = $Detail
        $row.DefaultCellStyle.ForeColor = [System.Drawing.Color]::FromArgb(224, 231, 238)
        $row.DefaultCellStyle.BackColor = [System.Drawing.Color]::FromArgb(16, 21, 27)
        $row.DefaultCellStyle.SelectionBackColor = [System.Drawing.Color]::FromArgb(30, 48, 62)
        $row.DefaultCellStyle.SelectionForeColor = [System.Drawing.Color]::White
        $row.Cells["status"].Style.ForeColor = $color
        $row.Cells["status"].Style.SelectionForeColor = $color
        return
    }
    if ($Script:EnvCheckRows -and $Script:EnvCheckRows.ContainsKey($Name)) {
        $item = $Script:EnvCheckRows[$Name]
        $item.SubItems[1].Text = $icon
        $item.SubItems[2].Text = $Detail
        $item.ForeColor = $color
        return
    }
    $item = New-Object System.Windows.Forms.ListViewItem($Name)
    [void]$item.SubItems.Add($icon)
    [void]$item.SubItems.Add($Detail)
    switch ($Status) {
        "OK" { $item.ForeColor = [System.Drawing.Color]::FromArgb(76, 220, 132) }
        "WARN" { $item.ForeColor = [System.Drawing.Color]::FromArgb(245, 190, 85) }
        "FAIL" { $item.ForeColor = [System.Drawing.Color]::FromArgb(255, 110, 110) }
        "WAIT" { $item.ForeColor = [System.Drawing.Color]::FromArgb(150, 162, 174) }
    }
    [void]$Script:CheckList.Items.Add($item)
    $Script:EnvCheckRows[$Name] = $item
}

function Get-EnvironmentCheckNames {
    param([string]$VersionKey = $Script:VersionKey)
    $names = @(
        "启动版本",
        "管理员权限",
        "项目路径中文检查",
        "项目 Python Runtime",
        "NVIDIA 显卡/驱动",
        "Python 包 / Torch CUDA"
    )
    if ($VersionKey -eq "vllm") {
        $names += @(
            "CUDA Toolkit / nvcc",
            "MSVC C++ Build Tools",
            "Intel SVML 兼容兜底",
            "vLLM 插件 / GPT2TTSModel 注册"
        )
    }
    elseif ($VersionKey -eq "fast6g") {
        $names += @(
            "DeepSpeed 6G 加速"
        )
    }
    $names += @(
        "IndexTTS2 模型文件",
        "本地音色库",
        "API 端口 $Script:ApiPort",
        "启动入口 BAT"
    )
    return $names
}

function Save-EnvironmentCheckState {
    param([string]$VersionKey = $Script:EnvCheckVersion)
    if ([string]::IsNullOrWhiteSpace($VersionKey)) { return }
    $Script:EnvCheckStateByVersion[$VersionKey] = [pscustomobject]@{
        Results = $Script:EnvCheckResults
        Completed = [bool]$Script:EnvCheckCompleted
        LastRun = $Script:EnvCheckLastRun
        Fail = [int]$Script:EnvCheckFail
        Warn = [int]$Script:EnvCheckWarn
    }
}

function Restore-EnvironmentCheckState {
    param([string]$VersionKey = $Script:VersionKey)
    if ([string]::IsNullOrWhiteSpace($VersionKey)) { $VersionKey = "vllm" }
    $Script:EnvCheckVersion = $VersionKey
    $state = $null
    if ($Script:EnvCheckStateByVersion -and $Script:EnvCheckStateByVersion.ContainsKey($VersionKey)) {
        $state = $Script:EnvCheckStateByVersion[$VersionKey]
    }
    if ($state) {
        $Script:EnvCheckResults = if ($state.Results) { $state.Results } else { @{} }
        $Script:EnvCheckCompleted = [bool]$state.Completed
        $Script:EnvCheckLastRun = $state.LastRun
        $Script:EnvCheckFail = [int]$state.Fail
        $Script:EnvCheckWarn = [int]$state.Warn
    }
    else {
        $Script:EnvCheckResults = @{}
        $Script:EnvCheckCompleted = $false
        $Script:EnvCheckLastRun = $null
        $Script:EnvCheckFail = 0
        $Script:EnvCheckWarn = 0
    }
    Initialize-EnvironmentCheckRows
}

function Initialize-EnvironmentCheckRows {
    param([string]$Status = "WAIT", [switch]$ResetResults)
    if (-not $Script:CheckList) { return }
    if ($ResetResults) {
        $Script:EnvCheckResults = @{}
        $Script:EnvCheckCompleted = $false
        $Script:EnvCheckLastRun = $null
        $Script:EnvCheckFail = 0
        $Script:EnvCheckWarn = 0
    }
    $Script:EnvCheckRows = @{}
    $names = @(Get-EnvironmentCheckNames -VersionKey $Script:VersionKey)
    if ($Script:CheckList -is [System.Windows.Forms.DataGridView]) {
        $Script:CheckList.Rows.Clear()
    }
    else {
        $Script:CheckList.Items.Clear()
    }
    foreach ($name in $names) {
        $saved = $null
        if (-not $ResetResults -and $Script:EnvCheckResults -and $Script:EnvCheckResults.ContainsKey($name)) {
            $saved = $Script:EnvCheckResults[$name]
        }
        if ($saved) {
            Add-CheckResult $name ([string]$saved.Status) ([string]$saved.Detail)
        }
        else {
            Add-CheckResult $name $Status ""
        }
    }
}

function Set-RepairResult {
    param([string]$Name, [string]$Status, [string]$Detail = "")
    if (-not $Script:RepairStatusLabels -or -not $Script:RepairStatusLabels.ContainsKey($Name)) { return }
    $statusLabel = $Script:RepairStatusLabels[$Name]
    $detailLabel = $Script:RepairDetailLabels[$Name]
    $statusText = switch ($Status) {
        "OK" { "已处理" }
        "SKIP" { "跳过" }
        "RUN" { "执行中" }
        "WARN" { "注意" }
        "FAIL" { "失败" }
        default { "待处理" }
    }
    $statusColor = switch ($Status) {
        "OK" { [System.Drawing.Color]::FromArgb(90, 222, 145) }
        "SKIP" { [System.Drawing.Color]::FromArgb(150, 162, 174) }
        "RUN" { [System.Drawing.Color]::FromArgb(120, 175, 230) }
        "WARN" { [System.Drawing.Color]::FromArgb(245, 190, 85) }
        "FAIL" { [System.Drawing.Color]::FromArgb(255, 110, 110) }
        default { [System.Drawing.Color]::FromArgb(150, 162, 174) }
    }
    $statusLabel.Text = $statusText
    $statusLabel.ForeColor = $statusColor
    $detailLabel.Text = $Detail
}

function Initialize-RepairRows {
    if (-not $Script:RepairStatusLabels) { return }
    foreach ($name in $Script:RepairStatusLabels.Keys) {
        Set-RepairResult $name "WAIT" ""
    }
    if ($Script:RepairSummaryLabel) {
        $Script:RepairSummaryLabel.Text = ""
    }
}

function Test-ApiHealth {
    try {
        $resp = Invoke-LeonJson -Uri "$Script:ApiBase/health" -TimeoutSec 2
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

function Get-ChildProcessIds {
    param([int]$ParentPid)
    $children = @()
    try {
        $children = @(Get-CimInstance Win32_Process -Filter "ParentProcessId = $ParentPid" -ErrorAction SilentlyContinue | ForEach-Object { [int]$_.ProcessId })
    }
    catch {
        $children = @()
    }
    return $children
}

function Stop-ProcessTreeById {
    param([int]$RootPid)
    if ($RootPid -le 0 -or $RootPid -eq $PID) { return }
    $ordered = @()
    $pending = @($RootPid)
    $seen = @{}
    while ($pending.Count -gt 0) {
        $current = [int]$pending[0]
        if ($pending.Count -gt 1) { $pending = @($pending[1..($pending.Count - 1)]) } else { $pending = @() }
        if ($seen.ContainsKey($current)) { continue }
        $seen[$current] = $true
        $ordered += $current
        foreach ($child in @(Get-ChildProcessIds -ParentPid $current)) {
            if (-not $seen.ContainsKey($child)) { $pending += $child }
        }
    }
    for ($i = $ordered.Count - 1; $i -ge 0; $i--) {
        $pidToStop = [int]$ordered[$i]
        if ($pidToStop -le 0 -or $pidToStop -eq $PID) { continue }
        try {
            Stop-Process -Id $pidToStop -Force -ErrorAction Stop
            Add-Log "已停止 LEON 服务进程 PID $pidToStop"
        }
        catch {
            Add-Log "停止 PID $pidToStop 失败: $($_.Exception.Message)" "WARN"
        }
    }
}

function Get-LauncherBackendWrapperPids {
    $needles = @(
        $Script:StartupBat,
        (Join-Path $Script:WorkspaceRoot "scripts\start-vllm-api.bat"),
        (Join-Path $Script:WorkspaceRoot "scripts\start-fast6g-api.bat")
    ) | Where-Object { -not [string]::IsNullOrWhiteSpace($_) }
    $matches = @()
    try {
        $processes = @(Get-CimInstance Win32_Process -ErrorAction SilentlyContinue | Where-Object {
            $cmd = [string]$_.CommandLine
            if ([string]::IsNullOrWhiteSpace($cmd)) { return $false }
            foreach ($needle in $needles) {
                if ($cmd.IndexOf($needle, [System.StringComparison]::OrdinalIgnoreCase) -ge 0) { return $true }
            }
            return $false
        })
        $matches = @($processes | ForEach-Object { [int]$_.ProcessId } | Where-Object { $_ -ne $PID } | Sort-Object -Unique)
    }
    catch {
        $matches = @()
    }
    return $matches
}

function Get-LeonPythonPids {
    $runtimeNeedles = @(
        $Script:RuntimePython,
        (Join-Path $Script:WorkspaceRoot "vllm\indextts2runtime\python.exe"),
        (Join-Path $Script:WorkspaceRoot "fast6g\indextts2runtime\python.exe")
    ) | Where-Object { -not [string]::IsNullOrWhiteSpace($_) } | Sort-Object -Unique
    $matches = @()
    try {
        $processes = @(Get-CimInstance Win32_Process -ErrorAction SilentlyContinue | Where-Object {
            $name = [string]$_.Name
            if ($_.ProcessId -eq $PID -or $name -notmatch '^python(\.exe)?$') { return $false }
            $cmd = [string]$_.CommandLine
            $exe = [string]$_.ExecutablePath
            if ([string]::IsNullOrWhiteSpace($cmd) -and [string]::IsNullOrWhiteSpace($exe)) { return $false }

            $usesLeonRuntime = $false
            foreach ($needle in $runtimeNeedles) {
                if ($cmd.IndexOf($needle, [System.StringComparison]::OrdinalIgnoreCase) -ge 0 -or
                    $exe.IndexOf($needle, [System.StringComparison]::OrdinalIgnoreCase) -ge 0) {
                    $usesLeonRuntime = $true
                    break
                }
            }
            if (-not $usesLeonRuntime) { return $false }

            # 覆盖主 API 进程，以及 multiprocessing 拉起的子 Python。
            return (
                $cmd.IndexOf("indextts2_api.py", [System.StringComparison]::OrdinalIgnoreCase) -ge 0 -or
                $cmd.IndexOf("--multiprocessing-fork", [System.StringComparison]::OrdinalIgnoreCase) -ge 0 -or
                $cmd.IndexOf("spawn_main(parent_pid=", [System.StringComparison]::OrdinalIgnoreCase) -ge 0 -or
                $cmd.IndexOf("-p $Script:ApiPort", [System.StringComparison]::OrdinalIgnoreCase) -ge 0
            )
        })
        $matches = @($processes | ForEach-Object { [int]$_.ProcessId } | Where-Object { $_ -ne $PID } | Sort-Object -Unique)
    }
    catch {
        $matches = @()
    }
    return $matches
}

function Stop-LeonPythonProcesses {
    param([string]$Reason = "停止服务")

    $pids = @()
    $pids += @(Get-ListeningPidsForPort -Port $Script:ApiPort)
    $pids += @(Get-LauncherBackendWrapperPids)
    $pids += @(Get-LeonPythonPids)
    $pids = @($pids | Where-Object { $_ -gt 0 -and $_ -ne $PID } | Sort-Object -Unique)

    if ($pids.Count -eq 0) {
        Add-Log "$Reason：未发现需要清理的 LEON 后端进程。"
        return @()
    }

    Add-Log "$Reason：清理 LEON 后端进程 PID: $($pids -join ', ')"
    foreach ($pidToStop in $pids) {
        Stop-ProcessTreeById -RootPid ([int]$pidToStop)
    }

    Start-Sleep -Milliseconds 500
    $remaining = @(Get-LeonPythonPids)
    if ($remaining.Count -gt 0) {
        Add-Log "$Reason：继续清理残留 LEON Python PID: $($remaining -join ', ')" "WARN"
        foreach ($pidToStop in $remaining) {
            Stop-ProcessTreeById -RootPid ([int]$pidToStop)
        }
        Start-Sleep -Milliseconds 300
    }
    return @(Get-LeonPythonPids)
}

function Stop-LeonServiceForLauncherExit {
    if ($env:LEON_LAUNCHER_SMOKE_TEST -eq "1") { return }
    try {
        if (@(Get-ListeningPidsForPort -Port $Script:ApiPort).Count -gt 0) {
            try {
                Add-Log "关闭启动器：向 LEON 服务发送退出请求..."
                Invoke-LeonJson -Uri "$Script:ApiBase/control?command=exit" -TimeoutSec 1 | Out-Null
            }
            catch {
                Add-Log "关闭启动器：退出请求未返回，继续清理进程。" "WARN"
            }
            Start-Sleep -Milliseconds 500
        }
        [void](Stop-LeonPythonProcesses -Reason "关闭启动器")
        $Script:WarmupStarted = $false
        $Script:ServiceTransition = $false
        $Script:ServiceTransitionText = ""
    }
    catch {
        Add-Log "关闭启动器时清理 LEON 后端失败: $($_.Exception.Message)" "WARN"
    }
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

    Show-EnvironmentPanel
    $checkVersion = [string]$Script:VersionKey
    $Script:EnvCheckVersion = $checkVersion
    Initialize-EnvironmentCheckRows -ResetResults
    $Script:EnvCheckRecording = $true
    try {
        Set-Progress 2 "正在检测 $(Get-LeonVersionLabelText $checkVersion) 环境..."
        Add-Log "开始环境检测：$(Get-LeonVersionLabelText $checkVersion)。项目目录: $Script:RepoRoot"

        $Script:EnvCheckFail = 0
        $Script:EnvCheckWarn = 0

        function Count-Result([string]$Status) {
            if ($Status -eq "FAIL") { $Script:EnvCheckFail++ }
            elseif ($Status -eq "WARN") { $Script:EnvCheckWarn++ }
        }

    Add-CheckResult "启动版本" "OK" "$(Get-LeonVersionLabelText $checkVersion)：$Script:RepoRoot"
    Set-Progress 5

    $status = if (Test-IsAdmin) { "OK" } else { "WARN" }
    Count-Result $status
    Add-CheckResult "管理员权限" $status ($(if ($status -eq "OK") { "已用管理员权限运行，可安装系统组件。" } else { "不是管理员。检测可用，winget 安装或系统级修复可能需要提权。" }))
    Set-Progress 10

    $pathHasChinese = Test-PathHasChinese $Script:RepoRoot
    $status = if (-not $pathHasChinese) { "OK" } elseif ($checkVersion -eq "vllm") { "FAIL" } else { "WARN" }
    Count-Result $status
    Add-CheckResult "项目路径中文检查" $status ($(if ($status -eq "OK") { "路径未包含中文，适合当前版本。" } elseif ($checkVersion -eq "vllm") { "当前 vLLM 路径包含中文，LLVM/ninja/CUDA 编译很容易失败。请移动到纯英文路径，例如 D:\LEON_IndexTTS2。" } else { "fast6g 通常不需要本地 CUDA 编译；路径含中文仍可能影响个别工具，建议后续移到纯英文路径。" }))
    Set-Progress 16

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
    Set-Progress 22

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
    Set-Progress 30

    if ($checkVersion -eq "vllm") {
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
        Set-Progress 38

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
        Add-CheckResult "MSVC C++ Build Tools" $status ($(if ($clPath) { "cl.exe: $clPath" } else { "未找到 cl.exe。vLLM 的 BigVGAN CUDA kernel 编译会失败，可用一键修复安装 Build Tools。" }))
        Set-Progress 46

        $svmlPath = Find-SvmlDll
        if ($svmlPath) {
            $status = "OK"
            $detail = "运行时可解析 svml_dispmd.dll: $svmlPath"
        }
        elseif ($runtimeOk -and (Test-RuntimeImportOk)) {
            $status = "OK"
            $detail = "未发现独立 svml_dispmd.dll，但当前 vLLM runtime 可 import 必需包；此机器无需修复该 DLL。"
        }
        elseif ($runtimeOk -and (Test-SvmlRepairNeeded)) {
            $status = "FAIL"
            $detail = "vLLM runtime import 失败且日志命中 SVML/LLVM/DLL 加载问题，可用一键修复复制随包 DLL 到项目 runtime。"
        }
        else {
            $status = "WARN"
            $detail = "未发现独立 svml_dispmd.dll，但当前未证明它是 vLLM 启动阻塞项；如果必需包 import 正常可忽略。"
        }
        Count-Result $status
        Add-CheckResult "Intel SVML 兼容兜底" $status $detail
    }
    Set-Progress 54

    if ($runtimeOk) {
        $pkg = Get-RuntimeImportProbe
        if ($pkg.ExitCode -eq 0) {
            $info = $pkg.Info
            if ($info) {
                $bad = @()
                $requiredImportNames = @(Get-LeonRuntimePackageNames -VersionKey $checkVersion)
                foreach ($name in $requiredImportNames) {
                    if ([string]$info.$name -like "ERROR:*") { $bad += "$name=$($info.$name)" }
                }
                $status = if ($bad.Count -gt 0) { "FAIL" } elseif ($info.torch_cuda_available -eq $true) { "OK" } else { "FAIL" }
                Count-Result $status
                $detailParts = @("torch=$($info.torch)", "cuda=$($info.torch_cuda_version)", "gpu=$($info.torch_gpu)")
                foreach ($name in $requiredImportNames) {
                    if ($name -ne "torch") { $detailParts += "$name=$($info.$name)" }
                }
                $detail = $detailParts -join "; "
                if ($bad.Count -gt 0) { $detail = $bad -join "; " }
                elseif ($info.torch_cuda_available -ne $true) { $detail = "$detail; torch.cuda.is_available=False" }
                Add-CheckResult "Python 包 / Torch CUDA" $status $detail
            }
            else {
                $status = "FAIL"; Count-Result $status
                Add-CheckResult "Python 包 / Torch CUDA" $status "包检测输出无法解析: $($pkg.Stdout.Trim())"
            }
        }
        else {
            $status = "FAIL"; Count-Result $status
            Add-CheckResult "Python 包 / Torch CUDA" $status $pkg.Stderr.Trim()
        }
    }
    Set-Progress 64

    if ($checkVersion -eq "fast6g") {
        $wheelPath = Get-Fast6gDeepSpeedWheelPath
        if (-not $runtimeOk) {
            $status = "WARN"
            $detail = "缺少项目 Python Runtime，暂不能检测 DeepSpeed。"
        }
        else {
            $ds = Invoke-PythonSnippet -Code "import deepspeed; print(getattr(deepspeed, '__version__', 'installed'))" -TimeoutSeconds 40
            if ($ds.ExitCode -eq 0) {
                $status = "OK"
                $detail = "deepspeed=$($ds.Stdout.Trim())"
            }
            elseif (Test-Path -LiteralPath $wheelPath) {
                $status = "WARN"
                $detail = "DeepSpeed 未安装或不可导入，可用一键修复安装随包 wheel: $wheelPath"
            }
            else {
                $status = "WARN"
                $detail = "DeepSpeed 未安装或不可导入，且未找到随包 wheel: $wheelPath"
            }
        }
        Count-Result $status
        Add-CheckResult "DeepSpeed 6G 加速" $status $detail
    }
    Set-Progress 68

    if ($runtimeOk -and $checkVersion -eq "vllm") {
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

    $voiceDir = Get-VoiceLibraryDir
    $voiceFiles = Get-VoiceAudioFiles -Directory $voiceDir
    $voiceCount = @($voiceFiles).Count
    $status = if ($voiceCount -gt 0) { "OK" } else { "WARN" }
    Count-Result $status
    Add-CheckResult "本地音色库" $status ($(if ($voiceCount -gt 0) { "音色目录: $voiceDir；发现 $voiceCount 个音频素材。" } else { "音色目录: $voiceDir；没有发现音色音频。" }))
    Set-Progress 84

    $portPids = @(Get-ListeningPidsForPort -Port $Script:ApiPort)
    $health = Test-ApiHealth
    if ($health) {
        $runningVersion = [string]$health.version
        $status = if ([string]::IsNullOrWhiteSpace($runningVersion) -or $runningVersion -eq $checkVersion) { "OK" } else { "WARN" }
        Count-Result $status
        Add-CheckResult "API 端口 $Script:ApiPort" $status ($(if ($status -eq "OK") { "服务已运行: $($health.local_url)" } else { "端口上运行的是 $runningVersion，不是当前选择的 $checkVersion；启动前请先停止现有服务。" }))
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
    Add-CheckResult "启动入口 BAT" $status ($(if ($startupOk) { $Script:StartupBat } else { "缺少当前版本启动脚本。" }))

    Set-Progress 100
    if ($Script:EnvCheckFail -gt 0) {
        Set-StatusText "$(Get-LeonVersionLabelText $checkVersion) 环境检测完成：$Script:EnvCheckFail 个失败，$Script:EnvCheckWarn 个警告。" "LightCoral"
    }
    elseif ($Script:EnvCheckWarn -gt 0) {
        Set-StatusText "$(Get-LeonVersionLabelText $checkVersion) 环境检测完成：0 个失败，$Script:EnvCheckWarn 个警告。" "Khaki"
    }
    else {
        Set-StatusText "$(Get-LeonVersionLabelText $checkVersion) 环境检测通过，点击左下角“启动 LEON 服务”。" "LightGreen"
    }
        $Script:EnvCheckCompleted = $true
        $Script:EnvCheckLastRun = Get-Date
        Save-EnvironmentCheckState -VersionKey $checkVersion
        Add-Log "$(Get-LeonVersionLabelText $checkVersion) 环境检测完成：FAIL=$Script:EnvCheckFail, WARN=$Script:EnvCheckWarn"
    }
    finally {
        $Script:EnvCheckRecording = $false
    }
}

function Install-WithWinget {
    param([string[]]$Args, [string]$Name)
    $winget = Get-CommandPath "winget.exe"
    if (-not $winget) {
        Add-Log "找不到 winget，无法自动安装 $Name。" "ERROR"
        Set-StatusText "找不到 winget，无法自动安装 $Name。" "LightCoral"
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

function Get-EnvCheckResult {
    param([string]$Name)
    if ($Script:EnvCheckResults -and $Script:EnvCheckResults.ContainsKey($Name)) {
        return $Script:EnvCheckResults[$Name]
    }
    return $null
}

function Test-EnvCheckResultNeedsRepair {
    param([string]$Name, [string]$Pattern = "", [string[]]$Statuses = @("WARN", "FAIL"))
    $result = Get-EnvCheckResult $Name
    if (-not $result) { return $false }
    if ($result.Status -notin $Statuses) { return $false }
    if ([string]::IsNullOrWhiteSpace($Pattern)) { return $true }
    return ([string]$result.Detail -match $Pattern)
}

function Repair-Environment {
    Show-EnvironmentPanel
    if ($Script:EnvCheckVersion -ne $Script:VersionKey) {
        Restore-EnvironmentCheckState -VersionKey $Script:VersionKey
    }
    $repairVersion = [string]$Script:VersionKey
    Add-Log "用户触发一键修复：$(Get-LeonVersionLabelText $repairVersion)。"

    if (-not $Script:EnvCheckCompleted -or -not $Script:EnvCheckResults -or $Script:EnvCheckResults.Count -eq 0) {
        Set-Progress 0
        if ($Script:CheckList) {
            Add-CheckResult "启动版本" "WAIT" "先检测当前版本环境，再点一键修复。"
        }
        Set-StatusText "先检测当前版本环境：$(Get-LeonVersionLabelText $repairVersion)。" "Khaki"
        Add-Log "一键修复已取消：$(Get-LeonVersionLabelText $repairVersion) 尚未完成环境检测。"
        return
    }

    Set-StatusText "正在执行 $(Get-LeonVersionLabelText $repairVersion) 可自动修复项..." "Khaki"
    Set-Progress 5
    $actions = 0

    if ((Get-EnvCheckResult "Intel SVML 兼容兜底") -and (Test-Path $Script:SvmlSource) -and (Test-EnvCheckResultNeedsRepair "Intel SVML 兼容兜底" "(?i)svml|llvm|dll|模块|module" @("FAIL"))) {
        Add-CheckResult "Intel SVML 兼容兜底" "WAIT" "正在复制随包 DLL 到项目 runtime。"
        try {
            $svmlTarget = Get-SvmlRepairTarget
            if (-not $svmlTarget) { throw "找不到可写入的项目 runtime 目录" }
            Copy-Item -LiteralPath $Script:SvmlSource -Destination $svmlTarget -Force
            $actions++
            Add-CheckResult "Intel SVML 兼容兜底" "OK" "已复制: $svmlTarget" -Record
            Add-Log "已复制 svml_dispmd.dll 到项目 runtime: $svmlTarget"
        }
        catch {
            Add-CheckResult "Intel SVML 兼容兜底" "FAIL" $_.Exception.Message -Record
            Add-Log "复制 svml_dispmd.dll 失败: $($_.Exception.Message)" "WARN"
        }
    }
    elseif (Get-EnvCheckResult "Intel SVML 兼容兜底") {
        Add-Log "SVML 当前不是明确阻塞项，跳过 svml_dispmd.dll 复制。"
    }
    Set-Progress 25

    if ((Get-EnvCheckResult "MSVC C++ Build Tools") -and (Test-EnvCheckResultNeedsRepair "MSVC C++ Build Tools" "未找到|缺少|cl\.exe")) {
        Add-CheckResult "MSVC C++ Build Tools" "WAIT" "正在调用 winget，可能需要系统弹窗确认。"
        $actions++
        Install-WithWinget -Name "Visual Studio 2022 Build Tools" -Args @(
            "install", "-e", "--id", "Microsoft.VisualStudio.2022.BuildTools",
            "--override", "--quiet --wait --norestart --add Microsoft.VisualStudio.Workload.VCTools --includeRecommended",
            "--accept-package-agreements", "--accept-source-agreements"
        )
        Add-CheckResult "MSVC C++ Build Tools" "WARN" "安装命令已触发，完成后重新检测。" -Record
    }
    elseif (Get-EnvCheckResult "MSVC C++ Build Tools") {
        Add-Log "MSVC Build Tools 已存在，跳过安装。"
    }
    Set-Progress 45

    if ((Get-EnvCheckResult "CUDA Toolkit / nvcc") -and (Test-EnvCheckResultNeedsRepair "CUDA Toolkit / nvcc" "未找到|nvcc 执行失败|CUDA Toolkit")) {
        Add-CheckResult "CUDA Toolkit / nvcc" "WAIT" "正在调用 winget，可能需要系统弹窗确认。"
        $actions++
        Install-WithWinget -Name "NVIDIA CUDA Toolkit" -Args @("install", "-e", "--id", "Nvidia.CUDA", "--accept-package-agreements", "--accept-source-agreements")
        Add-CheckResult "CUDA Toolkit / nvcc" "WARN" "安装命令已触发，完成后重新检测。" -Record
    }
    elseif (Get-EnvCheckResult "CUDA Toolkit / nvcc") {
        Add-Log "CUDA Toolkit 已存在，跳过安装。"
    }
    Set-Progress 65

    if ((Get-EnvCheckResult "DeepSpeed 6G 加速") -and (Test-EnvCheckResultNeedsRepair "DeepSpeed 6G 加速" "(?i)deepspeed|wheel|未安装|不可导入|缺少")) {
        $wheelPath = Get-Fast6gDeepSpeedWheelPath
        if (-not (Test-Path $Script:RuntimePython)) {
            Add-CheckResult "项目 Python Runtime" "FAIL" "缺少项目 runtime，无法安装 DeepSpeed。" -Record
        }
        elseif (-not (Test-Path -LiteralPath $wheelPath)) {
            Add-CheckResult "DeepSpeed 6G 加速" "FAIL" "未找到随包 wheel: $wheelPath" -Record
            Add-Log "DeepSpeed 修复失败：未找到随包 wheel: $wheelPath" "WARN"
        }
        else {
            Add-CheckResult "DeepSpeed 6G 加速" "WAIT" "正在安装随包 DeepSpeed wheel。"
            Add-Log "根据最近一次 fast6g 检测结果安装 DeepSpeed: $wheelPath"
            $actions++
            $pip = Invoke-Capture -FilePath $Script:RuntimePython -Arguments @("-m", "pip", "install", $wheelPath) -TimeoutSeconds 300 -Env @{ "PATH" = "$Script:RuntimeScripts;$env:PATH" }
            Add-Log ("pip install deepspeed exit=" + $pip.ExitCode)
            if ($pip.ExitCode -ne 0) {
                Add-CheckResult "DeepSpeed 6G 加速" "FAIL" $pip.Stderr -Record
                Add-Log $pip.Stderr "WARN"
            }
            else {
                Add-CheckResult "DeepSpeed 6G 加速" "OK" "DeepSpeed 已安装，完成后可重新检测确认。" -Record
            }
        }
    }
    elseif (Get-EnvCheckResult "DeepSpeed 6G 加速") {
        Add-Log "DeepSpeed 6G 加速当前不是可自动修复项，跳过安装。"
    }
    Set-Progress 74

    $pythonResult = Get-EnvCheckResult "Python 包 / Torch CUDA"
    $pythonRepairPackages = @()
    if (Test-EnvCheckResultNeedsRepair "Python 包 / Torch CUDA" "(?i)ninja") {
        $pythonRepairPackages += "ninja"
    }
    if ($repairVersion -eq "fast6g" -and $pythonResult) {
        $pythonDetail = [string]$pythonResult.Detail
        $fast6gRepairMap = @{
            "modelscope" = "modelscope==1.27.0"
            "transformers" = "transformers==4.52.1"
            "fastapi" = "fastapi"
            "uvicorn" = "uvicorn"
        }
        foreach ($pkgName in $fast6gRepairMap.Keys) {
            if ($pythonDetail -match ("(?i)(^|[;,\s])" + [regex]::Escape($pkgName) + "\s*=\s*ERROR")) {
                $pythonRepairPackages += $fast6gRepairMap[$pkgName]
            }
        }
    }
    $pythonRepairPackages = @($pythonRepairPackages | Select-Object -Unique)
    if ($pythonRepairPackages.Count -gt 0) {
        if (Test-Path $Script:RuntimePython) {
            Add-CheckResult "Python 包 / Torch CUDA" "WAIT" "检测结果显示缺少可自动修复包，正在安装: $($pythonRepairPackages -join ', ')"
            Add-Log "根据最近一次 $(Get-LeonVersionLabelText $repairVersion) 检测结果安装 Python 包: $($pythonRepairPackages -join ', ')"
            $actions++
            $pipArgs = @("-m", "pip", "install") + $pythonRepairPackages
            $pip = Invoke-Capture -FilePath $Script:RuntimePython -Arguments $pipArgs -TimeoutSeconds 360 -Env @{ "PATH" = "$Script:RuntimeScripts;$env:PATH" }
            Add-Log ("pip install runtime packages exit=" + $pip.ExitCode)
            if ($pip.ExitCode -ne 0) {
                Add-CheckResult "Python 包 / Torch CUDA" "FAIL" $pip.Stderr -Record
                Add-Log $pip.Stderr "WARN"
            }
            else {
                Add-CheckResult "Python 包 / Torch CUDA" "OK" "Python 包安装完成，完成后可重新检测确认。" -Record
            }
        }
        else {
            Add-CheckResult "项目 Python Runtime" "FAIL" "缺少项目 runtime，无法安装 Python 包。" -Record
        }
    }
    else {
        Add-Log "Python 包检测结果未指向当前版本可自动修复项，跳过 pip 修复。"
    }
    Set-Progress 82

    $pathResult = Get-EnvCheckResult "项目路径中文检查"
    if ($pathResult -and [string]$pathResult.Status -eq "FAIL" -and (Test-EnvCheckResultNeedsRepair "项目路径中文检查")) {
        $pathStatus = if ($pathResult) { [string]$pathResult.Status } else { "WARN" }
        Add-CheckResult "项目路径中文检查" $pathStatus "路径包含中文，无法自动安全搬迁。" -Record
        Add-Log "项目路径包含中文，无法自动安全搬迁。请把整个项目移动到纯英文路径后再运行。" "ERROR"
    }
    elseif ($pathResult -and [string]$pathResult.Status -eq "WARN") {
        Add-Log "当前版本路径中文只是警告项，无法自动搬迁，跳过路径修复。"
    }

    Save-EnvironmentCheckState -VersionKey $repairVersion
    if ($actions -gt 0) {
        Set-Progress 100
        Set-StatusText "$(Get-LeonVersionLabelText $repairVersion) 修复命令已触发，完成后点“开始检测”复查。" "Khaki"
        Add-Log "$(Get-LeonVersionLabelText $repairVersion) 一键修复已触发 $actions 个自动修复动作，完成后需要重新检测。"
    }
    else {
        Set-Progress 100
        Set-StatusText "$(Get-LeonVersionLabelText $repairVersion) 最近一次检测里没有可自动修复项。" "Khaki"
        Add-Log "$(Get-LeonVersionLabelText $repairVersion) 一键修复完成：最近一次检测里没有可自动修复项。"
    }
}

function Start-LeonService {
    Show-HomeLog
    if ($Script:ServiceTransition) {
        $msg = if ($Script:ServiceTransitionText) { $Script:ServiceTransitionText } else { "服务操作进行中..." }
        Set-StatusText $msg "Khaki"
        Add-Log "忽略重复点击：$msg" "WARN"
        return
    }
    $Script:ServiceTransition = $true
    $Script:ServiceTransitionText = "正在启动 LEON 服务..."
    Set-ServiceButtonBusy "启动中..."
    Set-StatusText "正在启动 LEON 服务..." "Khaki"
    Add-Log "启动按钮已响应，正在启动 LEON 服务..."
    if ($Script:VllmGpuCombo -and -not [string]::IsNullOrWhiteSpace($Script:VllmGpuCombo.Text)) {
        Set-VllmGpuMemoryUtilization $Script:VllmGpuCombo.Text
    }
    if (-not (Test-Path $Script:StartupBat)) {
        Add-Log "缺少启动 BAT: $Script:StartupBat" "ERROR"
        $Script:ServiceTransition = $false
        $Script:ServiceTransitionText = ""
        Update-StartButtonState $false
        return
    }
    $health = Test-ApiHealth
    if ($health) {
        Add-Log "LEON 服务已经在运行: $Script:ApiBase"
        Set-StatusText "LEON 服务已运行：$Script:ApiBase" "LightGreen"
        $Script:ServiceTransition = $false
        $Script:ServiceTransitionText = ""
        Update-StartButtonState $true
        return
    }
    Add-Log "调用启动入口: $Script:StartupBat"
    $gpuText = if ($Script:VersionKey -eq "vllm") { ", vLLM gpu_memory_utilization=$(Get-VllmGpuMemoryUtilizationText)" } else { "" }
    Add-Log "启动配置: $(Get-LeonVersionLabel)$gpuText"
    try {
        $oldNoPause = $env:LEON_LAUNCHER_NO_PAUSE
        $oldVersion = $env:LEON_LAUNCHER_VERSION
        $oldQwen = $env:LEON_ENABLE_QWEN_EMO
        $oldVllmGpu = $env:INDEXTTS_VLLM_GPU_MEMORY_UTILIZATION
        $oldPythonUtf8 = $env:PYTHONUTF8
        $oldPythonIoEncoding = $env:PYTHONIOENCODING
        $env:LEON_LAUNCHER_NO_PAUSE = "1"
        $env:LEON_LAUNCHER_VERSION = $Script:VersionKey
        $env:LEON_ENABLE_QWEN_EMO = "0"
        $env:PYTHONUTF8 = "1"
        $env:PYTHONIOENCODING = "utf-8"
        if ($Script:VersionKey -eq "vllm") {
            $env:INDEXTTS_VLLM_GPU_MEMORY_UTILIZATION = Get-VllmGpuMemoryUtilizationText
        }
        try {
            Start-Process -FilePath "cmd.exe" -ArgumentList @("/d", "/s", "/c", "chcp 65001 >nul & `"$Script:StartupBat`"") -WorkingDirectory $Script:RepoRoot -WindowStyle Hidden | Out-Null
        }
        finally {
            if ($null -eq $oldNoPause) {
                Remove-Item Env:\LEON_LAUNCHER_NO_PAUSE -ErrorAction SilentlyContinue
            }
            else {
                $env:LEON_LAUNCHER_NO_PAUSE = $oldNoPause
            }
            if ($null -eq $oldVersion) { Remove-Item Env:\LEON_LAUNCHER_VERSION -ErrorAction SilentlyContinue } else { $env:LEON_LAUNCHER_VERSION = $oldVersion }
            if ($null -eq $oldQwen) { Remove-Item Env:\LEON_ENABLE_QWEN_EMO -ErrorAction SilentlyContinue } else { $env:LEON_ENABLE_QWEN_EMO = $oldQwen }
            if ($null -eq $oldVllmGpu) { Remove-Item Env:\INDEXTTS_VLLM_GPU_MEMORY_UTILIZATION -ErrorAction SilentlyContinue } else { $env:INDEXTTS_VLLM_GPU_MEMORY_UTILIZATION = $oldVllmGpu }
            if ($null -eq $oldPythonUtf8) { Remove-Item Env:\PYTHONUTF8 -ErrorAction SilentlyContinue } else { $env:PYTHONUTF8 = $oldPythonUtf8 }
            if ($null -eq $oldPythonIoEncoding) { Remove-Item Env:\PYTHONIOENCODING -ErrorAction SilentlyContinue } else { $env:PYTHONIOENCODING = $oldPythonIoEncoding }
        }
        Set-StatusText "$(Get-LeonVersionLabel) 启动中，首次加载模型可能需要几分钟..." "Khaki"
        Start-Sleep -Milliseconds 600
        Refresh-StartupLogPaths
        Wait-ApiReadyAsync
    }
    catch {
        Add-Log "启动失败: $($_.Exception.Message)" "ERROR"
        $Script:ServiceTransition = $false
        $Script:ServiceTransitionText = ""
        Update-StartButtonState $false
    }
}

function Refresh-StartupLogPaths {
    if (Test-Path $Script:LogDir) {
        $Script:LatestStartupLog = Get-ChildItem -LiteralPath $Script:LogDir -Filter "api_restart_stable_*.log" -ErrorAction SilentlyContinue | Sort-Object LastWriteTime -Descending | Select-Object -First 1
        $Script:LatestStartupErr = Get-ChildItem -LiteralPath $Script:LogDir -Filter "api_restart_stable_*.err" -ErrorAction SilentlyContinue | Sort-Object LastWriteTime -Descending | Select-Object -First 1
    }
}

function Wait-ApiReadyAsync {
    if ($Script:ApiReadyWaitActive) { return }
    $Script:ApiReadyWaitActive = $true
    $timer = New-Object System.Windows.Forms.Timer
    $timer.Interval = 3000
    $start = Get-Date
    $lastWaitLog = -30
    $timer.Add_Tick({
        $health = Test-ApiHealth
        if ($health) {
            $timer.Stop()
            $timer.Dispose()
            $Script:ApiReadyWaitActive = $false
            Set-StatusText "LEON 服务已启动：$Script:ApiBase" "LightGreen"
            Add-Log "LEON 服务 ready: $Script:ApiBase"
            $Script:ServiceTransition = $false
            $Script:ServiceTransitionText = ""
            Update-StartButtonState $true
            Start-WarmupAsync
            return
        }
        $elapsed = [int]((Get-Date) - $start).TotalSeconds
        Set-StatusText "服务启动中... ${elapsed}s" "Khaki"
        if (($elapsed - $lastWaitLog) -ge 30) {
            Add-Log "等待 LEON 服务 ready... ${elapsed}s"
            $lastWaitLog = $elapsed
        }
        if ($elapsed -gt 300) {
            $timer.Stop()
            $timer.Dispose()
            $Script:ApiReadyWaitActive = $false
            Set-StatusText "LEON 服务启动超时，请查看日志。" "LightCoral"
            Add-Log "LEON 服务启动等待超时。" "ERROR"
            $Script:ServiceTransition = $false
            $Script:ServiceTransitionText = ""
            Update-StartButtonState $false
        }
    }.GetNewClosure())
    $timer.Start()
}

function Start-WarmupAsync {
    if ($Script:WarmupStarted) { return }
    $Script:WarmupStarted = $true
    Add-Log "检查 LEON 服务模型预热状态..."
    Set-StatusText "LEON 服务已启动，正在检查预热状态..." "Khaki"

    $timer = New-Object System.Windows.Forms.Timer
    $timer.Interval = 400
    $timer.Add_Tick({
        $timer.Stop()
        $timer.Dispose()
        try {
            $state = $null
            try {
                $state = Invoke-LeonJson -Uri "$Script:ApiBase/warmup" -TimeoutSec 5
            }
            catch {
                $state = $null
            }
            if ($state -and ($state.status -eq "ok" -or $state.status -eq "already_warmed")) {
                Set-StatusText "模型已预热，服务地址：$Script:ApiBase" "LightGreen"
                Add-Log "模型已预热: status=$($state.status), elapsed=$($state.elapsed_s)s, voice=$($state.voice)"
                Refresh-BackendLogTail
                return
            }
            if ($state -and $state.status -eq "running") {
                Set-StatusText "模型预热正在进行中..." "Khaki"
                Add-Log "模型预热正在进行中。"
                Refresh-BackendLogTail
                return
            }
            Add-Log "开始请求 LEON 服务模型预热..."
            Set-StatusText "LEON 服务已启动，正在预热模型..." "Khaki"
            $resp = Invoke-LeonJson -Uri "$Script:ApiBase/warmup" -Method Post -TimeoutSec 180
            if ($resp.status -eq "ok" -or $resp.status -eq "already_warmed") {
                Set-StatusText "模型预热完成，服务地址：$Script:ApiBase" "LightGreen"
                Add-Log "模型预热完成: status=$($resp.status), elapsed=$($resp.elapsed_s)s, voice=$($resp.voice)"
            }
            else {
                Set-StatusText "预热返回: $($resp.status)" "Khaki"
                Add-Log "模型预热返回: $($resp | ConvertTo-Json -Depth 4)" "WARN"
            }
        }
        catch {
            Set-StatusText "服务已启动，预热未完成，可稍后重试或直接使用。" "Khaki"
            Add-Log "模型预热未完成: $($_.Exception.Message)。如果当前服务是旧进程，/warmup 会在下次重启后生效。" "WARN"
        }
        Refresh-BackendLogTail
    }.GetNewClosure())
    $timer.Start()
}

function Stop-LeonService {
    Show-HomeLog
    $health = Test-ApiHealth
    if ($health) {
        try {
            Add-Log "向 LEON 服务发送退出请求..."
            Invoke-LeonJson -Uri "$Script:ApiBase/control?command=exit" -TimeoutSec 2 | Out-Null
        }
        catch {
            Add-Log "退出请求未返回，继续按端口 PID 停止服务。" "WARN"
        }
        $deadline = (Get-Date).AddSeconds(5)
        do {
            Start-Sleep -Milliseconds 500
            $pidsAfterExit = @(Get-ListeningPidsForPort -Port $Script:ApiPort)
            if ($pidsAfterExit.Count -eq 0) {
                Add-Log "LEON 服务端口已释放，继续检查残留 Python 进程。"
                break
            }
        } while ((Get-Date) -lt $deadline)
    }

    $pids = @(Get-ListeningPidsForPort -Port $Script:ApiPort)
    if ($pids.Count -eq 0) {
        Add-Log "端口 $Script:ApiPort 没有监听进程，继续检查 LEON Python 残留。"
    }
    else {
        Add-Log "强制停止监听端口 $Script:ApiPort 的进程: $($pids -join ', ')"
    }

    $remainingPython = @(Stop-LeonPythonProcesses -Reason "停止服务")
    Start-Sleep -Milliseconds 700
    $remaining = @(Get-ListeningPidsForPort -Port $Script:ApiPort)
    $remainingPython = @($remainingPython + @(Get-LeonPythonPids) | Sort-Object -Unique)
    if ($remaining.Count -eq 0 -and $remainingPython.Count -eq 0) {
        Add-Log "LEON 服务已停止。"
        Set-StatusText "服务已停止。" "Khaki"
        Update-StartButtonState $false
        $Script:WarmupStarted = $false
        $Script:ServiceTransition = $false
        $Script:ServiceTransitionText = ""
    }
    else {
        $leftText = @()
        if ($remaining.Count -gt 0) { $leftText += "端口 PID: $($remaining -join ', ')" }
        if ($remainingPython.Count -gt 0) { $leftText += "Python PID: $($remainingPython -join ', ')" }
        Add-Log "LEON 服务仍有残留，$($leftText -join '; ')" "WARN"
        Set-StatusText "服务仍在运行，请查看剩余 PID。" "Khaki"
        Update-StartButtonState $true
    }
}

function Refresh-Voices {
    Add-Log "刷新音色列表..."
    try {
        $resp = Invoke-LeonJson -Uri "$Script:ApiBase/voices" -TimeoutSec 10
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
        Add-Log "刷新音色失败，请先启动 LEON 服务: $($_.Exception.Message)" "WARN"
        Set-StatusText "刷新音色失败，请先启动 LEON 服务。" "Khaki"
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
        Add-Log "LEON 服务未运行，无法多音色测试。" "WARN"
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
        $resp = Invoke-LeonJson -Uri "$Script:ApiBase/tts_dialogue_stream_job" -Method Post -ContentType "application/json; charset=utf-8" -Body $body -TimeoutSec 20
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
            $status = Invoke-LeonJson -Uri "$Script:ApiBase/tts_dialogue_job_status/$Script:LastJobKey" -TimeoutSec 5
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
    }.GetNewClosure())
    $timer.Start()
}

function Open-LastAudio {
    if (-not $Script:LastJobKey) {
        Add-Log "还没有测试任务。" "WARN"
        return
    }
    Start-Process "$Script:ApiBase/cache_audio/$Script:LastJobKey" | Out-Null
}

function Copy-LocalTavoScript {
    $text = "<script src=`"http://$Script:LanHost`:$Script:ApiPort/static/tavo.js?v=$Script:TavoCacheBust`"></script>"
    [System.Windows.Forms.Clipboard]::SetText($text)
    Add-Log "已复制局域网 Tavo 注入脚本。"
}

function Copy-ApiUrl {
    [System.Windows.Forms.Clipboard]::SetText($Script:ApiBase)
    Add-Log "已复制 LEON 服务地址: $Script:ApiBase"
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
            $Script:WebUiStatusLabel.Text = "WebUI 未运行。点击启动 WebUI 会调用当前版本 WebUI 启动脚本。"
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
    }.GetNewClosure())
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
    if (-not $Script:LogTexts) { $Script:LogTexts = @{} }
    $launcherLog = Join-Path $Script:LogDir ("launcher-" + (Get-Date -Format "yyyyMMdd") + ".log")
    if (Test-Path $launcherLog) {
        $Script:LogTexts["launcher"] = Read-LauncherLogTail $launcherLog 160
    }
    $apiText = ""
    try {
        $apiTail = Invoke-LeonJson -Uri "$Script:ApiBase/server_log/tail?n=220" -TimeoutSec 2
        if ($apiTail -and $apiTail.lines) {
            foreach ($line in @($apiTail.lines)) {
                $lineText = [string]$line.line
                if (Test-NoisyServerLogLine $lineText) { continue }
                $ts = ""
                try { $ts = ([DateTimeOffset]::FromUnixTimeSeconds([int64]$line.ts).ToLocalTime().ToString("HH:mm:ss")) } catch { $ts = "--:--:--" }
                $apiText += "[$ts] [$($line.stream)] $lineText`r`n"
            }
        }
    }
    catch {}
    if ([string]::IsNullOrWhiteSpace($apiText)) {
        $apiText = "服务日志暂无有效内容。已隐藏 /health 和 /server_log/tail 自检请求。"
    }
    $Script:LogTexts["api"] = Normalize-LauncherLogText $apiText

    $stdoutText = ""
    if ($Script:LatestStartupLog -and (Test-Path $Script:LatestStartupLog.FullName)) {
        $stdoutText = Read-LauncherLogTail $Script:LatestStartupLog.FullName 160
    }
    if ([string]::IsNullOrWhiteSpace($stdoutText)) { $stdoutText = "未发现当前服务启动日志。" }
    $Script:LogTexts["stdout"] = $stdoutText

    $stderrText = ""
    if ($Script:LatestStartupErr -and (Test-Path $Script:LatestStartupErr.FullName)) {
        $stderrText = Read-LauncherLogTail $Script:LatestStartupErr.FullName 160
    }
    if ([string]::IsNullOrWhiteSpace($stderrText)) { $stderrText = "未发现当前诊断日志。" }
    $Script:LogTexts["stderr"] = $stderrText
    if (-not (Test-LogTextSelected)) {
        Set-LogTabActive $Script:ActiveLogTab
    }
}

function Start-InitialLauncherRefreshAsync {
    param([System.Windows.Forms.Form]$Form)

    $healthTimer = New-Object System.Windows.Forms.Timer
    $healthTimer.Interval = 250
    $healthTimer.Add_Tick({
        $healthTimer.Stop()
        $healthTimer.Dispose()
        if ($Form -and $Form.IsDisposed) { return }

        $health = Test-ApiHealth
        Update-StartButtonState ($null -ne $health)
        if ($health) {
            Set-StatusText "LEON 服务已运行：$Script:ApiBase" "LightGreen"
        }
        else {
            Set-StatusText "就绪。需要时点环境检测。" "Khaki"
        }
        Sync-VllmGpuControls
    }.GetNewClosure())
    $healthTimer.Start()

    # 日志尾部拉取会访问本地文件和 API，延后到首屏绘制后再做。
    $logTimer = New-Object System.Windows.Forms.Timer
    $logTimer.Interval = 900
    $logTimer.Add_Tick({
        $logTimer.Stop()
        $logTimer.Dispose()
        if ($Form -and $Form.IsDisposed) { return }
        if ($Script:LogPanel -and -not $Script:LogPanel.Visible) { return }
        Refresh-BackendLogTail
    }.GetNewClosure())
    $logTimer.Start()
}

function Build-LauncherForm {
    $form = New-Object System.Windows.Forms.Form
    $form.Text = "LEON 启动器 - IndexTTS2"
    $form.StartPosition = "CenterScreen"
    $form.Size = New-Object System.Drawing.Size(1240, 820)
    $form.MinimumSize = New-Object System.Drawing.Size(1120, 720)
    $form.FormBorderStyle = [System.Windows.Forms.FormBorderStyle]::Sizable
    $form.MaximizeBox = $true
    $form.MinimizeBox = $true
    $form.SizeGripStyle = [System.Windows.Forms.SizeGripStyle]::Show
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

    if ($false -and (Test-Path $Script:BannerPath)) {
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
    $sub.Text = "IndexTTS2 本地语音服务 · vLLM / fast6g 可选"
    $sub.Font = New-Font 10
    $sub.ForeColor = [System.Drawing.Color]::Gainsboro
    $sub.BackColor = [System.Drawing.Color]::Transparent
    $sub.Location = New-Object System.Drawing.Point(29, 62)
    $sub.Size = New-Object System.Drawing.Size(560, 24)
    $header.Controls.Add($sub)
    $sub.BringToFront()

    $Script:StatusLabel = New-Object System.Windows.Forms.Label
    $Script:StatusLabel.Text = "打开后不会自动检测。需要时点环境检测。"
    $Script:StatusLabel.Font = New-Font 9
    $Script:StatusLabel.ForeColor = [System.Drawing.Color]::Khaki
    $Script:StatusLabel.BackColor = [System.Drawing.Color]::Transparent
    $Script:StatusLabel.Location = New-Object System.Drawing.Point(29, 92)
    $Script:StatusLabel.Size = New-Object System.Drawing.Size(640, 24)
    $header.Controls.Add($Script:StatusLabel)
    $Script:StatusLabel.BringToFront()

    $Script:ProgressBar = $null

    $main = New-Object System.Windows.Forms.SplitContainer
    $main.Dock = "Fill"
    $main.Size = New-Object System.Drawing.Size(
        [Math]::Max(980, $form.ClientSize.Width),
        [Math]::Max(560, $form.ClientSize.Height - $header.Height)
    )
    $main.FixedPanel = [System.Windows.Forms.FixedPanel]::Panel1
    $main.IsSplitterFixed = $false
    $main.Panel1MinSize = 180
    $main.Panel2MinSize = 720
    $main.SplitterDistance = 220
    $main.BackColor = [System.Drawing.Color]::FromArgb(15, 18, 22)
    $main.Panel1.BackColor = [System.Drawing.Color]::FromArgb(21, 25, 31)
    $main.Panel2.BackColor = [System.Drawing.Color]::FromArgb(15, 18, 22)
    $form.Controls.Add($main)
    $main.BringToFront()

    $tabs = New-Object System.Windows.Forms.TabControl
    $tabs.Dock = "Fill"
    $tabs.Font = New-Font 9
    $tabs.BackColor = [System.Drawing.Color]::FromArgb(15, 18, 22)
    $tabs.Appearance = [System.Windows.Forms.TabAppearance]::FlatButtons
    $tabs.SizeMode = [System.Windows.Forms.TabSizeMode]::Fixed
    $tabs.ItemSize = New-Object System.Drawing.Size(0, 1)
    $main.Panel2.Controls.Add($tabs)
    $Script:Tabs = $tabs

    $buttons = @(
        @("环境检测", { $tabs.SelectedIndex = 1; Run-EnvironmentCheck }),
        @("一键修复", { $tabs.SelectedIndex = 1; Repair-Environment })
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
    $info.Text = "服务地址: $Script:ApiBase`r`n打开后只检测环境，不会自动启动服务。"
    $info.ForeColor = [System.Drawing.Color]::Silver
    $info.Location = New-Object System.Drawing.Point(18, 320)
    $info.Size = New-Object System.Drawing.Size(176, 80)
    $main.Panel1.Controls.Add($info)

    $versionLabel = New-Object System.Windows.Forms.Label
    $versionLabel.Text = "启动版本"
    $versionLabel.ForeColor = [System.Drawing.Color]::Gainsboro
    $versionLabel.Location = New-Object System.Drawing.Point(18, 388)
    $versionLabel.Size = New-Object System.Drawing.Size(178, 20)
    $main.Panel1.Controls.Add($versionLabel)

    $Script:VersionCombo = New-Object System.Windows.Forms.ComboBox
    $Script:VersionCombo.DropDownStyle = "DropDownList"
    [void]$Script:VersionCombo.Items.Add("vllm")
    [void]$Script:VersionCombo.Items.Add("fast6g")
    $Script:VersionCombo.SelectedItem = $Script:VersionKey
    $Script:VersionCombo.Location = New-Object System.Drawing.Point(18, 410)
    $Script:VersionCombo.Size = New-Object System.Drawing.Size(178, 28)
    $Script:VersionCombo.Add_SelectedIndexChanged({
        if ($Script:VersionCombo.SelectedItem) {
            Set-LeonVersion ([string]$Script:VersionCombo.SelectedItem)
            Add-Log "已选择启动版本: $(Get-LeonVersionLabel)"
            Set-StatusText "当前启动版本：$(Get-LeonVersionLabel)" "Khaki"
            Refresh-WebUiPanel | Out-Null
        }
    })
    $main.Panel1.Controls.Add($Script:VersionCombo)

    $vllmGpuLabel = New-Object System.Windows.Forms.Label
    $vllmGpuLabel.Text = "vLLM 显存比例（仅 vLLM）"
    $vllmGpuLabel.ForeColor = [System.Drawing.Color]::Gainsboro
    $vllmGpuLabel.Location = New-Object System.Drawing.Point(18, 444)
    $vllmGpuLabel.Size = New-Object System.Drawing.Size(178, 18)
    $main.Panel1.Controls.Add($vllmGpuLabel)

    $Script:VllmGpuCombo = New-Object System.Windows.Forms.ComboBox
    $Script:VllmGpuCombo.DropDownStyle = "DropDownList"
    [void]$Script:VllmGpuCombo.Items.Add("0.18 默认")
    [void]$Script:VllmGpuCombo.Items.Add("0.11 保守")
    $Script:VllmGpuCombo.Location = New-Object System.Drawing.Point(18, 464)
    $Script:VllmGpuCombo.Size = New-Object System.Drawing.Size(178, 28)
    $Script:VllmGpuCombo.Add_SelectedIndexChanged({
        if ($Script:VllmGpuCombo.SelectedItem) {
            Set-VllmGpuMemoryUtilization ([string]$Script:VllmGpuCombo.SelectedItem)
            Add-Log "vLLM gpu_memory_utilization 已设为 $(Get-VllmGpuMemoryUtilizationText)"
        }
    })
    $main.Panel1.Controls.Add($Script:VllmGpuCombo)
    Sync-VllmGpuControls

    $Script:QwenEmotionCheck = New-Object System.Windows.Forms.CheckBox
    $Script:QwenEmotionCheck.Text = "Qwen emotion 已弃用"
    $Script:QwenEmotionCheck.ForeColor = [System.Drawing.Color]::Silver
    $Script:QwenEmotionCheck.BackColor = [System.Drawing.Color]::FromArgb(21, 25, 31)
    $Script:QwenEmotionCheck.Checked = $false
    $Script:QwenEmotionCheck.Enabled = $false
    $Script:QwenEmotionCheck.Visible = $false
    $Script:QwenEmotionCheck.Location = New-Object System.Drawing.Point(18, 500)
    $Script:QwenEmotionCheck.Size = New-Object System.Drawing.Size(178, 24)
    $Script:QwenEmotionCheck.Add_CheckedChanged({
        $Script:EnableQwenEmotion = $false
        $Script:QwenEmotionCheck.Checked = $false
    })
    $main.Panel1.Controls.Add($Script:QwenEmotionCheck)

    $Script:StartButton = New-Object System.Windows.Forms.Button
    $Script:StartButton.Text = "启动 LEON 服务"
    $Script:StartButton.Location = New-Object System.Drawing.Point(18, 490)
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
        if ($startY -lt 492) { $startY = 492 }
        $Script:StartButton.Location = New-Object System.Drawing.Point(18, $startY)
        $Script:StartButton.Size = New-Object System.Drawing.Size([Math]::Max(160, $panelWidth - 36), $startHeight)
        $versionLabel.Location = New-Object System.Drawing.Point(18, [Math]::Max($y + 8, $startY - 142))
        $versionLabel.Size = New-Object System.Drawing.Size([Math]::Max(150, $panelWidth - 36), 20)
        $Script:VersionCombo.Location = New-Object System.Drawing.Point(18, ($versionLabel.Location.Y + 22))
        $Script:VersionCombo.Size = New-Object System.Drawing.Size([Math]::Max(150, $panelWidth - 36), 28)
        $vllmGpuLabel.Location = New-Object System.Drawing.Point(18, ($Script:VersionCombo.Location.Y + 34))
        $vllmGpuLabel.Size = New-Object System.Drawing.Size([Math]::Max(150, $panelWidth - 36), 18)
        $Script:VllmGpuCombo.Location = New-Object System.Drawing.Point(18, ($vllmGpuLabel.Location.Y + 20))
        $Script:VllmGpuCombo.Size = New-Object System.Drawing.Size([Math]::Max(150, $panelWidth - 36), 28)
        $Script:QwenEmotionCheck.Location = New-Object System.Drawing.Point(18, ($Script:VllmGpuCombo.Location.Y + 34))
        $Script:QwenEmotionCheck.Size = New-Object System.Drawing.Size([Math]::Max(150, $panelWidth - 36), 24)
        $infoTop = $y + 8
        $infoSpace = $versionLabel.Location.Y - $infoTop - 8
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
    $logHint.Text = "启动器日志 + LEON 服务日志"
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
    $copyPublic.Text = "复制局域网脚本"
    $copyPublic.Location = New-Object System.Drawing.Point(16, 10)
    $copyPublic.Size = New-Object System.Drawing.Size(120, 32)
    $copyPublic.Add_Click({ Copy-LocalTavoScript })
    $tavoPanel.Controls.Add($copyPublic)

    $copyLocal = New-Object System.Windows.Forms.Button
    $copyLocal.Text = "打开脚本"
    $copyLocal.Location = New-Object System.Drawing.Point(146, 10)
    $copyLocal.Size = New-Object System.Drawing.Size(130, 32)
    $copyLocal.Add_Click({ Start-Process "$Script:ApiBase/static/tavo.js?v=$Script:TavoCacheBust" | Out-Null })
    $tavoPanel.Controls.Add($copyLocal)

    $copyApi = New-Object System.Windows.Forms.Button
    $copyApi.Text = "复制服务地址"
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
2. 点击左下角“启动 LEON 服务”，等待状态显示服务已启动。
3. Tavo 里打开高级前端渲染：
   左侧边栏 -> 更多 -> 设置 -> 高级前端渲染 -> 打开。
4. 在 Tavo 正则里新增显示时注入规则。手机和电脑在同一个局域网时，把替换内容设为：

   <script src="http://$Script:LanHost`:$Script:ApiPort/static/tavo.js?v=$Script:TavoCacheBust"></script>

   如果需要公网访问，公网域名由你自己的隧道/反代配置提供。
   这个程序不检测、不保存、不依赖公网域名；只要公网地址能访问 /static/tavo.js，就可以把 script 的 host 换成你的公网 host。

5. 正则建议：
   - 作用范围：角色消息 / 显示时。
   - 替换参数：原文替换。
   - 如果只是追加播放器脚本，Find Regex 可以匹配整条消息，再在 Replace With 末尾追加 script。

常用地址

服务地址: $Script:ApiBase
本地测试页: $Script:ApiBase/tavo_test
脚本地址: $Script:ApiBase/static/tavo.js

注意

- Tavo 前端智能模式由 LEON 服务创建任务并解析，不应该让 WebView 先调用 /parse_text。
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

function Build-LauncherForm {
    $form = New-Object System.Windows.Forms.Form
    $form.Text = $Script:LauncherWindowTitle
    $form.StartPosition = "CenterScreen"
    $form.Size = New-Object System.Drawing.Size(1040, 720)
    $form.MinimumSize = New-Object System.Drawing.Size(920, 620)
    $form.FormBorderStyle = [System.Windows.Forms.FormBorderStyle]::Sizable
    $form.MaximizeBox = $true
    $form.MinimizeBox = $true
    $form.SizeGripStyle = [System.Windows.Forms.SizeGripStyle]::Show
    $form.BackColor = [System.Drawing.Color]::FromArgb(14, 18, 23)
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
    $header.Height = 104
    $header.BackColor = [System.Drawing.Color]::FromArgb(12, 16, 21)
    $form.Controls.Add($header)

    $title = New-Object System.Windows.Forms.Label
    $title.Text = "LEON 启动器"
    $title.Font = New-Font 22 ([System.Drawing.FontStyle]::Bold)
    $title.ForeColor = [System.Drawing.Color]::White
    $title.Location = New-Object System.Drawing.Point(24, 18)
    $title.Size = New-Object System.Drawing.Size(420, 40)
    $header.Controls.Add($title)

    $sub = New-Object System.Windows.Forms.Label
    $sub.Text = "IndexTTS2 本地语音服务 · vLLM / fast6g"
    $sub.Font = New-Font 10
    $sub.ForeColor = [System.Drawing.Color]::Gainsboro
    $sub.Location = New-Object System.Drawing.Point(27, 58)
    $sub.Size = New-Object System.Drawing.Size(520, 22)
    $header.Controls.Add($sub)

    $Script:StatusLabel = New-Object System.Windows.Forms.Label
    $Script:StatusLabel.Text = "就绪"
    $Script:StatusLabel.Font = New-Font 9
    $Script:StatusLabel.ForeColor = [System.Drawing.Color]::FromArgb(178, 188, 198)
    $Script:StatusLabel.Tag = "muted-header"
    $Script:StatusLabel.Anchor = [System.Windows.Forms.AnchorStyles]::Top -bor [System.Windows.Forms.AnchorStyles]::Right
    $Script:StatusLabel.TextAlign = [System.Drawing.ContentAlignment]::MiddleRight
    $Script:StatusLabel.Location = New-Object System.Drawing.Point(560, 36)
    $Script:StatusLabel.Size = New-Object System.Drawing.Size(420, 24)
    $header.Controls.Add($Script:StatusLabel)

    $side = New-Object System.Windows.Forms.Panel
    $side.Dock = "Left"
    $side.Width = 244
    $side.Padding = New-Object System.Windows.Forms.Padding(20, 18, 20, 18)
    $side.BackColor = [System.Drawing.Color]::FromArgb(19, 24, 31)
    $form.Controls.Add($side)

    $content = New-Object System.Windows.Forms.Panel
    $content.Dock = "Fill"
    $content.Padding = New-Object System.Windows.Forms.Padding(20, 18, 20, 20)
    $content.BackColor = [System.Drawing.Color]::FromArgb(14, 18, 23)
    $form.Controls.Add($content)
    $content.BringToFront()

    function Add-SideLabel {
        param([string]$Text, [int]$Y)
        $label = New-Object System.Windows.Forms.Label
        $label.Text = $Text
        $label.ForeColor = [System.Drawing.Color]::Gainsboro
        $label.Location = New-Object System.Drawing.Point(20, $Y)
        $label.Size = New-Object System.Drawing.Size(204, 20)
        $side.Controls.Add($label)
        return $label
    }
    function Add-SideButton {
        param([string]$Text, [int]$Y, [scriptblock]$Handler, [System.Drawing.Color]$BackColor)
        $btn = New-Object System.Windows.Forms.Button
        $btn.Text = $Text
        $btn.Location = New-Object System.Drawing.Point(20, $Y)
        $btn.Size = New-Object System.Drawing.Size(204, 38)
        $btn.FlatStyle = "Flat"
        $btn.ForeColor = [System.Drawing.Color]::White
        $btn.BackColor = $BackColor
        $btn.FlatAppearance.BorderColor = [System.Drawing.Color]::FromArgb(58, 70, 84)
        $btn.FlatAppearance.BorderSize = 1
        $btn.Add_Click($Handler)
        $side.Controls.Add($btn)
        return $btn
    }

    Add-SideLabel "启动版本" 20 | Out-Null
    $Script:VersionCombo = New-Object System.Windows.Forms.ComboBox
    $Script:VersionCombo.DropDownStyle = "DropDownList"
    [void]$Script:VersionCombo.Items.Add("vllm")
    [void]$Script:VersionCombo.Items.Add("fast6g")
    $Script:VersionCombo.SelectedItem = $Script:VersionKey
    $Script:VersionCombo.Location = New-Object System.Drawing.Point(20, 42)
    $Script:VersionCombo.Size = New-Object System.Drawing.Size(204, 28)
    $Script:VersionCombo.Add_SelectedIndexChanged({
        if ($Script:VersionCombo.SelectedItem) {
            Set-LeonVersion ([string]$Script:VersionCombo.SelectedItem)
            Set-StatusText "当前启动版本：$(Get-LeonVersionLabel)" "Khaki"
        }
    })
    $side.Controls.Add($Script:VersionCombo)

    Add-SideLabel "vLLM 显存比例" 88 | Out-Null
    $Script:VllmGpuCombo = New-Object System.Windows.Forms.TextBox
    $Script:VllmGpuCombo.Text = Get-VllmGpuMemoryUtilizationText
    $Script:VllmGpuCombo.Location = New-Object System.Drawing.Point(20, 110)
    $Script:VllmGpuCombo.Size = New-Object System.Drawing.Size(204, 28)
    $Script:VllmGpuCombo.BackColor = [System.Drawing.Color]::FromArgb(245, 247, 250)
    $Script:VllmGpuCombo.ForeColor = [System.Drawing.Color]::Black
    $Script:VllmGpuCombo.Add_Leave({
        Set-VllmGpuMemoryUtilization $Script:VllmGpuCombo.Text
        $Script:VllmGpuCombo.Text = Get-VllmGpuMemoryUtilizationText
    })
    $Script:VllmGpuCombo.Add_KeyDown({
        if ($_.KeyCode -eq [System.Windows.Forms.Keys]::Enter) {
            Set-VllmGpuMemoryUtilization $Script:VllmGpuCombo.Text
            $Script:VllmGpuCombo.Text = Get-VllmGpuMemoryUtilizationText
            $_.SuppressKeyPress = $true
        }
    })
    $side.Controls.Add($Script:VllmGpuCombo)

    $hint = New-Object System.Windows.Forms.Label
    $hint.Text = "默认 0.15；保守可填 0.11。仅 vLLM 生效。"
    $hint.ForeColor = [System.Drawing.Color]::Silver
    $hint.Location = New-Object System.Drawing.Point(20, 142)
    $hint.Size = New-Object System.Drawing.Size(204, 42)
    $side.Controls.Add($hint)

    $Script:StartButton = Add-SideButton "启动 LEON 服务" 202 { Toggle-LeonService } ([System.Drawing.Color]::FromArgb(25, 126, 89))
    $Script:StartButton.Font = New-Font 13 ([System.Drawing.FontStyle]::Bold)
    $Script:StartButton.Size = New-Object System.Drawing.Size(204, 68)
    $Script:StartButton.FlatAppearance.BorderColor = [System.Drawing.Color]::FromArgb(110, 210, 160)

    Add-SideButton "环境检测" 292 { Run-EnvironmentCheck } ([System.Drawing.Color]::FromArgb(35, 45, 56)) | Out-Null
    Add-SideButton "一键修复" 338 { Repair-Environment } ([System.Drawing.Color]::FromArgb(35, 45, 56)) | Out-Null

    $apiLabel = New-Object System.Windows.Forms.Label
    $apiLabel.Text = "服务地址: $Script:ApiBase"
    $apiLabel.ForeColor = [System.Drawing.Color]::Silver
    $apiLabel.Location = New-Object System.Drawing.Point(20, 408)
    $apiLabel.Size = New-Object System.Drawing.Size(204, 40)
    $side.Controls.Add($apiLabel)

    $envTitle = New-Object System.Windows.Forms.Label
    $envTitle.Text = "环境检测"
    $envTitle.Font = New-Font 15 ([System.Drawing.FontStyle]::Bold)
    $envTitle.ForeColor = [System.Drawing.Color]::White
    $envTitle.Dock = "Top"
    $envTitle.Height = 34
    $content.Controls.Add($envTitle)

    $Script:ProgressBar = New-Object System.Windows.Forms.ProgressBar
    $Script:ProgressBar.Dock = "Top"
    $Script:ProgressBar.Height = 10
    $Script:ProgressBar.Margin = New-Object System.Windows.Forms.Padding(0, 0, 0, 12)
    $content.Controls.Add($Script:ProgressBar)
    $Script:ProgressBar.BringToFront()

    $Script:CheckList = New-Object System.Windows.Forms.ListView
    $Script:CheckList.Dock = "Fill"
    $Script:CheckList.View = "Details"
    $Script:CheckList.FullRowSelect = $true
    $Script:CheckList.GridLines = $false
    $Script:CheckList.BorderStyle = "None"
    $Script:CheckList.BackColor = [System.Drawing.Color]::FromArgb(16, 21, 27)
    $Script:CheckList.ForeColor = [System.Drawing.Color]::WhiteSmoke
    $Script:CheckList.Font = New-Font 9
    [void]$Script:CheckList.Columns.Add("检查项", 220)
    [void]$Script:CheckList.Columns.Add("状态", 80)
    [void]$Script:CheckList.Columns.Add("详情", 680)
    $content.Controls.Add($Script:CheckList)
    $Script:CheckList.BringToFront()

    $form.Add_Shown({
        $health = Test-ApiHealth
        Update-StartButtonState $health
        if ($health) {
            Set-StatusText "LEON 服务已运行：$Script:ApiBase" "LightGreen"
        }
        else {
            Set-StatusText "就绪。需要时点环境检测。" "Khaki"
        }
        Sync-VllmGpuControls
    })
    $form.Add_Resize({
        if ($Script:StatusLabel) {
            $Script:StatusLabel.Location = New-Object System.Drawing.Point([Math]::Max(460, $form.ClientSize.Width - 460), 36)
            $Script:StatusLabel.Size = New-Object System.Drawing.Size(420, 24)
        }
    })
    $form.Add_FormClosed({
        if ($Script:LauncherIcon) {
            $Script:LauncherIcon.Dispose()
            $Script:LauncherIcon = $null
        }
    })
    return $form
}

function New-DarkLogBox {
    $box = New-Object System.Windows.Forms.RichTextBox
    $box.Multiline = $true
    $box.Dock = "Fill"
    $box.ScrollBars = [System.Windows.Forms.RichTextBoxScrollBars]::Vertical
    $box.WordWrap = $true
    $box.ReadOnly = $true
    $box.HideSelection = $false
    $box.ShortcutsEnabled = $true
    $box.BorderStyle = "None"
    $box.DetectUrls = $false
    $box.BackColor = [System.Drawing.Color]::FromArgb(10, 14, 19)
    $box.ForeColor = [System.Drawing.Color]::FromArgb(214, 224, 232)
    $box.Font = New-Object System.Drawing.Font("Consolas", 10)
    $menu = New-Object System.Windows.Forms.ContextMenuStrip
    $copyItem = New-Object System.Windows.Forms.ToolStripMenuItem("复制")
    $copyItem.Add_Click({
        if ($box.SelectionLength -gt 0) {
            $box.Copy()
        }
    })
    [void]$menu.Items.Add($copyItem)
    $copyAllItem = New-Object System.Windows.Forms.ToolStripMenuItem("复制全部")
    $copyAllItem.Add_Click({
        if (-not [string]::IsNullOrEmpty($box.Text)) {
            [System.Windows.Forms.Clipboard]::SetText($box.Text)
        }
    })
    [void]$menu.Items.Add($copyAllItem)
    $selectAllItem = New-Object System.Windows.Forms.ToolStripMenuItem("全选")
    $selectAllItem.Add_Click({ $box.SelectAll() })
    [void]$menu.Items.Add($selectAllItem)
    $box.ContextMenuStrip = $menu
    return $box
}

function Use-NativeLogViewer {
    return $true
}

function New-LauncherSection {
    param(
        [string]$Title,
        [int]$Height = 0
    )
    $panel = New-Object System.Windows.Forms.Panel
    $panel.Dock = "Top"
    if ($Height -gt 0) { $panel.Height = $Height }
    $panel.Padding = New-Object System.Windows.Forms.Padding(14, 10, 14, 14)
    $panel.BackColor = [System.Drawing.Color]::FromArgb(17, 22, 29)

    $label = New-Object System.Windows.Forms.Label
    $label.Text = $Title
    $label.Dock = "Top"
    $label.Height = 24
    $label.ForeColor = [System.Drawing.Color]::WhiteSmoke
    $label.Font = New-Font 10 ([System.Drawing.FontStyle]::Bold)
    $panel.Controls.Add($label)

    return $panel
}

function Build-LauncherForm {
    $form = New-Object System.Windows.Forms.Form
    $form.Text = $Script:LauncherWindowTitle
    $form.StartPosition = "CenterScreen"
    $form.Size = New-Object System.Drawing.Size(1120, 760)
    $form.MinimumSize = New-Object System.Drawing.Size(980, 660)
    $form.FormBorderStyle = [System.Windows.Forms.FormBorderStyle]::Sizable
    $form.MaximizeBox = $true
    $form.MinimizeBox = $true
    $form.SizeGripStyle = [System.Windows.Forms.SizeGripStyle]::Show
    $form.BackColor = [System.Drawing.Color]::FromArgb(12, 16, 21)
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

    $root = New-Object System.Windows.Forms.Panel
    $root.Dock = "Fill"
    $root.BackColor = [System.Drawing.Color]::FromArgb(12, 16, 21)
    $form.Controls.Add($root)

    $header = New-Object System.Windows.Forms.Panel
    $header.Dock = "Top"
    $header.Height = 156
    $header.Padding = New-Object System.Windows.Forms.Padding(28, 18, 28, 14)
    $header.BackColor = [System.Drawing.Color]::FromArgb(10, 14, 19)
    $root.Controls.Add($header)
    $heroImage = Add-CoverImageBackground -Control $header -ImagePath $Script:HeroPath -Description "启动器横幅" -HorizontalAlign "Center" -VerticalAlign "Center"

    $Script:StatusLabel = New-Object System.Windows.Forms.Label
    $Script:StatusLabel.Text = "就绪"
    $Script:StatusLabel.Font = New-Font 9
    $Script:StatusLabel.ForeColor = [System.Drawing.Color]::FromArgb(178, 188, 198)
    $Script:StatusLabel.BackColor = [System.Drawing.Color]::Transparent
    $Script:StatusLabel.Tag = "hidden-header-status"
    $Script:StatusLabel.Anchor = [System.Windows.Forms.AnchorStyles]::Top -bor [System.Windows.Forms.AnchorStyles]::Right
    $Script:StatusLabel.TextAlign = [System.Drawing.ContentAlignment]::MiddleRight
    $Script:StatusLabel.Location = New-Object System.Drawing.Point(610, 42)
    $Script:StatusLabel.Size = New-Object System.Drawing.Size(460, 24)
    $Script:StatusLabel.Visible = $false
    $header.Controls.Add($Script:StatusLabel)

    $body = New-Object System.Windows.Forms.Panel
    $body.Dock = "Fill"
    $body.BackColor = [System.Drawing.Color]::FromArgb(12, 16, 21)
    $root.Controls.Add($body)
    $body.BringToFront()

    $side = New-Object System.Windows.Forms.Panel
    $side.Dock = "Left"
    $side.Width = 244
    $side.Padding = New-Object System.Windows.Forms.Padding(18, 18, 18, 18)
    $side.BackColor = [System.Drawing.Color]::FromArgb(18, 24, 31)
    $body.Controls.Add($side)
    $sideImage = $null

    $navBack = New-Object System.Windows.Forms.Panel
    $navBack.Location = New-Object System.Drawing.Point(18, 18)
    $navBack.Size = New-Object System.Drawing.Size(208, 134)
    $navBack.BackColor = [System.Drawing.Color]::FromArgb(13, 18, 24)
    $side.Controls.Add($navBack)

    $content = New-Object System.Windows.Forms.Panel
    $content.Dock = "Fill"
    $content.Padding = New-Object System.Windows.Forms.Padding(20, 18, 20, 20)
    $content.BackColor = [System.Drawing.Color]::FromArgb(12, 16, 21)
    $body.Controls.Add($content)
    $content.BringToFront()

    function Add-SideLabel {
        param([string]$Text, [int]$Y)
        $label = New-Object System.Windows.Forms.Label
        $label.Text = $Text
        $label.ForeColor = [System.Drawing.Color]::FromArgb(194, 204, 214)
        $label.Location = New-Object System.Drawing.Point(20, $Y)
        $label.Size = New-Object System.Drawing.Size(204, 20)
        $side.Controls.Add($label)
        return $label
    }
    function Add-SideButton {
        param([string]$Text, [int]$Y, [scriptblock]$Handler, [System.Drawing.Color]$BackColor)
        $btn = New-Object System.Windows.Forms.Button
        $btn.Text = $Text
        $btn.Location = New-Object System.Drawing.Point(20, $Y)
        $btn.Size = New-Object System.Drawing.Size(204, 38)
        $btn.FlatStyle = "Flat"
        $btn.ForeColor = [System.Drawing.Color]::White
        $btn.BackColor = $BackColor
        $btn.FlatAppearance.BorderColor = [System.Drawing.Color]::FromArgb(58, 70, 84)
        $btn.FlatAppearance.BorderSize = 1
        $btn.Add_Click($Handler)
        $side.Controls.Add($btn)
        return $btn
    }

    $Script:NavButtons = @{}

    $homeNav = Add-SideButton "首页" 20 { Show-LauncherHome } ([System.Drawing.Color]::FromArgb(30, 39, 49))
    $Script:NavButtons["home"] = $homeNav
    $logNavButton = Add-SideButton "日志" 66 { Show-HomeLog } ([System.Drawing.Color]::FromArgb(30, 39, 49))
    $Script:NavButtons["log"] = $logNavButton
    $envNav = Add-SideButton "环境检测" 112 { Show-EnvironmentPanel; if (-not $Script:EnvCheckRows -or $Script:EnvCheckRows.Count -eq 0) { Initialize-EnvironmentCheckRows }; Set-Progress 0 } ([System.Drawing.Color]::FromArgb(30, 39, 49))
    $Script:NavButtons["env"] = $envNav
    $navBack.SendToBack()
    $homeNav.BringToFront()
    $logNavButton.BringToFront()
    $envNav.BringToFront()

    $bottomPanel = New-Object System.Windows.Forms.Panel
    $bottomPanel.Dock = "Bottom"
    $bottomPanel.Height = 132
    $bottomPanel.BackColor = $side.BackColor
    $side.Controls.Add($bottomPanel)

    $sidePosterImage = $null
    $sidePosterBox = New-Object System.Windows.Forms.Panel
    $sidePosterBox.BackColor = [System.Drawing.Color]::Transparent
    $side.Controls.Add($sidePosterBox)
    $sidePosterImage = Add-CoverImageBackground -Control $sidePosterBox -ImagePath $Script:SideImagePath -Description "左侧预览图" -HorizontalAlign "Center" -VerticalAlign "Center" -ScaleMode "FitWidth"
    $resizeSidePoster = {
        if (-not $sidePosterBox) { return }
        $posterTop = 166
        $posterBottomGap = $bottomPanel.Height + 18
        $posterHeight = [Math]::Max(120, $side.ClientSize.Height - $posterTop - $posterBottomGap)
        $sidePosterBox.Location = New-Object System.Drawing.Point(18, $posterTop)
        $sidePosterBox.Size = New-Object System.Drawing.Size([Math]::Max(120, $side.ClientSize.Width - 36), $posterHeight)
    }.GetNewClosure()
    & $resizeSidePoster
    $side.Add_Resize($resizeSidePoster)

    $configRow = New-Object System.Windows.Forms.Panel
    $configRow.Size = New-Object System.Drawing.Size(204, 32)
    $configRow.Location = New-Object System.Drawing.Point(0, 0)
    $configRow.BackColor = $side.BackColor
    $bottomPanel.Controls.Add($configRow)

    $Script:VersionCombo = New-Object System.Windows.Forms.Panel
    $Script:VersionCombo.Tag = "segmented-version"
    $Script:VersionCombo.Location = New-Object System.Drawing.Point(0, 0)
    $Script:VersionCombo.Size = New-Object System.Drawing.Size(126, 32)
    $Script:VersionCombo.BackColor = [System.Drawing.Color]::FromArgb(18, 24, 31)
    $configRow.Controls.Add($Script:VersionCombo)

    function Add-VersionSegmentButton {
        param([string]$Key, [string]$Text, [int]$X, [int]$Width)
        $btn = New-Object System.Windows.Forms.Button
        $btn.Text = $Text
        $btn.Tag = $Key
        $btn.Location = New-Object System.Drawing.Point($X, 0)
        $btn.Size = New-Object System.Drawing.Size($Width, 32)
        $btn.FlatStyle = "Flat"
        $btn.Font = New-Font 9 ([System.Drawing.FontStyle]::Bold)
        $btn.BackColor = [System.Drawing.Color]::FromArgb(24, 31, 39)
        $btn.ForeColor = [System.Drawing.Color]::FromArgb(202, 212, 222)
        $btn.FlatAppearance.BorderColor = [System.Drawing.Color]::FromArgb(46, 56, 68)
        $btn.FlatAppearance.BorderSize = 1
        $btn.Add_Click({
            Set-LeonVersion ([string]$this.Tag)
            Set-StatusText "已切换到 $(Get-LeonVersionLabel)。" "Khaki"
        })
        $Script:VersionCombo.Controls.Add($btn)
    }
    Add-VersionSegmentButton "vllm" "vLLM" 0 63
    Add-VersionSegmentButton "fast6g" "6G" 63 63

    $Script:VllmGpuShell = New-Object System.Windows.Forms.Panel
    $Script:VllmGpuShell.Location = New-Object System.Drawing.Point(136, 0)
    $Script:VllmGpuShell.Size = New-Object System.Drawing.Size(68, 32)
    $Script:VllmGpuShell.BackColor = [System.Drawing.Color]::FromArgb(24, 31, 39)
    $configRow.Controls.Add($Script:VllmGpuShell)

    $Script:VllmGpuCombo = New-Object System.Windows.Forms.TextBox
    $Script:VllmGpuCombo.Text = Get-VllmGpuMemoryUtilizationText
    $Script:VllmGpuCombo.Location = New-Object System.Drawing.Point(1, 5)
    $Script:VllmGpuCombo.Size = New-Object System.Drawing.Size(66, 22)
    $Script:VllmGpuCombo.BackColor = [System.Drawing.Color]::FromArgb(24, 31, 39)
    $Script:VllmGpuCombo.ForeColor = [System.Drawing.Color]::White
    $Script:VllmGpuCombo.Font = New-Font 10 ([System.Drawing.FontStyle]::Bold)
    $Script:VllmGpuCombo.TextAlign = "Center"
    $Script:VllmGpuCombo.BorderStyle = "None"
    $Script:VllmGpuCombo.Add_Leave({
        Set-VllmGpuMemoryUtilization $Script:VllmGpuCombo.Text
        $Script:VllmGpuCombo.Text = Get-VllmGpuMemoryUtilizationText
    })
    $Script:VllmGpuCombo.Add_KeyDown({
        if ($_.KeyCode -eq [System.Windows.Forms.Keys]::Enter) {
            Set-VllmGpuMemoryUtilization $Script:VllmGpuCombo.Text
            $Script:VllmGpuCombo.Text = Get-VllmGpuMemoryUtilizationText
            $_.SuppressKeyPress = $true
        }
    })
    $Script:VllmGpuShell.Controls.Add($Script:VllmGpuCombo)
    $Script:VllmGpuTooltip = New-Object System.Windows.Forms.ToolTip
    $Script:VllmGpuTooltip.AutoPopDelay = 8000
    $Script:VllmGpuTooltip.InitialDelay = 350
    $Script:VllmGpuTooltip.ReshowDelay = 100
    $Script:VllmGpuTooltip.SetToolTip($Script:VllmGpuCombo, "vLLM GPU 显存比例：控制 vLLM 预留 KV cache 的显存占比。0.15 是当前性能默认；显存紧张可填 0.11。")
    $Script:VllmGpuTooltip.SetToolTip($Script:VllmGpuShell, "vLLM GPU 显存比例：控制 vLLM 预留 KV cache 的显存占比。0.15 是当前性能默认；显存紧张可填 0.11。")

    $Script:StartButton = Add-SideButton "启动 LEON 服务" 0 { Toggle-LeonService } ([System.Drawing.Color]::FromArgb(25, 126, 89))
    $side.Controls.Remove($Script:StartButton)
    $bottomPanel.Controls.Add($Script:StartButton)
    $Script:StartButton.Font = New-Font 13 ([System.Drawing.FontStyle]::Bold)
    $Script:StartButton.Size = New-Object System.Drawing.Size(204, 68)
    $Script:StartButton.Anchor = [System.Windows.Forms.AnchorStyles]::Left -bor [System.Windows.Forms.AnchorStyles]::Bottom
    $Script:StartButton.Location = New-Object System.Drawing.Point(0, 44)
    $Script:StartButton.FlatAppearance.BorderColor = [System.Drawing.Color]::FromArgb(110, 210, 160)
    Sync-VllmGpuControls

    $Script:HomePanel = New-Object System.Windows.Forms.Panel
    $Script:HomePanel.Dock = "Fill"
    $Script:HomePanel.Padding = New-Object System.Windows.Forms.Padding(0)
    $Script:HomePanel.BackColor = [System.Drawing.Color]::FromArgb(5, 7, 11)
    $content.Controls.Add($Script:HomePanel)

    $homeImagePath = if (Test-Path -LiteralPath $Script:HomeImagePath) { $Script:HomeImagePath } else { $Script:HeroPath }
    $homePosterImage = $null
    $homePosterBox = New-Object System.Windows.Forms.Panel
    $homePosterBox.Dock = "Fill"
    $homePosterBox.BackColor = [System.Drawing.Color]::FromArgb(5, 7, 11)
    $Script:HomePanel.Controls.Add($homePosterBox)
    $homePosterImage = Add-CoverImageBackground -Control $homePosterBox -ImagePath $homeImagePath -Description "首页主视觉" -HorizontalAlign "Center" -VerticalAlign "Center" -ScaleMode "Cover"

    $Script:LogPanel = New-Object System.Windows.Forms.Panel
    $Script:LogPanel.Dock = "Fill"
    $Script:LogPanel.Padding = New-Object System.Windows.Forms.Padding(0)
    $Script:LogPanel.BackColor = [System.Drawing.Color]::FromArgb(12, 16, 21)
    $Script:LogPanel.Visible = $false
    $content.Controls.Add($Script:LogPanel)

    $logNav = New-Object System.Windows.Forms.FlowLayoutPanel
    $logNav.Dock = "None"
    $logNav.Location = New-Object System.Drawing.Point(0, 0)
    $logNav.Size = New-Object System.Drawing.Size(820, 42)
    $logNav.Anchor = [System.Windows.Forms.AnchorStyles]::Top -bor [System.Windows.Forms.AnchorStyles]::Left -bor [System.Windows.Forms.AnchorStyles]::Right
    $logNav.Padding = New-Object System.Windows.Forms.Padding(0, 0, 0, 8)
    $logNav.BackColor = [System.Drawing.Color]::FromArgb(12, 16, 21)
    $logNav.WrapContents = $false
    $Script:LogPanel.Controls.Add($logNav)

    function Add-LogButton {
        param([string]$Key, [string]$Text)
        $btn = New-Object System.Windows.Forms.Button
        $btn.Text = $Text
        $btn.Size = New-Object System.Drawing.Size(106, 32)
        $btn.Margin = New-Object System.Windows.Forms.Padding(0, 0, 8, 0)
        $btn.FlatStyle = "Flat"
        $btn.BackColor = [System.Drawing.Color]::FromArgb(24, 31, 39)
        $btn.ForeColor = [System.Drawing.Color]::FromArgb(205, 214, 224)
        $btn.FlatAppearance.BorderColor = [System.Drawing.Color]::FromArgb(46, 56, 68)
        $btn.FlatAppearance.BorderSize = 1
        $btn.Tag = $Key
        $btn.Add_Click({
            param($sender, $eventArgs)
            Set-LogTabActive ([string]$sender.Tag)
        })
        $btn.Add_MouseDown({
            param($sender, $eventArgs)
            Set-LogTabActive ([string]$sender.Tag)
        })
        $logNav.Controls.Add($btn)
        $Script:LogTabButtons[$Key] = $btn
    }

    Add-LogButton "launcher" "启动器"
    Add-LogButton "api" "服务日志"
    Add-LogButton "stdout" "服务启动"
    Add-LogButton "stderr" "诊断日志"

    $Script:LogBox = New-DarkLogBox
    $Script:LogBox.Dock = "None"
    $Script:LogBox.Location = New-Object System.Drawing.Point(0, 42)
    $Script:LogBox.Size = New-Object System.Drawing.Size(820, 520)
    $Script:LogBox.Anchor = [System.Windows.Forms.AnchorStyles]::Top -bor [System.Windows.Forms.AnchorStyles]::Bottom -bor [System.Windows.Forms.AnchorStyles]::Left -bor [System.Windows.Forms.AnchorStyles]::Right
    $Script:LogBox.BackColor = [System.Drawing.Color]::FromArgb(9, 13, 18)
    $Script:LogPanel.Controls.Add($Script:LogBox)
    $Script:LogBox.BringToFront()
    $logNav.BringToFront()
    $Script:LauncherLogBox = $Script:LogBox
    Set-LogTabActive "launcher"
    $Script:LogPanel.Add_Resize({
        if ($logNav) {
            $logNav.Size = New-Object System.Drawing.Size($Script:LogPanel.ClientSize.Width, 42)
        }
        if ($Script:LogBox) {
            $height = [Math]::Max(80, $Script:LogPanel.ClientSize.Height - 42)
            $Script:LogBox.Location = New-Object System.Drawing.Point(0, 42)
            $Script:LogBox.Size = New-Object System.Drawing.Size($Script:LogPanel.ClientSize.Width, $height)
        }
    })

    $Script:EnvPanel = New-Object System.Windows.Forms.Panel
    $Script:EnvPanel.Dock = "Fill"
    $Script:EnvPanel.Padding = New-Object System.Windows.Forms.Padding(0)
    $Script:EnvPanel.BackColor = [System.Drawing.Color]::FromArgb(12, 16, 21)
    $Script:EnvPanel.Visible = $false
    $content.Controls.Add($Script:EnvPanel)

    $envActions = New-Object System.Windows.Forms.Panel
    $envActions.Dock = "Top"
    $envActions.Height = 46
    $envActions.Padding = New-Object System.Windows.Forms.Padding(0, 0, 0, 10)
    $envActions.BackColor = [System.Drawing.Color]::FromArgb(12, 16, 21)
    $Script:EnvPanel.Controls.Add($envActions)

    $runCheckButton = New-Object System.Windows.Forms.Button
    $runCheckButton.Text = "开始检测"
    $runCheckButton.Location = New-Object System.Drawing.Point(0, 0)
    $runCheckButton.Size = New-Object System.Drawing.Size(116, 34)
    $runCheckButton.FlatStyle = "Flat"
    $runCheckButton.ForeColor = [System.Drawing.Color]::White
    $runCheckButton.BackColor = [System.Drawing.Color]::FromArgb(48, 68, 88)
    $runCheckButton.FlatAppearance.BorderColor = [System.Drawing.Color]::FromArgb(110, 145, 175)
    $runCheckButton.Add_Click({ Run-EnvironmentCheck })
    $envActions.Controls.Add($runCheckButton)

    $repairButton = New-Object System.Windows.Forms.Button
    $repairButton.Text = "一键修复"
    $repairButton.Location = New-Object System.Drawing.Point(128, 0)
    $repairButton.Size = New-Object System.Drawing.Size(116, 34)
    $repairButton.FlatStyle = "Flat"
    $repairButton.ForeColor = [System.Drawing.Color]::White
    $repairButton.BackColor = [System.Drawing.Color]::FromArgb(54, 58, 71)
    $repairButton.FlatAppearance.BorderColor = [System.Drawing.Color]::FromArgb(102, 110, 132)
    $repairButton.Add_Click({ Repair-Environment })
    $envActions.Controls.Add($repairButton)

    $Script:EnvVersionLabel = New-Object System.Windows.Forms.Label
    $Script:EnvVersionLabel.Text = "当前检测 / 修复：$(Get-LeonVersionLabel)"
    $Script:EnvVersionLabel.Location = New-Object System.Drawing.Point(262, 7)
    $Script:EnvVersionLabel.Size = New-Object System.Drawing.Size(520, 22)
    $Script:EnvVersionLabel.Anchor = [System.Windows.Forms.AnchorStyles]::Top -bor [System.Windows.Forms.AnchorStyles]::Left -bor [System.Windows.Forms.AnchorStyles]::Right
    $Script:EnvVersionLabel.ForeColor = [System.Drawing.Color]::FromArgb(206, 216, 226)
    $Script:EnvVersionLabel.BackColor = [System.Drawing.Color]::Transparent
    $Script:EnvVersionLabel.Font = New-Font 9 ([System.Drawing.FontStyle]::Bold)
    $envActions.Controls.Add($Script:EnvVersionLabel)

    $Script:ProgressBar = New-Object System.Windows.Forms.ProgressBar
    $Script:ProgressBar.Dock = "Top"
    $Script:ProgressBar.Height = 8
    $Script:EnvPanel.Controls.Add($Script:ProgressBar)
    $Script:ProgressBar.BringToFront()

    $Script:CheckList = New-Object System.Windows.Forms.DataGridView
    $Script:CheckList.Dock = "Fill"
    $Script:CheckList.AllowUserToAddRows = $false
    $Script:CheckList.AllowUserToDeleteRows = $false
    $Script:CheckList.AllowUserToResizeRows = $false
    $Script:CheckList.ReadOnly = $true
    $Script:CheckList.MultiSelect = $false
    $Script:CheckList.RowHeadersVisible = $false
    $Script:CheckList.BorderStyle = "None"
    $Script:CheckList.BackgroundColor = [System.Drawing.Color]::FromArgb(16, 21, 27)
    $Script:CheckList.GridColor = [System.Drawing.Color]::FromArgb(29, 37, 46)
    $Script:CheckList.EnableHeadersVisualStyles = $false
    $Script:CheckList.ColumnHeadersBorderStyle = [System.Windows.Forms.DataGridViewHeaderBorderStyle]::Single
    $Script:CheckList.ColumnHeadersDefaultCellStyle.BackColor = [System.Drawing.Color]::FromArgb(27, 35, 44)
    $Script:CheckList.ColumnHeadersDefaultCellStyle.ForeColor = [System.Drawing.Color]::FromArgb(226, 232, 238)
    $Script:CheckList.ColumnHeadersDefaultCellStyle.SelectionBackColor = [System.Drawing.Color]::FromArgb(27, 35, 44)
    $Script:CheckList.DefaultCellStyle.BackColor = [System.Drawing.Color]::FromArgb(16, 21, 27)
    $Script:CheckList.DefaultCellStyle.ForeColor = [System.Drawing.Color]::WhiteSmoke
    $Script:CheckList.DefaultCellStyle.SelectionBackColor = [System.Drawing.Color]::FromArgb(30, 48, 62)
    $Script:CheckList.DefaultCellStyle.SelectionForeColor = [System.Drawing.Color]::White
    $Script:CheckList.AlternatingRowsDefaultCellStyle.BackColor = [System.Drawing.Color]::FromArgb(18, 24, 31)
    $Script:CheckList.RowTemplate.Height = 26
    $Script:CheckList.AutoSizeColumnsMode = [System.Windows.Forms.DataGridViewAutoSizeColumnsMode]::Fill
    [void]$Script:CheckList.Columns.Add("name", "检查项")
    [void]$Script:CheckList.Columns.Add("status", "状态")
    [void]$Script:CheckList.Columns.Add("detail", "详情")
    $Script:CheckList.Columns["name"].FillWeight = 28
    $Script:CheckList.Columns["status"].FillWeight = 12
    $Script:CheckList.Columns["detail"].FillWeight = 60
    $Script:EnvPanel.Controls.Add($Script:CheckList)
    $Script:CheckList.BringToFront()
    Initialize-EnvironmentCheckRows

    $form.Add_Shown({
        Set-StatusText "就绪，正在检查服务状态..." "Khaki"
        Sync-VllmGpuControls
        Show-LauncherHome
        Set-LogTabActive "launcher"
        Start-InitialLauncherRefreshAsync -Form $form
    })
    $form.Add_Resize({
        if ($Script:StatusLabel) {
            $Script:StatusLabel.Location = New-Object System.Drawing.Point([Math]::Max(520, $form.ClientSize.Width - 500), 42)
            $Script:StatusLabel.Size = New-Object System.Drawing.Size(460, 24)
        }
    })
    $form.Add_ResizeBegin({
        $Script:LauncherResizeActive = $true
    })
    $form.Add_ResizeEnd({
        $Script:LauncherResizeActive = $false
        foreach ($panel in @($header, $sidePosterBox, $homePosterBox)) {
            if ($panel -and -not $panel.IsDisposed) {
                $panel.Invalidate()
            }
        }
    })
    $form.Add_FormClosing({
        Stop-LeonServiceForLauncherExit
    })
    $form.Add_FormClosed({
        if ($heroImage) {
            $heroImage.Dispose()
        }
        if ($sideImage) {
            $sideImage.Dispose()
        }
        if ($sidePosterImage) {
            $sidePosterImage.Dispose()
        }
        if ($homePosterImage) {
            $homePosterImage.Dispose()
        }
        if ($Script:LauncherIcon) {
            $Script:LauncherIcon.Dispose()
            $Script:LauncherIcon = $null
        }
    })
    return $form
}

Initialize-LauncherSingleInstance
$form = Build-LauncherForm
if ($env:LEON_LAUNCHER_SMOKE_TEST -eq "1") {
    $form.Dispose()
    Write-Output "LEON launcher smoke OK"
    exit 0
}
Add-Log "LEON 启动器已打开。"
try {
    [void][System.Windows.Forms.Application]::Run($form)
}
finally {
    Release-LauncherSingleInstance
}
