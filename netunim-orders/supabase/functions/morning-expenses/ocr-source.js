// Source URLs come only from a canonical draft read, never from client input.
// Provider fileHash/fileKey were NOT hashes/keys of our uploaded PDF in Sandbox.
export async function verifyOcrSource(raw, expected, environment, {fetch:send = globalThis.fetch, timeoutMs = 15000} = {}) {
  // Canonical Production expense reads returned www.greeninvoice.co.il; an
  // authenticated read-only probe verified the original PDF bytes there.
  const origins = environment === 'sandbox' ? ['https://sandbox.d.greeninvoice.co.il'] : environment === 'production' ?
    ['https://api.greeninvoice.co.il','https://www.greeninvoice.co.il'] : [];
  let url;
  try {url = new URL(raw?.url);} catch {throw new Error('morning_ocr_source_invalid');}
  if (!origins.includes(url.origin) || url.pathname !== '/api/v1/expenses/download' || url.username || url.password || url.hash ||
      !/^[\da-f]{64}$/.test(expected.sha256) || !Number.isSafeInteger(expected.size) || expected.size <= 0 || expected.size > 20 * 1024 * 1024) throw new Error('morning_ocr_source_invalid');
  const controller = new AbortController(), timer = setTimeout(() => controller.abort(), timeoutMs);
  let reader;
  try {
    const response = await send(url.href, {redirect:'error', credentials:'omit', signal:controller.signal});
    if (!response.ok || !response.body) throw new Error('morning_ocr_source_unavailable');
    const length = response.headers.get('Content-Length');
    if (length !== null && (!/^\d+$/.test(length) || Number(length) !== expected.size)) return false;
    const bytes = new Uint8Array(expected.size); let count = 0;
    reader = response.body.getReader();
    for (;;) {
      // race is needed for streams that do not propagate fetch cancellation.
      const part = await new Promise((resolve, reject) => {
        const abort = () => reject(new Error('morning_ocr_source_timeout'));
        if (controller.signal.aborted) {abort(); return;}
        controller.signal.addEventListener('abort', abort, {once:true});
        reader.read().then(resolve, reject).finally(() => controller.signal.removeEventListener('abort', abort));
      });
      if (part.done) break;
      if (count + part.value.length > expected.size) return false;
      bytes.set(part.value, count); count += part.value.length;
    }
    if (count !== expected.size) return false;
    const hash = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), n => n.toString(16).padStart(2, '0')).join('');
    return hash === expected.sha256;
  } finally {
    clearTimeout(timer);
    // Cancellation of an untrusted stalled stream must not hold the edge worker.
    if (reader) {void reader.cancel().catch(() => {});} else controller.abort();
  }
}
