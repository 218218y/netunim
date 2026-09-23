import {createIndexedDbConnection} from './indexed-db-connection.js';
import {readStorageRecord,sealStorageRecord} from './storage-journal-model.js';

export function createStorageJournalDb({name='netunim-storage-v2'}={}){
  const stores=['checkpoints','journal','metadata','bases','flights','controls'];
  const open=createIndexedDbConnection(name,4,db=>{
    for(const name of stores)if(!db.objectStoreNames.contains(name)){const store=db.createObjectStore(name);if(name==='journal')store.createIndex('owner','data.owner')}
    if(!db.objectStoreNames.contains('boundaries'))db.createObjectStore('boundaries');
    if(!db.objectStoreNames.contains('cutovers'))db.createObjectStore('cutovers');
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
  function initializeCloudHead(owner,checkpoint,base,writer,operation=null){return change(owner,(tx,current,done)=>{
    // Initialization is create-only. It cannot erase a previous owner's work,
    // a shadow namespace or an interrupted upload on retry.
    if(current.checkpoints||current.metadata||current.bases||current.flights||current.controls||current.journal.length)throw new Error('storage_initialization_exists');
    const head=readStorageRecord(checkpoint),cursor=readStorageRecord(base),entry=operation&&readStorageRecord(operation);
    if(head.owner!==owner||cursor.owner!==owner||head.epoch!==cursor.epoch||head.seq!==0||cursor.ackSeq!==0||!Number.isSafeInteger(cursor.revision)||cursor.revision<0)throw new Error('storage_initialization_invalid');
    if(entry&&(entry.owner!==owner||entry.epoch!==head.epoch||entry.seq!==1))throw new Error('storage_initialization_invalid');
    tx.objectStore('checkpoints').put(checkpoint,owner);tx.objectStore('bases').put(base,owner);
    if(entry)tx.objectStore('journal').put(operation,[owner,head.epoch,1]);
    tx.objectStore('metadata').put({epoch:head.epoch,seq:entry?1:0,writer},owner);done(true);
  })}
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
  function rejectFlight(owner,epoch,writer,operationId,base,{checkpoint,expectedSeq,control=null}={}){return change(owner,(tx,current,done)=>{
    assertFence(current,epoch,writer);const flight=current.flights&&readStorageRecord(current.flights),prior=current.bases&&readStorageRecord(current.bases),next=readStorageRecord(base);
    if(!flight||flight.operationId!==operationId)throw new Error('storage_reject_mismatch');
    if(!prior||next.owner!==owner||next.epoch!==epoch||next.ackSeq!==prior.ackSeq||!Number.isSafeInteger(next.revision)||next.revision<=flight.baseRevision)throw new Error('storage_rebase_cursor');
    if(!checkpoint||!Number.isSafeInteger(expectedSeq)||expectedSeq!==current.metadata.seq)throw new Error('storage_rebase_checkpoint_stale');
    const nextCheckpoint=readStorageRecord(checkpoint);
    if(nextCheckpoint.owner!==owner||nextCheckpoint.epoch!==epoch||nextCheckpoint.seq!==expectedSeq)throw new Error('storage_rebase_checkpoint_stale');
    // The new cloud revision and the local state rebased onto it become
    // authoritative together. A crash cannot expose only one side.
    tx.objectStore('checkpoints').put(checkpoint,owner);tx.objectStore('bases').put(base,owner);tx.objectStore('flights').delete(owner);
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
  function resetState(owner,epoch,writer,checkpoint){return change(owner,(tx,current,done)=>{
    assertFence(current,epoch,writer);const nextCheckpoint=readStorageRecord(checkpoint);
    if(nextCheckpoint.owner!==owner||nextCheckpoint.seq!==0||!String(nextCheckpoint.epoch||'').trim())throw new Error('storage_state_reset_invalid');
    tx.objectStore('checkpoints').put(checkpoint,owner);tx.objectStore('metadata').put({epoch:nextCheckpoint.epoch,seq:0,writer},owner);
    for(const record of current.journal)tx.objectStore('journal').delete([owner,record.data.epoch,record.data.seq]);
    tx.objectStore('bases').delete(owner);tx.objectStore('flights').delete(owner);tx.objectStore('controls').delete(owner);done(true);
  })}
  function resetCloudHead(owner,epoch,writer,checkpoint,base){return change(owner,(tx,current,done)=>{
    assertFence(current,epoch,writer);const nextCheckpoint=readStorageRecord(checkpoint),nextBase=readStorageRecord(base);
    if(nextCheckpoint.owner!==owner||nextBase.owner!==owner||nextCheckpoint.epoch!==nextBase.epoch||nextCheckpoint.seq!==0||nextBase.ackSeq!==0||!Number.isSafeInteger(nextBase.revision)||nextBase.revision<0)throw new Error('storage_cloud_reset_invalid');
    tx.objectStore('checkpoints').put(checkpoint,owner);tx.objectStore('metadata').put({epoch:nextCheckpoint.epoch,seq:0,writer},owner);
    for(const record of current.journal)tx.objectStore('journal').delete([owner,record.data.epoch,record.data.seq]);
    tx.objectStore('bases').put(base,owner);tx.objectStore('flights').delete(owner);tx.objectStore('controls').delete(owner);done(true);
  })}
  function boundaryTransaction(work){return open().then(db=>new Promise((resolve,reject)=>{
    const tx=db.transaction(['boundaries'],'readwrite'),store=tx.objectStore('boundaries');let result;
    try{work(store,value=>{result=value},error=>{try{tx.abort()}catch{}reject(error)})}catch(error){try{tx.abort()}catch{}reject(error)}
    tx.oncomplete=()=>resolve(result);tx.onabort=()=>reject(tx.error||new Error('storage_boundary_aborted'));tx.onerror=()=>{};
  }))}
  function readBoundary(owner){return open().then(db=>new Promise((resolve,reject)=>{
    const tx=db.transaction(['boundaries'],'readonly'),request=tx.objectStore('boundaries').get(owner);
    request.onsuccess=()=>{try{resolve(request.result?readStorageRecord(request.result):null)}catch(error){reject(error)}};
    request.onerror=()=>reject(request.error);
  }))}
  function beginBoundary(owner,record){return boundaryTransaction((store,done,fail)=>{
    const request=store.get(owner);request.onsuccess=()=>{try{
      if(request.result){const prior=readStorageRecord(request.result);if(prior.id===record.id&&prior.phase==='complete'){done(prior);return}if(prior.phase!=='complete')throw new Error('storage_boundary_pending')}
      if(record.owner!==owner||record.phase!=='prepared')throw new Error('storage_boundary_invalid');
      store.put(sealStorageRecord(record),owner);done(structuredClone(record));
    }catch(error){fail(error)}};
  })}
  function advanceBoundary(owner,id,fromPhase,toPhase){return boundaryTransaction((store,done,fail)=>{
    const request=store.get(owner);request.onsuccess=()=>{try{
      if(!request.result)throw new Error('storage_boundary_missing');
      const record=readStorageRecord(request.result);
      if(record.id!==id||record.owner!==owner||record.phase!==fromPhase)throw new Error('storage_boundary_changed');
      const next={...record,phase:toPhase};store.put(sealStorageRecord(next),owner);done(next);
    }catch(error){fail(error)}};
  })}
  function completeBoundary(owner,id){return boundaryTransaction((store,done,fail)=>{
    const request=store.get(owner);request.onsuccess=()=>{try{
      if(!request.result)throw new Error('storage_boundary_missing');
      const record=readStorageRecord(request.result);
      if(record.id!==id||record.phase!=='main-applied')throw new Error('storage_boundary_changed');
      store.put(sealStorageRecord({version:2,id,owner,kind:record.kind,phase:'complete',completedAt:new Date().toISOString()}),owner);done(true);
    }catch(error){fail(error)}};
  })}
  function readCutover(scope){return open().then(db=>new Promise((resolve,reject)=>{
    const tx=db.transaction(['cutovers'],'readonly'),request=tx.objectStore('cutovers').get(scope);
    request.onsuccess=()=>{try{resolve(request.result?readStorageRecord(request.result):null)}catch(error){reject(error)}};
    request.onerror=()=>reject(request.error);
  }))}
  function markCutover(app,identity){
    if(!['orders','kupa'].includes(app)||!String(identity||'').trim())throw new Error('storage_cutover_scope_invalid');
    return open().then(db=>new Promise((resolve,reject)=>{
      const owner=String(identity),scope=`${app}:${owner}`,mainOwner=`${owner}:${app}`,sharedOwner=`${owner}:shared-checks`;
      const tx=db.transaction(['cutovers','checkpoints','bases','boundaries'],'readwrite');
      const requests=[tx.objectStore('cutovers').get(scope),tx.objectStore('checkpoints').get(mainOwner),tx.objectStore('checkpoints').get(sharedOwner),tx.objectStore('bases').get(mainOwner),tx.objectStore('bases').get(sharedOwner),tx.objectStore('boundaries').get(owner)];
      let remaining=requests.length,result=null;
      const fail=error=>{try{tx.abort()}catch{}reject(error)};
      for(const request of requests)request.onsuccess=()=>{if(--remaining)return;try{
        const [current,main,shared,mainBase,sharedBase,boundary]=requests.map(row=>row.result);
        if(current){result=readStorageRecord(current);if(result.version!==2||result.scope!==scope)throw new Error('storage_cutover_marker_invalid');return}
        if(!main||!shared||!mainBase||!sharedBase)throw new Error('storage_cutover_head_missing');
        if(readStorageRecord(main).appMetadata?.storageRole!=='primary'||readStorageRecord(shared).appMetadata?.storageRole!=='shared-checks-primary')throw new Error('storage_cutover_role_invalid');
        if(readStorageRecord(mainBase).owner!==mainOwner||readStorageRecord(sharedBase).owner!==sharedOwner)throw new Error('storage_cutover_base_invalid');
        if(boundary&&readStorageRecord(boundary).phase!=='complete')throw new Error('storage_cutover_boundary_pending');
        result={version:2,scope,app,owner,markedAt:new Date().toISOString()};tx.objectStore('cutovers').put(sealStorageRecord(result),scope);
      }catch(error){fail(error)}};
      tx.oncomplete=()=>resolve(result);tx.onabort=()=>reject(tx.error||new Error('storage_cutover_aborted'));
    }))
  }
  return {load,install,initializeCloudHead,claim,append,compact,replaceCheckpoint,setBase,beginFlight,acknowledge,rejectFlight,setControl,clearControl,adoptCloudHead,resetState,resetCloudHead,readBoundary,beginBoundary,advanceBoundary,completeBoundary,readCutover,markCutover};
}
