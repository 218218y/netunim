import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parse } from 'acorn';
import { analyze } from 'eslint-scope';
const read = (file) => readFileSync(new URL('../' + file, import.meta.url), 'utf8');
const base = 'netunim-orders/site/assets/js/',
  owner = base + 'domains/finance/bank-connection-owner.js';
test('Orders Bank connection has five required ports, strict code and no browser/cloud/timer authority', () => {
  const source = read(owner),
    tree = parse(source, { ecmaVersion: 'latest', sourceType: 'module', ranges: true });
  const factory = tree.body.find(
    (row) => row.declaration?.id?.name === 'createOrdersBankConnectionOwner'
  ).declaration;
  assert.equal(factory.params[0].properties.length, 5);
  assert.ok(source.includes('// @ts-check'));
  assert.ok(Buffer.byteLength(source) < 15000);
  assert.deepEqual(
    tree.body.filter((row) => row.type === 'ImportDeclaration').map((row) => row.source.value),
    ['../../shared/runtime-task-owner.js', '../../shared/bridge-pairing-scope.js']
  );
  for (const reference of analyze(tree, { ecmaVersion: 2022, sourceType: 'module' }).globalScope
    .through)
    assert.ok(
      ![
        'window',
        'document',
        'navigator',
        'fetch',
        'localStorage',
        'globalThis',
        'Blob',
        'URL',
        'setTimeout',
        'setInterval',
      ].includes(reference.identifier.name),
      reference.identifier.name
    );
  const controller = read(base + 'domains/finance/controller.js');
  for (const method of [
    'status',
    'configureCredentials',
    'selectAccount',
    'deleteCredentials',
    'bankDiagnostics',
  ])
    assert.ok(!controller.includes('bridge.' + method + '('), method);
  for (const field of ['bankStatus', 'bankStatusChecked', 'bankBridgeError'])
    assert.ok(!controller.includes('local.' + field), field);
  assert.ok(!controller.includes('effects.saveJson'));
  assert.ok(!controller.includes('effects.writeText'));
  assert.ok(!source.includes('Math.max'));
});
test('Finance closes and joins Bank request and confirmation owners, and both rendering paths bind the form owner', () => {
  const composition = read(base + 'composition/finance.js');
  for (const name of ['controller', 'connections', 'bankConnections', 'archive'])
    for (const method of ['drain', 'dispose', 'isPending'])
      assert.ok(composition.includes(`${name}?.runtime.${method}()`), name + method);
  const view = read(base + 'domains/finance/view.js'),
    status = read(base + 'domains/finance/status-view.js');
  assert.ok(view.includes('bankConnectionView.bind()'));
  assert.match(view,/bindBankForm\s*:\s*bankConnectionView\.bind/);
  assert.ok(status.includes("if(section==='bank')bindBankForm()"));
  for (const name of ['creditConnectionView', 'bankConnectionView'])
    for (const method of ['drain', 'dispose', 'isPending'])
      assert.ok(view.includes(`${name}.runtime.${method}()`), name + method);
  const commands = read(base + 'domains/finance/bank-connection-commands.js');
  assert.ok(commands.includes('removeEventListener'));
  assert.ok(
    commands.indexOf('guard = controller.captureBankConnection()') <
      commands.indexOf('await confirmDialog(')
  );
  assert.ok(!view.includes('async function deleteBankCredentials'));
  assert.ok(!view.includes('...creditConnectionView'), 'the unused Credit-only runtime facade is retired');
  assert.ok(!status.includes('addEventListener'));
});
