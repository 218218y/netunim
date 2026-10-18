// @ts-check
import {evidenceDate, evidenceTimestamp} from './observation-time.js';

/** Historical feeds accept calendar dates and zoned timestamps. Invalid dates
 * must never roll into a different calendar day during normalization.
 * @param {unknown} value @returns {string|null} */
export function bankFeedTimestamp(value) {
  if (typeof value !== 'string') return null;
  const text = value.trim();
  return evidenceDate(text) || evidenceTimestamp(text) ? new Date(text).toISOString() : null;
}

/** Date-only business values keep their day. Timestamp values retain the
 * existing local-calendar conversion used by the Morning form.
 * @param {unknown} value @returns {string} */
export function bankDocumentDate(value) {
  if (typeof value !== 'string') return '';
  const text = value.trim();
  if (evidenceDate(text)) return text;
  if (!evidenceTimestamp(text)) return '';
  const date = new Date(text);
  return new Date(date.getTime() - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 10);
}
