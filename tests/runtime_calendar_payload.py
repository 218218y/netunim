"""Real Calendar API/journal/cache on native IDB with malformed Google replies.

No live account/provider is contacted. --baseline replaces only the API in the
disposable site, retaining the exact same assertions and native stores.
"""
import argparse
import json
import subprocess
from browser_harness import BrowserSession, ROOT

FLOW = r"""(async()=>{
 await appReady;syncDocument.stopPolling();finance.runtime.stop();
 const check=(ok,message)=>{if(!ok)throw Error(message)},phase=__PHASE__;
 const {createCalendarStorage}=await import('./assets/js/calendar/storage.js'),storage=createCalendarStorage();
 const {createStorageJournalDb}=await import('./assets/js/shared/storage-journal-idb.js'),db=createStorageJournalDb();
 const raw=async()=>JSON.stringify({main:await db.load('local:orders'),checks:await db.load('local:shared-checks')});
 const note={id:'calendar-payload-note',content:'unrelated durable note'};state.notes.push(note);
 storagePersistence.scheduleSave('Calendar payload fixture',{domains:['notes'],operations:[{type:'put',collection:'notes',id:note.id,mode:'insert',index:state.notes.length-1,record:note}]});await mainStorageV2.commitPromise;
 const before=await raw(),calendarId='calendar@example.test',eventId='abcd0123abcd0123abcd0123abcd0123';
 const event={id:eventId,summary:'exact accepted content',description:'kept',location:'',start:{date:'2026-10-15'},end:{date:'2026-10-16'}};
 const remote=new Map();if(phase.startsWith('patch')||phase.startsWith('delete'))remote.set(eventId,{...event,summary:'before edit'});
 let invalid=false,effects=0;
 cloudAuth.supaFetch=async(_path,options)=>{options.assertRequestScope();return new Response(JSON.stringify({access_token:'fixture-Google',expires_in:3600,account_id:calendarId}))};
 const reply=value=>new Response(JSON.stringify(value));
 globalThis.fetch=async(url,options={})=>{
  const path=new URL(url).pathname;
  if(path.endsWith('/calendarList'))return reply(invalid&&phase==='calendar-page'?{items:{}}:{items:[{id:calendarId,primary:true,summary:'fixture',accessRole:'owner'}]});
  if(['POST','PATCH','DELETE'].includes(options.method)){
   effects++;
   if(options.method==='DELETE')remote.delete(eventId);else remote.set(eventId,{...(remote.get(eventId)||{}),...JSON.parse(options.body)});
   if(invalid){
    if(phase.endsWith('json'))return new Response('<html>not JSON');
    if(phase.endsWith('identity'))return reply({...event,id:'some-other-event'});
    return reply({});
   }
   return options.method==='DELETE'?new Response(null,{status:204}):reply(remote.get(eventId));
  }
  if(path.endsWith('/events'))return reply(invalid&&phase==='event-page'?{items:[{...event,locked:'false'}]}:{items:[...remote.values()]});
  if(path.endsWith('/'+eventId)){check(remote.has(eventId),'GET for absent event');return reply(remote.get(eventId))}
  throw Error('unexpected fixture request '+path);
 };
 cloudAuth.saveSession({user:{id:'calendar-payload-owner'},access_token:'fixture',expires_at:9999999999});
 check(await domainsCalendarController.resumeAfterCloudLogin()===true,'initial valid sync failed');
 const snapshots=async()=>{const native=await storage.openDb(),tx=native.transaction('range-cache','readonly');return await new Promise((resolve,reject)=>{const r=tx.objectStore('range-cache').getAll();r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error)})};
 const cacheBefore=JSON.stringify(await snapshots());
 const writing=!phase.endsWith('page'),type=phase.split('-')[0];
 if(writing)await storage.addOperation({type,calendarId,eventId,...(type==='delete'?{}:{body:event})});
 const queued=await storage.listOperations();invalid=true;calendarSession.lastSyncAt=null;
 check(await domainsCalendarController.syncNow({quiet:true})===false,'malformed success falsely completed Calendar sync');
 check(!calendarSession.lastSyncAt,'malformed success published completed sync time');
 check(JSON.stringify(await snapshots())===cacheBefore,'malformed success overwrote verified cache');
 const retained=await storage.listOperations();
 if(writing){check(retained.length===1,'malformed success acknowledged durable operation');check(retained[0].seq===queued[0].seq&&retained[0].eventId===eventId&&JSON.stringify(retained[0].body)===JSON.stringify(queued[0].body),'queued identity/content changed');check(effects===1,'provider effect retried unexpectedly')}
 check(await raw()===before,'Calendar changed Main/Shared stores');
 // Keep the failed queue/cache through a fresh document before authorized replay.
 localStorage.setItem('fixture.calendar.payload',JSON.stringify({phase,event,remote:[...remote],before,queued:retained,effects}));
 cloudAuth.saveSession(null);
 return {phase,queued:retained.length,effects,cacheRetained:true,mainSharedRetained:true};
})()"""

RECOVER = r"""(async()=>{
 await appReady;syncDocument.stopPolling();finance.runtime.stop();
 const check=(ok,message)=>{if(!ok)throw Error(message)},saved=JSON.parse(localStorage.getItem('fixture.calendar.payload'));
 const {createCalendarStorage}=await import('./assets/js/calendar/storage.js'),storage=createCalendarStorage();
 const {createStorageJournalDb}=await import('./assets/js/shared/storage-journal-idb.js'),db=createStorageJournalDb();
 const raw=async()=>JSON.stringify({main:await db.load('local:orders'),checks:await db.load('local:shared-checks')}),before=await raw();
 const queued=await storage.listOperations();check(queued.length===saved.queued.length,'fresh document lost pending operation');
 if(queued.length)check(queued[0].eventId===saved.event.id&&JSON.stringify(queued[0].body)===JSON.stringify(saved.queued[0].body),'restart changed accepted content');
 const remote=new Map(saved.remote);let effects=saved.effects,gets=0;
 cloudAuth.supaFetch=async(_path,options)=>{options.assertRequestScope();return new Response(JSON.stringify({access_token:'fixture-Google',expires_in:3600,account_id:'calendar@example.test'}))};
 const reply=value=>new Response(JSON.stringify(value));
 globalThis.fetch=async(url,options={})=>{
  const path=new URL(url).pathname;
  if(path.endsWith('/calendarList'))return reply({items:[{id:'calendar@example.test',primary:true,accessRole:'owner'}]});
  if(options.method==='POST')return new Response(JSON.stringify({error:{message:'already exists'}}),{status:409});
  if(options.method==='PATCH'){remote.set(saved.event.id,{...remote.get(saved.event.id),...JSON.parse(options.body)});effects++;return reply(remote.get(saved.event.id))}
  if(options.method==='DELETE')return new Response(null,{status:404});
  if(path.endsWith('/events'))return reply({items:[...remote.values()]});
  if(path.endsWith('/'+saved.event.id)){gets++;return reply(remote.get(saved.event.id))}
  throw Error('unexpected recovery request '+path);
 };
 cloudAuth.saveSession({user:{id:'calendar-payload-owner'},access_token:'fixture',expires_at:9999999999});
 check(await domainsCalendarController.resumeAfterCloudLogin()===true,'valid recovery failed');
 check((await storage.listOperations()).length===0,'verified recovery did not ACK queue');
 if(saved.phase.startsWith('insert'))check(effects===1&&gets===1,'lost response duplicated insert or skipped identity confirmation');
 if(saved.phase.startsWith('delete'))check(effects===1,'already deleted event repeated effect');
 check(await raw()===before,'recovery changed Main/Shared stores');
 check((await mainStorageV2.recoverReadOnly()).state.notes.find(row=>row.id==='calendar-payload-note')?.content==='unrelated durable note','restart lost unrelated note');
 return {verifiedRecovery:true,exactIdentity:true,effects,gets};
})()"""

parser=argparse.ArgumentParser()
parser.add_argument('--baseline',action='store_true')
parser.add_argument('--phase',action='append',choices=('calendar-page','event-page','insert-json','insert-empty','insert-identity','patch-identity','delete-empty'))
args=parser.parse_args()
phases=args.phase or (('insert-empty',) if args.baseline else ('calendar-page','event-page','insert-json','insert-empty','insert-identity','patch-identity','delete-empty'))
for phase in phases:
 with BrowserSession(ROOT/'netunim-orders/site','calendar-payload-'+phase,auto_navigate=False) as browser:
  if args.baseline:
   prepared=browser.tmp/'site/assets/js/calendar/api.js'
   old=subprocess.check_output(['git','show','cb53a17504020a26dc7ea8af27b03a5849d78ce4:netunim-orders/site/assets/js/calendar/api.js'],cwd=ROOT)
   trailer=prepared.read_text(encoding='utf-8').split('\nexport const __testBindings=',1)[1]
   prepared.write_bytes(old+('\nexport const __testBindings='+trailer).encode('utf-8'))
  browser._navigate()
  failed=browser.evaluate(FLOW.replace('__PHASE__',json.dumps(phase)),timeout=35)
  browser._navigate()
  recovered=browser.evaluate(RECOVER,timeout=35)
  errors=browser.drain_serious_errors();assert not errors,errors
  print('PASS Calendar payload '+phase+': '+json.dumps({'failed':failed,'recovered':recovered}),flush=True)
