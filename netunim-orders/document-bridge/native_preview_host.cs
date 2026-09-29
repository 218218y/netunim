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

    [ComImport, Guid("00000114-0000-0000-C000-000000000046"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    internal interface IOleWindow
    {
        [PreserveSig] int GetWindow(out IntPtr hwnd);
        [PreserveSig] int ContextSensitiveHelp([MarshalAs(UnmanagedType.Bool)] bool enterMode);
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

    [Flags]
    internal enum FileDialogOptions : uint
    {
        NoChangeDirectory = 0x00000008,
        PickFolders = 0x00000020,
        ForceFileSystem = 0x00000040,
        PathMustExist = 0x00000800
    }

    internal enum ShellItemDisplayName : uint
    {
        FileSystemPath = 0x80058000
    }

    [ComImport, Guid("43826D1E-E718-42EE-BC55-A1E261C37BFE"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    internal interface IShellItem
    {
        void BindToHandler(IntPtr bindContext, ref Guid handlerId, ref Guid interfaceId, out IntPtr result);
        void GetParent(out IShellItem parent);
        void GetDisplayName(ShellItemDisplayName displayName, out IntPtr name);
        void GetAttributes(uint mask, out uint attributes);
        void Compare(IShellItem shellItem, uint hint, out int order);
    }

    [ComImport, Guid("D57C7288-D4AD-4768-BE02-9D969532D960"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    internal interface IFileOpenDialog
    {
        [PreserveSig] int Show(IntPtr parent);
        void SetFileTypes(uint count, IntPtr filterSpecs);
        void SetFileTypeIndex(uint index);
        void GetFileTypeIndex(out uint index);
        void Advise(IntPtr events, out uint cookie);
        void Unadvise(uint cookie);
        void SetOptions(FileDialogOptions options);
        void GetOptions(out FileDialogOptions options);
        void SetDefaultFolder(IShellItem shellItem);
        void SetFolder(IShellItem shellItem);
        void GetFolder(out IShellItem shellItem);
        void GetCurrentSelection(out IShellItem shellItem);
        void SetFileName([MarshalAs(UnmanagedType.LPWStr)] string name);
        void GetFileName(out IntPtr name);
        void SetTitle([MarshalAs(UnmanagedType.LPWStr)] string title);
        void SetOkButtonLabel([MarshalAs(UnmanagedType.LPWStr)] string label);
        void SetFileNameLabel([MarshalAs(UnmanagedType.LPWStr)] string label);
        void GetResult(out IShellItem shellItem);
        void AddPlace(IShellItem shellItem, int alignment);
        void SetDefaultExtension([MarshalAs(UnmanagedType.LPWStr)] string extension);
        void Close(int result);
        void SetClientGuid(ref Guid clientGuid);
        void ClearClientData();
        void SetFilter(IntPtr filter);
        void GetResults(out IntPtr shellItemArray);
        void GetSelectedItems(out IntPtr shellItemArray);
    }

    [ComImport, Guid("DC1C5A9C-E88A-4DDE-A5A1-60F82A20AEF7")]
    internal class FileOpenDialogCom
    {
    }

    internal static class ModernFolderPicker
    {
        private const int ErrorCancelled = unchecked((int)0x800704C7);
        private static readonly Guid ClientGuid = new Guid("0DF12263-C68C-4F68-9F66-78FCB8BF7DE4");

        public static string Pick(IntPtr ownerHandle)
        {
            IFileOpenDialog dialog = null;
            IShellItem selectedItem = null;
            IntPtr pathPointer = IntPtr.Zero;
            try
            {
                dialog = (IFileOpenDialog)new FileOpenDialogCom();
                FileDialogOptions options;
                dialog.GetOptions(out options);
                dialog.SetOptions(options | FileDialogOptions.NoChangeDirectory | FileDialogOptions.PickFolders | FileDialogOptions.ForceFileSystem | FileDialogOptions.PathMustExist);
                dialog.SetTitle("\u05d1\u05d7\u05e8 \u05ea\u05d9\u05e7\u05d9\u05d9\u05d4 \u05dc\u05d7\u05d9\u05e4\u05d5\u05e9");
                dialog.SetOkButtonLabel("\u05d1\u05d7\u05e8 \u05ea\u05d9\u05e7\u05d9\u05d9\u05d4");
                Guid clientGuid = ClientGuid;
                dialog.SetClientGuid(ref clientGuid);

                int result = dialog.Show(ownerHandle);
                if (result == ErrorCancelled) return null;
                if (result < 0) Marshal.ThrowExceptionForHR(result);

                dialog.GetResult(out selectedItem);
                if (selectedItem == null) return null;
                selectedItem.GetDisplayName(ShellItemDisplayName.FileSystemPath, out pathPointer);
                return pathPointer == IntPtr.Zero ? null : Marshal.PtrToStringUni(pathPointer);
            }
            finally
            {
                if (pathPointer != IntPtr.Zero) Marshal.FreeCoTaskMem(pathPointer);
                if (selectedItem != null && Marshal.IsComObject(selectedItem)) Marshal.FinalReleaseComObject(selectedItem);
                if (dialog != null && Marshal.IsComObject(dialog)) Marshal.FinalReleaseComObject(dialog);
            }
        }
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

    internal static class NativeDpi
    {
        private static readonly IntPtr PerMonitorAwareV2 = new IntPtr(-4);

        [DllImport("user32.dll", SetLastError = true)]
        [return: MarshalAs(UnmanagedType.Bool)]
        private static extern bool SetProcessDpiAwarenessContext(IntPtr dpiContext);

        [DllImport("user32.dll")]
        [return: MarshalAs(UnmanagedType.Bool)]
        private static extern bool SetProcessDPIAware();

        public static void Enable()
        {
            try
            {
                if (SetProcessDpiAwarenessContext(PerMonitorAwareV2)) return;
            }
            catch (EntryPointNotFoundException) { }
            catch (DllNotFoundException) { }

            try { SetProcessDPIAware(); }
            catch { }
        }
    }

    internal sealed class PreviewPanel : Panel
    {
        private static readonly Guid ShellItemGuid = new Guid("43826D1E-E718-42EE-BC55-A1E261C37BFE");
        private const string PreviewHandlerKey = "{8895B1C6-B41F-4C1C-A562-0D564250836F}";
        private object handlerObject;
        private IPreviewHandler handler;
        private readonly System.Windows.Forms.Timer settleTimer;
        private int settlePassesRemaining;
        private const uint SWP_NOZORDER = 0x0004;
        private const uint SWP_NOACTIVATE = 0x0010;
        private const uint SWP_SHOWWINDOW = 0x0040;

        [DllImport("user32.dll", SetLastError = true)]
        [return: MarshalAs(UnmanagedType.Bool)]
        private static extern bool GetClientRect(IntPtr hwnd, out RECT rect);

        [DllImport("user32.dll")]
        private static extern IntPtr GetParent(IntPtr hwnd);

        [DllImport("user32.dll", SetLastError = true)]
        [return: MarshalAs(UnmanagedType.Bool)]
        private static extern bool SetWindowPos(IntPtr hwnd, IntPtr insertAfter, int x, int y, int cx, int cy, uint flags);

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
            settleTimer = new System.Windows.Forms.Timer();
            settleTimer.Interval = 125;
            settleTimer.Tick += delegate
            {
                if (handler == null || settlePassesRemaining <= 0)
                {
                    settleTimer.Stop();
                    return;
                }
                settlePassesRemaining--;
                SynchronizePreviewBounds();
            };
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

                RECT rect = CurrentClientRect();
                handler.SetWindow(Handle, ref rect);
                handler.DoPreview();
                CurrentHandlerId = clsid.ToString("B");
                settlePassesRemaining = 10;
                SynchronizePreviewBounds();
                settleTimer.Start();
                return true;
            }
            catch (Exception ex)
            {
                error = ex.GetType().Name + ": " + ex.Message;
                UnloadPreview();
                return false;
            }
        }

        private RECT CurrentClientRect()
        {
            RECT rect;
            if (IsHandleCreated && GetClientRect(Handle, out rect))
            {
                rect.Left = 0;
                rect.Top = 0;
                rect.Right = Math.Max(1, rect.Right);
                rect.Bottom = Math.Max(1, rect.Bottom);
                return rect;
            }
            return new RECT(0, 0, Math.Max(1, ClientSize.Width), Math.Max(1, ClientSize.Height));
        }

        public void SynchronizePreviewBounds()
        {
            if (handler == null || !IsHandleCreated) return;
            RECT rect = CurrentClientRect();
            try { handler.SetWindow(Handle, ref rect); } catch { }
            try { handler.SetRect(ref rect); } catch { }

            try
            {
                IOleWindow oleWindow = handlerObject as IOleWindow;
                IntPtr previewWindow;
                if (oleWindow != null && oleWindow.GetWindow(out previewWindow) >= 0 && previewWindow != IntPtr.Zero && GetParent(previewWindow) == Handle)
                {
                    SetWindowPos(previewWindow, IntPtr.Zero, 0, 0, Math.Max(1, rect.Right), Math.Max(1, rect.Bottom), SWP_NOZORDER | SWP_NOACTIVATE | SWP_SHOWWINDOW);
                }
            }
            catch { }
        }

        protected override void OnResize(EventArgs e)
        {
            base.OnResize(e);
            SynchronizePreviewBounds();
        }

        public void UnloadPreview()
        {
            settleTimer.Stop();
            settlePassesRemaining = 0;
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
            if (disposing)
            {
                UnloadPreview();
                settleTimer.Dispose();
            }
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

        [DllImport("user32.dll")]
        private static extern uint GetDpiForWindow(IntPtr hwnd);

        public static IntPtr CurrentForegroundWindow()
        {
            try { return GetForegroundWindow(); }
            catch { return IntPtr.Zero; }
        }

        private static IntPtr SetOwner(IntPtr hwnd, IntPtr owner)
        {
            return IntPtr.Size == 8 ? SetWindowLongPtr64(hwnd, GWL_HWNDPARENT, owner) : SetWindowLong32(hwnd, GWL_HWNDPARENT, owner);
        }

        public PreviewForm()
        {
            FormBorderStyle = FormBorderStyle.None;
            ShowInTaskbar = false;
            StartPosition = FormStartPosition.Manual;
            AutoScaleMode = AutoScaleMode.None;
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

        public string Diagnostics
        {
            get
            {
                uint dpi = 96;
                try { dpi = GetDpiForWindow(Handle); }
                catch { }
                return "CLIENT=" + previewPanel.ClientSize.Width + "x" + previewPanel.ClientSize.Height + " DPI=" + dpi;
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
            previewPanel.SynchronizePreviewBounds();
            return true;
        }

        public void MovePreview(int x, int y, int width, int height)
        {
            if (!Visible) return;
            ApplyBounds(x, y, width, height);
            previewPanel.SynchronizePreviewBounds();
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
            NativeDpi.Enable();
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
                    Reply(id, true, "MOVED " + form.Diagnostics);
                    return;
                }
                if (command == "PICK_FOLDER")
                {
                    IntPtr ownerHandle = PreviewForm.CurrentForegroundWindow();
                    string selectedPath = ModernFolderPicker.Pick(ownerHandle);
                    if (String.IsNullOrWhiteSpace(selectedPath))
                    {
                        Reply(id, true, "CANCELLED");
                        return;
                    }
                    string encoded = Convert.ToBase64String(Encoding.UTF8.GetBytes(selectedPath));
                    Reply(id, true, "PICKED " + encoded);
                    return;
                }
                if (command == "OPEN")
                {
                    if (parts.Length < 7) throw new InvalidOperationException("OPEN requires path x y width height.");
                    string path = Encoding.UTF8.GetString(Convert.FromBase64String(parts[2]));
                    string handlerId, error;
                    bool ok = form.Open(path, ParseInt(parts[3]), ParseInt(parts[4]), ParseInt(parts[5]), ParseInt(parts[6]), out handlerId, out error);
                    if (!ok) throw new InvalidOperationException(error ?? "Preview handler failed.");
                    Reply(id, true, "OPENED " + (handlerId ?? String.Empty) + " " + form.Diagnostics);
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
