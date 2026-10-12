"""Native shared Calendar DB, separate tab producer and actual sync consumer.

Only Google/token responses and async boundaries are controlled. The secondary
tab writes through the real queue port (fault injection, not a UI permission
bypass shipped to users). No production data, auth or providers are contacted.
"""
import argparse
import json
import subprocess
from browser_harness import BrowserSession, ROOT

SETUP = r"""(async()=>{
 await appReady;syncDocument.stopPolling();finance.runtime.stop();
 const phase=__PHASE__,descriptor=Object.getOwnPropertyDescriptor(IDBTransaction.prototype,'oncomplete');
 const {createStorageJournalDb}=await import('./assets/js/shared/storage-journal-idb.js');const db=createStorageJournalDb();
 const note={id:'calendar-cross-tab-note',content:'independent durable note'};state.notes.push(note);
 storagePersistence.scheduleSave('Calendar cross-tab fixture',{domains:['notes'],operations:[{type:'put',collection:'notes',id:note.id,record:note,mode:'insert',index:state.notes.length-1}]});await mainStorageV2.commitPromise;
 const deferred=()=>{let resolve;const promise=new Promise(done=>{resolve=done});return {promise,resolve}};
 const raw=async()=>JSON.stringify({main:await db.load('local:orders'),checks:await db.load('local:shared-checks')});
 const audit=globalThis.calendarCrossTabAudit={held:deferred(),entered:deferred(),delivery:deferred(),deliveryEntered:deferred(),before:await raw(),raw,remote:new Map(),effects:0,descriptor,phase,armAbort:false};
 audit.originalGetAll=IDBObjectStore.prototype.getAll;
 IDBObjectStore.prototype.getAll=function(...args){
   const request=audit.originalGetAll.apply(this,args);
   if(audit.armAbort&&this.name==='pending-operations'){audit.armAbort=false;const tx=this.transaction;queueMicrotask(()=>tx.abort())}
   return request;
 };
 let cacheCommitted=false,armed=true;
 // This is the delivery owner's post-cache queue read, not the independent
 // observer's cache+queue+account read. The injection must survive new readers.
 Object.defineProperty(IDBTransaction.prototype,'oncomplete',{...descriptor,set(handler){
   const tx=this,queue=tx.objectStoreNames.contains('pending-operations'),cache=tx.objectStoreNames.contains('range-cache');
   const hold=armed&&((['receipt','receipt-abort'].includes(phase)&&cacheCommitted&&queue&&tx.objectStoreNames.length===1&&tx.mode==='readonly')||(phase==='cache'&&cache&&tx.mode==='readwrite'));
   if(hold)armed=false;
   descriptor.set.call(tx,function(event){if(cache&&tx.mode==='readwrite')cacheCommitted=true;if(hold){audit.entered.resolve();void audit.held.promise.then(()=>handler.call(tx,event))}else handler.call(tx,event)});
 }});
 cloudAuth.saveSession({user:{id:'calendar-owner-fixture'},access_token:'fixture',expires_at:9999999999});
 cloudAuth.supaFetch=async(_path,options)=>{options.assertRequestScope();if(JSON.parse(options.body).action!=='token')throw Error('unexpected OAuth');return new Response(JSON.stringify({access_token:'fixture-Google',expires_in:3600,account_id:'calendar@example.test'}))};
 audit.originalFetch=globalThis.fetch;let firstRead=true;
 globalThis.fetch=async(url,options={})=>{
   const path=new URL(url).pathname;
   if(path==='/calendar/v3/users/me/calendarList')return new Response(JSON.stringify({items:[{id:'calendar@example.test',primary:true,summary:'fixture',accessRole:'owner'}]}));
   if(path.endsWith('/events')&&options.method==='POST'){
     const body=JSON.parse(options.body);if(audit.remote.has(body.id))throw Error('duplicate provider create');audit.effects++;audit.remote.set(body.id,body);
     return {ok:true,status:200,text:async()=>{audit.deliveryEntered.resolve();await audit.delivery.promise;return JSON.stringify(body)}};
   }
   if(path.endsWith('/events')){
     const items=[...audit.remote.values()];
     if(firstRead){firstRead=false;if(phase==='events')return {ok:true,status:200,text:async()=>{audit.entered.resolve();await audit.held.promise;return JSON.stringify({items})}}}
     return new Response(JSON.stringify({items}));
   }
   throw Error('unexpected Google path '+path);
 };
 audit.sync=domainsCalendarController.resumeAfterCloudLogin();await audit.entered.promise;
 return {primary:tab.primaryTab};
})()"""

PRODUCE = r"""(async()=>{
 await appReady;const {createCalendarStorage}=await import('./assets/js/calendar/storage.js');const storage=createCalendarStorage();
 const record={type:'insert',calendarId:'calendar@example.test',eventId:'abcd0123abcd0123abcd0123abcd0123',body:{id:'abcd0123abcd0123abcd0123abcd0123',summary:'cross-tab committed event',description:'',location:'',start:{date:'2026-10-11'},end:{date:'2026-10-12'}}};
 await storage.addOperation(record);const queued=await storage.listOperations();
 return {secondary:!tab.primaryTab,record:queued[0],count:queued.length};
})()"""

VERIFY = r"""(async()=>{
 const audit=globalThis.calendarCrossTabAudit,check=(ok,message)=>{if(!ok)throw Error(message)};
 const {createCalendarStorage}=await import('./assets/js/calendar/storage.js');const storage=createCalendarStorage();
 try{
   audit.armAbort=audit.phase==='receipt-abort';audit.held.resolve();check(await audit.sync===false,'cross-tab commit was falsely reported as synchronized');
   check(!calendarSession.lastSyncAt,'cross-tab pending advanced completed sync time');
   check(calendarUi.pending[0]?.eventId==='abcd0123abcd0123abcd0123abcd0123','new durable pending not published');
   if(audit.phase==='receipt-abort'){
     check(!calendarSession.syncPromise&&audit.effects===0&&calendarSession.lastError,'failed confirmation started an automatic delivery');
     audit.manual=domainsCalendarController.syncNow({quiet:true});
   }
   await audit.deliveryEntered.promise;const queued=await storage.listOperations();
   check(queued.length===1&&queued[0].body.summary==='cross-tab committed event','queue lost before confirmed Google delivery');
   const resumed=calendarSession.syncPromise;check(resumed,'pending work lost its owner wake');audit.delivery.resolve();
   check(await resumed===true,'owned continuation failed');if(audit.manual)check(await audit.manual===true,'manual recovery failed');check(audit.effects===1&&audit.remote.size===1,'duplicate Google effect');
   check((await storage.listOperations()).length===0&&calendarSession.lastSyncAt,'confirmation did not settle queue');
   check(await audit.raw()===audit.before,'Calendar changed Main/Shared raw records');
   return {staleSuccessBlocked:true,pendingPublished:true,oneEffect:true,originalId:true,mainSharedRetained:true};
 }finally{
   Object.defineProperty(IDBTransaction.prototype,'oncomplete',audit.descriptor);IDBObjectStore.prototype.getAll=audit.originalGetAll;globalThis.fetch=audit.originalFetch;
   cloudAuth.saveSession(null);storage.saveConnectionPreference({autoConnect:false,accountId:'calendar@example.test'});
 }
})()"""

parser = argparse.ArgumentParser()
parser.add_argument('--baseline', action='store_true')
parser.add_argument('--phase', choices=('events', 'cache', 'receipt', 'receipt-abort'), action='append')
args = parser.parse_args()
phases = ('receipt',) if args.baseline else args.phase or ('events', 'cache', 'receipt', 'receipt-abort')
for phase in phases:
    with BrowserSession(ROOT / 'netunim-orders/site', 'calendar-cross-tab-' + phase, auto_navigate=False) as browser:
        if args.baseline:
            old = subprocess.check_output(['git', 'show', '4bbe4652d0718ba79cfaf1c8174b3e04355ff47e:netunim-orders/site/assets/js/domains/calendar/controller.js'], cwd=ROOT)
            prepared = browser.tmp / 'site/assets/js/domains/calendar/controller.js'
            trailer = prepared.read_text(encoding='utf-8').split('\nexport const __testBindings=', 1)[1]
            prepared.write_bytes(old + ('\nexport const __testBindings=' + trailer).encode('utf-8'))
        browser._navigate()
        assert browser.evaluate(SETUP.replace('__PHASE__', json.dumps(phase)))['primary']
        with browser.second_tab():
            produced = browser.evaluate(PRODUCE)
            assert produced['secondary'] and produced['count'] == 1, produced
            assert produced['record']['eventId'] == produced['record']['body']['id'], produced
            errors = browser.drain_serious_errors()
            assert not errors, errors
        result = browser.evaluate(VERIFY)
        assert not browser.drain_serious_errors()
        browser._navigate()
        recovered = browser.evaluate(r"""(async()=>{
          await appReady;const {createCalendarStorage}=await import('./assets/js/calendar/storage.js');const storage=createCalendarStorage(),db=await storage.openDb();
          const tx=db.transaction('range-cache','readonly'),snapshots=await new Promise((resolve,reject)=>{const request=tx.objectStore('range-cache').getAll();request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error)});
          return {pending:await storage.listOperations(),events:snapshots.flatMap(row=>row.events||[]),note:(await mainStorageV2.recoverReadOnly()).state.notes.find(row=>row.id==='calendar-cross-tab-note')};
        })()""")
        assert not recovered['pending'], recovered
        assert any(row['id'] == produced['record']['eventId'] and row['summary'] == produced['record']['body']['summary'] for row in recovered['events']), recovered
        assert recovered['note']['content'] == 'independent durable note', recovered
        assert not browser.drain_serious_errors()
        print('PASS Calendar real cross-tab ' + phase + ': ' + json.dumps(result), flush=True)
