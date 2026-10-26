import test from 'node:test';
import {assertFinanceRuntimeJoined} from './finance_runtime_ownership_fixture.mjs';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parse } from 'acorn';
import { analyze } from 'eslint-scope';
import { creditAdapterPolicyHashes } from './credit_adapter_policy_fixture.mjs';
const read = (file) => readFileSync(new URL('../' + file, import.meta.url), 'utf8');
function policies(source) {
  return creditAdapterPolicyHashes([
    source.replaceAll('FINANCE_CONNECTION_IMPORT_MAX_BYTES', 'MAX_IMPORT_BYTES'),
  ]).policies;
}
test('canonical import model preserves every reviewed parsing, portable/legacy identity and summary algorithm', () => {
  const fixture = JSON.parse(
      read('tests/fixtures/finance-connection-import-preserved-policy.json')
    ),
    source = read('shared/finance-connection-import.js');
  assert.deepEqual(policies(source), fixture.policies);
  assert.notDeepEqual(
    policies(source.replace('matches.length===1', 'matches.length>=1')),
    fixture.policies,
    'ambiguous legacy identity must not be accepted'
  );
});
test('shared importer has one strict runtime, six required ports and no platform effects', () => {
  const source = read('shared/finance-connection-import-runtime.js'),
    tree = parse(source, { ecmaVersion: 'latest', sourceType: 'module', ranges: true });
  const factory = tree.body.find(
    (row) => row.declaration?.id?.name === 'createFinanceConnectionImportRuntime'
  ).declaration;
  assert.deepEqual(
    factory.params[0].properties.map((row) => row.key.name),
    ['pairing', 'transport', 'selection', 'document', 'presentation', 'protocol']
  );
  const forbidden = new Set([
    'globalThis',
    'window',
    'document',
    'navigator',
    'fetch',
    'localStorage',
    'sessionStorage',
    'Blob',
    'setTimeout',
    'setInterval',
    'console',
  ]);
  assert.deepEqual(
    analyze(tree, { ecmaVersion: 2022, sourceType: 'module' })
      .globalScope.through.filter((ref) => forbidden.has(ref.identifier.name))
      .map((ref) => ref.identifier.name),
    []
  );
  assert.ok(source.includes('// @ts-check'));
  assert.ok(source.includes('approved !== true'));
  assert.ok(source.includes('Number.isSafeInteger(version)'));
});
test('both capabilities join import lifecycle and retire the unowned callable factory/picker', () => {
  const model = read('shared/finance-connection-import.js');
  assert.ok(!model.includes('createFinanceConnectionImporter'));
  assert.ok(!model.includes('chooseFinanceConnectionImportFile'));
  assert.ok(!model.includes('document.createElement'));
  for (const file of [
    'netunim-kupa/site/assets/js/composition/bank.js',
    'netunim-orders/site/assets/js/composition/finance.js',
  ]) {
    const source = read(file);
    if (file.includes('netunim-orders')) assertFinanceRuntimeJoined(source, 'importConnections.runtime');
    else for (const method of ['runtime.isPending()', 'runtime.drain()', 'runtime.dispose()'])
      assert.ok(source.includes('importConnections.' + method), file + '/' + method);
  }
  for (const app of ['kupa', 'orders'])
    for (const file of [
      'finance-connection-import.js',
      'finance-connection-import-runtime.js',
      'finance-connection-file-selection.js',
      'finance-connection-import-capability.js',
    ])
      assert.equal(
        read(`netunim-${app}/site/assets/js/shared/${file}`).replaceAll('\r\n', '\n'),
        read('shared/' + file).replaceAll('\r\n', '\n')
      );
});
