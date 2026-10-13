import {restoreBankMoneyBoundary} from './bank_balance_policy_fixture.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { parse } from 'acorn';
import { analyze } from 'eslint-scope';
const root = new URL('../', import.meta.url),
  read = (file) => readFileSync(new URL(file, root), 'utf8').replace(/\r\n/g, '\n');
const owner = 'netunim-orders/site/assets/js/domains/finance/credit-connection-owner.js',
  controller = 'netunim-orders/site/assets/js/domains/finance/controller.js';
const ast = (file) =>
  parse(read(file), { ecmaVersion: 'latest', sourceType: 'module', ranges: true });
const factory = (tree, name) =>
  tree.body.find((row) => row.declaration?.id?.name === name).declaration;
const clean = (key, value) =>
  ['start', 'end', 'loc', 'range', 'raw'].includes(key) ? undefined : value;
const hash = (value) => createHash('sha256').update(value).digest('hex');
test('Orders connection owner has five required ports and only the canonical accepted-work primitive', () => {
  const tree = ast(owner);
  assert.equal(factory(tree, 'createOrdersCreditConnectionOwner').params[0].properties.length, 5);
  assert.deepEqual(
    tree.body.filter((row) => row.type === 'ImportDeclaration').map((row) => row.source.value),
    ['../../shared/runtime-task-owner.js']
  );
  for (const ref of analyze(tree, { ecmaVersion: 2022, sourceType: 'module' }).globalScope.through)
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
      ].includes(ref.identifier.name),
      ref.identifier.name
    );
  assert.ok(Buffer.byteLength(read(owner)) < 15000);
  const source = read(controller);
  assert.equal(
    factory(ast(controller), 'createDomainsFinanceController').params[0].properties.length,
    21
  );
  for (const name of [
    'creditStatus',
    'creditDiagnostics',
    'creditDataDiagnostics',
    'saveCreditProfile',
    'deleteCreditProfile',
    'resetCreditProfiles',
  ])
    assert.ok(!source.includes('bridge.' + name), name);
  assert.ok(!source.includes('local.creditStatus'));
  assert.ok(source.includes('assertOwner();assertConnection();heartbeat?.assertCurrent()'));
});
test('Orders Finance lifecycle joins local, financial, archive and confirmation owners', () => {
  const source = read('netunim-orders/site/assets/js/composition/finance.js');
  for (const name of ['controller', 'connections', 'archive'])
    assert.ok(source.includes(`${name}?.runtime.drain()`), name);
  assert.ok(source.includes('presentation?.view.connectionRuntime.drain()'));
  assert.ok(source.includes('presentation?.view.connectionRuntime.dispose()'));
  const view = read('netunim-orders/site/assets/js/domains/finance/credit-connection-view.js');
  assert.ok(view.includes('removeEventListener'));
  assert.ok(view.includes('saved === true && currentForm(form)'));
  assert.ok(!view.includes('resetCreditSync,updateCreditConnectionFields'));
});
test('Orders issuer/wire/publication policy, credential values and Bank workflows retain the baseline algorithms', () => {
  const fixture = JSON.parse(read('tests/fixtures/orders-credit-connection-policy.json'));
  assert.equal(fixture.baseline, '56e9620242de2679a761bdd52733d606177c0b1f');
  assert.equal(Object.keys(fixture.sha256).length, 5);
  for (const [file, expected] of Object.entries(fixture.sha256))
    assert.equal(hash(read(file)), expected, file);
  const functions = factory(parse(restoreBankMoneyBoundary(read(controller)),{ecmaVersion:'latest',sourceType:'module',ranges:true}), 'createDomainsFinanceController').body.body;
  for (const [name, expected] of Object.entries(fixture.bankBodies))
    assert.equal(
      hash(
        JSON.stringify(
          functions.find((row) => row.id?.name === name),
          clean
        )
      ),
      expected,
      name
    );
  const save = factory(
    ast('netunim-orders/site/assets/js/domains/finance/credit-connection-view.js'),
    'createCreditConnectionView'
  ).body.body.find((row) => row.id?.name === 'saveCreditConnection');
  const payload = save.body.body
    .filter((row) => row.type === 'VariableDeclaration')
    .flatMap((row) => row.declarations)
    .find((row) => row.id.name === 'payload');
  assert.equal(
    hash(JSON.stringify(payload.init, clean)),
    fixture.credentialPayload,
    'password whitespace and ID/card leading zeros are preserved'
  );
});
