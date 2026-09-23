import {createIndexedDbConnection} from './indexed-db-connection.js';
import {readStorageRecord,sealStorageRecord} from './storage-journal-model.js';

export function createStorageJournalDb({name='netunim-storage-v2'}={}){
  const stores=['checkpoints','journal','metadata','bases','flights','controls'];
  const open=createIndexedDbConnection(name,7,db=>{
    for(const name of stores)if(!db.objectStoreNames.contains(name)){const store=db.createObjectStore(name);if(name==='journal')store.createIndex('owner','data.owner')}
    if(!db.objectStoreNames.contains('boundaries'))db.createObjectStore('boundaries');
    if(!db.objectStoreNames.contains('cutovers'))db.createObjectStore('cutovers');
    if(!db.objectStoreNames.contains('owner-bindings'))db.createObjectStore('owner-bindings');
    if(!db.objectStoreNames.contains('owner-handoffs'))db.createObjectStore('owner-handoffs');
    if(!db.objectStoreNames.contains('bootstrap-groups'))db.createObjectStore('bootstrap-groups');
    if(!db.objectStoreNames.contains('cutover-preparations'))db.createObjectStore('cutover-preparations');
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
  function replaceShadowWithCloudHead(owner,expectedEpoch,expectedSeq,checkpoint,base,writer,operation=null){return change(owner,(tx,current,done)=>{
    if(!current.checkpoints||!current.metadata||current.metadata.epoch!==expectedEpoch||Number(current.metadata.seq)!==Number(expectedSeq))throw new Error('storage_shadow_promotion_race');
    // A shadow namespace must never own cloud authority. Any existing cursor,
    // flight or control means this is not a shadow-only promotion and must stop.
    if(current.bases||current.flights||current.controls)throw new Error('storage_shadow_cloud_state_invalid');
    const prior=readStorageRecord(current.checkpoints),head=readStorageRecord(checkpoint),cursor=readStorageRecord(base),entry=operation&&readStorageRecord(operation);
    if(prior.owner!==owner||head.owner!==owner||cursor.owner!==owner||head.epoch!==cursor.epoch||head.seq!==0||cursor.ackSeq!==0||!Number.isSafeInteger(cursor.revision)||cursor.revision<0)throw new Error('storage_initialization_invalid');
    if(entry&&(entry.owner!==owner||entry.epoch!==head.epoch||entry.seq!==1))throw new Error('storage_initialization_invalid');
    for(const record of current.journal)tx.objectStore('journal').delete([owner,record.data.epoch,record.data.seq]);
    tx.objectStore('checkpoints').put(checkpoint,owner);tx.objectStore('bases').put(base,owner);tx.objectStore('flights').delete(owner);tx.objectStore('controls').delete(owner);
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
  function appendBoundary(owner,epoch,writer,record,{expectedSeq,expectedBaseRevision}={}){return change(owner,(tx,current,done)=>{
    assertFence(current,epoch,writer);
    const base=current.bases&&readStorageRecord(current.bases),operation=readStorageRecord(record);
    if(!base||base.owner!==owner||base.epoch!==epoch||base.revision!==expectedBaseRevision||base.ackSeq!==expectedSeq||current.metadata.seq!==expectedSeq||current.flights||current.controls)throw new Error('storage_boundary_cloud_changed');
    if(operation.owner!==owner||operation.epoch!==epoch||operation.seq!==expectedSeq+1||operation.appMetadata?.boundaryId==null)throw new Error('storage_boundary_operation_invalid');
    tx.objectStore('journal').put(record,[owner,epoch,operation.seq]);
    tx.objectStore('metadata').put({...current.metadata,seq:operation.seq},owner);
    done(true);
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
  function ownerRecord(storeName,app){return open().then(db=>new Promise((resolve,reject)=>{
    const tx=db.transaction([storeName],'readonly'),request=tx.objectStore(storeName).get(app);
    request.onsuccess=()=>{try{resolve(request.result?readStorageRecord(request.result):null)}catch(error){reject(error)}};
    request.onerror=()=>reject(request.error);
  }))}
  function readOwnerBinding(app){return ownerRecord('owner-bindings',app)}
  function readOwnerHandoff(app){return ownerRecord('owner-handoffs',app)}
  function initializeOwnerBinding(app,owner,{source='bootstrap',at=new Date().toISOString()}={}){return open().then(db=>new Promise((resolve,reject)=>{
    const tx=db.transaction(['owner-bindings'],'readwrite'),store=tx.objectStore('owner-bindings'),request=store.get(app);let result=null,error=null;
    request.onsuccess=()=>{try{
      if(request.result){result=readStorageRecord(request.result);if(result.version!==1||result.app!==app||result.owner!==owner)throw new Error('storage_owner_binding_conflict');return}
      result={version:1,app,owner,generation:1,source,createdAt:at,updatedAt:at};store.put(sealStorageRecord(result),app);
    }catch(cause){error=cause;try{tx.abort()}catch{}}};
    tx.oncomplete=()=>resolve(result);tx.onabort=()=>reject(error||tx.error||new Error('storage_owner_binding_aborted'));tx.onerror=()=>{error??=tx.error};
  }))}
  function reserveLocalOwnerTarget(app,targetOwner,{id,intent,at=new Date().toISOString()}={}){return open().then(db=>new Promise((resolve,reject)=>{
    const tx=db.transaction(['owner-bindings'],'readwrite'),store=tx.objectStore('owner-bindings'),request=store.get(app);let result=null,error=null;
    request.onsuccess=()=>{try{
      if(!request.result)throw new Error('storage_owner_binding_missing');const binding=readStorageRecord(request.result),target=String(targetOwner||'').trim(),kind=String(intent||'').trim(),operation=String(id||'').trim(),pending=binding.pendingAdoption||null;
      if(!target||target==='local'||!operation||!['load-account','upload-local'].includes(kind))throw new Error('storage_owner_local_adoption_invalid');
      if(binding.owner===target&&!pending){result=binding;return}
      if(binding.owner!=='local')throw new Error('storage_owner_handoff_required');
      if(pending){if(pending.targetOwner===target&&pending.intent===kind){result=binding;return}throw new Error('storage_owner_local_adoption_reserved')}
      result={...binding,pendingAdoption:{id:operation,targetOwner:target,intent:kind,createdAt:at,updatedAt:at},updatedAt:at};store.put(sealStorageRecord(result),app);
    }catch(cause){error=cause;try{tx.abort()}catch{}}};
    tx.oncomplete=()=>resolve(result);tx.onabort=()=>reject(error||tx.error||new Error('storage_owner_local_reservation_aborted'));tx.onerror=()=>{error??=tx.error};
  }))}
  function adoptPreparedLocalOwner(app,targetOwner,{id,intent,proof={},at=new Date().toISOString()}={}){return open().then(db=>new Promise((resolve,reject)=>{
    const tx=db.transaction(['owner-bindings','owner-handoffs'],'readwrite'),bindings=tx.objectStore('owner-bindings'),handoffs=tx.objectStore('owner-handoffs'),bindingReq=bindings.get(app),handoffReq=handoffs.get(app);let remaining=2,result=null,error=null;
    const finish=()=>{if(--remaining)return;try{
      if(!bindingReq.result)throw new Error('storage_owner_binding_missing');const binding=readStorageRecord(bindingReq.result),existing=handoffReq.result&&readStorageRecord(handoffReq.result),target=String(targetOwner||'').trim(),kind=String(intent||'').trim(),operation=String(id||'').trim();
      if(!target||target==='local'||!operation||!['load-account','upload-local'].includes(kind))throw new Error('storage_owner_local_adoption_invalid');
      if(binding.owner===target&&(!existing||existing.phase==='complete')){result={binding, handoff:existing||null};return}
      if(binding.owner!=='local')throw new Error('storage_owner_handoff_required');
      if(existing&&existing.phase!=='complete')throw new Error('storage_owner_handoff_pending');
      const reservation=binding.pendingAdoption||null;if(!reservation||reservation.targetOwner!==target||reservation.intent!==kind)throw new Error('storage_owner_local_adoption_not_reserved');
      const nextBinding={...binding,owner:target,generation:Number(binding.generation||0)+1,source:`prepared-local:${kind}`,pendingAdoption:null,updatedAt:at},complete={version:1,id:operation,app,sourceOwner:'local',targetOwner:target,intent:kind,phase:'complete',preparationProof:structuredClone(proof),reservationId:reservation.id,createdAt:reservation.createdAt||at,activatedAt:at,completedAt:at,updatedAt:at};
      bindings.put(sealStorageRecord(nextBinding),app);handoffs.put(sealStorageRecord(complete),app);result={binding:nextBinding,handoff:complete};
    }catch(cause){error=cause;try{tx.abort()}catch{}}};bindingReq.onsuccess=finish;handoffReq.onsuccess=finish;
    tx.oncomplete=()=>resolve(result);tx.onabort=()=>reject(error||tx.error||new Error('storage_owner_local_adoption_aborted'));tx.onerror=()=>{error??=tx.error};
  }))}
  function beginOwnerHandoff(app,record){return open().then(db=>new Promise((resolve,reject)=>{
    const tx=db.transaction(['owner-bindings','owner-handoffs'],'readwrite'),bindings=tx.objectStore('owner-bindings'),handoffs=tx.objectStore('owner-handoffs'),bindingReq=bindings.get(app),handoffReq=handoffs.get(app);let remaining=2,result=null,error=null;
    const finish=()=>{if(--remaining)return;try{
      if(!bindingReq.result)throw new Error('storage_owner_binding_missing');const binding=readStorageRecord(bindingReq.result),existing=handoffReq.result&&readStorageRecord(handoffReq.result);
      if(existing&&existing.phase!=='complete'){if(existing.id===record.id){result=existing;return}throw new Error('storage_owner_handoff_pending')}
      if(record.version!==1||record.app!==app||record.sourceOwner!==binding.owner||record.targetOwner===binding.owner||record.phase!=='freezing-source')throw new Error('storage_owner_handoff_invalid');
      result=structuredClone(record);handoffs.put(sealStorageRecord(result),app);
    }catch(cause){error=cause;try{tx.abort()}catch{}}};bindingReq.onsuccess=finish;handoffReq.onsuccess=finish;
    tx.oncomplete=()=>resolve(result);tx.onabort=()=>reject(error||tx.error||new Error('storage_owner_handoff_aborted'));tx.onerror=()=>{error??=tx.error};
  }))}
  function advanceOwnerHandoff(app,id,fromPhase,toPhase,patch={}){return open().then(db=>new Promise((resolve,reject)=>{
    const tx=db.transaction(['owner-handoffs'],'readwrite'),store=tx.objectStore('owner-handoffs'),request=store.get(app);let result=null,error=null;
    request.onsuccess=()=>{try{if(!request.result)throw new Error('storage_owner_handoff_missing');const current=readStorageRecord(request.result);if(current.id!==id||current.app!==app||current.phase!==fromPhase)throw new Error('storage_owner_handoff_changed');result={...current,...structuredClone(patch),phase:toPhase};store.put(sealStorageRecord(result),app)}catch(cause){error=cause;try{tx.abort()}catch{}}};
    tx.oncomplete=()=>resolve(result);tx.onabort=()=>reject(error||tx.error||new Error('storage_owner_handoff_aborted'));tx.onerror=()=>{error??=tx.error};
  }))}
  function activateOwnerHandoff(app,id,targetOwner,{at=new Date().toISOString()}={}){return open().then(db=>new Promise((resolve,reject)=>{
    const tx=db.transaction(['owner-bindings','owner-handoffs'],'readwrite'),bindings=tx.objectStore('owner-bindings'),handoffs=tx.objectStore('owner-handoffs'),bindingReq=bindings.get(app),handoffReq=handoffs.get(app);let remaining=2,result=null,error=null;
    const finish=()=>{if(--remaining)return;try{
      if(!bindingReq.result||!handoffReq.result)throw new Error('storage_owner_handoff_missing');const binding=readStorageRecord(bindingReq.result),handoff=readStorageRecord(handoffReq.result);
      if(handoff.id!==id||handoff.app!==app||handoff.phase!=='target-recovered'||handoff.sourceOwner!==binding.owner||handoff.targetOwner!==targetOwner)throw new Error('storage_owner_handoff_changed');
      const nextBinding={...binding,owner:targetOwner,generation:Number(binding.generation||0)+1,source:`handoff:${handoff.intent}`,updatedAt:at},active={...handoff,phase:'target-active',activatedAt:at,updatedAt:at};
      bindings.put(sealStorageRecord(nextBinding),app);handoffs.put(sealStorageRecord(active),app);result={binding:nextBinding,handoff:active};
    }catch(cause){error=cause;try{tx.abort()}catch{}}};bindingReq.onsuccess=finish;handoffReq.onsuccess=finish;
    tx.oncomplete=()=>resolve(result);tx.onabort=()=>reject(error||tx.error||new Error('storage_owner_handoff_aborted'));tx.onerror=()=>{error??=tx.error};
  }))}
  function completeOwnerHandoff(app,id,targetOwner,{at=new Date().toISOString()}={}){return open().then(db=>new Promise((resolve,reject)=>{
    const tx=db.transaction(['owner-bindings','owner-handoffs'],'readwrite'),bindings=tx.objectStore('owner-bindings'),handoffs=tx.objectStore('owner-handoffs'),bindingReq=bindings.get(app),handoffReq=handoffs.get(app);let remaining=2,result=null,error=null;
    const finish=()=>{if(--remaining)return;try{
      if(!bindingReq.result||!handoffReq.result)throw new Error('storage_owner_handoff_missing');const binding=readStorageRecord(bindingReq.result),handoff=readStorageRecord(handoffReq.result);
      if(handoff.id!==id||handoff.app!==app||handoff.phase!=='target-active'||binding.owner!==targetOwner||handoff.targetOwner!==targetOwner)throw new Error('storage_owner_handoff_changed');
      const complete={...handoff,phase:'complete',completedAt:at,updatedAt:at};
      handoffs.put(sealStorageRecord(complete),app);result={binding, handoff:complete};
    }catch(cause){error=cause;try{tx.abort()}catch{}}};bindingReq.onsuccess=finish;handoffReq.onsuccess=finish;
    tx.oncomplete=()=>resolve(result);tx.onabort=()=>reject(error||tx.error||new Error('storage_owner_handoff_aborted'));tx.onerror=()=>{error??=tx.error};
  }))}
  function bootstrapRecord(scope){return open().then(db=>new Promise((resolve,reject)=>{
    const tx=db.transaction(['bootstrap-groups'],'readonly'),request=tx.objectStore('bootstrap-groups').get(scope);
    request.onsuccess=()=>{try{resolve(request.result?readStorageRecord(request.result):null)}catch(error){reject(error)}};
    request.onerror=()=>reject(request.error);
  }))}
  function readBootstrapGroup(scope){return bootstrapRecord(scope)}
  function beginBootstrapGroup(scope,record){return open().then(db=>new Promise((resolve,reject)=>{
    const tx=db.transaction(['bootstrap-groups'],'readwrite'),store=tx.objectStore('bootstrap-groups'),request=store.get(scope);let result=null,error=null;
    request.onsuccess=()=>{try{
      const existing=request.result&&readStorageRecord(request.result);
      if(existing&&existing.phase!=='complete'){
        if(existing.id===record.id&&existing.planHash===record.planHash){result=existing;return}
        throw new Error('storage_bootstrap_group_pending');
      }
      if(record.version!==2||record.scope!==scope||record.phase!=='prepared'||!String(record.id||'').trim()||!String(record.planHash||'').trim())throw new Error('storage_bootstrap_group_invalid');
      result=structuredClone(record);store.put(sealStorageRecord(result),scope);
    }catch(cause){error=cause;try{tx.abort()}catch{}}};
    tx.oncomplete=()=>resolve(result);tx.onabort=()=>reject(error||tx.error||new Error('storage_bootstrap_group_aborted'));tx.onerror=()=>{error??=tx.error};
  }))}
  function advanceBootstrapGroup(scope,id,fromPhase,toPhase,patch={}){return open().then(db=>new Promise((resolve,reject)=>{
    const tx=db.transaction(['bootstrap-groups'],'readwrite'),store=tx.objectStore('bootstrap-groups'),request=store.get(scope);let result=null,error=null;
    request.onsuccess=()=>{try{
      if(!request.result)throw new Error('storage_bootstrap_group_missing');
      const current=readStorageRecord(request.result);
      if(current.id!==id||current.scope!==scope||current.phase!==fromPhase)throw new Error('storage_bootstrap_group_changed');
      result={...current,...structuredClone(patch),phase:toPhase};store.put(sealStorageRecord(result),scope);
    }catch(cause){error=cause;try{tx.abort()}catch{}}};
    tx.oncomplete=()=>resolve(result);tx.onabort=()=>reject(error||tx.error||new Error('storage_bootstrap_group_aborted'));tx.onerror=()=>{error??=tx.error};
  }))}
  function readCutoverPreparation(scope){return open().then(db=>new Promise((resolve,reject)=>{
    const tx=db.transaction(['cutover-preparations'],'readonly'),request=tx.objectStore('cutover-preparations').get(scope);
    request.onsuccess=()=>{try{resolve(request.result?readStorageRecord(request.result):null)}catch(error){reject(error)}};
    request.onerror=()=>reject(request.error);
  }))}
  function beginCutoverPreparation(scope,record){return open().then(db=>new Promise((resolve,reject)=>{
    const tx=db.transaction(['cutover-preparations'],'readwrite'),store=tx.objectStore('cutover-preparations'),request=store.get(scope);let result=null,error=null;
    request.onsuccess=()=>{try{
      const existing=request.result&&readStorageRecord(request.result);
      if(existing){
        if(existing.id===record.id){result=existing;return}
        if(existing.phase!=='complete')throw new Error('storage_cutover_preparation_pending');
        result=existing;return;
      }
      if(record.version!==1||record.scope!==scope||record.phase!=='freezing-source'||!String(record.id||'').trim())throw new Error('storage_cutover_preparation_invalid');
      result=structuredClone(record);store.put(sealStorageRecord(result),scope);
    }catch(cause){error=cause;try{tx.abort()}catch{}}};
    tx.oncomplete=()=>resolve(result);tx.onabort=()=>reject(error||tx.error||new Error('storage_cutover_preparation_aborted'));tx.onerror=()=>{error??=tx.error};
  }))}
  function advanceCutoverPreparation(scope,id,fromPhase,toPhase,patch={}){return open().then(db=>new Promise((resolve,reject)=>{
    const tx=db.transaction(['cutover-preparations'],'readwrite'),store=tx.objectStore('cutover-preparations'),request=store.get(scope);let result=null,error=null;
    request.onsuccess=()=>{try{
      if(!request.result)throw new Error('storage_cutover_preparation_missing');
      const current=readStorageRecord(request.result);
      if(current.id!==id||current.scope!==scope||current.phase!==fromPhase)throw new Error('storage_cutover_preparation_changed');
      result={...current,...structuredClone(patch),phase:toPhase};store.put(sealStorageRecord(result),scope);
    }catch(cause){error=cause;try{tx.abort()}catch{}}};
    tx.oncomplete=()=>resolve(result);tx.onabort=()=>reject(error||tx.error||new Error('storage_cutover_preparation_aborted'));tx.onerror=()=>{error??=tx.error};
  }))}
  function readCutover(scope){return open().then(db=>new Promise((resolve,reject)=>{
    const tx=db.transaction(['cutovers'],'readonly'),request=tx.objectStore('cutovers').get(scope);
    request.onsuccess=()=>{try{resolve(request.result?readStorageRecord(request.result):null)}catch(error){reject(error)}};
    request.onerror=()=>reject(request.error);
  }))}
  function markCutover(app,identity){
    if(!['orders','kupa'].includes(app)||!String(identity||'').trim())throw new Error('storage_cutover_scope_invalid');
    return open().then(db=>new Promise((resolve,reject)=>{
      const owner=String(identity),scope=`${app}:${owner}`,mainOwner=`${owner}:${app}`,sharedOwner=`${owner}:shared-checks`;
      const tx=db.transaction(['cutovers','checkpoints','metadata','bases','flights','controls','boundaries','bootstrap-groups'],'readwrite');
      const requests=[tx.objectStore('cutovers').get(scope),tx.objectStore('checkpoints').get(mainOwner),tx.objectStore('checkpoints').get(sharedOwner),tx.objectStore('metadata').get(mainOwner),tx.objectStore('metadata').get(sharedOwner),tx.objectStore('bases').get(mainOwner),tx.objectStore('bases').get(sharedOwner),tx.objectStore('flights').get(mainOwner),tx.objectStore('flights').get(sharedOwner),tx.objectStore('controls').get(mainOwner),tx.objectStore('controls').get(sharedOwner),tx.objectStore('boundaries').get(owner),tx.objectStore('bootstrap-groups').get(scope)];
      let remaining=requests.length,result=null;
      const fail=error=>{try{tx.abort()}catch{}reject(error)};
      for(const request of requests)request.onsuccess=()=>{if(--remaining)return;try{
        const [current,main,shared,mainMeta,sharedMeta,mainBase,sharedBase,mainFlight,sharedFlight,mainControl,sharedControl,boundary,bootstrap]=requests.map(row=>row.result);
        if(current){result=readStorageRecord(current);if(result.version!==2||result.scope!==scope)throw new Error('storage_cutover_marker_invalid');return}
        if(!main||!shared||!mainMeta||!sharedMeta||!mainBase||!sharedBase)throw new Error('storage_cutover_head_missing');
        const mainHead=readStorageRecord(main),sharedHead=readStorageRecord(shared),mainCursor=readStorageRecord(mainBase),sharedCursor=readStorageRecord(sharedBase);
        if(mainHead.appMetadata?.storageRole!=='primary'||sharedHead.appMetadata?.storageRole!=='shared-checks-primary')throw new Error('storage_cutover_role_invalid');
        if(mainHead.owner!==mainOwner||sharedHead.owner!==sharedOwner||mainCursor.owner!==mainOwner||sharedCursor.owner!==sharedOwner||mainCursor.epoch!==mainHead.epoch||sharedCursor.epoch!==sharedHead.epoch)throw new Error('storage_cutover_base_invalid');
        if(mainMeta.epoch!==mainHead.epoch||sharedMeta.epoch!==sharedHead.epoch||mainMeta.seq!==mainCursor.ackSeq||sharedMeta.seq!==sharedCursor.ackSeq||mainFlight||sharedFlight||mainControl||sharedControl)throw new Error('storage_cutover_head_not_clean');
        if(boundary&&readStorageRecord(boundary).phase!=='complete')throw new Error('storage_cutover_boundary_pending');
        if(bootstrap&&readStorageRecord(bootstrap).phase!=='complete')throw new Error('storage_cutover_bootstrap_pending');
        result={version:2,scope,app,owner,markedAt:new Date().toISOString()};tx.objectStore('cutovers').put(sealStorageRecord(result),scope);
      }catch(error){fail(error)}};
      tx.oncomplete=()=>resolve(result);tx.onabort=()=>reject(tx.error||new Error('storage_cutover_aborted'));
    }))
  }
  return {load,install,initializeCloudHead,replaceShadowWithCloudHead,claim,append,appendBoundary,compact,replaceCheckpoint,setBase,beginFlight,acknowledge,rejectFlight,setControl,clearControl,adoptCloudHead,resetState,resetCloudHead,readBoundary,beginBoundary,advanceBoundary,completeBoundary,readOwnerBinding,readOwnerHandoff,initializeOwnerBinding,reserveLocalOwnerTarget,adoptPreparedLocalOwner,beginOwnerHandoff,advanceOwnerHandoff,activateOwnerHandoff,completeOwnerHandoff,readBootstrapGroup,beginBootstrapGroup,advanceBootstrapGroup,readCutoverPreparation,beginCutoverPreparation,advanceCutoverPreparation,readCutover,markCutover};
}
