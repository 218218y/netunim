NETUNIM KUPA - BANK HAPOALIM BRIDGE
====================================

Purpose
-------
Kupa is a static PWA and must not contain or centrally store Bank Hapoalim credentials.
The Bank Bridge is a small Windows-local Node.js service bound only to 127.0.0.1:8765.
It logs in locally, returns the selected account's current balance plus a bounded recent transaction feed, and never stores Bank Hapoalim credentials in Kupa/cloud data.

Installation / upgrade (Windows)
--------------------------------
1. Install Node.js 22.22.2 or newer and keep Google Chrome or Microsoft Edge installed/up to date.
2. Run install_bank_bridge.bat.
3. The installer first builds and validates a staged runtime. Only after it succeeds does it stop an older Netunim bridge and activate the new runtime under:
   %LOCALAPPDATA%\NetunimKupaBankBridge\app
4. The Startup entry is a fixed ASCII-only VBS launcher. It resolves %LOCALAPPDATA% when Windows starts; it never stores the path of the ZIP/project folder and therefore is not broken by Hebrew/non-ASCII Windows paths or by moving the project folder.
5. The installer starts the bridge hidden, verifies /health, and copies this computer's random Bridge key to the clipboard.
6. Open Kupa -> Bank, paste that key, enter the Hapoalim user code/password and, when more than one account exists, enter BOTH branch number and account number. Hapoalim account IDs are built exactly as 12-branch-account; the Bridge never guesses a branch from an account-number suffix.
7. Click "Refresh now" for a silent test. If the bank requires extra verification, use "Open bank verification"; only that button opens a visible Chrome/Edge window.

Several computers
-----------------
Install and configure the Bridge separately on every computer from which Kupa should be able to refresh the bank.
Each computer intentionally has its own Bridge key and its own DPAPI-encrypted copy of the Hapoalim credentials.
The password is never synchronized between computers. The successful Hapoalim sync timestamp is stored with the shared Kupa bank snapshot,
so another computer using the same Kupa cloud data sees that a refresh already succeeded and will not auto-refresh again until 24 hours have passed.

Security model
--------------
- HTTP binds only to 127.0.0.1, not to the LAN or Internet.
- Every private endpoint requires a random Bearer key; /health contains no bank data.
- Credentials are encrypted with Windows DPAPI CurrentUser under %LOCALAPPDATA%\NetunimKupaBankBridge.
- Kupa never stores the Hapoalim user code/password in localStorage, JSON, backups, Supabase or the deployed site.
- The browser stores only the local Bridge key and the auto-refresh preference for that browser profile.
- The scraper uses Chrome/Edge already installed on Windows. Puppeteer's own browser download is disabled.
- A dedicated browser profile under the Bridge data directory is reused to preserve harmless browser/device state between bank sessions; it is not the user's normal Chrome profile.

Automatic and manual refresh
----------------------------
"Refresh now" and the automatic refresh are headless/silent. They do not open a bank window.
Automatic refresh becomes due 24 hours after the last successful Hapoalim sync stored in the shared Kupa state, not after a manual balance edit.
If Kupa was closed when the period elapsed, it checks on the next opening. Failed background attempts never overwrite the existing balance and are throttled for one hour on that computer.
If Hapoalim requires an additional interactive step, use "Open bank verification" explicitly.

Bridge v10 deliberately does not call israeli-bank-scrapers.scrape() as one all-or-nothing operation. After login it waits until both the Hapoalim SPA REST context and accounts service are really available, selects the configured account, reads that account's currentBalance as the required result, and only then requests recent transactions. This avoids losing a valid balance because another account or the optional transaction endpoint failed.

The recent feed requests the complete rolling 30-day window with the same 1000-row page size used by the pinned Hapoalim scraper. Each raw Hapoalim transaction also carries currentBalance; Bridge v10 preserves it as balanceAfter so Kupa can show the bank-provided balance after that transaction instead of reconstructing it locally. A transaction-fetch failure is partial success: the balance and successful bank-sync time are still saved, while Kupa shows a warning instead of returning a generic failed balance update.
The normalized feed (balance, selected account, successful sync time, recent transactions and warning) is stored with Kupa's shared bank state so all Kupa computers see the same last successful result. Its versioned shape is intended to be reusable by the Orders app later; Orders is not wired to write/read this feed in this patch.


Session-aware login (Bridge v10)
--------------------------------
The Hapoalim scraper library historically classifies login success by a fixed list of post-login URLs. Hapoalim may route a valid authenticated account to a different SPA URL, which can make the library return UNKNOWN_ERROR even while the bank account is visibly open. Bridge v10 does not trust the URL as the authority. Login success is also recognized when the page exposes the Hapoalim REST context and the authenticated /ServerServices/general/accounts request succeeds.

After a successful run the Bridge remembers only the successful Hapoalim page origin/path (never query/hash tokens). On later refreshes it first tries to reuse that authenticated browser session from the dedicated persistent Chrome/Edge profile. Only when the saved session is no longer usable does it run the credential login flow again. Silent login waits up to 90 seconds; if the bank requires renewed user verification, the Bridge reports AUTH_REQUIRED and the user can explicitly choose "פתח אימות בבנק".

Exact account selection (Bridge v10)
-----------------------------------
Bank Hapoalim identifies a current account to its internal API as bank-branch-account. For Bank Hapoalim the bank number is 12, so branch 123 and account 456789 become 12-123-456789.
Kupa stores branch and account as separate fields in the local Bridge credentials. If an account number alone is ambiguous, missing or stale, the Bridge returns only a safe list of open account identifiers (bank/branch/account) and Kupa renders them as selectable choices. Choosing one updates only the encrypted local account selector; the bank password does not need to be typed again. Closed accounts are excluded using the same accountClosingReasonCode rule as the pinned Hapoalim scraper.
A failed refresh also preserves the exact failure stage and upstream Hapoalim HTTP status when available, instead of hiding every failure behind the loopback endpoint's HTTP 400.

Maintenance
-----------
- To reinstall or upgrade: run install_bank_bridge.bat again. The old runtime is not replaced until staging checks pass.
- To show the local Bridge key from the installed runtime: cd /d "%LOCALAPPDATA%\NetunimKupaBankBridge\app" then node server.mjs --print-token
- To start manually for diagnostics: run the installed start_bank_bridge.bat without --hidden.
- Runtime log for hidden startup: %LOCALAPPDATA%\NetunimKupaBankBridge\bridge.log
- To remove only Windows autostart: remove_bank_bridge_autostart.bat
- To remove saved bank credentials: use Kupa's "Delete login details from this computer" button.

Dependency
----------
The bridge pins israeli-bank-scrapers 6.9.0. Bank websites can change without notice; if Bank Hapoalim changes its login/site flow, the pinned scraper may need a reviewed update.

Interactive bank verification
-----------------------------
If Bank Hapoalim requests an SMS/voice verification code, use "פתח אימות בבנק" in Kupa.
The visible Chrome/Edge window may stay open for up to 10 minutes while waiting for the verification flow to reach a real success/error page. It closes immediately when the login reaches a terminal result; there is no fixed delay after successful verification.

The Bridge reuses the same dedicated browser profile and remembers the same Chrome/Edge executable on that Windows computer. This preserves bank cookies/device state as far as Bank Hapoalim permits. The bank can still require verification again according to its own security policy.

Bridge v10 — יציבות ניווט ו-feed מלא ל-30 יום
-----------------------------------
החל מ-v10 קריאת יתרה ותנועות אינה מתחילה ברגע הראשון שבו דף החשבון נראה פתוח. ה-Bridge דורש חלון יציבות קצר של ה-SPA/API, ואם Puppeteer מאבד Execution Context בגלל redirect פנימי הוא ממתין לסשן מאומת ויציב ומנסה מחדש עד שלוש פעמים. שגיאות API אמיתיות אינן מוסתרות ואינן מקבלות retry אוטומטי.
במסך הקופה כפתורי הרענון, זמן העדכון האחרון וכשל העדכון האחרון נשארים גלויים; מפתח ה-Bridge, פרטי החשבון והעדכון האוטומטי נמצאים תחת 'הגדרות חיבור וסנכרון' הסגורות כברירת מחדל.


Cheque deposit enrichment (Bridge v10)

The bridge now treats only an explicit cheque-deposit activityDescription as a cheque deposit. Beneficiary/memo text is never used for classification; this fixes false positives such as Hebrew personal names that happen to contain the letters צק. Returned-cheque and ordinary cheque-debit transactions are not treated as deposits.

The pinned Hapoalim scraper publicly types the pfmDetails response only far enough to extract transactionNumber. It does not publish a stable schema for the per-cheque table or cheque images visible in the bank UI. Bridge v10 therefore does not expose arbitrary primitive pfmDetails fields. Generic values such as transactionStatusCode=0, transactionSum=0, check=false and multiCheck=false are ignored. If a bank response explicitly contains structured cheque rows (positive amount plus cheque number or full bank/branch/account identity), those rows are preserved as checkItems and shown by Kupa. Zero identifiers are rejected.

Potential image/scan/document URLs, session values, cookies and tokens are never persisted. At most a boolean document-presence marker survives. A failure to enrich one deposit never invalidates balance or the main transaction feed.

Transaction storage and retention (Bridge v10)
---------------------------------------------
Kupa stores bank.feed inside the ordinary Kupa state. Therefore every successful bank refresh is also copied to the browser recovery snapshot (localStorage + IndexedDB). In Supabase mode the same feed is saved in the shared Kupa cloud document; in file/directory mode it is saved in the Kupa JSON file.
The canonical feed is a rolling 30-day snapshot, not a long-term bank archive. A later successful refresh replaces the previous feed, so transactions that have moved outside the bank's new 30-day window are no longer kept in bank.feed. Browser recovery copies/backups must not be treated as a transaction archive. If permanent bank history is required later for Kupa + Orders, it should use a dedicated append/merge bank-transactions store instead of growing the main Kupa document without bound.
