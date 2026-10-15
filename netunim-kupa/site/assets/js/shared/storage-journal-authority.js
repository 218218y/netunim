// @ts-check
import {readStorageOperation} from './storage-operation.js';
import {sealStorageJsonRecord} from './storage-json-codec.js';
import {STORAGE_SCHEMAS,SHARED_CHECKS_STORAGE_SCHEMA} from './storage-v2-schema.js';

/** @param {string} owner @returns {import('./storage-operation.js').StorageOperationSchema} */
function schemaForOwner(owner){
  const separator=owner.lastIndexOf(':');
  if(separator<=0)throw new Error('storage_journal_owner_schema_required');
  const domain=owner.slice(separator+1);
  if(domain==='orders'||domain==='kupa')return STORAGE_SCHEMAS[domain];
  if(domain==='shared-checks')return SHARED_CHECKS_STORAGE_SCHEMA;
  throw new Error('storage_journal_owner_schema_required');
}

// Every current IDB journal writer uses this boundary, independently of caller
// validation. Capture synchronously, before opening/queuing a transaction.
/** @param {unknown} record @param {string} owner @param {string} epoch
 * @returns {import('./storage-json-codec.js').SealedStorageRecord<import('./storage-operation.js').StoredStorageOperation>}
 */
export function captureStorageJournalOperation(record,owner,epoch){
  const operation=readStorageOperation(structuredClone(record),schemaForOwner(owner));
  if(operation.owner!==owner||operation.epoch!==epoch)throw new Error('storage_owner_mismatch');
  return sealStorageJsonRecord(operation);
}
