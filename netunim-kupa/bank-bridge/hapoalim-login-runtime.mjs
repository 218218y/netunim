// @ts-check
import { INTERACTIVE_AUTH_TIMEOUT_MS } from './hapoalim-policy.mjs';

/**
 * @typedef {{evaluate:(read:()=>string)=>Promise<unknown>,url?:()=>string,isClosed?:()=>boolean}} LoginPage
 * @typedef {string|RegExp|((input:{page:LoginPage,value:string})=>unknown)} LoginCondition
 * @typedef {{timeoutMs?:number,pollMs?:number,timeoutCode?:string,timeoutMarker?:string,closedCode?:string,closedMarker?:string}} WaitOptions
 */

/** @param {number} ms @returns {Promise<void>} */
function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** @param {LoginPage} page */
async function currentPageUrl(page) {
  try {
    return String(await page.evaluate(() => window.location.href));
  } catch {
    return String(page?.url?.() || '');
  }
}

/** @param {LoginCondition} condition @param {LoginPage} page @param {string} value */
async function loginConditionMatches(condition, page, value) {
  if (condition instanceof RegExp) {
    condition.lastIndex = 0;
    return condition.test(value);
  }
  if (typeof condition === 'function') return !!(await condition({ page, value }));
  return String(value).toLowerCase() === String(condition).toLowerCase();
}

/** @param {LoginPage} page @param {Record<string,LoginCondition|LoginCondition[]>} possibleResults @param {WaitOptions} [options] */
export async function waitForTerminalLoginResult(
  page,
  possibleResults,
  {
    timeoutMs = INTERACTIVE_AUTH_TIMEOUT_MS,
    pollMs = 500,
    timeoutCode = 'INTERACTIVE_AUTH_TIMEOUT',
    timeoutMarker = 'NETUNIM_INTERACTIVE_AUTH_TIMEOUT',
    closedCode = 'INTERACTIVE_BROWSER_CLOSED',
    closedMarker = 'NETUNIM_INTERACTIVE_BROWSER_CLOSED',
  } = {}
) {
  const configuredTimeout = Number(timeoutMs);
  const duration = Number.isFinite(configuredTimeout) && configuredTimeout !== 0
    ? Math.max(1, configuredTimeout) : INTERACTIVE_AUTH_TIMEOUT_MS;
  const pollInterval = Number.isFinite(pollMs) ? Math.max(10, pollMs) : 500;
  const deadline = Date.now() + duration;
  while (Date.now() < deadline) {
    if (page?.isClosed?.()) {
      throw Object.assign(new Error(closedMarker), { code: closedCode });
    }
    const value = await currentPageUrl(page);
    for (const [resultKey, conditions] of Object.entries(possibleResults || {})) {
      for (const condition of Array.isArray(conditions) ? conditions : [conditions]) {
        try {
          if (await loginConditionMatches(condition, page, value)) return { resultKey, value };
        } catch {}
      }
    }
    await sleep(Math.min(pollInterval, Math.max(10, deadline - Date.now())));
  }
  throw Object.assign(new Error(timeoutMarker), { code: timeoutCode });
}
