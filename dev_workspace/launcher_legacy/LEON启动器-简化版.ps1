$ErrorActionPreference = "Continue"

Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing

[System.Windows.Forms.Application]::EnableVisualStyles()

$Script:LauncherMutex = $null
$Script:LauncherMutexOwned = $false
$Script:IsTestRender = ($env:LEON_LAUNCHER_SMOKE_TEST -eq "1" -or -not [string]::IsNullOrWhiteSpace($env:LEON_LAUNCHER_SCREENSHOT))
if (-not $Script:IsTestRender) {
    $launcherMutexCreated = $false
    $Script:LauncherMutex = New-Object System.Threading.Mutex($true, "Local\LEON.IndexTTS2.Launcher", [ref]$launcherMutexCreated)
    $Script:LauncherMutexOwned = $launcherMutexCreated
    if (-not $launcherMutexCreated) {
        [System.Windows.Forms.MessageBox]::Show("LEON 启动器已经打开。请使用现有窗口，避免重复启动服务。", "LEON 启动器", "OK", "Information") | Out-Null
        $Script:LauncherMutex.Dispose()
        exit 0
    }
}

$Script:LauncherScriptPath = if ($env:LEON_LAUNCHER_SCRIPT) { $env:LEON_LAUNCHER_SCRIPT } else { $MyInvocation.MyCommand.Path }
$Script:LauncherDir = if ($Script:LauncherScriptPath) { Split-Path -Parent $Script:LauncherScriptPath } else { (Get-Location).Path }
$Script:RepoRoot = (Resolve-Path (Join-Path $Script:LauncherDir "..\..")).Path
$Script:ApiPort = 9880
$Script:ApiBase = "http://127.0.0.1:$Script:ApiPort"
$Script:WebUiPort = 7860
$Script:WebUiBase = "http://127.0.0.1:$Script:WebUiPort"
$Script:LanHost = "<LAN-IP>"
$Script:StartupBat = Join-Path $Script:RepoRoot "go-API-VLLM-NoQwen.bat"
$Script:WebUiStartupBat = Join-Path $Script:RepoRoot "go-webui-VLLM-NoQwen.bat"
$Script:RuntimePython = Join-Path $Script:RepoRoot "indextts2runtime\python.exe"
$Script:RuntimeScripts = Join-Path $Script:RepoRoot "indextts2runtime\Scripts"
$Script:LogDir = Join-Path $Script:LauncherDir "logs"
$Script:BannerPath = Join-Path $Script:LauncherDir "leon-banner-modern.png"
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
$Script:ApiStartInProgress = $false
$Script:ApiStartedByLauncher = $false
$Script:ApiLauncherProcess = $null
$Script:BackendLogLastText = $null
$Script:PreviewBannerImage = $null

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

function Set-DoubleBuffered {
    param([System.Windows.Forms.Control]$Control)
    if (-not $Control) { return }
    try {
        $prop = $Control.GetType().GetProperty("DoubleBuffered", [System.Reflection.BindingFlags]"Instance, NonPublic")
        if ($prop) {
            $prop.SetValue($Control, $true, $null)
        }
    }
    catch {}
}

function Set-FlatButtonStyle {
    param(
        [System.Windows.Forms.Button]$Button,
        [string]$Variant = "Secondary"
    )
    if (-not $Button) { return }
    $Button.FlatStyle = [System.Windows.Forms.FlatStyle]::Flat
    $Button.UseVisualStyleBackColor = $false
    $Button.Font = New-Font 9
    $Button.ForeColor = [System.Drawing.Color]::FromArgb(236, 241, 246)
    $Button.Cursor = [System.Windows.Forms.Cursors]::Hand
    $Button.FlatAppearance.BorderSize = 1
    $Button.FlatAppearance.MouseOverBackColor = [System.Drawing.Color]::FromArgb(47, 58, 70)
    $Button.FlatAppearance.MouseDownBackColor = [System.Drawing.Color]::FromArgb(31, 40, 50)
    switch ($Variant) {
        "Primary" {
            $Button.BackColor = [System.Drawing.Color]::FromArgb(16, 185, 129)
            $Button.FlatAppearance.BorderColor = [System.Drawing.Color]::FromArgb(20, 205, 145)
            $Button.FlatAppearance.MouseOverBackColor = [System.Drawing.Color]::FromArgb(20, 205, 145)
            $Button.FlatAppearance.MouseDownBackColor = [System.Drawing.Color]::FromArgb(13, 148, 103)
        }
        "Danger" {
            $Button.BackColor = [System.Drawing.Color]::FromArgb(239, 68, 68)
            $Button.FlatAppearance.BorderColor = [System.Drawing.Color]::FromArgb(248, 113, 113)
            $Button.FlatAppearance.MouseOverBackColor = [System.Drawing.Color]::FromArgb(248, 113, 113)
            $Button.FlatAppearance.MouseDownBackColor = [System.Drawing.Color]::FromArgb(220, 38, 38)
        }
        default {
            $Button.BackColor = [System.Drawing.Color]::FromArgb(51, 65, 85)
            $Button.FlatAppearance.BorderColor = [System.Drawing.Color]::FromArgb(71, 85, 105)
        }
    }
}

function Set-TextBoxStyle {
    param([System.Windows.Forms.TextBoxBase]$TextBox)
    if (-not $TextBox) { return }
    $TextBox.BackColor = [System.Drawing.Color]::FromArgb(10, 14, 19)
    $TextBox.ForeColor = [System.Drawing.Color]::FromArgb(226, 232, 238)
    $TextBox.BorderStyle = [System.Windows.Forms.BorderStyle]::FixedSingle
    $TextBox.Font = New-Font 10
}

function Set-ComboBoxStyle {
    param([System.Windows.Forms.ComboBox]$ComboBox)
    if (-not $ComboBox) { return }
    $ComboBox.FlatStyle = [System.Windows.Forms.FlatStyle]::Flat
    $ComboBox.BackColor = [System.Drawing.Color]::FromArgb(10, 14, 19)
    $ComboBox.ForeColor = [System.Drawing.Color]::FromArgb(226, 232, 238)
    $ComboBox.Font = New-Font 9
}

function Save-BitmapPng {
    param(
        [System.Drawing.Bitmap]$Bitmap,
        [string]$Path
    )
    $outDir = Split-Path -Parent $Path
    if (-not [string]::IsNullOrWhiteSpace($outDir)) {
        New-Item -ItemType Directory -Force -Path $outDir | Out-Null
    }
    $stream = [System.IO.File]::Open($Path, [System.IO.FileMode]::Create, [System.IO.FileAccess]::Write, [System.IO.FileShare]::None)
    try {
        $Bitmap.Save($stream, [System.Drawing.Imaging.ImageFormat]::Png)
    }
    finally {
        $stream.Dispose()
    }
}

function Draw-LauncherHeaderBackdrop {
    param(
        [System.Drawing.Graphics]$Graphics,
        [System.Drawing.Rectangle]$Rect,
        [System.Drawing.Image]$BannerImage = $null
    )
    $Graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
    $Graphics.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
    $baseBrush = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(10, 14, 19))
    try {
        $Graphics.FillRectangle($baseBrush, $Rect)
    }
    finally {
        $baseBrush.Dispose()
    }

    if ($BannerImage) {
        $bannerStart = [Math]::Max(420, [int]($Rect.Width * 0.42))
        $bannerRect = [System.Drawing.Rectangle]::new($Rect.X + $bannerStart, $Rect.Y, [Math]::Max(0, $Rect.Width - $bannerStart), $Rect.Height)
        if ($bannerRect.Width -gt 0 -and $bannerRect.Height -gt 0) {
            $scale = [Math]::Max($bannerRect.Width / [double]$BannerImage.Width, $bannerRect.Height / [double]$BannerImage.Height)
            $drawW = [int][Math]::Ceiling($BannerImage.Width * $scale)
            $drawH = [int][Math]::Ceiling($BannerImage.Height * $scale)
            $drawX = [int]($bannerRect.X + (($bannerRect.Width - $drawW) / 2))
            $drawY = [int]($bannerRect.Y + (($bannerRect.Height - $drawH) / 2))
            $Graphics.DrawImage($BannerImage, [System.Drawing.Rectangle]::new($drawX, $drawY, $drawW, $drawH))
        }
    }
    else {
        $cyanPen = New-Object System.Drawing.Pen([System.Drawing.Color]::FromArgb(92, 64, 182, 214), 1.4)
        $goldPen = New-Object System.Drawing.Pen([System.Drawing.Color]::FromArgb(74, 210, 160, 92), 1.1)
        $gridPen = New-Object System.Drawing.Pen([System.Drawing.Color]::FromArgb(28, 96, 124, 146), 1)
        try {
            $startX = $Rect.X + [int]($Rect.Width * 0.45)
            for ($x = $startX; $x -lt $Rect.Right; $x += 56) {
                $Graphics.DrawLine($gridPen, [single]$x, [single]($Rect.Y + 16), [single]$x, [single]($Rect.Bottom - 12))
            }
            for ($i = 0; $i -lt 8; $i++) {
                $baseY = $Rect.Y + 30 + ($i * 8)
                $amp = 5 + (($i % 3) * 3)
                $pen = if (($i % 2) -eq 0) { $cyanPen } else { $goldPen }
                for ($x = $startX; $x -lt ($Rect.Right - 14); $x += 14) {
                    $y1 = $baseY + ([Math]::Sin(($x - $startX) / 42.0 + $i) * $amp)
                    $y2 = $baseY + ([Math]::Sin(($x + 14 - $startX) / 42.0 + $i) * $amp)
                    $Graphics.DrawLine($pen, [single]$x, [single]$y1, [single]($x + 14), [single]$y2)
                }
            }
        }
        finally {
            $cyanPen.Dispose()
            $goldPen.Dispose()
            $gridPen.Dispose()
        }
    }

    $overlay = New-Object System.Drawing.Drawing2D.LinearGradientBrush(
        $Rect,
        [System.Drawing.Color]::FromArgb(248, 8, 12, 17),
        [System.Drawing.Color]::FromArgb(145, 8, 12, 17),
        [System.Drawing.Drawing2D.LinearGradientMode]::Horizontal
    )
    $bottomPen = New-Object System.Drawing.Pen([System.Drawing.Color]::FromArgb(42, 52, 62), 1)
    try {
        $Graphics.FillRectangle($overlay, $Rect)
        $Graphics.DrawLine($bottomPen, $Rect.Left, $Rect.Bottom - 1, $Rect.Right, $Rect.Bottom - 1)
    }
    finally {
        $overlay.Dispose()
        $bottomPen.Dispose()
    }
}

function Initialize-ControlTree {
    param([System.Windows.Forms.Control]$Control)
    if (-not $Control) { return }
    if (($Control -is [System.Windows.Forms.TabPage]) -and $Control.Parent -and ($Control.Parent.SelectedTab -ne $Control)) {
        return
    }
    try {
        $Control.CreateControl()
        $Control.PerformLayout()
    }
    catch {}
    foreach ($child in $Control.Controls) {
        Initialize-ControlTree $child
    }
}

function Invoke-PreviewDockLayout {
    param([System.Windows.Forms.Control]$Control)
    if (-not $Control) { return }
    if (($Control -is [System.Windows.Forms.TabPage]) -and $Control.Parent -and ($Control.Parent.SelectedTab -ne $Control)) {
        return
    }
    if ($Control -is [System.Windows.Forms.SplitContainer]) {
        $client = $Control.ClientSize
        $split = [Math]::Max(120, [Math]::Min($Control.SplitterDistance, $client.Width - 120))
        $Control.Panel1.Location = [System.Drawing.Point]::new(0, 0)
        $Control.Panel1.Size = [System.Drawing.Size]::new($split, $client.Height)
        $Control.Panel2.Location = [System.Drawing.Point]::new($split + 4, 0)
        $Control.Panel2.Size = [System.Drawing.Size]::new([Math]::Max(0, $client.Width - $split - 4), $client.Height)
    }
    elseif ($Control -is [System.Windows.Forms.TabControl]) {
        $tabHeaderHeight = if ($Control.ItemSize.Height -le 2) { 0 } else { 34 }
        foreach ($page in $Control.TabPages) {
            $page.Location = [System.Drawing.Point]::new(0, $tabHeaderHeight)
            $page.Size = [System.Drawing.Size]::new($Control.ClientSize.Width, [Math]::Max(0, $Control.ClientSize.Height - $tabHeaderHeight))
        }
    }

    $fillControls = @()
    $topY = 0
    foreach ($child in $Control.Controls) {
        if ($child.Dock -eq [System.Windows.Forms.DockStyle]::Top) {
            $child.Location = [System.Drawing.Point]::new(0, $topY)
            $child.Size = [System.Drawing.Size]::new($Control.ClientSize.Width, $child.Height)
            $topY += $child.Height
        }
        elseif ($child.Dock -eq [System.Windows.Forms.DockStyle]::Fill) {
            $fillControls += $child
        }
    }
    foreach ($child in $fillControls) {
        $child.Location = [System.Drawing.Point]::new(0, $topY)
        $child.Size = [System.Drawing.Size]::new($Control.ClientSize.Width, [Math]::Max(0, $Control.ClientSize.Height - $topY))
    }
    foreach ($child in $Control.Controls) {
        Invoke-PreviewDockLayout $child
    }
}

function Draw-ControlTree {
    param(
        [System.Windows.Forms.Control]$Control,
        [System.Drawing.Graphics]$Graphics,
        [int]$OffsetX = 0,
        [int]$OffsetY = 0
    )
    if (-not $Control -or $Control.IsDisposed -or $Control.Width -le 0 -or $Control.Height -le 0) { return }
    if (($Control -is [System.Windows.Forms.TabPage]) -and $Control.Parent -and ($Control.Parent.SelectedTab -ne $Control)) {
        return
    }
    if ($Control -is [System.Windows.Forms.WebBrowser]) {
        return
    }

    $targetX = $OffsetX + $Control.Left
    $targetY = $OffsetY + $Control.Top
    $rect = [System.Drawing.Rectangle]::new([int]$targetX, [int]$targetY, [int]$Control.Width, [int]$Control.Height)
    $rectF = [System.Drawing.RectangleF]::new([single]$rect.X, [single]$rect.Y, [single]$rect.Width, [single]$rect.Height)
    $backColor = if ($Control.BackColor -and $Control.BackColor -ne [System.Drawing.Color]::Transparent) { $Control.BackColor } else { [System.Drawing.Color]::FromArgb(15, 18, 22) }
    if (
        $backColor.ToArgb() -eq [System.Drawing.SystemColors]::Control.ToArgb() -or
        $backColor.ToArgb() -eq [System.Drawing.SystemColors]::Window.ToArgb() -or
        $Control -is [System.Windows.Forms.SplitterPanel] -or
        $Control -is [System.Windows.Forms.TabPage]
    ) {
        $backColor = [System.Drawing.Color]::FromArgb(15, 18, 22)
    }
    $backBrush = New-Object System.Drawing.SolidBrush($backColor)
    $borderPen = New-Object System.Drawing.Pen([System.Drawing.Color]::FromArgb(48, 58, 70), 1)
    $textBrush = New-Object System.Drawing.SolidBrush($(if ($Control.ForeColor) { $Control.ForeColor } else { [System.Drawing.Color]::WhiteSmoke }))
    try {
        if ($Control.Name -eq "LauncherHeader") {
            Draw-LauncherHeaderBackdrop -Graphics $Graphics -Rect $rect -BannerImage $Script:PreviewBannerImage
        }
        elseif ($Control -is [System.Windows.Forms.Button]) {
            $Graphics.FillRectangle($backBrush, $rect)
            $Graphics.DrawRectangle($borderPen, $rect.X, $rect.Y, [Math]::Max(0, $rect.Width - 1), [Math]::Max(0, $rect.Height - 1))
            $sf = New-Object System.Drawing.StringFormat
            try {
                $sf.Alignment = [System.Drawing.StringAlignment]::Center
                $sf.LineAlignment = [System.Drawing.StringAlignment]::Center
                $Graphics.DrawString($Control.Text, $Control.Font, $textBrush, $rectF, $sf)
            }
            finally { $sf.Dispose() }
        }
        elseif ($Control -is [System.Windows.Forms.Label]) {
            if ($Control.BackColor -and $Control.BackColor -ne [System.Drawing.Color]::Transparent) {
                $Graphics.FillRectangle($backBrush, $rect)
            }
            $sf = New-Object System.Drawing.StringFormat
            try {
                $sf.Alignment = switch ($Control.TextAlign) {
                    ([System.Drawing.ContentAlignment]::MiddleCenter) { [System.Drawing.StringAlignment]::Center; break }
                    ([System.Drawing.ContentAlignment]::TopCenter) { [System.Drawing.StringAlignment]::Center; break }
                    ([System.Drawing.ContentAlignment]::BottomCenter) { [System.Drawing.StringAlignment]::Center; break }
                    default { [System.Drawing.StringAlignment]::Near }
                }
                $sf.LineAlignment = switch ($Control.TextAlign) {
                    ([System.Drawing.ContentAlignment]::MiddleCenter) { [System.Drawing.StringAlignment]::Center; break }
                    ([System.Drawing.ContentAlignment]::MiddleLeft) { [System.Drawing.StringAlignment]::Center; break }
                    ([System.Drawing.ContentAlignment]::MiddleRight) { [System.Drawing.StringAlignment]::Center; break }
                    default { [System.Drawing.StringAlignment]::Near }
                }
                $sf.Trimming = [System.Drawing.StringTrimming]::EllipsisCharacter
                $Graphics.DrawString($Control.Text, $Control.Font, $textBrush, $rectF, $sf)
            }
            finally { $sf.Dispose() }
        }
        elseif ($Control -is [System.Windows.Forms.RichTextBox] -or $Control -is [System.Windows.Forms.TextBox]) {
            $Graphics.FillRectangle($backBrush, $rect)
            $Graphics.DrawRectangle($borderPen, $rect.X, $rect.Y, [Math]::Max(0, $rect.Width - 1), [Math]::Max(0, $rect.Height - 1))
            $sf = New-Object System.Drawing.StringFormat
            try {
                $sf.Trimming = [System.Drawing.StringTrimming]::EllipsisCharacter
                $sf.FormatFlags = [System.Drawing.StringFormatFlags]::NoWrap
                $textRect = [System.Drawing.RectangleF]::new([single]($rect.X + 10), [single]($rect.Y + 8), [single][Math]::Max(0, $rect.Width - 20), [single][Math]::Max(0, $rect.Height - 16))
                $lines = @(([string]$Control.Text) -split "`r?`n" | Select-Object -First 26)
                $Graphics.DrawString(($lines -join [Environment]::NewLine), $Control.Font, $textBrush, $textRect, $sf)
            }
            finally { $sf.Dispose() }
        }
        elseif ($Control -is [System.Windows.Forms.ComboBox]) {
            $Graphics.FillRectangle($backBrush, $rect)
            $Graphics.DrawRectangle($borderPen, $rect.X, $rect.Y, [Math]::Max(0, $rect.Width - 1), [Math]::Max(0, $rect.Height - 1))
            $textRect = [System.Drawing.RectangleF]::new([single]($rect.X + 8), [single]($rect.Y + 5), [single][Math]::Max(0, $rect.Width - 28), [single][Math]::Max(0, $rect.Height - 10))
            $Graphics.DrawString($Control.Text, $Control.Font, $textBrush, $textRect)
            $Graphics.DrawString("v", $Control.Font, $textBrush, [single]($rect.Right - 20), [single]($rect.Y + 5))
        }
        elseif ($Control -is [System.Windows.Forms.ListView]) {
            $Graphics.FillRectangle($backBrush, $rect)
            $Graphics.DrawRectangle($borderPen, $rect.X, $rect.Y, [Math]::Max(0, $rect.Width - 1), [Math]::Max(0, $rect.Height - 1))
            $headerBrush = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(21, 27, 34))
            try {
                $headerRect = [System.Drawing.Rectangle]::new([int]$rect.X, [int]$rect.Y, [int]$rect.Width, 30)
                $Graphics.FillRectangle($headerBrush, $headerRect)
                $x = $rect.X + 10
                foreach ($col in $Control.Columns) {
                    $Graphics.DrawString($col.Text, $Control.Font, $textBrush, [single]$x, [single]($rect.Y + 7))
                    $x += [Math]::Max(60, $col.Width)
                }
            }
            finally { $headerBrush.Dispose() }
        }
        elseif ($Control -is [System.Windows.Forms.TabControl]) {
            $Graphics.FillRectangle($backBrush, $rect)
            if ($Control.ItemSize.Height -gt 2) {
                $tabX = $rect.X + 4
                for ($i = 0; $i -lt $Control.TabPages.Count; $i++) {
                    $isSelected = ($i -eq $Control.SelectedIndex)
                    $tabRect = [System.Drawing.Rectangle]::new([int]$tabX, [int]($rect.Y + 3), 92, 30)
                    $tabBrush = New-Object System.Drawing.SolidBrush($(if ($isSelected) { [System.Drawing.Color]::FromArgb(25, 30, 37) } else { [System.Drawing.Color]::FromArgb(15, 18, 22) }))
                    $tabTextBrush = New-Object System.Drawing.SolidBrush($(if ($isSelected) { [System.Drawing.Color]::White } else { [System.Drawing.Color]::FromArgb(178, 188, 198) }))
                    try {
                        $Graphics.FillRectangle($tabBrush, $tabRect)
                        $Graphics.DrawRectangle($borderPen, $tabRect.X, $tabRect.Y, $tabRect.Width - 1, $tabRect.Height - 1)
                        $sf = New-Object System.Drawing.StringFormat
                        try {
                            $sf.Alignment = [System.Drawing.StringAlignment]::Center
                            $sf.LineAlignment = [System.Drawing.StringAlignment]::Center
                            $tabRectF = [System.Drawing.RectangleF]::new([single]$tabRect.X, [single]$tabRect.Y, [single]$tabRect.Width, [single]$tabRect.Height)
                            $Graphics.DrawString($Control.TabPages[$i].Text, $Control.Font, $tabTextBrush, $tabRectF, $sf)
                        }
                        finally { $sf.Dispose() }
                    }
                    finally {
                        $tabBrush.Dispose()
                        $tabTextBrush.Dispose()
                    }
                    $tabX += 92
                }
            }
        }
        else {
            $Graphics.FillRectangle($backBrush, $rect)
        }
    }
    finally {
        $backBrush.Dispose()
        $borderPen.Dispose()
        $textBrush.Dispose()
    }

    foreach ($child in $Control.Controls) {
        Draw-ControlTree -Control $child -Graphics $Graphics -OffsetX $targetX -OffsetY $targetY
    }
}

function Add-Log {
    param([string]$Message, [string]$Level = "INFO")
    $line = "[{0}] [{1}] {2}" -f (Get-Date -Format "HH:mm:ss"), $Level, $Message
    if ($Script:LogBox) {
        $Script:LogBox.AppendText($line + [Environment]::NewLine)
        $Script:LogBox.SelectionStart = $Script:LogBox.TextLength
        $Script:LogBox.ScrollToCaret()
        $Script:BackendLogLastText = $Script:LogBox.Text
    }
    if (-not $Script:IsTestRender) {
        New-Item -ItemType Directory -Force -Path $Script:LogDir | Out-Null
        $logFile = Join-Path $Script:LogDir ("launcher-" + (Get-Date -Format "yyyyMMdd") + ".log")
        Add-Content -LiteralPath $logFile -Value $line -Encoding UTF8
    }
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
        $Script:StartButton.Text = "重启 LEON 服务"
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

function Get-ProcessInfo {
    param([int]$ProcessId)
    try {
        return Get-CimInstance Win32_Process -Filter "ProcessId = $ProcessId" -ErrorAction SilentlyContinue
    }
    catch {
        return $null
    }
}

function Test-IsProjectProcess {
    param($ProcessInfo)
    if ($null -eq $ProcessInfo) { return $false }
    $needle = [regex]::Escape($Script:RepoRoot)
    $text = (($ProcessInfo.CommandLine, $ProcessInfo.ExecutablePath) -join " ")
    return ($text -match $needle)
}

function Test-LeonApiFingerprint {
    try {
        $health = Invoke-RestMethod -Uri "$Script:ApiBase/health" -TimeoutSec 2
        if (-not $health -or ([string]$health.status) -ne "ok") { return $false }
    }
    catch {
        return $false
    }

    try {
        $voices = Invoke-RestMethod -Uri "$Script:ApiBase/voices" -TimeoutSec 4
        if ($null -ne $voices.voices) { return $true }
    }
    catch {}

    try {
        $static = Invoke-WebRequest -Uri "$Script:ApiBase/static/tavo.js" -UseBasicParsing -Method Head -TimeoutSec 3
        if ($static.StatusCode -ge 200 -and $static.StatusCode -lt 400) { return $true }
    }
    catch {}

    return $false
}

function Get-ForeignListeningPidsForApiPort {
    $apiFingerprintOk = Test-LeonApiFingerprint
    $foreignPids = @()
    foreach ($portPid in @(Get-ListeningPidsForPort -Port $Script:ApiPort)) {
        $info = Get-ProcessInfo -ProcessId $portPid
        if (-not (Test-IsProjectProcess $info) -and -not $apiFingerprintOk) {
            $foreignPids += [int]$portPid
        }
    }
    return $foreignPids | Sort-Object -Unique
}

function Wait-ApiPortReleased {
    param([int]$TimeoutSeconds = 20)
    $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
    do {
        $pids = @(Get-ListeningPidsForPort -Port $Script:ApiPort)
        if ($pids.Count -eq 0) { return $true }
        Start-Sleep -Milliseconds 400
        [System.Windows.Forms.Application]::DoEvents()
    } while ((Get-Date) -lt $deadline)
    return $false
}

function Get-ChildProcessIds {
    param([int]$ParentProcessId)
    $children = @()
    try {
        $children = @(Get-CimInstance Win32_Process -Filter "ParentProcessId = $ParentProcessId" -ErrorAction SilentlyContinue)
    }
    catch {}
    foreach ($child in $children) {
        Get-ChildProcessIds -ParentProcessId ([int]$child.ProcessId)
        [int]$child.ProcessId
    }
}

function Stop-ProcessTree {
    param([int]$ProcessId)
    try {
        $taskkillOutput = & taskkill.exe /PID $ProcessId /T /F 2>&1
        if ($LASTEXITCODE -eq 0) { return }
        Add-Log "taskkill /T 停止 PID $ProcessId 未完全成功: $($taskkillOutput -join ' ')" "WARN"
    }
    catch {
        Add-Log "taskkill /T 不可用，退回 PowerShell 停止 PID $ProcessId：$($_.Exception.Message)" "WARN"
    }

    $childIds = @(Get-ChildProcessIds -ParentProcessId $ProcessId)
    foreach ($childId in ($childIds | Sort-Object -Descending -Unique)) {
        try { Stop-Process -Id $childId -Force -ErrorAction SilentlyContinue } catch {}
    }
    try { Stop-Process -Id $ProcessId -Force -ErrorAction SilentlyContinue } catch {}
}

function Get-ProjectApiProcessIds {
    $targets = @{}
    $apiFingerprintOk = Test-LeonApiFingerprint

    foreach ($listenPid in @(Get-ListeningPidsForPort -Port $Script:ApiPort)) {
        $info = Get-ProcessInfo -ProcessId $listenPid
        if ((Test-IsProjectProcess $info) -or $apiFingerprintOk) {
            $targets[[int]$listenPid] = "API port $Script:ApiPort"
        }
        else {
            Add-Log "端口 $Script:ApiPort 被非本项目 PID $listenPid 占用，未纳入停止列表。" "WARN"
        }
    }

    $startupBatPattern = [regex]::Escape($Script:StartupBat)
    $restartScriptPattern = [regex]::Escape((Join-Path $Script:RepoRoot "tools\restart_indextts_api.ps1"))
    $runtimePythonPattern = [regex]::Escape($Script:RuntimePython)
    try {
        Get-CimInstance Win32_Process -ErrorAction SilentlyContinue |
            Where-Object {
                $cmd = [string]$_.CommandLine
                $exe = [string]$_.ExecutablePath
                (
                    ($cmd -match $startupBatPattern) -or
                    ($cmd -match $restartScriptPattern) -or
                    (($exe -match $runtimePythonPattern) -and ($cmd -match "indextts2_api\.py"))
                )
            } |
            ForEach-Object {
                $targets[[int]$_.ProcessId] = $_.Name
            }
    }
    catch {}

    return $targets.Keys | Sort-Object -Descending -Unique
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
    if ($Script:ApiStartInProgress) {
        Add-Log "API 启动流程已经在进行中，忽略重复点击。" "WARN"
        Set-StatusText "API 启动中，请等待当前启动流程完成..." "Khaki"
        return
    }
    if ($Script:ApiLauncherProcess) {
        try { $Script:ApiLauncherProcess.Refresh() } catch {}
        if (-not $Script:ApiLauncherProcess.HasExited) {
            Add-Log "底层启动脚本仍在运行，忽略重复启动请求。PID $($Script:ApiLauncherProcess.Id)" "WARN"
            Set-StatusText "底层启动脚本仍在运行，请等待..." "Khaki"
            return
        }
    }
    $foreignPids = @(Get-ForeignListeningPidsForApiPort)
    if ($foreignPids.Count -gt 0) {
        Add-Log "端口 $Script:ApiPort 已被非本项目进程占用，拒绝启动以避免双开/误杀。PID: $($foreignPids -join ', ')" "ERROR"
        Set-StatusText "端口 $Script:ApiPort 被其它进程占用，未启动。" "LightCoral"
        return
    }
    $oldProjectPids = @(Get-ProjectApiProcessIds)
    if ($oldProjectPids.Count -gt 0) {
        Add-Log "重新启动前先停止旧的本项目 API 进程树，PID: $($oldProjectPids -join ', ')"
        Set-StatusText "正在停止旧 API，避免双开..." "Khaki"
        foreach ($apiPid in $oldProjectPids) {
            try {
                Stop-ProcessTree -ProcessId $apiPid
                Add-Log "已停止旧项目 API 进程树 PID $apiPid"
            }
            catch {
                Add-Log "停止旧 PID $apiPid 失败: $($_.Exception.Message)" "WARN"
            }
        }
        if (-not (Wait-ApiPortReleased -TimeoutSeconds 25)) {
            $remaining = @(Get-ListeningPidsForPort -Port $Script:ApiPort)
            Add-Log "旧 API 停止后端口 $Script:ApiPort 仍未释放，拒绝继续启动。PID: $($remaining -join ', ')" "ERROR"
            Set-StatusText "旧 API 未释放端口，未启动新服务。" "LightCoral"
            return
        }
    }
    Add-Log "调用启动入口: $Script:StartupBat"
    try {
        $Script:ApiStartInProgress = $true
        $Script:ApiStartedByLauncher = $true
        $oldNoPause = $env:LEON_LAUNCHER_NO_PAUSE
        $env:LEON_LAUNCHER_NO_PAUSE = "1"
        try {
            $Script:ApiLauncherProcess = Start-Process -FilePath "cmd.exe" -ArgumentList @("/c", "`"$Script:StartupBat`"") -WorkingDirectory $Script:RepoRoot -WindowStyle Hidden -PassThru
        }
        finally {
            if ($null -eq $oldNoPause) {
                Remove-Item Env:\LEON_LAUNCHER_NO_PAUSE -ErrorAction SilentlyContinue
            }
            else {
                $env:LEON_LAUNCHER_NO_PAUSE = $oldNoPause
            }
        }
        Set-StatusText "服务启动中，首次加载模型可能需要几分钟..." "Khaki"
        Start-Sleep -Milliseconds 600
        Refresh-StartupLogPaths
        Wait-ApiReadyAsync
    }
    catch {
        $Script:ApiStartInProgress = $false
        $Script:ApiStartedByLauncher = $false
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
            $Script:ApiStartInProgress = $false
            $Script:ApiStartedByLauncher = $true
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
            $Script:ApiStartInProgress = $false
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
    param([switch]$FromLauncherClose)

    $pids = @(Get-ProjectApiProcessIds)
    if ($pids.Count -eq 0) {
        Add-Log "没有发现本项目 API 进程。"
        $Script:ApiStartInProgress = $false
        $Script:ApiStartedByLauncher = $false
        Update-StartButtonState $false
        return
    }
    foreach ($apiPid in $pids) {
        try {
            Stop-ProcessTree -ProcessId $apiPid
            Add-Log "已停止项目 API 进程树 PID $apiPid"
        }
        catch {
            Add-Log "停止 PID $apiPid 失败: $($_.Exception.Message)" "WARN"
        }
    }
    Start-Sleep -Milliseconds 800
    $Script:ApiStartInProgress = $false
    $Script:ApiStartedByLauncher = $false
    $Script:WarmupStarted = $false
    Update-StartButtonState $false
    if ($FromLauncherClose) {
        Add-Log "启动器关闭清理已执行。"
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
    Copy-LocalTavoScript
}

function Copy-LocalTavoScript {
    $text = "<script src=`"http://$Script:LanHost`:$Script:ApiPort/static/tavo.js?v=20260605-ld-live-v1`"></script>"
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
    if ($Script:IsTestRender) {
        if ($Script:WebUiStatusLabel) {
            $Script:WebUiStatusLabel.Text = "WebUI 预览模式未检测。"
            $Script:WebUiStatusLabel.ForeColor = [System.Drawing.Color]::Khaki
        }
        return $false
    }
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
    if ($Script:IsTestRender) { return }
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

function Convert-LogLineForDisplay {
    param([object]$Line)
    if ($null -eq $Line) { return $null }
    $text = [string]$Line
    $esc = [char]27
    $ansiPattern = [regex]::Escape([string]$esc) + "\[[0-9;?]*[ -/]*[@-~]"
    $text = $text -replace $ansiPattern, ""
    $text = $text -replace "`r", ""
    $text = $text -replace "[\x00-\x08\x0b\x0c\x0e-\x1f]", ""
    $text = $text.TrimEnd()
    if ([string]::IsNullOrWhiteSpace($text)) { return $null }

    $trim = $text.Trim()
    $scan = $trim -replace "^\[[^\]]+\]\s+\[[^\]]+\]\s+", ""
    if (
        $scan -match "^\d{1,3}%\|" -or
        $scan -match "^\|?\s*\d+/\d+\s*\[[^\]]*(it/s|s/it)" -or
        $scan -match "^\d+/\d+\s+\[[^\]]*(it/s|s/it)"
    ) {
        return $null
    }
    return $text
}

function Add-DisplayLogLine {
    param(
        [System.Text.StringBuilder]$Builder,
        [string]$Line,
        [ref]$SuppressedProgressCount
    )
    if ([string]::IsNullOrWhiteSpace([string]$Line)) { return }
    $clean = Convert-LogLineForDisplay $Line
    if ($null -eq $clean) {
        $SuppressedProgressCount.Value = [int]$SuppressedProgressCount.Value + 1
        return
    }
    [void]$Builder.AppendLine($clean)
}

function Set-BackendLogTextStable {
    param([string]$Text)
    if (-not $Script:BackendLogBox) { return }
    if ($Script:BackendLogLastText -eq $Text) { return }
    $Script:BackendLogLastText = $Text
    $Script:BackendLogBox.SuspendLayout()
    try {
        $Script:BackendLogBox.Text = $Text
        $Script:BackendLogBox.SelectionStart = $Script:BackendLogBox.TextLength
        $Script:BackendLogBox.ScrollToCaret()
    }
    finally {
        $Script:BackendLogBox.ResumeLayout()
    }
}

function Refresh-BackendLogTail {
    Refresh-StartupLogPaths
    $builder = New-Object System.Text.StringBuilder
    $suppressedProgress = 0
    try {
        $apiTail = Invoke-RestMethod -Uri "$Script:ApiBase/server_log/tail?n=220" -TimeoutSec 2
        if ($apiTail -and $apiTail.lines) {
            [void]$builder.AppendLine("=== API RUNTIME /server_log/tail ===")
            foreach ($line in @($apiTail.lines)) {
                $ts = ""
                try { $ts = ([DateTimeOffset]::FromUnixTimeSeconds([int64]$line.ts).ToLocalTime().ToString("HH:mm:ss")) } catch { $ts = "--:--:--" }
                $raw = "[$ts] [$($line.stream)] $($line.line)"
                Add-DisplayLogLine -Builder $builder -Line $raw -SuppressedProgressCount ([ref]$suppressedProgress)
            }
            [void]$builder.AppendLine()
        }
    }
    catch {}
    if ($Script:LatestStartupLog -and (Test-Path $Script:LatestStartupLog.FullName)) {
        [void]$builder.AppendLine("=== STDOUT $($Script:LatestStartupLog.Name) ===")
        foreach ($line in @(Get-Content -LiteralPath $Script:LatestStartupLog.FullName -Tail 120 -ErrorAction SilentlyContinue)) {
            Add-DisplayLogLine -Builder $builder -Line $line -SuppressedProgressCount ([ref]$suppressedProgress)
        }
        [void]$builder.AppendLine()
    }
    if ($Script:LatestStartupErr -and (Test-Path $Script:LatestStartupErr.FullName)) {
        [void]$builder.AppendLine("=== STDERR $($Script:LatestStartupErr.Name) ===")
        foreach ($line in @(Get-Content -LiteralPath $Script:LatestStartupErr.FullName -Tail 120 -ErrorAction SilentlyContinue)) {
            Add-DisplayLogLine -Builder $builder -Line $line -SuppressedProgressCount ([ref]$suppressedProgress)
        }
    }
    $text = $builder.ToString().TrimEnd()
    if ($suppressedProgress -gt 0) {
        $text += ("`r`n`r`n[launcher] 已隐藏 {0} 行动态进度条输出；完整原始日志在 打开日志。" -f $suppressedProgress)
    }
    if ([string]::IsNullOrWhiteSpace($text)) {
        $text = '还没有发现后端启动日志。先点击左下角“启动 LEON 服务”。'
    }
    Set-BackendLogTextStable $text
}

function Build-LauncherForm {
    $form = New-Object System.Windows.Forms.Form
    $form.Text = "LEON 启动器 - IndexTTS2 vLLM"
    $form.StartPosition = "CenterScreen"
    $form.Size = New-Object System.Drawing.Size(1240, 820)
    $form.MinimumSize = New-Object System.Drawing.Size(1120, 720)
    $form.BackColor = [System.Drawing.Color]::FromArgb(15, 23, 42)
    $form.Font = New-Font 9
    Set-DoubleBuffered $form
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
    $header.Name = "LauncherHeader"
    $header.Dock = "Top"
    $header.Height = 116
    $header.BackColor = [System.Drawing.Color]::FromArgb(10, 14, 19)
    Set-DoubleBuffered $header
    $form.Controls.Add($header)

    $bannerImage = $null
    if (Test-Path $Script:BannerPath) {
        try {
            $candidateBanner = [System.Drawing.Image]::FromFile($Script:BannerPath)
            $bannerAspect = $candidateBanner.Width / [double]$candidateBanner.Height
            if ($bannerAspect -ge 2.45) {
                $bannerImage = $candidateBanner
                $Script:PreviewBannerImage = $bannerImage
            }
            else {
                $candidateBanner.Dispose()
                Add-Log ("现有横幅比例 {0:N2}:1，不作为顶部横图渲染；等待 gpt-image-2 横图替换。" -f $bannerAspect) "WARN"
            }
        }
        catch {
            Add-Log "加载启动器横幅失败: $($_.Exception.Message)" "WARN"
            $bannerImage = $null
        }
    }
    $header.Add_Paint({
        param($sender, $e)
        $g = $e.Graphics
        $rect = $sender.ClientRectangle
        Draw-LauncherHeaderBackdrop -Graphics $g -Rect $rect -BannerImage $bannerImage
    })

    $title = New-Object System.Windows.Forms.Label
    $title.Text = "LEON 启动器"
    $title.Font = New-Font 21 ([System.Drawing.FontStyle]::Bold)
    $title.ForeColor = [System.Drawing.Color]::White
    $title.BackColor = [System.Drawing.Color]::Transparent
    $title.Location = New-Object System.Drawing.Point(26, 16)
    $title.Size = New-Object System.Drawing.Size(420, 42)
    $header.Controls.Add($title)
    $title.BringToFront()

    $sub = New-Object System.Windows.Forms.Label
    $sub.Text = "IndexTTS2 + vLLM 本地语音服务"
    $sub.Font = New-Font 10
    $sub.ForeColor = [System.Drawing.Color]::Gainsboro
    $sub.BackColor = [System.Drawing.Color]::Transparent
    $sub.Location = New-Object System.Drawing.Point(29, 58)
    $sub.Size = New-Object System.Drawing.Size(560, 24)
    $header.Controls.Add($sub)
    $sub.BringToFront()

    $Script:StatusLabel = New-Object System.Windows.Forms.Label
    $Script:StatusLabel.Text = "首次启动会自动检测环境。"
    $Script:StatusLabel.Font = New-Font 9
    $Script:StatusLabel.ForeColor = [System.Drawing.Color]::Khaki
    $Script:StatusLabel.BackColor = [System.Drawing.Color]::Transparent
    $Script:StatusLabel.Location = New-Object System.Drawing.Point(29, 84)
    $Script:StatusLabel.Size = New-Object System.Drawing.Size(640, 24)
    $header.Controls.Add($Script:StatusLabel)
    $Script:StatusLabel.BringToFront()

    $Script:ProgressBar = New-Object System.Windows.Forms.ProgressBar
    $Script:ProgressBar.Anchor = [System.Windows.Forms.AnchorStyles]::Top -bor [System.Windows.Forms.AnchorStyles]::Right
    $Script:ProgressBar.Location = New-Object System.Drawing.Point(858, 88)
    $Script:ProgressBar.Size = New-Object System.Drawing.Size(330, 10)
    $header.Controls.Add($Script:ProgressBar)
    $Script:ProgressBar.BringToFront()

    $main = New-Object System.Windows.Forms.SplitContainer
    $main.Dock = "Fill"
    $main.SplitterDistance = 220
    $main.FixedPanel = [System.Windows.Forms.FixedPanel]::Panel1
    $main.IsSplitterFixed = $true
    $main.BackColor = [System.Drawing.Color]::FromArgb(15, 18, 22)
    $main.Panel1.BackColor = [System.Drawing.Color]::FromArgb(30, 41, 59)
    $main.Panel2.BackColor = [System.Drawing.Color]::FromArgb(15, 23, 42)
    Set-DoubleBuffered $main
    Set-DoubleBuffered $main.Panel1
    Set-DoubleBuffered $main.Panel2
    $form.Controls.Add($main)
    $main.BringToFront()

    $tabs = New-Object System.Windows.Forms.TabControl
    $tabs.Dock = "Fill"
    $tabs.Font = New-Font 9
    $tabs.BackColor = [System.Drawing.Color]::FromArgb(15, 18, 22)
    $tabs.ForeColor = [System.Drawing.Color]::FromArgb(210, 218, 226)
    $tabs.DrawMode = [System.Windows.Forms.TabDrawMode]::OwnerDrawFixed
    $tabs.SizeMode = [System.Windows.Forms.TabSizeMode]::Fixed
    $tabs.Appearance = [System.Windows.Forms.TabAppearance]::FlatButtons
    $tabs.ItemSize = New-Object System.Drawing.Size(1, 1)
    $tabs.Padding = New-Object System.Drawing.Point(0, 0)
    $tabs.Add_DrawItem({
        param($sender, $e)
        $selected = ($e.Index -eq $sender.SelectedIndex)
        $rect = $e.Bounds
        $back = if ($selected) { [System.Drawing.Color]::FromArgb(25, 30, 37) } else { [System.Drawing.Color]::FromArgb(15, 23, 42) }
        $fore = if ($selected) { [System.Drawing.Color]::White } else { [System.Drawing.Color]::FromArgb(190, 198, 208) }
        $brush = New-Object System.Drawing.SolidBrush($back)
        $textBrush = New-Object System.Drawing.SolidBrush($fore)
        $fmt = New-Object System.Drawing.StringFormat
        $fmt.Alignment = [System.Drawing.StringAlignment]::Center
        $fmt.LineAlignment = [System.Drawing.StringAlignment]::Center
        try {
            $e.Graphics.FillRectangle($brush, $rect)
            $rectF = [System.Drawing.RectangleF]::new([single]$rect.X, [single]$rect.Y, [single]$rect.Width, [single]$rect.Height)
            $e.Graphics.DrawString($sender.TabPages[$e.Index].Text, $sender.Font, $textBrush, $rectF, $fmt)
            if ($selected) {
                $pen = New-Object System.Drawing.Pen([System.Drawing.Color]::FromArgb(16, 185, 129), 2)
                try {
                    $e.Graphics.DrawLine($pen, $rect.Left + 10, $rect.Bottom - 2, $rect.Right - 10, $rect.Bottom - 2)
                }
                finally {
                    $pen.Dispose()
                }
            }
        }
        finally {
            $brush.Dispose()
            $textBrush.Dispose()
            $fmt.Dispose()
        }
    })
    $main.Panel2.Controls.Add($tabs)
    $Script:Tabs = $tabs

    $sidebarButtons = @()
    $buttons = @(
        @("首页 / 日志", { Show-HomeLog }),
        @("环境检测", { $tabs.SelectedIndex = 1; Run-EnvironmentCheck }),
        @("一键修复", { $tabs.SelectedIndex = 1; Repair-Environment }),
        @("停止服务", { Stop-LeonService }),
        @("刷新音色", { $tabs.SelectedIndex = 2; Refresh-Voices }),
        @("WebUI", { $tabs.SelectedIndex = 3; Refresh-WebUiPanel | Out-Null }),
        @("打开 API", { Open-ApiHome }),
        @("打开日志", { Open-LogsFolder })
    )
    $y = 20
    foreach ($b in $buttons) {
        $btn = New-Object System.Windows.Forms.Button
        $btn.Text = $b[0]
        $btn.Location = New-Object System.Drawing.Point(20, $y)
        $btn.Size = New-Object System.Drawing.Size(178, 36)
        $variant = if ($b[0] -eq "停止服务") { "Danger" } else { "Secondary" }
        Set-FlatButtonStyle $btn $variant
        $handler = $b[1]
        $btn.Add_Click($handler)
        $main.Panel1.Controls.Add($btn)
        $sidebarButtons += $btn
        $y += 44
    }

    $info = New-Object System.Windows.Forms.Label
    $info.Text = "API: $Script:ApiPort`r`n只检测环境`r`n不自动启动"
    $info.ForeColor = [System.Drawing.Color]::Silver
    $info.Location = New-Object System.Drawing.Point(18, 320)
    $info.Size = New-Object System.Drawing.Size(176, 80)
    $main.Panel1.Controls.Add($info)

    $Script:StartButton = New-Object System.Windows.Forms.Button
    $Script:StartButton.Text = "启动 LEON 服务"
    $Script:StartButton.Location = New-Object System.Drawing.Point(18, 420)
    $Script:StartButton.Size = New-Object System.Drawing.Size(178, 76)
    $Script:StartButton.Anchor = [System.Windows.Forms.AnchorStyles]::Left -bor [System.Windows.Forms.AnchorStyles]::Right -bor [System.Windows.Forms.AnchorStyles]::Bottom
    Set-FlatButtonStyle $Script:StartButton "Primary"
    $Script:StartButton.Font = New-Font 14 ([System.Drawing.FontStyle]::Bold)
    $Script:StartButton.Add_Click({ Start-LeonService })
    $main.Panel1.Controls.Add($Script:StartButton)

    $layoutSidebar = {
        if (-not $Script:StartButton) { return }
        $panelWidth = [Math]::Max(150, $main.Panel1.ClientSize.Width)
        foreach ($btn in $sidebarButtons) {
            $btn.Size = New-Object System.Drawing.Size([Math]::Max(120, $panelWidth - 36), 36)
        }
        $startHeight = 76
        $startY = [Math]::Max(312, $main.Panel1.ClientSize.Height - $startHeight - 18)
        $Script:StartButton.Location = New-Object System.Drawing.Point(18, $startY)
        $Script:StartButton.Size = New-Object System.Drawing.Size([Math]::Max(120, $panelWidth - 36), $startHeight)
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

    $refreshLogBtn = New-Object System.Windows.Forms.Button
    $refreshLogBtn.Text = "刷新日志"
    $refreshLogBtn.Location = New-Object System.Drawing.Point(0, 4)
    $refreshLogBtn.Size = New-Object System.Drawing.Size(110, 30)
    Set-FlatButtonStyle $refreshLogBtn
    $refreshLogBtn.Add_Click({ Refresh-BackendLogTail })
    $logTop.Controls.Add($refreshLogBtn)

    $warmupBtn = New-Object System.Windows.Forms.Button
    $warmupBtn.Text = "手动预热"
    $warmupBtn.Location = New-Object System.Drawing.Point(120, 4)
    $warmupBtn.Size = New-Object System.Drawing.Size(110, 30)
    Set-FlatButtonStyle $warmupBtn
    $warmupBtn.Add_Click({ Start-WarmupAsync })
    $logTop.Controls.Add($warmupBtn)

    $logHint = New-Object System.Windows.Forms.Label
    $logHint.Text = "启动器日志 + 后端运行日志（已过滤动态进度条）"
    $logHint.ForeColor = [System.Drawing.Color]::Silver
    $logHint.Location = New-Object System.Drawing.Point(246, 9)
    $logHint.Size = New-Object System.Drawing.Size(360, 22)
    $logTop.Controls.Add($logHint)

    $Script:BackendLogBox = New-Object System.Windows.Forms.RichTextBox
    $Script:BackendLogBox.Multiline = $true
    $Script:BackendLogBox.Dock = "Fill"
    $Script:BackendLogBox.ScrollBars = "Vertical"
    $Script:BackendLogBox.WordWrap = $false
    $Script:BackendLogBox.ReadOnly = $true
    $Script:BackendLogBox.DetectUrls = $false
    $Script:BackendLogBox.BackColor = [System.Drawing.Color]::FromArgb(9, 12, 16)
    $Script:BackendLogBox.ForeColor = [System.Drawing.Color]::FromArgb(220, 226, 232)
    $Script:BackendLogBox.Font = New-Object System.Drawing.Font("Consolas", 9.5)
    $Script:BackendLogBox.BorderStyle = "None"
    $logShell.Controls.Add($Script:BackendLogBox)
    $logShell.Controls.Add($logTop)
    $Script:LogBox = $Script:BackendLogBox

    $tabEnv = New-Object System.Windows.Forms.TabPage
    $tabEnv.Text = "环境"
    $tabEnv.BackColor = [System.Drawing.Color]::FromArgb(18, 22, 27)
    $tabs.TabPages.Add($tabEnv)

    $Script:CheckList = New-Object System.Windows.Forms.ListView
    $Script:CheckList.Dock = "Fill"
    $Script:CheckList.View = "Details"
    $Script:CheckList.FullRowSelect = $true
    $Script:CheckList.GridLines = $false
    $Script:CheckList.BorderStyle = [System.Windows.Forms.BorderStyle]::None
    $Script:CheckList.HeaderStyle = [System.Windows.Forms.ColumnHeaderStyle]::Nonclickable
    $Script:CheckList.HideSelection = $false
    $Script:CheckList.BackColor = [System.Drawing.Color]::FromArgb(13, 17, 22)
    $Script:CheckList.ForeColor = [System.Drawing.Color]::WhiteSmoke
    Set-DoubleBuffered $Script:CheckList
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
    $voicePanel.BackColor = [System.Drawing.Color]::FromArgb(15, 18, 22)
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
        Set-ComboBoxStyle $cb
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
    Set-FlatButtonStyle $refreshVoiceBtn
    $refreshVoiceBtn.Add_Click({ Refresh-Voices })
    $voicePanel.Controls.Add($refreshVoiceBtn)

    $previewBtn = New-Object System.Windows.Forms.Button
    $previewBtn.Text = "试听默认音色"
    $previewBtn.Location = New-Object System.Drawing.Point(154, 116)
    $previewBtn.Size = New-Object System.Drawing.Size(130, 34)
    Set-FlatButtonStyle $previewBtn
    $previewBtn.Add_Click({ Open-VoicePreview })
    $voicePanel.Controls.Add($previewBtn)

    $testBtn = New-Object System.Windows.Forms.Button
    $testBtn.Text = "开始多音色测试"
    $testBtn.Location = New-Object System.Drawing.Point(294, 116)
    $testBtn.Size = New-Object System.Drawing.Size(150, 34)
    Set-FlatButtonStyle $testBtn "Primary"
    $testBtn.Add_Click({ Start-MultiVoiceTest })
    $voicePanel.Controls.Add($testBtn)

    $openAudioBtn = New-Object System.Windows.Forms.Button
    $openAudioBtn.Text = "打开最近音频"
    $openAudioBtn.Location = New-Object System.Drawing.Point(454, 116)
    $openAudioBtn.Size = New-Object System.Drawing.Size(130, 34)
    Set-FlatButtonStyle $openAudioBtn
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
    Set-TextBoxStyle $Script:TestTextBox
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
    Set-FlatButtonStyle $startWebUiBtn "Primary"
    $startWebUiBtn.Add_Click({ Start-WebUiService })
    $webUiTop.Controls.Add($startWebUiBtn)

    $openWebUiBtn = New-Object System.Windows.Forms.Button
    $openWebUiBtn.Text = "浏览器打开"
    $openWebUiBtn.Location = New-Object System.Drawing.Point(144, 10)
    $openWebUiBtn.Size = New-Object System.Drawing.Size(116, 32)
    Set-FlatButtonStyle $openWebUiBtn
    $openWebUiBtn.Add_Click({ Open-WebUiExternal })
    $webUiTop.Controls.Add($openWebUiBtn)

    $embedWebUiBtn = New-Object System.Windows.Forms.Button
    $embedWebUiBtn.Text = "内嵌刷新"
    $embedWebUiBtn.Location = New-Object System.Drawing.Point(272, 10)
    $embedWebUiBtn.Size = New-Object System.Drawing.Size(104, 32)
    Set-FlatButtonStyle $embedWebUiBtn
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

    if ($Script:IsTestRender) {
        $webUiPreview = New-Object System.Windows.Forms.Label
        $webUiPreview.Dock = "Fill"
        $webUiPreview.TextAlign = [System.Drawing.ContentAlignment]::MiddleCenter
        $webUiPreview.Text = "WebUI 内嵌区`r`n预览模式不初始化浏览器控件"
        $webUiPreview.ForeColor = [System.Drawing.Color]::FromArgb(170, 181, 192)
        $webUiPreview.BackColor = [System.Drawing.Color]::FromArgb(10, 14, 19)
        $webUiPreview.Font = New-Font 11
        $webUiShell.Controls.Add($webUiPreview)
    }
    else {
        $Script:WebUiBrowser = New-Object System.Windows.Forms.WebBrowser
        $Script:WebUiBrowser.Dock = "Fill"
        $Script:WebUiBrowser.ScriptErrorsSuppressed = $true
        $webUiShell.Controls.Add($Script:WebUiBrowser)
    }
    Refresh-WebUiPanel | Out-Null

    $form.Add_Shown({
        if (-not $Script:FirstCheckDone) {
            $Script:FirstCheckDone = $true
            $Script:Tabs.SelectedIndex = 0
            if ($Script:IsTestRender) {
                Refresh-BackendLogTail
                return
            }
            Run-EnvironmentCheck -Silent
            $health = Test-ApiHealth
            Update-StartButtonState $health
            if ($health) { Refresh-Voices; Refresh-BackendLogTail }
        }
    })
    $form.Add_FormClosing({
        if ($Script:ApiStartedByLauncher -or $Script:ApiStartInProgress) {
            Add-Log "启动器关闭：停止由本启动器启动的 API 服务。"
            Stop-LeonService -FromLauncherClose
        }
    })
    $form.Add_FormClosed({
        if ($bannerImage) {
            $bannerImage.Dispose()
            $Script:PreviewBannerImage = $null
            $bannerImage = $null
        }
        if ($Script:LauncherIcon) {
            $Script:LauncherIcon.Dispose()
            $Script:LauncherIcon = $null
        }
        if ($Script:LauncherMutex) {
            if ($Script:LauncherMutexOwned) {
                try { $Script:LauncherMutex.ReleaseMutex() } catch {}
                $Script:LauncherMutexOwned = $false
            }
            $Script:LauncherMutex.Dispose()
            $Script:LauncherMutex = $null
        }
    })
    return $form
}

$form = Build-LauncherForm
if (-not [string]::IsNullOrWhiteSpace($env:LEON_LAUNCHER_SCREENSHOT)) {
    Add-Log "LEON 启动器离屏截图渲染。"
    Set-StatusText "界面预览模式，不启动服务。" "Khaki"
    Update-StartButtonState $false
    $form.Size = New-Object System.Drawing.Size(1240, 820)
    if ($Script:Tabs) {
        $Script:Tabs.SelectedIndex = 0
    }
    Initialize-ControlTree $form
    Invoke-PreviewDockLayout $form
    $form.PerformLayout()
    Invoke-PreviewDockLayout $form
    [System.Windows.Forms.Application]::DoEvents()
    $bitmap = New-Object System.Drawing.Bitmap($form.ClientSize.Width, $form.ClientSize.Height)
    try {
        $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
        try {
            $graphics.Clear($form.BackColor)
            foreach ($child in $form.Controls) {
                Draw-ControlTree -Control $child -Graphics $graphics -OffsetX 0 -OffsetY 0
            }
        }
        finally {
            $graphics.Dispose()
        }
        Save-BitmapPng -Bitmap $bitmap -Path $env:LEON_LAUNCHER_SCREENSHOT
        Write-Output "LEON launcher screenshot OK: $env:LEON_LAUNCHER_SCREENSHOT"
    }
    finally {
        $bitmap.Dispose()
        $form.Dispose()
    }
    exit 0
}
if ($env:LEON_LAUNCHER_SMOKE_TEST -eq "1") {
    $form.Dispose()
    Write-Output "LEON launcher smoke OK"
    exit 0
}
Add-Log "LEON 启动器已打开。"
[void][System.Windows.Forms.Application]::Run($form)
