// @ts-check

/**
 * @typedef {import('./storage-records.js').StorageScope} StorageScope
 * @typedef {Pick<import('./storage-records.js').StorageCloudBase<import('./storage-records.js').StorageJsonObject>,'owner'|'epoch'|'revision'|'ackSeq'>} StorageAckCursor
 * @typedef {Pick<import('./storage-records.js').StorageCloudFlight<import('./storage-records.js').StorageJsonObject>,'baseRevision'|'endSeq'>} StorageAckFlight
 */

// Called inside the existing IDB transaction after writer fencing, operation-ID
// matching and checksum reads. It grants no commit/publication by itself.
/** @param {StorageAckCursor} acknowledged @param {StorageAckFlight} flight @param {StorageScope} scope */
export function assertStorageCloudAck(acknowledged,flight,{owner,epoch}){
  // An idempotent no-op can retain the revision. The cloud protocol validates
  // its response semantics; the durable cursor must only reject regression.
  if(acknowledged.owner!==owner||acknowledged.epoch!==epoch||!Number.isSafeInteger(acknowledged.revision)||acknowledged.revision<flight.baseRevision||acknowledged.ackSeq!==flight.endSeq)throw new Error('storage_ack_revision');
}
