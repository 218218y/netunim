import {createIndexedDbConnection} from './indexed-db-connection.js';
import {readStorageRecord} from './storage-journal-model.js';

export function createStorageJournalDb({name='netunim-storage-v2'}={}){
  const stores=['checkpoints','journal','metadata','bases','flights'];
  const open=createIndexedDbConnection(name,1,db=>{for(const name of stores){const store=db.createObjectStore(name);if(name==='journal')store.createIndex('owner','data.owner')}});
  async function transact(mode,work){const db=await open();return new Promise((resolve,reject)=>{
    const tx=db.transaction(stores,mode);let result,error;
    const fail=cause=>{error=cause;try{tx.abort()}catch{reject(cause)}};
    try{work(tx,value=>{result=value},fail)}catch(cause){fail(cause)}
    tx.oncomplete=()=>resolve(result);tx.onabort=()=>reject(error||tx.error||new Error('storage_transaction_aborted'));tx.onerror=()=>{error??=tx.error};
  })}
  function read(tx,owner,done,fail){
    const result={},names=['checkpoints','metadata','bases','flights','journal'];let pending=names.length;
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
    // New epochs never inherit an old cloud flight or base implicitly.
    tx.objectStore('bases').delete(owner);tx.objectStore('flights').delete(owner);done(true);
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
  function setBase(owner,epoch,writer,base){return change(owner,(tx,current,done)=>{assertFence(current,epoch,writer);if(current.flights)throw new Error('storage_flight_pending');tx.objectStore('bases').put(base,owner);done(true)})}
  function beginFlight(owner,epoch,writer,flight){return change(owner,(tx,current,done)=>{
    assertFence(current,epoch,writer);const data=readStorageRecord(flight);
    const base=current.bases&&readStorageRecord(current.bases);
    if(data.owner!==owner||data.epoch!==epoch||data.endSeq>current.metadata.seq||!base||data.baseRevision!==base.revision||data.startSeq!==base.ackSeq+1||data.endSeq<base.ackSeq)throw new Error('storage_flight_range');
    if(current.flights){if(JSON.stringify(current.flights)!==JSON.stringify(flight))throw new Error('storage_flight_pending');done(current.flights);return}
    tx.objectStore('flights').put(flight,owner);done(flight);
  })}
  function acknowledge(owner,epoch,writer,operationId,base){return change(owner,(tx,current,done)=>{
    assertFence(current,epoch,writer);if(!current.flights||readStorageRecord(current.flights).operationId!==operationId)throw new Error('storage_ack_mismatch');
    const acknowledged=readStorageRecord(base),flight=readStorageRecord(current.flights);
    if(!Number.isSafeInteger(acknowledged.revision)||acknowledged.revision<=flight.baseRevision||acknowledged.ackSeq!==flight.endSeq)throw new Error('storage_ack_revision');
    tx.objectStore('bases').put(base,owner);tx.objectStore('flights').delete(owner);done(true);
    // ACK never deletes journal entries. Only an atomic checkpoint can compact.
  })}
  return {load,install,claim,append,compact,setBase,beginFlight,acknowledge};
}
