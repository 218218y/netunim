"""Server-only restore: fresh writers, native IDB and failure after remote commit."""
import json
import argparse
from browser_harness import BrowserSession, ROOT

FLOW = r"""(async()=>{
 const app=__APP__,check=(ok,label)=>{if(!ok)throw Error(label)};
 const {createStorageJournalDb}=await import('./assets/js/shared/storage-journal-idb.js');
 const {createStorageJournal}=await import('./assets/js/shared/storage-journal.js');
 const {createStorageV2Boundary}=await import('./assets/js/shared/storage-v2-boundary.js');
 const {createRestoreGroupStore}=await import('./assets/js/shared/restore-groups.js');
 const {resumeServerRestoreGroups}=await import('./assets/js/shared/restore-server-recovery.js');
 const {applyStorageV2RestoreGroup,captureStorageV2RestoreSource}=await import('./assets/js/shared/storage-v2-restore.js');
 const {RESTORE_GROUP_NAMESPACES,createRestoreGroupKeys}=await import('./assets/js/shared/restore-group-keys.js');
 let ports;
 if(app==='orders'){
   const {createStorageBrowser}=await import('./assets/js/storage/browser.js');
   const storage=createStorageBrowser({model:{state:{}},files:{},session:{},prepareCloudState:()=>({}),normalizeState:value=>value});
   ports={put:(...args)=>storage.idbSyncPut(...args),get:(...args)=>storage.idbSyncGet(...args),remove:(...args)=>storage.idbSyncDelete(...args)};
 }else{
   const {createStorageIndexedDb}=await import('./assets/js/storage/indexed-db.js');
   const storage=createStorageIndexedDb({});
   ports={put:(...args)=>storage.idbPut('sync',...args),get:(...args)=>storage.idbGet('sync',...args),remove:(...args)=>storage.idbDelete('sync',...args)};
 }
 const makeStore=()=>createRestoreGroupStore({localKey:RESTORE_GROUP_NAMESPACES[app],...ports});
 const db=createStorageJournalDb({name:'restore-journals-'+app}),owner='restore-fixture',id='aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa',at='2026-10-16T10:00:00Z';
 const emergency={read:()=>[],write:()=>{},remove:()=>{}};
 const create=()=>({main:createStorageJournal({owner:owner+':'+app,schema:{collections:['notes']},validate:()=>{},db,emergency}),shared:createStorageJournal({owner:owner+':shared-checks',schema:{collections:['checks'],fields:['bankEvents']},validate:()=>{},db,emergency})});
 let client=create();await client.main.initializeCloudHead(8,{notes:[]});await client.shared.initializeCloudHead(11,{checks:[],bankEvents:[]});
 const group={restore_group_id:id,app_site:app,phase:'staged',created_at:at,updated_at:at};
 if(app==='orders'){
   // Exercise the actual signed-in startup recovery owner through the actual
   // Orders adapter, before any pending row or legacy restore database exists.
   const {createBackupRestore}=await import('./assets/js/ui/backup-restore.js');
   let lists=0;
   const backup=createBackupRestore({model:{state:{}},session:{},tab:{primaryTab:true},checksSession:{},
     cloud:{loadSession:()=>({user:{id:owner}}),restoreGroupStore:makeStore(),listIncompleteRestoreGroups:async()=>{lists++;return []}},
     storage:{storageV2LocalPrimary:()=>true,storageOwnerCurrent:()=>owner}});
   check(await backup.resumeIncompleteRestore()===false&&lists===1,'empty signed-in startup recovery did not complete');
 }
 const foreign={...group,owner:'other-owner',restore_group_id:'bbbbbbbb-bbbb-4bbb-bbbb-bbbbbbbbbbbb'};
 await makeStore().stageServerPending(foreign);
 const keys=createRestoreGroupKeys(RESTORE_GROUP_NAMESPACES[app]);
 const malformed={...group,owner,phase:'garbage'};
 await ports.put(keys.server(owner),malformed);
 let invalid=false;try{await makeStore().loadServerPending(owner)}catch(error){invalid=error.code==='RESTORE_RESPONSE_EVIDENCE_INVALID'}
 check(invalid&&JSON.stringify(await ports.get(keys.server(owner)))===JSON.stringify(malformed),'invalid recovery evidence was erased or accepted');
 await ports.remove(keys.server(owner));
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
 check(JSON.stringify(await makeStore().loadServerPending('other-owner'))===JSON.stringify(foreign),'completion changed another account pending restore');
 return {productionAdapter:true,serverOnly:true,freshClient:true,durableRetry:true,pairedAdoption:true,accountIsolation:true};
})()"""

parser=argparse.ArgumentParser()
parser.add_argument('--app',choices=('orders','kupa'))
parser.add_argument('--baseline',action='store_true',help='Restore the old Orders key gate only in the disposable test site; the regression must fail.')
args=parser.parse_args()
if args.baseline and args.app!='orders':
    parser.error('--baseline requires --app orders')

for app in ([args.app] if args.app else ('orders', 'kupa')):
    with BrowserSession(ROOT / f'netunim-{app}/site', app+'-restore-server-recovery', instrument=False,auto_navigate=False) as browser:
        if args.baseline:
            target=browser.tmp/'site/assets/js/storage/browser.js'
            source=target.read_text(encoding='utf-8')
            old="const current='orders.restore.group.v1:current',archive='orders.restore.group.v1:archive:';if(key===current||typeof key==='string'&&key.startsWith(archive)&&key.length>archive.length)return key;throw Error('storage_restore_group_key_required');"
            assert 'return restoreGroupKeys.read(key);' in source
            target.write_text(source.replace('return restoreGroupKeys.read(key);',old),encoding='utf-8')
        browser._navigate()
        result = browser.evaluate(FLOW.replace('__APP__', json.dumps(app)), timeout=40)
        assert result and all(result.values()), result
        assert not browser.drain_serious_errors()
        print(f'PASS {app} server-only restore: fresh client, native pending identity and paired authoritative heads')
