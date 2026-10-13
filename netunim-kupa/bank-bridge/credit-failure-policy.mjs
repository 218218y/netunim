// @ts-nocheck
import { creditText } from './credit-core-values.mjs';
import { CREDIT_PROVIDER_CONFIG } from './credit-profile-model.mjs';

function safeCreditProviderDiagnostic(rawValue, profile) {
  if (profile?.provider !== 'visaCal') return '';
  let value = String(rawValue || '').replace(/https?:\/\/[^\s,]+/gi, (url) => url.split('?')[0]);
  value = value.replace(/\b(?:Bearer|CALAuthScheme)\s+[A-Za-z0-9._~+\/=-]+/gi, '[authorization]');
  value = value.replace(
    /(\"(?:password|username|userName|authorization|token|calConnectToken)\"\s*:\s*\")[^\"]*(\")/gi,
    '$1[redacted]$2'
  );
  value = value.replace(/\b\d{6,}\b/g, '[number]').replace(/<[^>]{0,500}>/g, '[html]');
  return creditText(value, 220);
}

function creditFailureContext(typeValue, rawValue, profile) {
  const type = String(typeValue || 'SCRAPE_FAILED').toUpperCase(),
    raw = String(rawValue || ''),
    isIsracardGroup = profile?.provider === 'isracard' || profile?.provider === 'amex';
  const providerMonth = raw.match(
    /failed to fetch transactions for card\s+([^\.\s]+)\.\s*Message:\s*([^\r\n]+)/i
  );
  if (providerMonth) {
    const cardSuffix = creditText(providerMonth[1] || '', 16),
      providerMessage = creditText(providerMonth[2] || '', 160);
    return {
      code: 'CREDIT_PROVIDER_DATA_ERROR',
      stage: 'Transactions',
      message: `החברה דחתה או לא השלימה את קריאת העסקאות${cardSuffix ? ` לכרטיס ${cardSuffix}` : ''}${providerMessage ? `. הודעת החברה: ${providerMessage}` : ''}`,
    };
  }
  if (
    profile?.provider === 'visaCal' &&
    /monthData is not of type CardTransactionDetails/i.test(raw)
  )
    return {
      code: 'CREDIT_PROVIDER_SCHEMA_ERROR',
      stage: 'Transactions',
      message:
        'כאל החזירה באחת מקריאות החודש מבנה נתונים שונה מהחוזה שהמחבר מכיר. אין להתייחס לזה ככשל סיסמה; מחבר כאל דורש התאמת schema או בידוד של החודש הבעייתי.',
    };
  if (
    profile?.provider === 'visaCal' &&
    /(failed to extract login iframe|#ccLoginDesktopBtn|#regular-login|regular-login)/i.test(raw)
  )
    return {
      code: type === 'TIMEOUT' ? 'CREDIT_LOGIN_TIMEOUT' : 'CREDIT_LOGIN_UI_UNAVAILABLE',
      stage: 'LoginFlow',
      message:
        type === 'TIMEOUT'
          ? 'מסלול הכניסה של כאל לא הגיע לשלב הבא בזמן שהוגדר.'
          : 'מסלול הכניסה של כאל לא הציג את רכיב ההתחברות שהמחבר מצפה לו. זה מתאים לשינוי UI/הגנת אתר ולא לכשל בנתוני הכרטיס.',
    };
  if (
    /could not find ["']?init["']? data in session storage|get init data in session storage/i.test(
      raw
    )
  )
    return {
      code: 'CREDIT_SESSION_INIT_MISSING',
      stage: 'DashboardInit',
      message:
        'הכניסה הושלמה אך נתוני האתחול של אזור הלקוחות לא הופיעו. יש לפתוח רענון עם חלון אבחון; אם התקלה חוזרת, מחבר החברה דורש התאמה למסך החדש.',
    };
  if (/authorization header|auth[- ]module|authorization token/i.test(raw))
    return {
      code: 'CREDIT_AUTH_TOKEN_MISSING',
      stage: 'AuthToken',
      message:
        'הכניסה לא הניבה אסימון הרשאה שנדרש לקריאת נתוני האשראי. יש לפתוח רענון עם חלון אבחון כדי לבדוק את מסלול הכניסה הנוכחי של החברה.',
    };
  if (
    profile?.provider === 'visaCal' &&
    /(unexpected (?:token|end).*json|not valid json|json parse|json\.parse)/i.test(raw)
  )
    return {
      code: 'CREDIT_PROVIDER_RESPONSE_NOT_JSON',
      stage: 'DataApi',
      message:
        'כאל החזירה באחת מקריאות ה-API תשובה שאינה JSON תקין. זהו כשל תגובת שירות/הגנת אתר ולא כשל בפרטי ההתחברות.',
    };
  if (/fetch failed|networkerror|econnreset|etimedout|socket hang up/i.test(raw))
    return {
      code: 'CREDIT_PROVIDER_NETWORK_ERROR',
      stage: 'DataApi',
      message: 'החיבור לשירות הנתונים של חברת האשראי נקטע לפני שהתקבלה תשובה תקינה.',
    };
  if (type === 'TIMEOUT' && /(login|iframe|ccLoginDesktopBtn|regular-login|sign.?in)/i.test(raw))
    return {
      code: 'CREDIT_LOGIN_TIMEOUT',
      stage: 'LoginFlow',
      message: 'מסלול הכניסה של חברת האשראי לא הגיע לשלב הבא בזמן שהוגדר.',
    };
  if (type === 'TIMEOUT')
    return {
      code: 'CREDIT_PROVIDER_NETWORK_ERROR',
      stage: 'DataApi',
      message: 'החיבור לשירות חברת האשראי לא הסתיים בזמן',
    };
  if (type === 'INVALID_PASSWORD')
    return {
      code: 'CREDIT_INVALID_PASSWORD',
      stage: 'Login',
      message: isIsracardGroup
        ? 'פרטי ההתחברות הקבועים נדחו. יש להשתמש בתעודת זהות + 6 ספרות אחרונות של כרטיס מהסוג שנבחר + סיסמה קבועה'
        : 'פרטי ההתחברות אינם נכונים',
    };
  if (type === 'CHANGE_PASSWORD')
    return { code: 'CREDIT_CHANGE_PASSWORD', stage: 'Login', message: 'החברה דורשת החלפת סיסמה' };
  if (type === 'ACCOUNT_BLOCKED')
    return { code: 'CREDIT_ACCOUNT_BLOCKED', stage: 'Login', message: 'החשבון חסום' };
  if (type === 'UNKNOWN_ERROR')
    return {
      code: 'CREDIT_UNKNOWN_ERROR',
      stage: '',
      message: isIsracardGroup
        ? 'שירות הסיסמה הקבועה החזיר תשובה שלא זוהתה. מסך ה-SMS שנשאר פתוח בחלון אינו מדד להצלחת החיבור'
        : 'החברה החזירה מסך או תשובה שלא זוהו',
    };
  return null;
}

function safeCreditScrapeFailure(typeValue, rawValue, profile) {
  const type = String(typeValue || 'SCRAPE_FAILED').toUpperCase(),
    raw = String(rawValue || ''),
    label = creditText(
      profile?.label || CREDIT_PROVIDER_CONFIG[profile?.provider]?.label || 'חברת האשראי',
      100
    ),
    isIsracardGroup = profile?.provider === 'isracard' || profile?.provider === 'amex';
  let code = `CREDIT_${type}`,
    stage = '',
    message = 'סנכרון האשראי נכשל';
  if (/fetchPostWithinPage parse error/i.test(raw) && /(?:<!DOCTYPE|<html)/i.test(raw)) {
    code = 'CREDIT_LOGIN_HTML_RESPONSE';
    stage = 'LoginApi';
    const validateStage = /reqName=ValidateIdData/i.test(raw);
    if (profile?.provider === 'amex' && validateStage)
      message =
        'American Express החזירה דף HTML כבר בשלב ValidateIdData, לפני שלב בדיקת הסיסמה. זו תגובת אתר/הגנת אוטומציה של החברה למחבר הנוכחי ולא כשל בנתוני הקופה; חלון האבחון נסגר מיד משום שאין שלב כניסה נוסף שניתן להשלים.';
    else if (profile?.provider === 'isracard' && validateStage)
      message =
        'ישראכרט החזירה דף HTML בשלב ValidateIdData במקום JSON. החיבור לא הגיע לשלב בדיקת הסיסמה; נסה שוב בחלון אבחון ובזמן אחר, בלי ליצור חיבור נוסף לאותה זהות.';
    else
      message = isIsracardGroup
        ? 'שירות ההתחברות של החברה החזיר דף HTML במקום תשובת JSON. החיבור הזה לא הושלם; ודא שקיים רק חיבור אחד לאותה זהות בחברה ונסה שוב. אם התקלה חוזרת, השתמש ברענון עם חלון אבחון.'
        : 'שירות ההתחברות של החברה החזיר דף HTML במקום תשובת נתונים. נסה שוב עם חלון אבחון.';
  } else if (/fetchGetWithinPage parse error/i.test(raw) && /(?:<!DOCTYPE|<html)/i.test(raw)) {
    code = 'CREDIT_DATA_HTML_RESPONSE';
    stage = 'DataApi';
    message =
      'שירות הנתונים של החברה החזיר דף HTML במקום תשובת JSON. החיבור נשמר אך לא התקבלו ממנו נתונים תקינים.';
  } else if (/automation detected and blocked|block automation|bot detection/i.test(raw)) {
    code = 'CREDIT_AUTOMATION_BLOCKED';
    stage = 'LoginPage';
    message =
      'אתר חברת האשראי חסם זמנית את הגישה האוטומטית. יש להמתין עד תום ההשהיה; גם רענון ידני או חלון אבחון אינם עוקפים אותה.';
  } else {
    const context = creditFailureContext(type, raw, profile);
    if (context) {
      code = context.code;
      stage = context.stage;
      message = context.message;
    } else {
      code = 'CREDIT_SCRAPE_FAILED';
      const diagnostic = safeCreditProviderDiagnostic(raw, profile);
      message = `החברה החזירה תשובה שלא ניתן לעבד. נסה שוב עם חלון אבחון; אם התקלה חוזרת יש לעדכן את מחבר החברה.${diagnostic ? ` אבחון טכני בטוח: ${diagnostic}` : ''}`;
    }
  }
  const e = new Error(`${label}: ${message}`);
  e.code = code;
  if (stage) e.stage = stage;
  return e;
}

export const CREDIT_AUTOMATION_BLOCK_COOLDOWN_MS = 24 * 60 * 60 * 1000;

export const CREDIT_RATE_LIMIT_FALLBACK_COOLDOWN_MS = 24 * 60 * 60 * 1000;

function matchingCreditProfileErrors(errors, profile) {
  const profileId = String(profile?.profileId || ''),
    provider = String(profile?.provider || '');
  if (!profileId && !provider) return [];
  return (Array.isArray(errors) ? errors : [])
    .filter(
      (error) =>
        error &&
        (!profileId || String(error.profileId || '') === profileId) &&
        (!provider || String(error.provider || '') === provider)
    )
    .sort((a, b) => (Date.parse(b?.at || '') || 0) - (Date.parse(a?.at || '') || 0));
}

export function creditAutomaticRetryAfterAt(error, now = Date.now()) {
  const code = String(error?.code || ''),
    explicit = Date.parse(error?.retryAfterAt || '');
  if (Number.isFinite(explicit) && explicit > Number(now)) return new Date(explicit).toISOString();
  if (code !== 'CREDIT_AUTOMATION_BLOCKED' && code !== 'CREDIT_PROVIDER_RATE_LIMITED') return null;
  const base = Number(now);
  if (!Number.isFinite(base)) return null;
  return new Date(
    base +
      (code === 'CREDIT_AUTOMATION_BLOCKED'
        ? CREDIT_AUTOMATION_BLOCK_COOLDOWN_MS
        : CREDIT_RATE_LIMIT_FALLBACK_COOLDOWN_MS)
  ).toISOString();
}

function creditErrorBrowserEngine(error, profile) {
  const explicit = String(error?.browserEngine || '').toLowerCase();
  if (explicit) return explicit;
  // Bridge <=37 forced Amex through Camoufox and did not persist browserEngine on
  // profile errors. This narrow migration rule lets an existing Amex LoginPage/403
  // cooldown suppress only the old Camoufox fallback, not the newly eligible
  // Chromium primary path. Do not guess an engine for any other legacy failure.
  if (
    String(profile?.provider || '') === 'amex' &&
    String(error?.code || '') === 'CREDIT_AUTOMATION_BLOCKED' &&
    String(error?.stage || '') === 'LoginPage' &&
    Number(error?.httpStatus) === 403
  )
    return 'camoufox';
  return '';
}

function deferredCreditError(error, retryAt, { engineOnly = false } = {}) {
  const originalFailureAt = error.originalFailureAt || error.at || null,
    reason = String(error.code || '').includes('RATE_LIMITED') ? '429' : '403',
    engine = creditErrorBrowserEngine(error, { provider: error?.provider });
  return {
    ...error,
    severity: 'deferred',
    deferred: true,
    originalFailureAt,
    at: originalFailureAt,
    message:
      engineOnly && engine === 'camoufox'
        ? `Camoufox מושהה עד ${new Date(retryAt).toISOString()} עקב 403 קודם. מסלול Chromium הראשי נשאר זכאי לניסיון.`
        : `מושהה עד ${new Date(retryAt).toISOString()} עקב ${reason} קודם. לא נשלחה בקשה חדשה לחברת האשראי.`,
  };
}

export function deferredCamoufoxProfileError(errors, profile, now = Date.now()) {
  const time = Number(now);
  if (!Number.isFinite(time)) return null;
  for (const error of matchingCreditProfileErrors(errors, profile)) {
    const retryAt = Date.parse(error?.retryAfterAt || '');
    if (
      Number.isFinite(retryAt) &&
      retryAt > time &&
      String(error?.code || '') === 'CREDIT_AUTOMATION_BLOCKED' &&
      creditErrorBrowserEngine(error, profile) === 'camoufox'
    )
      return deferredCreditError({ ...error, browserEngine: 'camoufox' }, retryAt, {
        engineOnly: true,
      });
  }
  return null;
}

export function deferredCreditProfileError(errors, profile, now = Date.now()) {
  const time = Number(now);
  if (!Number.isFinite(time)) return null;
  const matching = matchingCreditProfileErrors(errors, profile);
  for (const error of matching) {
    const retryAt = Date.parse(error?.retryAfterAt || '');
    if (!Number.isFinite(retryAt) || retryAt <= time) continue;
    // 429 is issuer-wide. A Camoufox-only 403 is not: Chromium may still be usable.
    if (
      String(error?.code || '') === 'CREDIT_AUTOMATION_BLOCKED' &&
      creditErrorBrowserEngine(error, profile) === 'camoufox'
    )
      continue;
    return deferredCreditError(error, retryAt);
  }
  return null;
}

export function expiredCamoufoxLoginPageBlock(errors, profile, now = Date.now()) {
  const time = Number(now),
    provider = String(profile?.provider || '');
  if (!Number.isFinite(time) || !['amex', 'isracard'].includes(provider)) return null;
  const latest = matchingCreditProfileErrors(errors, profile).find(
    (error) => creditErrorBrowserEngine(error, profile) === 'camoufox'
  );
  if (!latest) return null;
  if (
    String(latest.code || '') !== 'CREDIT_AUTOMATION_BLOCKED' ||
    String(latest.stage || '') !== 'LoginPage' ||
    Number(latest.httpStatus) !== 403
  )
    return null;
  const retryAt = Date.parse(latest.retryAfterAt || '');
  return Number.isFinite(retryAt) && retryAt <= time ? latest : null;
}

export function creditErrorSeverity(error = {}) {
  const code = String(error?.code || ''),
    stage = String(error?.stage || ''),
    given = String(error?.severity || '');
  if (
    error?.deferred === true ||
    code === 'CREDIT_AUTOMATION_BLOCKED' ||
    code === 'CREDIT_PROVIDER_RATE_LIMITED'
  )
    return 'deferred';
  if (['error', 'warning', 'deferred', 'info'].includes(given)) return given;
  if (error?.tier === 'forecast' || stage === 'Frames' || stage === 'Pending') return 'warning';
  return 'error';
}

export function creditErrorComponent(error = {}) {
  const given = String(error?.component || '');
  if (
    ['core_transactions', 'forecast_transactions', 'pending', 'frames', 'profile'].includes(given)
  )
    return given;
  if (error?.tier === 'core') return 'core_transactions';
  if (error?.tier === 'forecast') return 'forecast_transactions';
  if (String(error?.stage || '') === 'Frames') return 'frames';
  if (String(error?.stage || '') === 'Pending') return 'pending';
  return 'profile';
}

export function creditScrapeFailure(result, profile) {
  return safeCreditScrapeFailure(result?.errorType, result?.errorMessage, profile);
}

export function creditLoginThrownScrapeFailure(error, profile) {
  if (String(error?.code || '').startsWith('CREDIT_')) return error;
  const raw = String(error?.message || error || ''),
    isTimeout =
      String(error?.name || '') === 'TimeoutError' ||
      /Navigation timeout of \d+ ms exceeded|waiting for (?:selector|navigation).*timeout/i.test(
        raw
      );
  return safeCreditScrapeFailure(
    isTimeout ? 'TIMEOUT' : 'SCRAPE_FAILED',
    `login flow: ${raw}`,
    profile
  );
}

export function creditThrownScrapeFailure(error, profile) {
  if (String(error?.code || '').startsWith('CREDIT_')) return error;
  return safeCreditScrapeFailure('SCRAPE_FAILED', error?.message || error, profile);
}
