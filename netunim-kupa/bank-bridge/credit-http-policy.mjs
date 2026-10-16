// @ts-nocheck
import { safeError } from './credit-value-codec.mjs';

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

function creditAutomationBlockBody(body = '') {
  const value = String(body || '');
  return /(?:block automation|bot detection|sorry[,!]?\s+you have been blocked|attention required[^<]{0,120}cloudflare|cf-error-details)/i.test(
    value
  );
}

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
    return safeError(
      'חברת האשראי הגבילה זמנית את קצב הבקשות. לא יתבצע ניסיון נוסף לפני מועד ההמתנה של החברה.',
      'CREDIT_PROVIDER_RATE_LIMITED',
      { ...extra, retryAfterAt: parseRetryAfter(retryAfter, now) }
    );
  if (httpStatus === 403 || creditAutomationBlockBody(responseText))
    return safeError(
      'חברת האשראי חסמה את בקשת האוטומציה של הסשן הנוכחי. לא יתבצע ניסיון נוסף במהלך הסנכרון.',
      'CREDIT_AUTOMATION_BLOCKED',
      extra
    );
  if (httpStatus < 200 || httpStatus >= 300)
    return safeError(
      `חברת האשראי החזירה HTTP ${httpStatus || 'לא ידוע'} בשלב ${stage || 'לא ידוע'}.`,
      'CREDIT_PROVIDER_HTTP_ERROR',
      extra
    );
  if (/^\s*(?:<!doctype\s+html|<html\b|<head\b|<body\b)/i.test(responseText))
    return safeError(
      'חברת האשראי החזירה HTML במקום JSON.',
      'CREDIT_PROVIDER_RESPONSE_NOT_JSON',
      extra
    );
  return null;
}

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
    return responseText ? JSON.parse(responseText) : null;
  } catch {
    throw safeError(
      'חברת האשראי החזירה תשובה שאינה JSON תקין.',
      'CREDIT_PROVIDER_RESPONSE_NOT_JSON',
      { stage, httpStatus: Number(status) || 0 }
    );
  }
}
