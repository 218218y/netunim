import {createDocumentPreview} from '../../netunim-orders/document-bridge/preview-content.mjs';
/** @type {import('../../netunim-orders/document-bridge/preview-content.mjs').PreviewContentPorts} */
const ports = {
  resolve: async () => ({mode: 'content', officeKind: '', structuredKind: '', metadata: {
    name: 'example.pdf', path: 'C:\\files', fullPath: 'C:\\files\\example.pdf', extension: 'pdf', size: 3, isDirectory: false, modified: '',
  }}),
  files: {readText: async () => ({text: 'preview', truncated: false}), readBinary: async () => new Uint8Array([1, 2, 3])},
  indexedText: async () => null,
};
const preview = createDocumentPreview(ports);
preview.file('opaque-result-id').then(result => result.buffer.byteLength);
// @ts-expect-error file reads must receive a numeric byte budget
ports.files.readBinary('example.pdf', '64MB');
// @ts-expect-error text reads must report truncation explicitly
createDocumentPreview({...ports, files: {...ports.files, readText: async () => ({text: 'partial'})}});
// @ts-expect-error binary transport cannot return a text string
createDocumentPreview({...ports, files: {...ports.files, readBinary: async () => 'bytes'}});
// @ts-expect-error directory evidence is a boolean, not a stat function
createDocumentPreview({...ports, resolve: async () => ({mode: '', officeKind: '', structuredKind: '', metadata: {name: '', path: '', fullPath: '', extension: '', size: 0, isDirectory: () => false, modified: ''}})});
preview.document('opaque-id').then(result => {
  if (result.kind === 'text') result.text.slice(0, 1);
  // @ts-expect-error native/binary/folder responses do not promise text content
  if (result.kind === 'native') result.text.slice(0, 1);
});
