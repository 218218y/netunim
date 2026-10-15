// @ts-check

/**
 * Search plans have passed the server's existing query/scope/type normalizers.
 * Only decoded Everything/PDF rows cross the read ports; wire input is never a
 * file path capability. Publication grants opaque IDs for the final page only.
 * @typedef {import('./result-registry.mjs').DocumentRow} DocumentRow
 * @typedef {import('./result-registry.mjs').PublicDocumentRow} PublicDocumentRow
 * @typedef {import('./result-registry.mjs').ResultContext} ResultContext
 * @typedef {import('./result-registry.mjs').ContentSearch} ContentSearch
 * @typedef {{field: 'name' | 'path' | 'size' | 'modified', direction: 'asc' | 'desc'}} DocumentSort
 * @typedef {{query: unknown, mode: 'everything' | 'content', contentSearch: ContentSearch,
 * scopePath: string, sort: DocumentSort, fileType: string, everythingQuery: string,
 * includePdf: boolean}} SearchPlan
 * @typedef {{query: unknown, mode: 'everything' | 'content', contentSearch: ContentSearch,
 * scopePath: string, sort: DocumentSort, fileType: string, limit: number, offset: number}} SearchRead
 * @typedef {{scopePath: string, fileType: string}} RecentPlan
 * @typedef {{ok: true, bridgeVersion: number, query: string, mode: 'everything' | 'content',
 * contentSearch: ContentSearch, fileType: string, scopePath: string, sort: DocumentSort,
 * offset: number, limit: number, results: PublicDocumentRow[], hasMore: boolean,
 * maxResults: number, elapsedMs: number, partial: boolean, rootErrors: unknown[]}} SearchPage
 * @typedef {{ok: true, bridgeVersion: number, mode: 'recent', fileType: string,
 * scopePath: string, results: PublicDocumentRow[], elapsedMs: number,
 * partial: false, rootErrors: unknown[]}} RecentPage
 * @typedef {{everything: {
 * search: (request: SearchRead) => Promise<{rows: DocumentRow[], elapsedMs: number}>,
 * recent: (request: RecentPlan & {limit: number}) => Promise<{rows: DocumentRow[], elapsedMs: number}>},
 * pdf: {prepare: () => Promise<{partial: boolean}>,
 * search: (request: SearchPlan, limit: number) => DocumentRow[]},
 * ordering: {merge: (groups: DocumentRow[][], limit: number, ceiling: number) => DocumentRow[],
 * compare: (left: DocumentRow, right: DocumentRow, sort: DocumentSort) => number},
 * publication: {prune: () => void, publish: (row: DocumentRow, context: ResultContext) => PublicDocumentRow},
 * audit: {write: (message: string) => Promise<void>}}} SearchPorts
 * @typedef {{bridgeVersion: number, maxResults: number, defaultLimit: number,
 * recentLimit: number}} SearchLimits
 * @typedef {{search: (plan: SearchPlan, limit: unknown, offset: unknown) => Promise<SearchPage>,
 * recent: (plan: RecentPlan, limit: unknown) => Promise<RecentPage>, dispose: () => Promise<void>}} DocumentSearch
 */

/** Join accepted siblings before surfacing the first observed failure.
 * Promise.all alone releases the caller while the other read still has work.
 * @template Left, Right
 * @param {() => Promise<Left>} first @param {() => Promise<Right>} second
 * @returns {Promise<[Left, Right]>} */
async function readTogether(first, second) {
  let failed = false;
  /** @type {unknown} */ let failure;
  /** @param {unknown} error @returns {never} */
  function capture(error) {
    if (!failed) {
      failed = true;
      failure = error;
    }
    throw error;
  }
  const [left, right] = await Promise.allSettled([
    Promise.resolve().then(first).catch(capture),
    Promise.resolve().then(second).catch(capture)
  ]);
  if (failed) throw failure;
  if (left?.status !== 'fulfilled' || right?.status !== 'fulfilled') {
    throw new Error('document_search_incomplete_reads');
  }
  return [left.value, right.value];
}

/** @param {SearchPorts} ports @param {SearchLimits} limits @returns {DocumentSearch} */
export function createDocumentSearch(
  { everything, pdf, ordering, publication, audit },
  { bridgeVersion, maxResults, defaultLimit, recentLimit }
) {
  let disposed = false;
  /** @type {Set<Promise<void>>} */ const pending = new Set();
  function assertActive() {
    if (disposed)
      throw Object.assign(new Error('Document search is closing.'), {
        code: 'DOCUMENT_SEARCH_DISPOSED'
      });
  }
  /** @template Value @param {() => Promise<Value>} work @returns {Promise<Value>} */
  function accept(work) {
    try {
      assertActive();
    } catch (error) {
      return Promise.reject(error);
    }
    const operation = Promise.resolve().then(() => {
      assertActive();
      return work();
    });
    const settled = operation.then(
      () => {},
      () => {}
    );
    pending.add(settled);
    void settled.then(() => pending.delete(settled));
    return operation;
  }
  /** @param {SearchPlan} plan @param {number} limit @param {number} offset @returns {SearchRead} */
  function request(plan, limit, offset) {
    return {
      query: plan.query,
      mode: plan.mode,
      contentSearch: plan.contentSearch,
      scopePath: plan.scopePath,
      sort: plan.sort,
      fileType: plan.fileType,
      limit,
      offset
    };
  }
  /** @param {SearchPlan} plan @param {unknown} limit @param {unknown} offset @returns {Promise<SearchPage>} */
  async function searchPage(plan, limit, offset) {
    const {
      query,
      mode,
      contentSearch,
      scopePath,
      sort,
      fileType,
      everythingQuery
    } = plan;
    const pageOffset = Math.max(
      0,
      Math.min(maxResults, Math.trunc(Number(offset) || 0))
    );
    const available = Math.max(0, maxResults - pageOffset);
    const boundedLimit = Math.min(
      available,
      Math.max(1, Math.trunc(Number(limit) || defaultLimit))
    );
    /** @param {PublicDocumentRow[]} results @param {boolean} hasMore @param {number} elapsedMs @param {boolean} partial @returns {SearchPage} */
    const page = (results, hasMore, elapsedMs, partial) => ({
      ok: true,
      bridgeVersion,
      query: String(query || '').trim(),
      mode,
      contentSearch,
      fileType,
      scopePath,
      sort,
      offset: pageOffset,
      limit: boundedLimit,
      results,
      hasMore,
      maxResults,
      elapsedMs,
      partial,
      rootErrors: []
    });
    if (!boundedLimit) return page([], false, 0, false);
    const wanted = Math.min(maxResults, pageOffset + boundedLimit + 1);
    /** @type {DocumentRow[]} */ let rows = [],
      supplemental = [],
      pageRows = [];
    let elapsedMs = 0,
      hasMore = false,
      partial = false;
    if (mode === 'everything') {
      const result = await everything.search(
        request(plan, Math.min(boundedLimit + 1, available), pageOffset)
      );
      rows = result.rows;
      elapsedMs = result.elapsedMs;
      pageRows = rows.slice(0, boundedLimit);
      hasMore =
        rows.length > boundedLimit && pageOffset + boundedLimit < maxResults;
    } else {
      const [result, indexState] = await readTogether(
        () => everything.search(request(plan, wanted, 0)),
        () => pdf.prepare()
      );
      assertActive();
      rows = result.rows;
      elapsedMs = result.elapsedMs;
      supplemental = plan.includePdf ? pdf.search(plan, wanted) : [];
      const merged = ordering
        .merge([rows, supplemental], wanted, maxResults)
        .sort((a, b) => ordering.compare(a, b, sort));
      pageRows = merged.slice(pageOffset, pageOffset + boundedLimit);
      hasMore =
        merged.length > pageOffset + pageRows.length &&
        pageOffset + boundedLimit < maxResults;
      partial = indexState.partial;
    }
    assertActive();
    publication.prune();
    const results = pageRows.map(row =>
      publication.publish(row, {
        query: String(query || ''),
        mode,
        contentSearch
      })
    );
    await audit.write(
      `SEARCH mode=${mode} offset=${pageOffset} limit=${boundedLimit} hasMore=${hasMore} partial=${partial} contentSearch=${JSON.stringify(contentSearch)} fileType=${fileType} sort=${sort.field}:${sort.direction} scope=everything-index+interactive-pdf scopePath=${JSON.stringify(scopePath)} results=${results.length} everythingResults=${rows.length} pdfSupplemental=${supplemental.length} elapsedMs=${elapsedMs} input=${JSON.stringify(String(query || ''))} everythingQuery=${JSON.stringify(everythingQuery)}`
    );
    assertActive();
    return page(results, hasMore, elapsedMs, partial);
  }
  /** @param {RecentPlan} plan @param {unknown} limit @returns {Promise<RecentPage>} */
  async function recentPage({ scopePath, fileType }, limit) {
    const boundedLimit = Math.min(
      recentLimit,
      Math.max(1, Number(limit) || recentLimit)
    );
    const { rows, elapsedMs } = await everything.recent({
      limit: boundedLimit,
      scopePath,
      fileType
    });
    assertActive();
    publication.prune();
    const results = ordering.merge([rows], boundedLimit, recentLimit).map(row =>
      publication.publish(row, {
        query: '',
        mode: 'everything',
        contentSearch: {
          matchMode: 'phrase',
          wordMatch: 'partial',
          proximityWords: 0
        }
      })
    );
    await audit.write(
      `RECENT scope=everything-index scopePath=${JSON.stringify(scopePath)} fileType=${fileType} sort=date-modified-descending results=${results.length} elapsedMs=${elapsedMs}`
    );
    assertActive();
    return {
      ok: true,
      bridgeVersion,
      mode: 'recent',
      fileType,
      scopePath,
      results,
      elapsedMs,
      partial: false,
      rootErrors: []
    };
  }
  async function dispose() {
    disposed = true;
    await Promise.all([...pending]);
  }
  return {
    search: (plan, limit, offset) =>
      accept(() => searchPage(plan, limit, offset)),
    recent: (plan, limit) => accept(() => recentPage(plan, limit)),
    dispose
  };
}
