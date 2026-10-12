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
      if(node.type!=='ImportDeclaration'||!String(node.source.value).startsWith('.'))continue;
      const dependency=path.posix.normalize(path.posix.join(path.posix.dirname(file),String(node.source.value)));
      assert.ok(!dependency.startsWith('../'));visit(dependency);
    }
  }
  visit('server.mjs');
  for(const file of ['operation-owner.mjs','connection-commands.mjs','connection-settings.mjs','connection-vault.mjs','windows-platform.mjs','http-handler.mjs','http-routes.mjs','wire-errors.mjs','connection-queries.mjs','finance-commands.mjs','diagnostic-queries.mjs'])assert.ok(seen.has(file));
  assert.ok(installer.indexOf('for %%F in')<installer.indexOf('node server.mjs --doctor'));
});
