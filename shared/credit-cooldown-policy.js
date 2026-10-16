// @ts-check
import { evidenceTimestamp, observationTimeMs } from './observation-time.js';

// Product policy: one automatic cooldown lasts at most one daily refresh cycle.
export const CREDIT_MAX_AUTO_COOLDOWN_MS = 24 * 60 * 60 * 1000;

/** Anchor the ceiling to the original failure, never to repeated reads of now.
 * Invalid/future failure evidence cannot grant indefinite scheduling authority.
 * @param {unknown} error @param {number} [now] @returns {string|null} */
export function creditRetryAfterAt(error, now = Date.now()) {
  if (!error || typeof error !== 'object' || Array.isArray(error)) return null;
  const row = /** @type {Record<string,unknown>} */ (error);
  const failedAt = observationTimeMs(row.originalFailureAt ?? row.at, now);
  if (failedAt === null || !evidenceTimestamp(row.retryAfterAt)) return null;
  return new Date(Math.min(Date.parse(row.retryAfterAt), failedAt + CREDIT_MAX_AUTO_COOLDOWN_MS)).toISOString();
}
