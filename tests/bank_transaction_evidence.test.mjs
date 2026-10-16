import test from 'node:test';
import assert from 'node:assert/strict';
import {readBankBalanceResult} from '../shared/bank-balance-result.js';
import {readBankTransaction} from '../shared/bank-transaction-evidence.js';
import {verifyBankArchiveCoverage} from '../shared/bank-archive-policy.js';
import {createCloudTransport as orders} from '../netunim-orders/site/assets/js/cloud/transport.js';
import {createCloudTransport as kupa} from '../netunim-kupa/site/assets/js/cloud/transport.js';

const tx={id:'T',mergeKey:'T',date:'2026-10-16T10:00:00Z',amount:25,currency:'ILS',status:'completed'};
const invalid={code:'BANK_TRANSACTIONS_INVALID'};
for(const status of [undefined,null,'garbage',true,false,0,'PENDING',' completed ']){
  test(`unknown bank status ${String(status)} never grants coverage, write or readback authority`,async()=>{
    const bad={...tx,status};
    assert.throws(()=>readBankTransaction(bad),invalid);
    for(const role of ['business','home']){
      assert.throws(()=>readBankBalanceResult({accounts:{business:{balance:0},[role]:{
        balance:0,transactions:[tx,bad],transactionCoverage:{complete:true}}}}),invalid);
    }
    for(const create of [orders,kupa]){
      let calls=0;
      const fetch=async()=>{calls++;throw Error('network must not run')};
      const transport=create({supaFetch:fetch,supaRest:fetch});
      await assert.rejects(transport.syncBankTransactionsSnapshot('A','business',[tx,bad],{
        snapshotAt:tx.date,coverage:{complete:true,from:'2026-10-01',to:'2026-10-16'},complete:true}),invalid);
      assert.equal(calls,0);
    }
    assert.throws(()=>verifyBankArchiveCoverage({sourcePayload:[bad]},[tx]));
    assert.throws(()=>verifyBankArchiveCoverage({sourcePayload:[tx]},[bad]));
  });
}
test('every transaction in a complete bank history must decode, including sparse entries',()=>{
  for(const bad of [null,false,[],{}, {...tx,amount:false},{...tx,currency:''},{...tx,date:'2026-02-30T10:00:00Z'}]){
    assert.throws(()=>readBankBalanceResult({balance:0,transactionCoverage:{complete:true},transactions:[tx,bad]}),invalid);
  }
  assert.throws(()=>readBankBalanceResult({balance:0,transactionCoverage:{complete:true},transactions:Array(1)}),invalid);
  for(const status of ['pending','completed'])assert.equal(readBankTransaction({...tx,status}).status,status);
});
