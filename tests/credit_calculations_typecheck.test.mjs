import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import path from 'node:path';
import {root,check,describe} from './typecheck_contract_fixture.mjs';

test('actual billing and account calculations satisfy negative consumers',()=>{
  const diagnostics=check();assert.deepEqual(diagnostics,[],describe(diagnostics));
});
for(const [file,from,to] of [
  ['credit-billing-cycles',"included:false,estimated:false,source:'unknown'","included:true,estimated:false,source:'unknown'"],
  ['credit-billing-cycles',"estimated:true,source:'original_ils_estimate'","estimated:false,source:'original_ils_estimate'"],
  ['credit-billing-cycles',"amount:0,rawAmount:null,currency:","amount:'0',rawAmount:null,currency:"],
  ['credit-card-account','return role;',"return 'other';"],
])test(`checked financial implementation rejects ${to}`,()=>{
  const target=path.join(root,'shared',file+'.js'),original=readFileSync(target,'utf8'),mutated=original.replace(from,to);
  assert.notEqual(original,mutated,from);
  const diagnostics=check(new Map([[target,mutated]]));
  assert.ok(diagnostics.some(item=>item.file&&path.resolve(item.file.fileName)===target&&[2322,2345].includes(item.code)),describe(diagnostics));
});
