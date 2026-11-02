const expenseUuid = value => typeof value === 'string' && /^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/i.test(value);
import {validateExpenseReporting} from './morning-report-period.js';
import {expenseInputIssues} from './morning-expense-validation.js';
export {expenseInputIssues} from './morning-expense-validation.js';

export function expenseCents(value) {
  if (typeof value !== 'string' && typeof value !== 'number') return null;
  const source = String(value);
  if (source.length > 20 || !/^\d+(?:\.\d{1,2})?$/.test(source)) return null;
  const [whole, fraction = ''] = source.split('.');
  const cents = BigInt(whole) * 100n + BigInt(fraction.padEnd(2, '0'));
  return cents <= 100000000000n ? Number(cents) : null;
}
export function normalizeExpenseInput(body, today, {allowP = false} = {}) {
  const input = body?.expense;
  if (!expenseUuid(body?.operationId)) throw new Error('invalid_expense_input');
  const issues = expenseInputIssues(input, today, {allowP, cents:expenseCents});
  if (issues.length) throw Object.assign(new Error(issues[0].code), {issues});
  const reporting = validateExpenseReporting(input, today);
  const net = expenseCents(input.net), vat = expenseCents(input.vat), gross = expenseCents(input.gross);
  const p = input.pcnClassification === 'P';
  return {supplierId:input.supplierId, classificationExpenseId:input.classificationExpenseId, documentType:input.documentType, number:p ? input.number.trim().padStart(9, '0') : input.number.trim(),
    date:input.date, reportingDate:input.reportingDate, netCents:net, vatCents:vat, grossCents:gross, pcnClassification:p ? 'P' : 'T',
    description:input.description.trim(), allocationNumber:input.allocationNumber || '', ...reporting};
}
