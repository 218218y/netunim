import { createPdfPreviewOperation } from '../../netunim-orders/document-bridge/pdf-preview-operation.mjs';
import { createPdfExtractionProcess } from '../../netunim-orders/document-bridge/pdf-extraction-process.mjs';
import { decodePdfExtractionResult } from '../../netunim-orders/document-bridge/pdf-extraction-result.mjs';
/** @type {import('../../netunim-orders/document-bridge/pdf-preview-operation.mjs').PdfPreviewPorts} */
const ports = {
  index: { load: async () => {}, get: () => undefined, append: async () => {} },
  extraction: { read: async () => ({}) },
  paths: { basename: file => file, dirname: file => file },
  presentation: {
    trim: text => ({ text, truncated: false }),
    fields: () => []
  },
  policy: { detectionRevision: 2, searchTextRevision: 2, geometryRevision: 1 },
  audit: { write: async () => {} }
};
const owner = createPdfPreviewOperation(ports);
/** @type {Promise<void>} */ const stopped = owner.dispose();
void stopped;
/** @type {Promise<void>} */ const invalidated =
  owner.invalidate('C:\\one.pdf');
void invalidated;
createPdfPreviewOperation({
  ...ports,
  // @ts-expect-error durable index publication must be awaited
  index: { ...ports.index, append: () => true }
});
// @ts-expect-error an unknown worker result cannot be treated as decoded text
const text = decodePdfExtractionResult(/** @type {unknown} */ ({})).text * 3;
void text;
createPdfPreviewOperation({
  ...ports,
  presentation: {
    ...ports.presentation,
    // @ts-expect-error trimming returns a synchronous projection
    trim: async text => ({ text, truncated: false })
  }
});
const worker = createPdfExtractionProcess({
  worker: { start: () => ({ kill: () => {} }) },
  runtime: { setTimeout: () => ({}), clearTimeout: () => {} }
});
/** @type {Promise<void>} */ const drained = worker.dispose();
void drained;
createPdfExtractionProcess(
  {
    worker: { start: () => ({ kill: () => {} }) },
    runtime: { setTimeout: () => ({}), clearTimeout: () => {} }
  },
  // @ts-expect-error timeout budgets are numeric
  { timeoutMs: '25 seconds' }
);
// @ts-expect-error worker output must be decoded before a consumer can see it
/** @type {Promise<string>} */ const raw = worker.read('C:\\one.pdf');
void raw;
