import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from 'acorn';
const bridge = fileURLToPath(new URL('../netunim-kupa/bank-bridge/', import.meta.url));
const retired = new Set([
  'credit-adapters.mjs',
  'credit-diagnostics.mjs',
  'credit-generic-adapter.mjs',
]);

test('Credit compatibility files are absent from every current import and the installer', () => {
  const folders = [bridge, fileURLToPath(new URL('./', import.meta.url))];
  for (const folder of folders)
    for (const name of fs.readdirSync(folder).filter((name) => name.endsWith('.mjs'))) {
      const source = fs.readFileSync(path.join(folder, name), 'utf8');
      for (const node of parse(source, { ecmaVersion: 'latest', sourceType: 'module' }).body) {
        const target = node.source?.value;
        if (typeof target === 'string')
          assert.ok(!retired.has(path.posix.basename(target)), name + ' imports retired ' + target);
      }
    }
  const installer = fs.readFileSync(path.join(bridge, 'install_bank_bridge.bat'), 'utf8');
  for (const name of retired) {
    assert.ok(!installer.includes(name));
    assert.equal(fs.existsSync(path.join(bridge, name)), false);
  }
});

test('active Credit entry imports its exact factory, wire and log owners', () => {
  const source = fs.readFileSync(path.join(bridge, 'server.mjs'), 'utf8'),
    ast = parse(source, { ecmaVersion: 'latest', sourceType: 'module' });
  for (const [name, owner] of [
    ['createCreditProviderAdapter', './credit-adapter-factory.mjs'],
    ['CREDIT_CONNECTOR_CONTRACT_VERSION', './credit-adapter-wire.mjs'],
    ['createCreditDiagnosticLog', './credit-diagnostic-log.mjs'],
  ]) {
    const imports = ast.body.filter(
      (row) =>
        row.type === 'ImportDeclaration' &&
        row.specifiers.some((spec) => spec.imported?.name === name)
    );
    assert.equal(imports.length, 1, name);
    assert.equal(imports[0].source.value, owner, name);
  }
});
