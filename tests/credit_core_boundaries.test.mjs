import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { parse } from 'acorn';
import { analyze } from 'eslint-scope';
const read = (name) =>
  fs.readFileSync(new URL('../netunim-kupa/bank-bridge/' + name + '.mjs', import.meta.url), 'utf8');
const models = {
  'credit-core-values': [],
  'credit-profile-model': ['./credit-core-values.mjs'],
  'credit-transaction-model': ['./credit-core-values.mjs','./credit-transaction-evidence.mjs'],
  'credit-transaction-evidence': [],
  'credit-failure-policy': ['./credit-core-values.mjs', './credit-profile-model.mjs'],
};
const effects = new Set([
  'globalThis',
  'window',
  'document',
  'navigator',
  'sessionStorage',
  'localStorage',
  'process',
  'fetch',
  'setTimeout',
  'setInterval',
  'clearTimeout',
  'clearInterval',
  'AbortController',
  'FileReader',
]);
function pure(name, source) {
  const ast = parse(source, { ecmaVersion: 'latest', sourceType: 'module', ranges: true });
  assert.deepEqual(
    ast.body.filter((row) => row.type === 'ImportDeclaration').map((row) => row.source.value),
    models[name]
  );
  for (const ref of analyze(ast, { ecmaVersion: 2022, sourceType: 'module' }).globalScope.through)
    assert.ok(!effects.has(ref.identifier.name), name + ' acquired ' + ref.identifier.name);
}
test('Credit profile, transaction and failure models have narrow imports and no browser/timer authority', () => {
  for (const name of Object.keys(models)) pure(name, read(name));
});
test('pure-module guard rejects browser globals, timers and new platform imports', () => {
  for (const extra of [
    '\nvoid globalThis.fetch;',
    '\nsetTimeout(()=>{},1);',
    "\nimport fs from 'node:fs';\nvoid fs;",
  ])
    assert.throws(() => pure('credit-core-values', read('credit-core-values') + extra));
});
test('new Credit core modules cannot depend back on the compatibility library or issuer adapters', () => {
  for (const name of Object.keys(models)) assert.ok(!read(name).includes("from './lib.mjs'"));
  for (const name of [
    'max-model',
    'visa-cal-model',
    'credit-monthly-projection',
    'credit-provider',
    'connection-commands',
    'connection-settings',
  ]) {
    const ast = parse(read(name), { ecmaVersion: 'latest', sourceType: 'module' });
    const core = ast.body.filter(
      (row) =>
        row.type === 'ImportDeclaration' &&
        row.specifiers.some((spec) =>
          [
            'creditDebitAmount',
            'normalizeCreditScrapeTransaction',
            'normalizeCreditScrapeAccount',
            'creditProviderSupported',
            'creditProfilePublic',
            'normalizeCreditProfileInput',
          ].includes(spec.imported?.name)
        )
    );
    assert.ok(core.length, name + ' should consume a Credit capability');
    assert.ok(
      core.every((row) => row.source.value !== './lib.mjs'),
      name + ' must bypass the broad library for Credit data'
    );
  }
});
