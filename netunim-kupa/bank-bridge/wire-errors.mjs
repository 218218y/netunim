import {publicAccountDescriptors} from './hapoalim-account-model.mjs';
import {evidenceTimestamp} from './observation-time.mjs';

// Native/provider messages can contain paths, credentials and account details.
// Only product codes and validated fields belong on the browser error contract.
const messages = new Map();
const accountSelectionCodes = ['ACCOUNT_NOT_FOUND', 'MULTIPLE_ACCOUNTS', 'AMBIGUOUS_ACCOUNT',
  'ACCOUNT_SELECTION_FAILED', 'INCOMPLETE_ACCOUNT_SELECTOR'];
for (const [codes, message] of [
  [['BRIDGE_ERROR', 'BANK_DATA_ERROR', 'SCRAPE_FAILED'], 'קריאת נתוני הבנק נכשלה. בדוק את מצב המחבר ונסה שוב.'],
  [['UNAUTHORIZED', 'BRIDGE_AUTH_REQUIRED'], 'מפתח המחבר שגוי, בוטל או פג. יש לבדוק את ההצמדה במחשב.'],
  [['BRIDGE_CAPABILITY_REQUIRED'], 'יש לאשר מקומית הרשאה לפעולה זו במחבר.'],
  [['BRIDGE_PAIRING_INVALID', 'BRIDGE_PAIRING_INACTIVE', 'BRIDGE_PAIRING_BUSY', 'BRIDGE_PAIRING_STORAGE'], 'לא ניתן להשלים את ההצמדה. בדוק את מצב ההצמדה במחשב.'],
  [['BRIDGE_STOPPING', 'SCRAPE_BUSY'], 'המחבר ממתין לסיום פעולה קיימת. אפשר לנסות שוב לאחר סיומה.'],
  [['REQUEST_TOO_LARGE'], 'הבקשה גדולה מדי'],
  [['INVALID_JSON'], 'JSON לא תקין'],
  [['MISSING_CREDENTIALS', 'MISSING_CREDIT_CREDENTIALS', 'CREDIT_CREDENTIALS'], 'חסרים פרטי התחברות. יש להשלים אותם בהגדרות החיבור.'],
  [['NOT_CONFIGURED', 'CREDIT_NOT_CONFIGURED'], 'לא נשמר חיבור פעיל. יש להגדיר חיבור לפני הרענון.'],
  [['NO_BALANCE'], 'לא התקבלה יתרה תקינה לחשבון. בדוק את החשבון באתר הבנק ונסה שוב.'],
  [['NO_ACCOUNTS'], 'הבנק לא החזיר חשבונות פעילים לחיבור. יש לבדוק את ההרשאות באתר הבנק.'],
  [accountSelectionCodes, 'יש לבחור סניף ומספר חשבון מתוך החשבונות הפעילים של הבנק.'],
  [['DUPLICATE_ACCOUNT_ROLE'], 'יש לבחור חשבונות שונים לחשבון העסקי ולחשבון הביתי.'],
  [['INVALID_PASSWORD', 'CREDIT_INVALID_PASSWORD', 'CREDIT_LOGIN_REJECTED'], 'פרטי ההתחברות נדחו. יש לבדוק אותם בהגדרות החיבור.'],
  [['CHANGE_PASSWORD', 'CREDIT_CHANGE_PASSWORD'], 'הספק דורש החלפת סיסמה באתר שלו לפני המשך הסנכרון.'],
  [['ACCOUNT_BLOCKED', 'CREDIT_ACCOUNT_BLOCKED'], 'הספק חסם את החשבון. יש לבדוק את מצב החשבון באתר הספק.'],
  [['AUTH_REQUIRED', 'SILENT_AUTH_TIMEOUT', 'BANK_SESSION_NOT_READY', 'CREDIT_AUTH_TOKEN_MISSING', 'CREDIT_SESSION_INIT_MISSING'], 'יש לפתוח אימות אצל הספק ולהשלים את ההתחברות.'],
  [['INTERACTIVE_AUTH_TIMEOUT', 'TIMEOUT', 'CREDIT_LOGIN_TIMEOUT'], 'זמן ההתחברות הסתיים. אפשר לפתוח שוב אימות ולהשלים אותו.'],
  [['INTERACTIVE_BROWSER_CLOSED', 'BANK_PAGE_CLOSED'], 'חלון האימות נסגר לפני שהפעולה הושלמה.'],
  [['BROWSER_NOT_FOUND', 'BROWSER_START_FAILED', 'WINDOWS_REQUIRED', 'CREDIT_BROWSER_RUNTIME_MISSING', 'CREDIT_CAMOUFOX_RUNTIME_MISSING', 'CREDIT_CAMOUFOX_STARTUP_FAILED', 'CREDIT_CAMOUFOX_PROFILE_IN_USE'], 'לא ניתן להפעיל את דפדפן המחבר. בדוק את ההתקנה ואת חלונות האימות הפתוחים במחשב.'],
  [['CREDIT_DUPLICATE_LOGIN'], 'כבר קיים חיבור לאותה זהות בחברת האשראי. חיבור אחד מחזיר את כל הכרטיסים שלה.'],
  [['MISSING_PROFILE_ID', 'UNSUPPORTED_CREDIT_PROVIDER', 'INVALID_CARD6'], 'פרטי חיבור האשראי אינם תקינים. בדוק אותם בהגדרות.'],
  [['INVALID_CONNECTION_IMPORT', 'INVALID_CONNECTION_IMPORT_BANK', 'INVALID_CONNECTION_IMPORT_CREDIT'], 'קובץ הגדרות החיבורים אינו תקין או אינו מתאים למחבר.'],
  [['CREDIT_SYNC_FAILED', 'CREDIT_SCRAPE_FAILED', 'CREDIT_UNKNOWN_ERROR', 'CREDIT_PROVIDER_DATA_ERROR', 'CREDIT_CAMOUFOX_FAILED'], 'סנכרון האשראי נכשל. בדוק את מצב החיבור ואת קוד התקלה.'],
  [['CREDIT_PROVIDER_RATE_LIMITED'], 'חברת האשראי הגבילה זמנית את קצב הבקשות. יש להמתין לפני ניסיון נוסף.'],
  [['CREDIT_AUTOMATION_BLOCKED'], 'חברת האשראי חסמה את החיבור האוטומטי. בדוק את החיבור באתר החברה לפני ניסיון נוסף.'],
  [['CREDIT_PROVIDER_NETWORK_ERROR', 'CREDIT_PROVIDER_UNAVAILABLE', 'CREDIT_PROVIDER_HTTP_ERROR'], 'שירות חברת האשראי אינו זמין כרגע. אפשר לנסות שוב מאוחר יותר.'],
  [['CREDIT_PROVIDER_SCHEMA_ERROR', 'CREDIT_PROVIDER_RESPONSE_NOT_JSON', 'CREDIT_LOGIN_HTML_RESPONSE', 'CREDIT_DATA_HTML_RESPONSE', 'CREDIT_LOGIN_UI_UNAVAILABLE', 'CREDIT_CONNECTOR_COMPATIBILITY_ERROR', 'CREDIT_BROWSER_IDENTITY_UNAVAILABLE', 'CREDIT_CAMOUFOX_IDENTITY_CORRUPT', 'CREDIT_CAMOUFOX_IDENTITY_UNAVAILABLE', 'CREDIT_CAMOUFOX_IDENTITY_UNSTABLE', 'CREDIT_CAMOUFOX_LOGIN_PROTOCOL', 'CREDIT_CAMOUFOX_UNSUPPORTED'], 'תגובת הספק אינה תואמת למחבר. בדוק אם זמין עדכון למחבר.'],
  [['CREDIT_FRAMES_UNAVAILABLE', 'CREDIT_PARTIAL_FORECAST', 'CREDIT_CORE_COVERAGE_INCOMPLETE', 'PARTIAL', 'BANK_TRANSACTIONS_INVALID'], 'חלק מנתוני הספק לא התקבלו. יש לבדוק את שלמות הנתונים לפני שימוש בהם.'],
]) for (const code of codes) messages.set(code, message);

const stages = new Set(['account', 'balance', 'browser', 'data', 'login', 'session', 'transactions',
  'AuthToken', 'BrowserIdentity', 'BrowserInit', 'BrowserLaunch', 'BrowserProfileRecovery', 'CardExcluded',
  'CardList', 'Complete', 'CoreCoverage', 'DashboardInit', 'DataApi', 'DigitalV3', 'Forecast', 'Frames',
  'IdentityContinuity', 'IdentityRecovery', 'Login', 'LoginApi', 'LoginDecision', 'LoginFlow', 'LoginPage',
  'LoginPassword', 'LoginSetup', 'MaxCards', 'MaxCategories', 'MaxData', 'MaxMonth', 'MaxTransactions',
  'Pending', 'Profile', 'SessionClosed', 'Transactions', 'TransactionsPage', 'ValidateIdData', 'performLogonI']);

function publicStage(value) {
  return stages.has(value) || typeof value === 'string' && /^(?:Billing|Transactions) \d{4}-(?:0[1-9]|1[0-2])$/.test(value) ? value : '';
}
function publicHttpStatus(value) {
  const status = Number(value);
  return Number.isInteger(status) && status >= 100 && status <= 599 ? status : 0;
}
function publicFailure(error) {
  const code = messages.has(error?.code) ? error.code : 'BRIDGE_ERROR';
  return {code, stage: publicStage(error?.stage), message: messages.get(code), httpStatus: publicHttpStatus(error?.httpStatus)};
}

export function bankBridgeCreditErrors(errors) {
  return (Array.isArray(errors) ? errors : []).slice(0, 100).map(error => {
    const row = {...publicFailure(error)};
    for (const key of ['at', 'originalFailureAt', 'retryAfterAt', 'providerRetryAfterAt'])
      if (evidenceTimestamp(error?.[key])) row[key] = error[key];
    for (const key of ['profileId', 'correlationId', 'diagnosticFingerprint'])
      if (typeof error?.[key] === 'string' && /^[A-Za-z0-9_-]{1,80}$/.test(error[key])) row[key] = error[key];
    for (const [key, allowed] of [
      ['provider', ['visaCal', 'max', 'isracard', 'amex']], ['browserEngine', ['chromium', 'camoufox']],
      ['fallbackFromBrowserEngine', ['chromium', 'camoufox']], ['severity', ['error', 'warning', 'deferred', 'info']],
      ['component', ['core_transactions', 'forecast_transactions', 'pending', 'frames', 'profile']], ['tier', ['core', 'forecast', 'history']],
      ['loginStep', ['navigation', 'landing-readiness', 'open-login-popup', 'credentials-submit', 'post-submit-navigation', 'result-detection']],
      ['loginState', ['authenticated-session', 'session-init-only', 'session-auth-only', 'invalid-password-route', 'change-password-route', 'connect-frame', 'dashboard-url', 'no-connect-frame', 'unavailable']],
    ]) if (allowed.includes(error?.[key])) row[key] = error[key];
    if (typeof error?.month === 'string' && /^\d{4}-(?:0[1-9]|1[0-2])$/.test(error.month)) row.month = error.month;
    if (typeof error?.accountSuffix === 'string' && /^\d{4}$/.test(error.accountSuffix)) row.accountSuffix = error.accountSuffix;
    if (messages.has(error?.fallbackFromCode)) row.fallbackFromCode = error.fallbackFromCode;
    if (publicStage(error?.fallbackFromStage)) row.fallbackFromStage = publicStage(error.fallbackFromStage);
    if (publicHttpStatus(error?.fallbackFromHttpStatus)) row.fallbackFromHttpStatus = publicHttpStatus(error.fallbackFromHttpStatus);
    return row;
  });
}

export function bankBridgeErrorResponse(error) {
  const failure = publicFailure(error);
  const selection = accountSelectionCodes.includes(failure.code);
  return {ok: false, ...failure,
    availableAccounts: selection ? publicAccountDescriptors(error?.availableAccounts).slice(0, 50) : [],
    accountRole: error?.accountRole === 'home' ? 'home' : error?.accountRole === 'business' ? 'business' : '',
    creditErrors: bankBridgeCreditErrors(error?.creditErrors)};
}
