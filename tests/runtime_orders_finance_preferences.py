"""Production Finance preferences/UI and real IDB; synthetic storage faults/IO."""
import argparse
import json
import subprocess
from browser_harness import BrowserSession, ROOT

FLOW = r"""(async()=>{
 await appReady;
 const check=(ok,message)=>{if(!ok)throw Error(message)},kind=__KIND__,phase=__PHASE__,owner='aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa',stamp='2026-10-11T10:00:00Z';
 const deferred=()=>{let resolve;const promise=new Promise(done=>{resolve=done});return {promise,resolve}};
 syncDocument.stopPolling();finance.runtime.stop();
 const note={id:'orders-preferences-note',content:'exact retained durable content'};state.notes.push(note);
 storagePersistence.scheduleSave('preferences fixture',{domains:['notes'],operations:[{type:'put',collection:'notes',id:note.id,mode:'insert',index:state.notes.length-1,record:note}]});await mainStorageV2.commitPromise;
 cloudAuth.saveSession({user:{id:owner},access_token:'fixture',expires_at:9999999999});let main=null,shared=null;
 cloudTransport.readCloud=async()=>main;cloudTransport.readSharedChecksCloud=async()=>shared;
 cloudTransport.rpcSaveV2=async snapshot=>{main={revision:1,state:structuredClone(snapshot)};return {r:{ok:true},row:main}};
 cloudTransport.rpcSaveSharedChecksV2=async rows=>{shared={revision:1,state:{version:1,checks:structuredClone(rows),bankEvents:[]}};return {r:{ok:true},row:shared}};
 await storageV2Coordinator.startStorageV2OwnerTransfer({targetOwner:owner,intent:'upload-local'});session.storageProtocolBlocked=false;
 const {createStorageJournalDb}=await import('./assets/js/shared/storage-journal-idb.js'),db=createStorageJournalDb();
 const identity=owner+':orders',sharedIdentity=owner+':shared-checks',beforeMain=JSON.stringify(await db.load(identity)),beforeShared=JSON.stringify(await db.load(sharedIdentity));
 let remote={bank:{source:'hapoalim',currentBalance:100,bankSyncAt:'2020-01-01T00:00:00Z',archiveInitialized:true,archiveVersion:2,feed:{accountNumber:'synthetic-account',balance:100,syncedAt:'2020-01-01T00:00:00Z',transactions:[]}},creditSync:{version:3,syncedAt:'2020-01-01T00:00:00Z',profiles:[],errors:[]}},revision=1,leases=0,providers=0,commits=0,resets=0;
 checksSession.kupaCloudReadState=structuredClone(remote);checksSession.kupaReadRevision=1;checksSession.financeReadRevision=1;
 cloudTransport.readKupaReadOnlyCloud=async()=>({revision,financeRevision:revision,state:structuredClone(remote)});
 cloudTransport.readFinanceSyncDocument=async()=>({revision,state:structuredClone(remote)});
 cloudTransport.claimFinanceSyncLease=async()=>{leases++;return {acquired:true,leaseName:kind,leaseToken:'fixture',fenceEpoch:1}};cloudTransport.releaseFinanceSyncLease=async()=>true;
 cloudTransport.saveBankSyncSnapshot=async bank=>{commits++;remote={...remote,bank};revision++;return {finance_revision:revision,kupa_revision:revision}};
 cloudTransport.rpcSaveFinanceSync=async next=>{commits++;remote=structuredClone(next);revision++;return {r:{ok:true},row:{revision,state:remote}}};
 cloudTransport.syncBankTransactionsSnapshot=async()=>({sourcePayload:[],result:{total_count:0}});cloudTransport.readBankTransactions=async()=>[];cloudTransport.readBankTransactionSnapshot=async()=>null;
 syncChecks.syncSharedChecksFromCloud=async()=>true;stateSnapshots.checksHaveLocalWork=()=>false;
 const token='netunim_kupa_bank_bridge_token_v1',enabled=`netunim_orders_${kind}_auto_daily_v1`,attempt=`netunim_orders_${kind}_auto_attempt_v1`,mode='netunim_orders_credit_auto_mode_v1';
 localStorage.setItem(token,'synthetic-pairing');localStorage.setItem('netunim_orders_bank_auto_daily_v1','0');localStorage.setItem('netunim_orders_credit_auto_daily_v1','0');localStorage.setItem(enabled,'1');localStorage.setItem(mode,'forecast');localStorage.removeItem(attempt);
 const fetch=globalThis.fetch,get=Storage.prototype.getItem,set=Storage.prototype.setItem,entered=deferred(),provider=deferred();let injecting=true;
 globalThis.fetch=(url,options)=>{
   const path=String(url);
   if(path.includes('/v2/credit/status'))return Promise.resolve(new Response(JSON.stringify({ok:true,bridgeVersion:73,contractVersion:2,profiles:[{profileId:'P'}]})));
   if(path.endsWith('/status'))return Promise.resolve(new Response(JSON.stringify({ok:true,bridgeVersion:73,configured:true})));
   if(path.includes('/v2/credit/reset')){resets++;return Promise.resolve(new Response('{"ok":true}'))}
   if(path.includes('/balance')||path.includes('/v2/credit/sync')){providers++;entered.resolve();return provider.promise}
   if(path.includes('/storage/v1/object/list/'))return Promise.resolve(new Response('[]'));
   return fetch(url,options);
 };
 const matches=key=>phase==='token'?key===token:key===enabled||key===attempt||kind==='credit'&&key===mode;
 Storage.prototype.getItem=function(key){if(injecting&&phase==='read'&&matches(key)||injecting&&phase==='token'&&key===token)throw new DOMException('private preference detail','SecurityError');return get.call(this,key)};
 Storage.prototype.setItem=function(key,value){if(injecting&&((phase==='attempt'&&key===attempt)||(phase==='disable'||phase==='drain')&&key===enabled||(phase==='mode'||phase==='reset')&&key===mode))throw new DOMException('private preference detail','QuotaExceededError');return set.call(this,key,value)};
 const command=kind==='bank'?'Bank':'Credit',toggle=kind==='bank'?'setBankAutoEnabled':'setCreditAutoEnabled';
 try{
   if(phase==='attempt')check(await domainsFinanceController['refresh'+command]({auto:true})===false,'attempt persistence rejection reported success');
   if(phase==='disable')check(domainsFinanceController[toggle](false)===false,'failed disable reported success');
   if(phase==='mode')check(finance.commands.setCreditAutoMode('quick')===false,'failed mode reported success');
   if(phase==='malformed'){set.call(localStorage,attempt,'not-a-time');finance.queries.snapshot()}
   if(phase==='reset')check(await finance.commands.resetCreditSync()===true,'confirmed Finance reset was negated by optional preferences');
   if(phase==='drain'){
     injecting=false;const pending=domainsFinanceController['refresh'+command]();await entered.promise;
     injecting=true;check(domainsFinanceController[toggle](false)===false,'failed disable reported success');
     provider.resolve(new Response(JSON.stringify(kind==='bank'?{ok:true,fetchedAt:stamp,accounts:{business:{balance:500,accountId:'synthetic-account',transactions:[]}}}:{ok:true,syncedAt:stamp,attemptedCount:1,profiles:[{profileId:'P',provider:'max',accounts:[{accountNumber:'card',txns:[{id:'exact-card-id',date:stamp,chargedAmount:-12}]}]}],errors:[]})));
     check(await pending===true,'preference failure aborted an already-started remote commit');
   }
   const snapshot=finance.queries.snapshot();check(snapshot[kind+'Busy']===false,'preference failure stranded a busy flag');
   check(snapshot[kind+'AutoEnabled']===false&&snapshot[kind+'AutomationWarningCode'],'automatic permission remained effective without preference proof');
   check(snapshot[kind+'Error']==='','preference failure masqueraded as an unsuccessful Finance commit');
   ui.currentView='kupa';ui.kupaSubView=kind;finance.presentation.renderKupa();
   check(document.querySelector('[data-action="toggle-orders-'+kind+'-sync-options"]')?.classList.contains('warn'),'preference warning absent from mounted headline');
   check(document.getElementById(kind==='bank'?'ordersBankSyncPanel':'ordersCreditSyncPanel')?.textContent.includes(snapshot[kind+'AutomationWarningCode']),'preference diagnostic absent');
   check(!document.querySelector('[data-change="set-orders-'+kind+'-auto"]')?.checked,'effective automatic checkbox remained enabled');
   if(phase==='mode'||phase==='reset')check(get.call(localStorage,mode)==='forecast','failed mode write erased retained preference');
   if(phase==='malformed')check(get.call(localStorage,attempt)==='not-a-time','malformed preference was erased');
   injecting=false;
   // A valid login and reconnect/start do not clear the failed permission.
   cloudAuth.saveSession({user:{id:owner},access_token:'refreshed',expires_at:9999999999});
   finance.runtime.start();await domainsFinanceController['maybeAutoRefresh'+command]();finance.runtime.stop();
   check(providers===(phase==='drain'?1:0),'recovery/reconnect rescanned a provider');check(commits===(phase==='drain'||phase==='reset'?1:0),'unexpected Finance commit');check(resets===(phase==='reset'?1:0),'unexpected Bridge reset');
   check(leases===(phase==='drain'||phase==='reset'?1:0),'preference failure acquired a lease');
   check(JSON.stringify(await db.load(identity))===beforeMain,'preference failure changed Main records');check(JSON.stringify(await db.load(sharedIdentity))===beforeShared,'preference failure changed Shared records');
   const recovered=await mainStorageV2.recoverReadOnly();check(recovered.state.notes.find(row=>row.id===note.id)?.content===note.content,'retained note changed identity/content');
   if(phase==='drain'&&kind==='credit')check(finance.queries.snapshot().creditSync.profiles[0].accounts[0].txns[0].id==='exact-card-id','drained Credit lost its stable ID');
   if(phase==='malformed')set.call(localStorage,attempt,'0');
   check(domainsFinanceController[toggle](true)===true,'explicit re-enable could not confirm recovered preferences');check(!finance.queries.snapshot()[kind+'AutomationWarningCode'],'explicit re-enable kept obsolete warning');finance.runtime.stop();
   return {truthfulWarning:true,busyReleased:true,noDuplicateProvider:true,mainRetained:true,sharedRetained:true,noteRetained:true,explicitRecovery:true};
 }finally{Storage.prototype.getItem=get;Storage.prototype.setItem=set;globalThis.fetch=fetch;finance.runtime.stop();cloudAuth.saveSession(null)}
})()"""

parser = argparse.ArgumentParser()
parser.add_argument('--baseline', action='store_true')
parser.add_argument('--case', choices=('read', 'attempt', 'disable', 'mode', 'reset', 'malformed', 'token', 'drain'), action='append')
parser.add_argument('--kind', choices=('bank', 'credit'), action='append')
args = parser.parse_args()
for kind in args.kind or ('bank', 'credit'):
    for phase in args.case or (('attempt',) if args.baseline else ('read', 'attempt', 'disable', 'malformed', 'token', 'drain', 'mode', 'reset')):
        if kind == 'bank' and phase in ('mode', 'reset'):
            continue
        with BrowserSession(ROOT / 'netunim-orders/site', 'orders-preferences-' + kind + '-' + phase, auto_navigate=False) as browser:
            if args.baseline:
                for relative in ('domains/finance/controller.js', 'domains/finance/automation.js', 'integrations/bank-bridge.js'):
                    old = subprocess.check_output(['git', 'show', '8a2df32b71f13b988f8437b9656c918de333466e:netunim-orders/site/assets/js/' + relative], cwd=ROOT)
                    prepared = browser.tmp / 'site/assets/js' / relative
                    current = prepared.read_text(encoding='utf-8')
                    trailer = '\nexport const __testBindings=' + current.split('\nexport const __testBindings=', 1)[1] if '\nexport const __testBindings=' in current else ''
                    prepared.write_bytes(old + trailer.encode('utf-8'))
            browser._navigate()
            result = browser.evaluate(FLOW.replace('__KIND__', json.dumps(kind)).replace('__PHASE__', json.dumps(phase)), timeout=45)
            assert result and all(result.values()), result
            browser._navigate()
            restored = browser.evaluate("""(async()=>{await appReady;return (await mainStorageV2.recoverReadOnly()).state.notes.find(row=>row.id==='orders-preferences-note')})()""")
            assert restored['id'] == 'orders-preferences-note' and restored['content'] == 'exact retained durable content', restored
            assert not browser.drain_serious_errors()
            print('PASS Orders Finance preferences ' + kind + '/' + phase + ': ' + json.dumps(result))
