import {createSharedChecksStorageV2,validateSharedChecksState} from './shared-checks-storage-v2.js';
import {createSharedChecksObserver} from './shared-checks-v2-shadow.js';
import {CLOUD_WRITE_POLICY,cloudWriteError,createOperationId,equalSyncJson,normalizeCloudError,operationAuditMetadata,runBusyCloudWriteWithPolicy,structuredSyncConflict} from './cloud-sync.js';

const canonical=state=>{validateSharedChecksState(state);return structuredClone({checks:state.checks,bankEvents:state.bankEvents})};
const stale=error=>/^storage_(ack_checkpoint_stale|rebase_checkpoint_stale|checkpoint_stale)$/.test(error?.message||'');

// One owner, one journal and one immutable RPC payload. Application adapters
// supply their existing check merge/normalization; this module owns durability.
// In particular, an authentication change is never a migration instruction.
export function createSharedChecksV2Runtime({owner,primary,mode=()=> 'off',readState,applyState,merge,readRemote,rpc,verifyLegacyClean,site,
  createStorage=createSharedChecksStorageV2,operationId=()=>createOperationId('shared-checks-v2'),now=()=>Date.now()}={}){
  if([owner,primary,readState,applyState,merge,readRemote,rpc,verifyLegacyClean].some(value=>typeof value!=='function'))throw new Error('shared_checks_runtime_configuration');
  let storage=null,identity='',opening=null,syncing=null,commits=Promise.resolve(),active=false,cursorReady=false,boundaryGate=()=>false;
  const risks=new Map();
  const diagnostics={recoveries:0,initializations:0,operations:0,acks:0,rebases:0,errors:0,lastError:''};
  const currentOwner=()=>String(owner()||'').trim();
  const primaryMode=()=>{const value=mode();return value==='primary'||value==='preparing'};
  const shadow=createSharedChecksObserver({owner,primary,readState,createStorage,enabled:()=>mode()==='shadow'&&!active});
  function assertContext(store=storage){
    if(!primaryMode()||!primary())throw new Error('shared_checks_primary_required');
    if(!store||store!==storage||identity!==currentOwner())throw new Error('shared_checks_owner_handoff_required');
  }
  function assertSyncAllowed(store=storage){assertContext(store);if(boundaryGate())throw new Error('storage_boundary_in_progress')}
  function context(){
    if(!primaryMode()||!primary()||!currentOwner())throw new Error('shared_checks_primary_required');
    if(identity!==currentOwner()||!storage){identity=currentOwner();storage=createStorage({owner,primary:()=>primary()&&primaryMode(),role:'primary'});active=false;cursorReady=false;commits=Promise.resolve()}
    return storage;
  }
  async function publish(store){
    // A local mutation can arrive while IDB is reading. Never replace it with
    // an earlier checkpoint, including just after a successful ACK transaction.
    for(let attempt=0;attempt<8;attempt++){
      assertContext(store);const recovered=await store.recover();assertContext(store);
      if(recovered.seq!==store.seq)continue;
      applyState(canonical(recovered.state));return recovered;
    }
    throw new Error('shared_checks_concurrent_publish');
  }
  function recover(){
    const store=context();if(opening?.store===store)return opening.promise;
    const promise=(async()=>{
      const recovered=await store.open();assertContext(store);
      if(!recovered)return null;
      const cloud=await store.cloudState();assertContext(store);
      if(!cloud.base&&currentOwner()!=='local')throw new Error('shared_checks_cursor_missing');
      if(!cloud.base&&(cloud.flight||cloud.control))throw new Error('shared_checks_local_head_invalid');
      active=true;cursorReady=!!cloud.base;diagnostics.recoveries++;
      return publish(store);
    })();
    opening={store,promise};promise.finally(()=>{if(opening?.promise===promise)opening=null}).catch(()=>{});return promise;
  }
  async function initialize({state,revision,intent,sourceOwner,bootstrapOperationId=''}={}){
    const store=context(),snapshot=canonical(state);
    if(active)throw new Error('shared_checks_already_active');
    // The verifier must read the durable V1 outbox as well as memory and the
    // synchronous cache. A failed IDB read is not evidence of a clean head.
    if(await verifyLegacyClean()!==true)throw new Error('shared_checks_legacy_pending_unverified');
    assertContext(store);
    if(intent==='legacy-upgrade'&&!equalSyncJson(canonical(readState()),snapshot))throw new Error('shared_checks_migration_state_changed');
    let recovered;
    try{recovered=await store.initializeCloudHead(revision,snapshot,{intent,sourceOwner,legacyPendingClean:true,bootstrapOperationId})}
    catch(error){
      if(error?.message!=='storage_initialization_exists'||!String(bootstrapOperationId||'').trim())throw error;
      recovered=await store.open();const cloud=await store.cloudState();
      if(!recovered||recovered.appMetadata?.bootstrapOperationId!==bootstrapOperationId||recovered.appMetadata?.migrationIntent!==intent||recovered.appMetadata?.sourceOwner!==sourceOwner||cloud?.base?.revision!==revision||!equalSyncJson(recovered.state,snapshot))throw new Error('shared_checks_bootstrap_existing_head_mismatch');
    }
    assertContext(store);active=true;cursorReady=true;diagnostics.initializations++;applyState(canonical(recovered.state));return recovered;
  }
  async function initializeLocal({state}={}){
    const store=context(),snapshot=canonical(state);
    if(identity!=='local')throw new Error('shared_checks_local_owner_required');
    if(await verifyLegacyClean()!==true)throw new Error('shared_checks_legacy_pending_unverified');
    await shadow.flush();
    assertContext(store);
    let recovered;
    try{recovered=await store.open({migrationState:snapshot,migrationIntent:'local-birth',sourceOwner:'local'})}
    catch(error){
      if(error?.message!=='shared_checks_storage_role_mismatch')throw error;
      recovered=await store.promoteVerifiedShadow(snapshot,{legacyPendingClean:true});
    }
    if(!recovered||!equalSyncJson(canonical(recovered.state),snapshot))throw new Error('shared_checks_local_birth_parity_mismatch');
    const cloud=await store.cloudState();if(cloud.base||cloud.flight||cloud.control)throw new Error('shared_checks_local_birth_cloud_head_exists');
    assertContext(store);active=true;cursorReady=false;diagnostics.initializations++;applyState(snapshot);return recovered;
  }
  async function promote({state,revision,sourceOwner}={}){
    const store=context(),snapshot=canonical(state);
    if(sourceOwner!==identity||await verifyLegacyClean()!==true)throw new Error('shared_checks_promotion_not_verified');
    assertContext(store);if(!equalSyncJson(canonical(readState()),snapshot))throw new Error('shared_checks_migration_state_changed');
    // Drain queued shadow work before touching its namespace. The stored role
    // also prevents a different shadow instance from reopening a primary head.
    await shadow.flush();assertContext(store);
    let recovered;
    try{recovered=await store.open()}catch(error){if(error.message!=='shared_checks_storage_role_mismatch')throw error;recovered=await store.promoteVerifiedShadow(snapshot,{legacyPendingClean:true})}
    assertContext(store);
    if(!recovered||!equalSyncJson(recovered.state,snapshot))throw new Error('shared_checks_shadow_parity_mismatch');
    const cloud=await store.cloudState();assertContext(store);
    if(!cloud.base)await store.captureCloudCursor(revision,snapshot,{legacyPendingClean:true});
    assertContext(store);active=true;cursorReady=true;return publish(store);
  }
  function persist(operations,{generation=0,surface='shared-checks',mutationType='edit',deleteIds=[],storageBoundary=''}={}){
    if(boundaryGate())throw new Error('storage_boundary_in_progress');
    if(mode()==='preparing')throw new Error('storage_v2_preparation_locked');
    if(mode()!=='primary')return {handled:false};
    // Primary is fail-closed. It must never silently resume either V1 or the
    // main journal when the checks owner is unavailable or the contract is bad.
    assertContext();if(!active)throw new Error('shared_checks_not_recovered');
    if(storageBoundary)throw new Error('shared_checks_coordinated_boundary_required');
    const store=storage,write=store.append(operations,readState(),{generation,surface,mutationType,deleteIds});
    diagnostics.operations++;
    const risk={owner:identity,failed:false};if(!write.emergencyDurable)risks.set(write,risk);
    write.committed.then(()=>risks.delete(write),error=>{if(risks.has(write))risk.failed=true;diagnostics.errors++;diagnostics.lastError=error.message});
    commits=write.committed;return {handled:true,...write};
  }
  function conflictControl(base,local,remote,conflicts,cloud){
    return {conflict:structuredSyncConflict({domain:'shared-checks',base:base.checks,local:local.checks,remote:remote.checks,conflicts,generation:cloud.pendingGeneration,baseRevision:cloud.base.revision,currentRemoteRevision:remote.revision})};
  }
  async function integrate(store,flight,row,rejected){
    if(!Number.isSafeInteger(row?.revision)||row.revision<=flight.baseRevision)throw new Error('shared_checks_response_revision_invalid');
    const remote=canonical(row.state);
    for(let attempt=0;attempt<8;attempt++){
      assertContext(store);const local=await store.recover(),cloud=await store.cloudState();assertContext(store);
      if(local.seq!==cloud.seq||local.seq!==store.seq)continue;
      const base=rejected?cloud.base.state:flight.snapshot,deleteIds=(rejected?cloud.pendingDeleteIntents:cloud.afterFlightDeleteIntents)?.checks||[];
      const merged=merge(base.checks,local.state.checks,remote.checks,{deleteIds});
      const control=merged.conflicts.length?conflictControl(base,local.state,{...remote,revision:row.revision},merged.conflicts,cloud):null;
      // A same-check conflict retains the visible local version and the remote
      // base for explicit resolution. Server bank events are still checkpointed.
      const currentState={checks:control?local.state.checks:merged.checks,bankEvents:remote.bankEvents};
      try{
        if(rejected)await store.rejectAndRebase(flight.operationId,row.revision,remote,{currentState,expectedSeq:local.seq,control});
        else await store.acknowledge(flight.operationId,row.revision,remote,{currentState,expectedSeq:local.seq,control});
      }catch(error){if(stale(error))continue;throw error}
      assertContext(store);diagnostics[rejected?'rebases':'acks']++;await publish(store);return !control;
    }
    throw new Error('shared_checks_concurrent_checkpoint');
  }
  async function synchronize(store){
    assertContext(store);if(!active)throw new Error('shared_checks_not_recovered');await commits;assertContext(store);
    let cloud=await store.cloudState();assertContext(store);
    if(!cloud.base)throw new Error('shared_checks_cursor_missing');
    if(cloud.control?.conflict)return false;
    if(Date.parse(cloud.control?.retry?.nextAttemptAt||'')>now())return false;
    for(let attempt=0;attempt<CLOUD_WRITE_POLICY.conflictAttempts;attempt++){
      assertContext(store);cloud=await store.cloudState();assertContext(store);
      if(cloud.control?.conflict)return false;
      if(!cloud.pending&&!cloud.flight){
        const before=store.seq,row=await readRemote();assertContext(store);
        if(!row)throw new Error('shared_checks_remote_missing');
        const remote=canonical(row.state);
        if(!Number.isSafeInteger(row.revision)||row.revision<cloud.base.revision)throw new Error('shared_checks_response_revision_invalid');
        // A mutation arriving during the read must be sent/merged normally.
        if(store.seq!==before)continue;
        try{assertSyncAllowed(store);await store.adoptCloudHead(row.revision,remote)}catch(error){if(error.message==='shared_checks_cloud_pending'||error.message==='storage_cloud_pending'||stale(error))continue;throw error}
        assertContext(store);await publish(store);return true;
      }
      assertSyncAllowed(store);const flight=await store.materializeFlight({operationId:operationId(),prepareAudit:value=>operationAuditMetadata({site,mutationType:value.mutationType,surface:value.surface,baseRevision:value.baseRevision,beforeState:cloud.base.state,afterState:value.snapshot,collections:['checks'],deleteCount:(value.deleteIntents?.checks||[]).length})});assertContext(store);
      const deletedIds=flight.deleteIntents?.checks||[];
      const audit=flight.audit;
      const result=await runBusyCloudWriteWithPolicy(()=>{assertContext(store);return rpc(structuredClone(flight.snapshot.checks),flight.baseRevision,flight.operationId,[...deletedIds],audit)});assertContext(store);
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
    assertSyncAllowed();const store=storage;if(syncing?.store===store)return syncing.promise;
    const promise=synchronize(store).catch(async error=>{
      diagnostics.errors++;diagnostics.lastError=error.message;
      if(error?.message==='shared_checks_cursor_missing')throw error;
      // Errors leave the flight intact. An old account's request cannot write
      // retry metadata or update the visible state after a handoff.
      try{assertSyncAllowed(store);const cloud=await store.cloudState();assertSyncAllowed(store);if(!cloud.control?.conflict){const normalized=normalizeCloudError(error);await store.setCloudControl({retry:{attempts:Number(cloud.control?.retry?.attempts||0)+1,lastErrorCode:normalized.code||normalized.kind,lastAttemptAt:new Date(now()).toISOString(),nextAttemptAt:normalized.retryAfterMs?new Date(now()+normalized.retryAfterMs).toISOString():null}})}}catch{/* The original error remains actionable. */}
      throw error;
    });
    syncing={store,promise};promise.finally(()=>{if(syncing?.promise===promise)syncing=null}).catch(()=>{});return promise;
  }
  async function replaceAuthoritativeState(state,{boundaryId}={}){
    assertContext();if(!active||!boundaryId)throw new Error('shared_checks_coordinated_boundary_required');
    const store=storage;await commits;assertContext(store);
    const result=await store.replaceAuthoritativeState(canonical(state),{boundaryId});assertContext(store);await publish(store);return result;
  }
  async function replaceLocalWithPending(state,{boundaryId,expectedSeq,expectedBaseRevision}={}){
    assertContext();if(!active||!boundaryId)throw new Error('shared_checks_coordinated_boundary_required');
    const store=storage;await commits;assertContext(store);
    const result=await store.replaceLocalWithPending(canonical(state),{boundaryId,expectedSeq,expectedBaseRevision});assertContext(store);await publish(store);return result;
  }
  async function replaceLocalAuthoritativeState(state,{boundaryId,expectedSeq}={}){
    assertContext();if(!active||!boundaryId||identity!=='local')throw new Error('shared_checks_coordinated_boundary_required');
    const store=storage;await commits;assertContext(store);
    const result=await store.replaceLocalAuthoritativeState(canonical(state),{boundaryId,expectedSeq});assertContext(store);await publish(store);return result;
  }
  async function resetCloudHead(revision,state,{boundaryId}={}){
    assertContext();if(!active||!boundaryId)throw new Error('shared_checks_coordinated_boundary_required');
    const store=storage;await commits;assertContext(store);
    const result=await store.resetCloudHead(revision,canonical(state),{boundaryId});assertContext(store);await publish(store);return result;
  }
  return {recover,initialize,initializeLocal,promote,persist,sync,diagnostics,setBoundaryGate:gate=>{if(typeof gate!=='function')throw new Error('storage_boundary_gate_invalid');boundaryGate=gate},
    replaceAuthoritativeState,replaceLocalWithPending,replaceLocalAuthoritativeState,resetCloudHead,
    observe:shadow.mutation,observeBoundary:shadow.boundary,
    async cloudState(){assertContext();const cloud=await storage.cloudState();cursorReady=!!cloud.base;return cloud},
    async flush(){await commits;return true},
    get requested(){return primaryMode()},
    get primaryReady(){return active&&primaryMode()&&primary()&&identity===currentOwner()&&storage?.ready},
    get localReady(){return active&&primaryMode()&&primary()&&identity===currentOwner()&&storage?.ready},
    get cloudReady(){return active&&cursorReady&&primaryMode()&&primary()&&identity===currentOwner()&&storage?.ready},
    get durabilityAtRisk(){return risks.size>0},get commitPromise(){return commits}};
}
