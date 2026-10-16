import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { parse } from 'acorn';
import { analyze } from 'eslint-scope';
const read = (name) =>
  fs.readFileSync(new URL('../netunim-kupa/bank-bridge/' + name + '.mjs', import.meta.url), 'utf8');
const pure = {
  'credit-value-codec': [],
  'credit-adapter-wire': [],
  'credit-month-plan': ['./credit-adapter-wire.mjs'],
  'credit-sync-scope': ['./credit-adapter-wire.mjs', './credit-month-plan.mjs'],
  'credit-http-policy': ['./credit-value-codec.mjs'],
  'credit-coverage': ['./credit-value-codec.mjs', './credit-adapter-wire.mjs'],
  'visa-cal-model': [
    './credit-value-codec.mjs',
    './credit-adapter-wire.mjs',
    './credit-transaction-model.mjs',
    './credit-core-values.mjs',
  ],
  'max-model': [
    './credit-value-codec.mjs',
    './credit-data-diagnostics.mjs',
    './credit-core-values.mjs',
  ],
  'credit-monthly-projection': [
    './credit-adapter-wire.mjs',
    './max-model.mjs',
    './credit-transaction-model.mjs',
    './credit-month-plan.mjs',
    './credit-coverage.mjs',
  ],
};
const ioNames = new Set([
  'fetch',
  'setTimeout',
  'setInterval',
  'clearTimeout',
  'clearInterval',
  'AbortController',
  'process',
  'globalThis',
  'window',
  'document',
  'navigator',
  'sessionStorage',
  'localStorage',
]);
function pureBoundary(source, allowed) {
  const ast = parse(source, { ecmaVersion: 'latest', sourceType: 'module', ranges: true });
  const imports = ast.body.filter((row) => row.type === 'ImportDeclaration');
  assert.deepEqual([...new Set(imports.map((row) => row.source.value))], allowed);
  for (const ref of analyze(ast, { ecmaVersion: 2022, sourceType: 'module' }).globalScope.through)
    assert.ok(
      !ioNames.has(ref.identifier.name),
      'pure module cannot acquire ' + ref.identifier.name
    );
}

test('credit calculations and data projections have explicit imports and no direct runtime authority', () => {
  for (const [name, allowed] of Object.entries(pure)) pureBoundary(read(name), allowed);
});

test('pure boundary checks reject new timers, browser authority and hidden platform imports', () => {
  for (const extra of [
    '\nsetTimeout(()=>{},1);',
    '\nvoid navigator.onLine;',
    '\nvoid globalThis.fetch;',
    "\nimport fs from 'node:fs';\nvoid fs;",
  ])
    assert.throws(() => pureBoundary(read('credit-month-plan') + extra, pure['credit-month-plan']));
});

test('credit adapter dependency graph remains acyclic and policy consumers bypass the broad facade', () => {
  const visited = new Set(),
    active = new Set();
  function visit(name) {
    assert.ok(!active.has(name), 'cycle at ' + name);
    if (visited.has(name)) return;
    active.add(name);
    for (const row of parse(read(name), { ecmaVersion: 'latest', sourceType: 'module' }).body) {
      const path = row.source?.value;
      if (typeof path === 'string' && path.startsWith('./')) visit(path.slice(2, -4));
    }
    active.delete(name);
    visited.add(name);
  }
  visit('credit-adapter-factory');
  for (const name of ['finance-commands', 'credit-provider'])
    assert.ok(!read(name).includes('./credit-adapters.mjs'));
});
