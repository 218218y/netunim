NETUNIM Document Bridge - local Everything content search
========================================================

Purpose
-------
The website calls only http://127.0.0.1:8766. The bridge queries the Everything
index on THIS Windows computer through the official ES command-line interface.
PDF files and OCR text are never uploaded to the website/Supabase.

Per-computer model
------------------
Install this bridge separately on every PC that uses document search. Each PC has:
- its own bridge token;
- its own list of allowed document roots;
- its own Everything index and update timing.
A shared network folder may be configured on several PCs; results still come from
each PC's local Everything index.
If the network folder and the local Drive folder are two mirrors of the same corpus,
prefer the local Drive root on each PC for lower latency and fewer duplicate results.
Add the network root only for documents that are not reliably mirrored locally.

Before install
--------------
1. Install/run Everything 1.5 on Windows.
2. In Everything, configure Content Indexing for PDF documents in the desired roots.
3. For a network/mapped folder, add it to Everything Folder Indexing. Enable
   "Rescan on full buffer" and a reasonable scheduled rescan because network change
   notifications can overflow/be missed. Keep Everything running in the background.
4. Confirm a manual Everything content: search finds text from the OCR PDFs.

Install
-------
Run install_document_bridge.bat on each PC. On first install enter one or more
roots separated by semicolons, for example:
  G:\My Drive\Documents; Z:\Shared PDFs
or a UNC path:
  \\server\share\PDF

The installer downloads the pinned official voidtools ES, verifies its Windows
Authenticode signature and version, installs the bridge under LocalAppData, and
adds an autostart launcher. The private bridge key is copied to the clipboard.
Paste that key into the website once on that PC/browser profile.

Reconfigure
-----------
Run:
  %LOCALAPPDATA%\NetunimDocumentBridge\configure_document_bridge.bat

Security model
--------------
- Bridge binds to 127.0.0.1 only.
- Search endpoint accepts plain user text, never raw Everything syntax.
- Bridge enforces ext:pdf + content: and configured roots itself.
- Browser never sends a file path to the open endpoint; it sends an expiring ID
  created by a recent search.
- CORS is restricted to configured site origins and localhost development origins.

Troubleshooting
---------------
Log: %LOCALAPPDATA%\NetunimDocumentBridge\bridge.log
Config: %LOCALAPPDATA%\NetunimDocumentBridge\config.json
Token: %LOCALAPPDATA%\NetunimDocumentBridge\bridge-token.txt
If Everything uses an older named 1.5a alpha instance the bridge probes it after
the current unnamed Everything 1.5 instance automatically.
