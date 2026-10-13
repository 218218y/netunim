import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {parse} from 'acorn';
const root=fileURLToPath(new URL('../netunim-kupa/bank-bridge/',import.meta.url));

test('Bank installer stages every transitive configuration/platform dependency before activation',()=>{
  const installer=fs.readFileSync(path.join(root,'install_bank_bridge.bat'),'utf8');
  const list=installer.match(/for %%F in \((server\.mjs[^)]+)\)/)?.[1];assert.ok(list);
  const staged=new Set(list.split(/\s+/)),seen=new Set();
  function visit(file){
    if(seen.has(file))return;seen.add(file);assert.ok(staged.has(file),`unstaged Bank runtime dependency: ${file}`);
    const ast=parse(fs.readFileSync(path.join(root,file),'utf8'),{ecmaVersion:'latest',sourceType:'module'});
    for(const node of ast.body){
      if(!['ImportDeclaration','ExportAllDeclaration','ExportNamedDeclaration'].includes(node.type)||!node.source||!String(node.source.value).startsWith('.'))continue;
      const dependency=path.posix.normalize(path.posix.join(path.posix.dirname(file),String(node.source.value)));
      assert.ok(!dependency.startsWith('../'));visit(dependency);
    }
  }
  visit('server.mjs');
  for(const file of ['json-artifact-owner.mjs','bridge-artifacts.mjs','credit-diagnostic-model.mjs','credit-diagnostic-log.mjs','hapoalim-wire.mjs','hapoalim-json.mjs','hapoalim-enrichment.mjs','hapoalim-accounts.mjs','cheque-images.mjs','file-task-owner.mjs','browser-locator.mjs','windows-browser.mjs','provider-errors.mjs','hapoalim-session.mjs','hapoalim-provider.mjs','credit-session.mjs','credit-provider.mjs','shutdown-owner.mjs','replacement-command.mjs','loopback-port.mjs','operation-owner.mjs','connection-commands.mjs','connection-settings.mjs','connection-vault.mjs','windows-platform.mjs','http-handler.mjs','http-routes.mjs','wire-errors.mjs','connection-queries.mjs','finance-commands.mjs','diagnostic-queries.mjs'])assert.ok(seen.has(file),file);
  assert.ok(installer.indexOf('for %%F in')<installer.indexOf('node server.mjs --doctor'));
});
