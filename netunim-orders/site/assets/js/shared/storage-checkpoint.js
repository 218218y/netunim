// @ts-check
import {readStorageJsonRecord} from './storage-json-codec.js';

/**
 * A reader contract, deliberately distinct from the current writer contract:
 * historical metadata can be absent/null, and savedAt is not recovery authority.
 * No defaults, rewriting or business-schema inference happen during decoding.
 * @typedef {import('./storage-json.js').StorageJson} StorageJson
 * @typedef {import('./storage-json.js').StorageJsonObject} StorageJsonObject
 * @typedef {StorageJsonObject & {version: 2, owner: string, epoch: string, seq: number, state: StorageJsonObject, appMetadata?: StorageJsonObject | null}} StoredStorageCheckpoint
 */

/** @param {StorageJson | undefined} value @returns {value is StorageJsonObject} */
function object(value){return value!==null&&typeof value==='object'&&!Array.isArray(value)}
/** @param {StorageJson | undefined} value @returns {value is string} */
function identity(value){return typeof value==='string'&&value.length>0&&value.length<=512}

/** @param {StorageJson} value @returns {value is StoredStorageCheckpoint} */
function checkpoint(value){
  return object(value)&&value.version===2&&identity(value.owner)&&identity(value.epoch)&&
    typeof value.seq==='number'&&Number.isSafeInteger(value.seq)&&value.seq>=0&&object(value.state)&&
    (value.appMetadata==null||object(value.appMetadata));
}

/** @param {unknown} record @returns {StoredStorageCheckpoint} */
export function readStorageCheckpoint(record){
  const data=readStorageJsonRecord(record);
  if(!checkpoint(data))throw new Error('storage_invalid_checkpoint');
  return data;
}
