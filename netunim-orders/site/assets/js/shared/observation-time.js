// @ts-check

/** @param {unknown} value @returns {value is string} */
export function evidenceDate(value){
  if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(value))return false;
  const date=new Date(value+'T00:00:00Z');
  return Number.isFinite(date.getTime())&&date.toISOString().slice(0,10)===value;
}
/** @param {unknown} value @returns {value is string} */
export function evidenceTimestamp(value){
  return typeof value==='string'&&
    /^\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d+)?(?:Z|[+-](?:[01]\d|2[0-3]):[0-5]\d)$/.test(value)&&
    evidenceDate(value.slice(0,10))&&Number.isFinite(Date.parse(value));
}
// Observation clocks may drift slightly. Scheduling deadlines use a separate policy.
export const OBSERVATION_FUTURE_TOLERANCE_MS = 5 * 60 * 1000;

/** A network observation must be an exact, zoned ISO timestamp on a real date.
 * @param {unknown} value @param {number} [now] @returns {number|null} */
export function observationTimeMs(value, now = Date.now()) {
  if (!evidenceTimestamp(value) || !Number.isFinite(now)) return null;
  const time = Date.parse(value);
  return time <= now + OBSERVATION_FUTURE_TOLERANCE_MS ? time : null;
}
