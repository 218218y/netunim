const productionOrigins = ['https://bargig-furniture.com', 'https://bargig-orders.pages.dev', 'https://bargig-kupa.pages.dev'];
export function googleOAuthOrigins(extra = '') {
  const origins = new Set(productionOrigins);
  for (const entry of extra.split(',').map(x => x.trim()).filter(Boolean)) {
    const url = new URL(entry);
    if (url.origin !== entry || (url.protocol !== 'https:' &&
        !(url.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(url.hostname)))) throw Error('Invalid Google OAuth origin configuration');
    origins.add(entry);
  }
  return origins;
}
export function googleOAuthResponse(req, response, origins) {
  const headers = new Headers(response.headers);
  headers.delete('Access-Control-Allow-Origin');
  headers.set('Vary', 'Origin');
  headers.set('Cache-Control', 'no-store');
  headers.set('Referrer-Policy', 'no-referrer');
  const origin = req.headers.get('Origin');
  if (origin && origins.has(origin)) headers.set('Access-Control-Allow-Origin', origin);
  return new Response(response.body, {status:response.status, statusText:response.statusText, headers});
}
