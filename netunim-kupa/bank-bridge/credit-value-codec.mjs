// @ts-check

/** @param {unknown} value @param {number} [max] */
export function text(value, max = 240) {
  return String(value ?? '')
    .trim()
    .replace(/\s+/g, ' ')
    .slice(0, max);
}

/** @param {unknown} value @returns {string|null} */
export function safeDate(value) {
  if (!value) return null;
  const raw = String(value).trim(),
    floatingIso = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,9})?)?$/.test(raw),
    d = new Date(floatingIso ? `${raw}Z` : raw);
  return Number.isFinite(d.getTime()) ? d.toISOString() : null;
}

/** @param {unknown} value @returns {string} */
export function explicitTransactionTime(value) {
  const match = /[T\s](\d{2}):(\d{2})(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})?$/.exec(
    String(value ?? '').trim()
  );
  if (!match) return '';
  const time = `${match[1]}:${match[2]}`;
  return time === '00:00' ? '' : time;
}

/** @param {string} message @param {string} code @param {Record<string,unknown>} [extra] @returns {Error & {code:unknown}} */
export function safeError(message, code, extra = {}) {
  const e = Object.assign(new Error(message),{code});
  Object.assign(e, extra);
  return e;
}

/** @param {unknown} value @returns {string} */
export function safeSuffix(value) {
  const digits = String(value ?? '').replace(/\D/g, '');
  return digits ? digits.slice(-4) : text(value, 4);
}

/** @param {unknown} error @returns {Exclude<import('./credit-model-contracts.js').FetchStatus,'success'>} */
export function errorFetchStatus(error) {
  const code = String(error!==null&&typeof error==='object'&&'code' in error?error.code||'':'');
  if (code === 'CREDIT_PROVIDER_SCHEMA_ERROR' || code === 'CREDIT_PROVIDER_RESPONSE_NOT_JSON')
    return 'schema_error';
  if (code === 'CREDIT_PROVIDER_NETWORK_ERROR') return 'network_error';
  return 'provider_error';
}

/** @param {unknown} value @param {PropertyKey} key @returns {boolean} */
export function hasOwn(value, key) {
  return !!value && typeof value === 'object' && Object.prototype.hasOwnProperty.call(value, key);
}
