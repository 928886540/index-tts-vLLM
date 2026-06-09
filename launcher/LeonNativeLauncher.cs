using System;
using System.Collections;
using System.Collections.Generic;
using System.Diagnostics;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.IO;
using System.Management;
using System.Net;
using System.Net.NetworkInformation;
using System.Net.Sockets;
using System.Runtime.InteropServices;
using System.Security.Principal;
using System.Text;
using System.Text.RegularExpressions;
using System.Threading;
using System.Threading.Tasks;
using System.Web.Script.Serialization;
using System.Windows.Forms;

internal static class LeonNativeLauncherProgram
{
    [STAThread]
    private static int Main()
    {
        Application.EnableVisualStyles();
        Application.SetCompatibleTextRenderingDefault(false);
        NativeMethods.SetAppUserModelId("LEON.IndexTTS2.Launcher");

        using (SingleInstance single = new SingleInstance("Local\\LEON.IndexTTS2.NativeLauncher"))
        {
            if (!IsSmokeTest() && !single.TryAcquire())
            {
                NativeMethods.ShowExistingWindow(LauncherForm.WindowTitle);
                return 0;
            }

            LauncherForm form = new LauncherForm();
            if (IsSmokeTest())
            {
                form.Dispose();
                return 0;
            }

            Application.Run(form);
        }

        return 0;
    }

    private static bool IsSmokeTest()
    {
        return string.Equals(Environment.GetEnvironmentVariable("LEON_LAUNCHER_SMOKE_TEST"), "1", StringComparison.Ordinal);
    }
}

internal sealed class LauncherForm : Form
{
    public const string WindowTitle = "LEON 启动器 - IndexTTS2";

    private const int ApiPort = 9880;
    private const string ApiBase = "http://127.0.0.1:9880";
    private const string TavoCacheBust = "20260609-mp3-cache-v63";
    private const string WarmupVoice = "400个火爆音色/短剧解说";
    private const string WarmupText = "短剧解说启动测试。";

    private readonly string workspaceRoot;
    private readonly string launcherDir;
    private readonly string scriptsDir;
    private readonly string staticDir;
    private readonly string profileDir;
    private readonly string activeProfilePath;
    private readonly string iconPath;
    private readonly string lanHost;
    private readonly object logLock = new object();
    private readonly Dictionary<string, string> logTexts = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
    private readonly Dictionary<string, List<EnvRow>> envRowsByVersion = new Dictionary<string, List<EnvRow>>(StringComparer.OrdinalIgnoreCase);
    private readonly HashSet<string> envCompletedVersions = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
    private readonly JavaScriptSerializer json = new JavaScriptSerializer();

    private string versionKey = "vllm";
    private string envTargetKey = "vllm";
    private string versionRoot;
    private string runtimePython;
    private string startupBat;
    private string logDir;
    private string latestStartupLog;
    private string latestStartupErr;
    private double vllmGpuRatio = 0.15;
    private bool lastHealthRunning;
    private bool serviceTransition;
    private bool logRefreshRunning;
    private bool healthRefreshRunning;
    private bool closeStopStarted;
    private bool forceClose;
    private bool startupSuccessBannerShown;

    private Icon launcherIcon;
    private Panel homePanel;
    private Panel logPanel;
    private Panel envPanel;
    private Panel configPanel;
    private TextBox logBox;
    private DataGridView envGrid;
    private Label statusLabel;
    private Button startButton;
    private Button navHomeButton;
    private Button navLogButton;
    private Button navConfigButton;
    private Button navEnvButton;
    private Button tabLauncherButton;
    private Button tabApiButton;
    private Button tabStderrButton;
    private Button vllmButton;
    private Button fast6gButton;
    private Button envVllmButton;
    private Button envFast6gButton;
    private Button envCheckButton;
    private Button envRepairButton;
    private TextBox ratioBox;
    private ComboBox profileSelectBox;
    private TextBox profileNameBox;
    private TextBox profileFileNameBox;
    private TextBox profileDescriptionBox;
    private Label profilePathHintLabel;
    private ComboBox liveQualityBox;
    private ComboBox generateQualityBox;
    private TextBox liveDiffusionBox;
    private TextBox livePromptSecondsBox;
    private TextBox liveSegmentTokensBox;
    private TextBox liveFirstTokensBox;
    private TextBox liveCfgRateBox;
    private TextBox generateDiffusionBox;
    private TextBox generatePromptSecondsBox;
    private TextBox generateSegmentTokensBox;
    private TextBox generateFirstTokensBox;
    private TextBox generateCfgRateBox;
    private TextBox llmPromptBox;
    private System.Windows.Forms.Timer logTimer;
    private System.Windows.Forms.Timer healthTimer;
    private string activeView = "home";
    private string activeLogTab = "launcher";
    private string selectedProfilePath;
    private bool profileListLoading;
    private bool qualityUiLoading;
    private string liveEditingPreset = "balanced";
    private string generateEditingPreset = "balanced";
    private Dictionary<string, object> currentProfileData;
    private bool envCheckRunning;
    private bool envRepairRunning;

    public LauncherForm()
    {
        workspaceRoot = AppDomain.CurrentDomain.BaseDirectory.TrimEnd(Path.DirectorySeparatorChar, Path.AltDirectorySeparatorChar);
        launcherDir = Path.Combine(workspaceRoot, "launcher");
        scriptsDir = Path.Combine(workspaceRoot, "scripts");
        staticDir = Path.Combine(workspaceRoot, "static");
        profileDir = Path.Combine(workspaceRoot, "config", "profiles");
        activeProfilePath = Path.Combine(profileDir, "active.json");
        iconPath = Path.Combine(launcherDir, "leon-launcher.ico");
        lanHost = string.IsNullOrWhiteSpace(Environment.GetEnvironmentVariable("LEON_LAN_HOST"))
            ? GetPreferredLanHost()
            : Environment.GetEnvironmentVariable("LEON_LAN_HOST");

        logTexts["launcher"] = string.Empty;
        logTexts["api"] = string.Empty;
        logTexts["stderr"] = string.Empty;

        string envVersion = Environment.GetEnvironmentVariable("LEON_LAUNCHER_VERSION");
        if (string.Equals(envVersion, "fast6g", StringComparison.OrdinalIgnoreCase))
        {
            versionKey = "fast6g";
        }
        envTargetKey = versionKey;

        double parsedRatio;
        string envRatio = Environment.GetEnvironmentVariable("INDEXTTS_VLLM_GPU_MEMORY_UTILIZATION");
        if (!string.IsNullOrWhiteSpace(envRatio) &&
            double.TryParse(envRatio, System.Globalization.NumberStyles.Float, System.Globalization.CultureInfo.InvariantCulture, out parsedRatio) &&
            parsedRatio > 0)
        {
            vllmGpuRatio = parsedRatio;
        }

        SetVersion(versionKey, false);
        ClearLauncherSessionLogs();
        BuildUi();
        AddLauncherLog("LEON 启动器已打开。");
    }

    protected override void Dispose(bool disposing)
    {
        if (disposing)
        {
            if (logTimer != null) logTimer.Dispose();
            if (healthTimer != null) healthTimer.Dispose();
            if (launcherIcon != null) launcherIcon.Dispose();
        }
        base.Dispose(disposing);
    }

    private void BuildUi()
    {
        Text = WindowTitle;
        StartPosition = FormStartPosition.CenterScreen;
        Size = new Size(1240, 820);
        MinimumSize = new Size(1120, 720);
        FormBorderStyle = FormBorderStyle.Sizable;
        MaximizeBox = true;
        MinimizeBox = true;
        SizeGripStyle = SizeGripStyle.Show;
        BackColor = Color.FromArgb(11, 15, 20);
        Font = NewFont(9.0f, FontStyle.Regular);
        AutoScaleMode = AutoScaleMode.Dpi;

        if (File.Exists(iconPath))
        {
            try
            {
                launcherIcon = new Icon(iconPath);
                Icon = launcherIcon;
                ShowIcon = true;
            }
            catch (Exception ex)
            {
                AddLauncherLog("加载启动器图标失败: " + ex.Message, "WARN");
            }
        }

        Panel header = new Panel();
        header.Dock = DockStyle.Top;
        header.Height = 132;
        header.BackColor = Color.FromArgb(11, 15, 20);
        Controls.Add(header);

        CachedImagePanel banner = new CachedImagePanel();
        banner.Dock = DockStyle.Fill;
        banner.BackColor = header.BackColor;
        banner.ScaleMode = ImageScaleMode.Cover;
        banner.HorizontalAlign = ImageHorizontalAlign.Center;
        banner.VerticalAlign = ImageVerticalAlign.Center;
        banner.SetImagePath(Path.Combine(launcherDir, "head.png"));
        header.Controls.Add(banner);

        statusLabel = new Label();
        statusLabel.Anchor = AnchorStyles.Top | AnchorStyles.Right;
        statusLabel.BackColor = Color.FromArgb(190, 10, 14, 18);
        statusLabel.ForeColor = Color.Khaki;
        statusLabel.Font = NewFont(9.0f, FontStyle.Bold);
        statusLabel.TextAlign = ContentAlignment.MiddleRight;
        statusLabel.Text = "就绪";
        statusLabel.Visible = false;
        statusLabel.Location = new Point(header.Width - 500, 40);
        statusLabel.Size = new Size(470, 26);
        header.Controls.Add(statusLabel);
        statusLabel.BringToFront();
        header.Resize += delegate
        {
            statusLabel.Location = new Point(Math.Max(20, header.ClientSize.Width - 500), 40);
            statusLabel.Size = new Size(Math.Min(470, Math.Max(120, header.ClientSize.Width - 40)), 26);
        };

        Panel body = new Panel();
        body.Dock = DockStyle.Fill;
        body.BackColor = Color.FromArgb(12, 16, 21);
        Controls.Add(body);
        body.BringToFront();

        Panel side = new Panel();
        side.Dock = DockStyle.Left;
        side.Width = 244;
        side.Padding = new Padding(18);
        side.BackColor = Color.FromArgb(17, 23, 30);
        body.Controls.Add(side);

        CachedImagePanel sideBackground = new CachedImagePanel();
        sideBackground.Dock = DockStyle.Fill;
        sideBackground.BackColor = side.BackColor;
        sideBackground.ScaleMode = ImageScaleMode.Cover;
        sideBackground.HorizontalAlign = ImageHorizontalAlign.Center;
        sideBackground.VerticalAlign = ImageVerticalAlign.Center;
        sideBackground.SetImagePath(Path.Combine(launcherDir, "left.png"));
        side.Controls.Add(sideBackground);
        sideBackground.SendToBack();

        navHomeButton = CreateSideButton("首页", 18, delegate { ShowView("home"); });
        navLogButton = CreateSideButton("日志", 64, delegate { ShowView("log"); });
        navConfigButton = CreateSideButton("调音台", 110, delegate { ShowView("config"); });
        navEnvButton = CreateSideButton("环境检测", 156, delegate { ShowView("env"); });
        side.Controls.Add(navHomeButton);
        side.Controls.Add(navLogButton);
        side.Controls.Add(navConfigButton);
        side.Controls.Add(navEnvButton);

        Panel bottomPanel = new Panel();
        bottomPanel.Dock = DockStyle.Bottom;
        bottomPanel.Height = 132;
        bottomPanel.BackColor = Color.Transparent;
        side.Controls.Add(bottomPanel);

        Panel configRow = new Panel();
        configRow.Location = new Point(0, 0);
        configRow.Size = new Size(208, 34);
        configRow.BackColor = Color.Transparent;
        bottomPanel.Controls.Add(configRow);

        vllmButton = CreateSmallButton("vLLM", 0, 0, 64, delegate { SetVersion("vllm", true); });
        fast6gButton = CreateSmallButton("6G", 64, 0, 64, delegate { SetVersion("fast6g", true); });
        configRow.Controls.Add(vllmButton);
        configRow.Controls.Add(fast6gButton);

        ratioBox = new TextBox();
        ratioBox.Location = new Point(140, 7);
        ratioBox.Size = new Size(64, 22);
        ratioBox.BorderStyle = BorderStyle.None;
        ratioBox.TextAlign = HorizontalAlignment.Center;
        ratioBox.BackColor = Color.FromArgb(25, 33, 42);
        ratioBox.ForeColor = Color.White;
        ratioBox.Font = NewFont(10.0f, FontStyle.Bold);
        ratioBox.Text = GetRatioText();
        ratioBox.Leave += delegate { SyncRatioFromBox(); };
        ratioBox.KeyDown += delegate(object sender, KeyEventArgs e)
        {
            if (e.KeyCode == Keys.Enter)
            {
                SyncRatioFromBox();
                e.SuppressKeyPress = true;
            }
        };
        configRow.Controls.Add(ratioBox);

        startButton = CreateSideButton("启动 LEON 服务", 44, delegate { ToggleServiceAsync(); });
        startButton.Font = NewFont(13.0f, FontStyle.Bold);
        startButton.Size = new Size(208, 68);
        startButton.BackColor = Color.FromArgb(25, 126, 89);
        startButton.FlatAppearance.BorderColor = Color.FromArgb(95, 185, 140);
        bottomPanel.Controls.Add(startButton);

        EventHandler resizeSideLayout = delegate
        {
            int contentWidth = Math.Min(208, Math.Max(120, side.ClientSize.Width - 36));
            int left = Math.Max(0, (side.ClientSize.Width - contentWidth) / 2);

            navHomeButton.Location = new Point(left, 18);
            navHomeButton.Size = new Size(contentWidth, 38);
            navLogButton.Location = new Point(left, 64);
            navLogButton.Size = new Size(contentWidth, 38);
            navConfigButton.Location = new Point(left, 110);
            navConfigButton.Size = new Size(contentWidth, 38);
            navEnvButton.Location = new Point(left, 156);
            navEnvButton.Size = new Size(contentWidth, 38);

            configRow.Location = new Point(Math.Max(0, (bottomPanel.ClientSize.Width - contentWidth) / 2), 0);
            configRow.Size = new Size(contentWidth, 34);
            startButton.Location = new Point(Math.Max(0, (bottomPanel.ClientSize.Width - contentWidth) / 2), 44);
            startButton.Size = new Size(contentWidth, 68);

            sideBackground.SendToBack();
            navHomeButton.BringToFront();
            navLogButton.BringToFront();
            navConfigButton.BringToFront();
            navEnvButton.BringToFront();
            bottomPanel.BringToFront();
        };
        side.Resize += resizeSideLayout;
        bottomPanel.Resize += resizeSideLayout;
        resizeSideLayout(side, EventArgs.Empty);

        Panel content = new Panel();
        content.Dock = DockStyle.Fill;
        content.Padding = new Padding(20, 18, 20, 20);
        content.BackColor = Color.FromArgb(12, 16, 21);
        body.Controls.Add(content);
        content.BringToFront();

        homePanel = new Panel();
        homePanel.Dock = DockStyle.Fill;
        homePanel.BackColor = Color.FromArgb(5, 7, 11);
        content.Controls.Add(homePanel);

        CachedImagePanel homeImage = new CachedImagePanel();
        homeImage.Dock = DockStyle.Fill;
        homeImage.BackColor = homePanel.BackColor;
        homeImage.ScaleMode = ImageScaleMode.Cover;
        homeImage.HorizontalAlign = ImageHorizontalAlign.Center;
        homeImage.VerticalAlign = ImageVerticalAlign.Center;
        homeImage.SetImagePath(Path.Combine(launcherDir, "home.png"));
        homePanel.Controls.Add(homeImage);

        logPanel = BuildLogPanel();
        content.Controls.Add(logPanel);

        configPanel = BuildConfigPanel();
        content.Controls.Add(configPanel);

        envPanel = BuildEnvironmentPanel();
        content.Controls.Add(envPanel);

        FormClosing += OnLauncherClosing;
        Shown += delegate
        {
            ShowView("home");
            SyncVersionUi();
            StartBackgroundTimers();
            RequestHealthRefresh();
            RequestLogRefresh();
        };
    }

    private Panel BuildLogPanel()
    {
        Panel panel = new Panel();
        panel.Dock = DockStyle.Fill;
        panel.BackColor = Color.FromArgb(12, 16, 21);
        panel.Visible = false;

        FlowLayoutPanel tabs = new FlowLayoutPanel();
        tabs.Dock = DockStyle.Top;
        tabs.Height = 50;
        tabs.WrapContents = false;
        tabs.Padding = new Padding(0, 0, 0, 8);
        tabs.BackColor = panel.BackColor;
        panel.Controls.Add(tabs);

        tabLauncherButton = CreateLogTabButton("启动器", "launcher");
        tabApiButton = CreateLogTabButton("服务日志", "api");
        tabStderrButton = CreateLogTabButton("诊断/错误", "stderr");
        tabs.Controls.Add(tabLauncherButton);
        tabs.Controls.Add(tabApiButton);
        tabs.Controls.Add(tabStderrButton);

        logBox = new TextBox();
        logBox.Dock = DockStyle.Fill;
        logBox.BackColor = Color.FromArgb(8, 12, 17);
        logBox.ForeColor = Color.FromArgb(222, 230, 238);
        logBox.Font = NewMonoFont(11.5f);
        logBox.Multiline = true;
        logBox.ReadOnly = true;
        logBox.BorderStyle = BorderStyle.None;
        logBox.ScrollBars = ScrollBars.Vertical;
        logBox.WordWrap = true;
        logBox.ShortcutsEnabled = true;
        logBox.HideSelection = false;
        panel.Controls.Add(logBox);
        logBox.BringToFront();

        SetLogTabActive("launcher");
        return panel;
    }

    private Panel BuildConfigPanel()
    {
        Panel panel = new Panel();
        panel.Dock = DockStyle.Fill;
        panel.BackColor = Color.FromArgb(12, 16, 21);
        panel.Visible = false;

        Panel top = new Panel();
        top.Dock = DockStyle.Top;
        top.Height = 128;
        top.BackColor = panel.BackColor;
        panel.Controls.Add(top);

        AddConfigLabel(top, "Profile", 0, 8, 70);
        profileSelectBox = new ComboBox();
        profileSelectBox.Location = new Point(76, 4);
        profileSelectBox.Size = new Size(300, 32);
        profileSelectBox.DropDownStyle = ComboBoxStyle.DropDownList;
        profileSelectBox.FlatStyle = FlatStyle.Flat;
        profileSelectBox.BackColor = Color.FromArgb(8, 12, 17);
        profileSelectBox.ForeColor = Color.WhiteSmoke;
        profileSelectBox.Font = NewFont(11.0f, FontStyle.Bold);
        profileSelectBox.SelectedIndexChanged += delegate { OnProfileSelectionChanged(); };
        top.Controls.Add(profileSelectBox);

        Button newButton = CreateFlatButton("新建配置", 392, 2, 96, 34, Color.FromArgb(42, 110, 154), delegate { CreateNewProfileFromDefaults(); });
        Button reloadButton = CreateFlatButton("读取配置", 496, 2, 96, 34, Color.FromArgb(48, 68, 88), delegate { LoadProfileIntoConfigUi(); });
        Button refreshButton = CreateFlatButton("刷新列表", 600, 2, 96, 34, Color.FromArgb(48, 68, 88), delegate { RefreshProfileList(true); });
        Button defaultButton = CreateFlatButton("恢复默认", 704, 2, 96, 34, Color.FromArgb(118, 78, 42), delegate { ResetConfigDefaults(); });
        Button saveButton = CreateFlatButton("保存 Profile", 0, 48, 132, 38, Color.FromArgb(25, 126, 89), delegate { SaveSelectedProfileFromUi(); });
        Button applyButton = CreateFlatButton("应用到 Tavo", 142, 48, 132, 38, Color.FromArgb(42, 110, 154), delegate { ApplySelectedProfileFromUi(); });
        Button cloneButton = CreateFlatButton("复制配置", 284, 48, 100, 38, Color.FromArgb(48, 68, 88), delegate { SaveAsNewProfileFromUi(); });
        StyleConfigActionButton(saveButton);
        StyleConfigActionButton(applyButton);
        StyleConfigActionButton(cloneButton);
        StyleConfigActionButton(newButton);
        StyleConfigActionButton(reloadButton);
        StyleConfigActionButton(refreshButton);
        StyleConfigActionButton(defaultButton);
        top.Controls.Add(saveButton);
        top.Controls.Add(applyButton);
        top.Controls.Add(cloneButton);
        top.Controls.Add(newButton);
        top.Controls.Add(reloadButton);
        top.Controls.Add(refreshButton);
        top.Controls.Add(defaultButton);

        Label tip = new Label();
        tip.Text = "这里配置档位参数库；Tavo 只选择档位名，生成时按 active.json 里的同名参数执行。保存写 Profile，应用写 active.json，下一次生成生效。";
        tip.Location = new Point(0, 96);
        tip.Size = new Size(840, 24);
        tip.ForeColor = Color.FromArgb(205, 214, 224);
        tip.BackColor = panel.BackColor;
        tip.Font = NewFont(10.0f, FontStyle.Regular);
        top.Controls.Add(tip);

        Panel scroll = new Panel();
        scroll.Dock = DockStyle.Fill;
        scroll.AutoScroll = true;
        scroll.BackColor = Color.FromArgb(12, 16, 21);
        panel.Controls.Add(scroll);
        scroll.BringToFront();

        scroll.AutoScrollMinSize = new Size(860, 840);

        AddConfigSectionLabel(scroll, "当前 Profile", 0, 2, 840);
        AddConfigLabel(scroll, "名称", 0, 36, 120);
        profileNameBox = CreateConfigTextBox(scroll, 0, 62, 240, 32);
        AddConfigLabel(scroll, "文件名", 260, 36, 120);
        profileFileNameBox = CreateConfigTextBox(scroll, 260, 62, 180, 32);
        AddConfigLabel(scroll, "描述", 460, 36, 120);
        profileDescriptionBox = CreateConfigTextBox(scroll, 460, 62, 360, 32);
        profilePathHintLabel = AddConfigLabel(scroll, "Profile 路径: ", 0, 104, 820);
        profilePathHintLabel.ForeColor = Color.FromArgb(138, 154, 170);

        AddConfigSectionLabel(scroll, "档位参数库", 0, 144, 840);
        AddQualityEditor(scroll, "LIVE 实时播放", 0, 176, true);
        AddQualityEditor(scroll, "DISK 完整生成", 424, 176, false);

        AddConfigSectionLabel(scroll, "LLM 提示词", 0, 476, 840);
        Label llmHint = AddConfigLabel(scroll, "这是 active profile 的完整拆段提示词；保存并应用后，下一次 AI 拆段会使用这里的内容。", 0, 506, 840);
        llmHint.ForeColor = Color.FromArgb(160, 172, 184);
        llmPromptBox = CreateConfigTextBox(scroll, 0, 534, 820, 150);
        llmPromptBox.Multiline = true;
        llmPromptBox.ScrollBars = ScrollBars.Vertical;
        llmPromptBox.AcceptsReturn = true;
        llmPromptBox.AcceptsTab = true;
        llmPromptBox.Anchor = AnchorStyles.Top | AnchorStyles.Left | AnchorStyles.Right;

        Label pathHint = AddConfigLabel(scroll, "Active 快照路径: " + activeProfilePath, 0, 700, 820);
        pathHint.ForeColor = Color.FromArgb(138, 154, 170);

        RefreshProfileList(false);
        return panel;
    }

    private void AddQualityEditor(Panel parent, string title, int x, int top, bool live)
    {
        Panel box = new Panel();
        box.Location = new Point(x, top);
        box.Size = new Size(404, 290);
        box.Anchor = AnchorStyles.Top | AnchorStyles.Left;
        box.BackColor = Color.FromArgb(16, 21, 27);
        parent.Controls.Add(box);

        AddConfigSectionLabel(box, title, 14, 12, 300);
        AddConfigLabel(box, "正在编辑档位", 14, 50, 110);
        ComboBox quality = CreateQualityComboBox(box, 104, 44, 170);
        quality.SelectedIndexChanged += delegate { OnQualityPresetSelectionChanged(live); };
        Label modeHint = AddConfigLabel(box, "切换这里只是编辑对应档位参数，不限制 Tavo 页面选档位。", 14, 86, 360);
        modeHint.ForeColor = Color.FromArgb(160, 172, 184);

        AddConfigLabel(box, "该档位生成参数", 14, 116, 220);
        TextBox diffusion = AddConfigNumberField(box, "扩散步数", 14, 144, "14", 112);
        TextBox prompt = AddConfigNumberField(box, "参考秒数", 144, 144, "10", 112);
        TextBox cfgRate = AddConfigNumberField(box, "S2Mel CFG", 274, 144, "0.70", 112);
        TextBox segment = AddConfigNumberField(box, "分段 token", 14, 208, "60", 112);
        TextBox first = AddConfigNumberField(box, "首段 token", 144, 208, "18", 112);

        Label hint = AddConfigLabel(box, "所有档位都可改", 274, 234, 112);
        hint.ForeColor = Color.FromArgb(160, 172, 184);

        if (live)
        {
            liveQualityBox = quality;
            liveDiffusionBox = diffusion;
            livePromptSecondsBox = prompt;
            liveSegmentTokensBox = segment;
            liveFirstTokensBox = first;
            liveCfgRateBox = cfgRate;
        }
        else
        {
            generateQualityBox = quality;
            generateDiffusionBox = diffusion;
            generatePromptSecondsBox = prompt;
            generateSegmentTokensBox = segment;
            generateFirstTokensBox = first;
            generateCfgRateBox = cfgRate;
        }
    }

    private TextBox AddConfigNumberField(Panel parent, string label, int x, int y, string placeholder)
    {
        return AddConfigNumberField(parent, label, x, y, placeholder, 130);
    }

    private TextBox AddConfigNumberField(Panel parent, string label, int x, int y, string placeholder, int width)
    {
        AddConfigLabel(parent, label, x, y, width);
        TextBox box = CreateConfigTextBox(parent, x, y + 26, width, 32);
        box.Anchor = AnchorStyles.Top | AnchorStyles.Left;
        box.TextAlign = HorizontalAlignment.Center;
        box.Text = placeholder;
        return box;
    }

    private Label AddConfigSectionLabel(Panel parent, string text, int x, int y, int width)
    {
        Label label = AddConfigLabel(parent, text, x, y, width);
        label.Font = NewFont(12.0f, FontStyle.Bold);
        label.ForeColor = Color.FromArgb(226, 232, 238);
        return label;
    }

    private Label AddConfigLabel(Panel parent, string text, int x, int y, int width)
    {
        Label label = new Label();
        label.Text = text;
        label.Location = new Point(x, y);
        label.Size = new Size(width, 22);
        label.AutoEllipsis = true;
        label.BackColor = parent.BackColor;
        label.ForeColor = Color.FromArgb(205, 214, 224);
        label.Font = NewFont(10.0f, FontStyle.Regular);
        parent.Controls.Add(label);
        return label;
    }

    private TextBox CreateConfigTextBox(Panel parent, int x, int y, int width, int height)
    {
        TextBox box = new TextBox();
        box.Location = new Point(x, y);
        box.Size = new Size(width, height);
        box.Anchor = AnchorStyles.Top | AnchorStyles.Left;
        box.BorderStyle = BorderStyle.FixedSingle;
        box.BackColor = Color.FromArgb(8, 12, 17);
        box.ForeColor = Color.WhiteSmoke;
        box.Font = NewMonoFont(10.5f);
        parent.Controls.Add(box);
        return box;
    }

    private ComboBox CreateQualityComboBox(Panel parent, int x, int y, int width)
    {
        ComboBox box = new ComboBox();
        box.Location = new Point(x, y);
        box.Size = new Size(width, 32);
        box.DropDownStyle = ComboBoxStyle.DropDownList;
        box.FlatStyle = FlatStyle.Flat;
        box.BackColor = Color.FromArgb(8, 12, 17);
        box.ForeColor = Color.WhiteSmoke;
        box.Font = NewFont(11.0f, FontStyle.Bold);
        box.Items.AddRange(new object[] { "fast", "balanced", "expressive", "ultra", "custom" });
        box.SelectedItem = "balanced";
        parent.Controls.Add(box);
        return box;
    }

    private void StyleConfigActionButton(Button button)
    {
        if (button == null) return;
        button.Font = NewFont(10.0f, FontStyle.Bold);
    }

    private void RefreshProfileList(bool showStatus)
    {
        try
        {
            EnsureDefaultProfileFiles();
            string preferred = selectedProfilePath;
            if (string.IsNullOrWhiteSpace(preferred)) preferred = GetAppliedSourceProfilePath();

            List<ProfileOption> options = ListProfileOptions();
            profileListLoading = true;
            if (profileSelectBox != null)
            {
                profileSelectBox.Items.Clear();
                foreach (ProfileOption option in options)
                {
                    profileSelectBox.Items.Add(option);
                }

                int selectedIndex = 0;
                for (int i = 0; i < options.Count; i++)
                {
                    if (SamePath(options[i].FilePath, preferred))
                    {
                        selectedIndex = i;
                        break;
                    }
                }
                if (profileSelectBox.Items.Count > 0) profileSelectBox.SelectedIndex = selectedIndex;
            }
            profileListLoading = false;

            ProfileOption selectedOption = profileSelectBox == null ? null : profileSelectBox.SelectedItem as ProfileOption;
            if (selectedOption != null)
            {
                selectedProfilePath = selectedOption.FilePath;
            }
            else if (options.Count > 0)
            {
                selectedProfilePath = options[0].FilePath;
            }
            LoadProfileIntoConfigUi();
            if (showStatus) SetStatus("Profile 列表已刷新。", Color.Khaki);
        }
        catch (Exception ex)
        {
            profileListLoading = false;
            AddLauncherLog("刷新 Profile 列表失败: " + ex.Message, "ERROR");
            SetStatus("刷新 Profile 失败，请看日志。", Color.LightCoral);
        }
    }

    private void OnProfileSelectionChanged()
    {
        if (profileListLoading) return;
        ProfileOption option = profileSelectBox == null ? null : profileSelectBox.SelectedItem as ProfileOption;
        if (option == null) return;
        selectedProfilePath = option.FilePath;
        LoadProfileIntoConfigUi();
    }

    private void LoadProfileIntoConfigUi()
    {
        try
        {
            EnsureDefaultProfileFiles();
            if (string.IsNullOrWhiteSpace(selectedProfilePath) || !File.Exists(selectedProfilePath))
            {
                List<ProfileOption> options = ListProfileOptions();
                if (options.Count == 0) throw new FileNotFoundException("没有可用的 profile 文件");
                selectedProfilePath = options[0].FilePath;
            }

            Dictionary<string, object> profile = LoadProfileData(selectedProfilePath);
            ApplyProfileToConfigUi(profile, selectedProfilePath);
            SelectProfileBoxPath(selectedProfilePath);
            SetStatus("Profile 已读取: " + GetStringValue(profile, "name", Path.GetFileNameWithoutExtension(selectedProfilePath)), Color.Khaki);
        }
        catch (Exception ex)
        {
            AddLauncherLog("读取 Profile 失败: " + ex.Message, "ERROR");
            SetStatus("读取 Profile 失败，请看日志。", Color.LightCoral);
        }
    }

    private void SaveSelectedProfileFromUi()
    {
        try
        {
            EnsureDefaultProfileFiles();
            string sourcePath = selectedProfilePath;
            if (string.IsNullOrWhiteSpace(sourcePath) || IsActiveProfilePath(sourcePath))
            {
                sourcePath = null;
            }

            string targetPath = DesiredProfilePathFromUi(sourcePath, false);
            Dictionary<string, object> profile = ReadProfileFromConfigUi(sourcePath);
            SaveProfileData(targetPath, profile);
            if (!string.IsNullOrWhiteSpace(sourcePath) && !SamePath(sourcePath, targetPath) && File.Exists(sourcePath))
            {
                File.Delete(sourcePath);
                UpdateAppliedSourceAfterRename(sourcePath, targetPath);
            }
            selectedProfilePath = targetPath;
            RefreshProfileList(false);
            AddLauncherLog("已保存 Profile: " + targetPath);
            SetStatus("Profile 已保存；点应用后写入 active。", Color.LightGreen);
        }
        catch (Exception ex)
        {
            AddLauncherLog("保存 Profile 失败: " + ex.Message, "ERROR");
            SetStatus("保存 Profile 失败，请看日志。", Color.LightCoral);
        }
    }

    private void SaveAsNewProfileFromUi()
    {
        try
        {
            EnsureDefaultProfileFiles();
            string path = MakeCopyProfilePathFromUi(selectedProfilePath);
            Dictionary<string, object> profile = ReadProfileFromConfigUi(selectedProfilePath);
            if (profileNameBox != null && string.IsNullOrWhiteSpace(profileNameBox.Text))
            {
                profile["name"] = Path.GetFileNameWithoutExtension(path);
            }
            SaveProfileData(path, profile);
            selectedProfilePath = path;
            RefreshProfileList(false);
            ApplyProfileToConfigUi(profile, path);
            AddLauncherLog("已复制 Profile: " + path);
            SetStatus("已复制为新 Profile；点应用后写入 active。", Color.LightGreen);
        }
        catch (Exception ex)
        {
            AddLauncherLog("复制 Profile 失败: " + ex.Message, "ERROR");
            SetStatus("复制 Profile 失败，请看日志。", Color.LightCoral);
        }
    }

    private void CreateNewProfileFromDefaults()
    {
        try
        {
            EnsureDefaultProfileFiles();
            Dictionary<string, object> profile = DefaultProfileData();
            string stamp = DateTime.Now.ToString("yyyyMMdd-HHmm", System.Globalization.CultureInfo.InvariantCulture);
            profile["name"] = "LEON profile " + stamp;
            profile["description"] = "Local tuning profile managed by the LEON launcher.";
            string path = MakeUniqueProfilePath(ProfileFileBaseFromName(GetStringValue(profile, "name", "leon-profile")));
            SaveProfileData(path, profile);
            selectedProfilePath = path;
            RefreshProfileList(false);
            ApplyProfileToConfigUi(profile, path);
            AddLauncherLog("已新建 Profile: " + path);
            SetStatus("已新建完整配置；改参数后保存或应用。", Color.LightGreen);
        }
        catch (Exception ex)
        {
            AddLauncherLog("新建 Profile 失败: " + ex.Message, "ERROR");
            SetStatus("新建 Profile 失败，请看日志。", Color.LightCoral);
        }
    }

    private void ApplySelectedProfileFromUi()
    {
        try
        {
            EnsureDefaultProfileFiles();
            string sourcePath = selectedProfilePath;
            if (string.IsNullOrWhiteSpace(sourcePath) || IsActiveProfilePath(sourcePath))
            {
                sourcePath = null;
            }

            string targetPath = DesiredProfilePathFromUi(sourcePath, false);
            Dictionary<string, object> profile = ReadProfileFromConfigUi(sourcePath);
            SaveProfileData(targetPath, profile);
            if (!string.IsNullOrWhiteSpace(sourcePath) && !SamePath(sourcePath, targetPath) && File.Exists(sourcePath))
            {
                File.Delete(sourcePath);
            }
            Dictionary<string, object> active = CloneProfileData(profile);
            active["appliedAt"] = DateTime.UtcNow.ToString("o", System.Globalization.CultureInfo.InvariantCulture);
            active["appliedFrom"] = Path.GetFileName(targetPath);
            SaveProfileData(activeProfilePath, active);
            selectedProfilePath = targetPath;
            RefreshProfileList(false);
            AddLauncherLog("已应用 Profile: " + targetPath + " -> " + activeProfilePath);
            SetStatus("Profile 已应用；Tavo 下一次生成前会重新读取 active。", Color.LightGreen);
        }
        catch (Exception ex)
        {
            AddLauncherLog("应用 Profile 失败: " + ex.Message, "ERROR");
            SetStatus("应用 Profile 失败，请看日志。", Color.LightCoral);
        }
    }

    private void ResetConfigDefaults()
    {
        Dictionary<string, object> profile = DefaultProfileData();
        ApplyProfileToConfigUi(profile, string.IsNullOrWhiteSpace(selectedProfilePath) ? DefaultProfilePath() : selectedProfilePath);
        SetStatus("已恢复默认值；保存或应用后写入。", Color.Khaki);
    }

    private void ApplyProfileToConfigUi(Dictionary<string, object> profile, string path)
    {
        NormalizeProfileData(profile);
        currentProfileData = CloneProfileData(profile);

        if (profileNameBox != null) profileNameBox.Text = GetStringValue(profile, "name", Path.GetFileNameWithoutExtension(path));
        if (profileFileNameBox != null) profileFileNameBox.Text = ProfileFileBaseFromName(Path.GetFileNameWithoutExtension(path));
        if (profileDescriptionBox != null) profileDescriptionBox.Text = GetStringValue(profile, "description", "");
        if (profilePathHintLabel != null) profilePathHintLabel.Text = "Profile 路径: " + path;

        qualityUiLoading = true;
        liveEditingPreset = "balanced";
        generateEditingPreset = "balanced";
        SetComboValue(liveQualityBox, liveEditingPreset);
        SetComboValue(generateQualityBox, generateEditingPreset);
        SetQualityFields(GetPresetQuality(currentProfileData, "live", liveEditingPreset), liveDiffusionBox, livePromptSecondsBox, liveSegmentTokensBox, liveFirstTokensBox, liveCfgRateBox);
        SetQualityFields(GetPresetQuality(currentProfileData, "generate", generateEditingPreset), generateDiffusionBox, generatePromptSecondsBox, generateSegmentTokensBox, generateFirstTokensBox, generateCfgRateBox);
        qualityUiLoading = false;

        if (llmPromptBox != null) llmPromptBox.Text = GetStringValue(profile, "llmPrompt", "");
    }

    private void OnQualityPresetSelectionChanged(bool live)
    {
        if (qualityUiLoading) return;
        if (currentProfileData == null) currentProfileData = DefaultProfileData();

        string stream = live ? "live" : "generate";
        string previous = live ? liveEditingPreset : generateEditingPreset;
        string next = SelectedQualityValue(live ? liveQualityBox : generateQualityBox);

        if (!string.IsNullOrWhiteSpace(previous))
        {
            SetPresetQuality(currentProfileData, stream, previous, ReadQualityFields(
                live ? liveDiffusionBox : generateDiffusionBox,
                live ? livePromptSecondsBox : generatePromptSecondsBox,
                live ? liveSegmentTokensBox : generateSegmentTokensBox,
                live ? liveFirstTokensBox : generateFirstTokensBox,
                live ? liveCfgRateBox : generateCfgRateBox));
        }

        if (live) liveEditingPreset = next;
        else generateEditingPreset = next;

        qualityUiLoading = true;
        SetQualityFields(GetPresetQuality(currentProfileData, stream, next),
            live ? liveDiffusionBox : generateDiffusionBox,
            live ? livePromptSecondsBox : generatePromptSecondsBox,
            live ? liveSegmentTokensBox : generateSegmentTokensBox,
            live ? liveFirstTokensBox : generateFirstTokensBox,
            live ? liveCfgRateBox : generateCfgRateBox);
        qualityUiLoading = false;
    }

    private void StoreCurrentQualityFields()
    {
        if (currentProfileData == null) currentProfileData = DefaultProfileData();
        SetPresetQuality(currentProfileData, "live", NormalizeQualityMode(liveEditingPreset), ReadQualityFields(liveDiffusionBox, livePromptSecondsBox, liveSegmentTokensBox, liveFirstTokensBox, liveCfgRateBox));
        SetPresetQuality(currentProfileData, "generate", NormalizeQualityMode(generateEditingPreset), ReadQualityFields(generateDiffusionBox, generatePromptSecondsBox, generateSegmentTokensBox, generateFirstTokensBox, generateCfgRateBox));
    }

    private Dictionary<string, object> ReadProfileFromConfigUi(string existingPath)
    {
        Dictionary<string, object> profile = null;
        if (!string.IsNullOrWhiteSpace(existingPath) && File.Exists(existingPath))
        {
            profile = LoadProfileData(existingPath);
        }
        if (profile == null) profile = DefaultProfileData();
        profile.Remove("appliedAt");
        profile.Remove("appliedFrom");
        currentProfileData = currentProfileData == null ? CloneProfileData(profile) : currentProfileData;
        StoreCurrentQualityFields();

        string profileName = profileNameBox == null ? "" : StringOrEmpty(profileNameBox.Text);
        if (string.IsNullOrWhiteSpace(profileName)) profileName = GetStringValue(profile, "name", "LEON profile");
        profile["version"] = 2;
        profile["name"] = profileName;
        profile["description"] = profileDescriptionBox == null ? "" : StringOrEmpty(profileDescriptionBox.Text);
        profile["llmPromptId"] = "launcher_profile_prompt_template_v1";
        string prompt = llmPromptBox == null ? "" : llmPromptBox.Text.Trim();
        profile["llmPrompt"] = string.IsNullOrWhiteSpace(prompt) ? DefaultLlmPromptTemplate() : prompt;
        profile["updatedAt"] = DateTime.UtcNow.ToString("o", System.Globalization.CultureInfo.InvariantCulture);

        Dictionary<string, object> sourceQuality = GetObjectDict(currentProfileData, "quality");
        Dictionary<string, object> sourcePresets = GetObjectDict(sourceQuality, "presets");
        Dictionary<string, object> quality = new Dictionary<string, object>(StringComparer.OrdinalIgnoreCase);
        quality["presets"] = CloneProfileData(sourcePresets);
        profile["quality"] = quality;
        NormalizeProfileData(profile);
        return profile;
    }

    private void EnsureDefaultProfileFiles()
    {
        Directory.CreateDirectory(profileDir);
        string defaultPath = DefaultProfilePath();
        if (!File.Exists(defaultPath))
        {
            Dictionary<string, object> seed = null;
            if (File.Exists(activeProfilePath))
            {
                try { seed = LoadProfileData(activeProfilePath); }
                catch { seed = null; }
            }
            if (seed == null) seed = DefaultProfileData();
            seed.Remove("appliedAt");
            seed.Remove("appliedFrom");
            if (string.IsNullOrWhiteSpace(GetStringValue(seed, "name", ""))) seed["name"] = "LEON default";
            if (string.IsNullOrWhiteSpace(GetStringValue(seed, "description", ""))) seed["description"] = "Default local tuning profile managed by the LEON launcher.";
            SaveProfileData(defaultPath, seed);
        }

        if (!File.Exists(activeProfilePath))
        {
            Dictionary<string, object> active = LoadProfileData(defaultPath);
            active["appliedAt"] = DateTime.UtcNow.ToString("o", System.Globalization.CultureInfo.InvariantCulture);
            active["appliedFrom"] = Path.GetFileName(defaultPath);
            SaveProfileData(activeProfilePath, active);
        }
    }

    private Dictionary<string, object> LoadActiveProfileData()
    {
        EnsureDefaultProfileFiles();
        return LoadProfileData(activeProfilePath);
    }

    private Dictionary<string, object> LoadProfileData(string path)
    {
        string text = File.ReadAllText(path, Encoding.UTF8);
        object value = json.DeserializeObject(text);
        Dictionary<string, object> profile = value as Dictionary<string, object>;
        if (profile == null) throw new InvalidDataException("profile 不是 JSON object: " + path);
        NormalizeProfileData(profile);
        return profile;
    }

    private void SaveProfileData(string path, Dictionary<string, object> profile)
    {
        Directory.CreateDirectory(Path.GetDirectoryName(path));
        File.WriteAllText(path, json.Serialize(profile), new UTF8Encoding(false));
    }

    private Dictionary<string, object> DefaultProfileData()
    {
        Dictionary<string, object> quality = new Dictionary<string, object>(StringComparer.OrdinalIgnoreCase);
        quality["presets"] = DefaultQualityPresetsData();

        Dictionary<string, object> profile = new Dictionary<string, object>(StringComparer.OrdinalIgnoreCase);
        profile["version"] = 2;
        profile["name"] = "LEON default";
        profile["description"] = "Default local tuning profile managed by the LEON launcher.";
        profile["llmPromptId"] = "launcher_profile_prompt_template_v1";
        profile["llmPrompt"] = DefaultLlmPromptTemplate();
        profile["quality"] = quality;
        return profile;
    }

    private string DefaultLlmPromptTemplate()
    {
        return string.Join("\n", new string[] {
            "你是中文小说→TTS 片段拆分器。只返回严格 JSON，不要任何解释，不要 ``` 代码块。",
            "",
            "{{roles_hint}}",
            "{{user_alias_hint}}",
            "{{character_hint}}",
            "输出格式:",
            "{{output_contract}}",
            "",
            "拆段规则:",
            "1. 旁白（叙述、环境、动作描写、心理描写、所有无引号正文）→ role 固定为 \"旁白\"。",
            "   无论主语是不是用户身份名/当前角色名，只要不是引号里的直接台词，都必须写 \"旁白\"。",
            "   例如「白夜雨抱住她」「潘金莲低下头」「她笑了」「我低下头看着……」「白夜雨说道：」都写旁白，不要让用户或角色认领旁白。",
            "   旁白连续多个句子，要按句号/问号/感叹号/分号拆成多个旁白 segments，每段≤2 句。",
            "2. 人物直接说出口的话 → role 用说话人的名字。",
            "   - 如果说话人是「你」或用户身份名，role 统一写 \"用户\"。",
            "   - 不要把「我」当作用户；无引号的「我……」默认是第一人称叙述，role 写 \"旁白\"。",
            "   - 其他人物优先从已知角色名单挑名字；名单外的新人物用原文里的名字。",
            "3. 「他说：」「她笑道：」「白夜雨说道：」这类引导句本身永远是旁白；只有后面引号里的直接台词才按说话人分配。",
            "4. text 是要朗读的原文片段，保留标点和语气词。",
            "{{style_rules}}",
            "",
            "{{emotion_rules}}",
            "",
            "完整性硬规则:",
            "- 必须覆盖输入原文 100%，按原文顺序输出，不要总结、改写、删字、漏掉最后一段。",
            "- 每个原文片段只能出现一次，不要把多段无关尾巴合并成一条对白。",
            "- 如果最后一个引号后还有动作/叙述/心理描写，最后一段必须是 role=\"旁白\"。",
            "- 不确定说话人时用 role=\"旁白\"，不要沿用上一句对白角色。",
            "",
            "示例输入:",
            "她低着头，眼角有泪。「对不起，我真的撑不住了。」",
            "{{example_user}}叹了口气，把手放在她肩上：「别哭。」",
            "示例输出:",
            "{{example_output}}"
        });
    }

    private void NormalizeProfileData(Dictionary<string, object> profile)
    {
        profile["version"] = 2;
        if (!profile.ContainsKey("name")) profile["name"] = "LEON profile";
        if (!profile.ContainsKey("description")) profile["description"] = "";
        profile["llmPromptId"] = "launcher_profile_prompt_template_v1";
        if (!profile.ContainsKey("llmPrompt") || string.IsNullOrWhiteSpace(GetStringValue(profile, "llmPrompt", ""))) profile["llmPrompt"] = DefaultLlmPromptTemplate();
        Dictionary<string, object> quality = GetObjectDict(profile, "quality");
        Dictionary<string, object> presets = GetObjectDict(quality, "presets");
        Dictionary<string, object> legacyCustom = GetObjectDict(quality, "custom");
        NormalizePresetStream(presets, "live", legacyCustom.ContainsKey("live") ? GetObjectDict(legacyCustom, "live") : null);
        NormalizePresetStream(presets, "generate", legacyCustom.ContainsKey("generate") ? GetObjectDict(legacyCustom, "generate") : null);
        quality.Remove("live");
        quality.Remove("generate");
        quality.Remove("custom");
    }

    private Dictionary<string, object> CloneProfileData(Dictionary<string, object> profile)
    {
        object value = json.DeserializeObject(json.Serialize(profile));
        Dictionary<string, object> clone = value as Dictionary<string, object>;
        return clone == null ? DefaultProfileData() : clone;
    }

    private List<ProfileOption> ListProfileOptions()
    {
        List<ProfileOption> options = new List<ProfileOption>();
        string[] files = Directory.GetFiles(profileDir, "*.json", SearchOption.TopDirectoryOnly);
        foreach (string file in files)
        {
            if (IsActiveProfilePath(file)) continue;
            try
            {
                Dictionary<string, object> profile = LoadProfileData(file);
                string label = GetStringValue(profile, "name", Path.GetFileNameWithoutExtension(file));
                if (IsAppliedProfileFile(file)) label += "  (active)";
                options.Add(new ProfileOption(label, file));
            }
            catch (Exception ex)
            {
                AddLauncherLog("跳过损坏 Profile: " + file + " / " + ex.Message, "WARN");
            }
        }
        options.Sort(delegate(ProfileOption a, ProfileOption b) { return string.Compare(a.DisplayName, b.DisplayName, StringComparison.OrdinalIgnoreCase); });
        return options;
    }

    private void SelectProfileBoxPath(string path)
    {
        if (profileSelectBox == null || profileListLoading) return;
        for (int i = 0; i < profileSelectBox.Items.Count; i++)
        {
            ProfileOption option = profileSelectBox.Items[i] as ProfileOption;
            if (option != null && SamePath(option.FilePath, path))
            {
                if (profileSelectBox.SelectedIndex != i) profileSelectBox.SelectedIndex = i;
                return;
            }
        }
    }

    private string GetAppliedSourceProfilePath()
    {
        if (!File.Exists(activeProfilePath)) return DefaultProfilePath();
        try
        {
            Dictionary<string, object> active = LoadProfileData(activeProfilePath);
            string appliedFrom = GetStringValue(active, "appliedFrom", "");
            if (!string.IsNullOrWhiteSpace(appliedFrom))
            {
                string path = Path.Combine(profileDir, Path.GetFileName(appliedFrom));
                if (File.Exists(path)) return path;
            }
        }
        catch
        {
        }
        return DefaultProfilePath();
    }

    private bool IsAppliedProfileFile(string file)
    {
        return SamePath(file, GetAppliedSourceProfilePath());
    }

    private string DefaultProfilePath()
    {
        return Path.Combine(profileDir, "leon-default.json");
    }

    private bool IsActiveProfilePath(string path)
    {
        return SamePath(path, activeProfilePath);
    }

    private string DesiredProfilePathFromUi(string sourcePath, bool allowExistingSource)
    {
        string baseName = profileFileNameBox == null ? "" : StringOrEmpty(profileFileNameBox.Text);
        if (string.IsNullOrWhiteSpace(baseName)) baseName = profileNameBox == null ? "" : StringOrEmpty(profileNameBox.Text);
        if (string.IsNullOrWhiteSpace(baseName) && !string.IsNullOrWhiteSpace(sourcePath)) baseName = Path.GetFileNameWithoutExtension(sourcePath);
        baseName = ProfileFileBaseFromName(baseName);
        string path = Path.Combine(profileDir, baseName + ".json");
        if (IsActiveProfilePath(path)) throw new InvalidOperationException("Profile 文件名不能是 active。");
        if (allowExistingSource && !string.IsNullOrWhiteSpace(sourcePath) && SamePath(path, sourcePath)) return sourcePath;
        if (File.Exists(path) && (string.IsNullOrWhiteSpace(sourcePath) || !SamePath(path, sourcePath)))
        {
            throw new IOException("Profile 文件名已存在: " + Path.GetFileName(path));
        }
        return path;
    }

    private string MakeCopyProfilePathFromUi(string sourcePath)
    {
        string baseName = profileFileNameBox == null ? "" : StringOrEmpty(profileFileNameBox.Text);
        if (string.IsNullOrWhiteSpace(baseName)) baseName = profileNameBox == null ? "" : StringOrEmpty(profileNameBox.Text);
        if (string.IsNullOrWhiteSpace(baseName) && !string.IsNullOrWhiteSpace(sourcePath)) baseName = Path.GetFileNameWithoutExtension(sourcePath);
        baseName = ProfileFileBaseFromName(baseName);
        if (!string.IsNullOrWhiteSpace(sourcePath) && string.Equals(baseName, ProfileFileBaseFromName(Path.GetFileNameWithoutExtension(sourcePath)), StringComparison.OrdinalIgnoreCase))
        {
            baseName += "-copy";
        }
        return MakeUniqueProfilePath(baseName);
    }

    private void UpdateAppliedSourceAfterRename(string oldPath, string newPath)
    {
        if (!File.Exists(activeProfilePath)) return;
        try
        {
            Dictionary<string, object> active = LoadProfileData(activeProfilePath);
            string appliedFrom = GetStringValue(active, "appliedFrom", "");
            if (string.Equals(Path.GetFileName(appliedFrom), Path.GetFileName(oldPath), StringComparison.OrdinalIgnoreCase))
            {
                active["appliedFrom"] = Path.GetFileName(newPath);
                SaveProfileData(activeProfilePath, active);
            }
        }
        catch (Exception ex)
        {
            AddLauncherLog("更新 active appliedFrom 失败: " + ex.Message, "WARN");
        }
    }

    private bool SamePath(string a, string b)
    {
        if (string.IsNullOrWhiteSpace(a) || string.IsNullOrWhiteSpace(b)) return false;
        try
        {
            return string.Equals(Path.GetFullPath(a).TrimEnd(Path.DirectorySeparatorChar, Path.AltDirectorySeparatorChar), Path.GetFullPath(b).TrimEnd(Path.DirectorySeparatorChar, Path.AltDirectorySeparatorChar), StringComparison.OrdinalIgnoreCase);
        }
        catch
        {
            return string.Equals(a, b, StringComparison.OrdinalIgnoreCase);
        }
    }

    private string ProfileFileBaseFromName(string name)
    {
        string raw = StringOrEmpty(name).ToLowerInvariant();
        StringBuilder sb = new StringBuilder();
        foreach (char ch in raw)
        {
            if ((ch >= 'a' && ch <= 'z') || (ch >= '0' && ch <= '9')) sb.Append(ch);
            else if (ch == '-' || ch == '_' || ch == ' ') sb.Append('-');
        }
        string baseName = Regex.Replace(sb.ToString(), "-+", "-").Trim('-');
        if (string.IsNullOrWhiteSpace(baseName)) baseName = "profile";
        if (baseName == "active") baseName = "profile-active";
        return baseName;
    }

    private string MakeUniqueProfilePath(string baseName)
    {
        baseName = ProfileFileBaseFromName(baseName);
        string path = Path.Combine(profileDir, baseName + ".json");
        if (!File.Exists(path) && !IsActiveProfilePath(path)) return path;
        string stamp = DateTime.Now.ToString("yyyyMMdd-HHmmss", System.Globalization.CultureInfo.InvariantCulture);
        path = Path.Combine(profileDir, baseName + "-" + stamp + ".json");
        int index = 2;
        while (File.Exists(path) || IsActiveProfilePath(path))
        {
            path = Path.Combine(profileDir, baseName + "-" + stamp + "-" + index.ToString(System.Globalization.CultureInfo.InvariantCulture) + ".json");
            index++;
        }
        return path;
    }

    private Dictionary<string, object> DefaultQualityPresetsData()
    {
        Dictionary<string, object> presets = new Dictionary<string, object>(StringComparer.OrdinalIgnoreCase);
        Dictionary<string, object> live = new Dictionary<string, object>(StringComparer.OrdinalIgnoreCase);
        Dictionary<string, object> generate = new Dictionary<string, object>(StringComparer.OrdinalIgnoreCase);
        foreach (string mode in QualityPresetNames())
        {
            live[mode] = DefaultQualityPresetData(mode);
            generate[mode] = DefaultQualityPresetData(mode);
        }
        presets["live"] = live;
        presets["generate"] = generate;
        return presets;
    }

    private string[] QualityPresetNames()
    {
        return new string[] { "fast", "balanced", "expressive", "ultra", "custom" };
    }

    private Dictionary<string, object> DefaultQualityPresetData(string mode)
    {
        Dictionary<string, object> data = new Dictionary<string, object>(StringComparer.OrdinalIgnoreCase);
        mode = NormalizeQualityMode(mode);
        if (mode == "fast")
        {
            data["diffusion_steps"] = 8;
            data["prompt_audio_seconds"] = 6;
            data["segment_tokens"] = 40;
            data["first_tokens"] = 10;
        }
        else if (mode == "ultra")
        {
            data["diffusion_steps"] = 20;
            data["prompt_audio_seconds"] = 14;
            data["segment_tokens"] = 96;
            data["first_tokens"] = 32;
        }
        else if (mode == "expressive")
        {
            data["diffusion_steps"] = 16;
            data["prompt_audio_seconds"] = 12;
            data["segment_tokens"] = 72;
            data["first_tokens"] = 24;
        }
        else
        {
            data["diffusion_steps"] = 14;
            data["prompt_audio_seconds"] = 10;
            data["segment_tokens"] = 60;
            data["first_tokens"] = 18;
        }
        data["s2mel_cfg_rate"] = 0.7;
        return data;
    }

    private void NormalizePresetStream(Dictionary<string, object> presets, string stream, Dictionary<string, object> legacyCustom)
    {
        Dictionary<string, object> streamPresets = GetObjectDict(presets, stream);
        foreach (string mode in QualityPresetNames())
        {
            Dictionary<string, object> existing = GetObjectDict(streamPresets, mode);
            if (mode == "custom" && legacyCustom != null && existing.Count == 0) existing = legacyCustom;
            streamPresets[mode] = NormalizeQualityData(existing, DefaultQualityPresetData(mode));
        }
    }

    private Dictionary<string, object> NormalizeQualityData(Dictionary<string, object> data, Dictionary<string, object> fallback)
    {
        Dictionary<string, object> normalized = new Dictionary<string, object>(StringComparer.OrdinalIgnoreCase);
        normalized["diffusion_steps"] = Math.Max(2, Math.Min(24, GetIntValue(data, "diffusion_steps", GetIntValue(fallback, "diffusion_steps", 14))));
        normalized["prompt_audio_seconds"] = Math.Max(2, Math.Min(16, GetDoubleValue(data, "prompt_audio_seconds", GetDoubleValue(fallback, "prompt_audio_seconds", 10))));
        normalized["segment_tokens"] = Math.Max(8, Math.Min(120, GetIntValue(data, "segment_tokens", GetIntValue(fallback, "segment_tokens", 60))));
        normalized["first_tokens"] = Math.Max(4, Math.Min(GetIntValue(normalized, "segment_tokens", 60), GetIntValue(data, "first_tokens", GetIntValue(fallback, "first_tokens", 18))));
        normalized["s2mel_cfg_rate"] = Math.Max(0, Math.Min(1.2, GetDoubleValue(data, "s2mel_cfg_rate", GetDoubleValue(fallback, "s2mel_cfg_rate", 0.7))));
        return normalized;
    }

    private Dictionary<string, object> GetPresetQuality(Dictionary<string, object> profile, string stream, string mode)
    {
        if (profile == null) profile = DefaultProfileData();
        NormalizeProfileData(profile);
        Dictionary<string, object> quality = GetObjectDict(profile, "quality");
        Dictionary<string, object> presets = GetObjectDict(quality, "presets");
        Dictionary<string, object> streamPresets = GetObjectDict(presets, stream);
        return GetObjectDict(streamPresets, NormalizeQualityMode(mode));
    }

    private void SetPresetQuality(Dictionary<string, object> profile, string stream, string mode, Dictionary<string, object> data)
    {
        if (profile == null) return;
        NormalizeProfileData(profile);
        Dictionary<string, object> quality = GetObjectDict(profile, "quality");
        Dictionary<string, object> presets = GetObjectDict(quality, "presets");
        Dictionary<string, object> streamPresets = GetObjectDict(presets, stream);
        streamPresets[NormalizeQualityMode(mode)] = NormalizeQualityData(data, DefaultQualityPresetData(mode));
    }

    private void SetQualityFields(Dictionary<string, object> data, TextBox diffusion, TextBox promptSeconds, TextBox segmentTokens, TextBox firstTokens, TextBox cfgRate)
    {
        if (diffusion != null) diffusion.Text = GetIntValue(data, "diffusion_steps", 14).ToString();
        if (promptSeconds != null) promptSeconds.Text = FormatDouble(GetDoubleValue(data, "prompt_audio_seconds", 10));
        if (segmentTokens != null) segmentTokens.Text = GetIntValue(data, "segment_tokens", 60).ToString();
        if (firstTokens != null) firstTokens.Text = GetIntValue(data, "first_tokens", 18).ToString();
        if (cfgRate != null) cfgRate.Text = FormatDouble(GetDoubleValue(data, "s2mel_cfg_rate", 0.7));
    }

    private Dictionary<string, object> ReadQualityFields(TextBox diffusion, TextBox promptSeconds, TextBox segmentTokens, TextBox firstTokens, TextBox cfgRate)
    {
        Dictionary<string, object> data = new Dictionary<string, object>(StringComparer.OrdinalIgnoreCase);
        data["diffusion_steps"] = ReadIntBox(diffusion, 14, 2, 24);
        data["prompt_audio_seconds"] = ReadDoubleBox(promptSeconds, 10, 2, 16);
        data["segment_tokens"] = ReadIntBox(segmentTokens, 60, 8, 120);
        data["first_tokens"] = ReadIntBox(firstTokens, 18, 4, ReadIntBox(segmentTokens, 60, 8, 120));
        data["s2mel_cfg_rate"] = ReadDoubleBox(cfgRate, 0.7, 0, 1.2);
        return data;
    }

    private Dictionary<string, object> GetObjectDict(Dictionary<string, object> parent, string key)
    {
        object value;
        if (parent != null && parent.TryGetValue(key, out value))
        {
            Dictionary<string, object> dict = value as Dictionary<string, object>;
            if (dict != null) return dict;
        }
        Dictionary<string, object> created = new Dictionary<string, object>(StringComparer.OrdinalIgnoreCase);
        if (parent != null) parent[key] = created;
        return created;
    }

    private string GetStringValue(Dictionary<string, object> dict, string key, string fallback)
    {
        object value;
        if (dict == null || !dict.TryGetValue(key, out value) || value == null) return fallback;
        string text = Convert.ToString(value);
        return string.IsNullOrWhiteSpace(text) ? fallback : text.Trim();
    }

    private int GetIntValue(Dictionary<string, object> dict, string key, int fallback)
    {
        object value;
        if (dict == null || !dict.TryGetValue(key, out value) || value == null) return fallback;
        int parsed;
        if (int.TryParse(Convert.ToString(value), out parsed)) return parsed;
        double parsedDouble;
        if (double.TryParse(Convert.ToString(value), System.Globalization.NumberStyles.Float, System.Globalization.CultureInfo.InvariantCulture, out parsedDouble)) return (int)Math.Round(parsedDouble);
        return fallback;
    }

    private double GetDoubleValue(Dictionary<string, object> dict, string key, double fallback)
    {
        object value;
        if (dict == null || !dict.TryGetValue(key, out value) || value == null) return fallback;
        double parsed;
        return double.TryParse(Convert.ToString(value), System.Globalization.NumberStyles.Float, System.Globalization.CultureInfo.InvariantCulture, out parsed) ? parsed : fallback;
    }

    private int ReadIntBox(TextBox box, int fallback, int min, int max)
    {
        int parsed;
        if (box != null && int.TryParse(StringOrEmpty(box.Text), out parsed))
        {
            return Math.Max(min, Math.Min(max, parsed));
        }
        return fallback;
    }

    private double ReadDoubleBox(TextBox box, double fallback, double min, double max)
    {
        double parsed;
        if (box != null && double.TryParse(StringOrEmpty(box.Text), System.Globalization.NumberStyles.Float, System.Globalization.CultureInfo.InvariantCulture, out parsed))
        {
            return Math.Max(min, Math.Min(max, parsed));
        }
        return fallback;
    }

    private static string StringOrEmpty(string value)
    {
        return value == null ? string.Empty : value.Trim();
    }

    private static string FormatDouble(double value)
    {
        return value.ToString("0.###", System.Globalization.CultureInfo.InvariantCulture);
    }

    private void SetComboValue(ComboBox box, string value)
    {
        if (box == null) return;
        value = NormalizeQualityMode(value);
        if (box.Items.Contains(value)) box.SelectedItem = value;
        else box.SelectedItem = "balanced";
    }

    private string SelectedQualityValue(ComboBox box)
    {
        return NormalizeQualityMode(box == null ? null : Convert.ToString(box.SelectedItem));
    }

    private string NormalizeQualityMode(string value)
    {
        value = StringOrEmpty(value).ToLowerInvariant();
        if (value == "fast" || value == "balanced" || value == "expressive" || value == "ultra" || value == "custom") return value;
        return "balanced";
    }

    private Panel BuildEnvironmentPanel()
    {
        Panel panel = new Panel();
        panel.Dock = DockStyle.Fill;
        panel.BackColor = Color.FromArgb(12, 16, 21);
        panel.Visible = false;

        Panel top = new Panel();
        top.Dock = DockStyle.Top;
        top.Height = 46;
        top.BackColor = panel.BackColor;
        panel.Controls.Add(top);

        envVllmButton = CreateFlatButton("vLLM", 0, 0, 64, 34, Color.FromArgb(48, 68, 88), delegate { SetEnvironmentTarget("vllm", true); });
        envFast6gButton = CreateFlatButton("6G", 64, 0, 64, 34, Color.FromArgb(24, 31, 39), delegate { SetEnvironmentTarget("fast6g", true); });
        top.Controls.Add(envVllmButton);
        top.Controls.Add(envFast6gButton);

        envCheckButton = CreateFlatButton("开始检测", 148, 0, 104, 34, Color.FromArgb(48, 68, 88), delegate { RunEnvironmentCheckAsync(); });
        envRepairButton = CreateFlatButton("一键修复", 260, 0, 104, 34, Color.FromArgb(118, 78, 42), delegate { RepairEnvironmentAsync(); });
        top.Controls.Add(envCheckButton);
        top.Controls.Add(envRepairButton);

        Label tip = new Label();
        tip.Text = "检测和修复按当前页选择的版本执行；vLLM 和 6G 的依赖不混在一起。";
        tip.Location = new Point(382, 8);
        tip.Size = new Size(700, 22);
        tip.ForeColor = Color.FromArgb(205, 214, 224);
        tip.BackColor = panel.BackColor;
        tip.Font = NewFont(9.0f, FontStyle.Regular);
        top.Controls.Add(tip);

        envGrid = new DataGridView();
        envGrid.Dock = DockStyle.Fill;
        envGrid.AllowUserToAddRows = false;
        envGrid.AllowUserToDeleteRows = false;
        envGrid.AllowUserToResizeRows = false;
        envGrid.ReadOnly = true;
        envGrid.MultiSelect = false;
        envGrid.RowHeadersVisible = false;
        envGrid.BorderStyle = BorderStyle.None;
        envGrid.BackgroundColor = Color.FromArgb(16, 21, 27);
        envGrid.GridColor = Color.FromArgb(29, 37, 46);
        envGrid.EnableHeadersVisualStyles = false;
        envGrid.ColumnHeadersDefaultCellStyle.BackColor = Color.FromArgb(27, 35, 44);
        envGrid.ColumnHeadersDefaultCellStyle.ForeColor = Color.FromArgb(226, 232, 238);
        envGrid.ColumnHeadersDefaultCellStyle.SelectionBackColor = Color.FromArgb(27, 35, 44);
        envGrid.DefaultCellStyle.BackColor = Color.FromArgb(16, 21, 27);
        envGrid.DefaultCellStyle.ForeColor = Color.WhiteSmoke;
        envGrid.DefaultCellStyle.SelectionBackColor = Color.FromArgb(30, 48, 62);
        envGrid.DefaultCellStyle.SelectionForeColor = Color.White;
        envGrid.AlternatingRowsDefaultCellStyle.BackColor = Color.FromArgb(18, 24, 31);
        envGrid.RowTemplate.Height = 28;
        envGrid.AutoSizeColumnsMode = DataGridViewAutoSizeColumnsMode.Fill;
        envGrid.Columns.Add("name", "检查项");
        envGrid.Columns.Add("status", "状态");
        envGrid.Columns.Add("detail", "详情");
        envGrid.Columns["name"].FillWeight = 28;
        envGrid.Columns["status"].FillWeight = 12;
        envGrid.Columns["detail"].FillWeight = 60;
        panel.Controls.Add(envGrid);
        envGrid.BringToFront();
        SetEnvironmentTarget(envTargetKey, false);
        return panel;
    }

    private void StartBackgroundTimers()
    {
        logTimer = new System.Windows.Forms.Timer();
        logTimer.Interval = 1600;
        logTimer.Tick += delegate { RequestLogRefresh(); };
        logTimer.Start();

        healthTimer = new System.Windows.Forms.Timer();
        healthTimer.Interval = 2500;
        healthTimer.Tick += delegate { RequestHealthRefresh(); };
        healthTimer.Start();
    }

    private void ToggleServiceAsync()
    {
        ShowView("log");
        SetLogTabActive("launcher");
        SyncRatioFromBox();

        if (serviceTransition)
        {
            AddLauncherLog("忽略重复点击：服务操作进行中。", "WARN");
            return;
        }

        serviceTransition = true;
        SetServiceButtonBusy(lastHealthRunning ? "停止中..." : "启动中...");
        SetStatus(lastHealthRunning ? "正在停止 LEON 服务..." : "正在启动 LEON 服务...", Color.Khaki);

        Task.Factory.StartNew(delegate
        {
            try
            {
                bool running = TestApiHealth(1600);
                if (running)
                {
                    StopServiceWorker("停止服务");
                }
                else
                {
                    StartServiceWorker();
                }
            }
            catch (Exception ex)
            {
                AddLauncherLog("服务操作失败: " + ex.Message, "ERROR");
                BeginUi(delegate
                {
                    serviceTransition = false;
                    UpdateStartButtonState(false);
                    SetStatus("服务操作失败，请看日志。", Color.LightCoral);
                });
            }
        });
    }

    private void StartServiceWorker()
    {
        AddLauncherLog("启动按钮已响应，正在启动 LEON 服务...");
        EnsureDefaultProfileFiles();

        if (!File.Exists(startupBat))
        {
            AddLauncherLog("缺少启动 BAT: " + startupBat, "ERROR");
            CompleteTransition(false, "缺少启动 BAT。", Color.LightCoral);
            return;
        }

        if (TestApiHealth(1200))
        {
            AddLauncherLog("LEON 服务已经在运行: " + ApiBase);
            CompleteTransition(true, "LEON 服务已运行：" + ApiBase, Color.LightGreen);
            RunWarmupWorker();
            return;
        }

        AddLauncherLog("调用启动入口: " + startupBat);
        if (string.Equals(versionKey, "vllm", StringComparison.OrdinalIgnoreCase))
        {
            AddLauncherLog("启动配置: vLLM 质量版, gpu_memory_utilization=" + GetRatioText());
        }
        else
        {
            AddLauncherLog("启动配置: fast6g 双加速 6G");
        }

        try
        {
            ProcessStartInfo psi = new ProcessStartInfo();
            psi.FileName = "cmd.exe";
            psi.Arguments = "/d /c " + QuoteCmdArgument(startupBat);
            psi.WorkingDirectory = versionRoot;
            psi.UseShellExecute = false;
            psi.CreateNoWindow = true;
            psi.WindowStyle = ProcessWindowStyle.Hidden;
            psi.EnvironmentVariables["LEON_LAUNCHER_NO_PAUSE"] = "1";
            psi.EnvironmentVariables["LEON_LAUNCHER_VERSION"] = versionKey;
            psi.EnvironmentVariables["LEON_ENABLE_QWEN_EMO"] = "0";
            psi.EnvironmentVariables["LEON_ACTIVE_PROFILE_PATH"] = activeProfilePath;
            psi.EnvironmentVariables["PYTHONUTF8"] = "1";
            psi.EnvironmentVariables["PYTHONIOENCODING"] = "utf-8";
            if (string.Equals(versionKey, "vllm", StringComparison.OrdinalIgnoreCase))
            {
                psi.EnvironmentVariables["INDEXTTS_VLLM_GPU_MEMORY_UTILIZATION"] = GetRatioText();
            }

            Process proc = Process.Start(psi);
            if (proc != null)
            {
                AddLauncherLog("启动 wrapper PID: " + proc.Id);
            }
        }
        catch (Exception ex)
        {
            AddLauncherLog("启动失败: " + ex.Message, "ERROR");
            CompleteTransition(false, "启动失败，请看日志。", Color.LightCoral);
            return;
        }

        RefreshStartupLogPaths();
        SetStatus("服务启动中，首次加载模型可能需要几分钟...", Color.Khaki);

        DateTime start = DateTime.Now;
        int lastWaitLog = -30;
        while ((DateTime.Now - start).TotalSeconds <= 300)
        {
            Thread.Sleep(3000);
            RequestLogRefresh();

            if (TestApiHealth(1800))
            {
                AddLauncherLog("LEON 服务 ready: " + ApiBase);
                CompleteTransition(true, "LEON 服务已启动：" + ApiBase, Color.LightGreen);
                RunWarmupWorker();
                return;
            }

            int elapsed = (int)(DateTime.Now - start).TotalSeconds;
            SetStatus("服务启动中... " + elapsed + "s", Color.Khaki);
            if (elapsed - lastWaitLog >= 30)
            {
                AddLauncherLog("等待 LEON 服务 ready... " + elapsed + "s");
                lastWaitLog = elapsed;
            }
        }

        AddLauncherLog("LEON 服务启动等待超时。", "ERROR");
        CompleteTransition(false, "LEON 服务启动超时，请查看日志。", Color.LightCoral);
    }

    private void StopServiceWorker(string reason)
    {
        AddLauncherLog(reason + "：开始停止 LEON 服务...");

        if (TestApiHealth(1200))
        {
            try
            {
                AddLauncherLog(reason + "：向 LEON 服务发送退出请求...");
                HttpGet(ApiBase + "/control?command=exit", 1000);
            }
            catch
            {
                AddLauncherLog(reason + "：退出请求未返回，继续清理进程。", "WARN");
            }

            DateTime deadline = DateTime.Now.AddSeconds(5);
            while (DateTime.Now < deadline)
            {
                Thread.Sleep(500);
                List<int> pidsAfterExit = GetListeningPidsForPort(ApiPort);
                if (pidsAfterExit.Count == 0)
                {
                    AddLauncherLog(reason + "：端口已释放，继续检查残留 Python。");
                    break;
                }
            }
        }

        List<int> remainingPython = StopLeonProcesses(reason);
        Thread.Sleep(700);

        List<int> remainingPort = GetListeningPidsForPort(ApiPort);
        List<int> finalPython = GetLeonPythonPids();
        foreach (int pid in remainingPython)
        {
            if (!finalPython.Contains(pid)) finalPython.Add(pid);
        }
        finalPython.Sort();

        bool stopped = remainingPort.Count == 0 && finalPython.Count == 0;
        if (stopped)
        {
            AddLauncherLog(reason + "：LEON 服务已停止。");
            startupSuccessBannerShown = false;
            CompleteTransition(false, "服务已停止。", Color.Khaki);
        }
        else
        {
            List<string> parts = new List<string>();
            if (remainingPort.Count > 0) parts.Add("端口 PID: " + string.Join(", ", ToStringArray(remainingPort)));
            if (finalPython.Count > 0) parts.Add("Python PID: " + string.Join(", ", ToStringArray(finalPython)));
            AddLauncherLog(reason + "：仍有残留，" + string.Join("; ", parts.ToArray()), "WARN");
            CompleteTransition(true, "服务仍在运行，请查看剩余 PID。", Color.Khaki);
        }
    }

    private List<int> StopLeonProcesses(string reason)
    {
        List<int> pids = new List<int>();
        AddUniquePids(pids, GetListeningPidsForPort(ApiPort));
        AddUniquePids(pids, GetLauncherBackendWrapperPids());
        AddUniquePids(pids, GetLeonPythonPids());
        pids.Sort();

        if (pids.Count == 0)
        {
            AddLauncherLog(reason + "：未发现需要清理的 LEON 后端进程。");
            return new List<int>();
        }

        AddLauncherLog(reason + "：清理 LEON 后端进程 PID: " + string.Join(", ", ToStringArray(pids)));
        foreach (int pid in pids)
        {
            StopProcessTreeById(pid);
        }

        Thread.Sleep(500);
        List<int> remaining = GetLeonPythonPids();
        if (remaining.Count > 0)
        {
            AddLauncherLog(reason + "：继续清理残留 LEON Python PID: " + string.Join(", ", ToStringArray(remaining)), "WARN");
            foreach (int pid in remaining)
            {
                StopProcessTreeById(pid);
            }
            Thread.Sleep(300);
        }

        return GetLeonPythonPids();
    }

    private void OnLauncherClosing(object sender, FormClosingEventArgs e)
    {
        if (forceClose || string.Equals(Environment.GetEnvironmentVariable("LEON_LAUNCHER_SMOKE_TEST"), "1", StringComparison.Ordinal))
        {
            return;
        }

        e.Cancel = true;
        if (closeStopStarted)
        {
            SetStatus("正在关闭并清理服务...", Color.Khaki);
            return;
        }

        closeStopStarted = true;
        serviceTransition = true;
        SetServiceButtonBusy("关闭中...");
        SetStatus("正在关闭并清理服务...", Color.Khaki);

        Task.Factory.StartNew(delegate
        {
            try
            {
                StopServiceWorker("关闭启动器");
            }
            catch (Exception ex)
            {
                AddLauncherLog("关闭启动器时清理服务失败: " + ex.Message, "WARN");
            }
            BeginUi(delegate
            {
                forceClose = true;
                Close();
            });
        });
    }

    private void RequestHealthRefresh()
    {
        if (healthRefreshRunning || IsDisposed) return;
        healthRefreshRunning = true;
        Task.Factory.StartNew(delegate
        {
            bool running = TestApiHealth(1200);
            BeginUi(delegate
            {
                healthRefreshRunning = false;
                lastHealthRunning = running;
                if (!serviceTransition)
                {
                    UpdateStartButtonState(running);
                    SetStatus(running ? "LEON 服务已运行：" + ApiBase : "就绪。需要时点启动服务。", running ? Color.LightGreen : Color.Khaki);
                }
            });
        });
    }

    private void RequestLogRefresh()
    {
        if (logRefreshRunning || IsDisposed) return;
        logRefreshRunning = true;
        Task.Factory.StartNew(delegate
        {
            Dictionary<string, string> refreshed = null;
            try
            {
                refreshed = RefreshLogsWorker();
            }
            catch (Exception ex)
            {
                AddLauncherLog("刷新日志失败: " + ex.Message, "WARN");
            }
            BeginUi(delegate
            {
                logRefreshRunning = false;
                if (refreshed != null)
                {
                    lock (logLock)
                    {
                        foreach (KeyValuePair<string, string> kv in refreshed)
                        {
                            logTexts[kv.Key] = kv.Value;
                        }
                    }
                    UpdateActiveLogBox(false);
                }
            });
        });
    }

    private Dictionary<string, string> RefreshLogsWorker()
    {
        RefreshStartupLogPaths();
        Dictionary<string, string> result = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);

        string launcherLog = Path.Combine(logDir, "launcher-" + DateTime.Now.ToString("yyyyMMdd") + ".log");
        if (File.Exists(launcherLog))
        {
            result["launcher"] = ReadLauncherLogTail(launcherLog, 160);
        }

        string stdoutText = string.Empty;
        if (!string.IsNullOrWhiteSpace(latestStartupLog) && File.Exists(latestStartupLog))
        {
            stdoutText = ReadLauncherLogTail(latestStartupLog, 160);
        }

        string stderrText = string.Empty;
        if (!string.IsNullOrWhiteSpace(latestStartupErr) && File.Exists(latestStartupErr))
        {
            stderrText = ReadLauncherLogTail(latestStartupErr, 220);
        }

        string apiText = string.Empty;
        string apiError = string.Empty;
        try
        {
            string jsonText = HttpGet(ApiBase + "/server_log/tail?n=220", 1600);
            apiText = ParseServerLogTail(jsonText);
        }
        catch (Exception ex)
        {
            apiError = ex.Message;
            apiText = string.Empty;
        }
        if (string.IsNullOrWhiteSpace(apiText))
        {
            apiText = BuildServiceLogFallback(apiError, stdoutText, stderrText);
        }
        result["api"] = NormalizeLogText(apiText);
        result["stderr"] = BuildDiagnosticLogText(stderrText);

        return result;
    }

    private string BuildServiceLogFallback(string apiError, string stdoutText, string stderrText)
    {
        StringBuilder sb = new StringBuilder();
        if (!string.IsNullOrWhiteSpace(apiError))
        {
            sb.AppendLine("服务日志读取失败: " + apiError);
            sb.AppendLine("这通常表示服务未运行、正在启动，或 /server_log/tail 暂时不可用。");
        }
        else
        {
            sb.AppendLine("服务日志当前没有 API 业务内容。");
            sb.AppendLine("已隐藏 /health 和 /server_log/tail 自检请求。");
        }

        string diagnostic = ExtractImportantLogLines(stderrText, 80);
        if (string.IsNullOrWhiteSpace(diagnostic)) diagnostic = ExtractReadableLogTail(stderrText, 80);
        if (!string.IsNullOrWhiteSpace(diagnostic))
        {
            sb.AppendLine();
            sb.AppendLine("最近诊断/错误片段:");
            sb.AppendLine(diagnostic);
        }
        else
        {
            string startup = ExtractImportantLogLines(stdoutText, 60);
            if (string.IsNullOrWhiteSpace(startup)) startup = ExtractReadableLogTail(stdoutText, 60);
            if (!string.IsNullOrWhiteSpace(startup))
            {
                sb.AppendLine();
                sb.AppendLine("最近启动片段:");
                sb.AppendLine(startup);
            }
        }

        return sb.ToString().TrimEnd();
    }

    private string BuildDiagnosticLogText(string stderrText)
    {
        if (string.IsNullOrWhiteSpace(stderrText))
        {
            return "未发现当前诊断/错误日志。\r\n诊断/错误页读取服务 stderr，用来显示模型库 warning、TTS traceback、启动异常和关键耗时。";
        }

        string filtered = FilterDiagnosticLog(stderrText);
        if (string.IsNullOrWhiteSpace(filtered))
        {
            string path = string.IsNullOrWhiteSpace(latestStartupErr) ? "" : "\r\n原始文件: " + latestStartupErr;
            return "诊断/错误日志里目前只有动态百分比进度或空白输出，已在页面隐藏。" + path;
        }

        StringBuilder sb = new StringBuilder();
        sb.AppendLine(filtered.TrimEnd());
        sb.AppendLine();
        sb.Append("[launcher] 诊断/错误来自服务 stderr；页面已隐藏动态百分比进度条。");
        if (!string.IsNullOrWhiteSpace(latestStartupErr)) sb.Append(" 原始文件: ").Append(latestStartupErr);
        return sb.ToString();
    }

    private string FilterDiagnosticLog(string text)
    {
        string normalized = NormalizeLogText(text);
        string[] lines = Regex.Split(normalized, "\r?\n");
        StringBuilder sb = new StringBuilder();
        foreach (string line in lines)
        {
            if (IsDiagnosticProgressLine(line)) continue;
            sb.Append(line).Append("\r\n");
        }
        return Regex.Replace(sb.ToString(), "(\r\n){3,}", "\r\n\r\n").TrimEnd();
    }

    private string ExtractImportantLogLines(string text, int maxLines)
    {
        if (string.IsNullOrWhiteSpace(text)) return string.Empty;
        string filtered = FilterDiagnosticLog(text);
        string[] lines = Regex.Split(filtered, "\r?\n");
        List<string> important = new List<string>();
        foreach (string raw in lines)
        {
            string line = raw.TrimEnd();
            if (string.IsNullOrWhiteSpace(line)) continue;
            if (IsImportantLogLine(line)) important.Add(line);
        }
        if (important.Count == 0) return string.Empty;

        StringBuilder sb = new StringBuilder();
        int start = Math.Max(0, important.Count - maxLines);
        for (int i = start; i < important.Count; i++)
        {
            sb.Append(important[i]).Append("\r\n");
        }
        return sb.ToString().TrimEnd();
    }

    private string ExtractReadableLogTail(string text, int maxLines)
    {
        if (string.IsNullOrWhiteSpace(text)) return string.Empty;
        string filtered = FilterDiagnosticLog(text);
        string[] lines = Regex.Split(filtered, "\r?\n");
        List<string> readable = new List<string>();
        foreach (string raw in lines)
        {
            string line = raw.TrimEnd();
            if (!string.IsNullOrWhiteSpace(line)) readable.Add(line);
        }
        if (readable.Count == 0) return string.Empty;

        StringBuilder sb = new StringBuilder();
        int start = Math.Max(0, readable.Count - maxLines);
        for (int i = start; i < readable.Count; i++)
        {
            sb.Append(readable[i]).Append("\r\n");
        }
        return sb.ToString().TrimEnd();
    }

    private void RunWarmupWorker()
    {
        if (!string.Equals(versionKey, "vllm", StringComparison.OrdinalIgnoreCase))
        {
            ShowStartupSuccessBanner();
            return;
        }

        AddLauncherLog("检查 LEON 服务模型预热状态...");
        SetStatus("LEON 服务已启动，正在检查预热状态...", Color.Khaki);

        Dictionary<string, object> state = null;
        try
        {
            state = ParseJsonObject(HttpGet(ApiBase + "/warmup", 5000));
        }
        catch
        {
            state = null;
        }

        string stateStatus = GetDictString(state, "status");
        string stateVoice = GetDictString(state, "voice");
        bool alreadyWarm = stateStatus == "ok" || stateStatus == "already_warmed";
        if (alreadyWarm && WarmupVoiceMatchesPreferred(stateVoice))
        {
            CompleteTransition(true, "模型已预热，服务地址：" + ApiBase, Color.LightGreen);
            AddLauncherLog("模型已预热: status=" + stateStatus + ", voice=" + stateVoice);
            ShowStartupSuccessBanner();
            RequestLogRefresh();
            return;
        }

        if (stateStatus == "running")
        {
            CompleteTransition(true, "模型预热正在进行中...", Color.Khaki);
            AddLauncherLog("模型预热正在进行中。");
            RequestLogRefresh();
            return;
        }

        bool forceWarmup = alreadyWarm;
        if (forceWarmup)
        {
            AddLauncherLog("模型已预热但不是短剧解说音色，重新预热一次: voice=" + stateVoice, "WARN");
        }

        AddLauncherLog("开始请求 LEON 服务模型预热: voice=" + WarmupVoice + ", force=" + forceWarmup);
        CompleteTransition(true, "LEON 服务已启动，正在预热模型...", Color.Khaki);

        Dictionary<string, object> body = new Dictionary<string, object>();
        body["voice"] = WarmupVoice;
        body["text"] = WarmupText;
        body["force"] = forceWarmup;

        try
        {
            Dictionary<string, object> resp = ParseJsonObject(HttpPost(ApiBase + "/warmup", json.Serialize(body), 180000));
            string respStatus = GetDictString(resp, "status");
            string respVoice = GetDictString(resp, "voice");
            if (respStatus == "ok" || respStatus == "already_warmed")
            {
                CompleteTransition(true, "模型预热完成，服务地址：" + ApiBase, Color.LightGreen);
                AddLauncherLog("模型预热完成: status=" + respStatus + ", voice=" + respVoice);
                if (WarmupVoiceMatchesPreferred(respVoice))
                {
                    ShowStartupSuccessBanner();
                }
                else
                {
                    AddLauncherLog("模型预热完成，但返回音色不是短剧解说: voice=" + respVoice, "WARN");
                }
            }
            else
            {
                CompleteTransition(true, "预热返回: " + respStatus, Color.Khaki);
                AddLauncherLog("模型预热返回: " + json.Serialize(resp), "WARN");
            }
        }
        catch (Exception ex)
        {
            CompleteTransition(TestApiHealth(1200), "服务已启动，预热未完成，可稍后重试或直接使用。", Color.Khaki);
            AddLauncherLog("模型预热未完成: " + ex.Message + "。warmup=" + ApiBase + "/warmup", "WARN");
        }

        RequestLogRefresh();
    }

    private bool WarmupVoiceMatchesPreferred(string voice)
    {
        if (string.IsNullOrWhiteSpace(voice)) return false;
        string preferred = WarmupVoice.Replace('\\', '/');
        int slash = preferred.LastIndexOf('/');
        string preferredName = slash >= 0 ? preferred.Substring(slash + 1) : preferred;
        preferredName = Path.GetFileNameWithoutExtension(preferredName);
        if (string.IsNullOrWhiteSpace(preferredName)) return true;
        return voice.Replace('\\', '/').IndexOf(preferredName, StringComparison.OrdinalIgnoreCase) >= 0;
    }

    private void ShowStartupSuccessBanner()
    {
        if (startupSuccessBannerShown) return;
        startupSuccessBannerShown = true;
        string tavoScript = "http://" + lanHost + ":" + ApiPort + "/static/tavo.js?v=" + TavoCacheBust;
        AddLauncherLog(
            "\r\n" +
            "============================================================\r\n" +
            "                 L  E  O  N    启动成功\r\n" +
            "============================================================\r\n" +
            "本地 IndexTTS2 语音服务已经就绪，可以用了。\r\n" +
            "API  : " + ApiBase + "\r\n" +
            "LAN  : http://" + lanHost + ":" + ApiPort + "\r\n" +
            "Tavo : " + tavoScript + "\r\n" +
            "============================================================");
    }

    private void RunEnvironmentCheckAsync()
    {
        if (envCheckRunning)
        {
            AddLauncherLog("环境检测已经在运行，忽略重复点击。", "WARN");
            return;
        }

        string target = NormalizeVersionKey(envTargetKey);
        envCheckRunning = true;
        SyncEnvironmentButtons();
        SetStatus("正在检测 " + GetVersionLabel(target) + " 环境...", Color.Khaki);
        Task.Factory.StartNew(delegate
        {
            List<EnvRow> rows;
            try
            {
                rows = BuildEnvironmentRows(target);
                envRowsByVersion[target] = rows;
                envCompletedVersions.Add(target);
                AddLauncherLog(GetVersionLabel(target) + " 环境检测完成。");
            }
            catch (Exception ex)
            {
                rows = new List<EnvRow>();
                rows.Add(new EnvRow("检测目标", "INFO", GetVersionLabel(target)));
                rows.Add(new EnvRow("环境检测", "FAIL", ex.Message));
                envRowsByVersion[target] = rows;
                envCompletedVersions.Add(target);
                AddLauncherLog(GetVersionLabel(target) + " 环境检测失败: " + ex.Message, "ERROR");
            }
            finally
            {
                BeginUi(delegate
                {
                    envCheckRunning = false;
                    SyncEnvironmentButtons();
                });
            }

            BeginUi(delegate
            {
                ApplyEnvironmentRows(rows);
                SetStatus(GetVersionLabel(target) + " 环境检测完成。", Color.LightGreen);
            });
        });
    }

    private void RepairEnvironmentAsync()
    {
        if (envRepairRunning)
        {
            AddLauncherLog("环境修复已经在运行，忽略重复点击。", "WARN");
            return;
        }

        string target = NormalizeVersionKey(envTargetKey);
        if (!envCompletedVersions.Contains(target))
        {
            AddLauncherLog(GetVersionLabel(target) + " 一键修复已取消：先点开始检测。", "WARN");
            List<EnvRow> rows = GetEnvironmentRowsForDisplay(target);
            rows.Add(new EnvRow("一键修复", "WAIT", "先点开始检测，再点一键修复。"));
            ApplyEnvironmentRows(rows);
            SetStatus("先检测 " + GetVersionLabel(target) + "，再修复。", Color.Khaki);
            return;
        }

        envRepairRunning = true;
        SyncEnvironmentButtons();
        SetStatus("正在执行 " + GetVersionLabel(target) + " 一键修复...", Color.Khaki);
        Task.Factory.StartNew(delegate
        {
            List<EnvRow> rows = GetEnvironmentRowsForDisplay(target);
            List<EnvRow> repairRows = new List<EnvRow>(rows);
            try
            {
                foreach (EnvRow row in RunEnvironmentRepair(target, rows))
                {
                    repairRows.Add(row);
                }
                envRowsByVersion[target] = repairRows;
                AddLauncherLog(GetVersionLabel(target) + " 一键修复流程已执行。");
            }
            catch (Exception ex)
            {
                repairRows.Add(new EnvRow("一键修复", "FAIL", ex.Message));
                envRowsByVersion[target] = repairRows;
                AddLauncherLog(GetVersionLabel(target) + " 一键修复失败: " + ex.Message, "ERROR");
            }
            finally
            {
                BeginUi(delegate
                {
                    envRepairRunning = false;
                    SyncEnvironmentButtons();
                });
            }

            BeginUi(delegate
            {
                ApplyEnvironmentRows(repairRows);
                SetStatus(GetVersionLabel(target) + " 修复流程已执行，建议重新检测。", Color.LightGreen);
            });
        });
    }

    private void ApplyEnvironmentRows(List<EnvRow> rows)
    {
        if (envGrid == null || envGrid.IsDisposed) return;
        envGrid.Rows.Clear();
        foreach (EnvRow row in rows)
        {
            int index = envGrid.Rows.Add(row.Name, row.Status, row.Detail);
            DataGridViewRow gridRow = envGrid.Rows[index];
            if (row.Status == "FAIL")
            {
                gridRow.DefaultCellStyle.ForeColor = Color.LightCoral;
            }
            else if (row.Status == "WARN" || row.Status == "WAIT")
            {
                gridRow.DefaultCellStyle.ForeColor = Color.Khaki;
            }
            else if (row.Status == "OK" || row.Status == "RUN")
            {
                gridRow.DefaultCellStyle.ForeColor = Color.LightGreen;
            }
            else if (row.Status == "INFO" || row.Status == "FREE")
            {
                gridRow.DefaultCellStyle.ForeColor = Color.FromArgb(205, 214, 224);
            }
        }
    }

    private void SetEnvironmentTarget(string key, bool userAction)
    {
        envTargetKey = NormalizeVersionKey(key);
        SyncEnvironmentButtons();
        ApplyEnvironmentRows(GetEnvironmentRowsForDisplay(envTargetKey));
        if (userAction)
        {
            AddLauncherLog("环境检测目标已切换到 " + GetVersionLabel(envTargetKey) + "。");
            SetStatus("环境检测目标：" + GetVersionLabel(envTargetKey), Color.Khaki);
        }
    }

    private void SyncEnvironmentButtons()
    {
        StyleVersionButton(envVllmButton, envTargetKey == "vllm");
        StyleVersionButton(envFast6gButton, envTargetKey == "fast6g");
        if (envCheckButton != null)
        {
            envCheckButton.Enabled = !envCheckRunning && !envRepairRunning;
            envCheckButton.Text = envCheckRunning ? "检测中..." : "开始检测";
        }
        if (envRepairButton != null)
        {
            envRepairButton.Enabled = !envCheckRunning && !envRepairRunning;
            envRepairButton.Text = envRepairRunning ? "修复中..." : "一键修复";
        }
    }

    private List<EnvRow> GetEnvironmentRowsForDisplay(string key)
    {
        key = NormalizeVersionKey(key);
        List<EnvRow> rows;
        if (envRowsByVersion.TryGetValue(key, out rows))
        {
            return new List<EnvRow>(rows);
        }

        rows = new List<EnvRow>();
        rows.Add(new EnvRow("检测目标", "INFO", GetVersionLabel(key)));
        rows.Add(new EnvRow("检测状态", "WAIT", "未检测。点开始检测只检查当前版本。"));
        rows.Add(new EnvRow("启动脚本", "WAIT", GetStartupBat(key)));
        rows.Add(new EnvRow("项目 Python Runtime", "WAIT", GetRuntimePython(key)));
        if (key == "vllm")
        {
            rows.Add(new EnvRow("vLLM 专属项", "WAIT", "CUDA Toolkit / MSVC / SVML / vLLM 插件"));
        }
        else
        {
            rows.Add(new EnvRow("6G 专属项", "WAIT", "DeepSpeed 6G 加速 / fast6g runtime"));
        }
        return rows;
    }

    private List<EnvRow> BuildEnvironmentRows(string key)
    {
        key = NormalizeVersionKey(key);
        string targetRoot = GetVersionRoot(key);
        string targetPython = GetRuntimePython(key);
        string targetStartupBat = GetStartupBat(key);
        string targetLogDir = GetVersionLogDir(key);
        string targetStartupLog = FindLatestFile(targetLogDir, "api_restart_stable_*.log");
        string targetStartupErr = FindLatestFile(targetLogDir, "api_restart_stable_*.err");

        List<EnvRow> rows = new List<EnvRow>();
        rows.Add(new EnvRow("检测目标", "INFO", GetVersionLabel(key)));
        rows.Add(new EnvRow("项目目录", Directory.Exists(workspaceRoot) ? "OK" : "FAIL", workspaceRoot));
        rows.Add(new EnvRow("版本目录", Directory.Exists(targetRoot) ? "OK" : "FAIL", targetRoot));
        rows.Add(new EnvRow("启动脚本", File.Exists(targetStartupBat) ? "OK" : "FAIL", targetStartupBat));
        rows.Add(new EnvRow("项目 Python Runtime", File.Exists(targetPython) ? "OK" : "FAIL", GetPythonVersion(targetPython)));
        rows.Add(new EnvRow("静态资源目录", Directory.Exists(staticDir) ? "OK" : "FAIL", staticDir));
        rows.Add(new EnvRow("首页图", File.Exists(Path.Combine(launcherDir, "home.png")) ? "OK" : "WARN", Path.Combine(launcherDir, "home.png")));
        rows.Add(new EnvRow("横幅图", File.Exists(Path.Combine(launcherDir, "head.png")) ? "OK" : "WARN", Path.Combine(launcherDir, "head.png")));
        rows.Add(new EnvRow("左侧图", File.Exists(Path.Combine(launcherDir, "left.png")) ? "OK" : "WARN", Path.Combine(launcherDir, "left.png")));

        rows.Add(new EnvRow("管理员权限", IsAdmin() ? "OK" : "WARN", IsAdmin() ? "已用管理员权限运行，可安装系统组件。" : "不是管理员。检测可用，winget 安装或系统级修复可能需要提权。"));
        rows.Add(new EnvRow("项目路径中文检查", PathHasChinese(workspaceRoot) ? "FAIL" : "OK", PathHasChinese(workspaceRoot) ? "当前路径包含中文，CUDA/ninja 编译容易失败。建议移动到纯英文路径。" : "路径未包含中文，适合 CUDA/ninja 编译。"));

        AddGpuRows(rows);
        if (key == "vllm")
        {
            AddVllmEnvironmentRows(rows, targetRoot, targetPython);
        }
        else
        {
            AddFast6gEnvironmentRows(rows, targetRoot, targetPython);
        }

        List<int> portPids = GetListeningPidsForPort(ApiPort);
        bool healthOk = TestApiHealth(1300);
        rows.Add(new EnvRow("API 端口 9880", portPids.Count > 0 ? "RUN" : "FREE", portPids.Count > 0 ? "监听 PID: " + string.Join(", ", ToStringArray(portPids)) : "端口未监听"));
        rows.Add(new EnvRow("API 健康检查", healthOk ? "OK" : "WAIT", healthOk ? ApiBase + "/health 正常" : "服务未启动或还在加载"));
        rows.Add(new EnvRow("日志目录", Directory.Exists(targetLogDir) ? "OK" : "INFO", targetLogDir));
        rows.Add(new EnvRow("服务启动日志", !string.IsNullOrWhiteSpace(targetStartupLog) ? "OK" : "INFO", string.IsNullOrWhiteSpace(targetStartupLog) ? "暂无 api_restart_stable_*.log" : targetStartupLog));
        rows.Add(new EnvRow("诊断日志", !string.IsNullOrWhiteSpace(targetStartupErr) ? "OK" : "INFO", string.IsNullOrWhiteSpace(targetStartupErr) ? "暂无 api_restart_stable_*.err" : targetStartupErr));
        return rows;
    }

    private void AddGpuRows(List<EnvRow> rows)
    {
        string nvidia = GetCommandPath("nvidia-smi.exe");
        if (string.IsNullOrWhiteSpace(nvidia))
        {
            rows.Add(new EnvRow("NVIDIA 显卡/驱动", "FAIL", "找不到 nvidia-smi。需要 NVIDIA 显卡和正常驱动。"));
            return;
        }

        CaptureResult gpu = RunCapture(nvidia, "--query-gpu=name,memory.total,driver_version --format=csv,noheader", workspaceRoot, null, 10);
        rows.Add(new EnvRow("NVIDIA 显卡/驱动", gpu.ExitCode == 0 ? "OK" : "FAIL", gpu.ExitCode == 0 ? FirstUsefulLine(gpu.Stdout) : Shorten(gpu.Stderr)));
    }

    private void AddVllmEnvironmentRows(List<EnvRow> rows, string targetRoot, string targetPython)
    {
        string cudaPath = GetCudaToolkitPath();
        if (!string.IsNullOrWhiteSpace(cudaPath))
        {
            CaptureResult nvcc = RunCapture(Path.Combine(cudaPath, "bin\\nvcc.exe"), "-V", targetRoot, null, 10);
            rows.Add(new EnvRow("CUDA Toolkit / nvcc", nvcc.ExitCode == 0 ? "OK" : "WARN", nvcc.ExitCode == 0 ? FirstMatchingLine(nvcc.Stdout + "\n" + nvcc.Stderr, "release") : "找到 CUDA 目录但 nvcc 执行失败: " + cudaPath));
        }
        else
        {
            rows.Add(new EnvRow("CUDA Toolkit / nvcc", "WARN", "未找到 CUDA Toolkit。Torch 自带 CUDA 可运行，但 BigVGAN CUDA kernel 编译需要 nvcc。"));
        }

        string clPath = GetMsvcClPath();
        rows.Add(new EnvRow("MSVC C++ Build Tools", string.IsNullOrWhiteSpace(clPath) ? "WARN" : "OK", string.IsNullOrWhiteSpace(clPath) ? "未找到 cl.exe。BigVGAN CUDA kernel 编译可能失败。" : "cl.exe: " + clPath));

        RuntimeProbe probe = ProbeRuntime(targetPython, targetRoot, "torch,torchaudio,vllm,fastapi,uvicorn,ninja,triton", 60);
        if (!File.Exists(targetPython))
        {
            rows.Add(new EnvRow("Python 包 / Torch CUDA / vLLM", "FAIL", "缺少 runtime python。"));
        }
        else if (probe.ExitCode != 0 || probe.Info == null)
        {
            rows.Add(new EnvRow("Python 包 / Torch CUDA / vLLM", "FAIL", Shorten(probe.Text)));
        }
        else
        {
            List<string> bad = new List<string>();
            foreach (string name in new[] { "torch", "torchaudio", "vllm", "fastapi", "uvicorn", "ninja" })
            {
                string value = GetDictString(probe.Info, name);
                if (value.StartsWith("ERROR:", StringComparison.OrdinalIgnoreCase)) bad.Add(name + "=" + value);
            }
            bool cudaAvailable = string.Equals(GetDictString(probe.Info, "torch_cuda_available"), "True", StringComparison.OrdinalIgnoreCase);
            string status = bad.Count == 0 && cudaAvailable ? "OK" : (bad.Count == 0 ? "WARN" : "FAIL");
            string detail = bad.Count > 0
                ? string.Join("; ", bad.ToArray())
                : "torch=" + GetDictString(probe.Info, "torch") + "; cuda=" + GetDictString(probe.Info, "torch_cuda_version") + "; gpu=" + GetDictString(probe.Info, "torch_gpu") + "; vllm=" + GetDictString(probe.Info, "vllm") + "; ninja=" + GetDictString(probe.Info, "ninja");
            rows.Add(new EnvRow("Python 包 / Torch CUDA / vLLM", status, detail));
        }

        string svml = FindSvmlDll(targetPython);
        bool runtimeImportOk = probe.Info != null &&
            !GetDictString(probe.Info, "torch").StartsWith("ERROR:", StringComparison.OrdinalIgnoreCase) &&
            !GetDictString(probe.Info, "vllm").StartsWith("ERROR:", StringComparison.OrdinalIgnoreCase);
        if (!string.IsNullOrWhiteSpace(svml))
        {
            rows.Add(new EnvRow("Intel SVML 兼容兜底", "OK", "运行时可解析 svml_dispmd.dll: " + svml));
        }
        else if (runtimeImportOk)
        {
            rows.Add(new EnvRow("Intel SVML 兼容兜底", "OK", "未发现独立 svml_dispmd.dll，但当前 runtime 可 import torch/vllm；无需修复。"));
        }
        else if (SvmlRepairNeeded(probe.Text))
        {
            rows.Add(new EnvRow("Intel SVML 兼容兜底", "FAIL", "runtime import 失败且命中 SVML/LLVM/DLL 加载问题，可用一键修复复制随包 DLL。"));
        }
        else
        {
            rows.Add(new EnvRow("Intel SVML 兼容兜底", "WARN", "未发现独立 svml_dispmd.dll，但当前未证明它是启动阻塞项。"));
        }

        if (File.Exists(targetPython))
        {
            CaptureResult patch = RunPythonSnippet(targetPython, targetRoot, "import patch_vllm; print('patch_vllm OK')", 60);
            rows.Add(new EnvRow("vLLM 插件 / GPT2TTSModel 注册", patch.ExitCode == 0 && patch.Stdout.IndexOf("OK", StringComparison.OrdinalIgnoreCase) >= 0 ? "OK" : "FAIL", patch.ExitCode == 0 ? Shorten(patch.Stdout) : Shorten(patch.Stdout + "\n" + patch.Stderr)));
        }

        AddRequiredModelRows(rows, targetRoot);
    }

    private void AddFast6gEnvironmentRows(List<EnvRow> rows, string targetRoot, string targetPython)
    {
        RuntimeProbe probe = ProbeRuntime(targetPython, targetRoot, "torch,torchaudio,deepspeed,fastapi,uvicorn", 60);
        if (!File.Exists(targetPython))
        {
            rows.Add(new EnvRow("Python 包 / Torch CUDA / 6G", "FAIL", "缺少 runtime python。"));
        }
        else if (probe.ExitCode != 0 || probe.Info == null)
        {
            rows.Add(new EnvRow("Python 包 / Torch CUDA / 6G", "FAIL", Shorten(probe.Text)));
        }
        else
        {
            List<string> bad = new List<string>();
            foreach (string name in new[] { "torch", "torchaudio", "fastapi", "uvicorn" })
            {
                string value = GetDictString(probe.Info, name);
                if (value.StartsWith("ERROR:", StringComparison.OrdinalIgnoreCase)) bad.Add(name + "=" + value);
            }
            bool cudaAvailable = string.Equals(GetDictString(probe.Info, "torch_cuda_available"), "True", StringComparison.OrdinalIgnoreCase);
            string status = bad.Count == 0 && cudaAvailable ? "OK" : (bad.Count == 0 ? "WARN" : "FAIL");
            string detail = bad.Count > 0
                ? string.Join("; ", bad.ToArray())
                : "torch=" + GetDictString(probe.Info, "torch") + "; cuda=" + GetDictString(probe.Info, "torch_cuda_version") + "; gpu=" + GetDictString(probe.Info, "torch_gpu");
            rows.Add(new EnvRow("Python 包 / Torch CUDA / 6G", status, detail));
        }

        string dsValue = probe.Info == null ? string.Empty : GetDictString(probe.Info, "deepspeed");
        bool dsOk = !string.IsNullOrWhiteSpace(dsValue) && !dsValue.StartsWith("ERROR:", StringComparison.OrdinalIgnoreCase);
        string wheel = Path.Combine(targetRoot, "deepspeed-0.17.1+unknown-cp312-cp312-win_amd64.whl");
        rows.Add(new EnvRow("DeepSpeed 6G 加速", dsOk ? "OK" : (File.Exists(wheel) ? "WARN" : "FAIL"), dsOk ? "deepspeed=" + dsValue : (File.Exists(wheel) ? "可用随包 wheel 修复: " + wheel : "缺少 deepspeed，且未找到随包 wheel。")));
        rows.Add(new EnvRow("6G API 文件", File.Exists(Path.Combine(targetRoot, "indextts2_api.py")) ? "OK" : "FAIL", Path.Combine(targetRoot, "indextts2_api.py")));
        rows.Add(new EnvRow("6G 推理文件", File.Exists(Path.Combine(targetRoot, "indextts\\infer_v2.py")) ? "OK" : "FAIL", Path.Combine(targetRoot, "indextts\\infer_v2.py")));
        AddRequiredModelRows(rows, targetRoot);
    }

    private void AddRequiredModelRows(List<EnvRow> rows, string targetRoot)
    {
        string[] required = new[] { "checkpoints\\config.yaml", "checkpoints\\gpt.pth", "checkpoints\\s2mel.pth", "checkpoints\\bpe.model", "checkpoints\\wav2vec2bert_stats.pt" };
        List<string> missing = new List<string>();
        foreach (string rel in required)
        {
            if (!File.Exists(Path.Combine(targetRoot, rel))) missing.Add(rel);
        }
        rows.Add(new EnvRow("模型文件", missing.Count == 0 ? "OK" : "FAIL", missing.Count == 0 ? "核心 checkpoint 文件存在。" : "缺少: " + string.Join(", ", missing.ToArray())));
    }

    private List<EnvRow> RunEnvironmentRepair(string key, List<EnvRow> latestRows)
    {
        key = NormalizeVersionKey(key);
        List<EnvRow> rows = new List<EnvRow>();
        if (key == "vllm")
        {
            rows.AddRange(RunVllmRepair(latestRows));
        }
        else
        {
            rows.AddRange(RunFast6gRepair());
        }
        return rows;
    }

    private List<EnvRow> RunVllmRepair(List<EnvRow> latestRows)
    {
        List<EnvRow> rows = new List<EnvRow>();
        string targetPython = GetRuntimePython("vllm");
        if (HasFailedOrWarn(latestRows, "Intel SVML"))
        {
            string source = FindBundledSvmlDll();
            string target = GetSvmlRepairTarget(targetPython);
            if (!string.IsNullOrWhiteSpace(source) && !string.IsNullOrWhiteSpace(target))
            {
                try
                {
                    File.Copy(source, target, true);
                    rows.Add(new EnvRow("修复 / SVML", "OK", "已复制 svml_dispmd.dll 到 " + target));
                }
                catch (Exception ex)
                {
                    rows.Add(new EnvRow("修复 / SVML", "FAIL", ex.Message));
                }
            }
            else
            {
                rows.Add(new EnvRow("修复 / SVML", "WARN", "未找到随包 svml_dispmd.dll 或 runtime 目标目录。"));
            }
        }
        else
        {
            rows.Add(new EnvRow("修复 / SVML", "INFO", "最近一次检测未显示 SVML 阻塞，跳过。"));
        }

        if (HasFailedOrWarn(latestRows, "MSVC"))
        {
            rows.Add(RunWingetRepairRow("修复 / MSVC Build Tools", "Microsoft.VisualStudio.2022.BuildTools", "--override \"--quiet --wait --norestart --add Microsoft.VisualStudio.Workload.VCTools --includeRecommended\""));
        }
        else
        {
            rows.Add(new EnvRow("修复 / MSVC Build Tools", "INFO", "最近一次检测未显示 MSVC 缺失，跳过。"));
        }

        if (HasFailedOrWarn(latestRows, "CUDA Toolkit"))
        {
            rows.Add(RunWingetRepairRow("修复 / CUDA Toolkit", "Nvidia.CUDA", string.Empty));
        }
        else
        {
            rows.Add(new EnvRow("修复 / CUDA Toolkit", "INFO", "最近一次检测未显示 CUDA Toolkit 缺失，跳过。"));
        }

        if (File.Exists(targetPython) && HasFailedOrWarn(latestRows, "ninja"))
        {
            CaptureResult pip = RunCapture(targetPython, "-m pip install ninja", GetVersionRoot("vllm"), GetRuntimeEnv(targetPython, GetVersionRoot("vllm")), 240);
            rows.Add(new EnvRow("修复 / ninja", pip.ExitCode == 0 ? "OK" : "FAIL", pip.ExitCode == 0 ? "pip install ninja 已执行。" : Shorten(pip.Stdout + "\n" + pip.Stderr)));
        }
        return rows;
    }

    private List<EnvRow> RunFast6gRepair()
    {
        List<EnvRow> rows = new List<EnvRow>();
        string targetRoot = GetVersionRoot("fast6g");
        string targetPython = GetRuntimePython("fast6g");
        string wheel = Path.Combine(targetRoot, "deepspeed-0.17.1+unknown-cp312-cp312-win_amd64.whl");
        if (!File.Exists(targetPython))
        {
            rows.Add(new EnvRow("修复 / DeepSpeed", "FAIL", "缺少 fast6g runtime python。"));
            return rows;
        }
        if (!File.Exists(wheel))
        {
            rows.Add(new EnvRow("修复 / DeepSpeed", "FAIL", "未找到随包 wheel: " + wheel));
            return rows;
        }

        CaptureResult pip = RunCapture(targetPython, "-m pip install " + QuoteCmdArgument(wheel), targetRoot, GetRuntimeEnv(targetPython, targetRoot), 240);
        rows.Add(new EnvRow("修复 / DeepSpeed", pip.ExitCode == 0 ? "OK" : "FAIL", pip.ExitCode == 0 ? "已安装随包 DeepSpeed wheel。" : Shorten(pip.Stdout + "\n" + pip.Stderr)));
        return rows;
    }

    private void ShowView(string view)
    {
        activeView = view;
        homePanel.Visible = view == "home";
        logPanel.Visible = view == "log";
        configPanel.Visible = view == "config";
        envPanel.Visible = view == "env";
        if (homePanel.Visible) homePanel.BringToFront();
        if (logPanel.Visible) logPanel.BringToFront();
        if (configPanel.Visible) configPanel.BringToFront();
        if (envPanel.Visible) envPanel.BringToFront();
        SyncNavButtons();
        if (view == "log")
        {
            RequestLogRefresh();
            UpdateActiveLogBox(false);
        }
    }

    private void SetLogTabActive(string key)
    {
        activeLogTab = key;
        StyleLogTab(tabLauncherButton, key == "launcher");
        StyleLogTab(tabApiButton, key == "api");
        StyleLogTab(tabStderrButton, key == "stderr");
        UpdateActiveLogBox(true);
    }

    private void UpdateActiveLogBox(bool forceScroll)
    {
        if (logBox == null || logBox.IsDisposed) return;

        string text;
        lock (logLock)
        {
            if (!logTexts.TryGetValue(activeLogTab, out text)) text = string.Empty;
        }
        if (string.IsNullOrWhiteSpace(text)) text = "暂无日志。";
        SetLogBoxText(text, forceScroll);
    }

    private void SetLogBoxText(string text, bool forceScroll)
    {
        if (logBox == null || logBox.IsDisposed) return;
        int previousStart = logBox.SelectionStart;
        int previousLength = logBox.SelectionLength;
        bool wasAtBottom = logBox.SelectionStart >= Math.Max(0, logBox.TextLength - 2);
        if (string.Equals(logBox.Text, text, StringComparison.Ordinal)) return;

        logBox.Text = text ?? string.Empty;
        if (forceScroll || wasAtBottom)
        {
            logBox.SelectionStart = logBox.TextLength;
            logBox.SelectionLength = 0;
            logBox.ScrollToCaret();
        }
        else
        {
            logBox.SelectionStart = Math.Min(previousStart, logBox.TextLength);
            logBox.SelectionLength = Math.Min(previousLength, Math.Max(0, logBox.TextLength - logBox.SelectionStart));
        }
    }

    private void CopyActiveLogToClipboard(bool all)
    {
        if (logBox == null || logBox.IsDisposed) return;
        string text = all || string.IsNullOrEmpty(logBox.SelectedText) ? logBox.Text : logBox.SelectedText;
        if (string.IsNullOrWhiteSpace(text))
        {
            SetStatus("当前日志为空。", Color.Khaki);
            return;
        }

        try
        {
            Clipboard.SetText(text);
            SetStatus(all ? "当前日志已复制。" : "选中日志已复制。", Color.LightGreen);
        }
        catch (Exception ex)
        {
            AddLauncherLog("复制日志失败: " + ex.Message, "WARN");
            SetStatus("复制日志失败，请看启动器日志。", Color.LightCoral);
        }
    }

    private void SetVersion(string key, bool userAction)
    {
        if (!string.Equals(key, "fast6g", StringComparison.OrdinalIgnoreCase))
        {
            key = "vllm";
        }

        versionKey = key;
        versionRoot = Path.Combine(workspaceRoot, key);
        runtimePython = Path.Combine(versionRoot, "indextts2runtime\\python.exe");
        startupBat = Path.Combine(scriptsDir, string.Equals(key, "fast6g", StringComparison.OrdinalIgnoreCase) ? "start-fast6g-api.bat" : "start-vllm-api.bat");
        logDir = Path.Combine(workspaceRoot, "logs", key);
        latestStartupLog = null;
        latestStartupErr = null;

        if (ratioBox != null)
        {
            ratioBox.Visible = string.Equals(versionKey, "vllm", StringComparison.OrdinalIgnoreCase);
            ratioBox.Enabled = ratioBox.Visible;
        }

        SyncVersionUi();
        if (userAction)
        {
            SetEnvironmentTarget(key, false);
        }
        if (userAction)
        {
            AddLauncherLog("已切换到 " + GetVersionLabel() + "。");
            SetStatus("已切换到 " + GetVersionLabel() + "。", Color.Khaki);
        }
    }

    private void SyncVersionUi()
    {
        StyleVersionButton(vllmButton, versionKey == "vllm");
        StyleVersionButton(fast6gButton, versionKey == "fast6g");
        if (ratioBox != null)
        {
            ratioBox.Visible = versionKey == "vllm";
            ratioBox.Enabled = ratioBox.Visible;
            ratioBox.Text = GetRatioText();
        }
    }

    private void SyncNavButtons()
    {
        StyleNavButton(navHomeButton, activeView == "home");
        StyleNavButton(navLogButton, activeView == "log");
        StyleNavButton(navConfigButton, activeView == "config");
        StyleNavButton(navEnvButton, activeView == "env");
    }

    private void UpdateStartButtonState(bool running)
    {
        lastHealthRunning = running;
        if (startButton == null || startButton.IsDisposed) return;
        if (running)
        {
            startButton.Text = "停止 LEON 服务";
            startButton.BackColor = Color.FromArgb(142, 62, 54);
            startButton.FlatAppearance.BorderColor = Color.FromArgb(205, 115, 100);
        }
        else
        {
            startButton.Text = "启动 LEON 服务";
            startButton.BackColor = Color.FromArgb(25, 126, 89);
            startButton.FlatAppearance.BorderColor = Color.FromArgb(95, 185, 140);
        }
        startButton.Enabled = true;
    }

    private void SetServiceButtonBusy(string text)
    {
        if (startButton == null || startButton.IsDisposed) return;
        startButton.Text = text;
        startButton.Enabled = true;
        startButton.BackColor = Color.FromArgb(138, 96, 38);
        startButton.FlatAppearance.BorderColor = Color.FromArgb(176, 140, 62);
    }

    private void CompleteTransition(bool running, string message, Color color)
    {
        BeginUi(delegate
        {
            serviceTransition = false;
            lastHealthRunning = running;
            UpdateStartButtonState(running);
            SetStatus(message, color);
        });
    }

    private void SetStatus(string text, Color color)
    {
        if (statusLabel != null && statusLabel.InvokeRequired)
        {
            BeginUi(delegate { SetStatus(text, color); });
            return;
        }
        if (statusLabel == null || statusLabel.IsDisposed) return;
        statusLabel.Text = text;
        statusLabel.ForeColor = color;
    }

    private void AddLauncherLog(string message)
    {
        AddLauncherLog(message, "INFO");
    }

    private void AddLauncherLog(string message, string level)
    {
        string line = "[" + DateTime.Now.ToString("HH:mm:ss") + "] [" + level + "] " + message;
        lock (logLock)
        {
            string existing;
            if (!logTexts.TryGetValue("launcher", out existing)) existing = string.Empty;
            logTexts["launcher"] = TrimLogText(existing + line + Environment.NewLine, 600);
        }

        try
        {
            Directory.CreateDirectory(logDir);
            string path = Path.Combine(logDir, "launcher-" + DateTime.Now.ToString("yyyyMMdd") + ".log");
            File.AppendAllText(path, line + Environment.NewLine, new UTF8Encoding(false));
        }
        catch
        {
        }

        BeginUi(delegate
        {
            if (activeLogTab == "launcher") UpdateActiveLogBox(true);
        });
    }

    private void ClearLauncherSessionLogs()
    {
        foreach (string key in new[] { "vllm", "fast6g" })
        {
            try
            {
                string dir = GetVersionLogDir(key);
                Directory.CreateDirectory(dir);
                string path = Path.Combine(dir, "launcher-" + DateTime.Now.ToString("yyyyMMdd") + ".log");
                File.WriteAllText(path, string.Empty, new UTF8Encoding(false));
            }
            catch
            {
            }
        }

        lock (logLock)
        {
            logTexts["launcher"] = string.Empty;
        }
    }

    private void RefreshStartupLogPaths()
    {
        latestStartupLog = FindLatestFile(logDir, "api_restart_stable_*.log");
        latestStartupErr = FindLatestFile(logDir, "api_restart_stable_*.err");
    }

    private bool TestApiHealth(int timeoutMs)
    {
        try
        {
            HttpGet(ApiBase + "/health", timeoutMs);
            return true;
        }
        catch
        {
            return false;
        }
    }

    private string HttpGet(string url, int timeoutMs)
    {
        HttpWebRequest request = (HttpWebRequest)WebRequest.Create(url);
        request.Method = "GET";
        request.Accept = "application/json";
        request.Timeout = Math.Max(500, timeoutMs);
        request.ReadWriteTimeout = Math.Max(500, timeoutMs);
        request.Proxy = null;
        using (WebResponse response = request.GetResponse())
        using (Stream stream = response.GetResponseStream())
        using (MemoryStream memory = new MemoryStream())
        {
            if (stream != null) stream.CopyTo(memory);
            return Encoding.UTF8.GetString(memory.ToArray());
        }
    }

    private string HttpPost(string url, string body, int timeoutMs)
    {
        byte[] bodyBytes = new UTF8Encoding(false).GetBytes(body ?? string.Empty);
        HttpWebRequest request = (HttpWebRequest)WebRequest.Create(url);
        request.Method = "POST";
        request.Accept = "application/json";
        request.ContentType = "application/json; charset=utf-8";
        request.ContentLength = bodyBytes.Length;
        request.Timeout = Math.Max(500, timeoutMs);
        request.ReadWriteTimeout = Math.Max(500, timeoutMs);
        request.Proxy = null;
        using (Stream requestStream = request.GetRequestStream())
        {
            requestStream.Write(bodyBytes, 0, bodyBytes.Length);
        }
        using (WebResponse response = request.GetResponse())
        using (Stream stream = response.GetResponseStream())
        using (MemoryStream memory = new MemoryStream())
        {
            if (stream != null) stream.CopyTo(memory);
            return Encoding.UTF8.GetString(memory.ToArray());
        }
    }

    private Dictionary<string, object> ParseJsonObject(string text)
    {
        if (string.IsNullOrWhiteSpace(text)) return new Dictionary<string, object>();
        Dictionary<string, object> dict = json.DeserializeObject(text) as Dictionary<string, object>;
        return dict ?? new Dictionary<string, object>();
    }

    private string ParseServerLogTail(string jsonText)
    {
        if (string.IsNullOrWhiteSpace(jsonText)) return string.Empty;
        object parsed = json.DeserializeObject(jsonText);
        Dictionary<string, object> root = parsed as Dictionary<string, object>;
        if (root == null || !root.ContainsKey("lines")) return string.Empty;

        IEnumerable lines = root["lines"] as IEnumerable;
        if (lines == null || root["lines"] is string) return string.Empty;

        StringBuilder sb = new StringBuilder();
        foreach (object item in lines)
        {
            Dictionary<string, object> lineObj = item as Dictionary<string, object>;
            if (lineObj == null) continue;

            string text = GetDictString(lineObj, "line");
            if (IsNoisyServerLogLine(text)) continue;

            string stream = GetDictString(lineObj, "stream");
            string ts = "--:--:--";
            object rawTs;
            if (lineObj.TryGetValue("ts", out rawTs))
            {
                long unix;
                if (long.TryParse(Convert.ToString(rawTs), out unix))
                {
                    try
                    {
                        DateTime local = new DateTime(1970, 1, 1, 0, 0, 0, DateTimeKind.Utc).AddSeconds(unix).ToLocalTime();
                        ts = local.ToString("HH:mm:ss");
                    }
                    catch
                    {
                    }
                }
            }
            sb.Append("[").Append(ts).Append("] [").Append(stream).Append("] ").Append(text).Append("\r\n");
        }
        return sb.ToString();
    }

    private List<int> GetListeningPidsForPort(int port)
    {
        List<int> pids = new List<int>();
        try
        {
            ProcessStartInfo psi = new ProcessStartInfo();
            psi.FileName = "netstat.exe";
            psi.Arguments = "-ano -p tcp";
            psi.UseShellExecute = false;
            psi.RedirectStandardOutput = true;
            psi.RedirectStandardError = true;
            psi.CreateNoWindow = true;

            using (Process proc = Process.Start(psi))
            {
                if (proc == null) return pids;
                string output = proc.StandardOutput.ReadToEnd();
                proc.WaitForExit(4000);
                string[] lines = output.Split(new[] { '\r', '\n' }, StringSplitOptions.RemoveEmptyEntries);
                foreach (string line in lines)
                {
                    if (line.IndexOf("LISTENING", StringComparison.OrdinalIgnoreCase) < 0) continue;
                    string[] parts = Regex.Split(line.Trim(), "\\s+");
                    if (parts.Length < 5) continue;
                    if (!parts[1].EndsWith(":" + port, StringComparison.OrdinalIgnoreCase)) continue;
                    int pid;
                    if (int.TryParse(parts[parts.Length - 1], out pid) && pid > 0 && !pids.Contains(pid))
                    {
                        pids.Add(pid);
                    }
                }
            }
        }
        catch
        {
        }
        pids.Sort();
        return pids;
    }

    private List<int> GetLauncherBackendWrapperPids()
    {
        List<int> matches = new List<int>();
        List<string> needles = new List<string>();
        needles.Add(startupBat);
        needles.Add(Path.Combine(scriptsDir, "start-vllm-api.bat"));
        needles.Add(Path.Combine(scriptsDir, "start-fast6g-api.bat"));
        needles.Add(Path.Combine(workspaceRoot, "vllm\\tools\\restart_indextts_api.ps1"));

        foreach (ProcessInfo proc in EnumerateProcesses())
        {
            if (proc.ProcessId == Process.GetCurrentProcess().Id) continue;
            string cmd = proc.CommandLine ?? string.Empty;
            if (cmd.Length == 0) continue;
            foreach (string needle in needles)
            {
                if (!string.IsNullOrWhiteSpace(needle) && cmd.IndexOf(needle, StringComparison.OrdinalIgnoreCase) >= 0)
                {
                    if (!matches.Contains(proc.ProcessId)) matches.Add(proc.ProcessId);
                    break;
                }
            }
        }
        matches.Sort();
        return matches;
    }

    private List<int> GetLeonPythonPids()
    {
        // 只匹配 LEON runtime 目录里的 python，避免误杀用户其它 Python。
        List<int> matches = new List<int>();
        List<string> runtimeNeedles = new List<string>();
        runtimeNeedles.Add(runtimePython);
        runtimeNeedles.Add(Path.Combine(workspaceRoot, "vllm\\indextts2runtime\\python.exe"));
        runtimeNeedles.Add(Path.Combine(workspaceRoot, "fast6g\\indextts2runtime\\python.exe"));

        foreach (ProcessInfo proc in EnumerateProcesses())
        {
            if (proc.ProcessId == Process.GetCurrentProcess().Id) continue;
            if (!Regex.IsMatch(proc.Name ?? string.Empty, "^python(\\.exe)?$", RegexOptions.IgnoreCase)) continue;

            string cmd = proc.CommandLine ?? string.Empty;
            string exe = proc.ExecutablePath ?? string.Empty;
            bool usesLeonRuntime = false;
            foreach (string needle in runtimeNeedles)
            {
                if (string.IsNullOrWhiteSpace(needle)) continue;
                if (cmd.IndexOf(needle, StringComparison.OrdinalIgnoreCase) >= 0 ||
                    exe.IndexOf(needle, StringComparison.OrdinalIgnoreCase) >= 0)
                {
                    usesLeonRuntime = true;
                    break;
                }
            }
            if (!usesLeonRuntime) continue;

            bool isLeonApiProcess =
                cmd.IndexOf("indextts2_api.py", StringComparison.OrdinalIgnoreCase) >= 0 ||
                cmd.IndexOf("--multiprocessing-fork", StringComparison.OrdinalIgnoreCase) >= 0 ||
                cmd.IndexOf("spawn_main(parent_pid=", StringComparison.OrdinalIgnoreCase) >= 0 ||
                cmd.IndexOf("-p " + ApiPort, StringComparison.OrdinalIgnoreCase) >= 0;

            if (isLeonApiProcess && !matches.Contains(proc.ProcessId))
            {
                matches.Add(proc.ProcessId);
            }
        }
        matches.Sort();
        return matches;
    }

    private void StopProcessTreeById(int rootPid)
    {
        if (rootPid <= 0 || rootPid == Process.GetCurrentProcess().Id) return;

        Dictionary<int, List<int>> childMap = BuildChildProcessMap();
        List<int> ordered = new List<int>();
        Stack<int> stack = new Stack<int>();
        HashSet<int> seen = new HashSet<int>();
        stack.Push(rootPid);
        while (stack.Count > 0)
        {
            int current = stack.Pop();
            if (seen.Contains(current)) continue;
            seen.Add(current);
            ordered.Add(current);
            List<int> children;
            if (childMap.TryGetValue(current, out children))
            {
                foreach (int child in children) stack.Push(child);
            }
        }

        for (int i = ordered.Count - 1; i >= 0; i--)
        {
            int pid = ordered[i];
            if (pid <= 0 || pid == Process.GetCurrentProcess().Id) continue;
            try
            {
                Process.GetProcessById(pid).Kill();
                AddLauncherLog("已停止 LEON 服务进程 PID " + pid);
            }
            catch (Exception ex)
            {
                AddLauncherLog("停止 PID " + pid + " 失败: " + ex.Message, "WARN");
            }
        }
    }

    private Dictionary<int, List<int>> BuildChildProcessMap()
    {
        Dictionary<int, List<int>> map = new Dictionary<int, List<int>>();
        foreach (ProcessInfo proc in EnumerateProcesses())
        {
            List<int> children;
            if (!map.TryGetValue(proc.ParentProcessId, out children))
            {
                children = new List<int>();
                map[proc.ParentProcessId] = children;
            }
            children.Add(proc.ProcessId);
        }
        return map;
    }

    private List<ProcessInfo> EnumerateProcesses()
    {
        List<ProcessInfo> list = new List<ProcessInfo>();
        try
        {
            using (ManagementObjectSearcher searcher = new ManagementObjectSearcher("SELECT ProcessId, ParentProcessId, Name, CommandLine, ExecutablePath FROM Win32_Process"))
            using (ManagementObjectCollection results = searcher.Get())
            {
                foreach (ManagementObject obj in results)
                {
                    using (obj)
                    {
                        ProcessInfo info = new ProcessInfo();
                        info.ProcessId = ToInt(obj["ProcessId"]);
                        info.ParentProcessId = ToInt(obj["ParentProcessId"]);
                        info.Name = Convert.ToString(obj["Name"]);
                        info.CommandLine = Convert.ToString(obj["CommandLine"]);
                        info.ExecutablePath = Convert.ToString(obj["ExecutablePath"]);
                        if (info.ProcessId > 0) list.Add(info);
                    }
                }
            }
        }
        catch
        {
        }
        return list;
    }

    private string ReadLauncherLogTail(string path, int tailLines)
    {
        try
        {
            byte[] bytes = ReadTailBytes(path, 512 * 1024);
            string raw = DecodeLogBytes(bytes);
            string normalized = NormalizeLogText(raw);
            string[] lines = Regex.Split(normalized, "\r?\n");
            if (lines.Length <= tailLines) return normalized;

            StringBuilder sb = new StringBuilder();
            for (int i = Math.Max(0, lines.Length - tailLines); i < lines.Length; i++)
            {
                if (lines[i].Length == 0 && i == lines.Length - 1) continue;
                sb.Append(lines[i]).Append("\r\n");
            }
            return sb.ToString().TrimEnd();
        }
        catch
        {
            return string.Empty;
        }
    }

    private byte[] ReadTailBytes(string path, int maxBytes)
    {
        using (FileStream fs = new FileStream(path, FileMode.Open, FileAccess.Read, FileShare.ReadWrite | FileShare.Delete))
        {
            long start = Math.Max(0, fs.Length - maxBytes);
            fs.Seek(start, SeekOrigin.Begin);
            byte[] buffer = new byte[fs.Length - start];
            int offset = 0;
            while (offset < buffer.Length)
            {
                int read = fs.Read(buffer, offset, buffer.Length - offset);
                if (read <= 0) break;
                offset += read;
            }
            if (offset == buffer.Length) return buffer;
            byte[] trimmed = new byte[offset];
            Array.Copy(buffer, trimmed, offset);
            return trimmed;
        }
    }

    private string DecodeLogBytes(byte[] bytes)
    {
        if (bytes == null || bytes.Length == 0) return string.Empty;

        List<DecodeCandidate> candidates = new List<DecodeCandidate>();
        AddDecodeCandidate(candidates, new UTF8Encoding(false, false), bytes);
        TryAddDecodeCandidate(candidates, "gb18030", bytes);
        TryAddDecodeCandidate(candidates, "gbk", bytes);
        AddDecodeCandidate(candidates, Encoding.Default, bytes);

        candidates.Sort(delegate(DecodeCandidate a, DecodeCandidate b) { return b.Score.CompareTo(a.Score); });
        return candidates.Count == 0 ? Encoding.Default.GetString(bytes) : candidates[0].Text;
    }

    private void AddDecodeCandidate(List<DecodeCandidate> candidates, Encoding encoding, byte[] bytes)
    {
        try
        {
            string text = encoding.GetString(bytes);
            candidates.Add(new DecodeCandidate(text, GetDecodeScore(text)));
        }
        catch
        {
        }
    }

    private void TryAddDecodeCandidate(List<DecodeCandidate> candidates, string encodingName, byte[] bytes)
    {
        try
        {
            AddDecodeCandidate(candidates, Encoding.GetEncoding(encodingName), bytes);
        }
        catch
        {
        }
    }

    private int GetDecodeScore(string text)
    {
        if (text == null) return -1000000;
        int score = 0;
        score -= Regex.Matches(text, "\uFFFD").Count * 1000;
        score -= Regex.Matches(text, "\0").Count * 500;
        score += Math.Min(300, Regex.Matches(text, "[\u4e00-\u9fff]").Count * 2);
        score += Regex.Matches(text, "启动|服务|日志|检测|环境|错误|等待|加载|模型|音色|完成|失败|成功|端口|路径").Count * 60;
        score -= Regex.Matches(text, "锟斤拷|Ã|Â|鍚|榯|浣|妗|鐧|涓|鏃|璇|鎴|绋|杩|鍔|姝|澶|犳|栨|锛").Count * 180;
        return score;
    }

    private string NormalizeLogText(string text)
    {
        if (text == null) return string.Empty;
        text = Regex.Replace(text, "\x1b\\[[0-?]*[ -/]*[@-~]", string.Empty);
        text = text.Replace("\0", string.Empty);
        text = Regex.Replace(text, "\r(?!\n)", "\n");
        text = text.Replace("\r\n", "\n");
        text = Regex.Replace(text, "(\\d{1,3})%\\|[^\\n]*?\\|\\s*", "$1% ");
        text = Regex.Replace(text, "[█▉▊▋▌▍▎▏▓▒░■□▇▆▅▄▃▂▁�]", string.Empty);
        string[] lines = text.Split('\n');
        StringBuilder sb = new StringBuilder();
        foreach (string line in lines)
        {
            if (IsNoisyLauncherLogLine(line)) continue;
            sb.Append(line.TrimEnd()).Append("\r\n");
        }
        return Regex.Replace(sb.ToString(), "(\r\n){3,}", "\r\n\r\n").TrimEnd();
    }

    private bool IsNoisyLauncherLogLine(string line)
    {
        if (string.IsNullOrWhiteSpace(line)) return false;
        if (line.IndexOf("�", StringComparison.Ordinal) >= 0) return true;
        return Regex.IsMatch(line, "space\\.bilibili\\.com|Integrated package Author|Redistribution and reselling|strictly prohibited|solely responsible|do not have any control|bilibili@", RegexOptions.IgnoreCase);
    }

    private bool IsNoisyServerLogLine(string line)
    {
        if (string.IsNullOrWhiteSpace(line)) return false;
        return Regex.IsMatch(line, "INFO:\\s+.*\"\\s*(GET|HEAD)\\s+/(health|server_log/tail)(\\?|\\s|/)", RegexOptions.IgnoreCase);
    }

    private bool IsDiagnosticProgressLine(string line)
    {
        if (string.IsNullOrWhiteSpace(line)) return false;
        string trimmed = line.Trim();
        if (Regex.IsMatch(trimmed, "^\\d{1,3}%\\s*$")) return true;
        if (Regex.IsMatch(trimmed, "^\\d{1,3}%\\s+\\d+/", RegexOptions.IgnoreCase)) return true;
        if (Regex.IsMatch(trimmed, "^\\d+%\\|.*\\|", RegexOptions.IgnoreCase)) return true;
        if (Regex.IsMatch(trimmed, "\\b(it/s|s/it)\\b", RegexOptions.IgnoreCase) && Regex.IsMatch(trimmed, "\\d{1,3}%|\\d+/\\d+")) return true;
        return false;
    }

    private bool IsImportantLogLine(string line)
    {
        if (string.IsNullOrWhiteSpace(line)) return false;
        return Regex.IsMatch(
            line,
            "ERROR|WARN|Traceback|Exception|RuntimeError|ValueError|failed|failure|timeout|RTF|rtf|real[-_ ]?time|elapsed|duration|first[_ -]?audio|audio_duration|cache_key|job|synth|segment|metrics|错误|失败|异常|超时|耗时|生成|合成|保存|落盘|音频",
            RegexOptions.IgnoreCase);
    }

    private void BeginUi(MethodInvoker action)
    {
        if (IsDisposed) return;
        try
        {
            if (InvokeRequired)
            {
                BeginInvoke(action);
            }
            else
            {
                action();
            }
        }
        catch
        {
        }
    }

    private Button CreateSideButton(string text, int y, EventHandler handler)
    {
        Button button = CreateFlatButton(text, 0, y, 208, 38, Color.FromArgb(30, 39, 49), handler);
        button.Font = NewFont(10.0f, FontStyle.Bold);
        button.Margin = Padding.Empty;
        return button;
    }

    private Button CreateSmallButton(string text, int x, int y, int width, EventHandler handler)
    {
        Button button = CreateFlatButton(text, x, y, width, 32, Color.FromArgb(24, 31, 39), handler);
        button.Font = NewFont(9.0f, FontStyle.Bold);
        return button;
    }

    private Button CreateLogTabButton(string text, string key)
    {
        Button button = CreateFlatButton(text, 0, 0, 106, 32, Color.FromArgb(24, 31, 39), delegate { SetLogTabActive(key); });
        button.Margin = new Padding(0, 0, 8, 0);
        return button;
    }

    private Button CreateFlatButton(string text, int x, int y, int width, int height, Color backColor, EventHandler handler)
    {
        Button button = new Button();
        button.Text = text;
        button.Location = new Point(x, y);
        button.Size = new Size(width, height);
        button.FlatStyle = FlatStyle.Flat;
        button.UseVisualStyleBackColor = false;
        button.BackColor = backColor;
        button.ForeColor = Color.White;
        button.FlatAppearance.BorderSize = 1;
        button.FlatAppearance.BorderColor = Color.FromArgb(52, 64, 78);
        button.FlatAppearance.MouseOverBackColor = Color.FromArgb(38, 50, 62);
        button.FlatAppearance.MouseDownBackColor = Color.FromArgb(48, 64, 78);
        button.Click += handler;
        return button;
    }

    private void StyleNavButton(Button button, bool active)
    {
        if (button == null) return;
        button.BackColor = active ? Color.FromArgb(48, 68, 88) : Color.FromArgb(30, 39, 49);
        button.FlatAppearance.BorderColor = active ? Color.FromArgb(105, 145, 176) : Color.FromArgb(52, 64, 78);
        button.ForeColor = Color.White;
    }

    private void StyleLogTab(Button button, bool active)
    {
        if (button == null) return;
        button.BackColor = active ? Color.FromArgb(48, 68, 88) : Color.FromArgb(24, 31, 39);
        button.FlatAppearance.BorderColor = active ? Color.FromArgb(105, 145, 176) : Color.FromArgb(46, 56, 68);
        button.ForeColor = active ? Color.White : Color.FromArgb(205, 214, 224);
    }

    private void StyleVersionButton(Button button, bool active)
    {
        if (button == null) return;
        button.BackColor = active ? Color.FromArgb(48, 68, 88) : Color.FromArgb(24, 31, 39);
        button.FlatAppearance.BorderColor = active ? Color.FromArgb(105, 145, 176) : Color.FromArgb(46, 56, 68);
    }

    private void SyncRatioFromBox()
    {
        double parsed;
        if (ratioBox != null &&
            double.TryParse(ratioBox.Text, System.Globalization.NumberStyles.Float, System.Globalization.CultureInfo.InvariantCulture, out parsed) &&
            parsed > 0)
        {
            vllmGpuRatio = parsed;
        }
        if (ratioBox != null) ratioBox.Text = GetRatioText();
    }

    private string NormalizeVersionKey(string key)
    {
        return string.Equals(key, "fast6g", StringComparison.OrdinalIgnoreCase) ? "fast6g" : "vllm";
    }

    private string GetVersionRoot(string key)
    {
        return Path.Combine(workspaceRoot, NormalizeVersionKey(key));
    }

    private string GetRuntimePython(string key)
    {
        return Path.Combine(GetVersionRoot(key), "indextts2runtime\\python.exe");
    }

    private string GetStartupBat(string key)
    {
        return Path.Combine(scriptsDir, NormalizeVersionKey(key) == "fast6g" ? "start-fast6g-api.bat" : "start-vllm-api.bat");
    }

    private string GetVersionLogDir(string key)
    {
        return Path.Combine(workspaceRoot, "logs", NormalizeVersionKey(key));
    }

    private string GetPythonVersion(string pythonPath)
    {
        if (!File.Exists(pythonPath)) return pythonPath;
        CaptureResult result = RunCapture(pythonPath, "--version", Path.GetDirectoryName(pythonPath), null, 10);
        string text = (result.Stdout + " " + result.Stderr).Trim();
        return string.IsNullOrWhiteSpace(text) ? pythonPath : text + " | " + pythonPath;
    }

    private bool IsAdmin()
    {
        try
        {
            WindowsPrincipal principal = new WindowsPrincipal(WindowsIdentity.GetCurrent());
            return principal.IsInRole(WindowsBuiltInRole.Administrator);
        }
        catch
        {
            return false;
        }
    }

    private static bool PathHasChinese(string path)
    {
        return !string.IsNullOrEmpty(path) && Regex.IsMatch(path, "[\u4e00-\u9fff]");
    }

    private static string GetCommandPath(string fileName)
    {
        if (string.IsNullOrWhiteSpace(fileName)) return null;
        if (File.Exists(fileName)) return fileName;

        string pathEnv = Environment.GetEnvironmentVariable("PATH") ?? string.Empty;
        string[] pathDirs = pathEnv.Split(new[] { ';' }, StringSplitOptions.RemoveEmptyEntries);
        string[] exts = Path.HasExtension(fileName)
            ? new[] { string.Empty }
            : ((Environment.GetEnvironmentVariable("PATHEXT") ?? ".EXE;.BAT;.CMD").Split(new[] { ';' }, StringSplitOptions.RemoveEmptyEntries));

        foreach (string dir in pathDirs)
        {
            string cleanDir = dir.Trim().Trim('"');
            if (string.IsNullOrWhiteSpace(cleanDir)) continue;
            foreach (string ext in exts)
            {
                string candidate = Path.Combine(cleanDir, fileName + ext);
                if (File.Exists(candidate)) return candidate;
            }
        }
        return null;
    }

    private CaptureResult RunPythonSnippet(string pythonPath, string workingDir, string code, int timeoutSeconds)
    {
        return RunCapture(pythonPath, "-c " + QuoteCmdArgument(code), workingDir, GetRuntimeEnv(pythonPath, workingDir), timeoutSeconds);
    }

    private RuntimeProbe ProbeRuntime(string pythonPath, string workingDir, string modulesCsv, int timeoutSeconds)
    {
        RuntimeProbe probe = new RuntimeProbe();
        if (!File.Exists(pythonPath))
        {
            probe.ExitCode = 127;
            probe.Text = "runtime python missing";
            return probe;
        }

        string[] modules = modulesCsv.Split(new[] { ',' }, StringSplitOptions.RemoveEmptyEntries);
        for (int i = 0; i < modules.Length; i++) modules[i] = modules[i].Trim();
        string modulesJson = json.Serialize(modules);
        string code =
            "import importlib,json\n" +
            "mods=" + modulesJson + "\n" +
            "out={}\n" +
            "for m in mods:\n" +
            "    try:\n" +
            "        mod=importlib.import_module(m)\n" +
            "        out[m]=getattr(mod,'__version__','installed')\n" +
            "    except Exception as e:\n" +
            "        out[m]='ERROR: '+str(e)\n" +
            "try:\n" +
            "    import torch\n" +
            "    out['torch_cuda_available']=bool(torch.cuda.is_available())\n" +
            "    out['torch_cuda_version']=getattr(torch.version,'cuda',None)\n" +
            "    out['torch_gpu']=torch.cuda.get_device_name(0) if torch.cuda.is_available() else ''\n" +
            "except Exception as e:\n" +
            "    out['torch_cuda_available']='ERROR: '+str(e)\n" +
            "print('LEON_IMPORT_PROBE_JSON='+json.dumps(out,ensure_ascii=False))\n";

        CaptureResult result = RunPythonSnippet(pythonPath, workingDir, code, timeoutSeconds);
        probe.ExitCode = result.ExitCode;
        probe.Text = (result.Stdout + "\n" + result.Stderr).Trim();
        probe.Info = ExtractProbeInfo(probe.Text);
        return probe;
    }

    private Dictionary<string, object> ExtractProbeInfo(string text)
    {
        const string marker = "LEON_IMPORT_PROBE_JSON=";
        if (string.IsNullOrWhiteSpace(text)) return null;
        int index = text.LastIndexOf(marker, StringComparison.Ordinal);
        if (index < 0) return null;
        string tail = text.Substring(index + marker.Length);
        int end = tail.IndexOfAny(new[] { '\r', '\n' });
        string jsonText = (end >= 0 ? tail.Substring(0, end) : tail).Trim();
        try
        {
            return json.DeserializeObject(jsonText) as Dictionary<string, object>;
        }
        catch
        {
            return null;
        }
    }

    private Dictionary<string, string> GetRuntimeEnv(string pythonPath, string versionRootForEnv)
    {
        Dictionary<string, string> env = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
        List<string> dirs = GetRuntimeDllSearchDirs(pythonPath, versionRootForEnv);
        string path = string.Join(";", dirs.ToArray());
        string existingPath = Environment.GetEnvironmentVariable("PATH") ?? string.Empty;
        env["PATH"] = string.IsNullOrWhiteSpace(path) ? existingPath : path + ";" + existingPath;
        env["HF_HOME"] = Path.Combine(versionRootForEnv, "checkpoints");
        env["PYTHONUTF8"] = "1";
        env["PYTHONIOENCODING"] = "utf-8";
        return env;
    }

    private List<string> GetRuntimeDllSearchDirs(string pythonPath, string versionRootForEnv)
    {
        List<string> dirs = new List<string>();
        string runtimeRoot = string.IsNullOrWhiteSpace(pythonPath) ? null : Path.GetDirectoryName(pythonPath);
        AddExistingDir(dirs, runtimeRoot);
        AddExistingDir(dirs, Path.Combine(runtimeRoot ?? string.Empty, "Scripts"));
        AddExistingDir(dirs, Path.Combine(runtimeRoot ?? string.Empty, "DLLs"));
        AddExistingDir(dirs, Path.Combine(runtimeRoot ?? string.Empty, "Library\\bin"));
        AddExistingDir(dirs, Path.Combine(runtimeRoot ?? string.Empty, "Lib\\site-packages\\torch\\lib"));
        AddExistingDir(dirs, Path.Combine(runtimeRoot ?? string.Empty, "Lib\\site-packages\\nvidia\\cublas\\bin"));
        AddExistingDir(dirs, Path.Combine(runtimeRoot ?? string.Empty, "Lib\\site-packages\\nvidia\\cuda_runtime\\bin"));
        AddExistingDir(dirs, Path.Combine(runtimeRoot ?? string.Empty, "Lib\\site-packages\\nvidia\\cudnn\\bin"));
        AddExistingDir(dirs, versionRootForEnv);
        AddExistingDir(dirs, Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.Windows), "System32"));
        return dirs;
    }

    private static void AddExistingDir(List<string> dirs, string dir)
    {
        if (string.IsNullOrWhiteSpace(dir) || !Directory.Exists(dir)) return;
        foreach (string existing in dirs)
        {
            if (string.Equals(existing, dir, StringComparison.OrdinalIgnoreCase)) return;
        }
        dirs.Add(dir);
    }

    private CaptureResult RunCapture(string fileName, string arguments, string workingDir, Dictionary<string, string> env, int timeoutSeconds)
    {
        CaptureResult result = new CaptureResult();
        try
        {
            ProcessStartInfo psi = new ProcessStartInfo();
            psi.FileName = fileName;
            psi.Arguments = arguments ?? string.Empty;
            psi.WorkingDirectory = Directory.Exists(workingDir) ? workingDir : workspaceRoot;
            psi.UseShellExecute = false;
            psi.RedirectStandardOutput = true;
            psi.RedirectStandardError = true;
            psi.CreateNoWindow = true;
            if (env != null)
            {
                foreach (KeyValuePair<string, string> item in env)
                {
                    psi.EnvironmentVariables[item.Key] = item.Value ?? string.Empty;
                }
            }

            using (Process proc = Process.Start(psi))
            {
                if (proc == null)
                {
                    result.ExitCode = 127;
                    result.Stderr = "process start returned null";
                    return result;
                }

                Task<string> stdoutTask = Task.Factory.StartNew(delegate { return proc.StandardOutput.ReadToEnd(); });
                Task<string> stderrTask = Task.Factory.StartNew(delegate { return proc.StandardError.ReadToEnd(); });
                bool exited = proc.WaitForExit(Math.Max(1, timeoutSeconds) * 1000);
                if (!exited)
                {
                    result.TimedOut = true;
                    result.ExitCode = 124;
                    try { proc.Kill(); }
                    catch { }
                }
                else
                {
                    result.ExitCode = proc.ExitCode;
                }
                stdoutTask.Wait(1000);
                stderrTask.Wait(1000);
                result.Stdout = stdoutTask.IsCompleted ? stdoutTask.Result : string.Empty;
                result.Stderr = stderrTask.IsCompleted ? stderrTask.Result : string.Empty;
            }
        }
        catch (Exception ex)
        {
            result.ExitCode = 127;
            result.Stderr = ex.Message;
        }
        return result;
    }

    private string GetCudaToolkitPath()
    {
        string cudaPath = Environment.GetEnvironmentVariable("CUDA_PATH");
        if (!string.IsNullOrWhiteSpace(cudaPath) && File.Exists(Path.Combine(cudaPath, "bin\\nvcc.exe")))
        {
            return cudaPath;
        }

        string root = @"C:\Program Files\NVIDIA GPU Computing Toolkit\CUDA";
        try
        {
            if (!Directory.Exists(root)) return null;
            string[] dirs = Directory.GetDirectories(root);
            Array.Sort(dirs, delegate(string a, string b) { return string.Compare(b, a, StringComparison.OrdinalIgnoreCase); });
            foreach (string dir in dirs)
            {
                if (File.Exists(Path.Combine(dir, "bin\\nvcc.exe"))) return dir;
            }
        }
        catch
        {
        }
        return null;
    }

    private string GetMsvcClPath()
    {
        string cl = GetCommandPath("cl.exe");
        if (!string.IsNullOrWhiteSpace(cl)) return cl;

        string vswhere = @"C:\Program Files (x86)\Microsoft Visual Studio\Installer\vswhere.exe";
        if (File.Exists(vswhere))
        {
            CaptureResult result = RunCapture(vswhere, "-latest -products * -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 -property installationPath", workspaceRoot, null, 10);
            string root = FirstUsefulLine(result.Stdout);
            cl = FindClUnderVs(root);
            if (!string.IsNullOrWhiteSpace(cl)) return cl;
        }

        foreach (string root in new[]
        {
            @"C:\Program Files\Microsoft Visual Studio\2022\BuildTools",
            @"C:\Program Files\Microsoft Visual Studio\2022\Community",
            @"C:\Program Files\Microsoft Visual Studio\2022\Professional",
            @"C:\Program Files\Microsoft Visual Studio\2022\Enterprise",
            @"C:\Program Files (x86)\Microsoft Visual Studio\2022\BuildTools",
            @"C:\Program Files (x86)\Microsoft Visual Studio\2022\Community"
        })
        {
            cl = FindClUnderVs(root);
            if (!string.IsNullOrWhiteSpace(cl)) return cl;
        }
        return null;
    }

    private static string FindClUnderVs(string vsRoot)
    {
        try
        {
            if (string.IsNullOrWhiteSpace(vsRoot)) return null;
            string msvcRoot = Path.Combine(vsRoot.Trim(), "VC\\Tools\\MSVC");
            if (!Directory.Exists(msvcRoot)) return null;
            string[] dirs = Directory.GetDirectories(msvcRoot);
            Array.Sort(dirs, delegate(string a, string b) { return string.Compare(b, a, StringComparison.OrdinalIgnoreCase); });
            foreach (string dir in dirs)
            {
                string candidate = Path.Combine(dir, "bin\\Hostx64\\x64\\cl.exe");
                if (File.Exists(candidate)) return candidate;
            }
        }
        catch
        {
        }
        return null;
    }

    private string FindSvmlDll(string pythonPath)
    {
        foreach (string dir in GetRuntimeDllSearchDirs(pythonPath, Path.GetDirectoryName(Path.GetDirectoryName(pythonPath) ?? string.Empty) ?? workspaceRoot))
        {
            string candidate = Path.Combine(dir, "svml_dispmd.dll");
            if (File.Exists(candidate)) return candidate;
        }
        return null;
    }

    private static bool SvmlRepairNeeded(string text)
    {
        return !string.IsNullOrWhiteSpace(text) && Regex.IsMatch(text, "svml_dispmd|LLVM ERROR|dll load failed|找不到指定的模块|specified module", RegexOptions.IgnoreCase);
    }

    private bool HasFailedOrWarn(List<EnvRow> rows, string namePart)
    {
        foreach (EnvRow row in rows)
        {
            if (row.Name.IndexOf(namePart, StringComparison.OrdinalIgnoreCase) < 0 &&
                row.Detail.IndexOf(namePart, StringComparison.OrdinalIgnoreCase) < 0)
            {
                continue;
            }
            if (row.Status == "FAIL" || row.Status == "WARN") return true;
        }
        return false;
    }

    private string FindBundledSvmlDll()
    {
        foreach (string candidate in new[]
        {
            Path.Combine(workspaceRoot, "dev_workspace\\llvm_error_fix\\svml_dispmd.dll"),
            Path.Combine(workspaceRoot, "llvm_error_fix\\svml_dispmd.dll")
        })
        {
            if (File.Exists(candidate)) return candidate;
        }
        return null;
    }

    private string GetSvmlRepairTarget(string pythonPath)
    {
        if (!File.Exists(pythonPath)) return null;
        string runtimeRoot = Path.GetDirectoryName(pythonPath);
        foreach (string dir in new[] { Path.Combine(runtimeRoot, "Library\\bin"), runtimeRoot })
        {
            if (Directory.Exists(dir)) return Path.Combine(dir, "svml_dispmd.dll");
        }
        return null;
    }

    private EnvRow RunWingetRepairRow(string name, string packageId, string extraArgs)
    {
        string winget = GetCommandPath("winget.exe");
        if (string.IsNullOrWhiteSpace(winget)) return new EnvRow(name, "FAIL", "找不到 winget。");
        string args = "install -e --id " + packageId + " " + (extraArgs ?? string.Empty) + " --accept-package-agreements --accept-source-agreements";
        CaptureResult result = RunCapture(winget, args, workspaceRoot, null, 900);
        return new EnvRow(name, result.ExitCode == 0 ? "OK" : "FAIL", result.ExitCode == 0 ? packageId + " 安装/修复命令已执行。" : Shorten(result.Stdout + "\n" + result.Stderr));
    }

    private static string FirstUsefulLine(string text)
    {
        if (string.IsNullOrWhiteSpace(text)) return string.Empty;
        string[] lines = Regex.Split(text, "\r?\n");
        foreach (string line in lines)
        {
            if (!string.IsNullOrWhiteSpace(line)) return Shorten(line.Trim());
        }
        return string.Empty;
    }

    private static string FirstMatchingLine(string text, string pattern)
    {
        if (string.IsNullOrWhiteSpace(text)) return string.Empty;
        string[] lines = Regex.Split(text, "\r?\n");
        foreach (string line in lines)
        {
            if (line.IndexOf(pattern, StringComparison.OrdinalIgnoreCase) >= 0) return Shorten(line.Trim());
        }
        return FirstUsefulLine(text);
    }

    private static string Shorten(string text)
    {
        if (string.IsNullOrWhiteSpace(text)) return string.Empty;
        text = Regex.Replace(text.Replace("\r", "\n"), "\n{2,}", "\n").Trim();
        text = text.Replace("\n", " | ");
        return text.Length <= 260 ? text : text.Substring(0, 257) + "...";
    }

    private string GetRatioText()
    {
        return vllmGpuRatio.ToString("0.###", System.Globalization.CultureInfo.InvariantCulture);
    }

    private string GetVersionLabel()
    {
        return GetVersionLabel(versionKey);
    }

    private string GetVersionLabel(string key)
    {
        return NormalizeVersionKey(key) == "fast6g" ? "fast6g 双加速 6G" : "vLLM 质量版";
    }

    private static Font NewFont(float size, FontStyle style)
    {
        return new Font("Microsoft YaHei UI", size, style);
    }

    private static Font NewMonoFont(float size)
    {
        return new Font("Consolas", size, FontStyle.Regular);
    }

    private static string QuoteCmdArgument(string value)
    {
        if (string.IsNullOrEmpty(value)) return "\"\"";
        return "\"" + value.Replace("\"", "\\\"") + "\"";
    }

    private static string[] ToStringArray(List<int> values)
    {
        string[] items = new string[values.Count];
        for (int i = 0; i < values.Count; i++) items[i] = values[i].ToString();
        return items;
    }

    private static void AddUniquePids(List<int> target, List<int> source)
    {
        foreach (int pid in source)
        {
            if (pid > 0 && !target.Contains(pid) && pid != Process.GetCurrentProcess().Id)
            {
                target.Add(pid);
            }
        }
    }

    private static string FindLatestFile(string dir, string pattern)
    {
        try
        {
            if (string.IsNullOrWhiteSpace(dir) || !Directory.Exists(dir)) return null;
            string[] files = Directory.GetFiles(dir, pattern);
            Array.Sort(files, delegate(string a, string b)
            {
                return File.GetLastWriteTimeUtc(b).CompareTo(File.GetLastWriteTimeUtc(a));
            });
            return files.Length == 0 ? null : files[0];
        }
        catch
        {
            return null;
        }
    }

    private static string TrimLogText(string text, int maxLines)
    {
        if (string.IsNullOrEmpty(text)) return string.Empty;
        string[] lines = Regex.Split(text, "\r?\n");
        if (lines.Length <= maxLines) return text;
        StringBuilder sb = new StringBuilder();
        for (int i = Math.Max(0, lines.Length - maxLines); i < lines.Length; i++)
        {
            sb.Append(lines[i]).Append(Environment.NewLine);
        }
        return sb.ToString();
    }

    private static string GetDictString(Dictionary<string, object> dict, string key)
    {
        if (dict == null) return string.Empty;
        object value;
        if (!dict.TryGetValue(key, out value) || value == null) return string.Empty;
        return Convert.ToString(value);
    }

    private static string GetPreferredLanHost()
    {
        List<string> addresses = new List<string>();
        try
        {
            foreach (NetworkInterface item in NetworkInterface.GetAllNetworkInterfaces())
            {
                if (item.OperationalStatus != OperationalStatus.Up || item.NetworkInterfaceType == NetworkInterfaceType.Loopback) continue;
                foreach (UnicastIPAddressInformation address in item.GetIPProperties().UnicastAddresses)
                {
                    if (address.Address.AddressFamily != AddressFamily.InterNetwork) continue;
                    string value = address.Address.ToString();
                    if (value.StartsWith("169.254.", StringComparison.Ordinal) || value == "127.0.0.1") continue;
                    addresses.Add(value);
                }
            }
        }
        catch
        {
        }

        foreach (string address in addresses)
        {
            if (address.StartsWith("192.168.", StringComparison.Ordinal) ||
                address.StartsWith("10.", StringComparison.Ordinal) ||
                Regex.IsMatch(address, "^172\\.(1[6-9]|2[0-9]|3[0-1])\\."))
            {
                return address;
            }
        }
        return addresses.Count > 0 ? addresses[0] : "127.0.0.1";
    }

    private static int ToInt(object value)
    {
        if (value == null) return 0;
        try { return Convert.ToInt32(value); }
        catch { return 0; }
    }

    private sealed class EnvRow
    {
        public readonly string Name;
        public readonly string Status;
        public readonly string Detail;

        public EnvRow(string name, string status, string detail)
        {
            Name = name;
            Status = status;
            Detail = detail;
        }
    }

    private sealed class ProfileOption
    {
        public readonly string DisplayName;
        public readonly string FilePath;

        public ProfileOption(string displayName, string filePath)
        {
            DisplayName = displayName;
            FilePath = filePath;
        }

        public override string ToString()
        {
            return DisplayName;
        }
    }

    private sealed class CaptureResult
    {
        public int ExitCode;
        public string Stdout = string.Empty;
        public string Stderr = string.Empty;
        public bool TimedOut;
    }

    private sealed class RuntimeProbe
    {
        public int ExitCode;
        public string Text = string.Empty;
        public Dictionary<string, object> Info;
    }

    private sealed class ProcessInfo
    {
        public int ProcessId;
        public int ParentProcessId;
        public string Name;
        public string CommandLine;
        public string ExecutablePath;
    }

    private sealed class DecodeCandidate
    {
        public readonly string Text;
        public readonly int Score;

        public DecodeCandidate(string text, int score)
        {
            Text = text;
            Score = score;
        }
    }
}

internal enum ImageScaleMode
{
    Cover,
    FitWidth
}

internal enum ImageHorizontalAlign
{
    Left,
    Center,
    Right
}

internal enum ImageVerticalAlign
{
    Top,
    Center,
    Bottom
}

internal sealed class WrappedLogView : Control
{
    private const int PadLeft = 14;
    private const int PadTop = 12;
    private const int PadRight = 20;
    private const int PadBottom = 12;
    private const int ScrollbarWidth = 8;

    private readonly List<string> visualLines = new List<string>();
    private string rawText = string.Empty;
    private int scrollLine;
    private int maxScrollLine;
    private int lineHeight = 16;
    private int charWidth = 8;
    private bool layoutDirty = true;
    private bool draggingThumb;
    private int dragStartY;
    private int dragStartScroll;
    private Rectangle thumbRect = Rectangle.Empty;

    public WrappedLogView()
    {
        SetStyle(ControlStyles.AllPaintingInWmPaint | ControlStyles.UserPaint | ControlStyles.OptimizedDoubleBuffer | ControlStyles.ResizeRedraw, true);
        TabStop = true;
    }

    public void SetText(string text, bool forceScroll)
    {
        text = text ?? string.Empty;
        bool wasAtBottom = scrollLine >= maxScrollLine - 1;
        if (!forceScroll && string.Equals(rawText, text, StringComparison.Ordinal)) return;

        rawText = text;
        layoutDirty = true;
        EnsureLayout();
        if (forceScroll || wasAtBottom)
        {
            ScrollToBottom();
        }
        else
        {
            ClampScroll();
        }
        Invalidate();
    }

    protected override void OnFontChanged(EventArgs e)
    {
        layoutDirty = true;
        base.OnFontChanged(e);
    }

    protected override void OnResize(EventArgs e)
    {
        bool wasAtBottom = scrollLine >= maxScrollLine - 1;
        layoutDirty = true;
        EnsureLayout();
        if (wasAtBottom) ScrollToBottom();
        else ClampScroll();
        base.OnResize(e);
    }

    protected override void OnMouseWheel(MouseEventArgs e)
    {
        EnsureLayout();
        int delta = e.Delta > 0 ? -3 : 3;
        scrollLine += delta;
        ClampScroll();
        Invalidate();
        base.OnMouseWheel(e);
    }

    protected override void OnMouseDown(MouseEventArgs e)
    {
        Focus();
        EnsureLayout();
        if (thumbRect.Contains(e.Location))
        {
            draggingThumb = true;
            dragStartY = e.Y;
            dragStartScroll = scrollLine;
            Capture = true;
        }
        else if (e.X >= ClientSize.Width - ScrollbarWidth - 4)
        {
            int page = Math.Max(1, VisibleLineCount() - 1);
            scrollLine += e.Y < thumbRect.Top ? -page : page;
            ClampScroll();
            Invalidate();
        }
        base.OnMouseDown(e);
    }

    protected override void OnMouseMove(MouseEventArgs e)
    {
        if (draggingThumb)
        {
            int trackHeight = Math.Max(1, ClientSize.Height - PadTop - PadBottom);
            int thumbHeight = Math.Max(28, thumbRect.Height);
            int travel = Math.Max(1, trackHeight - thumbHeight);
            int lineTravel = Math.Max(1, maxScrollLine);
            int moved = e.Y - dragStartY;
            scrollLine = dragStartScroll + (int)Math.Round(moved * (lineTravel / (double)travel));
            ClampScroll();
            Invalidate();
        }
        base.OnMouseMove(e);
    }

    protected override void OnMouseUp(MouseEventArgs e)
    {
        draggingThumb = false;
        Capture = false;
        base.OnMouseUp(e);
    }

    protected override bool IsInputKey(Keys keyData)
    {
        Keys key = keyData & Keys.KeyCode;
        if (key == Keys.Up || key == Keys.Down || key == Keys.PageUp || key == Keys.PageDown || key == Keys.Home || key == Keys.End)
        {
            return true;
        }
        return base.IsInputKey(keyData);
    }

    protected override void OnKeyDown(KeyEventArgs e)
    {
        EnsureLayout();
        int page = Math.Max(1, VisibleLineCount() - 1);
        if (e.KeyCode == Keys.Up) scrollLine--;
        else if (e.KeyCode == Keys.Down) scrollLine++;
        else if (e.KeyCode == Keys.PageUp) scrollLine -= page;
        else if (e.KeyCode == Keys.PageDown) scrollLine += page;
        else if (e.KeyCode == Keys.Home) scrollLine = 0;
        else if (e.KeyCode == Keys.End) scrollLine = maxScrollLine;
        else
        {
            base.OnKeyDown(e);
            return;
        }
        ClampScroll();
        Invalidate();
        e.Handled = true;
    }

    protected override void OnPaint(PaintEventArgs e)
    {
        EnsureLayout();
        e.Graphics.Clear(BackColor);
        e.Graphics.TextRenderingHint = System.Drawing.Text.TextRenderingHint.ClearTypeGridFit;

        using (Brush textBrush = new SolidBrush(ForeColor))
        {
            int y = PadTop;
            int visible = VisibleLineCount() + 1;
            for (int i = 0; i < visible; i++)
            {
                int lineIndex = scrollLine + i;
                if (lineIndex < 0 || lineIndex >= visualLines.Count) break;
                e.Graphics.DrawString(visualLines[lineIndex], Font, textBrush, PadLeft, y);
                y += lineHeight;
            }
        }

        PaintScrollbar(e.Graphics);
        base.OnPaint(e);
    }

    private void EnsureLayout()
    {
        if (!layoutDirty) return;
        visualLines.Clear();
        lineHeight = Math.Max(14, Font.Height + 3);
        Size charSize = TextRenderer.MeasureText(
            "00000000000000000000000000000000",
            Font,
            new Size(2000, 200),
            TextFormatFlags.NoPadding | TextFormatFlags.SingleLine);
        charWidth = Math.Max(5, (int)Math.Ceiling(charSize.Width / 32.0));
        int usableWidth = Math.Max(charWidth, ClientSize.Width - PadLeft - PadRight - ScrollbarWidth - 8);
        int maxChars = Math.Max(10, usableWidth / charWidth);

        string normalized = (rawText ?? string.Empty).Replace("\r\n", "\n").Replace("\r", "\n");
        string[] lines = normalized.Split('\n');
        foreach (string rawLine in lines)
        {
            WrapLine(rawLine, maxChars);
        }

        if (visualLines.Count == 0) visualLines.Add(string.Empty);
        layoutDirty = false;
        ClampScroll();
    }

    private void WrapLine(string line, int maxChars)
    {
        if (line == null) line = string.Empty;
        string remaining = line.Replace("\t", "    ");
        if (remaining.Length == 0)
        {
            visualLines.Add(string.Empty);
            return;
        }

        while (remaining.Length > maxChars)
        {
            int cut = maxChars;
            for (int i = Math.Min(maxChars, remaining.Length - 1); i > Math.Max(0, maxChars - 24); i--)
            {
                if (char.IsWhiteSpace(remaining[i]))
                {
                    cut = i + 1;
                    break;
                }
            }
            visualLines.Add(remaining.Substring(0, cut).TrimEnd());
            remaining = remaining.Substring(cut).TrimStart();
        }
        visualLines.Add(remaining);
    }

    private int VisibleLineCount()
    {
        return Math.Max(1, (ClientSize.Height - PadTop - PadBottom) / Math.Max(1, lineHeight));
    }

    private void ClampScroll()
    {
        maxScrollLine = Math.Max(0, visualLines.Count - VisibleLineCount());
        if (scrollLine < 0) scrollLine = 0;
        if (scrollLine > maxScrollLine) scrollLine = maxScrollLine;
    }

    private void ScrollToBottom()
    {
        maxScrollLine = Math.Max(0, visualLines.Count - VisibleLineCount());
        scrollLine = maxScrollLine;
    }

    private void PaintScrollbar(Graphics g)
    {
        int trackHeight = ClientSize.Height - PadTop - PadBottom;
        if (trackHeight <= 0 || visualLines.Count <= VisibleLineCount())
        {
            thumbRect = Rectangle.Empty;
            return;
        }

        int x = ClientSize.Width - ScrollbarWidth - 6;
        Rectangle track = new Rectangle(x, PadTop, ScrollbarWidth, trackHeight);
        int thumbHeight = Math.Max(28, (int)Math.Round(track.Height * (VisibleLineCount() / (double)visualLines.Count)));
        int travel = Math.Max(1, track.Height - thumbHeight);
        int thumbTop = track.Top + (maxScrollLine == 0 ? 0 : (int)Math.Round(travel * (scrollLine / (double)maxScrollLine)));
        thumbRect = new Rectangle(track.Left, thumbTop, track.Width, thumbHeight);

        using (SolidBrush trackBrush = new SolidBrush(Color.FromArgb(24, 31, 39)))
        using (SolidBrush thumbBrush = new SolidBrush(draggingThumb ? Color.FromArgb(96, 124, 150) : Color.FromArgb(67, 87, 106)))
        {
            g.FillRectangle(trackBrush, track);
            g.FillRectangle(thumbBrush, thumbRect);
        }
    }
}

internal sealed class CachedImagePanel : Panel
{
    private Image image;
    private Bitmap cache;
    private bool cacheDirty = true;
    private System.Windows.Forms.Timer resizeTimer;

    public ImageScaleMode ScaleMode = ImageScaleMode.Cover;
    public ImageHorizontalAlign HorizontalAlign = ImageHorizontalAlign.Center;
    public ImageVerticalAlign VerticalAlign = ImageVerticalAlign.Center;

    public CachedImagePanel()
    {
        // 大 PNG 只在尺寸稳定后重采样；拖动窗口时先复用缓存，避免切页/缩放卡 UI。
        SetStyle(ControlStyles.AllPaintingInWmPaint | ControlStyles.UserPaint | ControlStyles.OptimizedDoubleBuffer | ControlStyles.ResizeRedraw, true);
        resizeTimer = new System.Windows.Forms.Timer();
        resizeTimer.Interval = 120;
        resizeTimer.Tick += delegate
        {
            resizeTimer.Stop();
            cacheDirty = true;
            RebuildCache();
            Invalidate();
        };
    }

    public void SetImagePath(string path)
    {
        DisposeImage();
        if (string.IsNullOrWhiteSpace(path) || !File.Exists(path))
        {
            return;
        }

        try
        {
            byte[] bytes = File.ReadAllBytes(path);
            using (MemoryStream memory = new MemoryStream(bytes))
            using (Image loaded = Image.FromStream(memory))
            {
                image = new Bitmap(loaded);
            }
            cacheDirty = true;
            Invalidate();
        }
        catch
        {
            image = null;
        }
    }

    protected override void OnResize(EventArgs eventargs)
    {
        cacheDirty = true;
        if (resizeTimer != null)
        {
            resizeTimer.Stop();
            resizeTimer.Start();
        }
        Invalidate();
        base.OnResize(eventargs);
    }

    protected override void OnPaint(PaintEventArgs e)
    {
        base.OnPaint(e);
        if (image == null || ClientSize.Width <= 0 || ClientSize.Height <= 0) return;

        if (cache == null)
        {
            RebuildCache();
        }

        if (cacheDirty && cache != null)
        {
            e.Graphics.InterpolationMode = InterpolationMode.Low;
            e.Graphics.PixelOffsetMode = PixelOffsetMode.Half;
            e.Graphics.DrawImage(cache, ClientRectangle);
            return;
        }

        if (cache != null)
        {
            e.Graphics.DrawImageUnscaled(cache, 0, 0);
        }
    }

    protected override void Dispose(bool disposing)
    {
        if (disposing)
        {
            DisposeImage();
            if (resizeTimer != null)
            {
                resizeTimer.Dispose();
                resizeTimer = null;
            }
        }
        base.Dispose(disposing);
    }

    private void RebuildCache()
    {
        if (image == null || ClientSize.Width <= 0 || ClientSize.Height <= 0) return;

        Bitmap next = new Bitmap(ClientSize.Width, ClientSize.Height);
        using (Graphics g = Graphics.FromImage(next))
        {
            g.SmoothingMode = SmoothingMode.HighQuality;
            g.InterpolationMode = InterpolationMode.HighQualityBicubic;
            g.PixelOffsetMode = PixelOffsetMode.Half;
            g.CompositingQuality = CompositingQuality.HighQuality;
            g.Clear(GetBackColor());
            Rectangle dest = GetImageRectangle();
            g.DrawImage(image, dest);
        }

        if (cache != null) cache.Dispose();
        cache = next;
        cacheDirty = false;
    }

    private Rectangle GetImageRectangle()
    {
        double scale;
        if (ScaleMode == ImageScaleMode.FitWidth)
        {
            scale = ClientSize.Width / (double)image.Width;
        }
        else
        {
            scale = Math.Max(ClientSize.Width / (double)image.Width, ClientSize.Height / (double)image.Height);
        }

        int drawWidth = (int)Math.Ceiling(image.Width * scale);
        int drawHeight = (int)Math.Ceiling(image.Height * scale);
        int x;
        int y;

        if (HorizontalAlign == ImageHorizontalAlign.Left) x = 0;
        else if (HorizontalAlign == ImageHorizontalAlign.Right) x = ClientSize.Width - drawWidth;
        else x = (ClientSize.Width - drawWidth) / 2;

        if (VerticalAlign == ImageVerticalAlign.Top) y = 0;
        else if (VerticalAlign == ImageVerticalAlign.Bottom) y = ClientSize.Height - drawHeight;
        else y = (ClientSize.Height - drawHeight) / 2;

        return new Rectangle(x, y, drawWidth, drawHeight);
    }

    private Color GetBackColor()
    {
        if (BackColor == Color.Transparent && Parent != null)
        {
            return Parent.BackColor;
        }
        return BackColor;
    }

    private void DisposeImage()
    {
        if (cache != null)
        {
            cache.Dispose();
            cache = null;
        }
        if (image != null)
        {
            image.Dispose();
            image = null;
        }
        cacheDirty = true;
    }
}

internal sealed class SingleInstance : IDisposable
{
    private readonly string name;
    private Mutex mutex;

    public SingleInstance(string mutexName)
    {
        name = mutexName;
    }

    public bool TryAcquire()
    {
        bool createdNew;
        mutex = new Mutex(true, name, out createdNew);
        if (!createdNew)
        {
            mutex.Dispose();
            mutex = null;
        }
        return createdNew;
    }

    public void Dispose()
    {
        if (mutex == null) return;
        try { mutex.ReleaseMutex(); }
        catch { }
        mutex.Dispose();
        mutex = null;
    }
}

internal static class NativeMethods
{
    [DllImport("shell32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern int SetCurrentProcessExplicitAppUserModelID(string appID);

    [DllImport("user32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern IntPtr FindWindow(string lpClassName, string lpWindowName);

    [DllImport("user32.dll")]
    private static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);

    [DllImport("user32.dll")]
    private static extern bool SetForegroundWindow(IntPtr hWnd);

    public static void SetAppUserModelId(string appId)
    {
        try { SetCurrentProcessExplicitAppUserModelID(appId); }
        catch { }
    }

    public static void ShowExistingWindow(string title)
    {
        try
        {
            IntPtr hwnd = FindWindow(null, title);
            if (hwnd != IntPtr.Zero)
            {
                ShowWindow(hwnd, 9);
                SetForegroundWindow(hwnd);
            }
        }
        catch
        {
        }
    }
}
