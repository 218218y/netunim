import test from 'node:test';
import assert from 'node:assert/strict';
import {creditBillingRowsData,creditTransactionAmountData} from '../shared/credit-billing-cycles.js';
import {kupaAccountCashflowData} from '../shared/kupa-cashflow.js';
import {normalizeCreditSync} from '../netunim-kupa/site/assets/js/domains/credit/sync-feed.js';
import {normalizeCreditSync as ordersNormalize} from '../netunim-orders/site/assets/js/domains/finance/credit-feed.js';
import {creditMonthlyDetailData} from '../netunim-kupa/site/assets/js/domains/credit/model.js';
import {creditDetailRowMarkup} from '../netunim-orders/site/assets/js/domains/finance/credit-detail-view.js';
import {MaxAdapter,normalizeVisaCalTransaction} from '../netunim-kupa/bank-bridge/credit-adapters.mjs';
import {normalizeAmexDigitalV3ApprovedTransaction,normalizeAmexDigitalV3Voucher} from '../netunim-kupa/bank-bridge/amex-digitalv3.mjs';
import {normalizeIsracardDigitalV3ApprovedTransaction,normalizeIsracardDigitalV3Voucher} from '../netunim-kupa/bank-bridge/isracard-digitalv3.mjs';
import {normalizeIsracardFamilyTransaction} from '../netunim-kupa/bank-bridge/isracard-camoufox.mjs';

const due='2026-09-10';
function stateFor(provider,txns){return {credits:[],expenses:[],checks:[],bank:{currentBalance:10000,source:'hapoalim',asOfDate:due,feed:{balance:10000,syncedAt:due,transactions:[]}},creditSync:normalizeCreditSync({version:4,profiles:[{profileId:'p',provider,accounts:[{accountNumber:'1234',balanceDate:due,pendingStatus:'success',pendingFetchedAt:due,txns}]}],cardMappings:{'p:1234':{included:true,account:'עסקי'}}})}}
const clean=text=>text.replace(/[\u200e\u200f\u061c]/g,'');

test('all issuers retain refund signs in original amounts, series totals and rendered transaction columns',()=>{
  for(const provider of ['visaCal','max','isracard','amex']){
    const state=stateFor(provider,[
      {id:'refund',status:'completed',processedDate:due,chargedAmount:4.50,originalAmount:4.50,chargedCurrency:'ILS',originalCurrency:'ILS'},
      {id:'installment-refund',status:'completed',processedDate:due,chargedAmount:50,originalAmount:100,chargedCurrency:'ILS',originalCurrency:'ILS',installments:{number:1,total:2}},
      {id:'purchase',status:'completed',processedDate:due,chargedAmount:-50,originalAmount:-100,chargedCurrency:'ILS',originalCurrency:'ILS',installments:{number:1,total:2}},
    ]),rows=creditBillingRowsData(state,{asOf:due}),refund=rows.find(row=>row.creditId.includes('|refund|')),installment=rows.find(row=>row.creditId.includes('|installment-refund|'));
    assert.equal(refund.amount,-4.50);assert.equal(refund.displayAmount,-4.50);assert.equal(refund.originalAmount,-4.50);assert.equal(refund.totalAmount,-4.50);assert.equal(refund.series.totalAmount,-4.50);
    assert.equal(installment.amount,-50);assert.equal(installment.totalAmount,-100);assert.equal(installment.series.totalAmount,-100,'negative full installment total must not be replaced by its single installment');
    assert.match(clean(creditDetailRowMarkup(refund)),/<td class="amount">[^<]*-4\.50/);
    assert.match(clean(creditDetailRowMarkup(installment)),/<td class="amount">[^<]*-100/);
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
  let options;
  const profile={profileId:'p',provider:'max',label:'MAX',credentials:{username:'test',password:'test'}},adapter=new MaxAdapter({profile,companyId:'max',now:()=>new Date('2026-09-03T00:00:00Z'),syncMode:'daily',createScraper:input=>{options=input;return {scrape:async()=>({success:true,accounts:[{accountNumber:'1234',txns:[null,'',0,-4.5].map((amount,i)=>({id:String(i),status:'completed',processedDate:due,chargedAmount:-amount,originalAmount:-17.90,chargedCurrency:'ILS',originalCurrency:'ILS',rawTransaction:{actualPaymentAmount:amount,originalAmount:i===3?-4.5:17.90,purchaseDate:'2026-09-02T00:00:00'}}))}]})}}});
  const result=await adapter.scrape(),rows=result.accounts[0].months.flatMap(month=>month.transactions);
  assert.equal(options.includeRawTransaction,true);assert.deepEqual(rows.map(tx=>tx.chargedAmount),[null,null,0,4.5]);assert.equal(rows[3].originalAmount,4.5);
  assert.ok(rows.every(tx=>!Object.hasOwn(tx,'rawTransaction')),'raw provider payload is only inspected locally');
});
