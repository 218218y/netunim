// Independent from document issuance. Only callers in this function choose paths.
export function createExpenseTransport({environment, clientId, clientSecret, fetch:send = globalThis.fetch, timeoutMs = 20000,
  now = Date.now, sleep = ms => new Promise(resolve => setTimeout(resolve, ms))}) {
  if (!['production', 'sandbox'].includes(environment)) throw new Error('morning_environment_invalid');
  const api = environment === 'sandbox' ? 'https://sandbox.d.greeninvoice.co.il/api/v1' : 'https://api.greeninvoice.co.il/api/v1';
  const identity = environment === 'sandbox' ? 'https://api.sandbox.morning.dev' : 'https://api.morning.co';
  let token = '', expires = 0, flight = null;
  async function bounded(url, init) {
    const controller = new AbortController(), timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await send(url, {...init, signal:controller.signal, redirect:'error'});
      const body = await response.text(); // Keep the timeout through body consumption.
      let data;
      try { data = JSON.parse(body); } catch { if (response.ok) throw new Error('morning_response_invalid'); data = null; }
      return {response, data};
    } finally { clearTimeout(timer); }
  }
  async function authenticate() {
    if (token && expires > now() + 60000) return token;
    if (!flight) flight = (async () => {
      if (!clientId || !clientSecret) throw new Error('morning_not_configured');
      const {response, data} = await bounded(identity + '/idp/v1/oauth/token', {method:'POST', headers:{'Content-Type':'application/json'},
        body:JSON.stringify({grant_type:'client_credentials', client_id:clientId, client_secret:clientSecret})});
      const value = data?.access_token || data?.accessToken;
      if (!response.ok || typeof value !== 'string' || !value) throw Object.assign(new Error('morning_auth_failed'), {status:response.status});
      token = value;
      const lifetime = Number(data.expires_in ?? data.expiresIn);
      expires = now() + (Number.isFinite(lifetime) && lifetime > 0 ? Math.min(lifetime, 3600) : 300) * 1000;
      return token;
    })().finally(() => { flight = null; });
    return flight;
  }
  return async function request(path, init = {}, {upload = false} = {}) {
    if (typeof path !== 'string' || !path.startsWith('/') || path.startsWith('//')) throw new Error('invalid_morning_path');
    const host = upload ? (environment === 'sandbox' ? 'https://api.sandbox.d.greeninvoice.co.il' : 'https://api.morning.co') : api;
    const method = (init.method || 'GET').toUpperCase();
    const read = method === 'GET' || method === 'POST' && ['/suppliers/search', '/expenses/search', '/expenses/drafts/search'].includes(path);
    let refreshed = false, throttles = 0;
    for (;;) {
      const bearer = await authenticate();
      const result = await bounded(host + path, {...init, headers:{'Content-Type':'application/json', Authorization:`Bearer ${bearer}`}});
      // Reads may refresh authorization. Never replay financial writes here.
      if (read && result.response.status === 401 && !refreshed) { token = ''; expires = 0; refreshed = true; continue; }
      if (read && result.response.status === 429 && throttles < 2) {
        const header = result.response.headers.get('Retry-After');
        const delay = header === null ? 500 * 2 ** throttles : /^\d+(\.\d+)?$/.test(header) ? Number(header) * 1000 : Date.parse(header) - now();
        // A long server cooldown is surfaced instead of retried early. Bound
        // both count and delay; never replay a financial POST or upload bytes.
        if (Number.isFinite(delay) && delay >= 0 && delay <= 5000) { throttles++; await sleep(Math.max(100, delay)); continue; }
      }
      if (!result.response.ok) throw Object.assign(new Error('morning_source_failed'), {status:result.response.status});
      return result.data;
    }
  };
}
