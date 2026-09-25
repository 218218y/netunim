import {createStorageJournal} from './storage-journal.js';
import {STORAGE_SCHEMAS} from './storage-v2-schema.js';
import {equalSyncJson} from './cloud-sync.js';
import {storageOwnerReady} from './storage-owner.js';

// Only invalid persisted data poisons an identity. IDB open/abort, blocked
// connections and owner fencing may recover without a page reload.
export function storageRecoveryFailure(error){
  if(error?.name==='DataInvariantError'||error instanceof SyntaxError)return 'fatal';
  const message=String(error?.message||'');
  return /^(storage_(checksum_mismatch|non_json_value|unsafe_key|checkpoint_metadata|committed_metadata_mismatch|committed_journal_missing|invalid_checkpoint|invalid_operation|invalid_local_import|invalid_field|invalid_collection|invalid_put|unknown_operation|foreign_operation|duplicate_sequence|journal_gap_or_duplicate|missing_collection|delete_target_missing|insert_conflict|update_target_missing|emergency_owner))$/.test(message)?'fatal':'retryable';
}

const LIFECYCLE_BOUNDARIES=new Set(['network-offline-mirror','pagehide-v1-checkpoint','beforeunload-v1-checkpoint','manual-flush']);

export function storageV2Mode(app,storage=globalThis.localStorage,owner='local',{preparing=false}={}){
  try{
    const account=String(owner||'').trim();
    if(!storageOwnerReady(account))return 'off';
    if(storage?.getItem(`netunim-storage-cutover-version:${app}:${account}`)==='2'||account==='local'&&storage?.getItem(`netunim-storage-engine-version:${app}:local`)==='2')return 'primary';
    if(preparing)return 'preparing';
    return 'off';
  }catch{return 'off'}
}

// Bridges the journal engine into application persistence. A normal typed
// mutation is synchronously durable in the bounded emergency journal and then
// committed to IndexedDB. Durable boundaries install coordinated checkpoints.
export function createStorageV2Runtime({app,owner,primary,validate,prepareCheckpoint=state=>structuredClone(state),prepareOperation=operation=>structuredClone(operation),mode=()=>storageV2Mode(app,globalThis.localStorage,owner()),createJournal=createStorageJournal,scheduleIdle=callback=>globalThis.requestIdleCallback?requestIdleCallback(callback,{timeout:5000}):setTimeout(callback,1000),compactEvery=128,compactAfterMs=5*60*1000}={}){
  if(!STORAGE_SCHEMAS[app]||typeof owner!=='function'||typeof primary!=='function'||typeof validate!=='function')throw new Error('storage_v2_runtime_configuration');
  const diagnostics={mode:'off',recoveries:0,operations:0,boundaries:0,emergencyFailures:0,commitFailures:0,errors:0,lastError:''};
  let journal=null,identity='',authoritative=false,starting=null,startingIdentity='',commits=Promise.resolve(),corruptIdentity='',operationsSinceCheckpoint=0,lastCheckpointAt=Date.now(),compactionScheduled=false,undurableCount=0,boundaryGate=()=>false;
  const guardCloudMutation=()=>{if(boundaryGate())throw new Error('storage_boundary_in_progress')};
  const undurableFailures=new Map();
  const business=state=>{const copy=structuredClone(state||{});delete copy._meta;return copy};
  const primaryMode=()=>{const value=mode();return value==='primary'||value==='preparing'};
  function currentOwner(){return String(owner()||'').trim()||'local'}
  function readyForCurrentOwner(){return primaryMode()&&primary()&&authoritative&&identity===currentOwner()&&!!journal?.ready}
  function create(){
    const next=currentOwner();
    if(journal&&identity===next)return journal;
    identity=next;authoritative=false;commits=Promise.resolve();const scopedOwner=next;
    journal=createJournal({owner:`${scopedOwner}:${app}`,schema:STORAGE_SCHEMAS[app],validate,primary:()=>primaryMode()&&primary()&&scopedOwner===currentOwner()});corruptIdentity='';return journal;
  }
  function verifiedRecovery(active,recovered){
    // An open alone cannot prove that an IDB-only edit survived. Keep its risk
    // until the same epoch and sequence have actually been recovered.
    const failure=undurableFailures.get(active);
    if(failure&&failure.epoch===recovered.epoch&&recovered.seq>=failure.seq)undurableFailures.delete(active);
    return recovered;
  }
  async function recover(){
    if(!primaryMode()||!primary())return null;
    diagnostics.mode=mode();const active=create(),activeIdentity=identity;
    if(corruptIdentity===activeIdentity)return null;
    if(starting&&startingIdentity===activeIdentity)return starting;
    const request=(async()=>{
      try{
        const observedCommits=commits;
        await observedCommits.catch(()=>{});
        const recovered=await active.open();
        if(commits===observedCommits)commits=Promise.resolve();
        if(activeIdentity!==currentOwner())throw new Error('storage_owner_changed_during_recovery');
        if(recovered?.appMetadata?.storageRole!=='primary'){authoritative=false;return null}
        authoritative=true;
        diagnostics.recoveries++;
        operationsSinceCheckpoint=Math.max(0,recovered.seq-Number(recovered.stored?.checkpoints?.data?.seq||0));
        return {...verifiedRecovery(active,recovered),source:'v2'};
      }catch(error){diagnostics.errors++;diagnostics.lastError=error.message;diagnostics.recoveryFailure=storageRecoveryFailure(error);if(diagnostics.recoveryFailure==='fatal')corruptIdentity=activeIdentity;return null}
      finally{if(starting===request){starting=null;startingIdentity=''}}
    })();
    starting=request;startingIdentity=activeIdentity;return request;
  }
  async function recoverReadOnly(){
    if(!primaryMode())return null;
    const runtimeMode=mode();diagnostics.mode=runtimeMode;const active=create(),activeIdentity=identity;
    if(corruptIdentity===activeIdentity)return null;
    try{
      const recovered=await active.recover();
      if(activeIdentity!==currentOwner())throw new Error('storage_owner_changed_during_recovery');
      if(!recovered||recovered.appMetadata?.storageRole!=='primary')return null;
      diagnostics.recoveries++;return {...recovered,source:'v2-readonly'};
    }catch(error){diagnostics.errors++;diagnostics.lastError=error.message;diagnostics.recoveryFailure=storageRecoveryFailure(error);if(diagnostics.recoveryFailure==='fatal')corruptIdentity=activeIdentity;return null}
  }
  async function recoverForOwner({intent}={}){
    if(intent!=='load-account')throw new Error('storage_owner_transfer_intent_required');
    return recover();
  }
  async function initializeLocal(state,{appMetadata={}}={}){
    if(currentOwner()!=='local'||!primaryMode()||!primary())throw new Error('storage_local_birth_owner_required');
    const canonical=prepareCheckpoint(business(state));validate(canonical);
    const active=create(),scopedIdentity=identity;
    let recovered=await active.open();
    if(recovered){
      if(!equalSyncJson(recovered.state,canonical))throw new Error('storage_local_birth_parity_mismatch');
      if(recovered.appMetadata?.storageRole&&!['primary','shadow'].includes(recovered.appMetadata.storageRole))throw new Error('storage_local_birth_role_invalid');
    }
    const cloud=recovered?await active.cloudState():null;
    if(cloud?.base||cloud?.flight||cloud?.control)throw new Error('storage_local_birth_cloud_head_exists');
    if(!recovered||recovered.appMetadata?.storageRole!=='primary'){
      await active.install(canonical,{expectedEpoch:recovered?.epoch??null,appMetadata:{...appMetadata,storageRole:'primary',migrationIntent:'local-birth',sourceOwner:'local'}});
      recovered=await active.recover();
    }
    if(scopedIdentity!==currentOwner()||identity!==scopedIdentity||!equalSyncJson(recovered.state,canonical))throw new Error('storage_local_birth_owner_changed');
    authoritative=true;return verifiedRecovery(active,recovered);
  }
  async function initializeCloudHead(revision,state,{sourceOwner,intent,cloudState=state,changes=null,validateBase=validate,appMetadata={}}={}){
    if(!primaryMode()||!primary())throw new Error('storage_v2_primary_not_ready');
    const active=create(),scopedIdentity=identity;
    const validIntent=intent==='cloud-authoritative'&&sourceOwner===scopedIdentity||intent==='upload-local'&&sourceOwner==='local'&&revision===0||intent==='upload-owner'&&sourceOwner===scopedIdentity&&revision===0;
    if(!validIntent)throw new Error('storage_owner_transfer_intent_required');
    const prepared=prepareCheckpoint(business(state)),metadata={...appMetadata,storageRole:'primary',sourceOwner,targetOwner:scopedIdentity,migrationIntent:intent};
    let result;
    try{result=await active.initializeCloudHead(revision,prepared,{cloudState,changes,validateBase,appMetadata:metadata})}
    catch(error){
      if(error?.message!=='storage_initialization_exists'||!String(metadata.bootstrapOperationId||'').trim())throw error;
      const recovered=await active.open(),cloud=await active.cloudState({validateBase});
      const finalState=changes?.length===1&&changes[0]?.type==='replace-state'?prepareCheckpoint(business(changes[0].state)):prepared;
      const idempotent=!!recovered&&recovered.appMetadata?.bootstrapOperationId===metadata.bootstrapOperationId&&recovered.appMetadata?.migrationIntent===intent&&recovered.appMetadata?.sourceOwner===sourceOwner&&recovered.appMetadata?.targetOwner===scopedIdentity&&cloud?.base?.revision===revision&&equalSyncJson(cloud.base.state,cloudState)&&equalSyncJson(recovered.state,finalState);
      if(idempotent)result=recovered;
      else{
        if(!recovered||recovered.appMetadata?.storageRole==='primary'||cloud?.base||cloud?.flight||cloud?.control||!equalSyncJson(recovered.state,finalState))throw new Error('storage_bootstrap_existing_head_mismatch');
        result=await active.initializeCloudHead(revision,prepared,{cloudState,changes,validateBase,appMetadata:metadata,replaceExistingState:finalState});
      }
    }
    if(identity!==scopedIdentity||currentOwner()!==scopedIdentity)throw new Error('storage_owner_changed_during_recovery');
    authoritative=true;return result;
  }
  async function initializeFirstCloudHead(emptyState,currentState,{sourceOwner=currentOwner(),cloudState,validateBase=validate,appMetadata={}}={}){
    const scopedIdentity=currentOwner(),source=String(sourceOwner||'').trim();
    const intent=source==='local'?'upload-local':source===scopedIdentity?'upload-owner':'';
    if(!intent||scopedIdentity==='local')throw new Error('storage_owner_transfer_target_required');
    const initial=prepareCheckpoint(business(emptyState)),target=prepareCheckpoint(business(currentState));
    validate(initial);validate(target);if(cloudState===undefined)throw new Error('storage_bootstrap_cloud_base_required');validateBase(cloudState);
    const recovered=await initializeCloudHead(0,initial,{sourceOwner:source,intent,cloudState,validateBase,changes:[{type:'replace-state',state:target}],appMetadata});
    if(!equalSyncJson(recovered.state,target)||recovered.seq!==1)throw new Error('storage_bootstrap_replay_mismatch');
    return recovered;
  }
  async function initializeUploadLocalCloudHead(emptyState,currentState,options={}){return initializeFirstCloudHead(emptyState,currentState,{...options,sourceOwner:'local'})}
  function canonicalOperations(state,operations){
    const source=state||{},byCollection=new Map();
    return operations.map(operation=>{
      if(operation.type!=='put')return prepareOperation(operation);
      if(!byCollection.has(operation.collection))byCollection.set(operation.collection,new Map((source[operation.collection]||[]).map(row=>[row?.id,row])));
      const record=byCollection.get(operation.collection).get(operation.id);
      if(!record)throw new Error('storage_operation_record_missing');
      return prepareOperation({...operation,record});
    });
  }
  function scheduleCompaction(){
    if(compactionScheduled||!journal?.ready)return;compactionScheduled=true;
    scheduleIdle(async()=>{compactionScheduled=false;if(!readyForCurrentOwner()||(!operationsSinceCheckpoint&&Date.now()-lastCheckpointAt<compactAfterMs))return;try{await commits;await journal.compact();operationsSinceCheckpoint=0;lastCheckpointAt=Date.now()}catch(error){diagnostics.errors++;diagnostics.lastError=error.message}});
  }
  function persist(state,{operations=null,storageBoundary='',generation=0,surface='',mutationType='autosave',deleteIntents={}}={},appMetadata={}){
    if(boundaryGate())throw new Error('storage_boundary_in_progress');
    const runtimeMode=mode();if(runtimeMode==='preparing')throw new Error('storage_v2_preparation_locked');
    if(runtimeMode!=='primary'||!primary())return {handled:false,reason:'inactive'};
    diagnostics.mode='primary';const active=create(),boundary=String(storageBoundary||'').trim(),typed=Array.isArray(operations)&&operations.length>0;
    if(!authoritative||!active.ready)return {handled:false,reason:'not-ready'};
    if(boundary&&typed){diagnostics.errors++;diagnostics.lastError='storage_mutation_contract_ambiguous';return {handled:false,reason:'ambiguous'} }
    if(boundary&&LIFECYCLE_BOUNDARIES.has(boundary)&&active.ready)return {handled:true,emergencyDurable:true,committed:active.settled(),reason:'already-durable'};
    if(boundary){diagnostics.boundaries++;return {handled:false,reason:'boundary'} }
    if(!typed){diagnostics.errors++;diagnostics.lastError='storage_mutation_contract_required';return {handled:false,reason:'contract'} }
    try{
      const write=active.append(canonicalOperations(state,operations),{generation,surface,mutationType,deleteIntents,appMetadata:{...appMetadata,storageRole:'primary'}});diagnostics.operations++;operationsSinceCheckpoint++;
      if(!write.emergencyDurable){
        diagnostics.emergencyFailures++;undurableCount++;
        // This mutation has no synchronous durable copy. It becomes safe only
        // after the IndexedDB transaction completes; until then unload is blocked.
        const failedEpoch=active.epoch;
        write.committed.then(()=>{undurableCount--},()=>{undurableCount--;const prior=undurableFailures.get(active);undurableFailures.set(active,{epoch:failedEpoch,seq:Math.max(Number(prior?.seq||0),Number(write.seq||0))})});
      }
      commits=commits.catch(()=>{}).then(()=>write.committed).catch(error=>{diagnostics.commitFailures++;diagnostics.lastError=error.message;throw error});
      if(operationsSinceCheckpoint>=compactEvery||Date.now()-lastCheckpointAt>=compactAfterMs)scheduleCompaction();
      return {handled:true,emergencyDurable:write.emergencyDurable,transitionFallbackDurable:write.transitionFallbackDurable,committed:write.committed,seq:write.seq,transitioning:!!write.transitioning,reason:write.emergencyDurable?'journal':'idb-commit-pending'};
    }catch(error){diagnostics.errors++;diagnostics.lastError=error.message;return {handled:false,reason:'append-failed',error}}
  }
  async function flush(){
    if(starting)await starting;
    try{const active=await settledJournal();await active.settled();return !active.error}catch{return false}
  }
  async function settledJournal(){
    if(!readyForCurrentOwner())throw new Error('storage_v2_primary_not_ready');
    const active=journal,scopedIdentity=identity;await commits;
    if(active!==journal||identity!==scopedIdentity||!readyForCurrentOwner())throw new Error('storage_owner_changed_during_operation');
    return active;
  }
  async function setCloudBase(revision,state,options={}){guardCloudMutation();return (await settledJournal()).setCloudBase(revision,state,options)}
  async function captureCloudCursor(revision,options={}){guardCloudMutation();return (await settledJournal()).captureCloudCursor(revision,options)}
  async function cloudState(options={}){if(!readyForCurrentOwner())return null;return (await settledJournal()).cloudState(options)}
  async function materializeFlight(options={}){guardCloudMutation();return (await settledJournal()).materializeFlight(options)}
  async function acknowledgeFlight(operationId,revision,state,options={}){guardCloudMutation();const next={...options};if(Object.hasOwn(next,'currentState')){next.checkpointState=prepareCheckpoint(business(next.currentState));delete next.currentState}const active=await settledJournal();guardCloudMutation();return active.acknowledge(operationId,revision,state,next)}
  async function rejectFlight(operationId,revision,state,options={}){guardCloudMutation();const next={...options};if(Object.hasOwn(next,'currentState')){next.checkpointState=prepareCheckpoint(business(next.currentState));delete next.currentState}const active=await settledJournal();guardCloudMutation();return active.rejectAndRebase(operationId,revision,state,next)}
  async function setCloudControl(control={}){guardCloudMutation();return (await settledJournal()).setCloudControl(control)}
  async function clearCloudControl(){guardCloudMutation();if(!readyForCurrentOwner())return false;return (await settledJournal()).clearCloudControl()}
  async function replaceCurrentState(state,options={}){const active=await settledJournal(),result=await active.replaceCurrentState(prepareCheckpoint(business(state)),options);operationsSinceCheckpoint=0;lastCheckpointAt=Date.now();return result}
  async function replaceLocalAuthoritativeState(state,{boundaryId,expectedSeq}={}){
    if(currentOwner()!=='local')throw new Error('storage_boundary_local_owner_required');
    const active=await settledJournal(),result=await active.replaceLocalAuthoritativeState(prepareCheckpoint(business(state)),{boundaryId,expectedSeq});
    operationsSinceCheckpoint=0;lastCheckpointAt=Date.now();return result;
  }
  async function adoptCloudHead(revision,cloudState,currentState,options={}){guardCloudMutation();const active=await settledJournal();guardCloudMutation();const result=await active.adoptCloudHead(revision,cloudState,prepareCheckpoint(business(currentState)),options);operationsSinceCheckpoint=0;lastCheckpointAt=Date.now();return result}
  async function replaceAuthoritativeState(currentState,options={}){if(!readyForCurrentOwner())return false;const active=await settledJournal(),result=await active.replaceAuthoritativeState(prepareCheckpoint(business(currentState)),options);operationsSinceCheckpoint=0;lastCheckpointAt=Date.now();return result}
  async function replaceLocalWithPending(currentState,{boundaryId,expectedSeq,expectedBaseRevision,validateBase=validate,mutationType='import',surface='backup.local-import'}={}){
    const active=await settledJournal();
    const result=await active.replaceLocalWithPending(prepareCheckpoint(business(currentState)),{boundaryId,expectedSeq,expectedBaseRevision,validateBase,mutationType,surface,requireCurrentState:mutationType==='cloud-normalization',deleteCollections:STORAGE_SCHEMAS[app].collections.filter(name=>name!=='checks')});
    diagnostics.operations++;operationsSinceCheckpoint++;return result;
  }
  async function resetCloudHead(revision,cloudState,currentState,options={}){if(!readyForCurrentOwner())return false;const active=await settledJournal(),result=await active.resetCloudHead(revision,cloudState,prepareCheckpoint(business(currentState)),options);operationsSinceCheckpoint=0;lastCheckpointAt=Date.now();return result}
  async function compact(){if(!readyForCurrentOwner())return false;const active=await settledJournal(),result=await active.compact();operationsSinceCheckpoint=0;lastCheckpointAt=Date.now();return result}
  return {recover,recoverReadOnly,recoverForOwner,initializeLocal,initializeCloudHead,initializeFirstCloudHead,initializeUploadLocalCloudHead,persist,flush,setBoundaryGate:gate=>{if(typeof gate!=='function')throw new Error('storage_boundary_gate_invalid');boundaryGate=gate},setCloudBase,captureCloudCursor,cloudState,materializeFlight,acknowledgeFlight,rejectFlight,setCloudControl,clearCloudControl,replaceCurrentState,replaceLocalAuthoritativeState,replaceLocalWithPending,adoptCloudHead,replaceAuthoritativeState,resetCloudHead,compact,primaryDiagnostics:diagnostics,get diagnostics(){return diagnostics},get primaryReady(){return readyForCurrentOwner()},get cutoverActive(){const active=currentOwner();return !storageOwnerReady(active)||globalThis.localStorage?.getItem(`netunim-storage-cutover-version:${app}:${active}`)==='2'||active==='local'&&globalThis.localStorage?.getItem(`netunim-storage-engine-version:${app}:local`)==='2'},get durabilityAtRisk(){return undurableCount>0||undurableFailures.size>0},get commitPromise(){return commits}};
}
