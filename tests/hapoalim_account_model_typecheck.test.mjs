import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import {readFileSync} from 'node:fs';
import {root,check,describe} from './typecheck_contract_fixture.mjs';
test('Hapoalim account implementation and negative identity/money consumers pass',()=>{
  const diagnostics=check();assert.equal(diagnostics.length,0,describe(diagnostics));
});
for(const [label,from,to] of [
  ['canonical account identity','return { ...source, bankNumber, branchNumber, accountNumber, accountId };','return { ...source, bankNumber, branchNumber, accountNumber, accountId:200 };'],
  ['raw account number','const accountNumber = normalizeAccountPart(source.accountNumber);','const accountNumber = source.accountNumber;'],
])test('actual Hapoalim account model rejects a mutation of '+label,()=>{
  const source=path.join(root,'netunim-kupa/bank-bridge/hapoalim-account-model.mjs'),original=readFileSync(source,'utf8'),changed=original.replace(from,to);assert.notEqual(changed,original);
  const diagnostics=check(new Map([[source,changed]]));
  assert.ok(diagnostics.some(item=>item.file&&path.resolve(item.file.fileName)===source),describe(diagnostics));
});
