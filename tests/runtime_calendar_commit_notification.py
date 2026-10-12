"""Idle Calendar UI sees another tab's committed work; native IDB, fake Google."""
import argparse
import json
import subprocess
from browser_harness import BrowserSession, ROOT

SETUP = r"""(async()=>{
 await appReady;syncDocument.stopPolling();finance.runtime.stop();
 const note={id:'calendar-observation-retained-note',content:'independent durable note'};state.notes.push(note);
 storagePersistence.scheduleSave('Calendar observation fixture',{domains:['notes'],operations:[{type:'put',collection:'notes',id:note.id,record:note,mode:'insert',index:state.notes.length-1}]});await mainStorageV2.commitPromise;
 const check=(ok,message)=>{if(!ok)throw Error(message)},calendarId='calendar@example.test',owner='calendar-commit-owner';
 cloudAuth.saveSession({user:{id:owner},access_token:'fixture',expires_at:9999999999});
 cloudAuth.supaFetch=async(_path,options)=>{options.assertRequestScope?.();return new Response(JSON.stringify({access_token:'fixture-Google',expires_in:3600,account_id:calendarId}))};
 let network=0;const requests=[];globalThis.fetch=async(url,options)=>{network++;requests.push({url:String(url),method:options?.method||'GET'});return new Response(JSON.stringify({items:new URL(url).pathname.endsWith('/calendarList')?[{id:calendarId,primary:true,accessRole:'owner'}]:[]}))};
 check(await domainsCalendarController.resumeAfterCloudLogin()===true,'Calendar fixture failed');
 ui.currentView='calendar';await domainsCalendarController.renderCalendar();
 Object.defineProperty(document,'visibilityState',{configurable:true,value:'hidden'});
 const {createCalendarStorage}=await import('./assets/js/calendar/storage.js'),storage=createCalendarStorage();
 const {createStorageJournalDb}=await import('./assets/js/shared/storage-journal-idb.js'),db=createStorageJournalDb();
 let observed;const observation=new Promise(resolve=>{observed=resolve}),descriptor=Object.getOwnPropertyDescriptor(calendarUi,'pending');
 let pending=calendarUi.pending;
 Object.defineProperty(calendarUi,'pending',{configurable:true,get:()=>pending,set:value=>{pending=value;if(value.some(row=>row.body?.summary==='peer committed event'))observed()}});
 const raw=async()=>JSON.stringify({main:await db.load('local:orders'),shared:await db.load('local:shared-checks')});
 globalThis.calendarCommitAudit={storage,check,observation,raw,before:await raw(),network:()=>network,requests,calls:network,confirmedAt:calendarSession.lastSyncAt,descriptor};
 check(document.getElementById('calendarStatus').classList.contains('synced'),'initial fixture is not synced');
 return true;
})()"""

PRODUCE = r"""(async()=>{
 await appReady;syncDocument.stopPolling();finance.runtime.stop();
 cloudAuth.supaFetch=async(_path,options)=>{options.assertRequestScope?.();return new Response(JSON.stringify({access_token:'fixture-Google',expires_in:3600,account_id:'calendar@example.test'}))};
 globalThis.fetch=async(url)=>new Response(JSON.stringify({items:new URL(url).pathname.endsWith('/calendarList')?[{id:'calendar@example.test',primary:true,accessRole:'owner'}]:[]}));
 await domainsCalendarController.resumeAfterCloudLogin();Object.defineProperty(navigator,'onLine',{configurable:true,value:false});
 ui.currentView='calendar';await domainsCalendarController.renderCalendar();domainsCalendarController.newEvent();
 document.getElementById('calendarSummary').value='peer committed event';
 await domainsCalendarController.saveCalendarEvent();
 const {createCalendarStorage}=await import('./assets/js/calendar/storage.js'),rows=await createCalendarStorage().listOperations();
 if(rows.length!==1||rows[0].body.summary!=='peer committed event')throw Error('production producer did not retain the event');
 return rows[0];
})()"""

VERIFY = r"""(async()=>{
 const audit=calendarCommitAudit,rows=await audit.storage.listOperations();
 __WAIT__
 audit.check(rows.length===1&&calendarUi.pending[0]?.eventId===rows[0].eventId,'idle tab retained a false synced indicator after the peer commit '+JSON.stringify({rows,pending:calendarUi.pending,verified:calendarSession.accountVerified,error:calendarSession.queueObservationError,requests:audit.requests}));
 audit.check(document.getElementById('calendarStatus').classList.contains('pending'),'missing pending status');
 audit.check(document.getElementById('calendarBody').textContent.includes(rows[0].body.summary),'missing committed peer overlay');
 audit.check(calendarSession.lastSyncAt===audit.confirmedAt,'notification advanced Google confirmation');
 audit.check(audit.network()===audit.calls,'notification retried Google or fetched remotely');
 audit.check(await audit.raw()===audit.before,'notification changed Main/Shared stores');
 return {event:rows[0],pendingVisible:true,noProviderRetry:true,confirmationRetained:true,journalsRetained:true};
})()"""

ARM = r"""(()=>{
 const audit=calendarCommitAudit,phase=__PHASE__;
 const deferred=()=>{let resolve;const promise=new Promise(done=>{resolve=done});return {promise,resolve}};
 audit.entered=deferred();audit.release=deferred();audit.failed=deferred();audit.completed=deferred();
 let warning=calendarSession.queueObservationError;
 Object.defineProperty(calendarSession,'queueObservationError',{configurable:true,get:()=>warning,set:value=>{warning=value;if(value)audit.failed.resolve()}});
 audit.originalGetAll=IDBObjectStore.prototype.getAll;
 IDBObjectStore.prototype.getAll=function(...args){
   const request=audit.originalGetAll.apply(this,args);
   if(phase==='read-abort'&&audit.armed&&this.name==='range-cache'){const tx=this.transaction;queueMicrotask(()=>tx.abort())}
   return request;
 };
 const descriptor=Object.getOwnPropertyDescriptor(IDBTransaction.prototype,'oncomplete');audit.completeDescriptor=descriptor;
 Object.defineProperty(IDBTransaction.prototype,'oncomplete',{...descriptor,set(handler){
   const tx=this,hold=audit.armed&&phase!=='read-abort'&&tx.mode==='readonly'&&tx.objectStoreNames.contains('range-cache')&&tx.objectStoreNames.contains('pending-operations');
   if(hold)audit.armed=false;
   descriptor.set.call(tx,function(event){if(hold){audit.entered.resolve();void audit.release.promise.then(()=>{handler.call(tx,event);audit.completed.resolve()})}else handler.call(tx,event)});
 }});
 audit.armed=true;return true;
})()"""

FAULT = r"""(async()=>{
 const audit=calendarCommitAudit,phase=__PHASE__;
 if(phase==='read-abort'){
   await audit.failed.promise;
   audit.check(document.getElementById('calendarStatus').classList.contains('error'),'failed read retained a false synced indicator');
   audit.check(calendarSession.lastSyncAt===audit.confirmedAt,'failed read advanced remote confirmation');
   // A later real hint permits one new native read, without an automatic POST.
   audit.armed=false;const {createCalendarCommitNotifications}=await import('./assets/js/platform/calendar-commit-notifications.js');createCalendarCommitNotifications().notify();
   await audit.observation;audit.check(!calendarSession.queueObservationError,'a valid later read did not clear the independent observation warning');
   return true;
 }
 await audit.entered.promise;
 if(phase==='logout')cloudAuth.saveSession(null);else domainsCalendarController.dispose();
 audit.release.resolve();await audit.completed.promise;
 const settle=await audit.storage.listOperations();
 audit.check(settle.length===1,'authorization change removed the committed event');
 audit.check(!calendarUi.pending.length&&!calendarUi.displayEvents.length,'held observation published under a disposed/old account');
 audit.check(!calendarSession.queueObservationError,'obsolete read published a warning under the next account');
 audit.check(!document.getElementById('calendarStatus').classList.contains('synced'),'obsolete account retained success');
 audit.check(audit.network()===audit.calls,'observation performed remote work');
 audit.check(await audit.raw()===audit.before,'observation changed Main/Shared');
 return true;
})()"""

WRITES = r"""(async()=>{
 const audit=calendarCommitAudit,{createCalendarStorage}=await import('./assets/js/calendar/storage.js');let hints=0;
 const storage=createCalendarStorage({onLocalCommit:()=>{hints++;throw Error('injected notification failure')}}),prior=await storage.listOperations(),add=IDBObjectStore.prototype.add;
 const record={type:'insert',calendarId:'calendar@example.test',eventId:'abcd2222abcd2222abcd2222abcd2222',body:{id:'abcd2222abcd2222abcd2222abcd2222',summary:'drained write survives notification failure'}};
 IDBObjectStore.prototype.add=function(...args){const request=add.apply(this,args);if(this.name==='pending-operations'){const tx=this.transaction;queueMicrotask(()=>tx.abort())}return request};
 let aborted=false;try{await storage.addOperation(record)}catch{aborted=true}finally{IDBObjectStore.prototype.add=add}
 audit.check(aborted&&hints===0,'an aborted queue write emitted a commit hint');
 audit.check(JSON.stringify(await storage.listOperations())===JSON.stringify(prior),'abort altered the prior queued row');
 const seq=await storage.addOperation(record),rows=await storage.listOperations();
 audit.check(hints===1&&rows.length===2&&rows[1].seq===seq,'a hint failure rejected or removed a committed write');
 audit.check(await audit.raw()===audit.before,'write fault changed Main/Shared');return rows;
})()"""

parser = argparse.ArgumentParser()
parser.add_argument('--baseline', action='store_true')
parser.add_argument('--phase', choices=('peer','read-abort','logout','dispose'), action='append')
args = parser.parse_args()
phases=args.phase or (('peer',) if args.baseline else ('peer','read-abort','logout','dispose'))
if args.baseline and any(phase!='peer' for phase in phases):parser.error('--baseline supports only the peer regression')
for phase in phases:
    with BrowserSession(ROOT / 'netunim-orders/site', f'calendar-commit-{phase}',auto_navigate=False) as browser:
        if args.baseline:
            for path in ('composition/calendar.js','domains/calendar/controller.js','calendar/storage.js'):
                prepared=browser.tmp/f'site/assets/js/{path}'
                content=subprocess.check_output(['git','show',f'667f9dfd499746c25c3224bb2107fbe2744399bb:netunim-orders/site/assets/js/{path}'],cwd=ROOT)
                trailer=prepared.read_text(encoding='utf-8').split('\nexport const __testBindings=',1)
                if len(trailer)>1:content+=('\nexport const __testBindings='+trailer[1]).encode('utf-8')
                prepared.write_bytes(content)
        browser._navigate()
        browser.evaluate(SETUP)
        if phase!='peer':browser.evaluate(ARM.replace('__PHASE__',json.dumps(phase)))
        with browser.second_tab():
            produced = browser.evaluate(PRODUCE)
            errors=browser.drain_serious_errors();assert not errors,errors
        if phase!='peer':browser.evaluate(FAULT.replace('__PHASE__',json.dumps(phase)),timeout=30)
        if phase in ('peer','read-abort'):
            result = browser.evaluate(VERIFY.replace('__WAIT__', '' if args.baseline else 'await audit.observation;'), timeout=30)
            assert result['event'] == produced, result
        expected=browser.evaluate(WRITES) if phase=='peer' and not args.baseline else [produced]
        errors=browser.drain_serious_errors();assert not errors,errors
        browser.evaluate("(()=>{calendarCommitAudit.storage.saveConnectionPreference({autoConnect:false,accountId:'calendar@example.test'}); cloudAuth.saveSession(null); return true})()")
        browser._navigate()
        recovered = browser.evaluate("""(async()=>{await appReady;if(!state.notes.some(note=>note.id==='calendar-observation-retained-note'&&note.content==='independent durable note'))throw Error('independent durable note did not survive fresh recovery');const {createCalendarStorage}=await import('./assets/js/calendar/storage.js');return await createCalendarStorage().listOperations()})()""")
        assert recovered == expected, recovered
        errors=browser.drain_serious_errors();assert not errors,errors
        print(f'PASS Calendar {phase}: native two-tab commit/read fence, retained event/seq/body after fresh recovery, no provider retry or Main/Shared changes', flush=True)
