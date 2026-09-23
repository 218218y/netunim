import {createStorageJournal} from './storage-journal.js';
import {createStorageShadow,STORAGE_SCHEMAS} from './storage-shadow.js';
import {equalSyncJson} from './cloud-sync.js';

// Only invalid persisted data poisons an identity. IDB open/abort, blocked
// connections and owner fencing may recover without a page reload.
export function storageRecoveryFailure(error){
  if(error?.name==='DataInvariantError'||error instanceof SyntaxError)return 'fatal';
  const message=String(error?.message||'');
  return /^(storage_(checksum_mismatch|non_json_value|unsafe_key|checkpoint_metadata|committed_metadata_mismatch|committed_journal_missing|invalid_checkpoint|invalid_operation|invalid_field|invalid_collection|invalid_put|unknown_operation|foreign_operation|duplicate_sequence|journal_gap_or_duplicate|missing_collection|delete_target_missing|insert_conflict|update_target_missing|emergency_owner))$/.test(message)?'fatal':'retryable';
}

const LIFECYCLE_BOUNDARIES=new Set(['network-offline-mirror','pagehide-v1-checkpoint','beforeunload-v1-checkpoint','manual-flush']);

export function storageV2Mode(app,storage=globalThis.localStorage,owner='local'){
  try{
    const account=String(owner||'local');
    if(storage?.getItem(`netunim-storage-cutover-version:${app}:${account}`)==='2')return 'primary';
    const configured=storage?.getItem(`netunim-storage-v2-mode:${app}`)||storage?.getItem('netunim-storage-v2-mode');
    if(['primary','shadow','off'].includes(configured))return configured;
    return storage?.getItem('netunim-storage-v2-shadow')==='1'?'shadow':'off';
  }catch{return 'off'}
}

// Bridges the proven journal engine into application persistence. Primary mode
// is opt-in until production migration is explicitly enabled. A normal typed
// mutation is synchronously durable in the bounded emergency journal and then
// committed to IndexedDB. Boundaries keep the verified V1 checkpoint as a
// fallback while V2 atomically installs the same canonical state.
export function createStorageV2Runtime({app,owner,primary,validate,prepareCheckpoint=state=>structuredClone(state),mode=()=>storageV2Mode(app,globalThis.localStorage,owner()),createJournal=createStorageJournal,scheduleIdle=callback=>globalThis.requestIdleCallback?requestIdleCallback(callback,{timeout:5000}):setTimeout(callback,1000),compactEvery=128,compactAfterMs=5*60*1000}={}){
  if(!STORAGE_SCHEMAS[app]||typeof owner!=='function'||typeof primary!=='function'||typeof validate!=='function')throw new Error('storage_v2_runtime_configuration');
  const shadow=createStorageShadow({app,owner,primary,validate,enabled:()=>mode()==='shadow',createJournal});
  const diagnostics={mode:'off',recoveries:0,migrations:0,operations:0,boundaries:0,fallbacks:0,emergencyFailures:0,commitFailures:0,errors:0,lastError:''};
  let journal=null,identity='',starting=null,startingIdentity='',commits=Promise.resolve(),corruptIdentity='',operationsSinceCheckpoint=0,lastCheckpointAt=Date.now(),compactionScheduled=false,undurableCount=0,ownerHandoffRequired=false,boundaryGate=()=>false;
  const guardCloudMutation=()=>{if(boundaryGate())throw new Error('storage_boundary_in_progress')};
  const undurableFailures=new Map();
  const business=state=>{const copy=structuredClone(state||{});delete copy._meta;return copy};
  function currentOwner(){return String(owner()||'local')}
  function readyForCurrentOwner(){return mode()==='primary'&&primary()&&identity===currentOwner()&&!!journal?.ready}
  function create(){
    const next=currentOwner();
    if(journal&&identity===next)return journal;
    if(identity&&identity!==next)ownerHandoffRequired=true;
    identity=next;commits=Promise.resolve();const scopedOwner=next;
    journal=createJournal({owner:`${scopedOwner}:${app}`,schema:STORAGE_SCHEMAS[app],validate,primary:()=>primary()&&scopedOwner===currentOwner()});corruptIdentity='';return journal;
  }
  function verifiedRecovery(active,recovered){
    // An open alone cannot prove that an IDB-only edit survived. Keep its risk
    // until the same epoch and sequence have actually been recovered.
    const failure=undurableFailures.get(active);
    if(failure&&failure.epoch===recovered.epoch&&recovered.seq>=failure.seq)undurableFailures.delete(active);
    return recovered;
  }
  async function recover(fallbackState=null,appMetadata={},migrationAuthorized=false){
    if(mode()!=='primary'||!primary())return null;
    diagnostics.mode='primary';const active=create(),activeIdentity=identity;
    if(corruptIdentity===activeIdentity)return null;
    if(starting&&startingIdentity===activeIdentity)return starting;
    const request=(async()=>{
      try{
        const observedCommits=commits;
        await observedCommits.catch(()=>{});
        let recovered=await active.open();
        if(commits===observedCommits)commits=Promise.resolve();
        if(activeIdentity!==currentOwner())throw new Error('storage_owner_changed_during_recovery');
        if((ownerHandoffRequired&&!migrationAuthorized)||globalThis.localStorage?.getItem(`netunim-storage-cutover-version:${app}:${activeIdentity}`)==='2')fallbackState=null;
        if(recovered?.appMetadata?.storageRole==='primary'){
          const fallbackSeq=Number(appMetadata?.snapshotSeq||0),v2Seq=Number(recovered.appMetadata?.snapshotSeq||0);
          if(!fallbackState||fallbackSeq<=v2Seq){diagnostics.recoveries++;operationsSinceCheckpoint=Math.max(0,recovered.seq-Number(recovered.stored?.checkpoints?.data?.seq||0));return {...verifiedRecovery(active,recovered),source:'v2'}}
          const canonical=prepareCheckpoint(business(fallbackState));validate(canonical);await active.install(canonical,{appMetadata:{...appMetadata,storageRole:'primary'}});diagnostics.migrations++;
          recovered=await active.recover();return {...recovered,source:'v1-newer-fallback'};
        }
        // A shadow checkpoint is evidence, not authority. Promotion requires a
        // current verified V1 state and establishes a new fenced primary epoch.
        if(recovered){
          if(!fallbackState)return null;
          const canonical=prepareCheckpoint(business(fallbackState));validate(canonical);
          if(!equalSyncJson(recovered.state,canonical))diagnostics.fallbacks++;
          await active.install(canonical,{appMetadata:{...appMetadata,storageRole:'primary'}});diagnostics.migrations++;
          recovered=await active.recover();return {...recovered,source:'v1-promotion'};
        }
        if(!fallbackState)return null;
        const canonical=prepareCheckpoint(business(fallbackState));validate(canonical);
        await active.install(canonical,{appMetadata:{...appMetadata,storageRole:'primary'}});diagnostics.migrations++;
        recovered=await active.recover();return {...recovered,source:'v1-migration'};
      }catch(error){diagnostics.errors++;diagnostics.lastError=error.message;diagnostics.recoveryFailure=storageRecoveryFailure(error);if(diagnostics.recoveryFailure==='fatal')corruptIdentity=activeIdentity;return null}
      finally{if(starting===request){starting=null;startingIdentity=''}}
    })();
    starting=request;startingIdentity=activeIdentity;return request;
  }
  async function recoverForOwner({intent,sourceOwner,state=null,appMetadata={}}={}){
    const target=currentOwner();
    if(intent==='load-account')return recover(null,appMetadata);
    if(!['legacy-upgrade','upload-local'].includes(intent)||(intent==='upload-local'?sourceOwner!=='local'||target==='local':sourceOwner!==target))throw new Error('storage_owner_transfer_intent_required');
    return recover(state,{...appMetadata,migrationIntent:intent,sourceOwner},true);
  }
  async function initializeCloudHead(revision,state,{sourceOwner,intent,cloudState=state,changes=null,validateBase=validate,appMetadata={}}={}){
    if(mode()!=='primary'||!primary())throw new Error('storage_v2_primary_not_ready');
    const active=create(),scopedIdentity=identity;
    if(!['cloud-authoritative','upload-local'].includes(intent)||(intent==='upload-local'?sourceOwner!=='local'||revision!==0:sourceOwner!==scopedIdentity))throw new Error('storage_owner_transfer_intent_required');
    const result=await active.initializeCloudHead(revision,prepareCheckpoint(business(state)),{cloudState,changes,validateBase,appMetadata:{...appMetadata,storageRole:'primary',sourceOwner,migrationIntent:intent}});
    if(identity!==scopedIdentity||currentOwner()!==scopedIdentity)throw new Error('storage_owner_changed_during_recovery');
    ownerHandoffRequired=false;return result;
  }
  function canonicalOperations(state,operations){
    const source=state||{},byCollection=new Map();
    return operations.map(operation=>{
      if(operation.type!=='put')return structuredClone(operation);
      if(!byCollection.has(operation.collection))byCollection.set(operation.collection,new Map((source[operation.collection]||[]).map(row=>[row?.id,row])));
      const record=byCollection.get(operation.collection).get(operation.id);
      if(!record)throw new Error('storage_operation_record_missing');
      return {...structuredClone(operation),record:structuredClone(record)};
    });
  }
  function scheduleCompaction(){
    if(compactionScheduled||!journal?.ready)return;compactionScheduled=true;
    scheduleIdle(async()=>{compactionScheduled=false;if(!readyForCurrentOwner()||(!operationsSinceCheckpoint&&Date.now()-lastCheckpointAt<compactAfterMs))return;try{await commits;await journal.compact();operationsSinceCheckpoint=0;lastCheckpointAt=Date.now()}catch(error){diagnostics.errors++;diagnostics.lastError=error.message}});
  }
  function persist(state,{operations=null,storageBoundary='',generation=0,surface='',mutationType='autosave',deleteIntents={}}={},appMetadata={}){
    if(boundaryGate())throw new Error('storage_boundary_in_progress');
    if(mode()!=='primary'||!primary())return {handled:false,reason:'inactive'};
    diagnostics.mode='primary';const active=create(),boundary=String(storageBoundary||'').trim(),typed=Array.isArray(operations)&&operations.length>0;
    if(boundary&&typed){diagnostics.errors++;diagnostics.lastError='storage_mutation_contract_ambiguous';return {handled:false,reason:'ambiguous'} }
    if(boundary&&LIFECYCLE_BOUNDARIES.has(boundary)&&active.ready)return {handled:true,emergencyDurable:true,committed:active.settled(),reason:'already-durable'};
    if(boundary){diagnostics.boundaries++;return {handled:false,reason:'boundary'} }
    if(!typed){diagnostics.errors++;diagnostics.lastError='storage_mutation_contract_required';return {handled:false,reason:'contract'} }
    if(!active.ready){diagnostics.fallbacks++;return {handled:false,reason:'not-ready'} }
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
  function afterLegacy(state,options={},appMetadata={}){
    if(mode()==='shadow')return shadow.observe(state,options);
    if(mode()!=='primary'||!primary())return false;
    const active=create(),snapshot=business(state),boundary=String(options?.storageBoundary||'').trim();
    if(active.ready&&(!boundary||!LIFECYCLE_BOUNDARIES.has(boundary))){
      const canonical=prepareCheckpoint(snapshot);commits=commits.catch(()=>{}).then(()=>active.install(canonical,{appMetadata:{...appMetadata,storageRole:'primary'}})).then(result=>{operationsSinceCheckpoint=0;lastCheckpointAt=Date.now();return result}).catch(error=>{diagnostics.errors++;diagnostics.lastError=error.message;throw error});return true;
    }
    if(!active.ready){void recover(snapshot,appMetadata)}
    return true;
  }
  async function flush(){
    if(mode()==='shadow')return shadow.flush();
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
  async function adoptCloudHead(revision,cloudState,currentState,options={}){guardCloudMutation();const active=await settledJournal();guardCloudMutation();const result=await active.adoptCloudHead(revision,cloudState,prepareCheckpoint(business(currentState)),options);operationsSinceCheckpoint=0;lastCheckpointAt=Date.now();return result}
  async function replaceAuthoritativeState(currentState,options={}){if(!readyForCurrentOwner())return false;const active=await settledJournal(),result=await active.replaceAuthoritativeState(prepareCheckpoint(business(currentState)),options);operationsSinceCheckpoint=0;lastCheckpointAt=Date.now();return result}
  async function replaceLocalWithPending(currentState,{boundaryId,expectedSeq,expectedBaseRevision,validateBase=validate}={}){
    const active=await settledJournal();
    const result=await active.replaceLocalWithPending(prepareCheckpoint(business(currentState)),{boundaryId,expectedSeq,expectedBaseRevision,validateBase,deleteCollections:STORAGE_SCHEMAS[app].collections.filter(name=>name!=='checks')});
    diagnostics.operations++;operationsSinceCheckpoint++;return result;
  }
  async function resetCloudHead(revision,cloudState,currentState,options={}){if(!readyForCurrentOwner())return false;const active=await settledJournal(),result=await active.resetCloudHead(revision,cloudState,prepareCheckpoint(business(currentState)),options);operationsSinceCheckpoint=0;lastCheckpointAt=Date.now();return result}
  async function compact(){if(!readyForCurrentOwner())return false;const active=await settledJournal(),result=await active.compact();operationsSinceCheckpoint=0;lastCheckpointAt=Date.now();return result}
  return {recover,recoverForOwner,initializeCloudHead,persist,afterLegacy,observe:(...args)=>shadow.observe(...args),flush,setBoundaryGate:gate=>{if(typeof gate!=='function')throw new Error('storage_boundary_gate_invalid');boundaryGate=gate},setCloudBase,captureCloudCursor,cloudState,materializeFlight,acknowledgeFlight,rejectFlight,setCloudControl,clearCloudControl,replaceCurrentState,adoptCloudHead,replaceAuthoritativeState,replaceLocalWithPending,resetCloudHead,compact,primaryDiagnostics:diagnostics,shadowDiagnostics:shadow.diagnostics,get diagnostics(){return diagnostics.mode==='primary'?diagnostics:shadow.diagnostics.mode!=='disabled'?shadow.diagnostics:diagnostics},get primaryReady(){return readyForCurrentOwner()},get cutoverActive(){return globalThis.localStorage?.getItem(`netunim-storage-cutover-version:${app}:${currentOwner()}`)==='2'},get durabilityAtRisk(){return undurableCount>0||undurableFailures.size>0},get commitPromise(){return commits}};
}
