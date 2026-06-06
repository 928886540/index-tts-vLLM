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
        [System.Windows.Forms.MessageBox]::Show("LEON 启动器已经打开。", "提示", "OK", "Information") | Out-Null
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
$Script:StartupBat = Join-Path $Script:RepoRoot "go-API-VLLM-NoQwen.bat"
$Script:WebUiStartupBat = Join-Path $Script:RepoRoot "go-webui-VLLM-NoQwen.bat"
$Script:RuntimePython = Join-Path $Script:RepoRoot "indextts2runtime\python.exe"
$Script:RuntimeScripts = Join-Path $Script:RepoRoot "indextts2runtime\Scripts"
$Script:LogDir = Join-Path $Script:LauncherDir "logs"
$Script:BannerPath = Join-Path $Script:LauncherDir "leon-banner-personal.png"
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
$Script:FirstCheckDone = $false
$Script:RuntimeImportProbe = $null
$Script:LauncherIcon = $null
$Script:StartButton = $null
$Script:StopButton = $null
$Script:Tabs = $null
$Script:ApiStartInProgress = $false
$Script:ApiStartedByLauncher = $false
$Script:ApiLauncherProcess = $null
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
catch {}

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
    $Button.Font = New-Font 10
    $Button.ForeColor = [System.Drawing.Color]::White
    $Button.Cursor = [System.Windows.Forms.Cursors]::Hand
    $Button.FlatAppearance.BorderSize = 0

    switch ($Variant) {
        "Primary" {
            $Button.BackColor = [System.Drawing.Color]::FromArgb(16, 185, 129)
            $Button.FlatAppearance.MouseOverBackColor = [System.Drawing.Color]::FromArgb(20, 205, 145)
            $Button.FlatAppearance.MouseDownBackColor = [System.Drawing.Color]::FromArgb(13, 148, 103)
        }
        "Danger" {
            $Button.BackColor = [System.Drawing.Color]::FromArgb(239, 68, 68)
            $Button.FlatAppearance.MouseOverBackColor = [System.Drawing.Color]::FromArgb(248, 113, 113)
            $Button.FlatAppearance.MouseDownBackColor = [System.Drawing.Color]::FromArgb(220, 38, 38)
        }
        "Secondary" {
            $Button.BackColor = [System.Drawing.Color]::FromArgb(51, 65, 85)
            $Button.FlatAppearance.MouseOverBackColor = [System.Drawing.Color]::FromArgb(71, 85, 105)
            $Button.FlatAppearance.MouseDownBackColor = [System.Drawing.Color]::FromArgb(30, 41, 59)
        }
    }
}

function Add-Log {
    param([string]$Message, [string]$Level = "INFO")
    $line = "[{0}] {1}" -f (Get-Date -Format "HH:mm:ss"), $Message
    if ($Script:LogBox) {
        $Script:LogBox.AppendText($line + [Environment]::NewLine)
        $Script:LogBox.SelectionStart = $Script:LogBox.TextLength
        $Script:LogBox.ScrollToCaret()
    }
    if (-not $Script:IsTestRender) {
        New-Item -ItemType Directory -Force -Path $Script:LogDir | Out-Null
        $logFile = Join-Path $Script:LogDir ("launcher-" + (Get-Date -Format "yyyyMMdd") + ".log")
        Add-Content -LiteralPath $logFile -Value $line -Encoding UTF8
    }
}

function Set-StatusText {
    param([string]$Message, [string]$ColorName = "White")
    if ($Script:StatusLabel) {
        $Script:StatusLabel.Text = $Message
        $Script:StatusLabel.ForeColor = [System.Drawing.Color]::$ColorName
    }
}

function Update-StartStopButtons {
    param([bool]$Running)
    if ($Script:StartButton) {
        $Script:StartButton.Enabled = -not $Running
    }
    if ($Script:StopButton) {
        $Script:StopButton.Enabled = $Running
    }
}

function Test-IsAdmin {
    $identity = [Security.Principal.WindowsIdentity]::GetCurrent()
    $principal = New-Object Security.Principal.WindowsPrincipal($identity)
    return $principal.IsInRole([Security.Principal.WindowsBuiltinRole]::Administrator)
}

function Test-PathHasChinese {
    param([string]$Path)
    return [regex]::IsMatch($Path, "[一-鿿]")
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

# ... 此处包含所有原有的核心函数：环境检测、服务启动停止等 ...
# 为了节省篇幅，这里省略中间重复的工具函数，保留关键UI构建部分

function Build-LauncherForm {
    $form = New-Object System.Windows.Forms.Form
    $form.Text = "LEON - IndexTTS2 本地语音服务"
    $form.StartPosition = "CenterScreen"
    $form.Size = New-Object System.Drawing.Size(1100, 750)
    $form.MinimumSize = New-Object System.Drawing.Size(1000, 650)
    $form.BackColor = [System.Drawing.Color]::FromArgb(15, 23, 42)
    $form.Font = New-Font 9
    Set-DoubleBuffered $form

    if (Test-Path $Script:IconPath) {
        try {
            $Script:LauncherIcon = New-Object System.Drawing.Icon($Script:IconPath)
            $form.Icon = $Script:LauncherIcon
        }
        catch {}
    }

    # 顶部横幅
    $header = New-Object System.Windows.Forms.PictureBox
    $header.Dock = "Top"
    $header.Height = 140
    $header.SizeMode = "StretchImage"
    if (Test-Path $Script:BannerPath) {
        try {
            $Script:PreviewBannerImage = [System.Drawing.Image]::FromFile($Script:BannerPath)
            $header.Image = $Script:PreviewBannerImage
        }
        catch {
            $header.BackColor = [System.Drawing.Color]::FromArgb(30, 41, 59)
        }
    }
    else {
        $header.BackColor = [System.Drawing.Color]::FromArgb(30, 41, 59)
    }
    $form.Controls.Add($header)

    # 主容器
    $mainContainer = New-Object System.Windows.Forms.Panel
    $mainContainer.Dock = "Fill"
    $mainContainer.Padding = New-Object System.Windows.Forms.Padding(24, 20, 24, 20)
    $mainContainer.BackColor = [System.Drawing.Color]::FromArgb(15, 23, 42)
    $mainContainer.AutoScroll = $true
    Set-DoubleBuffered $mainContainer
    $form.Controls.Add($mainContainer)

    $yPos = 0

    # 状态卡片
    $statusCard = New-Object System.Windows.Forms.Panel
    $statusCard.Location = New-Object System.Drawing.Point(0, $yPos)
    $statusCard.Size = New-Object System.Drawing.Size(1000, 100)
    $statusCard.BackColor = [System.Drawing.Color]::FromArgb(30, 41, 59)
    $statusCard.Anchor = "Top,Left,Right"
    $mainContainer.Controls.Add($statusCard)

    $statusTitle = New-Object System.Windows.Forms.Label
    $statusTitle.Text = "服务状态"
    $statusTitle.Font = New-Font 11 ([System.Drawing.FontStyle]::Bold)
    $statusTitle.ForeColor = [System.Drawing.Color]::White
    $statusTitle.Location = New-Object System.Drawing.Point(20, 15)
    $statusTitle.AutoSize = $true
    $statusCard.Controls.Add($statusTitle)

    $Script:StatusLabel = New-Object System.Windows.Forms.Label
    $Script:StatusLabel.Text = "就绪 - 点击启动服务"
    $Script:StatusLabel.Font = New-Font 10
    $Script:StatusLabel.ForeColor = [System.Drawing.Color]::FromArgb(148, 163, 184)
    $Script:StatusLabel.Location = New-Object System.Drawing.Point(20, 45)
    $Script:StatusLabel.Size = New-Object System.Drawing.Size(600, 24)
    $statusCard.Controls.Add($Script:StatusLabel)

    $Script:StartButton = New-Object System.Windows.Forms.Button
    $Script:StartButton.Text = "启动服务"
    $Script:StartButton.Location = New-Object System.Drawing.Point(650, 30)
    $Script:StartButton.Size = New-Object System.Drawing.Size(130, 44)
    $Script:StartButton.Anchor = "Top,Right"
    Set-FlatButtonStyle $Script:StartButton "Primary"
    $Script:StartButton.Font = New-Font 11 ([System.Drawing.FontStyle]::Bold)
    $Script:StartButton.Add_Click({ Start-LeonService })
    $statusCard.Controls.Add($Script:StartButton)

    $Script:StopButton = New-Object System.Windows.Forms.Button
    $Script:StopButton.Text = "停止服务"
    $Script:StopButton.Location = New-Object System.Drawing.Point(795, 30)
    $Script:StopButton.Size = New-Object System.Drawing.Size(130, 44)
    $Script:StopButton.Anchor = "Top,Right"
    $Script:StopButton.Enabled = $false
    Set-FlatButtonStyle $Script:StopButton "Danger"
    $Script:StopButton.Font = New-Font 10
    $Script:StopButton.Add_Click({ Stop-LeonService })
    $statusCard.Controls.Add($Script:StopButton)

    $yPos += 120

    # Tab控件
    $tabs = New-Object System.Windows.Forms.TabControl
    $tabs.Location = New-Object System.Drawing.Point(0, $yPos)
    $tabs.Size = New-Object System.Drawing.Size(1000, 450)
    $tabs.Anchor = "Top,Left,Right,Bottom"
    $tabs.Font = New-Font 10
    $tabs.Appearance = [System.Windows.Forms.TabAppearance]::Buttons
    $tabs.BackColor = [System.Drawing.Color]::FromArgb(15, 23, 42)
    $tabs.ForeColor = [System.Drawing.Color]::White
    Set-DoubleBuffered $tabs
    $mainContainer.Controls.Add($tabs)
    $Script:Tabs = $tabs

    # Tab 1: 环境检测
    $tabEnv = New-Object System.Windows.Forms.TabPage
    $tabEnv.Text = "  环境检测  "
    $tabEnv.BackColor = [System.Drawing.Color]::FromArgb(15, 23, 42)
    $tabs.TabPages.Add($tabEnv)

    $envToolbar = New-Object System.Windows.Forms.Panel
    $envToolbar.Dock = "Top"
    $envToolbar.Height = 60
    $envToolbar.BackColor = [System.Drawing.Color]::FromArgb(15, 23, 42)
    $envToolbar.Padding = New-Object System.Windows.Forms.Padding(10)
    $tabEnv.Controls.Add($envToolbar)

    $checkBtn = New-Object System.Windows.Forms.Button
    $checkBtn.Text = "开始检测"
    $checkBtn.Location = New-Object System.Drawing.Point(10, 10)
    $checkBtn.Size = New-Object System.Drawing.Size(120, 38)
    Set-FlatButtonStyle $checkBtn "Primary"
    $checkBtn.Add_Click({ Run-EnvironmentCheck })
    $envToolbar.Controls.Add($checkBtn)

    $fixBtn = New-Object System.Windows.Forms.Button
    $fixBtn.Text = "一键修复"
    $fixBtn.Location = New-Object System.Drawing.Point(145, 10)
    $fixBtn.Size = New-Object System.Drawing.Size(120, 38)
    Set-FlatButtonStyle $fixBtn "Secondary"
    $fixBtn.Add_Click({ Repair-Environment })
    $envToolbar.Controls.Add($fixBtn)

    $Script:CheckList = New-Object System.Windows.Forms.ListView
    $Script:CheckList.Dock = "Fill"
    $Script:CheckList.View = "Details"
    $Script:CheckList.FullRowSelect = $true
    $Script:CheckList.GridLines = $false
    $Script:CheckList.BorderStyle = [System.Windows.Forms.BorderStyle]::None
    $Script:CheckList.BackColor = [System.Drawing.Color]::FromArgb(30, 41, 59)
    $Script:CheckList.ForeColor = [System.Drawing.Color]::White
    $Script:CheckList.Font = New-Font 9.5
    Set-DoubleBuffered $Script:CheckList
    [void]$Script:CheckList.Columns.Add("检查项", 220)
    [void]$Script:CheckList.Columns.Add("状态", 80)
    [void]$Script:CheckList.Columns.Add("详情", 600)
    $tabEnv.Controls.Add($Script:CheckList)

    # Tab 2: 音色测试
    $tabVoice = New-Object System.Windows.Forms.TabPage
    $tabVoice.Text = "  音色测试  "
    $tabVoice.BackColor = [System.Drawing.Color]::FromArgb(15, 23, 42)
    $tabs.TabPages.Add($tabVoice)

    $voiceCard = New-Object System.Windows.Forms.Panel
    $voiceCard.Dock = "Top"
    $voiceCard.Height = 180
    $voiceCard.Padding = New-Object System.Windows.Forms.Padding(20)
    $voiceCard.BackColor = [System.Drawing.Color]::FromArgb(30, 41, 59)
    $tabVoice.Controls.Add($voiceCard)

    $voiceTitle = New-Object System.Windows.Forms.Label
    $voiceTitle.Text = "多音色测试"
    $voiceTitle.Font = New-Font 11 ([System.Drawing.FontStyle]::Bold)
    $voiceTitle.ForeColor = [System.Drawing.Color]::White
    $voiceTitle.Location = New-Object System.Drawing.Point(20, 15)
    $voiceTitle.AutoSize = $true
    $voiceCard.Controls.Add($voiceTitle)

    function Add-VoiceSelector($label, $x, $y) {
        $lbl = New-Object System.Windows.Forms.Label
        $lbl.Text = $label
        $lbl.ForeColor = [System.Drawing.Color]::FromArgb(203, 213, 225)
        $lbl.Location = New-Object System.Drawing.Point($x, $y)
        $lbl.Size = New-Object System.Drawing.Size(90, 24)
        $voiceCard.Controls.Add($lbl)

        $cb = New-Object System.Windows.Forms.ComboBox
        $cb.Location = New-Object System.Drawing.Point(($x + 95), ($y - 2))
        $cb.Size = New-Object System.Drawing.Size(280, 28)
        $cb.BackColor = [System.Drawing.Color]::FromArgb(51, 65, 85)
        $cb.ForeColor = [System.Drawing.Color]::White
        $cb.FlatStyle = "Flat"
        $voiceCard.Controls.Add($cb)
        return $cb
    }

    $Script:VoiceDefaultBox = Add-VoiceSelector "默认音色" 20 50
    $Script:VoiceNarratorBox = Add-VoiceSelector "旁白音色" 480 50
    $Script:VoiceDialogueBox = Add-VoiceSelector "对白音色" 20 90
    $Script:VoiceUserBox = Add-VoiceSelector "用户音色" 480 90

    $refreshVoiceBtn = New-Object System.Windows.Forms.Button
    $refreshVoiceBtn.Text = "刷新音色"
    $refreshVoiceBtn.Location = New-Object System.Drawing.Point(20, 130)
    $refreshVoiceBtn.Size = New-Object System.Drawing.Size(110, 34)
    Set-FlatButtonStyle $refreshVoiceBtn "Secondary"
    $refreshVoiceBtn.Add_Click({ Refresh-Voices })
    $voiceCard.Controls.Add($refreshVoiceBtn)

    $testVoiceBtn = New-Object System.Windows.Forms.Button
    $testVoiceBtn.Text = "开始测试"
    $testVoiceBtn.Location = New-Object System.Drawing.Point(145, 130)
    $testVoiceBtn.Size = New-Object System.Drawing.Size(110, 34)
    Set-FlatButtonStyle $testVoiceBtn "Primary"
    $testVoiceBtn.Add_Click({ Start-MultiVoiceTest })
    $voiceCard.Controls.Add($testVoiceBtn)

    $Script:TestTextBox = New-Object System.Windows.Forms.TextBox
    $Script:TestTextBox.Multiline = $true
    $Script:TestTextBox.Dock = "Fill"
    $Script:TestTextBox.ScrollBars = "Vertical"
    $Script:TestTextBox.BackColor = [System.Drawing.Color]::FromArgb(30, 41, 59)
    $Script:TestTextBox.ForeColor = [System.Drawing.Color]::White
    $Script:TestTextBox.BorderStyle = "None"
    $Script:TestTextBox.Font = New-Object System.Drawing.Font("Consolas", 10)
    $Script:TestTextBox.Text = "夜色压下来，街边的灯一盏盏亮起。`n`"你终于来了。`"`n我低声回答：`"开始测试吧。`""
    $tabVoice.Controls.Add($Script:TestTextBox)

    # Tab 3: 日志
    $tabLog = New-Object System.Windows.Forms.TabPage
    $tabLog.Text = "  运行日志  "
    $tabLog.BackColor = [System.Drawing.Color]::FromArgb(15, 23, 42)
    $tabs.TabPages.Add($tabLog)

    $Script:LogBox = New-Object System.Windows.Forms.RichTextBox
    $Script:LogBox.Dock = "Fill"
    $Script:LogBox.ReadOnly = $true
    $Script:LogBox.BackColor = [System.Drawing.Color]::FromArgb(30, 41, 59)
    $Script:LogBox.ForeColor = [System.Drawing.Color]::FromArgb(226, 232, 240)
    $Script:LogBox.Font = New-Object System.Drawing.Font("Consolas", 9.5)
    $Script:LogBox.BorderStyle = "None"
    $tabLog.Controls.Add($Script:LogBox)

    # 初始化
    $form.Add_Shown({
        if (-not $Script:FirstCheckDone) {
            $Script:FirstCheckDone = $true
            Run-EnvironmentCheck
        }
    })

    $form.Add_FormClosing({
        if ($Script:ApiStartedByLauncher) {
            Stop-LeonService -FromLauncherClose
        }
    })

    $form.Add_FormClosed({
        if ($Script:PreviewBannerImage) {
            $Script:PreviewBannerImage.Dispose()
        }
        if ($Script:LauncherIcon) {
            $Script:LauncherIcon.Dispose()
        }
        if ($Script:LauncherMutex) {
            if ($Script:LauncherMutexOwned) {
                try { $Script:LauncherMutex.ReleaseMutex() } catch {}
            }
            $Script:LauncherMutex.Dispose()
        }
    })

    return $form
}

# 补充必要的核心函数（环境检测、服务启动等）
# 这里需要复制原脚本中的 Run-EnvironmentCheck、Start-LeonService 等函数
