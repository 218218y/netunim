import test from 'node:test';
import assert from 'node:assert/strict';
import {readCreditRefreshResult} from '../shared/credit-refresh-result.js';
import {mergeCreditSyncResult as kupaMerge} from '../netunim-kupa/site/assets/js/domains/credit/sync-feed.js';
import {mergeCreditSyncResult as ordersMerge} from '../netunim-orders/site/assets/js/domains/finance/credit-feed.js';
import {normalizeCreditScrapeTransaction,normalizeCreditScrapeAccount} from '../netunim-kupa/bank-bridge/credit-transaction-model.mjs';
const tx={id:'T',status:'completed',chargedAmount:-120,processedDate:'2026-10-01T00:00:00Z'};
const month={month:'2026-10',tier:'core',fetchStatus:'success',fetchedAt:'2026-10-16T09:00:00Z',transactions:[tx]};
const result=account=>({contractVersion:2,profiles:[{profileId:'P',provider:'max',accounts:[{accountNumber:'C',...account}]}]});
const rejected=value=>assert.throws(()=>readCreditRefreshResult(value),{code:'CREDIT_REFRESH_RESULT_INVALID'});

for(const [name,merge] of [['Kupa',kupaMerge],['Orders',ordersMerge]]){
  test(name+' preserves known monthly/pending evidence unless successful replacement has an explicit array',()=>{
    const initial=merge({cardMappings:{'P:C':{included:true}}},result({months:[month],pendingTransactions:[{...tx,id:'pending',status:'pending'}],pendingStatus:'success'}));
    const before=structuredClone(initial);
    for(const account of [{months:[{month:'2026-10',fetchStatus:'success'}]},
      {months:[{month:'2026-10',status:'fresh'}]},{pendingStatus:'success'}]){
      rejected(result(account));assert.deepEqual(initial,before);
    }
    const empty=merge(initial,readCreditRefreshResult(result({months:[{...month,transactions:[]}],pendingStatus:'success',pendingTransactions:[]})));
    assert.equal(empty.profiles[0].accounts[0].months[0].transactions.length,0);
    assert.equal(empty.profiles[0].accounts[0].pendingTransactions.length,0);
    const failed=merge(initial,readCreditRefreshResult(result({months:[{...month,fetchStatus:'schema_error',transactions:[]}],pendingStatus:'schema_error'})));
    assert.equal(failed.profiles[0].accounts[0].months[0].transactions[0].id,'T');
    assert.equal(failed.profiles[0].accounts[0].pendingTransactions[0].id,'pending');
  });
}
test('current monetary evidence rejects coerced/invalid values in every representation and account frame',()=>{
  for(const bad of [true,false,'', ' ', [],{},NaN,Infinity,'1e3']){
    for(const field of ['balance','cardFrame','availableCredit'])rejected(result({[field]:bad}));
    for(const field of ['chargedAmount','originalAmount']){
      const row={...tx,[field]:bad};
      for(const account of [{txns:[row]},{pendingTransactions:[row]},{unassignedTransactions:[row]},
        {months:[{...month,transactions:[row]}]}])rejected(result(account));
    }
  }
  for(const value of [0,-12.5,'12.50',null,undefined])assert.doesNotThrow(()=>readCreditRefreshResult(result({txns:[{...tx,chargedAmount:value}]})));
});
test('current installment and charge flags cannot invent financial meaning by normalization',()=>{
  for(const installments of [false,[],{}, {number:true,total:3},{number:1.5,total:3},{number:1,total:2.5},
    {number:0,total:3},{number:4,total:3},{number:1,total:Number.MAX_SAFE_INTEGER+1}])rejected(result({txns:[{...tx,installments}]}));
  for(const chargeAmountStatus of [true,'unknown',null])rejected(result({txns:[{...tx,chargeAmountStatus}]}));
  rejected(result({txns:[{...tx,chargeAmountStatus:'reported',chargedAmount:null}]}));
  rejected(result({txns:[{...tx,foreignTransaction:'false'}]}));
  for(const coreComplete of ['true',0,null])rejected({...result({}),profiles:[{profileId:'P',coreComplete}]});
});
test('month identity and retrieval status cannot be lost or resolve by duplicate-row order',()=>{
  for(const row of [{transactions:[]},{...month,month:'2026-13'},{...month,month:true},
    {...month,tier:'unknown'},{...month,fetchStatus:'unknown'},{...month,transactions:false}])rejected(result({months:[row]}));
  rejected(result({months:[month,{...month,transactions:[]}]}));
});
test('actual Bridge normalization retains valid nullable amounts, installments and successful empty coverage',()=>{
  const row=normalizeCreditScrapeTransaction({...tx,originalAmount:null,installments:{number:1,total:3}});
  const account=normalizeCreditScrapeAccount({accountNumber:'C',months:[{...month,transactions:[row]}],
    pendingStatus:'success',pendingTransactions:[],balance:null,cardFrame:1000},'max');
  const decoded=readCreditRefreshResult(result(account)).profiles[0].accounts[0];
  assert.equal(decoded.months[0].transactions[0].chargedAmount,-120);
  assert.equal(decoded.months[0].transactions[0].originalAmount,null);
  assert.deepEqual(decoded.months[0].transactions[0].installments,{number:1,total:3});
});
