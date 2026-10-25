// @ts-check

/**
 * @typedef {{owner:string,epoch:string,seq:number,baseRevision:number,ackSeq:number,checkpointChecksum:string,baseChecksum:string,controlChecksum:string|null}} CloudRecoveryHead
 */
/**
 * A recovery checkpoint changes only the projection at the captured local
 * sequence. It cannot ACK more work, replace a base, or retire another fence.
 * @param {{seq:number,base:{owner:string,epoch:string,revision:number,ackSeq:number}|null,flight:unknown,control:{retry?:unknown,conflict?:{kind?:unknown,currentRemoteRevision?:unknown}|null}|null}} head
 * @param {CloudRecoveryHead} expected
 * @param {'concurrent-ack'|null} conflictKind
 */
export function assertCloudRecoveryHead(head,expected,conflictKind){
  const base=head.base;
  if(!base||!expected||base.owner!==expected.owner||base.epoch!==expected.epoch||head.seq!==expected.seq||base.revision!==expected.baseRevision||base.ackSeq!==expected.ackSeq||head.flight||head.control?.retry)throw Object.assign(new Error('storage_cloud_recovery_stale'),{code:'storage_cloud_recovery_stale'});
  if(!Number.isSafeInteger(expected.seq)||expected.seq<0||!Number.isSafeInteger(expected.baseRevision)||expected.baseRevision<0||!Number.isSafeInteger(expected.ackSeq)||expected.ackSeq<0||expected.ackSeq>expected.seq||!expected.checkpointChecksum||!expected.baseChecksum)throw new Error('storage_cloud_recovery_head_required');
  if(conflictKind===null?!!head.control:conflictKind!=='concurrent-ack'||head.control?.conflict?.kind!==conflictKind||head.control.conflict.currentRemoteRevision!==base.revision)throw new Error('storage_cloud_recovery_control');
}
