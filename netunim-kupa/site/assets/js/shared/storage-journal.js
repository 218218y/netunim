import {createStorageCheckpoint,createStorageJournalRecord,createStorageCloudBase,createStorageCloudFlight} from './storage-records.js';
import {createOperationId,equalSyncJson} from './cloud-sync.js';
import {beginMeasure,recordPerformanceValue} from './runtime-performance.js';
import {createStorageJournalDb} from './storage-journal-idb.js';
import {sealStorageRecord,readStorageRecord,validateStoredOperation,readStorageOperation,replayStorageJournal} from './storage-journal-model.js';
import {readStorageCheckpoint} from './storage-checkpoint.js';
import {readStorageCloudBase,readStorageCloudFlight,readStorageCloudControl,readStorageCloudHead} from './storage-cloud-records.js';
import {captureStorageJournalPayload,captureStorageCloudControl} from './storage-journal-authority.js';
import {assertCloudRecoveryHead} from './storage-cloud-recovery.js';

/** @typedef {import('./storage-journal-contracts.js').State} State */
/** @typedef {import('./storage-journal-contracts.js').StorageDeleteIntents} StorageDeleteIntents */
/** @typedef {import('./storage-journal-contracts.js').Operation} Operation */
/** @typedef {import('./storage-journal-contracts.js').Payload} Payload */
/** @typedef {import('./storage-journal-contracts.js').EpochTransition} EpochTransition */
/** @typedef {import('./storage-journal-contracts.js').RecoveredJournal} RecoveredJournal */
/** @typedef {import('./storage-journal-contracts.js').JournalMethods} JournalMethods */
/** @param {unknown} value @returns {StorageDeleteIntents} */
function normalizeDeleteIntents(value){
  if(value==null)return {};
  if(!value||typeof value!=='object'||Array.isArray(value))throw new Error('storage_delete_intents_invalid');
  /** @type {StorageDeleteIntents} */ const result={};
  for(const [collection,rawIds] of Object.entries(value)){
    if(!collection||['__proto__','prototype','constructor'].includes(collection)||!Array.isArray(rawIds))throw new Error('storage_delete_intents_invalid');
    const ids=[...new Set(rawIds.map(id=>String(id||'').trim()).filter(Boolean))].sort();
    if(ids.length)result[collection]=ids;
  }
  return result;
}
/** @param {...unknown} sources @returns {StorageDeleteIntents} */
function mergeDeleteIntents(...sources){
  /** @type {StorageDeleteIntents} */ const merged={};
  for(const source of sources)for(const [collection,ids] of Object.entries(normalizeDeleteIntents(source)))(merged[collection]??=[]).push(...ids);
  for(const collection of Object.keys(merged))merged[collection]=[...new Set(merged[collection])].sort();
  return merged;
}

/** @param {import('./storage-json.js').StorageJsonArray} rows @returns {string[]} */
function collectionIds(rows){return rows.map(row=>{
  if(row===null||typeof row!=='object'||Array.isArray(row)||typeof row.id!=='string'||!row.id)throw new Error('storage_boundary_collection_invalid');
  return row.id;
})}

// Local checkpoint/journal engine. Rollout policy lives in the application
// adapter; this layer provides primary recovery and cloud synchronization.
/** @param {Partial<import('./storage-journal-contracts.js').JournalOptions>} [options] */
export function createStorageJournal({owner:configuredOwner,schema:configuredSchema,validate:configuredValidate,primary=()=>true,commitPrimary=primary,db=createStorageJournalDb(configuredSchema?{operationSchema:configuredSchema}:{}),emergency=globalThis.localStorage,operationId=()=>createOperationId('storage-v2'),now=()=>new Date().toISOString(),maxEmergencyBytes=131072,maxEmergencyEntries=64}={}){
  if(!configuredOwner||!configuredSchema||!configuredValidate)throw new Error('storage_configuration_required');
  const owner=configuredOwner,schema=configuredSchema,validate=configuredValidate;
  const prefix='netunim-storage-v2-emergency:'+encodeURIComponent(owner)+':',writer=operationId();
  /** @type {string|null} */ let epoch=null;
  /** @type {Promise<unknown>} */ let queue=Promise.resolve();
  /** @type {unknown} */ let failed=null;
  /** @type {EpochTransition|null} */ let transition=null;
  let seq=0,ready=false;
  /** @type {Map<string,string>} */ const pending=new Map();
  function currentEpoch(){if(epoch===null)throw new Error('storage_not_ready');return epoch}
  /** @returns {Promise<RecoveredJournal>} */
  async function requiredRecovery(){const recovered=await recover();if(!recovered)throw new Error('storage_checkpoint_missing');return recovered}

  /** @type {JournalMethods['readScopedOperation']} */
  function readScopedOperation(record,expectedEpoch){
    const operation=readStorageOperation(record,schema);
    if(operation.owner!==owner||operation.epoch!==expectedEpoch)throw new Error('storage_foreign_operation');
    return operation;
  }
  const guard=()=>{if(!primary())throw new Error('storage_secondary_tab');if(!ready)throw new Error('storage_not_ready');if(failed)throw failed};
  /** @template Result @param {()=>Result|PromiseLike<Result>} work @returns {Promise<Result>} */
  function enqueue(work){const result=queue.then(work);queue=result.catch(error=>{failed=error});return result}
  /** @template Result @param {string} nextEpoch @param {(active:EpochTransition)=>Result|PromiseLike<Result>} work @returns {Promise<Result>} */
  function enqueueEpochTransition(nextEpoch,work){
    if(transition)throw new Error('storage_epoch_transition');
    const active={epoch:nextEpoch,seq:0,fallbackEpoch:epoch,fallbackSeq:seq};transition=active;
    const result=queue.then(async()=>{try{return await work(active)}finally{if(transition===active)transition=null}});
    // A failed reset with edits reserved for its new epoch must stop further
    // writes. Recovery can replay their old-epoch emergency copies instead.
    queue=result.catch(error=>{if(active.seq)failed=error});return result;
  }
  /** @type {JournalMethods['readEmergency']} */
  function readEmergency(){
    if(!emergency)throw new Error('storage_emergency_unavailable');
    /** @type {Payload[]} */ const records=[];
    for(let i=0;i<emergency.length;i++){const key=emergency.key(i);if(!key?.startsWith(prefix))continue;const raw=emergency.getItem(key);const sealed=JSON.parse(raw===null?'null':raw),op=captureStorageJournalPayload(readStorageRecord(sealed));if(op.owner!==owner)throw new Error('storage_emergency_owner');records.push(sealStorageRecord(op))}
    return records;
  }
  /** @type {JournalMethods['emergencyKey']} */
  function emergencyKey(operation){return prefix+encodeURIComponent(String(operation.epoch))+':'+operation.seq}
  /** @type {JournalMethods['writeEmergency']} */
  function writeEmergency(record){const done=beginMeasure('storage:journal-emergency');try{
    const text=JSON.stringify(record);recordPerformanceValue('storage:bytes:journal-emergency',new TextEncoder().encode(text).length);
    if(pending.size>=maxEmergencyEntries||text.length*2+[...pending.values()].reduce((sum,value)=>sum+value.length*2,0)>maxEmergencyBytes)return false;
    const key=emergencyKey(record.data),existing=emergency.getItem(key);
    if(existing!==null&&existing!==text)throw new Error('storage_emergency_sequence_collision');
    emergency.setItem(key,text);if(emergency.getItem(key)!==text)throw new Error('storage_emergency_verification');pending.set(key,text);return true;
  }catch{return false}finally{done()}}
  /** @type {JournalMethods['cleanEmergency']} */
  function cleanEmergency(record){const key=emergencyKey(record.data);try{
    const text=emergency.getItem(key);
    // Never remove an entry replaced by another writer or a newer operation.
    if(text&&JSON.stringify(JSON.parse(text))!==JSON.stringify(record))throw new Error('storage_emergency_changed');
    emergency.removeItem(key);pending.delete(key);
  }catch{/* A committed duplicate is safe; recovery checks its exact identity. */}}
  /** @type {JournalMethods['recover']} */
  async function recover(){const done=beginMeasure('storage:replay');try{
    const stored=await db.load(owner);if(!stored.checkpoints)return null;
    const base=readStorageCheckpoint(stored.checkpoints);
    if(base.owner!==owner||stored.metadata?.epoch!==base.epoch)throw new Error('storage_checkpoint_metadata');
    const committedSeq=stored.journal.map(record=>readScopedOperation(record,base.epoch)).reduce((maximum,operation)=>Math.max(maximum,operation.seq),base.seq);
    if(!Number.isSafeInteger(stored.metadata.seq)||committedSeq!==stored.metadata.seq)throw new Error('storage_committed_metadata_mismatch');
    readStorageCloudHead({base:stored.bases,flight:stored.flights,control:stored.controls},{owner,epoch:base.epoch,seq:stored.metadata.seq});
    const records=readEmergency();
    // A prior epoch is retained for diagnostics, but cannot cross a restore boundary.
    const applicable=records.filter(record=>record.data.epoch===base.epoch).map(record=>sealStorageRecord(readScopedOperation(record,base.epoch)));
    const replay=replayStorageJournal(stored.checkpoints,[...stored.journal,...applicable],schema);
    if(replay.seq<stored.metadata.seq)throw new Error('storage_committed_journal_missing');
    validate(replay.state);return {...replay,stored:{...stored,metadata:stored.metadata,checkpoints:stored.checkpoints},emergency:applicable};
  }finally{done()}}
  /** @type {JournalMethods['open']} */
  async function open(){if(!primary())throw new Error('storage_secondary_tab');let recovered=await recover();if(!recovered)return null;if(!primary())throw new Error('storage_secondary_tab');
    await db.claim(owner,recovered.epoch,writer);recovered=await requiredRecovery();epoch=recovered.epoch;seq=recovered.seq;ready=true;failed=null;
    // Recovered emergency operations must commit before their entries are removed.
    for(const record of recovered.emergency.sort((a,b)=>a.data.seq-b.data.seq)){
      if(record.data.seq>recovered.stored.metadata.seq)await db.append(owner,currentEpoch(),writer,record);
      cleanEmergency(record);
    }
    // A failed epoch transition may leave a sealed copy for the epoch that
    // never became authoritative. Once the recovered writer is claimed, it is
    // safe to retire those obsolete copies.
    for(const record of readEmergency())if(record.data.epoch!==epoch)cleanEmergency(record);
    return recovered;
  }
  /** @type {JournalMethods['install']} */
  async function install(state,{expectedEpoch,appMetadata={}}={}){
    if(!primary())throw new Error('storage_secondary_tab');validate(state);const durableState=structuredClone(state),durableMetadata=structuredClone(appMetadata),nextEpoch=operationId();
    return enqueueEpochTransition(nextEpoch,async active=>{
      if(!primary())throw new Error('storage_secondary_tab');const requiredEpoch=expectedEpoch===undefined?epoch:expectedEpoch,checkpoint=sealStorageRecord(createStorageCheckpoint({owner,epoch:active.epoch,seq:0,state:durableState,appMetadata:durableMetadata,savedAt:now()}),{kind:'checkpoint'});
      const done=beginMeasure('storage:checkpoint');try{await db.install(owner,checkpoint,writer,{expectedEpoch:requiredEpoch});epoch=active.epoch;seq=active.seq;ready=true;failed=null;
        // The new epoch is durable before obsolete emergency entries are retired.
        for(const record of readEmergency())if(record.data.epoch!==epoch)cleanEmergency(record);
        return {epoch,seq};
      }finally{done()}
    });
  }
  /** @type {JournalMethods['append']} */
  function append(changes,{generation=0,surface='unknown',mutationType='edit',deleteIntents={},appMetadata={}}={}){
    guard();const activeTransition=transition,targetEpoch=activeTransition?.epoch||currentEpoch(),targetSeq=activeTransition?activeTransition.seq+1:seq+1,operation=createStorageJournalRecord({owner,epoch:targetEpoch,seq:targetSeq,generation,operationId:operationId(),at:now(),surface,mutationType,changes:structuredClone(changes),deleteIntents:normalizeDeleteIntents(deleteIntents),appMetadata:structuredClone(appMetadata)});
    validateStoredOperation(operation,schema);const record=sealStorageRecord(operation,{kind:'journal'});
    // Until the reset transaction commits, either epoch may be authoritative
    // after a crash. Keep the same operation in both emergency namespaces.
    const fallbackEpoch=activeTransition?.fallbackEpoch;
    if(activeTransition&&fallbackEpoch==null)throw new Error('storage_not_ready');
    const fallbackRecord=activeTransition&&fallbackEpoch!=null?sealStorageRecord({...operation,epoch:fallbackEpoch,seq:activeTransition.fallbackSeq+1},{kind:'journal'}):null;
    const fallbackDurable=!fallbackRecord||writeEmergency(fallbackRecord),newEpochDurable=writeEmergency(record),emergencyDurable=fallbackDurable&&newEpochDurable;
    if(activeTransition){activeTransition.seq=operation.seq;activeTransition.fallbackSeq++}else seq=operation.seq;
    const committed=enqueue(async()=>{if(!commitPrimary())throw new Error('storage_secondary_tab');const done=beginMeasure('storage:idb-journal');try{await db.append(owner,operation.epoch,writer,record);cleanEmergency(record);if(fallbackRecord)cleanEmergency(fallbackRecord);return true}finally{done()}});
    return {seq:operation.seq,operationId:operation.operationId,emergencyDurable,transitionFallbackDurable:fallbackDurable,committed,transitioning:!!activeTransition};
  }
  /** @type {JournalMethods['replaceLocalWithPending']} */
  async function replaceLocalWithPending(state,{boundaryId,expectedSeq,expectedBaseRevision,deleteCollections=schema.collections,validateBase=validate,mutationType='import',surface='backup.local-import',requireCurrentState=false}){
    guard();if(!String(boundaryId||'').trim()||!Number.isSafeInteger(expectedSeq)||!Number.isSafeInteger(expectedBaseRevision))throw new Error('storage_boundary_source_required');
    validate(state);state=structuredClone(state);deleteCollections=[...deleteCollections];await queue;guard();
    const recovered=await requiredRecovery(),cloud=cloudSnapshot(recovered.stored,validateBase);
    if(recovered.seq!==seq||recovered.stored.metadata.seq!==seq||seq!==expectedSeq||!cloud.base||cloud.base.revision!==expectedBaseRevision||cloud.base.ackSeq!==seq||cloud.flight||cloud.control)throw new Error('storage_boundary_cloud_changed');
    const target=structuredClone(state);
    /** @type {StorageDeleteIntents} */ const deleteIntents={};
    if(requireCurrentState&&!equalSyncJson(recovered.state,target))throw new Error('storage_normalization_state_changed');
    for(const collection of deleteCollections){
      if(!schema.collections.includes(collection))throw new Error('storage_boundary_collection_invalid');
      const before=cloud.base.state[collection],after=target[collection];
      if(!Array.isArray(before)||!Array.isArray(after))throw new Error('storage_boundary_collection_invalid');
      const retained=new Set(collectionIds(after));
      const removed=collectionIds(before).filter(id=>!retained.has(id));
      if(removed.length)deleteIntents[collection]=removed;
    }
    const operation=createStorageJournalRecord({owner,epoch:currentEpoch(),seq:seq+1,generation:1,operationId:operationId(),at:now(),surface,mutationType,changes:[{type:'replace-state',state:target}],deleteIntents:normalizeDeleteIntents(deleteIntents),appMetadata:{boundaryId}});
    validateStoredOperation(operation,schema);
    await db.appendBoundary(owner,currentEpoch(),writer,sealStorageRecord(operation,{kind:'journal'}),{expectedSeq,expectedBaseRevision});
    seq=operation.seq;return {seq,operationId:operation.operationId,deleteIntents:operation.deleteIntents};
  }
  /** @type {JournalMethods['initializeCloudHead']} */
  async function initializeCloudHead(revision,state,{cloudState:cloudBaseState=state,changes=null,validateBase=validate,appMetadata={}}={}){
    if(!primary())throw new Error('storage_secondary_tab');
    if(transition)throw new Error('storage_initialization_exists');
    if(!Number.isSafeInteger(revision)||revision<0)throw new Error('storage_base_revision');
    validate(state);validateBase(cloudBaseState);
    if(ready)throw new Error('storage_initialization_exists');
    const nextEpoch=operationId(),metadata=structuredClone(appMetadata);
    const checkpoint=sealStorageRecord(createStorageCheckpoint({owner,epoch:nextEpoch,seq:0,state,appMetadata:metadata,savedAt:now()}),{kind:'checkpoint'});
    const base=sealStorageRecord(createStorageCloudBase({owner,epoch:nextEpoch,revision,state:cloudBaseState,ackSeq:0}),{kind:'cloud-base'});
    const entry=changes===null?null:sealStorageRecord(createStorageJournalRecord({owner,epoch:nextEpoch,seq:1,generation:1,operationId:operationId(),at:now(),surface:'storage.bootstrap',mutationType:'bootstrap',changes,deleteIntents:{},appMetadata:metadata}),{kind:'journal'});
    const replay=replayStorageJournal(checkpoint,entry?[entry]:[],schema);validate(replay.state);
    await queue;if(!primary())throw new Error('storage_secondary_tab');
    await db.initializeCloudHead(owner,checkpoint,base,writer,entry);
    epoch=nextEpoch;seq=replay.seq;ready=true;failed=null;return replay;
  }
  /** @type {JournalMethods['compact']} */
  async function compact(){guard();await queue;if(failed)throw failed;const recovered=await requiredRecovery();validate(recovered.state);
    const checkpoint=sealStorageRecord(createStorageCheckpoint({owner,epoch:recovered.epoch,seq:recovered.seq,state:recovered.state,appMetadata:recovered.appMetadata||{},savedAt:now()}),{kind:'checkpoint'}),done=beginMeasure('storage:checkpoint');
    try{await db.compact(owner,recovered.epoch,writer,checkpoint);return recovered.seq}finally{done()}
  }
  /** @type {JournalMethods['setCloudBase']} */
  async function setCloudBase(revision,state,{validateBase=validate,ackSeq}){guard();if(!Number.isSafeInteger(revision)||revision<0)throw new Error('storage_base_revision');if(!Number.isSafeInteger(ackSeq)||ackSeq<0||ackSeq>seq)throw new Error('storage_base_sequence');validateBase(state);state=structuredClone(state);await queue;return db.setBase(owner,currentEpoch(),writer,sealStorageRecord(createStorageCloudBase({owner,epoch:currentEpoch(),revision,state,ackSeq}),{kind:'cloud-base'}))}
  /** @type {JournalMethods['captureCloudCursor']} */
  async function captureCloudCursor(revision,{project=(/** @type {State} */ state)=>state,validateBase=validate}={}){
    guard();if(!Number.isSafeInteger(revision)||revision<0)throw new Error('storage_base_revision');await queue;const recovered=await requiredRecovery(),state=project(recovered.state);validateBase(state);
    const base=createStorageCloudBase({owner,epoch:currentEpoch(),revision,state,ackSeq:recovered.seq});await db.setBase(owner,currentEpoch(),writer,sealStorageRecord(base,{kind:'cloud-base'}));await db.clearControl(owner,currentEpoch(),writer);return structuredClone(base);
  }
  /** @type {JournalMethods['cloudState']} */
  async function cloudState({validateBase=validate}={}){
    guard();await queue;return cloudSnapshot(await db.load(owner),validateBase);
  }
  /** @type {JournalMethods['cloudSnapshot']} */
  function cloudSnapshot(stored,validateBase){
    if(!stored.metadata)throw new Error('storage_checkpoint_metadata');
    const {base,flight,control,seq:committedSeq}=readStorageCloudHead({base:stored.bases,flight:stored.flights,control:stored.controls},{owner,epoch:currentEpoch(),seq:stored.metadata.seq});
    if(base)validateBase(base.state);if(flight)validateBase(flight.snapshot);
    const pendingRecords=base?stored.journal.map(record=>readScopedOperation(record,epoch)).filter(operation=>operation.seq>base.ackSeq&&operation.seq<=committedSeq).sort((a,b)=>a.seq-b.seq):[];
    if(base)for(let expected=base.ackSeq+1;expected<=committedSeq;expected++)if(pendingRecords[expected-base.ackSeq-1]?.seq!==expected)throw new Error('storage_cloud_journal_gap');
    const latest=pendingRecords.at(-1),afterFlightRecords=flight?pendingRecords.filter(operation=>operation.seq>flight.endSeq):pendingRecords,afterFlightLatest=afterFlightRecords.at(-1);
    return {seq:committedSeq,base,flight,control,
      pending:!!base&&committedSeq>base.ackSeq,
      pendingDeleteIntents:mergeDeleteIntents(...pendingRecords.map(operation=>operation.deleteIntents||{})),
      pendingGeneration:Math.max(0,...pendingRecords.map(operation=>Number(operation.generation||0))),
      pendingMutationType:pendingRecords.some(operation=>operation.mutationType==='bulk-delete')?'bulk-delete':latest?.mutationType||'autosave',
      pendingSurface:latest?.surface||'unknown',
      afterFlightPending:!!flight&&committedSeq>flight.endSeq,
      afterFlightDeleteIntents:mergeDeleteIntents(...afterFlightRecords.map(operation=>operation.deleteIntents||{})),
      afterFlightGeneration:Math.max(0,...afterFlightRecords.map(operation=>Number(operation.generation||0))),
      afterFlightMutationType:afterFlightRecords.some(operation=>operation.mutationType==='bulk-delete')?'bulk-delete':afterFlightLatest?.mutationType||'autosave',
      afterFlightSurface:afterFlightLatest?.surface||'unknown'};
  }
  /** @type {JournalMethods['materializeFlight']} */
  async function materializeFlight({operationId:flightId,baseRevision,throughSeq,snapshot:exactSnapshot,project=(/** @type {State} */ state)=>state,validateCloud=validate,prepareAudit=null}={}){
    if(exactSnapshot!==undefined)exactSnapshot=structuredClone(exactSnapshot);
    guard();await queue;const recovered=await requiredRecovery();
    if(recovered.stored.flights){const flight=readStorageCloudFlight(recovered.stored.flights);validateCloud(flight.snapshot);return flight}
    if(!flightId)throw new Error('storage_flight_id_required');
    if(typeof baseRevision!=='number'||!Number.isSafeInteger(baseRevision)||baseRevision<0||!recovered.stored.bases)throw new Error('storage_cloud_base_mismatch');
    const base=readStorageCloudBase(recovered.stored.bases),targetSeq=throughSeq===undefined?recovered.seq:Number(throughSeq);
    if(base.revision!==baseRevision||!Number.isSafeInteger(base.ackSeq)||base.ackSeq<0||base.ackSeq>recovered.seq)throw new Error('storage_cloud_base_mismatch');
    if(!Number.isSafeInteger(targetSeq)||targetSeq<base.ackSeq||targetSeq>recovered.seq)throw new Error('storage_flight_range');
    if(targetSeq===base.ackSeq)return null;
    if(targetSeq<recovered.seq&&exactSnapshot===undefined)throw new Error('storage_historical_snapshot_required');
    const pendingRecords=recovered.stored.journal.map(record=>readScopedOperation(record,epoch)).filter(operation=>operation.seq>base.ackSeq&&operation.seq<=targetSeq).sort((a,b)=>a.seq-b.seq);
    for(let expected=base.ackSeq+1;expected<=targetSeq;expected++)if(pendingRecords[expected-base.ackSeq-1]?.seq!==expected)throw new Error('storage_cloud_journal_gap');
    const done=beginMeasure('storage:outbox-materialize');let snapshot;
    try{snapshot=exactSnapshot===undefined?project(recovered.state):structuredClone(exactSnapshot);validateCloud(snapshot)}finally{done()}
    const pendingDeleteIntents=mergeDeleteIntents(...pendingRecords.map(operation=>operation.deleteIntents||{})),latest=pendingRecords.at(-1);
    const value=createStorageCloudFlight({owner,epoch:currentEpoch(),operationId:flightId,baseRevision,startSeq:base.ackSeq+1,endSeq:targetSeq,snapshot,deleteIntents:pendingDeleteIntents,generation:Math.max(0,...pendingRecords.map(operation=>Number(operation.generation||0))),mutationType:pendingRecords.some(operation=>operation.mutationType==='bulk-delete')?'bulk-delete':latest?.mutationType||'autosave',surface:latest?.surface||'unknown'});
    if(prepareAudit)value.audit=prepareAudit(structuredClone(value));
    const sealed=sealStorageRecord(value,{kind:'flight-payload'}),flightDone=beginMeasure('storage:flight-write');
    readStorageCloudFlight(sealed);
    try{await db.beginFlight(owner,currentEpoch(),writer,sealed);return readStorageCloudFlight(sealed)}finally{flightDone()}
  }
  /** @type {JournalMethods['acknowledge']} */
  async function acknowledge(flightId,revision,state,{validateBase=validate,checkpointState=null,expectedSeq=null,appMetadata={},control=null}={}){
    state=structuredClone(state);checkpointState=structuredClone(checkpointState);appMetadata=structuredClone(appMetadata);control=structuredClone(control);
    // A checkpoint is a projection of a specific journal head. Its caller must
    // supply that captured sequence; a later recovered/cache sequence cannot
    // certify the earlier image. Cursor-only ACKs have no checkpoint to bind.
    if(checkpointState!==null&&(typeof expectedSeq!=='number'||!Number.isSafeInteger(expectedSeq)||expectedSeq<0))throw Object.assign(new Error('storage_ack_checkpoint_required'),{code:'storage_ack_checkpoint_required'});
    guard();validateBase(state);if(checkpointState!==null)validate(checkpointState);await queue;const recovered=await requiredRecovery(),flight=recovered.stored.flights&&readStorageCloudFlight(recovered.stored.flights);if(!flight||flight.operationId!==flightId)throw new Error('storage_ack_mismatch');
    if(expectedSeq!==null&&recovered.seq!==expectedSeq)throw Object.assign(new Error('storage_ack_checkpoint_stale'),{code:'storage_ack_checkpoint_stale',candidateSeq:expectedSeq,observedSeq:recovered.seq});
    const base=sealStorageRecord(createStorageCloudBase({owner,epoch:currentEpoch(),revision,state,ackSeq:flight.endSeq}),{kind:'cloud-base'}),checkpoint=checkpointState===null?null:sealStorageRecord(createStorageCheckpoint({owner,epoch:currentEpoch(),seq:recovered.seq,state:structuredClone(checkpointState),appMetadata:{...(recovered.appMetadata||{}),...structuredClone(appMetadata)},savedAt:now()}),{kind:'checkpoint'}),sealedControl=control?sealStorageRecord({version:2,owner,epoch:currentEpoch(),updatedAt:now(),...structuredClone(control)},{kind:'cloud-control'}):null;
    await db.acknowledge(owner,currentEpoch(),writer,flightId,base,{checkpoint,control:sealedControl?captureStorageCloudControl(sealedControl):null});return {operationId:flightId,revision,ackSeq:flight.endSeq};
  }
  /** @type {JournalMethods['rejectAndRebase']} */
  async function rejectAndRebase(flightId,revision,state,{validateBase=validate,checkpointState,expectedSeq,appMetadata={},control=null}){
    state=structuredClone(state);checkpointState=structuredClone(checkpointState);appMetadata=structuredClone(appMetadata);control=structuredClone(control);
    guard();if(!Number.isSafeInteger(revision)||revision<0)throw new Error('storage_rebase_revision_invalid');validateBase(state);if(checkpointState===undefined||!Number.isSafeInteger(expectedSeq)||expectedSeq<0)throw new Error('storage_rebase_checkpoint_required');validate(checkpointState);
    await queue;const recovered=await requiredRecovery(),stored=recovered.stored,flight=stored.flights&&readStorageCloudFlight(stored.flights),base=stored.bases&&readStorageCloudBase(stored.bases);if(!flight||flight.operationId!==flightId)throw new Error('storage_reject_mismatch');if(!base)throw new Error('storage_cloud_base_mismatch');
    if(recovered.seq!==expectedSeq)throw new Error('storage_rebase_checkpoint_stale');
    const nextBase=sealStorageRecord(createStorageCloudBase({owner,epoch:currentEpoch(),revision,state,ackSeq:base.ackSeq}),{kind:'cloud-base'}),checkpoint=sealStorageRecord(createStorageCheckpoint({owner,epoch:currentEpoch(),seq:expectedSeq,state:structuredClone(checkpointState),appMetadata:{...(recovered.appMetadata||{}),...structuredClone(appMetadata)},savedAt:now()}),{kind:'checkpoint'}),sealedControl=control?sealStorageRecord({version:2,owner,epoch:currentEpoch(),updatedAt:now(),...structuredClone(control)},{kind:'cloud-control'}):null;
    await db.rejectFlight(owner,currentEpoch(),writer,flightId,nextBase,{checkpoint,expectedSeq,control:sealedControl?captureStorageCloudControl(sealedControl):null});return {rejected:structuredClone(flight),base:readStorageCloudBase(nextBase),checkpoint:readStorageCheckpoint(checkpoint),control:sealedControl?readStorageCloudControl(sealedControl):null,cloudState:cloudSnapshot({...stored,checkpoints:checkpoint,bases:nextBase,flights:null,controls:sealedControl},validateBase)};
  }
  /** @type {JournalMethods['setCloudControl']} */
  async function setCloudControl(control={},{expectedEpoch=epoch,isCurrent=()=>true}={}){control=structuredClone(control);guard();await queue;guard();if(epoch!==expectedEpoch||!isCurrent())throw Object.assign(new Error('storage_cloud_scope_changed'),{code:'storage_cloud_scope_changed'});const sealed=sealStorageRecord({version:2,owner,epoch:currentEpoch(),updatedAt:now(),...control},{kind:'cloud-control'});readStorageCloudControl(sealed);await db.setControl(owner,currentEpoch(),writer,captureStorageCloudControl(sealed));return readStorageCloudControl(sealed)}
  /** @type {JournalMethods['readCloudRecovery']} */
  async function readCloudRecovery({validateBase=validate,afterSeq=null,previousState=null}={}){
    guard();await queue;guard();const recovered=await requiredRecovery(),stored=recovered.stored,head=cloudSnapshot(stored,validateBase);
    if(recovered.seq!==head.seq)throw new Error('storage_cloud_recovery_undurable');
    if(!head.base||head.flight||!stored.bases)throw new Error('storage_cloud_recovery_flight');
    /** @type {State|null} */ let replayedPrevious=null;
    /** @type {StorageDeleteIntents} */ let deleteIntents={};
    if(afterSeq!==null){
      if(!Number.isSafeInteger(afterSeq)||afterSeq<head.base.ackSeq||afterSeq>head.seq||previousState===null)throw new Error('storage_cloud_recovery_sequence');
      validate(previousState);
      const records=stored.journal.filter(record=>readScopedOperation(record,epoch).seq>afterSeq);
      const seed=sealStorageRecord(createStorageCheckpoint({owner,epoch:currentEpoch(),seq:afterSeq,state:structuredClone(previousState),appMetadata:recovered.appMetadata,savedAt:now()}),{kind:'checkpoint'});
      const replay=replayStorageJournal(seed,records,schema);validate(replay.state);
      if(replay.seq!==head.seq)throw new Error('storage_cloud_recovery_sequence');
      replayedPrevious=replay.state;deleteIntents=mergeDeleteIntents(...records.map(record=>readScopedOperation(record,epoch).deleteIntents||{}));
    }
    return {state:recovered.state,replayedPrevious,deleteIntents,head,backup:structuredClone(stored),expectedHead:{owner,epoch:currentEpoch(),seq:head.seq,baseRevision:head.base.revision,ackSeq:head.base.ackSeq,checkpointChecksum:stored.checkpoints.checksum,baseChecksum:stored.bases.checksum,controlChecksum:stored.controls?.checksum??null}};
  }
  /** @type {JournalMethods['commitCloudRecovery']} */
  async function commitCloudRecovery(state,{expectedHead,conflictKind=null,validateBase=validate,isCurrent=()=>true}){
    guard();validate(state);const candidate=structuredClone(state),expected=structuredClone(expectedHead);
    await queue;guard();if(!isCurrent())throw new Error('storage_cloud_scope_changed');
    const recovered=await requiredRecovery(),stored=recovered.stored,head=cloudSnapshot(stored,validateBase);
    assertCloudRecoveryHead(head,expected,conflictKind);
    if(!stored.bases||recovered.seq!==head.seq||stored.checkpoints.checksum!==expected.checkpointChecksum||stored.bases.checksum!==expected.baseChecksum||(stored.controls?.checksum??null)!==expected.controlChecksum)throw new Error('storage_cloud_recovery_stale');
    const checkpoint=sealStorageRecord(createStorageCheckpoint({owner,epoch:currentEpoch(),seq:head.seq,state:candidate,appMetadata:recovered.appMetadata,savedAt:now()}),{kind:'checkpoint'});
    await db.commitCloudRecovery(owner,currentEpoch(),writer,checkpoint,{expectedHead:expected,conflictKind,isCurrent});
    return {...head,control:null};
  }
  /** @type {JournalMethods['clearCloudControl']} */
  async function clearCloudControl({onlyIfClean=null,project=(/** @type {State} */ state)=>state,validateBase=validate}={}){
    guard();await queue;
    if(!onlyIfClean)return db.clearControl(owner,currentEpoch(),writer);
    const recovered=await requiredRecovery(),stored=recovered.stored,cloud=cloudSnapshot(stored,validateBase);
    if(!cloud.base||cloud.pending||cloud.flight||cloud.control?.retry||cloud.control?.conflict?.kind!==onlyIfClean.kind||cloud.seq!==onlyIfClean.seq||cloud.base.revision!==onlyIfClean.baseRevision)return false;
    if(!stored.bases||!stored.controls)return false;
    const projected=project(structuredClone(recovered.state));validateBase(projected);
    if(!equalSyncJson(projected,cloud.base.state))return false;
    return db.clearControl(owner,currentEpoch(),writer,{expectedHead:{seq:cloud.seq,checkpointChecksum:stored.checkpoints.checksum,baseChecksum:stored.bases.checksum,controlChecksum:stored.controls.checksum}});
  }
  /** @type {JournalMethods['replaceCurrentState']} */
  async function replaceCurrentState(state,{appMetadata={},expectedSeq=null}={}){
    state=structuredClone(state);appMetadata=structuredClone(appMetadata);
    guard();validate(state);await queue;const recovered=await requiredRecovery();if(recovered.seq!==seq)throw new Error('storage_checkpoint_stale');
    if(expectedSeq!==null&&recovered.seq!==expectedSeq)throw new Error('storage_checkpoint_stale');
    const checkpoint=sealStorageRecord(createStorageCheckpoint({owner,epoch:currentEpoch(),seq:recovered.seq,state,appMetadata:{...(recovered.appMetadata||{}),...structuredClone(appMetadata)},savedAt:now()}),{kind:'checkpoint'});await db.replaceCheckpoint(owner,currentEpoch(),writer,checkpoint);return recovered.seq;
  }
  /** @type {JournalMethods['replaceLocalAuthoritativeState']} */
  async function replaceLocalAuthoritativeState(state,{boundaryId,expectedSeq}){
    state=structuredClone(state);
    guard();validate(state);
    if(!String(boundaryId||'').trim()||!Number.isSafeInteger(expectedSeq)||expectedSeq<0)throw new Error('storage_boundary_source_required');
    await queue;guard();const recovered=await requiredRecovery();
    if(recovered.seq!==expectedSeq||seq!==expectedSeq||recovered.stored.metadata.seq!==expectedSeq)throw new Error('storage_boundary_source_changed');
    if(recovered.stored.bases||recovered.stored.flights||recovered.stored.controls)throw new Error('storage_boundary_local_cloud_head_exists');
    const checkpoint=sealStorageRecord(createStorageCheckpoint({owner,epoch:currentEpoch(),seq:expectedSeq,state:structuredClone(state),appMetadata:{...(recovered.appMetadata||{}),boundaryId},savedAt:now()}),{kind:'checkpoint'});
    await db.replaceLocalCheckpoint(owner,currentEpoch(),writer,checkpoint,expectedSeq);
    return {epoch:currentEpoch(),seq:expectedSeq};
  }
  /** @type {JournalMethods['adoptCloudHead']} */
  async function adoptCloudHead(revision,cloudState,currentState,{validateBase=validate,appMetadata={},expectedHead=null}={}){
    guard();if(!Number.isSafeInteger(revision)||revision<0)throw new Error('storage_base_revision');validateBase(cloudState);validate(currentState);
    const durableCloud=structuredClone(cloudState),durableCurrent=structuredClone(currentState),durableMetadata=structuredClone(appMetadata),observed=expectedHead&&structuredClone(expectedHead);
    await queue;const recovered=await requiredRecovery(),stored=recovered.stored,base=stored.bases&&readStorageCloudBase(stored.bases);
    if(!base||!stored.bases||stored.flights||base.ackSeq!==recovered.seq||stored.controls&&readStorageCloudControl(stored.controls).conflict)throw new Error('storage_cloud_pending');
    if(observed&&(observed.seq!==recovered.seq||observed.baseRevision!==base.revision))throw new Error('storage_cloud_adoption_stale');
    const checkpoint=sealStorageRecord(createStorageCheckpoint({owner,epoch:currentEpoch(),seq:recovered.seq,state:durableCurrent,appMetadata:{...(recovered.appMetadata||{}),...durableMetadata},savedAt:now()}),{kind:'checkpoint'}),nextBase=sealStorageRecord(createStorageCloudBase({owner,epoch:currentEpoch(),revision,state:durableCloud,ackSeq:recovered.seq}),{kind:'cloud-base'});
    guard();await db.adoptCloudHead(owner,currentEpoch(),writer,checkpoint,nextBase,{expectedHead:{seq:recovered.seq,checkpointChecksum:stored.checkpoints.checksum,baseChecksum:stored.bases.checksum,controlChecksum:stored.controls?.checksum??null}});return {seq:recovered.seq,revision};
  }
  /** @type {JournalMethods['replaceAuthoritativeState']} */
  async function replaceAuthoritativeState(currentState,{appMetadata={},expectedLocalHead=null}={}){
    guard();validate(currentState);const durableState=structuredClone(currentState),durableMetadata=structuredClone(appMetadata),nextEpoch=operationId();
    return enqueueEpochTransition(nextEpoch,async active=>{
      if(!primary())throw new Error('storage_secondary_tab');const previousEpoch=currentEpoch(),checkpoint=sealStorageRecord(createStorageCheckpoint({owner,epoch:active.epoch,seq:0,state:durableState,appMetadata:durableMetadata,savedAt:now()}),{kind:'checkpoint'});
      await db.resetState(owner,previousEpoch,writer,checkpoint,{expectedLocalHead});epoch=active.epoch;seq=active.seq;ready=true;failed=null;for(const record of readEmergency())if(record.data.epoch!==epoch)cleanEmergency(record);return {epoch,seq};
    });
  }
  /** @type {JournalMethods['resetCloudHead']} */
  async function resetCloudHead(revision,cloudState,currentState,{validateBase=validate,appMetadata={},expectedCleanHead=null}={}){
    guard();if(!Number.isSafeInteger(revision)||revision<0)throw new Error('storage_base_revision');validateBase(cloudState);validate(currentState);const durableCloudState=structuredClone(cloudState),durableCurrentState=structuredClone(currentState),durableMetadata=structuredClone(appMetadata),nextEpoch=operationId();
    return enqueueEpochTransition(nextEpoch,async active=>{
      if(!primary())throw new Error('storage_secondary_tab');const previousEpoch=currentEpoch(),checkpoint=sealStorageRecord(createStorageCheckpoint({owner,epoch:active.epoch,seq:0,state:durableCurrentState,appMetadata:durableMetadata,savedAt:now()}),{kind:'checkpoint'}),nextBase=sealStorageRecord(createStorageCloudBase({owner,epoch:active.epoch,revision,state:durableCloudState,ackSeq:0}),{kind:'cloud-base'});
      await db.resetCloudHead(owner,previousEpoch,writer,checkpoint,nextBase,{expectedCleanHead});epoch=active.epoch;seq=active.seq;ready=true;failed=null;for(const record of readEmergency())if(record.data.epoch!==epoch)cleanEmergency(record);return {epoch,seq,revision,ackSeq:0};
    });
  }
  return {open,install,initializeCloudHead,append,replaceLocalWithPending,recover,compact,setCloudBase,captureCloudCursor,cloudState,materializeFlight,acknowledge,rejectAndRebase,setCloudControl,readCloudRecovery,commitCloudRecovery,clearCloudControl,replaceCurrentState,replaceLocalAuthoritativeState,adoptCloudHead,replaceAuthoritativeState,resetCloudHead,settled:()=>queue,get ready(){return ready&&!failed},get epoch(){return epoch},get seq(){return seq},get error(){return failed}};
}
