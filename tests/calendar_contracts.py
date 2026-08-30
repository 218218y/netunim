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
ok(auth_result.returncode==0,'calendar auth: server token restore, redirect start and disconnect contracts pass')


backend_result=subprocess.run([sys.executable,str(ROOT/'tests/calendar_oauth_backend_contracts.py')],cwd=ROOT,capture_output=True,text=True)
if backend_result.stdout: print(backend_result.stdout.strip())
if backend_result.stderr: print(backend_result.stderr.strip())
ok(backend_result.returncode==0,'calendar auth backend: server-side refresh-token storage and callback security contracts pass')

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
css=(SITE/'assets/app.css').read_text(encoding='utf-8')

ok('Object.freeze' in config and 'backendPath' in config and 'clientSecret' not in config and 'client_secret' not in config,'calendar config: browser points only at the Supabase OAuth backend and contains no client secret')
ok('auth/calendar.events' not in config and 'auth/calendar.calendarlist.readonly' not in config,'calendar config: Google scopes moved out of the public browser OAuth configuration')
ok('localStorage' not in auth and 'indexedDB' not in auth and 'accessToken' in auth and 'refresh_token' not in auth,'calendar auth: browser keeps only the short-lived Google access token in memory')
ok('beginConnect' in auth and 'restore' in auth and "action:'token'" not in auth,'calendar auth: browser uses the server OAuth bridge instead of Google popup APIs')
ok('function ready()' in auth and "backend('token')" in auth and "backend('start'" in auth,'calendar auth: startup refresh and interactive linking are separate server actions')
ok('async function prepare()' in auth and 'calendarAuth.prepare()' in controller and 'accounts.google.com/gsi/client' not in auth,'calendar auth: no Google Identity script or popup preload remains in the browser')
ok('initTokenClient' not in auth and 'requestAccessToken' not in auth and 'beginConnect' in auth,'calendar auth: popup-only Google token model is fully removed')
ok('calendarUi:{' in contexts and "viewMode:'week'" in contexts and "focusDate:''" in contexts and 'calendarSession:{' in contexts and 'eventMap:new Map()' in contexts and 'syncPromise:null' in contexts and 'pollTimer:null' in contexts and 'authResumePromise:null' in contexts,'calendar composition: view/focus plus UI/session state are initialized before the controller starts')
ok('renderCalendar, renderSettings' in navigation and "ui.currentView==='calendar')renderCalendar()" in navigation,'calendar navigation: the Calendar tab renders Calendar instead of falling through to Settings')
controller_actions=set(re.findall(r'data-(?:action|change)="(calendar-[^"]+)"',controller))
registered_actions=set(re.findall(r"'(calendar-[^']+)'\s*:\s*\(",(SITE/'assets/js/ui/actions.js').read_text(encoding='utf-8')))
ok(bool(controller_actions) and controller_actions <= registered_actions,'calendar actions: every calendar button/change action rendered by the controller is registered in delegated UI actions')
ok('calendarAuthAction' in main and "'calendar-auth':" in (SITE/'assets/js/ui/actions.js').read_text(encoding='utf-8'),'calendar auth action: composition-root adapter is reachable from the delegated action registry')
ok('domainsCalendarController.start();' in main and 'export const appReady=lifecycle.boot();' in main and main.index('domainsCalendarController.start();') < main.index('export const appReady=lifecycle.boot();'),'calendar startup contract: controller start precedes lifecycle boot and therefore must be safe with initialized context')
ok('accountVerified=false' in auth and 'accountVerified=true' in controller and 'אימות חשבון Google' in controller,'calendar account guard: mutations cannot race a newly connected, not-yet-verified Google account')
ok('connectionPreference' in storage and 'saveConnectionPreference' in storage and 'orders.google-calendar.connection.v1' in storage,'calendar reconnect preference: only non-secret account/intent metadata is persisted across browser restarts')
ok('resumeKnownConnectionSilently' in controller and 'calendarAuth.restore()' in controller and 'resumeKnownConnectionFromGesture' not in controller and "prompt:'none'" not in controller and 'expected!==accountId' in controller,'calendar reconnect: startup refreshes through the server with no popup or gesture fallback and still rejects account mismatch')
ok('hydrateLegacyConnectionPreference' in controller and "getMeta('accountId')" in controller,'calendar reconnect migration: existing installations inherit their previously verified Calendar account once')

ok('data-click-arg0="month"' in controller and 'data-click-arg0="week"' in controller and 'data-click-arg0="day"' in controller and 'calendar-prev-period' in controller and 'calendar-next-period' in controller,'calendar view controls: month/week/day and period navigation are rendered from one focused-date model')
toolbar_markup=re.search(r'function toolbarMarkup\(\)\{.*?return `(.*?)`\}',controller,re.S)
toolbar_source=toolbar_markup.group(1) if toolbar_markup else ''
nav_pos=toolbar_source.find('<div class="calendar-nav-actions">')
views_pos=toolbar_source.find('${viewModeMarkup()}')
title_pos=toolbar_source.find('<div class="calendar-title-block">')
ok(0<=nav_pos<views_pos<title_pos and '.calendar-nav-actions,.calendar-view-modes{display:flex;gap:5px;flex:0 0 auto}' in css and '.calendar-view-modes{order:2}' not in css,'calendar toolbar: RTL right edge is navigation, then view modes, then dynamic title, so period text cannot shift the controls')
ok('alignFocusInScroller' in controller and 'scroller.scrollTop' in controller and 'window.scrollTo' not in controller,'calendar focus: today/focused date is aligned inside the calendar scroller without moving the page viewport')
ok((SITE/'assets/js/calendar/view.js').is_file(),'calendar view: pure period/focus helper module is part of the application')
ok('calendarPrefetchRangeFor' in controller and 'calendarRangeContains' in controller and 'getRangeCacheCovering' in controller,'calendar cache: view changes reuse any cached snapshot that covers the visible range instead of requiring an exact range key')
ok('memoryCovered?bodyMarkup()' in controller and "syncNow({quiet:true,force:false})" in controller,'calendar cache: covered month/week/day transitions render immediately and revalidate without blocking the view')
ok("const range=prefetchRange()" in controller and 'calendarPrefetchRangeFor' in (SITE/'assets/js/calendar/view.js').read_text(encoding='utf-8'),'calendar prefetch: Google sync warms a rolling nearby window rather than refetching only the active view')
ok('cacheRangeStart' in contexts and 'cacheRangeEnd' in contexts,'calendar cache: in-memory state records its coverage so mode/period transitions can be synchronous')
ok('workerCount=Math.min(4,readable.length)' in api and 'Promise.all' in api,'calendar API: readable calendars are fetched with bounded parallelism instead of serial network waits')
ok("eventTypes" not in api and "singleEvents:true" in api and "showHidden:true" in api,'calendar API: event listing includes all event types and hidden subscribed calendars')
ok("event?.eventType==='birthday'" in controller and 'אירוע יום הולדת' in controller,'calendar UI: birthdays are visible but protected from unsupported editing')
ok("_pendingDelete:true" in controller and 'ממתין למחיקה' in controller,'calendar UI: unacknowledged deletes remain visibly pending until Google confirms them')
ok("autoIncrement:true" in storage and "pending-operations" in storage,'calendar storage: outbound operations use an ordered durable IndexedDB journal')
ok("error?.status!==409" in journal and 'getEvent' in journal and 'insertMatches' in journal,'calendar journal: duplicate create retry confirms both the preassigned ID and intended event content')
ok("error?.status===404||error?.status===410" in journal,'calendar journal: repeated deletes acknowledge already-deleted events')
ok('accounts.google.com/gsi' not in headers and 'https://www.googleapis.com' in headers and "script-src 'self'" in headers and "frame-src 'none'" in headers and 'Cross-Origin-Opener-Policy: same-origin' in headers,'calendar security: CSP/COOP no longer allow Google popup/iframe resources while Calendar API access remains allowed')
ok('./assets/js/calendar/journal.js' in worker and './assets/js/calendar/view.js' in worker and './assets/js/domains/calendar/controller.js' in worker,'calendar PWA: calendar journal/view/controller modules are part of the deterministic app shell')
ok((ROOT/'netunim-orders/GOOGLE_CALENDAR_SETUP.txt').is_file(),'calendar setup: deployment/OAuth instructions are included')

if errors:
    print('\nERRORS',len(errors))
    for item in errors: print('-',item)
    raise SystemExit(1)
print('\nALL CALENDAR CONTRACTS PASSED')
