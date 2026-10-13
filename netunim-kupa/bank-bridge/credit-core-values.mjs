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
  if (value === null || value === undefined || String(value).trim() === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
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
