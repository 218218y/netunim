using System;
using System.Diagnostics;
using System.IO;
using System.Text.RegularExpressions;
using System.Threading;

internal static class BankBridgeStartup
{
    private static readonly string Root = Path.GetFullPath(Path.Combine(AppDomain.CurrentDomain.BaseDirectory, ".."));
    private static readonly object LogLock = new object();

    private static int Main()
    {
        int result = 1;
        foreach (int delay in new[] { 0, 2, 5, 10 })
        {
            if (delay > 0)
            {
                WriteLog("autostart.log", "Retrying Bank Bridge in " + delay + " seconds.");
                Thread.Sleep(TimeSpan.FromSeconds(delay));
            }
            result = Launch();
            if (result == 0) break;
        }
        return result;
    }

    private static int Launch()
    {
        WriteLog("autostart.log", "Starting Bank Bridge from the Windows sign-in task.");
        try
        {
            // Hold the installer lock only until the listener has initialized.
            using (var startupLock = File.Open(Path.Combine(Root, "setup.lock"), FileMode.OpenOrCreate, FileAccess.ReadWrite, FileShare.None))
            {
                string runtime = File.ReadAllText(Path.Combine(Root, "node-runtime.txt")).Trim();
                if (!Regex.IsMatch(runtime, @"\Anode-v[0-9]+\.[0-9]+\.[0-9]+-win-x64-[0-9]{8}-[0-9]{6}-[0-9]+-[0-9a-f]{8}\z"))
                    throw new InvalidDataException("The private Node runtime pointer is invalid. Rerun the installer.");
                string server = Path.Combine(Root, "app", "server.mjs");
                if (!File.Exists(server)) throw new FileNotFoundException("The installed Bank Bridge server is missing.");

                using (var child = new Process())
                {
                    child.StartInfo = new ProcessStartInfo
                    {
                        FileName = Path.Combine(Root, runtime, "node.exe"),
                        Arguments = "\"" + server + "\"",
                        WorkingDirectory = Root,
                        UseShellExecute = false,
                        CreateNoWindow = true,
                        RedirectStandardOutput = true,
                        RedirectStandardError = true
                    };
                    child.OutputDataReceived += (sender, entry) =>
                    {
                        if (entry.Data == null) return;
                        if (Regex.IsMatch(entry.Data, @"\ANetunim Kupa Bank Bridge v[0-9]+ listening on http://127\.0\.0\.1:8765\z"))
                        {
                            startupLock.Dispose();
                            WriteLog("autostart.log", "Bank Bridge is listening on 127.0.0.1:8765.");
                        }
                        WriteLog("bridge.log", entry.Data);
                    };
                    child.ErrorDataReceived += (sender, entry) =>
                    {
                        if (entry.Data != null) WriteLog("bridge.log", entry.Data);
                    };
                    child.Start();
                    child.BeginOutputReadLine();
                    child.BeginErrorReadLine();
                    child.WaitForExit();
                    WriteLog("autostart.log", "Bank Bridge exited with code " + child.ExitCode + ".");
                    return child.ExitCode;
                }
            }
        }
        catch (Exception error)
        {
            WriteLog("autostart.log", "Bank Bridge launcher failed: " + error.Message);
            return 1;
        }
    }

    private static void WriteLog(string file, string line)
    {
        lock (LogLock)
        {
            try
            {
                string prefix = file == "autostart.log" ? DateTimeOffset.Now.ToString("o") + " " : "";
                File.AppendAllText(Path.Combine(Root, file), prefix + line + Environment.NewLine);
            }
            catch (IOException) { }
            catch (UnauthorizedAccessException) { }
        }
    }
}
