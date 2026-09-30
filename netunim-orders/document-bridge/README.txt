NETUNIM Document Bridge v29 - paged Everything search + AcroForm-aware PDF content + native preview
======================================================================

Shared website integration
--------------------------
One Bridge installation serves both Netunim Orders and Netunim Kupa on the same PC.
Both sites use the same loopback service on 127.0.0.1:8766 and the same per-computer
Bridge token. The default CORS allowlist includes both bargig-orders.pages.dev and
bargig-kupa.pages.dev families, plus the bargig-furniture.com production family.

Search scope
------------
The Bridge searches the COMPLETE local Everything index. Whatever the local
Everything instance indexes is searchable from the website.

Focused folder picker
---------------------
The search toolbar uses the native Windows IFileOpenDialog in folder mode. This
is the same modern Explorer-style shell surface used by current Windows apps, so
Quick Access, pinned locations and the normal navigation shortcuts remain
available. The selected item is still required to resolve to a filesystem path
because Everything scope filtering operates on real paths.

Website modes
-------------
1. File search (default)
   The query is passed directly to Everything search syntax. Filenames,
   folders, filters, paths, ext:, dm: and other Everything syntax are preserved.

2. Content search
   The Bridge builds an Everything content:"..." no-background-search: query.
   Interactive AcroForm PDFs also have a small local supplemental index. The
   supplemental extractor uses the same bundled PDF.js runtime as the website,
   reads logical page text plus text/choice form values directly from the PDF,
   and merges those matches with Everything results. It does not render pages to
   images and does not run OCR. This covers PDFs whose appearance streams use
   legacy Hebrew encodings that a Windows PDF iFilter may omit or expose in
   visual/reversed order. For interactive fields the index also keeps the PDF
   page number and widget rectangle. /documents/matches returns those anchors to
   the controlled PDF.js preview, so highlighting, first-match auto-scroll and
   next/previous navigation do not depend on the browser rediscovering the same
   AcroForm value a second time.

   The supplement snapshot is cached at:
     %LOCALAPPDATA%\NetunimDocumentBridge\pdf-form-index.json
   Incremental progress is appended to:
     %LOCALAPPDATA%\NetunimDocumentBridge\pdf-form-index.journal.jsonl
   Only PDFs already present in Everything are considered. Both interactive and
   non-interactive PDFs are fingerprinted after inspection, so an unchanged PDF
   is never reparsed merely because it has no form fields. Background discovery
   advances in small persisted batches; completed work survives Bridge upgrades,
   restarts and interrupted scans. PDF.js auxiliary CMap/font/WASM resources are read directly
   from local files with Unicode-safe Windows path handling, so Hebrew Windows
   user/profile names do not break standard-font loading.

Search latency
--------------
Filename and content searches are independent request lanes. The website starts
Everything filename search first and paints those rows as soon as they arrive;
content search follows without blocking the filename results. Interactive-PDF
index refresh is never awaited on the request path: the persisted index is used
immediately and refresh continues in the background. Boolean supplemental-index
filtering stops at the first qualifying match instead of materializing thousands
of highlight ranges per PDF.

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


Background PDF indexing
-----------------------
The supplemental index is incremental, not version-scoped. Installing a newer
Bridge does NOT intentionally rebuild all PDFs. An entry is re-inspected only
when Everything reports a changed size/date fingerprint or when it has never
been inspected. Negative results (ordinary PDFs without AcroForm fields) are
now cached too.

While an initial backlog exists, the Bridge processes only 8 PDFs per batch with
one PDF extraction at a time, appends that batch to a small crash-safe journal,
then yields before the next batch. The journal is compacted into the main snapshot
periodically, so progress survives interruption without rewriting a large JSON file
after every PDF. Active user searches take priority and postpone the next background batch.
This prevents a large Y:\ network archive from monopolizing CPU/network and means
a restart loses at most the current small batch rather than the entire scan.

Everything background process
-----------------------------
Everything.exe is started automatically with -startup when needed. A visible
Everything search window is not required. The Bridge uses the official ES IPC
client against the same local Everything instance/database.

Installation
------------
Run install_document_bridge.bat on each PC. The installer:
- builds NetunimPreviewHost.exe locally;
- upgrades the Bridge and stages the already-bundled local PDF.js runtime;
- verifies ES/Everything;
- starts Everything in background mode if required;
- preserves the existing supplemental PDF index without scanning PDFs during
  installation; after the new Bridge is healthy, background inspection resumes
  from the persisted fingerprints in small low-concurrency batches;
- stops the current Bridge listener before activation and then switches to a
  side-by-side versioned runtime through active-runtime.txt. The installer never
  renames or deletes the currently active runtime as a prerequisite for success,
  so a short-lived Windows file/current-directory handle cannot block an upgrade;
- cleans up verified old Bridge cmd/Node/NetunimPreviewHost helper processes and
  removes inactive runtimes only as best-effort maintenance after the new v29
  runtime has passed its health check;
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
- Content-search PDFs use the bundled local PDF.js viewer. Normal page-text matches use the PDF.js find controller. Interactive AcroForm text/choice values are searched separately from their logical /V values and merged into the same match sequence, while the PDF-authored appearance stream remains the visible source. Matching form fields receive the same persistent/current highlighting and the match arrows scroll through page-text and form-field matches as one sequence. The browser-native PDF iframe remains only a fallback if the controlled viewer cannot initialize.
- Office filename previews keep the Windows IPreviewHandler surface for layout fidelity. Content-search DOCX-family files use the local docx-preview runtime; Excel workbooks use the local SheetJS runtime in a Web Worker; plain text uses the browser DOM. These controlled viewers highlight all matches and the same match arrows scroll to the active result. Legacy DOC/RTF content falls back to Everything-extracted text because browser DOCX renderers cannot faithfully parse the old binary Word format.
- Match text is cached in memory for a short period by file path + size + modified time, with a small bounded cache. No snippets or file content are uploaded.

Paged search results
--------------------
Normal file/content searches return 150 results in the first batch. The website requests
additional 150-result pages only when the user approaches the bottom of the result pane.
The local API carries an explicit offset and hasMore flag; filename search pages Everything
directly, while content search re-merges Everything + interactive-PDF supplemental results
up to the requested window before slicing so cross-source ordering and de-duplication remain
correct. A 5000-result per-query safety ceiling prevents one UI search from allocating an
unbounded result set.


חיפוש כללי ריק: ה-Bridge מחזיר עד 150 קבצים אחרונים ישירות מאינדקס Everything, ממוינים לפי Date Modified, ללא סריקת דיסק.
