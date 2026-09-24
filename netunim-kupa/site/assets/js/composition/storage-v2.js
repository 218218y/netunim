import {createStorageOwnerBinding} from '../shared/storage-owner.js';
import {createStorageV2BootstrapCoordinator} from '../shared/storage-v2-bootstrap.js';
import {createStorageV2ProductionTransition} from '../shared/storage-v2-production-transition.js';
import {createStorageV2Runtime,storageV2Mode} from '../shared/storage-v2-runtime.js';
import {createStorageV2CloudPorts} from '../storage/v2-cloud-ports.js';
import {createSharedChecksV2Composition} from '../shared/shared-checks-v2-composition.js';
import {createStorageV2LocalBirth,verifyStorageV2LocalEngine} from '../shared/storage-v2-local-birth.js';
import {createLegacyLocalBirthSource} from '../storage/local-birth-source.js';
import {createSpreadsheetStore} from '../shared/spreadsheet-store.js';
import {migrateLegacySpreadsheet} from '../shared/spreadsheet-model.js';
import {equalSyncJson} from '../shared/cloud-sync.js';
import {createStorageV2OwnerTransfer} from '../shared/storage-v2-owner-transfer.js';
import {createStorageV2DetachedTarget} from '../shared/storage-v2-detached-target.js';
import {createStorageV2FencedRecovery} from '../shared/storage-v2-fenced-recovery.js';
import {createSharedChecksV2Runtime} from '../shared/shared-checks-v2-runtime.js';
import {createSharedChecksStorageV2} from '../shared/shared-checks-storage-v2.js';
import {createStorageJournalDb} from '../shared/storage-journal-idb.js';
import {createStateNormalization} from '../state/normalization.js';
import {createSyncChecks} from '../sync/checks.js';
import {normalizeSharedChecks} from '../domains/checks/model.js';
import {assertKupaEntityInvariants,assertValidCloudState} from '../state/validation.js';
import {INITIAL_STATE} from '../state/constants.js';

// Owns the Kupa storage migration state machines. main.js supplies application
// ports, but no longer carries drain/bootstrap/owner-adoption orchestration.
export function createKupaStorageV2Coordinator({tab,session,storage=globalThis.localStorage}={}){
  if(!tab||!session)throw new Error('kupa_storage_v2_tab_required');
  const owner=createStorageOwnerBinding({app:'kupa',primary:()=>tab.primaryTab});
  const bootstrap=createStorageV2BootstrapCoordinator({app:'kupa',owner:()=>owner.current(),primary:()=>tab.primaryTab});
  let transition=null,localBirth=null,ownerTransfer=null,fencedRecovery=null,transferRebinding=false,legacyDrain=false,ports=null;
  const requirePorts=()=>{if(!ports)throw new Error('kupa_storage_v2_not_configured');return ports};
  const preparing=()=>owner.locked||transferRebinding||!!ownerTransfer?.preparing||!!localBirth?.preparing||!!transition?.preparing||!!(bootstrap.hasGroup&&bootstrap.group?.phase!=='complete');
  const legacyDrainActive=()=>legacyDrain&&!session.storageProtocolBlocked;
  const legacyWriteAllowed=()=>!session.storageProtocolBlocked&&owner.writable&&(!preparing()||legacyDrain);
  const legacyChecksWriteAllowed=()=>legacyWriteAllowed()&&storage?.getItem(`netunim-storage-cutover-version:kupa:${owner.current()}`)!=='2'&&(owner.current()!=='local'||storage?.getItem('netunim-storage-engine-version:kupa:local')!=='2');
  const mode=()=>storageV2Mode('kupa',storage,owner.current(),{preparing:preparing()});
  const createRuntime=options=>createStorageV2Runtime({app:'kupa',owner:()=>owner.current(),primary:()=>tab.primaryTab&&owner.writable,mode,...options});
  const createCloudPorts=storageBrowser=>({...createStorageV2CloudPorts(storageBrowser),storageV2PrimaryRequested:()=>['primary','preparing'].includes(mode()),storageV2BootstrapStatus:()=>bootstrap.load(),prepareStorageV2Bootstrap:(...args)=>bootstrap.prepare(...args),advanceStorageV2Bootstrap:(...args)=>bootstrap.advance(...args)});
  const shadowEnabled=(runtime,key)=>{if(runtime.cutoverActive)return false;if(mode()==='shadow')return true;try{return storage?.getItem(key)==='1'}catch{return false}};
  const status=(runtime,authenticated)=>({active:runtime.cutoverActive,preparing:preparing(),canBegin:tab.primaryTab&&owner.current()!=='local'&&!!authenticated&&!runtime.cutoverActive});
  const observerPorts=(runtime,key)=>({owner:()=>owner.current(),primary:()=>tab.primaryTab&&owner.writable,enabled:()=>shadowEnabled(runtime,key)});
  const pendingLegacyWriteAllowed=runtime=>legacyWriteAllowed()&&!runtime.cutoverActive;
  const createSharedComposition=({model,checksSession,domainRevisions,main,stateNormalization,syncChecksState,getSyncChecks,getCloudTransport})=>createSharedChecksV2Composition({
    site:'kupa',owner:()=>owner.current(),primary:()=>tab.primaryTab&&owner.writable,preparing,
    model,checksSession,eventsKey:'sharedChecksBankEvents',domainRevisions,main,
    merge:(...args)=>getSyncChecks().mergeSharedChecks(...args),readRemote:(...args)=>getCloudTransport().readSharedChecksDocument(...args),rpc:(...args)=>getCloudTransport().rpcSaveSharedChecksV2(...args),verifyLegacyClean:(...args)=>syncChecksState.verifyLegacyChecksClean(...args),
    validateMainCloud:state=>assertValidCloudState(state,'Kupa V2 restore cloud state'),applyMainState:state=>{model.state=stateNormalization.normalizeState({...state,checks:model.state.checks});domainRevisions.touchAll()},
  });

  async function verifyLegacyClean(){
    const p=requirePorts(),main=await p.storagePending.getCloudPending();
    return !main&&p.storagePending.cloudPendingHeadVerifiedCleanSync()&&!p.storagePending.cloudPendingExistsSync()&&(await p.syncChecksState.verifyLegacyChecksClean())===true;
  }
  async function drainLegacy(){
    const p=requirePorts(),previousMode=p.session.connectionMode,previousReady=p.session.backendReady;
    legacyDrain=true;p.session.connectionMode='supabase';p.session.backendReady=true;
    try{
      const mainPending=await p.storagePending.getCloudPending();
      if(mainPending){const ok=await p.syncDocument.reconcileCloudPending(null,{legacyDrain:true});if(!ok&&await p.storagePending.getCloudPending())throw new Error('storage_cutover_main_legacy_drain_incomplete')}
      const checksPending=await p.syncChecksState.getSharedChecksPending();
      if(checksPending){const ok=await p.syncChecks.saveSharedChecksToCloud('',{legacyDrain:true});if(!ok&&await p.syncChecksState.getSharedChecksPending())throw new Error('storage_cutover_shared_legacy_drain_incomplete')}
      if(await verifyLegacyClean()!==true)throw new Error('storage_cutover_legacy_pending');
      return {main:true,shared:true};
    }finally{
      legacyDrain=false;
      if(!p.storageShadow.cutoverActive){p.session.connectionMode=previousMode;p.session.backendReady=previousReady}
    }
  }
  function detachedNormalization(){return createStateNormalization({model:{state:{},lastNormalizeRemovedCredits:0},externalWorkbooks:true})}
  async function settleTransferSource({sourceOwner}){
    const p=requirePorts();
    // beginHandoff intentionally changes the live mode to "preparing". Verify
    // the durable source marker instead of relying on that transient mode.
    if(sourceOwner!==owner.current()||!owner.locked)throw new Error('kupa_transfer_source_not_primary');
    const marked=sourceOwner==='local'
      ?await verifyStorageV2LocalEngine({app:'kupa',owner:()=>sourceOwner})
      :await p.verifyStorageCutover();
    if(marked!==true||sourceOwner!==owner.current()||!owner.locked)throw new Error('kupa_transfer_source_not_primary');
    await Promise.all([p.storageShadow.commitPromise,p.sharedChecksV2.commitPromise,p.files.browserStateWritePromise,p.files.storageV2CommitPromise,
      p.session.saveQueue,p.session.cloudSavePromise,p.session.cloudOutboxCommitPromise,p.checksSession.sharedChecksSavePromise,
      p.checksSession.sharedChecksPullPromise,p.checksSession.sharedChecksOutboxCommitPromise].filter(Boolean));
    if(p.session.cloudSyncBusy||p.session.cloudWriteBusy||p.checksSession.sharedChecksBusy||await verifyLegacyClean()!==true)throw new Error('kupa_transfer_source_unsettled');
    const boundary=await createStorageJournalDb().readBoundary(sourceOwner);
    if(boundary&&boundary.phase!=='complete')throw new Error('kupa_transfer_source_boundary_pending');
    const normalization=detachedNormalization(),sourceMain=createStorageV2Runtime({app:'kupa',owner:()=>sourceOwner,primary:()=>tab.primaryTab,mode:()=> 'preparing',
      validate:state=>assertKupaEntityInvariants(state,{includeChecks:true,required:true}),prepareCheckpoint:state=>normalization.prepareKupaStorageState(state),prepareOperation:operation=>normalization.prepareKupaStorageOperation(operation)});
    const mainRecovered=await sourceMain.recoverForOwner({intent:'load-account'}),mainCloud=mainRecovered?await sourceMain.cloudState({validateBase:value=>assertValidCloudState(value,'Kupa transfer source')}):null;
    const sourceShared=createSharedChecksStorageV2({owner:()=>sourceOwner,primary:()=>tab.primaryTab,role:'primary'}),sharedRecovered=await sourceShared.open(),sharedCloud=sharedRecovered?await sourceShared.cloudState():null;
    if(!mainRecovered||!sharedRecovered||!mainCloud||!sharedCloud)throw new Error('kupa_transfer_source_checkpoint_missing');
    if(sourceOwner==='local'){
      if(mainCloud.base||mainCloud.flight||mainCloud.control||sharedCloud.base||sharedCloud.flight||sharedCloud.control)throw new Error('kupa_transfer_local_cloud_head_exists');
    }else{
      if(!mainCloud.base||!sharedCloud.base||mainCloud.pending||sharedCloud.pending||mainCloud.flight||sharedCloud.flight||mainCloud.control||sharedCloud.control||mainCloud.base.ackSeq!==mainCloud.seq||sharedCloud.base.ackSeq!==sharedCloud.seq||
        !equalSyncJson(mainCloud.base.state,normalization.prepareKupaCloudState(mainRecovered.state))||!equalSyncJson(sharedCloud.base.state,sharedRecovered.state))throw new Error('kupa_transfer_source_cloud_unsettled');
    }
    if(sourceOwner!==owner.current()||mode()!=='primary')throw new Error('kupa_transfer_source_changed');
    return {main:{seq:mainRecovered.seq,state:normalization.prepareKupaCloudState(mainRecovered.state),fullState:mainRecovered.state},
      shared:{seq:sharedRecovered.seq,state:sharedRecovered.state}};
  }
  function createDetachedTarget(targetOwner){
    const p=requirePorts(),normalization=detachedNormalization(),target=()=>targetOwner;
    const targetMain=createStorageV2Runtime({app:'kupa',owner:target,primary:()=>tab.primaryTab,mode:()=> 'preparing',
      validate:state=>assertKupaEntityInvariants(state,{includeChecks:true,required:true}),prepareCheckpoint:state=>normalization.prepareKupaStorageState(state),prepareOperation:operation=>normalization.prepareKupaStorageOperation(operation)});
    let detachedSharedState={checks:[],bankEvents:[]};
    const merge=createSyncChecks({checksSession:{sharedChecksBootstrapActive:false},model:{state:{checks:[]}}}).mergeSharedChecks;
    const targetShared=createSharedChecksV2Runtime({site:'kupa',owner:target,primary:()=>tab.primaryTab,mode:()=> 'preparing',
      readState:()=>detachedSharedState,applyState:value=>{detachedSharedState=structuredClone(value)},merge,
      readRemote:()=>p.cloudTransport.readSharedChecksDocument(),rpc:(...args)=>p.cloudTransport.rpcSaveSharedChecksV2(...args),
      verifyLegacyClean:()=>p.syncChecksState.verifyLegacyChecksClean()});
    return createStorageV2DetachedTarget({app:'kupa',targetOwner,primary:()=>tab.primaryTab,main:targetMain,shared:targetShared,
      readMainRemote:()=>p.cloudTransport.readSupabaseDocument(),projectMainRemote:row=>normalization.prepareKupaCloudState(row.state),
      readSharedRemote:()=>p.cloudTransport.readSharedChecksDocument(),projectSharedRemote:row=>({checks:row.state.checks,bankEvents:row.state.bankEvents}),
      composeMainState:(cloud,shared)=>normalization.normalizeState({...cloud,checks:shared.checks}),
      projectMainState:state=>normalization.prepareKupaCloudState(state),emptyMainState:()=>normalization.normalizeState(INITIAL_STATE),
      validateMainCloud:value=>assertValidCloudState(value,'Kupa detached target'),
      rpcMain:(...args)=>p.syncDocument.rpcSaveCloudV2(...args),rpcShared:(...args)=>p.cloudTransport.rpcSaveSharedChecksV2(...args),
      verifyLegacyClean:()=>verifyLegacyClean()});
  }
  async function installTransferTargetView({mainState,sharedState,mainRevision,sharedRevision}){
    const p=requirePorts();
    const next=p.stateNormalization.normalizeState({...mainState,checks:normalizeSharedChecks(sharedState.checks)});
    p.model.state=next;p.domainRevisions.touchAll();
    p.checksSession.sharedChecksBase=structuredClone(sharedState.checks);
    p.checksSession.sharedChecksBankEvents=structuredClone(sharedState.bankEvents);
    p.checksSession.sharedChecksRevision=Number(sharedRevision);
    p.checksSession.sharedChecksSaveRequested=false;
    p.checksSession.sharedChecksBootstrapActive=false;
    p.session.dbRevision=Number(mainRevision);p.session.connectionMode='supabase';p.session.backendReady=true;
    p.session.lastSavedSnapshot=JSON.stringify(p.stateNormalization.prepareKupaCloudState(next));
    p.session.cloudConflictPending=false;p.session.storageV2CloudPending=false;
    p.session.serverInfo={...p.session.serverInfo,databaseFile:'Supabase'};
    p.files.dataFileHandle=null;
  }
  async function hydrateActiveTarget(result){
    if(!result)return result;
    const p=requirePorts(),main=await p.storageShadow.recoverForOwner({intent:'load-account'});
    if(!main)throw new Error('kupa_transfer_active_main_missing');
    p.model.state=p.stateNormalization.normalizeState(main.state);
    if(!await p.sharedChecksV2Composition.recoverPrimary())throw new Error('kupa_transfer_active_shared_missing');
    p.domainRevisions.touchAll();
    if(!equalSyncJson(p.stateNormalization.prepareKupaCloudState(p.model.state),p.stateNormalization.prepareKupaCloudState(result.mainState))||
      !equalSyncJson({checks:p.model.state.checks,bankEvents:p.checksSession.sharedChecksBankEvents},result.sharedState))throw new Error('kupa_transfer_active_target_changed');
    return result;
  }
  function configure(next){
    if(transition)throw new Error('kupa_storage_v2_already_configured');ports=next;
    const p=requirePorts();
    fencedRecovery=createStorageV2FencedRecovery({app:'kupa',owner:()=>owner.current(),primary:()=>tab.primaryTab&&owner.writable,
      authenticatedOwner:()=>p.cloudAuth.loadSupaSession()?.user?.id||null,readProtocolState:()=>p.cloudTransport.readStorageProtocolState(),
      readMainRemote:()=>p.cloudTransport.readSupabaseDocument(),projectMainRemote:row=>p.stateNormalization.prepareKupaCloudState(row.state),
      readSharedRemote:()=>p.cloudTransport.readSharedChecksDocument(),projectSharedRemote:row=>row.state,
      composeMainState:(cloud,shared)=>p.stateNormalization.normalizeState({...cloud,checks:shared.checks}),
      projectMainState:state=>p.stateNormalization.prepareKupaCloudState(state),
      validateMainState:state=>assertKupaEntityInvariants(state,{includeChecks:true,required:true}),
      validateMainCloud:state=>assertValidCloudState(state,'Kupa fenced recovery cloud state'),storage});
    transition=createStorageV2ProductionTransition({
      app:'kupa',ownerBinding:owner,primary:()=>tab.primaryTab&&owner.writable,online:()=>globalThis.navigator?.onLine!==false,authOwner:()=>p.cloudAuth.loadSupaSession()?.user?.id||null,bootstrapCoordinator:bootstrap,
      readMainState:()=>p.model.state,projectMainState:state=>p.stateNormalization.prepareKupaCloudState(state),emptyMainState:()=>p.stateNormalization.normalizeState(INITIAL_STATE),mainSourceSeq:()=>p.session.localSnapshotSeq,
      readSharedState:()=>({checks:p.model.state.checks,bankEvents:p.checksSession.sharedChecksBankEvents||[]}),sharedSourceSeq:()=>p.checksSession.sharedChecksGeneration,
      readMainRemote:()=>p.cloudTransport.readSupabaseDocument(),projectMainRemote:row=>p.stateNormalization.prepareKupaCloudState(row.state),readSharedRemote:()=>p.cloudTransport.readSharedChecksDocument(),projectSharedRemote:row=>({checks:row.state.checks,bankEvents:row.state.bankEvents}),
      initializeMainHead:options=>p.storageBrowser.initializeStorageV2BootstrapHead(options),
      initializeSharedHead:options=>{if(!p.sharedChecksV2Composition.lockPreparation())throw new Error('shared_checks_preparation_lock_required');return p.sharedChecksV2.initialize(options)},
      syncMain:()=>p.syncDocument.requestStorageV2CloudSave('',{force:true}),
      syncShared:()=>{if(!p.sharedChecksV2Composition.lockPreparation())throw new Error('shared_checks_preparation_lock_required');return p.sharedChecksV2.sync()},
      readMainCloudState:()=>p.storageBrowser.refreshStorageV2CloudState(),
      readSharedCloudState:()=>{if(!p.sharedChecksV2Composition.lockPreparation())throw new Error('shared_checks_preparation_lock_required');return p.sharedChecksV2.cloudState()},
      readMainRecoveredState:async()=> (await p.storageShadow.recoverForOwner({intent:'load-account'}))?.state||null,
      readSharedRecoveredState:async()=> (await p.sharedChecksV2.recover())?.state||null,
      freeze:async()=>{
        clearTimeout(p.checksSession.sharedChecksSaveTimer);p.checksSession.sharedChecksSaveTimer=null;
        if(!p.sharedChecksV2Composition.lockPreparation())throw new Error('shared_checks_preparation_lock_required');
        await p.syncDocument.quiesceForStorageCutover();
        const pending=[p.checksSession.sharedChecksSavePromise,p.checksSession.sharedChecksPullPromise].filter(Boolean);if(pending.length)await Promise.allSettled(pending);
        return true;
      },
      drainLegacy,verifyLegacyClean,markCutover:options=>p.sharedChecksV2Composition.markCutover(options),verifyCutover:()=>p.verifyStorageCutover(),
    });
    const workbookStore=createSpreadsheetStore();
    localBirth=createStorageV2LocalBirth({
      app:'kupa',owner:()=>owner.current(),primary:()=>tab.primaryTab&&owner.writable,
      main:p.storageShadow,shared:p.sharedChecksV2,
      enableShared:()=>{if(p.sharedChecksV2Composition.lockPreparation()||mode()==='primary')return;throw new Error('kupa_local_birth_shared_lock_required')},
      readSource:createLegacyLocalBirthSource({idbGet:(...args)=>p.storageIndexedDb.idbGet(...args),normalizeState:state=>p.stateNormalization.normalizeState(state)}),
      applyAuxiliary:async auxiliary=>{
        if(!auxiliary?.workbook)throw new Error('kupa_local_birth_workbook_missing');
        migrateLegacySpreadsheet(auxiliary.workbook);
        await p.captureLegacyWorkbook(auxiliary.workbook,auxiliary.workbook);
      },
      verifyAuxiliary:async auxiliary=>{
        const saved=await workbookStore.load('local:kupa:main'),record=saved.record;
        if(!record)return false;
        const source=auxiliary.workbook;
        return equalSyncJson(record.legacy,source)||equalSyncJson(record.legacyRecovery,source)||equalSyncJson(record.working,migrateLegacySpreadsheet(source));
      },
      quiesce:async()=>{
        clearTimeout(p.checksSession.sharedChecksSaveTimer);p.checksSession.sharedChecksSaveTimer=null;
        await Promise.all([p.files.browserStateWritePromise,p.files.storageV2CommitPromise,p.session.cloudOutboxCommitPromise,p.checksSession.sharedChecksOutboxCommitPromise,p.checksSession.sharedChecksSavePromise,p.session.saveQueue].filter(Boolean));
      },
      verifyLegacyClean,
    });
    ownerTransfer=createStorageV2OwnerTransfer({app:'kupa',ownerBinding:owner,primary:()=>tab.primaryTab,
      online:()=>globalThis.navigator?.onLine!==false,authOwner:()=>p.cloudAuth.loadSupaSession()?.user?.id||null,
      settleSource:settleTransferSource,createDetachedTarget,installTargetView:installTransferTargetView});
    return transition;
  }
  async function hydrateLocalBirth(){return localBirth?.hydrate()??null}
  async function ensureLocalBirth(){if(owner.current()!=='local')return false;if(!localBirth)throw new Error('kupa_storage_v2_not_configured');if(!tab.primaryTab)throw new Error('storage_local_birth_primary_required');await localBirth.begin();return true}
  async function finishOwnerTransfer(action){
    if(!ownerTransfer)throw new Error('kupa_storage_v2_not_configured');
    const initialOwner=owner.current();transferRebinding=true;
    try{const result=await action();if(result)await hydrateActiveTarget(result);transferRebinding=false;return result}
    catch(error){if(owner.locked||owner.current()===initialOwner)transferRebinding=false;throw error}
  }
  async function startStorageV2OwnerTransfer(options){return finishOwnerTransfer(()=>ownerTransfer.start(options))}
  async function resumeStorageV2OwnerTransfer(){return finishOwnerTransfer(()=>ownerTransfer.resume())}
  async function hydrateStorageV2OwnerTransfer(){return ownerTransfer?.hydrate()??null}
  function ownerAdoption(){return owner.status().binding?.pendingAdoption||null}
  async function prepareAuthenticatedOwner(intent){
    const p=requirePorts(),auth=p.cloudAuth.loadSupaSession(),target=String(auth?.user?.id||'').trim(),current=owner.current();
    if(!target)throw new Error('storage_owner_reauth_required');if(current===target)return null;if(current!=='local')throw new Error('storage_owner_handoff_required');
    const pending=ownerAdoption();if(pending){owner.assertAuthenticatedOwner(target);return pending}
    await owner.reserveLocalAdoption(target,{intent});return ownerAdoption();
  }
  async function adoptAuthenticatedOwner(intent){
    const p=requirePorts(),auth=p.cloudAuth.loadSupaSession(),target=String(auth?.user?.id||'').trim(),current=owner.current();
    if(!target)throw new Error('storage_owner_reauth_required');if(current===target)return true;if(current!=='local')throw new Error('storage_owner_handoff_required');
    const pending=ownerAdoption();if(!pending||pending.targetOwner!==target)throw new Error('storage_owner_local_adoption_not_reserved');const effectiveIntent=pending.intent||intent;
    const commits=[p.files.browserStateWritePromise,p.files.storageV2CommitPromise,p.session.cloudOutboxCommitPromise,p.checksSession.sharedChecksOutboxCommitPromise].filter(Boolean);if(commits.length)await Promise.all(commits);
    if(await verifyLegacyClean()!==true)throw new Error('storage_owner_local_adoption_pending');
    await owner.adoptPreparedLocalOwner(target,{intent:effectiveIntent,proof:{mainRevision:Number(p.session.dbRevision||0),sharedRevision:Number(p.checksSession.sharedChecksRevision||0),preparedAt:new Date().toISOString()}});
    return true;
  }
  async function beginCutover(){
    const p=requirePorts();if(p.storageShadow.cutoverActive)return {already:true};
    if(!tab.primaryTab)throw new Error('storage_cutover_primary_required');if(globalThis.navigator?.onLine===false)throw new Error('storage_cutover_online_required');
    const auth=p.cloudAuth.loadSupaSession();owner.assertAuthenticatedOwner(auth?.user?.id);await p.cloudAuth.ensureSyncCapabilities();p.session.connectionMode='supabase';p.session.backendReady=true;
    await transition.hydrate();await transition.begin();if(await p.verifyStorageCutover()!==true)throw new Error('storage_cutover_marker_verification_failed');
    return {already:false};
  }
  async function recoverLocalV2State(){
    const p=requirePorts(),recovered=await p.storageShadow.recover();
    if(!recovered)throw new Error('storage_local_engine_main_recovery_required');
    p.model.state=p.stateNormalization.normalizeState(recovered.state);p.domainRevisions.touchAll();return true;
  }
  async function recoverReadOnlyV2State(){
    const p=requirePorts(),recovered=await p.storageShadow.recoverReadOnly?.();
    if(!recovered)return false;
    p.model.state=p.stateNormalization.normalizeState(recovered.state);p.domainRevisions.touchAll();return true;
  }
  return {owner,bootstrap,preparing,mode,createRuntime,createCloudPorts,createSharedComposition,shadowEnabled,status,observerPorts,pendingLegacyWriteAllowed,legacyDrainActive,legacyWriteAllowed,legacyChecksWriteAllowed,configure,verifyLegacyClean,ownerAdoption,prepareAuthenticatedOwner,adoptAuthenticatedOwner,beginCutover,recoverFencedAccount:()=>fencedRecovery.recover(),recoverLocalV2State,recoverReadOnlyV2State,
    ownerUiPorts:()=>({prepareAuthenticatedStorageOwner:(...args)=>prepareAuthenticatedOwner(...args),storageOwnerCurrent:()=>owner.current(),storageOwnerAdoption:()=>ownerAdoption(),adoptAuthenticatedStorageOwner:(...args)=>adoptAuthenticatedOwner(...args),
      startStorageV2OwnerTransfer,storageV2OwnerTransferPreparing:()=>!!ownerTransfer?.preparing||transferRebinding}),
    adoptionPort:()=>({adoptAuthenticatedStorageOwner:(...args)=>adoptAuthenticatedOwner(...args)}),
    transitionLifecyclePorts:()=>({hydrateStorageTransition:()=>transition.hydrate(),resumeStorageTransition:()=>transition.resume(),storageTransitionPreparing:()=>!!transition?.preparing,
      hydrateLocalBirth,ensureLocalBirth,localBirthPreparing:()=>!!localBirth?.preparing,
      hydrateStorageV2OwnerTransfer,resumeStorageV2OwnerTransfer,storageV2OwnerTransferPreparing:()=>!!ownerTransfer?.preparing||transferRebinding}),
    hydrateTransition:()=>{if(!transition)throw new Error('kupa_storage_v2_not_configured');return transition.hydrate()},resumeTransition:()=>{if(!transition)throw new Error('kupa_storage_v2_not_configured');return transition.resume()},get transitionPreparing(){return !!transition?.preparing}};
}
