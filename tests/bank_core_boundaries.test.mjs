import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from 'acorn';
import { analyze } from 'eslint-scope';
const root = fileURLToPath(new URL('../netunim-kupa/bank-bridge/', import.meta.url));
const read = (name) => fs.readFileSync(path.join(root, name + '.mjs'), 'utf8');
const budgets = {
  'hapoalim-policy': [],
  'hapoalim-navigation-policy': ['./hapoalim-policy.mjs'],
  'hapoalim-login-runtime': ['./hapoalim-policy.mjs'],
  'hapoalim-account-selector': [],
  'hapoalim-account-model': ['./hapoalim-account-selector.mjs'],
  'hapoalim-detail-values': [],
  'hapoalim-detail-keys': ['./hapoalim-detail-values.mjs'],
  'hapoalim-cheque-model': ['./hapoalim-detail-values.mjs', './hapoalim-detail-keys.mjs'],
  'hapoalim-credit-settlement-model': [
    './hapoalim-detail-values.mjs',
    './hapoalim-detail-keys.mjs',
  ],
  'hapoalim-additional-details-model': [
    './hapoalim-cheque-model.mjs',
    './hapoalim-detail-keys.mjs',
    './hapoalim-detail-values.mjs',
  ],
  'hapoalim-date-codec': [],
  'hapoalim-transaction-model': [
    './hapoalim-policy.mjs',
    './hapoalim-detail-values.mjs',
    './hapoalim-credit-settlement-model.mjs',
    './hapoalim-cheque-model.mjs',
    './hapoalim-date-codec.mjs',
  ],
  'hapoalim-failure-policy': [],
};
const effects = new Set([
  'globalThis',
  'window',
  'document',
  'navigator',
  'process',
  'fetch',
  'setTimeout',
  'setInterval',
  'clearTimeout',
  'clearInterval',
  'AbortController',
  'FileReader',
  'localStorage',
  'sessionStorage',
]);
function assertBoundary(name, source) {
  const tree = parse(source, { ecmaVersion: 'latest', sourceType: 'module', ranges: true });
  assert.deepEqual(
    tree.body.filter((row) => row.type === 'ImportDeclaration').map((row) => row.source.value),
    budgets[name],
    name + ' import budget'
  );
  if (name !== 'hapoalim-login-runtime')
    for (const ref of analyze(tree, { ecmaVersion: 2022, sourceType: 'module' }).globalScope
      .through)
      assert.ok(!effects.has(ref.identifier.name), name + ' cannot acquire ' + ref.identifier.name);
}
test('Bank normalization, identity and failure models have explicit dependency/effect budgets', () => {
  for (const name of Object.keys(budgets)) assertBoundary(name, read(name));
});
test('Bank model budgets reject hidden platform imports, timers and browser globals', () => {
  for (const extra of [
    "\nimport fs from 'node:fs';\nvoid fs;",
    '\nsetTimeout(()=>{},1);',
    '\nvoid globalThis.fetch;',
  ])
    assert.throws(() =>
      assertBoundary('hapoalim-account-selector', read('hapoalim-account-selector') + extra)
    );
});
test('the retired Bank library has no current source, import or installer entry', () => {
  assert.equal(fs.existsSync(path.join(root, 'lib.mjs')), false);
  const folders = [root, fileURLToPath(new URL('./', import.meta.url))];
  const legacy = ['normalizeAccountNumber', 'selectBalanceAccount', 'isHapoalimChequeTransaction'];
  for (const folder of folders)
    for (const file of fs.readdirSync(folder).filter((file) => file.endsWith('.mjs'))) {
      const tree = parse(fs.readFileSync(path.join(folder, file), 'utf8'), {
        ecmaVersion: 'latest',
        sourceType: 'module',
      });
      for (const row of tree.body) {
        if (row.source?.value)
          assert.notEqual(
            path.resolve(folder, String(row.source.value)),
            path.join(root, 'lib.mjs'),
            file + ' consumes the retired Bank module'
          );
        if (folder === root && row.type === 'ExportNamedDeclaration') {
          const names = row.declaration?.id
            ? [row.declaration.id.name]
            : row.declaration?.declarations?.map((item) => item.id.name) ||
              row.specifiers.map((item) => item.exported.name);
          assert.ok(
            !names.some((name) => legacy.includes(name)),
            file + ' reintroduces an unused legacy export'
          );
        }
      }
    }
  const installer = fs.readFileSync(path.join(root, 'install_bank_bridge.bat'), 'utf8'),
    list = installer.match(/for %%F in \((server\.mjs[^)]+)\)/)?.[1];
  assert.ok(list);
  assert.ok(!list.split(/\s+/).includes('lib.mjs'));
});
test('canonical Bank model dependencies remain acyclic', () => {
  const active = new Set(),
    done = new Set();
  function visit(name) {
    assert.ok(!active.has(name), 'model cycle ' + name);
    if (done.has(name)) return;
    active.add(name);
    for (const dep of budgets[name]) visit(dep.slice(2, -4));
    active.delete(name);
    done.add(name);
  }
  Object.keys(budgets).forEach(visit);
});
