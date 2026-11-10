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
    'X-Content-Type-Options': 'nosniff',
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

// This is the browser error contract. Native errors can embed paths, command
// lines, filenames and account details even when their code is recognized.
const publicErrors = new Map([
  ['UNAUTHORIZED', [401, 'המפתח או קוד ההצמדה שגוי, בוטל או פג.']],
  ['BRIDGE_CAPABILITY_REQUIRED', [403, 'יש לאשר מקומית הרשאה לפעולה זו במחבר.']],
  ['BRIDGE_PAIRING_INVALID', [400, 'פרטי ההצמדה אינם תקינים.']],
  ['BRIDGE_PAIRING_STORAGE', [503, 'לא ניתן לקרוא או לעדכן את הגדרות ההצמדה המקומיות.']],
  ['BRIDGE_PAIRING_INACTIVE', [409, 'יש להתחיל מעבר מקומי לפני הצמדה.']],
  ['BRIDGE_PAIRING_BUSY', [429, 'יש להשלים הצמדה ממתינה או להמתין לפקיעתה.']],
  ['QUERY_TOO_SHORT', [400, 'יש להקליד לפחות תו אחד לחיפוש שם, או שני תווים לחיפוש בתוכן.']],
  ['RESULT_EXPIRED', [410, 'תוצאת החיפוש פגה. חפש שוב את הקובץ.']],
  ['DOCUMENT_PATH_FORBIDDEN', [403, 'הנתיב מחוץ להיקף החיפוש המורשה או מוגן בהגדרות המחבר.']],
  ['DOCUMENT_ROOTS_NOT_CONFIGURED', [503, 'יש לבחור לפחות תיקייה או כונן זמינים בהגדרות Document Bridge במחשב.']],
  ['DOCUMENT_SEARCH_DISPOSED', [503, 'המחבר נסגר. אפשר לנסות שוב לאחר הפעלתו.']],
  ['DOCUMENT_COMMANDS_DISPOSED', [503, 'המחבר נסגר. אפשר לנסות שוב לאחר הפעלתו.']],
  ['PDF_MAINTENANCE_DRAIN_TIMEOUT', [503, 'המחבר ממתין לסיום עדכון אינדקס ה־PDF.']],
  ['OPEN_TARGET_MISSING', [503, 'הקובץ כבר אינו קיים או שאינו נגיש.']],
  ['ENOENT', [503, 'הקובץ, התיקייה או הכונן אינם זמינים. בדוק את הזמינות במחשב ונסה שוב.']],
  ['ENOTDIR', [503, 'התיקייה או הכונן אינם זמינים.']],
  ['EACCES', [503, 'למחבר אין גישה לקובץ או לתיקייה.']],
  ['EPERM', [503, 'Windows חסם את הפעולה בקובץ או בתיקייה.']],
  ['ES_NOT_FOUND', [503, 'כלי החיפוש של Everything אינו זמין. בדוק את ההתקנה במחשב.']],
  ['EVERYTHING_EXE_NOT_FOUND', [503, 'Everything אינו זמין. בדוק את ההתקנה במחשב.']],
  ['EVERYTHING_START_TIMEOUT', [503, 'Everything לא היה מוכן בזמן. נסה שוב.']],
  ['ES_TIMEOUT', [503, 'החיפוש לא הסתיים בזמן. אפשר לצמצם אותו ולנסות שוב.']],
  ['ES_EXIT_ERROR', [503, 'החיפוש ב־Everything נכשל. בדוק את מצב המחבר במחשב.']],
  ['ES_OUTPUT_LIMIT', [503, 'תוצאות החיפוש חורגות מהמגבלה. אפשר לצמצם את החיפוש.']],
  ['ES_CONTENT_TOO_LARGE', [503, 'תוכן המסמך חורג ממגבלת האימות. אפשר לצמצם את החיפוש.']],
  ['ES_CONTENT_UNAVAILABLE', [503, 'תוכן המסמך אינו זמין לאימות החיפוש.']],
  ['PREVIEW_TOO_LARGE', [503, 'הקובץ גדול מדי לתצוגה מקדימה מהירה.']],
  ['PREVIEW_NOT_FILE', [503, 'תיקייה אינה קובץ לתצוגה מקדימה.']],
  ['PREVIEW_UNSUPPORTED', [503, 'סוג הקובץ אינו נתמך בתצוגה מקדימה.']],
  ['NATIVE_PREVIEW_NOT_FILE', [503, 'לתיקייה אין תצוגת מסמך של Windows.']],
  ['NATIVE_PREVIEW_UNSUPPORTED', [503, 'תצוגת Windows זמינה למסמכי Office נתמכים.']],
  ['NATIVE_PREVIEW_FAILED', [503, 'לא ניתן לפתוח את התצוגה המקדימה של Windows.']],
  ['WINDOWS_REQUIRED', [503, 'הפעולה נתמכת ב־Windows בלבד.']],
  ['DELETE_TARGET_REMAINS', [503, 'Windows לא אישר שהקובץ הועבר לסל המיחזור.']],
  ['INVALID_JSON', [503, 'JSON לא תקין']],
  ['REQUEST_TOO_LARGE', [503, 'הבקשה גדולה מדי']],
]);

export function documentBridgeErrorResponse(error) {
  const code = error?.code;
  const known = publicErrors.get(code);
  return {
    ok: false,
    code: known ? code : 'DOCUMENT_BRIDGE_ERROR',
    message: known?.[1] ?? 'הפעולה ב־Document Bridge נכשלה. אפשר לבדוק את יומן המחבר במחשב.',
    rootErrors: [],
  };
}

export function documentBridgeDiagnosticCode(error) {
  const code = error?.code;
  return typeof code === 'string' && /^[A-Z][A-Z0-9_]{0,63}$/.test(code) ? code : 'ERROR';
}

// All private routes pass the same origin/token gate, before body consumption or
// capability entry. Configuration and token ownership stay with the runtime.
export function createDocumentBridgeHttpHandler({loadConfig, readToken, routes, health, appendLog, pairing}) {
  if ([loadConfig, readToken, health, appendLog].some(port => typeof port !== 'function') || !(routes instanceof Map)) {
    throw new Error('document_bridge_http_ports_required');
  }
  return async function handle(req, res) {
    const started = performance.now();
    const config = await loadConfig(), origin = String(req.headers.origin || '');
    if (origin && !originAllowed(origin, config.allowedOrigins)) {
      res.writeHead(403, {'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'Vary': 'Origin'});
      res.end(JSON.stringify({ok: false, code: 'ORIGIN_NOT_ALLOWED', message: 'מקור האתר אינו מורשה לגשת ל-Document Bridge.'}));
      return;
    }
    if (req.method === 'OPTIONS') { res.writeHead(204, corsHeaders(req, config)); res.end(); return; }
    if (req.method === 'GET' && req.url === '/health') {
      const data = health();
      sendJson(req, res, 200, pairing ? {...data, pairingProtocol:pairing.protocol} : data, config);
      return;
    }
    const bearer = authToken(req);
    const allows = value => config.allowedOrigins.includes(value) && originAllowed(value, config.allowedOrigins);
    const control = pairing?.respond({pathname:req.url,req,res,bearer,readBody:readJson,
      send:(status,data)=>sendJson(req,res,status,status >= 400 ? documentBridgeErrorResponse(data) : data,config),originAllowed:allows});
    if (control) { await control; return; }
    if (!pairing && !tokenEqual(await readToken(), bearer)) {
      sendJson(req, res, 401, {ok: false, code: 'UNAUTHORIZED', message: 'מפתח Document Bridge שגוי או חסר.'}, config);
      return;
    }
    let cancelledRead = false;
    try {
      const grant = await pairing?.capture({origin:req.headers.origin,bearer,originAllowed:allows,readLegacy:readToken});
      // Match the exact method and request target, preserving the wire contract:
      // query strings, trailing slashes and alternate methods are not aliases.
      const route = routes.get(`${req.method} ${req.url}`);
      if (!route) { sendJson(req, res, 404, {ok: false, code: 'NOT_FOUND', message: 'נתיב לא קיים'}, config); return; }
      grant?.authorize?.(route.permission);
      const run = async () => {
        // A response closes on caller cancellation even after the request body
        // completed. IncomingMessage's normal close is not a cancellation signal.
        // Commands/previews retain their accepted-work drain independently.
        const controller = route.cancellable ? new AbortController() : null;
        const disconnected = () => {
          if (controller && !res.writableFinished) { cancelledRead = true; controller.abort(); }
        };
        if (controller) res.once('close', disconnected);
        try {
          const body = route.readBody ? await readJson(req) : {};
          if (res.destroyed) disconnected();
          controller?.signal.throwIfAborted();
          grant?.assert();
          const routeStarted = performance.now();
          const result = await route.run(body, controller ? {signal:controller.signal} : undefined);
          grant?.assert();
          if (!res.destroyed) {
            res.setHeader('Server-Timing', `bridge;dur=${(performance.now()-started).toFixed(2)}, operation;dur=${(performance.now()-routeStarted).toFixed(2)}`);
            res.setHeader('Access-Control-Expose-Headers', 'Server-Timing');
            if (route.response === 'binary') sendBinary(req, res, result, config);
            else sendJson(req, res, 200, result, config);
          }
          route.afterResponse?.();
        } finally {
          if (controller) res.off('close', disconnected);
        }
      };
      if (grant) await pairing.run(grant, run);
      else await run();
    } catch (error) {
      if (res.destroyed && cancelledRead) return;
      const data = documentBridgeErrorResponse(error);
      const known = publicErrors.get(data.code);
      await appendLog(`HTTP_ERROR code=${documentBridgeDiagnosticCode(error)}`);
      if (res.destroyed) return;
      sendJson(req, res, known?.[0] ?? 503, data, config);
    }
  };
}
