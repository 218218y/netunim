import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { parse } from 'acorn';
import { analyze } from 'eslint-scope';
import { creditAdapterPolicyHashes } from './credit_adapter_policy_fixture.mjs';
import { createCloudTransport as kupaTransport } from '../netunim-kupa/site/assets/js/cloud/transport.js';
import { createCloudTransport as ordersTransport } from '../netunim-orders/site/assets/js/cloud/transport.js';
const read = (file) => fs.readFileSync(new URL('../' + file, import.meta.url), 'utf8');
const folder = 'netunim-kupa/site/assets/js/domains/bank/';
function boundary(source, imports) {
  const ast = parse(source, { sourceType: 'module', ecmaVersion: 'latest', ranges: true });
  assert.deepEqual(
    ast.body.filter((row) => row.type === 'ImportDeclaration').map((row) => row.source.value),
    imports
  );
  const forbidden = new Set([
    'globalThis',
    'window',
    'document',
    'navigator',
    'fetch',
    'setTimeout',
    'clearTimeout',
    'setInterval',
    'clearInterval',
    'console',
    'process',
    'localStorage',
    'sessionStorage',
  ]);
  const scope = analyze(ast, { sourceType: 'module', ecmaVersion: 2022 });
  assert.deepEqual(
    scope.globalScope.through
      .filter((ref) => forbidden.has(ref.identifier.name))
      .map((ref) => ref.identifier.name),
    []
  );
  return ast;
}
test('snapshot commands own six required ports and have no platform/resource effects', () => {
  const ast = boundary(read(folder + 'snapshot-commands.js'), [
    '../../shared/bank-snapshot-receipt.js',
  ]);
  const factory = ast.body.find(
    (row) => row.declaration?.id?.name === 'createKupaBankSnapshotCommands'
  ).declaration;
  assert.equal(factory.params[0].properties.length, 6);
  boundary(read(folder + 'manual-snapshot.js'), ['../../core/money.js', './feed.js']);
  for (const suffix of [
    "\nimport fs from 'node:fs';",
    '\nsetTimeout(()=>{},1);',
    '\nconsole.error("private");',
  ])
    assert.throws(() =>
      boundary(read(folder + 'snapshot-commands.js') + suffix, [
        '../../shared/bank-snapshot-receipt.js',
      ])
    );
});
test('Bank controller has snapshot/refresh APIs while the operation requires a real lease', () => {
  const source = read(folder + 'controller.js'),
    ast = parse(source, { sourceType: 'module', ecmaVersion: 'latest' });
  const factory = ast.body.find(
    (row) => row.declaration?.id?.name === 'createDomainsBankController'
  ).declaration;
  const fields = factory.params[0].properties.map((row) => row.key.name);
  assert.equal(fields.length, 13);
  for (const required of ['snapshots', 'bankRefresh'])
    assert.ok(fields.includes(required), required);
  for (const old of [
    'saveState',
    'recoverLocalState',
    'saveFinancePatch',
    'saveBankSyncSnapshot',
    'claimFinanceSyncLease',
    'releaseFinanceSyncLease',
    'mergeBankTransactions',
    'touchBankDataRevision',
  ])
    assert.ok(!fields.includes(old), old);
  assert.ok(!source.includes('acquired:true'));
  assert.ok(!source.includes('localSnapshot.save('));
  assert.ok(!source.includes('readBankSnapshotReceipt('));
  assert.ok(source.includes('bankRefresh.commands.refresh('));
  const operation=read(folder+'refresh.js').replace(/\s+/g,'');
  assert.ok(operation.includes("if(cloud.mode()==='supabase')"));
  assert.ok(operation.includes('publication.publishCloud(nextBank,archiveCandidate,requireCloudLease(lease))'));
  assert.ok(operation.includes("leases.commands.acquire('bank'"));
  const composition = read('netunim-kupa/site/assets/js/composition/bank.js').replace(/\s+/g, '');
  for (const wire of [
    'local:localSnapshot',
    'cloud:{publish:(...args)=>cloud.saveSnapshot(...args),refresh:(...args)=>cloud.refreshFinance(...args)}',
    'claim:(...args)=>cloud.claimLease(...args)',
    'release:(...args)=>cloud.releaseLease(...args)',
  ])
    assert.ok(composition.includes(wire), wire);
});
test('both application transports retire the unused raw merge export and retain one snapshot writer', () => {
  for (const factory of [kupaTransport, ordersTransport]) {
    const api = factory({
      session: {},
      supaRest: () => assert.fail('construction IO'),
      supaFetch: () => assert.fail('construction IO'),
    });
    assert.ok(!Object.hasOwn(api, 'mergeBankTransactions'));
    assert.equal(typeof api.syncBankTransactionsSnapshot, 'function');
  }
  for (const app of ['kupa', 'orders'])
    assert.ok(
      !read(`netunim-${app}/site/assets/js/cloud/transport.js`).includes('mergeBankTransactions')
    );
});
test('reviewed snapshot transports and captured archive command retain their policy bodies', () => {
  const fixture = JSON.parse(read('tests/fixtures/bank-snapshot-transports-policy.json'));
  for (const app of ['kupa', 'orders']) {
    const source = read(`netunim-${app}/site/assets/js/cloud/transport.js`),
      ast = parse(source, { sourceType: 'module', ecmaVersion: 'latest' });
    const factory = ast.body.find(
      (row) => row.declaration?.id?.name === 'createCloudTransport'
    ).declaration;
    const declarations = Object.keys(fixture.policies[app]).map((name) => {
      const node = factory.body.body.find(
        (row) => row.type === 'FunctionDeclaration' && row.id.name === name
      );
      assert.ok(node, name);
      return source.slice(node.start, node.end);
    });
    assert.deepEqual(creditAdapterPolicyHashes(declarations).policies, fixture.policies[app]);
  }
  const source = read('shared/bank-transaction-evidence.js');
  const ast = parse(source, {sourceType: 'module', ecmaVersion: 'latest'});
  const command = ast.body.find(row => row.declaration?.id?.name === 'readBankArchiveCommand').declaration;
  assert.deepEqual(creditAdapterPolicyHashes([source.slice(command.start, command.end)]).policies, fixture.command);
});
