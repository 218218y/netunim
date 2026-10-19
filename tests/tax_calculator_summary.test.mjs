import test from 'node:test';
import assert from 'node:assert/strict';
import { createAnnual, createProfile, assertAnnual, same } from '../shared/tax-calculator/contracts.js';
import { defaultRules } from '../shared/tax-calculator/rules.js';
import { calculateTax } from '../shared/tax-calculator/compute.js';
import { summaryMarkup, inputMarkup, insuranceSettlementMarkup } from '../shared/tax-calculator/view.js';

const input = (patch = {}) => ({ ...createAnnual(2026, createProfile(), defaultRules()),
  revenue: 18000000, arnonaAnnual: 600000, ...patch });

test('net reconciles business profit, rental income and each deduction without changing turnover', () => {
  const i = input({ rentMonthly: 350000, rentExpenses: 120000, expensesMonthly: 100000 });
  const r = calculateTax(i), a = r.annual;
  assert.equal(a.revenue, 18000000);
  assert.equal(i.revenue, 18000000);
  assert.equal(a.net, a.revenue - a.expenses + a.rent - a.rentExpenses
    - a.insurance - a.pension - a.incomeTax - a.arnona);
  assert.equal(calculateTax({ ...i, householdOtherMonthly: 500000, otherResidentsMonthly: 400000 }).annual.net, a.net);
  const html = summaryMarkup(r);
  assert.match(html, /מחזור העסק ללא מע״מ/);
  assert.match(html, /נטו משוער כולל עסק ושכירות/);
  assert.match(html, /שכירות לאחר הוצאות/);
  assert.ok(html.indexOf('צפי מס הכנסה') < html.indexOf('פירוט חודשי ושנתי'));
  for (const label of ['צפי הפקדה לפנסיה', 'הפרשי מקדמות', 'צפי מע״מ', 'תחזית הנחת ארנונה'])
    assert.ok(html.indexOf(label) < html.indexOf('פירוט חודשי ושנתי'), label);
});

test('advances compare twelve months against both NI and health, without changing tax or net', () => {
  const i = input(), original = calculateTax(i);
  const due = calculateTax({ ...i, insuranceAdvanceMonthly: 100000 });
  assert.equal(due.insuranceSettlement.advancesAnnual, 1200000);
  assert.equal(due.insuranceSettlement.balance, original.annual.national + original.annual.health - 1200000);
  assert.equal(due.insuranceSettlement.status, 'due');
  assert.equal(due.insuranceSettlement.refund, 0);
  assert.deepEqual(due.annual, original.annual, 'prepayments are a settlement, not another expense or tax deduction');
  const refund = calculateTax({ ...i, insuranceAdvanceMonthly: 500000 });
  assert.equal(refund.insuranceSettlement.refund, 6000000 - original.annual.insurance);
  assert.equal(refund.insuranceSettlement.additionalDue, 0);
  assert.equal(refund.insuranceSettlement.status, 'refund');
  assert.match(insuranceSettlementMarkup(refund), /החזר משוער/);
  assert.match(insuranceSettlementMarkup(due), /תוספת משוערת לתשלום/);
});

test('unknown advance is distinct from zero; missing income does not fabricate a refund', () => {
  const i = input();
  assert.equal(calculateTax(i).insuranceSettlement.status, 'not-entered');
  assert.equal(calculateTax(i).insuranceSettlement.balance, null);
  assert.equal(calculateTax({ ...i, insuranceAdvanceMonthly: 0 }).insuranceSettlement.additionalDue,
    calculateTax(i).annual.insurance);
  const missing = calculateTax({ ...i, revenue: null, insuranceAdvanceMonthly: 200000 });
  assert.equal(missing.insuranceSettlement.status, 'missing-income');
  assert.equal(missing.insuranceSettlement.balance, null);
  assert.equal(missing.insuranceSettlement.refund, null);
  assert.equal(calculateTax({ ...i, activeSelfEmployed: false, insuranceAdvanceMonthly: 0 }).insuranceSettlement.status, 'balanced');
});

test('business expenses, VAT and period affect insurance liability; advances remain independent', () => {
  const i = input({ revenue: 21240000, vatIncluded: true, insuranceAdvanceMonthly: 120000 });
  const a = calculateTax(i);
  const monthly = calculateTax({ ...i, revenue: 1770000, revenuePeriod: 'monthly' });
  assert.deepEqual(a.insuranceSettlement, monthly.insuranceSettlement);
  assert.ok(calculateTax({ ...i, expensesMonthly: 200000 }).insuranceSettlement.liability < a.insuranceSettlement.liability);
  const loss = calculateTax({ ...i, revenue: 0, expensesMonthly: 100000 });
  assert.ok(loss.insuranceSettlement.liability > 0, 'active self employed minimum remains applicable');
});

test('optional advance does not rewrite existing documents or immutable operation receipts', () => {
  const old = input(); delete old.insuranceAdvanceMonthly;
  assert.ok(same(assertAnnual(old), old));
  assert.equal(Object.hasOwn(assertAnnual(old), 'insuranceAdvanceMonthly'), false);
  assert.equal(calculateTax(old).insuranceSettlement.status, 'not-entered');
  for (const bad of [-1, 1.5, undefined, '1000', Number.NaN, 1000000000001])
    assert.throws(() => assertAnnual({ ...old, insuranceAdvanceMonthly: bad }));
  assert.throws(() => assertAnnual({ ...old, arbitraryAdvance: 100 }));
  const next = createAnnual(2027, old.profile, defaultRules(2027));
  assert.equal(next.insuranceAdvanceMonthly, null);
  assert.match(inputMarkup('tax', old, calculateTax(old)), /data-field="insuranceAdvanceMonthly"/);
  assert.doesNotMatch(inputMarkup('tax', old, calculateTax(old)), /NaN/);
});

test('pension remaining compares actual deposits against the minimum, preserving unknown deposits', () => {
  const i = input(), required = calculateTax(i).annual.pensionMinimum;
  assert.equal(calculateTax(i).pensionFunding.actual, null);
  assert.equal(calculateTax(i).pensionFunding.remaining, required);
  assert.equal(calculateTax({ ...i, pensionActual: 0 }).pensionFunding.remaining, required);
  assert.equal(calculateTax({ ...i, pensionActual: required + 100 }).pensionFunding.remaining, 0);
});
