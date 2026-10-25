import test from 'node:test';
import assert from 'node:assert/strict';
import {publicAccountDescriptors,selectAccountDescriptor} from '../netunim-kupa/bank-bridge/hapoalim-account-model.mjs';
test('partial provider rows cannot acquire account authority from missing identity',()=>{
  const valid={bankNumber:12,branchNumber:'001',accountNumber:'000123',balance:'unverified'};
  assert.deepEqual(publicAccountDescriptors([null,undefined,42,'provider',{},valid]),[{bankNumber:'12',branchNumber:'001',accountNumber:'000123',accountId:'12-001-000123'}]);
  const selected=selectAccountDescriptor([null,{},valid]);assert.equal(selected.accountId,'12-001-000123');assert.equal(selected.balance,'unverified');
  assert.throws(()=>selectAccountDescriptor([null,{},12]),{code:'NO_ACCOUNTS'});
});
test('selection preserves branch and bank authority when account numbers collide',()=>{
  const accounts=[{bankNumber:'12',branchNumber:'001',accountNumber:'123'},{bankNumber:'12',branchNumber:'002',accountNumber:'123'}];
  assert.throws(()=>selectAccountDescriptor(accounts,'123'),error=>error.code==='AMBIGUOUS_ACCOUNT'&&error.availableAccounts.length===2);
  assert.equal(selectAccountDescriptor(accounts,'12-002-123').accountId,'12-002-123');
  assert.throws(()=>selectAccountDescriptor(accounts,'10-002-123'),{code:'ACCOUNT_NOT_FOUND'});
});
