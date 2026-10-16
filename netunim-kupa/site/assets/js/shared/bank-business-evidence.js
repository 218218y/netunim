// @ts-check
import {evidenceObject as object,evidenceMoney as money,evidenceInteger as integer,evidenceText as text} from './response-evidence.js';

function invalid(){throw Object.assign(new Error('Bank business evidence is invalid'),{code:'BANK_TRANSACTIONS_INVALID',retryable:false})}
/** @param {Record<string,unknown>} row @param {string[]} fields */
function strings(row,fields){
  for(const field of fields)if(row[field]!==undefined&&typeof row[field]!=='string')invalid();
}
/** @param {Record<string,unknown>} row @param {string[]} fields */
function booleans(row,fields){
  for(const field of fields)if(row[field]!==undefined&&typeof row[field]!=='boolean')invalid();
}
/** Missing optional detail fields carry no evidence. Supplied values must retain
 * their actual JSON types; normalization cannot turn "false" into permission.
 * @param {unknown} value */
export function assertBankCheckDetails(value){
  if(value==null)return;
  if(!object(value))return invalid();
  strings(value,['kind','warning']);
  booleans(value,['hasDocumentReference']);
  if(value.kind!==undefined&&!['','deposit','returned','returned_credit'].includes(String(value.kind)))invalid();
  if(value.checkCount!=null&&(!integer(value.checkCount)||value.checkCount===0))invalid();
  if(value.checkNumbers!==undefined&&(!Array.isArray(value.checkNumbers)||value.checkNumbers.length>50||
    !Array.from(value.checkNumbers).every(text)||new Set(value.checkNumbers).size!==value.checkNumbers.length))invalid();
  if(value.checkItems===undefined)return;
  if(!Array.isArray(value.checkItems)||value.checkItems.length>50)return invalid();
  for(const item of Array.from(value.checkItems)){
    if(!object(item))return invalid();
    strings(item,['bankNumber','branchNumber','accountNumber','checkNumber','imageFrontKey','imageBackKey']);
    booleans(item,['hasDocumentReference']);
    if(!money(item.amount)||Number(item.amount)<=0||
      !text(item.checkNumber)&&!(text(item.bankNumber)&&text(item.branchNumber)&&text(item.accountNumber)))invalid();
    for(const field of ['imageFrontKey','imageBackKey']){
      if(item[field]!==undefined&&item[field]!==''&&!(typeof item[field]==='string'&&/^[a-f0-9]{64}$/.test(item[field])))invalid();
    }
  }
}
/** @param {unknown} value */
export function assertBankCreditSettlementDetails(value){
  if(value==null)return;
  if(!object(value))return invalid();
  strings(value,['provider','providerLabel','issuerReference','permissionReference','cardIdentitySource','warning']);
  booleans(value,['detailFetched']);
  if(!['visaCal','max','isracard','amex'].includes(String(value.provider)))invalid();
  for(const field of ['bankActivityTypeCode','bankTextCode']){
    if(value[field]!=null&&!integer(value[field]))invalid();
  }
  if(value.cardLast4s!==undefined&&(!Array.isArray(value.cardLast4s)||value.cardLast4s.length>20||
    !Array.from(value.cardLast4s).every(v=>typeof v==='string'&&/^\d{4}$/.test(v))||
    new Set(value.cardLast4s).size!==value.cardLast4s.length))invalid();
  if(value.cardIdentitySource!==undefined&&!['','bank_detail_explicit'].includes(String(value.cardIdentitySource)))invalid();
  if(Array.isArray(value.cardLast4s)&&value.cardLast4s.length&&value.cardIdentitySource!=='bank_detail_explicit')invalid();
}
