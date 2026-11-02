// @ts-check
export class GoogleHttpError extends Error {
  /** @param {'timeout'|'network'|'http'|'response'} kind @param {string} code @param {number} [status] */
  constructor(kind, code, status = 0) {
    super(`Google OAuth ${kind} failure`);
    this.kind = kind; this.code = code; this.status = status;
  }
}

/** One deadline covers connection, headers and response consumption. No retries.
 * @param {{fetchRequest?:typeof fetch, setTimer?:typeof setTimeout, clearTimer?:typeof clearTimeout, timeoutMs?:number}} [ports]
 */
export function createGoogleHttp({fetchRequest = fetch, setTimer = setTimeout, clearTimer = clearTimeout, timeoutMs = 15000} = {}) {
  /** @param {string} url @param {RequestInit} init @param {boolean} [empty] @returns {Promise<Record<string, unknown>>} */
  return async function googleHttp(url, init, empty = false) {
    const controller = new AbortController();
    /** @type {ReadableStreamDefaultReader<Uint8Array> | undefined} */
    let reader;
    let expired = false;
    /** @type {ReturnType<typeof setTimeout> | undefined} */
    let timer;
    /** @type {Promise<never>} */
    const deadline = new Promise((_, reject) => {
      const onTimeout = () => {
        expired = true;
        reject(new GoogleHttpError('timeout', 'google_timeout'));
        controller.abort();
        void reader?.cancel().catch(() => {});
      };
      timer = setTimer(onTimeout, timeoutMs);
    });
    async function perform() {
      const response = await fetchRequest(url, {...init, signal:controller.signal});
      if (expired) { void response.body?.cancel().catch(() => {}); throw new GoogleHttpError('timeout', 'google_timeout'); }
      reader = response.body?.getReader();
      const decoder = new TextDecoder('utf-8', {fatal:true});
      let text = '', size = 0;
      try {
        if (reader) while (true) {
          const part = await reader.read();
          if (part.done) break;
          size += part.value.byteLength;
          if (size > 2 * 1024 * 1024) throw new GoogleHttpError('response', 'google_response_too_large');
          text += decoder.decode(part.value, {stream:true});
        }
        text += decoder.decode();
        /** @type {unknown} */
        let parsed = {};
        try { parsed = text ? JSON.parse(text) : {}; } catch { if (response.ok && !empty) throw new GoogleHttpError('response', 'google_invalid_response'); }
        const data = parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? /** @type {Record<string, unknown>} */ (parsed) : {};
        if (!response.ok) {
          const code = typeof data.error === 'string' && /^[a-z_]{1,80}$/.test(data.error) ? data.error : 'google_http_error';
          throw new GoogleHttpError('http', code, response.status);
        }
        if (!empty && (!text || parsed !== data)) throw new GoogleHttpError('response', 'google_invalid_response');
        return data;
      } finally {
        void reader?.cancel().catch(() => {});
        reader?.releaseLock();
      }
    }
    try {
      return await Promise.race([perform(), deadline]);
    } catch (error) {
      controller.abort();
      if (expired) throw new GoogleHttpError('timeout', 'google_timeout');
      if (error instanceof GoogleHttpError) throw error;
      throw new GoogleHttpError('network', 'google_network_error');
    } finally { clearTimer(timer); }
  };
}
