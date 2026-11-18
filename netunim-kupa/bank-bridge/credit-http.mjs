// @ts-check
import { providerRecord, safeError, text } from './credit-value-codec.mjs';
import { classifyCreditHttpResponse, parseCreditJsonResponse,decodeCreditHttpReply } from './credit-http-policy.mjs';

/**
 * @typedef {Record<string,string>} RequestHeaders
 * @typedef {(url:string, request:RequestInit)=>Promise<Pick<Response,'status'|'text'|'headers'>>} CreditFetch
 * @typedef {{evaluate:<Args extends unknown[], Result>(callback:(...args:Args)=>Promise<Result>,...args:Args)=>Promise<unknown>}} CreditPage
 * @typedef {{stage?:string,timeoutMs?:number,now?:number}} RequestOptions
 * @typedef {{data:unknown,transport:'browser'}|{data:unknown,transport:'node-fallback',browserError:string}} CalHttpResult
 * @typedef {{httpStatus:0,bodyType:'transport_failure'|'invalid_transport'}|{httpStatus:number,bodyType:'empty'|'non_json'|'json',contentType:string,bodyLength:number,data:unknown}} MaxHttpObservation
 */

/** @param {CreditFetch} fetchImpl @param {string} url @param {unknown} data @param {RequestOptions & {headers?:RequestHeaders}} [options] */
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
      const causeName = text(providerRecord(error)?.name, 40);
      throw safeError(
        causeName === 'AbortError'
          ? 'קריאת הנתונים מחברת האשראי לא הסתיימה בזמן.'
          : 'החיבור לשירות הנתונים של חברת האשראי נקטע.',
        'CREDIT_PROVIDER_NETWORK_ERROR',
        { stage, causeName }
      );
    }
    const reply = decodeCreditHttpReply({
      status: response.status,
      body: responseText,
      retryAfter: response.headers?.get?.('retry-after') ?? '',
    }, stage);
    return parseCreditJsonResponse(reply.body, {
      status: reply.status,
      stage,
      retryAfter: reply.retryAfter,
      now,
    });
  } finally {
    clearTimeout(timer);
  }
}

/** @param {CreditPage} page @param {CreditFetch} fetchImpl @param {string} url @param {unknown} data @param {RequestOptions & {browserHeaders?:RequestHeaders,nodeHeaders?:RequestHeaders}} [options] @returns {Promise<CalHttpResult>} */
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
    inPageError = text(providerRecord(error)?.message || error, 180) || 'Browser request failed';
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
      throw Object.assign(error instanceof Error ? error : new Error('Credit HTTP reply failed'), { transport: 'browser' });
    }
  }
  try {
    return {
      data: await postJson(fetchImpl, url, data, { headers: nodeHeaders, stage, timeoutMs, now }),
      transport: 'node-fallback',
      browserError: inPageError,
    };
  } catch (error) {
    throw Object.assign(error instanceof Error ? error : new Error('Credit HTTP fallback failed'), {
      transport: 'node-fallback', browserRequestError: inPageError,
    });
  }
}

/** @param {CreditPage} page @param {string} url @param {string} stage @param {number} [now] @param {((value:MaxHttpObservation)=>void)|null} [observe] @returns {Promise<unknown>} */
export async function maxGetJsonWithinPage(page, url, stage, now = Date.now(), observe = null) {
  /** @param {MaxHttpObservation} value */
  const notify=value=>{try{observe?.(value)}catch{/* Diagnostics cannot change provider results. */}};
  let payload;
  try {
    payload = await page.evaluate(async (innerUrl) => {
      const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),45000);
      let response;
      try {
        response = await fetch(innerUrl, { credentials: 'include',signal:controller.signal });
        const body = response.status === 204 ? '' : await response.text();
        return {status:response.status,body,retryAfter:response.headers?.get?.('retry-after')||'',contentType:response.headers?.get?.('content-type')||''};
      } catch (error) {
        return { networkError: String((error instanceof Error && error.message) || error || 'fetch failed') };
      } finally {
        clearTimeout(timer);
      }
    }, url);
  } catch (error) {
    notify({httpStatus:0,bodyType:'transport_failure'});
    throw safeError(
      'קריאת נתוני MAX מתוך הסשן המחובר נכשלה לפני קבלת תשובה.',
      'CREDIT_PROVIDER_NETWORK_ERROR',
      { stage, causeName: text(providerRecord(error)?.name, 40) }
    );
  }
  const receipt = providerRecord(payload);
  if (typeof receipt?.networkError === 'string' && receipt.networkError.trim()) {
    notify({httpStatus:0,bodyType:'transport_failure'});
    throw safeError('החיבור לשירות הנתונים של MAX נקטע.', 'CREDIT_PROVIDER_NETWORK_ERROR', {
      stage,
    });
  }
  let reply;
  try{reply=decodeCreditHttpReply(payload,stage)}catch(error){notify({httpStatus:0,bodyType:'invalid_transport'});throw error}
  /** @type {unknown} */
  let data = null;
  let invalidJson=false;
  if(reply.body)try{data=JSON.parse(reply.body)}catch{invalidJson=true}
  const contentType = typeof receipt?.contentType === 'string' ? receipt.contentType : '';
  notify({httpStatus:reply.status,bodyType:!reply.body?'empty':invalidJson?'non_json':'json',contentType,bodyLength:reply.body.length,data});
  const body = reply.body,
    failure = classifyCreditHttpResponse({
      status: reply.status,
      text: body,
      stage,
      retryAfter: reply.retryAfter,
      now,
    });
  if (failure) throw failure;
  if (invalidJson) {
    throw safeError('MAX החזירה תשובה שאינה JSON תקין.', 'CREDIT_PROVIDER_RESPONSE_NOT_JSON', {
      stage,
      httpStatus: reply.status,
    });
  }
  return data;
}
