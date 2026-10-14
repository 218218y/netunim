import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { parse } from 'acorn';
import { analyze } from 'eslint-scope';
import { creditAdapterPolicyHashes } from './credit_adapter_policy_fixture.mjs';
import {archivePolicySource} from './bank_archive_reconciliation_policy_fixture.mjs';
import {tokens} from './bank_policy_ast_fixture.mjs';
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
function policies(source,policySource=archivePolicySource()) {
  const ast = parse(source, { sourceType: 'module', ecmaVersion: 'latest' }),
    factory = ast.body.find(
      (row) => row.declaration?.id?.name === 'createDomainsBankController'
    ).declaration;
  return creditAdapterPolicyHashes(
    fixture.names
      .filter((name) => name !== 'commitBankSnapshot')
      .map((name) => {
        if(['accountIdOf','completeTransactionCoverage','canonicalJson','sameInstant','sameNumber','assertBankArchiveCoverage'].includes(name)){
          const policy=parse(policySource,{ecmaVersion:'latest',sourceType:'module'}),node=policy.body.find(row=>row.id?.name===name);assert.ok(node,name);return policySource.slice(node.start,node.end);
        }
        if (name === 'applyBridgeAccountFields') {
          const owner = read(folder + 'connection-owner.js');
          const node = parse(owner, { sourceType:'module', ecmaVersion:'latest' }).body.find(row => row.id?.name === name);
          assert.ok(node, name);
          return owner.slice(node.start, node.end);
        }
        if (name === 'financeBankPayload' || name === 'prepareBankSnapshot')
          return commandDeclaration(name);
        const node = [...ast.body, ...factory.body.body].find(
          (row) => row.type === 'FunctionDeclaration' && row.id.name === name
        );
        assert.ok(node, name);
        const body=source.slice(node.start, node.end);
        // Only the delegated device readout/financial-feedback union changed.
        // The retained archive projection, sync clocks and local notice stay
        // compared with the immutable pre-extraction AST fixture.
        return name==='bankBridgeUiState' ? body
          .replaceAll('financialFeedback','bridgeState')
          .replace('const connection=connectionState();','')
          .replace('...connection,...bridgeState,busy:bridgeState.busy||connection.busy,','...bridgeState,')
          .replace('localSnapshot:local,autoEnabled:', 'localSnapshot:local,tokenConfigured:!!bridge.getBridgeToken(),autoEnabled:') : body;
      })
  ).policies;
}
test('14 retained Bank/archive/Shared policies match pre-extraction algorithms across their real owners', () => {
  const { commitBankSnapshot, ...retained } = fixture.policies;
  assert.equal(typeof commitBankSnapshot, 'string');
  assert.deepEqual(policies(read(folder + 'controller.js')), retained);
});
test('preservation fixture rejects changed archive coverage', () => {
  const source = tokens(archivePolicySource());
  for (const [from, to, name] of [
    ['total!==source.length', 'false', 'assertBankArchiveCoverage'],
  ]) {
    const changed = source.replace(from, to);
    assert.notEqual(changed, source);
    assert.notEqual(policies(read(folder+'controller.js'),changed)[name], fixture.policies[name]);
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
  assert.equal(fields.length, 17);
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
    'archive.commands.invalidate',
    'archive.runtime.pause()',
    'archive.runtime.resume()',
    'snapshots.commands.publishLocal(nextBank',
  ])
    assert.ok(source.includes(call), call);
  assert.ok(source.includes('archiveReconciliation.commands.sync('));
});
test('composition supplies live Kupa authority and owns archive disposal and drain', () => {
  const original = read('netunim-kupa/site/assets/js/composition/bank.js');
  const source = original.replace(/\s+/g, '');
  for (const wire of [
    'authority:scope',
    "cloud:()=>session.connectionMode==='supabase'",
    'transactions:(...args)=>cloud.readTransactions(...args)',
    'snapshot:(...args)=>cloud.readTransactionSnapshot(...args)',
    'archive.runtime.dispose()',
  ])
    assert.ok(source.includes(wire), wire);
  assert.ok(awaitsArchiveDrain(original),'the archive owner must be joined by capability drain');
  assert.equal(awaitsArchiveDrain(original.replace('archive.runtime.drain()','Promise.resolve()')),false);
  assert.equal(awaitsArchiveDrain(original.replace(/await\s+Promise\.all\(/,'Promise.all(')),false);
});
function awaitsArchiveDrain(source) {
  const tree=parse(source,{ecmaVersion:'latest',sourceType:'module'});
  const factory=tree.body.find(row=>row.declaration?.id?.name==='createKupaBankCapability').declaration;
  const runtime=factory.body.body.flatMap(row=>row.declarations||[]).find(row=>row.id.name==='runtime').init;
  const drain=runtime.properties.find(row=>row.key.name==='drain').value;
  const isDrain=node=>node?.type==='CallExpression'&&node.callee?.object?.object?.name==='archive'&&node.callee.object.property?.name==='runtime'&&node.callee.property?.name==='drain';
  let joined=false;
  function walk(node){
    if(!node||typeof node!=='object')return;
    if(node.type==='AwaitExpression'){
      const value=node.argument;
      if(isDrain(value))joined=true;
      if(value?.type==='CallExpression'&&value.callee?.object?.name==='Promise'&&value.callee.property?.name==='all'&&value.arguments[0]?.type==='ArrayExpression'&&value.arguments[0].elements.some(isDrain))joined=true;
    }
    for(const value of Object.values(node)){if(Array.isArray(value))value.forEach(walk);else if(value&&typeof value==='object')walk(value);}
  }
  walk(drain.body);return joined;
}
