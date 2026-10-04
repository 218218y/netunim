NETUNIM Document Bridge v38 - paged Everything search + AcroForm-aware PDF content + native preview
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
   supplemental extractor uses the pinned bundled PDF.js release, with the
   legacy build required explicitly for Node.js (no modern-build fallback),
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
   is never reparsed merely because it has no form fields. Scheduled maintenance
   advances in bounded persisted runs; completed work survives Bridge upgrades,
   restarts and interrupted scans. PDF.js auxiliary CMap/font/WASM resources are read directly
   from local files with Unicode-safe Windows path handling, so Hebrew Windows
   user/profile names do not break standard-font loading.

Search latency
--------------
Filename and content searches are independent request lanes. The website starts
Everything filename search first and paints those rows as soon as they arrive;
content search follows without blocking the filename results. Interactive-PDF
index maintenance is never started on the search or warm request path: the persisted
index is used immediately. Boolean supplemental-index
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


Node runtime baseline
---------------------
The Windows Document Bridge does not depend on a machine-wide Node installation.
The installer provisions the reviewed Windows x64 Node.js 24.21.0 executable into
a versioned private runtime under %LOCALAPPDATA%\NetunimDocumentBridge and
activates it through node-runtime.txt only after verification. The official
node.exe is pinned to SHA-256:
  ba4e6d110e8c1592a1ecd390f6b05f3da124b13871a5be62b341a07a853c6c32

The download URL contains the exact release number; it never follows latest/LTS
aliases. The official node-v24.21.0-win-x64.zip archive is pinned to SHA-256
158f7685b44de51f6c0df1d153526cbcd3e1bc739a8dfc607721cef75de9e541; the
extracted node.exe is independently pinned to the SHA-256 shown above. The
installer first prefers a verified local archive next to the installer, in the
user Downloads folder or under the Bridge downloads folder, then uses the exact
official Node release URL with a bounded timeout. install_node_runtime.ps1 verifies
both hashes and process.versions.node before changing node-runtime.txt. Installer scratch is
created under the private Bridge AppRoot rather than $env:TEMP: Windows PowerShell's
FileSystem provider can fail Remove-Item on 8.3 TEMP paths used by some Unicode account
names. Scratch cleanup uses System.IO and is best-effort, so a cleanup failure is logged but
can never replace the real installation result or its primary exception. A failed Bridge
upgrade restores the previous Node pointer and keeps the previous active Bridge runtime.
After a successful health check, inactive private Node runtime directories are removed as
best-effort cleanup.

Normal startup, manual Bridge configuration and scheduled PDF maintenance all
resolve node.exe through node-runtime.txt. They never use PATH, `where node` or
`Get-Command node.exe`. On Windows, server.mjs also verifies that process.execPath
is the exact private node.exe selected by the pointer; doctor/install diagnostics
add a SHA-256 verification. A global Node installation is therefore not required
on end-user PCs after this installer is used.

The PDF.js legacy Node build probes for @napi-rs/canvas during module import.
Netunim's Node PDF path is intentionally text/annotation extraction only and
never calls page.render(). PDF.js 6.3.289 therefore does not need native canvas
for this workload. The Bridge suppresses only the exact optional-canvas import
warnings emitted for a missing @napi-rs/canvas package; any different PDF.js
warning is still printed. The installer doctor verifies the real text-only
legacy runtime before activation.

PDF.js regression corpus
------------------------
Every reviewed PDF.js runtime must pass `npm run pdfjs:check` before deployment.
That command now verifies the pinned vendor bytes/API surface, synchronized site
assets, and tests/fixtures/pdf-corpus through tests/pdfjs_corpus.test.mjs. The
corpus is intentionally small and immutable and covers an ordinary text PDF, a
Hebrew AcroForm with text/checkbox/select values, a 120-page PDF, an empty PDF,
a deliberately corrupt/truncated PDF and a password-protected PDF. manifest.json
pins every fixture by SHA-256 and byte count, so accidental fixture regeneration
or line-ending rewriting fails the gate instead of silently changing the baseline.

Scheduled PDF maintenance
-------------------------
The Bridge listener never scans PDFs on startup, warm or search. Windows Task
Scheduler starts a separate short-lived Node process daily at 12:00, after a
missed start when Windows permits, with low priority and AC power required.
Each scheduled run handles at most 300 changed PDFs or 15 minutes, whichever comes first.
A manual Force refresh is intentionally unbounded by file count or elapsed time and continues
until every currently changed candidate has been inspected, unless the user stops it. The
process exits when the run finishes. A second run cannot overlap the first.

Each normal daily maintenance window performs a full PDF metadata reconciliation
against Everything so newly copied or moved PDFs are discovered even when their
Date Modified value is old. Manual -Force refreshes always request the same full
metadata reconciliation. No PDF content is read during metadata comparison;
only new, changed, failed-due-for-retry or extractor-revision candidates are
opened. The date-modified incremental query remains only for continuation runs
inside the same maintenance window, with a one-day overlap. A checkpoint advances
only after the candidate set is complete, so unfinished work is reconsidered at
the next run.

The persisted index has independent detection, search-text and geometry revisions.
Missing geometry is recovered only when that PDF is previewed; it does not add
the whole library to the maintenance queue. Unchanged negative results remain
cached. Failed PDFs use increasing retry delays from one to seven days; password
protected files wait 30 days. A changed fingerprint is inspected immediately.
Every inspected record is journaled before the next file, and a file lock
protects journal/snapshot changes from concurrent preview enrichment.

Run maintenance manually if needed:
  powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%LOCALAPPDATA%\NetunimDocumentBridge\run_pdf_maintenance.ps1" -Force
The runner reads both active-runtime.txt and node-runtime.txt, so the scheduled
worker uses the same pinned private Node executable as the listener. A manual
-Force run has no file-count or 15-minute cap by default; -MaxFiles N can be used
to impose an explicit file-count cap for command-line maintenance when desired.
The status endpoint exposes the last attempt, successful run and result counters;
bridge.log records trigger, bytes read, CPU time and elapsed time.

`server.mjs --doctor` also queries Task Scheduler and prints State, enabled/trigger
status, whether the schedule is active, Last Run Time, Last Result, Next Run Time
and missed-run count. It validates that the registered action points to the
expected run_pdf_maintenance.ps1 under the Bridge home. This Task Scheduler query
is diagnostic-only (doctor/install summary); normal startup/search requests never
run Get-ScheduledTask/Get-ScheduledTaskInfo or schtasks.

Everything background process
-----------------------------
Everything.exe is started automatically with -startup when needed. A visible
Everything search window is not required. The Bridge uses the official ES IPC
client against the same local Everything instance/database.

Installation
------------
Run install_document_bridge.bat on each PC. The installer:
- installs/reuses the exact private Node.js 24.21.0 runtime and verifies its pinned
  SHA-256 before changing node-runtime.txt;
- builds NetunimPreviewHost.exe locally;
- upgrades the Bridge and stages the already-bundled local PDF.js runtime;
- imports and validates the staged PDF.js legacy runtime during Bridge diagnostics.
  PDF.js version changes are separately blocked by the repository verification gate
  (`npm run pdfjs:check` and the normal JS test suite) unless the immutable corpus passes;
- verifies ES/Everything;
- starts Everything in background mode if required;
- preserves the existing supplemental PDF index without scanning PDFs during
  installation and registers daily AC-only PDF maintenance;
- stops the current Bridge listener before activation and then switches to a
  side-by-side versioned runtime through active-runtime.txt. The installer never
  renames or deletes the currently active runtime as a prerequisite for success,
  so a short-lived Windows file/current-directory handle cannot block an upgrade;
- cleans up verified old Bridge cmd/Node/NetunimPreviewHost helper processes and
  removes inactive Bridge/Node runtimes only as best-effort maintenance after
  the new v38 runtime has passed its health check;
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
Node installer log:
  %LOCALAPPDATA%\NetunimDocumentBridge\install-node.log

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
