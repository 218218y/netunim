// @ts-check
import {readStorageOperation} from './storage-operation.js';
import {sealStorageJsonRecord,assertStorageJson} from './storage-json-codec.js';
import {readStorageCloudBase,readStorageCloudFlight,readStorageCloudControl} from './storage-cloud-records.js';
import {STORAGE_SCHEMAS,SHARED_CHECKS_STORAGE_SCHEMA} from './storage-v2-schema.js';

/** @typedef {import('./storage-json.js').StorageJsonObject} JsonObject */
/** @typedef {JsonObject & {seq:number,checkpointChecksum:string}} Head */
/** @typedef {Head & {baseChecksum:string,controlChecksum:string|null}} CloudHead */
/** @typedef {Head & {epoch:string}} LocalHead */

/** @param {string} owner @param {import('./storage-operation.js').StorageOperationSchema} [configuredSchema] @returns {import('./storage-operation.js').StorageOperationSchema} */
function schemaForOwner(owner,configuredSchema){
  const separator=owner.lastIndexOf(':');
  const domain=owner.slice(separator+1);
  if(separator>0&&(domain==='orders'||domain==='kupa'))return STORAGE_SCHEMAS[domain];
  if(separator>0&&domain==='shared-checks')return SHARED_CHECKS_STORAGE_SCHEMA;
  if(configuredSchema)return configuredSchema;
  throw new Error('storage_journal_owner_schema_required');
}

// Every current IDB journal writer uses this boundary, independently of caller
// validation. Capture synchronously, before opening/queuing a transaction.
/** @param {unknown} record @param {string} owner @param {string} epoch
 * @param {import('./storage-operation.js').StorageOperationSchema} [configuredSchema]
 * @returns {import('./storage-json-codec.js').SealedStorageRecord<import('./storage-operation.js').StoredStorageOperation>}
 */
export function captureStorageJournalOperation(record,owner,epoch,configuredSchema){
  const operation=readStorageOperation(structuredClone(record),schemaForOwner(owner,configuredSchema));
  if(operation.owner!==owner||operation.epoch!==epoch)throw new Error('storage_owner_mismatch');
  return sealStorageJsonRecord(operation);
}

// These are caller inputs, not persisted-head recovery. Capture and decode
// before IDB open/queueing; transactional owner/writer/range checks stay in IDB.
/** @param {unknown} record */
export function captureStorageCloudBase(record){return sealStorageJsonRecord(readStorageCloudBase(structuredClone(record)))}
/** @param {unknown} record */
export function captureStorageCloudFlight(record){return sealStorageJsonRecord(readStorageCloudFlight(structuredClone(record)))}
/** @param {unknown} record */
export function captureStorageCloudControl(record){return sealStorageJsonRecord(readStorageCloudControl(structuredClone(record)))}
/** @param {unknown} value @returns {import('./storage-json.js').StorageJsonObject} */
export function captureStorageJournalPayload(value){
  const data=assertStorageJson(structuredClone(value));
  if(data===null||typeof data!=='object'||Array.isArray(data))throw new Error('storage_journal_payload_invalid');
  return data;
}
/** @param {unknown} value @returns {value is number} */
function sequence(value){return typeof value==='number'&&Number.isSafeInteger(value)&&value>=0}
/** @param {unknown} value @returns {value is string} */
function text(value){return typeof value==='string'&&value.trim().length>0}
/** @param {unknown} value @returns {Head} */
function head(value){
  const data=captureStorageJournalPayload(value);
  if(!sequence(data.seq)||!text(data.checkpointChecksum))throw new Error('storage_journal_precondition_invalid');
  return {...data,seq:data.seq,checkpointChecksum:data.checkpointChecksum};
}
/** @param {unknown} value @returns {CloudHead|null} */
export function captureStorageExpectedHead(value){
  if(value===null)return null;
  const data=head(value);
  if(!text(data.baseChecksum)||!(data.controlChecksum===null||text(data.controlChecksum)))throw new Error('storage_journal_precondition_invalid');
  return {...data,baseChecksum:data.baseChecksum,controlChecksum:data.controlChecksum};
}
/** @param {unknown} value */
export function captureStorageRecoveryHead(value){
  const data=captureStorageExpectedHead(value);
  if(!data||!text(data.owner)||!text(data.epoch)||!sequence(data.baseRevision)||!sequence(data.ackSeq)||data.ackSeq>data.seq)throw new Error('storage_cloud_recovery_head_required');
  return {...data,owner:data.owner,epoch:data.epoch,baseRevision:data.baseRevision,ackSeq:data.ackSeq};
}
/** @param {unknown} value @returns {LocalHead|null} */
export function captureStorageLocalHead(value){
  if(value===null)return null;
  const data=head(value);
  if(!text(data.epoch))throw new Error('storage_journal_precondition_invalid');
  return {...data,epoch:data.epoch};
}
/** @param {unknown} value */
export function captureStorageCleanHead(value){
  const data=captureStorageLocalHead(value);
  if(!data)return null;
  if(!sequence(data.revision))throw new Error('storage_journal_precondition_invalid');
  return {...data,revision:data.revision};
}

/** Selective durable-authority decisions. All callers pass already-decoded
 * records inside the same IDB transaction as the write. Capture, cloud-head
 * decoding, writer fences and physical journal-key checks retain their owners.
 * @typedef {{owner:string,epoch:string,seq:number}} JournalDecisionScope
 * @typedef {Pick<import('./storage-checkpoint.js').StoredStorageCheckpoint,'owner'|'epoch'|'seq'>} DecisionCheckpoint
 * @typedef {Pick<import('./storage-cloud-records.js').StoredCloudBase,'owner'|'epoch'|'revision'|'ackSeq'>} DecisionBase
 */

/** @param {string} owner @param {DecisionCheckpoint} checkpoint
 * @param {string|null} observedEpoch @param {string|null} expectedEpoch @param {boolean} hasFlight */
export function assertStorageJournalInstall(owner,checkpoint,observedEpoch,expectedEpoch,hasFlight){
  if(observedEpoch!==expectedEpoch)throw new Error('storage_checkpoint_race');
  if(hasFlight)throw new Error('storage_restore_flight_pending');
  if(checkpoint.owner!==owner)throw new Error('storage_owner_mismatch');
}

/** @param {string} owner @param {DecisionCheckpoint} checkpoint @param {DecisionBase} base
 * @param {DecisionCheckpoint|null} entry */
export function assertStorageJournalInitialization(owner,checkpoint,base,entry){
  if(checkpoint.owner!==owner||base.owner!==owner||checkpoint.epoch!==base.epoch||checkpoint.seq!==0||
    base.ackSeq!==0||!Number.isSafeInteger(base.revision)||base.revision<0)throw new Error('storage_initialization_invalid');
  if(entry&&(entry.owner!==owner||entry.epoch!==checkpoint.epoch||entry.seq!==1))throw new Error('storage_initialization_invalid');
}

/** @param {JournalDecisionScope} scope @param {DecisionCheckpoint} checkpoint
 * @param {number} priorSeq @param {number|null} ackSeq */
export function storageJournalCompactionThrough(scope,checkpoint,priorSeq,ackSeq){
  if(checkpoint.owner!==scope.owner||checkpoint.epoch!==scope.epoch||checkpoint.seq<priorSeq||checkpoint.seq>scope.seq){
    throw new Error('storage_compaction_range');
  }
  return ackSeq===null?checkpoint.seq:Math.min(checkpoint.seq,ackSeq);
}

/** @param {JournalDecisionScope} scope @param {DecisionCheckpoint} checkpoint */
export function assertStorageJournalAckCheckpoint(scope,checkpoint){
  if(checkpoint.owner!==scope.owner||checkpoint.epoch!==scope.epoch||checkpoint.seq!==scope.seq){
    throw Object.assign(new Error('storage_checkpoint_stale'),{
      code:'storage_ack_checkpoint_stale',candidateSeq:checkpoint.seq,observedSeq:scope.seq,
    });
  }
}

/** @param {JournalDecisionScope} scope @param {DecisionCheckpoint} checkpoint
 * @param {DecisionBase} base @param {DecisionBase|null} prior @param {boolean} conflict */
export function assertStorageJournalAdoption(scope,checkpoint,base,prior,conflict){
  if(!prior||prior.ackSeq!==scope.seq||conflict)throw new Error('storage_cloud_pending');
  if(checkpoint.owner!==scope.owner||checkpoint.epoch!==scope.epoch||checkpoint.seq!==scope.seq)throw new Error('storage_checkpoint_stale');
  if(base.owner!==scope.owner||base.epoch!==scope.epoch||base.ackSeq!==scope.seq||!Number.isSafeInteger(base.revision)||base.revision<prior.revision)throw new Error('storage_cloud_base_mismatch');
}

/** @param {string} owner @param {DecisionCheckpoint} checkpoint @param {DecisionBase} base */
export function assertStorageJournalCloudReset(owner,checkpoint,base){
  if(checkpoint.owner!==owner||base.owner!==owner||checkpoint.epoch!==base.epoch||checkpoint.seq!==0||
    base.ackSeq!==0||!Number.isSafeInteger(base.revision)||base.revision<0)throw new Error('storage_cloud_reset_invalid');
}
