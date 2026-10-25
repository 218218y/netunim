import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import path from 'node:path';
import {root,check,describe} from './typecheck_contract_fixture.mjs';

test('actual Bridge financial models and negative consumers compile without exclusions',()=>{
  const diagnostics=check();assert.deepEqual(diagnostics,[],describe(diagnostics));
  for(const file of ['credit-transaction-model','credit-profile-model','hapoalim-cheque-model','hapoalim-credit-settlement-model'])
    assert.doesNotMatch(readFileSync(path.join(root,'netunim-kupa/bank-bridge',file+'.mjs'),'utf8'),/@ts-nocheck/);
});
for(const [file,from,to] of [
  ['credit-transaction-model','chargedAmount: creditNumber(data.chargedAmount)',"chargedAmount: '12'"],
  ['credit-transaction-model','status: data.status',"status: 'saved'"],
  ['credit-transaction-model','total: Math.trunc(Number(data.installments.total))',"total: '3'"],
  ['hapoalim-cheque-model','return { bankNumber, branchNumber, accountNumber, checkNumber, amount, hasDocumentReference };',"return { bankNumber, branchNumber, accountNumber, checkNumber, amount: '12', hasDocumentReference };"],
])test(`checked Bridge implementation rejects ${to}`,()=>{
  const target=path.join(root,'netunim-kupa/bank-bridge',file+'.mjs'),original=readFileSync(target,'utf8'),mutated=original.replace(from,to);
  assert.notEqual(original,mutated,from);
  const diagnostics=check(new Map([[target,mutated]]));
  assert.ok(diagnostics.some(item=>item.file&&path.resolve(item.file.fileName)===target&&[2322,2345].includes(item.code)),describe(diagnostics));
});
