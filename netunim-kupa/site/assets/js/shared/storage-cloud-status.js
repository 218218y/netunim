// A scoped, validated journal read or committed ACK receipt is the evidence for
// Main status. A remote GET alone does not acknowledge local work. Callers must
// also check live access, generation and their visible cloud projection.
export function cloudHeadIsSynced(head,{revision,observedHead=null}={}){
  const base=head?.base;
  if(!base||head.pending!==false||head.flight||head.control)return false;
  if(!Number.isSafeInteger(head.seq)||head.seq<0||base.ackSeq!==head.seq)return false;
  if(!Number.isSafeInteger(base.revision)||base.revision<0||base.revision!==revision)return false;
  if(observedHead&&(head.seq!==observedHead.seq||base.owner!==observedHead.base?.owner||base.epoch!==observedHead.base?.epoch))return false;
  return true;
}
