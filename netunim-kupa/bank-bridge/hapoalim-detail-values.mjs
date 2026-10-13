// @ts-check

/** @param {unknown} value @param {number} [max] @returns {string} */
export function compactText(value, max = 240) {
  return String(value ?? '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max);
}

/** @param {unknown} value @returns {string} */
export function detailKeyToken(value) {
  return String(value ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9א-ת]+/g, '');
}

/** @param {unknown} value @returns {string} */
function primitiveDetailValue(value) {
  if (typeof value === 'string') return compactText(value, 180);
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  if (typeof value === 'boolean') return value ? 'כן' : 'לא';
  return '';
}

/** @param {unknown} value @returns {string} */
export function meaningfulDetailValue(value) {
  const clean = primitiveDetailValue(value),
    token = detailKeyToken(clean);
  if (
    !clean ||
    token === '0' ||
    token === 'false' ||
    token === 'לא' ||
    token === 'none' ||
    token === 'null' ||
    token === 'undefined'
  )
    return '';
  return clean;
}
