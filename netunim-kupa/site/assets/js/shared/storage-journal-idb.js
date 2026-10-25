import {createStorageOwnerTransactions} from './storage-owner-idb.js';
import {createStorageCheckpoint,createStorageCloudBase} from './storage-records.js';
import {assertStorageCloudAck} from './storage-cloud-ack.js';
import {readStorageCloudBase,readStorageCloudFlight,readStorageCloudControl,readStorageCloudHead} from './storage-cloud-records.js';
import {createIndexedDbConnection,completeIndexedDbTransaction} from './indexed-db-connection.js';
import {readStorageRecord,sealStorageRecord} from './storage-journal-model.js';
import {readStorageState,readStorageBoundary} from './storage-operation.js';
import {historicalShadowRoleForSide} from './storage-v2-persisted-compat.js';
import {assertCloudRecoveryHead} from './storage-cloud-recovery.js';
import {readStorageCheckpoint,captureStorageCheckpoint,readStorageJournalDeletionKeys} from './storage-checkpoint.js';
import {captureStorageJournalOperation,captureStorageCloudBase,captureStorageCloudFlight,captureStorageCloudControl,
  captureStorageExpectedHead,captureStorageRecoveryHead,captureStorageLocalHead,captureStorageCleanHead,
  captureStorageJournalPayload,assertStorageJournalInstall,assertStorageJournalInitialization,
  storageJournalCompactionThrough,assertStorageJournalAckCheckpoint,assertStorageJournalAdoption,
  assertStorageJournalCloudReset,assertStorageJournalReplacement,assertStorageJournalLocalReplacement,
  assertStorageJournalFlight,assertStorageJournalRejection,assertStorageJournalLocalReset} from './storage-journal-authority.js';

/** @typedef {import('./storage-journal-db.js').StorageJournalDb} Db */
/** @typedef {import('./storage-journal-db.js').State} State */
/** @typedef {import('./storage-journal-db.js').Envelope} Envelope */
/** @typedef {import('./storage-journal-db.js').Metadata} Metadata */
/** @typedef {import('./storage-journal-db.js').Snapshot} Snapshot */
/** @typedef {import('./storage-journal-db.js').EditableSnapshot} EditableSnapshot */
/** @template Result @typedef {import('./storage-journal-db.js').TransactionWork<Result>} TransactionWork */
/** @param {unknown} record @returns {State} */
function readJournalObject(record){return readStorageState(readStorageRecord(record))}
/** @param {unknown} value @returns {Metadata|null} */
function readMetadata(value){
  if(value==null)return null;
  if(typeof value!=='object'||!('epoch' in value)||typeof value.epoch!=='string'||!('seq' in value)||typeof value.seq!=='number'||!Number.isSafeInteger(value.seq)||value.seq<0||!('writer' in value)||typeof value.writer!=='string')throw new Error('storage_journal_metadata_invalid');
  return {epoch:value.epoch,seq:value.seq,writer:value.writer};
}
/** @param {unknown} value @returns {Envelope|null} */
function readEnvelope(value){
  if(value==null)return null;
  if(typeof value!=='object'||!('data' in value)||!('checksum' in value)||typeof value.checksum!=='string')throw new Error('storage_checksum_mismatch');
  return {data:value.data,checksum:value.checksum};
}

/** @param {{name?:string,operationSchema?:import('./storage-operation.js').StorageOperationSchema}} [options] */
export function createStorageJournalDb({name='netunim-storage-v2',operationSchema}={}){
  // Generic journal consumers may configure a schema; application namespaces
  // always use their fixed business schema. Capture configuration once.
  const configuredSchema=operationSchema&&structuredClone(operationSchema);
  const stores=['checkpoints','journal','metadata','bases','flights','controls'];
  const open=createIndexedDbConnection(name,10,db=>{
    for(const name of stores)if(!db.objectStoreNames.contains(name)){const store=db.createObjectStore(name);if(name==='journal')store.createIndex('owner','data.owner')}
    if(!db.objectStoreNames.contains('boundaries'))db.createObjectStore('boundaries');
    if(!db.objectStoreNames.contains('cutovers'))db.createObjectStore('cutovers');
    if(!db.objectStoreNames.contains('owner-bindings'))db.createObjectStore('owner-bindings');
    if(!db.objectStoreNames.contains('owner-handoffs'))db.createObjectStore('owner-handoffs');
    if(!db.objectStoreNames.contains('bootstrap-groups'))db.createObjectStore('bootstrap-groups');
    if(!db.objectStoreNames.contains('local-births'))db.createObjectStore('local-births');
    if(db.objectStoreNames.contains('cutover-preparations'))db.deleteObjectStore('cutover-preparations');
    // Fenced adoption discards obsolete V1 state and never writes quarantine
    // records. Retire the unused store during the normal schema upgrade.
    if(db.objectStoreNames.contains('legacy-recoveries'))db.deleteObjectStore('legacy-recoveries');
  });
  /** @template Result @param {string[]} names @param {IDBTransactionMode} mode @param {TransactionWork<Result>} work @param {string} [abortCode] @returns {Promise<Result>} */
  function transactStores(names,mode,work,abortCode){
    return completeIndexedDbTransaction(async()=>(await open()).transaction(names,mode),work,abortCode);
  }
  /** @template Result @param {IDBTransactionMode} mode @param {TransactionWork<Result>} work @returns {Promise<Result>} */
  function transact(mode,work){return transactStores(stores,mode,work)}
  // Every journal writer, including schema v1, keys records by
  // [owner, epoch, seq]. Select that physical namespace before decoding the
  // payload: the mutable data.owner index cannot prove presence or ownership.
  // String epochs sort below the array sentinel; adjacent owner prefixes do
  // not enter this range. Keep the historical index/schema without migrating.
  /** @param {IDBTransaction} tx @param {string} owner @returns {IDBRequest<unknown[]>} */
  function readJournal(tx,owner){return tx.objectStore('journal').getAll(IDBKeyRange.bound([owner],[owner,[]],false,true))}
  /** @param {IDBTransaction} tx @param {string} owner @param {(snapshot:Snapshot)=>undefined} done @param {(cause:unknown)=>undefined} fail @param {{retirement?:boolean}} [options] @returns {undefined} */
  function read(tx,owner,done,fail,{retirement=false}={}){
    /** @type {Snapshot} */
    const result={checkpoints:null,metadata:null,bases:null,flights:null,controls:null,journal:[]};
    const names=['checkpoints','metadata','bases','flights','controls','journal',...(retirement?['journalKeys']:[])];let pending=names.length;
    for(const name of names){
      const request=name==='journal'?readJournal(tx,owner):name==='journalKeys'?tx.objectStore('journal').getAllKeys(IDBKeyRange.bound([owner],[owner,[]],false,true)):tx.objectStore(name).get(owner);
      request.onsuccess=()=>{try{
        /** @type {unknown} */ const value=request.result;
        if(name==='metadata')result.metadata=readMetadata(value);
        else if(name==='journal'){
          if(!Array.isArray(value))throw new Error('storage_journal_invalid');result.journal=value;
        }else if(name==='journalKeys')result.journalKeys=value;
        else if(name==='checkpoints'||name==='bases'||name==='flights'||name==='controls')result[name]=readEnvelope(value);
        if(!--pending)done(result);
      }catch(error){fail(error)}};
    }
  }
  /** @type {Db['load']} */
  function load(owner){return transact('readonly',(tx,done,fail)=>read(tx,owner,done,fail))}
  /** @template Result @param {string} owner @param {(tx:IDBTransaction,current:EditableSnapshot,done:(value:Result)=>undefined)=>undefined} edit @returns {Promise<Result>} */
  function change(owner,edit){return transact('readwrite',(tx,done,fail)=>read(tx,owner,current=>{const journalKeys=readStorageJournalDeletionKeys(current.journal,current.journalKeys,owner);edit(tx,{...current,journalKeys},done)},fail,{retirement:true}))}
  /** @template {Pick<Snapshot,'metadata'> & Partial<Snapshot>} Current @param {Current} current @param {string} owner @param {string} epoch @param {string} writer @returns {asserts current is Current & {metadata:Metadata}} */
  function assertFence(current,owner,epoch,writer){
    if(current.metadata?.epoch!==epoch||current.metadata?.writer!==writer)throw new Error('storage_writer_fenced');
    // Full-head transactions validate inside the same read/write transaction.
    // Append keeps its two-record hot path; it neither ACKs nor clears a head.
    if(Object.hasOwn(current,'bases'))readStorageCloudHead({base:current.bases,flight:current.flights,control:current.controls},{owner,epoch,seq:current.metadata.seq});
  }
  /** @type {Db['install']} */
  async function install(owner,checkpoint,writer,{expectedEpoch=null}={}){checkpoint=captureStorageCheckpoint(checkpoint);return change(owner,(tx,current,done)=>{
    const data=readStorageCheckpoint(checkpoint);
    assertStorageJournalInstall(owner,data,current.metadata?.epoch??null,expectedEpoch,Boolean(current.flights));
    tx.objectStore('checkpoints').put(checkpoint,owner);tx.objectStore('metadata').put({epoch:data.epoch,seq:data.seq,writer},owner);
    for(const key of current.journalKeys)tx.objectStore('journal').delete(key);
    // New epochs never inherit an old cloud cursor, flight or control state implicitly.
    tx.objectStore('bases').delete(owner);tx.objectStore('flights').delete(owner);tx.objectStore('controls').delete(owner);done(true);
  })}
  /** @type {Db['claim']} */
  function claim(owner,epoch,writer){return change(owner,(tx,current,done)=>{if(current.metadata?.epoch!==epoch)throw new Error('storage_epoch_changed');readStorageCloudHead({base:current.bases,flight:current.flights,control:current.controls},{owner,epoch,seq:current.metadata.seq});tx.objectStore('metadata').put({...current.metadata,writer},owner);done(true)})}
  /** @type {Db['initializeCloudHead']} */
  async function initializeCloudHead(owner,checkpoint,base,writer,operation=null){
    checkpoint=captureStorageCheckpoint(checkpoint);
    base=captureStorageCloudBase(base);
    if(operation!==null)operation=captureStorageJournalOperation(operation,owner,checkpoint.data.epoch,configuredSchema);
    return change(owner,(tx,current,done)=>{
    // Initialization is create-only. It cannot erase a previous owner's work,
    // a shadow namespace or an interrupted upload on retry.
    if(current.checkpoints||current.metadata||current.bases||current.flights||current.controls||current.journal.length)throw new Error('storage_initialization_exists');
    const head=readStorageCheckpoint(checkpoint),cursor=readStorageCloudBase(base),entry=operation&&structuredClone(operation.data);
    assertStorageJournalInitialization(owner,head,cursor,entry);readStorageCloudBase(base);
    tx.objectStore('checkpoints').put(checkpoint,owner);tx.objectStore('bases').put(base,owner);
    if(entry)tx.objectStore('journal').put(operation,[owner,head.epoch,1]);
    tx.objectStore('metadata').put({epoch:head.epoch,seq:entry?1:0,writer},owner);done(true);
  })}
  /** @type {Db['append']} */
  async function append(owner,epoch,writer,record){
    record=captureStorageJournalOperation(record,owner,epoch,configuredSchema);
    return transact('readwrite',(tx,done,fail)=>{
    // The hot path reads two small records, never the checkpoint or full journal.
    const operation=structuredClone(record.data),key=[owner,epoch,operation.seq],metadata=tx.objectStore('metadata').get(owner),existing=tx.objectStore('journal').get(key);let remaining=2;
    const finish=()=>{if(--remaining)return;try{
      const current={metadata:readMetadata(metadata.result)};assertFence(current,owner,epoch,writer);
      if(operation.owner!==owner||operation.epoch!==epoch)throw new Error('storage_owner_mismatch');
      if(existing.result){if(JSON.stringify(existing.result)!==JSON.stringify(record))throw new Error('storage_retry_payload_changed');done(true);return}
      if(operation.seq!==current.metadata.seq+1)throw new Error('storage_append_gap');
      tx.objectStore('journal').put(record,key);tx.objectStore('metadata').put({...current.metadata,seq:operation.seq},owner);done(true);
    }catch(error){fail(error)}};
    metadata.onsuccess=finish;existing.onsuccess=finish;
  })}
  /** @type {Db['compact']} */
  async function compact(owner,epoch,writer,checkpoint){checkpoint=captureStorageCheckpoint(checkpoint);return change(owner,(tx,current,done)=>{
    assertFence(current,owner,epoch,writer);const data=readStorageCheckpoint(checkpoint),prior=readStorageCheckpoint(current.checkpoints);
    const base=current.bases?readStorageCloudBase(current.bases):null;
    const deleteThrough=storageJournalCompactionThrough({owner,epoch,seq:current.metadata.seq},data,prior.seq,base?base.ackSeq:null);
    tx.objectStore('checkpoints').put(checkpoint,owner);
    // Operations newer than the durable cloud cursor remain available even when
    // their state is already represented by a local checkpoint. This preserves
    // explicit deletes and audit metadata until the cloud has acknowledged them.
    for(const key of current.journalKeys)if(key[1]===epoch&&key[2]<=deleteThrough)tx.objectStore('journal').delete(key);done(true);
  })}
  /** @type {Db['replaceCheckpoint']} */
  async function replaceCheckpoint(owner,epoch,writer,checkpoint){checkpoint=captureStorageCheckpoint(checkpoint);return change(owner,(tx,current,done)=>{
    assertFence(current,owner,epoch,writer);const data=readStorageCheckpoint(checkpoint);
    assertStorageJournalReplacement({owner,epoch,seq:current.metadata.seq},data);
    // This is a same-epoch authoritative rebase. Cloud cursor/flight and the
    // unacknowledged journal stay intact; replay starts from the new current head.
    tx.objectStore('checkpoints').put(checkpoint,owner);done(true);
  })}
  /** @type {Db['replaceLocalCheckpoint']} */
  async function replaceLocalCheckpoint(owner,epoch,writer,checkpoint,expectedSeq){checkpoint=captureStorageCheckpoint(checkpoint);return change(owner,(tx,current,done)=>{
    assertFence(current,owner,epoch,writer);const data=readStorageCheckpoint(checkpoint);
    assertStorageJournalLocalReplacement({owner,epoch,seq:current.metadata.seq},data,expectedSeq,
      Boolean(current.bases||current.flights||current.controls));
    // A local authoritative import supersedes every prior operation. With no
    // cloud cursor there are no remote delete intents to retain.
    for(const key of current.journalKeys)tx.objectStore('journal').delete(key);
    tx.objectStore('checkpoints').put(checkpoint,owner);done(true);
  })}
  /** @type {Db['setBase']} */
  async function setBase(owner,epoch,writer,base){base=captureStorageCloudBase(base);
    return change(owner,(tx,current,done)=>{assertFence(current,owner,epoch,writer);if(current.flights)throw new Error('storage_flight_pending');const data=readStorageCloudBase(base);if(data.owner!==owner||data.epoch!==epoch||!Number.isSafeInteger(data.revision)||data.revision<0||!Number.isSafeInteger(data.ackSeq)||data.ackSeq<0||data.ackSeq>current.metadata.seq)throw new Error('storage_cloud_base_mismatch');readStorageCloudBase(base);tx.objectStore('bases').put(base,owner);done(true)})}
  /** @type {Db['beginFlight']} */
  async function beginFlight(owner,epoch,writer,flight){flight=captureStorageCloudFlight(flight);return change(owner,(tx,current,done)=>{
    assertFence(current,owner,epoch,writer);const data=readStorageCloudFlight(flight);
    const base=current.bases&&readStorageCloudBase(current.bases);
    assertStorageJournalFlight({owner,epoch,seq:current.metadata.seq},data,base);readStorageCloudFlight(flight);
    if(current.flights){if(JSON.stringify(current.flights)!==JSON.stringify(flight))throw new Error('storage_flight_pending');done(captureStorageCloudFlight(current.flights));return}
    tx.objectStore('flights').put(flight,owner);done(flight);
  })}
  /** @type {Db['acknowledge']} */
  async function acknowledge(owner,epoch,writer,operationId,base,{checkpoint=null,control=null}={}){
    base=captureStorageCloudBase(base);if(control!==null)control=captureStorageCloudControl(control);if(checkpoint!==null)checkpoint=captureStorageCheckpoint(checkpoint);return change(owner,(tx,current,done)=>{
    assertFence(current,owner,epoch,writer);if(!current.flights||readStorageCloudFlight(current.flights).operationId!==operationId)throw new Error('storage_ack_mismatch');
    const acknowledged=readStorageCloudBase(base),flight=readStorageCloudFlight(current.flights);
    assertStorageCloudAck(acknowledged,flight,{owner,epoch});readStorageCloudBase(base);
    if(checkpoint){const nextCheckpoint=readStorageCheckpoint(checkpoint);assertStorageJournalAckCheckpoint({owner,epoch,seq:current.metadata.seq},nextCheckpoint);tx.objectStore('checkpoints').put(checkpoint,owner)}
    if(control){const nextControl=readStorageCloudControl(control);if(nextControl.owner!==owner||nextControl.epoch!==epoch)throw new Error('storage_control_scope');readStorageCloudControl(control);tx.objectStore('controls').put(control,owner)}else tx.objectStore('controls').delete(owner);
    tx.objectStore('bases').put(base,owner);tx.objectStore('flights').delete(owner);done(true);
    // ACK never deletes journal entries. Only an atomic checkpoint can compact.
  })}
  /** @type {Db['rejectFlight']} */
  async function rejectFlight(owner,epoch,writer,operationId,base,{checkpoint,expectedSeq,control=null}){
    base=captureStorageCloudBase(base);if(control!==null)control=captureStorageCloudControl(control);checkpoint=captureStorageCheckpoint(checkpoint);return change(owner,(tx,current,done)=>{
    assertFence(current,owner,epoch,writer);const flight=current.flights&&readStorageCloudFlight(current.flights),prior=current.bases&&readStorageCloudBase(current.bases),next=readStorageCloudBase(base);
    const nextCheckpoint=readStorageCheckpoint(checkpoint);
    assertStorageJournalRejection({owner,epoch,seq:current.metadata.seq},flight,prior,next,nextCheckpoint,expectedSeq,operationId);
    readStorageCloudBase(base);
    // The new cloud revision and the local state rebased onto it become
    // authoritative together. A crash cannot expose only one side.
    tx.objectStore('checkpoints').put(checkpoint,owner);tx.objectStore('bases').put(base,owner);tx.objectStore('flights').delete(owner);
    if(control){const nextControl=readStorageCloudControl(control);if(nextControl.owner!==owner||nextControl.epoch!==epoch)throw new Error('storage_control_scope');readStorageCloudControl(control);tx.objectStore('controls').put(control,owner)}else tx.objectStore('controls').delete(owner);done(true);
  })}
  /** @type {Db['setControl']} */
  async function setControl(owner,epoch,writer,control){control=captureStorageCloudControl(control);
    return change(owner,(tx,current,done)=>{assertFence(current,owner,epoch,writer);const data=readStorageCloudControl(control);if(data.owner!==owner||data.epoch!==epoch)throw new Error('storage_control_scope');readStorageCloudControl(control);tx.objectStore('controls').put(control,owner);done(true)})}
  /** @type {Db['clearControl']} */
  async function clearControl(owner,epoch,writer,{expectedHead=null}={}){expectedHead=captureStorageExpectedHead(expectedHead);return change(owner,(tx,current,done)=>{
    assertFence(current,owner,epoch,writer);
    if(expectedHead&&(current.metadata.seq!==expectedHead.seq||current.flights||current.checkpoints?.checksum!==expectedHead.checkpointChecksum||current.bases?.checksum!==expectedHead.baseChecksum||current.controls?.checksum!==expectedHead.controlChecksum))throw new Error('storage_control_head_changed');
    tx.objectStore('controls').delete(owner);done(true);
  })}
  /** @type {Db['commitCloudRecovery']} */
  async function commitCloudRecovery(owner,epoch,writer,checkpoint,{expectedHead,conflictKind=null,isCurrent=()=>true}){
    checkpoint=captureStorageCheckpoint(checkpoint);expectedHead=captureStorageRecoveryHead(expectedHead);return change(owner,(tx,current,done)=>{
    assertFence(current,owner,epoch,writer);
    if(!isCurrent())throw new Error('storage_cloud_scope_changed');
    const decoded=readStorageCloudHead({base:current.bases,flight:current.flights,control:current.controls},{owner,epoch,seq:current.metadata.seq});
    assertCloudRecoveryHead(decoded,expectedHead,conflictKind);
    if(current.checkpoints?.checksum!==expectedHead.checkpointChecksum||current.bases?.checksum!==expectedHead.baseChecksum||(current.controls?.checksum??null)!==expectedHead.controlChecksum)throw new Error('storage_cloud_recovery_stale');
    const next=readStorageCheckpoint(checkpoint);
    if(next.owner!==owner||next.epoch!==epoch||next.seq!==current.metadata.seq)throw new Error('storage_cloud_recovery_stale');
    tx.objectStore('checkpoints').put(checkpoint,owner);
    if(conflictKind==='concurrent-ack')tx.objectStore('controls').delete(owner);
    // The base/ACK, journal, physical keys and operation IDs are untouched.
    done(true);
  })}
  /** @type {Db['adoptCloudHead']} */
  async function adoptCloudHead(owner,epoch,writer,checkpoint,base,{expectedHead=null}={}){
    base=captureStorageCloudBase(base);expectedHead=captureStorageExpectedHead(expectedHead);checkpoint=captureStorageCheckpoint(checkpoint);return change(owner,(tx,current,done)=>{
    assertFence(current,owner,epoch,writer);if(current.flights)throw new Error('storage_flight_pending');
    if(expectedHead&&(current.metadata.seq!==expectedHead.seq||current.checkpoints?.checksum!==expectedHead.checkpointChecksum||current.bases?.checksum!==expectedHead.baseChecksum||(current.controls?.checksum??null)!==expectedHead.controlChecksum))throw new Error('storage_cloud_adoption_stale');
    const nextCheckpoint=readStorageCheckpoint(checkpoint),nextBase=readStorageCloudBase(base),prior=current.bases&&readStorageCloudBase(current.bases);
    assertStorageJournalAdoption({owner,epoch,seq:current.metadata.seq},nextCheckpoint,nextBase,prior,
      Boolean(current.controls&&readStorageCloudControl(current.controls).conflict));readStorageCloudBase(base);
    tx.objectStore('checkpoints').put(checkpoint,owner);tx.objectStore('bases').put(base,owner);tx.objectStore('controls').delete(owner);done(true);
  })}
  /** @type {Db['resetState']} */
  async function resetState(owner,epoch,writer,checkpoint,{expectedLocalHead=null}={}){
    expectedLocalHead=captureStorageLocalHead(expectedLocalHead);checkpoint=captureStorageCheckpoint(checkpoint);return change(owner,(tx,current,done)=>{
    assertFence(current,owner,epoch,writer);const nextCheckpoint=readStorageCheckpoint(checkpoint);
    if(expectedLocalHead&&(current.metadata.seq!==expectedLocalHead.seq||current.metadata.epoch!==expectedLocalHead.epoch||current.checkpoints?.checksum!==expectedLocalHead.checkpointChecksum||current.bases||current.flights||current.controls))throw new Error('storage_main_projection_head_changed');
    assertStorageJournalLocalReset(owner,nextCheckpoint);
    tx.objectStore('checkpoints').put(checkpoint,owner);tx.objectStore('metadata').put({epoch:nextCheckpoint.epoch,seq:0,writer},owner);
    for(const key of current.journalKeys)tx.objectStore('journal').delete(key);
    tx.objectStore('bases').delete(owner);tx.objectStore('flights').delete(owner);tx.objectStore('controls').delete(owner);done(true);
  })}
  /** @type {Db['resetCloudHead']} */
  async function resetCloudHead(owner,epoch,writer,checkpoint,base,{expectedCleanHead=null}={}){
    base=captureStorageCloudBase(base);expectedCleanHead=captureStorageCleanHead(expectedCleanHead);checkpoint=captureStorageCheckpoint(checkpoint);return change(owner,(tx,current,done)=>{
    assertFence(current,owner,epoch,writer);const nextCheckpoint=readStorageCheckpoint(checkpoint),nextBase=readStorageCloudBase(base);
    if(expectedCleanHead){const prior=current.bases&&readStorageCloudBase(current.bases);if(current.metadata.seq!==expectedCleanHead.seq||current.metadata.epoch!==expectedCleanHead.epoch||current.checkpoints?.checksum!==expectedCleanHead.checkpointChecksum||!prior||prior.revision!==expectedCleanHead.revision||prior.ackSeq!==expectedCleanHead.seq||current.flights||current.controls)throw new Error('storage_main_projection_head_changed')}
    assertStorageJournalCloudReset(owner,nextCheckpoint,nextBase);readStorageCloudBase(base);
    tx.objectStore('checkpoints').put(checkpoint,owner);tx.objectStore('metadata').put({epoch:nextCheckpoint.epoch,seq:0,writer},owner);
    for(const key of current.journalKeys)tx.objectStore('journal').delete(key);
    tx.objectStore('bases').put(base,owner);tx.objectStore('flights').delete(owner);tx.objectStore('controls').delete(owner);done(true);
  })}
  /** @type {Db['appendBoundary']} */
  async function appendBoundary(owner,epoch,writer,record,{expectedSeq,expectedBaseRevision}){
    record=captureStorageJournalOperation(record,owner,epoch,configuredSchema);
    return change(owner,(tx,current,done)=>{
    assertFence(current,owner,epoch,writer);
    const base=current.bases&&readStorageCloudBase(current.bases),operation=structuredClone(record.data);
    if(!base||base.owner!==owner||base.epoch!==epoch||base.revision!==expectedBaseRevision||base.ackSeq!==expectedSeq||current.metadata.seq!==expectedSeq||current.flights||current.controls)throw new Error('storage_boundary_cloud_changed');
    if(operation.owner!==owner||operation.epoch!==epoch||operation.seq!==expectedSeq+1||operation.appMetadata?.boundaryId==null)throw new Error('storage_boundary_operation_invalid');
    tx.objectStore('journal').put(record,[owner,epoch,operation.seq]);
    tx.objectStore('metadata').put({...current.metadata,seq:operation.seq},owner);
    done(true);
  })}
  /** @template Result @param {(store:IDBObjectStore,done:(value:Result)=>undefined,fail:(cause:unknown)=>undefined)=>undefined} work @returns {Promise<Result>} */
  function boundaryTransaction(work){return transactStores(['boundaries'],'readwrite',(tx,done,fail)=>{
    work(tx.objectStore('boundaries'),done,fail);
  },'storage_boundary_aborted')}
  /** @param {string} name @param {string} key @returns {Promise<State|null>} */
  function readTransition(name,key){return transactStores([name],'readonly',(tx,done,fail)=>{
    const request=tx.objectStore(name).get(key);
    request.onsuccess=()=>{try{done(request.result?readJournalObject(request.result):null)}catch(error){fail(error)}};
  })}
  /** @type {Db['readBoundary']} */
  function readBoundary(owner){return readTransition('boundaries',owner)}
  /** @type {Db['beginBoundary']} */
  async function beginBoundary(owner,record){record=captureStorageJournalPayload(record);return boundaryTransaction((store,done,fail)=>{
    const request=store.get(owner);request.onsuccess=()=>{try{
      if(request.result){const prior=readJournalObject(request.result);if(prior.id===record.id&&prior.phase==='complete'){done(prior);return}if(prior.phase!=='complete')throw new Error('storage_boundary_pending')}
      if(record.owner!==owner||record.phase!=='prepared')throw new Error('storage_boundary_invalid');
      store.put(sealStorageRecord(record),owner);done(structuredClone(record));
    }catch(error){fail(error)}};
  })}
  /** @type {Db['advanceBoundary']} */
  function advanceBoundary(owner,id,fromPhase,toPhase){return boundaryTransaction((store,done,fail)=>{
    const request=store.get(owner);request.onsuccess=()=>{try{
      if(!request.result)throw new Error('storage_boundary_missing');
      const record=readJournalObject(request.result);
      if(record.id!==id||record.owner!==owner||record.phase!==fromPhase)throw new Error('storage_boundary_changed');
      /** @type {State} */ const next={...record,phase:toPhase};store.put(sealStorageRecord(next),owner);done(next);
    }catch(error){fail(error)}};
  })}
  /** @type {Db['completeBoundary']} */
  function completeBoundary(owner,id){return boundaryTransaction((store,done,fail)=>{
    const request=store.get(owner);request.onsuccess=()=>{try{
      if(!request.result)throw new Error('storage_boundary_missing');
      const record=readStorageBoundary(readStorageRecord(request.result),owner);
      if(!record||record.id!==id||record.phase!=='main-applied')throw new Error('storage_boundary_changed');
      store.put(sealStorageRecord({version:2,id,owner,kind:record.kind,phase:'complete',completedAt:new Date().toISOString()}),owner);done(true);
    }catch(error){fail(error)}};
  })}
  const {readOwnerState,readOwnerBinding,readOwnerHandoff,initializeOwnerBinding,reserveLocalOwnerTarget,adoptPreparedLocalOwner,beginOwnerHandoff,advanceOwnerHandoff,activateOwnerHandoff,completeOwnerHandoff}=createStorageOwnerTransactions({open});
  /** @type {Db['readBootstrapGroup']} */
  function readBootstrapGroup(scope){return readTransition('bootstrap-groups',scope)}
  /** @type {Db['beginBootstrapGroup']} */
  async function beginBootstrapGroup(scope,record){record=captureStorageJournalPayload(record);return transactStores(['bootstrap-groups'],'readwrite',(tx,done,fail)=>{
    const store=tx.objectStore('bootstrap-groups'),request=store.get(scope);
    request.onsuccess=()=>{try{
      const existing=request.result&&readJournalObject(request.result);
      if(existing&&existing.phase!=='complete'){
        if(existing.id===record.id&&existing.planHash===record.planHash){done(existing);return}
        throw new Error('storage_bootstrap_group_pending');
      }
      if(record.version!==2||record.scope!==scope||record.phase!=='prepared'||!String(record.id||'').trim()||!String(record.planHash||'').trim())throw new Error('storage_bootstrap_group_invalid');
      const result=structuredClone(record);store.put(sealStorageRecord(result),scope);done(result);
    }catch(cause){fail(cause)}};
  },'storage_bootstrap_group_aborted')}
  /** @type {Db['advanceBootstrapGroup']} */
  async function advanceBootstrapGroup(scope,id,fromPhase,toPhase,patch={}){patch=captureStorageJournalPayload(patch);return transactStores(['bootstrap-groups'],'readwrite',(tx,done,fail)=>{
    const store=tx.objectStore('bootstrap-groups'),request=store.get(scope);
    request.onsuccess=()=>{try{
      if(!request.result)throw new Error('storage_bootstrap_group_missing');
      const current=readJournalObject(request.result);
      if(current.id!==id||current.scope!==scope||current.phase!==fromPhase)throw new Error('storage_bootstrap_group_changed');
      const result={...current,...structuredClone(patch),phase:toPhase};store.put(sealStorageRecord(result),scope);done(result);
    }catch(cause){fail(cause)}};
  },'storage_bootstrap_group_aborted')}
  /** @type {Db['readV2Marker']} */
  function readV2Marker(scope){return open().then(db=>new Promise((resolve,reject)=>{
    const tx=db.transaction(['cutovers'],'readonly'),request=tx.objectStore('cutovers').get(scope);
    request.onsuccess=()=>{try{resolve(request.result?readJournalObject(request.result):null)}catch(error){reject(error)}};
    request.onerror=()=>reject(request.error);
  }))}
  /** @type {Db['markAccountMarker']} */
  function markAccountMarker(app,identity){
    if(!['orders','kupa'].includes(app)||!String(identity||'').trim())throw new Error('storage_cutover_scope_invalid');
    return open().then(db=>new Promise((resolve,reject)=>{
      const owner=String(identity),scope=`${app}:${owner}`,mainOwner=`${owner}:${app}`,sharedOwner=`${owner}:shared-checks`;
      const tx=db.transaction(['cutovers','checkpoints','metadata','bases','flights','controls','boundaries','bootstrap-groups'],'readwrite');
      /** @type {IDBRequest<unknown>[]} */
      const requests=[tx.objectStore('cutovers').get(scope),tx.objectStore('checkpoints').get(mainOwner),tx.objectStore('checkpoints').get(sharedOwner),tx.objectStore('metadata').get(mainOwner),tx.objectStore('metadata').get(sharedOwner),tx.objectStore('bases').get(mainOwner),tx.objectStore('bases').get(sharedOwner),tx.objectStore('flights').get(mainOwner),tx.objectStore('flights').get(sharedOwner),tx.objectStore('controls').get(mainOwner),tx.objectStore('controls').get(sharedOwner),tx.objectStore('boundaries').get(owner),tx.objectStore('bootstrap-groups').get(scope)];
      let remaining=requests.length;
      /** @type {State|null} */ let result=null;
      /** @param {unknown} error */
      const fail=error=>{try{tx.abort()}catch{}reject(error)};
      for(const request of requests)request.onsuccess=()=>{if(--remaining)return;try{
        const [current,main,shared,rawMainMeta,rawSharedMeta,mainBase,sharedBase,mainFlight,sharedFlight,mainControl,sharedControl,boundary,bootstrap]=requests.map(row=>row.result);
        if(current){result=readJournalObject(current);if(result.version!==2||result.scope!==scope)throw new Error('storage_cutover_marker_invalid');return}
        const mainMeta=readMetadata(rawMainMeta),sharedMeta=readMetadata(rawSharedMeta);
        if(!main||!shared||!mainMeta||!sharedMeta||!mainBase||!sharedBase)throw new Error('storage_cutover_head_missing');
        const mainHead=readStorageCheckpoint(main),sharedHead=readStorageCheckpoint(shared),mainCursor=readStorageCloudBase(mainBase),sharedCursor=readStorageCloudBase(sharedBase);
        if(mainHead.appMetadata?.storageRole!=='primary'||sharedHead.appMetadata?.storageRole!=='shared-checks-primary')throw new Error('storage_cutover_role_invalid');
        if(mainHead.owner!==mainOwner||sharedHead.owner!==sharedOwner||mainCursor.owner!==mainOwner||sharedCursor.owner!==sharedOwner||mainCursor.epoch!==mainHead.epoch||sharedCursor.epoch!==sharedHead.epoch)throw new Error('storage_cutover_base_invalid');
        if(mainMeta.epoch!==mainHead.epoch||sharedMeta.epoch!==sharedHead.epoch||mainMeta.seq!==mainCursor.ackSeq||sharedMeta.seq!==sharedCursor.ackSeq||mainFlight||sharedFlight||mainControl||sharedControl)throw new Error('storage_cutover_head_not_clean');
        readStorageCloudHead({base:mainBase},{owner:mainOwner,epoch:mainHead.epoch,seq:mainMeta.seq});
        readStorageCloudHead({base:sharedBase},{owner:sharedOwner,epoch:sharedHead.epoch,seq:sharedMeta.seq});
        if(boundary&&readJournalObject(boundary).phase!=='complete')throw new Error('storage_cutover_boundary_pending');
        if(bootstrap&&readJournalObject(bootstrap).phase!=='complete')throw new Error('storage_cutover_bootstrap_pending');
        result={version:2,scope,app,owner,markedAt:new Date().toISOString()};tx.objectStore('cutovers').put(sealStorageRecord(result),scope);
      }catch(error){fail(error)}};
      tx.oncomplete=()=>resolve(result);tx.onabort=()=>reject(tx.error||new Error('storage_cutover_aborted'));
    }))
  }
  /** @type {Db['readLocalBirth']} */
  function readLocalBirth(scope){return readTransition('local-births',scope)}
  /** @type {Db['beginLocalBirth']} */
  async function beginLocalBirth(scope,record){record=captureStorageJournalPayload(record);return transactStores(['local-births'],'readwrite',(tx,done,fail)=>{
    const store=tx.objectStore('local-births'),request=store.get(scope);
    request.onsuccess=()=>{try{
      if(request.result){const result=readJournalObject(request.result);if(result.id!==record.id)throw new Error('storage_local_birth_pending');done(result);return}
      if(record.scope!==scope||record.phase!=='prepared')throw new Error('storage_local_birth_invalid');
      const result=structuredClone(record);store.put(sealStorageRecord(result),scope);done(result);
    }catch(cause){fail(cause)}};
  },'storage_local_birth_aborted')}
  /** @type {Db['advanceLocalBirth']} */
  function advanceLocalBirth(scope,id,fromPhase,toPhase){return transactStores(['local-births'],'readwrite',(tx,done,fail)=>{
    const store=tx.objectStore('local-births'),request=store.get(scope);
    request.onsuccess=()=>{try{
      if(!request.result)throw new Error('storage_local_birth_missing');const current=readJournalObject(request.result);
      if(current.id!==id||current.phase!==fromPhase||current.scope!==scope)throw new Error('storage_local_birth_changed');
      /** @type {State} */ const result={...current,phase:toPhase,updatedAt:new Date().toISOString()};
      // The full source is needed only until both journals and the marker are
      // durable. Retire the duplicate snapshot after completion.
      if(toPhase==='complete'){delete result.mainState;delete result.sharedState}
      store.put(sealStorageRecord(result),scope);done(result);
    }catch(cause){fail(cause)}};
  },'storage_local_birth_aborted')}
  /** @type {Db['markLocalEngine']} */
  function markLocalEngine(app){
    if(!['orders','kupa'].includes(app))throw new Error('storage_local_engine_app_invalid');
    return open().then(db=>new Promise((resolve,reject)=>{
      const scope=`${app}:local`,mainOwner=`local:${app}`,sharedOwner='local:shared-checks',markerKey=`local-engine:${scope}`;
      const tx=db.transaction(['cutovers','local-births','owner-bindings','checkpoints','metadata','bases','flights','controls','boundaries'],'readwrite');
      /** @type {IDBRequest<unknown>[]} */
      const requests=[tx.objectStore('cutovers').get(markerKey),tx.objectStore('local-births').get(scope),tx.objectStore('owner-bindings').get(app),tx.objectStore('checkpoints').get(mainOwner),tx.objectStore('checkpoints').get(sharedOwner),tx.objectStore('metadata').get(mainOwner),tx.objectStore('metadata').get(sharedOwner),tx.objectStore('bases').get(mainOwner),tx.objectStore('bases').get(sharedOwner),tx.objectStore('flights').get(mainOwner),tx.objectStore('flights').get(sharedOwner),tx.objectStore('controls').get(mainOwner),tx.objectStore('controls').get(sharedOwner),tx.objectStore('boundaries').get('local')];
      let remaining=requests.length;
      /** @type {State|null} */ let result=null;
      /** @type {unknown} */ let error=null;
      /** @param {unknown} cause */
      const fail=cause=>{error=cause;try{tx.abort()}catch{}};
      for(const request of requests)request.onsuccess=()=>{if(--remaining)return;try{
        const [existing,birth,binding,main,shared,rawMainMeta,rawSharedMeta,mainBase,sharedBase,mainFlight,sharedFlight,mainControl,sharedControl,boundary]=requests.map(row=>row.result);
        const activeBinding=binding?readJournalObject(binding):null;
        if(!activeBinding||activeBinding.owner!=='local'||activeBinding.pendingAdoption)throw new Error('storage_local_engine_owner_changed');
        if(existing){result=readJournalObject(existing);if(result.version!==2||result.kind!=='local-engine'||result.scope!==scope)throw new Error('storage_local_engine_marker_invalid');return}
        const mainMeta=readMetadata(rawMainMeta),sharedMeta=readMetadata(rawSharedMeta);
        if(!birth||!main||!shared||!mainMeta||!sharedMeta)throw new Error('storage_local_engine_head_missing');
        const plan=readJournalObject(birth),mainHead=readStorageCheckpoint(main),sharedHead=readStorageCheckpoint(shared);
        if(typeof plan.id!=='string'||!plan.id||plan.scope!==scope||plan.phase!=='verified'||mainHead.appMetadata?.storageRole!=='primary'||sharedHead.appMetadata?.storageRole!=='shared-checks-primary')throw new Error('storage_local_engine_role_invalid');
        if(mainHead.owner!==mainOwner||sharedHead.owner!==sharedOwner||mainMeta.epoch!==mainHead.epoch||sharedMeta.epoch!==sharedHead.epoch||mainMeta.seq!==mainHead.seq||sharedMeta.seq!==sharedHead.seq)throw new Error('storage_local_engine_head_changed');
        if(mainBase||sharedBase||mainFlight||sharedFlight||mainControl||sharedControl)throw new Error('storage_local_engine_cloud_head_exists');
        if(boundary&&readJournalObject(boundary).phase!=='complete')throw new Error('storage_local_engine_boundary_pending');
        result={version:2,kind:'local-engine',scope,app,owner:'local',birthId:plan.id,markedAt:new Date().toISOString()};tx.objectStore('cutovers').put(sealStorageRecord(result),markerKey);
      }catch(cause){fail(cause)}};
      tx.oncomplete=()=>resolve(result);tx.onabort=()=>reject(error||tx.error||new Error('storage_local_engine_aborted'));tx.onerror=()=>{error??=tx.error};
    }))
  }
  /** @type {Db['readLocalEngine']} */
  function readLocalEngine(app){return readV2Marker(`local-engine:${app}:local`)}
  // An account browser without a durable V2 marker may adopt the cloud only
  // after the server has proved protocol 2 and both remote documents have been
  // validated. Install both owners and the marker in one transaction: a crash
  // can never expose Main V2 with an old Shared Checks checkpoint (or vice versa).
  /** @type {Db['adoptFencedAccount']} */
  function adoptFencedAccount(app,identity,{mainState,mainCloudState,mainRevision,sharedState,sharedRevision,sourceOwner=identity}){
    if(!['orders','kupa'].includes(app)||!String(identity||'').trim()||identity==='local'||
      ![identity,'local'].includes(sourceOwner)||!Number.isSafeInteger(mainRevision)||mainRevision<0||!Number.isSafeInteger(sharedRevision)||sharedRevision<0)
      throw new Error('storage_fenced_recovery_input_invalid');
    if(!mainState||Object.hasOwn(mainState,'checks'))throw new Error('storage_main_projection_invalid');
    const scope=`${app}:${identity}`,mainOwner=`${identity}:${app}`,sharedOwner=`${identity}:shared-checks`,stamp=new Date().toISOString();
    const heads=[
      {owner:mainOwner,role:'primary',state:mainState,cloud:mainCloudState,revision:mainRevision},
      {owner:sharedOwner,role:'shared-checks-primary',state:sharedState,cloud:sharedState,revision:sharedRevision},
    ].map(side=>{
      const epoch=globalThis.crypto?.randomUUID?.();if(!epoch)throw new Error('storage_fenced_recovery_epoch_unavailable');
      return {...side,epoch,checkpoint:sealStorageRecord(createStorageCheckpoint({owner:side.owner,epoch,seq:0,state:side.state,appMetadata:{storageRole:side.role,migrationIntent:'cloud-authoritative',sourceOwner:identity,targetOwner:identity,...(side.role==='primary'?{mainProjectionVersion:2}:{})},savedAt:stamp}),{kind:'checkpoint'}),
        base:sealStorageRecord(createStorageCloudBase({owner:side.owner,epoch,revision:side.revision,state:side.cloud,ackSeq:0}),{kind:'cloud-base'})};
    });
    return open().then(db=>new Promise((resolve,reject)=>{
      const names=['cutovers','owner-bindings','owner-handoffs','bootstrap-groups','local-births','boundaries',...stores];
      const tx=db.transaction(names,'readwrite');
      /** @type {State|null} */ let result=null;
      /** @type {unknown} */ let error=null;
      /** @type {Record<string,IDBRequest<unknown>|IDBRequest<unknown[]>>} */
      const requests={marker:tx.objectStore('cutovers').get(scope),binding:tx.objectStore('owner-bindings').get(app),handoff:tx.objectStore('owner-handoffs').get(app),
        bootstrap:tx.objectStore('bootstrap-groups').get(scope),boundary:tx.objectStore('boundaries').get(identity)};
      if(sourceOwner==='local'){
        requests.localMarker=tx.objectStore('cutovers').get(`local-engine:${app}:local`);
        requests.localBirth=tx.objectStore('local-births').get(`${app}:local`);
        requests.localBoundary=tx.objectStore('boundaries').get('local');
        for(const name of stores){
          requests[`local:${name}`]=name==='journal'?readJournal(tx,`local:${app}`):tx.objectStore(name).get(`local:${app}`);
          requests[`local-shared:${name}`]=name==='journal'?readJournal(tx,'local:shared-checks'):tx.objectStore(name).get('local:shared-checks');
        }
      }
      for(const side of heads){
        const key=side.role==='primary'?'main':'shared';
        for(const name of stores)requests[`${key}:${name}`]=name==='journal'?readJournal(tx,side.owner):tx.objectStore(name).get(side.owner);
      }
      let remaining=Object.keys(requests).length;
      /** @param {unknown} cause */
      const fail=cause=>{error=cause;try{tx.abort()}catch{reject(cause)}};
      for(const request of Object.values(requests))request.onsuccess=()=>{if(--remaining)return;try{
        if(requests.marker?.result)throw new Error('storage_fenced_recovery_marker_exists');
        const rawBinding=requests.binding?.result,binding=rawBinding?readJournalObject(rawBinding):null;
        if(!binding||binding.owner!==sourceOwner||binding.pendingAdoption)throw new Error('storage_fenced_recovery_owner_changed');
        if(sourceOwner==='local'){
          if(requests.localMarker?.result||requests.localBirth?.result||requests.localBoundary?.result||
            Object.entries(requests).some(([key,request])=>(key.startsWith('local:')||key.startsWith('local-shared:'))&&
              (Array.isArray(request.result)?request.result.length>0:!!request.result)))throw new Error('storage_fenced_recovery_existing_local_v2');
        }
        for(const name of ['handoff','bootstrap','boundary']){
          const raw=requests[name]?.result,record=raw?readJournalObject(raw):null;
          if(record&&record.phase!=='complete')throw new Error('storage_fenced_recovery_transition_pending');
        }
        for(const side of heads){
          const key=side.role==='primary'?'main':'shared',checkpoint=requests[`${key}:checkpoints`]?.result;
          const prior=checkpoint?readStorageCheckpoint(checkpoint):null,expected=historicalShadowRoleForSide(key);
          // Never replace an unfinished V2 primary, pending flight or control.
          // Only an old shadow copy (or no V2 data) may be superseded by cloud.
          const metadata=readMetadata(requests[`${key}:metadata`]?.result),rawEntries=requests[`${key}:journal`]?.result;
          if(!Array.isArray(rawEntries))throw new Error('storage_journal_invalid');
          const entries=rawEntries;
          if(prior&&(prior.appMetadata?.storageRole!==expected||!metadata||metadata.epoch!==prior.epoch)||
            !prior&&(metadata||entries.length)||requests[`${key}:bases`]?.result||requests[`${key}:flights`]?.result||requests[`${key}:controls`]?.result)throw new Error('storage_fenced_recovery_existing_v2_head');
          for(const entry of entries){const operation=readJournalObject(entry);if(typeof operation.epoch!=='string'||typeof operation.seq!=='number')throw new Error('storage_journal_key_mismatch');tx.objectStore('journal').delete([side.owner,operation.epoch,operation.seq])}
          tx.objectStore('checkpoints').put(side.checkpoint,side.owner);
          tx.objectStore('bases').put(side.base,side.owner);
          tx.objectStore('metadata').put({epoch:side.epoch,seq:0,writer:'fenced-recovery'},side.owner);
        }
        result={version:2,scope,app,owner:identity,markedAt:stamp};
        tx.objectStore('cutovers').put(sealStorageRecord(result),scope);
        if(sourceOwner==='local')tx.objectStore('owner-bindings').put(sealStorageRecord({...binding,owner:identity,generation:Number(binding.generation||0)+1,
          source:'fenced-cloud-authoritative',updatedAt:stamp}),app);
      }catch(cause){fail(cause)}};
      tx.oncomplete=()=>resolve(result);tx.onabort=()=>reject(error||tx.error||new Error('storage_fenced_recovery_aborted'));tx.onerror=()=>{error??=tx.error};
    }))
  }
  return {load,install,initializeCloudHead,claim,append,compact,appendBoundary,replaceCheckpoint,replaceLocalCheckpoint,setBase,beginFlight,acknowledge,rejectFlight,setControl,clearControl,commitCloudRecovery,adoptCloudHead,resetState,resetCloudHead,readBoundary,beginBoundary,advanceBoundary,completeBoundary,readOwnerState,readOwnerBinding,readOwnerHandoff,initializeOwnerBinding,reserveLocalOwnerTarget,adoptPreparedLocalOwner,beginOwnerHandoff,advanceOwnerHandoff,activateOwnerHandoff,completeOwnerHandoff,readBootstrapGroup,beginBootstrapGroup,advanceBootstrapGroup,readV2Marker,markAccountMarker,readLocalBirth,beginLocalBirth,advanceLocalBirth,markLocalEngine,readLocalEngine,adoptFencedAccount};
}
