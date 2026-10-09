// @ts-check

/**
 * A status read needs cursor evidence, not the whole persisted checkpoint.
 * State/Flight validation remains the journal owner's responsibility.
 * @typedef {import('./storage-cloud-ack.js').StorageAckCursor} CloudCursor
 * @typedef {{seq:number,base:CloudCursor|null,pending:boolean,flight:object|null,control:object|null}} CloudStatusHead
 * @typedef {{seq:number,base:{owner:string,epoch:string}|null}} ObservedCloudHead
 */

// A scoped, validated journal read or committed ACK receipt is the evidence for
// Main status. A remote GET alone does not acknowledge local work. Callers must
// also check live access, generation and their visible cloud projection.
/**
 * @param {CloudStatusHead|null|undefined} head
 * @param {{revision?:number,observedHead?:ObservedCloudHead|null}} [options]
 * @returns {boolean}
 */
export function cloudHeadIsSynced(head,{revision,observedHead=null}={}){
  const base=head?.base;
  if(!base||head.pending!==false||head.flight||head.control)return false;
  if(!Number.isSafeInteger(head.seq)||head.seq<0||base.ackSeq!==head.seq)return false;
  if(!Number.isSafeInteger(base.revision)||base.revision<0||base.revision!==revision)return false;
  if(observedHead&&(head.seq!==observedHead.seq||base.owner!==observedHead.base?.owner||base.epoch!==observedHead.base?.epoch))return false;
  return true;
}
