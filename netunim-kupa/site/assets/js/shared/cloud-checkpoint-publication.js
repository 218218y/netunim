// @ts-check

/**
 * Commit the reconciled cloud cursor/checkpoint before publishing its view.
 * A failed commit keeps its original error. A concurrent local head prevents
 * publication; the caller owns fencing and recovery, never replaying the ACK.
 * @template T
 * @param {{commit:()=>Promise<T>,isCurrent:(committed:T)=>boolean,publish:()=>void}} ports
 * @returns {Promise<{committed:T,published:true}|{committed:T,published:false,reason:'stale'}|{committed:T,published:false,reason:'publication-error',error:unknown}>}
 */
export async function commitCloudCheckpoint({commit,isCurrent,publish}){
  const committed=await commit();
  if(!isCurrent(committed))return {committed,published:false,reason:'stale'};
  // Publication is a distinct post-commit phase. Its failure cannot turn a
  // durable ACK into another write; retain the receipt and original cause.
  try{publish()}catch(error){return {committed,published:false,reason:'publication-error',error}}
  return {committed,published:true};
}
