import {createIndexedDbConnection} from './indexed-db-connection.js';
import {readStorageRecord} from './storage-journal-model.js';

export function createStorageJournalDb({name='netunim-storage-v2'}={}){
  const stores=['checkpoints','journal','metadata','bases','flights','controls'];
  const open=createIndexedDbConnection(name,2,db=>{
    for(const name of stores)if(!db.objectStoreNames.contains(name)){const store=db.createObjectStore(name);if(name==='journal')store.createIndex('owner','data.owner')}
  });
  async function transact(mode,work){const db=await open();return new Promise((resolve,reject)=>{
    const tx=db.transaction(stores,mode);let result,error;
    const fail=cause=>{error=cause;try{tx.abort()}catch{reject(cause)}};
    try{work(tx,value=>{result=value},fail)}catch(cause){fail(cause)}
    tx.oncomplete=()=>resolve(result);tx.onabort=()=>reject(error||tx.error||new Error('storage_transaction_aborted'));tx.onerror=()=>{error??=tx.error};
  })}
  function read(tx,owner,done,fail){
    const result={},names=['checkpoints','metadata','bases','flights','controls','journal'];let pending=names.length;
    for(const name of names){const request=name==='journal'?tx.objectStore(name).index('owner').getAll(owner):tx.objectStore(name).get(owner);request.onsuccess=()=>{result[name]=request.result??(name==='journal'?[]:null);if(!--pending){try{done(result)}catch(error){fail(error)}}}}
  }
  function load(owner){return transact('readonly',(tx,done,fail)=>read(tx,owner,done,fail))}
  function change(owner,edit){return transact('readwrite',(tx,done,fail)=>read(tx,owner,current=>{edit(tx,current,done)},fail))}
  function assertFence(current,epoch,writer){if(current.metadata?.epoch!==epoch||current.metadata?.writer!==writer)throw new Error('storage_writer_fenced')}
  function install(owner,checkpoint,writer,{expectedEpoch=null}={}){return change(owner,(tx,current,done)=>{
    if((current.metadata?.epoch??null)!==expectedEpoch)throw new Error('storage_checkpoint_race');
    if(current.flights)throw new Error('storage_restore_flight_pending');
    const data=readStorageRecord(checkpoint);if(data.owner!==owner)throw new Error('storage_owner_mismatch');
    tx.objectStore('checkpoints').put(checkpoint,owner);tx.objectStore('metadata').put({epoch:data.epoch,seq:data.seq,writer},owner);
    for(const record of current.journal)tx.objectStore('journal').delete([owner,record.data.epoch,record.data.seq]);
    // New epochs never inherit an old cloud cursor, flight or control state implicitly.
    tx.objectStore('bases').delete(owner);tx.objectStore('flights').delete(owner);tx.objectStore('controls').delete(owner);done(true);
  })}
  function claim(owner,epoch,writer){return change(owner,(tx,current,done)=>{if(current.metadata?.epoch!==epoch)throw new Error('storage_epoch_changed');tx.objectStore('metadata').put({...current.metadata,writer},owner);done(true)})}
  function append(owner,epoch,writer,record){return transact('readwrite',(tx,done,fail)=>{
    // The hot path reads two small records, never the checkpoint or full journal.
    const operation=readStorageRecord(record),key=[owner,epoch,operation.seq],metadata=tx.objectStore('metadata').get(owner),existing=tx.objectStore('journal').get(key);let remaining=2;
    const finish=()=>{if(--remaining)return;try{
      assertFence({metadata:metadata.result},epoch,writer);
      if(operation.owner!==owner||operation.epoch!==epoch)throw new Error('storage_owner_mismatch');
      if(existing.result){if(JSON.stringify(existing.result)!==JSON.stringify(record))throw new Error('storage_retry_payload_changed');done(true);return}
      if(operation.seq!==metadata.result.seq+1)throw new Error('storage_append_gap');
      tx.objectStore('journal').put(record,key);tx.objectStore('metadata').put({...metadata.result,seq:operation.seq},owner);done(true);
    }catch(error){fail(error)}};
    metadata.onsuccess=finish;existing.onsuccess=finish;
  })}
  function compact(owner,epoch,writer,checkpoint){return change(owner,(tx,current,done)=>{
    assertFence(current,epoch,writer);const data=readStorageRecord(checkpoint),prior=readStorageRecord(current.checkpoints);
    if(data.owner!==owner||data.epoch!==epoch||data.seq<prior.seq||data.seq>current.metadata.seq)throw new Error('storage_compaction_range');
    tx.objectStore('checkpoints').put(checkpoint,owner);
    // Operations newer than the durable cloud cursor remain available even when
    // their state is already represented by a local checkpoint. This preserves
    // explicit deletes and audit metadata until the cloud has acknowledged them.
    const base=current.bases?readStorageRecord(current.bases):null,deleteThrough=base?Math.min(data.seq,Number(base.ackSeq||0)):data.seq;
    for(const row of current.journal)if(row.data.epoch===epoch&&row.data.seq<=deleteThrough)tx.objectStore('journal').delete([owner,epoch,row.data.seq]);done(true);
  })}
  function replaceCheckpoint(owner,epoch,writer,checkpoint){return change(owner,(tx,current,done)=>{
    assertFence(current,epoch,writer);const data=readStorageRecord(checkpoint);
    if(data.owner!==owner||data.epoch!==epoch||data.seq!==current.metadata.seq)throw new Error('storage_checkpoint_stale');
    // This is a same-epoch authoritative rebase. Cloud cursor/flight and the
    // unacknowledged journal stay intact; replay starts from the new current head.
    tx.objectStore('checkpoints').put(checkpoint,owner);done(true);
  })}
  function setBase(owner,epoch,writer,base){return change(owner,(tx,current,done)=>{assertFence(current,epoch,writer);if(current.flights)throw new Error('storage_flight_pending');const data=readStorageRecord(base);if(data.owner!==owner||data.epoch!==epoch||!Number.isSafeInteger(data.revision)||data.revision<0||!Number.isSafeInteger(data.ackSeq)||data.ackSeq<0||data.ackSeq>current.metadata.seq)throw new Error('storage_cloud_base_mismatch');tx.objectStore('bases').put(base,owner);done(true)})}
  function beginFlight(owner,epoch,writer,flight){return change(owner,(tx,current,done)=>{
    assertFence(current,epoch,writer);const data=readStorageRecord(flight);
    const base=current.bases&&readStorageRecord(current.bases);
    if(data.owner!==owner||data.epoch!==epoch||data.endSeq>current.metadata.seq||!base||data.baseRevision!==base.revision||data.startSeq!==base.ackSeq+1||data.endSeq<data.startSeq)throw new Error('storage_flight_range');
    if(current.flights){if(JSON.stringify(current.flights)!==JSON.stringify(flight))throw new Error('storage_flight_pending');done(current.flights);return}
    tx.objectStore('flights').put(flight,owner);done(flight);
  })}
  function acknowledge(owner,epoch,writer,operationId,base,{checkpoint=null,control=null}={}){return change(owner,(tx,current,done)=>{
    assertFence(current,epoch,writer);if(!current.flights||readStorageRecord(current.flights).operationId!==operationId)throw new Error('storage_ack_mismatch');
    const acknowledged=readStorageRecord(base),flight=readStorageRecord(current.flights);
    if(acknowledged.owner!==owner||acknowledged.epoch!==epoch||!Number.isSafeInteger(acknowledged.revision)||acknowledged.revision<=flight.baseRevision||acknowledged.ackSeq!==flight.endSeq)throw new Error('storage_ack_revision');
    if(checkpoint){const nextCheckpoint=readStorageRecord(checkpoint);if(nextCheckpoint.owner!==owner||nextCheckpoint.epoch!==epoch||nextCheckpoint.seq!==current.metadata.seq)throw new Error('storage_checkpoint_stale');tx.objectStore('checkpoints').put(checkpoint,owner)}
    if(control){const nextControl=readStorageRecord(control);if(nextControl.owner!==owner||nextControl.epoch!==epoch)throw new Error('storage_control_scope');tx.objectStore('controls').put(control,owner)}else tx.objectStore('controls').delete(owner);
    tx.objectStore('bases').put(base,owner);tx.objectStore('flights').delete(owner);done(true);
    // ACK never deletes journal entries. Only an atomic checkpoint can compact.
  })}
  function rejectFlight(owner,epoch,writer,operationId,base,control=null){return change(owner,(tx,current,done)=>{
    assertFence(current,epoch,writer);const flight=current.flights&&readStorageRecord(current.flights),prior=current.bases&&readStorageRecord(current.bases),next=readStorageRecord(base);
    if(!flight||flight.operationId!==operationId)throw new Error('storage_reject_mismatch');
    if(!prior||next.owner!==owner||next.epoch!==epoch||next.ackSeq!==prior.ackSeq||next.revision<=flight.baseRevision)throw new Error('storage_rebase_cursor');
    tx.objectStore('bases').put(base,owner);tx.objectStore('flights').delete(owner);
    if(control){const nextControl=readStorageRecord(control);if(nextControl.owner!==owner||nextControl.epoch!==epoch)throw new Error('storage_control_scope');tx.objectStore('controls').put(control,owner)}else tx.objectStore('controls').delete(owner);done(true);
  })}
  function setControl(owner,epoch,writer,control){return change(owner,(tx,current,done)=>{assertFence(current,epoch,writer);const data=readStorageRecord(control);if(data.owner!==owner||data.epoch!==epoch)throw new Error('storage_control_scope');tx.objectStore('controls').put(control,owner);done(true)})}
  function clearControl(owner,epoch,writer){return change(owner,(tx,current,done)=>{assertFence(current,epoch,writer);tx.objectStore('controls').delete(owner);done(true)})}
  function adoptCloudHead(owner,epoch,writer,checkpoint,base){return change(owner,(tx,current,done)=>{
    assertFence(current,epoch,writer);if(current.flights)throw new Error('storage_flight_pending');
    const nextCheckpoint=readStorageRecord(checkpoint),nextBase=readStorageRecord(base),prior=current.bases&&readStorageRecord(current.bases);
    if(!prior||prior.ackSeq!==current.metadata.seq)throw new Error('storage_cloud_pending');
    if(nextCheckpoint.owner!==owner||nextCheckpoint.epoch!==epoch||nextCheckpoint.seq!==current.metadata.seq)throw new Error('storage_checkpoint_stale');
    if(nextBase.owner!==owner||nextBase.epoch!==epoch||nextBase.ackSeq!==current.metadata.seq||!Number.isSafeInteger(nextBase.revision)||nextBase.revision<prior.revision)throw new Error('storage_cloud_base_mismatch');
    tx.objectStore('checkpoints').put(checkpoint,owner);tx.objectStore('bases').put(base,owner);tx.objectStore('controls').delete(owner);done(true);
  })}
  function resetCloudHead(owner,epoch,writer,checkpoint,base){return change(owner,(tx,current,done)=>{
    assertFence(current,epoch,writer);const nextCheckpoint=readStorageRecord(checkpoint),nextBase=readStorageRecord(base);
    if(nextCheckpoint.owner!==owner||nextBase.owner!==owner||nextCheckpoint.epoch!==nextBase.epoch||nextCheckpoint.seq!==0||nextBase.ackSeq!==0||!Number.isSafeInteger(nextBase.revision)||nextBase.revision<0)throw new Error('storage_cloud_reset_invalid');
    tx.objectStore('checkpoints').put(checkpoint,owner);tx.objectStore('metadata').put({epoch:nextCheckpoint.epoch,seq:0,writer},owner);
    for(const record of current.journal)tx.objectStore('journal').delete([owner,record.data.epoch,record.data.seq]);
    tx.objectStore('bases').put(base,owner);tx.objectStore('flights').delete(owner);tx.objectStore('controls').delete(owner);done(true);
  })}
  return {load,install,claim,append,compact,replaceCheckpoint,setBase,beginFlight,acknowledge,rejectFlight,setControl,clearControl,adoptCloudHead,resetCloudHead};
}
