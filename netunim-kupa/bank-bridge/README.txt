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
- Hapoalim, Visa Cal, Max and the normal Isracard path use Chrome/Edge already installed on Windows. Puppeteer's own browser download is disabled.
- American Express uses a separate locally installed Camoufox browser because the issuer currently rejects the ordinary automated Chromium fingerprint before the fixed-password API login can start. Camoufox files stay under %LOCALAPPDATA%\NetunimKupaBankBridge\camoufox.
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
The bridge pins israeli-bank-scrapers 6.9.0 for Hapoalim/Cal/Max and the normal Isracard path. The Isracard-family WAF path pins camoufox-js 0.12.0 with playwright-core 1.60.0; Bridge v18 also pins fingerprint-generator 2.1.86 because that package chooses the generated browser fingerprint used by Camoufox. The matching Camoufox browser is downloaded into the stable local cache during installation. Bank/card websites can change without notice; a changed issuer protocol still requires a reviewed connector update rather than blind retries.

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


Credit-card sync (Bridge v18)
-----------------------------
Bridge v18 keeps the encrypted multi-profile credit-card connections introduced in v12 for Visa Cal, Max, Isracard and American Express. Profiles are stored only in %LOCALAPPDATA%\NetunimKupaBankBridge\credit-card-profiles.dpapi using Windows DPAPI CurrentUser encryption. The HTTP status API exposes profile IDs/labels/provider/default classification only; credentials are never returned to the browser.

Supported credentials follow israeli-bank-scrapers 6.9.0: Visa Cal and Max use username/password; Isracard and American Express use id/card6Digits/password. Multiple profiles for the same provider are supported only for different login identities. The same Visa Cal/Max username or the same Isracard/Amex ID cannot be stored twice for the same provider, because one issuer login already returns all cards visible to that identity. Profiles for different identities are scraped sequentially to avoid cookie/session collisions.

A full credit refresh requests 130 historical days and up to 12 future months with combineInstallments=false and without raw transaction payloads. The 130-day lookback guarantees enough source data for the current month plus three complete prior calendar months. Bridge v32 keeps fast refresh intentionally narrow (current billing month + next billing month) while preserving older/future Last Known Good month slices from the last full refresh. The main manual Refresh action uses full mode (130 historical days + 12 future months), and the once-per-day automatic refresh can be configured as either fast or full. The bridge returns a normalized safe subset: card/account number, optional issuer balance/balance date, optional credit limit/available credit, billing/installment dates, optional purchase/transaction date, amounts, description, installments and status. No login secrets or raw HTML are returned. Pending issuer rows remain visible for review but are intentionally excluded from the Kupa cash-flow forecast until the issuer posts them with a trustworthy billing date.

Bridge v18 preserves Visa Cal's issuer credit limit and MAX's credit limit. israeli-bank-scrapers 6.9.0 defines MAX balance as -(CreditLimit - OpenToBuy), so only for MAX the bridge derives exact availableCredit as cardFrame + balance. Visa Cal balance is the next debit rather than total limit use, so the bridge deliberately does not apply that formula. The current Isracard/Amex normalized adapters expose neither value. Missing numeric values remain null rather than being coerced to zero.

The web app stores these normalized results in state.creditSync. Credit feed v3 has one calculation model: included issuer cards are always the primary source, and any newly-created state.credits row is an additive manual adjustment only. On the one-time v2 -> v3 migration, pre-existing manual credit rows are removed so old hand-entered schedules cannot double-count the newly synchronized issuer feed. New manual additions created after the migration remain persistent and additive.

Bridge v12 — issuer/card selection

American Express is a separate CompanyTypes.amex scraper in israeli-bank-scrapers 6.9.0, with its own American Express base URL/company code. It shares the Isracard-family fixed-password credential shape (id + six card digits + password) but must not be sent through CompanyTypes.isracard.

An issuer login can legitimately return many current/old/household cards. Kupa therefore separates discovery from inclusion. Existing v1 cards migrate as included so an upgrade cannot silently alter totals; cards first discovered under credit feed v2 are excluded until the user explicitly opts them in. Business/home classification and display name remain per-card and per-profile.

The Isracard/Amex scraper does not click the visible SMS/password UI. It loads the login page, then calls ValidateIdData and performLogonI inside the page with the fixed-password credentials. Therefore an interactive browser remaining visually on the SMS login screen is not itself a failure signal. The Bridge result/error is authoritative.

Bridge v14 — reset, duplicate prevention, presentation controls and safe diagnostics

The /credit/reset endpoint deletes only the local encrypted credit profile vault and credit-sync metadata; it does not touch Hapoalim credentials. The Kupa UI pairs this with clearing state.creditSync through the normal save path, so a full reset also removes synchronized card/profile/mapping data from the Kupa document/cloud. The app remains in synchronized-primary mode; any post-migration manual additions are a separate additive layer and are not deleted by a credit-sync reset.

Deleting one credit profile through /credit/profiles remains intentionally local-only for multi-computer use. A previously synchronized cloud profile can therefore still appear as “configure on this computer” after local deletion; use the explicit full reset when the goal is to start from zero everywhere.

Scraper error strings are not trusted as safe diagnostics. Isracard/Amex HTML returned where the fixed-password JSON service was expected is classified as CREDIT_LOGIN_HTML_RESPONSE, and generic raw scraper messages are no longer persisted. Bridge v14 additionally identifies the ValidateIdData stage so an Amex HTML response is reported accurately as a pre-password issuer/WAF response instead of being mislabeled as bad credentials. This prevents request payload details embedded by the upstream scraper from leaking into the Kupa/cloud error feed.

Per-card mapping now has three independent presentation/calculation dimensions: included/excluded, visible/hidden, and business/home. Hidden is presentation-only: an included hidden card stays in totals but its card identity and detailed issuer rows are omitted from live/detail views. Owner and business/home filters are composable across forecasts, issuer summaries, and the unified payment-detail table.

Bridge v15 — American Express WAF/browser-engine fix
----------------------------------------------------
The v14 diagnostic proved that the failing American Express session received HTML at ValidateIdData, before performLogonI/password validation. The upstream Isracard/Amex connector performs those login steps as in-page JSON requests, so repeatedly waiting on or typing into the visible login form cannot repair that failure class.

Bridge v15 keeps the issuer protocol (American Express base URL/company code 77, ValidateIdData, performLogonI, DashboardMonth and CardsTransactionsList) but changes the browser engine for American Express to Camoufox, a hardened Firefox build with generated browser fingerprints. This is deliberately isolated to American Express: Cal/Max/Hapoalim retain their existing paths, while Isracard tries its existing Chrome/Edge path first and falls back to Camoufox only after a canonical HTML/WAF failure. Invalid credentials never cause a second browser-engine login attempt.

The installer pins the Camoufox JS/runtime versions, downloads its browser to %LOCALAPPDATA%\NetunimKupaBankBridge\camoufox, launches it in the staged --doctor check, and only then replaces the active Bridge. A download/launch failure therefore leaves the previously installed Bridge untouched. The first v15 installation can take longer because this browser binary is downloaded once.

Camoufox responses are normalized into the same safe credit error taxonomy already used by Kupa (CREDIT_AUTOMATION_BLOCKED, CREDIT_LOGIN_HTML_RESPONSE and CREDIT_DATA_HTML_RESPONSE). Raw issuer HTML and credential-bearing request bodies are never persisted or returned to Kupa. The Amex numeric/string response quirks are also normalized explicitly, and installment month shifts clamp to the destination month end instead of overflowing dates such as January 31 into March.

Bridge v17 — qualified Camoufox fingerprints before credentials
--------------------------------------------------------------
The v17 Amex failure class is earlier than ValidateIdData: the anonymous GET of /personalarea/Login itself can be rejected before any ID, card digits or password are sent. Bridge v17 therefore qualifies the browser session before login instead of retrying credentials. Camoufox's generated Windows/Firefox fingerprint is sanitized and checked for internally consistent OS, CPU, screen/window hierarchy and non-software GPU signals. Only a fingerprint that passes those checks is allowed to open the issuer login page.

A 403 on that anonymous login-page request discards the browser without sending credentials and selects a fresh qualified fingerprint, with a hard limit of three anonymous sessions. This is not a general retry loop: once the login page is accepted, credentials are sent exactly once through the existing ValidateIdData/performLogonI protocol. HTTP 429 is now a separate CREDIT_PROVIDER_RATE_LIMITED condition and is never treated as a fingerprint failure or retried, avoiding extra load when the issuer is genuinely rate-limiting the connection.

The critical fingerprint-generator runtime is pinned to 2.1.86 alongside camoufox-js 0.12.0 and playwright-core 1.60.0 so reinstalling the same Bridge does not silently select a newer fingerprint generator. The staged Camoufox doctor now exercises the same qualified fingerprint creation path used by Amex before the active Bridge is replaced.

Bridge v16 — authoritative bank balance and credit lifecycle
-----------------------------------------------------------
Kupa no longer converts check workflow changes into synthetic bank movements. The Hapoalim/manual snapshot is the sole bank balance source. Legacy check event metadata is retained only so existing deployed Supabase RPCs and old documents remain readable; it is excluded from Kupa and Orders calculations.

Credit detail no longer splits active and completed series into separate tables. The UI uses one month selector that shows the current/nearest charge month by default, keeps three prior calendar months available as history, and exposes every future billing month that is actually present in the normalized issuer feed. Missing future installments are never synthesized. Orders now evaluates the same state.creditSync rows as Kupa when calculating the read-only Kupa net balance.



Bridge v18 — Camoufox owns fingerprint generation

Bridge v17's installer could fail before Camoufox launched because the local fingerprint pre-filter treated BrowserForge's zero innerWidth/innerHeight values as invalid. Those zeroes are collection sentinels for unavailable window measurements, not proof of an impossible browser, and Camoufox's own mapper intentionally skips zero-valued fields. Rejecting them caused every generated sample on affected datasets to be discarded during --doctor.

Bridge v18 removes that duplicate local fingerprint sanitizer/validator. It uses Camoufox's supported os='windows' and screen constraints and lets Camoufox generate/map the BrowserForge fingerprint internally. The security boundary remains stronger and simpler: before any ID, card digits or password are sent, the Bridge opens the issuer login page anonymously; an HTTP 403 discards that entire browser session and launches a fresh Camoufox-generated session, while HTTP 429 is not retried. The installer doctor now checks that the real Camoufox browser/runtime can launch, instead of rejecting valid BrowserForge sentinel data.

The installer also no longer prints the misleading Chrome/Edge-only advice for a Camoufox doctor failure; the exact diagnostic printed immediately above is authoritative and the previously installed Bridge remains untouched on any doctor failure.


Bridge v28 — Credit Connector contract v2 (supersedes older credit retry behavior)
-----------------------------------------------------------------------------------
Bridge v28 separates Visa Cal, MAX, Isracard and American Express behind explicit provider adapters. Visa Cal uses one login/session and independent card+month reads. Coverage from the 130-day history through next month is required Core coverage; later issuer-supplied months through +12 are forecast enrichment. A failed forecast month does not discard another month/card, while an incomplete Core refresh does not advance the shared successful-sync timestamp.

Kupa/Orders credit feed v4 stores and merges Last Known Good data per profile/card/month. The UI distinguishes fresh, stale and missing coverage. It never creates an installment or future month that the issuer did not return. Existing v1-v3 feeds remain readable and the original v2-to-v3 manual-row cleanup is not repeated during the v4 upgrade.

Camoufox now uses one local persistent identity per provider + login identity under %LOCALAPPDATA%\NetunimKupaBankBridge\credit-identities. Both its persistent browser context and generated config/seeds are reused. The staged installer doctor launches the real pinned Camoufox 0.12.0 runtime twice and fails installation if observable identity fields change. A LoginPage 403 gets exactly one anonymous attempt and then a 24-hour per-profile automatic circuit breaker; there is no fingerprint rotation. HTTP 429 preserves Retry-After and otherwise uses a conservative 24-hour fallback.

Sanitized credit diagnostics are kept locally as bounded rotating JSONL and exposed only through the authenticated loopback summary endpoint. Credentials, cookies, authorization tokens, login bodies and raw issuer HTML are excluded. The installer retains the previous runtime in app-rollback and installs %LOCALAPPDATA%\NetunimKupaBankBridge\rollback_bank_bridge.bat. Web clients prefer /v2/credit/* and use the v27 route only after an explicit 404, so an emergency runtime rollback remains usable without deleting profiles or shared snapshots.

The detailed implementation, rollout, rollback and live-verification boundaries are documented in CREDIT_CONNECTOR_V2_REPORT.md at the repository root.


Bridge v20 — unified monthly credit detail and purchase dates
-----------------------------------------------------------
The credit detail screen is now driven by actual normalized charge rows instead of collapsing each purchase series to only its next payment. One month selector combines current/future obligations and recent completed history; each month button shows the filtered monthly total and opens the rows billed in that month. The default is the nearest known charge month, while the three preceding calendar months remain available in the same frame.

The scrape lookback is 130 days so the UI can reliably cover three complete preceding calendar months even near the end of a long month. Future scraping remains up to 12 months with combineInstallments=false; the UI displays only installments/months the issuer actually supplied and does not extrapolate absent installments.

Bridge v20 also carries an optional transactionDate separately from the installment/billing date. The Isracard-family Camoufox adapter preserves fullPurchaseDate exactly in transactionDate while retaining the existing shifted installment date and fullPaymentDate billing date. For normalized issuer rows that do not supply the new field, the web feed derives the series-origin date from the existing normalized purchase date plus installment number so older/native data stays readable without pretending an unavailable raw field was supplied.

Bridge v21 — compact bank sync status
------------------------------------
The bank status endpoint now exposes lastErrorAt for the last failed bank refresh. The Kupa bank toolbar uses this timestamp only for the compact collapsed status (failed + time); the full bank error text remains inside the expanded synchronization panel.

Bridge v24 — Amex anonymous Login 403 / request-interception fix
---------------------------------------------------------------
The PWA/browser that hosts Kupa does not choose the browser engine used for issuer scraping. Kupa calls the loopback Bank Bridge on 127.0.0.1; the Bridge launches Camoufox as its own local process for American Express. Chrome Local Network Access permission is therefore required only so the installed PWA can reach the Bridge, not so Chrome can open the American Express site.

The remaining Amex failure was isolated to the anonymous GET of /personalarea/Login returning HTTP 403 before ValidateIdData and before credentials were sent. The Camoufox adapter was installing Playwright page.route('**/*') interception on every request only to abort detector-dom.min.js. Current Camoufox/Firefox diagnostics show that routed Firefox requests can differ on the wire from normal Firefox (cache-control headers and header ordering), and strict WAFs can reject the document request before page JavaScript executes. This exactly matches the Bridge's LoginPage/403 failure boundary.

Bridge v24 removes request interception entirely from the Isracard-family Camoufox adapter. The login/data protocol does not require interception, so no substitute blocker or header rewrite is added. Anonymous Login qualification, bounded 403 session rotation, 429 handling, safe diagnostics, and the rule that credentials are sent only after an accepted Login document remain unchanged. The web app now requires Bridge v24 so a stale local Bridge cannot silently keep the old interception behavior after deployment.

Bridge v29 — Cal Frames contract, component severity and hard cooldown semantics

Bridge v29 keeps Credit Connector contract v2 and the v28 monthly Last Known Good storage. It does not require a Supabase migration and does not replace existing business data. Visa Cal Frames now follows the exact optional FramesResponse contract embedded in israeli-bank-scrapers 6.9.0: result, bankIssuedCards, calIssuedCards and cardLevelFrames may be absent. Missing frame data is a component warning, not a transaction schema failure. A sole issuer group may provide its account-level next debit/date and frame limit when no card-level frame matches; no amount, limit or available credit is synthesized.

Core Transactions, Forecast Transactions, Pending and Frames have explicit component/severity metadata. Only Core Transactions advance the successful profile clock. Frames/Pending failures and forecast gaps are warnings; a previous frame or pending result is retained as Last Known Good and marked stale where applicable. Kupa and Orders display successful Core with component warnings as "הושלם עם אזהרות".

The rotating local diagnostics now store a response-shape fingerprint plus key names, result type and presence/type/count metadata for the two Cal frame groups and cardLevelFrames. Values, cardUniqueId, amounts, authorization, cookies, raw JSON and raw HTML are not stored. Both apps expose "העתק אבחון טכני בטוח", which copies only events returned by the authenticated loopback diagnostics endpoint.

403 and 429 cooldowns are hard not-before gates for automatic, manual and ordinary interactive diagnostic refreshes. A deferred check sends no issuer request, does not update attemptedAt, retains the original failure timestamp and reports attemptedCount=0. No force-bypass action is connected to the normal diagnostic button. The installer doctor proves only local Camoufox runtime and persistent identity continuity; it does not prove issuer WAF acceptance. WAF acceptance requires an authorized live canary, and two successful live launches are required before trusted-device/session continuity can be marked verified.



Bridge v25 — Hapoalim navigation-race recovery and cloud lease resilience
-----------------------------------------------------------------------
Hapoalim login can complete while its SPA is replacing the active document. israeli-bank-scrapers 6.9.0 performs a client-side URL read with page.evaluate after postAction; if that read lands on the document swap, Puppeteer reports "Execution context was destroyed, most likely because of a navigation" even though the submitted login may already have reached a terminal success/failure state. Bridge v25 does not resubmit credentials. It catches only this classified transient navigation race and resolves the result from the same login attempt using the already-established terminal URL/authenticated accounts API signal, then proceeds through the existing stable-session gate. Real credential/authentication failures keep their existing error classification.

The two web apps also treat transient Supabase transport loss separately from bank login. Safe GET requests are retried with bounded timeouts. The distributed bank/credit lease claim and release RPCs are retried only with the same lease token; the SQL contract already makes same-token claim renewal idempotent, so a lost HTTP response cannot create a second owner or a second bank session. Mutating finance/document save RPCs are not automatically retried. If Supabase remains unreachable, synchronization still fails closed before the local Bridge is opened, preserving the cross-computer single-session guarantee.

Bridge v31 — Cal Frames semantics and manual full refresh
---------------------------------------------------------
Bridge v31 keeps Credit Connector contract v2 and the mode-aware POST /v2/credit/sync protocol. syncMode=daily reads only the current month plus the next month (along with provider-specific pending/frame data); syncMode=full keeps the 130-day history and +12-month issuer horizon. Kupa and Orders now use full mode for the main manual Refresh button, while the once-per-day automatic refresh remains daily. The advanced panel exposes an explicit fast daily refresh.

Visa Cal Frames statusCode 87 ("לא נמצאו כרטיסים רלוונטיים להצגה") is a non-applicable Frames response, not a failed card synchronization. The same card can still return successful monthly Transactions, so v31 records the frame as unavailable without creating a provider-error row and continues preserving/refreshing transaction months. Hidden remains presentation-only: an included hidden card can still carry valid historical or future installments. By contrast, a card that is already known in the shared feed and marked not included is sent to the local Bridge as excluded; Visa Cal still discovers the issuer card list after login but sends no Frames, Pending or monthly transaction requests for that excluded suffix. Newly discovered cards are not pre-skipped, so discovery remains reliable and changing a card back to included makes it eligible on the next refresh.

This remains a workload policy, not a retry workaround. Visa Cal still uses one login and sequential per-card Frames, Pending and monthly reads; MAX/Isracard and the Camoufox Isracard-family path receive the same daily/full date scope. No extra retry is added for 403/429. Existing month slices that are outside a daily result remain in the credit feed as Last Known Good because the web merge updates month keys individually rather than replacing the whole account history.

Safe response diagnostics now retain the issuer's numeric statusCode (when present) in addition to structural shape metadata, while the structural fingerprint deliberately ignores that numeric value. The authenticated loopback diagnostics summary returns up to 500 sanitized events. Raw response bodies, credentials, cookies, authorization values, full card identifiers and transaction amounts remain excluded.



Bridge v32 — billing-cycle boundaries and selectable automatic horizon
---------------------------------------------------------------------
Bridge v32 fixes the fast-refresh month boundary at the source. An issuer transaction belongs to a synchronized month by its billing/debit date (processedDate), never by its purchase date. A purchase made in August and billed in September must therefore remain in the September slice even when daily mode starts on September 1. Visa Cal applies its cutoff to processedDate. For native MAX/Isracard, Netunim disables israeli-bank-scrapers' purchase-date output filter while keeping the same narrow current+next month request horizon, then applies the authoritative post-normalization cutoff and month grouping by processedDate. The Camoufox Isracard/American Express path uses the same billing-date rule. Purchase/transactionDate remains preserved separately for detail ordering and audit display.

This correction also restores the existing checking-account cash-flow calculation without adding a second credit formula. Kupa and Orders already subtract included business credit rows using processedDate alongside fixed expenses; fast refresh had been removing some current-cycle rows before they reached those consumers. With the source boundary corrected, the same synchronized row feeds the credit forecast, next-cycle commitments, projected checking balance and minimum/negative-balance alert.

Automatic credit refresh remains once per day, but each browser can now choose its horizon explicitly: fast reads the current and next billing month; full reads the 130-day history and twelve future months. The main manual Refresh remains full, and the advanced explicit fast refresh remains available. The selected automatic horizon is a local browser preference and does not change cloud finance data or issuer credentials.

Normalized transaction IDs are now idempotent across adapter normalization (id or identifier is preserved). This prevents a transaction that was already normalized once from losing its stable issuer identifier when it is wrapped into monthly coverage.

Bridge v33 — controlled recovery for a rejected Camoufox identity
-----------------------------------------------------------------
The Amex failure addressed by v33 is the anonymous LoginPage HTTP 403 that occurs before ValidateIdData and before any ID, card suffix or password is sent. Bridge v28/v29 correctly introduced a hard 24-hour per-profile cooldown and stopped immediate fingerprint rotation, but after that cooldown expired the next run reused the exact same persistent Camoufox profile and generated config. A browser identity that had become persistently unacceptable to the issuer could therefore enter a deterministic 403 -> 24-hour wait -> same identity -> 403 loop with no recovery path.

Bridge v33 keeps the hard cooldown unchanged and still permits exactly one anonymous LoginPage qualification per run. It does not add an immediate retry, a force bypass, credential resubmission, or a fingerprint loop. Only when the latest failure for an Amex/Isracard Camoufox profile is the same LoginPage HTTP 403 and its stored retryAfterAt has actually expired, the Bridge retires that one rejected local browser identity before the next eligible attempt. The Camoufox generated config and its persistent browser profile are removed together, so cookies/storage are never carried into a different generated device identity. A safe IdentityRecovery diagnostic is recorded without credentials, cookies or issuer HTML.

If the replacement identity is also rejected (for example because the issuer is blocking something broader than that local browser identity), the new 403 enters the same 24-hour circuit breaker and no further identity is generated in that run. Blocks after credentials have begun (for example ValidateIdData) never trigger identity retirement. Financial data, cloud state and encrypted credit-card credentials are not touched by this recovery; only the local Camoufox identity directory for that provider/login identity is replaced. Kupa and Orders now require Credit Bridge v33 so an older v32 runtime cannot silently keep the no-recovery behavior.
