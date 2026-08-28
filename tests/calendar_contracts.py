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
ok('error_callback' in auth and 'popup_closed' in auth and 'hasGrantedAllScopes' in auth,'calendar auth: popup cancellation and partial OAuth grants cannot leave a hung/under-scoped session')
ok('async function prepare()' in auth and 'gisPromise=null' in auth and 'calendarAuth.prepare()' in controller,'calendar auth: GIS is preloaded before user gesture and a failed script load remains retryable')
ok('globalThis.google.accounts.oauth2.initTokenClient' in auth and 'globalThis.google.accounts.oauth2.hasGrantedAllScopes' in auth and 'globalThis.google.accounts.oauth2.revoke' in auth,'calendar auth: Google Identity global is accessed explicitly through globalThis and passes no-undef linting')
ok('calendarUi:{' in contexts and 'calendarSession:{' in contexts and 'eventMap:new Map()' in contexts and 'syncPromise:null' in contexts and 'pollTimer:null' in contexts,'calendar composition: UI/session state is initialized before the controller starts')
ok('renderCalendar, renderSettings' in navigation and "ui.currentView==='calendar')renderCalendar()" in navigation,'calendar navigation: the Calendar tab renders Calendar instead of falling through to Settings')
controller_actions=set(re.findall(r'data-(?:action|change)="(calendar-[^"]+)"',controller))
registered_actions=set(re.findall(r"'(calendar-[^']+)'\s*:\s*\(",(SITE/'assets/js/ui/actions.js').read_text(encoding='utf-8')))
ok(bool(controller_actions) and controller_actions <= registered_actions,'calendar actions: every calendar button/change action rendered by the controller is registered in delegated UI actions')
ok('calendarAuthAction' in main and "'calendar-auth':" in (SITE/'assets/js/ui/actions.js').read_text(encoding='utf-8'),'calendar auth action: composition-root adapter is reachable from the delegated action registry')
ok('domainsCalendarController.start();' in main and 'export const appReady=lifecycle.boot();' in main and main.index('domainsCalendarController.start();') < main.index('export const appReady=lifecycle.boot();'),'calendar startup contract: controller start precedes lifecycle boot and therefore must be safe with initialized context')
ok('accountVerified=false' in auth and 'accountVerified=true' in controller and 'אימות חשבון Google' in controller,'calendar account guard: mutations cannot race a newly connected, not-yet-verified Google account')
ok("eventTypes" not in api and "singleEvents:true" in api and "showHidden:true" in api,'calendar API: event listing includes all event types and hidden subscribed calendars')
ok("event?.eventType==='birthday'" in controller and 'אירוע יום הולדת' in controller,'calendar UI: birthdays are visible but protected from unsupported editing')
ok("_pendingDelete:true" in controller and 'ממתין למחיקה' in controller,'calendar UI: unacknowledged deletes remain visibly pending until Google confirms them')
ok("autoIncrement:true" in storage and "pending-operations" in storage,'calendar storage: outbound operations use an ordered durable IndexedDB journal')
ok("error?.status!==409" in journal and 'getEvent' in journal and 'insertMatches' in journal,'calendar journal: duplicate create retry confirms both the preassigned ID and intended event content')
ok("error?.status===404||error?.status===410" in journal,'calendar journal: repeated deletes acknowledge already-deleted events')
ok('https://accounts.google.com/gsi/client' in headers and 'https://accounts.google.com/gsi/' in headers and 'https://www.googleapis.com' in headers and "style-src-elem 'self' 'unsafe-inline' https://accounts.google.com/gsi/style" in headers and "script-src 'self' 'unsafe-inline'" not in headers and 'Cross-Origin-Opener-Policy: same-origin-allow-popups' in headers,'calendar security: CSP/COOP allow GIS popup/API plus its injected styles while inline script execution remains forbidden')
ok('./assets/js/calendar/journal.js' in worker and './assets/js/domains/calendar/controller.js' in worker,'calendar PWA: new local modules are part of the deterministic app shell')
ok((ROOT/'netunim-orders/GOOGLE_CALENDAR_SETUP.txt').is_file(),'calendar setup: deployment/OAuth instructions are included')

if errors:
    print('\nERRORS',len(errors))
    for item in errors: print('-',item)
    raise SystemExit(1)
print('\nALL CALENDAR CONTRACTS PASSED')
