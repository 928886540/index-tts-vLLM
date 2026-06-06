using System;
using System.Diagnostics;
using System.IO;
using System.Text;
using System.Windows.Forms;

internal static class LeonLauncherBootstrap
{
    [STAThread]
    private static int Main(string[] args)
    {
        string baseDir = AppDomain.CurrentDomain.BaseDirectory;
        string launcherScript = Path.Combine(baseDir, "LEON-Launcher.ps1");
        if (!File.Exists(launcherScript))
        {
            launcherScript = Path.Combine(baseDir, "launcher", "LEON-Launcher.ps1");
        }

        if (!File.Exists(launcherScript))
        {
            ShowError(
                "\u627e\u4e0d\u5230\u542f\u52a8\u5668\u811a\u672c\uff1a\r\n" + launcherScript +
                "\r\n\r\n\u8bf7\u786e\u8ba4 LEON-Launcher.exe \u5728 leon_api \u6839\u76ee\u5f55\uff0c\u6216\u8005 LEON-Launcher.ps1 \u5728\u540c\u4e00\u4e2a\u6587\u4ef6\u5939\u3002");
            return 2;
        }

        string powershell = Path.Combine(
            Environment.GetFolderPath(Environment.SpecialFolder.System),
            "WindowsPowerShell\\v1.0\\powershell.exe");
        if (!File.Exists(powershell))
        {
            powershell = "powershell.exe";
        }

        try
        {
            ProcessStartInfo psi = new ProcessStartInfo();
            psi.FileName = powershell;
            psi.WorkingDirectory = baseDir;
            psi.UseShellExecute = false;
            psi.CreateNoWindow = true;
            psi.Arguments = "-NoProfile -ExecutionPolicy Bypass -File " + QuoteArgument(launcherScript);
            psi.EnvironmentVariables["LEON_LAUNCHER_SCRIPT"] = launcherScript;

            using (Process proc = Process.Start(psi))
            {
                if (proc == null)
                {
                    ShowError("\u542f\u52a8 PowerShell \u5931\u8d25\uff0c\u8bf7\u68c0\u67e5 Windows PowerShell \u662f\u5426\u53ef\u7528\u3002");
                    return 3;
                }
                proc.WaitForExit();
                return proc.ExitCode;
            }
        }
        catch (Exception ex)
        {
            ShowError("\u542f\u52a8 LEON \u542f\u52a8\u5668\u5931\u8d25\uff1a\r\n" + ex.Message);
            return 1;
        }
    }

    private static string QuoteArgument(string value)
    {
        if (string.IsNullOrEmpty(value))
        {
            return "\"\"";
        }

        StringBuilder quoted = new StringBuilder();
        quoted.Append('"');
        int backslashes = 0;
        foreach (char c in value)
        {
            if (c == '\\')
            {
                backslashes++;
                continue;
            }

            if (c == '"')
            {
                quoted.Append('\\', backslashes * 2 + 1);
                quoted.Append('"');
                backslashes = 0;
                continue;
            }

            if (backslashes > 0)
            {
                quoted.Append('\\', backslashes);
                backslashes = 0;
            }
            quoted.Append(c);
        }

        if (backslashes > 0)
        {
            quoted.Append('\\', backslashes * 2);
        }
        quoted.Append('"');
        return quoted.ToString();
    }

    private static void ShowError(string message)
    {
        MessageBox.Show(message, "LEON Launcher", MessageBoxButtons.OK, MessageBoxIcon.Error);
    }
}
