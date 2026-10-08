"""Kupa save confirmation races with real IndexedDB snapshots and restart."""
import json
from browser_harness import BrowserSession, ROOT

FLOW = r"""(async()=>{
 const clone=structuredClone,noop=()=>{},gate=()=>{let resolve;const promise=new Promise(done=>{resolve=done});return {promise,resolve}};
 const {INITIAL_STATE}=await import('./assets/js/state/constants.js');
 const {createStateNormalization}=await import('./assets/js/composition/state-normalization.js');
 const {createSyncMerge}=await import('./assets/js/sync/merge.js');
 const {createStorageV2Runtime}=await import('./assets/js/shared/storage-v2-runtime.js');
 const {createStorageJournal}=await import('./assets/js/shared/storage-journal.js');
 const {createStorageJournalDb}=await import('./assets/js/shared/storage-journal-idb.js');
 const {createStorageBrowser}=await import('./assets/js/storage/browser.js');
 const {createSyncDocument}=await import('./assets/js/sync/document.js');
 const {assertKupaEntityInvariants}=await import('./assets/js/state/validation.js');
 const scenario=SCENARIO,realDb=createStorageJournalDb({name:'kupa-save-confirmation'}),owner='save-confirmation-'+scenario,entered=gate(),release=gate();
 let holdNextRead=false,holdMaterialization=scenario==='no-flight',holdBackup=scenario==='backup',server=null,commits=0;
 const ledger=new Map();
 const db={...realDb,load:async(...args)=>{
   const stored=await realDb.load(...args);
   if(holdNextRead){holdNextRead=false;entered.resolve();await release.promise}
   return stored;
 }};
 async function make(initial=false){
   const model={state:clone(INITIAL_STATE)},normalization=createStateNormalization({model});
   model.state=normalization.normalizeState(model.state);const project=normalization.prepareKupaCloudState;
   const tab={primaryTab:true},session={localGeneration:0,dbRevision:5,connectionMode:'supabase',backendReady:true,cloudDocumentName:'main',serverInfo:{}},statuses=[];
   const storage=createStorageV2Runtime({app:'kupa',owner:()=>owner,primary:()=>tab.primaryTab,mode:()=> 'primary',
     validate:state=>assertKupaEntityInvariants(state,{required:true}),prepareCheckpoint:normalization.prepareKupaStorageState,
     createJournal:options=>createStorageJournal({...options,db})});
   if(initial){
     model.state.notes=[{id:'N',content:'original',createdAt:'2026-10-08',updatedAt:'2026-10-08'}];server={revision:5,state:project(model.state)};
     await storage.initializeCloudHead(5,model.state,{sourceOwner:owner,intent:'cloud-authoritative',cloudState:server.state});
   }
   const recovered=await storage.recoverForOwner({intent:'load-account'});model.state=normalization.normalizeState({...recovered.state,checks:[]});session.localGeneration=recovered.seq;
   const driver=createStorageBrowser({storageV2:storage,model,session,files:{},...normalization});
   session.dbRevision=(await driver.refreshStorageV2CloudState()).base.revision;
   const nativeMaterialize=storage.materializeFlight;
   storage.materializeFlight=async options=>{
     const result=await nativeMaterialize(options);
     // Hold the actual readonly IDB snapshot used by the driver's post-materialize
     // refresh. The read has completed; a real append commits before delivery.
     if(holdMaterialization&&!result){holdMaterialization=false;holdNextRead=true}
     return result;
   };
   const merge=createSyncMerge({normalizeState:normalization.normalizeState,prepareKupaCloudState:project});
   const api=createSyncDocument({model,session,tab,checksSession:{},...normalization,
     storageV2CloudOutboxActive:()=>driver.storageV2CloudOutboxActive(),assertAccountOwner:noop,
     refreshStorageV2CloudState:()=>driver.refreshStorageV2CloudState(),materializeStorageV2CloudFlight:options=>driver.materializeStorageV2CloudFlight(options),
     acknowledgeStorageV2CloudFlight:(...args)=>driver.acknowledgeStorageV2CloudFlight(...args),rejectStorageV2CloudFlight:(...args)=>driver.rejectStorageV2CloudFlight(...args),
     setStorageV2CloudControl:value=>driver.setStorageV2CloudControl(value),storageV2CommitPromise:()=>storage.commitPromise,
     mergeKupaCloudState3Way:merge.mergeKupaCloudState3Way,showSecondaryTabGuard:noop,reportError:noop,render:noop,toast:noop,
     setSaveStatus:noop,setCloudHeaderStatus:(...args)=>statuses.push(args),backupSnapshotToComputer:async()=>{if(holdBackup){holdBackup=false;entered.resolve();await release.promise}},
     supaRest:async(_path,options)=>{
       const request=JSON.parse(options.body),id=request.p_operation_id;
       if(!ledger.has(id)){
         if(request.p_expected_revision!==server.revision)throw Error('unexpected cloud revision');
         server={revision:server.revision+1,state:clone(request.p_state)};ledger.set(id,clone(server));commits++;
       }
       return {ok:true,text:async()=>JSON.stringify(ledger.get(id))};
     }});
   return {model,session,storage,driver,api,statuses};
 }
 let runtime=await make(true);
 async function edit(content){
   runtime.model.state.notes[0].content=content;runtime.session.localGeneration++;
   const write=runtime.storage.persist(runtime.model.state,{generation:runtime.session.localGeneration,operations:[{type:'put',collection:'notes',mode:'replace',id:'N',record:clone(runtime.model.state.notes[0])}]});
   if(!write.handled||!write.emergencyDurable)throw Error('fixture append lacks durability');await write.committed;
 }
 try{
   if(scenario==='backup')await edit('first-flight');
   const saving=runtime.api.requestStorageV2CloudSave('');await entered.promise;
   await edit('edited-during-'+scenario);
   release.resolve();const result=await saving,head=await runtime.driver.refreshStorageV2CloudState();
   const report={result,synced:runtime.statuses.some(([mode])=>mode==='synced'),pending:head.pending,seq:head.seq,ackSeq:head.base.ackSeq,commitsBeforeRestart:commits};
   const fresh=await make();runtime.api.stopCloudPolling();runtime=fresh;
   const restored=runtime.model.state.notes.find(row=>row.id==='N');
   report.restartRetained=restored?.content==='edited-during-'+scenario;
   report.recoveredSave=await runtime.api.requestStorageV2CloudSave('');
   const final=await runtime.driver.refreshStorageV2CloudState();
   report.cloudRetained=server.state.notes.filter(row=>row.id==='N'&&row.content==='edited-during-'+scenario).length===1;
   const expectedSeq=scenario==='backup'?2:1;
   report.monotonicAck=final.base.ackSeq===expectedSeq&&final.base.revision===5+expectedSeq&&!final.pending&&!final.flight;
   report.singleCommit=commits===expectedSeq&&ledger.size===expectedSeq;
   return report;
 }finally{release.resolve();runtime.api.stopCloudPolling()}
})()"""

for scenario in ('no-flight', 'backup'):
    with BrowserSession(ROOT / 'netunim-kupa/site', 'kupa-save-confirmation-' + scenario) as browser:
        result = browser.evaluate(FLOW.replace('SCENARIO', json.dumps(scenario)), timeout=30)
        print('Kupa real IDB ' + scenario + ' race: ' + str(result), flush=True)
        assert result['result'] is False and result['synced'] is False, result
        expected_ack = 1 if scenario == 'backup' else 0
        assert result['pending'] and result['seq'] == expected_ack + 1 and result['ackSeq'] == expected_ack and result['commitsBeforeRestart'] == expected_ack, result
        assert all(result[key] for key in ('restartRetained', 'recoveredSave', 'cloudRetained', 'monotonicAck', 'singleCommit')), result
        assert not browser.drain_serious_errors()
        print('PASS Kupa real IndexedDB ' + scenario + ' confirmation, fresh-runtime recovery and one effect per flight')
