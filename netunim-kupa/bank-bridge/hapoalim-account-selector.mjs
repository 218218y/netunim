// @ts-check

/** @param {unknown} value @returns {string} */
export function normalizeAccountPart(value) {
  return String(value ?? '')
    .trim()
    .replace(/\D/g, '');
}

/** @typedef {{bankNumber:string,branchNumber:string,accountNumber:string}} BankAccountSelector */
/** @typedef {{bankNumber?:unknown,branchNumber?:unknown,accountNumber?:unknown}} SelectorFields */
/** @param {unknown} [target] @returns {BankAccountSelector} */
export function parseAccountSelector(target = '') {
  if (target && typeof target === 'object') {
    return {
      bankNumber: normalizeAccountPart(/** @type {SelectorFields} */ (target).bankNumber) || '12',
      branchNumber: normalizeAccountPart(/** @type {SelectorFields} */ (target).branchNumber),
      accountNumber: normalizeAccountPart(/** @type {SelectorFields} */ (target).accountNumber),
    };
  }
  const raw = String(target || '').trim();
  if (!raw) return { bankNumber: '12', branchNumber: '', accountNumber: '' };
  const parts = raw
    .split(/[^0-9]+/)
    .map(normalizeAccountPart)
    .filter(Boolean);
  if (parts.length >= 3)
    return {
      bankNumber: /** @type {string} */ (parts.at(-3)),
      branchNumber: /** @type {string} */ (parts.at(-2)),
      accountNumber: /** @type {string} */ (parts.at(-1)),
    };
  if (parts.length === 2)
    return {
      bankNumber: '12',
      branchNumber: /** @type {string} */ (parts[0]),
      accountNumber: /** @type {string} */ (parts[1]),
    };
  return { bankNumber: '12', branchNumber: '', accountNumber: normalizeAccountPart(raw) };
}
