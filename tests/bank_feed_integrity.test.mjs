import test from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {bankMorningEligibility, bankMorningPrefill} from '../netunim-orders/site/assets/js/domains/finance/bank-morning.js';
import {normalizeBankFeed as ordersFeed, normalizeBankFeedTransaction as ordersRow} from '../netunim-orders/site/assets/js/domains/finance/bank-feed.js';
import {normalizeBankFeed as kupaFeed, normalizeBankFeedTransaction as kupaRow} from '../netunim-kupa/site/assets/js/domains/bank/feed.js';

const transaction = {archiveId: 1, amount: 20, date: '2026-10-18', processedDate: null};
for (const date of ['2026-02-30', '2026-13-99', '2026-04-31', '2026-02-29', '1900-02-29', '2026-02-30T00:00:00Z']) {
  test(`impossible business date rejects without rolling forward: ${date}`, () => {
    for (const normalize of [ordersRow, kupaRow]) assert.equal(normalize({date}).date, null);
    assert.throws(() => bankMorningPrefill({...transaction, date}), /bank_morning_invalid_date/);
    assert.throws(() => bankMorningPrefill({...transaction, processedDate: date}), /bank_morning_invalid_date/);
  });
}
test('valid leap days and the processing-date precedence are preserved', () => {
  for (const date of ['2000-02-29', '2024-02-29', '2026-10-18']) {
    assert.equal(bankMorningPrefill({...transaction, date}).date, date);
    for (const normalize of [ordersRow, kupaRow]) assert.equal(normalize({date}).date, `${date}T00:00:00.000Z`);
  }
  assert.equal(bankMorningPrefill({...transaction, processedDate: '2026-10-17'}).date, '2026-10-17');
});
test('date-only days stay fixed across time zones and timestamps use the existing local day', () => {
  const module = new URL('../shared/observation-time.js', import.meta.url).href;
  for (const [TZ, expected] of [['UTC', '2026-10-17'], ['Asia/Jerusalem', '2026-10-18'], ['America/New_York', '2026-10-17']]) {
    const script = `import {localCalendarDate as date} from ${JSON.stringify(module)}; console.log(JSON.stringify([date('2024-02-29'),date('2026-10-17T23:30:00Z'),date('2026-02-30T23:30:00Z')]))`;
    const output = execFileSync(process.execPath, ['--input-type=module', '-e', script], {env: {...process.env, TZ}, encoding: 'utf8'});
    assert.deepEqual(JSON.parse(output), ['2024-02-29', expected, '']);
  }
});
test('missing or malformed historical money stays unknown; actual zero stays known', () => {
  for (const normalize of [ordersRow, kupaRow]) {
    for (const amount of [null, undefined, '', ' ', 'invalid', false, true, [], {}, Infinity]) {
      const row = normalize({...transaction, amount});
      assert.equal(row.amount, null, String(amount));
      assert.throws(() => bankMorningPrefill(row), /bank_morning_invalid_amount/);
    }
    assert.equal(normalize({...transaction, amount: 0}).amount, 0);
    assert.equal(normalize({...transaction, amount: '20.50'}).amount, 20.5);
  }
});
test('direct Morning entry cannot coerce booleans, arrays or objects into a receipt amount', () => {
  for (const amount of [null, undefined, '', 'invalid', true, false, [], [20], {}, {valueOf: () => 20}]) {
    const row = {...transaction, amount};
    assert.equal(bankMorningEligibility(row).code, 'not-credit');
    assert.throws(() => bankMorningPrefill(row), /bank_morning_invalid_amount/);
  }
  assert.equal(bankMorningPrefill({...transaction, amount: '20.50'}).amount, 20.5);
});
test('invalid balances and calendar coverage cannot create a usable feed or snapshot', () => {
  for (const normalize of [ordersFeed, kupaFeed]) {
    for (const balance of [null, undefined, '', true, {}]) assert.equal(normalize({balance, syncedAt: '2026-10-18T00:00:00Z'}), null);
    const feed = normalize({balance: 0, syncedAt: '2026-10-18T00:00:00Z', directSnapshot: {
      snapshotAt: '2026-10-18T00:00:00Z', coverageFrom: '2026-02-30', coverageTo: '2026-10-18', transactions: [],
    }});
    assert.equal(feed.balance, 0);
    assert.equal(feed.directSnapshot, null);
  }
});

test('all optional feed money remains unknown on coercible input and snapshot counts are checked', () => {
  for (const normalize of [ordersFeed, kupaFeed]) {
    for (const value of [true, false, [], {}, ' ', null]) {
      const feed = normalize({balance: 0, syncedAt: '2026-10-18', availableBalance: value,
        creditLimit: value, creditLimitUsed: value, creditLimitUsedPercent: value,
        transactions: [{balanceAfter: value}]});
      for (const field of ['availableBalance','creditLimit','creditLimitUsed','creditLimitUsedPercent']) assert.equal(feed[field], null);
      assert.equal(feed.transactions[0].balanceAfter, null);
    }
    const base = {balance: 0, syncedAt: '2026-10-18', directSnapshot: {
      snapshotAt: '2026-10-18', coverageFrom: '2026-10-01', coverageTo: '2026-10-18', transactions: [{id: 'one'}], transactionCount: 2}};
    assert.equal(normalize(base).directSnapshot, null);
    base.directSnapshot.transactionCount = 1;
    assert.equal(normalize(base).directSnapshot.transactions.length, 1);
    base.directSnapshot.coverageFrom = '2026-10-19';
    assert.equal(normalize(base).directSnapshot, null);
  }
});

test('historical archive IDs and Morning amounts cannot be forged by coercible values', () => {
  for (const value of [true, [1], {}, ' ']) {
    for (const normalize of [ordersRow, kupaRow]) assert.equal(normalize({archiveId: value}).archiveId, null);
    const row = ordersRow({documentLinks: [{documentId: 'D', documentType: 320, documentAmount: value, verifiedAt: '2026-10-18'}]});
    assert.equal(row.documentLinks.length, 0);
  }
  assert.equal(ordersRow({archiveId: '42'}).archiveId, 42);
});
