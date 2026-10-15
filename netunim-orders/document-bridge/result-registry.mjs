// @ts-check

/**
 * Private full paths never leave this owner as public results. Accepted file
 * commands capture a row before stat and retain that authority while draining.
 * @typedef {{name: string, fullPath: string, relativePath: string, modified: string,
 * size: number | null, extension: string, attributes?: string, isDirectory?: boolean}} DocumentRow
 * @typedef {{matchMode: 'phrase' | 'all' | 'any' | 'proximity', wordMatch: 'partial' | 'whole', proximityWords: number}} ContentSearch
 * @typedef {{query: string, mode: 'everything' | 'content', contentSearch: ContentSearch}} ResultContext
 * @typedef {{id: string, name: string, relativePath: string, modified: string,
 * size: number | null, extension: string, attributes: string, isDirectory: boolean,
 * rootId: 'everything', rootLabel: 'Everything'}} PublicDocumentRow
 * @typedef {{fullPath: string, name: string, relativePath: string, modified: string,
 * size: number | null, attributes: string, expiresAt: number} & ResultContext} StoredResult
 * @typedef {{size: number, mtimeMs: number, mtime: Date, isDirectory: () => boolean}} ResultStat
 * @typedef {{clock: {now: () => number, ttlMs: number}, identity: {next: () => string},
 * files: {stat: (fullPath: string) => Promise<ResultStat>}}} ResultRegistryPorts
 */

/** @param {ResultRegistryPorts} ports */
export function createDocumentResultRegistry({ clock, identity, files }) {
  /** @type {Map<string, StoredResult>} */ const entries = new Map();
  let disposed = false;
  function assertActive() {
    if (disposed)
      throw Object.assign(new Error('Document results are closing.'), {
        code: 'DOCUMENT_RESULTS_DISPOSED'
      });
  }
  function prune() {
    const now = clock.now();
    for (const [id, row] of entries)
      if (row.expiresAt <= now) entries.delete(id);
  }
  /** @param {DocumentRow} row @param {ResultContext} context @returns {PublicDocumentRow} */
  function publish(row, context) {
    assertActive();
    const id = identity.next();
    entries.set(id, {
      fullPath: row.fullPath,
      name: row.name,
      relativePath: row.relativePath,
      modified: row.modified,
      size: row.size,
      attributes: row.attributes || '',
      query: context.query,
      mode: context.mode,
      contentSearch: context.contentSearch,
      expiresAt: clock.now() + clock.ttlMs
    });
    return {
      id,
      name: row.name,
      relativePath: row.relativePath,
      modified: row.modified,
      size: row.size,
      extension: row.extension,
      attributes: row.attributes || '',
      isDirectory: !!row.isDirectory,
      rootId: 'everything',
      rootLabel: 'Everything'
    };
  }
  /** @param {unknown} id */
  async function resolve(id) {
    assertActive();
    prune();
    const row = entries.get(String(id || ''));
    if (!row)
      throw Object.assign(new Error('תוצאת החיפוש פגה. חפש שוב את הקובץ.'), {
        code: 'RESULT_EXPIRED'
      });
    let stat;
    try {
      stat = await files.stat(row.fullPath);
    } catch {
      throw Object.assign(new Error('הקובץ כבר אינו קיים או שאינו נגיש.'), {
        code: 'OPEN_TARGET_MISSING'
      });
    }
    return { row, stat };
  }
  /** @param {unknown} fullPath */
  function invalidate(fullPath) {
    const target = String(fullPath || '').toLocaleLowerCase('en-US'),
      invalidatedIds = [];
    for (const [id, row] of entries) {
      if (String(row.fullPath || '').toLocaleLowerCase('en-US') !== target)
        continue;
      entries.delete(id);
      invalidatedIds.push(id);
    }
    return invalidatedIds;
  }
  function dispose() {
    disposed = true;
    entries.clear();
  }
  return { prune, publish, resolve, invalidate, dispose };
}
