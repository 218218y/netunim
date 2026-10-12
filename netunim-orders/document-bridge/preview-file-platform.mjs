import fs from 'node:fs/promises';
import {decodePreviewText, trimPreviewText, TEXT_PREVIEW_MAX_BYTES} from './preview-content.mjs';

const READ_CHUNK_BYTES = 64 * 1024;
const tooLarge = () => Object.assign(new Error('הקובץ גדול מדי לתצוגה מקדימה מהירה.'), {code: 'PREVIEW_TOO_LARGE'});

/** Opens one handle per request. Search metadata never authorizes an unbounded
 * read of a file that changed later. Only read access is used; every exit closes
 * the handle, including failed stat/read/decode and budget rejection.
 */
export function createPreviewFilePlatform({open = fs.open} = {}) {
  async function read(fullPath, maxBytes, prefix) {
    if (!Number.isSafeInteger(maxBytes) || maxBytes < 1) throw new Error('document_preview_byte_budget_required');
    const handle = await open(fullPath, 'r');
    try {
      const stat = await handle.stat();
      if (!stat.isFile()) throw Object.assign(new Error('תיקייה אינה קובץ לתצוגה מקדימה.'), {code: 'PREVIEW_NOT_FILE'});
      if (!prefix && stat.size > maxBytes) throw tooLarge();
      const chunks = []; let length = 0;
      // One lookahead byte distinguishes exact-limit EOF from growth/overflow.
      // This also bounds allocations and reads if the file keeps growing.
      while (length <= maxBytes) {
        const chunk = Buffer.allocUnsafe(Math.min(READ_CHUNK_BYTES, maxBytes + 1 - length));
        const {bytesRead} = await handle.read(chunk, 0, chunk.length, length);
        if (!bytesRead) break;
        chunks.push(chunk.subarray(0, bytesRead)); length += bytesRead;
      }
      const truncated = length > maxBytes;
      if (truncated && !prefix) throw tooLarge();
      const buffer = Buffer.concat(chunks, length).subarray(0, maxBytes);
      return {buffer, truncated};
    } finally { await handle.close(); }
  }
  return {
    async readText(fullPath) {
      const {buffer, truncated} = await read(fullPath, TEXT_PREVIEW_MAX_BYTES, true);
      const result = trimPreviewText(decodePreviewText(buffer));
      return {...result, truncated: result.truncated || truncated};
    },
    async readBinary(fullPath, maxBytes) { return (await read(fullPath, maxBytes, false)).buffer; },
  };
}
