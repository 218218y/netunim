// @ts-check
import { readBankMoney } from './bank-money-value.mjs';
import {
  chequeItemKey,
  explicitChequeNumberFromText,
  normalizeChequeItemObject,
  normalizeChequeItemSemanticArray,
  normalizeChequeTableObject,
} from './hapoalim-cheque-model.mjs';
import {
  isChequeCountKey,
  isChequeNumberKey,
  isDocumentDetailKey,
  isSemanticLabelKey,
  isSemanticValueKey,
  isTransactionReferenceKey,
  isUnsafeTechnicalDetailKey,
} from './hapoalim-detail-keys.mjs';
import { compactText, meaningfulDetailValue } from './hapoalim-detail-values.mjs';

/** @typedef {Parameters<typeof chequeItemKey>[0]} ChequeItem */
/** @typedef {ChequeItem & {imageFrontKey:string,imageBackKey:string}} ChequeItemWithImages */

/** @param {unknown} payload */
export function normalizeHapoalimAdditionalDetails(payload) {
  /** @type {Set<string>} */ const checkNumbers = new Set();
  const itemKeys = new Set();
  /** @type {ChequeItem[]} */ const items = [];
  let referenceNumber = '',
    checkCount = null,
    hasDocumentReference = false;
  /** @param {ChequeItem|null} item */
  const addItem = (item) => {
    if (!item) return;
    const key = chequeItemKey(item);
    if (itemKeys.has(key)) return;
    itemKeys.add(key);
    items.push(item);
    if (item.checkNumber) checkNumbers.add(item.checkNumber);
    if (item.hasDocumentReference) hasDocumentReference = true;
  };
  /** @param {string} key @param {unknown} value */
  const consumeSemanticField = (key, value) => {
    if (isUnsafeTechnicalDetailKey(key)) return;
    if (isDocumentDetailKey(key)) {
      if (meaningfulDetailValue(value)) hasDocumentReference = true;
      return;
    }
    const clean = meaningfulDetailValue(value);
    if (!clean) return;
    const inlineChequeNumber = explicitChequeNumberFromText(clean);
    if (inlineChequeNumber) checkNumbers.add(inlineChequeNumber);
    if (isTransactionReferenceKey(key) && !referenceNumber) {
      referenceNumber = clean;
      return;
    }
    if (isChequeCountKey(key)) {
      const n = Number(String(clean).replace(/[^0-9.-]/g, ''));
      if (Number.isFinite(n) && n > 0) checkCount = Math.trunc(n);
      return;
    }
    if (isChequeNumberKey(key) && clean !== '0') checkNumbers.add(clean);
  };
  /** @param {unknown} value */
  const visit = (value, path = '', depth = 0) => {
    if (depth > 5 || value === null || value === undefined) return;
    if (Array.isArray(value)) {
      addItem(normalizeChequeItemSemanticArray(value));
      if (path && isChequeNumberKey(path)) {
        for (const child of value.slice(0, 50)) consumeSemanticField(path, child);
        return;
      }
      for (const child of value.slice(0, 80)) visit(child, path, depth + 1);
      return;
    }
    if (typeof value !== 'object') {
      if (path) consumeSemanticField(path, value);
      return;
    }
    for (const tableItem of normalizeChequeTableObject(value)) addItem(tableItem);
    addItem(normalizeChequeItemObject(value));
    /** @type {[string,unknown][]} */ const entries = Object.entries(value);
    const labelEntry = entries.find(
      ([key, child]) => isSemanticLabelKey(key) && meaningfulDetailValue(child)
    );
    const valueEntry = entries.find(
      ([key, child]) => isSemanticValueKey(key) && meaningfulDetailValue(child)
    );
    const consumed = new Set();
    if (labelEntry && valueEntry && labelEntry[0] !== valueEntry[0]) {
      consumeSemanticField(meaningfulDetailValue(labelEntry[1]), valueEntry[1]);
      consumed.add(labelEntry[0]);
      consumed.add(valueEntry[0]);
    }
    for (const [rawKey, child] of entries) {
      if (consumed.has(rawKey)) continue;
      const key = String(rawKey || ''),
        nextPath = path ? `${path}.${key}` : key;
      if (isDocumentDetailKey(key)) {
        if (meaningfulDetailValue(child)) hasDocumentReference = true;
        continue;
      }
      if (isUnsafeTechnicalDetailKey(key)) continue;
      if (child && typeof child === 'object') {
        visit(child, nextPath, depth + 1);
        continue;
      }
      consumeSemanticField(key, child);
    }
  };
  visit(payload);
  const cleanItems = items.slice(0, 50),
    numbers = [...checkNumbers].filter((x) => x && x !== '0').slice(0, 50);
  if (cleanItems.length) {
    for (const item of cleanItems) {
      if (item.checkNumber && !numbers.includes(item.checkNumber)) numbers.push(item.checkNumber);
    }
  }
  if (checkCount === null && cleanItems.length) checkCount = cleanItems.length;
  else if (checkCount === null && numbers.length) checkCount = numbers.length;
  return {
    referenceNumber: compactText(referenceNumber, 100),
    checkNumbers: numbers,
    checkCount,
    checkItems: cleanItems,
    hasDocumentReference,
  };
}

/** @param {...unknown} sources */
export function mergeHapoalimAdditionalDetails(...sources) {
  /** @type {Set<string>} */ const checkNumbers = new Set();
  const itemKeys = new Set();
  /** @type {ChequeItemWithImages[]} */ const checkItems = [];
  let referenceNumber = '',
    declaredCount = 0,
    hasDocumentReference = false;
  for (const value of sources) {
    if (!value || typeof value !== 'object') continue;
    const source = /** @type {Record<string,unknown>} */ (value);
    if (!referenceNumber) referenceNumber = compactText(source.referenceNumber, 100);
    const count = readBankMoney(source.checkCount);
    if (count !== null && Number.isFinite(count) && count > 0)
      declaredCount = Math.max(declaredCount, Math.trunc(count));
    if (source.hasDocumentReference === true) hasDocumentReference = true;
    for (const value of Array.isArray(source.checkNumbers) ? source.checkNumbers : []) {
      const clean = compactText(value, 80);
      if (clean && clean !== '0') checkNumbers.add(clean);
    }
    /** @type {unknown[]} */ const sourceItems = Array.isArray(source.checkItems) ? source.checkItems : [];
    for (const value of sourceItems) {
      if (!value || typeof value !== 'object') continue;
      const raw = /** @type {Record<string,unknown>} */ (value);
      const amount = readBankMoney(raw?.amount);
      if (amount === null || amount <= 0) continue;
      /** @type {ChequeItemWithImages} */
      const item = {
        bankNumber: compactText(raw?.bankNumber, 20),
        branchNumber: compactText(raw?.branchNumber, 20),
        accountNumber: compactText(raw?.accountNumber, 40),
        checkNumber: compactText(raw?.checkNumber, 80),
        amount,
        hasDocumentReference: raw?.hasDocumentReference === true,
        imageFrontKey: /^[a-f0-9]{64}$/.test(String(raw?.imageFrontKey || ''))
          ? String(raw.imageFrontKey)
          : '',
        imageBackKey: /^[a-f0-9]{64}$/.test(String(raw?.imageBackKey || ''))
          ? String(raw.imageBackKey)
          : '',
      };
      if (!(item.checkNumber || (item.bankNumber && item.branchNumber && item.accountNumber))) continue;
      const key = chequeItemKey(item);
      if (itemKeys.has(key)) continue;
      itemKeys.add(key);
      checkItems.push(item);
      if (item.checkNumber && item.checkNumber !== '0') checkNumbers.add(item.checkNumber);
      if (item.hasDocumentReference) hasDocumentReference = true;
    }
  }
  const numbers = [...checkNumbers].slice(0, 50),
    items = checkItems.slice(0, 50),
    inferredCount = Math.max(numbers.length, items.length);
  const checkCount = Math.max(declaredCount, inferredCount) || null;
  return {
    referenceNumber,
    checkNumbers: numbers,
    checkCount,
    checkItems: items,
    hasDocumentReference,
  };
}

/** @param {unknown} baseUrl @param {unknown} pfmDetails @param {unknown} accountId */
export function buildHapoalimAdditionalDetailsUrl(baseUrl, pfmDetails, accountId) {
  const base = new URL(String(baseUrl || '')),
    url = new URL(String(pfmDetails || ''), base);
  if (url.origin !== base.origin) {
    throw Object.assign(new Error('כתובת פרטי התנועה אינה שייכת לבנק הפועלים'), { code: 'UNSAFE_DETAIL_URL' });
  }
  url.searchParams.set('accountId', String(accountId || ''));
  url.searchParams.set('lang', 'he');
  return url.toString();
}
