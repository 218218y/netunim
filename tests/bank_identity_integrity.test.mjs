import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizeRecentTransactions} from '../netunim-kupa/bank-bridge/hapoalim-transaction-model.mjs';
import {normalizeBankFeed as ordersFeed} from '../netunim-orders/site/assets/js/domains/finance/bank-feed.js';
import {normalizeBankFeed as kupaFeed, bankTransactionIdentity} from '../netunim-kupa/site/assets/js/domains/bank/feed.js';
import {bankRecurringExpensesData, bankRecurringDebitHistoryData, BANK_RECURRING_DEBITS} from '../shared/bank-recurring-debits.js';
import {readBankArchiveCommand} from '../shared/bank-transaction-evidence.js';
import {createKupaSearchModel} from '../netunim-kupa/site/assets/js/domains/search/model.js';
import {overlayBankTransactionHistory} from '../shared/bank-transaction-identity.js';

const syncedAt = '2026-10-18T06:00:00Z';
const raw = {eventDate: '20260915', valueDate: '20260915', eventAmount: 100, eventActivityTypeCode: 2,
  referenceNumber: 123456, serialNumber: 11, activityDescription: BANK_RECURRING_DEBITS[0].bankLabels[0]};
const source = () => normalizeRecentTransactions([raw, {...raw, serialNumber: 12}]);
const snapshot = transactions => ({accountNumber: 'home', syncedAt, balance: 1000, transactions,
  directSnapshot: {snapshotAt: syncedAt, coverageFrom: '2026-09-01', coverageTo: '2026-10-18', transactionCount: transactions.length, transactions}});

for (const [name, normalize] of [['orders', ordersFeed], ['kupa', kupaFeed]]) {
  test(`${name}: distinct bank serials and indistinguishable source rows survive every feed read`, () => {
    for (const transactions of [source(), normalizeRecentTransactions([raw, raw])]) {
      let feed = snapshot(transactions);
      for (let round = 0; round < 3; round++) {
        feed = normalize(JSON.parse(JSON.stringify(feed)));
        assert.equal(feed.transactions.length, 2);
        assert.equal(feed.directSnapshot.transactions.length, 2);
        assert.equal(feed.directSnapshot.transactionCount, 2);
      }
    }
  });
}

test('archive merge keys already distinguish serials and the feed preserves archive IDs and document links', () => {
  const command = readBankArchiveCommand({accountKey: 'home', accountRole: 'home', snapshotAt: syncedAt,
    transactions: source(), complete: false});
  assert.equal(new Set(command.p_transactions.map(row => row.mergeKey)).size, 2);
  const rows = command.p_transactions.map((row, index) => ({...row, id: row.mergeKey, archiveId: index + 1,
    documentLinks: [{documentId: `doc-${index}`, documentType: 320, documentAmount: 100, verifiedAt: syncedAt}]}));
  const feed = ordersFeed(snapshot(rows));
  assert.deepEqual(feed.transactions.map(row => row.archiveId), [1, 2]);
  assert.deepEqual(feed.transactions.map(row => row.documentLinks[0].documentId), ['doc-0', 'doc-1']);
});

test('search identities distinguish repeated references and repeated source occurrences', () => {
  const search = createKupaSearchModel({bank: {transactionIdentity: bankTransactionIdentity},
    credit: {monthlyDetail: () => ({}), itemIdentity: () => '', providerLabels: {}}, cash: {typeLabel: () => ''}});
  for (const transactions of [source(), normalizeRecentTransactions([raw, raw])]) {
    const rows = search.buildKupaSearchFragment({bank: {homeFeed: snapshot(transactions)}}, 'bank');
    assert.equal(rows.length, 2);
    assert.equal(new Set(rows.map(row => row.id)).size, 2);
    assert.notEqual(rows[0].id, bankTransactionIdentity(transactions[0], 'business', 0));
  }
});

test('forecast and retained history preserve multiplicity and report ambiguous source months', () => {
  for (const transactions of [source(), normalizeRecentTransactions([raw, raw])]) {
    const feed = snapshot(transactions);
    feed.recurringDebitHistory = bankRecurringDebitHistoryData(null, feed, 'home');
    assert.equal(feed.recurringDebitHistory.length, 2);
    const repeated = bankRecurringDebitHistoryData(feed, {...feed, transactions: [...transactions].reverse()}, 'home');
    assert.equal(repeated.length, 2, 'history/current overlay must not accumulate or collapse occurrences');
    const forecast = bankRecurringExpensesData({bank: {homeFeed: feed}}, 'home', '2026-10-18', '2026-12-31');
    assert.equal(forecast.rows.length, 0, 'two indistinguishable bank movements cannot seed a single estimate');
    assert.ok(forecast.warnings.some(warning => warning.kind === 'ambiguous'));
    assert.equal(forecast.incomplete, true);
  }
});

test('overlay keeps archive corrections, raw-to-archive transitions and separate archive identities', () => {
  const row = source()[0];
  const archived = {...row, archiveId: 41, id: 'serial-key'};
  const next = {...archived, date: '2026-09-16T09:00:00Z', amount: -120, memo: 'corrected'};
  assert.deepEqual(overlayBankTransactionHistory([archived], [next]), [{row: next, current: true}]);
  assert.deepEqual(overlayBankTransactionHistory([row], [archived]), [{row: archived, current: true}]);
  assert.equal(overlayBankTransactionHistory([archived], [{...archived, archiveId: 42}]).length, 2);
  const duplicates = Array.from({length: 1000}, () => ({...row}));
  assert.equal(overlayBankTransactionHistory(duplicates, [...duplicates].reverse()).length, 1000);
  const pending = {...row, bankSerial: '0'};
  const different = {...pending, amount: -200};
  const partial = overlayBankTransactionHistory([pending, different], [different]);
  assert.deepEqual(partial.map(entry => entry.row.amount), [-100, -200]);
  assert.deepEqual(partial.map(entry => entry.current), [false, true]);
});

test('historical feed reads do not silently truncate a stored bank row at the transport budget', () => {
  const transactions = Array.from({length: 20001}, (_, index) => ({...source()[0], archiveId: index + 1}));
  for (const normalize of [kupaFeed, ordersFeed]) {
    const feed = normalize(snapshot(transactions));
    assert.equal(feed.transactions.length, transactions.length);
    assert.equal(feed.directSnapshot.transactions.length, transactions.length);
  }
});
