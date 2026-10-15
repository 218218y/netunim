import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parse } from 'acorn';
import { declaration, tokens } from './bank_policy_ast_fixture.mjs';
import { restoreFinanceLeaseOwnership } from './finance_lease_policy_fixture.mjs';
import {restoreOrdersBankRefresh} from './orders_bank_refresh_policy_fixture.mjs';
import {restoreCreditRefresh} from './credit_refresh_policy_fixture.mjs';
import {restoreKupaBankRefresh} from './kupa_bank_refresh_policy_fixture.mjs';
const read = (path) => {
  const source=readFileSync(new URL('../' + path, import.meta.url), 'utf8');
  if(path==='netunim-orders/site/assets/js/domains/finance/controller.js')return restoreOrdersBankRefresh(source);
  if(path==='netunim-kupa/site/assets/js/domains/bank/controller.js')return restoreKupaBankRefresh(source);
  return path==='netunim-kupa/site/assets/js/domains/credit/controller.js'?restoreCreditRefresh(source,'kupa'):source;
};
const clean = (key, value) =>
  ['start', 'end', 'loc', 'range', 'raw'].includes(key) ? undefined : value;
const ast = (value) => JSON.parse(JSON.stringify(value, clean));
const ownerPath = 'shared/finance-lease-owner.js';
const fixture = JSON.parse(read('tests/fixtures/finance-lease-preserved-policy.json'));

test('all four financial refresh callers retain their pre-change provider, freshness, merge and publication policies', () => {
  assert.equal(fixture.baseline, 'ef9391eaf3cdf9f7879433f81fe241d56b7b1b74');
  for (const [file, functions] of Object.entries(fixture.functions))
    for (const [name, original] of Object.entries(functions))
      assert.deepEqual(
        ast(declaration(restoreFinanceLeaseOwnership(read(file)), name)),
        ast(declaration(original, name)),
        name
      );
});

test('policy characterization detects actual provider/publication changes and omitted awaited cleanup', () => {
  for (const [file, functions] of Object.entries(fixture.functions)) {
    const source = read(file);
    for (const [name, original] of Object.entries(functions)) {
      const fn = declaration(source, name),
        body = source.slice(fn.start, fn.end);
      for (const [from, to] of [
        ['interactive,syncMode:requestedMode', "interactive,syncMode:'forecast'"],
        ['interactive,historyDays', 'interactive,historyDays:365'],
        ['await leaseSession?.close()', 'leaseSession?.close()'],
      ]) {
        if (!body.includes(from)) continue;
        const changed = body.replace(from, to);
        assert.notEqual(changed, body);
        assert.notDeepEqual(
          ast(declaration(restoreFinanceLeaseOwnership(changed), name)),
          ast(declaration(original, name))
        );
      }
    }
  }
});

test('the canonical owner has three ports, one command and explicit lifecycle, without provider, UI or document authority', () => {
  const source = read(ownerPath),
    tree = parse(source, { ecmaVersion: 'latest', sourceType: 'module' });
  assert.equal(declaration(source, 'createFinanceLeaseOwner').params[0].properties.length, 3);
  assert.deepEqual(
    tree.body.filter((n) => n.type === 'ImportDeclaration').map((n) => n.source.value),
    ['./finance-lease-heartbeat.js']
  );
  for (const forbidden of [
    'navigator',
    'document.',
    'localStorage',
    'fetch(',
    'saveFinance',
    'syncCredit',
    'fetchBalance',
  ])
    assert.ok(!source.includes(forbidden), forbidden);
  for (const site of ['kupa', 'orders'])
    assert.equal(read(`netunim-${site}/site/assets/js/shared/finance-lease-owner.js`), source);
  const compact = tokens(source);
  for (const proof of [
    'commands:{acquire}',
    'await Promise.allSettled([ready])',
    'await heartbeat?.stop()',
    'assertOwner();await leases.release(name,token,{assertCurrent:assertOwner})',
    'for(const record of sessions)record.stop()',
  ])
    assert.ok(compact.includes(proof), proof);
});

test('controllers retire flat claim/release and heartbeat resources; composition supplies account authority independent of disposal', () => {
  for (const file of Object.keys(fixture.functions)) {
    const source = read(file);
    assert.ok(source.includes('syncLeases.commands.acquire('));
    assert.ok(source.includes('await leaseSession?.close()'));
    const runtimeName=file.includes('/credit/')||file.includes('/finance/')?'creditRefresh':'bankRefresh';
    assert.ok(source.includes(runtimeName+'.runtime.dispose()'));
    assert.ok(source.includes(runtimeName+'.runtime.drain()'));
    for (const retired of [
      'startFinanceLeaseHeartbeat',
      'claimFinanceSyncLease',
      'releaseFinanceSyncLease',
      'heartbeats',
    ])
      assert.ok(!source.includes(retired), file + ':' + retired);
  }
  const bank = read('netunim-kupa/site/assets/js/composition/bank.js'),
    credit = read('netunim-kupa/site/assets/js/composition/credit.js'),
    orders = read('netunim-orders/site/assets/js/composition/finance.js');
  assert.ok(bank.includes('authority:authority.scope'));
  assert.ok(credit.includes('authority:authority.scope'));
  assert.ok(orders.includes('const leaseAuthority = createFinanceOperationScope({readAccess})'));
  assert.ok(orders.includes('authority:leaseAuthority'));
  // Manual document edits still use their FIFO/no-provider lease policy.
  assert.ok(orders.includes('leases:syncLeases,'));
});
