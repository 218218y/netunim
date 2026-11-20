// @ts-check

/** @param {unknown} value @param {RegExp} pattern */
function accountDigits(value, pattern) {
  if (typeof value !== 'string' && (typeof value !== 'number' || !Number.isSafeInteger(value))) return '';
  const digits = String(value).trim();
  return pattern.test(digits) && /[1-9]/.test(digits) ? digits : '';
}

/** @param {unknown} value */
export function normalizeBankSenderAccount(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const account = /** @type {Record<string,unknown>} */ (value);
  const bankNumber = accountDigits(account.bankNumber, /^[0-9]{1,3}$/).replace(/^0+/, '');
  const branchNumber = accountDigits(account.branchNumber, /^[0-9]{1,6}$/);
  const accountNumber = accountDigits(account.accountNumber, /^[0-9]{1,20}$/);
  return bankNumber && branchNumber && accountNumber ? {bankNumber, branchNumber, accountNumber} : null;
}
