// @ts-nocheck
import { safeError, text } from './credit-value-codec.mjs';
import { classifyCreditHttpResponse, parseCreditJsonResponse,decodeCreditHttpReply } from './credit-http-policy.mjs';

async function postJson(
  fetchImpl,
  url,
  data,
  { headers = {}, stage = '', timeoutMs = 60_000, now = Date.now() } = {}
) {
  const controller = new AbortController(),
    timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    let response, responseText;
    try {
      response = await fetchImpl(url, {
        method: 'POST',
        headers: { Accept: 'application/json', 'Content-Type': 'application/json', ...headers },
        body: JSON.stringify(data),
        signal: controller.signal,
      });
      responseText = await response.text();
    } catch (error) {
      throw safeError(
        error?.name === 'AbortError'
          ? 'קריאת הנתונים מחברת האשראי לא הסתיימה בזמן.'
          : 'החיבור לשירות הנתונים של חברת האשראי נקטע.',
        'CREDIT_PROVIDER_NETWORK_ERROR',
        { stage, causeName: text(error?.name, 40) }
      );
    }
    return parseCreditJsonResponse(responseText, {
      status: response.status,
      stage,
      retryAfter: response.headers?.get?.('retry-after') || '',
      now,
    });
  } finally {
    clearTimeout(timer);
  }
}

export async function postVisaCalJson(
  page,
  fetchImpl,
  url,
  data,
  { browserHeaders = {}, nodeHeaders = {}, stage = '', timeoutMs = 60_000, now = Date.now() } = {}
) {
  let inPageError = '';
  let pageResponse;
  try {
    pageResponse = await page.evaluate(
      async (innerUrl, innerData, innerHeaders, innerTimeoutMs) => {
        const controller = new AbortController(),
          timer = setTimeout(() => controller.abort(), innerTimeoutMs);
        try {
          const response = await fetch(innerUrl, {
            method: 'POST',
            body: JSON.stringify(innerData),
            credentials: 'include',
            headers: {
              Accept: 'application/json',
              'Content-Type': 'application/json',
              ...innerHeaders,
            },
            signal: controller.signal,
          });
          return {
            status: response.status,
            body: await response.text(),
            retryAfter: response.headers.get('retry-after') || '',
          };
        } finally {
          clearTimeout(timer);
        }
      },
      url,
      data,
      browserHeaders,
      timeoutMs
    );
  } catch (error) {
    inPageError = text(error?.message || error, 180);
  }
  if (!inPageError) {
    try {
      const reply=decodeCreditHttpReply(pageResponse,stage);
      return {
        data: parseCreditJsonResponse(reply.body, {
          status: reply.status,
          stage,
          retryAfter: reply.retryAfter,
          now,
        }),
        transport: 'browser',
      };
    } catch (error) {
      error.transport = 'browser';
      throw error;
    }
  }
  try {
    return {
      data: await postJson(fetchImpl, url, data, { headers: nodeHeaders, stage, timeoutMs, now }),
      transport: 'node-fallback',
      browserError: inPageError,
    };
  } catch (error) {
    error.transport = 'node-fallback';
    error.browserRequestError = inPageError;
    throw error;
  }
}

export async function maxGetJsonWithinPage(page, url, stage, now = Date.now()) {
  let payload;
  try {
    payload = await page.evaluate(async (innerUrl) => {
      let response;
      try {
        response = await fetch(innerUrl, { credentials: 'include' });
      } catch (error) {
        return { networkError: String(error?.message || error || 'fetch failed') };
      }
      const body = response.status === 204 ? '' : await response.text();
      return {
        status: response.status,
        body,
        retryAfter: response.headers?.get?.('retry-after') || '',
      };
    }, url);
  } catch (error) {
    throw safeError(
      'קריאת נתוני MAX מתוך הסשן המחובר נכשלה לפני קבלת תשובה.',
      'CREDIT_PROVIDER_NETWORK_ERROR',
      { stage, causeName: text(error?.name, 40) }
    );
  }
  if (payload?.networkError)
    throw safeError('החיבור לשירות הנתונים של MAX נקטע.', 'CREDIT_PROVIDER_NETWORK_ERROR', {
      stage,
    });
  const reply=decodeCreditHttpReply(payload,stage);
  const body = reply.body,
    failure = classifyCreditHttpResponse({
      status: reply.status,
      text: body,
      stage,
      retryAfter: reply.retryAfter,
      now,
    });
  if (failure) throw failure;
  if (!body) return null;
  try {
    return JSON.parse(body);
  } catch {
    throw safeError('MAX החזירה תשובה שאינה JSON תקין.', 'CREDIT_PROVIDER_RESPONSE_NOT_JSON', {
      stage,
      httpStatus: reply.status,
    });
  }
}
