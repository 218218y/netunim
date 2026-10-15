import fs from 'node:fs/promises';

// Missing derived metadata starts empty. Existing but unreadable/malformed bytes
// remain evidence; they must not silently become an empty writable checkpoint.
export async function readPdfMaintenanceMetadata(file) {
  try {
    return JSON.parse((await fs.readFile(file, 'utf8')).replace(/^\uFEFF/, ''));
  } catch (error) {
    if (error?.code === 'ENOENT') return {};
    if (error instanceof SyntaxError)
      throw Object.assign(new Error('PDF maintenance metadata is invalid.'), {
        code: 'PDF_MAINTENANCE_METADATA_INVALID',
        cause: error
      });
    throw error;
  }
}
