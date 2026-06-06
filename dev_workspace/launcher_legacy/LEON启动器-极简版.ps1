# LEON 极简启动器
# 只保留核心功能，无侧边栏，顶部按钮

$ErrorActionPreference = "Continue"
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
[System.Windows.Forms.Application]::EnableVisualStyles()

# 全局变量
$Script:LauncherDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$Script:RepoRoot = (Resolve-Path (Join-Path $Script:LauncherDir "..\..")).Path
$Script:ApiPort = 9880
$Script:ApiBase = "http://127.0.0.1:$Script:ApiPort"
$Script:StartupBat = Join-Path $Script:RepoRoot "go-API-VLLM-NoQwen.bat"
$Script:BannerPath = Join-Path $Script:LauncherDir "leon-banner-hq.png"

function New-Font {
    param([float]$Size, [System.Drawing.FontStyle]$Style = [System.Drawing.FontStyle]::Regular)
    return New-Object System.Drawing.Font("Segoe UI", $Size, $Style)
}

function New-ModernButton {
    param([string]$Text, [string]$Color = "Primary")
    $btn = New-Object System.Windows.Forms.Button
    $btn.Text = $Text
    $btn.Height = 45
    $btn.FlatStyle = "Flat"
    $btn.Font = New-Font 10
    $btn.Cursor = "Hand"
    $btn.FlatAppearance.BorderSize = 0

    switch ($Color) {
        "Primary" {
            $btn.BackColor = [System.Drawing.Color]::FromArgb(16, 185, 129)
            $btn.ForeColor = [System.Drawing.Color]::White
        }
        "Danger" {
            $btn.BackColor = [System.Drawing.Color]::FromArgb(239, 68, 68)
            $btn.ForeColor = [System.Drawing.Color]::White
        }
        default {
            $btn.BackColor = [System.Drawing.Color]::FromArgb(51, 65, 85)
            $btn.ForeColor = [System.Drawing.Color]::White
        }
    }
    return $btn
}

function Start-Service {
    if (-not (Test-Path $Script:StartupBat)) {
        [System.Windows.Forms.MessageBox]::Show("Startup script not found", "Error") | Out-Null
        return
    }
    Start-Process -FilePath "cmd.exe" -ArgumentList @("/c", "`"$Script:StartupBat`"") -WorkingDirectory $Script:RepoRoot -WindowStyle Hidden
}

function Stop-Service {
    $pids = @()
    netstat -ano -p tcp | Select-String "LISTENING" | ForEach-Object {
        $parts = $_.ToString().Trim() -split "\s+"
        if ($parts.Length -ge 5 -and $parts[1] -match (":$Script:ApiPort$")) {
            $pids += [int]$parts[-1]
        }
    }
    foreach ($pid in $pids) {
        taskkill /PID $pid /T /F 2>&1 | Out-Null
    }
}

# 构建界面
$form = New-Object System.Windows.Forms.Form
$form.Text = "LEON - IndexTTS2"
$form.Size = New-Object System.Drawing.Size(1100, 700)
$form.StartPosition = "CenterScreen"
$form.BackColor = [System.Drawing.Color]::FromArgb(15, 23, 42)

# 横幅
$banner = New-Object System.Windows.Forms.PictureBox
$banner.Dock = "Top"
$banner.Height = 160
$banner.SizeMode = "StretchImage"
if (Test-Path $Script:BannerPath) {
    $banner.Image = [System.Drawing.Image]::FromFile($Script:BannerPath)
}
$form.Controls.Add($banner)

# 顶部按钮栏
$toolbar = New-Object System.Windows.Forms.FlowLayoutPanel
$toolbar.Dock = "Top"
$toolbar.Height = 70
$toolbar.BackColor = [System.Drawing.Color]::FromArgb(30, 41, 59)
$toolbar.Padding = New-Object System.Windows.Forms.Padding(20, 12, 20, 12)
$toolbar.FlowDirection = "LeftToRight"
$form.Controls.Add($toolbar)

$startBtn = New-ModernButton -Text "启动服务" -Color "Primary"
$startBtn.Width = 130
$startBtn.Add_Click({ Start-Service })
$toolbar.Controls.Add($startBtn)

$stopBtn = New-ModernButton -Text "停止服务" -Color "Danger"
$stopBtn.Width = 130
$stopBtn.Add_Click({ Stop-Service })
$toolbar.Controls.Add($stopBtn)

# 主内容区 - Tabs
$tabs = New-Object System.Windows.Forms.TabControl
$tabs.Dock = "Fill"
$tabs.Font = New-Font 10
$tabs.BackColor = [System.Drawing.Color]::FromArgb(15, 23, 42)
$tabs.ForeColor = [System.Drawing.Color]::White
$form.Controls.Add($tabs)

# Tab 1: 日志
$tabLog = New-Object System.Windows.Forms.TabPage
$tabLog.Text = "日志"
$tabLog.BackColor = [System.Drawing.Color]::FromArgb(15, 23, 42)
$tabs.TabPages.Add($tabLog)

$logBox = New-Object System.Windows.Forms.RichTextBox
$logBox.Dock = "Fill"
$logBox.ReadOnly = $true
$logBox.BackColor = [System.Drawing.Color]::FromArgb(30, 41, 59)
$logBox.ForeColor = [System.Drawing.Color]::White
$logBox.Font = New-Object System.Drawing.Font("Consolas", 10)
$logBox.BorderStyle = "None"
$logBox.Text = "LEON Launcher Ready`n`nClick [Start Service] to start the API server."
$tabLog.Controls.Add($logBox)

[void][System.Windows.Forms.Application]::Run($form)
