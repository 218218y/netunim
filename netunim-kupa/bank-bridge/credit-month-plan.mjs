// @ts-nocheck
import {
  CREDIT_FUTURE_MONTHS,
  CREDIT_HISTORY_DAYS,
  CREDIT_CORE_FUTURE_MONTHS,
  CREDIT_RECENT_HISTORY_DAYS,
} from './credit-adapter-wire.mjs';

function two(value) {
  return String(value).padStart(2, '0');
}

function monthKey(value) {
  const d = new Date(value);
  return `${d.getUTCFullYear()}-${two(d.getUTCMonth() + 1)}`;
}

function monthStart(value) {
  const d = new Date(value);
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1));
}

function addMonths(value, count) {
  const d = monthStart(value);
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + count, 1));
}

export function creditRecoveryStartDate(now = new Date()) {
  const d = new Date(now);
  d.setUTCDate(d.getUTCDate() - CREDIT_HISTORY_DAYS);
  return d;
}

export function creditRecentStartDate(now = new Date()) {
  const d = new Date(now);
  d.setUTCDate(d.getUTCDate() - CREDIT_RECENT_HISTORY_DAYS);
  return d;
}

export function buildCreditMonthPlan({
  startDate = creditRecoveryStartDate(),
  futureMonths = CREDIT_FUTURE_MONTHS,
  now = new Date(),
} = {}) {
  const start = monthStart(startDate),
    current = monthStart(now),
    coreEnd = addMonths(current, CREDIT_CORE_FUTURE_MONTHS),
    end = addMonths(
      current,
      Math.max(CREDIT_CORE_FUTURE_MONTHS, Math.trunc(Number(futureMonths) || 0))
    ),
    months = [];
  for (let cursor = start; cursor <= end; cursor = addMonths(cursor, 1))
    months.push({ month: monthKey(cursor), tier: cursor <= coreEnd ? 'core' : 'forecast' });
  return months;
}
