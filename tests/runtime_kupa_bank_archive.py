"""Production archive ownership: accepted reads, account handoff and real durable journals."""
import json
from browser_harness import BrowserSession, ROOT

FLOW = r"""(async()=>{
 const check=(ok,message)=>{if(!ok)throw Error(message)},deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b});return {promise,resolve,reject}};
 const caseName=__CASE__,owner='aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa',stamp='2026-10-08T10:00:00.000Z';
 financeAutomation.stop();syncDocument.stopCloudPolling();
 const note={id:'archive-read-owner-note',content:'durable before archive reads'};state.notes.push(note);
 await storagePersistence.saveState('archive ownership fixture',{domains:['notes'],operations:[{type:'put',collection:'notes',id:note.id,mode:'insert',index:state.notes.length-1,record:note}]});await mainStorageV2.commitPromise;
 cloudAuth.storeSupaSession({user:{id:owner},access_token:'fixture',expires_at:9999999999});let main=null,shared=null;
 cloudTransport.readSupabaseDocument=async()=>main;cloudTransport.readSharedChecksDocument=async()=>shared;
 syncDocument.rpcSaveCloudV2=async snapshot=>{main={revision:1,state:structuredClone(snapshot)};return {r:{ok:true},row:main}};
 cloudTransport.rpcSaveSharedChecksV2=async rows=>{shared={revision:1,state:{version:1,checks:structuredClone(rows),bankEvents:[]}};return {r:{ok:true},row:shared}};
 await storageV2Coordinator.ownerUiPorts().startStorageV2OwnerTransfer({targetOwner:owner,intent:'upload-local'});session.connectionMode='supabase';session.backendReady=true;session.storageProtocolBlocked=false;
 const {createStorageJournalDb}=await import('./assets/js/shared/storage-journal-idb.js'),db=createStorageJournalDb(),identity=owner+':kupa',sharedIdentity=owner+':shared-checks';
 const mainJournal=await db.load(identity),sharedJournal=await db.load(sharedIdentity);
 check(mainJournal?.checkpoints&&sharedJournal?.checkpoints,'real Main/Shared checkpoints missing');
 const beforeMain=JSON.stringify(mainJournal),beforeShared=JSON.stringify(sharedJournal);
 const bankState={source:'hapoalim',currentBalance:100,bankSyncAt:'2020-01-01T00:00:00Z',archiveInitialized:true,archiveVersion:2,feed:{accountNumber:'same-account',balance:100,syncedAt:stamp,transactions:[]}};
 state.bank=structuredClone(bankState);
 const held=deferred(),entered=deferred(),provider=deferred(),providerEntered=deferred(),reported=[],originalError=console.error,originalFetch=globalThis.fetch;
 let settled=false,releases=0,writes=0,snapshots=0,pending,refreshing=null,draining=null,drained=false;
 console.error=(...args)=>{if(args.some(arg=>String(arg?.message||arg).includes('private former archive')))reported.push(args);else originalError(...args)};
 cloudTransport.readBankTransactions=()=>['handoff','race'].includes(caseName)?held.promise:Promise.reject(Error('archive read failed'));
 cloudTransport.readBankTransactionSnapshot=()=>{snapshots++;entered.resolve();return ['handoff','race'].includes(caseName)?Promise.resolve(null):held.promise};
 try{
   if(['verification','race'].includes(caseName)){
     localStorage.setItem('netunim_kupa_bank_bridge_token_v1','fixture-pairing');
     cloudTransport.claimFinanceSyncLease=async()=>({acquired:true,leaseName:'bank',leaseToken:'fixture',fenceEpoch:1});
     cloudTransport.releaseFinanceSyncLease=async()=>{releases++;return true};
     cloudTransport.readSupabaseDocument=async()=>({revision:session.dbRevision,financeRevision:session.financeRevision,state:structuredClone(state)});
     cloudTransport.syncBankTransactionsSnapshot=async()=>({sourcePayload:[],result:{total_count:0}});
     cloudTransport.saveBankSyncSnapshot=async()=>{writes++;throw Error('unexpected Bank publication')};
     checks.commands.sync=async()=>true;checks.queries.hasLocalWork=()=>false;
     globalThis.fetch=(url,options)=>{
       const path=String(url);
       if(path.endsWith('/status'))return Promise.resolve(new Response(JSON.stringify({ok:true,bridgeVersion:73,configured:true})));
       if(path.includes('/balance')){if(caseName==='race'){providerEntered.resolve();return provider.promise}return Promise.resolve(new Response(JSON.stringify({ok:true,fetchedAt:stamp,accounts:{business:{balance:500,accountId:'same-account',transactions:[]}}})))};
       if(path.includes('/storage/v1/object/list/'))return Promise.resolve(new Response('[]'));
       return originalFetch(url,options);
     };
     pending=caseName==='race'?bank.queries.ensureDisplayArchive():bank.commands.refreshBankBalance();
   }else pending=bank.queries.ensureDisplayArchive();
   void pending.then(()=>{settled=true});await entered.promise;
   if(caseName==='dispose'){bank.runtime.dispose();draining=bank.runtime.drain().then(()=>{drained=true})}
   if(caseName==='race'){
     refreshing=bank.commands.refreshBankBalance();await providerEntered.promise;
     held.resolve([{id:'uncommitted',date:stamp,processedDate:stamp,amount:12,currency:'ILS',status:'completed',description:'uncommitted'}]);
     check(await pending===false,'superseded hydration reported success');
     check(bank.queries.snapshot().feed.transactions.length===0,'background hydration exposed uncommitted archive');
     provider.reject(Error('provider failed before Bank publication'));check(await refreshing===false,'failed provider reported success');
   }else if(caseName==='handoff'){
     cloudAuth.storeSupaSession({user:{id:'bbbbbbbb-bbbb-4bbb-bbbb-bbbbbbbbbbbb'},access_token:'other',expires_at:9999999999});held.reject(Error('private former archive failure'));
   }else{
     await new Promise(resolve=>setTimeout(resolve,0));
     check(!settled,'accepted sibling read was abandoned');check(!drained,'Bank disposal abandoned accepted sibling');check(releases===0,'Finance lease released before accepted sibling settled');held.resolve(null);
   }
   check(await pending===false,'failed archive operation reported success');if(draining)await draining;
   check(reported.length===0,'former-account error reported');check(writes===0,'failed reads published Bank state');
   check(releases===(['verification','race'].includes(caseName)?1:0),'unexpected Finance lease release');check(snapshots===1,'archive read duplicated');
   check(JSON.stringify(await db.load(identity))===beforeMain,'archive reads changed Main durable journal');
   check(JSON.stringify(await db.load(sharedIdentity))===beforeShared,'archive reads changed Shared durable journal');
   check(state.notes.find(row=>row.id===note.id)?.content===note.content,'note identity/content changed');
   return {acceptedSiblingRetained:true,scopeFenced:true,leaseRetained:true,noPublication:true,journalsRetained:true};
 }finally{
   held.resolve(null);provider.resolve(new Response('{}'));if(pending)await pending.catch(()=>{});if(refreshing)await refreshing.catch(()=>{});console.error=originalError;globalThis.fetch=originalFetch;financeAutomation.stop();cloudAuth.storeSupaSession(null);
 }
})()"""

for case in ('hydration', 'handoff', 'verification', 'dispose', 'race'):
    with BrowserSession(ROOT / 'netunim-kupa/site', 'kupa-bank-archive-' + case) as browser:
        result = browser.evaluate(FLOW.replace('__CASE__', json.dumps(case)), timeout=70)
        assert result and all(result.values()), result
        assert not browser.drain_serious_errors()
        print('PASS Kupa Bank archive ' + case + ': ' + json.dumps(result))
