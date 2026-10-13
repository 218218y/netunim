// @ts-nocheck
import { CAL_INVALID_PASSWORD_MESSAGE } from './credit-adapter-wire.mjs';
import { safeError } from './credit-value-codec.mjs';
import { sleep } from './credit-scheduler.mjs';
import { preserveInstalledChromiumIdentity } from './isracard-group-utils.mjs';

const VISA_CAL_LOGIN_RESULT_TIMEOUT_MS = 45_000;

const VISA_CAL_LOGIN_RESULT_POLL_MS = 200;

function safeDecodeVisaCalUrl(value) {
  try {
    return decodeURIComponent(String(value || ''));
  } catch {
    return String(value || '');
  }
}

export function isVisaCalInvalidPasswordErrorUrl(value) {
  const decoded = safeDecodeVisaCalUrl(value);
  return decoded.includes('/calconnect/error') && decoded.includes(CAL_INVALID_PASSWORD_MESSAGE);
}

function visaCalHasInvalidPasswordErrorFrame(page) {
  try {
    return (typeof page?.frames === 'function' ? page.frames() : []).some((frame) => {
      try {
        return isVisaCalInvalidPasswordErrorUrl(frame?.url?.());
      } catch {
        return false;
      }
    });
  } catch {
    return false;
  }
}

async function visaCalSessionState(page) {
  try {
    return await page.evaluate(() => {
      const parse = (value) => {
          try {
            return value ? JSON.parse(value) : null;
          } catch {
            return null;
          }
        },
        init = parse(sessionStorage.getItem('init')),
        auth = parse(sessionStorage.getItem('auth-module')),
        hasInit = Array.isArray(init?.result?.cards),
        hasToken =
          typeof auth?.auth?.calConnectToken === 'string' &&
          auth.auth.calConnectToken.trim().length > 0;
      if (hasInit && hasToken) return 'authenticated';
      if (hasInit) return 'init-only';
      if (hasToken) return 'auth-only';
      return 'missing';
    });
  } catch {
    return 'unavailable';
  }
}

export async function visaCalHasAuthenticatedSessionState(page) {
  return (await visaCalSessionState(page)) === 'authenticated';
}

async function visaCalSafeLoginState(page) {
  const sessionState = await visaCalSessionState(page);
  if (sessionState === 'authenticated') return 'authenticated-session';
  if (sessionState === 'init-only') return 'session-init-only';
  if (sessionState === 'auth-only') return 'session-auth-only';
  if (visaCalHasInvalidPasswordErrorFrame(page)) return 'invalid-password-route';
  let frames = [];
  try {
    frames = typeof page?.frames === 'function' ? page.frames() : [];
  } catch {}
  if (
    frames.some((frame) => {
      try {
        return /change-password/i.test(String(frame?.url?.() || ''));
      } catch {
        return false;
      }
    })
  )
    return 'change-password-route';
  if (
    frames.some((frame) => {
      try {
        return /connect/i.test(String(frame?.url?.() || ''));
      } catch {
        return false;
      }
    })
  )
    return 'connect-frame';
  const currentUrl = await visaCalClientUrl(page);
  if (/dashboard/i.test(currentUrl)) return 'dashboard-url';
  return 'no-connect-frame';
}

async function visaCalClientUrl(page) {
  try {
    if (typeof page?.evaluate === 'function')
      return String((await page.evaluate(() => window.location.href)) || '');
  } catch {}
  try {
    return String(page?.url?.() || '');
  } catch {
    return '';
  }
}

function visaCalStaticLoginConditionMatches(condition, currentUrl) {
  if (condition instanceof RegExp) {
    condition.lastIndex = 0;
    return condition.test(currentUrl);
  }
  return typeof condition === 'string' && currentUrl.toLowerCase() === condition.toLowerCase();
}

async function visaCalUpstreamLoginResult(page, possibleResults) {
  const currentUrl = await visaCalClientUrl(page),
    entries = Object.entries(
      possibleResults && typeof possibleResults === 'object' ? possibleResults : {}
    ),
    successKey = entries.find(([result]) => result === 'SUCCESS' || /success/i.test(result))?.[0];
  for (const [result, conditions] of entries)
    for (const condition of Array.isArray(conditions) ? conditions : [])
      if (
        typeof condition !== 'function' &&
        visaCalStaticLoginConditionMatches(condition, currentUrl)
      )
        return { result, currentUrl };
  // Cal's SPA can establish the authenticated session before (or without) committing the main page URL to /dashboard.
  // The pinned scraper itself requires both of these sessionStorage objects immediately after login, so their joint
  // presence is stronger success evidence than URL navigation and does not expose the token or card data.
  if (successKey && (await visaCalHasAuthenticatedSessionState(page)))
    return { result: successKey, currentUrl };
  const frames = typeof page?.frames === 'function' ? page.frames() : [],
    hasConnectFrame = frames.some((frame) => {
      try {
        return /connect/i.test(String(frame?.url?.() || ''));
      } catch {
        return false;
      }
    });
  if (!hasConnectFrame) return null;
  for (const [result, conditions] of entries) {
    for (const condition of Array.isArray(conditions) ? conditions : []) {
      if (typeof condition !== 'function') continue;
      try {
        if (await condition({ page, value: currentUrl })) return { result, currentUrl };
      } catch {}
    }
  }
  return null;
}

async function waitForVisaCalUpstreamLoginResult(
  scraper,
  possibleResults,
  { timeoutMs = VISA_CAL_LOGIN_RESULT_TIMEOUT_MS, pollMs = VISA_CAL_LOGIN_RESULT_POLL_MS } = {}
) {
  const page = scraper?.page;
  if (!page)
    throw safeError(
      'מחבר כאל לא חשף page לאחר initialize.',
      'CREDIT_CONNECTOR_COMPATIBILITY_ERROR',
      { stage: 'LoginSetup' }
    );
  const timeout = Math.max(1000, Number(timeoutMs) || VISA_CAL_LOGIN_RESULT_TIMEOUT_MS),
    poll = Math.max(25, Number(pollMs) || VISA_CAL_LOGIN_RESULT_POLL_MS),
    deadline = Date.now() + timeout;
  let tutorialCloseAttempted = false;
  while (Date.now() <= deadline) {
    const currentUrl = await visaCalClientUrl(page);
    if (/site-tutorial(?:[/?#]|$)/i.test(currentUrl) && !tutorialCloseAttempted) {
      tutorialCloseAttempted = true;
      try {
        await page.click('button.btn-close');
      } catch {}
    }
    const recognized = await visaCalUpstreamLoginResult(page, possibleResults);
    if (recognized) return recognized;
    const remaining = deadline - Date.now();
    if (remaining <= 0) break;
    await sleep(Math.min(poll, remaining));
  }
  const error = new Error(
    `Visa Cal login did not reach an upstream-recognized result within ${timeout} ms`
  );
  error.name = 'TimeoutError';
  error.loginState = await visaCalSafeLoginState(page);
  throw error;
}

export async function prepareVisaCalBrowserIdentity(page, { identityProbeUrl = '' } = {}) {
  if (
    !page ||
    typeof page.evaluate !== 'function' ||
    typeof page.setUserAgent !== 'function' ||
    typeof page.evaluateOnNewDocument !== 'function'
  )
    throw safeError(
      'מחבר כאל המותקן אינו חושף Page מלא שנדרש לשמירת זהות Chrome/Edge עקבית.',
      'CREDIT_CONNECTOR_COMPATIBILITY_ERROR',
      { stage: 'BrowserIdentity' }
    );
  const identity = await preserveInstalledChromiumIdentity(page, { probeUrl: identityProbeUrl });
  if (!identity.ok)
    throw safeError(
      'לא ניתן לשמר זהות Chrome/Edge מקורית ועקבית עבור כאל; הסנכרון נעצר לפני הכניסה כדי לא לשלוח User-Agent ו-Client Hints סותרים.',
      'CREDIT_BROWSER_IDENTITY_UNAVAILABLE',
      {
        stage: 'BrowserIdentity',
        clientHintsState: identity.clientHintsState,
        browserMajorVersion: identity.browserMajorVersion,
      }
    );
  if (typeof page.setExtraHTTPHeaders === 'function')
    await page.setExtraHTTPHeaders({ 'accept-language': 'he-IL,he;q=0.9,en-US;q=0.8,en;q=0.7' });
  await page.evaluateOnNewDocument(() => {
    try {
      Object.defineProperty(navigator, 'webdriver', { get: () => undefined, configurable: true });
    } catch {}
  });
  return identity;
}

export function applyVisaCalLoginNavigationPolicy(
  scraper,
  {
    loginResultTimeoutMs = VISA_CAL_LOGIN_RESULT_TIMEOUT_MS,
    loginResultPollMs = VISA_CAL_LOGIN_RESULT_POLL_MS,
  } = {}
) {
  if (!scraper || typeof scraper.getLoginOptions !== 'function')
    throw safeError(
      'מחבר כאל המותקן אינו חושף את חוזה getLoginOptions שנדרש למדיניות הניווט המקומית.',
      'CREDIT_CONNECTOR_COMPATIBILITY_ERROR',
      { stage: 'LoginSetup' }
    );
  const getLoginOptions = scraper.getLoginOptions.bind(scraper);
  scraper.__netunimLoginStep = 'navigation';
  scraper.getLoginOptions = (credentials) => {
    const options = getLoginOptions(credentials);
    if (!options || typeof options !== 'object' || Array.isArray(options))
      throw safeError(
        'מחבר כאל המותקן החזיר חוזה LoginOptions לא תקין.',
        'CREDIT_CONNECTOR_COMPATIBILITY_ERROR',
        { stage: 'LoginSetup' }
      );
    if (
      !options.possibleResults ||
      typeof options.possibleResults !== 'object' ||
      Array.isArray(options.possibleResults)
    )
      throw safeError(
        'מחבר כאל המותקן אינו חושף possibleResults תקין לזיהוי תוצאת הכניסה.',
        'CREDIT_CONNECTOR_COMPATIBILITY_ERROR',
        { stage: 'LoginSetup' }
      );
    const possibleResults = { ...options.possibleResults },
      successKey = Object.keys(possibleResults).find(
        (key) => key === 'SUCCESS' || /success/i.test(key)
      ),
      invalidPasswordKey = Object.keys(possibleResults).find(
        (key) => key === 'INVALID_PASSWORD' || /invalid.*password/i.test(key)
      );
    if (successKey)
      possibleResults[successKey] = [
        async ({ page } = {}) => visaCalHasAuthenticatedSessionState(page),
        ...(Array.isArray(possibleResults[successKey]) ? possibleResults[successKey] : []),
      ];
    if (invalidPasswordKey)
      possibleResults[invalidPasswordKey] = [
        async ({ page } = {}) => visaCalHasInvalidPasswordErrorFrame(page),
        ...(Array.isArray(possibleResults[invalidPasswordKey])
          ? possibleResults[invalidPasswordKey]
          : []),
      ];
    const wrapStep = (step, nextStep, action) =>
      typeof action === 'function'
        ? async (...args) => {
            scraper.__netunimLoginStep = step;
            const result = await action(...args);
            if (nextStep) scraper.__netunimLoginStep = nextStep;
            return result;
          }
        : action;
    // Cal is an SPA and the credential form lives in a cross-origin iframe. Upstream
    // clicks Submit and only afterwards starts waitForNavigation() on the main page.
    // That wait can miss the already-completed transition, and an iframe-local result
    // does not have to create a main-page navigation event at all. Use the installed
    // scraper's own possibleResults contract as the authority instead of duplicating
    // Cal selectors/messages locally. The 45-second bound and one credential submit stay unchanged.
    const postAction = async () => {
      scraper.__netunimLoginStep = 'result-detection';
      await waitForVisaCalUpstreamLoginResult(scraper, possibleResults, {
        timeoutMs: loginResultTimeoutMs,
        pollMs: loginResultPollMs,
      });
    };
    // The landing document itself only needs DOMContentLoaded because upstream already
    // owns the explicit #ccLoginDesktopBtn readiness check.
    return {
      ...options,
      possibleResults,
      waitUntil: 'domcontentloaded',
      checkReadiness: wrapStep('landing-readiness', 'open-login-popup', options.checkReadiness),
      preAction: wrapStep('open-login-popup', 'credentials-submit', options.preAction),
      postAction,
    };
  };
  return scraper;
}
