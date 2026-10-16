import test from 'node:test';
import assert from 'node:assert/strict';
import {readCreditRefreshResult} from '../shared/credit-refresh-result.js';
import {normalizeCreditScrapeTransaction} from '../netunim-kupa/bank-bridge/credit-transaction-model.mjs';
import {normalizeCreditSync as ordersHistory} from '../netunim-orders/site/assets/js/domains/finance/credit-feed.js';
import {normalizeCreditSync as kupaHistory} from '../netunim-kupa/site/assets/js/domains/credit/sync-feed.js';
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
test('historical persisted Credit data remains readable, while current network replies cannot choose legacy status rules',()=>{
  for(const contractVersion of [undefined,1]){
    const legacy=response({txns:[{id:'old'}]},contractVersion);
    if(contractVersion===undefined)delete legacy.contractVersion;
    assert.throws(()=>readCreditRefreshResult(legacy),{code:'CREDIT_REFRESH_RESULT_INVALID'});
    assert.throws(()=>readCreditRefreshResult(response({txns:[{id:'old',status:'garbage'}]},contractVersion)),{code:'CREDIT_REFRESH_RESULT_INVALID'});
  }
  for(const contractVersion of [null,'2',true,0,1,3]){
    assert.throws(()=>readCreditRefreshResult(response({txns:[tx]},contractVersion)),{code:'CREDIT_REFRESH_RESULT_INVALID'});
  }
  for(const normalize of [ordersHistory,kupaHistory]){
    const stored={version:1,contractVersion:1,profiles:[{profileId:'P',provider:'max',accounts:[{accountNumber:'C',
      txns:[{id:'old',date:'2026-10-01T10:00:00Z',chargedAmount:20,chargedCurrency:'ILS'}]}]}]};
    assert.equal(normalize(stored).profiles[0].accounts[0].txns[0].status,'completed');
  }
});
test('a current v2 handshake cannot be downgraded by omitting the response protocol version',()=>{
  for(const account of [{txns:[{id:'T'}]},{months:[{transactions:[{id:'T'}]}]},
    {pendingTransactions:[{id:'T'}]},{unassignedTransactions:[{id:'T'}]}]){
    const result=response(account);delete result.contractVersion;
    assert.throws(()=>readCreditRefreshResult(result),{code:'CREDIT_REFRESH_RESULT_INVALID'});
  }
  assert.throws(()=>readCreditRefreshResult(response({txns:[tx]},1)),{code:'CREDIT_REFRESH_RESULT_INVALID'});
  const current=response({txns:[tx]});delete current.contractVersion;
  assert.equal(readCreditRefreshResult(current).profiles[0].accounts[0].txns[0].status,'completed');
});
test('valid current transaction evidence is detached from the provider response before publication',()=>{
  const raw=response({txns:[structuredClone(tx)]});
  const accepted=readCreditRefreshResult(raw);
  raw.profiles[0].accounts[0].txns[0].status='garbage';
  assert.equal(accepted.profiles[0].accounts[0].txns[0].status,'completed');
});
