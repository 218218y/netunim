import {createStorageOwnerBinding} from '../shared/storage-owner.js';
import {createStorageV2BootstrapCoordinator} from '../shared/storage-v2-bootstrap.js';
import {createStorageV2LocalBirth,verifyStorageV2LocalEngine} from '../shared/storage-v2-local-birth.js';
import {createStorageV2OwnerTransfer} from '../shared/storage-v2-owner-transfer.js';
import {createStorageV2DetachedTarget} from '../shared/storage-v2-detached-target.js';
import {createStorageV2FencedRecovery} from '../shared/storage-v2-fenced-recovery.js';
import {createLegacyRetirementScheduler,retireLegacyBusinessStorage} from '../shared/storage-v2-legacy-retirement.js';
import {createStorageV2Runtime,storageV2Mode} from '../shared/storage-v2-runtime.js';
import {createSharedChecksV2Runtime} from '../shared/shared-checks-v2-runtime.js';
import {createStorageV2CloudPorts} from '../storage/v2-cloud-ports.js';
import {createSharedChecksV2Composition} from '../shared/shared-checks-v2-composition.js';
import {assertValidOrderCloudState} from '../state/validation.js';
import {INITIAL_STATE} from '../state/constants.js';

// Owns the Orders V2 storage lifecycle. main.js supplies application ports.
export function createOrdersStorageV2Coordinator({tab,session,storage=globalThis.localStorage}={}){
  if(!tab||!session)throw new Error('orders_storage_v2_tab_required');
  const owner=createStorageOwnerBinding({app:'orders',primary:()=>tab.primaryTab});
  const bootstrap=createStorageV2BootstrapCoordinator({app:'orders',owner:()=>owner.current(),primary:()=>tab.primaryTab});
  let localBirth=null,ownerTransfer=null,fencedRecovery=null,transferRebinding=false,ports=null;
  const requirePorts=()=>{if(!ports)throw new Error('orders_storage_v2_not_configured');return ports};
  const preparing=()=>owner.locked||transferRebinding||!!ownerTransfer?.preparing||!!localBirth?.preparing||!!(bootstrap.hasGroup&&bootstrap.group?.phase!=='complete');
  const scheduleLegacyRetirement=createLegacyRetirementScheduler({
    ready:()=>!!ports&&tab.primaryTab&&owner.writable&&!session.storageProtocolBlocked&&!preparing()&&ports.storageShadow.primaryReady&&ports.sharedChecksV2.primaryReady&&(owner.current()==='local'||globalThis.navigator?.onLine!==false),
    settle:async()=>{const p=requirePorts(),pending=[p.files.browserStateWritePromise,p.session.ordersOutboxCommitPromise,p.checksSession.checksOutboxCommitPromise].filter(Boolean);if(pending.length)await Promise.allSettled(pending)},
    retire:async()=>{const p=requirePorts();await retireLegacyBusinessStorage({app:'orders',owner:owner.current(),ownerNow:()=>owner.current(),
      primaryReady:()=>tab.primaryTab&&owner.writable&&!session.storageProtocolBlocked&&!preparing()&&p.storageShadow.primaryReady&&p.sharedChecksV2.primaryReady,
      verifyV2:()=>owner.current()==='local'?verifyStorageV2LocalEngine({app:'orders',owner:()=>owner.current()}):p.verifyStorageCutover(),
      readProtocolState:()=>p.cloudTransport.readStorageProtocolState(),storage,
      deleteRecords:()=>p.storageBrowser.deleteLegacyBusinessRecords()})},
  });
  // Compatibility modules are read-only until they are removed. No production
  // transition is allowed to reopen a V1 business writer.
  const legacyWriteAllowed=()=>false;
  const mode=()=>storageV2Mode('orders',storage,owner.current(),{preparing:preparing()});
  const createRuntime=options=>createStorageV2Runtime({app:'orders',owner:()=>owner.current(),primary:()=>tab.primaryTab&&owner.writable,mode,...options});
  const createCloudPorts=storageBrowser=>({...createStorageV2CloudPorts(storageBrowser),storageV2PrimaryRequested:()=>['primary','preparing'].includes(mode()),storageV2BootstrapStatus:()=>bootstrap.load(),prepareStorageV2Bootstrap:(...args)=>bootstrap.prepare(...args),advanceStorageV2Bootstrap:(...args)=>bootstrap.advance(...args)});
  const pendingLegacyWriteAllowed=runtime=>legacyWriteAllowed()&&!runtime.cutoverActive;
  const createSharedComposition=({model,checksSession,domainRevisions,main,stateNormalization,storageChecks,getSyncChecks,getCloudTransport})=>createSharedChecksV2Composition({
    site:'orders',owner:()=>owner.current(),primary:()=>tab.primaryTab&&owner.writable,preparing,
    model,checksSession,eventsKey:'checksBankEvents',domainRevisions,main,
    merge:(...args)=>getSyncChecks().mergeSharedChecks(...args),readRemote:(...args)=>getCloudTransport().readSharedChecksCloud(...args),rpc:(...args)=>getCloudTransport().rpcSaveSharedChecksV2(...args),verifyLegacyClean:(...args)=>storageChecks.verifyLegacyChecksClean(...args),
    validateMainCloud:state=>assertValidOrderCloudState(state,'Orders V2 restore cloud state'),applyMainState:state=>{const previous=model.state;model.state=stateNormalization.normalizeState({...state,checks:previous.checks});domainRevisions.reconcile(previous,model.state,{forceAll:true})},
  });

  async function verifyLegacyClean(){
    const p=requirePorts();return (await p.storageBrowser.verifyLegacyCloudClean())===true&&(await p.storageChecks.verifyLegacyChecksClean())===true;
  }
  function configure(next){
    if(ports)throw new Error('orders_storage_v2_already_configured');ports=next;
    const p=requirePorts();
    fencedRecovery=createStorageV2FencedRecovery({app:'orders',owner:()=>owner.current(),primary:()=>tab.primaryTab&&owner.writable,refreshOwnerBinding:()=>owner.refresh(),
      authenticatedOwner:()=>p.cloudAuth.loadSession()?.user?.id||null,readProtocolState:()=>p.cloudTransport.readStorageProtocolState(),
      readMainRemote:()=>p.cloudTransport.readCloud(),projectMainRemote:row=>p.stateSnapshots.prepareCloudState(row.state),
      readSharedRemote:()=>p.cloudTransport.readSharedChecksCloud(),projectSharedRemote:row=>row.state,
      composeMainState:(cloud,shared)=>p.prepareV2Checkpoint(p.stateNormalization.normalizeState({...cloud,checks:shared.checks})),
      projectMainState:state=>p.stateSnapshots.prepareCloudState(state),validateMainState:state=>p.validateMainState(state),
      validateMainCloud:state=>assertValidOrderCloudState(state,'Orders fenced recovery cloud state'),storage});
    localBirth=createStorageV2LocalBirth({
      app:'orders',owner:()=>owner.current(),primary:()=>tab.primaryTab&&owner.writable,
      main:p.storageShadow,shared:p.sharedChecksV2,
      enableShared:()=>{if(!p.sharedChecksV2Composition.lockPreparation())throw new Error('orders_local_birth_shared_lock_required')},
      readSource:async()=>{
        const mainState=p.prepareV2Checkpoint(INITIAL_STATE);delete mainState.checks;
        return {mainState,sharedState:{checks:[],bankEvents:[]}};
      },
      quiesce:async()=>{
        clearTimeout(p.checksSession.sharedChecksSaveTimer);p.checksSession.sharedChecksSaveTimer=null;
        await p.syncDocument.quiesceForStorageCutover();
        const pending=[p.files.browserStateWritePromise,p.files.storageV2CommitPromise,p.session.ordersOutboxCommitPromise,p.checksSession.checksOutboxCommitPromise,p.checksSession.checksSavePromise,p.checksSession.checksPullPromise].filter(Boolean);
        if(pending.length)await Promise.all(pending);
      },
    });
    const fixedMain=identity=>createStorageV2Runtime({
      app:'orders',owner:()=>identity,primary:()=>tab.primaryTab,mode:()=> 'preparing',
      validate:state=>p.validateMainState(state),prepareCheckpoint:p.prepareV2Checkpoint,
    });
    const fixedShared=identity=>{
      let snapshot={checks:[],bankEvents:[]};
      return createSharedChecksV2Runtime({
        site:'orders',owner:()=>identity,primary:()=>tab.primaryTab,mode:()=> 'preparing',
        readState:()=>snapshot,applyState:state=>{snapshot=structuredClone(state)},
        merge:(...args)=>p.syncChecks.mergeSharedChecks(...args),
        readRemote:()=>p.cloudTransport.readSharedChecksCloud(),
        rpc:(...args)=>p.cloudTransport.rpcSaveSharedChecksV2(...args),
        verifyLegacyClean:()=>owner.current()==='local'?true:p.storageChecks.verifyLegacyChecksClean(),
      });
    };
    async function settleSource({sourceOwner}){
      if(owner.current()!==sourceOwner||!owner.locked)throw new Error('orders_transfer_source_lock_required');
      const marked=sourceOwner==='local'
        ?await verifyStorageV2LocalEngine({app:'orders',owner:()=>sourceOwner})
        :await p.verifyStorageCutover();
      if(marked!==true||owner.current()!==sourceOwner||!owner.locked)throw new Error('orders_transfer_source_not_primary');
      clearTimeout(p.checksSession.sharedChecksSaveTimer);p.checksSession.sharedChecksSaveTimer=null;
      await p.syncDocument.quiesceForStorageCutover();
      const pending=[p.files.browserStateWritePromise,p.files.storageV2CommitPromise,p.session.ordersOutboxCommitPromise,p.checksSession.checksOutboxCommitPromise,p.session.cloudSavePromise,p.checksSession.checksSavePromise,p.checksSession.checksPullPromise,p.sharedChecksV2.commitPromise].filter(Boolean);
      if(pending.length)await Promise.all(pending);
      // A marked local V2 source is authoritative. Retired V1 outboxes are
      // unrelated to its journal and must not prevent transferring V2 data.
      if(sourceOwner!=='local'&&(await p.storageBrowser.verifyLegacyCloudCleanReadOnly()!==true||await p.storageChecks.verifyLegacyChecksClean()!==true))throw new Error('orders_transfer_legacy_pending');
      const main=fixedMain(sourceOwner),shared=fixedShared(sourceOwner),mainRecovered=await main.recover(null),sharedRecovered=await shared.recover();
      if(!mainRecovered?.state||!sharedRecovered?.state)throw new Error('orders_transfer_source_checkpoint_missing');
      const mainCloud=await main.cloudState({validateBase:state=>assertValidOrderCloudState(state,'Orders transfer source cloud base')}),sharedCloud=await shared.cloudState();
      if(mainCloud.flight||mainCloud.control||sharedCloud.flight||sharedCloud.control)throw new Error('orders_transfer_source_flight_unsettled');
      if(sourceOwner==='local'){
        if(mainCloud.base||sharedCloud.base)throw new Error('orders_transfer_local_cloud_head_unexpected');
      }else if(!mainCloud.base||!sharedCloud.base||mainCloud.pending||sharedCloud.pending||mainCloud.base.ackSeq!==mainCloud.seq||sharedCloud.base.ackSeq!==sharedCloud.seq)throw new Error('orders_transfer_source_pending');
      const sharedState={checks:structuredClone(sharedRecovered.state.checks),bankEvents:structuredClone(sharedRecovered.state.bankEvents)},fullState=p.prepareV2Checkpoint({...mainRecovered.state,checks:sharedState.checks}),cloudState=p.stateSnapshots.prepareCloudState(fullState);
      return {main:{state:cloudState,fullState,seq:mainRecovered.seq},shared:{state:sharedState,seq:sharedRecovered.seq}};
    }
    function detachedTarget(targetOwner){
      const main=fixedMain(targetOwner),shared=fixedShared(targetOwner);
      return createStorageV2DetachedTarget({
        app:'orders',targetOwner,primary:()=>tab.primaryTab,main,shared,
        readMainRemote:()=>p.cloudTransport.readCloud(),projectMainRemote:row=>p.stateSnapshots.prepareCloudState(row.state),
        readSharedRemote:()=>p.cloudTransport.readSharedChecksCloud(),projectSharedRemote:row=>({checks:row.state.checks,bankEvents:row.state.bankEvents}),
        composeMainState:(mainState,sharedState)=>p.prepareV2Checkpoint(p.stateNormalization.normalizeState({...structuredClone(mainState),checks:structuredClone(sharedState.checks)})),
        projectMainState:state=>p.stateSnapshots.prepareCloudState(state),emptyMainState:()=>p.prepareV2Checkpoint(INITIAL_STATE),
        validateMainCloud:state=>assertValidOrderCloudState(state,'Orders detached target cloud state'),
        rpcMain:(...args)=>p.cloudTransport.rpcSaveV2(...args),rpcShared:(...args)=>p.cloudTransport.rpcSaveSharedChecksV2(...args),
        verifyLegacyClean:async()=>owner.current()==='local'||await p.storageBrowser.verifyLegacyCloudCleanReadOnly()===true&&await p.storageChecks.verifyLegacyChecksClean()===true,
      });
    }
    ownerTransfer=createStorageV2OwnerTransfer({
      app:'orders',ownerBinding:owner,primary:()=>tab.primaryTab,online:()=>globalThis.navigator?.onLine!==false,
      authOwner:()=>p.cloudAuth.loadSession()?.user?.id||null,settleSource,createDetachedTarget:detachedTarget,
      installTargetView:async({mainState,sharedState,mainRevision,sharedRevision})=>{
        const previous=p.model.state;
        p.model.state=p.stateNormalization.normalizeState({...structuredClone(mainState),checks:structuredClone(sharedState.checks)});
        p.domainRevisions.reconcile(previous,p.model.state,{forceAll:true});
        p.session.cloudRevision=mainRevision;p.session.lastCloudState=p.stateSnapshots.prepareCloudState(p.model.state);
        p.session.cloudSaveRequested=false;p.session.storageV2CloudPending=false;p.session.cloudConflictBlocked=false;p.session.cloudUpdatedAt=null;
        p.checksSession.checksCloudRevision=sharedRevision;p.checksSession.checksCloudBase=structuredClone(sharedState.checks);
        p.checksSession.checksBankEvents=structuredClone(sharedState.bankEvents);p.checksSession.checksSaveRequested=false;
      },
    });
    return true;
  }
  async function rebindTransferredOwner(){
    const p=requirePorts();
    const main=await p.storageShadow.recoverForOwner({intent:'load-account'});
    if(!main?.state||await p.sharedChecksV2Composition.recoverPrimary()!==true)throw new Error('orders_transfer_active_recovery_failed');
    const previous=p.model.state;
    p.model.state=p.stateNormalization.normalizeState({...structuredClone(main.state),checks:structuredClone(p.model.state.checks)});
    p.domainRevisions.reconcile(previous,p.model.state,{forceAll:true});
  }
  async function finishOwnerTransfer(action){
    const initialOwner=owner.current();transferRebinding=true;
    try{
      const result=await action();
      if(result)await rebindTransferredOwner();
      transferRebinding=false;
      return result;
    }catch(error){
      // After activation, failed active-runtime hydration cannot expose a
      // writable target with an old source model in the same tab.
      if(owner.locked||owner.current()===initialOwner)transferRebinding=false;
      throw error;
    }
  }
  async function startStorageV2OwnerTransfer(options){return finishOwnerTransfer(()=>ownerTransfer.start(options))}
  async function resumeStorageV2OwnerTransfer(){return finishOwnerTransfer(()=>ownerTransfer.resume())}
  function ownerAdoption(){return owner.status().binding?.pendingAdoption||null}
  async function prepareAuthenticatedOwner(intent){
    const p=requirePorts(),auth=p.cloudAuth.loadSession(),target=String(auth?.user?.id||'').trim(),current=owner.current();
    if(!target)throw new Error('storage_owner_reauth_required');if(current===target)return null;if(current!=='local')throw new Error('storage_owner_handoff_required');
    const pending=ownerAdoption();if(pending){owner.assertAuthenticatedOwner(target);return pending}
    await owner.reserveLocalAdoption(target,{intent});return ownerAdoption();
  }
  async function adoptAuthenticatedOwner(intent){
    const p=requirePorts(),auth=p.cloudAuth.loadSession(),target=String(auth?.user?.id||'').trim(),current=owner.current();
    if(!target)throw new Error('storage_owner_reauth_required');if(current===target)return true;if(current!=='local')throw new Error('storage_owner_handoff_required');
    const pending=ownerAdoption();if(!pending||pending.targetOwner!==target)throw new Error('storage_owner_local_adoption_not_reserved');const effectiveIntent=pending.intent||intent;
    const commits=[p.files.browserStateWritePromise,p.files.storageV2CommitPromise,p.session.ordersOutboxCommitPromise,p.checksSession.checksOutboxCommitPromise].filter(Boolean);if(commits.length)await Promise.all(commits);
    if(await verifyLegacyClean()!==true)throw new Error('storage_owner_local_adoption_pending');
    await owner.adoptPreparedLocalOwner(target,{intent:effectiveIntent,proof:{mainRevision:Number(p.session.cloudRevision||0),sharedRevision:Number(p.checksSession.checksCloudRevision||0),preparedAt:new Date().toISOString()}});
    return true;
  }
  async function recoverShared(){
    const p=requirePorts(),recovered=await p.sharedChecksV2Composition.recoverPrimary();
    if(recovered)scheduleLegacyRetirement();
    return recovered;
  }
  return {owner,bootstrap,preparing,mode,createRuntime,createCloudPorts,createSharedComposition,pendingLegacyWriteAllowed,legacyWriteAllowed,scheduleLegacyRetirement,recoverShared,configure,verifyLegacyClean,ownerAdoption,prepareAuthenticatedOwner,adoptAuthenticatedOwner,recoverFencedAccount:()=>fencedRecovery.recover(),startStorageV2OwnerTransfer,resumeStorageV2OwnerTransfer,
    ownerUiPorts:()=>({prepareAuthenticatedStorageOwner:(...args)=>prepareAuthenticatedOwner(...args),storageOwnerCurrent:()=>owner.current(),storageOwnerAdoption:()=>ownerAdoption(),adoptAuthenticatedStorageOwner:(...args)=>adoptAuthenticatedOwner(...args)}),
    adoptionPort:()=>({adoptAuthenticatedStorageOwner:(...args)=>adoptAuthenticatedOwner(...args)}),
    localBirthLifecyclePorts:()=>({hydrateLocalBirth:()=>localBirth.hydrate(),ensureLocalBirth:()=>localBirth.begin(),resumeLocalBirth:()=>localBirth.resume(),localBirthPreparing:()=>!!localBirth?.preparing,storageOwnerCurrent:()=>owner.current()}),
    ownerTransferLifecyclePorts:()=>({hydrateStorageV2OwnerTransfer:()=>ownerTransfer.hydrate(),resumeStorageV2OwnerTransfer,storageV2OwnerTransferPreparing:()=>!!ownerTransfer?.preparing||transferRebinding}),
    ownerTransferUiPorts:()=>({startStorageV2OwnerTransfer,resumeStorageV2OwnerTransfer,storageV2OwnerTransferPreparing:()=>!!ownerTransfer?.preparing||transferRebinding}),
  };
}
