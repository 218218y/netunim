// Independent from document issuance. Only callers in this function choose paths.
export function createExpenseTransport({environment, clientId, clientSecret, fetch:send = globalThis.fetch, timeoutMs = 20000}) {
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
      try { data = JSON.parse(body); } catch { throw new Error('morning_response_invalid'); }
      return {response, data};
    } finally { clearTimeout(timer); }
  }
  async function authenticate() {
    if (token && expires > Date.now() + 60000) return token;
    if (!flight) flight = (async () => {
      if (!clientId || !clientSecret) throw new Error('morning_not_configured');
      const {response, data} = await bounded(identity + '/idp/v1/oauth/token', {method:'POST', headers:{'Content-Type':'application/json'},
        body:JSON.stringify({grant_type:'client_credentials', client_id:clientId, client_secret:clientSecret})});
      const value = data?.access_token || data?.accessToken;
      if (!response.ok || typeof value !== 'string' || !value) throw new Error('morning_auth_failed');
      token = value;
      const lifetime = Number(data.expires_in ?? data.expiresIn);
      expires = Date.now() + (Number.isFinite(lifetime) && lifetime > 0 ? Math.min(lifetime, 3600) : 300) * 1000;
      return token;
    })().finally(() => { flight = null; });
    return flight;
  }
  return async function request(path, init = {}, {upload = false} = {}) {
    if (typeof path !== 'string' || !path.startsWith('/') || path.startsWith('//')) throw new Error('invalid_morning_path');
    const host = upload ? (environment === 'sandbox' ? 'https://api.sandbox.d.greeninvoice.co.il' : 'https://api.morning.co') : api;
    for (let attempt = 0; attempt < 2; attempt++) {
      const bearer = await authenticate();
      const result = await bounded(host + path, {...init, headers:{'Content-Type':'application/json', Authorization:`Bearer ${bearer}`}});
      // Reads may refresh authorization. Never replay financial writes here.
      const read = !init.method || init.method === 'GET' || path.endsWith('/search');
      if (read && result.response.status === 401 && attempt === 0) { token = ''; expires = 0; continue; }
      if (!result.response.ok) throw Object.assign(new Error('morning_source_failed'), {status:result.response.status});
      return result.data;
    }
    throw new Error('morning_auth_failed');
  };
}
