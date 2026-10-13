import test from 'node:test';
import assert from 'node:assert/strict';
import {
  creditSyncScope,
  normalizeCreditSyncMode,
} from '../netunim-kupa/bank-bridge/credit-sync-scope.mjs';
import { buildCreditMonthPlan } from '../netunim-kupa/bank-bridge/credit-month-plan.mjs';

test('credit scope normalizes historical inputs, captures the date and keeps the reviewed horizons', () => {
  const now = new Date('2026-10-13T12:00:00.000Z'),
    stamp = now.getTime();
  for (const [input, mode, days, future] of [
    ['daily', 'quick', 30, 1],
    ['full', 'recovery', 130, 12],
    ['forecast', 'forecast', 30, 12],
    [undefined, 'quick', 30, 1],
    [{}, 'quick', 30, 1],
  ]) {
    const scope = creditSyncScope({ syncMode: input, now });
    assert.equal(scope.syncMode, mode);
    assert.equal(scope.futureMonths, future);
    assert.equal(scope.startDate.getTime(), stamp - days * 86400000);
    assert.equal(now.getTime(), stamp);
    assert.equal(normalizeCreditSyncMode(input), mode);
    const plan = buildCreditMonthPlan({ ...scope, now });
    assert.equal(plan.at(-1).month, future === 1 ? '2026-11' : '2027-10');
    assert.equal(plan.filter((row) => row.tier === 'forecast').length, future === 1 ? 0 : 11);
  }
});

test('month planning retains year rollover, leap dates and an inclusive one-month core', () => {
  assert.deepEqual(
    buildCreditMonthPlan({
      startDate: new Date('2024-02-29Z'),
      now: new Date('2024-12-31Z'),
      futureMonths: 1,
    }).slice(-3),
    [
      { month: '2024-11', tier: 'core' },
      { month: '2024-12', tier: 'core' },
      { month: '2025-01', tier: 'core' },
    ]
  );
});
