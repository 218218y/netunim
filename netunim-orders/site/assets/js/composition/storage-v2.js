import {createStorageOwnerBinding} from '../shared/storage-owner.js';
import {createStorageV2BootstrapCoordinator} from '../shared/storage-v2-bootstrap.js';
import {createStorageV2ProductionTransition} from '../shared/storage-v2-production-transition.js';
import {createStorageV2Runtime,storageV2Mode} from '../shared/storage-v2-runtime.js';
import {createStorageV2CloudPorts} from '../storage/v2-cloud-ports.js';
import {createSharedChecksV2Composition} from '../shared/shared-checks-v2-composition.js';
import {assertValidOrderCloudState} from '../state/validation.js';
import {INITIAL_STATE} from '../state/constants.js';

// Owns the Orders storage migration state machines. main.js supplies application
// ports, but no longer carries drain/bootstrap/owner-adoption orchestration.
export function createOrdersStorageV2Coordinator({tab,storage=globalThis.localStorage}={}){
  if(!tab)throw new Error('orders_storage_v2_tab_required');
  const owner=createStorageOwnerBinding({app:'orders',primary:()=>tab.primaryTab});
  const bootstrap=createStorageV2BootstrapCoordinator({app:'orders',owner:()=>owner.current(),primary:()=>tab.primaryTab});
  let transition=null,legacyDrain=false,ports=null;
  const requirePorts=()=>{if(!ports)throw new Error('orders_storage_v2_not_configured');return ports};
  const preparing=()=>owner.locked||!!transition?.preparing||!!(bootstrap.hasGroup&&bootstrap.group?.phase!=='complete');
  const legacyDrainActive=()=>legacyDrain;
  const legacyWriteAllowed=()=>owner.writable&&(!preparing()||legacyDrain);
  const legacyChecksWriteAllowed=()=>legacyWriteAllowed()&&storage?.getItem(`netunim-storage-cutover-version:orders:${owner.current()}`)!=='2';
  const mode=()=>storageV2Mode('orders',storage,owner.current(),{preparing:preparing()});
  const createRuntime=options=>createStorageV2Runtime({app:'orders',owner:()=>owner.current(),primary:()=>tab.primaryTab&&owner.writable,mode,...options});
  const createCloudPorts=storageBrowser=>({...createStorageV2CloudPorts(storageBrowser),storageV2PrimaryRequested:()=>['primary','preparing'].includes(mode()),storageV2BootstrapStatus:()=>bootstrap.load(),prepareStorageV2Bootstrap:(...args)=>bootstrap.prepare(...args),advanceStorageV2Bootstrap:(...args)=>bootstrap.advance(...args)});
  const shadowEnabled=(runtime,key)=>{if(runtime.cutoverActive)return false;if(mode()==='shadow')return true;try{return storage?.getItem(key)==='1'}catch{return false}};
  const status=(runtime,authenticated)=>({active:runtime.cutoverActive,preparing:preparing(),canBegin:tab.primaryTab&&owner.current()!=='local'&&!!authenticated&&!runtime.cutoverActive});
  const observerPorts=(runtime,key)=>({owner:()=>owner.current(),primary:()=>tab.primaryTab&&owner.writable,enabled:()=>shadowEnabled(runtime,key)});
  const pendingLegacyWriteAllowed=runtime=>legacyWriteAllowed()&&!runtime.cutoverActive;
  const createSharedComposition=({model,checksSession,domainRevisions,main,stateNormalization,storageChecks,getSyncChecks,getCloudTransport})=>createSharedChecksV2Composition({
    site:'orders',owner:()=>owner.current(),primary:()=>tab.primaryTab&&owner.writable,preparing,
    model,checksSession,eventsKey:'checksBankEvents',domainRevisions,main,
    merge:(...args)=>getSyncChecks().mergeSharedChecks(...args),readRemote:(...args)=>getCloudTransport().readSharedChecksCloud(...args),rpc:(...args)=>getCloudTransport().rpcSaveSharedChecks(...args),verifyLegacyClean:(...args)=>storageChecks.verifyLegacyChecksClean(...args),
    validateMainCloud:state=>assertValidOrderCloudState(state,'Orders V2 restore cloud state'),applyMainState:state=>{const previous=model.state;model.state=stateNormalization.normalizeState({...state,checks:previous.checks});domainRevisions.reconcile(previous,model.state,{forceAll:true})},
  });

  async function verifyLegacyClean(){
    const p=requirePorts();return (await p.storageBrowser.verifyLegacyCloudClean())===true&&(await p.storageChecks.verifyLegacyChecksClean())===true;
  }
  async function drainLegacy(){
    const p=requirePorts();legacyDrain=true;
    try{
      const mainPending=await p.storageBrowser.getCloudPending();
      if(mainPending){const ok=await p.syncDocument.requestCloudSave('',{legacyDrain:true});if(!ok&&await p.storageBrowser.getCloudPending())throw new Error('storage_cutover_main_legacy_drain_incomplete')}
      const checksPending=await p.storageChecks.getChecksPending();
      if(checksPending){const ok=await p.syncChecks.saveSharedChecksToCloud('',{legacyDrain:true});if(!ok&&await p.storageChecks.getChecksPending())throw new Error('storage_cutover_shared_legacy_drain_incomplete')}
      if(await verifyLegacyClean()!==true)throw new Error('storage_cutover_legacy_pending');
      return {main:true,shared:true};
    }finally{legacyDrain=false}
  }
  function configure(next){
    if(transition)throw new Error('orders_storage_v2_already_configured');ports=next;
    const p=requirePorts();
    transition=createStorageV2ProductionTransition({
      app:'orders',ownerBinding:owner,primary:()=>tab.primaryTab&&owner.writable,online:()=>globalThis.navigator?.onLine!==false,authOwner:()=>p.cloudAuth.loadSession()?.user?.id||null,bootstrapCoordinator:bootstrap,
      readMainState:()=>p.model.state,projectMainState:state=>p.stateSnapshots.prepareCloudState(state),emptyMainState:()=>p.stateNormalization.normalizeState(INITIAL_STATE),mainSourceSeq:()=>p.session.localSnapshotSeq,
      readSharedState:()=>({checks:p.model.state.checks,bankEvents:p.checksSession.checksBankEvents||[]}),sharedSourceSeq:()=>p.checksSession.checksGeneration,
      readMainRemote:()=>p.cloudTransport.readCloud(),projectMainRemote:row=>p.stateSnapshots.prepareCloudState(row.state),readSharedRemote:()=>p.cloudTransport.readSharedChecksCloud(),projectSharedRemote:row=>({checks:row.state.checks,bankEvents:row.state.bankEvents}),
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
        const pending=[p.checksSession.checksSavePromise,p.checksSession.checksPullPromise].filter(Boolean);if(pending.length)await Promise.allSettled(pending);
        return true;
      },
      drainLegacy,verifyLegacyClean,markCutover:options=>p.sharedChecksV2Composition.markCutover(options),verifyCutover:()=>p.verifyStorageCutover(),
    });
    return transition;
  }
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
  async function beginCutover(){
    const p=requirePorts();if(p.storageShadow.cutoverActive)return {already:true};
    if(!tab.primaryTab)throw new Error('storage_cutover_primary_required');if(globalThis.navigator?.onLine===false)throw new Error('storage_cutover_online_required');
    const auth=p.cloudAuth.loadSession();owner.assertAuthenticatedOwner(auth?.user?.id);await p.cloudAuth.ensureSyncCapabilities();
    await transition.hydrate();await transition.begin();if(await p.verifyStorageCutover()!==true)throw new Error('storage_cutover_marker_verification_failed');
    return {already:false};
  }
  return {owner,bootstrap,preparing,mode,createRuntime,createCloudPorts,createSharedComposition,shadowEnabled,status,observerPorts,pendingLegacyWriteAllowed,legacyDrainActive,legacyWriteAllowed,legacyChecksWriteAllowed,configure,verifyLegacyClean,ownerAdoption,prepareAuthenticatedOwner,adoptAuthenticatedOwner,beginCutover,
    ownerUiPorts:()=>({prepareAuthenticatedStorageOwner:(...args)=>prepareAuthenticatedOwner(...args),storageOwnerCurrent:()=>owner.current(),storageOwnerAdoption:()=>ownerAdoption(),adoptAuthenticatedStorageOwner:(...args)=>adoptAuthenticatedOwner(...args)}),
    adoptionPort:()=>({adoptAuthenticatedStorageOwner:(...args)=>adoptAuthenticatedOwner(...args)}),
    transitionLifecyclePorts:()=>({hydrateStorageTransition:()=>transition.hydrate(),resumeStorageTransition:()=>transition.resume(),storageTransitionPreparing:()=>!!transition?.preparing}),
    hydrateTransition:()=>{if(!transition)throw new Error('orders_storage_v2_not_configured');return transition.hydrate()},resumeTransition:()=>{if(!transition)throw new Error('orders_storage_v2_not_configured');return transition.resume()},get transitionPreparing(){return !!transition?.preparing}};
}
