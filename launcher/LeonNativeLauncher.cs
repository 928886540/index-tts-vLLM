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

    private readonly string workspaceRoot;
    private readonly string launcherDir;
    private readonly string scriptsDir;
    private readonly string staticDir;
    private readonly string iconPath;
    private readonly object logLock = new object();
    private readonly Dictionary<string, string> logTexts = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
    private readonly JavaScriptSerializer json = new JavaScriptSerializer();

    private string versionKey = "vllm";
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

    private Icon launcherIcon;
    private Panel homePanel;
    private Panel logPanel;
    private Panel envPanel;
    private RichTextBox logBox;
    private DataGridView envGrid;
    private Label statusLabel;
    private Button startButton;
    private Button navHomeButton;
    private Button navLogButton;
    private Button navEnvButton;
    private Button tabLauncherButton;
    private Button tabApiButton;
    private Button tabStdoutButton;
    private Button tabStderrButton;
    private Button vllmButton;
    private Button fast6gButton;
    private TextBox ratioBox;
    private System.Windows.Forms.Timer logTimer;
    private System.Windows.Forms.Timer healthTimer;
    private string activeView = "home";
    private string activeLogTab = "launcher";

    public LauncherForm()
    {
        workspaceRoot = AppDomain.CurrentDomain.BaseDirectory.TrimEnd(Path.DirectorySeparatorChar, Path.AltDirectorySeparatorChar);
        launcherDir = Path.Combine(workspaceRoot, "launcher");
        scriptsDir = Path.Combine(workspaceRoot, "scripts");
        staticDir = Path.Combine(workspaceRoot, "static");
        iconPath = Path.Combine(launcherDir, "leon-launcher.ico");

        logTexts["launcher"] = string.Empty;
        logTexts["api"] = string.Empty;
        logTexts["stdout"] = string.Empty;
        logTexts["stderr"] = string.Empty;

        string envVersion = Environment.GetEnvironmentVariable("LEON_LAUNCHER_VERSION");
        if (string.Equals(envVersion, "fast6g", StringComparison.OrdinalIgnoreCase))
        {
            versionKey = "fast6g";
        }

        double parsedRatio;
        string envRatio = Environment.GetEnvironmentVariable("INDEXTTS_VLLM_GPU_MEMORY_UTILIZATION");
        if (!string.IsNullOrWhiteSpace(envRatio) &&
            double.TryParse(envRatio, System.Globalization.NumberStyles.Float, System.Globalization.CultureInfo.InvariantCulture, out parsedRatio) &&
            parsedRatio > 0)
        {
            vllmGpuRatio = parsedRatio;
        }

        SetVersion(versionKey, false);
        BuildUi();
        AddLauncherLog("LEON 真 EXE 启动器已打开。");
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
        banner.ScaleMode = ImageScaleMode.FitWidth;
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

        navHomeButton = CreateSideButton("首页", 18, delegate { ShowView("home"); });
        navLogButton = CreateSideButton("日志", 64, delegate { ShowView("log"); });
        navEnvButton = CreateSideButton("环境检测", 110, delegate { ShowView("env"); RunEnvironmentCheckAsync(); });
        side.Controls.Add(navHomeButton);
        side.Controls.Add(navLogButton);
        side.Controls.Add(navEnvButton);

        Panel bottomPanel = new Panel();
        bottomPanel.Dock = DockStyle.Bottom;
        bottomPanel.Height = 132;
        bottomPanel.BackColor = side.BackColor;
        side.Controls.Add(bottomPanel);

        Panel configRow = new Panel();
        configRow.Location = new Point(0, 0);
        configRow.Size = new Size(208, 34);
        configRow.BackColor = side.BackColor;
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

        CachedImagePanel sidePoster = new CachedImagePanel();
        sidePoster.BackColor = side.BackColor;
        sidePoster.ScaleMode = ImageScaleMode.FitWidth;
        sidePoster.HorizontalAlign = ImageHorizontalAlign.Center;
        sidePoster.VerticalAlign = ImageVerticalAlign.Center;
        sidePoster.SetImagePath(Path.Combine(launcherDir, "left.png"));
        side.Controls.Add(sidePoster);
        sidePoster.SendToBack();

        EventHandler resizeSidePoster = delegate
        {
            int contentWidth = Math.Min(208, Math.Max(120, side.ClientSize.Width - 36));
            int left = Math.Max(0, (side.ClientSize.Width - contentWidth) / 2);

            navHomeButton.Location = new Point(left, 18);
            navHomeButton.Size = new Size(contentWidth, 38);
            navLogButton.Location = new Point(left, 64);
            navLogButton.Size = new Size(contentWidth, 38);
            navEnvButton.Location = new Point(left, 110);
            navEnvButton.Size = new Size(contentWidth, 38);

            configRow.Location = new Point(Math.Max(0, (bottomPanel.ClientSize.Width - contentWidth) / 2), 0);
            configRow.Size = new Size(contentWidth, 34);
            startButton.Location = new Point(Math.Max(0, (bottomPanel.ClientSize.Width - contentWidth) / 2), 44);
            startButton.Size = new Size(contentWidth, 68);

            int top = 164;
            int bottomGap = bottomPanel.Height + 18;
            int height = Math.Max(120, side.ClientSize.Height - top - bottomGap);
            sidePoster.Location = new Point(left, top);
            sidePoster.Size = new Size(contentWidth, height);
        };
        side.Resize += resizeSidePoster;
        bottomPanel.Resize += resizeSidePoster;
        resizeSidePoster(side, EventArgs.Empty);

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
        homeImage.ScaleMode = ImageScaleMode.FitWidth;
        homeImage.HorizontalAlign = ImageHorizontalAlign.Center;
        homeImage.VerticalAlign = ImageVerticalAlign.Center;
        homeImage.SetImagePath(Path.Combine(launcherDir, "home.png"));
        homePanel.Controls.Add(homeImage);

        logPanel = BuildLogPanel();
        content.Controls.Add(logPanel);

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
        tabs.Height = 42;
        tabs.WrapContents = false;
        tabs.Padding = new Padding(0, 0, 0, 8);
        tabs.BackColor = panel.BackColor;
        panel.Controls.Add(tabs);

        tabLauncherButton = CreateLogTabButton("启动器", "launcher");
        tabApiButton = CreateLogTabButton("服务日志", "api");
        tabStdoutButton = CreateLogTabButton("服务启动", "stdout");
        tabStderrButton = CreateLogTabButton("诊断日志", "stderr");
        tabs.Controls.Add(tabLauncherButton);
        tabs.Controls.Add(tabApiButton);
        tabs.Controls.Add(tabStdoutButton);
        tabs.Controls.Add(tabStderrButton);

        logBox = new RichTextBox();
        logBox.Dock = DockStyle.Fill;
        logBox.BorderStyle = BorderStyle.None;
        logBox.ReadOnly = true;
        logBox.WordWrap = false;
        logBox.DetectUrls = false;
        logBox.BackColor = Color.FromArgb(8, 12, 17);
        logBox.ForeColor = Color.FromArgb(222, 230, 238);
        logBox.Font = NewMonoFont(9.0f);
        panel.Controls.Add(logBox);
        logBox.BringToFront();

        SetLogTabActive("launcher");
        return panel;
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

        Button refresh = CreateFlatButton("刷新检测", 0, 0, 116, 34, Color.FromArgb(48, 68, 88), delegate { RunEnvironmentCheckAsync(); });
        top.Controls.Add(refresh);

        Label tip = new Label();
        tip.Text = "轻量检测只查启动必需项，不在打开页面时跑重型修复。";
        tip.Location = new Point(132, 8);
        tip.Size = new Size(620, 22);
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

        string apiText = string.Empty;
        try
        {
            string jsonText = HttpGet(ApiBase + "/server_log/tail?n=220", 1600);
            apiText = ParseServerLogTail(jsonText);
        }
        catch
        {
            apiText = string.Empty;
        }
        if (string.IsNullOrWhiteSpace(apiText))
        {
            apiText = "服务日志暂无有效内容。已隐藏 /health 和 /server_log/tail 自检请求。";
        }
        result["api"] = NormalizeLogText(apiText);

        string stdoutText = string.Empty;
        if (!string.IsNullOrWhiteSpace(latestStartupLog) && File.Exists(latestStartupLog))
        {
            stdoutText = ReadLauncherLogTail(latestStartupLog, 160);
        }
        result["stdout"] = string.IsNullOrWhiteSpace(stdoutText) ? "未发现当前服务启动日志。" : stdoutText;

        string stderrText = string.Empty;
        if (!string.IsNullOrWhiteSpace(latestStartupErr) && File.Exists(latestStartupErr))
        {
            stderrText = ReadLauncherLogTail(latestStartupErr, 160);
        }
        result["stderr"] = string.IsNullOrWhiteSpace(stderrText) ? "未发现当前诊断日志。" : stderrText;

        return result;
    }

    private void RunEnvironmentCheckAsync()
    {
        SetStatus("正在做轻量环境检测...", Color.Khaki);
        Task.Factory.StartNew(delegate
        {
            List<EnvRow> rows = new List<EnvRow>();
            rows.Add(new EnvRow("项目目录", Directory.Exists(workspaceRoot) ? "OK" : "FAIL", workspaceRoot));
            rows.Add(new EnvRow("当前版本", "INFO", GetVersionLabel()));
            rows.Add(new EnvRow("启动脚本", File.Exists(startupBat) ? "OK" : "FAIL", startupBat));
            rows.Add(new EnvRow("项目 Python Runtime", File.Exists(runtimePython) ? "OK" : "FAIL", runtimePython));
            rows.Add(new EnvRow("静态资源目录", Directory.Exists(staticDir) ? "OK" : "FAIL", staticDir));
            rows.Add(new EnvRow("首页图", File.Exists(Path.Combine(launcherDir, "home.png")) ? "OK" : "WARN", Path.Combine(launcherDir, "home.png")));
            rows.Add(new EnvRow("横幅图", File.Exists(Path.Combine(launcherDir, "head.png")) ? "OK" : "WARN", Path.Combine(launcherDir, "head.png")));
            rows.Add(new EnvRow("左侧图", File.Exists(Path.Combine(launcherDir, "left.png")) ? "OK" : "WARN", Path.Combine(launcherDir, "left.png")));

            List<int> portPids = GetListeningPidsForPort(ApiPort);
            rows.Add(new EnvRow("API 端口 9880", portPids.Count > 0 ? "RUN" : "FREE", portPids.Count > 0 ? "监听 PID: " + string.Join(", ", ToStringArray(portPids)) : "端口未监听"));
            rows.Add(new EnvRow("API 健康检查", TestApiHealth(1300) ? "OK" : "WAIT", TestApiHealth(1300) ? ApiBase + "/health 正常" : "服务未启动或还在加载"));

            RefreshStartupLogPaths();
            rows.Add(new EnvRow("日志目录", Directory.Exists(logDir) ? "OK" : "INFO", logDir));
            rows.Add(new EnvRow("服务启动日志", !string.IsNullOrWhiteSpace(latestStartupLog) ? "OK" : "INFO", string.IsNullOrWhiteSpace(latestStartupLog) ? "暂无 api_restart_stable_*.log" : latestStartupLog));
            rows.Add(new EnvRow("诊断日志", !string.IsNullOrWhiteSpace(latestStartupErr) ? "OK" : "INFO", string.IsNullOrWhiteSpace(latestStartupErr) ? "暂无 api_restart_stable_*.err" : latestStartupErr));

            BeginUi(delegate
            {
                ApplyEnvironmentRows(rows);
                SetStatus("轻量环境检测完成。", Color.LightGreen);
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
        }
    }

    private void ShowView(string view)
    {
        activeView = view;
        homePanel.Visible = view == "home";
        logPanel.Visible = view == "log";
        envPanel.Visible = view == "env";
        if (homePanel.Visible) homePanel.BringToFront();
        if (logPanel.Visible) logPanel.BringToFront();
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
        StyleLogTab(tabStdoutButton, key == "stdout");
        StyleLogTab(tabStderrButton, key == "stderr");
        UpdateActiveLogBox(true);
    }

    private void UpdateActiveLogBox(bool forceScroll)
    {
        if (logBox == null || logBox.IsDisposed) return;
        if (logBox.SelectionLength > 0) return;

        string text;
        lock (logLock)
        {
            if (!logTexts.TryGetValue(activeLogTab, out text)) text = string.Empty;
        }
        if (string.IsNullOrWhiteSpace(text)) text = "暂无日志。";
        if (logBox.Text == text) return;

        logBox.SuspendLayout();
        logBox.Text = text;
        if (forceScroll || logBox.SelectionLength == 0)
        {
            logBox.SelectionStart = logBox.TextLength;
            logBox.SelectionLength = 0;
            logBox.ScrollToCaret();
        }
        logBox.ResumeLayout();
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

    private string GetRatioText()
    {
        return vllmGpuRatio.ToString("0.###", System.Globalization.CultureInfo.InvariantCulture);
    }

    private string GetVersionLabel()
    {
        return versionKey == "fast6g" ? "fast6g 双加速 6G" : "vLLM 质量版";
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
        object value;
        if (!dict.TryGetValue(key, out value) || value == null) return string.Empty;
        return Convert.ToString(value);
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
