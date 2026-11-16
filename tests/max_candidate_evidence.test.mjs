import test from 'node:test';
import assert from 'node:assert/strict';
import {extractMaxTransactionCandidates} from '../netunim-kupa/bank-bridge/max-model.mjs';
import {MaxAdapter} from '../netunim-kupa/bank-bridge/max-adapter.mjs';
import {createCreditProvider} from '../netunim-kupa/bank-bridge/credit-provider.mjs';
import {mergeCreditSyncResult as kupa} from '../netunim-kupa/site/assets/js/domains/credit/sync-feed.js';
import {mergeCreditSyncResult as orders} from '../netunim-orders/site/assets/js/domains/finance/credit-feed.js';
import {creditBillingRowsData} from '../shared/credit-billing-cycles.js';
const now='2026-11-16T12:00:00Z';
const raw=(fields={})=>({shortCardNumber:'0042',purchaseDate:'2026-11-03',paymentDate:'2026-11-20',
  merchantName:'Merchant A',originalAmount:100,originalCurrency:'ILS',actualPaymentAmount:100,
  paymentCurrency:376,comments:'',planName:'רגילה',planTypeId:5,dealData:{arn:'REUSED',purchaseTime:'10:01'},...fields});
const response=rows=>({result:{transactions:rows,details:{transactions:structuredClone(rows.filter(r=>r.dealData?.arn))}}});
async function scrape(data){
  let cleanup=null;
  const page={evaluate:async(_fn,url)=>({status:200,retryAfter:'',body:JSON.stringify(
    url.includes('getCategories')?{result:[]}:url.includes('getHomePageData')?{Result:{UserCards:{Cards:[]}}}:
      String(JSON.parse(new URL(url).searchParams.get('filterData')).date)==='2026-11-01'?data:{result:{transactions:[]}})})};
  const adapter=new MaxAdapter({profile:{profileId:'P',provider:'max',label:'Synthetic',credentials:{username:'synthetic',password:'synthetic'}},
    companyId:'max',now:()=>new Date(now),syncMode:'quick',createScraper:()=>({page,initialize:async()=>{},login:async()=>({success:true}),terminate:async value=>{cleanup=value}})});
  try{const result=await adapter.scrape();assert.equal(cleanup,result.coreComplete);return result}
  catch(error){assert.equal(cleanup,false);throw error}
}
function state(merge,profile,old={}){
  const cardMappings=Object.fromEntries(profile.accounts.map(a=>['P:'+a.accountNumber,{included:true,account:'עסקי'}]));
  return {creditSync:merge({cardMappings,...old},{syncedAt:now,profiles:[profile]})};
}
function total(value){return creditBillingRowsData(value,{asOf:'2026-11-16'}).reduce((sum,row)=>sum+row.amount,0)}
for(const [label,second,count,amount] of [
  ['exact page mirror',raw(),1,100],
  ['different amounts',raw({originalAmount:200,actualPaymentAmount:200}),2,300],
  ['different merchants',raw({merchantName:'Merchant B'}),2,200],
  ['different purchase times',raw({dealData:{arn:'REUSED',purchaseTime:'11:02'}}),2,200],
  ['different cards',raw({shortCardNumber:'7755'}),2,200],
])test('MAX candidate '+label+' survives the real adapter, both feeds, billing and replay',async()=>{
  const data=response([raw(),second]),wire=JSON.stringify(data);
  assert.equal(extractMaxTransactionCandidates(data).transactions.length,count);
  const profile=await scrape(data);assert.equal(profile.coreComplete,true);
  assert.equal(profile.accounts.flatMap(a=>a.months.flatMap(m=>m.transactions)).length,count);
  if(label==='different cards')assert.equal(profile.accounts.length,2);
  for(const merge of [kupa,orders]){
    const first=state(merge,profile);assert.equal(first.creditSync.errors.length,0);assert.equal(total(first),amount);
    const replay=state(merge,profile,first.creditSync);assert.equal(replay.creditSync.errors.length,0);assert.equal(total(replay),amount);
  }
  assert.equal(JSON.stringify(data),wire);
});

test('MAX a partial refresh cannot erase a newly retained repeated-ID purchase',async()=>{
  const complete=await scrape(response([raw(),raw({merchantName:'Merchant B',actualPaymentAmount:200,originalAmount:200})]));
  const partial=await scrape(response([raw()]));
  for(const merge of [kupa,orders]){
    const before=state(merge,complete),after=state(merge,partial,before.creditSync);
    assert.equal(total(before),300);assert.equal(total(after),300);
    assert.ok(after.creditSync.errors.some(e=>e.code==='CREDIT_HISTORICAL_MONTH_REGRESSION'));
  }
});

for(const [label,second] of [
  ['conflicting settlement',raw({actualPaymentAmount:200})],
  ['conflicting memo',raw({comments:'Different comment'})],
  ['incomplete purchase evidence',raw({merchantName:'Merchant B',originalAmount:null})],
  ['ambiguous card suffix',raw({shortCardNumber:'12340042'})],
])test('MAX blocks '+label+' without publishing a second charge or replacing history',async()=>{
  const data=response([raw(),second]);
  assert.throws(()=>extractMaxTransactionCandidates(data),error=>error.code==='CREDIT_PROVIDER_SCHEMA_ERROR'&&error.stage==='MaxTransactions');
  const prior=await scrape(response([raw()]));
  const provider=createCreditProvider({sessions:{scrape:()=>scrape(data)},identity:{remove:async()=>{}},diagnostics:{record:()=>{}}});
  const failed=await provider.scrape([{profileId:'P',provider:'max',label:'Synthetic'}]);
  assert.equal(failed.coreSuccessCount,0);assert.equal(failed.syncedAt,null);assert.equal(failed.profiles.length,0);
  assert.equal(failed.errors[0].code,'CREDIT_PROVIDER_SCHEMA_ERROR');
  for(const merge of [kupa,orders]){
    const before=state(merge,prior),after={creditSync:merge(before.creditSync,failed)};
    assert.equal(total(after),100);assert.ok(after.creditSync.errors.length>0);
  }
  assert.ok(!JSON.stringify(failed.errors).includes('REUSED'));
});

test('MAX anonymous multiplicity is preserved within a list; mirror placement stays ambiguous',async()=>{
  const a=raw({dealData:{purchaseTime:'10:01'}}),data={result:{transactions:[a,structuredClone(a)]}};
  assert.equal(extractMaxTransactionCandidates(data).transactions.length,2);
  const profile=await scrape(data);
  for(const merge of [kupa,orders])assert.equal(total(state(merge,profile)),200);
  assert.throws(()=>extractMaxTransactionCandidates({result:{transactions:[a],anotherView:[structuredClone(a)]}}),{code:'CREDIT_PROVIDER_SCHEMA_ERROR'});
});

test('MAX keeps refunds, foreign money, installments and pending/final transitions',async()=>{
  const rows=[raw(),raw({actualPaymentAmount:-40,originalAmount:-40}),
    raw({actualPaymentAmount:365,originalAmount:100,originalCurrency:'USD',merchantName:'Foreign merchant'}),
    raw({comments:'תשלום 1 מתוך 2',actualPaymentAmount:50}),raw({comments:'תשלום 2 מתוך 2',actualPaymentAmount:50}),
    raw({paymentDate:null,actualPaymentAmount:0})];
  const profile=await scrape(response(rows));assert.equal(profile.coreComplete,true);
  for(const merge of [kupa,orders])assert.equal(total(state(merge,profile)),525);
});
