import test from 'node:test';
import assert from 'node:assert/strict';
import { observationTimeMs, OBSERVATION_FUTURE_TOLERANCE_MS } from '../shared/observation-time.js';
import { readBankBalanceResult, readBankSnapshotResult } from '../shared/bank-balance-result.js';

const now = Date.parse('2026-10-16T10:00:00Z');
test('only legacy balance reads may omit a Bridge observation', () => {
  for (const decode of [readBankBalanceResult, readBankSnapshotResult]) {
    for (const account of [
      { balance: 0, transactions: [] },
      { balance: 0, transactions: [], transactionCoverage: { complete: true } },
      { balance: 0, transactionCoverage: { complete: false } },
    ]) for (const value of [account, { accounts: { business: account } },
      { accounts: { business: { balance: 1 }, home: account } }]) {
      const before = structuredClone(value);
      assert.throws(() => decode(value, now), { code: 'BANK_OBSERVATION_TIME_INVALID' });
      assert.deepEqual(value, before);
      assert.equal(decode({ ...value, fetchedAt: new Date(now).toISOString() }, now).source.fetchedAt,
        new Date(now).toISOString());
    }
  }
  assert.equal(readBankBalanceResult({ balance: 0 }, now).business.balance, 0);
  assert.throws(() => readBankSnapshotResult({ balance: 0 }, now), { code: 'BANK_OBSERVATION_TIME_INVALID' });
});
test('observation time accepts real zoned ISO instants within the reviewed skew', () => {
  for (const stamp of ['2026-10-16T10:00:00Z', '2026-10-16T13:00:00+03:00', '2024-02-29T10:00:00.123Z'])
    assert.equal(observationTimeMs(stamp, now), Date.parse(stamp));
  assert.equal(observationTimeMs(new Date(now + OBSERVATION_FUTURE_TOLERANCE_MS).toISOString(), now), now + OBSERVATION_FUTURE_TOLERANCE_MS);
});
test('Bank rejects supplied malformed/future clocks instead of inventing freshness', () => {
  for (const fetchedAt of [null, '', false, 0, [], {}, '2026-10-16', '2026-10-16T10:00:00', '2026-02-30T10:00:00Z', '2099-01-01T00:00:00Z', new Date(now + OBSERVATION_FUTURE_TOLERANCE_MS + 1).toISOString()]) {
    assert.equal(observationTimeMs(fetchedAt, now), null);
    assert.throws(() => readBankBalanceResult({ balance: 1, fetchedAt }, now), { code: 'BANK_OBSERVATION_TIME_INVALID' });
  }
  assert.equal(readBankBalanceResult({ balance: 1 }, now).source.fetchedAt, new Date(now).toISOString());
});
