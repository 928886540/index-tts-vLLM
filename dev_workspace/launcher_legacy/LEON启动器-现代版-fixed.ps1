# LEON 启动器 - 现代版本
# 卡片式布局，无侧边栏，顶部操作栏

$ErrorActionPreference = "Continue"

Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
[System.Windows.Forms.Application]::EnableVisualStyles()

# 全局变量初始化
$Script:LauncherDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$Script:RepoRoot = (Resolve-Path (Join-Path $Script:LauncherDir "..\..")).Path
$Script:ApiPort = 9880
$Script:ApiBase = "http://127.0.0.1:$Script:ApiPort"
$Script:StartupBat = Join-Path $Script:RepoRoot "go-API-VLLM-NoQwen.bat"
$Script:RuntimePython = Join-Path $Script:RepoRoot "indextts2runtime\python.exe"
$Script:RuntimeScripts = Join-Path $Script:RepoRoot "indextts2runtime\Scripts"
$Script:LogDir = Join-Path $Script:LauncherDir "logs"
$Script:BannerPath = Join-Path $Script:LauncherDir "leon-banner-modern.png"
$Script:IconPath = Join-Path $Script:LauncherDir "leon-launcher.ico"
$Script:SvmlSource = Join-Path $Script:RepoRoot "Leon_api\LLVM ERROR报错解决\svml_dispmd.dll"
$Script:ApiStartedByLauncher = $false
$Script:ApiLauncherProcess = $null
$Script:CheckList = $null
$Script:LogBox = $null
$Script:StatusLabel = $null
$Script:VoiceDefaultBox = $null
$Script:VoiceNarratorBox = $null
$Script:VoiceDialogueBox = $null
$Script:VoiceUserBox = $null
$Script:TestTextBox = $null

# 工具函数
function New-Font {
    param([float]$Size, [System.Drawing.FontStyle]$Style = [System.Drawing.FontStyle]::Regular)
    return New-Object System.Drawing.Font("Segoe UI", $Size, $Style)
}

function Set-DoubleBuffered {
    param([System.Windows.Forms.Control]$Control)
    if (-not $Control) { return }
    try {
        $prop = $Control.GetType().GetProperty("DoubleBuffered", [System.Reflection.BindingFlags]"Instance, NonPublic")
        if ($prop) { $prop.SetValue($Control, $true, $null) }
    } catch {}
}

function New-ModernButton {
    param(
        [string]$Text,
        [string]$Variant = "Primary",
        [int]$Width = 120,
        [int]$Height = 40
    )

    $btn = New-Object System.Windows.Forms.Button
    $btn.Text = $Text
    $btn.Size = New-Object System.Drawing.Size($Width, $Height)
    $btn.FlatStyle = [System.Windows.Forms.FlatStyle]::Flat
    $btn.Font = New-Font 10
    $btn.Cursor = [System.Windows.Forms.Cursors]::Hand
    $btn.FlatAppearance.BorderSize = 0

    switch ($Variant) {
        "Primary" {
            $btn.BackColor = [System.Drawing.Color]::FromArgb(16, 185, 129)
            $btn.ForeColor = [System.Drawing.Color]::White
            $btn.FlatAppearance.MouseOverBackColor = [System.Drawing.Color]::FromArgb(20, 205, 145)
        }
        "Secondary" {
            $btn.BackColor = [System.Drawing.Color]::FromArgb(51, 65, 85)
            $btn.ForeColor = [System.Drawing.Color]::White
            $btn.FlatAppearance.MouseOverBackColor = [System.Drawing.Color]::FromArgb(71, 85, 105)
        }
        "Danger" {
            $btn.BackColor = [System.Drawing.Color]::FromArgb(239, 68, 68)
            $btn.ForeColor = [System.Drawing.Color]::White
            $btn.FlatAppearance.MouseOverBackColor = [System.Drawing.Color]::FromArgb(248, 113, 113)
        }
    }

    return $btn
}

function New-Card {
    param(
        [int]$Width = 560,
        [int]$Height = 200
    )

    $card = New-Object System.Windows.Forms.Panel
    $card.Size = New-Object System.Drawing.Size($Width, $Height)
    $card.BackColor = [System.Drawing.Color]::FromArgb(30, 41, 59)
    $card.Padding = New-Object System.Windows.Forms.Padding(20)
    Set-DoubleBuffered $card
    return $card
}

function Add-Log {
    param([string]$Message)
    $line = "[{0}] {1}" -f (Get-Date -Format "HH:mm:ss"), $Message
    if ($Script:LogBox) {
        $Script:LogBox.AppendText($line + [Environment]::NewLine)
        $Script:LogBox.SelectionStart = $Script:LogBox.TextLength
        $Script:LogBox.ScrollToCaret()
    }
    New-Item -ItemType Directory -Force -Path $Script:LogDir -ErrorAction SilentlyContinue | Out-Null
    $logFile = Join-Path $Script:LogDir ("launcher-" + (Get-Date -Format "yyyyMMdd") + ".log")
    Add-Content -LiteralPath $logFile -Value $line -Encoding UTF8 -ErrorAction SilentlyContinue
}

function Set-StatusText {
    param([string]$Message, [string]$Color = "LightGray")
    if ($Script:StatusLabel) {
        $Script:StatusLabel.Text = $Message
        $Script:StatusLabel.ForeColor = [System.Drawing.Color]::$Color
    }
}

function Test-ApiHealth {
    try {
        $resp = Invoke-RestMethod -Uri "$Script:ApiBase/health" -TimeoutSec 2
        return $resp
    } catch {
        return $null
    }
}

function Get-ListeningPidsForPort {
    param([int]$Port)
    $pids = @()
    try {
        netstat -ano -p tcp | Select-String "LISTENING" | ForEach-Object {
            $parts = $_.ToString().Trim() -split "\s+"
            if ($parts.Length -ge 5 -and $parts[1] -match (":$Port$")) {
                $pids += [int]$parts[-1]
            }
        }
    } catch {}
    return $pids | Sort-Object -Unique
}

function Start-LeonService {
    if (-not (Test-Path $Script:StartupBat)) {
        Add-Log "缺少启动脚本: $Script:StartupBat"
        [System.Windows.Forms.MessageBox]::Show("找不到启动脚本", "错误", "OK", "Error")
        return
    }

    Add-Log "启动 LEON 服务..."
    Set-StatusText "正在启动服务..." "Yellow"

    try {
        $Script:ApiLauncherProcess = Start-Process -FilePath "cmd.exe" -ArgumentList @("/c", "`"$Script:StartupBat`"") -WorkingDirectory $Script:RepoRoot -WindowStyle Hidden -PassThru
        $Script:ApiStartedByLauncher = $true

        # 等待服务启动
        $timer = New-Object System.Windows.Forms.Timer
        $timer.Interval = 3000
        $start = Get-Date
        $timer.Add_Tick({
            $health = Test-ApiHealth
            if ($health) {
                $timer.Stop()
                $timer.Dispose()
                Set-StatusText "✓ 服务运行中 - $Script:ApiBase" "LightGreen"
                Add-Log "API 已启动"
                return
            }
            $elapsed = [int]((Get-Date) - $start).TotalSeconds
            Set-StatusText "启动中... ${elapsed}s" "Yellow"
            if ($elapsed -gt 180) {
                $timer.Stop()
                $timer.Dispose()
                Set-StatusText "启动超时，请查看日志" "Red"
                Add-Log "API 启动超时"
            }
        })
        $timer.Start()
    }
    catch {
        Set-StatusText "启动失败" "Red"
        Add-Log "启动失败: $($_.Exception.Message)"
    }
}

function Stop-LeonService {
    $pids = @(Get-ListeningPidsForPort -Port $Script:ApiPort)
    if ($pids.Count -eq 0) {
        Add-Log "没有发现运行中的服务"
        return
    }

    foreach ($pid in $pids) {
        try {
            taskkill /PID $pid /T /F 2>&1 | Out-Null
            Add-Log "已停止进程 PID $pid"
        } catch {
            Add-Log "停止进程失败: $($_.Exception.Message)"
        }
    }

    $Script:ApiStartedByLauncher = $false
    Set-StatusText "服务已停止" "LightGray"
    Add-Log "服务已停止"
}

function Run-EnvironmentCheck {
    if (-not $Script:CheckList) { return }

    $Script:CheckList.Items.Clear()
    Set-StatusText "正在检测环境..." "Yellow"
    Add-Log "开始环境检测"

    # 检测项目路径
    $hasC hinese = [regex]::IsMatch($Script:RepoRoot, "[一-鿿]")
    $item = New-Object System.Windows.Forms.ListViewItem("项目路径")
    [void]$item.SubItems.Add($(if ($hasChinese) { "警告" } else { "通过" }))
    [void]$item.SubItems.Add($(if ($hasChinese) { "路径包含中文" } else { "路径正常" }))
    $item.ForeColor = $(if ($hasChinese) { [System.Drawing.Color]::Orange } else { [System.Drawing.Color]::LightGreen })
    [void]$Script:CheckList.Items.Add($item)

    # 检测 Python Runtime
    $pyExists = Test-Path $Script:RuntimePython
    $item = New-Object System.Windows.Forms.ListViewItem("Python Runtime")
    [void]$item.SubItems.Add($(if ($pyExists) { "通过" } else { "失败" }))
    [void]$item.SubItems.Add($(if ($pyExists) { "找到 Python" } else { "缺少 indextts2runtime" }))
    $item.ForeColor = $(if ($pyExists) { [System.Drawing.Color]::LightGreen } else { [System.Drawing.Color]::Red })
    [void]$Script:CheckList.Items.Add($item)

    # 检测端口
    $pids = @(Get-ListeningPidsForPort -Port $Script:ApiPort)
    $health = Test-ApiHealth
    $item = New-Object System.Windows.Forms.ListViewItem("API 端口")
    if ($health) {
        [void]$item.SubItems.Add("运行中")
        [void]$item.SubItems.Add("服务已启动")
        $item.ForeColor = [System.Drawing.Color]::LightGreen
    }
    elseif ($pids.Count -gt 0) {
        [void]$item.SubItems.Add("占用")
        [void]$item.SubItems.Add("端口被占用 PID: $($pids -join ',')")
        $item.ForeColor = [System.Drawing.Color]::Orange
    }
    else {
        [void]$item.SubItems.Add("空闲")
        [void]$item.SubItems.Add("端口可用")
        $item.ForeColor = [System.Drawing.Color]::LightGreen
    }
    [void]$Script:CheckList.Items.Add($item)

    Set-StatusText "环境检测完成" "LightGreen"
    Add-Log "环境检测完成"
}

function Refresh-Voices {
    try {
        $resp = Invoke-RestMethod -Uri "$Script:ApiBase/voices" -TimeoutSec 10
        $names = @($resp.voices | ForEach-Object { $_.name })

        foreach ($cb in @($Script:VoiceDefaultBox, $Script:VoiceNarratorBox, $Script:VoiceDialogueBox, $Script:VoiceUserBox)) {
            if ($cb) {
                $old = $cb.Text
                $cb.Items.Clear()
                foreach ($name in $names) { [void]$cb.Items.Add($name) }
                if ($old -and $names -contains $old) { $cb.Text = $old }
                elseif ($names.Count -gt 0) { $cb.SelectedIndex = 0 }
            }
        }

        Add-Log "音色已刷新"
    }
    catch {
        Add-Log "刷新音色失败: $($_.Exception.Message)"
    }
}

function Start-VoiceTest {
    $text = $Script:TestTextBox.Text
    if ([string]::IsNullOrWhiteSpace($text)) {
        [System.Windows.Forms.MessageBox]::Show("请输入测试文本", "提示", "OK", "Warning")
        return
    }

    Add-Log "开始音色测试..."
    Set-StatusText "正在生成音频..." "Yellow"

    $body = @{
        text = $text
        parse_mode = "normal"
        voices = @{
            default = $Script:VoiceDefaultBox.Text
            "旁白" = $Script:VoiceNarratorBox.Text
            "对白" = $Script:VoiceDialogueBox.Text
            "用户" = $Script:VoiceUserBox.Text
        }
    } | ConvertTo-Json -Depth 8

    try {
        $resp = Invoke-RestMethod -Uri "$Script:ApiBase/tts_dialogue_stream_job" -Method Post -ContentType "application/json; charset=utf-8" -Body $body -TimeoutSec 20
        Add-Log "测试任务已创建: $($resp.cache_key)"
        Set-StatusText "测试任务已创建" "LightGreen"
    }
    catch {
        Add-Log "测试失败: $($_.Exception.Message)"
        Set-StatusText "测试失败" "Red"
    }
}

# 构建主窗体
function Build-MainForm {
    $form = New-Object System.Windows.Forms.Form
    $form.Text = "LEON - IndexTTS2 启动器"
    $form.Size = New-Object System.Drawing.Size(1200, 800)
    $form.StartPosition = "CenterScreen"
    $form.BackColor = [System.Drawing.Color]::FromArgb(15, 23, 42)
    $form.Font = New-Font 9
    Set-DoubleBuffered $form

    if (Test-Path $Script:IconPath) {
        try {
            $form.Icon = New-Object System.Drawing.Icon($Script:IconPath)
        } catch {}
    }

    # 顶部横幅
    $banner = New-Object System.Windows.Forms.PictureBox
    $banner.Dock = "Top"
    $banner.Height = 160
    $banner.SizeMode = "StretchImage"
    if (Test-Path $Script:BannerPath) {
        try {
            $banner.Image = [System.Drawing.Image]::FromFile($Script:BannerPath)
        } catch {
            $banner.BackColor = [System.Drawing.Color]::FromArgb(30, 41, 59)
        }
    }
    $form.Controls.Add($banner)

    # 主容器（可滚动）
    $mainPanel = New-Object System.Windows.Forms.Panel
    $mainPanel.Dock = "Fill"
    $mainPanel.AutoScroll = $true
    $mainPanel.BackColor = [System.Drawing.Color]::FromArgb(15, 23, 42)
    $mainPanel.Padding = New-Object System.Windows.Forms.Padding(30, 20, 30, 20)
    Set-DoubleBuffered $mainPanel
    $form.Controls.Add($mainPanel)

    $yPos = 0

    # 卡片1：服务控制
    $serviceCard = New-Card -Width 1100 -Height 140
    $serviceCard.Location = New-Object System.Drawing.Point(0, $yPos)
    $mainPanel.Controls.Add($serviceCard)

    $serviceTitle = New-Object System.Windows.Forms.Label
    $serviceTitle.Text = "服务控制"
    $serviceTitle.Font = New-Font 14 ([System.Drawing.FontStyle]::Bold)
    $serviceTitle.ForeColor = [System.Drawing.Color]::White
    $serviceTitle.Location = New-Object System.Drawing.Point(0, 0)
    $serviceTitle.AutoSize = $true
    $serviceCard.Controls.Add($serviceTitle)

    $Script:StatusLabel = New-Object System.Windows.Forms.Label
    $Script:StatusLabel.Text = "就绪 - 点击启动服务"
    $Script:StatusLabel.Font = New-Font 10
    $Script:StatusLabel.ForeColor = [System.Drawing.Color]::LightGray
    $Script:StatusLabel.Location = New-Object System.Drawing.Point(0, 35)
    $Script:StatusLabel.Size = New-Object System.Drawing.Size(700, 24)
    $serviceCard.Controls.Add($Script:StatusLabel)

    $startBtn = New-ModernButton -Text "启动服务" -Variant "Primary" -Width 140 -Height 50
    $startBtn.Location = New-Object System.Drawing.Point(0, 70)
    $startBtn.Font = New-Font 11 ([System.Drawing.FontStyle]::Bold)
    $startBtn.Add_Click({ Start-LeonService })
    $serviceCard.Controls.Add($startBtn)

    $stopBtn = New-ModernButton -Text "停止服务" -Variant "Danger" -Width 140 -Height 50
    $stopBtn.Location = New-Object System.Drawing.Point(160, 70)
    $stopBtn.Add_Click({ Stop-LeonService })
    $serviceCard.Controls.Add($stopBtn)

    $checkBtn = New-ModernButton -Text "环境检测" -Variant "Secondary" -Width 140 -Height 50
    $checkBtn.Location = New-Object System.Drawing.Point(320, 70)
    $checkBtn.Add_Click({ Run-EnvironmentCheck })
    $serviceCard.Controls.Add($checkBtn)

    $yPos += 160

    # 卡片2：环境检测结果
    $envCard = New-Card -Width 1100 -Height 280
    $envCard.Location = New-Object System.Drawing.Point(0, $yPos)
    $mainPanel.Controls.Add($envCard)

    $envTitle = New-Object System.Windows.Forms.Label
    $envTitle.Text = "环境状态"
    $envTitle.Font = New-Font 14 ([System.Drawing.FontStyle]::Bold)
    $envTitle.ForeColor = [System.Drawing.Color]::White
    $envTitle.Location = New-Object System.Drawing.Point(0, 0)
    $envTitle.AutoSize = $true
    $envCard.Controls.Add($envTitle)

    $Script:CheckList = New-Object System.Windows.Forms.ListView
    $Script:CheckList.Location = New-Object System.Drawing.Point(0, 40)
    $Script:CheckList.Size = New-Object System.Drawing.Size(1060, 220)
    $Script:CheckList.View = "Details"
    $Script:CheckList.FullRowSelect = $true
    $Script:CheckList.GridLines = $true
    $Script:CheckList.BorderStyle = [System.Windows.Forms.BorderStyle]::None
    $Script:CheckList.BackColor = [System.Drawing.Color]::FromArgb(51, 65, 85)
    $Script:CheckList.ForeColor = [System.Drawing.Color]::White
    $Script:CheckList.Font = New-Font 10
    Set-DoubleBuffered $Script:CheckList
    [void]$Script:CheckList.Columns.Add("检查项", 200)
    [void]$Script:CheckList.Columns.Add("状态", 100)
    [void]$Script:CheckList.Columns.Add("详情", 750)
    $envCard.Controls.Add($Script:CheckList)

    $yPos += 300

    # 卡片3：音色测试
    $voiceCard = New-Card -Width 540 -Height 360
    $voiceCard.Location = New-Object System.Drawing.Point(0, $yPos)
    $mainPanel.Controls.Add($voiceCard)

    $voiceTitle = New-Object System.Windows.Forms.Label
    $voiceTitle.Text = "音色测试"
    $voiceTitle.Font = New-Font 14 ([System.Drawing.FontStyle]::Bold)
    $voiceTitle.ForeColor = [System.Drawing.Color]::White
    $voiceTitle.Location = New-Object System.Drawing.Point(0, 0)
    $voiceTitle.AutoSize = $true
    $voiceCard.Controls.Add($voiceTitle)

    function Add-VoiceBox($label, $y) {
        $lbl = New-Object System.Windows.Forms.Label
        $lbl.Text = $label
        $lbl.ForeColor = [System.Drawing.Color]::LightGray
        $lbl.Location = New-Object System.Drawing.Point(0, $y)
        $lbl.Size = New-Object System.Drawing.Size(80, 24)
        $voiceCard.Controls.Add($lbl)

        $cb = New-Object System.Windows.Forms.ComboBox
        $cb.Location = New-Object System.Drawing.Point(90, $y)
        $cb.Size = New-Object System.Drawing.Size(400, 28)
        $cb.BackColor = [System.Drawing.Color]::FromArgb(51, 65, 85)
        $cb.ForeColor = [System.Drawing.Color]::White
        $cb.FlatStyle = "Flat"
        $voiceCard.Controls.Add($cb)
        return $cb
    }

    $Script:VoiceDefaultBox = Add-VoiceBox "默认音色" 40
    $Script:VoiceNarratorBox = Add-VoiceBox "旁白音色" 80
    $Script:VoiceDialogueBox = Add-VoiceBox "对白音色" 120
    $Script:VoiceUserBox = Add-VoiceBox "用户音色" 160

    $refreshVoiceBtn = New-ModernButton -Text "刷新音色" -Variant "Secondary" -Width 110 -Height 36
    $refreshVoiceBtn.Location = New-Object System.Drawing.Point(0, 210)
    $refreshVoiceBtn.Add_Click({ Refresh-Voices })
    $voiceCard.Controls.Add($refreshVoiceBtn)

    $testVoiceBtn = New-ModernButton -Text "开始测试" -Variant "Primary" -Width 110 -Height 36
    $testVoiceBtn.Location = New-Object System.Drawing.Point(130, 210)
    $testVoiceBtn.Add_Click({ Start-VoiceTest })
    $voiceCard.Controls.Add($testVoiceBtn)

    $Script:TestTextBox = New-Object System.Windows.Forms.TextBox
    $Script:TestTextBox.Multiline = $true
    $Script:TestTextBox.Location = New-Object System.Drawing.Point(0, 260)
    $Script:TestTextBox.Size = New-Object System.Drawing.Size(500, 80)
    $Script:TestTextBox.BackColor = [System.Drawing.Color]::FromArgb(51, 65, 85)
    $Script:TestTextBox.ForeColor = [System.Drawing.Color]::White
    $Script:TestTextBox.BorderStyle = "None"
    $Script:TestTextBox.Font = New-Object System.Drawing.Font("Consolas", 10)
    $Script:TestTextBox.Text = "夜色压下来，街边的灯一盏盏亮起。`n`"你终于来了。`"`n我低声回答：`"开始测试吧。`""
    $voiceCard.Controls.Add($Script:TestTextBox)

    # 卡片4：日志
    $logCard = New-Card -Width 540 -Height 360
    $logCard.Location = New-Object System.Drawing.Point(560, $yPos)
    $mainPanel.Controls.Add($logCard)

    $logTitle = New-Object System.Windows.Forms.Label
    $logTitle.Text = "运行日志"
    $logTitle.Font = New-Font 14 ([System.Drawing.FontStyle]::Bold)
    $logTitle.ForeColor = [System.Drawing.Color]::White
    $logTitle.Location = New-Object System.Drawing.Point(0, 0)
    $logTitle.AutoSize = $true
    $logCard.Controls.Add($logTitle)

    $Script:LogBox = New-Object System.Windows.Forms.RichTextBox
    $Script:LogBox.Location = New-Object System.Drawing.Point(0, 40)
    $Script:LogBox.Size = New-Object System.Drawing.Size(500, 300)
    $Script:LogBox.ReadOnly = $true
    $Script:LogBox.BackColor = [System.Drawing.Color]::FromArgb(15, 23, 42)
    $Script:LogBox.ForeColor = [System.Drawing.Color]::LightGray
    $Script:LogBox.Font = New-Object System.Drawing.Font("Consolas", 9)
    $Script:LogBox.BorderStyle = "None"
    $logCard.Controls.Add($Script:LogBox)

    # 初始化
    $form.Add_Shown({
        Run-EnvironmentCheck
        Add-Log "LEON 启动器已打开"
    })

    $form.Add_FormClosing({
        if ($Script:ApiStartedByLauncher) {
            Stop-LeonService
        }
    })

    return $form
}

# 主程序
$form = Build-MainForm
[void][System.Windows.Forms.Application]::Run($form)
