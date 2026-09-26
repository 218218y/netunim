NETUNIM Document Bridge v7 - Everything search + rich local preview
=====================================================================

Search scope
------------
The Bridge searches the COMPLETE local Everything index. Whatever the local
Everything instance indexes is searchable from the website.

Website modes
-------------
1. Content files
   The Bridge builds an Everything content:"..." no-background-search: query.

2. Everything
   The query is passed directly to Everything search syntax. Filters, paths,
   ext:, dm: and other Everything syntax are preserved.

Unicode
-------
ES output is forced to UTF-8 with -cp 65001 and ES uses native Windows argument
parsing with -argv. This preserves Unicode query text, filenames and paths over
Node pipes.

Opening files and folders
-------------------------
The browser sends only an expiring result ID. The Bridge resolves the ID and
checks the path again immediately before opening it.

Both folders and documents now use .NET ProcessStartInfo with UseShellExecute=true.
That hands the path to the interactive Windows graphical shell and invokes its
registered default Open action. The Bridge does not wait for explorer.exe to
exit and does not depend on Shell.Application.Open.

Rich local preview
------------------
The preview never uploads the source file.

- PDF files are streamed from 127.0.0.1 and opened with Chromium PDF parameters
  toolbar=0, navpanes=0 and view=FitH. This hides the thumbnail/navigation pane
  and fits the page to the available preview width while mouse/keyboard scrolling
  stays inside the PDF viewer.
- Common images are streamed locally into the preview pane.
- Plain text files use a bounded local text preview.
- Word/Excel/PowerPoint/RTF preview uses the locally installed Microsoft Office
  application in hidden/read-only mode to create a cached PDF under:
    %LOCALAPPDATA%\NetunimDocumentBridge\preview-cache
  The source document is never modified. The PDF preserves normal Office page
  layout/formatting far better than extracted text.
- If Microsoft Office is unavailable or conversion fails, the Bridge falls back
  to Everything's indexed Content text when available.

The Office conversion cache is keyed by path + file size + modification time,
so repeated previews are fast. Old cache entries are removed automatically.

Everything background process
-----------------------------
Everything.exe is started automatically with -startup when needed. A visible
Everything search window is not required. The Bridge uses the official ES IPC
client against the same local Everything instance/database.

Installation
------------
Run install_document_bridge.bat on each PC. The installer upgrades the Bridge,
including office_preview.ps1, verifies ES/Everything, starts Everything in
background mode if required, and opens:
  %LOCALAPPDATA%\NetunimDocumentBridge\INSTALLATION-LOG.txt
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
- Files and extracted/generated preview content stay on the local computer.
