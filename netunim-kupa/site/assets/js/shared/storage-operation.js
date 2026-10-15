// @ts-check
import {assertStorageJson,readStorageJsonRecord,storageJsonHash} from './storage-json-codec.js';
import {isHistoricalUploadOwnerBootstrap} from './storage-v2-persisted-compat.js';

/**
 * Historical reader annotations may be absent/null. Current writers have a
 * separate, stronger contract. Decoding never supplies or rewrites defaults.
 * @typedef {import('./storage-json.js').StorageJson} StorageJson
 * @typedef {import('./storage-json.js').StorageJsonObject} StorageJsonObject
 * @typedef {StorageJsonObject & {type:'put',collection:string,id:string,record:StorageJsonObject & {id:string}} & ({mode:'insert',index:number}|{mode:'replace'})} StoredStoragePutChange
 * @typedef {import('./storage-records.js').StorageSetChange|import('./storage-records.js').StorageDeleteChange|import('./storage-records.js').StorageReplaceStateChange|StoredStoragePutChange} StorageChange
 * @typedef {import('./storage-records.js').StorageDeleteIntents} StorageDeleteIntents
 * @typedef {{collections?:readonly string[],fields?:readonly string[]}} StorageOperationSchema
 * @typedef {StorageJsonObject & {version:2,owner:string,epoch:string,seq:number,generation:number,operationId:string,at:string,changes:StorageChange[],appMetadata?:StorageJsonObject|null,deleteIntents?:StorageDeleteIntents|null,surface?:string|null,mutationType?:string|null}} StoredStorageOperation
 */

const forbidden=new Set(['__proto__','prototype','constructor']);
/** @param {StorageJson | undefined} value @returns {value is StorageJsonObject} */
function object(value){return value!==null&&typeof value==='object'&&!Array.isArray(value)}
/** @param {StorageJson | undefined} value @returns {value is string} */
function identity(value){return typeof value==='string'&&value.length>0&&value.length<=512}
/** @param {StorageJson | undefined} value @param {number} [min] @returns {value is number} */
function integer(value,min=0){return typeof value==='number'&&Number.isSafeInteger(value)&&value>=min}

/** @param {StorageJson} value @param {StorageJsonObject} operation @param {StorageOperationSchema} schema @returns {value is StorageChange} */
function change(value,operation,{collections=[],fields=[]}){
  if(!object(value))throw new Error('storage_invalid_operation');
  if(value.type==='replace-state'){
    const metadata=object(operation.appMetadata)?operation.appMetadata:null;
    const durableBoundary=typeof operation.mutationType==='string'&&['import','cloud-normalization'].includes(operation.mutationType)&&identity(metadata?.boundaryId);
    const firstCloudBootstrap=operation.mutationType==='bootstrap'&&operation.seq===1&&metadata?.storageRole==='primary'&&((metadata.migrationIntent==='upload-local'&&metadata.sourceOwner==='local')||isHistoricalUploadOwnerBootstrap({appMetadata:metadata}));
    if(!Array.isArray(operation.changes)||operation.changes.length!==1||(!durableBoundary&&!firstCloudBootstrap)||!object(value.state))throw new Error('storage_invalid_local_import');
    return true;
  }
  if(value.type==='set'){
    if(typeof value.field!=='string'||!fields.includes(value.field)||forbidden.has(value.field)||!Object.hasOwn(value,'value'))throw new Error('storage_invalid_field');
    return true;
  }
  if(typeof value.collection!=='string'||!collections.includes(value.collection)||forbidden.has(value.collection)||!identity(value.id))throw new Error('storage_invalid_collection');
  if(value.type==='put'){
    if((value.mode!=='insert'&&value.mode!=='replace')||!object(value.record)||value.record.id!==value.id||(value.mode==='insert'&&!integer(value.index)))throw new Error('storage_invalid_put');
    // A replacement index was historically ignored; it is not authority and
    // is intentionally not claimed by the reader type.
  }else if(value.type!=='delete')throw new Error('storage_unknown_operation');
  return true;
}

/** @param {StorageJson} value @param {StorageOperationSchema} schema @returns {value is StoredStorageOperation} */
function operation(value,schema){
  if(!object(value)||value.version!==2||!identity(value.owner)||!identity(value.epoch)||!identity(value.operationId)||!integer(value.seq,1)||!integer(value.generation)||!identity(value.at)||!Array.isArray(value.changes)||!value.changes.length||
    (value.appMetadata!=null&&!object(value.appMetadata))||(value.surface!=null&&typeof value.surface!=='string')||(value.mutationType!=null&&typeof value.mutationType!=='string'))throw new Error('storage_invalid_operation');
  for(const entry of value.changes)change(entry,value,schema);
  if(value.deleteIntents!=null){
    if(!object(value.deleteIntents))throw new Error('storage_delete_intents_invalid');
    for(const [collection,ids] of Object.entries(value.deleteIntents))if(!identity(collection)||forbidden.has(collection)||!Array.isArray(ids)||ids.some(id=>!identity(id))||new Set(ids).size!==ids.length)throw new Error('storage_delete_intents_invalid');
  }
  return true;
}

/** @param {unknown} value @param {StorageOperationSchema} [schema] @returns {StoredStorageOperation} */
export function validateStoredOperation(value,schema={}){
  const data=assertStorageJson(value);
  if(!operation(data,schema))throw new Error('storage_invalid_operation');
  return data;
}

/** @param {unknown} record @param {StorageOperationSchema} [schema] @returns {StoredStorageOperation} */
export function readStorageOperation(record,schema={}){
  const data=readStorageJsonRecord(record);
  if(!operation(data,schema))throw new Error('storage_invalid_operation');
  return data;
}

/**
 * @typedef {'restore'|'import'|'authoritative-load'|'local-file-rebase'} BoundaryKind
 * @typedef {'prepared'|'shared-applied'|'main-applied'} BoundaryPhase
 * @typedef {StorageJsonObject & {kind:'replace-authoritative'|'reset-cloud-head'|'replace-local-with-pending'|'replace-local-authoritative',state:StorageJsonObject,cloudState?:StorageJsonObject,expectedSeq?:number,expectedBaseRevision?:number,requireCleanCloud?:true,revision?:number,options?:StorageJsonObject & {appMetadata?:StorageJsonObject}}} BoundaryAction
 * @typedef {{version:2,owner:string,id:string,kind:BoundaryKind,phase:BoundaryPhase,main:BoundaryAction,shared:BoundaryAction}} PendingBoundary
 * @typedef {{version:2,owner:string,id:string,kind:BoundaryKind,phase:'complete'}} CompletedBoundary
 * @typedef {PendingBoundary|CompletedBoundary} StorageBoundary
 * @typedef {{id:string,kind:BoundaryKind,main:BoundaryAction,shared:BoundaryAction}} BoundaryIntent
 */

/** @param {StorageJson|undefined} value @param {StorageJsonObject} record @returns {value is BoundaryAction} */
function boundaryAction(value,record) {
  if(!object(value)||typeof value.kind!=='string'||!['replace-authoritative','reset-cloud-head','replace-local-with-pending','replace-local-authoritative'].includes(value.kind)||!object(value.state))throw new Error('storage_boundary_action_invalid');
  if(value.cloudState!==undefined&&!object(value.cloudState))throw new Error('storage_boundary_action_invalid');
  if(value.options!==undefined&&(!object(value.options)||(value.options.appMetadata!==undefined&&!object(value.options.appMetadata))))throw new Error('storage_boundary_options_invalid');
  if(object(value.options)&&object(value.options.appMetadata)&&value.options.appMetadata.boundaryId!==undefined&&value.options.appMetadata.boundaryId!==record.id)throw new Error('storage_boundary_identity_override');
  if(record.kind==='import'&&!['replace-local-with-pending','replace-local-authoritative'].includes(value.kind))throw new Error('storage_boundary_import_requires_pending');
  if(value.kind==='replace-local-authoritative'&&(record.owner!=='local'||record.kind!=='import'||!integer(value.expectedSeq)||value.expectedBaseRevision!==undefined||value.requireCleanCloud!==undefined))throw new Error('storage_boundary_local_precondition_required');
  if(value.kind==='replace-local-with-pending'&&(record.kind!=='import'||value.requireCleanCloud!==true||!integer(value.expectedSeq)||!integer(value.expectedBaseRevision)))throw new Error('storage_boundary_import_precondition_required');
  if(value.kind==='reset-cloud-head'&&!integer(value.revision))throw new Error('storage_boundary_revision_invalid');
  if(value.expectedSeq!==undefined&&!integer(value.expectedSeq))throw new Error('storage_boundary_sequence_invalid');
  if(value.expectedBaseRevision!==undefined&&!integer(value.expectedBaseRevision))throw new Error('storage_boundary_base_revision_invalid');
  if(value.requireCleanCloud!==undefined&&value.requireCleanCloud!==true)throw new Error('storage_boundary_cloud_precondition_invalid');
  return true;
}
/** @param {StorageJson} data @param {string} owner @returns {data is StorageJsonObject & StorageBoundary} */
function boundaryRecord(data,owner) {
  if(!object(data)||data.version!==2||data.owner!==owner||!identity(data.id)||!data.id.trim()||typeof data.kind!=='string'||!['restore','import','authoritative-load','local-file-rebase'].includes(data.kind))throw new Error('storage_boundary_invalid');
  if(data.phase==='complete')return true;
  if(typeof data.phase!=='string'||!['prepared','shared-applied','main-applied'].includes(data.phase))throw new Error('storage_boundary_phase_invalid');
  if(!boundaryAction(data.main,data)||!boundaryAction(data.shared,data))throw new Error('storage_boundary_action_invalid');
  if(data.kind==='import'&&data.main.kind!==data.shared.kind)throw new Error('storage_boundary_import_owner_mismatch');
  return true;
}
// Decodes every durable read, including phase transitions and compact completion
// markers. Invalid evidence remains on disk and cannot unlock ordinary edits.
/** @param {unknown} value @param {string} owner @returns {StorageBoundary|null} */
export function readStorageBoundary(value,owner) {
  if(value==null)return null;
  const data=assertStorageJson(value);
  if(!boundaryRecord(data,owner))throw new Error('storage_boundary_invalid');
  return data;
}

/** @param {unknown} value @returns {StorageJsonObject} */
export function readStorageState(value) {
  const data=assertStorageJson(value);
  if(!object(data))throw new Error('storage_boundary_state_invalid');
  return data;
}
/** @param {string} role @param {unknown} value @param {{cryptoImpl?:Pick<Crypto,'subtle'>}} [options] */
export function storageV2BootstrapStateHash(role,value,{cryptoImpl=globalThis.crypto}={}) {
  if(role!=='main'&&role!=='shared')throw new Error('storage_bootstrap_role_invalid');
  const state=readStorageState(value);
  if(role==='main')return storageJsonHash(state,cryptoImpl);
  if(!Array.isArray(state.checks)||!Array.isArray(state.bankEvents))throw new Error('storage_bootstrap_shared_state_invalid');
  return storageJsonHash({checks:state.checks,bankEvents:state.bankEvents},cryptoImpl);
}
/** @param {unknown} value @returns {StorageJsonObject} */
export function readSharedChecksState(value) {
  const state=readStorageState(value);
  if(!Array.isArray(state.checks)||!Array.isArray(state.bankEvents))throw new Error('shared_checks_state_invalid');
  const ids=new Set(),sequences=new Set();
  for(const check of state.checks) {
    if(!object(check)||typeof check.id!=='string'||!check.id.trim()||ids.has(check.id))throw new Error('shared_checks_identity_invalid');
    ids.add(check.id);
  }
  for(const event of state.bankEvents) {
    if(!object(event)||!integer(event.seq,1)||typeof event.checkId!=='string'||!event.checkId.trim()||sequences.has(event.seq))throw new Error('shared_checks_bank_event_invalid');
    sequences.add(event.seq);
  }
  return state;
}
/** @param {unknown} value @param {string} error @returns {{seq:number,revision:number}} */
export function readCleanStorageHead(value,error) {
  const cloud=readStorageState(value),base=cloud.base;
  if(!object(base)||!integer(cloud.seq)||!integer(base.revision)||base.ackSeq!==cloud.seq||cloud.pending!==false||cloud.flight||cloud.control)throw new Error(error);
  return {seq:cloud.seq,revision:base.revision};
}
/** @param {unknown} value @returns {number} */
export function readStorageRestoreRevision(value) {
  const revision=typeof value==='string'&&/^(0|[1-9]\d*)$/.test(value)?Number(value):value;
  if(typeof revision!=='number'||!Number.isSafeInteger(revision)||revision<0)throw new Error('storage_restore_v2_revision_invalid');
  return revision;
}

/** @param {string} [domain] @param {{now?:()=>number,random?:()=>number,randomUUID?:(()=>string)|null}|(()=>number)|null} [options] @param {()=>number} [legacyRandom] */
export function createOperationId(domain='sync',options={},legacyRandom) {
  const settings=typeof options==='function'?{now:options,random:legacyRandom}:options||{},now=settings.now||Date.now,random=settings.random||Math.random;
  const randomUUID=Object.hasOwn(settings,'randomUUID')?('randomUUID' in settings?settings.randomUUID:undefined):globalThis.crypto?.randomUUID?.bind(globalThis.crypto);
  if(typeof randomUUID==='function')return `${String(domain||'sync')}:${randomUUID()}`;
  return `${String(domain||'sync')}:${now().toString(36)}:${random().toString(36).slice(2,10)}`;
}
