"""Actual lease HTTP/composition lifecycle, Main/Shared IDB and fresh recovery."""
import argparse
import json
from browser_harness import BrowserSession, ROOT

FLOW = r"""(async()=>{
 const check=(ok,message)=>{if(!ok)throw Error(message)},site=__SITE__,kind=__KIND__,phase=__PHASE__,action=__ACTION__,kupa=site==='kupa',owner='fixture-lease-owner',originalFetch=globalThis.fetch;
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
 if(kupa)checks.commands.sync=async()=>true;else checks.commands.sync=async()=>true;
 if(kupa)checks.queries.hasLocalWork=()=>false;else stateSnapshots.checksHaveLocalWork=()=>false;
 localStorage.setItem('netunim_kupa_bank_bridge_token_v1','fixture-pairing');
 localStorage.setItem('netunim_'+site+'_bank_auto_daily_v1','0');localStorage.setItem('netunim_'+site+'_credit_auto_daily_v1','0');
 const {createStorageJournalDb}=await import('./assets/js/shared/storage-journal-idb.js'),db=createStorageJournalDb(),identity=owner+':'+site;
 const mainBefore=JSON.stringify(await db.load(identity)),sharedBefore=JSON.stringify(await db.load(owner+':shared-checks')),projectionBefore=JSON.stringify(kupa?{bank:state.bank,creditSync:state.creditSync}:checksSession.kupaCloudReadState);

 const deferred=()=>Promise.withResolvers(),claimGate=deferred(),renewalGate=deferred(),providerGate=deferred(),entered=deferred(),providerEntered=deferred();
 let claims=0,releases=0,providers=0,tick=null,settled=false,drained=false;
 const scheduled=new Map(),originalSetTimeout=globalThis.setTimeout,originalClearTimeout=globalThis.clearTimeout;
 let id=-700;
 globalThis.setTimeout=(run,ms,...args)=>{if(ms===400000){const key=id--;tick=()=>{scheduled.delete(key);return run()};scheduled.set(key,tick);return key}return originalSetTimeout(run,ms,...args)};
 globalThis.clearTimeout=key=>{if(key<=-700)scheduled.delete(key);else originalClearTimeout(key)};
 const request=async(path,options)=>{
   options.assertRequestScope?.();
   if(String(path).endsWith('/claim_finance_sync_lease')){
     claims++;
     if(phase==='acquisition'&&claims===1){entered.resolve();await claimGate.promise}
     if(phase==='renewal'&&claims===2){entered.resolve();await renewalGate.promise}
     const requested=JSON.parse(options.body);
     return new Response(JSON.stringify([{acquired:true,lease_token:requested.p_lease_token,fence_epoch:7,leased_until:'2030-01-01T00:00:00+00:00'}]));
   }
   if(String(path).endsWith('/release_finance_sync_lease')){releases++;return new Response('true')}
   throw Error('unexpected fixture RPC '+path);
 };
 if(kupa)cloudAuth.supaRest=request;else cloudAuth.supaFetch=request;
 globalThis.fetch=(url,options)=>{
   const path=String(url);
   if(path.includes('/v2/credit/status'))return Promise.resolve(new Response(JSON.stringify({ok:true,bridgeVersion:74,contractVersion:2,profiles:[{profileId:'P'}]})));
   if(path.endsWith('/status'))return Promise.resolve(new Response(JSON.stringify({ok:true,bridgeVersion:74,configured:true})));
   if(path.includes('/balance')||path.includes('/v2/credit/sync')){providers++;providerEntered.resolve();if(phase==='provider')entered.resolve();return providerGate.promise}
   if(path.includes('/storage/v1/object/list/'))return Promise.resolve(new Response('[]'));
   return originalFetch(url,options);
 };
 const capability=kupa?(kind==='bank'?bank:credit):finance;
 let pending,renewal;
 try{
   pending=capability.commands[kupa?(kind==='bank'?'refreshBankBalance':'refreshCreditSync'):(kind==='bank'?'refreshBank':'refreshCredit')]();void pending.then(()=>{settled=true});
   if(phase==='renewal'){await providerEntered.promise;check(typeof tick==='function','missing lease heartbeat');renewal=tick()}
   await entered.promise;
   if(action==='dispose'){check(capability.runtime.dispose()===true,'dispose rejected');check(capability.runtime.dispose()===false,'dispose repeated')}
   else authenticate({user:{id:'another-owner'},access_token:'other',expires_at:9999999999});
   if(action==='dispose')check(scheduled.size===0,'disposed capability retained a lease wakeup');
   const draining=capability.runtime.drain().then(()=>{drained=true});await new Promise(resolve=>originalSetTimeout(resolve,0));
   check(capability.runtime.isPending()&&!settled&&!drained,'accepted lease/provider work was dropped');check(releases===0,'lease released under accepted work');
   claimGate.resolve();renewalGate.resolve();if(renewal)await renewal;
   providerGate.resolve(new Response(JSON.stringify(kind==='bank'?{ok:true,fetchedAt:'2026-10-14T10:00:00Z',accounts:{business:{balance:500,accountId:'stable-account',transactions:[]}}}:{ok:true,syncedAt:'2026-10-14T10:00:00Z',attemptedCount:1,profiles:[{profileId:'P',provider:'max',accounts:[]}],errors:[]})));
   await pending;await draining;
   check(!capability.runtime.isPending(),'lease work retained after cleanup');check(scheduled.size===0,'cleanup rearmed heartbeat');
   check(claims===(phase==='renewal'?2:1),'unexpected lease retry');check(providers===(phase==='acquisition'?0:1),'provider opened after acquisition authority ended');
   check(releases===(action==='dispose'?1:0),'cleanup used a new account or lost same-account authorization');
   check(JSON.stringify(kupa?{bank:state.bank,creditSync:state.creditSync}:checksSession.kupaCloudReadState)===projectionBefore,'retired result replaced financial projection');
   check(JSON.stringify(await db.load(identity))===mainBefore,'retired result changed Main journal');check(JSON.stringify(await db.load(owner+':shared-checks'))===sharedBefore,'retired result changed Shared journal');
   return {wakeupsStopped:true,acceptedWorkJoined:true,cleanupScoped:true,noRetries:true,projectionRetained:true,journalsRetained:true};
 }finally{
   claimGate.resolve();renewalGate.resolve();providerGate.resolve(new Response('{}'));if(pending)await pending.catch(()=>{});
   globalThis.fetch=originalFetch;globalThis.setTimeout=originalSetTimeout;globalThis.clearTimeout=originalClearTimeout;authenticate(null);
 }
})()"""

parser=argparse.ArgumentParser()
parser.add_argument('--site',choices=('kupa','orders'))
parser.add_argument('--kind',choices=('bank','credit'))
parser.add_argument('--phase',choices=('acquisition','provider','renewal'))
parser.add_argument('--action',choices=('dispose','account'))
args=parser.parse_args()
for site in ([args.site] if args.site else ('kupa','orders')):
    for kind in ([args.kind] if args.kind else ('bank','credit')):
        for phase in ([args.phase] if args.phase else ('acquisition','provider','renewal')):
            for action in ([args.action] if args.action else ('dispose','account')):
                with BrowserSession(ROOT / ('netunim-'+site+'/site'),'lease-ownership-'+site+'-'+kind+'-'+phase+'-'+action) as browser:
                    source=FLOW.replace('__SITE__',json.dumps(site)).replace('__KIND__',json.dumps(kind)).replace('__PHASE__',json.dumps(phase)).replace('__ACTION__',json.dumps(action))
                    result=browser.evaluate(source,timeout=45)
                    assert result and all(result.values()),result
                    browser._navigate()
                    restored=browser.evaluate("""(async()=>{await appReady;const recovered=await mainStorageV2.recoverReadOnly();return recovered?.state?.notes?.find(row=>row.id==='lease-confirmation-note')?.content})()""")
                    assert restored=='durable before lease confirmation',restored
                    assert not browser.drain_serious_errors()
                    print('PASS lease ownership '+site+'/'+kind+'/'+phase+'/'+action+': '+json.dumps(result))
