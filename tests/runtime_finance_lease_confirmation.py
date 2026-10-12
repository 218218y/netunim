"""Actual lease HTTP decoders and provider commands; synthetic server, native IDB.

No live issuer/bank is contacted. A valid grant reaches one deliberately failed
provider request. An invalid grant or a genuine refusal reaches none.
"""
import json
import os
from browser_harness import BrowserSession, ROOT

FLOW = r"""(async()=>{
 const check=(ok,message)=>{if(!ok)throw Error(message)},site=__SITE__,kind=__KIND__,caseName=__CASE__,kupa=site==='kupa',owner='fixture-lease-owner',originalFetch=globalThis.fetch;
 if(kupa){financeAutomation.stop();syncDocument.stopCloudPolling()}else{syncDocument.stopPolling();finance.runtime.stop()}
 const note={id:'lease-confirmation-note',content:'durable before lease confirmation'};state.notes.push(note);
 const mutation={domains:['notes'],operations:[{type:'put',collection:'notes',id:note.id,mode:'insert',index:state.notes.length-1,record:note}]};
 if(kupa)await storagePersistence.saveState('lease fixture',mutation);else storagePersistence.scheduleSave('lease fixture',mutation);
 await mainStorageV2.commitPromise;
 const authenticate=kupa?cloudAuth.storeSupaSession:cloudAuth.saveSession;authenticate({user:{id:owner},access_token:'fixture',expires_at:9999999999});
 let main=null,shared=null;
 const writeMain=async snapshot=>{main={revision:1,state:structuredClone(snapshot)};return {r:{ok:true},row:main}},writeChecks=async checks=>{shared={revision:1,state:{version:1,checks:structuredClone(checks),bankEvents:[]}};return {r:{ok:true},row:shared}};
 if(kupa){cloudTransport.readSupabaseDocument=async()=>main;cloudTransport.readSharedChecksDocument=async()=>shared;syncDocument.rpcSaveCloudV2=writeMain;cloudTransport.rpcSaveSharedChecksV2=writeChecks;await storageV2Coordinator.ownerUiPorts().startStorageV2OwnerTransfer({targetOwner:owner,intent:'upload-local'})}
 else{cloudTransport.readCloud=async()=>main;cloudTransport.readSharedChecksCloud=async()=>shared;cloudTransport.rpcSaveV2=writeMain;cloudTransport.rpcSaveSharedChecksV2=writeChecks;await storageV2Coordinator.startStorageV2OwnerTransfer({targetOwner:owner,intent:'upload-local'})}
 session.connectionMode='supabase';session.backendReady=true;session.storageProtocolBlocked=false;
 const remoteFinance={bank:{source:'hapoalim',currentBalance:100,feed:{accountNumber:'stable-account',transactions:[]}},creditSync:{version:4,profiles:[],errors:[]}};
 if(kupa){state.bank={...state.bank,...remoteFinance.bank};state.creditSync=remoteFinance.creditSync;session.financeRevision=1;cloudTransport.readSupabaseDocument=async()=>({revision:1,financeRevision:1,state:structuredClone(state)})}
 else{checksSession.kupaCloudReadState=structuredClone(remoteFinance);checksSession.kupaReadRevision=1;checksSession.financeReadRevision=1;cloudTransport.readKupaReadOnlyCloud=async()=>({revision:1,financeRevision:1,state:structuredClone(remoteFinance)})}
 cloudTransport.readFinanceSyncDocument=async()=>({revision:1,state:structuredClone(remoteFinance)});
 if(kupa)syncChecks.syncSharedChecksFromCloud=async()=>true;else checks.commands.sync=async()=>true;
 if(kupa)syncChecksState.sharedChecksHaveLocalWork=()=>false;else stateSnapshots.checksHaveLocalWork=()=>false;
 localStorage.setItem('netunim_kupa_bank_bridge_token_v1','fixture-pairing');
 localStorage.setItem('netunim_'+site+'_bank_auto_daily_v1','0');localStorage.setItem('netunim_'+site+'_credit_auto_daily_v1','0');
 const {createStorageJournalDb}=await import('./assets/js/shared/storage-journal-idb.js'),db=createStorageJournalDb(),identity=owner+':'+site;
 const mainBefore=JSON.stringify(await db.load(identity)),sharedBefore=JSON.stringify(await db.load(owner+':shared-checks')),projectionBefore=JSON.stringify(kupa?{bank:state.bank,creditSync:state.creditSync}:checksSession.kupaCloudReadState);
 let providers=0,claims=0,releases=0;
 const request=async(path,options)=>{
   options.assertRequestScope?.();
   if(String(path).endsWith('/claim_finance_sync_lease')){
     claims++;const requested=JSON.parse(options.body),row={acquired:caseName!=='busy',lease_token:caseName==='busy'?'other-computer':requested.p_lease_token,fence_epoch:7,leased_until:'2030-01-01T00:00:00+00:00'};
     return new Response(JSON.stringify([caseName==='invalid'?{acquired:true}:row]));
   }
   if(String(path).endsWith('/release_finance_sync_lease')){releases++;return new Response('true')}
   throw Error('unexpected fixture RPC '+path);
 };
 if(kupa)cloudAuth.supaRest=request;else cloudAuth.supaFetch=request;
 globalThis.fetch=(url,options)=>{
   const path=String(url);
   if(path.includes('/v2/credit/status'))return Promise.resolve(new Response(JSON.stringify({ok:true,bridgeVersion:73,contractVersion:2,profiles:[{profileId:'P'}]})));
   if(path.endsWith('/status'))return Promise.resolve(new Response(JSON.stringify({ok:true,bridgeVersion:73,configured:true})));
   if(path.includes('/balance')||path.includes('/v2/credit/sync')){providers++;return Promise.reject(Error('fixture provider stopped before any side effect'))}
   if(path.includes('/storage/v1/object/list/'))return Promise.resolve(new Response('[]'));
   return originalFetch(url,options);
 };
 const controller=kupa?(kind==='bank'?bank.commands:domainsCreditController):finance.commands;
 await controller[kupa?(kind==='bank'?'refreshBankBalance':'refreshCreditSync'):(kind==='bank'?'refreshBank':'refreshCredit')]();
 check(providers===(caseName==='valid'?1:0),'provider opened without confirmed ownership: '+providers);
 check(claims===1,'unexpected lease retry '+claims);check(releases===(caseName==='valid'?1:0),'unconfirmed/foreign lease was released '+releases);
 const warning=kupa?(kind==='bank'?bank.queries.snapshot().lastError:controller.creditSyncUiState().error):finance.queries.snapshot()[kind+'Error'];
 if(caseName!=='busy')check(warning.length>0,'missing visible lease/provider error');
 if(caseName==='invalid')check(warning.includes('אישור'),'invalid grant was not classified visibly');
 check(JSON.stringify(kupa?{bank:state.bank,creditSync:state.creditSync}:checksSession.kupaCloudReadState)===projectionBefore,'lease failure replaced confirmed projection');
 check(JSON.stringify(await db.load(identity))===mainBefore,'lease failure changed Main journal');check(JSON.stringify(await db.load(owner+':shared-checks'))===sharedBefore,'lease failure changed Shared journal');
 globalThis.fetch=originalFetch;authenticate(null);
 return {providerAuthorization:true,noBlindRetry:true,noForeignRelease:true,projectionRetained:true,journalsRetained:true};
})()"""

failures = []
for site in ('kupa', 'orders'):
    for kind in ('bank', 'credit'):
        if os.environ.get('NETUNIM_LEASE_OWNER') not in (None, site + '-' + kind):
            continue
        for case in ('invalid', 'busy', 'valid'):
            if os.environ.get('NETUNIM_LEASE_CASE') not in (None, case):
                continue
            try:
                with BrowserSession(ROOT / ('netunim-' + site + '/site'), 'lease-' + site + '-' + kind + '-' + case) as browser:
                    result = browser.evaluate(FLOW.replace('__SITE__', json.dumps(site)).replace('__KIND__', json.dumps(kind)).replace('__CASE__', json.dumps(case)), timeout=45)
                    assert result and all(result.values()), result
                    browser._navigate()
                    recovered = browser.evaluate("""(async()=>{await appReady;return (await mainStorageV2.recoverReadOnly()).state.notes.find(row=>row.id==='lease-confirmation-note')?.content})()""")
                    assert recovered == 'durable before lease confirmation', recovered
                    assert not browser.drain_serious_errors()
                    print('PASS Finance lease ' + site + '/' + kind + '/' + case + ': ' + json.dumps(result), flush=True)
            except Exception as error:
                failures.append(site + '/' + kind + '/' + case + ': ' + str(error))
                print('FAIL ' + failures[-1], flush=True)
assert not failures, '\n'.join(failures)
