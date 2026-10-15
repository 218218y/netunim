// @ts-check
import { createRuntimeTaskOwner } from '../../shared/runtime-task-owner.js';
import {
  decodeMorningCatalogPage,
  decodeMorningCatalogDocument,
  decodeMorningCatalogMetadata,
  decodeMorningCatalogLink
} from './morning-catalog-evidence.js';
/** @typedef {import('../../core/morning-operation-scope.js').MorningAssertion} MorningAssertion */
/** @typedef {import('./morning-catalog-evidence.js').CatalogPage} CatalogPage */
/** @typedef {import('./morning-catalog-evidence.js').OperationMetadata} OperationMetadata */
/** @typedef {{fromDate:string,toDate:string,page:number,pageSize:number,sort:string,order:string,type:number[],status:number[],clientName:string}} CatalogQuery */
const CACHE_TTL_MS = 90_000;
/** @param {Date} date */
function localDate(date) {
  return new Date(date.getTime() - date.getTimezoneOffset() * 60_000)
    .toISOString()
    .slice(0, 10);
}
/** @param {Date} [now] @returns {CatalogQuery} */
export function defaultDocumentSearch(now = new Date()) {
  const from = new Date(now);
  from.setDate(from.getDate() - 90);
  return {
    fromDate: localDate(from),
    toDate: localDate(now),
    page: 0,
    pageSize: 25,
    sort: 'documentDate',
    order: 'DESC',
    type: [],
    status: [],
    clientName: ''
  };
}
/** Read-only provider/catalog owner. No issuance, financial allocation or DOM authority.
 * @param {{authority:{capture:()=>MorningAssertion},request:{json:(action:string,payload:Record<string,unknown>,assertCurrent:MorningAssertion)=>Promise<unknown>},clock:{now:()=>number}}} ports
 */
export function createMorningCatalog({ authority, request, clock }) {
  const work = createRuntimeTaskOwner();
  let disposed = false,
    generation = 0;
  /** @type {Map<string,{data:CatalogPage,assertCurrent:MorningAssertion,expires:number}>} */ const cache =
    new Map();
  /** @type {Map<string,{promise:Promise<OperationMetadata|null>,assertCurrent:MorningAssertion}>} */ const metadataCache =
    new Map();
  /** @returns {MorningAssertion} */
  function capture() {
    if (disposed)
      throw Object.assign(new Error('Morning נעצר'), {
        code: 'MORNING_OPERATION_SCOPE_CHANGED'
      });
    const assertAuth = authority.capture();
    return () => {
      if (disposed)
        throw Object.assign(new Error('Morning נעצר'), {
          code: 'MORNING_OPERATION_SCOPE_CHANGED'
        });
      assertAuth();
      return undefined;
    };
  }
  function invalidate() {
    generation++;
    cache.clear();
    metadataCache.clear();
  }
  /** @template T @param {(assertCurrent:MorningAssertion)=>Promise<T>} run @returns {Promise<T>} */
  function accept(run) {
    return work.run(() => run(capture()));
  }
  /** @param {CatalogQuery} query @param {{refresh?:boolean,isCurrent?:()=>boolean}} [options] */
  function search(query, { refresh = false, isCurrent = () => true } = {}) {
    return accept(async assertCurrent => {
      const epoch = generation,
        key = JSON.stringify(query);
      let cached = cache.get(key);
      if (cached) {
        try {
          cached.assertCurrent();
        } catch {
          cached = undefined;
          invalidate();
        }
      }
      const data =
        !refresh && cached && cached.expires > clock.now()
          ? cached.data
          : decodeMorningCatalogPage(
              await request.json('search_documents', query, assertCurrent)
            );
      assertCurrent();
      if (epoch === generation && isCurrent()) {
        if (cache.size >= 20) {
          const oldest = cache.keys().next().value;
          if (oldest !== undefined) cache.delete(oldest);
        }
        cache.set(key, {
          data,
          assertCurrent,
          expires: clock.now() + CACHE_TTL_MS
        });
      }
      return data;
    });
  }
  /** @param {string} id @param {MorningAssertion} assertCurrent */
  async function detail(id, assertCurrent) {
    const data = await request.json(
      'get_document',
      { document_id: id },
      assertCurrent
    );
    assertCurrent();
    return decodeMorningCatalogDocument(data, id);
  }
  /** @param {string} operationId */
  function metadata(operationId) {
    return accept(async assertCurrent => {
      const operation = String(operationId || '').trim();
      if (!operation) return null;
      const cached = metadataCache.get(operation);
      if (cached) {
        let current = true;
        try {
          cached.assertCurrent();
        } catch {
          current = false;
          if (metadataCache.get(operation) === cached)
            metadataCache.delete(operation);
        }
        if (current) return cached.promise;
      }
      /** @type {{promise:Promise<OperationMetadata|null>,assertCurrent:MorningAssertion}} */ let entry;
      const forget = () => {
        if (metadataCache.get(operation) === entry)
          metadataCache.delete(operation);
      };
      const pending = (async () => {
        const data = await request.json(
          'status',
          { operation_id: operation },
          assertCurrent
        );
        assertCurrent();
        const result = decodeMorningCatalogMetadata(data, operation);
        if (!result) {
          forget();
          return null;
        }
        if (!result.documentNumber || !result.documentType) {
          const document = await detail(result.documentId, assertCurrent);
          result.documentNumber = String(
            document.number || result.documentNumber
          );
          result.documentType = document.type || result.documentType;
        }
        if (!result.documentNumber || !result.documentType) {
          forget();
          return null;
        }
        return result;
      })().catch(error => {
        forget();
        throw error;
      });
      entry = { promise: pending, assertCurrent };
      metadataCache.set(operation, entry);
      return pending;
    });
  }
  /** @param {string} id */
  function readDocument(id) {
    return accept(assertCurrent => detail(id, assertCurrent));
  }
  /** @param {string} id */
  function link(id) {
    return accept(async assertCurrent => {
      const data = await request.json(
        'document_links',
        { document_id: id },
        assertCurrent
      );
      assertCurrent();
      return decodeMorningCatalogLink(data);
    });
  }
  function dispose() {
    if (disposed) return false;
    disposed = true;
    invalidate();
    work.close();
    return true;
  }
  return {
    search,
    metadata,
    document: readDocument,
    link,
    invalidate,
    runtime: { dispose, drain: work.drain, isPending: work.isPending }
  };
}
