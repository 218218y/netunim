// @ts-check
import {evidenceObject as object} from './response-evidence.js';

/** @returns {never} */
function invalid(){throw Object.assign(new Error('Credit transaction evidence is invalid'),{code:'CREDIT_REFRESH_RESULT_INVALID',retryable:false})}
/** The production handshake requires v2. Older responses can omit the envelope
 * version, but cannot downgrade transaction evidence to persisted-feed rules.
 * @param {unknown} version @returns {2} */
export function creditResponseProtocol(version){
  if(version===undefined||version===2)return 2;
  return invalid();
}
/** Validate every representation before a feed normalizer can deduplicate it.
 * @param {Record<string,unknown>} profile */
export function assertCreditProfileTransactions(profile){
  if(profile.accounts===undefined)return;
  if(!Array.isArray(profile.accounts))return invalid();
  for(const account of Array.from(profile.accounts)){
    if(!object(account))return invalid();
    for(const field of ['txns','pendingTransactions','unassignedTransactions']){
      transactions(account[field]);
    }
    if(account.months===undefined)continue;
    if(!Array.isArray(account.months))return invalid();
    for(const month of Array.from(account.months)){
      if(!object(month))return invalid();
      transactions(month.transactions);
    }
  }
}
/** @param {unknown} value */
function transactions(value){
  if(value===undefined)return;
  if(!Array.isArray(value))return invalid();
  for(const tx of Array.from(value)){
    if(!object(tx)||!(tx.status==='pending'||tx.status==='completed'))invalid();
  }
}
