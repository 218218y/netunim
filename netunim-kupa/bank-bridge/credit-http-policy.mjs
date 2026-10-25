// @ts-check
import { safeError } from './credit-value-codec.mjs';

/** @typedef {{status:number,body:string,retryAfter:string}} CreditHttpReply */
/** @typedef {{status?:unknown,stage?:string,retryAfter?:unknown,now?:number}} CreditHttpOptions */
/** @typedef {{stage:string,httpStatus:number,retryAfterAt?:string|null}} CreditHttpMetadata */
/** @typedef {Error & {code:unknown} & CreditHttpMetadata} CreditHttpFailure */

/** @param {string} message @param {string} code @param {CreditHttpMetadata} metadata @returns {CreditHttpFailure} */
function httpFailure(message,code,metadata){
  return Object.assign(safeError(message,code),metadata);
}

/** @param {unknown} value @param {string} [stage] @returns {CreditHttpReply} */
export function decodeCreditHttpReply(value,stage=''){
  if(value&&typeof value==='object'&&!Array.isArray(value)){
    const row=/** @type {Record<string,unknown>} */(value);
    const {status,body}=row;
    const retryAfter=row.retryAfter===undefined?'':row.retryAfter;
    if(typeof status==='number'&&Number.isInteger(status)&&status>=100&&status<=599
      &&typeof body==='string'&&typeof retryAfter==='string'){
      return {status,body,retryAfter};
    }
  }
  throw httpFailure('חברת האשראי החזירה מעטפת HTTP שאינה תקינה.',
    'CREDIT_PROVIDER_SCHEMA_ERROR',{stage,httpStatus:0});
}

/** @param {unknown} value @param {number} [now] @returns {string|null} */
export function parseRetryAfter(value, now = Date.now()) {
  const raw = String(value ?? '').trim();
  if (!raw) return null;
  const seconds = Number(raw);
  let time =
    Number.isFinite(seconds) && seconds >= 0 ? Number(now) + seconds * 1000 : Date.parse(raw);
  if (!Number.isFinite(time)) return null;
  time = Math.max(Number(now) || Date.now(), time);
  const date = new Date(time);
  return Number.isFinite(date.getTime()) ? date.toISOString() : null;
}

/** @param {unknown} [body] */
function creditAutomationBlockBody(body = '') {
  const value = String(body || '');
  return /(?:block automation|bot detection|sorry[,!]?\s+you have been blocked|attention required[^<]{0,120}cloudflare|cf-error-details)/i.test(
    value
  );
}

/** @param {CreditHttpOptions & {text?:unknown}} [options] @returns {CreditHttpFailure|null} */
export function classifyCreditHttpResponse({
  status = 0,
  text: body = '',
  stage = '',
  retryAfter = '',
  now = Date.now(),
} = {}) {
  const httpStatus = Number(status) || 0,
    responseText = String(body || ''),
    extra = { stage, httpStatus };
  if (httpStatus === 429)
    return httpFailure(
      'חברת האשראי הגבילה זמנית את קצב הבקשות. לא יתבצע ניסיון נוסף לפני מועד ההמתנה של החברה.',
      'CREDIT_PROVIDER_RATE_LIMITED',
      { ...extra, retryAfterAt: parseRetryAfter(retryAfter, now) }
    );
  if (httpStatus === 403 || creditAutomationBlockBody(responseText))
    return httpFailure(
      'חברת האשראי חסמה את בקשת האוטומציה של הסשן הנוכחי. לא יתבצע ניסיון נוסף במהלך הסנכרון.',
      'CREDIT_AUTOMATION_BLOCKED',
      extra
    );
  if (httpStatus < 200 || httpStatus >= 300)
    return httpFailure(
      `חברת האשראי החזירה HTTP ${httpStatus || 'לא ידוע'} בשלב ${stage || 'לא ידוע'}.`,
      'CREDIT_PROVIDER_HTTP_ERROR',
      extra
    );
  if (/^\s*(?:<!doctype\s+html|<html\b|<head\b|<body\b)/i.test(responseText))
    return httpFailure(
      'חברת האשראי החזירה HTML במקום JSON.',
      'CREDIT_PROVIDER_RESPONSE_NOT_JSON',
      extra
    );
  return null;
}

/** @param {string} responseText @param {CreditHttpOptions} [options] @returns {unknown} */
export function parseCreditJsonResponse(
  responseText,
  { status = 0, stage = '', retryAfter = '', now = Date.now() } = {}
) {
  const failure = classifyCreditHttpResponse({
    status,
    text: responseText,
    stage,
    retryAfter,
    now,
  });
  if (failure) throw failure;
  try {
    return responseText ? /** @type {unknown} */(JSON.parse(responseText)) : null;
  } catch {
    throw httpFailure(
      'חברת האשראי החזירה תשובה שאינה JSON תקין.',
      'CREDIT_PROVIDER_RESPONSE_NOT_JSON',
      { stage, httpStatus: Number(status) || 0 }
    );
  }
}
