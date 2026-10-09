"""Calendar login fencing and lost-response recovery on native IndexedDB.

Production composition/auth/API/journal/controller run in disposable profiles.
OAuth and Google endpoints are controlled, with a persisted synthetic server
effect across reload; no production credentials, Supabase data, or Google calls.
"""
import json
from browser_harness import BrowserSession, ROOT

SETUP = r"""
 const check=(ok,message)=>{if(!ok)throw Error(message)};
 await appReady;syncDocument.stopPolling();domainsFinanceController.stopAutoSync();
 const originalFetch=globalThis.fetch,owner='fixture-calendar-owner',calendarId='calendar@example.test';
 const authenticate=user=>cloudAuth.saveSession(user?{user:{id:user},access_token:'fixture-'+user,expires_at:9999999999}:null);
 const {createCalendarStorage}=await import('./assets/js/calendar/storage.js');const storage=createCalendarStorage();
 const {createStorageJournalDb}=await import('./assets/js/shared/storage-journal-idb.js');const db=createStorageJournalDb();
 const raw=async()=>JSON.stringify({main:await db.load('local:orders'),checks:await db.load('local:shared-checks')});
 const id='abcd0123abcd0123abcd0123abcd0123',noteId='calendar-retained-note';
 const event={id,summary:'retained Calendar event',description:'exact content',location:'',start:{date:'2026-10-09'},end:{date:'2026-10-10'}};
"""

BEFORE = r"""(async()=>{
__SETUP__
 const mode=__MODE__,change=__CHANGE__;
 const note={id:noteId,content:'durable independent Main note'};state.notes.push(note);
 storagePersistence.scheduleSave('Calendar ownership fixture',{domains:['notes'],operations:[{type:'put',collection:'notes',id:note.id,mode:'insert',index:state.notes.length-1,record:note}]});
 await mainStorageV2.commitPromise;
 await storage.putMeta('accountId',calendarId);
 await storage.addOperation({type:'insert',calendarId,eventId:id,body:event});
 const before=await raw(),queuedBefore=await storage.listOperations(),seq=queuedBefore[0].seq;
 const remote=new Map();let effects=0,tokenRequests=0;
 let release,signal;const held=new Promise(resolve=>{release=resolve}),entered=new Promise(resolve=>{signal=resolve});
 cloudAuth.supaFetch=async(path,options)=>{
   check(String(path).endsWith('/google-calendar-oauth'),'unexpected OAuth endpoint');options.assertRequestScope?.();
   const body=JSON.parse(options.body);check(body.action==='token','unexpected OAuth action');tokenRequests++;
   const result={access_token:'fixture-Google-token',expires_in:3600,account_id:calendarId};
   if(mode==='token-headers'){signal();await held;return new Response(JSON.stringify(result))}
   if(mode==='token-body')return {ok:true,status:200,json:async()=>{signal();await held;return result}};
   return new Response(JSON.stringify(result));
 };
 globalThis.fetch=async(url,options={})=>{
   const path=new URL(url).pathname;
   if(path==='/calendar/v3/users/me/calendarList')return new Response(JSON.stringify({items:[{id:calendarId,primary:true,summary:'fixture',accessRole:'owner'}]}));
   if(path.endsWith('/events')&&options.method==='POST'){
     const body=JSON.parse(options.body);check(body.id===id,'immutable event ID changed');remote.set(id,body);effects++;
     return {ok:true,status:200,text:async()=>{signal();await held;return JSON.stringify(body)}};
   }
   if(path.endsWith('/events'))return new Response(JSON.stringify({items:[...remote.values()]}));
   throw Error('unexpected Google request '+path);
 };
 authenticate(owner);
 const outcome=domainsCalendarController.resumeAfterCloudLogin().then(value=>({value}),error=>({code:error.code}));
 await entered;
 if(change==='logout')authenticate(null);else if(change==='account')authenticate('fixture-calendar-other');else{authenticate(null);authenticate(owner)}
 release();const result=await outcome;
 check(result.value!==true,'former login falsely confirmed complete sync');
 check(!calendarSession.accessToken&&!calendarSession.connected,'former credential survived revocation');
 check(!calendarSession.lastSyncAt,'former result published a successful sync');
 const queued=await storage.listOperations();check(queued.length===1&&queued[0].seq===seq,'unconfirmed event was removed/replaced');
 check(JSON.stringify(queued[0].body)===JSON.stringify(event)&&queued[0].eventId===id,'unconfirmed event content/ID changed');
 check(await raw()===before,'Calendar authorization touched Main/Shared journal');
 check(state.notes.find(row=>row.id===noteId)?.content===note.content,'independent Main note changed');
 check(tokenRequests===1&&effects===(mode==='event-body'?1:0),'unexpected server effect/token retry');
 globalThis.fetch=originalFetch;authenticate(null);
 return {revoked:true,pendingRetained:true,mainSharedRetained:true,effects,remote:[...remote.values()],seq};
})()"""

RECOVER = r"""(async()=>{
__SETUP__
 const remote=new Map(__REMOTE__.map(row=>[row.id,row]));let effects=__EFFECTS__,attempts=0,verified=0;
 const queue=await storage.listOperations();check(queue.length===1&&queue[0].seq===__SEQ__&&queue[0].eventId===id,'pending identity lost on fresh runtime');
 check(JSON.stringify(queue[0].body)===JSON.stringify(event),'pending content lost on restart');
 const note=(await mainStorageV2.recoverReadOnly()).state.notes.find(row=>row.id===noteId);
 check(note?.content==='durable independent Main note','Main recovery lost note');const before=await raw();
 cloudAuth.supaFetch=async(path,options)=>{options.assertRequestScope?.();check(JSON.parse(options.body).action==='token','unexpected OAuth action');return new Response(JSON.stringify({access_token:'recovered-token',expires_in:3600,account_id:calendarId}))};
 globalThis.fetch=async(url,options={})=>{
   const path=new URL(url).pathname;
   if(path==='/calendar/v3/users/me/calendarList')return new Response(JSON.stringify({items:[{id:calendarId,primary:true,summary:'fixture',accessRole:'owner'}]}));
   if(path.endsWith('/events')&&options.method==='POST'){
     const body=JSON.parse(options.body);attempts++;check(body.id===id,'replay used a different event ID');
     if(remote.has(id))return new Response(JSON.stringify({error:{message:'exists'}}),{status:409});
     remote.set(id,body);effects++;return new Response(JSON.stringify(body));
   }
   if(path.endsWith('/events/'+id)){verified++;return new Response(JSON.stringify(remote.get(id)))}
   if(path.endsWith('/events'))return new Response(JSON.stringify({items:[...remote.values()]}));
   throw Error('unexpected recovery request '+path);
 };
 authenticate(owner);check(await domainsCalendarController.resumeAfterCloudLogin()===true,'authorized recovery did not confirm sync');
 check((await storage.listOperations()).length===0,'confirmed event still pending');
 check(effects===1&&attempts===1&&verified===(__EFFECTS__?1:0),'replay duplicated effect or skipped content verification');
 check(await raw()===before,'Calendar recovery changed Main/Shared journal');
 check(calendarSession.lastSyncAt&&calendarSession.connected,'successful recovery not published');
 globalThis.fetch=originalFetch;authenticate(null);
 return {pendingSurvivedRestart:true,exactIdentity:true,noDuplicateEffect:true,confirmed:true,mainSharedRetained:true};
})()"""

for mode, change in (('token-headers', 'account'), ('token-body', 'logout'), ('event-body', 'logout'), ('event-body', 'relogin')):
    with BrowserSession(ROOT / 'netunim-orders/site', 'calendar-ownership-' + mode + '-' + change) as browser:
        before = browser.evaluate(BEFORE.replace('__SETUP__', SETUP).replace('__MODE__', json.dumps(mode)).replace('__CHANGE__', json.dumps(change)), timeout=30)
        browser._navigate()
        recovery = RECOVER.replace('__SETUP__', SETUP).replace('__REMOTE__', json.dumps(before['remote'])).replace('__EFFECTS__', str(before['effects'])).replace('__SEQ__', str(before['seq']))
        restored = browser.evaluate(recovery, timeout=30)
        assert restored and all(restored.values()), restored
        browser._navigate()
        cached = browser.evaluate(r"""(async()=>{await appReady;const {createCalendarStorage}=await import('./assets/js/calendar/storage.js');const storage=createCalendarStorage();const queue=await storage.listOperations();const db=await storage.openDb();const tx=db.transaction('range-cache','readonly');const snapshots=await new Promise((resolve,reject)=>{const r=tx.objectStore('range-cache').getAll();r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error)});return {empty:queue.length===0,event:snapshots.flatMap(row=>row.events||[]).some(row=>row.id==='abcd0123abcd0123abcd0123abcd0123'&&row.summary==='retained Calendar event')}})()""")
        assert cached['empty'] and cached['event'], cached
        errors = browser.drain_serious_errors()
        assert not errors, errors
        print('PASS Calendar ownership ' + mode + '/' + change + ': ' + json.dumps(restored))
