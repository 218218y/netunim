import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import {readFileSync} from 'node:fs';
import {root,check,describe} from './typecheck_contract_fixture.mjs';
test('boundary/bootstrap implementations and negative phase/identity consumers pass',()=>{
  const diagnostics=check();assert.equal(diagnostics.length,0,describe(diagnostics));
});
for(const [file,label,from,to] of [
  ['storage-v2-boundary.js','raw persisted boundary','let record=read(raw,scoped);','let record=raw;'],
  ['storage-v2-boundary.js','frozen sequence','expectedSeq:action.expectedSeq','expectedSeq:"old"'],
  ['storage-v2-boundary.js','closed phase',"record.phase==='shared-applied'","record.phase==='published'"],
  ['storage-v2-bootstrap.js','awaited phase proof','const proof=await initializeMain(','const proof=initializeMain('],
  ['storage-v2-bootstrap.js','scope identity','const expected={scope:group.scope','const expected={scope:200'],
  ['storage-v2-bootstrap.js','raw bootstrap record','const current=assertStorageV2BootstrapGroup(record);','const current=record;'],
])test('actual transition implementation rejects a mutation of '+label,()=>{
  const source=path.join(root,'shared',file),original=readFileSync(source,'utf8'),changed=original.replace(from,to);assert.notEqual(changed,original);
  const diagnostics=check(new Map([[source,changed]]));
  assert.ok(diagnostics.some(item=>item.file&&path.resolve(item.file.fileName)===source),describe(diagnostics));
});
