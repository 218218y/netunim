// @ts-check
import {evidenceObject as object,evidenceText as text,evidenceTimestamp as timestamp,evidenceMoney as money} from './response-evidence.js';
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
