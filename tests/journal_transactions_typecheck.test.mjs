import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import path from 'node:path';
import {root,check,describe} from './typecheck_contract_fixture.mjs';

test('actual journal transactions and replay satisfy strict negative consumers',()=>{
  const diagnostics=check();
  assert.deepEqual(diagnostics,[],describe(diagnostics));
});

for(const [file,from,to] of [
  ['shared/storage-journal-idb.js',"tx.objectStore('controls').delete(owner);done(true);", "tx.objectStore('controls').delete(owner);done(Promise.resolve(true));"],
  ['shared/storage-journal-idb.js','done(true);',"done('saved');"],
  ['shared/storage-journal-model.js','return {state,seq,epoch:base.epoch,owner:base.owner,appMetadata};',"return {state,seq:'1',epoch:base.epoch,owner:base.owner,appMetadata};"],
  ['shared/storage-journal-model.js','bySeq.set(operation.seq,operation);',"bySeq.set('1',operation);"],
])test(`checked journal implementation rejects ${to}`,()=>{
  const target=path.join(root,file),original=readFileSync(target,'utf8'),mutated=original.replace(from,to);
  assert.notEqual(original,mutated,from);
  const diagnostics=check(new Map([[target,mutated]]));
  assert.ok(diagnostics.some(item=>item.file&&path.resolve(item.file.fileName)===target&&[2322,2345].includes(item.code)),describe(diagnostics));
});
