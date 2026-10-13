// @ts-check

/** @param {unknown} value @returns {string} */
function dateDigits(value) {
  const s = String(value ?? '').replace(/\D/g, '');
  return s.length >= 8 ? s.slice(0, 8) : '';
}

/** @param {Date|string|number} [value] @returns {string} */
export function ymdDate(value = new Date()) {
  const d = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(d.getTime())) return '';
  const y = d.getFullYear(),
    m = String(d.getMonth() + 1).padStart(2, '0'),
    day = String(d.getDate()).padStart(2, '0');
  return `${y}${m}${day}`;
}

/** @param {unknown} value @returns {string|null} */
export function isoFromBankDate(value) {
  const d = dateDigits(value);
  if (!d) return null;
  const y = Number(d.slice(0, 4)),
    m = Number(d.slice(4, 6)),
    day = Number(d.slice(6, 8));
  const date = new Date(y, m - 1, day, 12, 0, 0, 0);
  return Number.isFinite(date.getTime()) ? date.toISOString() : null;
}
