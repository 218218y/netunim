"""Confirmed Finance write vs local follow-up, through Kupa composition and real IDB.

The Finance server and follow-up failures are controlled ports, not live issuers,
PostgreSQL commits or an actual quota exhaustion. Recovery uses the real journal.
"""
import json
from browser_harness import BrowserSession, ROOT

FLOW = r"""(async()=>{
 const check=(ok,message)=>{if(!ok)throw Error(message)};
 const originalFetch=globalThis.fetch,owner='fixture-credit-publication',action=__ACTION__,failure=__FAILURE__;
 financeAutomation.stop();syncDocument.stopCloudPolling();
 const note={id:'credit-publication-note',content:'retained through ancillary failure'};state.notes.push(note);
 await storagePersistence.saveState('credit publication fixture',{domains:['notes'],operations:[{type:'put',collection:'notes',id:note.id,mode:'insert',index:state.notes.length-1,record:note}]});await mainStorageV2.commitPromise;
 cloudAuth.storeSupaSession({user:{id:owner},access_token:'fixture',expires_at:9999999999});
 let main=null,checks=null,finance=null,commits=0,providerRuns=0,resets=0,reads=0,unavailable=false;
 cloudTransport.readSupabaseDocument=async()=>main;cloudTransport.readSharedChecksDocument=async()=>checks;
 syncDocument.rpcSaveCloudV2=async snapshot=>{main={revision:(main?.revision||0)+1,state:structuredClone(snapshot)};return {r:{ok:true},row:main}};
 cloudTransport.rpcSaveSharedChecksV2=async rows=>{checks={revision:1,state:{version:1,checks:structuredClone(rows),bankEvents:[]}};return {r:{ok:true},row:checks}};
 await storageV2Coordinator.ownerUiPorts().startStorageV2OwnerTransfer({targetOwner:owner,intent:'upload-local'});
 session.connectionMode='supabase';session.backendReady=true;session.storageProtocolBlocked=false;
 // The initial transfer uses the public command. Subsequent Main saves use
 // the RPC closure's auth transport; bind that controlled server boundary too.
 cloudAuth.supaRest=async(path,options)=>{
   check(String(path).endsWith('/save_kupa_document_v6'),'unexpected fixture RPC: '+path);
   const request=JSON.parse(options.body);check(request.p_expected_revision===main.revision,'unexpected fixture Main revision');
   main={revision:main.revision+1,state:JSON.parse(JSON.stringify(request.p_state))};
   return new Response(JSON.stringify(main));
 };
 const {createStorageJournalDb}=await import('./assets/js/shared/storage-journal-idb.js');const db=createStorageJournalDb(),identity=owner+':kupa',durableBefore=JSON.stringify(await db.load(identity));
 localStorage.setItem('netunim_kupa_bank_bridge_token_v1','fixture-pairing');localStorage.setItem('netunim_kupa_credit_auto_daily_v1','0');
 cloudTransport.claimFinanceSyncLease=async()=>({acquired:true,leaseName:'credit',leaseToken:'fixture',fenceEpoch:1});cloudTransport.releaseFinanceSyncLease=async()=>true;
 cloudTransport.saveFinancePatch=async(mutator,_lease,options)=>{options?.assertCurrent?.();commits++;finance=JSON.parse(JSON.stringify(mutator({creditSync:state.creditSync})));return {saved:true,row:{revision:2,state:finance}}};
 cloudTransport.readSupabaseDocument=async()=>{reads++;return unavailable?null:{revision:main.revision,financeRevision:finance?2:session.financeRevision,state:{...structuredClone(main.state),...structuredClone(finance||{creditSync:state.creditSync})}}};
 globalThis.fetch=(url,options)=>{
   if(String(url).includes('/v2/credit/status'))return Promise.resolve(new Response(JSON.stringify({ok:true,bridgeVersion:73,contractVersion:2,profiles:[{profileId:'P'}]})));
   if(String(url).includes('/v2/credit/reset')){resets++;return Promise.resolve(new Response(JSON.stringify({ok:true})))}
   if(String(url).includes('/v2/credit/sync')){providerRuns++;return Promise.resolve(new Response(JSON.stringify({ok:true,syncedAt:'2026-10-09T10:00:00Z',attemptedCount:1,profiles:[{profileId:'P',provider:'max',accounts:[{accountNumber:'card',txns:[{id:'stable-issuer-tx',date:'2026-10-09',processedDate:'2026-10-09',chargedAmount:12}]}]}],errors:[]})))}
   return originalFetch(url,options);
 };
 const save=storagePersistence.saveState;let followupFailure=failure,followups=0,localResult=null;
 storagePersistence.saveState=async(...args)=>{followups++;if(followupFailure==='throw')throw new DOMException('controlled ancillary failure','QuotaExceededError');if(followupFailure==='false')return false;try{localResult=await save(...args);return localResult}catch(error){localResult={error:error.message,stack:error.stack};throw error}};
 uiModal.confirmDialog=async()=>true;const messages=[];uiStatus.toast=message=>messages.push(message);
 uiNavigation.setPage('credit');
 const result=action==='refresh'?await domainsCreditController.refreshCreditSync():action==='settings'?await domainsCreditController.saveCreditCardOrder([]):await domainsCreditController.resetCreditSync();
 if(action==='settings')check(result===true,'a confirmed settings commit was reported as failed');
 check(commits===1&&followups===1,'unexpected commit/follow-up count');
 check(JSON.stringify(await db.load(identity))===durableBefore,'injected follow-up failure changed durable Main records');
 const warning=domainsCreditController.creditSyncUiState();check(warning.publicationWarning&&warning.error==='','ancillary failure masqueraded as a provider/commit failure');
 check(JSON.stringify(state.creditSync)===JSON.stringify(finance.creditSync),'confirmed credit result not published');
 check(document.getElementById('creditSyncToggle')?.classList.contains('warn'),'Credit headline claimed ordinary success');
 check(document.querySelector('[data-action="retry-credit-publication"]'),'missing recovery action');
 unavailable=true;const before=JSON.stringify(state.creditSync);check(await domainsCreditController.retryCreditPublication()===false,'unavailable read confirmed recovery');
 check(JSON.stringify(state.creditSync)===before&&domainsCreditController.creditSyncUiState().publicationWarning,'unverified read discarded the last confirmed result');
 unavailable=false;followupFailure=null;const beforeReads=reads;
 const completed=await uiActions['retry-credit-publication']({},null);
 const head=await mainStorageV2.cloudState();
 check(completed===true,'real local follow-up did not complete: '+JSON.stringify({localResult,messages,warning:domainsCreditController.creditSyncUiState().publicationWarningCode,main:mainStorageV2.diagnostics,cloudConflict:session.cloudConflictPending,revision:session.dbRevision,head:{seq:head.seq,baseRevision:head.base.revision,ackSeq:head.base.ackSeq,pending:head.pending,flight:!!head.flight,control:head.control},saveStatus:document.getElementById('saveIndicator')?.textContent}));await mainStorageV2.commitPromise;
 check(reads>beforeReads,'recovery did not re-read the authoritative Finance document');
 check(commits===1&&providerRuns===(action==='refresh'?1:0)&&resets===(action==='reset'?1:0),'recovery repeated a provider or remote effect');
 check(!domainsCreditController.creditSyncUiState().publicationWarning,'completed follow-up retained the warning');
 check(!document.querySelector('[data-action="retry-credit-publication"]'),'completed recovery left a stale action');
 const recovered=await mainStorageV2.recoverReadOnly();check(recovered.state.notes.find(row=>row.id===note.id)?.content===note.content,'note identity/content lost');
 const {normalizeCreditSync}=await import('./assets/js/domains/credit/sync-feed.js');
 if(action==='refresh'){const tx=normalizeCreditSync(recovered.state.creditSync).profiles[0].accounts[0].txns[0];check(tx.id==='stable-issuer-tx'&&tx.chargedAmount===12,'real journal recovery changed the issuer transaction ID/content')}
 globalThis.fetch=originalFetch;storagePersistence.saveState=save;financeAutomation.stop();cloudAuth.storeSupaSession(null);
 return {truthfulWarning:true,journalRetained:true,readBasedRecovery:true,noRepeatedEffect:true,exactIds:true};
})()"""

for action in ('refresh', 'settings', 'reset'):
    for failure in ('false', 'throw'):
        with BrowserSession(ROOT / 'netunim-kupa/site', 'credit-publication-' + action + '-' + failure) as browser:
            result = browser.evaluate(FLOW.replace('__ACTION__', json.dumps(action)).replace('__FAILURE__', json.dumps(failure)), timeout=45)
            assert result and all(result.values()), result
            browser._navigate()
            restored = browser.evaluate("""(async()=>{await appReady;const recovered=await mainStorageV2.recoverReadOnly();const {normalizeCreditSync}=await import('./assets/js/domains/credit/sync-feed.js');return {note:recovered?.state?.notes?.find(row=>row.id==='credit-publication-note')?.content,transactions:normalizeCreditSync(recovered?.state?.creditSync).profiles.flatMap(profile=>profile.accounts.flatMap(account=>account.txns)).map(tx=>({id:tx.id,chargedAmount:tx.chargedAmount}))}})()""")
            assert restored['note'] == 'retained through ancillary failure', restored
            if action == 'refresh':
                assert {'id': 'stable-issuer-tx', 'chargedAmount': 12} in restored['transactions'], restored
            errors = browser.drain_serious_errors()
            assert not errors, errors
            print('PASS Kupa Credit publication ' + action + '/' + failure + ': ' + json.dumps(result))
