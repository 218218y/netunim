// Used by the disposable PostgreSQL and native IndexedDB integration suites.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {normalizeRecentTransactions} from '../netunim-kupa/bank-bridge/hapoalim-transaction-model.mjs';
import {readBankBalanceResult} from '../shared/bank-balance-result.js';
import {readBankArchiveCommand} from '../shared/bank-transaction-evidence.js';
import {verifyBankArchiveCoverage} from '../shared/bank-archive-policy.js';
import {BANK_RECURRING_DEBITS, bankRecurringDebitHistoryData} from '../shared/bank-recurring-debits.js';
import {kupaAccountCashflowData} from '../shared/kupa-cashflow.js';
import {bankTransactionDisplayIdentity} from '../shared/bank-transaction-identity.js';
import {createKupaSearchModel} from '../netunim-kupa/site/assets/js/domains/search/model.js';
import {createCloudTransport as ordersTransport} from '../netunim-orders/site/assets/js/cloud/transport.js';
import {createCloudTransport as kupaTransport} from '../netunim-kupa/site/assets/js/cloud/transport.js';
import {normalizeBankFeed as ordersFeed} from '../netunim-orders/site/assets/js/domains/finance/bank-feed.js';
import {normalizeBankFeed as kupaFeed} from '../netunim-kupa/site/assets/js/domains/bank/feed.js';

const accountKey = 'synthetic-account';
if (process.argv[2] === 'source') {
  const raw = {eventDate: '20261013', valueDate: '20261013', eventAmount: 100,
    eventActivityTypeCode: 2, referenceNumber: 123456, serialNumber: 11,
    activityDescription: BANK_RECURRING_DEBITS[2].bankLabels[0]};
  const transactions = normalizeRecentTransactions([raw, {...raw, serialNumber: 12}]);
  const fetchedAt = '2026-10-18T06:00:00Z';
  const snapshot = {balance: 500, accountId: accountKey, transactions,
    transactionCoverage: {complete: true, from: '2026-10-01', to: '2026-10-18'}};
  const decoded = readBankBalanceResult({fetchedAt, accounts: {business: snapshot}});
  const command = readBankArchiveCommand({accountKey, accountRole: 'business', snapshotAt: fetchedAt,
    transactions: decoded.business.transactions, coverage: snapshot.transactionCoverage, complete: true});
  console.log(JSON.stringify({snapshot, fetchedAt, command}));
} else if (process.argv[2] === 'verify') {
  const {source, archive, snapshot} = JSON.parse(readFileSync(0, 'utf8'));
  for (const [create, normalize] of [[ordersTransport, ordersFeed], [kupaTransport, kupaFeed]]) {
    const request = async path => {
      const body = path.includes('/bank_transactions?') ? archive
        : path.includes('/bank_transaction_snapshots?') ? [snapshot]
          : path.includes('/list_bank_morning_document_links') ? [] : null;
      assert.notEqual(body, null, path);
      return {ok: true, json: async () => structuredClone(body), text: async () => JSON.stringify(body)};
    };
    const transport = create({supaFetch: request, supaRest: request});
    const rows = await transport.readBankTransactions(accountKey, 'business', {days: null});
    const directSnapshot = await transport.readBankTransactionSnapshot(accountKey, 'business');
    assert.equal(rows.length, 2);
    assert.equal(new Set(rows.map(row => row.archiveId)).size, 2);
    assert.deepEqual(rows.map(row => row.bankSerial).sort(), ['11', '12']);
    verifyBankArchiveCoverage({sourcePayload: source.command.p_transactions, result: {total_count: 2}}, rows, {requireExactCount: true});
    let feed = normalize({accountNumber: accountKey, balance: 500, syncedAt: source.fetchedAt, transactions: rows, directSnapshot});
    for (let round = 0; round < 3; round++) {
      feed = normalize(JSON.parse(JSON.stringify(feed)));
      assert.equal(feed.transactions.length, 2);
      assert.equal(feed.directSnapshot.transactions.length, 2);
      feed.recurringDebitHistory = bankRecurringDebitHistoryData(feed, feed, 'business');
      assert.equal(feed.recurringDebitHistory.length, 2);
    }
    const state = {bank: {source: 'hapoalim', currentBalance: 500, asOfDate: '2026-10-18', feed}, checks: [], credits: [], expenses: [], cash: []};
    const flow = kupaAccountCashflowData(state, 'business', '2026-10-18', {targetDate: '2026-12-31'});
    assert.equal(flow.forecastIncomplete, true);
    assert.equal(flow.expenseRows.filter(row => row.source === 'bank_recurring').length, 0);
    const search = createKupaSearchModel({bank: {transactionIdentity: bankTransactionDisplayIdentity},
      credit: {monthlyDetail: () => ({}), itemIdentity: () => '', providerLabels: {}}, cash: {typeLabel: () => ''}});
    const entries = search.buildKupaSearchFragment(state, 'bank');
    assert.equal(entries.length, 2);
    assert.equal(new Set(entries.map(row => row.id)).size, 2);
  }
  console.log('PASS raw Bridge -> archive RPC -> SQL readback -> both transports/feeds -> reload/search/cashflow preserves two source movements');
} else throw Error('bank_identity_pipeline_mode_required');
