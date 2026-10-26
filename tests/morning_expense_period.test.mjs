import {test} from 'node:test';
import assert from 'node:assert/strict';
import {expenseBimonth, expenseReportingChoice, validateExpenseReporting, reportPeriod} from '../netunim-orders/site/assets/js/core/morning-report-period.js';
test('expense periods use the same bimonthly calendar as reports, including year transitions', () => {
  assert.equal(expenseBimonth('2026-10-26').key, '2026-09');
  assert.equal(expenseBimonth('2026-10-26').label, 'ספטמבר–אוקטובר 2026');
  assert.deepEqual(expenseBimonth('2026-12-31').months, ['2026-11-01', '2026-12-01']);
  assert.deepEqual(expenseBimonth('2027-01-01').months, ['2027-01-01', '2027-02-01']);
  assert.equal(reportPeriod('bimonth', 2024, 1).toDate, '2024-02-29');
});
test('September and October invoices preserve their exact source months inside the same period', () => {
  for (const month of ['09', '10']) {
    const choice = expenseReportingChoice(`2026-${month}-20`, '2026-09', '2026-10-26');
    assert.equal(choice.reportingDate, `2026-${month}-01`); assert.equal(choice.requiresConfirmation, false);
  }
  const older = expenseReportingChoice('2026-08-15', '2026-09', '2026-10-26');
  assert.equal(older.reportingDate, '2026-10-01'); assert.equal(older.requiresConfirmation, true);
});

test('automatic reporting at the start of a year cannot choose a future month', () => {
  assert.equal(expenseReportingChoice('2026-12-20','2027-01','2027-01-02').reportingDate,'2027-01-01');
  assert.equal(expenseReportingChoice('2026-08-20','2026-09','2026-09-02').reportingDate,'2026-09-01');
});
test('future, pre-invoice and mismatched periods are blocked; selecting a later period needs no extra checkbox', () => {
  for (const reportingDate of ['2037-12-01', '2026-11-01', '2026-09-01', '2026-10-02']) {
    assert.throws(() => validateExpenseReporting({date:'2026-10-20', reportingDate}, '2026-10-26'));
  }
  assert.equal(validateExpenseReporting({date:'2026-08-20', reportingDate:'2026-10-01'}, '2026-10-26').reportingPeriod, '2026-09');
  assert.equal(validateExpenseReporting({date:'2026-08-20', reportingDate:'2026-10-01', reportingPeriod:'2026-09', reportingDateConfirmed:true}, '2026-10-26').reportingPeriod, '2026-09');
  assert.throws(() => validateExpenseReporting({date:'2026-10-20', reportingDate:'2026-10-01', reportingPeriod:'2026-11'}, '2026-10-26'));
});
