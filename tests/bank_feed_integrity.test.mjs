import test from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {bankMorningPrefill} from '../netunim-orders/site/assets/js/domains/finance/bank-morning.js';
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
  const module = new URL('../shared/bank-feed-values.js', import.meta.url).href;
  for (const [TZ, expected] of [['UTC', '2026-10-17'], ['Asia/Jerusalem', '2026-10-18'], ['America/New_York', '2026-10-17']]) {
    const script = `import {bankDocumentDate as date} from ${JSON.stringify(module)}; console.log(JSON.stringify([date('2024-02-29'),date('2026-10-17T23:30:00Z'),date('2026-02-30T23:30:00Z')]))`;
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
