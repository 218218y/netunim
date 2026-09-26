NETUNIM Document Bridge v5 - direct Everything search for the website
=====================================================================

Search scope
------------
The Bridge searches the COMPLETE local Everything index. There is no second
folder allowlist in the Bridge. Whatever the local Everything instance indexes
is searchable from the website.

Website modes
-------------
1. Content files
   The Bridge builds an Everything content:"..." no-background-search: query.
   Search text is passed to ES after -- so the quotes in content:"..." remain
   part of the Everything query exactly. The Bridge does NOT use ES -search,
   because ES parses/removes quotes supplied to -search.

2. Everything
   The query is passed directly to Everything search syntax after --. Filters,
   paths, ext:, dm: and other Everything syntax are preserved.

Result limiting
---------------
The Bridge uses ES -max-results for the IPC viewport. It does NOT use ES -n.
Recent ES versions implement -n by adding a count: filter into the Everything
search itself; that changes the search expression and is undesirable for slow
content queries.

Unicode / Hebrew
----------------
ES output is forced to UTF-8 with:
  -cp 65001
and ES uses native Windows argument parsing with:
  -argv
This preserves Hebrew/Unicode query text, filenames and paths over Node pipes.

Opening files and folders
-------------------------
The browser sends only an expiring result ID. The Bridge first verifies that the
path still exists, then asks the Windows shell to perform the default action with:
  Invoke-Item -LiteralPath <result path>
The actual path is passed through an environment variable, not interpolated into
PowerShell source. This works for both folders (Explorer) and associated files,
and avoids treating explorer.exe's non-zero process exit code as an open failure.

Everything background process
-----------------------------
Everything.exe is started automatically with -startup when needed. A visible
Everything search window is not required. The Bridge uses the official ES IPC
client against the same local Everything instance/database.

Installation
------------
Run install_document_bridge.bat on each PC. The installer upgrades the Bridge,
verifies ES/Everything, starts Everything in hidden startup mode if required,
and opens:
  %LOCALAPPDATA%\NetunimDocumentBridge\INSTALLATION-LOG.txt
The website key is near the top of this file.

Logs
----
Installation information / website key:
  %LOCALAPPDATA%\NetunimDocumentBridge\INSTALLATION-LOG.txt
Runtime log (includes input query, exact Everything query, result count and time):
  %LOCALAPPDATA%\NetunimDocumentBridge\bridge.log
Console log:
  %LOCALAPPDATA%\NetunimDocumentBridge\bridge-console.log
ES installer log:
  %LOCALAPPDATA%\NetunimDocumentBridge\install-es.log

Security
--------
- Bridge binds only to 127.0.0.1.
- Requests require the per-computer Bridge token.
- CORS is limited to configured Netunim website origins/local development.
- Opening requires an unexpired result ID produced by an authenticated search.
- Files and extracted content stay on the local computer.
