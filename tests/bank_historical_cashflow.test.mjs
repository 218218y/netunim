import test from 'node:test';
import assert from 'node:assert/strict';
import * as shared from '../shared/kupa-cashflow.js';
import * as orders from '../netunim-orders/site/assets/js/shared/kupa-cashflow.js';
import * as kupa from '../netunim-kupa/site/assets/js/shared/kupa-cashflow.js';

const reference = '2026-10-16', now = Date.parse('2026-10-18T10:00:00Z');
function fixture(role, stamp) {
  return {
    checks: [], expenses: [],
    credits: [{ id: 'card', card: 'card', account: role, active: true,
      firstChargeDate: reference, totalAmount: 100, installments: 1 }],
    bank: { source: 'hapoalim', currentBalance: 1000, asOfDate: stamp,
      updatedAt: stamp, bankSyncAt: stamp,
      feed: { balance: 1000, syncedAt: stamp, transactions: [] },
      homeFeed: { balance: 1000, syncedAt: stamp, transactions: [] } },
  };
}

for (const role of ['עסקי', 'ביתי']) for (const stamp of [
  '2099-01-01T00:00:00Z', '2099-01-01', '2026-02-30T10:00:00Z',
  '2026-02-30', '2026-10-16T10:00:00', null,
]) test(`${role}: invalid retained Bank time cannot advance cashflow or settle credit: ${stamp}`, t => {
  t.mock.timers.enable({ apis: ['Date'], now });
  const state = fixture(role, stamp), before = structuredClone(state);
  const feed = role === 'ביתי' ? state.bank.homeFeed : state.bank.feed;
  // This debit could settle today's card only with a trustworthy observation.
  feed.transactions.push({ date: reference, amount: -100, status: 'completed', description: 'חיוב אשראי' });
  const retained = structuredClone(state);
  for (const engine of [shared, orders, kupa]) {
    assert.equal(engine.kupaAccountBankAsOfDateData(state, role, reference), reference);
    const flow = engine.kupaAccountCashflowData(state, role, reference, { targetDate: '2026-10-20' });
    assert.equal(flow.reference, reference);
    assert.equal(flow.start, reference);
    assert.equal(flow.credit, 100);
    assert.equal(flow.projected, 900);
    const rows = engine.kupaReconciledCreditRowsData(state, role, reference);
    assert.ok(rows.some(row => row.creditId === 'card' && row.bankSettlementState !== 'settled'));
  }
  assert.deepEqual(state, retained, 'retain corrupt observations and rows for diagnosis/recovery');
  assert.equal(before.bank.bankSyncAt, stamp);
});

test('a valid later observation and future business dates keep their separate meanings', t => {
  t.mock.timers.enable({ apis: ['Date'], now });
  for (const role of ['עסקי', 'ביתי']) for (const engine of [shared, orders, kupa]) {
    const state = fixture(role, '2026-10-17T10:00:00+03:00');
    assert.equal(engine.kupaAccountBankAsOfDateData(state, role, reference), '2026-10-17');
    state.bank.bankSyncAt = '2099-01-01T00:00:00Z';
    assert.equal(engine.kupaAccountBankAsOfDateData(state, role, reference), '2026-10-17');
    state.credits[0].firstChargeDate = '2026-11-15';
    const flow = engine.kupaAccountCashflowData(state, role, reference, { targetDate: '2026-11-20' });
    assert.equal(flow.credit, 100);
    assert.equal(flow.targetDate, '2026-11-20');
  }
});

test('historical date-only observations still allow proven bank settlement', t => {
  t.mock.timers.enable({ apis: ['Date'], now });
  for (const role of ['עסקי', 'ביתי']) for (const engine of [shared, orders, kupa]) {
    const state = fixture(role, reference);
    const feed = role === 'ביתי' ? state.bank.homeFeed : state.bank.feed;
    feed.transactions.push({ date: reference, amount: -100, status: 'completed', description: 'חיוב אשראי' });
    assert.equal(engine.kupaAccountCashflowData(state, role, reference).credit, 0);
  }
});

test('correcting a computer clock re-evaluates the same retained observation', t => {
  t.mock.timers.enable({ apis: ['Date'], now: Date.parse('2099-01-01T12:00:00Z') });
  const state = fixture('ביתי', '2099-01-01T10:00:00Z');
  assert.equal(shared.kupaAccountBankAsOfDateData(state, 'ביתי', reference), '2099-01-01');
  t.mock.timers.setTime(now);
  assert.equal(shared.kupaAccountBankAsOfDateData(state, 'ביתי', reference), reference);
  assert.equal(state.bank.homeFeed.syncedAt, '2099-01-01T10:00:00Z');
});
