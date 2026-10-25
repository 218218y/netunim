import {createStorageJournal} from './storage-journal.js';
import {StorageCloudRecordError} from './storage-cloud-records.js';
import {STORAGE_SCHEMAS} from './storage-v2-schema.js';
import {equalSyncJson} from './cloud-sync.js';
import {storageOwnerReady} from './storage-owner-binding.js';
import {isStorageV2ActivationCached} from './storage-v2-activation-cache.js';
import {captureStorageCommandOptions} from './storage-journal-authority.js';

// Only invalid persisted data poisons an identity. IDB open/abort, blocked
// connections and owner fencing may recover without a page reload.
/** @param {unknown} error */
export function storageRecoveryFailure(error){
  if(error instanceof StorageCloudRecordError||error!==null&&typeof error==='object'&&'name' in error&&error.name==='DataInvariantError'||error instanceof SyntaxError)return 'fatal';
  const message=errorMessage(error);
  return /^(storage_(checksum_mismatch|non_json_value|unsafe_key|checkpoint_metadata|committed_metadata_mismatch|committed_journal_missing|invalid_checkpoint|invalid_operation|invalid_local_import|invalid_field|invalid_collection|invalid_collection_record|invalid_put|unknown_operation|foreign_operation|journal_metadata_invalid|journal_invalid|journal_payload_invalid|journal_key_mismatch|duplicate_sequence|journal_gap_or_duplicate|missing_collection|delete_target_missing|insert_conflict|update_target_missing|delete_intents_invalid|emergency_owner|main_projection_invalid))$/.test(message)?'fatal':'retryable';
}
/** @param {unknown} error */
function errorMessage(error){return error!==null&&typeof error==='object'&&'message' in error?String(error.message||''):''}


/** @param {import('./storage-v2-runtime-contracts.js').App} app @param {Pick<Storage,'getItem'>} [storage] @param {string} [owner] @param {{preparing?:boolean}} [options] @returns {import('./storage-v2-runtime-contracts.js').Mode} */
export function storageV2Mode(app,storage=globalThis.localStorage,owner='local',{preparing=false}={}){
  try{
    const account=String(owner||'').trim();
    if(!storageOwnerReady(account))return 'off';
    if(isStorageV2ActivationCached(app,account,storage))return 'primary';
    if(preparing)return 'preparing';
    return 'off';
  }catch{return 'off'}
}

// Bridges the journal engine into application persistence. A normal typed
// mutation is synchronously durable in the bounded emergency journal and then
// committed to IndexedDB. Durable boundaries install coordinated checkpoints.
/** @typedef {import('./storage-v2-runtime-contracts.js').Journal} Journal */
/** @typedef {import('./storage-journal-contracts.js').State} State */
/** @typedef {import('./storage-v2-runtime-contracts.js').RuntimeMethods} RuntimeMethods */
/** @param {Partial<import('./storage-v2-runtime-contracts.js').Options>} [options] */
export function createStorageV2Runtime({app:configuredApp,owner:configuredOwner,primary:configuredPrimary,captureCommitAuthority:configuredAuthority,validate:configuredValidate,prepareCheckpoint=state=>structuredClone(state),prepareOperation=operation=>structuredClone(operation),mode:configuredMode,createJournal=createStorageJournal,scheduleIdle=callback=>typeof globalThis.requestIdleCallback==='function'?requestIdleCallback(callback,{timeout:5000}):setTimeout(callback,1000),compactEvery=128,compactAfterMs=5*60*1000}={}){
  if(!configuredApp||!STORAGE_SCHEMAS[configuredApp]||typeof configuredOwner!=='function'||typeof configuredPrimary!=='function'||typeof configuredValidate!=='function')throw new Error('storage_v2_runtime_configuration');
  const app=configuredApp,owner=configuredOwner,primary=configuredPrimary,validate=configuredValidate;
  const mode=configuredMode||(()=>storageV2Mode(app,globalThis.localStorage,owner())),captureCommitAuthority=configuredAuthority||(()=>primary);
  /** @type {import('./storage-v2-runtime-contracts.js').Diagnostics} */
  const diagnostics={mode:'off',recoveries:0,operations:0,emergencyFailures:0,commitFailures:0,errors:0,lastError:'',pendingCommits:0,peakPendingCommits:0,undurableCommits:0,maxCommitLatencyMs:0};
  /** @type {Journal|null} */ let journal=null;
  /** @type {Promise<import('./storage-v2-runtime-contracts.js').Recovery|null>|null} */ let starting=null;
  /** @type {Journal|null} */ let startingIdentity=null;
  /** @type {Promise<unknown>} */ let commits=Promise.resolve();
  /** @type {object|false} */ let compactionScheduled=false;
  let identity='',authoritative=false,corruptIdentity='',operationsSinceCheckpoint=0,lastCheckpointAt=Date.now(),undurableCount=0,boundaryGate=()=>false;
  const guardCloudMutation=()=>{if(boundaryGate())throw new Error('storage_boundary_in_progress')};
  /** @type {Map<Journal,{epoch:string|null,seq:number}>} */ const undurableFailures=new Map();
  /** @param {State} state */
  const business=state=>{const copy=structuredClone(state||{});delete copy._meta;return copy};
  /** @param {State} state */
  const checkpointState=state=>{const copy=prepareCheckpoint(business(state));delete copy.checks;return copy};
  const primaryMode=()=>{const value=mode();return value==='primary'||value==='preparing'};
  function currentOwner(){return String(owner()||'').trim()||'local'}
  function readyForCurrentOwner(){return primaryMode()&&primary()&&authoritative&&identity===currentOwner()&&!!journal?.ready}
  function create(){
    const next=currentOwner();
    if(journal&&identity===next)return journal;
    identity=next;authoritative=false;commits=Promise.resolve();operationsSinceCheckpoint=0;lastCheckpointAt=Date.now();compactionScheduled=false;const scopedOwner=next,commitPrimary=captureCommitAuthority();
    journal=createJournal({owner:`${scopedOwner}:${app}`,schema:STORAGE_SCHEMAS[app],validate,primary:()=>primaryMode()&&primary()&&scopedOwner===currentOwner(),commitPrimary:()=>primaryMode()&&commitPrimary()&&scopedOwner===currentOwner()});corruptIdentity='';return journal;
  }
  /** @param {Journal|null} active @param {boolean} [writer] */
  function currentJournal(active,writer=true){return active===journal&&identity===currentOwner()&&primaryMode()&&(!writer||primary())}
  /** @param {Journal} active @param {number} seq @param {string|null} epoch */
  function checkpointCompleted(active,seq,epoch){
    if(!currentJournal(active)||active.epoch!==epoch||!readyForCurrentOwner())return;
    operationsSinceCheckpoint=Math.max(0,active.seq-seq);lastCheckpointAt=Date.now();
  }
  /** @template {import('./storage-journal-model.js').ReplayedStorageJournal} T @param {Journal} active @param {T} recovered @returns {T} */
  function verifiedRecovery(active,recovered){
    // An open alone cannot prove that an IDB-only edit survived. Keep its risk
    // until the same epoch and sequence have actually been recovered.
    const failure=undurableFailures.get(active);
    if(failure&&failure.epoch===recovered.epoch&&recovered.seq>=failure.seq)undurableFailures.delete(active);
    return recovered;
  }
  /** @type {RuntimeMethods['recover']} */
  async function recover(){
    if(!primaryMode()||!primary())return null;
    diagnostics.mode=mode();const active=create(),activeIdentity=identity;
    if(corruptIdentity===activeIdentity)return null;
    if(starting&&startingIdentity===active)return starting;
    /** @type {Promise<import('./storage-v2-runtime-contracts.js').Recovery|null>|undefined} */ let request;
    request=(async()=>{
      try{
        const observedCommits=commits;
        await observedCommits.catch(()=>{});
        if(!currentJournal(active))throw new Error('storage_owner_changed_during_recovery');
        const recovered=await active.open();
        if(!currentJournal(active))throw new Error('storage_owner_changed_during_recovery');
        if(commits===observedCommits)commits=Promise.resolve();
        if(!recovered||recovered.appMetadata?.storageRole!=='primary'){authoritative=false;return null}
        authoritative=true;
        diagnostics.recoveries++;
        const checkpoint=recovered.stored?.checkpoints?.data;
        operationsSinceCheckpoint=Math.max(0,recovered.seq-Number(checkpoint&&typeof checkpoint==='object'&&'seq' in checkpoint?checkpoint.seq||0:0));
        return {...verifiedRecovery(active,recovered),appMetadata:{...recovered.appMetadata,storageRole:recovered.appMetadata.storageRole},source:/** @type {const} */('v2')};
      }catch(error){if(currentJournal(active)){authoritative=false;diagnostics.errors++;diagnostics.lastError=errorMessage(error);diagnostics.recoveryFailure=storageRecoveryFailure(error);if(diagnostics.recoveryFailure==='fatal')corruptIdentity=activeIdentity}return null}
      finally{if(starting===request){starting=null;startingIdentity=null}}
    })();
    starting=request;startingIdentity=active;return request;
  }
  /** @type {RuntimeMethods['recoverReadOnly']} */
  async function recoverReadOnly(){
    if(!primaryMode())return null;
    const runtimeMode=mode();diagnostics.mode=runtimeMode;const active=create(),activeIdentity=identity;
    if(corruptIdentity===activeIdentity)return null;
    try{
      const recovered=await active.recover();
      if(!currentJournal(active,false))throw new Error('storage_owner_changed_during_recovery');
      if(!recovered||recovered.appMetadata?.storageRole!=='primary')return null;
      diagnostics.recoveries++;return {...recovered,appMetadata:{...recovered.appMetadata,storageRole:recovered.appMetadata.storageRole},source:'v2-readonly'};
    }catch(error){if(currentJournal(active,false)){diagnostics.errors++;diagnostics.lastError=errorMessage(error);diagnostics.recoveryFailure=storageRecoveryFailure(error);if(diagnostics.recoveryFailure==='fatal'){authoritative=false;corruptIdentity=activeIdentity}}return null}
  }
  /** @type {RuntimeMethods['recoverForOwner']} */
  async function recoverForOwner(options){
    const {intent}=options||{};
    if(intent!=='load-account')throw new Error('storage_owner_transfer_intent_required');
    return recover();
  }
  /** @type {RuntimeMethods['initializeLocal']} */
  async function initializeLocal(state,{appMetadata={}}={}){
    if(currentOwner()!=='local'||!primaryMode()||!primary())throw new Error('storage_local_birth_owner_required');
    const canonical=checkpointState(state);validate(canonical);appMetadata=structuredClone(appMetadata);
    const active=create(),scopedIdentity=identity;
    let recovered=await active.open();
    if(!currentJournal(active))throw new Error('storage_local_birth_owner_changed');
    if(recovered){
      if(!equalSyncJson(recovered.state,canonical))throw new Error('storage_local_birth_parity_mismatch');
      if(recovered.appMetadata?.storageRole!=='primary')throw new Error('storage_local_birth_role_invalid');
    }
    const cloud=recovered?await active.cloudState():null;
    if(!currentJournal(active))throw new Error('storage_local_birth_owner_changed');
    if(cloud?.base||cloud?.flight||cloud?.control)throw new Error('storage_local_birth_cloud_head_exists');
    if(!recovered){
      await active.install(canonical,{expectedEpoch:null,appMetadata:{...appMetadata,storageRole:'primary',migrationIntent:'local-birth',sourceOwner:'local',mainProjectionVersion:2}});
      if(!currentJournal(active))throw new Error('storage_local_birth_owner_changed');
      recovered=await active.recover();
    }
    if(!recovered||!currentJournal(active)||scopedIdentity!==currentOwner()||!equalSyncJson(recovered.state,canonical))throw new Error('storage_local_birth_owner_changed');
    authoritative=true;return verifiedRecovery(active,recovered);
  }
  /** @type {RuntimeMethods['initializeCloudHead']} */
  async function initializeCloudHead(revision,state,options){
    const {sourceOwner,intent,cloudState=state,changes=null,validateBase=validate,appMetadata={}}=options||{};
    if(!primaryMode()||!primary())throw new Error('storage_v2_primary_not_ready');
    const active=create(),scopedIdentity=identity;
    const validIntent=intent==='cloud-authoritative'&&sourceOwner===scopedIdentity||intent==='upload-local'&&sourceOwner==='local'&&revision===0;
    if(!validIntent||sourceOwner===undefined||intent===undefined)throw new Error('storage_owner_transfer_intent_required');
    const prepared=checkpointState(state),preparedChanges=changes?.map(change=>change?.type==='replace-state'?{...change,state:checkpointState(change.state)}:change)??null;
    /** @type {State} */ const metadata={...appMetadata,storageRole:'primary',sourceOwner,targetOwner:scopedIdentity,migrationIntent:intent,mainProjectionVersion:2};
    let result;
    try{result=await active.initializeCloudHead(revision,prepared,{cloudState,changes:preparedChanges,validateBase,appMetadata:metadata})}
    catch(error){
      if(errorMessage(error)!=='storage_initialization_exists'||!String(metadata.bootstrapOperationId||'').trim())throw error;
      const recovered=await active.open(),cloud=await active.cloudState({validateBase});
      const finalState=preparedChanges?.length===1&&preparedChanges[0]?.type==='replace-state'?preparedChanges[0].state:prepared;
      const idempotent=!!recovered&&recovered.appMetadata?.bootstrapOperationId===metadata.bootstrapOperationId&&recovered.appMetadata?.migrationIntent===intent&&recovered.appMetadata?.sourceOwner===sourceOwner&&recovered.appMetadata?.targetOwner===scopedIdentity&&cloud?.base?.revision===revision&&equalSyncJson(cloud.base.state,cloudState)&&equalSyncJson(recovered.state,finalState);
      if(idempotent)result=recovered;
      else throw new Error('storage_bootstrap_existing_head_mismatch');
    }
    if(!currentJournal(active))throw new Error('storage_owner_changed_during_recovery');
    authoritative=true;return result;
  }
  /** @type {RuntimeMethods['initializeUploadLocalCloudHead']} */
  async function initializeUploadLocalCloudHead(emptyState,currentState,options){
    const {cloudState,validateBase=validate,appMetadata={}}=options||{};
    if(currentOwner()==='local')throw new Error('storage_owner_transfer_target_required');
    const initial=checkpointState(emptyState),target=checkpointState(currentState);
    validate(initial);validate(target);if(cloudState===undefined)throw new Error('storage_bootstrap_cloud_base_required');validateBase(cloudState);
    const recovered=await initializeCloudHead(0,initial,{sourceOwner:'local',intent:'upload-local',cloudState,validateBase,changes:[{type:'replace-state',state:target}],appMetadata});
    if(!equalSyncJson(recovered.state,target)||recovered.seq!==1)throw new Error('storage_bootstrap_replay_mismatch');
    return recovered;
  }
  /** @param {State} state @param {import('./storage-records.js').StorageChange[]} operations */
  function canonicalOperations(state,operations){
    const source=state||{};
    /** @type {Map<string,Map<string,State & {id:string}>>} */ const byCollection=new Map();
    return operations.map(operation=>{
      if(operation.type!=='put')return prepareOperation(operation);
      if(!byCollection.has(operation.collection)){
        const rows=source[operation.collection]||[];
        if(!Array.isArray(rows))throw new Error('storage_operation_record_missing');
        /** @type {Map<string,State & {id:string}>} */ const records=new Map();
        for(const row of rows)if(row&&typeof row==='object'&&!Array.isArray(row)&&typeof row.id==='string')records.set(row.id,{...row,id:row.id});
        byCollection.set(operation.collection,records);
      }
      const record=byCollection.get(operation.collection)?.get(operation.id);
      if(!record)throw new Error('storage_operation_record_missing');
      return prepareOperation({...operation,record});
    });
  }
  function scheduleCompaction(){
    if(compactionScheduled||!journal?.ready)return;
    const active=journal,epoch=active.epoch,task={};compactionScheduled=task;
    const current=()=>currentJournal(active)&&active.epoch===epoch&&readyForCurrentOwner();
    scheduleIdle(async()=>{
      try{
        if(!current()||(!operationsSinceCheckpoint&&Date.now()-lastCheckpointAt<compactAfterMs))return;
        await commits;
        if(!current())return;
        const seq=await active.compact();
        if(current())checkpointCompleted(active,seq,epoch);
      }catch(error){if(current()){diagnostics.errors++;diagnostics.lastError=errorMessage(error)}}
      finally{if(compactionScheduled===task)compactionScheduled=false}
    });
  }
  /** @type {RuntimeMethods['persist']} */
  function persist(state,options={},appMetadata={}){
    const {operations=null,generation=0,surface='',mutationType='autosave',deleteIntents={}}=options;
    if(boundaryGate())throw new Error('storage_boundary_in_progress');
    const runtimeMode=mode();if(runtimeMode==='preparing')throw new Error('storage_v2_preparation_locked');
    if(runtimeMode!=='primary'||!primary())return {handled:false,reason:'inactive'};
    diagnostics.mode='primary';const active=create(),typed=Array.isArray(operations)&&operations.length>0;
    if(!authoritative||!active.ready)return {handled:false,reason:'not-ready'};
    if(Object.hasOwn(options,'storageBoundary')){diagnostics.errors++;diagnostics.lastError='storage_legacy_boundary_forbidden';return {handled:false,reason:'legacy-boundary'} }
    if(!typed){diagnostics.errors++;diagnostics.lastError='storage_mutation_contract_required';return {handled:false,reason:'contract'} }
    try{
      const started=Date.now(),write=active.append(canonicalOperations(state,operations),{generation,surface,mutationType,deleteIntents,appMetadata:{...appMetadata,storageRole:'primary'}});diagnostics.operations++;operationsSinceCheckpoint++;
      diagnostics.pendingCommits++;diagnostics.peakPendingCommits=Math.max(diagnostics.peakPendingCommits,diagnostics.pendingCommits);
      const settled=()=>{diagnostics.pendingCommits--;diagnostics.maxCommitLatencyMs=Math.max(diagnostics.maxCommitLatencyMs,Math.max(0,Date.now()-started))};
      write.committed.then(settled,settled);
      if(!write.emergencyDurable){
        diagnostics.emergencyFailures++;undurableCount++;diagnostics.undurableCommits++;
        // This mutation has no synchronous durable copy. It becomes safe only
        // after the IndexedDB transaction completes; until then unload is blocked.
        const failedEpoch=active.epoch;
        write.committed.then(()=>{undurableCount--;diagnostics.undurableCommits--},()=>{undurableCount--;diagnostics.undurableCommits--;const prior=undurableFailures.get(active);undurableFailures.set(active,{epoch:failedEpoch,seq:Math.max(Number(prior?.seq||0),Number(write.seq||0))})});
      }
      commits=commits.catch(()=>{}).then(()=>write.committed).catch(error=>{diagnostics.commitFailures++;diagnostics.lastError=errorMessage(error);throw error});
      if(operationsSinceCheckpoint>=compactEvery||Date.now()-lastCheckpointAt>=compactAfterMs)scheduleCompaction();
      return {handled:true,emergencyDurable:write.emergencyDurable,transitionFallbackDurable:write.transitionFallbackDurable,committed:write.committed,seq:write.seq,transitioning:!!write.transitioning,reason:write.emergencyDurable?'journal':'idb-commit-pending'};
    }catch(error){diagnostics.errors++;diagnostics.lastError=errorMessage(error);return {handled:false,reason:'append-failed',error}}
  }
  async function flush(){
    if(starting)await starting;
    try{const active=await settledJournal();await active.settled();return currentJournal(active)&&readyForCurrentOwner()&&!active.error}catch{return false}
  }
  async function settledJournal(){
    if(!journal||!readyForCurrentOwner())throw new Error('storage_v2_primary_not_ready');
    const active=journal,epoch=active.epoch;await commits;
    if(!currentJournal(active)||active.epoch!==epoch||!readyForCurrentOwner())throw new Error('storage_owner_changed_during_operation');
    return active;
  }
  /** @type {RuntimeMethods['setCloudBase']} */
  async function setCloudBase(revision,state,options){
    guardCloudMutation();const candidate=structuredClone(state),next=captureStorageCommandOptions(options);
    const active=await settledJournal();guardCloudMutation();return active.setCloudBase(revision,candidate,next);
  }
  /** @type {RuntimeMethods['captureCloudCursor']} */
  async function captureCloudCursor(revision,options={}){
    guardCloudMutation();const next=captureStorageCommandOptions(options),active=await settledJournal();
    guardCloudMutation();return active.captureCloudCursor(revision,next);
  }
  /** @type {RuntimeMethods['cloudState']} */
  async function cloudState(options={}){if(!readyForCurrentOwner())return null;return (await settledJournal()).cloudState(options)}
  /** @type {RuntimeMethods['materializeFlight']} */
  async function materializeFlight(options={}){
    guardCloudMutation();const next=captureStorageCommandOptions(options),active=await settledJournal();
    guardCloudMutation();return active.materializeFlight(next);
  }
  /** @type {RuntimeMethods['acknowledgeFlight']} */
  async function acknowledgeFlight(operationId,revision,state,options={}){
    guardCloudMutation();const candidate=structuredClone(state),next=captureStorageCommandOptions(options);
    if(next.currentState!==undefined){next.checkpointState=checkpointState(next.currentState);delete next.currentState}
    const active=await settledJournal();guardCloudMutation();return active.acknowledge(operationId,revision,candidate,next);
  }
  /** @type {RuntimeMethods['rejectFlight']} */
  async function rejectFlight(operationId,revision,state,options){
    guardCloudMutation();const candidate=structuredClone(state),next=captureStorageCommandOptions(options);
    const checkpoint=next.currentState!==undefined?checkpointState(next.currentState):next.checkpointState;
    delete next.currentState;
    if(checkpoint===undefined)throw new Error('storage_rebase_checkpoint_required');
    const active=await settledJournal();guardCloudMutation();return active.rejectAndRebase(operationId,revision,candidate,{...next,checkpointState:checkpoint});
  }
  /** @type {RuntimeMethods['setCloudControl']} */
  async function setCloudControl(control={},options={}){
    guardCloudMutation();const candidate=structuredClone(control),next=captureStorageCommandOptions(options);
    const expected=next.expectedScope||{owner:`${identity}:${app}`,epoch:journal?.epoch},active=await settledJournal();guardCloudMutation();
    if(expected.owner!==`${identity}:${app}`||expected.epoch!==active.epoch)throw Object.assign(new Error('storage_cloud_scope_changed'),{code:'storage_cloud_scope_changed'});
    return active.setCloudControl(candidate,{expectedEpoch:expected.epoch,...(next.isCurrent?{isCurrent:next.isCurrent}:{})});
  }
  /** @type {RuntimeMethods['clearCloudControl']} */
  async function clearCloudControl(options={}){
    guardCloudMutation();if(!readyForCurrentOwner())return false;
    const next=captureStorageCommandOptions(options),active=await settledJournal();guardCloudMutation();return active.clearCloudControl(next);
  }
  /** @type {RuntimeMethods['readCloudRecovery']} */
  async function readCloudRecovery(options={}){
    const next=captureStorageCommandOptions(options);
    if(next.previousState!==null&&next.previousState!==undefined)next.previousState=checkpointState(next.previousState);
    const active=await settledJournal();return active.readCloudRecovery(next);
  }
  /** @type {RuntimeMethods['commitCloudRecovery']} */
  async function commitCloudRecovery(state,options){
    guardCloudMutation();const candidate=checkpointState(state),next=captureStorageCommandOptions(options),active=await settledJournal();
    guardCloudMutation();return active.commitCloudRecovery(candidate,next);
  }
  /** @type {RuntimeMethods['replaceCurrentState']} */
  async function replaceCurrentState(state,options={}){
    const candidate=checkpointState(state),next=captureStorageCommandOptions(options),active=await settledJournal(),epoch=active.epoch;
    const result=await active.replaceCurrentState(candidate,next);checkpointCompleted(active,result,epoch);return result;
  }
  /** @type {RuntimeMethods['replaceLocalAuthoritativeState']} */
  async function replaceLocalAuthoritativeState(state,options){
    const {boundaryId,expectedSeq}=options||{};
    if(currentOwner()!=='local')throw new Error('storage_boundary_local_owner_required');
    const candidate=checkpointState(state),active=await settledJournal();
    if(boundaryId===undefined||expectedSeq===undefined)throw new Error('storage_boundary_source_required');
    const result=await active.replaceLocalAuthoritativeState(candidate,{boundaryId,expectedSeq});
    checkpointCompleted(active,result.seq,result.epoch);return result;
  }
  /** @type {RuntimeMethods['adoptCloudHead']} */
  async function adoptCloudHead(revision,cloudState,currentState,options={}){guardCloudMutation();const durableCloud=structuredClone(cloudState),durableCurrent=checkpointState(currentState),next=captureStorageCommandOptions(options);const active=await settledJournal(),epoch=active.epoch;guardCloudMutation();const result=await active.adoptCloudHead(revision,durableCloud,durableCurrent,next);checkpointCompleted(active,result.seq,epoch);return result}
  /** @type {RuntimeMethods['replaceAuthoritativeState']} */
  async function replaceAuthoritativeState(currentState,options={}){
    if(!readyForCurrentOwner())return false;
    const candidate=checkpointState(currentState),next=captureStorageCommandOptions(options);
    const metadata={...next.appMetadata,mainProjectionVersion:2},active=await settledJournal();
    const result=await active.replaceAuthoritativeState(candidate,{...next,appMetadata:metadata});
    checkpointCompleted(active,result.seq,result.epoch);return result;
  }
  /** @type {RuntimeMethods['replaceLocalWithPending']} */
  async function replaceLocalWithPending(currentState,options){
    const {boundaryId,expectedSeq,expectedBaseRevision,validateBase=validate,mutationType='import',surface='backup.local-import'}=options||{};
    const candidate=checkpointState(currentState),active=await settledJournal();
    if(boundaryId===undefined||expectedSeq===undefined||expectedBaseRevision===undefined)throw new Error('storage_boundary_source_required');
    const result=await active.replaceLocalWithPending(candidate,{boundaryId,expectedSeq,expectedBaseRevision,validateBase,mutationType,surface,requireCurrentState:mutationType==='cloud-normalization',deleteCollections:STORAGE_SCHEMAS[app].collections});
    if(currentJournal(active)){diagnostics.operations++;operationsSinceCheckpoint++}return result;
  }
  /** @type {RuntimeMethods['resetCloudHead']} */
  async function resetCloudHead(revision,cloudState,currentState,options={}){
    if(!readyForCurrentOwner())return false;
    const durableCloud=structuredClone(cloudState),candidate=checkpointState(currentState),next=captureStorageCommandOptions(options);
    const metadata={...next.appMetadata,mainProjectionVersion:2},active=await settledJournal();
    const result=await active.resetCloudHead(revision,durableCloud,candidate,{...next,appMetadata:metadata});
    checkpointCompleted(active,result.seq,result.epoch);return result;
  }
  /** @type {RuntimeMethods['compact']} */
  async function compact(){if(!readyForCurrentOwner())return false;const active=await settledJournal(),epoch=active.epoch,result=await active.compact();checkpointCompleted(active,result,epoch);return result}
  async function incidentSample(){
    const active=journal,scopedIdentity=identity;
    const current=()=>active===journal&&scopedIdentity===currentOwner()&&readyForCurrentOwner()&&!boundaryGate();
    return (await import('./sync-journal-incident.js')).sampleJournalIncident({read:cloudState,ready:current,
      current:cloud=>!!active&&active.seq===cloud.seq&&active.epoch===cloud.base?.epoch&&!undurableFailures.has(active),
      epoch:()=>active?.epoch,durabilityError:()=>!!active&&active===journal&&scopedIdentity===currentOwner()&&undurableFailures.has(active),
      blocked:()=>active===journal&&scopedIdentity===currentOwner()&&primary()&&(corruptIdentity===scopedIdentity||!!active?.error),fatal:storageRecoveryFailure});
  }
  return {incidentSample,recover,recoverReadOnly,recoverForOwner,initializeLocal,initializeCloudHead,initializeUploadLocalCloudHead,persist,flush,
    setBoundaryGate:(/** @type {()=>boolean} */ gate)=>{if(typeof gate!=='function')throw new Error('storage_boundary_gate_invalid');boundaryGate=gate},
    setCloudBase,captureCloudCursor,cloudState,materializeFlight,acknowledgeFlight,rejectFlight,setCloudControl,clearCloudControl,readCloudRecovery,commitCloudRecovery,
    replaceCurrentState,replaceLocalAuthoritativeState,replaceLocalWithPending,adoptCloudHead,replaceAuthoritativeState,resetCloudHead,compact,primaryDiagnostics:diagnostics,
    get diagnostics(){return diagnostics},get primaryReady(){return readyForCurrentOwner()},
    get cloudScope(){return authoritative&&identity===currentOwner()&&journal?.ready?{owner:`${identity}:${app}`,epoch:journal.epoch,accountOwner:identity,writable:readyForCurrentOwner()}:null},
    get accountV2Active(){const active=currentOwner();return !storageOwnerReady(active)||isStorageV2ActivationCached(app,active)},
    get durabilityAtRisk(){return undurableCount>0||undurableFailures.size>0},get commitPromise(){return commits}};
}
