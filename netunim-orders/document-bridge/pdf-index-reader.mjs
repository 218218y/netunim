// @ts-check

export const PDF_INDEX_SCHEMA = 3;
const READABLE_SCHEMAS = new Set([1, 2, PDF_INDEX_SCHEMA]);

/** @typedef {{readSnapshot: () => Promise<string | null>, readJournal: () => Promise<string | null>,
 * signature: () => Promise<string>}} PdfIndexFiles */
/** @template {{fullPath: string}} Entry
 * @typedef {{entries: ReadonlyMap<string, Entry>, pending: number, pdfCount: number,
 * updatedAt: number, signature: string}} PdfIndexCandidate
 */

/** @param {string} kind @param {number} [lineNumber] */
function invalid(kind, lineNumber) {
  const message = kind === 'SNAPSHOT'
    ? 'PDF index snapshot is invalid or newer than this Bridge; leaving it untouched'
    : `PDF index journal is invalid${lineNumber === undefined ? '' : ` at line ${lineNumber}`}; leaving it untouched`;
  return Object.assign(new Error(message), {code: `PDF_INDEX_${kind}_INVALID`, ...(lineNumber === undefined ? {} : {lineNumber})});
}
/** @param {unknown} value @returns {value is Record<string, unknown>} */
function object(value) { return value !== null && typeof value === 'object' && !Array.isArray(value); }
/** @param {string} text @param {string} kind @param {number} [lineNumber] @returns {unknown} */
function parse(text, kind, lineNumber) {
  try { return JSON.parse(text.replace(/^\uFEFF/, '')); } catch { throw invalid(kind, lineNumber); }
}
/** @param {unknown} value */
function count(value) {
  if (value === undefined || value === null) return 0;
  if (typeof value !== 'number' && typeof value !== 'string') throw invalid('SNAPSHOT');
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < 0) throw invalid('SNAPSHOT');
  return number;
}

/** @template {{fullPath: string}} Entry
 * @param {{files: PdfIndexFiles, normalizeEntry: (raw: unknown) => Entry | null}} ports */
export function createPdfIndexReader({files, normalizeEntry}) {
  if (typeof files?.readSnapshot !== 'function' || typeof files.readJournal !== 'function' ||
      typeof files.signature !== 'function' || typeof normalizeEntry !== 'function') throw new Error('pdf_index_reader_ports_required');
  /** @param {unknown} raw @param {string} kind @param {number} [lineNumber] @returns {Entry} */
  function entry(raw, kind, lineNumber) {
    if (!object(raw) || typeof raw.fullPath !== 'string' || !raw.fullPath) throw invalid(kind, lineNumber);
    const normalized = normalizeEntry(raw);
    if (!normalized || normalized.fullPath !== raw.fullPath) throw invalid(kind, lineNumber);
    return normalized;
  }
  /** Caller holds the existing index lock across read and synchronous publication.
   * All JSON is decoded into a candidate; no active model or file is modified here.
   * @returns {Promise<PdfIndexCandidate<Entry>>} */
  async function read() {
    const before = await files.signature();
    const snapshotText = await files.readSnapshot(), journalText = await files.readJournal();
    /** @type {Map<string, Entry>} */
    const entries = new Map();
    let pending = 0, pdfCount = 0, updatedAt = 0;
    if (snapshotText !== null) {
      const snapshot = parse(snapshotText, 'SNAPSHOT');
      if (!object(snapshot) || (typeof snapshot.schema !== 'number' && typeof snapshot.schema !== 'string') ||
          !READABLE_SCHEMAS.has(Number(snapshot.schema)) || !Array.isArray(snapshot.entries)) throw invalid('SNAPSHOT');
      pending = count(snapshot.pending); pdfCount = count(snapshot.pdfCount);
      const parsedDate = Date.parse(String(snapshot.updatedAt || ''));
      updatedAt = Number.isFinite(parsedDate) ? parsedDate : 0;
      for (const raw of snapshot.entries) {
        const normalized = entry(raw, 'SNAPSHOT'); entries.set(normalized.fullPath.toLocaleLowerCase('en-US'), normalized);
      }
    }
    const lines = (journalText || '').replace(/^\uFEFF/, '').split(/\r?\n/);
    for (let index = 0; index < lines.length; index++) {
      const line = lines[index]; if (!line?.trim()) continue;
      const record = parse(line, 'JOURNAL', index + 1);
      if (!object(record)) throw invalid('JOURNAL', index + 1);
      if (record.op === 'upsert') {
        const normalized = entry(record.entry, 'JOURNAL', index + 1); entries.set(normalized.fullPath.toLocaleLowerCase('en-US'), normalized);
      } else if (record.op === 'remove' && typeof record.fullPath === 'string' && record.fullPath) {
        entries.delete(record.fullPath.toLocaleLowerCase('en-US'));
      } else throw invalid('JOURNAL', index + 1);
    }
    const signature = await files.signature();
    if (before !== signature) throw Object.assign(new Error('PDF index files changed during read; retry under the index lock'), {code: 'PDF_INDEX_READ_CHANGED'});
    return {entries, pending, pdfCount, updatedAt, signature};
  }
  return {read};
}
