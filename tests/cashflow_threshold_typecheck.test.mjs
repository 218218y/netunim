import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import {readFileSync} from 'node:fs';
import {root,check,describe} from './typecheck_contract_fixture.mjs';
for(const [file,from,to] of [
  ['shared/cashflow.js','projected:null,minimum,active:false', 'projected:0,minimum,active:false'],
  ['shared/cashflow.js',"active:false,reason:'unavailable'","active:true,reason:'unavailable'"],
  ['shared/cashflow-notification.js','daysUntilBreach}:null',"daysUntilBreach:'tomorrow'}:null"],
])test('actual threshold/warning body rejects '+to,()=>{
  const source=path.join(root,file),original=readFileSync(source,'utf8'),changed=original.replace(from,to);assert.notEqual(changed,original);
  const diagnostics=check(new Map([[source,changed]]));
  assert.ok(diagnostics.some(item=>item.file&&path.resolve(item.file.fileName)===source&&item.code===2322),describe(diagnostics));
});
