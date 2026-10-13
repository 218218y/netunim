// @ts-check
import {
  CREDIT_CORE_FUTURE_MONTHS,
  CREDIT_FUTURE_MONTHS,
  CREDIT_SYNC_MODE_FORECAST,
  CREDIT_SYNC_MODE_QUICK,
  CREDIT_SYNC_MODE_RECOVERY,
} from './credit-adapter-wire.mjs';
import { creditRecentStartDate, creditRecoveryStartDate } from './credit-month-plan.mjs';

/** @typedef {'quick'|'forecast'|'recovery'} CreditSyncMode */
/** @typedef {{syncMode:CreditSyncMode,startDate:Date,futureMonths:1|12}} CreditSyncScope */
/** @param {unknown} value @returns {CreditSyncMode} */
export function normalizeCreditSyncMode(value) {
  if (value === CREDIT_SYNC_MODE_FORECAST) return CREDIT_SYNC_MODE_FORECAST;
  if (value === CREDIT_SYNC_MODE_RECOVERY || value === 'full') return CREDIT_SYNC_MODE_RECOVERY;
  if (value === CREDIT_SYNC_MODE_QUICK || value === 'daily') return CREDIT_SYNC_MODE_QUICK;
  return CREDIT_SYNC_MODE_QUICK;
}

/** @param {{syncMode?:unknown,now?:Date}} [options] @returns {CreditSyncScope} */
export function creditSyncScope({ syncMode = CREDIT_SYNC_MODE_QUICK, now = new Date() } = {}) {
  const mode = normalizeCreditSyncMode(syncMode);
  if (mode === CREDIT_SYNC_MODE_RECOVERY)
    return {
      syncMode: mode,
      startDate: creditRecoveryStartDate(now),
      futureMonths: CREDIT_FUTURE_MONTHS,
    };
  if (mode === CREDIT_SYNC_MODE_FORECAST)
    return {
      syncMode: mode,
      startDate: creditRecentStartDate(now),
      futureMonths: CREDIT_FUTURE_MONTHS,
    };
  return {
    syncMode: mode,
    startDate: creditRecentStartDate(now),
    futureMonths: CREDIT_CORE_FUTURE_MONTHS,
  };
}
