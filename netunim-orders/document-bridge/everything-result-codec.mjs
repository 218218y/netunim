// @ts-check
/** @param {string} message @param {string} code @param {number} [rowIndex] */
function invalid(message, code, rowIndex) { return Object.assign(new Error(message), {code, ...(rowIndex === undefined ? {} : {rowIndex})}); }
/** @param {unknown} value @returns {value is Record<string, unknown>} */
const object = value => !!value && typeof value === 'object' && !Array.isArray(value);
/** @param {string} stdout */
export function decodeEverythingCount(stdout) {
  if (typeof stdout !== 'string') throw invalid('ES returned an invalid result count', 'ES_INVALID_COUNT');
  const raw = stdout.replace(/^\uFEFF/, '').trim(), value = Number(raw);
  if (!/^\d+$/.test(raw) || !Number.isSafeInteger(value)) throw invalid('ES returned an invalid result count', 'ES_INVALID_COUNT');
  return value;
}
/** @param {unknown} parsed @returns {unknown[]} */
function rows(parsed) {
  if (Array.isArray(parsed)) return parsed;
  if (object(parsed)) {
    // Keep the named compatibility wrappers. Unrelated metadata arrays cannot
    // establish a successful empty result or replace a malformed results field.
    const collections = Object.entries(parsed).filter(([key]) => ['results', 'items', 'files', 'rows'].includes(key.toLowerCase()));
    if (collections.length === 1 && Array.isArray(collections[0]?.[1])) return collections[0][1];
  }
  throw invalid('ES returned an invalid result collection', 'ES_INVALID_JSON');
}
/** @template {{fullPath: string}} Row
 * @param {string} stdout @param {(raw: unknown) => Row | null} normalizeRow @returns {Row[]} */
export function decodeEverythingRows(stdout, normalizeRow) {
  if (typeof stdout !== 'string' || typeof normalizeRow !== 'function') throw invalid('ES returned invalid JSON', 'ES_INVALID_JSON');
  const raw = stdout.replace(/^\uFEFF/, '').trim();
  // ES 1.1.0.38 emits the JSON opening bracket at its first row. No matches
  // legitimately produce blank stdout; retain that reviewed compatibility.
  if (!raw) return [];
  /** @type {unknown} */ let parsed;
  try { parsed = JSON.parse(raw); } catch { throw invalid('ES returned invalid JSON', 'ES_INVALID_JSON'); }
  return rows(parsed).map((value, rowIndex) => {
    if (!object(value)) throw invalid('ES returned an invalid result row', 'ES_INVALID_JSON', rowIndex);
    const row = normalizeRow(value);
    if (!row || typeof row.fullPath !== 'string' || !row.fullPath) {
      void Promise.resolve(row).catch(() => {});
      throw invalid('ES returned an invalid result row', 'ES_INVALID_JSON', rowIndex);
    }
    return row;
  });
}
