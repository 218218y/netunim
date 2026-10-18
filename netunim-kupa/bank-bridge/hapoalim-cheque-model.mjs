// @ts-nocheck
import { compactText, meaningfulDetailValue } from './hapoalim-detail-values.mjs';
import {
  isAccountNumberKey,
  isBankNumberKey,
  isBranchNumberKey,
  isChequeAmountKey,
  isChequeNumberKey,
  isDocumentDetailKey,
  isSemanticLabelKey,
  isSemanticValueKey,
  isTransactionReferenceKey,
  isUnsafeTechnicalDetailKey,
} from './hapoalim-detail-keys.mjs';

export function explicitChequeNumberFromText(value) {
  const text = compactText(value, 240);
  if (!text) return '';
  const match = text.match(
    /(?:אסמכתא\s*\(\s*מס[׳']?\s*(?:שיק|צ[׳']?ק)\s*\)|מס(?:פר|[׳'])?\s*(?:שיק|צ[׳']?ק)|(?:שיק|צ[׳']?ק)\s*מס(?:פר|[׳'])?)\s*[:=\-–—]?\s*([0-9]{2,20})/u
  );
  return match ? compactText(match[1], 80) : '';
}

function depositDescriptionToken(value) {
  return String(value ?? '')
    .toLowerCase()
    .replace(/[\u05f3\u05f4'’׳״]/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

export function hapoalimChequeTransactionKind(txn) {
  // Only the bank's activity description is authoritative here. Do not scan beneficiary names:
  // Hebrew names such as "זרצקי" contain the letters צק and previously caused false positives.
  const text = depositDescriptionToken(txn?.activityDescription);
  if (!text) return '';
  if (
    /(?:^|[\s.,;:()\-/])(?:הפק(?:דה|דת)?\.?\s*(?:שיק|שיקים|צ'?ק|צ'?קים)|הפק\.?\s*(?:שיק|שיקים|צ'?ק|צ'?קים))(?:$|[\s.,;:()\-/])/.test(
      text
    ) ||
    /\b(?:check|cheque)s?\s+deposit\b|\bdeposit(?:ed|ing)?\s+(?:check|cheque)s?\b/i.test(text)
  )
    return 'deposit';
  if (
    /^החזרת\s+(?:שיק(?:ים)?|צ'?ק(?:ים)?|המחא(?:ה|ות))(?:$|[\s.:,;()\-–—־])/.test(text) ||
    /^(?:שיק|צ'?ק|המחאה)\s+(?:הוחזר|חזר)(?:$|[\s.:,;()\-–—־])/.test(text) ||
    /^(?:returned|return)\s+(?:check|cheque)s?(?:$|[\s.:,;()\-–—])/i.test(text)
  )
    return 'returned';
  if (/^הצ\.?\s*(?:שיק|צ'?ק)\s+חוזר(?:\s*[\-–—־]\s*|\s+)נט$/u.test(text)) return 'returned_credit';
  return '';
}

function semanticPairsFromObject(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return [];
  const entries = Object.entries(value),
    pairs = [];
  const labelEntry = entries.find(
    ([key, child]) => isSemanticLabelKey(key) && meaningfulDetailValue(child)
  );
  const valueEntry = entries.find(
    ([key, child]) => isSemanticValueKey(key) && meaningfulDetailValue(child)
  );
  if (labelEntry && valueEntry && labelEntry[0] !== valueEntry[0])
    pairs.push([meaningfulDetailValue(labelEntry[1]), valueEntry[1]]);
  for (const [key, child] of entries) {
    if (child === null || child === undefined || typeof child === 'object') continue;
    pairs.push([key, child]);
  }
  return pairs;
}

function semanticCellPairsFromArray(value) {
  if (!Array.isArray(value) || !value.length) return [];
  const pairs = [];
  let objectCells = 0;
  for (const child of value.slice(0, 30)) {
    if (!child || typeof child !== 'object' || Array.isArray(child)) return [];
    objectCells++;
    const entries = Object.entries(child);
    // A direct bank/branch/account/amount key means this is probably an array of rows,
    // not an array of cells belonging to one row. Never collapse rows together.
    if (
      entries.some(
        ([key]) =>
          isBankNumberKey(key) ||
          isBranchNumberKey(key) ||
          isAccountNumberKey(key) ||
          isChequeAmountKey(key) ||
          isChequeNumberKey(key) ||
          isTransactionReferenceKey(key)
      )
    )
      return [];
    const labelEntry = entries.find(
      ([key, field]) => isSemanticLabelKey(key) && meaningfulDetailValue(field)
    );
    const valueEntry = entries.find(
      ([key, field]) => isSemanticValueKey(key) && meaningfulDetailValue(field)
    );
    if (!labelEntry || !valueEntry || labelEntry[0] === valueEntry[0]) return [];
    pairs.push([meaningfulDetailValue(labelEntry[1]), valueEntry[1]]);
  }
  return pairs.length === objectCells ? pairs : [];
}

function nestedSemanticPairsFromObject(value, depth = 0) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || depth > 3) return [];
  const pairs = semanticPairsFromObject(value);
  for (const [rawKey, child] of Object.entries(value)) {
    if (!child || typeof child !== 'object') continue;
    const key = String(rawKey || '');
    if (isUnsafeTechnicalDetailKey(key) || isDocumentDetailKey(key)) continue;
    if (Array.isArray(child)) {
      // Some Hapoalim detail payloads keep a row's display cells in a nested array.
      // Fold them into this row only when EVERY element is an explicit label/value cell.
      // This preserves row identity and never relies on array order alone.
      pairs.push(...semanticCellPairsFromArray(child));
      for (const primitive of child.slice(0, 30)) {
        if (typeof primitive !== 'string') continue;
        const explicit = explicitChequeNumberFromText(primitive);
        if (explicit) pairs.push(['מספר שיק', explicit]);
      }
      continue;
    }
    pairs.push(...nestedSemanticPairsFromObject(child, depth + 1));
  }
  return pairs;
}

function normalizeChequeItemPairs(pairs) {
  let bankNumber = '',
    branchNumber = '',
    accountNumber = '',
    checkNumber = '',
    amount = null,
    hasDocumentReference = false;
  for (const [rawKey, rawValue] of pairs) {
    const key = String(rawKey || '');
    if (isUnsafeTechnicalDetailKey(key)) continue;
    if (isDocumentDetailKey(key)) {
      if (meaningfulDetailValue(rawValue)) hasDocumentReference = true;
      continue;
    }
    const clean = meaningfulDetailValue(rawValue);
    if (!clean) continue;
    const inlineChequeNumber = explicitChequeNumberFromText(clean);
    if (inlineChequeNumber && !checkNumber) checkNumber = inlineChequeNumber;
    if (isBankNumberKey(key)) {
      if (!bankNumber) bankNumber = compactText(clean, 20);
      continue;
    }
    if (isBranchNumberKey(key)) {
      if (!branchNumber) branchNumber = compactText(clean, 20);
      continue;
    }
    if (isAccountNumberKey(key)) {
      if (!accountNumber) accountNumber = compactText(clean, 40);
      continue;
    }
    if (isChequeNumberKey(key)) {
      if (!checkNumber) checkNumber = compactText(clean, 80);
      continue;
    }
    // A generic transaction/reference field is not a cheque identifier. The current
    // Hapoalim cheque endpoint exposes the cheque number in its dedicated `number`
    // field; labelled semantic cheque-number fields are handled above.
    if (isTransactionReferenceKey(key)) continue;
    if (isChequeAmountKey(key) && amount === null) {
      const n = Number(String(clean).replace(/[,\s₪]/g, ''));
      if (Number.isFinite(n) && n > 0) amount = n;
    }
  }
  const fullAccountIdentity = !!(bankNumber && branchNumber && accountNumber);
  if (!(Number.isFinite(amount) && amount > 0 && (checkNumber || fullAccountIdentity))) return null;
  return { bankNumber, branchNumber, accountNumber, checkNumber, amount, hasDocumentReference };
}

function normalizeHapoalimChequeListItem(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  // Captured Hapoalim /current-account/cheques/... responses use this exact row
  // contract: {bank, branch, account, number, amount, ...}. `number` is the bank's
  // authoritative cheque number. Do not reinterpret the transaction reference.
  const required = ['bank', 'branch', 'account', 'number', 'amount'];
  if (!required.every((key) => Object.prototype.hasOwnProperty.call(value, key))) return null;
  const bankNumber = compactText(meaningfulDetailValue(value.bank), 20);
  const branchNumber = compactText(meaningfulDetailValue(value.branch), 20);
  const accountNumber = compactText(meaningfulDetailValue(value.account), 40);
  const checkNumber = compactText(meaningfulDetailValue(value.number), 80);
  const amountNumber = typeof value.amount === 'number' || typeof value.amount === 'string'
    ? Number(String(value.amount).replace(/[,\s₪]/g, '')) : NaN;
  const amount = Number.isFinite(amountNumber) && amountNumber > 0 ? amountNumber : null;
  const hasDocumentReference = Object.entries(value).some(
    ([key, child]) => isDocumentDetailKey(key) && !!meaningfulDetailValue(child)
  );
  if (!bankNumber || !branchNumber || !accountNumber || !amount) return null;
  return { bankNumber, branchNumber, accountNumber, checkNumber, amount, hasDocumentReference };
}

export function normalizeChequeItemObject(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const nativeChequeItem = normalizeHapoalimChequeListItem(value);
  if (nativeChequeItem) return nativeChequeItem;
  // Other Hapoalim views may render a table cell as a nested {label,value}-like
  // object. Fold nested semantic objects into the SAME row; never cross array
  // boundaries (which may hold several cheques).
  return normalizeChequeItemPairs(nestedSemanticPairsFromObject(value));
}

export function normalizeChequeItemSemanticArray(value) {
  if (!Array.isArray(value) || !value.length) return null;
  const pairs = [];
  let semanticCells = 0,
    objectCells = 0;
  for (const child of value.slice(0, 30)) {
    if (!child || typeof child !== 'object' || Array.isArray(child)) continue;
    objectCells++;
    const entries = Object.entries(child);
    // If a child already looks like a row (rather than one label/value cell), this
    // array can contain several cheques and must never be collapsed across rows.
    if (
      entries.some(
        ([key]) =>
          isBankNumberKey(key) ||
          isBranchNumberKey(key) ||
          isAccountNumberKey(key) ||
          isChequeAmountKey(key) ||
          isChequeNumberKey(key) ||
          isTransactionReferenceKey(key)
      )
    )
      return null;
    const labelEntry = entries.find(
      ([key, field]) => isSemanticLabelKey(key) && meaningfulDetailValue(field)
    );
    const valueEntry = entries.find(
      ([key, field]) => isSemanticValueKey(key) && meaningfulDetailValue(field)
    );
    if (!labelEntry || !valueEntry || labelEntry[0] === valueEntry[0]) continue;
    pairs.push([meaningfulDetailValue(labelEntry[1]), valueEntry[1]]);
    semanticCells++;
  }
  // Reconstruct only a clearly tabular cheque row: every object in the array must
  // be one semantic cell, and at least four cells are required to prove row shape.
  if (semanticCells < 4 || semanticCells !== objectCells) return null;
  return normalizeChequeItemPairs(pairs);
}

function semanticColumnLabel(value) {
  if (typeof value === 'string' || typeof value === 'number') return meaningfulDetailValue(value);
  if (!value || typeof value !== 'object' || Array.isArray(value)) return '';
  for (const [key, child] of Object.entries(value)) {
    if (isSemanticLabelKey(key)) {
      const clean = meaningfulDetailValue(child);
      if (clean) return clean;
    }
  }
  return '';
}

function semanticCellValue(value) {
  if (value === null || value === undefined) return '';
  if (typeof value !== 'object') return value;
  if (Array.isArray(value)) return '';
  for (const [key, child] of Object.entries(value)) {
    if (isSemanticValueKey(key) && meaningfulDetailValue(child)) return child;
  }
  return '';
}

export function normalizeChequeTableObject(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return [];
  const arrays = Object.values(value).filter(Array.isArray),
    headerCandidates = [];
  for (const candidate of arrays) {
    if (candidate.length < 4 || candidate.length > 20) continue;
    const labels = candidate.map(semanticColumnLabel);
    if (labels.some((x) => !x)) continue;
    // Position-based mapping is accepted only when the bank itself supplied a complete,
    // explicit cheque table header. This is not a guessed column order.
    if (
      !labels.some(isBankNumberKey) ||
      !labels.some(isBranchNumberKey) ||
      !labels.some(isAccountNumberKey) ||
      !labels.some(isChequeAmountKey) ||
      !labels.some(isChequeNumberKey)
    )
      continue;
    headerCandidates.push(labels);
  }
  if (headerCandidates.length !== 1) return [];
  const labels = headerCandidates[0],
    items = [];
  const addRow = (row) => {
    const cells = Array.isArray(row)
      ? row
      : row && typeof row === 'object'
        ? Object.values(row).find(Array.isArray)
        : null;
    if (!Array.isArray(cells) || cells.length < labels.length) return;
    const pairs = labels.map((label, index) => [label, semanticCellValue(cells[index])]);
    const item = normalizeChequeItemPairs(pairs);
    if (item) items.push(item);
  };
  for (const candidate of arrays) {
    if (candidate.length === labels.length && candidate.map(semanticColumnLabel).every(Boolean))
      continue;
    if (candidate.every((row) => Array.isArray(row) || (row && typeof row === 'object')))
      for (const row of candidate.slice(0, 50)) addRow(row);
  }
  return items;
}

export function chequeItemKey(item) {
  return [
    item.bankNumber,
    item.branchNumber,
    item.accountNumber,
    item.checkNumber,
    item.amount,
  ].join('|');
}
