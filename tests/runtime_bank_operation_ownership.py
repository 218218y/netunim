"""Kupa production Bank composition, auth, Main/Shared IDB and restart."""
import json
from browser_harness import BrowserSession, ROOT

FLOW = r"""(async()=>{
 const check=(ok,message)=>{if(!ok)throw Error(message)};
 const deferred=()=>{let resolve;const promise=new Promise(done=>{resolve=done});return {promise,resolve}};
 const realFetch=globalThis.fetch,owner='aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa',caseName=__CASE__,stamp='2026-10-08T10:00:00.000Z';
 financeAutomation.stop();syncDocument.stopCloudPolling();
 const note={id:'bank-operation-note',content:'durable before bank request'};state.notes.push(note);
 await storagePersistence.saveState('bank operation fixture',{domains:['notes'],operations:[{type:'put',collection:'notes',id:note.id,mode:'insert',index:state.notes.length-1,record:note}]});await mainStorageV2.commitPromise;
 cloudAuth.storeSupaSession({user:{id:owner},access_token:'fixture',expires_at:9999999999});let main=null,checks=null;
 cloudTransport.readSupabaseDocument=async()=>main;cloudTransport.readSharedChecksDocument=async()=>checks;
 syncDocument.rpcSaveCloudV2=async snapshot=>{main={revision:1,state:structuredClone(snapshot)};return {r:{ok:true},row:main}};
 cloudTransport.rpcSaveSharedChecksV2=async rows=>{checks={revision:1,state:{version:1,checks:structuredClone(rows),bankEvents:[]}};return {r:{ok:true},row:checks}};
 await storageV2Coordinator.ownerUiPorts().startStorageV2OwnerTransfer({targetOwner:owner,intent:'upload-local'});
 session.connectionMode='supabase';session.backendReady=true;session.storageProtocolBlocked=false;
 state.bank={...state.bank,source:'hapoalim',currentBalance:100,bankSyncAt:stamp,archiveInitialized:true,archiveVersion:2,feed:{accountNumber:'same-account',balance:100,syncedAt:stamp,transactions:[]}};
 const {createStorageJournalDb}=await import('./assets/js/shared/storage-journal-idb.js');const db=createStorageJournalDb(),identity=owner+':kupa',durableBefore=JSON.stringify(await db.load(identity));
 localStorage.setItem('netunim_kupa_bank_bridge_token_v1','fixture-pairing');localStorage.setItem('netunim_kupa_bank_auto_daily_v1','0');
 const entered=deferred(),provider=deferred(),saving=deferred(),saved=deferred();let publications=0,archives=0,releases=0;
 syncChecks.syncSharedChecksFromCloud=async()=>true;syncChecksState.sharedChecksHaveLocalWork=()=>false;
 cloudTransport.claimFinanceSyncLease=async()=>({acquired:true,leaseName:'bank',leaseToken:'fixture',fenceEpoch:1});cloudTransport.releaseFinanceSyncLease=async()=>{releases++;return true};
 cloudTransport.readSupabaseDocument=async()=>({revision:session.dbRevision,financeRevision:session.financeRevision,state:structuredClone(state)});
 cloudTransport.syncBankTransactionsSnapshot=async()=>{archives++;return {sourcePayload:[],result:{total_count:0}}};
 cloudTransport.readBankTransactions=async()=>caseName==='network'?[{id:'uncommitted',date:stamp,processedDate:stamp,amount:12,currency:'ILS',status:'completed',description:'uncommitted'}]:[];
 cloudTransport.readBankTransactionSnapshot=async()=>null;
 cloudTransport.saveBankSyncSnapshot=async()=>{publications++;if(caseName==='publication'){saving.resolve();await saved.promise}if(caseName==='network')throw Error('fixture atomic network failure');return {revision:2}};
 globalThis.fetch=(url,options)=>{
   if(String(url).includes('/balance')){entered.resolve();return provider.promise}
   if(String(url).includes('/storage/v1/object/list/'))return Promise.resolve(new Response('[]'));
   return realFetch(url,options);
 };
 const before=JSON.stringify(state.bank),pending=domainsBankController.refreshBankBalance();await entered.promise;
 if(caseName==='logout')check(uiCloud.logoutSupabase()===true,'production logout rejected');
 if(caseName==='account')cloudAuth.storeSupaSession({user:{id:'bbbbbbbb-bbbb-4bbb-bbbb-bbbbbbbbbbbb'},access_token:'other',expires_at:9999999999});
 if(caseName==='relogin'){cloudAuth.storeSupaSession(null);cloudAuth.storeSupaSession({user:{id:owner},access_token:'fixture-2',expires_at:9999999999})}
 if(caseName==='secondary')tab.primaryTab=false;
 provider.resolve(new Response(JSON.stringify({ok:true,fetchedAt:stamp,accounts:{business:{balance:500,accountId:'same-account',transactions:[]}}})));
 if(caseName==='publication'){await saving.promise;cloudAuth.storeSupaSession(null);saved.resolve()}
 check(await pending===false,'former/failed bank operation reported success');
 check(JSON.stringify(state.bank)===before,'former/failed bank operation changed displayed balance');
 check(domainsBankController.bankBridgeUiState().feed.transactions.length===0,'uncommitted archive rows replaced displayed Last Known Good');
 check(archives===(caseName==='network'||caseName==='publication'?1:0),'former owner result entered archive transport');
 check(publications===(caseName==='network'||caseName==='publication'?1:0),'unexpected atomic bank publication');
 check(JSON.stringify(await db.load(identity))===durableBefore,'bank failure changed durable Main journal');
 check(state.notes.find(row=>row.id===note.id)?.content===note.content,'durable note lost identity/content');
 check(domainsBankController.bankBridgeUiState().lastError.length>0,'missing operator error');
 check(caseName==='network'||releases===0,'former login released a lease under current authorization');
 globalThis.fetch=realFetch;financeAutomation.stop();cloudAuth.storeSupaSession(null);return {balanceRetained:true,archiveRetained:true,journalRetained:true,noteRetained:true,scopedPublication:true,visibleError:true};
})()"""

for case in ('logout', 'account', 'relogin', 'secondary', 'publication', 'network'):
    with BrowserSession(ROOT / 'netunim-kupa/site', 'bank-operation-' + case) as browser:
        result = browser.evaluate(FLOW.replace('__CASE__', json.dumps(case)), timeout=45)
        assert result and all(result.values()), result
        browser._navigate()
        restored = browser.evaluate("""(async()=>{await appReady;const recovered=await mainStorageV2.recoverReadOnly();return recovered?.state?.notes?.find(row=>row.id==='bank-operation-note')?.content})()""")
        assert restored == 'durable before bank request', restored
        errors = browser.drain_serious_errors()
        assert not errors, errors
        print('PASS Kupa bank operation ' + case + ': ' + json.dumps(result))
