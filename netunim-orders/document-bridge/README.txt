NETUNIM Document Bridge v8 - Everything search + native Windows preview
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
