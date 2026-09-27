using System;
using System.Drawing;
using System.IO;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;
using System.Windows.Forms;
using Microsoft.Win32;

namespace NetunimPreview
{
    [ComImport, Guid("8895B1C6-B41F-4C1C-A562-0D564250836F"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    internal interface IPreviewHandler
    {
        void SetWindow(IntPtr hwnd, ref RECT rect);
        void SetRect(ref RECT rect);
        void DoPreview();
        void Unload();
        void SetFocus();
        void QueryFocus(out IntPtr hwnd);
        [PreserveSig] uint TranslateAccelerator(ref MSG msg);
    }

    [ComImport, Guid("B7D14566-0509-4CCE-A71F-0A554233BD9B"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    internal interface IInitializeWithFile
    {
        void Initialize([MarshalAs(UnmanagedType.LPWStr)] string filePath, uint mode);
    }

    [ComImport, Guid("7F73BE3F-FB79-493C-A6C7-7EE14E245841"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    internal interface IInitializeWithItem
    {
        void Initialize([MarshalAs(UnmanagedType.Interface)] object item, uint mode);
    }

    [StructLayout(LayoutKind.Sequential)]
    internal struct RECT
    {
        public int Left;
        public int Top;
        public int Right;
        public int Bottom;
        public RECT(int left, int top, int right, int bottom)
        {
            Left = left; Top = top; Right = right; Bottom = bottom;
        }
    }

    [StructLayout(LayoutKind.Sequential)]
    internal struct POINT { public int X; public int Y; }

    [StructLayout(LayoutKind.Sequential)]
    internal struct MSG
    {
        public IntPtr hwnd;
        public uint message;
        public UIntPtr wParam;
        public IntPtr lParam;
        public uint time;
        public POINT pt;
    }

    internal sealed class PreviewPanel : Panel
    {
        private static readonly Guid ShellItemGuid = new Guid("43826D1E-E718-42EE-BC55-A1E261C37BFE");
        private const string PreviewHandlerKey = "{8895B1C6-B41F-4C1C-A562-0D564250836F}";
        private object handlerObject;
        private IPreviewHandler handler;

        [DllImport("shell32.dll", CharSet = CharSet.Unicode, PreserveSig = true)]
        private static extern int SHCreateItemFromParsingName(
            [MarshalAs(UnmanagedType.LPWStr)] string path,
            IntPtr bindContext,
            ref Guid riid,
            out IntPtr item);

        public PreviewPanel()
        {
            Dock = DockStyle.Fill;
            BackColor = Color.White;
        }

        public string CurrentHandlerId { get; private set; }

        public bool OpenPreview(string filePath, out string error)
        {
            error = null;
            UnloadPreview();
            if (String.IsNullOrWhiteSpace(filePath) || !File.Exists(filePath))
            {
                error = "Preview file does not exist.";
                return false;
            }

            Guid clsid = FindPreviewHandler(filePath);
            if (clsid == Guid.Empty)
            {
                error = "No Windows preview handler is registered for this file type.";
                return false;
            }

            try
            {
                Type type = Type.GetTypeFromCLSID(clsid, true);
                handlerObject = Activator.CreateInstance(type);
                bool initialized = false;

                IInitializeWithFile fileInitializer = handlerObject as IInitializeWithFile;
                if (fileInitializer != null)
                {
                    fileInitializer.Initialize(filePath, 0);
                    initialized = true;
                }
                else
                {
                    IInitializeWithItem itemInitializer = handlerObject as IInitializeWithItem;
                    if (itemInitializer != null)
                    {
                        IntPtr shellItemPtr = IntPtr.Zero;
                        try
                        {
                            Guid iid = ShellItemGuid;
                            int hr = SHCreateItemFromParsingName(filePath, IntPtr.Zero, ref iid, out shellItemPtr);
                            if (hr < 0) Marshal.ThrowExceptionForHR(hr);
                            object shellItem = Marshal.GetObjectForIUnknown(shellItemPtr);
                            try { itemInitializer.Initialize(shellItem, 0); }
                            finally { if (Marshal.IsComObject(shellItem)) Marshal.FinalReleaseComObject(shellItem); }
                            initialized = true;
                        }
                        finally
                        {
                            if (shellItemPtr != IntPtr.Zero) Marshal.Release(shellItemPtr);
                        }
                    }
                }

                if (!initialized)
                {
                    error = "The registered preview handler cannot be initialized from a local file.";
                    UnloadPreview();
                    return false;
                }

                handler = handlerObject as IPreviewHandler;
                if (handler == null)
                {
                    error = "The registered COM object does not implement IPreviewHandler.";
                    UnloadPreview();
                    return false;
                }

                RECT rect = new RECT(0, 0, Math.Max(1, ClientSize.Width), Math.Max(1, ClientSize.Height));
                handler.SetWindow(Handle, ref rect);
                handler.DoPreview();
                CurrentHandlerId = clsid.ToString("B");
                return true;
            }
            catch (Exception ex)
            {
                error = ex.GetType().Name + ": " + ex.Message;
                UnloadPreview();
                return false;
            }
        }

        protected override void OnResize(EventArgs e)
        {
            base.OnResize(e);
            if (handler == null) return;
            try
            {
                RECT rect = new RECT(0, 0, Math.Max(1, ClientSize.Width), Math.Max(1, ClientSize.Height));
                handler.SetRect(ref rect);
            }
            catch { }
        }

        public void UnloadPreview()
        {
            if (handler != null)
            {
                try { handler.Unload(); } catch { }
            }
            handler = null;
            CurrentHandlerId = null;
            if (handlerObject != null && Marshal.IsComObject(handlerObject))
            {
                try { Marshal.FinalReleaseComObject(handlerObject); } catch { }
            }
            handlerObject = null;
        }

        private static Guid FindPreviewHandler(string filePath)
        {
            string extension = Path.GetExtension(filePath);
            if (String.IsNullOrWhiteSpace(extension)) return Guid.Empty;

            Guid result = ReadHandlerGuid(extension + "\\ShellEx\\" + PreviewHandlerKey);
            if (result != Guid.Empty) return result;

            string className = ReadDefaultValue(extension);
            if (!String.IsNullOrWhiteSpace(className))
            {
                result = ReadHandlerGuid(className + "\\ShellEx\\" + PreviewHandlerKey);
                if (result != Guid.Empty) return result;
            }

            return ReadHandlerGuid("SystemFileAssociations\\" + extension + "\\ShellEx\\" + PreviewHandlerKey);
        }

        private static string ReadDefaultValue(string keyPath)
        {
            try
            {
                using (RegistryKey key = Registry.ClassesRoot.OpenSubKey(keyPath))
                {
                    object value = key == null ? null : key.GetValue(null);
                    return value == null ? String.Empty : Convert.ToString(value).Trim();
                }
            }
            catch { return String.Empty; }
        }

        private static Guid ReadHandlerGuid(string keyPath)
        {
            string value = ReadDefaultValue(keyPath);
            Guid guid;
            return Guid.TryParse(value, out guid) ? guid : Guid.Empty;
        }

        protected override void Dispose(bool disposing)
        {
            if (disposing) UnloadPreview();
            base.Dispose(disposing);
        }
    }

    internal sealed class PreviewForm : Form
    {
        private const int GWL_HWNDPARENT = -8;
        private static readonly IntPtr HWND_TOP = new IntPtr(0);
        private const uint SWP_NOACTIVATE = 0x0010;
        private const uint SWP_SHOWWINDOW = 0x0040;
        private readonly PreviewPanel previewPanel;

        [DllImport("user32.dll")]
        private static extern IntPtr GetForegroundWindow();

        [DllImport("user32.dll", EntryPoint = "SetWindowLongPtrW")]
        private static extern IntPtr SetWindowLongPtr64(IntPtr hwnd, int index, IntPtr newValue);

        [DllImport("user32.dll", EntryPoint = "SetWindowLongW")]
        private static extern IntPtr SetWindowLong32(IntPtr hwnd, int index, IntPtr newValue);

        [DllImport("user32.dll")]
        [return: MarshalAs(UnmanagedType.Bool)]
        private static extern bool SetWindowPos(IntPtr hwnd, IntPtr insertAfter, int x, int y, int cx, int cy, uint flags);

        private static IntPtr SetOwner(IntPtr hwnd, IntPtr owner)
        {
            return IntPtr.Size == 8 ? SetWindowLongPtr64(hwnd, GWL_HWNDPARENT, owner) : SetWindowLong32(hwnd, GWL_HWNDPARENT, owner);
        }

        public PreviewForm()
        {
            FormBorderStyle = FormBorderStyle.None;
            ShowInTaskbar = false;
            StartPosition = FormStartPosition.Manual;
            BackColor = Color.White;
            previewPanel = new PreviewPanel();
            Controls.Add(previewPanel);
            Size = new Size(900, 700);
        }

        protected override bool ShowWithoutActivation { get { return true; } }

        protected override CreateParams CreateParams
        {
            get
            {
                CreateParams cp = base.CreateParams;
                cp.ExStyle |= 0x00000080; // WS_EX_TOOLWINDOW
                return cp;
            }
        }

        public bool Open(string path, int x, int y, int width, int height, out string handlerId, out string error)
        {
            handlerId = null;
            error = null;
            IntPtr owner = GetForegroundWindow();
            if (owner != IntPtr.Zero && owner != Handle)
            {
                try { SetOwner(Handle, owner); } catch { }
            }
            ApplyBounds(x, y, width, height);
            if (!Visible) Show();
            ApplyBounds(x, y, width, height);
            if (!previewPanel.OpenPreview(path, out error))
            {
                HidePreview();
                return false;
            }
            handlerId = previewPanel.CurrentHandlerId;
            ApplyBounds(x, y, width, height);
            return true;
        }

        public void MovePreview(int x, int y, int width, int height)
        {
            if (!Visible) return;
            ApplyBounds(x, y, width, height);
        }

        private void ApplyBounds(int x, int y, int width, int height)
        {
            width = Math.Max(200, Math.Min(5000, width));
            height = Math.Max(160, Math.Min(4000, height));
            SetWindowPos(Handle, HWND_TOP, x, y, width, height, SWP_NOACTIVATE | SWP_SHOWWINDOW);
        }

        public void HidePreview()
        {
            previewPanel.UnloadPreview();
            Hide();
        }
    }

    internal static class Program
    {
        private static PreviewForm form;
        private static readonly object outputLock = new object();

        [STAThread]
        private static void Main()
        {
            Console.InputEncoding = Encoding.UTF8;
            Console.OutputEncoding = Encoding.UTF8;
            Application.EnableVisualStyles();
            Application.SetCompatibleTextRenderingDefault(false);
            form = new PreviewForm();
            IntPtr handle = form.Handle;

            Thread inputThread = new Thread(ReadCommands);
            inputThread.IsBackground = true;
            inputThread.Name = "NetunimPreviewCommands";
            inputThread.Start();

            Application.Run();
            form.Dispose();
        }

        private static void ReadCommands()
        {
            string line;
            while ((line = Console.ReadLine()) != null)
            {
                string captured = line;
                try
                {
                    form.BeginInvoke(new Action(delegate { HandleCommand(captured); }));
                }
                catch { break; }
            }
            try { form.BeginInvoke(new Action(delegate { form.HidePreview(); Application.ExitThread(); })); } catch { }
        }

        private static void HandleCommand(string line)
        {
            string[] parts = line.Split('\t');
            string id = parts.Length > 0 ? parts[0] : "0";
            string command = parts.Length > 1 ? parts[1] : String.Empty;
            try
            {
                if (command == "PING")
                {
                    Reply(id, true, "PONG");
                    return;
                }
                if (command == "HIDE")
                {
                    form.HidePreview();
                    Reply(id, true, "HIDDEN");
                    return;
                }
                if (command == "EXIT")
                {
                    form.HidePreview();
                    Reply(id, true, "BYE");
                    Application.ExitThread();
                    return;
                }
                if (command == "MOVE")
                {
                    if (parts.Length < 6) throw new InvalidOperationException("MOVE requires x y width height.");
                    form.MovePreview(ParseInt(parts[2]), ParseInt(parts[3]), ParseInt(parts[4]), ParseInt(parts[5]));
                    Reply(id, true, "MOVED");
                    return;
                }
                if (command == "OPEN")
                {
                    if (parts.Length < 7) throw new InvalidOperationException("OPEN requires path x y width height.");
                    string path = Encoding.UTF8.GetString(Convert.FromBase64String(parts[2]));
                    string handlerId, error;
                    bool ok = form.Open(path, ParseInt(parts[3]), ParseInt(parts[4]), ParseInt(parts[5]), ParseInt(parts[6]), out handlerId, out error);
                    if (!ok) throw new InvalidOperationException(error ?? "Preview handler failed.");
                    Reply(id, true, "OPENED " + (handlerId ?? String.Empty));
                    return;
                }
                throw new InvalidOperationException("Unknown command: " + command);
            }
            catch (Exception ex)
            {
                Reply(id, false, ex.GetType().Name + ": " + ex.Message);
            }
        }

        private static int ParseInt(string value)
        {
            int result;
            if (!Int32.TryParse(value, out result)) throw new FormatException("Invalid integer: " + value);
            return result;
        }

        private static void Reply(string id, bool ok, string message)
        {
            string safe = (message ?? String.Empty).Replace("\r", " ").Replace("\n", " ").Replace("\t", " ");
            lock (outputLock)
            {
                Console.WriteLine(id + "\t" + (ok ? "OK" : "ERR") + "\t" + safe);
                Console.Out.Flush();
            }
        }
    }
}
