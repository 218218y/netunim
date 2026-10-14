"""Kupa uses the canonical cloud archive sequence while retaining Main/Shared IDB ownership."""
import argparse
import json
from browser_harness import BrowserSession, ROOT

FLOW = r"""(async()=>{
 const check=(ok,message)=>{if(!ok)throw Error(message)},deferred=()=>Promise.withResolvers();
 const phase=__PHASE__,action=__ACTION__,owner='aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa',stamp='2026-10-14T10:00:00.000Z';
 financeAutomation.stop();syncDocument.stopCloudPolling();
 const note={id:'bank-publication-note',content:'durable before publication'};state.notes.push(note);
 await storagePersistence.saveState('Bank publication fixture',{domains:['notes'],operations:[{type:'put',collection:'notes',id:note.id,mode:'insert',index:state.notes.length-1,record:note}]});await mainStorageV2.commitPromise;
 cloudAuth.storeSupaSession({user:{id:owner},access_token:'fixture',expires_at:9999999999});let main=null,shared=null;
 cloudTransport.readSupabaseDocument=async()=>main;cloudTransport.readSharedChecksDocument=async()=>shared;
 syncDocument.rpcSaveCloudV2=async snapshot=>{main={revision:1,state:structuredClone(snapshot)};return {r:{ok:true},row:main}};
 cloudTransport.rpcSaveSharedChecksV2=async rows=>{shared={revision:1,state:{version:1,checks:structuredClone(rows),bankEvents:[]}};return {r:{ok:true},row:shared}};
 await storageV2Coordinator.ownerUiPorts().startStorageV2OwnerTransfer({targetOwner:owner,intent:'upload-local'});session.connectionMode='supabase';session.backendReady=true;session.storageProtocolBlocked=false;
 const {createStorageJournalDb}=await import('./assets/js/shared/storage-journal-idb.js'),db=createStorageJournalDb(),identity=owner+':kupa',sharedIdentity=owner+':shared-checks';
 const beforeMain=JSON.stringify(await db.load(identity)),beforeShared=JSON.stringify(await db.load(sharedIdentity));
 check(beforeMain&&beforeShared,'real journals missing');
 const remote={bank:{source:'hapoalim',currentBalance:100,bankSyncAt:'2020-01-01T00:00:00Z',archiveInitialized:true,archiveVersion:2,feed:{accountNumber:'same-account',balance:100,syncedAt:stamp,transactions:[]}},creditSync:{profiles:[],errors:[]}};
 state.bank=structuredClone(remote.bank);
 localStorage.setItem('netunim_kupa_bank_bridge_token_v1','pairing-A');
 for(const key of ['netunim_kupa_bank_auto_daily_v1','netunim_kupa_credit_auto_daily_v1'])localStorage.setItem(key,'0');
 const gate=deferred(),entered=deferred(),originalFetch=globalThis.fetch;let released=0,writes=0,checksReads=0,drained=false,settled=false;
 const events=[],wait=async name=>{events.push(name);if(name===phase){entered.resolve();await gate.promise}};
 cloudTransport.claimFinanceSyncLease=async(leaseName,leaseToken)=>({acquired:true,leaseName,leaseToken,fenceEpoch:1});
 cloudTransport.releaseFinanceSyncLease=async(_kind,_token,options)=>{options.assertCurrent();released++;return true};
 cloudTransport.readSupabaseDocument=async()=>({revision:Number(session.dbRevision),financeRevision:Number(session.financeRevision),state:{...structuredClone(state),bank:structuredClone(remote.bank)}});
 cloudTransport.readFinanceSyncDocument=async()=>({revision:1,state:structuredClone(remote)});
 checks.commands.sync=async()=>{if(++checksReads===2)await wait('checks');return true};checks.queries.hasLocalWork=()=>false;
 cloudTransport.syncBankTransactionsSnapshot=async()=>{await wait('transactions');return {sourcePayload:[],result:{total_count:0}}};
 cloudTransport.readBankTransactions=async()=>{await wait('archive');return []};cloudTransport.readBankTransactionSnapshot=async()=>null;
 cloudTransport.saveBankSyncSnapshot=async()=>{writes++;await wait('publication');return {finance_revision:2,kupa_revision:2}};
 globalThis.fetch=(url,options)=>{
   const path=String(url);
   if(path.endsWith('/status'))return Promise.resolve(new Response(JSON.stringify({ok:true,bridgeVersion:74,configured:true})));
   if(path.includes('/balance'))return Promise.resolve(new Response(JSON.stringify({ok:true,fetchedAt:stamp,accounts:{business:{balance:500,accountId:'same-account',transactions:[]}}})));
   if(path.includes('/storage/v1/object/list/'))return Promise.resolve(new Response('[]'));
   return originalFetch(url,options);
 };
 let pending;
 try{
   const beforeReadout=JSON.stringify(state.bank);
   pending=bank.commands.refreshBankBalance();void pending.finally(()=>{settled=true});await entered.promise;
   if(action==='pairing')localStorage.setItem('netunim_kupa_bank_bridge_token_v1','pairing-B');
   else if(action==='account')cloudAuth.storeSupaSession({user:{id:'bbbbbbbb-bbbb-4bbb-bbbb-bbbbbbbbbbbb'},access_token:'other',expires_at:9999999999});
   else {check(bank.runtime.dispose()===true,'dispose rejected');check(bank.runtime.dispose()===false,'dispose was not idempotent')}
   const draining=bank.runtime.drain().then(()=>{drained=true});await new Promise(resolve=>setTimeout(resolve,0));
   check(bank.runtime.isPending(),'accepted Bank work disappeared');check(!drained&&!settled,'accepted Bank work was abandoned');check(released===0,'lease released before accepted stage settled');
   const accepted=[...events];gate.resolve();check(await pending===false,'stale Bank result reported success');await draining;
   check(!bank.runtime.isPending(),'Bank work retained after drain');check(JSON.stringify(events)===JSON.stringify(accepted),'a later stage entered after authority ended');
   check(writes===(phase==='publication'?1:0),'an unaccepted write entered');check(released===(action!=='account'?1:0),'lease cleanup used replacement account or lost same-account authority');
   check(JSON.stringify(state.bank)===beforeReadout,'stale Bank result replaced readout');
   check(JSON.stringify(await db.load(identity))===beforeMain,'publication changed Main journal');check(JSON.stringify(await db.load(sharedIdentity))===beforeShared,'publication changed Shared journal');
   check(state.notes.find(row=>row.id===note.id)?.content===note.content,'note identity/content lost');
   return {acceptedWorkDrained:true,laterStagesFenced:true,leaseRetained:true,readoutRetained:true,mainRetained:true,sharedRetained:true};
 }finally{gate.resolve();if(pending)await pending.catch(()=>{});globalThis.fetch=originalFetch;bank.runtime.stop();cloudAuth.storeSupaSession(null)}
})()"""

parser = argparse.ArgumentParser()
parser.add_argument('--phase', choices=('transactions', 'archive'))
parser.add_argument('--action', choices=('pairing', 'account', 'dispose'))
args = parser.parse_args()
for phase in ([args.phase] if args.phase else ('transactions', 'archive')):
    for action in ([args.action] if args.action else ('pairing', 'account', 'dispose')):
        with BrowserSession(ROOT / 'netunim-kupa/site', 'bank-publication-' + phase + '-' + action) as browser:
            result = browser.evaluate(FLOW.replace('__PHASE__', json.dumps(phase)).replace('__ACTION__', json.dumps(action)), timeout=45)
            assert result and all(result.values()), result
            browser._navigate()
            restored = browser.evaluate("""(async()=>{await appReady;const recovered=await mainStorageV2.recoverReadOnly();return recovered?.state?.notes?.find(row=>row.id==='bank-publication-note')?.content})()""")
            assert restored == 'durable before publication', restored
            assert not browser.drain_serious_errors()
            print('PASS Kupa canonical Bank archive ' + phase + '/' + action + ': ' + json.dumps(result))
