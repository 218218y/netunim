import {equalSyncJson} from './cloud-sync.js';
import {storageV2BootstrapStateHash} from './storage-v2-bootstrap.js';
import {createStorageV2Transition} from './storage-v2-transition.js';

function identity(value){const text=String(value||'').trim();if(!text||text==='local')throw new Error('storage_cutover_account_owner_required');return text}
function revision(row){const value=Number(row?.revision);return Number.isSafeInteger(value)&&value>=0?value:null}
function canonicalShared(value){if(!value||!Array.isArray(value.checks)||!Array.isArray(value.bankEvents))throw new Error('storage_cutover_shared_state_invalid');return {checks:value.checks,bankEvents:value.bankEvents}}

// Production adapter shared by Orders and Kupa. It deliberately knows nothing
// about legacy outbox formats: each app supplies drain/clean ports. The adapter
// owns the immutable bootstrap decision, TOCTOU verification, V2 initialization,
// remote/local parity checks and the final marker hand-off.
export function createStorageV2ProductionTransition({
  app,ownerBinding,primary=()=>true,online=()=>true,authOwner=()=>null,bootstrapCoordinator,cutoverDb,
  readMainState,projectMainState,emptyMainState,mainSourceSeq=()=>0,readSharedState,sharedSourceSeq=()=>0,
  readMainRemote,projectMainRemote=row=>row?.state,readSharedRemote,projectSharedRemote=row=>row?.state,
  initializeMainHead,initializeSharedHead,syncMain,syncShared,readMainCloudState,readSharedCloudState,
  freeze,drainLegacy,verifyLegacyClean,markCutover,verifyCutover,
}={}){
  const required=[ownerBinding?.current,ownerBinding?.assertAuthenticatedOwner,primary,online,authOwner,readMainState,projectMainState,emptyMainState,readSharedState,readMainRemote,readSharedRemote,initializeMainHead,initializeSharedHead,syncMain,syncShared,readMainCloudState,readSharedCloudState,freeze,drainLegacy,verifyLegacyClean,markCutover,verifyCutover];
  if(!bootstrapCoordinator||required.some(value=>typeof value!=='function'))throw new Error('storage_production_transition_configuration');
  const owner=()=>identity(ownerBinding.current());
  function guard(){if(!primary())throw new Error('storage_cutover_primary_required');if(!online())throw new Error('storage_cutover_online_required');const current=owner(),authenticated=String(authOwner()||'').trim();ownerBinding.assertAuthenticatedOwner(authenticated);if(authenticated!==current)throw new Error('storage_cutover_auth_owner_mismatch');return current}
  async function currentSources(){
    const mainFull=readMainState(),main=projectMainState(mainFull),shared=canonicalShared(readSharedState());
    return {mainFull,main,shared,mainSeq:Math.max(0,Number(mainSourceSeq()||0)),sharedSeq:Math.max(0,Number(sharedSourceSeq()||0))};
  }
  async function assertSourceHash(role,state,expected){const actual=await storageV2BootstrapStateHash(role,state);if(actual!==expected)throw new Error(`storage_cutover_${role}_source_changed`)}
  async function assertRemote(side,row,project){
    if(!row||revision(row)!==Number(side.remoteRevision))throw new Error(`storage_cutover_${side.role}_remote_changed`);
    const state=project(row);await assertSourceHash(side.role,state,side.remoteHash);return state;
  }
  async function discoverBootstrap(){
    const current=guard(),source=await currentSources(),[mainRow,sharedRow]=await Promise.all([readMainRemote(),readSharedRemote()]);guard();
    const mainRemote=mainRow?{state:projectMainRemote(mainRow),revision:revision(mainRow)}:null;
    const sharedRemote=sharedRow?{state:canonicalShared(projectSharedRemote(sharedRow)),revision:revision(sharedRow)}:null;
    if(mainRow&&mainRemote.revision===null)throw new Error('storage_cutover_main_remote_revision_invalid');
    if(sharedRow&&sharedRemote.revision===null)throw new Error('storage_cutover_shared_remote_revision_invalid');
    return {owner:current,sourceOwner:current,transferIntent:mainRemote?'legacy-upgrade':'first-cloud',mainSource:{state:source.main,seq:source.mainSeq},sharedSource:{state:source.shared,seq:source.sharedSeq},mainRemote,sharedRemote};
  }
  async function initializeMain(side,group){
    guard();const source=await currentSources();await assertSourceHash('main',source.main,side.sourceHash);const row=await readMainRemote();guard();
    if(side.intent==='cloud-authoritative'){
      const cloud=await assertRemote(side,row,projectMainRemote);return initializeMainHead({intent:'cloud-authoritative',sourceOwner:group.sourceOwner,operationId:side.operationId,revision:Number(side.remoteRevision),currentState:source.mainFull,cloudState:cloud});
    }
    if(side.intent!=='upload-owner'||row)throw new Error('storage_cutover_main_upload_target_changed');
    return initializeMainHead({intent:'upload-owner',sourceOwner:group.sourceOwner,operationId:side.operationId,revision:0,emptyState:emptyMainState(),currentState:source.mainFull});
  }
  async function initializeShared(side,group){
    guard();const source=await currentSources();await assertSourceHash('shared',source.shared,side.sourceHash);const row=await readSharedRemote();guard();
    if(side.intent==='cloud-authoritative'){
      const cloud=canonicalShared(await assertRemote(side,row,projectSharedRemote));return initializeSharedHead({state:cloud,revision:Number(side.remoteRevision),intent:'cloud-authoritative',sourceOwner:group.sourceOwner,bootstrapOperationId:side.operationId});
    }
    if(side.intent!=='upload-owner'||row)throw new Error('storage_cutover_shared_upload_target_changed');
    return initializeSharedHead({state:source.shared,revision:0,intent:'upload-owner',sourceOwner:group.sourceOwner,bootstrapOperationId:side.operationId});
  }
  async function verifySide(role,cloud,row,project){
    if(!cloud?.base||cloud.flight||cloud.control||cloud.pending)throw new Error(`storage_cutover_${role}_local_head_unsettled`);
    if(!row||revision(row)!==Number(cloud.base.revision))throw new Error(`storage_cutover_${role}_remote_revision_mismatch`);
    const remote=project(row),base=role==='shared'?canonicalShared(cloud.base.state):cloud.base.state,authoritative=role==='shared'?canonicalShared(remote):remote;
    if(!equalSyncJson(base,authoritative))throw new Error(`storage_cutover_${role}_remote_state_mismatch`);
    if(Number(cloud.base.ackSeq)!==Number(cloud.seq))throw new Error(`storage_cutover_${role}_ack_mismatch`);
    return Number(row.revision);
  }
  async function verifyHeads(){
    guard();if(await verifyLegacyClean()!==true)throw new Error('storage_cutover_legacy_pending');
    const [mainCloud,sharedCloud,mainRow,sharedRow]=await Promise.all([readMainCloudState(),readSharedCloudState(),readMainRemote(),readSharedRemote()]);guard();
    const mainRevision=await verifySide('main',mainCloud,mainRow,projectMainRemote),sharedRevision=await verifySide('shared',sharedCloud,sharedRow,projectSharedRemote);
    return {clean:true,mainRevision,sharedRevision};
  }
  const transition=createStorageV2Transition({app,owner,primary,bootstrapCoordinator,cutoverDb,freeze,discoverBootstrap,drainLegacy,verifyLegacyClean,
    initializeMain,initializeShared,
    syncMain:async()=>{guard();const ok=await syncMain();if(ok!==true)throw new Error('storage_cutover_main_sync_incomplete');return {clean:true}},
    syncShared:async()=>{guard();const ok=await syncShared();if(ok!==true)throw new Error('storage_cutover_shared_sync_incomplete');return {clean:true}},
    verifyBootstrap:verifyHeads,verifyHeads,markCutover,verifyCutover});
  return transition;
}
