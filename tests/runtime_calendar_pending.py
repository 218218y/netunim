"""Native Calendar IDB: concurrent append, stale read and deferred commit receipt.

Real composition/storage/controller; controlled Google effects, disposable
profiles only. --baseline replays the old controller in the temporary copy to
prove the failing case without editing the workspace or touching real data.
"""
import json
import subprocess
import argparse
from browser_harness import BrowserSession, ROOT

FLOW = r"""(async()=>{
 await appReady;syncDocument.stopPolling();domainsFinanceController.stopAutoSync();
 const check=(ok,message)=>{if(!ok)throw Error(message)},phase=__PHASE__;
 const originalFetch=globalThis.fetch,descriptor=Object.getOwnPropertyDescriptor(IDBTransaction.prototype,'oncomplete');
 const {createCalendarStorage}=await import('./assets/js/calendar/storage.js');const storage=createCalendarStorage();
 const {createStorageJournalDb}=await import('./assets/js/shared/storage-journal-idb.js');const db=createStorageJournalDb();
 const raw=async()=>JSON.stringify({main:await db.load('local:orders'),checks:await db.load('local:shared-checks')});
 const note={id:'calendar-pending-note',content:'independent durable note'};state.notes.push(note);
 storagePersistence.scheduleSave('Calendar pending fixture',{domains:['notes'],operations:[{type:'put',collection:'notes',id:note.id,mode:'insert',index:state.notes.length-1,record:note}]});await mainStorageV2.commitPromise;
 const before=await raw(),calendarId='calendar@example.test',remote=new Map();let effects=0,queueReads=0,armed=false,appendArmed=false;
 const deferred=()=>{let resolve;const promise=new Promise(done=>{resolve=done});return {promise,resolve}};
 const held=deferred(),entered=deferred(),delivery=deferred(),deliveryEntered=deferred(),appendHeld=deferred(),appendEntered=deferred();
 Object.defineProperty(IDBTransaction.prototype,'oncomplete',{...descriptor,set(handler){
   const tx=this,cache=tx.objectStoreNames.contains('range-cache'),queue=tx.objectStoreNames.contains('pending-operations');
   let wait=null;
   if(armed&&((phase==='cache'&&cache&&tx.mode==='readwrite')||(phase==='receipt'&&queue&&tx.mode==='readonly'&&++queueReads===4))){armed=false;wait={held,entered}}
   if(appendArmed&&queue&&tx.mode==='readwrite'){appendArmed=false;wait={held:appendHeld,entered:appendEntered}}
   descriptor.set.call(tx,function(event){if(wait){wait.entered.resolve();void wait.held.promise.then(()=>handler.call(tx,event))}else handler.call(tx,event)});
 }});
 const authenticate=user=>cloudAuth.saveSession(user?{user:{id:user},access_token:'fixture',expires_at:9999999999}:null);
 cloudAuth.supaFetch=async(_path,options)=>{options.assertRequestScope?.();check(JSON.parse(options.body).action==='token','unexpected OAuth action');return new Response(JSON.stringify({access_token:'fixture-Google',expires_in:3600,account_id:calendarId}))};
 let firstRead=true;
 globalThis.fetch=async(url,options={})=>{
   const path=new URL(url).pathname;
   if(path==='/calendar/v3/users/me/calendarList')return new Response(JSON.stringify({items:[{id:calendarId,primary:true,summary:'fixture',accessRole:'owner'}]}));
   if(path.endsWith('/events')&&options.method==='POST'){
     const body=JSON.parse(options.body);check(!remote.has(body.id),'duplicate Google create');effects++;remote.set(body.id,body);
     return {ok:true,status:200,text:async()=>{deliveryEntered.resolve();await delivery.promise;return JSON.stringify(body)}};
   }
   if(path.endsWith('/events')){
     const items=[...remote.values()];
     if(firstRead){firstRead=false;if(['events','staged','revoked'].includes(phase))return {ok:true,status:200,text:async()=>{entered.resolve();await held.promise;return JSON.stringify({items})}}}
     return new Response(JSON.stringify({items}));
   }
   throw Error('unexpected fixture request '+path);
 };
 try{
   authenticate('fixture-calendar-owner');armed=true;
   const first=domainsCalendarController.resumeAfterCloudLogin().catch(error=>{if(error.code==='CALENDAR_OPERATION_SCOPE_CHANGED')return false;throw error});await entered.promise;
   let saving=null,reacquire=null;
   if(phase==='staged'){
     document.body.insertAdjacentHTML('beforeend','<div id="calendarPendingFixture"><input id="calendarSummary" value="retained queued event"><input id="calendarStartDate" value="2026-10-09"><input id="calendarEndDate" value="2026-10-09"><input id="calendarAllDay" type="checkbox" checked><input id="calendarCalendarId" value="calendar@example.test"></div>');
     appendArmed=true;saving=domainsCalendarController.saveCalendarEvent();await appendEntered.promise;
   }else await storage.addOperation({type:'insert',calendarId,eventId:'abcd0123abcd0123abcd0123abcd0123',body:{id:'abcd0123abcd0123abcd0123abcd0123',summary:'retained queued event',description:'',location:'',start:{date:'2026-10-09'},end:{date:'2026-10-10'}}});
   if(phase==='revoked')authenticate(null);
   held.resolve();check(await first===false,'old snapshot falsely confirmed whole Calendar sync');
   check(!calendarSession.lastSyncAt,'old read published a completed sync time');
   const queued=await storage.listOperations();check(queued.length===1,'new durable operation lost/acknowledged prematurely');
   const original=queued[0];check(original.body.summary==='retained queued event'&&original.body.id===original.eventId,'queued identity/content changed');
   if(phase==='staged'){
     check(effects===0,'unfinished local write triggered provider delivery');
     appendHeld.resolve();await saving;
   }
   if(phase==='revoked'){
     check(effects===0,'revoked continuation used former authority');authenticate('fixture-calendar-owner');reacquire=domainsCalendarController.resumeAfterCloudLogin();
   }
   await deliveryEntered.promise;
   check((await storage.listOperations())[0]?.eventId===original.eventId,'queue deleted before Google response confirmed');
   const resumed=calendarSession.syncPromise;check(resumed,'known new work was not scheduled by the owner');
   delivery.resolve();check(await resumed===true,'authorized continuation failed to confirm settled queue');if(reacquire)check(await reacquire===true,'reacquired login did not confirm recovery');
   check(effects===1&&remote.size===1,'continuation duplicated provider effect');
   check(remote.get(original.eventId)?.summary===original.body.summary,'provider identity/content differs');
   check((await storage.listOperations()).length===0,'confirmed operation remained queued');
   check(calendarSession.lastSyncAt,'confirmed sync not published');
   check(await raw()===before,'Calendar pipeline changed Main/Shared raw stores');
   return {staleSuccessBlocked:true,exactIdentity:true,ownedContinuation:true,noDuplicateEffect:true,mainSharedRetained:true,eventId:original.eventId};
 }finally{Object.defineProperty(IDBTransaction.prototype,'oncomplete',descriptor);globalThis.fetch=originalFetch;authenticate(null)}
})()"""

parser = argparse.ArgumentParser()
parser.add_argument('--baseline', action='store_true')
parser.add_argument('--phase', choices=('events', 'cache', 'receipt', 'staged', 'revoked'), action='append')
args = parser.parse_args()
baseline = args.baseline
phases = ('events',) if baseline else (args.phase or ('events', 'cache', 'receipt', 'staged', 'revoked'))
for phase in phases:
    with BrowserSession(ROOT / 'netunim-orders/site', 'calendar-pending-' + phase, auto_navigate=False) as browser:
        if baseline:
            old = subprocess.check_output(['git', 'show', '38b1b35d282d1f9e1dff2165d41d326238e61cf3:netunim-orders/site/assets/js/domains/calendar/controller.js'], cwd=ROOT)
            prepared = browser.tmp / 'site/assets/js/domains/calendar/controller.js'
            # Keep the harness's lexical access exports; replacing only the
            # production body must not turn this into a test-hook/module error.
            trailer = prepared.read_text(encoding='utf-8').split('\nexport const __testBindings=', 1)[1]
            prepared.write_bytes(old + ('\nexport const __testBindings=' + trailer).encode('utf-8'))
        browser._navigate()
        result = browser.evaluate(FLOW.replace('__PHASE__', json.dumps(phase)), timeout=35)
        browser._navigate()
        restored = browser.evaluate(r"""(async()=>{await appReady;const {createCalendarStorage}=await import('./assets/js/calendar/storage.js');const storage=createCalendarStorage();const db=await storage.openDb();const tx=db.transaction('range-cache','readonly');const snapshots=await new Promise((resolve,reject)=>{const r=tx.objectStore('range-cache').getAll();r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error)});return {queue:await storage.listOperations(),events:snapshots.flatMap(row=>row.events||[]),note:(await mainStorageV2.recoverReadOnly()).state.notes.find(row=>row.id==='calendar-pending-note')}})()""")
        assert not restored['queue'], restored
        assert any(event['id'] == result['eventId'] and event['summary'] == 'retained queued event' for event in restored['events']), restored
        assert restored['note']['content'] == 'independent durable note', restored
        errors = browser.drain_serious_errors()
        assert not errors, errors
        print('PASS Calendar pending ' + phase + ': ' + json.dumps(result))
