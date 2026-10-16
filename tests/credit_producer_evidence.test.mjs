import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {normalizeCreditScrapeTransaction as transaction,normalizeCreditMonthSlice as month,
  normalizeCreditScrapeAccount as account} from '../netunim-kupa/bank-bridge/credit-transaction-model.mjs';
import {readCreditRefreshResult} from '../shared/credit-refresh-result.js';
import {creditDebitAmount} from '../netunim-kupa/bank-bridge/credit-core-values.mjs';
import {normalizeVisaCalTransaction} from '../netunim-kupa/bank-bridge/visa-cal-model.mjs';
import {normalizeMaxRawTransaction} from '../netunim-kupa/bank-bridge/max-model.mjs';
const tx={id:'T',status:'completed',chargedAmount:20};
const slice={month:'2026-10',fetchStatus:'success',transactions:[tx]};
function rejected(fn){assert.throws(fn,{code:'CREDIT_PROVIDER_SCHEMA_ERROR',stage:'Transactions',retryable:false})}
test('raw issuer amount adapters reject JSON containers and booleans before sign/format conversion',()=>{
  for(const bad of [true,false,[],[120],{},Infinity,NaN]){
    rejected(()=>creditDebitAmount(bad));
    rejected(()=>normalizeVisaCalTransaction({trnAmt:bad}));
    rejected(()=>normalizeMaxRawTransaction({shortCardNumber:'1234',purchaseDate:'2026-10-01',merchantName:'Test',originalAmount:bad,actualPaymentAmount:120}));
  }
  assert.equal(creditDebitAmount('120.50'),-120.5);
  assert.equal(creditDebitAmount(null),null);
  assert.equal(normalizeMaxRawTransaction({shortCardNumber:'1234',purchaseDate:'2026-10-01',merchantName:'Test',originalAmount:'1,200.50',actualPaymentAmount:'120.50'}).chargedAmount,-120.5);
});
test('Bridge rejects monetary and installment evidence before any coercion can make it look valid',()=>{
  for(const bad of [true,false,[],{},'', ' ',Infinity,NaN]){
    rejected(()=>transaction({...tx,chargedAmount:bad}));
    rejected(()=>transaction({...tx,originalAmount:bad}));
    for(const field of ['balance','cardFrame','availableCredit'])rejected(()=>account({[field]:bad}));
  }
  for(const installments of [{number:1.9,total:3},{number:true,total:3},{number:4,total:3}])rejected(()=>transaction({...tx,installments}));
  for(const foreignTransaction of ['false',0])rejected(()=>transaction({...tx,foreignTransaction}));
});
test('Bridge cannot turn missing successful monthly/pending arrays into authoritative empty results',()=>{
  for(const transactions of [undefined,null,false,{}])rejected(()=>month({...slice,transactions}));
  rejected(()=>account({months:[{month:'2026-10',fetchStatus:'success'}]}));
  rejected(()=>account({pendingStatus:'success'}));
  for(const nested of [{txns:[{...tx,chargedAmount:true}]},{pendingTransactions:[{...tx,status:'unknown'}]},
    {unassignedTransactions:[null]},{months:[{...slice,transactions:new Array(1)}]}])rejected(()=>account(nested));
});
test('valid normalized Bridge output is accepted by the identical browser contract',()=>{
  const normalized=account({accountNumber:'C',balance:'-20.50',cardFrame:1000,
    months:[{...slice,transactions:[{...tx,chargedAmount:'20.50',originalAmount:null,installments:{number:1,total:3}}]}],
    pendingStatus:'success',pendingTransactions:[]},'max');
  const accepted=readCreditRefreshResult({contractVersion:2,profiles:[{profileId:'P',accounts:[normalized]}]});
  assert.equal(accepted.profiles[0].accounts[0].months[0].transactions[0].chargedAmount,20.5);
  assert.equal(normalized.availableCredit,979.5);
  assert.deepEqual(month({...slice,transactions:[]}).transactions,[]);
  assert.deepEqual(month({month:'2026-10',fetchStatus:'schema_error'}).transactions,[]);
  assert.equal(fs.readFileSync('shared/credit-transaction-evidence.js','utf8').replaceAll('\r\n','\n'),
    fs.readFileSync('netunim-kupa/bank-bridge/credit-transaction-evidence.mjs','utf8').replaceAll('\r\n','\n'));
});
test('three actual producer-guard mutations reproduce the previously accepted evidence laundering',async()=>{
  const original=fs.readFileSync('netunim-kupa/bank-bridge/credit-transaction-model.mjs','utf8');
  for(const [guard,name,invoke,observed] of [
    ['assertCreditTransactionEvidence(tx)','normalizeCreditScrapeTransaction',fn=>fn({...tx,installments:{number:1.9,total:3}}).installments.number,1],
    ['assertCreditProfileTransactions({accounts:[{months:[slice]}]})','normalizeCreditMonthSlice',fn=>fn({month:'2026-10',fetchStatus:'success'}).transactions,[]],
    ['assertCreditProfileTransactions({accounts:[account]})','normalizeCreditScrapeAccount',fn=>fn({pendingStatus:'success'}).pendingTransactions,[]],
  ]){
    const source=original.replace('assertProviderEvidence(()=>'+guard+');','');
    assert.notEqual(source,original);
    const absolute=source.replaceAll(/(['"])\.\/(.*?)\1/g,(_,quote,file)=>JSON.stringify(new URL('../netunim-kupa/bank-bridge/'+file,import.meta.url).href));
    const mutant=await import('data:text/javascript;base64,'+Buffer.from(absolute).toString('base64'));
    assert.deepEqual(invoke(mutant[name]),observed);
  }
});
test('removing the raw numeric guard reproduces invented issuer money before normalized evidence exists',async()=>{
  const original=fs.readFileSync('netunim-kupa/bank-bridge/credit-core-values.mjs','utf8');
  const source=original.replace('assertCreditNumericInput(value);','');
  assert.notEqual(source,original);
  const mutant=await import('data:text/javascript;base64,'+Buffer.from(source).toString('base64'));
  assert.equal(mutant.creditDebitAmount(true),-1);
  assert.equal(mutant.creditDebitAmount([120]),-120);
});
