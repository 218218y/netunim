import {createMorningExpenseIntake} from '../domains/finance/morning-expense-intake.js';
import {createExpenseRequest} from '../integrations/morning-expenses.js';
import {validateExpenseFile, uploadExpenseFile} from '../platform/morning-expense-files.js';

// This entire composition is loaded only when its panel is first opened.
export function createFinanceMorningExpenses({auth, morningOperationScope, confirmDialog, isActive}) {
  return createMorningExpenseIntake({request:createExpenseRequest({supaFetch:(...args) => auth.supaFetch(...args)}),
    captureRead:() => morningOperationScope.captureRead(), captureWrite:() => morningOperationScope.capture(),
    accountId:() => auth.getAccountScope()?.owner, subscribeAccountScope:listener => auth.subscribeAccountScope?.(listener) || (() => {}),
    confirmDialog, files:{validate:validateExpenseFile, upload:uploadExpenseFile}, isActive});
}
