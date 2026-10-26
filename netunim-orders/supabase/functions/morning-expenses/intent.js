import {expenseUuid} from './service.js';
import {expenseCents} from './input.js';

// Every fresh verification and file attachment compares the same canonical
// fields. A historical verified_at timestamp cannot authorize a changed expense.
export function expenseMatchesIntent(raw, payload) {
  if (!payload?.supplier || !payload.accountingClassification) return false;
  return expenseUuid(raw?.id) && raw.documentType === payload.documentType && raw.number === payload.number && raw.date === payload.date &&
    raw.reportingDate === payload.reportingDate && raw.currency === 'ILS' && expenseCents(raw.amount) === expenseCents(payload.amount) &&
    expenseCents(raw.vat) === expenseCents(payload.vat) && raw.supplier?.taxId === payload.supplier.taxId &&
    raw.accountingClassification?.id === payload.accountingClassification.id && raw.data?.pcnClassification === 'T' &&
    (!payload.allocationNumber || raw.allocationNumber === payload.allocationNumber) && [10, 20, 30, 40].includes(raw.status);
}
