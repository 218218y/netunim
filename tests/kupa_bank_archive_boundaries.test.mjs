import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { parse } from 'acorn';
import { analyze } from 'eslint-scope';
import { creditAdapterPolicyHashes } from './credit_adapter_policy_fixture.mjs';
const read = (file) => fs.readFileSync(new URL('../' + file, import.meta.url), 'utf8');
const folder = 'netunim-kupa/site/assets/js/domains/bank/';
const fixture = JSON.parse(read('tests/fixtures/kupa-bank-archive-preserved-policy.json'));
const snapshotSource = read(folder + 'snapshot-commands.js');
function commandDeclaration(name) {
  const ast = parse(snapshotSource, { sourceType: 'module', ecmaVersion: 'latest' }),
    factory = ast.body.find(
      (row) => row.declaration?.id?.name === 'createKupaBankSnapshotCommands'
    ).declaration;
  const node = [...ast.body.map((row) => row.declaration || row), ...factory.body.body].find(
    (row) => row.type === 'FunctionDeclaration' && row.id.name === name
  );
  assert.ok(node, name);
  return snapshotSource
    .slice(node.start, node.end)
    .replaceAll('bank.mode()', 'session.connectionMode')
    .replaceAll('checks.hasLocalWork()', 'sharedChecksHaveLocalWork()')
    .replaceAll('checks.saveCloud(', 'saveSharedChecksToCloud(')
    .replaceAll('checks.syncCloud(', 'syncSharedChecksFromCloud(');
}
function policies(source) {
  const ast = parse(source, { sourceType: 'module', ecmaVersion: 'latest' }),
    factory = ast.body.find(
      (row) => row.declaration?.id?.name === 'createDomainsBankController'
    ).declaration;
  return creditAdapterPolicyHashes(
    fixture.names
      .filter((name) => name !== 'commitBankSnapshot')
      .map((name) => {
        if (name === 'financeBankPayload' || name === 'prepareBankSnapshot')
          return commandDeclaration(name);
        const node = [...ast.body, ...factory.body.body].find(
          (row) => row.type === 'FunctionDeclaration' && row.id.name === name
        );
        assert.ok(node, name);
        return source.slice(node.start, node.end);
      })
  ).policies;
}
test('14 retained Bank/archive/Shared policies match pre-extraction algorithms across their real owners', () => {
  const { commitBankSnapshot, ...retained } = fixture.policies;
  assert.equal(typeof commitBankSnapshot, 'string');
  assert.deepEqual(policies(read(folder + 'controller.js')), retained);
});
test('preservation fixture rejects changed archive coverage', () => {
  const source = read(folder + 'controller.js');
  for (const [from, to, name] of [
    ['total!==source.length', 'false', 'assertBankArchiveCoverage'],
  ]) {
    const changed = source.replace(from, to);
    assert.notEqual(changed, source);
    assert.notEqual(policies(changed)[name], fixture.policies[name]);
  }
});
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
test('shared read batch has no platform effects and each application owns its cache', () => {
  boundary(read('shared/bank-archive-read-batch.js'), []);
  const ast = boundary(read(folder + 'archive-readout.js'), [
    '../../shared/bank-archive-read-batch.js',
  ]);
  const factory = ast.body.find(
    (row) => row.declaration?.id?.name === 'createKupaBankArchiveReadout'
  ).declaration;
  assert.equal(factory.params[0].properties.length, 6);
  boundary(read(folder + 'archive-model.js'), ['./feed.js']);
  for (const suffix of [
    "\nimport fs from 'node:fs';",
    '\nconsole.error("private");',
    '\nsetTimeout(()=>{},1);',
  ])
    assert.throws(() => boundary(read('shared/bank-archive-read-batch.js') + suffix, []));
});
test('Kupa controller delegates archive ownership and preserves local publication authority', () => {
  const source = read(folder + 'controller.js'),
    ast = parse(source, { sourceType: 'module', ecmaVersion: 'latest' });
  const factory = ast.body.find(
    (row) => row.declaration?.id?.name === 'createDomainsBankController'
  ).declaration;
  const fields = factory.params[0].properties.map((row) => row.key.name);
  assert.equal(fields.length, 18);
  assert.ok(fields.includes('archive'));
  for (const old of [
    'readBankTransactions',
    'readBankTransactionSnapshot',
    'touchBankDisplayRevision',
  ])
    assert.ok(!fields.includes(old), old);
  assert.ok(!source.includes('bankDisplayArchive'));
  assert.ok(!source.includes('cacheIsCurrent'));
  for (const call of [
    'archive.queries.readSnapshot',
    'archive.commands.invalidate',
    'archive.runtime.pause()',
    'archive.runtime.resume()',
    'snapshots.commands.publishLocal(nextBank',
  ])
    assert.ok(source.includes(call), call);
});
test('composition supplies live Kupa authority and owns archive disposal and drain', () => {
  const source = read('netunim-kupa/site/assets/js/composition/bank.js').replace(/\s+/g, '');
  for (const wire of [
    'authority:scope',
    "cloud:()=>session.connectionMode==='supabase'",
    'transactions:(...args)=>cloud.readTransactions(...args)',
    'snapshot:(...args)=>cloud.readTransactionSnapshot(...args)',
    'archive.runtime.dispose()',
    'awaitarchive.runtime.drain()',
  ])
    assert.ok(source.includes(wire), wire);
});
