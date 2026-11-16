import test from 'node:test';
import assert from 'node:assert/strict';
import {extractMaxTransactionCandidates,normalizeMaxRawTransaction} from '../netunim-kupa/bank-bridge/max-model.mjs';
import {MaxAdapter} from '../netunim-kupa/bank-bridge/max-adapter.mjs';
import {createCreditProvider} from '../netunim-kupa/bank-bridge/credit-provider.mjs';
import {mergeCreditSyncResult as kupa} from '../netunim-kupa/site/assets/js/domains/credit/sync-feed.js';
import {mergeCreditSyncResult as orders} from '../netunim-orders/site/assets/js/domains/finance/credit-feed.js';
const now='2026-11-16T12:00:00Z';
const raw=(fields={})=>({shortCardNumber:'0042',purchaseDate:'2026-11-03',paymentDate:'2026-11-20',merchantName:'Synthetic merchant',
  originalAmount:100,originalCurrency:'ILS',actualPaymentAmount:100,paymentCurrency:376,planName:'רגילה',dealData:{arn:'synthetic',purchaseTime:'10:01'},...fields});
const unknown={newCard:'0042',newDate:'2026-11-03',newAmount:100,newMerchant:'sensitive-unrecognized-value'};
async function run(data,{syncMode='quick',overrides={}}={}){
 const closed=[],profile={profileId:'P',provider:'max',label:'Synthetic',credentials:{username:'synthetic',password:'synthetic'}};
 const monthly=url=>{const month=JSON.parse(new URL(url).searchParams.get('filterData')).date.replace(/-(\d)-01$/,'-0$1-01').slice(0,7);return Object.hasOwn(overrides,month)?overrides[month]:month==='2026-11'?data:{result:{transactions:[]}}};
 const page={evaluate:async(_fn,url)=>({status:200,retryAfter:'',body:JSON.stringify(url.includes('getCategories')?{result:[]}:
   url.includes('getHomePageData')?{Result:{UserCards:{Cards:[{Last4Digits:'0042',CreditLimit:1000,OpenToBuy:900,CycleSummary:[{Date:'2026-11-20',CurrencySymbol:'₪'}]}]}}}:
   monthly(url))})};
 const provider=createCreditProvider({sessions:{scrape:()=>new MaxAdapter({profile,companyId:'max',syncMode,now:()=>new Date(now),
   createScraper:()=>({page,initialize:async()=>{},login:async()=>({success:true}),terminate:async value=>closed.push(value)})}).scrape()},identity:{remove:async()=>{}},diagnostics:{record:()=>{}}});
 const result=await provider.scrape([profile]);assert.deepEqual(closed,[result.coreSuccessCount===1]);return result;
}
const schema=error=>error.code==='CREDIT_PROVIDER_SCHEMA_ERROR';
test('MAX rejects nonempty known transaction lists whose field names are unrecognized',()=>{
 assert.throws(()=>extractMaxTransactionCandidates({result:{transactions:[unknown]}}),schema);
});
test('MAX rejects a partially recognized transaction list rather than returning only its valid rows',()=>{
 assert.throws(()=>extractMaxTransactionCandidates({result:{transactions:[raw(),unknown]}}),schema);
});
test('MAX schema failures preserve saved pending and completed rows in both real feeds',async()=>{
 const pending=raw({paymentDate:null,actualPaymentAmount:0,merchantName:'Pending merchant',dealData:{arn:'pending',purchaseTime:'11:02'}});
 const prior=await run({result:{transactions:[raw(),pending]}});assert.equal(prior.coreSuccessCount,1);
 for(const data of [{result:{transactions:[unknown]}},{result:{transactions:[raw(),unknown]}}]){
  const result=await run(data);assert.equal(result.coreSuccessCount,0);assert.equal(result.syncedAt,null);assert.equal(result.profiles.length,0);
  assert.equal(result.errors[0].code,'CREDIT_PROVIDER_SCHEMA_ERROR');
  assert.ok(result.errors[0].stage.includes('2026-11'));
  for(const merge of [kupa,orders]){
   const before=merge({cardMappings:{'P:0042':{included:true}}},{...prior,syncedAt:now}),wire=JSON.stringify(before),after=merge(before,result);
   assert.equal(after.profiles[0].accounts[0].pendingTransactions.length,1);
   assert.deepEqual(after.profiles[0].accounts[0].months,before.profiles[0].accounts[0].months);
   assert.ok(after.errors.length);assert.equal(JSON.stringify(before),wire);
  }
  const publicError=JSON.stringify(result.errors);assert.ok(!publicError.includes('sensitive-unrecognized-value'));assert.ok(!publicError.includes('newCard'));
 }
});
test('MAX rejects nonempty invalid or impossible billing dates instead of completing an unassigned row',()=>{
 for(const paymentDate of ['not-a-date','2026-02-30','2026-04-31','2026-11-20T24:00:00','31/02/2026',true,false,0,[],{}])
  assert.throws(()=>normalizeMaxRawTransaction(raw({paymentDate})),schema,String(paymentDate));
});
test('MAX explicit empty transaction lists remain authoritative with recognized nonfinancial metadata',async()=>{
 const data={result:{transactions:[],categories:[{id:1,currency:'ILS',ilsSum:0,sum:0},{id:2,sum:0}],totalCycle:[{currency:'ILS',pastDebit:0,futureDebit:0,totalAmount:0},{currency:'USD',totalAmount:0}],
  barsGraphDetailsResult:{monthlySummary:[{actualDebitSumNIS:0,date:'2026-11',isFutureDebit:false}]},cancelDenialData:{cancelDenialReasons:[{reasonId:1,reasonText:'Synthetic'}]}}};
 assert.equal(extractMaxTransactionCandidates(data).transactions.length,0);
 const result=await run(data);assert.equal(result.coreSuccessCount,1);assert.equal(result.errors.length,0);
 assert.ok(result.profiles[0].accounts[0].months.every(m=>m.fetchStatus==='success'&&m.transactions.length===0));
});

test('MAX requires an identifiable result and list before accepting an empty month',()=>{
 for(const data of [{},{result:null},{result:[]},{result:{}},{result:{categories:[]}},
  {result:{transactions:null}},{result:{transactions:{}}},{result:{transactions:[null]}},
  {result:{transactions:[],newPurchases:[unknown]}}])assert.throws(()=>extractMaxTransactionCandidates(data),schema);
});
test('MAX does not mistake metadata or a depth-truncated reply for fully parsed transactions',()=>{
 assert.throws(()=>extractMaxTransactionCandidates({result:{transactions:[],categories:[unknown]}}),schema);
 let nested={transactions:[raw()]};for(let i=0;i<12;i++)nested={child:nested};
 assert.throws(()=>extractMaxTransactionCandidates({result:{transactions:[],nested}}),schema);
});
test('MAX still discovers valid nested foreign rows and deduplicates identical views',()=>{
 const r=raw({originalCurrency:'USD'}),data={result:{transactions:[],foreignAndCurrency:{chargedNow:[r]},mirror:[structuredClone(r)]}};
 assert.equal(extractMaxTransactionCandidates(data).transactions.length,1);
 assert.equal(extractMaxTransactionCandidates({result:{foreignAndCurrency:{chargedNow:[]}}}).transactions.length,0);
});
test('MAX calendar validation accepts leap dates, explicit offsets and existing provider formats',()=>{
 for(const [paymentDate,expected]of [['29/02/2024','2024-02-29T00:00:00.000Z'],['2024-02-29','2024-02-29T00:00:00.000Z'],
  ['2026-11-20T23:10:20.123+02:00','2026-11-20T21:10:20.123Z'],['20.11.2026 09:02:01','2026-11-20T09:02:01.000Z']])
  assert.equal(normalizeMaxRawTransaction(raw({paymentDate})).processedDate,expected);
 for(const paymentDate of [null,undefined,'','   '])assert.equal(normalizeMaxRawTransaction(raw({paymentDate})).status,'pending');
});
test('MAX invalid calendar dates also fail through the actual provider and keep pending data',async()=>{
 const seed=await run({result:{transactions:[raw({paymentDate:null})]}});
 for(const paymentDate of ['2026-02-30','invalid']){
  const result=await run({result:{transactions:[raw({paymentDate})]}});assert.equal(result.coreSuccessCount,0);
  for(const merge of [kupa,orders]){
   const before=merge({cardMappings:{'P:0042':{included:true}}},seed),after=merge(before,result);
   assert.equal(after.profiles[0].accounts[0].pendingTransactions.length,1);assert.ok(after.errors.length);
  }
 }
});
test('MAX an explicitly verified empty reply can retire an expired pending authorization',async()=>{
 const seed=await run({result:{transactions:[raw({paymentDate:null})]}}),empty=await run({result:{transactions:[]}});
 for(const merge of [kupa,orders]){
  const before=merge({cardMappings:{'P:0042':{included:true}}},seed),after=merge(before,empty);
  assert.equal(after.profiles[0].accounts[0].pendingTransactions.length,0);assert.equal(after.errors.length,0);
 }
});

test('MAX optional future schema failures warn, keep core/pending data and preserve future history in both feeds',async()=>{
 const future=raw({paymentDate:'2027-01-20',dealData:{arn:'future',purchaseTime:'10:01'},originalAmount:900,actualPaymentAmount:900});
 const seed=await run({result:{transactions:[raw(),future]}},{syncMode:'forecast'});
 const pending=raw({paymentDate:null,actualPaymentAmount:0,merchantName:'Pending merchant',dealData:{arn:'pending',purchaseTime:'11:02'}});
 const result=await run({result:{transactions:[raw(),pending]}},{syncMode:'forecast',overrides:{'2027-01':{result:null}}});
 assert.equal(result.coreSuccessCount,1);assert.equal(result.profiles[0].coreComplete,true);
 assert.equal(result.errors.length,1);assert.equal(result.errors[0].severity,'warning');assert.equal(result.errors[0].month,'2027-01');
 const slice=result.profiles[0].accounts[0].months.find(m=>m.month==='2027-01');
 assert.equal(slice.fetchStatus,'schema_error');assert.equal(slice.fetchedAt,null);assert.ok(slice.providerSchemaVersion.startsWith('max-'));
 for(const merge of [kupa,orders]){
  const before=merge({cardMappings:{'P:0042':{included:true}}},seed),after=merge(before,result);
  const old=before.profiles[0].accounts[0].months.find(m=>m.month==='2027-01'),next=after.profiles[0].accounts[0].months.find(m=>m.month==='2027-01');
  assert.deepEqual(next.transactions,old.transactions);assert.equal(after.profiles[0].accounts[0].pendingTransactions.length,1);
  assert.ok(!after.errors.some(e=>e.code==='CREDIT_HISTORICAL_MONTH_REGRESSION'));
 }
});
test('MAX the observed far-future missing-result pattern is never reported as verified empty',async()=>{
 const overrides=Object.fromEntries(Array.from({length:11},(_,i)=>['2027-'+String(i+1).padStart(2,'0'),{result:null}]));
 const result=await run({result:{transactions:[raw()]}},{syncMode:'forecast',overrides});
 assert.equal(result.coreSuccessCount,1);assert.equal(result.errors.length,11);assert.ok(result.errors.every(e=>e.severity==='warning'));
 const months=result.profiles[0].accounts[0].months;
 assert.equal(months.filter(m=>m.fetchStatus==='schema_error').length,11);assert.equal(months.find(m=>m.month==='2026-11').fetchStatus,'success');
});
