import {expensePermission, expenseUuid} from './service.js';

// Production needs BOTH the ordinary server-owned write grant and one explicitly
// nominated pilot user. A Sandbox grant or a client-supplied metadata flag cannot
// open it. This identity gate remains active when new writes are switched off.
export function expenseWriteAccess(user, environment, writeIds, productionUserId) {
  if (!expensePermission(user, 'write', writeIds)) return false;
  if (environment === 'sandbox') return true;
  return environment === 'production' && expenseUuid(productionUserId) && user.id === productionUserId;
}
