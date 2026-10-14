import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { parse } from 'acorn';
import { analyze } from 'eslint-scope';
import { creditAdapterPolicyHashes } from './credit_adapter_policy_fixture.mjs';
const folder = '../netunim-orders/site/assets/js/domains/finance/';
const read = (name) => fs.readFileSync(new URL(folder + name + '.js', import.meta.url), 'utf8');
const fixture = JSON.parse(
  fs.readFileSync(
    new URL('./fixtures/orders-finance-document-policy.json', import.meta.url),
    'utf8'
  )
);
function declaration(source, name) {
  const ast = parse(source, { ecmaVersion: 'latest', sourceType: 'module' }),
    queue = [ast];
  while (queue.length) {
    const node = queue.shift();
    if (node?.type === 'FunctionDeclaration' && node.id.name === name)
      return source.slice(node.start, node.end);
    for (const value of Object.values(node))
      if (value && typeof value === 'object') {
        if (Array.isArray(value))
          queue.push(...value.filter((item) => item && typeof item === 'object'));
        else queue.push(value);
      }
  }
  throw new Error('missing declaration ' + name);
}
const sources = () => [
  declaration(read('kupa-write-state'), 'prepareKupaWriteState'),
  declaration(read('document-commands'), 'mutateKupaCloud'),
  declaration(read('document-commands'), 'mutateFinanceCloud'),
  declaration(read('document-publication'), 'confirmCommittedReadout'),
];

test('active Finance document algorithms match the pre-extraction fixture after explicit legacy retirement', () => {
  assert.deepEqual(creditAdapterPolicyHashes(sources()).policies, fixture.policies);
});
test('frozen policy detects lost stripping, changed raw receipts, conflict identities and scope checks', () => {
  const changes = [
    ['delete out.creditSync;', '', 0, 'prepareKupaWriteState'],
    ["Object.hasOwn(result, 'j')", 'false', 1, 'mutateKupaCloud'],
    ["createOperationId('finance')", "createOperationId('different')", 2, 'mutateFinanceCloud'],
    ['assertCurrent();', '', 3, 'confirmCommittedReadout'],
  ];
  for (const [before, after, index, name] of changes) {
    const original = sources(),
      next = [...original];
    next[index] = original[index].replace(before, after);
    assert.notEqual(next[index], original[index]);
    assert.notEqual(creditAdapterPolicyHashes(next).policies[name], fixture.policies[name]);
  }
});
test('controller has no direct document-write collaborators or nonatomic Bank fallback', () => {
  const source = read('controller'),
    ast = parse(source, { ecmaVersion: 'latest', sourceType: 'module' }),
    factory = ast.body.find(
      (row) => row.declaration?.id?.name === 'createDomainsFinanceController'
    ).declaration;
  const fields = factory.params[0].properties.map((row) => row.key.name);
  assert.equal(
    fields.length,
    18,
    'local Bank and Credit ownership are explicit reviewed collaborators'
  );
  for (const name of [
    'readKupaReadOnlyCloud',
    'rpcSaveKupaDocument',
    'acceptKupaCloudRow',
    'readFinanceSyncDocument',
    'rpcSaveFinanceSync',
    'saveBankSyncSnapshot',
    'mergeBankTransactions',
    'claimFinanceSyncLease',
    'releaseFinanceSyncLease',
  ])
    assert.ok(!fields.includes(name), name);
  const bank = declaration(source, 'refreshBank');
  assert.ok(bank.includes('bankSnapshots.commands.publish'));
  assert.ok(read('bank-snapshot-publication').includes('publication.save('));
  assert.ok(!bank.includes('mutateFinanceCloud('));
  assert.ok(!bank.includes('mutateKupaCloud('));
  assert.ok(!read('document-commands').includes('typeof rpcSaveFinanceSync'));
  assert.ok(!read('document-commands').includes(fixture.retiredFinanceFallback));
});
test('document capabilities and pure Kupa write state have explicit dependency and authority budgets', () => {
  const budgets = {
    'document-commands': [
      '../../core/values.js',
      '../../shared/finance-fence.js',
      '../../shared/cloud-sync.js',
      '../../shared/finance-write-receipt.js',
      '../../shared/bank-snapshot-receipt.js',
      './kupa-write-state.js',
      './document-publication.js',
    ],
    'kupa-write-state': ['../../core/values.js', '../../shared/cashflow.js'],
    'document-publication': [],
  };
  for (const [name, imports] of Object.entries(budgets)) {
    const tree = parse(read(name), { ecmaVersion: 'latest', sourceType: 'module', ranges: true });
    assert.deepEqual(
      tree.body.filter((row) => row.type === 'ImportDeclaration').map((row) => row.source.value),
      imports
    );
    const refs = analyze(tree, { ecmaVersion: 2022, sourceType: 'module' }).globalScope.through;
    for (const ref of refs)
      assert.ok(
        ![
          'window',
          'document',
          'navigator',
          'fetch',
          'setTimeout',
          'setInterval',
          'globalThis',
          'localStorage',
        ].includes(ref.identifier.name),
        name + ' acquires ' + ref.identifier.name
      );
  }
  const tree = parse(read('document-commands'), { ecmaVersion: 'latest', sourceType: 'module' }),
    factory = tree.body.find(
      (row) => row.declaration?.id?.name === 'createOrdersFinanceDocumentCommands'
    ).declaration;
  assert.equal(factory.params[0].properties.length, 6);
});
