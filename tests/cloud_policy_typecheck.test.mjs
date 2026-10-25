import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import path from 'node:path';
import {root,check,describe} from './typecheck_contract_fixture.mjs';

test('actual cloud policy and scheduler preserve strict negative consumers',()=>{
  const diagnostics=check();assert.deepEqual(diagnostics,[],describe(diagnostics));
});
for(const [from,to] of [
  ['generation:normalizedGeneration,',"generation:'1',"],
  ["let kind='fatal';","let kind='saved';"],
  ['attempts:finiteGeneration(record(retry).attempts)',"attempts:'1'"],
  ['item.resolve(await item.task())','item.resolve(true)'],
])test(`actual cloud policy rejects ${to}`,()=>{
  const target=path.join(root,'shared/cloud-sync.js'),original=readFileSync(target,'utf8'),mutated=original.replace(from,to);
  assert.notEqual(original,mutated,from);
  const diagnostics=check(new Map([[target,mutated]]));
  assert.ok(diagnostics.some(item=>item.file&&path.resolve(item.file.fileName)===target&&[2322,2345].includes(item.code)),describe(diagnostics));
});
