"""Competing production Calendar sync owners, native Web Locks and IndexedDB.

Google/OAuth responses are synthetic, shared by the two disposable tabs. Main
and Shared records are retained exactly; no provider or production data is used.
"""
import argparse
import json
import subprocess
from browser_harness import BrowserSession, ROOT

SETUP = r"""(async()=>{
 await appReady;syncDocument.stopPolling();finance.runtime.stop();
 const {createCalendarStorage}=await import('./assets/js/calendar/storage.js'),storage=createCalendarStorage();
 const deferred=()=>{let resolve;const promise=new Promise(done=>{resolve=done});return {promise,resolve}};
 const audit=globalThis.calendarDeliveryAudit={held:deferred(),entered:deferred(),requested:deferred(),finished:deferred(),calls:0};
 if(__ACK_ABORT__){
   const originalDelete=IDBObjectStore.prototype.delete;
   IDBObjectStore.prototype.delete=function(...args){const request=originalDelete.apply(this,args);if(audit.abortAck&&this.name==='pending-operations'){audit.abortAck=false;const tx=this.transaction;queueMicrotask(()=>tx.abort())}return request};
 }
 const {createStorageJournalDb}=await import('./assets/js/shared/storage-journal-idb.js'),db=createStorageJournalDb();
 audit.raw=async()=>JSON.stringify({main:await db.load('local:orders'),checks:await db.load('local:shared-checks')});
 audit.before=await audit.raw();
 const calendarId='calendar@example.test',eventId='abcd0123abcd0123abcd0123abcd0123';
 __PRODUCE__
 audit.beforeQueue=await storage.listOperations();
 const originalRequest=navigator.locks.request.bind(navigator.locks);
 navigator.locks.request=(name,options,callback)=>{if(name==='netunim-orders-calendar-delivery')audit.requested.resolve();return originalRequest(name,options,callback)};
 cloudAuth.supaFetch=async(_path,options)=>{options.assertRequestScope();return new Response(JSON.stringify({access_token:'fixture-Google',expires_in:3600,account_id:calendarId}))};
 globalThis.fetch=async(url,options={})=>{
   const path=new URL(url).pathname;
   if(path==='/calendar/v3/users/me/calendarList')return new Response(JSON.stringify({items:[{id:calendarId,primary:true,summary:'fixture',accessRole:'owner'}]}));
   if(options.method==='PATCH'){
     const body=JSON.parse(options.body);audit.calls++;
     if(__PRIMARY__&&audit.calls===1){audit.entered.resolve();await audit.held.promise;localStorage.setItem('fixture.calendar.remote',JSON.stringify({...JSON.parse(localStorage.getItem('fixture.calendar.remote')),id:eventId,...body}));if(__ACK_ABORT__)audit.abortAck=true;else throw Error('fixture response lost after effect')}
     localStorage.setItem('fixture.calendar.remote',JSON.stringify({...JSON.parse(localStorage.getItem('fixture.calendar.remote')),id:eventId,...body}));return new Response(JSON.stringify({...JSON.parse(localStorage.getItem('fixture.calendar.remote')),id:eventId,...body}));
   }
   if(path.endsWith('/events'))return new Response(JSON.stringify({items:[JSON.parse(localStorage.getItem('fixture.calendar.remote'))]}));
   throw Error('unexpected Calendar request '+path);
 };
 audit.sync=domainsCalendarController.resumeAfterCloudLogin().then(result=>{audit.finished.resolve();return result},error=>{audit.finished.resolve();if(error.code==='CALENDAR_OPERATION_SCOPE_CHANGED')return false;throw error});
 __ENTER__
 return {primary:tab.primaryTab,calls:audit.calls,lastSyncAt:calendarSession.lastSyncAt,pending:(await storage.listOperations()).length};
})()"""

PRODUCE = r"""
 cloudAuth.saveSession({user:{id:'calendar-owner-fixture'},access_token:'fixture',expires_at:9999999999});
 await storage.putMeta('accountId',calendarId);storage.saveConnectionPreference({autoConnect:false,accountId:calendarId});
 localStorage.setItem('fixture.calendar.remote',JSON.stringify({id:eventId,summary:'initial',start:{date:'2026-10-15'},end:{date:'2026-10-16'}}));
 for(const summary of ['old','new'])await storage.addOperation({type:'patch',calendarId,eventId,body:{summary}});
"""

VERIFY = r"""(async()=>{
 const audit=globalThis.calendarDeliveryAudit,{createCalendarStorage}=await import('./assets/js/calendar/storage.js'),storage=createCalendarStorage();
 const check=(ok,message)=>{if(!ok)throw Error(message)};
 const result=await audit.sync;
 check(result===__SUCCESS__,'unexpected Calendar sync outcome');
 check(await audit.raw()===audit.before,'Calendar changed Main/Shared raw stores');
 return {result,calls:audit.calls,pending:await storage.listOperations(),remote:JSON.parse(localStorage.getItem('fixture.calendar.remote')),lastError:calendarSession.lastError,lastSyncAt:calendarSession.lastSyncAt,beforeQueue:audit.beforeQueue};
})()"""

def run_case(*, baseline=False, dispose_queued=False, ack_abort=False):
    setup = SETUP.replace('__ACK_ABORT__', 'true' if ack_abort else 'false')
    with BrowserSession(ROOT / 'netunim-orders/site', 'calendar-delivery-owner'+('-disposed' if dispose_queued else '-ack-abort' if ack_abort else ''), auto_navigate=False) as browser:
        if baseline:
            old = subprocess.check_output(['git', 'show', '0bd62159:netunim-orders/site/assets/js/calendar/journal.js'], cwd=ROOT)
            prepared = browser.tmp / 'site/assets/js/calendar/journal.js'
            trailer = prepared.read_text(encoding='utf-8').split('\nexport const __testBindings=', 1)[1]
            prepared.write_bytes(old + ('\nexport const __testBindings=' + trailer).encode('utf-8'))
        browser._navigate()
        first = browser.evaluate(setup.replace('__PRODUCE__', PRODUCE).replace('__PRIMARY__', 'true').replace('__ENTER__', 'await audit.entered.promise;'))
        assert first['primary'] and first['calls'] == 1 and first['pending'] == 2, first
        primary = browser.ws, browser.seq, browser.events
        with browser.second_tab():
            second = browser.evaluate(setup.replace('__PRODUCE__', '').replace('__PRIMARY__', 'false').replace('__ENTER__', 'await Promise.race([audit.finished.promise,audit.requested.promise]);'))
            assert not second['primary'], second
            if dispose_queued:
                disposed = browser.evaluate('(async()=>{domainsCalendarController.dispose();return await calendarDeliveryAudit.sync})()')
                assert disposed is False, disposed
            secondary = browser.ws, browser.seq, browser.events
            browser.ws, browser.seq, browser.events = primary
            browser.evaluate('(()=>{calendarDeliveryAudit.held.resolve();return true})()')
            a = browser.evaluate(VERIFY.replace('__SUCCESS__', 'false'))
            assert not browser.drain_serious_errors()
            primary = browser.ws, browser.seq, browser.events
            browser.ws, browser.seq, browser.events = secondary
            b = browser.evaluate(VERIFY.replace('__SUCCESS__', 'false' if dispose_queued else 'true'))
            assert not browser.drain_serious_errors()
        browser.ws, browser.seq, browser.events = primary
        if dispose_queued:
            assert b['calls'] == 0 and len(b['pending']) == 2 and not b['lastSyncAt'], b
            assert [(row['seq'], row['eventId'], row['body']) for row in b['pending']] == [(row['seq'], row['eventId'], row['body']) for row in a['beforeQueue']], b
            b = browser.evaluate("(async()=>{const result=await domainsCalendarController.syncNow({quiet:true});const {createCalendarStorage}=await import('./assets/js/calendar/storage.js');return {result,calls:calendarDeliveryAudit.calls-1,pending:await createCalendarStorage().listOperations(),remote:JSON.parse(localStorage.getItem('fixture.calendar.remote'))}})()")
            assert b['result'] is True, b
        print(json.dumps({'secondWhileFirstPending': second, 'remote': b['remote'], 'queue': b['pending'], 'firstError': a['lastError']}, ensure_ascii=True), flush=True)
        assert second['calls'] == 0 and second['pending'] == 2 and not second['lastSyncAt'], 'competing owner delivered/confirmed while the first request was unresolved'
        assert a['calls'] == 1 and b['calls'] == 2 and b['remote']['summary'] == 'new' and not b['pending'], 'late request regressed the confirmed Google state'
        assert len(a['beforeQueue']) == 2 and len({row['eventId'] for row in a['beforeQueue']}) == 1
        resources = browser.evaluate(r"""(async()=>{
          const {createCalendarDeliveryOwner}=await import('./assets/js/platform/calendar-delivery-owner.js'),owner=createCalendarDeliveryOwner();
          const deferred=()=>{let resolve;const promise=new Promise(done=>{resolve=done});return {promise,resolve}},entered=deferred(),held=deferred(),active=new AbortController(),queued=new AbortController();
          const first=owner.run(()=>{},async()=>{entered.resolve();await held.promise;return 1},{signal:active.signal});await entered.promise;
          let forbidden=0;const next=owner.run(()=>{},async()=>{forbidden++;return 2},{signal:queued.signal}).catch(error=>error.name);
          queued.abort();const cancelled=await next;active.abort();
          const before=await navigator.locks.query();held.resolve();const settled=await first;
          for(let i=0;i<100;i++)if(await owner.run(()=>{},async()=>i)!==i)throw Error('incorrect lock result');
          const after=await navigator.locks.query(),owns=rows=>rows.filter(row=>row.name==='netunim-orders-calendar-delivery').length;
          return {cancelled,forbidden,held:owns(before.held),settled,remaining:owns(after.held)+owns(after.pending)};
        })()""")
        assert resources == {'cancelled': 'AbortError', 'forbidden': 0, 'held': 1, 'settled': 1, 'remaining': 0}, resources
        browser.evaluate("(()=>{cloudAuth.saveSession(null);return true})()")
        browser._navigate()
        recovered = browser.evaluate("(async()=>{await appReady;const {createCalendarStorage}=await import('./assets/js/calendar/storage.js');return {pending:await createCalendarStorage().listOperations(),remote:JSON.parse(localStorage.getItem('fixture.calendar.remote'))}})()")
        assert not recovered['pending'] and recovered['remote']['summary'] == 'new', recovered
        assert not browser.drain_serious_errors()
        print('PASS Calendar delivery ownership' + (' + queued disposal' if dispose_queued else ' + native ACK abort' if ack_abort else '') + ': original event ID, ordered replay, native IDB, fresh-document recovery, 100 native lock cycles', flush=True)

parser = argparse.ArgumentParser()
parser.add_argument('--baseline', action='store_true')
parser.add_argument('--dispose-queued', action='store_true')
parser.add_argument('--ack-abort', action='store_true')
args = parser.parse_args()
if args.baseline:
    run_case(baseline=True)
elif args.dispose_queued:
    run_case(dispose_queued=True)
elif args.ack_abort:
    run_case(ack_abort=True)
else:
    run_case()
    run_case(dispose_queued=True)
    run_case(ack_abort=True)
