NETUNIM Document Bridge v11 - Everything search + DPI-correct native Windows preview
======================================================================

Search scope
------------
The Bridge searches the COMPLETE local Everything index. Whatever the local
Everything instance indexes is searchable from the website.

Website modes
-------------
1. File search (default)
   The query is passed directly to Everything search syntax. Filenames,
   folders, filters, paths, ext:, dm: and other Everything syntax are preserved.

2. Content search
   The Bridge builds an Everything content:"..." no-background-search: query.

Unicode
-------
ES output is forced to UTF-8 with -cp 65001 and ES uses native Windows argument
parsing with -argv. This preserves Unicode query text, filenames and paths over
Node pipes.

Opening files and folders
-------------------------
The browser sends only an expiring result ID. The Bridge resolves the ID and
checks the path again immediately before opening it.

Both folders and documents use .NET ProcessStartInfo with UseShellExecute=true.
That hands the path to the interactive Windows graphical shell and invokes its
registered default Open action.

Local preview
-------------
The preview never uploads the source file.

- PDF files are streamed from 127.0.0.1 into the browser PDF viewer.
- Common images are streamed locally into the preview pane.
- Plain text files use a bounded local text preview.
- Word/Excel/PowerPoint/RTF use the Windows system IPreviewHandler associated
  with the file extension. This is the same Windows preview layer normally used
  by Everything and File Explorer. Office applications are NOT launched and no
  temporary PDF is exported for the normal Office preview path.

The native Windows preview is hosted by NetunimPreviewHost.exe. The installer
builds this small local helper from native_preview_host.cs with the .NET
Framework compiler already included in Windows. The helper has no network
access. It receives only a local file path from the authenticated Bridge and
hosts the registered Windows Preview Handler in a borderless owned window that
is positioned over the website preview pane.

Why this changed
----------------
The previous implementation automated Word/Excel/PowerPoint and exported a PDF.
That could be slow on first use, could trigger Office startup/security UI, and
could not reproduce Excel workbook tabs or the exact system preview appearance.
The native Preview Handler path avoids Office automation and uses the same class
of preview component that Everything normally hosts.

DPI and resize correctness
--------------------------
Browser geometry is measured in CSS pixels, while a native Windows preview host
must be positioned in device pixels. The website converts preview coordinates
with window.devicePixelRatio before sending them to the Bridge.

NetunimPreviewHost.exe enables Per-Monitor-V2 DPI awareness before creating any
UI. It reads its real client RECT from Windows and reapplies SetWindow + SetRect
to the active IPreviewHandler on every resize/MOVE, even when the requested outer
bounds did not numerically change. When the handler exposes IOleWindow and its
preview HWND is a direct child of our host, that child is also resized to fill
the complete client area. A short settle pass repeats the bounds after DoPreview
for handlers (notably some Office handlers) that create their child UI lazily.

The browser also forces a geometry resync when its window regains focus. This
prevents another preview host or a monitor/DPI transition from leaving a stale
Office preview size behind.

Everything background process
-----------------------------
Everything.exe is started automatically with -startup when needed. A visible
Everything search window is not required. The Bridge uses the official ES IPC
client against the same local Everything instance/database.

Installation
------------
Run install_document_bridge.bat on each PC. The installer:
- builds NetunimPreviewHost.exe locally;
- upgrades the Bridge;
- verifies ES/Everything;
- starts Everything in background mode if required;
- opens %LOCALAPPDATA%\NetunimDocumentBridge\INSTALLATION-LOG.txt.
The website key is near the top of this file.

Logs
----
Installation information / website key:
  %LOCALAPPDATA%\NetunimDocumentBridge\INSTALLATION-LOG.txt
Runtime log:
  %LOCALAPPDATA%\NetunimDocumentBridge\bridge.log
Console log:
  %LOCALAPPDATA%\NetunimDocumentBridge\bridge-console.log
ES installer log:
  %LOCALAPPDATA%\NetunimDocumentBridge\install-es.log

Security
--------
- Bridge binds only to 127.0.0.1.
- Requests require the per-computer Bridge token.
- CORS is limited to configured website origins/local development.
- Open and preview operations accept only an unexpired result ID produced by an
  authenticated search. The browser cannot submit an arbitrary filesystem path.
- Files and preview content stay on the local computer.

Content-search match highlighting
---------------------------------
Highlighting is intentionally computed only for the single selected result. The main Everything result list is never rescanned for snippets.

- Text previews highlight the selected content-search phrase directly in the preview.
- Content-search PDFs use the bundled local PDF.js viewer. Its find controller highlights every match and the match arrows select and scroll to the previous/next occurrence. The browser-native PDF iframe remains only a fallback if the controlled viewer cannot initialize.
- Office previews keep the Windows IPreviewHandler surface for layout fidelity. IPreviewHandler has no generic API for injecting search highlights, so a compact local match bar above the native preview shows the match count and highlighted context snippets instead of manipulating the Office preview window.
- Match text is cached in memory for a short period by file path + size + modified time, with a small bounded cache. No snippets or file content are uploaded.

