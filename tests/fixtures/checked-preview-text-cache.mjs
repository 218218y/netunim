import {createPreviewTextCache} from '../../netunim-orders/document-bridge/preview-text-cache.mjs';
const cache = createPreviewTextCache({clock: Date.now, ttlMs: 600000, maxEntries: 24});
cache.read('C:\\file.txt', '1:2', async () => ({text: 'data', source: 'file', truncated: false}));
// @ts-expect-error clocks must return numeric milliseconds
createPreviewTextCache({clock: () => 'now', ttlMs: 600000, maxEntries: 24});
// @ts-expect-error source discriminant must identify the actual text supplier
cache.read('C:\\file.txt', '1:2', async () => ({text: 'data', source: 'unknown', truncated: false}));
// @ts-expect-error cache loaders must settle asynchronously with explicit truncation
cache.read('C:\\file.txt', '1:2', () => ({text: 'data', source: 'file', truncated: false}));
// @ts-expect-error result expiry is numeric, not a formatted time
createPreviewTextCache({clock: Date.now, ttlMs: '10 minutes', maxEntries: 24});
// @ts-expect-error file version evidence is captured text, not mutable metadata
cache.read('C:\\file.txt', {mtimeMs: 2}, async () => null);
cache.read('C:\\form.pdf', '1:2', async () => ({text: 'form', source: 'pdfjs-acroform', truncated: false, formFields: [{pageNumber: 1, annotationIndex: 0, fieldKey: 'f', fieldName: '', fieldType: 'Tx', rect: [1, 2, 3, 4], values: ['text'], multiLine: false}]}));
