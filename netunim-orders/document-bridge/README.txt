NETUNIM Document Bridge v4 - Everything search for the website
===============================================================

What changed in v4
------------------
The Bridge now searches the COMPLETE Everything index. It no longer maintains a
second folder allowlist (Y:\, C:\, Drive, etc). Whatever is indexed and searchable
in the local Everything instance is the database searched by the website.

There are two website search modes:
1. Content - sends a literal content:"..." query to Everything.
2. Everything - sends the query directly to Everything search syntax, like the
   Everything search box itself. Example: יבמות, ext:pdf יבמות, dm:thisweek.

Unicode / Hebrew
----------------
ES writes pipe output using its console code page. v4 forces:
  -cp 65001
so JSON output is UTF-8, and also uses:
  -argv
so ES parses the Windows command line with CommandLineToArgvW. This is important
for Hebrew/Unicode search text and Hebrew filenames/paths.

Everything background process
-----------------------------
Everything.exe is started automatically with -startup when needed. No visible
search window is required. The Bridge talks to the local Everything IPC through
the official ES command-line client.

Installation
------------
Run install_document_bridge.bat on each PC.
There is no Bridge folder-selection step anymore. Configure disks/folders/content
indexing only in Everything itself. The installer checks the complete Everything
index and opens:
  %LOCALAPPDATA%\NetunimDocumentBridge\INSTALLATION-LOG.txt
The key to paste into the website is near the top of this file.

Opening results
---------------
The browser sends only the temporary result ID back to the Bridge. The browser
cannot submit an arbitrary filesystem path. The Bridge verifies that the result
still exists, then opens files through Windows Start-Process (default association)
and folders through Explorer. The API returns success only after Windows accepts
the launch request.

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
- CORS is limited to the configured Netunim website origins/local development.
- Opening a file/folder requires an unexpired result ID produced by a recent
  authenticated Everything search.
- Files and extracted content remain on the local computer.
