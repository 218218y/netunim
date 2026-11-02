// @ts-check
export class JsonBodyError extends Error {
  /** @param {number} status @param {string} code */
  constructor(status, code) { super(code); this.status = status; this.code = code; }
}

/** Read actual UTF-8 bytes, regardless of a missing or dishonest Content-Length.
 * @param {Request} request
 * @param {number} maxBytes
 * @returns {Promise<Record<string, unknown>>}
 */
export async function readJsonBodyBounded(request, maxBytes) {
  const mediaType = (request.headers.get('Content-Type') || '').split(';')[0]?.trim().toLowerCase();
  const length = request.headers.get('Content-Length') || '';
  const earlyError = mediaType !== 'application/json' ? new JsonBodyError(415, 'unsupported_media_type') :
    /^\d+$/.test(length) && Number(length) > maxBytes ? new JsonBodyError(413, 'request_too_large') : null;
  if (earlyError) {
    void request.body?.cancel().catch(() => {});
    throw earlyError;
  }
  const reader = request.body?.getReader();
  if (!reader) throw new JsonBodyError(400, 'invalid_json_body');
  const decoder = new TextDecoder('utf-8', {fatal:true});
  let size = 0, text = '';
  try {
    while (true) {
      const part = await reader.read();
      if (part.done) break;
      size += part.value.byteLength;
      if (size > maxBytes) throw new JsonBodyError(413, 'request_too_large');
      text += decoder.decode(part.value, {stream:true});
    }
    text += decoder.decode();
    const value = JSON.parse(text);
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new JsonBodyError(400, 'invalid_json_body');
    return value;
  } catch (error) {
    // Cancellation must not delay rejection if the sender never settles it.
    void reader.cancel().catch(() => {});
    throw error instanceof JsonBodyError ? error : new JsonBodyError(400, 'invalid_json_body');
  } finally { reader.releaseLock(); }
}
