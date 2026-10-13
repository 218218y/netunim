// @ts-check
/**
 * Numeric strings remain accepted. Absence, blank text and coercible objects
 * are not financial evidence. A genuine numeric zero remains a known value.
 * @param {unknown} value @returns {number|null}
 */
export function readBankMoney(value) {
  if (typeof value !== 'number' && (typeof value !== 'string' || !value.trim())) return null;
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}
