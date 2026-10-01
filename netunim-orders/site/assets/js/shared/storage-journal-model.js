// Storage operations contain final values, never clocks, random IDs or callbacks.
// This is a local persistence contract, independent of the cloud RPC protocol.
import {measureStorage,storageBytes} from './storage-metrics.js';
export const STORAGE_JOURNAL_VERSION=2;
const forbidden=new Set(['__proto__','prototype','constructor']);
export function assertStorageJson(value){
  const seen=new Set();
  function visit(item){
    if(item===null||typeof item==='string'||typeof item==='boolean')return;
    if(typeof item==='number'&&Number.isFinite(item))return;
    if(!item||typeof item!=='object'||seen.has(item)||(!Array.isArray(item)&&Object.getPrototypeOf(item)!==Object.prototype))throw new Error('storage_non_json_value');
    seen.add(item);for(const [key,child] of Object.entries(item)){if(forbidden.has(key))throw new Error('storage_unsafe_key');visit(child)}seen.delete(item);
  }
  visit(value);return value;
}
// Corruption detection, not a cryptographic signature or authentication boundary.
export function storageChecksum(text){let a=2166136261,b=0x9e3779b9;for(let i=0;i<text.length;i++){const c=text.charCodeAt(i);a=Math.imul(a^c,16777619);b=Math.imul(b^c,2246822519)}return (a>>>0).toString(16).padStart(8,'0')+(b>>>0).toString(16).padStart(8,'0')}
export function sealStorageRecord(value,{kind=null}={}){
  const run=(name,work)=>kind?measureStorage(name,work):work();
  run('validate',()=>assertStorageJson(value));
  const data=run(`${kind}-clone`,()=>structuredClone(value));
  const text=run(`${kind}-stringify`,()=>JSON.stringify(data));
  if(kind)storageBytes(kind,text);
  return {data,checksum:storageChecksum(text)};
}
export function readStorageRecord(record){if(!record?.data||storageChecksum(JSON.stringify(record.data))!==record.checksum)throw new Error('storage_checksum_mismatch');assertStorageJson(record.data);return structuredClone(record.data)}
function integer(value,min=0){return Number.isSafeInteger(value)&&value>=min}
function identity(value){return typeof value==='string'&&value.length>0&&value.length<=512}
export function validateStoredOperation(operation,{collections=[],fields=[]}={}){
  assertStorageJson(operation);
  if(operation.version!==2||!identity(operation.owner)||!identity(operation.epoch)||!identity(operation.operationId)||!integer(operation.seq,1)||!integer(operation.generation)||!identity(operation.at)||!Array.isArray(operation.changes)||!operation.changes.length)throw new Error('storage_invalid_operation');
  for(const change of operation.changes){
    if(change.type==='replace-state'){
      const durableBoundary=['import','cloud-normalization'].includes(operation.mutationType)&&identity(operation.appMetadata?.boundaryId);
      const firstCloudBootstrap=operation.mutationType==='bootstrap'&&operation.seq===1&&operation.appMetadata?.storageRole==='primary'&&((operation.appMetadata?.migrationIntent==='upload-local'&&operation.appMetadata?.sourceOwner==='local')||(operation.appMetadata?.migrationIntent==='upload-owner'&&identity(operation.appMetadata?.targetOwner)&&operation.appMetadata?.sourceOwner===operation.appMetadata?.targetOwner));
      if(operation.changes.length!==1||(!durableBoundary&&!firstCloudBootstrap)||!change.state||typeof change.state!=='object'||Array.isArray(change.state))throw new Error('storage_invalid_local_import');
      continue;
    }
    if(change.type==='set'){
      if(!fields.includes(change.field)||forbidden.has(change.field)||!Object.hasOwn(change,'value'))throw new Error('storage_invalid_field');
      continue;
    }
    if(!collections.includes(change.collection)||forbidden.has(change.collection)||!identity(change.id))throw new Error('storage_invalid_collection');
    if(change.type==='put'){
      if(!['insert','replace'].includes(change.mode)||!change.record||change.record.id!==change.id||(change.mode==='insert'&&!integer(change.index)))throw new Error('storage_invalid_put');
    }else if(change.type!=='delete')throw new Error('storage_unknown_operation');
  }
  if(operation.deleteIntents!=null){
    if(!operation.deleteIntents||typeof operation.deleteIntents!=='object'||Array.isArray(operation.deleteIntents))throw new Error('storage_delete_intents_invalid');
    for(const [collection,ids] of Object.entries(operation.deleteIntents))if(!identity(collection)||forbidden.has(collection)||!Array.isArray(ids)||ids.some(id=>!identity(id))||new Set(ids).size!==ids.length)throw new Error('storage_delete_intents_invalid');
  }
  return operation;
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
  const base=readStorageRecord(checkpoint);
  if(base.version!==2||!identity(base.owner)||!identity(base.epoch)||!integer(base.seq)||!base.state)throw new Error('storage_invalid_checkpoint');
  // Older Main checkpoints can retain acknowledged check operations until the
  // projection migration compacts them. New appends always use the strict
  // schema; a migrated checkpoint must never replay an old check operation.
  const replaySchema=base.appMetadata?.mainProjectionVersion===2||!schema.legacyCollections?schema:{...schema,collections:schema.legacyCollections};
  if(base.appMetadata?.mainProjectionVersion===2&&Object.hasOwn(base.state,'checks'))throw new Error('storage_main_projection_invalid');
  const state=structuredClone(base.state),bySeq=new Map(),ids=new Set();let seq=base.seq,appMetadata=structuredClone(base.appMetadata||{});
  for(const sealed of records){
    const operation=readStorageRecord(sealed);validateStoredOperation(operation,replaySchema);
    if(operation.owner!==base.owner||operation.epoch!==base.epoch)throw new Error('storage_foreign_operation');
    const prior=bySeq.get(operation.seq);
    if(prior&&JSON.stringify(prior)!==JSON.stringify(operation))throw new Error('storage_duplicate_sequence');
    bySeq.set(operation.seq,operation);
  }
  for(const operation of [...bySeq.values()].sort((a,b)=>a.seq-b.seq)){
    if(operation.seq<=base.seq)continue;
    if(operation.seq!==seq+1||ids.has(operation.operationId))throw new Error('storage_journal_gap_or_duplicate');
    applyStoredOperation(state,operation,replaySchema);seq=operation.seq;ids.add(operation.operationId);if(Object.hasOwn(operation,'appMetadata'))appMetadata={...appMetadata,...structuredClone(operation.appMetadata||{})};
  }
  if(appMetadata.mainProjectionVersion===2&&Object.hasOwn(state,'checks'))throw new Error('storage_main_projection_invalid');
  return {state,seq,epoch:base.epoch,owner:base.owner,appMetadata};
}
