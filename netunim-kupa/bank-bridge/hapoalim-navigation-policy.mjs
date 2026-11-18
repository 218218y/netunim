// @ts-check
import { HAPOALIM_DATA_RETRY_LIMIT } from './hapoalim-policy.mjs';

/** @param {unknown} error */
export function isTransientNavigationError(error) {
  const detail = error && typeof error === 'object' && 'message' in error ? error.message : '';
  const message = String(detail || error || '').toLowerCase();
  return (
    message.includes('execution context was destroyed') ||
    message.includes('cannot find context with specified id') ||
    message.includes('inspected target navigated or closed') ||
    message.includes('most likely because of a navigation') ||
    message.includes('protocol error (runtime.callfunctionon)')
  );
}

/** @template T @param {(attempt:number)=>T|Promise<T>} operation @param {{attempts?:number,onRetry?:(error:unknown,attempt:number)=>unknown}} [options] @returns {Promise<T>} */
export async function retryTransientNavigation(
  operation,
  { attempts = HAPOALIM_DATA_RETRY_LIMIT, onRetry = async () => {} } = {}
) {
  const configured = Number(attempts);
  const count = Number.isFinite(configured) && configured !== 0
    ? Math.max(1, Math.trunc(configured))
    : HAPOALIM_DATA_RETRY_LIMIT;
  let lastError;
  for (let attempt = 1; attempt <= count; attempt++) {
    try {
      return await operation(attempt);
    } catch (error) {
      lastError = error;
      if (attempt >= count || !isTransientNavigationError(error)) throw error;
      await onRetry(error, attempt);
    }
  }
  throw lastError;
}
