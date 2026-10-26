const expenseUuid = value => typeof value === 'string' && /^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/i.test(value);
import {validReportDate as reportDate, validateExpenseReporting} from './morning-report-period.js';

export function expenseCents(value) {
  if (typeof value !== 'string' && typeof value !== 'number') return null;
  const source = String(value);
  if (source.length > 20 || !/^\d+(?:\.\d{1,2})?$/.test(source)) return null;
  const [whole, fraction = ''] = source.split('.');
  const cents = BigInt(whole) * 100n + BigInt(fraction.padEnd(2, '0'));
  return cents <= 100000000000n ? Number(cents) : null;
}
export function normalizeExpenseInput(body, today) {
  const input = body?.expense;
  if (!expenseUuid(body?.operationId) || !input || !expenseUuid(input.supplierId) || !expenseUuid(input.classificationExpenseId)) throw new Error('invalid_expense_input');
  if (![305, 330, 320].includes(input.documentType) || typeof input.number !== 'string' || !input.number.trim() || input.number.length > 20 || /[\u0000-\u001f\u007f]/.test(input.number)) throw new Error('invalid_expense_input');
  if (!reportDate(input.date) || input.date < '2010-01-01' || input.date > today || !reportDate(input.reportingDate) || !input.reportingDate.endsWith('-01')) throw new Error('invalid_expense_input');
  const reporting = validateExpenseReporting(input, today);
  const net = expenseCents(input.net), vat = expenseCents(input.vat), gross = expenseCents(input.gross);
  if (net === null || vat === null || gross === null || gross <= 0 || net + vat !== gross) throw new Error('invalid_expense_amounts');
  // Only ordinary T expenses enter this writer. P remains an explicit acceptance gate.
  if (input.pcnClassification !== 'T') throw new Error('morning_expense_p_unverified');
  if (typeof input.description !== 'string' || input.description.length > 250 || typeof (input.allocationNumber ?? '') !== 'string' || !/^(?:\d{9})?$/.test(input.allocationNumber ?? '')) throw new Error('invalid_expense_input');
  return {supplierId:input.supplierId, classificationExpenseId:input.classificationExpenseId, documentType:input.documentType, number:input.number.trim(),
    date:input.date, reportingDate:input.reportingDate, netCents:net, vatCents:vat, grossCents:gross, pcnClassification:'T',
    description:input.description.trim(), allocationNumber:input.allocationNumber || '', ...reporting};
}
