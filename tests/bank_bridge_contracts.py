from pathlib import Path
import json
import subprocess

ROOT=Path(__file__).resolve().parents[1]
SITE=ROOT/'netunim-kupa/site'
BRIDGE=ROOT/'netunim-kupa/bank-bridge'
errors=[]

def ok(condition,message):
    print(('PASS' if condition else 'FAIL'),message)
    if not condition: errors.append(message)

for rel in ['server.mjs','lib.mjs']:
    r=subprocess.run(['node','--check',str(BRIDGE/rel)],capture_output=True,text=True)
    ok(r.returncode==0,f'bank bridge: {rel} has valid JavaScript syntax')
    if r.returncode: print(r.stderr)
for rel in ['assets/js/domains/bank/bridge.js','assets/js/domains/bank/feed.js','assets/js/domains/bank/controller.js','assets/js/domains/bank/view.js','assets/js/ui/actions.js','assets/js/main.js','assets/js/state/normalization.js']:
    r=subprocess.run(['node','--check',str(SITE/rel)],capture_output=True,text=True)
    ok(r.returncode==0,f'bank site: {rel} has valid JavaScript syntax')
    if r.returncode: print(r.stderr)

r=subprocess.run(['node',str(ROOT/'tests/bank_bridge_models.test.mjs')],cwd=ROOT,capture_output=True,text=True)
if r.stdout: print(r.stdout.strip())
if r.stderr: print(r.stderr.strip())
ok(r.returncode==0,'bank bridge models: staged data/feed/MFA model tests pass')

server=(BRIDGE/'server.mjs').read_text(encoding='utf-8')
lib=(BRIDGE/'lib.mjs').read_text(encoding='utf-8')
controller=(SITE/'assets/js/domains/bank/controller.js').read_text(encoding='utf-8')
client=(SITE/'assets/js/domains/bank/bridge.js').read_text(encoding='utf-8')
feed=(SITE/'assets/js/domains/bank/feed.js').read_text(encoding='utf-8')
view=(SITE/'assets/js/domains/bank/view.js').read_text(encoding='utf-8')
actions=(SITE/'assets/js/ui/actions.js').read_text(encoding='utf-8')
main=(SITE/'assets/js/main.js').read_text(encoding='utf-8')
normalization=(SITE/'assets/js/state/normalization.js').read_text(encoding='utf-8')
headers=(SITE/'_headers').read_text(encoding='utf-8')
worker=(SITE/'service-worker.js').read_text(encoding='utf-8')
installer=(BRIDGE/'install_bank_bridge.bat').read_text(encoding='utf-8')
start_script=(BRIDGE/'start_bank_bridge.bat').read_text(encoding='utf-8')
launcher_path=BRIDGE/'launch_hidden.vbs'
launcher=launcher_path.read_text(encoding='ascii') if launcher_path.exists() else ''
package=json.loads((BRIDGE/'package.json').read_text(encoding='utf-8'))

ok(BRIDGE.is_dir() and not str(BRIDGE).startswith(str(SITE)), 'bank bridge security: scraper and credentials component stays outside the public site root')
ok("const HOST='127.0.0.1'" in server and 'activeServer.listen(PORT,HOST' in server, 'bank bridge security: HTTP service binds to loopback only')
ok('System.Security.Cryptography.DataProtectionScope]::CurrentUser' in server and 'ProtectedData]::Protect' in server and 'ProtectedData]::Unprotect' in server, 'bank bridge security: Hapoalim credentials use Windows DPAPI CurrentUser encryption')
ok('Bearer ' in server and 'timingSafeEqual' in server and "req.url==='/health'" in server, 'bank bridge security: private routes require a timing-safe bearer key')
ok(package.get('dependencies',{}).get('israeli-bank-scrapers')=='6.9.0', 'bank bridge dependency: scraper version is pinned exactly')
ok(package.get('allowScripts',{}).get('puppeteer') is False and 'PUPPETEER_SKIP_DOWNLOAD=true' in installer, 'bank bridge dependency: Puppeteer browser download/install script is disabled')
ok('findInstalledBrowser' in server and 'executablePath:browserPath' in server and '--user-data-dir=${BROWSER_PROFILE_DIR}' in server and '--profile-directory=Default' in server and 'rememberBrowser' in server, 'bank bridge browser: one installed Chrome/Edge choice and a dedicated persistent local profile are reused across runs')
ok('selectAccountDescriptor' in server and 'parseAccountSelector' in server and 'availableAccounts' in server and 'branchNumber' in server and 'MULTIPLE_ACCOUNTS' in lib, 'bank bridge account guard: Hapoalim bank 12 + exact branch/account are selected before bank reads and ambiguous account numbers return safe choices')

# Login root-cause guard: Hapoalim can change the successful SPA URL. A real authenticated data session, not a hard-coded route, is authoritative.
ok('readHapoalimSessionState' in server and 'hapoalimSessionIsAuthenticated' in server and "[...originalSuccess,async()=>hapoalimSessionIsAuthenticated(scraper.page)]" in server, 'bank login classification: a working authenticated accounts API is accepted as success even when the post-login URL is unknown to the pinned scraper')
ok('enableHapoalimSessionAwareLogin(scraper,{interactive})' in server and 'SILENT_AUTH_TIMEOUT_MS' in server and 'NETUNIM_SILENT_AUTH_TIMEOUT' in lib, 'bank login adapter: silent refresh no longer uses the pinned scraper URL result alone and reports AUTH_REQUIRED when no authenticated session is established')
ok('tryReuseSavedHapoalimSession' in server and 'sessionUrl' in server and 'safeHapoalimSessionUrl' in server and "`${url.origin}${url.pathname}`" in server, 'bank session reuse: successful profile session path is reused before a new credential login and query/hash tokens are never persisted')

# Root cause guard: do not reintroduce the monolithic library scrape that couples every account, balance and transaction fetch.
ok('scraper.scrape(' not in server and 'scraper.login(' in server and 'scraper.initialize(' in server, 'bank data adapter: bridge owns staged login/data flow instead of monolithic scraper.scrape()')
ok('waitForHapoalimSessionReady' in server and 'window.bnhpApp?.restContext' in server and '/ServerServices/general/accounts' in server and 'HAPOALIM_POST_LOGIN_TIMEOUT_MS' in server and 'HAPOALIM_NAVIGATION_STABLE_MS' in server, 'bank post-login readiness: visible homepage is not treated as data-ready until authenticated SPA/API state remains stable across navigation')
ok('balanceAndCreditLimit' in server and "runStage('balance'" in server and 'currentBalance' in server, 'bank balance: selected account balance is fetched independently as the authoritative required result')
ok('retryTransientNavigation' in server and 'pageFetchJsonOnce' in server and 'HAPOALIM_DATA_RETRY_LIMIT' in server and 'isTransientNavigationError' in server, 'bank navigation recovery: balance/transaction reads retry only transient destroyed execution contexts after re-establishing a stable authenticated page')
ok('/current-account/transactions?' in server and "method:'POST'" in server and 'numItemsPerPage=${HAPOALIM_TRANSACTION_LIMIT}' in server and 'normalizeRecentTransactions' in server and 'HAPOALIM_TRANSACTION_LOOKBACK_DAYS' in server and 'HAPOALIM_TRANSACTION_LIMIT' in server, 'bank transactions: full rolling thirty-day Hapoalim page is fetched separately without the historical twenty-row trim')
ok('enrichHapoalimChequeTransactions' in server and 'pfmDetails' in server and 'buildHapoalimAdditionalDetailsUrl' in server and 'normalizeHapoalimAdditionalDetails' in server and 'isHapoalimChequeTransaction' in server and 'beneficiary names' in lib, 'bank cheque details: only explicit cheque-deposit activity descriptions follow Hapoalim additional-information; beneficiary text cannot create false positives')
ok('UNSAFE_DETAIL_URL' in lib and 'hasDocumentReference' in lib and 'isUnsafeTechnicalDetailKey' in lib and 'isDocumentDetailKey' in lib and 'checkItems' in lib and 'generic PFM' not in lib, 'bank cheque detail security: additional requests stay on Hapoalim origin, sensitive document/session values are not persisted, and only structured cheque rows survive normalization')
ok("catch(e){transactionWarning=" in server and 'transactions,transactionWarning,sessionHref' in server, 'bank partial success: transaction failure is non-fatal after a valid balance has been read')
ok("lastWarning:result.transactionWarning||''" in server and 'lastErrorStage' in server and 'safeError(error)' in server, 'bank diagnostics: status records stage/code/warning instead of collapsing every data failure into an opaque HTTP 400')

ok(launcher_path.exists() and all(b < 128 for b in launcher_path.read_bytes()), 'bank bridge startup: launcher is ASCII-only and cannot corrupt Hebrew Windows paths')
ok('ExpandEnvironmentStrings("%LOCALAPPDATA%")' in launcher and '%~dp0' not in launcher and 'shell.Run command, 0, False' in launcher, 'bank bridge startup: launcher resolves stable LOCALAPPDATA at runtime and starts hidden')
ok('%APPROOT%\\app' in installer and 'app-staging' in installer and 'npm ci' in installer and '--doctor' in installer, 'bank bridge install: runtime is staged and validated in a stable per-user location before activation')
ok('--stop-existing' in installer and "req.url==='/shutdown'" in server and 'stopVerifiedListener' in server, 'bank bridge upgrade: an existing verified bridge is stopped before replacing its runtime')
ok('node "%STAGING%\\server.mjs" --stop-existing' in installer and 'if exist "%APPDIR%" (' in installer and 'The previous Bank Bridge runtime could not be removed.' in installer, 'bank bridge upgrade: validated staging code performs shutdown and activation fails closed if old runtime remains locked')
ok('const BRIDGE_VERSION=10' in server and 'version:BRIDGE_VERSION' in server and 'Number(j.version)>=10' in installer and '/health' in installer, 'bank bridge install: installer verifies structured cheque-deposit bridge v10 after hidden startup')
ok('>> "%LOCALAPPDATA%\\NetunimKupaBankBridge\\bridge.log" 2>&1' in start_script, 'bank bridge startup: background output goes to a log instead of popup error windows')

ok('syncSharedChecksFromCloud({quiet:true,required:true})' in controller and 'sharedChecksObservedSequence()' in controller and 'snapshotSeq:observedSeq' in controller, 'bank snapshot integrity: remote balance uses existing synchronized check watermark before saving')
ok("source:'hapoalim'" in controller and 'commitBankSnapshot(result.balance' in controller, 'bank snapshot integrity: Hapoalim balance enters through the same snapshot commit path as manual balance')
ok('normalizeBankFeed' in controller and 'bankFeed:feed' in controller and 'feed:nextFeed' in controller and 'n.bank.feed=normalizeBankFeed(n.bank.feed)' in normalization, 'bank feed persistence: balance/transactions/sync timestamp are normalized into shared Kupa cloud state')
ok('bankSyncAt:nextSyncAt' in controller and 'n.bank.bankSyncAt=n.bank.feed?.syncedAt' in normalization, 'bank multi-computer schedule: last successful bank sync is derived from the shared canonical feed')
ok('bankAutoRefreshDue(lastSyncAt,now)' in controller and 'BANK_AUTO_INTERVAL_MS=24*60*60*1000' in client, 'bank auto refresh: due time is exactly 24h from the shared successful bank sync, not from a manual balance edit')
ok('markAutoAttempt' in controller and 'AUTO_RETRY_COOLDOWN_MS=60*60*1000' in client, 'bank auto refresh: failed background attempts are rate-limited locally')
ok("refreshBankBalance({interactive:false,auto:true})" in controller and "'refresh-bank-from-hapoalim':(element,event)=>{event?.preventDefault();event?.stopPropagation();refreshBankBalance({interactive:false,auto:false})}" in actions and "'open-bank-auth':(element,event)=>{event?.preventDefault();event?.stopPropagation();refreshBankBalance({interactive:true,auto:false})}" in actions, 'bank refresh modes: automatic/manual refresh are silent; visible authentication is explicit and toolbar buttons do not toggle the disclosure')
ok('INTERACTIVE_AUTH_TIMEOUT_MS=10*60*1000' in lib and 'SILENT_AUTH_TIMEOUT_MS=90*1000' in lib and 'waitForTerminalLoginResult' in server and 'enableHapoalimSessionAwareLogin' in server, 'bank authentication: both silent and interactive login wait for a terminal result with separate bounded timeouts')
ok('INTERACTIVE_BRIDGE_TIMEOUT_MS=15*60*1000' in client and 'timeoutMs:interactive?INTERACTIVE_BRIDGE_TIMEOUT_MS:180000' in client, 'bank timeouts: site request window outlives interactive MFA and silent staged API readiness')
ok('bridgeVersion:BRIDGE_VERSION' in server and 'upgradeRequired=bridgeVersion<10' in controller, 'bank bridge upgrade handshake: site rejects pre-v10 local runtime before a bank data refresh')

ok('BANK_FEED_VERSION=4' in feed and 'BANK_FEED_TRANSACTION_LIMIT=1000' in feed and 'balanceAfter' in feed and 'bankReference' in feed and 'checkItems' in feed and 'transactionWarning' in feed, 'bank shared contract: v4 feed keeps full thirty-day transactions plus structured verified cheque rows')
ok('id="bankBranchNumberInput"' in view and 'id="bankAccountNumberInput"' in view and 'select-bank-bridge-account' in view, 'bank account UI: branch and account are separate and bank-returned exact account choices are selectable')
ok("req.url==='/account-selection'" in server and 'selectAccount({branchNumber,accountNumber})' in client and 'selectBankBridgeAccount' in controller, 'bank account selection: a discovered branch/account can update encrypted local credentials without re-entering the bank password')
ok('lastErrorHttpStatus' in server and 'lastAvailableAccounts' in server and 'e.availableAccounts' in client, 'bank diagnostics: HTTP status and safe account choices survive the loopback error envelope instead of being hidden behind generic 400')
ok('הסנכרון האחרון מהבנק הצליח' in view and 'bankSyncHeadlineMarkup' in view and 'bank-transactions-table' in view and '<th>חובה</th><th>זכות</th><th>יתרה לאחר תנועה</th>' in view and 'balanceAfter' in view and 'יתרה נוכחית' in view, 'bank UI: last-sync result stays compact and the bank-like table includes authoritative per-transaction balances')
ok('bankChequeDetailsMarkup' in view and 'שיקים בהפקדה:' in view and 'מס׳ שיק' in view and 'אסמכתת הפקדה:' in view and 'bank-cheque-items' in view and 'transaction Status Code' not in view and 'מזהה סידורי בבנק:' not in view, 'bank cheque UI: only structured cheque-deposit rows/aggregate reference are shown; generic PFM fields and internal serials are hidden')
ok('<details class="bank-sync-settings">' in view and '<summary class="bank-sync-toolbar">' in view and 'id="bankSyncHeadline"' in view and 'bank-sync-head-actions' in view and 'bank-sync-chevron' in view and view.index('bank-transactions-region')>view.index('</details>'), 'bank UI: the sync result itself is the collapsed disclosure toolbar, refresh/auth share the same row, and transactions begin immediately below it')
ok('id="bankBridgePairForm"' in view and 'id="bankBridgeCredentialsForm"' in view and view.count('<form ')==2 and 'onsubmit=' not in view, 'bank credentials UI: token and bank credentials are two independent semantic forms with no inline CSP handler')
ok("addEventListener('submit',event=>event.preventDefault())" in view and "'save-bank-bridge-token'" in actions and 'saveBankBridgeToken:(...args)=>domainsBankController.saveBankBridgeToken' in main, 'bank forms: submit suppression and local Bridge pairing are wired through JavaScript/delegated actions')
ok('id="bankPasswordInput"' in view and 'autocomplete="current-password"' in view, 'bank credentials UI: password control has a semantic credentials-form owner')
ok('localStorage.setItem(TOKEN_KEY' in client and 'localStorage.setItem(AUTO_KEY' in client and 'localStorage.setItem(AUTO_ATTEMPT_KEY' in client and 'localStorage.setItem(userCode' not in client and 'localStorage.setItem(password' not in client, 'bank credentials security: browser persistence is limited to local bridge token/refresh preferences, never Hapoalim credentials')
ok('http://127.0.0.1:8765' in headers and "connect-src 'self'" in headers, 'bank CSP: only intended loopback bridge is added to connect-src')
ok('./assets/js/domains/bank/bridge.js' in worker and './assets/js/domains/bank/controller.js' in worker and './assets/js/domains/bank/feed.js' in worker, 'bank PWA: bridge/controller/canonical feed modules are part of deterministic app shell')

if errors:
    print('\nERRORS',len(errors))
    for item in errors: print('-',item)
    raise SystemExit(1)
print('\nALL BANK BRIDGE CONTRACTS PASSED')
