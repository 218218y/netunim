// @ts-check
import {assertStorageJson,readStorageJsonRecord} from './storage-json-codec.js';
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
