// @ts-check
import {readStorageJsonRecord} from './storage-json-codec.js';

/**
 * Readers preserve historical optional/null annotations. Current writers keep
 * their stronger contract in storage-records; decoding never repairs a record.
 * @typedef {import('./storage-json.js').StorageJson} StorageJson
 * @typedef {import('./storage-json.js').StorageJsonObject} StorageJsonObject
 * @typedef {import('./storage-records.js').StorageDeleteIntents} StorageDeleteIntents
 * @typedef {StorageJsonObject & {version:2,owner:string,epoch:string,revision:number,ackSeq:number,state:StorageJsonObject,projection?:'cloud'|null}} StoredCloudBase
 * @typedef {StorageJsonObject & {version:2,owner:string,epoch:string,operationId:string,baseRevision:number,startSeq:number,endSeq:number,snapshot:StorageJsonObject,generation?:number|null,deleteIntents?:StorageDeleteIntents|null,surface?:string|null,mutationType?:string|null,audit?:StorageJsonObject|null}} StoredCloudFlight
 * @typedef {StorageJsonObject & {attempts?:number|null,nextAttemptAt?:string|null,lastAttemptAt?:string|null,lastErrorCode?:string|null}} StoredCloudRetry
 * @typedef {StorageJsonObject & {version:2,owner:string,epoch:string,updatedAt?:string|null,retry?:StoredCloudRetry|null,conflict?:StorageJsonObject|null}} StoredCloudControl
 * @typedef {{owner:string,epoch:string,seq:number}} CloudRecordScope
 * @typedef {{base?:unknown,flight?:unknown,control?:unknown}} SealedCloudHead
 */

// Provenance matters: an invalid persisted head is corruption, whereas a
// generic optimistic-precondition error with the same code may be retryable.
export class StorageCloudRecordError extends Error {
  /** @param {string} code */
  constructor(code){super(code)}
}
/** @param {StorageJson | undefined} value @returns {value is StorageJsonObject} */
function object(value){return value!==null&&typeof value==='object'&&!Array.isArray(value)}
/** @param {StorageJson | undefined} value @returns {value is string} */
function identity(value){return typeof value==='string'&&value.length>0&&value.length<=512}
/** @param {unknown} value @param {number} [min] @returns {value is number} */
function integer(value,min=0){return typeof value==='number'&&Number.isSafeInteger(value)&&value>=min}
/** @param {StorageJson | undefined} value */
function nullableText(value){return value==null||typeof value==='string'}
/** @param {StorageJsonObject} value */
function scopedVersion(value){return value.version===2&&identity(value.owner)&&identity(value.epoch)}

/** @param {StorageJson} value @returns {value is StoredCloudBase} */
function base(value){
  if(!object(value)||!scopedVersion(value)||!integer(value.revision)||!integer(value.ackSeq)||!object(value.state)||(value.projection!=null&&value.projection!=='cloud'))throw new StorageCloudRecordError('storage_invalid_cloud_base');
  return true;
}
/** @param {StorageJson} value @returns {value is StoredCloudFlight} */
function flight(value){
  if(!object(value)||!scopedVersion(value)||!identity(value.operationId)||!value.operationId.trim()||!integer(value.baseRevision)||!integer(value.startSeq,1)||!integer(value.endSeq,1)||value.endSeq<value.startSeq||!object(value.snapshot)||
    (value.generation!=null&&!integer(value.generation))||!nullableText(value.surface)||!nullableText(value.mutationType)||(value.audit!=null&&!object(value.audit)))throw new StorageCloudRecordError('storage_invalid_cloud_flight');
  if(value.deleteIntents!=null){
    if(!object(value.deleteIntents))throw new StorageCloudRecordError('storage_invalid_cloud_flight');
    // Older flights retained caller ordering/duplicates. These annotations do
    // not authorize journal deletion; preserve their bytes and immutable ID.
    for(const [collection,ids] of Object.entries(value.deleteIntents))if(!identity(collection)||!Array.isArray(ids)||ids.some(id=>!identity(id)))throw new StorageCloudRecordError('storage_invalid_cloud_flight');
  }
  return true;
}
/** @param {StorageJson} value @returns {value is StoredCloudControl} */
function control(value){
  if(!object(value)||!scopedVersion(value)||!nullableText(value.updatedAt)||(value.conflict!=null&&!object(value.conflict)))throw new StorageCloudRecordError('storage_invalid_cloud_control');
  if(value.retry!=null){
    const retry=value.retry;
    if(!object(retry)||(retry.attempts!=null&&!integer(retry.attempts))||!nullableText(retry.lastErrorCode)||!nullableText(retry.lastAttemptAt)||
      (retry.nextAttemptAt!=null&&(typeof retry.nextAttemptAt!=='string'||!Number.isFinite(Date.parse(retry.nextAttemptAt)))))throw new StorageCloudRecordError('storage_invalid_cloud_control');
  }
  return true;
}

/** @param {unknown} record @returns {StoredCloudBase} */
export function readStorageCloudBase(record){const data=readStorageJsonRecord(record);if(!base(data))throw new StorageCloudRecordError('storage_invalid_cloud_base');return data}
/** @param {unknown} record @returns {StoredCloudFlight} */
export function readStorageCloudFlight(record){const data=readStorageJsonRecord(record);if(!flight(data))throw new StorageCloudRecordError('storage_invalid_cloud_flight');return data}
/** @param {unknown} record @returns {StoredCloudControl} */
export function readStorageCloudControl(record){const data=readStorageJsonRecord(record);if(!control(data))throw new StorageCloudRecordError('storage_invalid_cloud_control');return data}

// One decision for recovery, pending/status, retained-flight replay and IDB
// transactions. Business projection validation remains with the app owner.
/** @param {SealedCloudHead} records @param {CloudRecordScope} scope */
export function readStorageCloudHead({base:sealedBase,flight:sealedFlight,control:sealedControl},{owner,epoch,seq}){
  if(!integer(seq))throw new StorageCloudRecordError('storage_committed_metadata_mismatch');
  const base=sealedBase==null?null:readStorageCloudBase(sealedBase),flight=sealedFlight==null?null:readStorageCloudFlight(sealedFlight),control=sealedControl==null?null:readStorageCloudControl(sealedControl);
  if(base&&(base.owner!==owner||base.epoch!==epoch||base.ackSeq>seq))throw new StorageCloudRecordError('storage_cloud_base_mismatch');
  if(flight&&(!base||flight.owner!==owner||flight.epoch!==epoch||flight.baseRevision!==base.revision||flight.startSeq!==base.ackSeq+1||flight.endSeq>seq))throw new StorageCloudRecordError('storage_cloud_flight_mismatch');
  if(control&&(control.owner!==owner||control.epoch!==epoch))throw new StorageCloudRecordError('storage_control_scope');
  return {seq,base,flight,control};
}
