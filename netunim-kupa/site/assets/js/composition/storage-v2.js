import {createStorageOwnerBinding} from '../shared/storage-owner.js';
import {createStorageV2BootstrapCoordinator} from '../shared/storage-v2-bootstrap.js';
import {createStorageV2Runtime,storageV2Mode} from '../shared/storage-v2-runtime.js';
import {createStorageV2CloudPorts} from '../storage/v2-cloud-ports.js';
import {createSharedChecksV2Composition} from '../shared/shared-checks-v2-composition.js';
import {createStorageV2LocalBirth,verifyStorageV2LocalEngine} from '../shared/storage-v2-local-birth.js';
import {createSpreadsheetStore} from '../shared/spreadsheet-store.js';
import {migrateLegacySpreadsheet} from '../shared/spreadsheet-model.js';
import {equalSyncJson} from '../shared/cloud-sync.js';
import {createStorageV2OwnerTransfer} from '../shared/storage-v2-owner-transfer.js';
import {createStorageV2DetachedTarget} from '../shared/storage-v2-detached-target.js';
import {createStorageV2FencedRecovery} from '../shared/storage-v2-fenced-recovery.js';
import {createLegacyRetirementScheduler,retireLegacyBusinessStorage} from '../shared/storage-v2-legacy-retirement.js';
import {createSharedChecksV2Runtime} from '../shared/shared-checks-v2-runtime.js';
import {createSharedChecksStorageV2} from '../shared/shared-checks-storage-v2.js';
import {createStorageJournalDb} from '../shared/storage-journal-idb.js';
import {createStateNormalization} from '../state/normalization.js';
import {createSyncChecks} from '../sync/checks.js';
import {normalizeSharedChecks} from '../domains/checks/model.js';
import {assertKupaEntityInvariants,assertValidCloudState} from '../state/validation.js';
import {INITIAL_STATE} from '../state/constants.js';

// Owns the Kupa V2 storage lifecycle. main.js supplies application ports.
export function createKupaStorageV2Coordinator({tab,session,storage=globalThis.localStorage}={}){
  if(!tab||!session)throw new Error('kupa_storage_v2_tab_required');
  const owner=createStorageOwnerBinding({app:'kupa',primary:()=>tab.primaryTab});
  const bootstrap=createStorageV2BootstrapCoordinator({app:'kupa',owner:()=>owner.current(),primary:()=>tab.primaryTab});
  let localBirth=null,ownerTransfer=null,fencedRecovery=null,transferRebinding=false,ports=null;
  const requirePorts=()=>{if(!ports)throw new Error('kupa_storage_v2_not_configured');return ports};
  const preparing=()=>owner.locked||transferRebinding||!!ownerTransfer?.preparing||!!localBirth?.preparing||!!(bootstrap.hasGroup&&bootstrap.group?.phase!=='complete');
  const scheduleLegacyRetirement=createLegacyRetirementScheduler({
    ready:()=>!!ports&&tab.primaryTab&&owner.writable&&!session.storageProtocolBlocked&&!preparing()&&ports.storageShadow.primaryReady&&ports.sharedChecksV2.primaryReady&&(owner.current()==='local'||globalThis.navigator?.onLine!==false),
    retire:async()=>{const p=requirePorts();await retireLegacyBusinessStorage({app:'kupa',owner:owner.current(),ownerNow:()=>owner.current(),
      primaryReady:()=>tab.primaryTab&&owner.writable&&!session.storageProtocolBlocked&&!preparing()&&p.storageShadow.primaryReady&&p.sharedChecksV2.primaryReady,
      verifyV2:()=>owner.current()==='local'?verifyStorageV2LocalEngine({app:'kupa',owner:()=>owner.current()}):p.verifyStorageCutover(),
      readProtocolState:()=>p.cloudTransport.readStorageProtocolState(),storage,
      deleteRecords:async()=>{for(const key of ['browser-state-v1','cloud-pending-v2','cloud-pending-v3','shared-checks-outbox-v3'])await p.storageIndexedDb.idbDelete('sync',key)}})},
  });
  const mode=()=>storageV2Mode('kupa',storage,owner.current(),{preparing:preparing()});
  const createRuntime=options=>createStorageV2Runtime({app:'kupa',owner:()=>owner.current(),primary:()=>tab.primaryTab&&owner.writable,mode,...options});
  const createCloudPorts=storageBrowser=>({...createStorageV2CloudPorts(storageBrowser),storageV2PrimaryRequested:()=>['primary','preparing'].includes(mode()),storageV2BootstrapStatus:()=>bootstrap.load(),prepareStorageV2Bootstrap:(...args)=>bootstrap.prepare(...args),advanceStorageV2Bootstrap:(...args)=>bootstrap.advance(...args)});
  const createSharedComposition=({model,checksSession,domainRevisions,main,stateNormalization,getSyncChecks,getCloudTransport})=>createSharedChecksV2Composition({
    site:'kupa',owner:()=>owner.current(),primary:()=>tab.primaryTab&&owner.writable,preparing,
    model,checksSession,eventsKey:'sharedChecksBankEvents',domainRevisions,main,
    merge:(...args)=>getSyncChecks().mergeSharedChecks(...args),readRemote:(...args)=>getCloudTransport().readSharedChecksDocument(...args),rpc:(...args)=>getCloudTransport().rpcSaveSharedChecksV2(...args),
    validateMainCloud:state=>assertValidCloudState(state,'Kupa V2 restore cloud state'),applyMainState:state=>{model.state=stateNormalization.normalizeState({...state,checks:model.state.checks});domainRevisions.touchAll()},
  });

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
    await Promise.all([p.storageShadow.commitPromise,p.sharedChecksV2.commitPromise,p.files.storageV2CommitPromise,
      p.session.saveQueue,p.session.cloudSavePromise,p.checksSession.sharedChecksSavePromise,
      p.checksSession.sharedChecksPullPromise].filter(Boolean));
    if(p.session.cloudSyncBusy||p.session.cloudWriteBusy||p.checksSession.sharedChecksBusy)throw new Error('kupa_transfer_source_unsettled');
    const boundary=await createStorageJournalDb().readBoundary(sourceOwner);
    if(boundary&&boundary.phase!=='complete')throw new Error('kupa_transfer_source_boundary_pending');
    const normalization=detachedNormalization(),sourceMain=createStorageV2Runtime({app:'kupa',owner:()=>sourceOwner,primary:()=>tab.primaryTab,mode:()=> 'preparing',
      validate:state=>assertKupaEntityInvariants(state,{includeChecks:Object.hasOwn(state||{},'checks'),required:true}),prepareCheckpoint:state=>normalization.prepareKupaStorageState(state),prepareOperation:operation=>normalization.prepareKupaStorageOperation(operation)});
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
      validate:state=>assertKupaEntityInvariants(state,{includeChecks:Object.hasOwn(state||{},'checks'),required:true}),prepareCheckpoint:state=>normalization.prepareKupaStorageState(state),prepareOperation:operation=>normalization.prepareKupaStorageOperation(operation)});
    let detachedSharedState={checks:[],bankEvents:[]};
    const merge=createSyncChecks({checksSession:{sharedChecksBootstrapActive:false},model:{state:{checks:[]}}}).mergeSharedChecks;
    const targetShared=createSharedChecksV2Runtime({site:'kupa',owner:target,primary:()=>tab.primaryTab,mode:()=> 'preparing',
      readState:()=>detachedSharedState,applyState:value=>{detachedSharedState=structuredClone(value)},merge,
      readRemote:()=>p.cloudTransport.readSharedChecksDocument(),rpc:(...args)=>p.cloudTransport.rpcSaveSharedChecksV2(...args)});
    return createStorageV2DetachedTarget({app:'kupa',targetOwner,primary:()=>tab.primaryTab,main:targetMain,shared:targetShared,
      readMainRemote:()=>p.cloudTransport.readSupabaseDocument(),projectMainRemote:row=>normalization.prepareKupaCloudState(row.state),
      readSharedRemote:()=>p.cloudTransport.readSharedChecksDocument(),projectSharedRemote:row=>({checks:row.state.checks,bankEvents:row.state.bankEvents}),
      composeMainState:(cloud,shared)=>normalization.normalizeState({...cloud,checks:shared.checks}),
      projectMainState:state=>normalization.prepareKupaCloudState(state),emptyMainState:()=>normalization.normalizeState(INITIAL_STATE),
      validateMainCloud:value=>assertValidCloudState(value,'Kupa detached target'),
      rpcMain:(...args)=>p.syncDocument.rpcSaveCloudV2(...args),rpcShared:(...args)=>p.cloudTransport.rpcSaveSharedChecksV2(...args)});
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
    if(ports)throw new Error('kupa_storage_v2_already_configured');ports=next;
    const p=requirePorts();
    fencedRecovery=createStorageV2FencedRecovery({app:'kupa',owner:()=>owner.current(),primary:()=>tab.primaryTab&&owner.writable,refreshOwnerBinding:()=>owner.refresh(),
      authenticatedOwner:()=>p.cloudAuth.loadSupaSession()?.user?.id||null,readProtocolState:()=>p.cloudTransport.readStorageProtocolState(),
      readMainRemote:()=>p.cloudTransport.readSupabaseDocument(),projectMainRemote:row=>p.stateNormalization.prepareKupaCloudState(row.state),
      readSharedRemote:()=>p.cloudTransport.readSharedChecksDocument(),projectSharedRemote:row=>row.state,
      composeMainState:(cloud,shared)=>p.stateNormalization.normalizeState({...cloud,checks:shared.checks}),
      projectMainState:state=>p.stateNormalization.prepareKupaCloudState(state),
      validateMainState:state=>assertKupaEntityInvariants(state,{includeChecks:Object.hasOwn(state||{},'checks'),required:true}),
      validateMainCloud:state=>assertValidCloudState(state,'Kupa fenced recovery cloud state'),storage});
    const workbookStore=createSpreadsheetStore();
    localBirth=createStorageV2LocalBirth({
      app:'kupa',owner:()=>owner.current(),primary:()=>tab.primaryTab&&owner.writable,
      main:p.storageShadow,shared:p.sharedChecksV2,
      enableShared:()=>{if(p.sharedChecksV2Composition.lockPreparation()||mode()==='primary')return;throw new Error('kupa_local_birth_shared_lock_required')},
      readSource:async()=>{
        const mainState=p.stateNormalization.normalizeState(INITIAL_STATE);delete mainState.checks;
        return {mainState,sharedState:{checks:[],bankEvents:[]}};
      },
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
        await Promise.all([p.files.storageV2CommitPromise,p.checksSession.sharedChecksSavePromise,p.session.saveQueue].filter(Boolean));
      },
    });
    ownerTransfer=createStorageV2OwnerTransfer({app:'kupa',ownerBinding:owner,primary:()=>tab.primaryTab,
      online:()=>globalThis.navigator?.onLine!==false,authOwner:()=>p.cloudAuth.loadSupaSession()?.user?.id||null,
      settleSource:settleTransferSource,createDetachedTarget,installTargetView:installTransferTargetView});
    return true;
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
  function assertAuthenticatedAccountOwner(){
    const p=requirePorts(),active=owner.current(),authenticated=String(p.cloudAuth.loadSupaSession()?.user?.id||'').trim();
    if(!active||active==='local'||owner.locked||active!==authenticated)throw new Error('storage_owner_account_mismatch');
    return true;
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
  async function recoverShared(){
    const p=requirePorts(),recovered=await p.sharedChecksV2Composition.recoverPrimary();
    if(recovered)scheduleLegacyRetirement();
    return recovered;
  }
  return {owner,bootstrap,preparing,mode,createRuntime,createCloudPorts,createSharedComposition,scheduleLegacyRetirement,recoverShared,configure,ownerAdoption,recoverFencedAccount:()=>fencedRecovery.recover(),recoverLocalV2State,recoverReadOnlyV2State,
    ownerUiPorts:()=>({storageOwnerCurrent:()=>owner.current(),storageOwnerAdoption:()=>ownerAdoption(),
      startStorageV2OwnerTransfer,storageV2OwnerTransferPreparing:()=>!!ownerTransfer?.preparing||transferRebinding}),
    accountContextPort:()=>({assertAccountOwner:assertAuthenticatedAccountOwner}),
    lifecyclePorts:()=>({hydrateLocalBirth,ensureLocalBirth,localBirthPreparing:()=>!!localBirth?.preparing,
      hydrateStorageV2OwnerTransfer,resumeStorageV2OwnerTransfer,storageV2OwnerTransferPreparing:()=>!!ownerTransfer?.preparing||transferRebinding}),
  };
}
