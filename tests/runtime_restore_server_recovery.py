"""Server-only restore: fresh writers, native IDB and failure after remote commit."""
import json
from browser_harness import BrowserSession, ROOT

FLOW = r"""(async()=>{
 const app=__APP__,check=(ok,label)=>{if(!ok)throw Error(label)};
 const {createStorageJournalDb}=await import('./assets/js/shared/storage-journal-idb.js');
 const {createStorageJournal}=await import('./assets/js/shared/storage-journal.js');
 const {createStorageV2Boundary}=await import('./assets/js/shared/storage-v2-boundary.js');
 const {createRestoreGroupStore}=await import('./assets/js/shared/restore-groups.js');
 const {resumeServerRestoreGroups}=await import('./assets/js/shared/restore-server-recovery.js');
 const {applyStorageV2RestoreGroup,captureStorageV2RestoreSource}=await import('./assets/js/shared/storage-v2-restore.js');
 const native=await new Promise((resolve,reject)=>{const request=indexedDB.open('restore-pending-'+app,1);
   request.onupgradeneeded=()=>request.result.createObjectStore('pending');request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error)});
 const kv=(mode,work)=>new Promise((resolve,reject)=>{const tx=native.transaction('pending',mode);let value;
   const request=work(tx.objectStore('pending'));if(request)request.onsuccess=()=>{value=request.result};
   tx.oncomplete=()=>resolve(value);tx.onabort=()=>reject(tx.error)});
 const makeStore=()=>createRestoreGroupStore({localKey:'server-only-'+app,storage:{getItem:()=>null,setItem:()=>{},removeItem:()=>{}},
   put:(key,value)=>kv('readwrite',store=>store.put(value,key)),get:key=>kv('readonly',store=>store.get(key)),remove:key=>kv('readwrite',store=>store.delete(key))});
 const db=createStorageJournalDb({name:'restore-journals-'+app}),owner='restore-fixture',id='aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa',at='2026-10-16T10:00:00Z';
 const emergency={read:()=>[],write:()=>{},remove:()=>{}};
 const create=()=>({main:createStorageJournal({owner:owner+':'+app,schema:{collections:['notes']},validate:()=>{},db,emergency}),shared:createStorageJournal({owner:owner+':shared-checks',schema:{collections:['checks'],fields:['bankEvents']},validate:()=>{},db,emergency})});
 let client=create();await client.main.initializeCloudHead(8,{notes:[]});await client.shared.initializeCloudHead(11,{checks:[],bankEvents:[]});
 const group={restore_group_id:id,app_site:app,phase:'staged',created_at:at,updated_at:at};
 const receipt={restore_group_id:id,phase:'completed',main_revision:9,checks_revision:12};
 const heads={main:{document_name:'main',revision:9,updated_at:at,state:{notes:[{id:'RESTORED',content:'authoritative'}]}},
   shared:{document_name:'main',revision:12,updated_at:at,state:{checks:[{id:'CHECK',amount:100}],bankEvents:[]}}};
 let committed=false,failRead=true,adopted=false,requests=0;
 const run=async()=>{
   const shared={...client.shared,resetCloudHead:(revision,state,{boundaryId}={})=>client.shared.resetCloudHead(revision,state,state,{appMetadata:{boundaryId}})};
   const boundary=createStorageV2Boundary({owner:()=>owner,primary:()=>true,main:client.main,shared,db});
   const store=makeStore();check(await store.loadPending()===null,'unexpected local restore payload');
   return resumeServerRestoreGroups({appSite:app,owner,store,assertCurrent:()=>{},
     listRemote:async()=>committed?[]:[group],applyRemote:async requested=>{check(requested===id,'wrong restore');committed=true;requests++;return receipt},
     readSource:async()=>captureStorageV2RestoreSource(await client.main.cloudState(),await client.shared.cloudState()),
     readHeads:async()=>{if(failRead)throw Error('controlled read failure after server commit');return heads},
     applyLocally:async(plan,result)=>{await applyStorageV2RestoreGroup({boundary,group:plan,result,target:plan.main.state,sharedState:plan.checks.state});adopted=true},
   });
 };
 let rejected=false;try{await run()}catch(error){rejected=error.message==='controlled read failure after server commit'}
 check(rejected&&committed&&!adopted,'unknown result was accepted');check((await makeStore().loadServerPending(owner))?.restore_group_id===id,'pending identity lost');
 client=create();await client.main.open();await client.shared.open();failRead=false;
 check(await run()===true&&adopted,'fresh client did not adopt completed restore');
 const main=await client.main.recover(),shared=await client.shared.recover(),mainCloud=await client.main.cloudState(),sharedCloud=await client.shared.cloudState();
 check(main.state.notes[0].content==='authoritative'&&shared.state.checks[0].amount===100,'paired state missing');
 check(mainCloud.base.revision===9&&sharedCloud.base.revision===12&&!mainCloud.pending&&!sharedCloud.pending,'restored heads missing');
 check(await makeStore().loadServerPending(owner)===null&&requests===2,'recovery did not finish exactly');
 native.close();return {serverOnly:true,freshClient:true,durableRetry:true,pairedAdoption:true};
})()"""

for app in ('orders', 'kupa'):
    with BrowserSession(ROOT / f'netunim-{app}/site', app+'-restore-server-recovery', instrument=False) as browser:
        result = browser.evaluate(FLOW.replace('__APP__', json.dumps(app)), timeout=40)
        assert result and all(result.values()), result
        assert not browser.drain_serious_errors()
        print(f'PASS {app} server-only restore: fresh client, native pending identity and paired authoritative heads')
