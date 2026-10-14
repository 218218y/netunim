import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parse } from 'acorn';
import { analyze } from 'eslint-scope';
import {restoreOrdersBankPublication} from './orders_bank_publication_policy_fixture.mjs';
import {restoreKupaReconciliation} from './bank_archive_reconciliation_policy_fixture.mjs';
const read = (file) => readFileSync(new URL('../' + file, import.meta.url), 'utf8');
const files = [
  'netunim-kupa/site/assets/js/domains/bank/controller.js',
  'netunim-orders/site/assets/js/domains/finance/controller.js',
];
function boundary(source, name, overrides) {
  if(name==='createDomainsFinanceController')source=restoreOrdersBankPublication(source,overrides);
  else source=restoreKupaReconciliation(source);
  const tree = parse(source, { ecmaVersion: 'latest', sourceType: 'module' }),
    factory = tree.body.find((row) => row.declaration?.id?.name === name).declaration;
  const command = factory.body.body.find(
    (row) =>
      row.id?.name ===
      (name === 'createDomainsBankController' ? 'refreshBankBalance' : 'refreshBank')
  );
  const body = source.slice(command.start, command.end),
    received = body.indexOf('await bridge.fetchBalance('),
    validated = body.indexOf('readBankBalanceResult(result)'),
    archive = body.indexOf('await syncBankTransactionsSnapshot(');
  assert.ok(received >= 0 && validated > received && archive > validated);
  assert.ok(
    /\);assertCurrent\(\);/.test(body.slice(received, validated)),
    'owner guard precedes decode'
  );
  assert.ok(body.includes('...bankSnapshotFinancials(business)'));
  for (const field of [
    'balance',
    'availableBalance',
    'creditLimit',
    'creditLimitUsed',
    'creditLimitUsedPercent',
  ])
    assert.ok(!body.includes('Number(business.' + field + ')'), field);
}
test('both actual Bank publication callers use the validated scalar boundary before archives/writes', () => {
  for (let index = 0; index < files.length; index++) {
    const source = read(files[index]),
      name = index === 0 ? 'createDomainsBankController' : 'createDomainsFinanceController';
    boundary(source, name);
    for (const [from, to] of [
      ['readBankBalanceResult(result)', '{business:result,home:null,homeFailure:null}'],
      ['...bankSnapshotFinancials(business)', 'availableBalance:Number(business.availableBalance)'],
    ])
      if(index===0)assert.throws(() => boundary(source.replace(from, to), name));
      else {
        const file=from==='readBankBalanceResult(result)'?'bank-snapshot-publication':'bank-snapshot-policy';
        const actual=read('netunim-orders/site/assets/js/domains/finance/'+file+'.js');
        const pattern=from==='...bankSnapshotFinancials(business)'?/\.\.\.bankSnapshotFinancials\(business\)/g:from;
        const changed=actual.replace(pattern,to);assert.notEqual(changed,actual);
        assert.throws(()=>boundary(source,name,{[file==='bank-snapshot-policy'?'model':'owner']:changed}));
      }
  }
});
test('financial result/evidence is a pure strict boundary and canonical generated copies match', () => {
  const source = read('shared/bank-balance-result.js'),
    tree = parse(source, { ecmaVersion: 'latest', sourceType: 'module', ranges: true });
  assert.deepEqual(
    tree.body.filter((row) => row.type === 'ImportDeclaration').map((row) => row.source.value),
    ['./bank-money-value.js']
  );
  assert.ok(source.includes('// @ts-check'));
  for (const ref of analyze(tree, { ecmaVersion: 2022, sourceType: 'module' }).globalScope.through)
    assert.ok(
      ![
        'window',
        'document',
        'fetch',
        'navigator',
        'localStorage',
        'setTimeout',
        'setInterval',
        'console',
        'globalThis',
      ].includes(ref.identifier.name),
      ref.identifier.name
    );
  for (const app of ['kupa', 'orders'])
    assert.equal(
      read(`netunim-${app}/site/assets/js/shared/bank-balance-result.js`).replace(/\r\n/g, '\n'),
      source.replace(/\r\n/g, '\n')
    );
});

test('Hapoalim account reader consumes canonical financial evidence and installer stages the exact generated helper', () => {
  const source = read('netunim-kupa/bank-bridge/hapoalim-accounts.mjs');
  for (const field of [
    'currentBalance',
    'withdrawalBalance',
    'creditLimitAmount',
    'creditLimitUtilizationAmount',
    'creditLimitUtilizationPercent',
  ])
    assert.ok(source.includes('readBankMoney(balanceData?.' + field + ')'), field);
  assert.ok(source.includes('if (balance === null)'));
  assert.ok(source.indexOf('if (balance === null)') < source.indexOf('const end = clock.date()'));
  assert.equal(
    read('netunim-kupa/bank-bridge/bank-money-value.mjs').replace(/\r\n/g, '\n'),
    read('shared/bank-money-value.js').replace(/\r\n/g, '\n')
  );
  assert.ok(
    read('netunim-kupa/bank-bridge/install_bank_bridge.bat').includes(
      'server.mjs bank-money-value.mjs'
    )
  );
  assert.ok(read('netunim-kupa/bank-bridge/server.mjs').includes('const BRIDGE_VERSION=74'));
  assert.ok(read('netunim-kupa/site/assets/js/domains/bank/connection-owner.js').includes('KUPA_BANK_BRIDGE_MINIMUM_VERSION = 74'));
  assert.ok(read(files[0]).includes('if(!connections.queries.supported(bridgeStatus))'));
  assert.ok(read('netunim-orders/site/assets/js/domains/finance/bank-connection-owner.js').includes('ORDERS_BANK_BRIDGE_MINIMUM_VERSION = 74'));
  assert.ok(read('netunim-orders/site/assets/js/domains/finance/bank-refresh.js').replace(/\s+/g,'').includes('if(!device.supported(status))'));
  const kupa = read(files[0]);
  assert.ok(
    kupa.indexOf('const bridgeStatus=await connections.queries.readStatus()') >= 0 &&
    kupa.indexOf('const bridgeStatus=await connections.queries.readStatus()') <
      kupa.indexOf('const result=await bridge.fetchBalance(')
  );
});
