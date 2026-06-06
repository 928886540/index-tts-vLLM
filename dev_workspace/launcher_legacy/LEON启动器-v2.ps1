# LEON 现代简约启动器
# 参考现代 UI 设计原则：大留白、扁平化、卡片式

$ErrorActionPreference = "Continue"
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
[System.Windows.Forms.Application]::EnableVisualStyles()

$Script:LauncherDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$Script:RepoRoot = (Resolve-Path (Join-Path $Script:LauncherDir "..\..")).Path
$Script:ApiPort = 9880
$Script:ApiBase = "http://127.0.0.1:$Script:ApiPort"
$Script:StartupBat = Join-Path $Script:RepoRoot "go-API-VLLM-NoQwen.bat"
$Script:RuntimePython = Join-Path $Script:RepoRoot "indextts2runtime\python.exe"
$Script:BannerPath = Join-Path $Script:LauncherDir "leon-banner-hq.png"
$Script:CheckList = $null

function New-Font {
    param([float]$Size, [System.Drawing.FontStyle]$Style = [System.Drawing.FontStyle]::Regular)
    return New-Object System.Drawing.Font("Segoe UI", $Size, $Style)
}

function New-Button {
    param([string]$Text, [int]$Width = 140, [string]$Type = "Primary")
    $btn = New-Object System.Windows.Forms.Button
    $btn.Text = $Text
    $btn.Width = $Width
    $btn.Height = 48
    $btn.FlatStyle = "Flat"
    $btn.Font = New-Font 10.5
    $btn.Cursor = "Hand"
    $btn.FlatAppearance.BorderSize = 0
    $btn.Margin = New-Object System.Windows.Forms.Padding(10, 0, 10, 0)

    switch ($Type) {
        "Primary" {
            $btn.BackColor = [System.Drawing.Color]::FromArgb(16, 185, 129)
            $btn.ForeColor = [System.Drawing.Color]::White
        }
        "Danger" {
            $btn.BackColor = [System.Drawing.Color]::FromArgb(239, 68, 68)
            $btn.ForeColor = [System.Drawing.Color]::White
        }
        default {
            $btn.BackColor = [System.Drawing.Color]::FromArgb(71, 85, 105)
            $btn.ForeColor = [System.Drawing.Color]::White
        }
    }
    return $btn
}

function Start-Service {
    if (-not (Test-Path $Script:StartupBat)) { return }
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
    foreach ($pid in $pids) { taskkill /PID $pid /T /F 2>&1 | Out-Null }
}

function Run-Check {
    if (-not $Script:CheckList) { return }
    $Script:CheckList.Items.Clear()

    # Python Runtime
    $item = New-Object System.Windows.Forms.ListViewItem("Python Runtime")
    $exists = Test-Path $Script:RuntimePython
    [void]$item.SubItems.Add($(if ($exists) { "OK" } else { "MISSING" }))
    [void]$item.SubItems.Add($(if ($exists) { $Script:RuntimePython } else { "Not found" }))
    $item.ForeColor = $(if ($exists) { [System.Drawing.Color]::FromArgb(16, 185, 129) } else { [System.Drawing.Color]::FromArgb(239, 68, 68) })
    [void]$Script:CheckList.Items.Add($item)

    # API Port
    $item = New-Object System.Windows.Forms.ListViewItem("API Port $Script:ApiPort")
    $pids = @()
    netstat -ano -p tcp | Select-String "LISTENING" | ForEach-Object {
        $parts = $_.ToString().Trim() -split "\s+"
        if ($parts.Length -ge 5 -and $parts[1] -match (":$Script:ApiPort$")) {
            $pids += [int]$parts[-1]
        }
    }
    if ($pids.Count -gt 0) {
        [void]$item.SubItems.Add("BUSY")
        [void]$item.SubItems.Add("PID: $($pids -join ',')")
        $item.ForeColor = [System.Drawing.Color]::FromArgb(245, 158, 11)
    } else {
        [void]$item.SubItems.Add("FREE")
        [void]$item.SubItems.Add("Port available")
        $item.ForeColor = [System.Drawing.Color]::FromArgb(16, 185, 129)
    }
    [void]$Script:CheckList.Items.Add($item)
}

# 主窗体
$form = New-Object System.Windows.Forms.Form
$form.Text = "LEON - IndexTTS2"
$form.Size = New-Object System.Drawing.Size(1200, 750)
$form.StartPosition = "CenterScreen"
$form.BackColor = [System.Drawing.Color]::FromArgb(15, 23, 42)
$form.Font = New-Font 9

# 横幅
$banner = New-Object System.Windows.Forms.PictureBox
$banner.Dock = "Top"
$banner.Height = 160
$banner.SizeMode = "StretchImage"
$banner.BackColor = [System.Drawing.Color]::FromArgb(30, 41, 59)
if (Test-Path $Script:BannerPath) {
    $banner.Image = [System.Drawing.Image]::FromFile($Script:BannerPath)
}
$form.Controls.Add($banner)

# 按钮栏（使用 FlowLayoutPanel 自动排列）
$buttonBar = New-Object System.Windows.Forms.FlowLayoutPanel
$buttonBar.Dock = "Top"
$buttonBar.Height = 80
$buttonBar.BackColor = [System.Drawing.Color]::FromArgb(30, 41, 59)
$buttonBar.Padding = New-Object System.Windows.Forms.Padding(30, 16, 30, 16)
$buttonBar.FlowDirection = "LeftToRight"
$form.Controls.Add($buttonBar)

$btnStart = New-Button -Text "Start Service" -Width 150 -Type "Primary"
$btnStart.Add_Click({ Start-Service })
$buttonBar.Controls.Add($btnStart)

$btnStop = New-Button -Text "Stop Service" -Width 150 -Type "Danger"
$btnStop.Add_Click({ Stop-Service })
$buttonBar.Controls.Add($btnStop)

$btnCheck = New-Button -Text "Check Environment" -Width 180 -Type "Secondary"
$btnCheck.Add_Click({ Run-Check })
$buttonBar.Controls.Add($btnCheck)

# 主内容区 - Tabs
$tabs = New-Object System.Windows.Forms.TabControl
$tabs.Dock = "Fill"
$tabs.Font = New-Font 10
$tabs.BackColor = [System.Drawing.Color]::FromArgb(15, 23, 42)
$tabs.ForeColor = [System.Drawing.Color]::White
$form.Controls.Add($tabs)

# Tab 1: Environment Check
$tabCheck = New-Object System.Windows.Forms.TabPage
$tabCheck.Text = "  Environment  "
$tabCheck.BackColor = [System.Drawing.Color]::FromArgb(15, 23, 42)
$tabCheck.Padding = New-Object System.Windows.Forms.Padding(30)
$tabs.TabPages.Add($tabCheck)

$Script:CheckList = New-Object System.Windows.Forms.ListView
$Script:CheckList.Dock = "Fill"
$Script:CheckList.View = "Details"
$Script:CheckList.FullRowSelect = $true
$Script:CheckList.GridLines = $false
$Script:CheckList.BorderStyle = "None"
$Script:CheckList.BackColor = [System.Drawing.Color]::FromArgb(30, 41, 59)
$Script:CheckList.ForeColor = [System.Drawing.Color]::White
$Script:CheckList.Font = New-Font 10
[void]$Script:CheckList.Columns.Add("Item", 250)
[void]$Script:CheckList.Columns.Add("Status", 100)
[void]$Script:CheckList.Columns.Add("Details", 700)
$tabCheck.Controls.Add($Script:CheckList)

# Tab 2: Logs
$tabLog = New-Object System.Windows.Forms.TabPage
$tabLog.Text = "  Logs  "
$tabLog.BackColor = [System.Drawing.Color]::FromArgb(15, 23, 42)
$tabLog.Padding = New-Object System.Windows.Forms.Padding(30)
$tabs.TabPages.Add($tabLog)

$logBox = New-Object System.Windows.Forms.RichTextBox
$logBox.Dock = "Fill"
$logBox.ReadOnly = $true
$logBox.BackColor = [System.Drawing.Color]::FromArgb(30, 41, 59)
$logBox.ForeColor = [System.Drawing.Color]::FromArgb(226, 232, 240)
$logBox.Font = New-Object System.Drawing.Font("Consolas", 10)
$logBox.BorderStyle = "None"
$logBox.Text = "[" + (Get-Date -Format "HH:mm:ss") + "] LEON Launcher ready.`n`nClick 'Start Service' to launch the API server."
$tabLog.Controls.Add($logBox)

[void][System.Windows.Forms.Application]::Run($form)
