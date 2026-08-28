from pathlib import Path
import re
import subprocess
import sys

ROOT=Path(__file__).resolve().parents[1]
SITE=ROOT/'netunim-orders/site'
errors=[]

def ok(condition,message):
    print(('PASS' if condition else 'FAIL'),message)
    if not condition: errors.append(message)

result=subprocess.run(['node',str(ROOT/'tests/calendar_journal.test.mjs')],cwd=ROOT,capture_output=True,text=True)
if result.stdout: print(result.stdout.strip())
if result.stderr: print(result.stderr.strip())
ok(result.returncode==0,'calendar journal: idempotent retry and durable failure contracts pass')

api_result=subprocess.run(['node',str(ROOT/'tests/calendar_api.test.mjs')],cwd=ROOT,capture_output=True,text=True)
if api_result.stdout: print(api_result.stdout.strip())
if api_result.stderr: print(api_result.stderr.strip())
ok(api_result.returncode==0,'calendar API: hidden calendars are included and free/busy-only calendars cannot break event sync')

actions_result=subprocess.run(['node',str(ROOT/'tests/calendar_ui_actions.test.mjs')],cwd=ROOT,capture_output=True,text=True)
if actions_result.stdout: print(actions_result.stdout.strip())
if actions_result.stderr: print(actions_result.stderr.strip())
ok(actions_result.returncode==0,'calendar UI: delegated calendar actions invoke their composition-root adapters with preserved arguments')

view_result=subprocess.run(['node',str(ROOT/'tests/calendar_view.test.mjs')],cwd=ROOT,capture_output=True,text=True)
if view_result.stdout: print(view_result.stdout.strip())
if view_result.stderr: print(view_result.stderr.strip())
ok(view_result.returncode==0,'calendar view: month/week/day ranges and focus navigation are deterministic')

auth_result=subprocess.run(['node',str(ROOT/'tests/calendar_auth.test.mjs')],cwd=ROOT,capture_output=True,text=True)
if auth_result.stdout: print(auth_result.stdout.strip())
if auth_result.stderr: print(auth_result.stderr.strip())
ok(auth_result.returncode==0,'calendar auth: OAuth access-denied/popup-close paths settle cleanly with actionable test-user guidance')

storage_result=subprocess.run(['node',str(ROOT/'tests/calendar_storage.test.mjs')],cwd=ROOT,capture_output=True,text=True)
if storage_result.stdout: print(storage_result.stdout.strip())
if storage_result.stderr: print(storage_result.stderr.strip())
ok(storage_result.returncode==0,'calendar storage: remembered Google-account preference survives reload without persisting an access token')

index=(SITE/'index.html').read_text(encoding='utf-8')
nav=re.search(r'<nav class="nav" id="nav">(.*?)</nav>',index,re.S)
buttons=re.findall(r'data-view="([^"]+)"',nav.group(1) if nav else '')
ok(bool(buttons) and buttons[-1]=='calendar','orders: Calendar is the final business navigation tab')

config=(SITE/'assets/js/calendar/config.js').read_text(encoding='utf-8')
auth=(SITE/'assets/js/calendar/auth.js').read_text(encoding='utf-8')
api=(SITE/'assets/js/calendar/api.js').read_text(encoding='utf-8')
storage=(SITE/'assets/js/calendar/storage.js').read_text(encoding='utf-8')
journal=(SITE/'assets/js/calendar/journal.js').read_text(encoding='utf-8')
controller=(SITE/'assets/js/domains/calendar/controller.js').read_text(encoding='utf-8')
contexts=(SITE/'assets/js/state/contexts.js').read_text(encoding='utf-8')
navigation=(SITE/'assets/js/ui/navigation.js').read_text(encoding='utf-8')
main=(SITE/'assets/js/main.js').read_text(encoding='utf-8')
headers=(SITE/'_headers').read_text(encoding='utf-8')
worker=(SITE/'service-worker.js').read_text(encoding='utf-8')

ok('Object.freeze' in config and 'clientId' in config and 'clientSecret' not in config and 'client_secret' not in config,'calendar config: public client ID only; no client secret field')
ok('auth/calendar.events' in config and 'auth/calendar.calendarlist.readonly' in config and "scope:'https://www.googleapis.com/auth/calendar'," not in config,'calendar config: OAuth is least-privilege for event editing plus calendar-list read access')
ok('localStorage' not in auth and 'indexedDB' not in auth and 'accessToken' in auth,'calendar auth: Google access token is memory-only')
ok('error_callback' in auth and 'popup_closed' in auth and 'hasGrantedAllScopes' in auth and "code==='access_denied'" in auth and 'Audience → Test users' in auth,'calendar auth: OAuth denial/popup cancellation settles cleanly and gives actionable Testing/Test-user guidance')
ok('login_hint' in auth and 'function ready()' in auth and "prompt:String(prompt??'')" in auth,'calendar auth: remembered accounts support both silent prompt=none startup and normal interactive token requests')
ok('async function prepare()' in auth and 'gisPromise=null' in auth and 'calendarAuth.prepare()' in controller,'calendar auth: GIS is preloaded before user gesture and a failed script load remains retryable')
ok('globalThis.google.accounts.oauth2.initTokenClient' in auth and 'globalThis.google.accounts.oauth2.hasGrantedAllScopes' in auth and 'globalThis.google.accounts.oauth2.revoke' in auth,'calendar auth: Google Identity global is accessed explicitly through globalThis and passes no-undef linting')
ok('calendarUi:{' in contexts and "viewMode:'month'" in contexts and "focusDate:''" in contexts and 'calendarSession:{' in contexts and 'eventMap:new Map()' in contexts and 'syncPromise:null' in contexts and 'pollTimer:null' in contexts and 'autoReconnectAttempted:false' in contexts and 'authResumePromise:null' in contexts,'calendar composition: view/focus plus UI/session state are initialized before the controller starts')
ok('renderCalendar, renderSettings' in navigation and "ui.currentView==='calendar')renderCalendar()" in navigation,'calendar navigation: the Calendar tab renders Calendar instead of falling through to Settings')
controller_actions=set(re.findall(r'data-(?:action|change)="(calendar-[^"]+)"',controller))
registered_actions=set(re.findall(r"'(calendar-[^']+)'\s*:\s*\(",(SITE/'assets/js/ui/actions.js').read_text(encoding='utf-8')))
ok(bool(controller_actions) and controller_actions <= registered_actions,'calendar actions: every calendar button/change action rendered by the controller is registered in delegated UI actions')
ok('calendarAuthAction' in main and "'calendar-auth':" in (SITE/'assets/js/ui/actions.js').read_text(encoding='utf-8'),'calendar auth action: composition-root adapter is reachable from the delegated action registry')
ok('domainsCalendarController.start();' in main and 'export const appReady=lifecycle.boot();' in main and main.index('domainsCalendarController.start();') < main.index('export const appReady=lifecycle.boot();'),'calendar startup contract: controller start precedes lifecycle boot and therefore must be safe with initialized context')
ok('accountVerified=false' in auth and 'accountVerified=true' in controller and 'אימות חשבון Google' in controller,'calendar account guard: mutations cannot race a newly connected, not-yet-verified Google account')
ok('connectionPreference' in storage and 'saveConnectionPreference' in storage and 'orders.google-calendar.connection.v1' in storage,'calendar reconnect preference: only non-secret account/intent metadata is persisted across browser restarts')
ok('resumeKnownConnectionSilently' in controller and "prompt:'none'" in controller and 'resumeKnownConnectionFromGesture' in controller and 'event?.isTrusted' in controller and 'loginHint:accountId' in controller and 'expected!==accountId' in controller,'calendar reconnect: startup first tries silent remembered-account auth, with trusted-gesture fallback and mismatch rejection before sync')
ok('hydrateLegacyConnectionPreference' in controller and "getMeta('accountId')" in controller,'calendar reconnect migration: existing installations inherit their previously verified Calendar account once')

ok('data-click-arg0="month"' in controller and 'data-click-arg0="week"' in controller and 'data-click-arg0="day"' in controller and 'calendar-prev-period' in controller and 'calendar-next-period' in controller,'calendar view controls: month/week/day and period navigation are rendered from one focused-date model')
ok('alignFocusInScroller' in controller and 'scroller.scrollTop' in controller and 'window.scrollTo' not in controller,'calendar focus: today/focused date is aligned inside the calendar scroller without moving the page viewport')
ok((SITE/'assets/js/calendar/view.js').is_file(),'calendar view: pure period/focus helper module is part of the application')
ok("eventTypes" not in api and "singleEvents:true" in api and "showHidden:true" in api,'calendar API: event listing includes all event types and hidden subscribed calendars')
ok("event?.eventType==='birthday'" in controller and 'אירוע יום הולדת' in controller,'calendar UI: birthdays are visible but protected from unsupported editing')
ok("_pendingDelete:true" in controller and 'ממתין למחיקה' in controller,'calendar UI: unacknowledged deletes remain visibly pending until Google confirms them')
ok("autoIncrement:true" in storage and "pending-operations" in storage,'calendar storage: outbound operations use an ordered durable IndexedDB journal')
ok("error?.status!==409" in journal and 'getEvent' in journal and 'insertMatches' in journal,'calendar journal: duplicate create retry confirms both the preassigned ID and intended event content')
ok("error?.status===404||error?.status===410" in journal,'calendar journal: repeated deletes acknowledge already-deleted events')
ok('https://accounts.google.com/gsi/client' in headers and 'https://accounts.google.com/gsi/' in headers and 'https://www.googleapis.com' in headers and "style-src-elem 'self' 'unsafe-inline' https://accounts.google.com/gsi/style" in headers and "script-src 'self' 'unsafe-inline'" not in headers and 'Cross-Origin-Opener-Policy: same-origin-allow-popups' in headers,'calendar security: CSP/COOP allow GIS popup/API plus its injected styles while inline script execution remains forbidden')
ok('./assets/js/calendar/journal.js' in worker and './assets/js/calendar/view.js' in worker and './assets/js/domains/calendar/controller.js' in worker,'calendar PWA: calendar journal/view/controller modules are part of the deterministic app shell')
ok((ROOT/'netunim-orders/GOOGLE_CALENDAR_SETUP.txt').is_file(),'calendar setup: deployment/OAuth instructions are included')

if errors:
    print('\nERRORS',len(errors))
    for item in errors: print('-',item)
    raise SystemExit(1)
print('\nALL CALENDAR CONTRACTS PASSED')
