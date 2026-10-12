// @ts-check
/** @typedef {{fullPath: string, extension: string, isDirectory: boolean}} PdfInventoryRow */
/** @template {PdfInventoryRow} Row
 * @typedef {{count: (signal: AbortSignal | null) => Promise<number>,
 * page: (request: {offset: number, limit: number, modifiedSince: string, signal: AbortSignal | null}) => Promise<readonly Row[]>}} PdfInventorySession
 */
/** @template {PdfInventoryRow} Row
 * @param {{open: (signal: AbortSignal | null) => Promise<PdfInventorySession<Row>>, isStopping: () => boolean}} ports
 * @param {{pageSize: number}} options */
export function createPdfInventory({open, isStopping}, {pageSize}) {
  if (typeof open !== 'function' || typeof isStopping !== 'function' || !Number.isSafeInteger(pageSize) || pageSize < 1 || pageSize > 1000) throw new Error('pdf_inventory_ports_required');
  /** @param {AbortSignal | null} signal */
  function assertActive(signal) {
    if (isStopping() || signal?.aborted) throw Object.assign(new Error('PDF inventory interrupted'), {code: 'ABORT_ERR', name: 'AbortError'});
  }
  const changed = () => Object.assign(new Error('PDF inventory changed or repeated during paging; reconciliation deferred'), {code: 'PDF_INVENTORY_CHANGED'});
  /** @param {number} value */
  function count(value) { if (!Number.isSafeInteger(value) || value < 0) throw Object.assign(new Error('PDF inventory count is invalid'), {code: 'PDF_INVENTORY_COUNT_INVALID'}); return value; }
  /** @param {{signal?: AbortSignal | null, modifiedSince?: string, verifyComplete?: boolean}} [options] @returns {Promise<Row[]>} */
  async function read({signal = null, modifiedSince = '', verifyComplete = false} = {}) {
    if (typeof modifiedSince !== 'string' || (modifiedSince && !/^\d{4}-\d{2}-\d{2}$/.test(modifiedSince)) || (verifyComplete && modifiedSince)) throw new Error('pdf_inventory_scope_required');
    assertActive(signal); const session = await open(signal); assertActive(signal);
    let expected = null;
    if (verifyComplete) { expected = count(await session.count(signal)); assertActive(signal); }
    /** @type {Row[]} */ const entries = [];
    const seen = new Set(); let offset = 0;
    while (true) {
      assertActive(signal); const page = await session.page({offset, limit: pageSize, modifiedSince, signal}); assertActive(signal);
      if (!Array.isArray(page) || page.length > pageSize) throw Object.assign(new Error('PDF inventory page is invalid'), {code: 'PDF_INVENTORY_PAGE_INVALID'});
      for (const row of page) {
        if (!row || typeof row.fullPath !== 'string' || !row.fullPath || row.extension !== 'pdf' || row.isDirectory !== false) throw Object.assign(new Error('PDF inventory row is invalid'), {code: 'PDF_INVENTORY_PAGE_INVALID'});
        const key = row.fullPath.toLocaleLowerCase('en-US');
        if (seen.has(key)) throw changed(); seen.add(key); entries.push(row);
      }
      if (expected !== null && entries.length > expected) throw changed();
      if (page.length < pageSize) break;
      offset += page.length;
    }
    if (expected !== null) { const final = count(await session.count(signal)); assertActive(signal); if (expected !== final || seen.size !== final) throw changed(); }
    assertActive(signal); return entries;
  }
  return {read, assertActive};
}
