// @ts-check
import {evidenceObject as object} from './response-evidence.js';

/** @returns {never} */
function invalid(){throw Object.assign(new Error('Credit transaction evidence is invalid'),{code:'CREDIT_REFRESH_RESULT_INVALID',retryable:false})}
/** Current Bridge contract is v2. Unversioned/v1 responses are the supported
 * legacy protocol and alone may omit transaction status. An unknown supplied
 * status is never legacy compatibility. Persisted feed readers are separate.
 * @param {unknown} version @returns {1|2} */
export function creditResponseProtocol(version){
  if(version===undefined||version===1)return 1;
  if(version===2)return 2;
  return invalid();
}
/** Validate every representation before a feed normalizer can deduplicate it.
 * @param {Record<string,unknown>} profile @param {1|2} protocol */
export function assertCreditProfileTransactions(profile,protocol){
  if(profile.accounts===undefined)return;
  if(!Array.isArray(profile.accounts))return invalid();
  for(const account of Array.from(profile.accounts)){
    if(!object(account))return invalid();
    for(const field of ['txns','pendingTransactions','unassignedTransactions']){
      transactions(account[field],protocol);
    }
    if(account.months===undefined)continue;
    if(!Array.isArray(account.months))return invalid();
    for(const month of Array.from(account.months)){
      if(!object(month))return invalid();
      transactions(month.transactions,protocol);
    }
  }
}
/** @param {unknown} value @param {1|2} protocol */
function transactions(value,protocol){
  if(value===undefined)return;
  if(!Array.isArray(value))return invalid();
  for(const tx of Array.from(value)){
    if(!object(tx)||!(tx.status==='pending'||tx.status==='completed'||protocol===1&&tx.status===undefined))invalid();
  }
}
