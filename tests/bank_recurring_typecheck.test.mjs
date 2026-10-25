import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import path from 'node:path';
import {root,check,describe} from './typecheck_contract_fixture.mjs';

test('actual bank recurring calculation and negative consumers compile strictly',()=>{
  const diagnostics=check();assert.equal(diagnostics.length,0,describe(diagnostics));
});
for(const [from,to] of [
  ['amountEstimated: true,','amountEstimated: false,'],
  ["source: 'bank_recurring',","source: 'bank_posted',"],
  ['amount: direction * cents(latest.amount) / 100,','amount: null,'],
  ['nextAmount: null',"nextAmount: 'unknown'"],
])test(`checked recurring calculation rejects ${to}`,()=>{
  const target=path.join(root,'shared/bank-recurring-debits.js'),original=readFileSync(target,'utf8'),mutated=original.replace(from,to);
  assert.notEqual(original,mutated,from);
  const diagnostics=check(new Map([[target,mutated]]));
  assert.ok(diagnostics.some(item=>item.file&&path.resolve(item.file.fileName)===target&&[2322,2345].includes(item.code)),describe(diagnostics));
});
