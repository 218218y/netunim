import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parse } from 'acorn';
import { analyze } from 'eslint-scope';
const read = (file) => readFileSync(new URL('../' + file, import.meta.url), 'utf8');
const files = [
  'netunim-kupa/site/assets/js/domains/bank/controller.js',
  'netunim-orders/site/assets/js/domains/finance/controller.js',
];
function boundary(source, name) {
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
      assert.throws(() => boundary(source.replace(from, to), name));
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
  assert.ok(read(files[0]).includes('const BANK_BRIDGE_VERSION=74'));
  assert.ok(read('netunim-orders/site/assets/js/domains/finance/bank-connection-owner.js').includes('ORDERS_BANK_BRIDGE_MINIMUM_VERSION = 74'));
  assert.ok(read(files[1]).includes('if(!bankConnections.queries.supported(status))'));
  const kupa = read(files[0]);
  assert.ok(
    kupa.indexOf('const bridgeStatus=await bridge.status()') <
      kupa.indexOf('const result=await bridge.fetchBalance(')
  );
});
