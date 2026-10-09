// @ts-check

/**
 * @template T
 * @typedef {{committed:T,published:true}|{committed:T,published:false,reason:'stale'}|{committed:T,published:false,reason:'publication-error',error:unknown}} CloudPublicationReceipt
 */

/**
 * Commit the reconciled cloud cursor/checkpoint before publishing its view.
 * A failed commit keeps its original error. A concurrent local head prevents
 * publication; the caller owns fencing and recovery, never replaying the ACK.
 * @template T
 * Publication must finish synchronously. A Promise would escape the receipt's
 * error boundary; `undefined` rejects async callbacks which `void` accepts.
 * @param {{commit:()=>Promise<T>,isCurrent:(committed:T)=>boolean,publish:()=>undefined}} ports
 * @returns {Promise<CloudPublicationReceipt<T>>}
 */
export async function commitCloudCheckpoint({commit,isCurrent,publish}){
  const committed=await commit();
  if(!isCurrent(committed))return {committed,published:false,reason:'stale'};
  // Publication is a distinct post-commit phase. Its failure cannot turn a
  // durable ACK into another write; retain the receipt and original cause.
  try{publish()}catch(error){return {committed,published:false,reason:'publication-error',error}}
  return {committed,published:true};
}
