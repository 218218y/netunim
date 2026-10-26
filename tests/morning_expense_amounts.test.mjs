import {test} from 'node:test';
import assert from 'node:assert/strict';
import {expenseAmountChange} from '../netunim-orders/site/assets/js/core/morning-expense-amounts.js';
import {normalizeExpenseInput} from '../netunim-orders/site/assets/js/core/morning-expense-input.js';

test('gross amounts split into exact agorot for ordinary and P invoices', () => {
  assert.deepEqual(expenseAmountChange({gross:'27582.50'}, 'gross', 18), {net:'23375.00', vat:'4207.50'});
  assert.deepEqual(expenseAmountChange({gross:'1160.00'}, 'gross', 16), {net:'1000.00', vat:'160.00'});
  assert.deepEqual(expenseAmountChange({gross:'0.03'}, 'gross', 18), {net:'0.03', vat:'0.00'});
  for (const rate of [16,18]) for (const gross of ['0.01','1.00','99.99','1000000.03']) {
    const value = expenseAmountChange({gross}, 'gross', rate);
    assert.equal(Math.round((Number(value.net) + Number(value.vat)) * 100), Math.round(Number(gross) * 100));
  }
});
test('net calculates both fields; a manual VAT correction preserves net', () => {
  assert.deepEqual(expenseAmountChange({net:'1000.00'}, 'net'), {vat:'180.00', gross:'1180.00'});
  assert.deepEqual(expenseAmountChange({net:'1000.00',vat:'160.00'}, 'vat'), {gross:'1160.00'});
  for (const gross of ['', 'text', '-1', '1.001', 'Infinity']) assert.deepEqual(expenseAmountChange({gross}, 'gross'), {});
});
test('invoice receipt type 320 keeps the same supplier expense validation and later reporting', () => {
  const id = n => 'aaaaaaaa-aaaa-4aaa-aaaa-' + String(n).padStart(12,'0');
  const body={operationId:id(1),expense:{supplierId:id(2),classificationExpenseId:id(3),documentType:320,number:'R-1',date:'2026-08-20',
    reportingDate:'2026-10-01',reportingPeriod:'2026-09',net:'100',vat:'18',gross:'118',pcnClassification:'T',description:''}};
  const normalized=normalizeExpenseInput(body,'2026-10-26');
  assert.equal(normalized.documentType,320); assert.equal(normalized.reportingDate,'2026-10-01');
  body.expense.documentType=400;assert.throws(()=>normalizeExpenseInput(body,'2026-10-26'),/invalid_expense_input/);
});
