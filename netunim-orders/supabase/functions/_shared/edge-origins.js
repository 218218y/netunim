const productionOrigins = ['https://bargig-furniture.com', 'https://bargig-orders.pages.dev', 'https://bargig-kupa.pages.dev'];
export function edgeOrigins(extra = '') {
  const origins = new Set(productionOrigins);
  for (const entry of extra.split(',').map(x => x.trim()).filter(Boolean)) {
    const url = new URL(entry);
    if (entry.includes('*') || url.origin !== entry || (url.protocol !== 'https:' &&
        !(url.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(url.hostname)))) throw Error('Invalid Edge origin configuration');
    origins.add(entry);
  }
  return origins;
}
export function edgeResponse(req, response, origins) {
  const headers = new Headers(response.headers);
  headers.delete('Access-Control-Allow-Origin');
  headers.set('Vary', 'Origin');
  headers.set('Cache-Control', 'no-store');
  headers.set('Referrer-Policy', 'no-referrer');
  const origin = req.headers.get('Origin');
  if (origin && origins.has(origin)) headers.set('Access-Control-Allow-Origin', origin);
  return new Response(response.body, {status:response.status, statusText:response.statusText, headers});
}
export function withEdgeOrigins(handler, origins) {
  return async req => {
    const origin = req.headers.get('Origin');
    const response = origin && !origins.has(origin) ? Response.json({code:'origin_not_allowed'}, {status:403}) : await handler(req);
    return edgeResponse(req, response, origins);
  };
}
