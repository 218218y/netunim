import { timingSafeEqual } from 'node:crypto';
import { bankBridgeErrorResponse } from './wire-errors.mjs';
const MAX_JSON_REQUEST_BYTES = 32 * 1024;
function tokenEqual(expected, actual) { const a = Buffer.from(String(expected || '')), b = Buffer.from(String(actual || '')); return a.length === b.length && a.length > 0 && timingSafeEqual(a, b); }
function corsHeaders(req) { const origin = req.headers.origin || '*'; return {
    'Access-Control-Allow-Origin': origin, 'Access-Control-Allow-Methods': 'GET,POST,DELETE,OPTIONS', 'Access-Control-Allow-Headers': 'Authorization,Content-Type', 'Access-Control-Allow-Private-Network': 'true', 'Access-Control-Max-Age': '600', 'Cache-Control': 'no-store', 'Vary': 'Origin'
}; }
export function sendBankBridgeJson(req, res, status, data) { res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', ...corsHeaders(req) }); res.end(JSON.stringify(data)); }
async function readJson(req) {
    let size = 0, chunks = [];
    for await (const chunk of req) {
        size += chunk.length;
        if (size > MAX_JSON_REQUEST_BYTES)
            throw Object.assign(new Error('הבקשה גדולה מדי'), { code: 'REQUEST_TOO_LARGE' });
        chunks.push(chunk);
    }
    if (!chunks.length)
        return {};
    try {
        return JSON.parse(Buffer.concat(chunks).toString('utf8'));
    }
    catch {
        throw Object.assign(new Error('JSON לא תקין'), { code: 'INVALID_JSON' });
    }
}
function authToken(req) { const value = String(req.headers.authorization || ''); return value.startsWith('Bearer ') ? value.slice(7).trim() : ''; }
// One entry gate precedes all private routes, body consumption and capability
// entry. Bank pathname/query aliases and reflected CORS remain its own policy.
export function createBankBridgeHttpHandler({ token, routes, health }) {
    if (typeof token !== 'string' || !token || typeof routes?.resolve !== 'function' || typeof health !== 'function') {
        throw new Error('bank_bridge_http_ports_required');
    }
    async function handle(req, res) {
        const pathname = new URL(req.url || '/', 'http://127.0.0.1:8765').pathname;
        if (req.method === 'OPTIONS') {
            res.writeHead(204, corsHeaders(req));
            res.end();
            return;
        }
        if (req.method === 'GET' && pathname === '/health') {
            sendBankBridgeJson(req, res, 200, health());
            return;
        }
        if (!tokenEqual(token, authToken(req))) {
            sendBankBridgeJson(req, res, 401, { ok: false, code: 'UNAUTHORIZED', message: 'מפתח Bank Bridge שגוי' });
            return;
        }
        try {
            const route = routes.resolve(req.method, pathname);
            if (!route) {
                sendBankBridgeJson(req, res, 404, { ok: false, code: 'NOT_FOUND', message: 'נתיב Bank Bridge לא קיים' });
                return;
            }
            if (route.response === 'binary') {
                const image = await route.run();
                if (!image) {
                    sendBankBridgeJson(req, res, 404, { ok: false, code: 'CHEQUE_IMAGE_NOT_FOUND', message: 'תמונת השיק אינה זמינה עוד ב-Bank Bridge המקומי' });
                    return;
                }
                res.writeHead(200, {
                    ...corsHeaders(req), 'Content-Type': image.contentType, 'Content-Length': String(image.size), 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff'
                });
                res.end(image.data);
                return;
            }
            const result = await route.run(route.readBody ? await readJson(req) : {});
            sendBankBridgeJson(req, res, 200, result);
            route.afterResponse?.();
        }
        catch (error) {
            sendBankBridgeJson(req, res, error?.code === 'REQUEST_TOO_LARGE' ? 413 : 400, bankBridgeErrorResponse(error));
        }
    }
    return function listener(req, res) {
        return handle(req, res).catch(error => sendBankBridgeJson(req, res, 500, bankBridgeErrorResponse(error)));
    };
}
