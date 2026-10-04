import test from 'node:test';
import assert from 'node:assert/strict';
import {creditBillingRowsData,creditTransactionAmountData} from '../shared/credit-billing-cycles.js';
import {kupaAccountCashflowData} from '../shared/kupa-cashflow.js';
import {mergeCreditSyncResult,normalizeCreditSync} from '../netunim-kupa/site/assets/js/domains/credit/sync-feed.js';
import {normalizeCreditSync as ordersNormalize} from '../netunim-orders/site/assets/js/domains/finance/credit-feed.js';
import {creditMonthlyDetailData,creditUpcomingDetailData} from '../netunim-kupa/site/assets/js/domains/credit/model.js';
import {creditDetailRowMarkup} from '../netunim-orders/site/assets/js/domains/finance/credit-detail-view.js';
import {MaxAdapter,normalizeMaxRawTransaction,normalizeVisaCalTransaction} from '../netunim-kupa/bank-bridge/credit-adapters.mjs';
import {normalizeAmexDigitalV3ApprovedTransaction,normalizeAmexDigitalV3Voucher} from '../netunim-kupa/bank-bridge/amex-digitalv3.mjs';
import {normalizeIsracardDigitalV3ApprovedTransaction,normalizeIsracardDigitalV3Voucher} from '../netunim-kupa/bank-bridge/isracard-digitalv3.mjs';
import {normalizeIsracardFamilyTransaction} from '../netunim-kupa/bank-bridge/isracard-camoufox.mjs';
import {creditDetailDayMatch,creditDetailMonthDayMatch,creditDetailMonthlySections,creditDetailRangeMatch,creditDetailChargeCycleKey} from '../shared/credit-detail-controls.js';

const due='2026-09-10';
function stateFor(provider,txns){return {credits:[],expenses:[],checks:[],bank:{currentBalance:10000,source:'hapoalim',asOfDate:due,feed:{balance:10000,syncedAt:due,transactions:[]}},creditSync:normalizeCreditSync({version:4,profiles:[{profileId:'p',provider,accounts:[{accountNumber:'1234',balanceDate:due,pendingStatus:'success',pendingFetchedAt:due,txns}]}],cardMappings:{'p:1234':{included:true,account:'עסקי'}}})}}
const clean=text=>text.replace(/[\u200e\u200f\u061c]/g,'');
function maxScraperForRows(rows,{card='1234'}={}){const page={evaluate:async(_fn,url)=>{let data;if(url.includes('/getCategories'))data={result:[]};else if(url.includes('/getHomePageData'))data={Result:{UserCards:{Cards:[{Last4Digits:card,CreditLimit:1000,OpenToBuy:900,CycleSummary:[]}]}}};else{const filter=JSON.parse(new URL(url).searchParams.get('filterData')||'{}'),month=String(filter.date||'').replace(/-(\d)-01$/,'-0$1-01').slice(0,7);data={result:{transactions:month==='2026-09'?rows:[]}}}return {status:200,body:JSON.stringify(data),retryAfter:''}}};return {page,initialize:async()=>{},login:async()=>({success:true}),terminate:async()=>{}}}

test('all issuers retain refund signs in original amounts, series totals and rendered transaction columns',()=>{
  for(const provider of ['visaCal','max','isracard','amex']){
    const state=stateFor(provider,[
      {id:'refund',status:'completed',processedDate:due,chargedAmount:4.50,originalAmount:4.50,chargedCurrency:'ILS',originalCurrency:'ILS'},
      {id:'installment-refund',status:'completed',processedDate:due,chargedAmount:50,originalAmount:100,chargedCurrency:'ILS',originalCurrency:'ILS',installments:{number:1,total:2}},
      {id:'purchase',status:'completed',processedDate:due,chargedAmount:-50,originalAmount:-100,chargedCurrency:'ILS',originalCurrency:'ILS',installments:{number:1,total:2}},
    ]),rows=creditBillingRowsData(state,{asOf:due}),refund=rows.find(row=>row.creditId.includes('|refund|')),installment=rows.find(row=>row.creditId.includes('|installment-refund|'));
    assert.equal(refund.amount,-4.50);assert.equal(refund.displayAmount,-4.50);assert.equal(refund.originalAmount,-4.50);assert.equal(refund.totalAmount,-4.50);assert.equal(refund.series.totalAmount,-4.50);
    assert.equal(installment.amount,-50);assert.equal(installment.totalAmount,-100);assert.equal(installment.series.totalAmount,-100,'negative full installment total must not be replaced by its single installment');
    assert.match(clean(creditDetailRowMarkup(refund)),/<td class="amount credit-detail-total">[^<]*-4\.50/);
    assert.match(clean(creditDetailRowMarkup(installment)),/<td class="amount credit-detail-total">[^<]*-100/);
    assert.equal(creditMonthlyDetailData(state,due).months[0].items.find(row=>row.creditId===refund.creditId).series.totalAmount,-4.50);
    assert.equal(kupaAccountCashflowData(state,'עסקי',due).credit,-4.50,'presentation must not change the charged cashflow sum');
    assert.deepEqual(ordersNormalize(state.creditSync),state.creditSync);
  }
});

test('all issuers distinguish finalized missing/zero charges from pending estimates',()=>{
  for(const provider of ['visaCal','max','isracard','amex'])for(const chargedAmount of [null,undefined,'',0]){
    const tx={id:'test',status:'completed',processedDate:due,chargedAmount,originalAmount:-17.90,chargedCurrency:'ILS',originalCurrency:'ILS'},state=stateFor(provider,[tx]),forecast=kupaAccountCashflowData(state,'עסקי',due),row=creditBillingRowsData(state,{asOf:due})[0];
    assert.equal(forecast.credit,0);assert.equal(forecast.forecastIncomplete,chargedAmount!==0);assert.equal(row.totalAmount,17.90,'the known face value remains available for display only');
    const pending=kupaAccountCashflowData(stateFor(provider,[{...tx,status:'pending',transactionDate:due}]),'עסקי',due);
    assert.equal(pending.credit,17.90,'a fresh authorization still estimates its original ILS amount');
  }
  const fx={status:'completed',chargedAmount:25,chargedCurrency:'ILS',originalAmount:10,originalCurrency:'USD',processedDate:due};
  const row=creditBillingRowsData(stateFor('max',[fx]),{asOf:due})[0];assert.equal(row.totalAmount,-25);assert.equal(row.originalAmount,-10);assert.match(clean(creditDetailRowMarkup(row)),/-10 USD/);
  const missing={...fx,chargedAmount:null};assert.equal(creditTransactionAmountData(missing).included,false);assert.equal(creditTransactionAmountData(missing).amount,0);
});

test('DigitalV3 issuers and Camoufox preserve signed refunds and reject null-to-zero coercion',()=>{
  for(const normalize of [normalizeAmexDigitalV3Voucher,normalizeIsracardDigitalV3Voucher])for(const amount of [null,undefined,'',' ',0,4.5,-4.5]){
    const tx=normalize({seqVoucherNumber:'v',purchaseDate:'09/09/2026',originalAmount:-10,billingAmount:amount,originalCurrencyIso:'ILS'},due);
    assert.equal(tx.originalAmount,10);assert.equal(tx.chargedAmount,typeof amount==='number'?(amount===0?0:-amount):null);
    assert.equal(creditTransactionAmountData(tx).amount,typeof amount==='number'?amount:0);
  }
  const discountedFee=normalizeIsracardDigitalV3Voucher({seqVoucherNumber:'fee',purchaseDate:'23/08/2026',originalAmount:19.25,billingAmount:9.62,originalCurrencyIso:'ILS',businessName:'פועלים- דמי כרטיס',discountAmount:9.63,moreInfo:'הנחה 9.63 ש"ח'},'2026-09-15');
  assert.equal(discountedFee.originalAmount,-19.25);assert.equal(discountedFee.chargedAmount,-9.62);assert.equal(discountedFee.memo,'הנחה 9.63 ש"ח');
  for(const normalize of [normalizeAmexDigitalV3ApprovedTransaction,normalizeIsracardDigitalV3ApprovedTransaction]){
    const tx=normalize({purchaseDate:'09/09/2026',originalAmount:20,ilsBillingAmount:null,currencyIso:'ILS'});assert.equal(tx.chargedAmount,null);assert.equal(creditTransactionAmountData(tx).amount,20);
  }
  for(const outbound of [false,true])for(const amount of [null,'',0,-4.5,4.5]){
    const raw=outbound?{dealSumOutbound:-10,paymentSumOutbound:amount,fullPurchaseDateOutbound:'09/09/2026',voucherNumberRatzOutbound:'123'}:{dealSum:-10,paymentSum:amount,fullPurchaseDate:'09/09/2026',voucherNumberRatz:'123'};
    const tx=normalizeIsracardFamilyTransaction({...raw,currencyId:'ILS'},due);assert.ok(tx);assert.equal(tx.originalAmount,10);assert.equal(tx.chargedAmount,typeof amount==='number'?(amount===0?0:-amount):null);
  }
  const cal=normalizeVisaCalTransaction({trnIntId:'c',trnTypeCode:'6',trnAmt:4.5,amtBeforeConvAndIndex:-4.5,trnPurchaseDate:due,debCrdDate:due,trnCurrencySymbol:'₪',debCrdCurrencySymbol:'₪'});
  assert.equal(cal.originalAmount,4.5);assert.equal(cal.chargedAmount,4.5);
});

test('MAX raw charged amount restores missingness lost by upstream unary minus without exporting raw data',async()=>{
  let options;const amounts=[null,'',0,-4.5],rawRows=amounts.map((amount,i)=>({shortCardNumber:'1234',purchaseDate:'2026-09-02T00:00:00',paymentDate:due,actualPaymentAmount:amount,originalAmount:i===3?-4.5:17.90,originalCurrency:'ILS',paymentCurrency:376,merchantName:`fixture ${i}`,planName:'רגילה',planTypeId:5,comments:'',dealData:{arn:String(i)}}));
  assert.deepEqual(rawRows.map(row=>normalizeMaxRawTransaction(row)?.chargedAmount),[null,null,0,4.5],'the local MAX mapper keeps missing and zero settlement amounts distinct');
  const profile={profileId:'p',provider:'max',label:'MAX',credentials:{username:'test',password:'test'}},adapter=new MaxAdapter({profile,companyId:'max',now:()=>new Date('2026-09-03T00:00:00Z'),syncMode:'quick',createScraper:input=>{options=input;return maxScraperForRows(rawRows)}});
  const result=await adapter.scrape(),rows=result.accounts[0].months.flatMap(month=>month.transactions);
  assert.equal(options.includeRawTransaction,true);assert.deepEqual(rows.map(tx=>tx.chargedAmount),[null,null,0,4.5]);assert.equal(rows[3].originalAmount,4.5);
  assert.ok(rows.every(tx=>!Object.hasOwn(tx,'rawTransaction')),'raw provider payload is only inspected locally');
});


test('monthly credit detail keeps finalized FX charges visible outside the 10/15 cycle and groups them first',()=>{
  const fx={id:'fx',status:'completed',date:'2026-09-03',foreignCurrency:true,detailCycleUncertain:false},regular={id:'regular',status:'completed',date:'2026-09-03',foreignCurrency:false},uncertain={id:'uncertain',status:'pending',detailCycleUncertain:true,foreignCurrency:true};
  assert.equal(creditDetailDayMatch(fx,'10'),false,'the generic day filter still describes only the regular 10/15 cycle');
  assert.equal(creditDetailMonthDayMatch(fx,'10'),true,'a finalized FX charge remains visible in its actual payment month even outside the monthly cycle day');
  assert.equal(creditDetailMonthDayMatch(regular,'10'),false,'ordinary rows still obey the selected charge-day cycle');
  assert.equal(creditDetailMonthDayMatch(uncertain,'10'),false,'pending/uncertain FX is not promoted into the finalized FX section');
  const sections=creditDetailMonthlySections([regular,uncertain,fx]);
  assert.deepEqual(sections.foreign.map(row=>row.id),['fx']);assert.deepEqual(sections.uncertain.map(row=>row.id),['uncertain']);assert.deepEqual(sections.regular.map(row=>row.id),['regular']);assert.deepEqual(sections.ordered.map(row=>row.id),['fx','uncertain','regular']);
});


test('MAX provider-marked foreign transactions settled in ILS remain visible as FX and pending snapshot is replaced by the final row',()=>{
  const pending={id:'',status:'pending',date:'2026-09-30T08:31:00.000Z',transactionDate:'2026-09-30T08:31:00.000Z',processedDate:null,transactionTime:'08:31',originalAmount:-110,originalCurrency:'ILS',chargedAmount:null,chargedCurrency:'ILS',foreignTransaction:true,description:'AKUSOLI.COM VILNIUS LT',memo:'חיוב עסקת חו"ל בש"ח'},final={...pending,id:'provider-final',status:'completed',date:'2026-09-30T00:00:00.000Z',transactionDate:'2026-09-30T00:00:00.000Z',processedDate:'2026-10-02T00:00:00.000Z',transactionTime:'08:31',chargedAmount:-110};
  const initial=normalizeCreditSync({version:4,profiles:[{profileId:'max-fx',provider:'max',syncedAt:'2026-10-01T08:00:00.000Z',accounts:[{accountNumber:'6326',balanceDate:'2026-10-11T00:00:00.000Z',pendingStatus:'success',pendingFetchedAt:'2026-10-01T08:00:00.000Z',pendingTransactions:[pending],months:[]}]}],cardMappings:{'max-fx:6326':{included:true,account:'עסקי'}}});
  assert.equal(initial.profiles[0].accounts[0].pendingTransactions[0].foreignTransaction,true,'the explicit MAX foreign marker survives local feed normalization while the row is pending');
  const merged=mergeCreditSyncResult(initial,{syncedAt:'2026-10-02T09:00:00.000Z',contractVersion:2,profiles:[{profileId:'max-fx',provider:'max',syncedAt:'2026-10-02T09:00:00.000Z',attemptedAt:'2026-10-02T09:00:00.000Z',coreComplete:true,accounts:[{accountNumber:'6326',pendingStatus:'success',pendingFetchedAt:'2026-10-02T09:00:00.000Z',pendingTransactions:[],months:[{month:'2026-10',tier:'core',fetchStatus:'success',status:'fresh',fetchedAt:'2026-10-02T09:00:00.000Z',providerSchemaVersion:'max-netunim-v2+upstream-login-6.10.0',transactions:[final]}]}]}],errors:[]});
  const account=merged.profiles[0].accounts[0];assert.equal(account.pendingTransactions.length,0,'a successful new MAX pending snapshot removes the old authorization once it is no longer pending');
  const stored=account.months.find(month=>month.month==='2026-10').transactions[0];assert.equal(stored.foreignTransaction,true,'the finalized replacement keeps the provider foreign marker through persistence normalization');
  const state={credits:[],creditSync:merged},row=creditBillingRowsData(state,{asOf:'2026-10-04'}).find(item=>item.description==='AKUSOLI.COM VILNIUS LT');
  assert.ok(row);assert.equal(row.status,'completed');assert.equal(row.date,'2026-10-02');assert.equal(row.foreignCurrency,true,'a shekel-settled MAX foreign charge is classified from the issuer marker rather than a fabricated currency');
  assert.equal(creditDetailMonthDayMatch(row,'10'),true,'the finalized off-cycle charge remains visible even when the card view is filtered to its normal day-10 cycle');
  assert.deepEqual(creditDetailMonthlySections([row]).foreign,[row],'the finalized row is rendered in the dedicated foreign/FX section');
  const october=creditMonthlyDetailData(state,'2026-10-04').months.find(month=>month.key==='2026-10'),cycleRow=october.items.find(item=>item.description==='AKUSOLI.COM VILNIUS LT'),upcoming=creditUpcomingDetailData(state,'2026-10-04').items.find(item=>item.description==='AKUSOLI.COM VILNIUS LT');
  assert.ok(cycleRow);assert.equal(cycleRow.date,'2026-10-02','the real immediate debit date stays authoritative for the row and exact date filtering');assert.equal(cycleRow.detailCycleBillingDate,'2026-10-11','the immediate debit is attached to the card statement cycle that closes after it');
  assert.equal(cycleRow.detailCycleNominalDay,10,'Saturday-shifted 11 October remains the nominal day-10 cycle');assert.equal(creditDetailChargeCycleKey(cycleRow),'2026-10:10');
  assert.equal(creditDetailRangeMatch(cycleRow,'2026-10-02','2026-10-02'),true,'exact-date mode still targets the real immediate debit date, not the statement grouping date');
  assert.ok(upcoming);assert.equal(upcoming.detailCycleBillingDate,'2026-10-11','the current statement view includes foreign immediate charges already debited inside this cycle window');
  assert.equal(ordersNormalize(merged).profiles[0].accounts[0].months.find(month=>month.month==='2026-10').transactions[0].foreignTransaction,true,'Orders preserves the same explicit foreign marker');
});

test('MAX raw amount recovery never overwrites issuer chargedCurrency for foreign-wallet charges',async()=>{
  const raw={shortCardNumber:'9090',purchaseDate:'2026-09-03',paymentDate:'2026-09-04',actualPaymentAmount:-40,originalAmount:-40,paymentCurrency:840,originalCurrency:'USD',planName:'חיוב ארנק מטח',planTypeId:5,merchantName:'wallet charge',comments:'',dealData:{arn:'wallet-usd'}},profile={profileId:'fx-max',provider:'max',label:'MAX',credentials:{username:'test',password:'test'}},adapter=new MaxAdapter({profile,companyId:'max',now:()=>new Date('2026-09-04T00:00:00Z'),syncMode:'quick',createScraper:()=>maxScraperForRows([raw],{card:'9090'})});
  const row=(await adapter.scrape()).accounts[0].months.flatMap(month=>month.transactions).find(tx=>tx.id==='wallet-usd');
  assert.ok(row);assert.equal(row.chargedAmount,40);assert.equal(row.chargedCurrency,'USD');assert.equal(row.originalCurrency,'USD');
});
