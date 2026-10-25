// @ts-check
import { compactText, detailKeyToken, meaningfulDetailValue } from './hapoalim-detail-values.mjs';
import {
  isDocumentDetailKey,
  isSemanticLabelKey,
  isSemanticValueKey,
  isUnsafeTechnicalDetailKey,
} from './hapoalim-detail-keys.mjs';

/** @param {unknown} value */
function normalizedBankDescriptor(value) {
  return compactText(value, 220)
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[\u05f3\u05f4'’׳״]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

const CREDIT_SETTLEMENT_PROVIDER_LABELS = {
  visaCal: 'כאל',
  max: 'MAX',
  isracard: 'ישראכרט',
  amex: 'אמריקן אקספרס',
};

/** @param {Record<string,unknown>|null|undefined} txn @returns {''|'visaCal'|'max'|'isracard'|'amex'} */
export function hapoalimCreditSettlementProvider(txn) {
  if (Number(txn?.eventActivityTypeCode) !== 2) return '';
  const description = normalizedBankDescriptor(txn?.activityDescription),
    english = normalizedBankDescriptor(txn?.englishActionDesc);
  if (
    description.includes('אמריקן אקספרס') ||
    english.includes('american expr') ||
    english.includes('american express')
  )
    return 'amex';
  if (description.includes('ישראכרט') || english.includes('isracard')) return 'isracard';
  if (description.includes('מקס איט פיננס') || english === 'max' || english.includes('max finance'))
    return 'max';
  // Hapoalim truncates CAL's legal name "כרטיסי אשראי לישראל" to "כרטיסי אשראי ל".
  // Require that exact legal-name prefix; VISA alone is a payment network and is not issuer proof.
  if (/^כרטיסי אשראי ל(?:$|[\s.,:;])/u.test(description)) return 'visaCal';
  return '';
}

/** @param {Record<string,unknown>|null|undefined} txn */
export function isHapoalimCompletedCreditSettlement(txn) {
  return !!hapoalimCreditSettlementProvider(txn) && Number(txn?.serialNumber) !== 0;
}

/** @param {Record<string,unknown>|null|undefined} txn */
export function isHapoalimCreditPermissionDetails(txn) {
  if (!hapoalimCreditSettlementProvider(txn)) return false;
  const value = String(txn?.details || '').trim();
  if (!value) return false;
  try {
    const url = new URL(value, 'https://login.bankhapoalim.co.il');
    return /^\/ServerServices\/current-account\/permissions\//i.test(url.pathname);
  } catch {
    return false;
  }
}

/** @param {string} key */
function isExplicitCardNumberKey(key) {
  const token = detailKeyToken(key);
  return /(?:creditcard|card).*(?:number|no|num|last4|lastfour|lastdigits|suffix)|(?:number|no|num|last4|lastfour|lastdigits|suffix).*(?:creditcard|card)|(?:מספר|מס)(?:ה)?כרטיס|כרטיס(?:מספר|מס)|(?:4|ארבע)(?:ה)?ספרות(?:ה)?אחרונות(?:של)?(?:ה)?כרטיס|ספרותאחרונות(?:של)?(?:ה)?כרטיס/.test(
    token
  );
}

/** @param {unknown} value */
function explicitCardLast4(value) {
  const clean = meaningfulDetailValue(value);
  if (!clean) return '';
  const digits = String(clean).replace(/\D/g, '');
  return digits.length >= 4 && digits.length <= 19 ? digits.slice(-4) : '';
}

/** @param {unknown} payload @returns {{cardLast4s:string[]}} */
export function normalizeHapoalimCreditPermissionDetails(payload) {
  /** @type {Set<string>} */ const cardLast4s = new Set();
  /** @param {string} key @param {unknown} value */
  const consume = (key, value) => {
    if (
      isUnsafeTechnicalDetailKey(key) ||
      isDocumentDetailKey(key) ||
      !isExplicitCardNumberKey(key)
    )
      return;
    const suffix = explicitCardLast4(value);
    if (suffix) cardLast4s.add(suffix);
  };
  /** @param {unknown} value @param {string} [path] @param {number} [depth] */
  const visit = (value, path = '', depth = 0) => {
    if (depth > 7 || value === null || value === undefined) return;
    if (Array.isArray(value)) {
      for (const child of value.slice(0, 120)) visit(child, path, depth + 1);
      return;
    }
    if (typeof value !== 'object') {
      if (path) consume(path, value);
      return;
    }
    const entries = Object.entries(value);
    const labelEntry = entries.find(
      ([key, child]) => isSemanticLabelKey(key) && meaningfulDetailValue(child)
    );
    const valueEntry = entries.find(
      ([key, child]) => isSemanticValueKey(key) && meaningfulDetailValue(child)
    );
    const consumed = new Set();
    if (labelEntry && valueEntry && labelEntry[0] !== valueEntry[0]) {
      consume(meaningfulDetailValue(labelEntry[1]), valueEntry[1]);
      consumed.add(labelEntry[0]);
      consumed.add(valueEntry[0]);
    }
    for (const [rawKey, child] of entries) {
      if (consumed.has(rawKey)) continue;
      const key = String(rawKey || ''),
        nextPath = path ? `${path}.${key}` : key;
      if (isUnsafeTechnicalDetailKey(key) || isDocumentDetailKey(key)) continue;
      if (child && typeof child === 'object') visit(child, nextPath, depth + 1);
      else consume(nextPath, child);
    }
  };
  visit(payload);
  return { cardLast4s: [...cardLast4s].sort().slice(0, 20) };
}

/** @param {...({cardLast4s?:unknown}|null|undefined)} sources @returns {{cardLast4s:string[]}} */
export function mergeHapoalimCreditPermissionDetails(...sources) {
  /** @type {Set<string>} */ const cardLast4s = new Set();
  for (const source of sources)
    for (const suffix of Array.isArray(source?.cardLast4s) ? source.cardLast4s : []) {
      const clean = String(suffix || '').replace(/\D/g, '');
      if (/^\d{4}$/.test(clean)) cardLast4s.add(clean);
    }
  return { cardLast4s: [...cardLast4s].sort().slice(0, 20) };
}

/** @param {Record<string,unknown>|null|undefined} txn @param {string} bankReference */
export function normalizedCreditSettlementDetails(txn, bankReference) {
  const provider = hapoalimCreditSettlementProvider(txn);
  if (!provider) return null;
  /** @type {Record<string,unknown>} */
  const extra =
    txn?.netunimCreditSettlementDetails && typeof txn.netunimCreditSettlementDetails === 'object'
      ? {...txn.netunimCreditSettlementDetails}
      : {};
  const cardLast4s = [
    ...new Set(
      (Array.isArray(extra.cardLast4s) ? extra.cardLast4s : [])
        .map((value) => String(value || '').replace(/\D/g, ''))
        .filter((value) => /^\d{4}$/.test(value))
    ),
  ].slice(0, 20);
  const permissionLink = isHapoalimCreditPermissionDetails(txn);
  return {
    provider,
    providerLabel: CREDIT_SETTLEMENT_PROVIDER_LABELS[provider] || provider,
    issuerReference: bankReference,
    permissionReference: permissionLink ? compactText(txn?.referenceCatenatedNumber, 100) : '',
    bankActivityTypeCode: Number.isFinite(Number(txn?.activityTypeCode))
      ? Number(txn?.activityTypeCode)
      : null,
    bankTextCode: Number.isFinite(Number(txn?.textCode)) ? Number(txn?.textCode) : null,
    cardLast4s,
    cardIdentitySource: cardLast4s.length ? 'bank_detail_explicit' : '',
    detailFetched: extra.detailFetched === true,
    warning: compactText(extra.warning, 220),
  };
}
