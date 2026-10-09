// @ts-check

/** @typedef {Readonly<{finance_revision: number, kupa_revision: number, [key: string]: unknown}>} BankSnapshotReceipt */
/** @param {unknown} value @returns {value is Record<string, unknown>} */
function object(value){return value!==null&&typeof value==='object'&&!Array.isArray(value)}
/** @param {unknown} value @returns {value is number} */
function revision(value){return typeof value==='number'&&Number.isSafeInteger(value)&&value>0}

/**
 * The atomic Bank RPC acknowledges two independent documents, not a Main
 * journal flight. HTTP success alone cannot prove either commit. An invalid
 * reply leaves the server outcome unknown; never retry a provider scan here.
 * @param {unknown} response
 * @returns {BankSnapshotReceipt}
 */
export function readBankSnapshotReceipt(response){
  const row=Array.isArray(response)?(response.length===1?response[0]:null):response;
  if(!object(row)||!revision(row.finance_revision)||!revision(row.kupa_revision)){
    throw Object.assign(new Error('לא התקבל אישור תקין לשמירת צילום הבנק. ייתכן שהשרת שמר את הנתונים. יש לרענן מהענן לפני סריקה נוספת.'),{
      code:'BANK_SNAPSHOT_RECEIPT_INVALID',kind:'confirmation_unknown',retryable:false,
    });
  }
  return Object.freeze({...row,finance_revision:row.finance_revision,kupa_revision:row.kupa_revision});
}

/**
 * A confirmed atomic commit remains committed when a later readout is stale.
 * This predicate grants display freshness only, never a journal ACK.
 * @param {BankSnapshotReceipt} receipt
 * @param {unknown} readout
 * @returns {boolean}
 */
export function bankSnapshotReadoutIsCurrent(receipt,readout){
  return object(readout)&&readout.verified===true&&revision(readout.revision)&&revision(readout.financeRevision)&&
    readout.revision>=receipt.kupa_revision&&readout.financeRevision>=receipt.finance_revision;
}
