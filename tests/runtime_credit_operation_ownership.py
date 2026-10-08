"""Actual Kupa composition/auth and durable owner with controlled finance I/O."""
import json
from browser_harness import BrowserSession, ROOT

FLOW = r"""(async()=>{
 const check=(ok,message)=>{if(!ok)throw Error(message)};
 const deferred=()=>{let resolve;const promise=new Promise(done=>{resolve=done});return {promise,resolve}};
 const originalFetch=globalThis.fetch,owner='fixture-credit-owner',caseName=__CASE__;
 financeAutomation.stop();syncDocument.stopCloudPolling();
 const note={id:'credit-operation-note',content:'durable before issuer request'};state.notes.push(note);
 await storagePersistence.saveState('credit operation fixture',{domains:['notes'],operations:[{type:'put',collection:'notes',id:note.id,mode:'insert',index:state.notes.length-1,record:note}]});
 await mainStorageV2.commitPromise;
 cloudAuth.storeSupaSession({user:{id:owner},access_token:'fixture',expires_at:9999999999});
 let main=null,checks=null;
 cloudTransport.readSupabaseDocument=async()=>main;cloudTransport.readSharedChecksDocument=async()=>checks;
 syncDocument.rpcSaveCloudV2=async snapshot=>{main={revision:1,state:structuredClone(snapshot)};return {r:{ok:true},row:main}};
 cloudTransport.rpcSaveSharedChecksV2=async rows=>{checks={revision:1,state:{version:1,checks:structuredClone(rows),bankEvents:[]}};return {r:{ok:true},row:checks}};
 await storageV2Coordinator.ownerUiPorts().startStorageV2OwnerTransfer({targetOwner:owner,intent:'upload-local'});
 session.connectionMode='supabase';session.backendReady=true;session.storageProtocolBlocked=false;
 const {createStorageJournalDb}=await import('./assets/js/shared/storage-journal-idb.js');const db=createStorageJournalDb(),identity=owner+':kupa',durableBefore=JSON.stringify(await db.load(identity));
 localStorage.setItem('netunim_kupa_bank_bridge_token_v1','fixture-pairing');localStorage.setItem('netunim_kupa_credit_auto_daily_v1','0');
 const entered=deferred(),provider=deferred(),saving=deferred(),saved=deferred();let publications=0,releases=0;
 cloudTransport.claimFinanceSyncLease=async()=>({acquired:true,leaseName:'credit',leaseToken:'fixture',fenceEpoch:1});
 cloudTransport.releaseFinanceSyncLease=async()=>{releases++;return true};
 cloudTransport.saveFinancePatch=async(mutator,_lease,options)=>{
   options?.assertCurrent?.();publications++;const next=mutator({creditSync:state.creditSync});
   if(caseName==='publication'){saving.resolve();await saved.promise}
   if(caseName==='network')throw Error('fixture offline before finance commit');
   return {saved:true,row:{revision:2,state:next}};
 };
 cloudTransport.readSupabaseDocument=async()=>({revision:session.dbRevision,financeRevision:session.financeRevision,state:structuredClone(state)});
 globalThis.fetch=(url,options)=>{
   if(String(url).includes('/v2/credit/status'))return Promise.resolve(new Response(JSON.stringify({ok:true,bridgeVersion:73,contractVersion:2,profiles:[{profileId:'P'}]})));
   if(String(url).includes('/v2/credit/sync')){entered.resolve();return provider.promise}
   return originalFetch(url,options);
 };
 const before=JSON.stringify(state.creditSync),pending=domainsCreditController.refreshCreditSync();await entered.promise;
 if(caseName==='logout')check(uiCloud.logoutSupabase()===true,'production logout rejected');
 if(caseName==='account')cloudAuth.storeSupaSession({user:{id:'fixture-other-owner'},access_token:'fixture-other',expires_at:9999999999});
 if(caseName==='relogin'){cloudAuth.storeSupaSession(null);cloudAuth.storeSupaSession({user:{id:owner},access_token:'fixture-2',expires_at:9999999999})}
 if(caseName==='secondary')tab.primaryTab=false;
 provider.resolve(new Response(JSON.stringify({ok:true,syncedAt:'2026-10-08T10:00:00Z',attemptedCount:1,profiles:[{profileId:'P',provider:'max',accounts:[{accountNumber:'card',txns:[{id:'issuer-tx',date:'2026-10-08',amount:12}]}]}],errors:[]})));
 if(caseName==='publication'){await saving.promise;cloudAuth.storeSupaSession(null);saved.resolve()}
 await pending;
 check(JSON.stringify(state.creditSync)===before,'former/failed issuer result changed the displayed credit data');
 check(publications===(caseName==='network'||caseName==='publication'?1:0),'unexpected finance publication');
 check(JSON.stringify(await db.load(identity))===durableBefore,'credit failure changed durable Main/pending journal');
 check(state.notes.find(row=>row.id===note.id)?.content===note.content,'durable note identity/content lost');
 check(domainsCreditController.creditSyncUiState().error.length>0,'failure did not offer an operator error');
 check(caseName==='network'||releases===0,'former authorization released a lease under the new scope');
 globalThis.fetch=originalFetch;financeAutomation.stop();cloudAuth.storeSupaSession(null);return {projectionRetained:true,journalRetained:true,noteRetained:true,visibleError:true,scopedPublication:true};
})()"""

for case in ('logout', 'account', 'relogin', 'secondary', 'publication', 'network'):
    with BrowserSession(ROOT / 'netunim-kupa/site', 'credit-operation-' + case) as browser:
        result = browser.evaluate(FLOW.replace('__CASE__', json.dumps(case)), timeout=45)
        assert result and all(result.values()), result
        browser._navigate()
        restored = browser.evaluate("""(async()=>{await appReady;const recovered=await mainStorageV2.recoverReadOnly();return recovered?.state?.notes?.find(row=>row.id==='credit-operation-note')?.content})()""")
        assert restored == 'durable before issuer request', restored
        errors = browser.drain_serious_errors()
        assert not errors, errors
        print('PASS Kupa credit operation ' + case + ': ' + json.dumps(result))
