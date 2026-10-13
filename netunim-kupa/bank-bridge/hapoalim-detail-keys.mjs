// @ts-check
import { detailKeyToken } from './hapoalim-detail-values.mjs';

/** @param {unknown} key @returns {boolean} */
export function isDocumentDetailKey(key) {
  const token = detailKeyToken(key);
  return /(image|scan|document|attachment|file|pdf|base64|binary|photo|צילום|סריק|מסמך|קובץ|תמונה)/i.test(
    token
  );
}

/** @param {unknown} key @returns {boolean} */
export function isUnsafeTechnicalDetailKey(key) {
  const token = detailKeyToken(key);
  return /(token|cookie|session|jwt|xsrf|csrf|authorization|html|content|href|url|uri)/i.test(
    token
  );
}

/** @param {unknown} key @returns {boolean} */
export function isChequeCountKey(key) {
  const token = detailKeyToken(key);
  return /((check|cheque|cheq|chk).*(count|quantity|qty|total|numberof)|(count|quantity|qty|total|numberof).*(check|cheque|cheq|chk)|(?:checks|cheques)(?:count|number|total)|(?:count|number|total)(?:checks|cheques)|(?:כמות|מספר)(?:ה)?(?:שיקים|צקים)|(?:שיקים|צקים)(?:כמות|מספר))/.test(
    token
  );
}

/** @param {unknown} key @returns {boolean} */
export function isChequeNumberKey(key) {
  const token = detailKeyToken(key);
  if (isChequeCountKey(key)) return false;
  return /((check|cheque|cheq|chk).*(number|no|num|serial|reference)|(number|no|num|serial|reference).*(check|cheque|cheq|chk)|(?:מספר|מס|אסמכתא)(?:ה)?(?:שיק|צק)$|(?:שיק|צק)(?:מספר|מס|אסמכתא)$)/.test(
    token
  );
}

/** @param {unknown} key @returns {boolean} */
export function isTransactionReferenceKey(key) {
  const token = detailKeyToken(key);
  return /^(transactionnumber|transactionno|referencenumber|reference|אסמכתא|מספרתנועה)$/.test(
    token
  );
}

/** @param {unknown} key @returns {boolean} */
export function isBankNumberKey(key) {
  return /^(bank|banknumber|bankno|bankcode|בנק|מספרבנק|מסבנק)$/.test(detailKeyToken(key));
}

/** @param {unknown} key @returns {boolean} */
export function isBranchNumberKey(key) {
  return /^(branch|branchnumber|branchno|branchcode|סניף|מספרסניף|מססניף)$/.test(
    detailKeyToken(key)
  );
}

/** @param {unknown} key @returns {boolean} */
export function isAccountNumberKey(key) {
  return /^(account|accountnumber|accountno|accountid|חשבון|מספרחשבון|מסחשבון)$/.test(
    detailKeyToken(key)
  );
}

/** @param {unknown} key @returns {boolean} */
export function isChequeAmountKey(key) {
  const token = detailKeyToken(key);
  return (
    /^(amount|sum|checkamount|chequeamount|checksum|chequesum|סכום)$/.test(token) ||
    /^(?:check|cheque|cheq|chk).*(?:amount|sum)/.test(token) ||
    /^(?:amount|sum).*(?:check|cheque|cheq|chk)/.test(token) ||
    /^סכום(?:ה)?(?:שיק|צק)/.test(token)
  );
}

/** @param {unknown} key @returns {boolean} */
export function isSemanticLabelKey(key) {
  return /^(label|title|name|caption|header|columnname|field|fieldname|fieldlabel|fielddesc|fielddescription|displayname|displaylabel|description|תווית|כותרת|שם)$/.test(
    detailKeyToken(key)
  );
}

/** @param {unknown} key @returns {boolean} */
export function isSemanticValueKey(key) {
  return /^(value|fieldvalue|formattedvalue|displayvalue|displaytext|displaycontent|text|data|content|ערך|תוכן)$/.test(
    detailKeyToken(key)
  );
}
