import {timingSafeEqual} from 'node:crypto';
import {originAllowed} from './lib.mjs';

const REQUEST_BODY_MAX_BYTES = 8192;

function tokenEqual(expected, actual) {
  const a = Buffer.from(String(expected || '')), b = Buffer.from(String(actual || ''));
  return a.length === b.length && a.length > 0 && timingSafeEqual(a, b);
}

function authToken(req) {
  const value = String(req.headers.authorization || '');
  return value.startsWith('Bearer ') ? value.slice(7).trim() : '';
}

function corsHeaders(req, config) {
  const origin = String(req.headers.origin || '');
  return {
    'Access-Control-Allow-Origin': origin && originAllowed(origin, config.allowedOrigins) ? origin : 'null',
    'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
    'Access-Control-Allow-Headers': 'Authorization,Content-Type',
    'Access-Control-Allow-Private-Network': 'true',
    'Access-Control-Max-Age': '600', 'Cache-Control': 'no-store', 'Vary': 'Origin',
  };
}

function sendJson(req, res, status, data, config) {
  res.writeHead(status, {'Content-Type': 'application/json; charset=utf-8', ...corsHeaders(req, config)});
  res.end(JSON.stringify(data));
}

function sendBinary(req, res, {buffer, mime, name}, config) {
  res.writeHead(200, {
    'Content-Type': mime, 'Content-Length': String(buffer.length),
    'Content-Disposition': `inline; filename*=UTF-8''${encodeURIComponent(name)}`,
    ...corsHeaders(req, config),
  });
  res.end(buffer);
}

async function readJson(req) {
  let size = 0;
  const chunks = [];
  for await (const chunk of req) {
    size += chunk.length;
    if (size > REQUEST_BODY_MAX_BYTES) throw Object.assign(new Error('הבקשה גדולה מדי'), {code: 'REQUEST_TOO_LARGE'});
    chunks.push(chunk);
  }
  if (!chunks.length) return {};
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); }
  catch { throw Object.assign(new Error('JSON לא תקין'), {code: 'INVALID_JSON'}); }
}

export function documentBridgeErrorResponse(error) {
  return {ok: false, code: error?.code || 'DOCUMENT_BRIDGE_ERROR',
    message: error?.message || 'שגיאת Document Bridge', rootErrors: Array.isArray(error?.rootErrors) ? error.rootErrors : []};
}

// All private routes pass the same origin/token gate, before body consumption or
// capability entry. Configuration and token ownership stay with the runtime.
export function createDocumentBridgeHttpHandler({loadConfig, readToken, routes, health, appendLog}) {
  if ([loadConfig, readToken, health, appendLog].some(port => typeof port !== 'function') || !(routes instanceof Map)) {
    throw new Error('document_bridge_http_ports_required');
  }
  return async function handle(req, res) {
    const config = await loadConfig(), origin = String(req.headers.origin || '');
    if (origin && !originAllowed(origin, config.allowedOrigins)) {
      res.writeHead(403, {'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'Vary': 'Origin'});
      res.end(JSON.stringify({ok: false, code: 'ORIGIN_NOT_ALLOWED', message: 'מקור האתר אינו מורשה לגשת ל-Document Bridge.'}));
      return;
    }
    if (req.method === 'OPTIONS') { res.writeHead(204, corsHeaders(req, config)); res.end(); return; }
    if (req.method === 'GET' && req.url === '/health') { sendJson(req, res, 200, health(), config); return; }
    if (!tokenEqual(await readToken(), authToken(req))) {
      sendJson(req, res, 401, {ok: false, code: 'UNAUTHORIZED', message: 'מפתח Document Bridge שגוי או חסר.'}, config);
      return;
    }
    try {
      // Match the exact method and request target, preserving the wire contract:
      // query strings, trailing slashes and alternate methods are not aliases.
      const route = routes.get(`${req.method} ${req.url}`);
      if (!route) { sendJson(req, res, 404, {ok: false, code: 'NOT_FOUND', message: 'נתיב לא קיים'}, config); return; }
      // A response closes on caller cancellation even after the request body
      // completed. IncomingMessage's normal close is not a cancellation signal.
      // Commands/previews retain their accepted-work drain independently.
      const controller = route.cancellable ? new AbortController() : null;
      const disconnected = () => { if (!res.writableFinished) controller?.abort(); };
      if (controller) res.once('close', disconnected);
      try {
        const body = route.readBody ? await readJson(req) : {};
        if (res.destroyed) disconnected();
        controller?.signal.throwIfAborted();
        const result = await route.run(body, controller ? {signal:controller.signal} : undefined);
        if (!res.destroyed) {
          if (route.response === 'binary') sendBinary(req, res, result, config);
          else sendJson(req, res, 200, result, config);
        }
        route.afterResponse?.();
      } finally {
        if (controller) res.off('close', disconnected);
      }
    } catch (error) {
      if (res.destroyed) return;
      await appendLog(`${req.method} ${req.url} ${error?.code || 'ERROR'} ${error?.message || error}`);
      const status = error?.code === 'QUERY_TOO_SHORT' ? 400 : error?.code === 'RESULT_EXPIRED' ? 410 : 503;
      sendJson(req, res, status, documentBridgeErrorResponse(error), config);
    }
  };
}
