NETUNIM Document Bridge v6 - Everything search + local preview
===============================================================

Search scope
------------
The Bridge searches the COMPLETE local Everything index. There is no second
folder allowlist in the Bridge. Whatever the local Everything instance indexes
is searchable from the website.

Website modes
-------------
1. Content files
   The Bridge builds an Everything content:"..." no-background-search: query.
   Search text is passed to ES after -- so quotes remain part of the Everything
   query exactly.

2. Everything
   The query is passed directly to Everything search syntax after --. Filters,
   paths, ext:, dm: and other Everything syntax are preserved.

Unicode
-------
ES output is forced to UTF-8 with -cp 65001 and ES uses native Windows argument
parsing with -argv. This preserves Unicode query text, filenames and paths over
Node pipes.

Result list and preview
-----------------------
Document search uses a compact Everything-style result table. A single click
selects a result and loads the preview pane; a double click opens the result in
Windows.

Preview stays local:
- PDF and common images are loaded from the local Bridge into an in-browser blob.
- Text files are read locally with a bounded preview size.
- Office/other document types first use Everything's Content property when it is
  available, providing a fast text preview without uploading the document.
- Unsupported/very large files show metadata and can still be opened in Windows.

Opening files and folders
-------------------------
The browser sends only an expiring result ID. The Bridge verifies the path on
 disk immediately before opening it.

Files use PowerShell Start-Process, which asks Windows to use the registered
default application.

Folders use the documented Windows Shell.Application Open method. This hands the
folder to the interactive Explorer shell and returns immediately, avoiding the
previous explorer.exe / Invoke-Item lifecycle problem where the Bridge waited but
no Explorer window appeared.

Everything background process
-----------------------------
Everything.exe is started automatically with -startup when needed. A visible
Everything search window is not required. The Bridge uses the official ES IPC
client against the same local Everything instance/database.

Installation
------------
Run install_document_bridge.bat on each PC. The installer upgrades the Bridge,
verifies ES/Everything, starts Everything in background mode if required, and
opens:
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
- Files and extracted content stay on the local computer.
