using System;
using System.Drawing;
using System.Runtime.InteropServices;
using System.Windows.Forms;
namespace NetunimPreview
{
    internal static class ViewportGeometryTests
    {
        private delegate IntPtr WindowProc(IntPtr hwnd, uint message, IntPtr wparam, IntPtr lparam);
        [StructLayout(LayoutKind.Sequential, CharSet=CharSet.Unicode)]
        private struct WindowClass { public uint style; public WindowProc procedure; public int extraClass, extraWindow; public IntPtr instance, icon, cursor, background; public string menu, name; }
        [DllImport("user32.dll",CharSet=CharSet.Unicode)] private static extern ushort RegisterClass(ref WindowClass value);
        [DllImport("user32.dll",CharSet=CharSet.Unicode)] private static extern IntPtr CreateWindowEx(int extended,string type,string title,uint style,int x,int y,int width,int height,IntPtr parent,IntPtr menu,IntPtr instance,IntPtr parameter);
        [DllImport("user32.dll")] private static extern IntPtr DefWindowProc(IntPtr hwnd,uint message,IntPtr wparam,IntPtr lparam);
        [DllImport("user32.dll")] private static extern bool SetWindowPos(IntPtr hwnd,IntPtr after,int x,int y,int width,int height,uint flags);
        [DllImport("user32.dll")] private static extern bool ClientToScreen(IntPtr hwnd,ref POINT point);
        [DllImport("user32.dll")] private static extern bool DestroyWindow(IntPtr hwnd);
        private static WindowProc procedure=DefWindowProc;
        private static void Bounds(IntPtr window,int x,int y,int width,int height) { if(!SetWindowPos(window,IntPtr.Zero,x,y,width,height,0x0014))throw new Exception("fixture position failed"); }
        private static void Check(IntPtr owner,IntPtr page,int viewportWidth,int viewportHeight)
        {
            POINT expected=new POINT();expected.X=30;expected.Y=50;
            if(!ClientToScreen(page,ref expected))throw new Exception("fixture origin failed");
            Rectangle result=BrowserViewportGeometry.Resolve(owner,30,50,220,180,viewportWidth,viewportHeight);
            if(result!=new Rectangle(expected.X,expected.Y,220,180))throw new Exception("preview escaped page viewport: "+result);
        }
        private static void Reject(Action action) { try{action();}catch(InvalidOperationException){return;}throw new Exception("ambiguous or stale viewport was accepted"); }
        [STAThread] private static void Main()
        {
            NativeDpi.Enable();
            WindowClass type=new WindowClass();type.procedure=procedure;type.name="Chrome_RenderWidgetHostHWND";
            if(RegisterClass(ref type)==0)throw new Exception("fixture class registration failed");
            using(Form owner=new Form())
            {
                owner.StartPosition=FormStartPosition.Manual;owner.Location=new Point(-18000,-18000);owner.Size=new Size(1600,1000);owner.Show();
                IntPtr page=CreateWindowEx(0,type.name,"page",0x50000000,0,70,1000,700,owner.Handle,IntPtr.Zero,IntPtr.Zero,IntPtr.Zero);
                IntPtr console=CreateWindowEx(0,type.name,"devtools",0x50000000,1000,70,400,700,owner.Handle,IntPtr.Zero,IntPtr.Zero,IntPtr.Zero);
                if(page==IntPtr.Zero||console==IntPtr.Zero)throw new Exception("fixture window creation failed");
                try
                {
                    Check(owner.Handle,page,1000,700); // console docked right
                    Bounds(page,400,70,1000,700);Bounds(console,0,70,400,700);Check(owner.Handle,page,1000,700); // left
                    Bounds(page,0,70,1400,450);Bounds(console,0,520,1400,250);Check(owner.Handle,page,1400,450); // bottom
                    Bounds(page,0,70,1750,875);Bounds(console,0,945,1750,200);Check(owner.Handle,page,1750,875); // physical DPI size
                    Reject(delegate{BrowserViewportGeometry.Resolve(owner.Handle,30,50,220,180,1700,800);});
                    Bounds(console,0,70,1750,875);Reject(delegate{BrowserViewportGeometry.Resolve(owner.Handle,30,50,220,180,1750,875);});
                    Reject(delegate{BrowserViewportGeometry.Resolve(owner.Handle,-1,0,220,180,1750,875);});
                }
                finally { DestroyWindow(console);DestroyWindow(page);owner.Hide(); }
            }
            Console.WriteLine("PASS viewport geometry: right/left/bottom DevTools, DPI, negative screen origins, stale and ambiguous views");
        }
    }
}
