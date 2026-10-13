// @ts-nocheck

export const CREDIT_CONNECTOR_CONTRACT_VERSION = 2;

export const CREDIT_PROVIDER_SCHEMA_VERSION = 'israeli-bank-scrapers-6.10.0';

export const MAX_PROVIDER_SCHEMA_VERSION = 'max-netunim-v2+upstream-login-6.10.0';

export const VISA_CAL_PROVIDER_SCHEMA_VERSION =
  'visa-cal-netunim-v8+upstream-6.12.1-balance+pr1184-invalid-password+pr1193-browser-api+authenticated-session-result';

export const CREDIT_CORE_FUTURE_MONTHS = 1;

export const CREDIT_RECENT_HISTORY_DAYS = 30;

export const CREDIT_SYNC_MODE_QUICK = 'quick';

export const CREDIT_SYNC_MODE_FORECAST = 'forecast';

export const CREDIT_SYNC_MODE_RECOVERY = 'recovery';

export const CAL_ENDPOINTS = {
  frames: 'https://api.cal-online.co.il/Frames/api/Frames/GetFrameStatus',
  pending: 'https://api.cal-online.co.il/Transactions/api/approvals/getClearanceRequests',
  transactions:
    'https://api.cal-online.co.il/Transactions/api/transactionsDetails/getCardTransactionsDetails',
};

export const CAL_STATIC_HEADERS = {
  Origin: 'https://digital-web.cal-online.co.il',
  Referer: 'https://digital-web.cal-online.co.il',
  'Accept-Language': 'he-IL,he;q=0.9,en-US;q=0.8,en;q=0.7',
  'Sec-Fetch-Site': 'same-site',
  'Sec-Fetch-Mode': 'cors',
  'Sec-Fetch-Dest': 'empty',
};

export const CAL_TRANSACTION_TYPES = {
  regular: '5',
  credit: '6',
  installments: '8',
  standingOrder: '9',
};

export const CAL_FRAMES_NOT_RELEVANT_STATUS = 87;

export const CAL_INVALID_PASSWORD_MESSAGE = 'שם המשתמש או הסיסמה שהוזנו שגויים';

export const MAX_BASE_API_ACTIONS_URL = 'https://onlinelcapi.max.co.il';

const MAX_BASE_WELCOME_URL = 'https://www.max.co.il';

export const MAX_HOME_PAGE_DATA_URL = `${MAX_BASE_WELCOME_URL}/api/registered/getHomePageData`;

export const MAX_CATEGORIES_URL = `${MAX_BASE_API_ACTIONS_URL}/api/contents/getCategories`;

export const CREDIT_HISTORY_DAYS = 130;
export const CREDIT_FUTURE_MONTHS = 12;
