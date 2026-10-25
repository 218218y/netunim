import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import path from 'node:path';
import {root,check,describe} from './typecheck_contract_fixture.mjs';

test('actual shared check and bank-event normalization compile strictly',()=>{
  const diagnostics=check();assert.equal(diagnostics.length,0,describe(diagnostics));
});
for(const [from,to] of [
  ['amount:checkAmount(check.amount),',"amount:'known',"],
  ['id:String(check.id),','id:Number(check.id),'],
  ['depositSeq:Number.isSafeInteger(seq)&&seq>0?seq:null,',"depositSeq:Number.isSafeInteger(seq)&&seq>0?seq:'unknown',"],
  ["delta:checkAmount(field(event,'delta')),","delta:'saved',"],
])test(`checked shared model rejects ${to}`,()=>{
  const target=path.join(root,'shared/shared-checks-contract.js'),original=readFileSync(target,'utf8'),mutated=original.replace(from,to);
  assert.notEqual(original,mutated,from);
  const diagnostics=check(new Map([[target,mutated]]));
  assert.ok(diagnostics.some(item=>item.file&&path.resolve(item.file.fileName)===target&&[2322,2345,2677].includes(item.code)),describe(diagnostics));
});
