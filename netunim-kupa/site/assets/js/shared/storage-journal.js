import {createOperationId,equalSyncJson} from './cloud-sync.js';
import {beginMeasure,recordPerformanceValue} from './runtime-performance.js';
import {createStorageJournalDb} from './storage-journal-idb.js';
import {sealStorageRecord,readStorageRecord,validateStoredOperation,replayStorageJournal} from './storage-journal-model.js';

function normalizeDeleteIntents(value){
  if(value==null)return {};
  if(!value||typeof value!=='object'||Array.isArray(value))throw new Error('storage_delete_intents_invalid');
  const result={};
  for(const [collection,rawIds] of Object.entries(value)){
    if(!collection||['__proto__','prototype','constructor'].includes(collection)||!Array.isArray(rawIds))throw new Error('storage_delete_intents_invalid');
    const ids=[...new Set(rawIds.map(id=>String(id||'').trim()).filter(Boolean))].sort();
    if(ids.length)result[collection]=ids;
  }
  return result;
}
function mergeDeleteIntents(...sources){
  const merged={};
  for(const source of sources)for(const [collection,ids] of Object.entries(normalizeDeleteIntents(source)))(merged[collection]??=[]).push(...ids);
  for(const collection of Object.keys(merged))merged[collection]=[...new Set(merged[collection])].sort();
  return merged;
}

// Local checkpoint/journal engine. Rollout policy lives in the application
// adapter; this layer is equally usable for shadow comparison and primary recovery.
export function createStorageJournal({owner,schema,validate,primary=()=>true,db=createStorageJournalDb(),emergency=globalThis.localStorage,operationId=()=>createOperationId('storage-v2'),now=()=>new Date().toISOString(),maxEmergencyBytes=131072,maxEmergencyEntries=64}={}){
  if(!owner||!schema||!validate)throw new Error('storage_configuration_required');
  const prefix='netunim-storage-v2-emergency:'+encodeURIComponent(owner)+':',writer=operationId();
  let epoch=null,seq=0,queue=Promise.resolve(),ready=false,failed=null,transition=null;
  const pending=new Map();
  const guard=()=>{if(!primary())throw new Error('storage_secondary_tab');if(!ready)throw new Error('storage_not_ready');if(failed)throw failed};
  function enqueue(work){const result=queue.then(work);queue=result.catch(error=>{failed=error});return result}
  function enqueueEpochTransition(nextEpoch,work){
    if(transition)throw new Error('storage_epoch_transition');
    const active={epoch:nextEpoch,seq:0,fallbackEpoch:epoch,fallbackSeq:seq};transition=active;
    const result=queue.then(async()=>{try{return await work(active)}finally{if(transition===active)transition=null}});
    // A failed reset with edits reserved for its new epoch must stop further
    // writes. Recovery can replay their old-epoch emergency copies instead.
    queue=result.catch(error=>{if(active.seq)failed=error});return result;
  }
  function readEmergency(){
    if(!emergency)throw new Error('storage_emergency_unavailable');
    const records=[];
    for(let i=0;i<emergency.length;i++){const key=emergency.key(i);if(!key?.startsWith(prefix))continue;const raw=emergency.getItem(key);const sealed=JSON.parse(raw);const op=readStorageRecord(sealed);if(op.owner!==owner)throw new Error('storage_emergency_owner');records.push(sealed)}
    return records;
  }
  function emergencyKey(operation){return prefix+encodeURIComponent(operation.epoch)+':'+operation.seq}
  function writeEmergency(record){const done=beginMeasure('storage:journal-emergency');try{
    const text=JSON.stringify(record);recordPerformanceValue('storage:bytes:journal-emergency',new TextEncoder().encode(text).length);
    if(pending.size>=maxEmergencyEntries||text.length*2+[...pending.values()].reduce((sum,value)=>sum+value.length*2,0)>maxEmergencyBytes)return false;
    const key=emergencyKey(record.data),existing=emergency.getItem(key);
    if(existing!==null&&existing!==text)throw new Error('storage_emergency_sequence_collision');
    emergency.setItem(key,text);if(emergency.getItem(key)!==text)throw new Error('storage_emergency_verification');pending.set(key,text);return true;
  }catch{return false}finally{done()}}
  function cleanEmergency(record){const key=emergencyKey(record.data);try{
    const text=emergency.getItem(key);
    // Never remove an entry replaced by another writer or a newer operation.
    if(text&&JSON.stringify(JSON.parse(text))!==JSON.stringify(record))throw new Error('storage_emergency_changed');
    emergency.removeItem(key);pending.delete(key);
  }catch{/* A committed duplicate is safe; recovery checks its exact identity. */}}
  async function recover(){const done=beginMeasure('storage:replay');try{
    const stored=await db.load(owner);if(!stored.checkpoints)return null;
    const base=readStorageRecord(stored.checkpoints);
    if(base.owner!==owner||stored.metadata?.epoch!==base.epoch)throw new Error('storage_checkpoint_metadata');
    const committedSeq=stored.journal.reduce((maximum,record)=>Math.max(maximum,record.data.seq),base.seq);
    if(!Number.isSafeInteger(stored.metadata.seq)||committedSeq!==stored.metadata.seq)throw new Error('storage_committed_metadata_mismatch');
    const records=readEmergency();
    // A prior epoch is retained for diagnostics, but cannot cross a restore boundary.
    const applicable=records.filter(record=>record.data.epoch===base.epoch);
    const replay=replayStorageJournal(stored.checkpoints,[...stored.journal,...applicable],schema);
    if(replay.seq<stored.metadata.seq)throw new Error('storage_committed_journal_missing');
    validate(replay.state);return {...replay,stored,emergency:applicable};
  }finally{done()}}
  async function open(){if(!primary())throw new Error('storage_secondary_tab');let recovered=await recover();if(!recovered)return null;if(!primary())throw new Error('storage_secondary_tab');
    await db.claim(owner,recovered.epoch,writer);recovered=await recover();epoch=recovered.epoch;seq=recovered.seq;ready=true;failed=null;
    // Recovered emergency operations must commit before their entries are removed.
    for(const record of recovered.emergency.sort((a,b)=>a.data.seq-b.data.seq)){
      if(record.data.seq>recovered.stored.metadata.seq)await db.append(owner,epoch,writer,record);
      cleanEmergency(record);
    }
    // A failed epoch transition may leave a sealed copy for the epoch that
    // never became authoritative. Once the recovered writer is claimed, it is
    // safe to retire those obsolete copies.
    for(const record of readEmergency())if(record.data.epoch!==epoch)cleanEmergency(record);
    return recovered;
  }
  async function install(state,{expectedEpoch,appMetadata={}}={}){
    if(!primary())throw new Error('storage_secondary_tab');validate(state);const durableState=structuredClone(state),durableMetadata=structuredClone(appMetadata),nextEpoch=operationId();
    return enqueueEpochTransition(nextEpoch,async active=>{
      if(!primary())throw new Error('storage_secondary_tab');const requiredEpoch=expectedEpoch===undefined?epoch:expectedEpoch,checkpoint=sealStorageRecord({version:2,owner,epoch:active.epoch,seq:0,state:durableState,appMetadata:durableMetadata,savedAt:now()},{kind:'checkpoint'});
      const done=beginMeasure('storage:checkpoint');try{await db.install(owner,checkpoint,writer,{expectedEpoch:requiredEpoch});epoch=active.epoch;seq=active.seq;ready=true;failed=null;
        // The new epoch is durable before obsolete emergency entries are retired.
        for(const record of readEmergency())if(record.data.epoch!==epoch)cleanEmergency(record);
        return {epoch,seq};
      }finally{done()}
    });
  }
  function append(changes,{generation=0,surface='unknown',mutationType='edit',deleteIntents={},appMetadata={}}={}){
    guard();const activeTransition=transition,targetEpoch=activeTransition?.epoch||epoch,targetSeq=activeTransition?activeTransition.seq+1:seq+1,operation={version:2,owner,epoch:targetEpoch,seq:targetSeq,generation,operationId:operationId(),at:now(),surface,mutationType,changes:structuredClone(changes),deleteIntents:normalizeDeleteIntents(deleteIntents),appMetadata:structuredClone(appMetadata)};
    validateStoredOperation(operation,schema);const record=sealStorageRecord(operation,{kind:'journal'});
    // Until the reset transaction commits, either epoch may be authoritative
    // after a crash. Keep the same operation in both emergency namespaces.
    const fallbackRecord=activeTransition?sealStorageRecord({...operation,epoch:activeTransition.fallbackEpoch,seq:activeTransition.fallbackSeq+1},{kind:'journal'}):null;
    const fallbackDurable=!fallbackRecord||writeEmergency(fallbackRecord),newEpochDurable=writeEmergency(record),emergencyDurable=fallbackDurable&&newEpochDurable;
    if(activeTransition){activeTransition.seq=operation.seq;activeTransition.fallbackSeq++}else seq=operation.seq;
    const committed=enqueue(async()=>{if(!primary())throw new Error('storage_secondary_tab');const done=beginMeasure('storage:idb-journal');try{await db.append(owner,operation.epoch,writer,record);cleanEmergency(record);if(fallbackRecord)cleanEmergency(fallbackRecord);return true}finally{done()}});
    return {seq:operation.seq,operationId:operation.operationId,emergencyDurable,transitionFallbackDurable:fallbackDurable,committed,transitioning:!!activeTransition};
  }
  async function replaceLocalWithPending(state,{boundaryId,expectedSeq,expectedBaseRevision,deleteCollections=schema.collections,validateBase=validate,mutationType='import',surface='backup.local-import',requireCurrentState=false}={}){
    guard();if(!String(boundaryId||'').trim()||!Number.isSafeInteger(expectedSeq)||!Number.isSafeInteger(expectedBaseRevision))throw new Error('storage_boundary_source_required');
    validate(state);await queue;guard();
    const recovered=await recover(),cloud=cloudSnapshot(recovered.stored,validateBase);
    if(recovered.seq!==seq||recovered.stored.metadata.seq!==seq||seq!==expectedSeq||!cloud.base||cloud.base.revision!==expectedBaseRevision||cloud.base.ackSeq!==seq||cloud.flight||cloud.control)throw new Error('storage_boundary_cloud_changed');
    const target=structuredClone(state),deleteIntents={};
    if(requireCurrentState&&!equalSyncJson(recovered.state,target))throw new Error('storage_normalization_state_changed');
    for(const collection of deleteCollections){
      if(!schema.collections.includes(collection))throw new Error('storage_boundary_collection_invalid');
      const before=cloud.base.state[collection],after=target[collection];
      if(!Array.isArray(before)||!Array.isArray(after))throw new Error('storage_boundary_collection_invalid');
      const retained=new Set(after.map(row=>row.id));
      const removed=before.map(row=>row.id).filter(id=>!retained.has(id));
      if(removed.length)deleteIntents[collection]=removed;
    }
    const operation={version:2,owner,epoch,seq:seq+1,generation:1,operationId:operationId(),at:now(),surface,mutationType,changes:[{type:'replace-state',state:target}],deleteIntents:normalizeDeleteIntents(deleteIntents),appMetadata:{boundaryId}};
    validateStoredOperation(operation,schema);
    await db.appendBoundary(owner,epoch,writer,sealStorageRecord(operation,{kind:'journal'}),{expectedSeq,expectedBaseRevision});
    seq=operation.seq;return {seq,operationId:operation.operationId,deleteIntents:operation.deleteIntents};
  }
  async function initializeCloudHead(revision,state,{cloudState:cloudBaseState=state,changes=null,validateBase=validate,appMetadata={},replaceExistingState=null}={}){
    if(!primary())throw new Error('storage_secondary_tab');
    if(transition)throw new Error('storage_initialization_exists');
    if(!Number.isSafeInteger(revision)||revision<0)throw new Error('storage_base_revision');
    validate(state);validateBase(cloudBaseState);
    let existing=null;
    if(ready){
      if(replaceExistingState===null)throw new Error('storage_initialization_exists');
      existing=await recover();validate(replaceExistingState);
      if(!equalSyncJson(existing.state,replaceExistingState))throw new Error('storage_shadow_parity_mismatch');
      const cloud=await cloudState();if(cloud.base||cloud.flight||cloud.control)throw new Error('storage_shadow_cloud_state_invalid');
    }
    const nextEpoch=operationId(),metadata=structuredClone(appMetadata);
    const checkpoint=sealStorageRecord({version:2,owner,epoch:nextEpoch,seq:0,state,appMetadata:metadata,savedAt:now()},{kind:'checkpoint'});
    const base=sealStorageRecord({version:2,owner,epoch:nextEpoch,revision,state:cloudBaseState,projection:'cloud',ackSeq:0},{kind:'cloud-base'});
    const entry=changes===null?null:sealStorageRecord({version:2,owner,epoch:nextEpoch,seq:1,generation:1,operationId:operationId(),at:now(),surface:'storage.bootstrap',mutationType:'bootstrap',changes,deleteIntents:{},appMetadata:metadata},{kind:'journal'});
    const replay=replayStorageJournal(checkpoint,entry?[entry]:[],schema);validate(replay.state);
    await queue;if(!primary())throw new Error('storage_secondary_tab');
    if(existing)await db.replaceShadowWithCloudHead(owner,existing.epoch,existing.seq,checkpoint,base,writer,entry);else await db.initializeCloudHead(owner,checkpoint,base,writer,entry);
    epoch=nextEpoch;seq=replay.seq;ready=true;failed=null;return replay;
  }
  async function compact(){guard();await queue;if(failed)throw failed;const recovered=await recover();validate(recovered.state);
    const checkpoint=sealStorageRecord({version:2,owner,epoch:recovered.epoch,seq:recovered.seq,state:recovered.state,appMetadata:recovered.appMetadata||{},savedAt:now()},{kind:'checkpoint'}),done=beginMeasure('storage:checkpoint');
    try{await db.compact(owner,recovered.epoch,writer,checkpoint);return recovered.seq}finally{done()}
  }
  async function setCloudBase(revision,state,{validateBase=validate,ackSeq}={}){guard();if(!Number.isSafeInteger(revision)||revision<0)throw new Error('storage_base_revision');if(!Number.isSafeInteger(ackSeq)||ackSeq<0||ackSeq>seq)throw new Error('storage_base_sequence');validateBase(state);await queue;return db.setBase(owner,epoch,writer,sealStorageRecord({version:2,owner,epoch,revision,state,projection:'cloud',ackSeq},{kind:'cloud-base'}))}
  async function captureCloudCursor(revision,{project=state=>state,validateBase=validate}={}){
    guard();if(!Number.isSafeInteger(revision)||revision<0)throw new Error('storage_base_revision');await queue;const recovered=await recover(),state=project(recovered.state);validateBase(state);
    const base={version:2,owner,epoch,revision,state,projection:'cloud',ackSeq:recovered.seq};await db.setBase(owner,epoch,writer,sealStorageRecord(base,{kind:'cloud-base'}));await db.clearControl(owner,epoch,writer);return structuredClone(base);
  }
  async function cloudState({validateBase=validate}={}){
    guard();await queue;return cloudSnapshot(await db.load(owner),validateBase);
  }
  function cloudSnapshot(stored,validateBase){
    const base=stored.bases&&readStorageRecord(stored.bases),flight=stored.flights&&readStorageRecord(stored.flights),control=stored.controls&&readStorageRecord(stored.controls),committedSeq=Number(stored.metadata?.seq);
    if(!Number.isSafeInteger(committedSeq)||committedSeq<0)throw new Error('storage_committed_metadata_mismatch');
    if(base){if(base.owner!==owner||base.epoch!==epoch||!Number.isSafeInteger(base.revision)||base.revision<0||!Number.isSafeInteger(base.ackSeq)||base.ackSeq<0||base.ackSeq>committedSeq)throw new Error('storage_cloud_base_mismatch');validateBase(base.state)}
    if(flight){if(flight.owner!==owner||flight.epoch!==epoch||!base||flight.baseRevision!==base.revision||!String(flight.operationId||'').trim()||!Number.isSafeInteger(flight.startSeq)||!Number.isSafeInteger(flight.endSeq)||flight.startSeq!==base.ackSeq+1||flight.endSeq<flight.startSeq||flight.endSeq>committedSeq)throw new Error('storage_cloud_flight_mismatch');validateBase(flight.snapshot)}
    if(control&&(control.owner!==owner||control.epoch!==epoch))throw new Error('storage_control_scope');
    const pendingRecords=base?stored.journal.map(readStorageRecord).filter(operation=>operation.epoch===epoch&&operation.seq>base.ackSeq&&operation.seq<=committedSeq).sort((a,b)=>a.seq-b.seq):[];
    if(base)for(let expected=base.ackSeq+1;expected<=committedSeq;expected++)if(pendingRecords[expected-base.ackSeq-1]?.seq!==expected)throw new Error('storage_cloud_journal_gap');
    const latest=pendingRecords.at(-1)||{},afterFlightRecords=flight?pendingRecords.filter(operation=>operation.seq>flight.endSeq):pendingRecords,afterFlightLatest=afterFlightRecords.at(-1)||{};
    return {seq:committedSeq,base,flight,control,pending:!!base&&committedSeq>base.ackSeq,pendingDeleteIntents:mergeDeleteIntents(...pendingRecords.map(operation=>operation.deleteIntents||{})),pendingGeneration:Math.max(0,...pendingRecords.map(operation=>Number(operation.generation||0))),pendingMutationType:pendingRecords.some(operation=>operation.mutationType==='bulk-delete')?'bulk-delete':latest.mutationType||'autosave',pendingSurface:latest.surface||'unknown',afterFlightPending:!!flight&&committedSeq>flight.endSeq,afterFlightDeleteIntents:mergeDeleteIntents(...afterFlightRecords.map(operation=>operation.deleteIntents||{})),afterFlightGeneration:Math.max(0,...afterFlightRecords.map(operation=>Number(operation.generation||0))),afterFlightMutationType:afterFlightRecords.some(operation=>operation.mutationType==='bulk-delete')?'bulk-delete':afterFlightLatest.mutationType||'autosave',afterFlightSurface:afterFlightLatest.surface||'unknown'};
  }
  async function materializeFlight({operationId:flightId,baseRevision,throughSeq,snapshot:exactSnapshot,project=state=>state,validateCloud=validate,prepareAudit=null}={}){
    guard();await queue;const recovered=await recover();
    if(recovered.stored.flights)return readStorageRecord(recovered.stored.flights);
    if(!flightId)throw new Error('storage_flight_id_required');
    if(!Number.isSafeInteger(baseRevision)||baseRevision<0||!recovered.stored.bases)throw new Error('storage_cloud_base_mismatch');
    const base=readStorageRecord(recovered.stored.bases),targetSeq=throughSeq===undefined?recovered.seq:Number(throughSeq);
    if(base.revision!==baseRevision||!Number.isSafeInteger(base.ackSeq)||base.ackSeq<0||base.ackSeq>recovered.seq)throw new Error('storage_cloud_base_mismatch');
    if(!Number.isSafeInteger(targetSeq)||targetSeq<base.ackSeq||targetSeq>recovered.seq)throw new Error('storage_flight_range');
    if(targetSeq===base.ackSeq)return null;
    if(targetSeq<recovered.seq&&exactSnapshot===undefined)throw new Error('storage_historical_snapshot_required');
    const pendingRecords=recovered.stored.journal.map(readStorageRecord).filter(operation=>operation.epoch===epoch&&operation.seq>base.ackSeq&&operation.seq<=targetSeq).sort((a,b)=>a.seq-b.seq);
    for(let expected=base.ackSeq+1;expected<=targetSeq;expected++)if(pendingRecords[expected-base.ackSeq-1]?.seq!==expected)throw new Error('storage_cloud_journal_gap');
    const done=beginMeasure('storage:outbox-materialize');let snapshot;
    try{snapshot=exactSnapshot===undefined?project(recovered.state):structuredClone(exactSnapshot);validateCloud(snapshot)}finally{done()}
    const pendingDeleteIntents=mergeDeleteIntents(...pendingRecords.map(operation=>operation.deleteIntents||{})),latest=pendingRecords.at(-1)||{};
    const value={version:2,owner,epoch,operationId:flightId,baseRevision,startSeq:base.ackSeq+1,endSeq:targetSeq,snapshot,deleteIntents:pendingDeleteIntents,generation:Math.max(0,...pendingRecords.map(operation=>Number(operation.generation||0))),mutationType:pendingRecords.some(operation=>operation.mutationType==='bulk-delete')?'bulk-delete':latest.mutationType||'autosave',surface:latest.surface||'unknown'};
    if(prepareAudit)value.audit=prepareAudit(structuredClone(value));
    const sealed=sealStorageRecord(value,{kind:'flight-payload'}),flightDone=beginMeasure('storage:flight-write');
    try{await db.beginFlight(owner,epoch,writer,sealed);return readStorageRecord(sealed)}finally{flightDone()}
  }
  async function acknowledge(flightId,revision,state,{validateBase=validate,checkpointState=null,expectedSeq=null,appMetadata={},control=null}={}){
    guard();validateBase(state);if(checkpointState!==null)validate(checkpointState);await queue;const recovered=await recover(),flight=recovered.stored.flights&&readStorageRecord(recovered.stored.flights);if(!flight||flight.operationId!==flightId)throw new Error('storage_ack_mismatch');
    if(expectedSeq!==null&&recovered.seq!==expectedSeq)throw new Error('storage_ack_checkpoint_stale');
    const base=sealStorageRecord({version:2,owner,epoch,revision,state,projection:'cloud',ackSeq:flight.endSeq},{kind:'cloud-base'}),checkpoint=checkpointState===null?null:sealStorageRecord({version:2,owner,epoch,seq:recovered.seq,state:structuredClone(checkpointState),appMetadata:{...(recovered.appMetadata||{}),...structuredClone(appMetadata)},savedAt:now()},{kind:'checkpoint'}),sealedControl=control?sealStorageRecord({version:2,owner,epoch,updatedAt:now(),...structuredClone(control)},{kind:'cloud-control'}):null;
    await db.acknowledge(owner,epoch,writer,flightId,base,{checkpoint,control:sealedControl});return {operationId:flightId,revision,ackSeq:flight.endSeq};
  }
  async function rejectAndRebase(flightId,revision,state,{validateBase=validate,checkpointState,expectedSeq,appMetadata={},control=null}={}){
    guard();if(!Number.isSafeInteger(revision)||revision<0)throw new Error('storage_rebase_revision_invalid');validateBase(state);if(checkpointState===undefined||!Number.isSafeInteger(expectedSeq)||expectedSeq<0)throw new Error('storage_rebase_checkpoint_required');validate(checkpointState);
    await queue;const recovered=await recover(),stored=recovered.stored,flight=stored.flights&&readStorageRecord(stored.flights),base=stored.bases&&readStorageRecord(stored.bases);if(!flight||flight.operationId!==flightId)throw new Error('storage_reject_mismatch');if(!base)throw new Error('storage_cloud_base_mismatch');
    if(recovered.seq!==expectedSeq)throw new Error('storage_rebase_checkpoint_stale');
    const nextBase=sealStorageRecord({version:2,owner,epoch,revision,state,projection:'cloud',ackSeq:base.ackSeq},{kind:'cloud-base'}),checkpoint=sealStorageRecord({version:2,owner,epoch,seq:expectedSeq,state:structuredClone(checkpointState),appMetadata:{...(recovered.appMetadata||{}),...structuredClone(appMetadata)},savedAt:now()},{kind:'checkpoint'}),sealedControl=control?sealStorageRecord({version:2,owner,epoch,updatedAt:now(),...structuredClone(control)},{kind:'cloud-control'}):null;
    await db.rejectFlight(owner,epoch,writer,flightId,nextBase,{checkpoint,expectedSeq,control:sealedControl});return {rejected:structuredClone(flight),base:readStorageRecord(nextBase),checkpoint:readStorageRecord(checkpoint),control:sealedControl&&readStorageRecord(sealedControl),cloudState:cloudSnapshot({...stored,checkpoints:checkpoint,bases:nextBase,flights:null,controls:sealedControl},validateBase)};
  }
  async function setCloudControl(control={}){guard();await queue;const sealed=sealStorageRecord({version:2,owner,epoch,updatedAt:now(),...structuredClone(control)},{kind:'cloud-control'});await db.setControl(owner,epoch,writer,sealed);return readStorageRecord(sealed)}
  async function clearCloudControl(){guard();await queue;return db.clearControl(owner,epoch,writer)}
  async function replaceCurrentState(state,{appMetadata={}}={}){
    guard();validate(state);await queue;const recovered=await recover();if(recovered.seq!==seq)throw new Error('storage_checkpoint_stale');
    const checkpoint=sealStorageRecord({version:2,owner,epoch,seq:recovered.seq,state,appMetadata:{...(recovered.appMetadata||{}),...structuredClone(appMetadata)},savedAt:now()},{kind:'checkpoint'});await db.replaceCheckpoint(owner,epoch,writer,checkpoint);return recovered.seq;
  }
  async function replaceLocalAuthoritativeState(state,{boundaryId,expectedSeq}={}){
    guard();validate(state);
    if(!String(boundaryId||'').trim()||!Number.isSafeInteger(expectedSeq)||expectedSeq<0)throw new Error('storage_boundary_source_required');
    await queue;guard();const recovered=await recover();
    if(recovered.seq!==expectedSeq||seq!==expectedSeq||recovered.stored.metadata.seq!==expectedSeq)throw new Error('storage_boundary_source_changed');
    if(recovered.stored.bases||recovered.stored.flights||recovered.stored.controls)throw new Error('storage_boundary_local_cloud_head_exists');
    const checkpoint=sealStorageRecord({version:2,owner,epoch,seq:expectedSeq,state:structuredClone(state),appMetadata:{...(recovered.appMetadata||{}),boundaryId},savedAt:now()},{kind:'checkpoint'});
    await db.replaceLocalCheckpoint(owner,epoch,writer,checkpoint,expectedSeq);
    return {epoch,seq:expectedSeq};
  }
  async function adoptCloudHead(revision,cloudState,currentState,{validateBase=validate,appMetadata={}}={}){
    guard();if(!Number.isSafeInteger(revision)||revision<0)throw new Error('storage_base_revision');validateBase(cloudState);validate(currentState);await queue;const recovered=await recover(),base=recovered.stored.bases&&readStorageRecord(recovered.stored.bases);if(!base||recovered.stored.flights||base.ackSeq!==recovered.seq)throw new Error('storage_cloud_pending');
    const checkpoint=sealStorageRecord({version:2,owner,epoch,seq:recovered.seq,state:structuredClone(currentState),appMetadata:{...(recovered.appMetadata||{}),...structuredClone(appMetadata)},savedAt:now()},{kind:'checkpoint'}),nextBase=sealStorageRecord({version:2,owner,epoch,revision,state:structuredClone(cloudState),projection:'cloud',ackSeq:recovered.seq},{kind:'cloud-base'});
    await db.adoptCloudHead(owner,epoch,writer,checkpoint,nextBase);return {seq:recovered.seq,revision};
  }
  async function replaceAuthoritativeState(currentState,{appMetadata={}}={}){
    guard();validate(currentState);const durableState=structuredClone(currentState),durableMetadata=structuredClone(appMetadata),nextEpoch=operationId();
    return enqueueEpochTransition(nextEpoch,async active=>{
      if(!primary())throw new Error('storage_secondary_tab');const previousEpoch=epoch,checkpoint=sealStorageRecord({version:2,owner,epoch:active.epoch,seq:0,state:durableState,appMetadata:durableMetadata,savedAt:now()},{kind:'checkpoint'});
      await db.resetState(owner,previousEpoch,writer,checkpoint);epoch=active.epoch;seq=active.seq;ready=true;failed=null;for(const record of readEmergency())if(record.data.epoch!==epoch)cleanEmergency(record);return {epoch,seq};
    });
  }
  async function resetCloudHead(revision,cloudState,currentState,{validateBase=validate,appMetadata={}}={}){
    guard();if(!Number.isSafeInteger(revision)||revision<0)throw new Error('storage_base_revision');validateBase(cloudState);validate(currentState);const durableCloudState=structuredClone(cloudState),durableCurrentState=structuredClone(currentState),durableMetadata=structuredClone(appMetadata),nextEpoch=operationId();
    return enqueueEpochTransition(nextEpoch,async active=>{
      if(!primary())throw new Error('storage_secondary_tab');const previousEpoch=epoch,checkpoint=sealStorageRecord({version:2,owner,epoch:active.epoch,seq:0,state:durableCurrentState,appMetadata:durableMetadata,savedAt:now()},{kind:'checkpoint'}),nextBase=sealStorageRecord({version:2,owner,epoch:active.epoch,revision,state:durableCloudState,projection:'cloud',ackSeq:0},{kind:'cloud-base'});
      await db.resetCloudHead(owner,previousEpoch,writer,checkpoint,nextBase);epoch=active.epoch;seq=active.seq;ready=true;failed=null;for(const record of readEmergency())if(record.data.epoch!==epoch)cleanEmergency(record);return {epoch,seq,revision,ackSeq:0};
    });
  }
  return {open,install,initializeCloudHead,append,replaceLocalWithPending,recover,compact,setCloudBase,captureCloudCursor,cloudState,materializeFlight,acknowledge,rejectAndRebase,setCloudControl,clearCloudControl,replaceCurrentState,replaceLocalAuthoritativeState,adoptCloudHead,replaceAuthoritativeState,resetCloudHead,settled:()=>queue,get ready(){return ready&&!failed},get epoch(){return epoch},get seq(){return seq},get error(){return failed}};
}
