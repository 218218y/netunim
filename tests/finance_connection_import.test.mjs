import test from 'node:test';
import assert from 'node:assert/strict';
import {
  parseFinanceConnectionImportText,
  prepareFinanceConnectionImport,
  financeConnectionImportSummary,
} from '../shared/finance-connection-import.js';

function sample(){
  return {
    schema:'netunim-finance-connections',version:1,mode:'replace',
    bank:{provider:'hapoalim',userCode:'bank-user',password:'bank-pass',accounts:{business:{branchNumber:'123',accountNumber:'111111'},home:{branchNumber:'123',accountNumber:'222222'}}},
    credit:{profiles:[
      {connectionKey:'max-owner-a',provider:'max',label:'MAX-A',ownerLabel:'בעלים א',defaultAccount:'עסקי',credentials:{username:'max-user',password:'max-pass'}},
      {connectionKey:'amex-owner-b',provider:'amex',label:'AMEX-B',ownerLabel:'בעלים ב',defaultAccount:'עסקי',credentials:{id:'123456789',card6Digits:'123456',password:'amex-pass'}},
    ]},
  };
}

test('finance import parses the versioned replace document and summarizes both domains',()=>{
  const parsed=parseFinanceConnectionImportText(JSON.stringify(sample()));
  assert.equal(parsed.schema,'netunim-finance-connections');
  assert.deepEqual(financeConnectionImportSummary(parsed),{creditProfileCount:2,bankAccountCount:2});
});

test('portable finance import keeps connectionKey authoritative across computers',()=>{
  const source=sample();
  source.credit.profiles[0].profileId='machine-specific-id';
  const prepared=prepareFinanceConnectionImport(source,[
    {profileId:'cloud-existing-id',provider:'max',label:' MAX-A ',ownerLabel:'בעלים א'},
  ]);
  assert.equal(prepared.credit.profiles[0].profileId,undefined,'connectionKey must reach the Bridge without a cloud/machine-specific profileId override');
  assert.equal(source.credit.profiles[0].profileId,'machine-specific-id','preparation never mutates the selected import document');
  assert.equal(prepared.credit.profiles[1].profileId,undefined);
});

test('legacy import without connectionKey can still reuse one unambiguous cloud identity',()=>{
  const source=sample();delete source.credit.profiles[0].connectionKey;source.credit.profiles[0].profileId=undefined;
  const prepared=prepareFinanceConnectionImport(source,[
    {profileId:'cloud-existing-id',provider:'max',label:' MAX-A ',ownerLabel:'בעלים א'},
  ]);
  assert.equal(prepared.credit.profiles[0].profileId,'cloud-existing-id');
});

test('legacy finance import does not guess when more than one cloud profile matches',()=>{
  const source=sample();delete source.credit.profiles[0].connectionKey;
  const prepared=prepareFinanceConnectionImport(source,[
    {profileId:'a',provider:'max',label:'MAX-A',ownerLabel:'בעלים א'},
    {profileId:'b',provider:'max',label:'MAX-A',ownerLabel:'בעלים א'},
  ]);
  assert.equal(prepared.credit.profiles[0].profileId,undefined);
});

test('finance import rejects unversioned or merge-style documents',()=>{
  const invalid=sample();invalid.mode='merge';
  assert.throws(()=>parseFinanceConnectionImportText(JSON.stringify(invalid)),/replace/);
  delete invalid.schema;
  assert.throws(()=>parseFinanceConnectionImportText(JSON.stringify(invalid)),/פורמט/);
});
