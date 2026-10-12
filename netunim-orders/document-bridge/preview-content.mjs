// @ts-check

export const TEXT_PREVIEW_MAX_BYTES = 1024 * 1024;
export const BINARY_PREVIEW_MAX_BYTES = 64 * 1024 * 1024;
export const TEXT_PREVIEW_MAX_CHARS = 600000;
const TEXT_EXTENSIONS = new Set(['txt','log','md','markdown','csv','tsv','json','xml','yaml','yml','ini','cfg','conf','sql','js','mjs','cjs','ts','tsx','jsx','css','scss','less','html','htm']);
const BINARY_PREVIEW_MIME = new Map([['pdf','application/pdf'],['png','image/png'],['jpg','image/jpeg'],['jpeg','image/jpeg'],['gif','image/gif'],['webp','image/webp'],['bmp','image/bmp'],['svg','image/svg+xml']]);
const STRUCTURED_PREVIEW_MIME = new Map([['docx','application/vnd.openxmlformats-officedocument.wordprocessingml.document'],['docm','application/vnd.ms-word.document.macroEnabled.12'],['dotx','application/vnd.openxmlformats-officedocument.wordprocessingml.template'],['dotm','application/vnd.ms-word.template.macroEnabled.12'],['xls','application/vnd.ms-excel'],['xlsx','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'],['xlsm','application/vnd.ms-excel.sheet.macroEnabled.12'],['xlsb','application/vnd.ms-excel.sheet.binary.macroEnabled.12'],['xlt','application/vnd.ms-excel'],['xltx','application/vnd.openxmlformats-officedocument.spreadsheetml.template'],['xltm','application/vnd.ms-excel.template.macroEnabled.12']]);

/** @typedef {{text: string, truncated: boolean}} TextPreview
 * @typedef {{name: string, path: string, fullPath: string, extension: string,
 * size: number, isDirectory: boolean, modified: string}} PreviewMetadata
 * @typedef {{mode: string, metadata: PreviewMetadata, officeKind: string, structuredKind: string}} PreviewTarget
 * @typedef {{readText: (fullPath: string) => Promise<TextPreview>,
 * readBinary: (fullPath: string, maxBytes: number) => Promise<Uint8Array>}} PreviewFiles
 * @typedef {{resolve: (id: unknown) => Promise<PreviewTarget>, files: PreviewFiles,
 * indexedText: (fullPath: string) => Promise<TextPreview | null>}} PreviewContentPorts
 * @typedef {PreviewMetadata & ({ok: true, kind: 'folder'} |
 * {ok: true, kind: 'binary', mime: string, source: 'file'} |
 * {ok: true, kind: 'structured', documentKind: string, mime: string, source: 'local-renderer'} |
 * {ok: true, kind: 'text', source: 'file' | 'office-text-fallback' | 'everything-content', text: string, truncated: boolean} |
 * {ok: true, kind: 'native', source: 'windows-preview-handler', officeKind: string} |
 * {ok: true, kind: 'unavailable', reason: 'too-large' | 'no-preview-handler'})} PreviewResult
 */

/** @param {string} extension */
export const isTextPreview = extension => TEXT_EXTENSIONS.has(extension);

/** @param {unknown} value @returns {TextPreview} */
export function trimPreviewText(value) {
  const text = String(value ?? '').replace(/\u0000/g, '');
  return {text: text.slice(0, TEXT_PREVIEW_MAX_CHARS), truncated: text.length > TEXT_PREVIEW_MAX_CHARS};
}

/** @param {Uint8Array} bytes */
export function decodePreviewText(bytes) {
  if (bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) return new TextDecoder('utf-8').decode(bytes.subarray(3));
  if (bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xfe) return new TextDecoder('utf-16le').decode(bytes.subarray(2));
  if (bytes.length >= 2 && bytes[0] === 0xfe && bytes[1] === 0xff) return new TextDecoder('utf-16be').decode(bytes.subarray(2));
  try { return new TextDecoder('utf-8', {fatal: true}).decode(bytes); } catch {}
  try { return new TextDecoder('windows-1255').decode(bytes); } catch {
    return Array.from(bytes, byte => String.fromCharCode(byte)).join('');
  }
}

/** @param {PreviewContentPorts} ports */
export function createDocumentPreview({resolve, files, indexedText}) {
  if (typeof resolve !== 'function' || typeof indexedText !== 'function' ||
      typeof files?.readText !== 'function' || typeof files.readBinary !== 'function') {
    throw new Error('document_preview_ports_required');
  }
  /** @param {unknown} id @returns {Promise<PreviewResult>} */
  async function document(id) {
    const {mode, metadata: meta, officeKind, structuredKind} = await resolve(id);
    if (meta.isDirectory) return {ok: true, kind: 'folder', ...meta};
    const mime = BINARY_PREVIEW_MIME.get(meta.extension);
    if (mime && meta.size <= BINARY_PREVIEW_MAX_BYTES) return {ok: true, kind: 'binary', mime, source: 'file', ...meta};
    if (mode === 'content' && structuredKind && meta.size <= BINARY_PREVIEW_MAX_BYTES) {
      return {ok: true, kind: 'structured', documentKind: structuredKind,
        mime: STRUCTURED_PREVIEW_MIME.get(meta.extension) || 'application/octet-stream', source: 'local-renderer', ...meta};
    }
    if (isTextPreview(meta.extension)) return {ok: true, kind: 'text', source: 'file', ...meta, ...await files.readText(meta.fullPath)};
    if (mode === 'content' && officeKind) {
      const indexed = await indexedText(meta.fullPath);
      if (indexed) return {ok: true, kind: 'text', source: 'office-text-fallback', ...meta, ...indexed};
    }
    if (officeKind) return {ok: true, kind: 'native', source: 'windows-preview-handler', officeKind, ...meta};
    const indexed = await indexedText(meta.fullPath);
    if (indexed) return {ok: true, kind: 'text', source: 'everything-content', ...meta, ...indexed};
    if (mime || structuredKind) return {ok: true, kind: 'unavailable', reason: 'too-large', ...meta};
    return {ok: true, kind: 'unavailable', reason: 'no-preview-handler', ...meta};
  }
  /** @param {unknown} id @returns {Promise<{buffer: Uint8Array, mime: string, name: string}>} */
  async function file(id) {
    const {metadata: meta} = await resolve(id);
    if (meta.isDirectory) throw Object.assign(new Error('תיקייה אינה קובץ לתצוגה מקדימה.'), {code: 'PREVIEW_NOT_FILE'});
    const mime = BINARY_PREVIEW_MIME.get(meta.extension) || STRUCTURED_PREVIEW_MIME.get(meta.extension);
    if (!mime) throw Object.assign(new Error('סוג הקובץ אינו נתמך בתצוגה בינארית.'), {code: 'PREVIEW_UNSUPPORTED'});
    if (meta.size > BINARY_PREVIEW_MAX_BYTES) throw Object.assign(new Error('הקובץ גדול מדי לתצוגה מקדימה מהירה.'), {code: 'PREVIEW_TOO_LARGE'});
    // Metadata classifies the result; the file port must enforce the same byte
    // budget on the opened handle, including growth after this snapshot.
    return {buffer: await files.readBinary(meta.fullPath, BINARY_PREVIEW_MAX_BYTES), mime, name: meta.name};
  }
  return {document, file};
}
