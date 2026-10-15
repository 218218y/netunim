// @ts-check
import {readStorageJsonRecord,sealStorageJsonRecord} from './storage-json-codec.js';

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

// Capture before an IDB-open await: callers cannot change the accepted command
// while its transaction is waiting. Preserve historical reader metadata.
/** @param {unknown} record */
export function captureStorageCheckpoint(record){return sealStorageJsonRecord(structuredClone(readStorageCheckpoint(record)))}

/** @typedef {[string,string,number]} StorageJournalKey */
/**
 * Proves deletion scope, not the application's operation/business schema.
 * Payload fields alone cannot identify the physical row to retire.
 * @param {unknown} records @param {unknown} physicalKeys @param {string} owner
 * @returns {StorageJournalKey[]}
 */
export function readStorageJournalDeletionKeys(records,physicalKeys,owner){
  if(!identity(owner)||!Array.isArray(records)||!Array.isArray(physicalKeys)||records.length!==physicalKeys.length)throw new Error('storage_journal_key_mismatch');
  return records.map((record,index)=>{
    const data=readStorageJsonRecord(record),key=physicalKeys[index];
    if(!object(data)||data.version!==2||data.owner!==owner||!identity(data.epoch)||typeof data.seq!=='number'||!Number.isSafeInteger(data.seq)||data.seq<1||
      !Array.isArray(key)||key.length!==3||key[0]!==owner||key[1]!==data.epoch||key[2]!==data.seq)throw new Error('storage_journal_key_mismatch');
    return [owner,data.epoch,data.seq];
  });
}
