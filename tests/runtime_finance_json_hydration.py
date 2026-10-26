"""Actual Finance normalization/adoption and native IDB; no provider IO."""
import os
from browser_harness import BrowserSession, ROOT

FLOW=r"""(async()=>{
 const check=(value,message)=>{if(!value)throw Error(message)},noop=()=>{},clone=structuredClone;
 const {createStateNormalization}=await import('./assets/js/composition/state-normalization.js');
 const {createStorageJournal}=await import('./assets/js/shared/storage-journal.js');
 const {createStorageJournalDb}=await import('./assets/js/shared/storage-journal-idb.js');
 const {STORAGE_SCHEMAS}=await import('./assets/js/shared/storage-v2-schema.js');
 const {assertStorageJson}=await import('./assets/js/shared/storage-json-codec.js');
 const {createRemoteAdoption}=await import('./assets/js/sync/remote-adoption.js');
 const {createCloudPolling}=await import('./assets/js/sync/polling.js');
 const {createKupaBankSnapshotCommands}=await import('./assets/js/domains/bank/snapshot-commands.js');
 async function fixture(name){
  const model={state:{}},normalization=createStateNormalization({model});
  model.state=normalization.normalizeState({notes:[{id:'N',content:'retained note'}],bank:{source:'hapoalim',currentBalance:100,adjustments:[],snapshotToken:'old',snapshotSeq:1}});
  const db=createStorageJournalDb({name:'finance-hydration-'+name}),journal=createStorageJournal({owner:'A:kupa',schema:STORAGE_SCHEMAS.kupa,validate:assertStorageJson,db});
  const checkpoint=value=>{const next=clone(value);delete next.checks;return next};
  await journal.initializeCloudHead(1,checkpoint(model.state),{cloudState:normalization.prepareKupaCloudState(model.state),appMetadata:{mainProjectionVersion:2}});
  const session={connectionMode:'supabase',backendReady:true,dbRevision:1,financeRevision:1,localGeneration:0,serverInfo:{}},tab={primaryTab:true};
  let remote={revision:1,financeRevision:1,financeAvailable:true,state:clone(model.state)};
  const access={getCloudWriteScope:()=>({owner:'A:kupa',epoch:journal.epoch,accountOwner:'A',loginEpoch:1,writable:true}),writeScopeCurrent:()=>true,isOnline:()=>true,
    storageV2PreparationActive:()=>false,storageV2CloudOutboxActive:()=>true,assertAccountOwner:noop,markCloudMode:noop};
  const adoption=createRemoteAdoption({model,session,tab,access,projection:normalization,
    journal:{refreshStorageV2CloudState:()=>journal.cloudState(),replaceStorageV2CurrentState:(next,options)=>journal.replaceCurrentState(checkpoint(next),options),
      adoptStorageV2CloudHead:(revision,next,options)=>journal.adoptCloudHead(revision,options.cloudState,checkpoint(next),options),setStorageV2CloudControl:(...args)=>journal.setCloudControl(...args),
      clearStorageV2CloudControl:options=>journal.clearCloudControl({...options,project:normalization.prepareKupaCloudState})},
    transport:{readSupabaseDocument:async()=>clone(remote)},view:{render:noop,setSaveStatus:noop,setCloudHeaderStatus:noop,hideConnectScreen:noop,setConnectedStatus:noop},
    mirror:{backupSnapshotToComputer:async()=>{}},secondary:{syncSharedChecksFromCloud:async()=>{},refreshOrdersFinanceSummary:async()=>{}},write:{startCloudPolling:noop,requestStorageV2CloudSave:async()=>true}});
  const polling=createCloudPolling({model,session,tab,access,state:{prepareKupaCloudState:normalization.prepareKupaCloudState,refreshStorageV2CloudState:()=>journal.cloudState()},
    view:{setSaveStatus:noop,setCloudHeaderStatus:noop,toast:noop},remote:{readSupabaseDocument:async()=>clone(remote)},
    adoption:{...adoption,setStorageV2CloudControl:(...args)=>journal.setCloudControl(...args)},
    secondary:{pollSharedChecks:async()=>{},pollIndependentFinance:async()=>false,refreshOrdersFinanceSummary:async()=>{}},write:{requestStorageV2CloudSave:async()=>true},
    confirmation:{pollAccessCurrent:()=>true,markCloudPollSynced:async()=>true,markCloudPollFailure:error=>{throw error}}});
  return {model,session,journal,db,normalization,adoption,polling,get remote(){return remote},set remote(row){remote=row}};
 }
 if(__CASE__!=='bank'){
 const credit=await fixture('credit');
 const creditState={version:4,profiles:[{profileId:'P',provider:'max',accounts:[{accountNumber:'synthetic-card',months:[{month:'2026-10',status:'fresh',fetchStatus:'success',transactions:[{id:'issuer-tx',date:'2026-10-20',processedDate:'2026-10-20',chargedAmount:12}]}]}]}]};
 await credit.adoption.applyFinanceOnlyRow({state:{creditSync:creditState},financeRevision:2});
 const recovered=await credit.journal.recover();assertStorageJson(recovered.state);
 check(recovered.state.creditSync.profiles[0].accounts[0].txns[0].id==='issuer-tx','issuer identity lost during checkpoint');
 check(recovered.state.notes[0].content==='retained note'&&credit.session.financeRevision===2,'Finance hydration changed Main or failed to advance');
 check(!(await credit.journal.cloudState()).pending,'Finance cache created Main work');credit.polling.stop();}
 for(const expectedBalance of [500,700]){
 const revision=expectedBalance===700?3:2,bank=await fixture('bank-'+expectedBalance),candidate={...clone(bank.model.state.bank),currentBalance:500,snapshotToken:'new',snapshotSeq:2};let writes=0;
 const commands=createKupaBankSnapshotCommands({authority:{capture:()=>noop},bank:{mode:()=> 'supabase',manualCandidate:()=>candidate},
  checks:{hasLocalWork:()=>false,saveCloud:async()=>true,syncCloud:async()=>true},local:{state:()=>null,save:async()=>true,retry:async()=>true},
  cloud:{publish:async()=>{writes++;bank.remote={revision,financeRevision:revision,financeAvailable:true,state:{...bank.normalization.prepareKupaCloudState({...bank.model.state,bank:candidate}),bank:{...candidate,currentBalance:expectedBalance},creditSync:bank.model.state.creditSync}};return {finance_revision:2,kupa_revision:2,updated_at:'2026-10-26T18:56:17Z'};},
   refresh:async()=>{await bank.polling.poll();return {verified:bank.session.dbRevision>=2,revision:bank.session.dbRevision,financeRevision:bank.session.financeRevision};}},
  publication:{archive:noop,data:noop}});
 const result=await commands.commands.publishCloud(candidate,null,{assertCurrent:noop});
 const head=await bank.journal.cloudState();
 check(result.readoutVerified&&!head.control&&!head.pending&&head.base.revision===revision,'confirmed bank snapshot created a false Main conflict');
 check(bank.model.state.bank.currentBalance===expectedBalance&&bank.model.state.notes[0].content==='retained note'&&writes===1,'bank hydration overwrote a newer readout or repeated a write');
 const fresh=createStorageJournal({owner:'A:kupa',schema:STORAGE_SCHEMAS.kupa,validate:assertStorageJson,db:bank.db});
 const restart=await fresh.open();check(restart.state.bank.currentBalance===expectedBalance&&restart.state.notes[0].content==='retained note','fresh journal lost verified bank or note');
 // Repeated scans and an old clean journal fence may not create a new incident.
 bank.model.state.bank={...bank.model.state.bank};
 const again=await bank.polling.poll();check(again&&!(await bank.journal.cloudState()).control,'repeat read created conflict');
 const prior=await fixture('previous-fence-'+expectedBalance);
 await prior.journal.setCloudControl({conflict:{kind:'storage-v2-dirty-head',domain:'kupa'}});
 prior.session.cloudConflictPending=true;
 check(!(await prior.adoption.reviewCleanConflict(await prior.journal.cloudState())).control,'clean proven old fence did not retire');
 check(!prior.session.cloudConflictPending&&prior.model.state.notes[0].content==='retained note','old fence review changed business data');
 prior.polling.stop();
 bank.polling.stop();}
 return {creditCheckpoint:true,bankCheckpoint:true,newerReadoutRetained:true,noFalseConflict:true,oneRemoteWrite:true,notesRetained:true,restart:true};
})()"""

if __name__=='__main__':
    with BrowserSession(ROOT/'netunim-kupa/site','finance-json-hydration',instrument=False) as browser:
        result=browser.evaluate(FLOW.replace('__CASE__',repr(os.environ.get('NETUNIM_HYDRATION_CASE','all'))),timeout=45)
        assert all(result.values()),result
        assert not browser.drain_serious_errors()
        print('PASS Finance hydration and bank readback with native IDB:',result,flush=True)
