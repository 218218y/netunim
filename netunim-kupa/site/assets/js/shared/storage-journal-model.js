// Storage operations contain final values, never clocks, random IDs or callbacks.
// This is a local persistence contract, independent of the cloud RPC protocol.
import {measureStorage,storageBytes} from './storage-metrics.js';
import {sealStorageJsonRecord} from './storage-json-codec.js';
import {readStorageCheckpoint} from './storage-checkpoint.js';
import {validateStoredOperation,readStorageOperation} from './storage-operation.js';
export {assertStorageJson,storageChecksum,readStorageJsonRecord as readStorageRecord} from './storage-json-codec.js';
export {validateStoredOperation,readStorageOperation} from './storage-operation.js';
export const STORAGE_JOURNAL_VERSION=2;
export function sealStorageRecord(value,{kind=null}={}){
  return sealStorageJsonRecord(value,{kind,measure:(name,work)=>kind?measureStorage(name,work):work(),onSerialized:text=>{if(kind)storageBytes(kind,text)}});
}
// Mutates only the owned replay state. Validation precedes any changes to it.
export function applyStoredOperation(state,operation,schema){
  validateStoredOperation(operation,schema);
  for(const change of operation.changes){
    if(change.type==='replace-state'){
      for(const key of Object.keys(state))delete state[key];
      Object.assign(state,structuredClone(change.state));
      continue;
    }
    if(change.type==='set'){state[change.field]=structuredClone(change.value);continue}
    const rows=state[change.collection];if(!Array.isArray(rows))throw new Error('storage_missing_collection');
    const index=rows.findIndex(row=>row.id===change.id);
    if(change.type==='delete'){if(index<0)throw new Error('storage_delete_target_missing');rows.splice(index,1)}
    else if(change.mode==='insert'){
      if(index>=0||change.index>rows.length)throw new Error('storage_insert_conflict');
      rows.splice(change.index,0,structuredClone(change.record));
    }else{if(index<0)throw new Error('storage_update_target_missing');rows[index]=structuredClone(change.record)}
  }
  return state;
}
export function replayStorageJournal(checkpoint,records,schema){
  const base=readStorageCheckpoint(checkpoint);
  // A Main checkpoint from the transition era cannot be mistaken for current
  // authority. An old device must explicitly reset and adopt the cloud head.
  if(schema.mainProjection===2&&(base.appMetadata?.mainProjectionVersion!==2||Object.hasOwn(base.state,'checks')))throw new Error('storage_main_projection_invalid');
  const state=structuredClone(base.state),bySeq=new Map(),ids=new Set();let seq=base.seq,appMetadata=structuredClone(base.appMetadata||{});
  for(const sealed of records){
    const operation=readStorageOperation(sealed,schema);
    if(operation.owner!==base.owner||operation.epoch!==base.epoch)throw new Error('storage_foreign_operation');
    const prior=bySeq.get(operation.seq);
    if(prior&&JSON.stringify(prior)!==JSON.stringify(operation))throw new Error('storage_duplicate_sequence');
    bySeq.set(operation.seq,operation);
  }
  for(const operation of [...bySeq.values()].sort((a,b)=>a.seq-b.seq)){
    if(operation.seq<=base.seq)continue;
    if(operation.seq!==seq+1||ids.has(operation.operationId))throw new Error('storage_journal_gap_or_duplicate');
    applyStoredOperation(state,operation,schema);seq=operation.seq;ids.add(operation.operationId);if(Object.hasOwn(operation,'appMetadata'))appMetadata={...appMetadata,...structuredClone(operation.appMetadata||{})};
  }
  if(schema.mainProjection===2&&(appMetadata.mainProjectionVersion!==2||Object.hasOwn(state,'checks')))throw new Error('storage_main_projection_invalid');
  return {state,seq,epoch:base.epoch,owner:base.owner,appMetadata};
}
