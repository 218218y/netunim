import {
  HAPOALIM_NAVIGATION_STABLE_MS,
  HAPOALIM_DATA_RETRY_LIMIT,
  retryTransientNavigation,
} from './lib.mjs';
export function createHapoalimJsonReader({ session }) {
  if (typeof session?.ready !== 'function') throw new Error('bank_json_ports_required');
  const waitForHapoalimSessionReady = session.ready;
  async function pageFetchJsonOnce(page, { url, method = 'GET', headers = {}, body } = {}) {
    const result = await page.evaluate(
      async ({ url, method, headers, body }) => {
        try {
          const response = await fetch(url, {
            method,
            headers,
            body,
            credentials: 'include',
            cache: 'no-store',
          });
          const text = await response.text();
          let data = null;
          try {
            data = text ? JSON.parse(text) : null;
          } catch {}
          return { ok: response.ok, status: response.status, data, text: text.slice(0, 600) };
        } catch (error) {
          return { ok: false, status: 0, data: null, text: String(error?.message || error) };
        }
      },
      { url, method, headers, body }
    );
    if (!result?.ok) {
      const e = new Error(
        `בנק הפועלים החזיר שגיאה בקריאת הנתונים${result?.status ? ` (HTTP ${result.status})` : ''}`
      );
      e.code = 'HAPOALIM_API_ERROR';
      e.httpStatus = result?.status || 0;
      e.detail = result?.text || '';
      throw e;
    }
    return result.data;
  }

  async function pageFetchJson(page, requestFactory, { initialReady = null } = {}) {
    let reusableReady = initialReady;
    return retryTransientNavigation(
      async () => {
        let ready = reusableReady;
        reusableReady = null;
        if (ready && String(page?.url?.() || '') !== String(ready.href || '')) ready = null;
        if (!ready)
          ready = await waitForHapoalimSessionReady(page, {
            timeoutMs: 20000,
            pollMs: 300,
            stableMs: HAPOALIM_NAVIGATION_STABLE_MS,
          });
        const request = await requestFactory(ready);
        const data = await pageFetchJsonOnce(page, request);
        return { data, ready };
      },
      { attempts: HAPOALIM_DATA_RETRY_LIMIT }
    );
  }
  return Object.freeze({ read: pageFetchJson });
}
