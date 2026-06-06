# LEON Launcher - Beautiful Modern Edition
# Improved UI with flat design, responsive cards, and clean dark theme

$ErrorActionPreference = "Continue"
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
[System.Windows.Forms.Application]::EnableVisualStyles()

$Script:LauncherDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$Script:RepoRoot = (Resolve-Path (Join-Path $Script:LauncherDir "..\..")).Path
$Script:ApiPort = 9880
$Script:StartupBat = Join-Path $Script:RepoRoot "go-API-VLLM-NoQwen.bat"
$Script:RuntimePython = Join-Path $Script:RepoRoot "indextts2runtime\python.exe"
$Script:BannerPath = Join-Path $Script:LauncherDir "leon-banner-hq.png"

# --- Theme Colors ---
$ThemeBg = [System.Drawing.Color]::FromArgb(18, 18, 18)
$ThemePanel = [System.Drawing.Color]::FromArgb(28, 28, 28)
$ThemeCard = [System.Drawing.Color]::FromArgb(36, 36, 36)
$ThemeText = [System.Drawing.Color]::White
$ThemeMuted = [System.Drawing.Color]::FromArgb(160, 160, 160)
$ThemePrimary = [System.Drawing.Color]::FromArgb(0, 120, 212)
$ThemeSuccess = [System.Drawing.Color]::FromArgb(16, 124, 16)
$ThemeDanger = [System.Drawing.Color]::FromArgb(196, 43, 28)

function New-StyledButton {
    param([string]$Text, [int]$Width = 140, [int]$Height = 42, [System.Drawing.Color]$BackColor)
    $btn = New-Object System.Windows.Forms.Button
    $btn.Text = $Text
    $btn.Size = New-Object System.Drawing.Size($Width, $Height)
    $btn.FlatStyle = "Flat"
    $btn.Font = New-Object System.Drawing.Font("Segoe UI", 10, [System.Drawing.FontStyle]::Bold)
    $btn.Cursor = "Hand"
    $btn.FlatAppearance.BorderSize = 0
    $btn.BackColor = $BackColor
    $btn.ForeColor = [System.Drawing.Color]::White
    $btn.Margin = New-Object System.Windows.Forms.Padding(0, 0, 12, 0)

    # Hover effect
    $hoverColor = [System.Drawing.Color]::FromArgb(
        [math]::Min(255, $BackColor.R + 25),
        [math]::Min(255, $BackColor.G + 25),
        [math]::Min(255, $BackColor.B + 25)
    )
    
    $btn.Add_MouseEnter({ $this.BackColor = $hoverColor })
    $btn.Add_MouseLeave({ $this.BackColor = $BackColor })

    return $btn
}

# Main Form
$form = New-Object System.Windows.Forms.Form
$form.Text = "LEON Launcher - IndexTTS2"
$form.Size = New-Object System.Drawing.Size(1000, 750)
$form.StartPosition = "CenterScreen"
$form.BackColor = $ThemeBg
$form.Font = New-Object System.Drawing.Font("Segoe UI", 9)
try { $form.Icon = [System.Drawing.Icon]::ExtractAssociatedIcon($PSCommandPath) } catch {}

# 4. Log Panel (Added first to Fill)
$logPanel = New-Object System.Windows.Forms.Panel
$logPanel.Dock = "Fill"
$logPanel.Padding = New-Object System.Windows.Forms.Padding(25)
$form.Controls.Add($logPanel)

$lblLog = New-Object System.Windows.Forms.Label
$lblLog.Text = "CONSOLE OUTPUT"
$lblLog.Font = New-Object System.Drawing.Font("Segoe UI", 9, [System.Drawing.FontStyle]::Bold)
$lblLog.ForeColor = $ThemeMuted
$lblLog.AutoSize = $true
$lblLog.Location = New-Object System.Drawing.Point(25, 20)
$logPanel.Controls.Add($lblLog)

$Script:LogBox = New-Object System.Windows.Forms.RichTextBox
$Script:LogBox.Location = New-Object System.Drawing.Point(25, 45)
$Script:LogBox.Anchor = "Top,Left,Right,Bottom"
$Script:LogBox.BackColor = $ThemePanel
$Script:LogBox.ForeColor = [System.Drawing.Color]::FromArgb(210, 210, 210)
$Script:LogBox.Font = New-Object System.Drawing.Font("Consolas", 10)
$Script:LogBox.BorderStyle = "None"
$Script:LogBox.ReadOnly = $true
$Script:LogBox.Text = "[$(Get-Date -Format 'HH:mm:ss')] LEON Launcher Ready`n"
$logPanel.Controls.Add($Script:LogBox)

# Force LogBox size
$form.Add_Load({
    $Script:LogBox.Size = New-Object System.Drawing.Size($logPanel.Width - 50, $logPanel.Height - 70)
})
$logPanel.Add_Resize({
    if ($Script:LogBox) {
        $Script:LogBox.Size = New-Object System.Drawing.Size($logPanel.Width - 50, $logPanel.Height - 70)
    }
})

# 3. Status Cards
$cardContainer = New-Object System.Windows.Forms.TableLayoutPanel
$cardContainer.Dock = "Top"
$cardContainer.Height = 110
$cardContainer.ColumnCount = 3
$cardContainer.RowCount = 1
$cardContainer.Padding = New-Object System.Windows.Forms.Padding(20, 0, 20, 10)
for($i=0; $i -lt 3; $i++) {
    $cardContainer.ColumnStyles.Add((New-Object System.Windows.Forms.ColumnStyle("Percent", 33.33))) | Out-Null
}
$form.Controls.Add($cardContainer)

function Add-Card {
    param([string]$Title, [string]$Value, [ref]$LabelRef, [int]$Col)
    $p = New-Object System.Windows.Forms.Panel
    $p.Dock = "Fill"
    $p.Margin = New-Object System.Windows.Forms.Padding(5)
    $p.BackColor = $ThemeCard
    
    $lblT = New-Object System.Windows.Forms.Label
    $lblT.Text = $Title.ToUpper()
    $lblT.Font = New-Object System.Drawing.Font("Segoe UI", 9, [System.Drawing.FontStyle]::Bold)
    $lblT.ForeColor = $ThemeMuted
    $lblT.Location = New-Object System.Drawing.Point(15, 15)
    $lblT.AutoSize = $true
    $p.Controls.Add($lblT)
    
    $lblV = New-Object System.Windows.Forms.Label
    $lblV.Text = $Value
    $lblV.Font = New-Object System.Drawing.Font("Segoe UI", 16, [System.Drawing.FontStyle]::Bold)
    $lblV.ForeColor = $ThemeText
    $lblV.Location = New-Object System.Drawing.Point(15, 42)
    $lblV.AutoSize = $true
    $LabelRef.Value = $lblV
    $p.Controls.Add($lblV)
    
    $cardContainer.Controls.Add($p, $Col, 0)
}

$Script:StatusLabel = $null
$Script:PythonLabel = $null
$lblVoicesRef = $null
Add-Card -Title "API Status" -Value "OFFLINE" -LabelRef ([ref]$Script:StatusLabel) -Col 0
Add-Card -Title "Python Runtime" -Value "Checking..." -LabelRef ([ref]$Script:PythonLabel) -Col 1
Add-Card -Title "Voice Library" -Value "--" -LabelRef ([ref]$lblVoicesRef) -Col 2


# 2. Toolbar
$toolbar = New-Object System.Windows.Forms.FlowLayoutPanel
$toolbar.Dock = "Top"
$toolbar.Height = 70
$toolbar.Padding = New-Object System.Windows.Forms.Padding(25, 12, 25, 12)
$toolbar.FlowDirection = "LeftToRight"
$form.Controls.Add($toolbar)

$btnStart = New-StyledButton -Text "▶ START SERVICE" -BackColor $ThemeSuccess -Width 160
$btnStart.Add_Click({
    if (Test-Path $Script:StartupBat) {
        Start-Process -FilePath "cmd.exe" -ArgumentList @("/c", "`"$Script:StartupBat`"") -WorkingDirectory $Script:RepoRoot -WindowStyle Hidden
        $Script:LogBox.AppendText("[$(Get-Date -Format 'HH:mm:ss')] Service started`n")
        $Script:StatusLabel.Text = "RUNNING"
        $Script:StatusLabel.ForeColor = $ThemeSuccess
    } else {
        $Script:LogBox.AppendText("[$(Get-Date -Format 'HH:mm:ss')] ERROR: $Script:StartupBat not found`n")
    }
})
$toolbar.Controls.Add($btnStart)

$btnStop = New-StyledButton -Text "■ STOP" -BackColor $ThemeDanger -Width 100
$btnStop.Add_Click({
    $Script:LogBox.AppendText("[$(Get-Date -Format 'HH:mm:ss')] Stopping service...`n")
    netstat -ano -p tcp | Select-String "LISTENING" | ForEach-Object {
        $parts = $_.ToString().Trim() -split "\s+"
        if ($parts.Length -ge 5 -and $parts[1] -match (":$Script:ApiPort$")) {
            taskkill /PID ([int]$parts[-1]) /T /F 2>&1 | Out-Null
        }
    }
    $Script:StatusLabel.Text = "OFFLINE"
    $Script:StatusLabel.ForeColor = $ThemeText
    $Script:LogBox.AppendText("[$(Get-Date -Format 'HH:mm:ss')] Service stopped`n")
})
$toolbar.Controls.Add($btnStop)

$btnCheck = New-StyledButton -Text "⟳ CHECK ENV" -BackColor $ThemePrimary -Width 140
$btnCheck.Add_Click({
    $Script:LogBox.AppendText("[$(Get-Date -Format 'HH:mm:ss')] Checking environment...`n")
    if (Test-Path $Script:RuntimePython) { 
        $Script:PythonLabel.Text = "INSTALLED" 
        $Script:PythonLabel.ForeColor = $ThemeSuccess
        $Script:LogBox.AppendText("[$(Get-Date -Format 'HH:mm:ss')] Python Runtime: FOUND`n")
    } else { 
        $Script:PythonLabel.Text = "NOT FOUND" 
        $Script:PythonLabel.ForeColor = $ThemeDanger
        $Script:LogBox.AppendText("[$(Get-Date -Format 'HH:mm:ss')] Python Runtime: MISSING`n")
    }
})
$toolbar.Controls.Add($btnCheck)

# 1. Banner
$banner = New-Object System.Windows.Forms.PictureBox
$banner.Dock = "Top"
$banner.Height = 160
$banner.SizeMode = "Zoom"
$banner.BackColor = $ThemeBg
$banner.Margin = New-Object System.Windows.Forms.Padding(0)
if (Test-Path $Script:BannerPath) {
    try { $banner.Image = [System.Drawing.Image]::FromFile($Script:BannerPath) } catch {}
}
$form.Controls.Add($banner)

# Run Application
[void][System.Windows.Forms.Application]::Run($form)
