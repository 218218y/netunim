// @ts-check
import { evidenceTimestamp } from './response-evidence.js';

// Observation clocks may drift slightly. Scheduling deadlines use a separate policy.
export const OBSERVATION_FUTURE_TOLERANCE_MS = 5 * 60 * 1000;

/** A network observation must be an exact, zoned ISO timestamp on a real date.
 * @param {unknown} value @param {number} [now] @returns {number|null} */
export function observationTimeMs(value, now = Date.now()) {
  if (!evidenceTimestamp(value) || !Number.isFinite(now)) return null;
  const time = Date.parse(value);
  return time <= now + OBSERVATION_FUTURE_TOLERANCE_MS ? time : null;
}
