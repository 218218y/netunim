"""Calendar account display boundaries; real UI/auth/tabs/IDB, synthetic Google."""
import argparse
import json
import subprocess
from browser_harness import BrowserSession, ROOT

SETUP = r"""(async()=>{
 await appReady;syncDocument.stopPolling();domainsFinanceController.stopAutoSync();
 const check=(ok,message)=>{if(!ok)throw Error(message)},owner='calendar-display-A',other='calendar-display-B',calendarId='calendar@example.test';
 const login=id=>cloudAuth.saveSession(id?{user:{id},access_token:'synthetic-'+id,expires_at:9999999999}:null);
 const frame=()=>new Promise(resolve=>requestAnimationFrame(resolve)),wait=async(predicate,message)=>{const end=performance.now()+4000;while(!predicate()){if(performance.now()>end)throw Error(message);await frame()}};
 const today=new Date(),date=today.toLocaleDateString('sv-SE'),end=new Date(today);end.setDate(end.getDate()+1);
 const calendars=[{id:calendarId,primary:true,summary:'private calendar A',accessRole:'owner'}];
 const event={id:'abcd0123abcd0123abcd0123abcd0123',summary:'private Calendar event A',description:'private Calendar description A',start:{date},end:{date:end.toLocaleDateString('sv-SE')}};
 let calls=0;const remote=new Map([[event.id,event]]);
 cloudAuth.supaFetch=async(_path,options)=>{options.assertRequestScope?.();calls++;return new Response(JSON.stringify({access_token:'synthetic-Google',expires_in:3600,account_id:calendarId}))};
 const originalFetch=globalThis.fetch;globalThis.fetch=async(url,options={})=>{calls++;if(options.method==='POST'){const body=JSON.parse(options.body);check(!remote.has(body.id),'duplicate synthetic Google effect');remote.set(body.id,body);return new Response(JSON.stringify(body))}return new Response(JSON.stringify(new URL(url).pathname.endsWith('/calendarList')?{items:calendars}:{items:[...remote.values()]}))};
 login(owner);check(await domainsCalendarController.resumeAfterCloudLogin()===true,'authorized Calendar fixture did not settle');
 Object.defineProperty(navigator,'onLine',{value:false,configurable:true});
 const {createCalendarStorage}=await import('./assets/js/calendar/storage.js'),storage=createCalendarStorage();
 await storage.addOperation({type:'insert',calendarId,eventId:'beef0123beef0123beef0123beef0123',body:{...event,id:'beef0123beef0123beef0123beef0123',summary:'private durable pending A'}});
 ui.currentView='calendar';await domainsCalendarController.renderCalendar();
 check(document.getElementById('calendarBody').textContent.includes(event.summary),'private Calendar fixture not displayed');
 const surface=__SURFACE__,key=encodeURIComponent(calendarId)+'::'+event.id;
 if(surface==='editor'||surface==='confirmation')domainsCalendarController.openCalendarEvent(key);
 if(surface==='quick')domainsCalendarController.calendarDayCreate(date,{detail:1});
 if(surface==='quick')await wait(()=>document.getElementById('calendarQuickSummary'),'quick editor did not open');
 if(surface==='confirmation'){void domainsCalendarController.deleteCalendarEvent(key);await wait(()=>document.getElementById('confirmBackdrop').classList.contains('open'),'delete confirmation did not open')}
 const {createStorageJournalDb}=await import('./assets/js/shared/storage-journal-idb.js'),db=createStorageJournalDb();
 const raw=async()=>{const native=await storage.openDb(),tx=native.transaction(['range-cache','meta'],'readonly'),read=name=>new Promise((resolve,reject)=>{const r=tx.objectStore(name).getAll();r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error)}),[cache,meta]=await Promise.all([read('range-cache'),read('meta')]);return JSON.stringify({cache,meta,queue:await storage.listOperations(),main:await db.load('local:orders'),shared:await db.load('local:shared-checks')})};
 globalThis.calendarPrivacy={owner,other,login,wait,check,raw,before:await raw(),calls:()=>calls,originalFetch,storage};
 return true;
})()"""

VERIFY = r"""(async()=>{
 const f=calendarPrivacy;
 await f.wait(()=>!document.getElementById('calendarBody')?.textContent.includes('private Calendar')&&!document.querySelector('.calendar-event-form,.calendar-quick-form,.calendar-readonly-details'),'former-account Calendar display retained');
 f.check(!document.getElementById('confirmBackdrop').classList.contains('open'),'former-account Calendar confirmation retained');
 f.check(!document.getElementById('confirmMessage').textContent.includes('private Calendar'),'private Calendar confirmation text retained');
 f.check(calendarUi.events.length===0&&calendarUi.pending.length===0&&calendarUi.eventMap.size===0,'Calendar model retained old account');
 f.check(!calendarSession.accessToken&&!calendarSession.connected,'former Google token retained');
 const count=f.calls();await domainsCalendarController.renderCalendar();domainsCalendarController.newEvent();
 f.check(!document.getElementById('calendarBody').textContent.includes('private'),'unauthorized cache republished');
 f.check(!document.querySelector('.calendar-event-form')&&f.calls()===count,'unauthorized local editor/network action');
 f.check(await f.raw()===f.before,'visual invalidation changed durable queue/cache/Main/Shared');
 // Same authenticated owner can reopen its attributed cache offline without OAuth.
 f.login(f.owner);await domainsCalendarController.renderCalendar();
 f.check(document.getElementById('calendarBody').textContent.includes('private durable pending A'),'same-owner offline queue/cache not recoverable');
 uiModal.modal('Other capability','<p id="unrelated-calendar-modal">unrelated</p>');f.login(null);
 f.check(document.getElementById('unrelated-calendar-modal'),'Calendar invalidation replaced another capability modal');
 f.check(await f.raw()===f.before,'reopening cache changed retained data');
 f.login(f.owner);await domainsCalendarController.renderCalendar();const root=document.getElementById('calendarBody');
 const {createOrdersCalendarRuntime}=await import('./assets/js/composition/calendar.js');
 const add=EventTarget.prototype.addEventListener,remove=EventTarget.prototype.removeEventListener,live=new Set(),subscriptions=new Set(),intervals=new Set(),set=globalThis.setInterval,clear=globalThis.clearInterval;
 EventTarget.prototype.addEventListener=function(type,fn,options){if(this===window||this===document)live.add(fn);return add.call(this,type,fn,options)};
 EventTarget.prototype.removeEventListener=function(type,fn,options){if(this===window||this===document)live.delete(fn);return remove.call(this,type,fn,options)};
 globalThis.setInterval=(...args)=>{const id=set(...args);intervals.add(id);return id};globalThis.clearInterval=id=>{intervals.delete(id);clear(id)};
 const subscribeAccountScope=fn=>{const stop=cloudAuth.subscribeAccountScope(fn);subscriptions.add(fn);return ()=>{subscriptions.delete(fn);stop()}};
 try{for(let i=0;i<100;i++){
  const runtime=createOrdersCalendarRuntime({calendarSession:{},accountScope:()=>cloudAuth.getAccountScope(),subscribeAccountScope,supaFetch:()=>{throw Error('disposed runtime performed network work')}});
  const controller=runtime.createController({ui:{currentView:'dashboard'},tab:{primaryTab:true},calendarUi:{},uiLayout:{},uiModal,uiStatus,uiCloud,uiDateEditor});
  f.check(controller.start()===true&&controller.start()===false,'Calendar started duplicate poll/listeners');
  f.check(runtime.dispose()===true&&runtime.dispose()===false&&controller.start()===false,'Calendar disposal not final/idempotent');
  await Promise.resolve();await Promise.resolve();
  f.check(!live.size&&!subscriptions.size&&!intervals.size,'Calendar disposed owner retained listeners/pollers');
  f.check(document.getElementById('calendarBody')===root&&root.textContent.includes('private Calendar'),'unmounted Calendar owner cleared another owner display');
 }}finally{EventTarget.prototype.addEventListener=add;EventTarget.prototype.removeEventListener=remove;globalThis.setInterval=set;globalThis.clearInterval=clear}
 f.check(await f.raw()===f.before,'resource cycles changed durable stores');
 globalThis.fetch=f.originalFetch;
 return {cleared:true,pendingRetained:true,offlineReopen:true,unrelatedModalRetained:true,resourceCycles:100};
})()"""

RACE = r"""(async()=>{
 const f=calendarPrivacy,phase=__RACE__,descriptor=Object.getOwnPropertyDescriptor(IDBTransaction.prototype,'oncomplete');
 let entered,release,armed=true;const waiting=new Promise(resolve=>{entered=resolve}),held=new Promise(resolve=>{release=resolve});
 const toasts=[],toast=uiStatus.toast;uiStatus.toast=(message,...args)=>{toasts.push(message);return toast(message,...args)};
 if(phase==='append'){
  domainsCalendarController.newEvent();document.getElementById('calendarSummary').value='retained append during logout';
 }else{calendarUi.cacheRangeStart='';calendarUi.cacheRangeEnd=''}
 Object.defineProperty(IDBTransaction.prototype,'oncomplete',{...descriptor,set(handler){
  const tx=this,match=armed&&tx.objectStoreNames.contains('pending-operations')&&(phase==='append'?tx.mode==='readwrite':tx.mode==='readonly'&&tx.objectStoreNames.contains('range-cache'));
  if(match)armed=false;
  descriptor.set.call(tx,function(event){if(match){entered();void held.then(()=>handler.call(tx,event))}else handler.call(tx,event)});
 }});
 try{
  const result=phase==='append'?domainsCalendarController.saveCalendarEvent():domainsCalendarController.renderCalendar();
  await waiting;
  const committed=await f.storage.listOperations();
  if(phase==='append')f.check(committed.some(row=>row.body?.summary==='retained append during logout'),'native append did not finish before interruption');
  f.login(f.other);uiModal.modal('New capability','<p id="calendar-race-unrelated">new account modal</p>');release();await result;
  f.check(document.getElementById('calendar-race-unrelated'),'late local completion closed another capability');
  f.check(!document.getElementById('calendarBody').textContent.includes('private'),'late cache/append publication used former authority');
  f.check(JSON.stringify(await f.storage.listOperations())===JSON.stringify(committed),'logout dropped committed Calendar identity/content');
  f.check(!toasts.some(text=>String(text).includes('נשמר')),'late completion presented former-account success');
  return {phase,preserved:true,noLatePublication:true};
 }finally{Object.defineProperty(IDBTransaction.prototype,'oncomplete',descriptor);uiStatus.toast=toast;globalThis.fetch=f.originalFetch}
})()"""

LEGACY = r"""(async()=>{
 const f=calendarPrivacy,native=await f.storage.openDb(),tx=native.transaction('range-cache','readonly');
 const snapshots=await new Promise((resolve,reject)=>{const r=tx.objectStore('range-cache').getAll();r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error)});
 for(const snapshot of snapshots){delete snapshot.owner;await f.storage.putRangeCache(snapshot)}
 const pending=JSON.stringify(await f.storage.listOperations());f.login(null);f.login(f.owner);const before=await f.raw();
 await domainsCalendarController.renderCalendar();
 f.check(!document.getElementById('calendarBody').textContent.includes('private'),'legacy cache inferred an application owner');
 f.check(await f.raw()===before,'locking legacy display changed queue/cache/journal');
 Object.defineProperty(navigator,'onLine',{value:true,configurable:true});
 f.check(await domainsCalendarController.resumeAfterCloudLogin()===true,'authorized legacy recovery did not confirm delivery');
 const rows=JSON.parse(pending),snapshot=await f.storage.getRangeCacheCovering(calendarUi.cacheRangeStart,calendarUi.cacheRangeEnd,'calendar@example.test');
 f.check(snapshot.owner===f.owner,'verified remote read did not attribute offline cache');
 for(const row of rows)f.check(snapshot.events.some(event=>event.id===row.eventId&&event.summary===row.body.summary),'legacy recovery changed pending ID/content');
 f.check((await f.storage.listOperations()).length===0,'confirmed legacy delivery did not acknowledge existing event');
 Object.defineProperty(navigator,'onLine',{value:false,configurable:true});f.login(null);f.login(f.owner);await domainsCalendarController.renderCalendar();
 f.check(document.getElementById('calendarBody').textContent.includes('private durable pending A'),'attributed offline cache did not reopen');
 globalThis.fetch=f.originalFetch;
 return {legacyRetained:true,verifiedAttribution:true,exactIDs:true,offlineReopen:true};
})()"""

ABORT = r"""(async()=>{
 const f=calendarPrivacy,get=IDBObjectStore.prototype.getAll;let aborted=false;
 calendarUi.cacheRangeStart='';calendarUi.cacheRangeEnd='';
 IDBObjectStore.prototype.getAll=function(...args){const request=get.apply(this,args),tx=this.transaction;if(!aborted&&this.name==='range-cache'&&tx.objectStoreNames.contains('pending-operations')){aborted=true;queueMicrotask(()=>tx.abort())}return request};
 try{
  await domainsCalendarController.renderCalendar();await Promise.resolve();
  f.check(aborted&&calendarSession.lastError==='טעינת המטמון המקומי נכשלה','native display abort did not report failure');
  f.check(await f.raw()===f.before,'aborted display read changed retained stores');
  return {abortReported:true,retained:true};
 }finally{IDBObjectStore.prototype.getAll=get;globalThis.fetch=f.originalFetch}
})()"""

parser=argparse.ArgumentParser()
parser.add_argument('--surface',choices=('board','editor','quick','confirmation'),action='append')
parser.add_argument('--phase',choices=('local','cross-tab','account'),action='append')
parser.add_argument('--race',choices=('display','append','legacy','read-abort'),action='append')
parser.add_argument('--baseline',action='store_true')
args=parser.parse_args()
for surface in (() if args.race else args.surface or ('board','editor','quick','confirmation')):
    for phase in args.phase or ('local','cross-tab','account'):
        with BrowserSession(ROOT/'netunim-orders/site',f'calendar-privacy-{surface}-{phase}',auto_navigate=False) as browser:
            if args.baseline:
                for path in ('composition/calendar.js','domains/calendar/controller.js','calendar/auth.js','calendar/storage.js'):
                    prepared=browser.tmp/f'site/assets/js/{path}'
                    content=subprocess.check_output(['git','show',f'b4e200ae3c373a2eeb23cba49b5bd34c1577d863:netunim-orders/site/assets/js/{path}'],cwd=ROOT)
                    trailer=prepared.read_text(encoding='utf-8').split('\nexport const __testBindings=',1)
                    if len(trailer)>1:
                        content+=('\nexport const __testBindings='+trailer[1]).encode('utf-8')
                    prepared.write_bytes(content)
            browser._navigate()
            browser.evaluate(SETUP.replace('__SURFACE__',json.dumps(surface)),timeout=30)
            if phase=='local':
                browser.evaluate('calendarPrivacy.login(null); true')
            elif phase=='account':
                browser.evaluate('calendarPrivacy.login(calendarPrivacy.other); true')
            else:
                with browser.second_tab():
                    browser.evaluate("localStorage.removeItem('orders.supabase.session.v1'); true")
            result=browser.evaluate(VERIFY,timeout=15)
            assert result and all(result.values()),result
            assert not browser.drain_serious_errors()
            print(f'PASS Calendar {surface}/{phase} privacy: {json.dumps(result)}',flush=True)
if args.race or not(args.surface or args.phase):
    for phase in args.race or ('display','append','legacy','read-abort'):
        with BrowserSession(ROOT/'netunim-orders/site',f'calendar-privacy-race-{phase}') as browser:
            browser.evaluate(SETUP.replace('__SURFACE__',json.dumps('board')),timeout=30)
            flow=LEGACY if phase=='legacy' else ABORT if phase=='read-abort' else RACE.replace('__RACE__',json.dumps(phase))
            result=browser.evaluate(flow,timeout=15)
            assert all(result.values()),result
            assert not browser.drain_serious_errors()
            print(f'PASS Calendar native {phase} boundary: {json.dumps(result)}',flush=True)
