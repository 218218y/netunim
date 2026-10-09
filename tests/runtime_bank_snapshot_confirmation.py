"""Atomic Bank confirmation through both production adapters and real IndexedDB.

Controlled server commit + malformed response; no live provider or production DB.
Main/Shared recovery is real. The simulated remote Bank effect is read back once,
without repeating a provider scan or a write.
"""
import json
from browser_harness import BrowserSession, ROOT

FLOW = r"""(async()=>{
 const check=(ok,message)=>{if(!ok)throw Error(message)};
 const stable=value=>JSON.stringify(value,(_key,item)=>item&&typeof item==='object'&&!Array.isArray(item)?Object.fromEntries(Object.keys(item).sort().map(key=>[key,item[key]])):item);
 const site=__SITE__,body=__BODY__,owner='fixture-bank-confirmation',stamp='2026-10-09T10:00:00.000Z',originalFetch=globalThis.fetch;
 const kupa=site==='kupa';
 if(kupa){financeAutomation.stop();syncDocument.stopCloudPolling()}else{syncDocument.stopPolling();domainsFinanceController.stopAutoSync()}
 const note={id:'bank-confirmation-note',content:'durable before unconfirmed Bank result'};state.notes.push(note);
 const operation={domains:['notes'],operations:[{type:'put',collection:'notes',id:note.id,mode:'insert',index:state.notes.length-1,record:note}]};
 if(kupa)await storagePersistence.saveState('Bank confirmation fixture',operation);else storagePersistence.scheduleSave('Bank confirmation fixture',operation);
 await mainStorageV2.commitPromise;
 const initialBank={...state.bank,source:'hapoalim',currentBalance:100,archiveInitialized:true,archiveVersion:2,bankSyncAt:stamp,feed:{accountNumber:'same-account',balance:100,syncedAt:stamp,transactions:[]}};
 // Stage the synthetic initial Bank projection before the transfer boundary.
 if(kupa)state.bank=initialBank;
 const authenticate=kupa?cloudAuth.storeSupaSession:cloudAuth.saveSession;
 authenticate({user:{id:owner},access_token:'fixture',expires_at:9999999999});
 let main=null,shared=null,remoteBank=initialBank,bankRevision=1,commits=0,scrapes=0;
 const writeMain=async snapshot=>{main={revision:1,state:structuredClone(snapshot)};return {r:{ok:true},row:main}};
 const writeChecks=async rows=>{shared={revision:1,state:{version:1,checks:structuredClone(rows),bankEvents:[]}};return {r:{ok:true},row:shared}};
 if(kupa){cloudTransport.readSupabaseDocument=async()=>main;cloudTransport.readSharedChecksDocument=async()=>shared;syncDocument.rpcSaveCloudV2=writeMain;cloudTransport.rpcSaveSharedChecksV2=writeChecks;await storageV2Coordinator.ownerUiPorts().startStorageV2OwnerTransfer({targetOwner:owner,intent:'upload-local'})}
 else{cloudTransport.readCloud=async()=>main;cloudTransport.readSharedChecksCloud=async()=>shared;cloudTransport.rpcSaveV2=writeMain;cloudTransport.rpcSaveSharedChecksV2=writeChecks;await storageV2Coordinator.startStorageV2OwnerTransfer({targetOwner:owner,intent:'upload-local'});checksSession.kupaCloudReadState={bank:structuredClone(initialBank),creditSync:{profiles:[]}};checksSession.kupaReadRevision=1;checksSession.financeReadRevision=1}
 session.connectionMode='supabase';session.backendReady=true;session.storageProtocolBlocked=false;
 if(kupa){state.bank=structuredClone(initialBank);session.financeRevision=1;session.dbRevision=main.revision}
 const {createStorageJournalDb}=await import('./assets/js/shared/storage-journal-idb.js');const db=createStorageJournalDb(),identity=owner+':'+site;
 const durableBefore=JSON.stringify(await db.load(identity)),sharedBefore=JSON.stringify(await db.load(owner+':shared-checks')),sharedStateBefore=JSON.stringify((await sharedChecksV2.recoverReadOnly()).state);
 localStorage.setItem('netunim_kupa_bank_bridge_token_v1','fixture-pairing');
 for(const key of ['netunim_kupa_bank_auto_daily_v1','netunim_orders_bank_auto_daily_v1','netunim_orders_credit_auto_daily_v1'])localStorage.setItem(key,'0');
 cloudTransport.claimFinanceSyncLease=async()=>({acquired:true,leaseName:'bank',leaseToken:'fixture',fenceEpoch:1});cloudTransport.releaseFinanceSyncLease=async()=>true;
 syncChecks.syncSharedChecksFromCloud=async()=>true;
 if(kupa)syncChecksState.sharedChecksHaveLocalWork=()=>false;else stateSnapshots.checksHaveLocalWork=()=>false;
 const readout=()=>({revision:bankRevision,financeRevision:bankRevision,state:{...(kupa?structuredClone(main.state):{creditSync:{profiles:[]}}),bank:structuredClone(remoteBank)}});
 if(kupa)cloudTransport.readSupabaseDocument=async()=>readout();else cloudTransport.readKupaReadOnlyCloud=async()=>readout();
 cloudTransport.readFinanceSyncDocument=async()=>({revision:bankRevision,state:{bank:structuredClone(remoteBank),creditSync:{profiles:[]}}});
 cloudTransport.syncBankTransactionsSnapshot=async()=>({sourcePayload:[],result:{total_count:0}});
 cloudTransport.readBankTransactions=async()=>[{id:'stable-bank-transaction',date:stamp,processedDate:stamp,amount:12,currency:'ILS',status:'completed',description:'retained'}];cloudTransport.readBankTransactionSnapshot=async()=>null;
 const request=async(path,options)=>{
   check(String(path).endsWith('/save_bank_sync_snapshot_v6'),'unexpected fixture RPC: '+path);options.assertRequestScope?.();
   const send=JSON.parse(options.body);commits++;remoteBank=structuredClone(send.p_bank_state);bankRevision=2;
   // Represent the actual server's independent Main watermark effect too.
   main={revision:2,state:{...main.state,bank:{adjustments:main.state.bank?.adjustments||[],snapshotToken:send.p_snapshot_token,snapshotSeq:send.p_snapshot_seq}}};
   return new Response(body);
 };
 // Exercise the production response decoder, not a controller mock receipt.
 if(kupa)cloudAuth.supaRest=request;else cloudAuth.supaFetch=request;
 globalThis.fetch=(url,options)=>{
   const path=String(url);
   if(path.endsWith('/status'))return Promise.resolve(new Response(JSON.stringify({ok:true,bridgeVersion:73,configured:true})));
   if(path.includes('/balance')){scrapes++;return Promise.resolve(new Response(JSON.stringify({ok:true,fetchedAt:stamp,accounts:{business:{balance:500,accountId:'same-account',transactions:[]}}})))}
   if(path.includes('/storage/v1/object/list/'))return Promise.resolve(new Response('[]'));
   return originalFetch(url,options);
 };
 const controller=kupa?domainsBankController:domainsFinanceController;
 const before=stable(kupa?state.bank:checksSession.kupaCloudReadState);
 check(await (kupa?controller.refreshBankBalance():controller.refreshBank())===false,'malformed HTTP 200 was accepted as a confirmed commit');
 check(stable(kupa?state.bank:checksSession.kupaCloudReadState)===before,'unconfirmed result replaced Last Known Good: '+JSON.stringify({site,before,after:kupa?state.bank:checksSession.kupaCloudReadState,commits,scrapes}));
 check(JSON.stringify(await db.load(identity))===durableBefore,'unknown confirmation changed durable Main records');
 check(JSON.stringify(await db.load(owner+':shared-checks'))===sharedBefore,'unknown confirmation changed Shared Checks');
 const diagnostic=kupa?controller.bankBridgeUiState():controller.snapshot();
 check((kupa?diagnostic.lastError:diagnostic.bankError).includes('אישור'),'unknown confirmation not visible to operator');
 // Recovery is an authorized read of the committed effect, never another scan.
 if(kupa){await syncDocument.cloudPoll();await controller.ensureBankDisplayArchive()}else await controller.refreshFinanceData();
 const bank=kupa?controller.bankBridgeUiState():controller.snapshot().bank;
 check((kupa?state.bank.currentBalance:bank.currentBalance)===500,'confirmed read did not recover the server Bank effect');
 check(JSON.stringify(bank.feed.transactions.map(row=>row.id))==='["stable-bank-transaction"]','Bank transaction identity lost/duplicated');
 check(commits===1&&scrapes===1,'recovery repeated a remote write/provider effect');
 check(state.notes.find(row=>row.id===note.id)?.content===note.content,'note identity/content lost');
 check(JSON.stringify((await sharedChecksV2.recoverReadOnly()).state)===sharedStateBefore,'readout recovery changed Shared Checks content');
 if(!kupa)check(JSON.stringify(await db.load(identity))===durableBefore,'read-only Finance recovery changed Orders Main');
 const recovered=await mainStorageV2.recoverReadOnly();check(recovered.state.notes.find(row=>row.id===note.id)?.content===note.content,'real Main recovery lost note');
 globalThis.fetch=originalFetch;authenticate(null);
 return {unknownOutcomeReported:true,lastKnownGoodRetained:true,journalRetained:true,sharedRetained:true,readBasedRecovery:true,noDuplicateEffect:true,exactIds:true};
})()"""

for site in ('kupa', 'orders'):
    for name, body in (('null', 'null'), ('multiple', '[{},{}]')):
        with BrowserSession(ROOT / ('netunim-' + site + '/site'), 'bank-confirmation-' + site + '-' + name) as browser:
            result = browser.evaluate(FLOW.replace('__SITE__', json.dumps(site)).replace('__BODY__', json.dumps(body)), timeout=45)
            assert result and all(result.values()), result
            browser._navigate()
            restored = browser.evaluate("""(async()=>{await appReady;const recovered=await mainStorageV2.recoverReadOnly();return recovered?.state?.notes?.find(row=>row.id==='bank-confirmation-note')?.content})()""")
            assert restored == 'durable before unconfirmed Bank result', restored
            errors = browser.drain_serious_errors()
            assert not errors, errors
            print('PASS Bank confirmation ' + site + '/' + name + ': ' + json.dumps(result))
