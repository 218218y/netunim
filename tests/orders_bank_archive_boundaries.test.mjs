import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { parse } from 'acorn';
import { analyze } from 'eslint-scope';

const read = (name) =>
  fs.readFileSync(
    new URL('../netunim-orders/site/assets/js/domains/finance/' + name + '.js', import.meta.url),
    'utf8'
  );
function boundary(source, imports) {
  const ast = parse(source, { ecmaVersion: 'latest', sourceType: 'module', ranges: true });
  assert.deepEqual(
    ast.body.filter((row) => row.type === 'ImportDeclaration').map((row) => row.source.value),
    imports
  );
  const forbidden = new Set([
    'window',
    'document',
    'navigator',
    'fetch',
    'setTimeout',
    'clearTimeout',
    'setInterval',
    'clearInterval',
    'globalThis',
    'console',
    'process',
    'localStorage',
    'sessionStorage',
  ]);
  const scope = analyze(ast, { ecmaVersion: 2022, sourceType: 'module' });
  assert.deepEqual(
    scope.globalScope.through
      .filter((ref) => forbidden.has(ref.identifier.name))
      .map((ref) => ref.identifier.name),
    []
  );
  return ast;
}
test('archive ownership has six explicit ports and the projection model remains pure', () => {
  const ast = boundary(read('bank-archive-readout'), ['../../shared/bank-archive-read-batch.js']);
  const factory = ast.body.find(
    (row) => row.declaration?.id?.name === 'createOrdersBankArchiveReadout'
  ).declaration;
  assert.equal(factory.params[0].properties.length, 6);
  boundary(read('bank-archive-model'), ['./bank-feed.js']);
});
test('archive boundary rejects filesystem imports, timers and direct diagnostics', () => {
  for (const suffix of [
    "\nimport fs from 'node:fs';",
    '\nsetTimeout(() => {}, 1);',
    '\nconsole.error("private");',
  ])
    assert.throws(() => boundary(read('bank-archive-readout') + suffix, ['../../shared/bank-archive-read-batch.js']));
});
test('Finance delegates archive reads, publications and pauses without private archive resources', () => {
  const source = read('controller'),
    ast = parse(source, { ecmaVersion: 'latest', sourceType: 'module' });
  const factory = ast.body.find(
    (row) => row.declaration?.id?.name === 'createDomainsFinanceController'
  ).declaration;
  const fields = factory.params[0].properties.map((row) => row.key.name);
  assert.equal(fields.length, 18);
  assert.ok(fields.includes('connections'));
  assert.ok(fields.includes('archive'));
  for (const field of [
    'readBankTransactions',
    'readBankTransactionSnapshot',
    'touchBankDisplayRevision',
    'readRevision',
  ])
    assert.ok(!fields.includes(field), field);
  for (const resource of [
    'bankDisplayArchive',
    'bankDisplayArchiveTask',
    'projectionScope',
    'projectionEpoch',
  ])
    assert.ok(!source.includes(resource), resource);
  for (const method of [
    'archive.commands.update',
    'archive.runtime.pause()',
    'archive.runtime.resume()',
  ])
    assert.ok(source.includes(method), method);
  const publication=read('bank-snapshot-publication');
  for(const method of ['archive.read(', 'archive.publish('])assert.ok(publication.includes(method));
});
test('production composition wires current authority and transport and disposes the archive owner', () => {
  const source = fs
    .readFileSync(
      new URL('../netunim-orders/site/assets/js/composition/finance.js', import.meta.url),
      'utf8'
    )
    .replace(/\s+/g, '');
  for (const wire of [
    'authority:operationScope',
    'transactions:(...args)=>cloud.readBankTransactions(...args)',
    'snapshot:(...args)=>cloud.readBankTransactionSnapshot(...args)',
    'archive?.runtime.dispose()',
  ])
    assert.ok(source.includes(wire), wire);
});
