import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {parse} from 'acorn';

const root = fileURLToPath(new URL('../netunim-orders/document-bridge/', import.meta.url));

test('Windows installer stages the complete static server module dependency graph before activation', () => {
  const installer = fs.readFileSync(path.join(root, 'install_document_bridge.bat'), 'utf8');
  const list = installer.match(/for %%F in \((server\.mjs[^)]+)\)/)?.[1];
  assert.ok(list, 'installer must declare the staged runtime module list');
  const staged = new Set(list.split(/\s+/));
  const seen = new Set(),active = new Set();
  function visit(file) {
    assert.equal(active.has(file),false,`runtime dependency cycle at ${file}`);
    if (seen.has(file)) return;
    active.add(file);
    seen.add(file);
    assert.ok(staged.has(file), `runtime dependency ${file} is missing from the transactional staging copy`);
    const program = parse(fs.readFileSync(path.join(root, file), 'utf8'), {ecmaVersion: 'latest', sourceType: 'module'});
    for (const node of program.body) {
      if (node.type !== 'ImportDeclaration' || !String(node.source.value).startsWith('.')) continue;
      const dependency = path.posix.normalize(path.posix.join(path.posix.dirname(file), String(node.source.value)));
      assert.ok(!dependency.startsWith('../'), 'runtime imports must remain within the versioned installation');
      visit(dependency);
    }
    active.delete(file);
  }
  visit('server.mjs');
  assert.ok(seen.has('http-handler.mjs') && seen.has('http-routes.mjs'));
  for(const file of ['bridge-replacement-command.mjs','windows-process-control.mjs','bridge-runtime-files.mjs','pdf-maintenance-task-diagnostics.mjs','bridge-installation-diagnostics.mjs','pdf-inventory-reconciliation.mjs'])assert.ok(seen.has(file),'listener must compose '+file);
  assert.ok(installer.indexOf('for %%F in') < installer.indexOf('"%STAGING%\\server.mjs" --init'));
});
