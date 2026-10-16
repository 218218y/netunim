import { observationTimeMs } from './observation-time.js';

export const BANK_AUTO_INTERVAL_MS=4*60*60*1000;
export const CREDIT_AUTO_INTERVAL_MS=24*60*60*1000;

function refreshDue(updatedAt,intervalMs,now){
  const time=observationTimeMs(updatedAt,now);
  return time===null||now-time>=intervalMs;
}
export function bankAutoRefreshDue(updatedAt,now=Date.now()){return refreshDue(updatedAt,BANK_AUTO_INTERVAL_MS,now)}
export function creditRefreshDue(updatedAt,now=Date.now()){return refreshDue(updatedAt,CREDIT_AUTO_INTERVAL_MS,now)}
