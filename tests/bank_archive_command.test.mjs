import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {readBankArchiveCommand} from '../shared/bank-transaction-evidence.js';
import {createCloudTransport as ordersTransport} from '../netunim-orders/site/assets/js/cloud/transport.js';
import {createCloudTransport as kupaTransport} from '../netunim-kupa/site/assets/js/cloud/transport.js';

const at = '2026-10-18T06:00:00Z';
const row = {id: 'T', date: at, amount: 20, currency: 'ILS', status: 'completed'};
const command = {accountKey: 'A', accountRole: 'business', transactions: [row], snapshotAt: at,
  complete: true, coverage: {complete: true, from: '2026-10-01', to: '2026-10-18'}};

for (const [name, create] of [['orders', ordersTransport], ['kupa', kupaTransport]]) {
  test(`${name}: malformed snapshot authority rejects before any request`, async () => {
    let requests = 0;
    const request = async () => {requests++; throw Error('must not send');};
    const transport = create({session: {cloudDocumentName: 'main'}, supaRest: request, supaFetch: request});
    for (const patch of [
      {snapshotAt: '2026-02-30T00:00:00Z'}, {snapshotAt: '2026-10-18'}, {snapshotAt: true},
      {accountKey: ''}, {accountRole: 'unexpected'}, {accountRole: {toString: () => 'business'}},
      {complete: 'true'}, {coverage: {complete: 'true'}}, {coverage: {complete: true, warning: false}},
      {coverage: {complete: true, from: '2026-02-30', to: '2026-10-18'}},
      {coverage: {complete: true, from: '2026-10-18', to: '2026-10-01'}},
      {transactions: [{...row, amount: null}]}, {transactions: [{...row, status: 'garbage'}]},
    ]) {
      const value = {...command, ...patch};
      await assert.rejects(() => transport.syncBankTransactionsSnapshot(value.accountKey, value.accountRole, value.transactions, value),
        {code: 'BANK_TRANSACTIONS_INVALID'});
    }
    assert.equal(requests, 0);
  });
  test(`${name}: stale account and unproven reply cannot yield archive success`, async () => {
    let current = true;
    const request = async () => ({ok: true, text: async () => {current = false; return '[]';}});
    const transport = create({session: {cloudDocumentName: 'main'}, supaRest: request, supaFetch: request});
    const assertCurrent = () => {if (!current) throw Error('account_changed');};
    await assert.rejects(() => transport.syncBankTransactionsSnapshot('A', 'business', [row], {...command, lease: {assertCurrent}}), /account_changed/);
    await assert.rejects(() => transport.syncBankTransactionsSnapshot('A', 'business', [row], command), {code: 'BANK_RESPONSE_EVIDENCE_INVALID'});
  });
}
test('accepted command is detached and immutable; warnings never acquire absence authority', () => {
  const raw = structuredClone(command);
  const accepted = readBankArchiveCommand(raw);
  raw.transactions[0].amount = 999;
  raw.coverage.from = '1900-01-01';
  assert.equal(accepted.p_transactions[0].amount, 20);
  assert.equal(accepted.p_coverage_from, '2026-10-01');
  assert.throws(() => {accepted.p_transactions[0].amount = 999;}, TypeError);
  assert.throws(() => accepted.p_transactions.pop(), TypeError);
  assert.throws(() => {accepted.p_complete = false;}, TypeError);
  const partial = readBankArchiveCommand({...command, coverage: {...command.coverage, warning: 'provider failed'}});
  assert.equal(partial.p_complete, false);
  assert.equal(partial.p_coverage_from, null);
  assert.equal(partial.p_coverage_to, null);
});
test('removing the real timestamp guard restores calendar rollover authority', async () => {
  const file = new URL('../shared/bank-transaction-evidence.js', import.meta.url);
  let source = readFileSync(file, 'utf8');
  const guard = '!timestamp(value.snapshotAt)';
  assert.equal(source.split(guard).length, 2);
  source = source.replace(guard, 'false').replace(/(['"])\.\/([^'"]+)\1/g, (_, quote, path) => JSON.stringify(new URL(path, file).href));
  const mutant = await import('data:text/javascript;base64,' + Buffer.from(source).toString('base64'));
  const raw = {...command, snapshotAt: '2026-02-30T00:00:00Z'};
  assert.throws(() => readBankArchiveCommand(raw), {code: 'BANK_TRANSACTIONS_INVALID'});
  assert.equal(mutant.readBankArchiveCommand(raw).p_snapshot_at, '2026-03-02T00:00:00.000Z');
});
