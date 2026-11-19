// @ts-check

/**
 * @typedef {{owner:string,epoch:string,seq:number,baseRevision:number,ackSeq:number,checkpointChecksum:string,baseChecksum:string,controlChecksum:string|null}} CloudRecoveryHead
 * @typedef {'concurrent-ack'|'shared-checks-entity'} CloudRecoveryKind
 */
/**
 * A recovery checkpoint changes only the projection at the captured local
 * sequence. It cannot ACK more work, replace a base, or retire another fence.
 * @param {{seq:number,base:{owner:string,epoch:string,revision:number,ackSeq:number}|null,flight:unknown,control:{retry?:unknown,conflict?:{kind?:unknown,domain?:unknown,currentRemoteRevision?:unknown}|null}|null}} head
 * @param {CloudRecoveryHead} expected
 * @param {CloudRecoveryKind|null} conflictKind
 */
export function assertCloudRecoveryHead(head,expected,conflictKind){
  const base=head.base;
  if(!base||!expected||base.owner!==expected.owner||base.epoch!==expected.epoch||head.seq!==expected.seq||base.revision!==expected.baseRevision||base.ackSeq!==expected.ackSeq||head.flight||head.control?.retry)throw Object.assign(new Error('storage_cloud_recovery_stale'),{code:'storage_cloud_recovery_stale'});
  if(!Number.isSafeInteger(expected.seq)||expected.seq<0||!Number.isSafeInteger(expected.baseRevision)||expected.baseRevision<0||!Number.isSafeInteger(expected.ackSeq)||expected.ackSeq<0||expected.ackSeq>expected.seq||!expected.checkpointChecksum||!expected.baseChecksum)throw new Error('storage_cloud_recovery_head_required');
  const conflict=head.control?.conflict;
  const matches=conflictKind==='concurrent-ack'&&conflict?.kind==='concurrent-ack'||
    conflictKind==='shared-checks-entity'&&base.owner.endsWith(':shared-checks')&&expected.seq>expected.ackSeq&&
    conflict?.kind==='entity-conflict'&&conflict.domain==='shared-checks';
  if(conflictKind===null?!!head.control:!matches||conflict?.currentRemoteRevision!==base.revision)throw new Error('storage_cloud_recovery_control');
}
