// @ts-check

/**
 * Parsed wire fields remain unknown here. Search/file implementations own their
 * existing normalization and opaque-result authorization; routing never accepts
 * an arbitrary filesystem path instead of a result ID.
 * @typedef {{query?: unknown, limit?: unknown, mode?: unknown, contentSearch?: unknown,
 * scopePath?: unknown, offset?: unknown, sort?: unknown, fileType?: unknown,
 * id?: unknown, geometry?: unknown}} DocumentBridgeBody
 * @typedef {{buffer: Uint8Array, mime: string, name: string}} BinaryPreview
 * @typedef {{signal?: AbortSignal}} ReadContext
 * @typedef {{readBody: boolean, response: 'json', cancellable?: boolean, run: (body: DocumentBridgeBody, context?: ReadContext) => unknown,
 * afterResponse?: () => void} | {readBody: boolean, response: 'binary',
 * run: (body: DocumentBridgeBody) => Promise<BinaryPreview>}} DocumentBridgeRoute
 * @typedef {{
 * service: {status: () => Promise<unknown>, warm: () => Promise<unknown>},
 * maintenance: {status: () => Promise<unknown>, start: () => Promise<unknown>, stop: () => Promise<unknown>},
 * search: {selectFolder: () => Promise<unknown>,
 * recent: (limit: unknown, scopePath: unknown, fileType: unknown, signal?: AbortSignal) => Promise<unknown>,
 * search: (query: unknown, limit: unknown, mode: unknown, contentSearch: unknown,
 * scopePath: unknown, offset: unknown, sort: unknown, fileType: unknown, signal?: AbortSignal) => Promise<unknown>},
 * preview: {document: (id: unknown) => Promise<unknown>, matches: (id: unknown) => Promise<unknown>,
 * file: (id: unknown) => Promise<BinaryPreview>},
 * nativePreview: {open: (id: unknown, geometry: unknown) => Promise<unknown>,
 * move: (geometry: unknown) => Promise<unknown>, hide: () => Promise<unknown>},
 * files: {open: (id: unknown) => Promise<unknown>, reveal: (id: unknown) => Promise<unknown>,
 * delete: (id: unknown) => Promise<unknown>},
 * shutdown: {prepare: () => Promise<unknown>, afterResponse: () => void}
 * }} DocumentBridgeRoutePorts
 */

/** @param {DocumentBridgeRoutePorts} ports */
export function createDocumentBridgeRoutes({service, maintenance, search, preview, nativePreview, files, shutdown}) {
  // Validate the small capability facades before starting the listener. No route
  // can select another capability or gain public access through this registry.
  /** @type {Array<[object, string[]]>} */
  const requiredPorts = [
    [service, ['status', 'warm']], [maintenance, ['status', 'start', 'stop']],
    [search, ['selectFolder', 'recent', 'search']], [preview, ['document', 'matches', 'file']],
    [nativePreview, ['open', 'move', 'hide']], [files, ['open', 'reveal', 'delete']],
    [shutdown, ['prepare', 'afterResponse']],
  ];
  for (const [capability, names] of requiredPorts) {
    if (!capability || names.some(name => typeof Reflect.get(capability, name) !== 'function')) {
      throw new Error('document_bridge_route_ports_required');
    }
  }
  /** @type {Map<string, DocumentBridgeRoute>} */
  const routes = new Map();
  /** @param {string} key @param {DocumentBridgeRoute} route */
  function register(key, route) {
    if (routes.has(key)) throw new Error('document_bridge_duplicate_route');
    routes.set(key, Object.freeze(route));
  }
  /** @param {string} key @param {(body: DocumentBridgeBody, context?: ReadContext) => unknown} run @param {boolean} [readBody] @param {boolean} [cancellable] */
  const json = (key, run, readBody = false, cancellable = false) => register(key, {response: 'json', readBody, run, ...(cancellable?{cancellable:true}:{})});
  json('GET /status', () => service.status());
  json('POST /documents/warm', () => service.warm());
  json('GET /documents/pdf-index/status', () => maintenance.status());
  json('POST /documents/pdf-index/start', () => maintenance.start());
  json('POST /documents/pdf-index/stop', () => maintenance.stop());
  json('POST /documents/select-folder', () => search.selectFolder());
  json('POST /documents/recent', (body, context) => search.recent(body.limit, body.scopePath, body.fileType, context?.signal), true, true);
  json('POST /documents/search', (body, context) => search.search(body.query, body.limit, body.mode, body.contentSearch, body.scopePath, body.offset, body.sort, body.fileType, context?.signal), true, true);
  json('POST /documents/preview', body => preview.document(body.id), true);
  json('POST /documents/matches', body => preview.matches(body.id), true);
  register('POST /documents/preview-file', {response: 'binary', readBody: true, run: body => preview.file(body.id)});
  json('POST /documents/native-preview', body => nativePreview.open(body.id, body.geometry), true);
  json('POST /documents/native-preview/move', body => nativePreview.move(body.geometry), true);
  json('POST /documents/native-preview/hide', () => nativePreview.hide());
  json('POST /documents/open', body => files.open(body.id), true);
  json('POST /documents/reveal', body => files.reveal(body.id), true);
  json('POST /documents/delete', body => files.delete(body.id), true);
  register('POST /shutdown', {response: 'json', readBody: false, run: () => shutdown.prepare(), afterResponse: () => shutdown.afterResponse()});
  return routes;
}
