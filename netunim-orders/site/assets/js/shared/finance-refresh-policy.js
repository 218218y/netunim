// @ts-check
import { observationTimeMs, OBSERVATION_FUTURE_TOLERANCE_MS } from './observation-time.js';

export const BANK_AUTO_INTERVAL_MS=4*60*60*1000;
export const CREDIT_AUTO_INTERVAL_MS=24*60*60*1000;

/** @param {unknown} updatedAt @param {number} intervalMs @param {number} now */
function refreshDue(updatedAt,intervalMs,now){
  const time=observationTimeMs(updatedAt,now);
  return time===null||now-time>=intervalMs;
}
/** @param {unknown} updatedAt @param {number} [now] */
export function bankAutoRefreshDue(updatedAt,now=Date.now()){return refreshDue(updatedAt,BANK_AUTO_INTERVAL_MS,now)}
/** @param {unknown} updatedAt @param {number} [now] */
export function creditRefreshDue(updatedAt,now=Date.now()){return refreshDue(updatedAt,CREDIT_AUTO_INTERVAL_MS,now)}

/** The wakeup must agree with admission: an invalid observation is due now.
 * @param {unknown} updatedAt @param {number} intervalMs @param {number} [now] */
export function financeRefreshDelayMs(updatedAt, intervalMs, now = Date.now()) {
  const time = observationTimeMs(updatedAt, now);
  return time === null ? 0 : Math.max(0, time + intervalMs - now);
}

/** Computer-local attempts are epoch milliseconds, not provider observations.
 * A saved future attempt cannot defer work after a corrected local clock.
 * @param {number} attemptedAt @param {number} retryMs @param {number} [now] */
export function financeAttemptDelayMs(attemptedAt, retryMs, now = Date.now()) {
  return Number.isSafeInteger(attemptedAt) && attemptedAt > 0 &&
    attemptedAt <= now + OBSERVATION_FUTURE_TOLERANCE_MS
    ? Math.max(0, attemptedAt + retryMs - now) : 0;
}
