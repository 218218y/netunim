"""Production archive ownership: accepted reads, account handoff and real durable journals."""
import json
from browser_harness import BrowserSession, ROOT

FLOW = r"""(async()=>{
 const check=(ok,message)=>{if(!ok)throw Error(message)},deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b});return {promise,resolve,reject}};
 const caseName=__CASE__,owner='aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa',stamp='2026-10-08T10:00:00.000Z';
 syncDocument.stopPolling();finance.runtime.stop();
 const note={id:'archive-read-owner-note',content:'durable before archive reads'};state.notes.push(note);
 storagePersistence.scheduleSave('archive ownership fixture',{domains:['notes'],operations:[{type:'put',collection:'notes',id:note.id,mode:'insert',index:state.notes.length-1,record:note}]});await mainStorageV2.commitPromise;
 cloudAuth.saveSession({user:{id:owner},access_token:'fixture',expires_at:9999999999});let main=null,shared=null;
 cloudTransport.readCloud=async()=>main;cloudTransport.readSharedChecksCloud=async()=>shared;
 cloudTransport.rpcSaveV2=async snapshot=>{main={revision:1,state:structuredClone(snapshot)};return {r:{ok:true},row:main}};
 cloudTransport.rpcSaveSharedChecksV2=async rows=>{shared={revision:1,state:{version:1,checks:structuredClone(rows),bankEvents:[]}};return {r:{ok:true},row:shared}};
 await storageV2Coordinator.startStorageV2OwnerTransfer({targetOwner:owner,intent:'upload-local'});session.storageProtocolBlocked=false;
 const {createStorageJournalDb}=await import('./assets/js/shared/storage-journal-idb.js'),db=createStorageJournalDb(),identity=owner+':orders',sharedIdentity=owner+':shared-checks';
 const mainJournal=await db.load(identity),sharedJournal=await db.load(sharedIdentity);
 check(mainJournal?.checkpoints&&sharedJournal?.checkpoints,'real Main/Shared checkpoints missing');
 const beforeMain=JSON.stringify(mainJournal),beforeShared=JSON.stringify(sharedJournal);
 const bank={source:'hapoalim',currentBalance:100,bankSyncAt:'2020-01-01T00:00:00Z',archiveInitialized:true,archiveVersion:2,feed:{accountNumber:'same-account',balance:100,syncedAt:stamp,transactions:[]}},remote={bank,creditSync:{profiles:[],errors:[]}};
 checksSession.kupaCloudReadState=structuredClone(remote);checksSession.kupaReadRevision=1;checksSession.financeReadRevision=1;
 const held=deferred(),entered=deferred(),reported=[],originalError=console.error,originalFetch=globalThis.fetch;
 let settled=false,releases=0,writes=0,snapshots=0,pending;
 console.error=(...args)=>{if(args.some(arg=>String(arg?.message||arg).includes('private former archive')))reported.push(args);else originalError(...args)};
 cloudTransport.readBankTransactions=()=>caseName==='handoff'?held.promise:Promise.reject(Error('archive read failed'));
 cloudTransport.readBankTransactionSnapshot=()=>{snapshots++;entered.resolve();return caseName==='handoff'?Promise.resolve(null):held.promise};
 try{
   if(caseName==='verification'){
     localStorage.setItem('netunim_kupa_bank_bridge_token_v1','fixture-pairing');
     cloudTransport.claimFinanceSyncLease=async()=>({acquired:true,leaseName:'bank',leaseToken:'fixture',fenceEpoch:1});
     cloudTransport.releaseFinanceSyncLease=async()=>{releases++;return true};
     cloudTransport.readKupaReadOnlyCloud=async()=>({revision:1,financeRevision:1,state:structuredClone(remote)});
     cloudTransport.readFinanceSyncDocument=async()=>({revision:1,state:structuredClone(remote)});
     cloudTransport.syncBankTransactionsSnapshot=async()=>({sourcePayload:[],result:{total_count:0}});
     cloudTransport.saveBankSyncSnapshot=async()=>{writes++;throw Error('unexpected Bank publication')};
     checks.commands.sync=async()=>true;stateSnapshots.checksHaveLocalWork=()=>false;
     globalThis.fetch=(url,options)=>{
       const path=String(url);
       if(path.endsWith('/status'))return Promise.resolve(new Response(JSON.stringify({ok:true,bridgeVersion:73,configured:true})));
       if(path.includes('/balance'))return Promise.resolve(new Response(JSON.stringify({ok:true,fetchedAt:stamp,accounts:{business:{balance:500,accountId:'same-account',transactions:[]}}})));
       if(path.includes('/storage/v1/object/list/'))return Promise.resolve(new Response('[]'));
       return originalFetch(url,options);
     };
     pending=finance.commands.refreshBank();
   }else pending=finance.queries.ensureBankDisplayArchive();
   void pending.then(()=>{settled=true});await entered.promise;
   if(caseName==='handoff'){
     cloudAuth.saveSession({user:{id:'bbbbbbbb-bbbb-4bbb-bbbb-bbbbbbbbbbbb'},access_token:'other',expires_at:9999999999});held.reject(Error('private former archive failure'));
   }else{
     await new Promise(resolve=>setTimeout(resolve,0));
     check(!settled,'accepted sibling read was abandoned');check(releases===0,'Finance lease released before accepted sibling settled');held.resolve(null);
   }
   check(await pending===false,'failed archive operation reported success');
   check(reported.length===0,'former-account error reported');check(writes===0,'failed reads published Bank state');
   check(releases===(caseName==='verification'?1:0),'unexpected Finance lease release');check(snapshots===1,'archive read duplicated');
   check(JSON.stringify(await db.load(identity))===beforeMain,'archive reads changed Main durable journal');
   check(JSON.stringify(await db.load(sharedIdentity))===beforeShared,'archive reads changed Shared durable journal');
   check(state.notes.find(row=>row.id===note.id)?.content===note.content,'note identity/content changed');
   return {acceptedSiblingRetained:true,scopeFenced:true,leaseRetained:true,noPublication:true,journalsRetained:true};
 }finally{
   held.resolve(null);if(pending)await pending.catch(()=>{});console.error=originalError;globalThis.fetch=originalFetch;finance.runtime.stop();cloudAuth.saveSession(null);
 }
})()"""

for case in ('hydration', 'handoff', 'verification'):
    with BrowserSession(ROOT / 'netunim-orders/site', 'orders-bank-archive-' + case) as browser:
        result = browser.evaluate(FLOW.replace('__CASE__', json.dumps(case)), timeout=70)
        assert result and all(result.values()), result
        assert not browser.drain_serious_errors()
        print('PASS Orders Bank archive ' + case + ': ' + json.dumps(result))
