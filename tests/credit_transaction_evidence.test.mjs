import test from 'node:test';
import assert from 'node:assert/strict';
import {readCreditRefreshResult} from '../shared/credit-refresh-result.js';
import {normalizeCreditScrapeTransaction} from '../netunim-kupa/bank-bridge/credit-transaction-model.mjs';
const tx={id:'T',status:'completed',chargedAmount:20};
const response=(account,contractVersion=2)=>({contractVersion,profiles:[{profileId:'P',accounts:[account]}]});
for(const status of [undefined,null,'garbage',true,false,0,'PENDING',' completed ']){
  test(`Credit current protocol never finalizes unknown status ${String(status)}`,()=>{
    const bad={...tx,status};
    assert.throws(()=>normalizeCreditScrapeTransaction(bad),{code:'CREDIT_PROVIDER_SCHEMA_ERROR'});
    for(const account of [{txns:[bad]},{pendingTransactions:[bad]},{unassignedTransactions:[bad]},
      {months:[{transactions:[tx,bad]}]}]){
      assert.throws(()=>readCreditRefreshResult(response(account)),{code:'CREDIT_REFRESH_RESULT_INVALID'});
    }
  });
}
test('only the explicit legacy protocol permits omitted status, never an unknown supplied value',()=>{
  for(const contractVersion of [undefined,1]){
    const legacy=response({txns:[{id:'old'}]},contractVersion);
    if(contractVersion===undefined)delete legacy.contractVersion;
    assert.doesNotThrow(()=>readCreditRefreshResult(legacy));
    assert.throws(()=>readCreditRefreshResult(response({txns:[{id:'old',status:'garbage'}]},contractVersion)),{code:'CREDIT_REFRESH_RESULT_INVALID'});
  }
  for(const contractVersion of [null,'2',true,0,3]){
    assert.throws(()=>readCreditRefreshResult(response({txns:[tx]},contractVersion)),{code:'CREDIT_REFRESH_RESULT_INVALID'});
  }
});
test('valid current transaction evidence is detached from the provider response before publication',()=>{
  const raw=response({txns:[structuredClone(tx)]});
  const accepted=readCreditRefreshResult(raw);
  raw.profiles[0].accounts[0].txns[0].status='garbage';
  assert.equal(accepted.profiles[0].accounts[0].txns[0].status,'completed');
});
