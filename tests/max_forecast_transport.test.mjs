import test from 'node:test';
import assert from 'node:assert/strict';
import {MaxAdapter} from '../netunim-kupa/bank-bridge/max-adapter.mjs';
import {createCreditProvider} from '../netunim-kupa/bank-bridge/credit-provider.mjs';
import {buildCreditDataDiagnosticPayload} from '../netunim-kupa/bank-bridge/credit-data-diagnostics.mjs';
import {mergeCreditSyncResult as kupa} from '../netunim-kupa/site/assets/js/domains/credit/sync-feed.js';
import {mergeCreditSyncResult as orders} from '../netunim-orders/site/assets/js/domains/finance/credit-feed.js';

const now='2026-11-17T12:00:00Z',profile={profileId:'synthetic',provider:'max',label:'Synthetic',credentials:{username:'private-user',password:'private-password'}};
const raw=(fields={})=>({shortCardNumber:'0042',purchaseDate:'2026-11-03',paymentDate:'2026-11-20',merchantName:'PRIVATE-MERCHANT',
 originalAmount:100,originalCurrency:'ILS',actualPaymentAmount:100,paymentCurrency:376,planName:'רגילה',dealData:{arn:'private-identifier'},...fields});
async function run(fault={},core={result:{transactions:[raw()]}},syncMode='forecast'){
 const requested=[],closed=[];
 const page={evaluate:async(_fn,url)=>{
  let data={result:[]};
  if(url.includes('getHomePageData'))data={Result:{UserCards:{Cards:[{Last4Digits:'0042'}]}}};
  if(url.includes('getTransactionsAndGraphs')){
   const filter=JSON.parse(new URL(url).searchParams.get('filterData'));
   assert.equal(filter.userIndex,-1);assert.equal(filter.cardIndex,-1);assert.equal(filter.monthView,true);assert.equal(filter.bankAccount.bankAccountIndex,-1);
   const month=filter.date.replace(/-(\d)-01$/,'-0$1-01').slice(0,7);requested.push(month);
   if(fault[month]){const f=fault[month];if(f.throw)throw f.throw;return {status:f.status??200,body:f.body??JSON.stringify(f.data),retryAfter:f.retryAfter||''};}
   data=month==='2026-11'?core:{result:{transactions:[]}};
  }
  return {status:200,body:JSON.stringify(data),retryAfter:''};
 }};
 const provider=createCreditProvider({sessions:{scrape:()=>new MaxAdapter({profile,companyId:'max',syncMode,now:()=>new Date(now),
  createScraper:()=>({page,initialize:async()=>{},login:async()=>({success:true}),terminate:async success=>closed.push(success)})}).scrape()},identity:{remove:async()=>{}},diagnostics:{record:()=>{}}});
 return {result:await provider.scrape([profile]),requested,closed};
}
test('MAX isolates optional HTTP 503, network, JSON and normalization failures from verified core',async()=>{
 for(const fault of [{status:503,body:'{"error":"private-response"}'},{throw:new Error('private-network')},
  {body:'not-json-private'},{data:{result:{transactions:[raw(),raw({paymentDate:'invalid'})]}}}]){
  const {result}=await run({'2027-01':fault});
  assert.equal(result.coreSuccessCount,1);assert.equal(result.errors.length,1);
  assert.equal(result.errors[0].component,'forecast_transactions');assert.equal(result.errors[0].severity,'warning');
  const month=result.profiles[0].accounts[0].months.find(m=>m.month==='2027-01');
  assert.notEqual(month.fetchStatus,'success');assert.equal(month.fetchedAt,null);
  assert.equal(result.profiles[0].accounts[0].months.find(m=>m.month==='2026-11').transactions.length,1);
 }
});
const noData=code=>({returnCode:code,rcDesc:null,result:null,correlationID:'synthetic-correlation'});
test('MAX provider-defined no-transaction codes 10 and 11 verify empty forecast months without warnings',async()=>{
 for(const code of [10,11]){
  const faults=Object.fromEntries(Array.from({length:11},(_,i)=>['2027-'+String(i+1).padStart(2,'0'),{data:noData(code)}]));
  const {result}=await run(faults);assert.equal(result.coreSuccessCount,1);assert.equal(result.errors.length,0);
  const month=result.profiles[0].accounts[0].months.find(m=>m.month==='2027-01');
  assert.equal(month.fetchStatus,'success');assert.ok(month.fetchedAt);assert.deepEqual(month.transactions,[]);
  const diagnostic=buildCreditDataDiagnosticPayload({profiles:[profile],rawSamples:result._dataDiagnostics});
  const evidence=diagnostic.profiles[0].providerEvidence.find(e=>e.month==='2027-01').response;
  assert.equal(evidence.returnCode,code);assert.equal(evidence.outcome,'verified_empty');assert.equal(evidence.reason,'provider_no_transactions');
 }
});
test('MAX temporary failure 9 and row limit 13 are never treated as empty transactions',async()=>{
 for(const code of [9,13]){
  const {result}=await run({'2027-01':{data:noData(code)}});
  assert.equal(result.coreSuccessCount,1);assert.equal(result.errors.length,1);
  const month=result.profiles[0].accounts[0].months.find(m=>m.month==='2027-01');assert.notEqual(month.fetchStatus,'success');assert.equal(month.fetchedAt,null);
  const diagnostic=buildCreditDataDiagnosticPayload({profiles:[profile],rawSamples:result._dataDiagnostics});
  assert.notEqual(diagnostic.profiles[0].providerEvidence.find(e=>e.month==='2027-01').response.outcome,'verified_empty');
 }
});
test('MAX unknown business rejection codes stop the profile instead of being downgraded to forecast warnings',async()=>{
 for(const code of [42,401]){
  const {result,requested,closed}=await run({'2027-01':{data:noData(code)}});
  assert.equal(result.coreSuccessCount,0);assert.deepEqual(closed,[false]);assert.equal(requested.at(-1),'2027-01');
 }
});
test('MAX confirmed provider empty replies cannot erase protected future history, including recovery',async()=>{
 for(const mode of ['forecast','recovery']){
  const seed=(await run({}, {result:{transactions:[raw(),raw({paymentDate:'2027-01-20',dealData:{arn:'future'}})]}},mode)).result;
  const next=(await run({'2027-01':{data:noData(10)}},{result:{transactions:[raw()]}},mode)).result;
  for(const merge of [kupa,orders]){
   const before=merge({cardMappings:{'synthetic:0042':{included:true}}},seed),after=merge(before,next);
   assert.deepEqual(after.profiles[0].accounts[0].months.find(m=>m.month==='2027-01').transactions,before.profiles[0].accounts[0].months.find(m=>m.month==='2027-01').transactions);
   assert.ok(after.errors.some(e=>e.code==='CREDIT_HISTORICAL_MONTH_REGRESSION'));
  }
 }
});
test('MAX preserves prior future history and current pending on optional transport failure in both feeds',async()=>{
 const future=raw({paymentDate:'2027-01-20',dealData:{arn:'future'}}),pending=raw({purchaseDate:'2026-11-16',paymentDate:null,dealData:{arn:'pending'}});
 const seed=(await run({}, {result:{transactions:[raw(),future]}})).result;
 const next=(await run({'2027-01':{status:503,body:'{}'}},{result:{transactions:[raw(),pending]}})).result;
 for(const merge of [kupa,orders]){
  const before=merge({cardMappings:{'synthetic:0042':{included:true}}},seed),after=merge(before,next),account=after.profiles[0].accounts[0];
  assert.deepEqual(account.months.find(m=>m.month==='2027-01').transactions,before.profiles[0].accounts[0].months.find(m=>m.month==='2027-01').transactions);
  assert.equal(account.pendingTransactions.length,1);assert.ok(after.errors.length);
 }
});
test('MAX auth, automation blocks and rate limits abort the profile and stop later requests',async()=>{
 for(const status of [401,403,429]){
  const {result,requested,closed}=await run({'2027-01':{status,body:'{}',retryAfter:'120'}});
  assert.equal(result.coreSuccessCount,0);assert.deepEqual(closed,[false]);assert.equal(requested.at(-1),'2027-01');
 }
});
test('MAX core HTTP failure aborts publication and optional malformed months cannot leak any rows',async()=>{
 const core=await run({'2026-11':{status:503,body:'{}'}});
 assert.equal(core.result.coreSuccessCount,0);assert.equal(core.result.profiles.length,0);assert.deepEqual(core.closed,[false]);
 const partial=await run({'2027-01':{data:{result:{transactions:[raw({dealData:{arn:'must-not-leak'}}),raw({paymentDate:'invalid'})]}}}});
 assert.equal(partial.result.coreSuccessCount,1);
 const txns=partial.result.profiles[0].accounts[0].months.flatMap(m=>m.transactions);
 assert.equal(txns.length,1);assert.ok(txns.every(tx=>tx.id!=='must-not-leak'));
});
test('MAX all optional forecast failures preserve old rows and their original verification time',async()=>{
 const seed=(await run({}, {result:{transactions:[raw(),raw({paymentDate:'2027-01-20',dealData:{arn:'future'}})]}})).result;
 const faults=Object.fromEntries(Array.from({length:11},(_,i)=>['2027-'+String(i+1).padStart(2,'0'),{status:503,body:'{}'}]));
 const next=(await run(faults)).result;assert.equal(next.coreSuccessCount,1);assert.equal(next.errors.length,11);
 for(const merge of [kupa,orders]){
  const before=merge({cardMappings:{'synthetic:0042':{included:true}}},seed),after=merge(before,next);
  const old=before.profiles[0].accounts[0].months.find(m=>m.month==='2027-01'),current=after.profiles[0].accounts[0].months.find(m=>m.month==='2027-01');
  assert.deepEqual(current.transactions,old.transactions);assert.equal(current.fetchedAt,old.fetchedAt);assert.equal(current.status,'stale');
 }
});
test('MAX rejected core and forecast responses survive diagnostic export without response values',async()=>{
 for(const month of ['2026-11','2027-01']){
  const {result}=await run({[month]:{data:{result:null,token:'PRIVATE-TOKEN',message:'PRIVATE-NAME'}}});
  const diagnostic=buildCreditDataDiagnosticPayload({profiles:[profile],rawSamples:result._dataDiagnostics});
  const evidence=diagnostic.profiles[0].providerEvidence.find(e=>e.month===month);
  assert.ok(evidence?.response,'missing rejected response evidence');assert.equal(evidence.response.resultType,'null');
  assert.equal(evidence.response.httpStatus,200);assert.equal(evidence.response.outcome,'unrecognized_schema');
  assert.equal(evidence.response.reason,'result_null');
  assert.doesNotMatch(JSON.stringify(evidence),/PRIVATE-TOKEN|PRIVATE-NAME|private-password|PRIVATE-MERCHANT/);
 }
});
