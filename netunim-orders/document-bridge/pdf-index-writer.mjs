// @ts-check
import {PDF_INDEX_SCHEMA} from './pdf-index-reader.mjs';

/** @typedef {{signature: () => Promise<string>, appendJournal: (text: string) => Promise<void>,
 * replaceSnapshot: (text: string) => Promise<void>, clearJournal: () => Promise<void>}} PdfIndexWriteFiles
 * @typedef {{run: <T>(work: () => Promise<T>) => Promise<T>}} PdfIndexWriteLock
 */
/** @template {{fullPath: string}} Entry
 * @typedef {{reader: {read: () => Promise<import('./pdf-index-reader.mjs').PdfIndexCandidate<Entry>>,
 * stage: (candidate: import('./pdf-index-reader.mjs').PdfIndexCandidate<Entry>, records: readonly unknown[]) => import('./pdf-index-reader.mjs').PdfIndexCandidate<Entry>},
 * files: PdfIndexWriteFiles, lock: PdfIndexWriteLock, serializeEntry: (entry: Entry) => unknown,
 * publish: (candidate: import('./pdf-index-reader.mjs').PdfIndexCandidate<Entry>, phase: 'append' | 'compact') => undefined,
 * now: () => number}} PdfIndexWriterPorts
 */
/** @param {unknown} value @param {number} [space] */
function encode(value, space) { const text = JSON.stringify(value, null, space); if (typeof text !== 'string') throw new Error('pdf_index_write_record_required'); return text; }
/** @param {string} text @returns {unknown} */
const decode = text => JSON.parse(text);
/** @param {number} value */
function count(value) { if (!Number.isSafeInteger(value) || value < 0) throw new Error('pdf_index_write_count_required'); return value; }

/** @template {{fullPath: string}} Entry @param {PdfIndexWriterPorts<Entry>} ports */
export function createPdfIndexWriter({reader, files, lock, serializeEntry, publish, now}) {
  if ([reader?.read, reader?.stage, files?.signature, files?.appendJournal, files?.replaceSnapshot, files?.clearJournal,
    lock?.run, serializeEntry, publish, now].some(port => typeof port !== 'function')) throw new Error('pdf_index_writer_ports_required');
  /** @type {import('./pdf-index-reader.mjs').PdfIndexCandidate<Entry> | null} */ let known = null;
  async function readHead() {
    if (known && await files.signature() === known.signature) return known;
    return reader.read();
  }
  /** @param {string} expected */
  async function assertSignature(expected) {
    if (await files.signature() !== expected) throw Object.assign(new Error('PDF index changed before write; retained files require a fresh read'), {code: 'PDF_INDEX_WRITE_CHANGED'});
  }
  /** @param {import('./pdf-index-reader.mjs').PdfIndexCandidate<Entry>} candidate @param {'append' | 'compact'} phase */
  function publication(candidate, phase) {
    known = candidate;
    try {
      /** @type {unknown} */ const outcome = publish(candidate, phase);
      if (outcome !== undefined) { void Promise.resolve(outcome).catch(() => {}); throw new Error('pdf_index_publication_must_be_synchronous'); }
    }
    catch (cause) { throw Object.assign(new Error('PDF index committed but publication failed; reread before retry', {cause}), {code: 'PDF_INDEX_COMMITTED_PUBLICATION_FAILED', committed: true}); }
  }
  /** @param {readonly unknown[]} records */
  async function append(records) {
    if (!records.length) return;
    const encoded = records.map(record => encode(record));
    await lock.run(async () => {
      const head = await readHead(), candidate = reader.stage(head, encoded.map(decode));
      await assertSignature(head.signature);
      await files.appendJournal(encoded.join('\n') + '\n');
      const signature = await files.signature();
      publication({...candidate, signature}, 'append');
    });
  }
  /** @param {{pending?: number, pdfCount?: number}} [options] */
  async function compact({pending, pdfCount} = {}) {
    await lock.run(async () => {
      const head = await readHead(), updatedAt = now();
      const metadata = {pending: count(pending ?? head.pending), pdfCount: count(pdfCount ?? head.pdfCount)};
      const entries = [...head.entries.values()].map(serializeEntry);
      // Validate serialized bytes too; a faulty serializer cannot change path
      // identity, erase known records, or authorize later journal clearance.
      const encoded = entries.map(entry => encode(entry));
      const candidate = reader.stage({...head, entries: new Map()}, encoded.map(text => ({op: 'upsert', entry: decode(text)})));
      if (candidate.entries.size !== head.entries.size || [...head.entries].some(([key, value]) => candidate.entries.get(key)?.fullPath !== value.fullPath)) throw new Error('pdf_index_serialization_changed');
      const snapshot = encode({schema: PDF_INDEX_SCHEMA, updatedAt: new Date(updatedAt).toISOString(), ...metadata, entries: encoded.map(decode)}, 2);
      await assertSignature(head.signature);
      await files.replaceSnapshot(snapshot + '\n');
      // The complete snapshot commits first. If journal replacement fails, the
      // old complete journal remains replayable over it; never truncate in place.
      await files.clearJournal();
      const signature = await files.signature();
      publication({...candidate, ...metadata, updatedAt, signature}, 'compact');
    });
  }
  return {append, compact};
}
