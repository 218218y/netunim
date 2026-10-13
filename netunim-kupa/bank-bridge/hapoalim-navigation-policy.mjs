// @ts-nocheck
import { HAPOALIM_DATA_RETRY_LIMIT } from './hapoalim-policy.mjs';

export function isTransientNavigationError(error) {
  const message = String(error?.message || error || '').toLowerCase();
  return (
    message.includes('execution context was destroyed') ||
    message.includes('cannot find context with specified id') ||
    message.includes('inspected target navigated or closed') ||
    message.includes('most likely because of a navigation') ||
    message.includes('protocol error (runtime.callfunctionon)')
  );
}

export async function retryTransientNavigation(
  operation,
  { attempts = HAPOALIM_DATA_RETRY_LIMIT, onRetry = async () => {} } = {}
) {
  const count = Math.max(1, Number(attempts) || HAPOALIM_DATA_RETRY_LIMIT);
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
