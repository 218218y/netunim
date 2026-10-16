// @ts-check

/** @param {unknown} value @param {number} [max] @returns {string} */
export function creditText(value, max = 240) {
  return String(value ?? '')
    .trim()
    .replace(/\s+/g, ' ')
    .slice(0, max);
}

/** @param {unknown} value @returns {number|null} */
export function creditNumber(value) {
  assertCreditNumericInput(value);
  if (value === null || value === undefined || String(value).trim() === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

/** Provider-specific string formatting stays with its adapter. JSON containers
 * and booleans must never become issuer amounts through Number/String coercion.
 * @param {unknown} value */
export function assertCreditNumericInput(value){
  if(value==null||typeof value==='string'||typeof value==='number'&&Number.isFinite(value))return;
  throw Object.assign(new Error('Credit provider numeric input is invalid'),{
    code:'CREDIT_PROVIDER_SCHEMA_ERROR',stage:'Transactions',retryable:false,
  });
}

/** @param {unknown} value @returns {number|null} */
export function creditDebitAmount(value) {
  const amount = creditNumber(value);
  return amount === null ? null : amount === 0 ? 0 : -amount;
}

/** @param {unknown} value @returns {string} */
export function creditTransactionTime(value) {
  const match = /^(\d{1,2}):(\d{2})(?::\d{2})?$/.exec(String(value ?? '').trim());
  if (!match) return '';
  const hour = Number(match[1]),
    minute = Number(match[2]);
  return hour >= 0 && hour <= 23 && minute >= 0 && minute <= 59
    ? `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`
    : '';
}
