import { timingSafeEqual } from 'node:crypto';
import { bankBridgeErrorResponse } from './wire-errors.mjs';
import {createBankOriginPolicy} from './origin-policy.mjs';
const MAX_JSON_REQUEST_BYTES = 32 * 1024;
const legacyOriginPolicy=createBankOriginPolicy();
function tokenEqual(expected, actual) { const a = Buffer.from(String(expected || '')), b = Buffer.from(String(actual || '')); return a.length === b.length && a.length > 0 && timingSafeEqual(a, b); }
function corsHeaders(req,originPolicy) {
    const origin=req.headers.origin;
    const headers={'Cache-Control':'no-store','Vary':'Origin'};
    if(!originPolicy.allows(origin))return headers;
    return {...headers,
        'Access-Control-Allow-Origin':origin||'*',
        'Access-Control-Allow-Methods':'GET,POST,DELETE,OPTIONS',
        'Access-Control-Allow-Headers':'Authorization,Content-Type',
        'Access-Control-Allow-Private-Network':'true',
        'Access-Control-Max-Age':'600',
    };
}
export function sendBankBridgeJson(req,res,status,data,originPolicy=legacyOriginPolicy) {
    res.writeHead(status,{'Content-Type':'application/json; charset=utf-8',...corsHeaders(req,originPolicy)});
    res.end(JSON.stringify(data));
}
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
// entry. Bank pathname/query aliases remain compatible with installed clients.
export function createBankBridgeHttpHandler({ token, routes, health, admission, originPolicy=legacyOriginPolicy, pairing }) {
    if (typeof token !== 'string' || !token || typeof routes?.resolve !== 'function' || typeof health !== 'function' || typeof admission?.assertAccepting !== 'function') {
        throw new Error('bank_bridge_http_ports_required');
    }
    if(typeof originPolicy?.allows!=='function')throw new TypeError('bank_bridge_origin_policy_required');
    const send=(req,res,status,data)=>sendBankBridgeJson(req,res,status,data,originPolicy);
    async function handle(req, res) {
        if(!originPolicy.allows(req.headers.origin)){
            send(req,res,403,{ok:false,code:'ORIGIN_NOT_ALLOWED',message:'מקור הבקשה אינו מורשה ב-Bank Bridge'});
            return;
        }
        const pathname = new URL(req.url || '/', 'http://127.0.0.1:8765').pathname;
        if (req.method === 'OPTIONS') {
            res.writeHead(204, corsHeaders(req,originPolicy));
            res.end();
            return;
        }
        if (req.method === 'GET' && pathname === '/health') {
            const data = health();
            send(req, res, 200, pairing ? {...data, pairingProtocol: pairing.protocol} : data);
            return;
        }
        try {
            const bearer = authToken(req);
            const originAllowed = origin => originPolicy.mode === 'allowlist' && originPolicy.allows(origin);
            const control = pairing?.respond({pathname, req, res, bearer, readBody:readJson,
                send:(status,data)=>send(req,res,status,data), originAllowed, canActivate:originPolicy.mode==='allowlist'});
            if (control) { await control; return; }
            let grant;
            if (pairing) grant = await pairing.capture({origin:req.headers.origin, bearer, originAllowed, readLegacy:()=>token});
            else if (!tokenEqual(token, bearer)) {
                send(req, res, 401, { ok: false, code: 'UNAUTHORIZED', message: 'מפתח Bank Bridge שגוי' });
                return;
            }
            if(pathname!=='/shutdown')admission.assertAccepting();
            const route = routes.resolve(req.method, pathname);
            if (!route) {
                send(req, res, 404, { ok: false, code: 'NOT_FOUND', message: 'נתיב Bank Bridge לא קיים' });
                return;
            }
            grant?.authorize?.(route.permission);
            const run = async () => {
              if (route.response === 'binary') {
                  grant?.assert();
                  const image = await route.run();
                  grant?.assert();
                  if (!image) {
                      send(req, res, 404, { ok: false, code: 'CHEQUE_IMAGE_NOT_FOUND', message: 'תמונת השיק אינה זמינה עוד ב-Bank Bridge המקומי' });
                      return;
                  }
                  res.writeHead(200, {
                      ...corsHeaders(req,originPolicy), 'Content-Type': image.contentType, 'Content-Length': String(image.size), 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff'
                  });
                  res.end(image.data);
                  return;
              }
              const body = route.readBody ? await readJson(req) : {};
              grant?.assert();
              // Stream on the original authorized request. Older clients keep
              // the existing JSON response and HTTP status codes.
              const report = route.streamProgress && body?.streamProgress === true
                ? (stage, index, total) => {
                    if (res.destroyed || res.writableEnded) return;
                    try { grant?.assert(); } catch { return; }
                    if (!res.headersSent)
                        res.writeHead(200, {...corsHeaders(req,originPolicy),'Content-Type':'application/x-ndjson; charset=utf-8'});
                    res.write(JSON.stringify({progress:{stage,index,total}})+'\n');
                  }
                : undefined;
              const result = await route.run(body, report);
              grant?.assert();
              if (res.destroyed) return;
              if (res.headersSent) res.end(JSON.stringify({result})+'\n');
              else send(req, res, 200, result);
              route.afterResponse?.();
            };
            if (grant) await pairing.run(grant, run);
            else await run();
        }
        catch (error) {
            if (res.destroyed || res.writableEnded) return;
            const result = bankBridgeErrorResponse(error);
            if (res.headersSent) res.end(JSON.stringify({result})+'\n');
            else send(req, res, error?.status || (error?.code === 'REQUEST_TOO_LARGE' ? 413 : 400), result);
        }
    }
    return function listener(req, res) {
        return handle(req, res).catch(error => send(req, res, 500, bankBridgeErrorResponse(error)));
    };
}
