// @ts-nocheck
import { INTERACTIVE_AUTH_TIMEOUT_MS } from './hapoalim-policy.mjs';

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function currentPageUrl(page) {
  try {
    return String(await page.evaluate(() => window.location.href));
  } catch {
    return String(page?.url?.() || '');
  }
}

async function loginConditionMatches(condition, page, value) {
  if (condition instanceof RegExp) {
    condition.lastIndex = 0;
    return condition.test(value);
  }
  if (typeof condition === 'function') return !!(await condition({ page, value }));
  return String(value).toLowerCase() === String(condition).toLowerCase();
}

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
  const deadline = Date.now() + Math.max(1, Number(timeoutMs) || INTERACTIVE_AUTH_TIMEOUT_MS);
  while (Date.now() < deadline) {
    if (page?.isClosed?.()) {
      const e = new Error(closedMarker);
      e.code = closedCode;
      throw e;
    }
    const value = await currentPageUrl(page);
    for (const [resultKey, conditions] of Object.entries(possibleResults || {})) {
      for (const condition of Array.isArray(conditions) ? conditions : [conditions]) {
        try {
          if (await loginConditionMatches(condition, page, value)) return { resultKey, value };
        } catch {}
      }
    }
    await sleep(Math.min(Math.max(10, pollMs), Math.max(10, deadline - Date.now())));
  }
  const e = new Error(timeoutMarker);
  e.code = timeoutCode;
  throw e;
}
