// @ts-check
/** @typedef {'SCOPE_CHANGED_AFTER_COMMIT'|'ACK_COMMITTED_PUBLICATION_STALE'|'ACK_PUBLICATION_EXCEPTION'} PublicationPhase */
/** @typedef {{baseRevision?:unknown,ackRevision?:unknown,endSeq?:unknown,candidateSeq?:unknown,observedSeq?:unknown}} DiagnosticInput */

// Explicit scalar allowlist: never serialize a head, snapshot, owner, operation
// ID or exception message. Diagnostics are observations, never retry/ACK policy.
/** @param {PublicationPhase} phase @param {DiagnosticInput} input */
export function cloudAckPublicationDiagnostic(phase,input){
  const result={phase,errorCode:phase==='SCOPE_CHANGED_AFTER_COMMIT'?'cloud_sync_scope_changed':phase==='ACK_PUBLICATION_EXCEPTION'?'cloud_ack_publication_exception':'cloud_ack_publication_stale'};
  /** @type {Record<string,unknown>} */ const diagnostic={...result};
  for(const key of /** @type {const} */ (['baseRevision','ackRevision','endSeq','candidateSeq','observedSeq'])){
    const value=input[key];
    if(typeof value==='number'&&Number.isSafeInteger(value)&&value>=0)diagnostic[key]=value;
  }
  return diagnostic;
}
