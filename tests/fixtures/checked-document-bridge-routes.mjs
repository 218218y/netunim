import {createDocumentBridgeRoutes} from '../../netunim-orders/document-bridge/http-routes.mjs';
/** @type {import('../../netunim-orders/document-bridge/http-routes.mjs').DocumentBridgeRoutePorts} */
const ports = {
  service: {status: async () => ({}), warm: async () => ({})},
  maintenance: {status: async () => ({}), start: async () => ({}), stop: async () => ({})},
  search: {search: async () => ({}), recent: async () => ({}), selectFolder: async () => ({})},
  preview: {document: async () => ({}), matches: async () => ({}), file: async () => ({buffer: new Uint8Array(), mime: 'application/pdf', name: 'test.pdf'})},
  nativePreview: {open: async () => ({}), move: async () => ({}), hide: async () => ({})},
  files: {open: async () => ({}), reveal: async () => ({}), delete: async () => ({})},
  shutdown: {prepare: async () => ({}), afterResponse: () => {}},
};
createDocumentBridgeRoutes(ports);
// @ts-expect-error all private capability facades must be bound
createDocumentBridgeRoutes({service: ports.service});
// @ts-expect-error binary preview cannot return a path or a JSON object in place of bytes
createDocumentBridgeRoutes({...ports, preview: {...ports.preview, file: async () => ({path: 'test.pdf'})}});
// @ts-expect-error shutdown must retain the response-before-teardown callback
createDocumentBridgeRoutes({...ports, shutdown: {prepare: async () => ({})}});
/** @param {import('../../netunim-orders/document-bridge/http-routes.mjs').DocumentBridgeBody} body */
function consumeWireBody(body) {
  // @ts-expect-error untrusted body fields have not been normalized into numbers
  const limit = body.limit + 1;
  // @ts-expect-error file operations accept an opaque ID, never a body.path contract
  const path = body.path;
  return {limit, path};
}
consumeWireBody({id: 'opaque-id', limit: 20});
