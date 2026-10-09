"""Credit preferences failures through actual composition, UI and real IndexedDB.

Storage exceptions and Finance/Bridge responses are controlled synthetic ports.
This does not exhaust a real disk quota or contact live credit providers.
"""
import argparse
import json
import subprocess
from browser_harness import BrowserSession, ROOT

FLOW = r"""(async()=>{
 await appReady;
 const check=(ok,message)=>{if(!ok)throw Error(message)},phase=__PHASE__,owner='fixture-credit-preferences';
 financeAutomation.stop();syncDocument.stopCloudPolling();
 const note={id:'credit-preferences-note',content:'independent durable content'};state.notes.push(note);
 await storagePersistence.saveState('preferences fixture',{domains:['notes'],operations:[{type:'put',collection:'notes',id:note.id,mode:'insert',index:state.notes.length-1,record:note}]});await mainStorageV2.commitPromise;
 cloudAuth.storeSupaSession({user:{id:owner},access_token:'fixture',expires_at:9999999999});
 let main=null,checks=null,finance=null,commits=0,providerRuns=0,resets=0,leases=0;
 cloudTransport.readSupabaseDocument=async()=>main;cloudTransport.readSharedChecksDocument=async()=>checks;
 syncDocument.rpcSaveCloudV2=async snapshot=>{main={revision:(main?.revision||0)+1,state:structuredClone(snapshot)};return {r:{ok:true},row:main}};
 cloudTransport.rpcSaveSharedChecksV2=async rows=>{checks={revision:1,state:{version:1,checks:structuredClone(rows),bankEvents:[]}};return {r:{ok:true},row:checks}};
 await storageV2Coordinator.ownerUiPorts().startStorageV2OwnerTransfer({targetOwner:owner,intent:'upload-local'});
 session.connectionMode='supabase';session.backendReady=true;session.storageProtocolBlocked=false;
 cloudAuth.supaRest=async(path,options)=>{
   check(String(path).endsWith('/save_kupa_document_v6'),'unexpected Main RPC');const request=JSON.parse(options.body);
   check(request.p_expected_revision===main.revision,'unexpected Main revision');main={revision:main.revision+1,state:JSON.parse(JSON.stringify(request.p_state))};return new Response(JSON.stringify(main));
 };
 const {createStorageJournalDb}=await import('./assets/js/shared/storage-journal-idb.js'),db=createStorageJournalDb();
 const identity=owner+':kupa',shared=owner+':shared-checks',mainBefore=JSON.stringify(await db.load(identity)),sharedBefore=JSON.stringify(await db.load(shared));
 cloudTransport.claimFinanceSyncLease=async()=>{leases++;return {acquired:true,leaseName:'credit',leaseToken:'fixture',fenceEpoch:1}};cloudTransport.releaseFinanceSyncLease=async()=>true;
 cloudTransport.saveFinancePatch=async(mutator,_lease,options)=>{options?.assertCurrent?.();commits++;finance=JSON.parse(JSON.stringify(mutator({creditSync:state.creditSync})));return {saved:true,row:{revision:2,state:finance}}};
 cloudTransport.readSupabaseDocument=async()=>({revision:main.revision,financeRevision:finance?2:session.financeRevision,state:{...structuredClone(main.state),...structuredClone(finance||{creditSync:state.creditSync})}});
 const originalFetch=globalThis.fetch;
 globalThis.fetch=(url,options)=>{
   if(String(url).includes('/v2/credit/status'))return Promise.resolve(new Response(JSON.stringify({ok:true,bridgeVersion:73,contractVersion:2,profiles:[{profileId:'P'}]})));
   if(String(url).includes('/v2/credit/reset')){resets++;return Promise.resolve(new Response(JSON.stringify({ok:true})))}
   if(String(url).includes('/v2/credit/sync')){providerRuns++;throw Error('preferences failure must not enter a provider')}
   return originalFetch(url,options);
 };
 const enabled='netunim_kupa_credit_auto_daily_v1',mode='netunim_kupa_credit_auto_mode_v1',attempt='netunim_kupa_credit_auto_attempt_v1';
 localStorage.setItem('netunim_kupa_bank_bridge_token_v1','fixture-pairing');localStorage.setItem(enabled,'1');localStorage.setItem(mode,'forecast');localStorage.removeItem(attempt);
 if(phase==='read')uiNavigation.setPage('credit');
 const get=Storage.prototype.getItem,set=Storage.prototype.setItem;let injecting=true;
 Storage.prototype.getItem=function(key){if(injecting&&phase==='read'&&String(key).startsWith('netunim_kupa_credit_auto_'))throw new DOMException('controlled preference read','SecurityError');return get.call(this,key)};
 Storage.prototype.setItem=function(key,value){if(injecting&&(phase==='attempt'&&key===attempt||phase==='disable'&&key===enabled||phase==='reset'&&key===mode))throw new DOMException('controlled preference write','QuotaExceededError');return set.call(this,key,value)};
 uiModal.confirmDialog=async()=>true;const messages=[];uiStatus.toast=message=>messages.push(message);
 try{
   if(phase==='reset')await domainsCreditController.resetCreditSync();
   else if(phase==='disable')check(domainsCreditController.setCreditAutoRefresh(false)===false,'failed preference write falsely confirmed');
   else if(phase==='attempt'||phase==='read')await domainsCreditController.startAutoSync();
   const status=domainsCreditController.creditSyncUiState();check(status.autoEnabled===false&&status.preferenceWarning,'blocked preferences did not report a paused state');
   check(status.error==='','preference failure masqueraded as a Finance commit failure');
   if(phase!=='read')uiNavigation.setPage('credit');check(document.getElementById('creditSyncToggle')?.classList.contains('warn'),'Credit headline did not expose the preference warning');
   check(document.getElementById('creditSyncPanel')?.textContent.includes(status.preferenceWarningCode),'missing preference diagnostic code');
   check(!document.querySelector('[data-change="set-credit-auto-refresh"]')?.checked,'UI falsely displayed active automatic refresh');
   injecting=false;await domainsCreditController.startAutoSync();check(providerRuns===0&&leases===0,'storage recovery restarted a suspended provider operation');
   check(JSON.stringify(await db.load(shared))===sharedBefore,'optional preference failure changed Shared records');
   if(phase==='reset'){
     check(resets===1&&commits===1,'partial preferences interrupted the confirmed reset');check(finance.creditSync.profiles.length===0,'Finance reset not committed');
     check(get.call(localStorage,enabled)==='0'&&get.call(localStorage,mode)==='forecast','partial reset was hidden or old mode erased');
   }else{
     check(resets===0&&commits===0,'optional preference failure mutated Finance');check(JSON.stringify(await db.load(identity))===mainBefore,'preference failure changed Main journal');
   }
   const recovered=await mainStorageV2.recoverReadOnly();check(recovered.state.notes.find(row=>row.id===note.id)?.content===note.content,'note identity/content changed');
   if(phase==='disable'||phase==='read'){
     check(domainsCreditController.setCreditAutoRefresh(true)===true,'explicit enable did not recover preferences');check(!domainsCreditController.creditSyncUiState().preferenceWarning,'successful enable retained stale warning');
   }
   return {truthfulWarning:true,noProviderRetry:true,financeResetCompleted:phase!=='reset'||commits===1,sharedRetained:true,exactNote:true};
 }finally{Storage.prototype.getItem=get;Storage.prototype.setItem=set;globalThis.fetch=originalFetch;financeAutomation.stop();cloudAuth.storeSupaSession(null)}
})()"""

parser = argparse.ArgumentParser()
parser.add_argument('--baseline', action='store_true')
parser.add_argument('--phase', choices=('read', 'attempt', 'disable', 'reset'), action='append')
args = parser.parse_args()
for phase in args.phase or (('read',) if args.baseline else ('read', 'attempt', 'disable', 'reset')):
    with BrowserSession(ROOT / 'netunim-kupa/site', 'credit-preferences-' + phase, auto_navigate=False) as browser:
        if args.baseline:
            old = subprocess.check_output(['git', 'show', 'af1b7cbc84f56039d27fa843732e5198b41a9ffa:netunim-kupa/site/assets/js/domains/credit/controller.js'], cwd=ROOT)
            prepared = browser.tmp / 'site/assets/js/domains/credit/controller.js'
            trailer = prepared.read_text(encoding='utf-8').split('\nexport const __testBindings=', 1)[1]
            prepared.write_bytes(old + ('\nexport const __testBindings=' + trailer).encode('utf-8'))
        browser._navigate()
        result = browser.evaluate(FLOW.replace('__PHASE__', json.dumps(phase)), timeout=40)
        assert result and all(result.values()), result
        browser._navigate()
        restored = browser.evaluate("""(async()=>{await appReady;return (await mainStorageV2.recoverReadOnly()).state.notes.find(row=>row.id==='credit-preferences-note')})()""")
        assert restored['id'] == 'credit-preferences-note' and restored['content'] == 'independent durable content', restored
        errors = browser.drain_serious_errors()
        assert not errors, errors
        print('PASS Credit preferences ' + phase + ': ' + json.dumps(result))
