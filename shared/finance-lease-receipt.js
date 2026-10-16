// @ts-check
import {evidenceTimestamp} from './response-evidence.js';
/** @typedef {'bank' | 'credit'} FinanceLeaseName */
/** @typedef {Readonly<{acquired: true, leaseName: FinanceLeaseName, leaseToken: string, fenceEpoch: number, leasedUntil: string}> | Readonly<{acquired: false, leaseName: FinanceLeaseName, leaseToken: string, fenceEpoch: number, leasedUntil: string}>} FinanceLeaseReceipt */

/** @param {unknown} value @returns {value is Record<string, unknown>} */
function leaseReceiptObject(value){return value!==null&&typeof value==='object'&&!Array.isArray(value)}
/** @param {unknown} value @returns {value is string} */
function leaseReceiptToken(value){return typeof value==='string'&&value.trim().length>0&&value.length<=200}

/**
 * An HTTP success must prove the requested token acquired the server fence.
 * A refusal legitimately names another holder; it never authorizes work.
 * The timestamp is server evidence, not a client-clock expiry decision.
 * Nothing here grants a document ACK, starts a provider or retries a claim.
 * @param {unknown} response
 * @param {{leaseName: FinanceLeaseName, leaseToken: string}} requested
 * @returns {FinanceLeaseReceipt}
 */
export function readFinanceLeaseReceipt(response,{leaseName,leaseToken}){
  try{
    const row=Array.isArray(response)?(response.length===1?response[0]:null):response;
    if((leaseName!=='bank'&&leaseName!=='credit')||!leaseReceiptToken(leaseToken)||!leaseReceiptObject(row)||
      typeof row.acquired!=='boolean'||!leaseReceiptToken(row.lease_token)||
      row.acquired&&row.lease_token!==leaseToken||
      !(typeof row.fence_epoch==='number'||typeof row.fence_epoch==='string'&&/^\d+$/.test(row.fence_epoch))||
      !evidenceTimestamp(row.leased_until)){
      throw new Error('finance_lease_receipt_metadata_invalid');
    }
    const fenceEpoch=Number(row.fence_epoch);
    if(!Number.isSafeInteger(fenceEpoch)||fenceEpoch<1)throw new Error('finance_lease_receipt_fence_invalid');
    return Object.freeze({acquired:row.acquired,leaseName,leaseToken:row.lease_token,fenceEpoch,leasedUntil:row.leased_until});
  }catch(cause){
    throw Object.assign(new Error('לא התקבל אישור תקין לנעילת הסינכרון מהענן. לא נפתחה כניסה לבנק או לחברת האשראי. יש לבדוק את החיבור לפני ניסיון נוסף.',{cause}),{
      code:'FINANCE_LEASE_RECEIPT_INVALID',kind:'confirmation_unknown',retryable:false,
    });
  }
}
