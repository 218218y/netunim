import {createSharedChecksStorageV2,validateSharedChecksState} from './shared-checks-storage-v2.js';
import {readStorageState} from './storage-operation.js';
import {storageRecoveryFailure} from './storage-v2-runtime.js';
import {CLOUD_WRITE_POLICY,cloudWriteError,createCloudRetryControl,createOperationId,equalSyncJson,normalizeCloudError,operationAuditMetadata,runBusyCloudWriteWithPolicy,structuredSyncConflict} from './cloud-sync.js';

/** @param {unknown} state */
const canonical=state=>{const verified=validateSharedChecksState(state);return structuredClone({checks:verified.checks,bankEvents:verified.bankEvents})};
/** @param {unknown} error */
const errorMessage=error=>error!==null&&typeof error==='object'&&'message' in error?String(error.message||''):'';
/** @param {unknown} error */
const stale=error=>/^storage_(ack_checkpoint_stale|rebase_checkpoint_stale|checkpoint_stale|cloud_adoption_stale)$/.test(errorMessage(error));

// One owner, one journal and one immutable RPC payload. Application adapters
// supply their existing check merge/normalization; this module owns durability.
// In particular, an authentication change is never a migration instruction.
/** @typedef {import('./shared-checks-runtime-contracts.js').Storage} Store */
/** @typedef {import('./shared-checks-runtime-contracts.js').Methods} Methods */
/** @typedef {import('./shared-checks-runtime-contracts.js').SharedState} SharedState */
/** @typedef {import('./shared-checks-runtime-contracts.js').Cloud} Cloud */
/** @typedef {import('./shared-checks-runtime-contracts.js').Flight} Flight */
/** @typedef {import('./shared-checks-runtime-contracts.js').Row} Row */
/** @param {Partial<import('./shared-checks-runtime-contracts.js').Options>} [options] */
export function createSharedChecksV2Runtime({owner:configuredOwner,primary:configuredPrimary,captureCommitAuthority=()=>configuredPrimary||(()=>false),mode=()=> 'off',readState:configuredReadState,applyState:configuredApplyState,merge:configuredMerge,readRemote:configuredReadRemote,rpc:configuredRpc,refreshBankRpc,site,
  createStorage=createSharedChecksStorageV2,operationId=()=>createOperationId('shared-checks-v2'),now=()=>Date.now(),random=Math.random}={}){
  if(typeof configuredOwner!=='function'||typeof configuredPrimary!=='function'||typeof configuredReadState!=='function'||typeof configuredApplyState!=='function'||typeof configuredMerge!=='function'||typeof configuredReadRemote!=='function'||typeof configuredRpc!=='function')throw new Error('shared_checks_runtime_configuration');
  const owner=configuredOwner,primary=configuredPrimary,readState=configuredReadState,applyState=configuredApplyState,merge=configuredMerge,readRemote=configuredReadRemote,rpc=configuredRpc;
  /** @type {Store|null} */ let storage=null;
  /** @type {import('./shared-checks-runtime-contracts.js').Opening|null} */ let opening=null;
  /** @type {import('./shared-checks-runtime-contracts.js').Syncing|null} */ let syncing=null;
  /** @type {Promise<unknown>} */ let commits=Promise.resolve();
  /** @type {string|null} */ let lastRemoteUpdatedAt=null;
  let identity='',active=false,cursorReady=false,boundaryGate=()=>false,commitAuthority=()=>false;
  let workPending=true,commitsInFlight=0,incidentRecoveryBlocked=false;
  /** @type {Map<import('./storage-journal-contracts.js').AppendAdmission,{store:Store,failed:boolean}>} */
  const risks=new Map();
  const diagnostics={recoveries:0,initializations:0,operations:0,acks:0,rebases:0,errors:0,lastError:''};
  const currentOwner=()=>String(owner()||'').trim();
  const primaryMode=()=>{const value=mode();return value==='primary'||value==='preparing'};
  const localReady=()=>active&&primaryMode()&&primary()&&commitAuthority()&&identity===currentOwner()&&!!storage?.ready;
  /** @param {Store|null} [store] @returns {Store} */
  function assertContext(store=storage){
    if(!primaryMode()||!primary())throw new Error('shared_checks_primary_required');
    if(!store||store!==storage||identity!==currentOwner()||!commitAuthority())throw new Error('shared_checks_owner_handoff_required');
    return store;
  }
  /** @param {Store|null} [store] @returns {Store} */
  function assertSyncAllowed(store=storage){const storeContext=assertContext(store);if(!active)throw new Error('shared_checks_not_recovered');if(boundaryGate())throw new Error('storage_boundary_in_progress');return storeContext}
  /** @param {Store|null} store */
  const current=store=>!!store&&store===storage&&identity===currentOwner()&&commitAuthority();
  /** @param {Store} store @param {string|null} epoch */
  function assertEpoch(store,epoch){assertContext(store);if(store.epoch!==epoch)throw new Error('shared_checks_owner_changed_during_operation')}
  function context(){
    if(!primaryMode()||!primary()||!currentOwner())throw new Error('shared_checks_primary_required');
    if(identity!==currentOwner()||!storage||!commitAuthority()){
      identity=currentOwner();commitAuthority=captureCommitAuthority();
      storage=createStorage({owner,primary:()=>primary()&&primaryMode(),commitPrimary:commitAuthority});
      active=false;cursorReady=false;lastRemoteUpdatedAt=null;commits=Promise.resolve();workPending=true;commitsInFlight=0;incidentRecoveryBlocked=false;
    }
    return storage;
  }
  /** @param {Store} store */
  async function publish(store){
    // A local mutation can arrive while IDB is reading. Never replace it with
    // an earlier checkpoint, including just after a successful ACK transaction.
    for(let attempt=0;attempt<8;attempt++){
      assertContext(store);const recovered=await store.recover();assertContext(store);
      if(!recovered)throw new Error('shared_checks_not_recovered');
      if(recovered.seq!==store.seq)continue;
      applyState(canonical(recovered.state));return recovered;
    }
    throw new Error('shared_checks_concurrent_publish');
  }
  /** @template {import('./storage-journal-model.js').ReplayedStorageJournal|null} T @param {Store} store @param {()=>Promise<T>} task */
  function activate(store,task){
    if(opening?.store===store)throw new Error('shared_checks_activation_in_progress');
    active=false;cursorReady=false;workPending=true;
    const promise=Promise.resolve().then(task).catch(error=>{
      if(current(store)){active=false;cursorReady=false;workPending=true;incidentRecoveryBlocked=storageRecoveryFailure(error)==='fatal'||/^shared_checks_(cursor_missing|local_head_invalid)$/.test(errorMessage(error))}
      throw error;
    });
    opening={store,promise};promise.finally(()=>{if(opening?.promise===promise)opening=null}).catch(()=>{});return promise;
  }
  function recover(){
    const store=context();if(opening?.store===store)return opening.promise;
    return activate(store,async()=>{
      const recovered=await store.open();assertContext(store);
      if(!recovered)return null;
      const cloud=await store.cloudState();assertContext(store);
      if(!cloud.base&&currentOwner()!=='local')throw new Error('shared_checks_cursor_missing');
      if(!cloud.base&&(cloud.flight||cloud.control))throw new Error('shared_checks_local_head_invalid');
      const result=await publish(store);assertContext(store);
      active=true;cursorReady=!!cloud.base;workPending=!!(cloud.pending||cloud.flight||cloud.control);diagnostics.recoveries++;incidentRecoveryBlocked=false;return result;
    });
  }
  async function recoverReadOnly(){
    if(!primaryMode()||!currentOwner())return null;
    const scopedOwner=currentOwner(),activeStore=storage,scopedIdentity=identity,epoch=storage?.epoch,writerAuthority=primary()&&activeStore?commitAuthority:null;
    const store=createStorage({owner:()=>scopedOwner,primary:()=>false});
    const isCurrent=()=>scopedOwner===currentOwner()&&storage===activeStore&&identity===scopedIdentity&&storage?.epoch===epoch&&primaryMode()&&(!writerAuthority||writerAuthority());
    try{
      const recovered=await store.recoverReadOnly();
      if(!isCurrent())throw new Error('shared_checks_owner_changed');
      if(!recovered)return null;
      applyState(canonical(recovered.state));diagnostics.recoveries++;return recovered;
    }catch(error){if(isCurrent()){diagnostics.errors++;diagnostics.lastError=errorMessage(error)}return null}
  }
  /** @type {Methods['initialize']} */
  async function initialize(options){
    const {state,revision,intent,sourceOwner,bootstrapOperationId=''}=options||{};
    const store=context(),snapshot=canonical(state);
    if(active)throw new Error('shared_checks_already_active');
    assertContext(store);
    return activate(store,async()=>{
      let recovered;
      try{recovered=await store.initializeCloudHead(revision,snapshot,{intent,sourceOwner,bootstrapOperationId})}
      catch(error){
        if(errorMessage(error)!=='storage_initialization_exists'||!String(bootstrapOperationId||'').trim())throw error;
        recovered=await store.open();const cloud=await store.cloudState();
        if(!recovered||recovered.appMetadata?.bootstrapOperationId!==bootstrapOperationId||recovered.appMetadata?.migrationIntent!==intent||recovered.appMetadata?.sourceOwner!==sourceOwner||cloud?.base?.revision!==revision||!equalSyncJson(recovered.state,snapshot))throw new Error('shared_checks_bootstrap_existing_head_mismatch');
      }
      const cloud=await store.cloudState();assertContext(store);
      applyState(canonical(recovered.state));assertContext(store);
      active=true;cursorReady=true;workPending=!!(cloud.pending||cloud.flight||cloud.control);diagnostics.initializations++;incidentRecoveryBlocked=false;return recovered;
    });
  }
  /** @type {Methods['initializeLocal']} */
  async function initializeLocal(options){
    const {state}=options||{};
    const store=context(),snapshot=canonical(state);
    if(identity!=='local')throw new Error('shared_checks_local_owner_required');
    assertContext(store);
    return activate(store,async()=>{
      const recovered=await store.open({migrationState:snapshot,migrationIntent:'local-birth',sourceOwner:'local'});
      if(!recovered||!equalSyncJson(canonical(recovered.state),snapshot))throw new Error('shared_checks_local_birth_parity_mismatch');
      const cloud=await store.cloudState();if(cloud.base||cloud.flight||cloud.control)throw new Error('shared_checks_local_birth_cloud_head_exists');
      assertContext(store);applyState(snapshot);assertContext(store);
      active=true;cursorReady=false;workPending=false;diagnostics.initializations++;incidentRecoveryBlocked=false;return recovered;
    });
  }
  /** @type {Methods['persist']} */
  function persist(operations,options={}){
    const {generation=0,surface='shared-checks',mutationType='edit',deleteIds=[]}=options;
    if(boundaryGate())throw new Error('storage_boundary_in_progress');
    if(mode()==='preparing')throw new Error('storage_v2_preparation_locked');
    if(mode()!=='primary')return {handled:false};
    // Primary is fail-closed. It must never silently resume either V1 or the
    // main journal when the checks owner is unavailable or the contract is bad.
    assertContext();if(!active)throw new Error('shared_checks_not_recovered');
    if(Object.hasOwn(options,'storageBoundary'))throw new Error('shared_checks_legacy_boundary_forbidden');
    const store=assertContext(),write=store.append(operations,readState(),{generation,surface,mutationType,deleteIds});
    diagnostics.operations++;
    workPending=true;commitsInFlight++;
    const risk={store,failed:false};if(!write.emergencyDurable)risks.set(write,risk);
    write.committed.then(()=>{if(store===storage)commitsInFlight--;risks.delete(write)},error=>{if(store===storage)commitsInFlight--;if(current(store)){diagnostics.errors++;diagnostics.lastError=errorMessage(error)}if(risks.has(write))risk.failed=true});
    commits=write.committed;return {handled:true,...write};
  }
  /** @param {SharedState} base @param {SharedState} local @param {SharedState & {revision:number}} remote @param {string[]} conflicts @param {Cloud & {base:NonNullable<Cloud['base']>}} cloud */
  function conflictControl(base,local,remote,conflicts,cloud){
    return {conflict:readStorageState(structuredSyncConflict({domain:'shared-checks',base:base.checks,local:local.checks,remote:remote.checks,conflicts,generation:cloud.pendingGeneration,baseRevision:cloud.base.revision,currentRemoteRevision:remote.revision}))};
  }
  /** @param {Store} store @param {Flight} flight @param {Row|null|undefined} row @param {boolean} rejected */
  async function integrate(store,flight,row,rejected){
    if(!row||!Number.isSafeInteger(row.revision)||row.revision<=flight.baseRevision)throw new Error('shared_checks_response_revision_invalid');
    const remote=canonical(row.state);
    for(let attempt=0;attempt<8;attempt++){
      assertContext(store);const local=await store.recover(),cloud=await store.cloudState();assertContext(store);
      if(!local||!cloud.base)throw new Error('shared_checks_not_recovered');
      if(local.seq!==cloud.seq||local.seq!==store.seq)continue;
      const base=canonical(rejected?cloud.base.state:flight.snapshot),localState=canonical(local.state),deleteIds=(rejected?cloud.pendingDeleteIntents:cloud.afterFlightDeleteIntents)?.checks||[];
      const merged=merge(base.checks,localState.checks,remote.checks,{deleteIds});
      const control=merged.conflicts.length?conflictControl(base,localState,{...remote,revision:row.revision},merged.conflicts,{...cloud,base:cloud.base}):null;
      // A same-check conflict retains the visible local version and the remote
      // base for explicit resolution. Server bank events are still checkpointed.
      const currentState={checks:control?localState.checks:merged.checks,bankEvents:remote.bankEvents};
      try{
        if(rejected)await store.rejectAndRebase(flight.operationId,row.revision,remote,{currentState,expectedSeq:local.seq,control});
        else await store.acknowledge(flight.operationId,row.revision,remote,{currentState,expectedSeq:local.seq,control});
      }catch(error){if(stale(error))continue;throw error}
      assertContext(store);diagnostics[rejected?'rebases':'acks']++;lastRemoteUpdatedAt=row.updated_at||lastRemoteUpdatedAt;await publish(store);return !control;
    }
    throw new Error('shared_checks_concurrent_checkpoint');
  }
  /** @param {Store} store */
  async function synchronize(store){
    assertContext(store);if(!active)throw new Error('shared_checks_not_recovered');await store.settled();assertContext(store);
    let cloud=await store.cloudState();assertContext(store);
    if(!cloud.base)throw new Error('shared_checks_cursor_missing');
    if(cloud.control?.conflict)return false;
    if(Date.parse(cloud.control?.retry?.nextAttemptAt||'')>now())return false;
    for(let attempt=0;attempt<CLOUD_WRITE_POLICY.conflictAttempts;attempt++){
      assertContext(store);cloud=await store.cloudState();assertContext(store);
      if(!cloud.base)throw new Error('shared_checks_cursor_missing');
      if(cloud.control?.conflict)return false;
      if(!cloud.pending&&!cloud.flight){
        const before=store.seq,row=await readRemote();assertContext(store);
        if(!row)throw new Error('shared_checks_remote_missing');
        const remote=canonical(row.state);
        if(!Number.isSafeInteger(row.revision)||row.revision<cloud.base.revision)throw new Error('shared_checks_response_revision_invalid');
        // A mutation arriving during the read must be sent/merged normally.
        if(store.seq!==before)continue;
        try{assertSyncAllowed(store);await store.adoptCloudHead(row.revision,remote)}catch(error){if(errorMessage(error)==='shared_checks_cloud_pending'||errorMessage(error)==='storage_cloud_pending'||stale(error))continue;throw error}
        assertContext(store);lastRemoteUpdatedAt=row.updated_at||lastRemoteUpdatedAt;await publish(store);return true;
      }
      const baseState=cloud.base.state;
      assertSyncAllowed(store);const flight=await store.materializeFlight({operationId:operationId(),prepareAudit:value=>({...operationAuditMetadata({...(site===undefined?{}:{site}),mutationType:value.mutationType,surface:value.surface,baseRevision:value.baseRevision,beforeState:baseState,afterState:value.snapshot,collections:['checks'],deleteCount:(value.deleteIntents?.checks||[]).length}),checkAmountPrecision:2})});assertContext(store);
      if(!flight)throw new Error('shared_checks_flight_missing');
      const deletedIds=flight.deleteIntents?.checks||[];
      const audit=flight.audit;
      const result=await runBusyCloudWriteWithPolicy(()=>{assertContext(store);return rpc(canonical(flight.snapshot).checks,flight.baseRevision,flight.operationId,[...deletedIds],audit)});assertContext(store);
      if(result?.r?.ok){if(!await integrate(store,flight,result.row,false))return false;continue}
      if(normalizeCloudError(result).kind!=='revision_conflict')throw cloudWriteError(result,'shared_checks_save_failed');
      // Only a definitive rejection permits rotation of an operation ID.
      const row=await readRemote();assertContext(store);
      if(!row)throw new Error('shared_checks_remote_missing');
      if(!await integrate(store,flight,row,true))return false;
    }
    cloud=await store.cloudState();assertContext(store);return !cloud.pending&&!cloud.flight&&!cloud.control?.conflict;
  }
  function sync(){
    assertSyncAllowed();const store=assertContext();if(syncing?.store===store)return syncing.promise;
    const promise=synchronize(store).catch(async error=>{
      if(current(store)){workPending=true;diagnostics.errors++;diagnostics.lastError=errorMessage(error)}
      if(errorMessage(error)==='shared_checks_cursor_missing')throw error;
      // Errors leave the flight intact. An old account's request cannot write
      // retry metadata or update the visible state after a handoff.
      try{assertSyncAllowed(store);const cloud=await store.cloudState();assertSyncAllowed(store);if(!cloud.control?.conflict)await store.setCloudControl({retry:createCloudRetryControl(error,cloud.control?.retry,{now,random})})}catch{/* The original error remains actionable. */}
      throw error;
    }).then(async result=>{
      assertContext(store);const cloud=await store.cloudState();assertContext(store);
      workPending=!!(cloud.pending||cloud.flight||cloud.control);return result;
    }).catch(error=>{if(current(store))workPending=true;throw error});
    syncing={store,promise};promise.finally(()=>{if(syncing?.promise===promise)syncing=null}).catch(()=>{});return promise;
  }
  /** @type {Methods['replaceAuthoritativeState']} */
  async function replaceAuthoritativeState(state,options){
    const {boundaryId}=options||{};
    assertContext();if(!active||!boundaryId)throw new Error('shared_checks_coordinated_boundary_required');
    const store=assertContext();await store.settled();assertContext(store);
    const result=await store.replaceAuthoritativeState(canonical(state),{boundaryId});assertContext(store);workPending=true;await publish(store);return result;
  }
  /** @type {Methods['replaceLocalWithPending']} */
  async function replaceLocalWithPending(state,options){
    const {boundaryId,expectedSeq,expectedBaseRevision}=options||{};
    assertContext();if(!active||!boundaryId)throw new Error('shared_checks_coordinated_boundary_required');
    const store=assertContext();await store.settled();assertContext(store);
    const result=await store.replaceLocalWithPending(canonical(state),{boundaryId,expectedSeq,expectedBaseRevision});assertContext(store);workPending=true;await publish(store);return result;
  }
  /** @type {Methods['replaceLocalAuthoritativeState']} */
  async function replaceLocalAuthoritativeState(state,options){
    const {boundaryId,expectedSeq}=options||{};
    assertContext();if(!active||!boundaryId||identity!=='local')throw new Error('shared_checks_coordinated_boundary_required');
    const store=assertContext();await store.settled();assertContext(store);
    const result=await store.replaceLocalAuthoritativeState(canonical(state),{boundaryId,expectedSeq});assertContext(store);workPending=true;await publish(store);return result;
  }
  /** @type {Methods['resetCloudHead']} */
  async function resetCloudHead(revision,state,options){
    const {boundaryId}=options||{};
    assertContext();if(!active||!boundaryId)throw new Error('shared_checks_coordinated_boundary_required');
    const store=assertContext();await store.settled();assertContext(store);
    const result=await store.resetCloudHead(revision,canonical(state),{boundaryId});assertContext(store);workPending=true;await publish(store);return result;
  }
  async function refreshBankMatches(){
    assertSyncAllowed();const store=assertContext();await store.settled();assertSyncAllowed(store);
    if(mode()!=='primary'||!active||!cursorReady)throw new Error('shared_checks_not_recovered');
    if(typeof refreshBankRpc!=='function')throw new Error('check_bank_refresh_unavailable');
    const cloud=await store.cloudState();assertSyncAllowed(store);
    if(cloud.pending||cloud.flight||cloud.control||commitsInFlight||workPending||syncing?.store===store||[...risks.values()].some(risk=>risk.store===store))return {status:'pending'};
    if(!cloud.base)throw new Error('shared_checks_cursor_missing');
    const result=await refreshBankRpc(cloud.base.revision);assertSyncAllowed(store);
    return result;
  }
  async function incidentSample(){
    const store=storage,scopedIdentity=identity;
    const current=()=>!!store&&store===storage&&active&&store.ready&&primaryMode()&&primary()&&commitAuthority()&&scopedIdentity===currentOwner()&&!boundaryGate();
    return (await import('./sync-journal-incident.js')).sampleJournalIncident({read:()=>store?store.cloudState():Promise.resolve(null),ready:current,
      current:cloud=>!!store&&store.seq===cloud.seq&&commitsInFlight===0&&![...risks.values()].some(risk=>risk.store===store),
      epoch:()=>store?.epoch,durabilityError:()=>current()&&[...risks.values()].some(risk=>risk.store===store&&risk.failed),
      blocked:()=>store===storage&&(incidentRecoveryBlocked||!!store?.journalBlocked)&&primary()&&scopedIdentity===currentOwner(),fatal:storageRecoveryFailure});
  }
  return {incidentSample,recover,recoverReadOnly,initialize,initializeLocal,persist,sync,refreshBankMatches,diagnostics,setBoundaryGate:(/** @type {()=>boolean} */ gate)=>{if(typeof gate!=='function')throw new Error('storage_boundary_gate_invalid');boundaryGate=gate},
    replaceAuthoritativeState,replaceLocalWithPending,replaceLocalAuthoritativeState,resetCloudHead,
    async cloudState(){const store=assertContext(),epoch=store.epoch,cloud=await store.cloudState();assertEpoch(store,epoch);cursorReady=!!cloud.base;if(cloud.pending||cloud.flight||cloud.control)workPending=true;return cloud},
    async flush(){const store=assertContext(),epoch=store.epoch;if(!active)throw new Error('shared_checks_not_recovered');await store.settled();assertEpoch(store,epoch);if(!active||!store.ready)throw new Error('shared_checks_not_recovered');return true},
    get requested(){return primaryMode()},
    get primaryReady(){return localReady()},
    get localReady(){return localReady()},
    get cloudReady(){return cursorReady&&localReady()},
    get hasLocalWork(){return !active||!primaryMode()||!primary()||!commitAuthority()||identity!==currentOwner()||boundaryGate()||workPending||commitsInFlight>0||syncing?.store===storage||[...risks.values()].some(risk=>risk.store===storage)},
    get lastRemoteUpdatedAt(){return lastRemoteUpdatedAt},
    get durabilityAtRisk(){return risks.size>0},get commitPromise(){return commits}};
}
