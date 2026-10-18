// @ts-check
import { evidenceDate } from './observation-time.mjs';

/** @param {unknown} value @returns {string} */
function dateDigits(value) {
  if (typeof value !== 'number' && typeof value !== 'string') return '';
  const text = String(value);
  if (/^\d{8}$/.test(text)) return text;
  return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text.replaceAll('-', '') : '';
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
  // Validate the calendar before the local-noon conversion can roll a bad day
  // into a valid one. Keep the established local timezone policy unchanged.
  const calendar = `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}`;
  if (!evidenceDate(calendar)) return null;
  const date = new Date(`${calendar}T12:00:00`);
  return Number.isFinite(date.getTime()) ? date.toISOString() : null;
}
