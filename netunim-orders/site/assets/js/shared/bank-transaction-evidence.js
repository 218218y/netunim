// @ts-check
import {evidenceObject as object,evidenceText as text,evidenceTimestamp as timestamp,evidenceDate as date,evidenceMoney as money} from './response-evidence.js';
import {assertBankCheckDetails,assertBankCreditSettlementDetails} from './bank-business-evidence.js';

/** @typedef {Readonly<Record<string,unknown>&{status:'pending'|'completed',amount:number|string,currency:string}>} BankTransaction */
export function invalidBankTransaction(){
  return Object.assign(new Error('Bank transaction evidence is invalid'),{code:'BANK_TRANSACTIONS_INVALID',retryable:false});
}
/** Current transaction status is evidence, never a fallback for unknown input.
 * @param {unknown} value @returns {value is 'pending'|'completed'} */
export function bankTransactionStatus(value){return value==='pending'||value==='completed'}

/** Decode the common business fields of Bridge, archive and snapshot rows.
 * Archive adapters translate SQL column names before calling this boundary.
 * Historical persisted feed normalization is a separate compatibility reader.
 * @param {unknown} value @returns {BankTransaction} */
export function readBankTransaction(value){
  if(!object(value)||!bankTransactionStatus(value.status)||!money(value.amount)||!text(value.currency))throw invalidBankTransaction();
  for(const field of ['date','processedDate']){
    if(value[field]!=null&&!timestamp(value[field]))throw invalidBankTransaction();
  }
  if(value.balanceAfter!=null&&!money(value.balanceAfter))throw invalidBankTransaction();
  if(value.cheque!==undefined&&typeof value.cheque!=='boolean')throw invalidBankTransaction();
  for(const field of ['id','mergeKey','description','memo','partyName','partyHeadline','messageHeadline','messageDetail','bankReference','bankSerial']){
    if(value[field]!==undefined&&typeof value[field]!=='string')throw invalidBankTransaction();
  }
  if(value.activityTypeCode!=null&&(typeof value.activityTypeCode!=='number'||!Number.isSafeInteger(value.activityTypeCode)))throw invalidBankTransaction();
  assertBankCheckDetails(value.checkDetails);
  assertBankCreditSettlementDetails(value.creditSettlementDetails);
  if(!text(value.id)&&!text(value.mergeKey)&&!timestamp(value.date)&&!timestamp(value.processedDate))throw invalidBankTransaction();
  return /** @type {BankTransaction} */ (freeze(structuredClone(value)));
}
/** @param {unknown} value @returns {unknown} */
function freeze(value){
  if(value!==null&&typeof value==='object'){
    for(const child of Object.values(value))freeze(child);
    Object.freeze(value);
  }
  return value;
}
/** @param {unknown} value @returns {readonly BankTransaction[]} */
export function readBankTransactions(value){
  if(!Array.isArray(value))throw invalidBankTransaction();
  return Object.freeze(Array.from(value,readBankTransaction));
}

/** Capture the command before transport I/O. Snapshot clocks are timestamps;
 * absence reconciliation requires exact, ordered calendar coverage. A warning
 * retains the established partial-snapshot policy, without authority to erase.
 * @param {unknown} value */
export function readBankArchiveCommand(value) {
  if (!object(value) || !text(value.accountKey) ||
      !['business', 'home'].includes(String(value.accountRole)) ||
      typeof value.accountRole !== 'string' || !timestamp(value.snapshotAt) ||
      value.complete !== undefined && typeof value.complete !== 'boolean') throw invalidBankTransaction();
  const coverage = value.coverage;
  if (coverage != null && (!object(coverage) ||
      coverage.complete !== undefined && typeof coverage.complete !== 'boolean' ||
      coverage.warning !== undefined && typeof coverage.warning !== 'string')) throw invalidBankTransaction();
  const complete = value.complete === true && object(coverage) && coverage.complete === true && !coverage.warning;
  if (complete && (!date(coverage.from) || !date(coverage.to) || coverage.from > coverage.to)) throw invalidBankTransaction();
  const occurrences = new Map();
  const transactions = readBankTransactions(value.transactions).map(tx => {
    const day = String(tx.date || '').slice(0, 10);
    const processedDay = String(tx.processedDate || '').slice(0, 10);
    const serial = String(tx.bankSerial || '');
    const reference = String(tx.bankReference || '');
    const signature = `${day}|${processedDay}|${tx.amount}|${tx.description || ''}|${tx.memo || ''}|${JSON.stringify(tx.checkDetails || null)}`;
    const occurrence = (occurrences.get(signature) || 0) + 1;
    occurrences.set(signature, occurrence);
    let stableKey;
    if (serial && serial !== '0' && day) stableKey = `serial:${day}:${serial}:${tx.amount}`;
    else if (reference && day) stableKey = `ref:${day}:${reference}:${tx.amount}:${tx.description || ''}:${tx.memo || ''}`;
    else stableKey = `fallback:${signature}:${occurrence}`;
    return Object.freeze({...tx, mergeKey: String(tx.mergeKey || stableKey)});
  });
  return Object.freeze({
    p_account_key: value.accountKey,
    p_account_role: /** @type {'business'|'home'} */ (value.accountRole),
    p_transactions: Object.freeze(transactions),
    p_snapshot_at: new Date(value.snapshotAt).toISOString(),
    p_coverage_from: complete ? String(coverage.from) : null,
    p_coverage_to: complete ? String(coverage.to) : null,
    p_complete: complete,
  });
}
