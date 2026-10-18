import test from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {isoFromBankDate} from '../netunim-kupa/bank-bridge/hapoalim-date-codec.mjs';
import {normalizeHapoalimTransaction, normalizeRecentTransactions, hapoalimTransactionPageState} from '../netunim-kupa/bank-bridge/hapoalim-transaction-model.mjs';
import {bankTransactionCoverage} from '../shared/bank-archive-policy.js';
import {bankRecurringDebitHistoryData, BANK_RECURRING_DEBITS} from '../shared/bank-recurring-debits.js';
import {readerFixture} from './bank_reader_fixture.mjs';
import {mergeHapoalimAdditionalDetails, normalizeHapoalimAdditionalDetails} from '../netunim-kupa/bank-bridge/hapoalim-additional-details-model.mjs';

const raw = {eventDate: '20261013', valueDate: '20261013', eventAmount: 100,
  eventActivityTypeCode: 2, referenceNumber: 123456, serialNumber: 11, activityDescription: 'transfer'};

test('the raw Bank date decoder rejects impossible days before Date can roll them forward', () => {
  for (const value of ['20260230', '20261301', '20260431', '20260229', '19000229', '20260010', '20261000']) {
    assert.equal(isoFromBankDate(value), null, value);
    assert.throws(() => normalizeHapoalimTransaction({...raw, eventDate: value}), {code: 'BANK_TRANSACTIONS_INVALID'});
    assert.throws(() => normalizeHapoalimTransaction({...raw, valueDate: value}), {code: 'BANK_TRANSACTIONS_INVALID'});
  }
});

test('raw money distinguishes missing/invalid input from real zero and numeric strings', () => {
  for (const eventAmount of [null, undefined, '', ' ', false, true, [], [100], {}, Infinity, 'invalid']) {
    assert.throws(() => normalizeHapoalimTransaction({...raw, eventAmount}), {code: 'BANK_TRANSACTIONS_INVALID'}, String(eventAmount));
    assert.throws(() => normalizeRecentTransactions([raw, {...raw, eventAmount}]), {code: 'BANK_TRANSACTIONS_INVALID'});
  }
  for (const eventAmount of [0, '0', '100.50']) {
    const row = normalizeHapoalimTransaction({...raw, eventAmount});
    assert.equal(row.amount, eventAmount === '100.50' ? -100.5 : 0);
  }
});

test('raw direction, status and date syntax cannot invent completed credit evidence', () => {
  for (const eventActivityTypeCode of [undefined, null, false, true, '', ' ', [], 0, 3, 'bad']) {
    assert.throws(() => normalizeHapoalimTransaction({...raw, eventActivityTypeCode}), {code: 'BANK_TRANSACTIONS_INVALID'});
  }
  for (const serialNumber of [undefined, null, false, true, '', ' ', [], -1, 1.5, 'bad']) {
    assert.throws(() => normalizeHapoalimTransaction({...raw, serialNumber}), {code: 'BANK_TRANSACTIONS_INVALID'});
  }
  for (const value of ['prefix20261013', '202610130', '2026/10/13', [], {}, true]) assert.equal(isoFromBankDate(value), null);
  assert.equal(normalizeHapoalimTransaction({...raw, serialNumber: '0', eventActivityTypeCode: '1'}).status, 'pending');
  assert.equal(normalizeHapoalimTransaction({...raw, eventDate: '2026-10-13'}).amount, -100);
});

test('valid leap days retain the existing local-noon timezone policy', () => {
  const module = new URL('../netunim-kupa/bank-bridge/hapoalim-date-codec.mjs', import.meta.url).href;
  for (const TZ of ['UTC', 'Asia/Jerusalem', 'America/New_York']) {
    const script = `import {isoFromBankDate} from ${JSON.stringify(module)};
      console.log(JSON.stringify(['20000229','20240229','20261013'].map(value => {
        const date = new Date(isoFromBankDate(value));
        return [date.getFullYear(), date.getMonth()+1, date.getDate(), date.getHours()];
      })));`;
    const result = execFileSync(process.execPath, ['--input-type=module', '-e', script], {encoding: 'utf8', env: {...process.env, TZ}});
    assert.deepEqual(JSON.parse(result), [[2000,2,29,12], [2024,2,29,12], [2026,10,13,12]]);
  }
});

test('invalid coverage never grants absence authority to recurring history', () => {
  const description = BANK_RECURRING_DEBITS.find(rule => rule.account === BANK_RECURRING_DEBITS[0].account).bankLabels[0];
  const previous = {accountNumber: 'home', transactions: [{id: 'kept', date: '2026-03-05', description, amount: -100}]};
  const next = {accountNumber: 'home', transactions: []};
  for (const [from, to] of [['2026-02-30','2026-03-15'], ['2026-03-01','2026-04-31'], ['2026-03-15','2026-03-01']]) {
    const coverage = bankTransactionCoverage({transactionCoverage: {complete: true, from, to}});
    assert.equal(coverage.complete, false);
    assert.equal(coverage.from, null);
    assert.equal(bankRecurringDebitHistoryData(previous, next, 'home', coverage)[0].presenceState, undefined);
    assert.equal(bankRecurringDebitHistoryData(previous, next, 'home', {complete: true, from, to})[0].presenceState, undefined);
  }
  const valid = bankTransactionCoverage({transactionCoverage: {complete: true, from: '2026-03-01', to: '2026-03-15'}});
  assert.equal(valid.complete, true);
  assert.equal(bankRecurringDebitHistoryData(previous, next, 'home', valid)[0].presenceState, 'missing');
  for (const snapshot of [{transactionCoverage: {...valid, warning: 'partial'}},
    {transactionCoverage: valid, transactionWarning: 'partial'}]) {
    const coverage = bankTransactionCoverage(snapshot);
    assert.equal(coverage.complete, false);
    assert.equal(bankRecurringDebitHistoryData(previous, next, 'home', coverage)[0].presenceState, undefined);
  }
});

test('actual account reads retain balance and diagnose invalid source rows without complete history', async () => {
  for (const bad of [{eventAmount: null}, {eventDate: '20260230'}, {valueDate: '20260431'}]) {
    const f = readerFixture({respond: async url => url.pathname.endsWith('balanceAndCreditLimit')
      ? {currentBalance: 42} : {transactions: [raw, {...raw, ...bad}]}});
    const result = await f.api.read(f.page, {businessBranchNumber: '345', businessAccountNumber: '678901'}, f.ready, 1, {diagnosticRun: f.run});
    assert.equal(result.balance, 42);
    assert.equal(result.transactionCoverage.complete, false);
    assert.ok(result.transactionWarning);
    assert.deepEqual(result.transactions, []);
  }
});

test('a missing, malformed or sparse transaction page cannot masquerade as complete empty history', async () => {
  for (const payload of [null, {}, {transactions: null}, {transactions: {}}, {transactions: false}]) {
    assert.throws(() => hapoalimTransactionPageState(payload), {code: 'BANK_TRANSACTIONS_INVALID'});
    const f = readerFixture({respond: async url => url.pathname.endsWith('balanceAndCreditLimit') ? {currentBalance: 42} : payload});
    const result = await f.api.read(f.page, {businessBranchNumber: '345', businessAccountNumber: '678901'}, f.ready, 1);
    assert.equal(result.transactionCoverage.complete, false);
    assert.ok(result.transactionWarning);
  }
  assert.throws(() => normalizeRecentTransactions(Array(1)), {code: 'BANK_TRANSACTIONS_INVALID'});
  assert.equal(hapoalimTransactionPageState({transactions: []}).isFull, false);
});

test('expanded cheque money and document flags cannot gain authority through coercion', () => {
  for (const amount of [true, false, [100], [], {}, null, ' ']) {
    const item = {bankNumber: '12', branchNumber: '1', accountNumber: '123', checkNumber: '99', amount};
    const details = mergeHapoalimAdditionalDetails({checkItems: [item], hasDocumentReference: 'false'});
    assert.equal(details.checkItems.length, 0);
    assert.equal(details.hasDocumentReference, false);
    const normalized = normalizeHapoalimAdditionalDetails({list: [{bank: 12, branch: 1, account: 123, number: 99, amount}]});
    assert.equal(normalized.checkItems.length, 0);
  }
});
