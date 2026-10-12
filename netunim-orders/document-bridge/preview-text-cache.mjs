// @ts-check

/** @typedef {{pageNumber: number, annotationIndex: number, fieldKey: string,
 * fieldName: string, fieldType: string, rect: [number, number, number, number],
 * values: string[], multiLine: boolean}} PreviewFormField
 * @typedef {{text: string, truncated: boolean,
 * source: 'file' | 'everything-content' | 'pdfjs-acroform', formFields?: PreviewFormField[]}} SearchablePreviewText
 * @typedef {{clock: () => number, ttlMs: number, maxEntries: number}} PreviewCacheOptions
 * @typedef {{fingerprint: string, at: number, data: SearchablePreviewText | null,
 * pending: Promise<SearchablePreviewText | null> | null}} PreviewCacheEntry
 */

/** @param {PreviewCacheOptions} options */
export function createPreviewTextCache({clock, ttlMs, maxEntries}) {
  if (typeof clock !== 'function' || !Number.isFinite(ttlMs) || ttlMs < 0 ||
      !Number.isSafeInteger(maxEntries) || maxEntries < 1) throw new Error('document_preview_cache_options_required');
  /** @type {Map<string, PreviewCacheEntry>} */
  const entries = new Map();
  let disposed = false;
  /** @param {string} fullPath */
  const keyFor = fullPath => fullPath.toLocaleLowerCase('en-US');
  function prune() {
    const now = clock();
    for (const [key, entry] of entries) {
      // Started extraction has its own deadline. Result TTL begins on success;
      // cache capacity can still evict its slot without cancelling the work.
      if (!entry.pending && now - entry.at > ttlMs) entries.delete(key);
    }
    while (entries.size > maxEntries) {
      const oldest = entries.keys().next().value;
      if (oldest === undefined) break;
      entries.delete(oldest);
    }
  }
  /** @param {string} key @param {PreviewCacheEntry} entry */
  function touch(key, entry) { entries.delete(key); entries.set(key, entry); }

  /** @param {string} fullPath @param {string} fingerprint
   * @param {() => Promise<SearchablePreviewText | null>} load
   * @returns {Promise<SearchablePreviewText | null>} */
  function read(fullPath, fingerprint, load) {
    if (disposed) return Promise.reject(new Error('document_preview_cache_disposed'));
    if (typeof fullPath !== 'string' || !fullPath || typeof fingerprint !== 'string' || !fingerprint || typeof load !== 'function') {
      throw new Error('document_preview_cache_request_required');
    }
    prune();
    const key = keyFor(fullPath), cached = entries.get(key);
    if (cached?.fingerprint === fingerprint) {
      touch(key, cached);
      if (cached.pending) return cached.pending;
      cached.at = clock();
      return Promise.resolve(cached.data);
    }
    // The entry object is this extraction's authority. Invalidation, eviction
    // or replacement retires it; a late callback cannot reacquire that authority.
    /** @type {PreviewCacheEntry} */
    const entry = {fingerprint, at: clock(), data: null, pending: null};
    touch(key, entry);
    const pending = Promise.resolve().then(() => {
      if (disposed) throw new Error('document_preview_cache_disposed');
      return load();
    }).then(data => {
      if (!disposed && entries.get(key) === entry) {
        if (data) { entry.data = data; entry.pending = null; entry.at = clock(); touch(key, entry); prune(); }
        else entries.delete(key);
      }
      // Already-started callers retain their own result. Only cache publication
      // is fenced; no implicit second extraction/retry is started here.
      return data;
    }, error => {
      if (entries.get(key) === entry) entries.delete(key);
      throw error;
    });
    entry.pending = pending; prune();
    return pending;
  }
  /** @param {string} fullPath */
  function invalidate(fullPath) { entries.delete(keyFor(fullPath)); }
  function dispose() { disposed = true; entries.clear(); }
  return {read, invalidate, dispose};
}
