import {createPdfIndexReader} from '../../netunim-orders/document-bridge/pdf-index-reader.mjs';
/** @type {import('../../netunim-orders/document-bridge/pdf-index-reader.mjs').PdfIndexFiles} */
const files = {readSnapshot: async () => null, readJournal: async () => null, signature: async () => 'stable'};
const reader = createPdfIndexReader({files, normalizeEntry: raw => {
  if (raw !== null && typeof raw === 'object' && 'fullPath' in raw && typeof raw.fullPath === 'string') return {fullPath: raw.fullPath, text: 'normalized'};
  return null;
}});
/** @param {string} value */
const showText = value => value.slice(0, 1);
reader.read().then(candidate => {
  candidate.entries.get('c:\\file.pdf')?.text.slice(0, 1);
  // @ts-expect-error publication metadata is numeric, not a formatted count
  showText(candidate.pending);
  // @ts-expect-error candidates expose read-only entries
  candidate.entries.clear();
});
// @ts-expect-error journal reads must distinguish text from a missing file
createPdfIndexReader({files: {...files, readJournal: async () => false}, normalizeEntry: () => ({fullPath: 'C:\\file.pdf'})});
// @ts-expect-error signatures must describe file metadata rather than a boolean gate
createPdfIndexReader({files: {...files, signature: async () => true}, normalizeEntry: () => ({fullPath: 'C:\\file.pdf'})});
// @ts-expect-error normalized entries preserve a string path
createPdfIndexReader({files, normalizeEntry: () => ({fullPath: 123})});
// @ts-expect-error decoding normalizers must finish synchronously before publication
createPdfIndexReader({files, normalizeEntry: async () => ({fullPath: 'C:\\file.pdf'})});
