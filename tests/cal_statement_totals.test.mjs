import test from 'node:test';
import assert from 'node:assert/strict';
import {parseVisaCalMonthData,normalizeVisaCalTransaction,parseVisaCalFrame} from '../netunim-kupa/bank-bridge/credit-adapters.mjs';
import {normalizeCreditScrapeAccount} from '../netunim-kupa/bank-bridge/lib.mjs';
import {normalizeCreditSync,mergeCreditSyncResult} from '../netunim-kupa/site/assets/js/domains/credit/sync-feed.js';
import {normalizeCreditSync as ordersNormalize} from '../netunim-orders/site/assets/js/domains/finance/credit-feed.js';
import {kupaAccountCashflowData} from '../shared/kupa-cashflow.js';
import {creditBillingRowsData} from '../shared/credit-billing-cycles.js';
import {creditDetailRowMarkup} from '../netunim-orders/site/assets/js/domains/finance/credit-detail-view.js';
import {kupaReconciledCreditDetailRowsData} from '../shared/kupa-cashflow.js';

// Public CAL client contract: bankAccounts[].debitDates[].date and
// totalDebits[{currencySymbol,amount}] drive the cycle heading on its website.
const txn={trnIntId:'purchase',trnTypeCode:'5',trnPurchaseDate:'2026-08-25T12:00:00',debCrdDate:'2026-09-10T00:00:00',trnAmt:1372.67,amtBeforeConvAndIndex:1372.67,trnCurrencySymbol:'₪',debCrdCurrencySymbol:'₪',merchantName:'עסקת בדיקה'};
const body=(day={})=>({statusCode:1,result:{bankAccounts:[{debitDates:[{date:'2026-09-10T00:00:00',totalDebits:[{currencySymbol:'₪',amount:1369.78}],transactions:[txn],...day}]}]}});
function stateFor(txns){return {credits:[],checks:[],expenses:[],bank:{homeFeed:{balance:9000,syncedAt:'2026-09-10',transactions:[]}},creditSync:normalizeCreditSync({profiles:[{profileId:'cal',provider:'visaCal',defaultAccount:'ביתי',accounts:[normalizeCreditScrapeAccount({accountNumber:'9715',txns},'visaCal')]}],cardMappings:{'cal:9715':{included:true,account:'ביתי'}}})}}

test('CAL statement total preserves purchases and explains the exact 2.89 ILS difference',()=>{
  const input=body(),before=structuredClone(input),rows=parseVisaCalMonthData(input),adjustment=rows.find(row=>row.type==='statement_adjustment');
  assert.equal(rows[0].chargedAmount,-1372.67);assert.equal(adjustment.chargedAmount,2.89);
  assert.match(adjustment.description,/כאל/);assert.match(adjustment.memo,/1369\.78/);assert.match(adjustment.memo,/1372\.67/);
  const state=stateFor(rows),forecast=kupaAccountCashflowData(state,'ביתי','2026-09-10');
  assert.equal(forecast.credit,1369.78);assert.equal(forecast.forecastIncomplete,false);
  assert.deepEqual(ordersNormalize(state.creditSync),state.creditSync);
  assert.deepEqual(input,before);
  assert.equal(parseVisaCalMonthData(body({totalDebits:[{currencySymbol:'₪',amount:1372.67}]})).length,1,'equal totals need no adjustment');
});

test('CAL totals do not manufacture amounts from incomplete, invalid or foreign-only evidence',()=>{
  for(const patch of [
    {totalDebits:undefined},{totalDebits:[{currencySymbol:'₪',amount:null}]},{totalDebits:[{currencySymbol:'₪',amount:''}]},
    {totalDebits:[{currencySymbol:'USD',amount:1369.78}]},
    {totalDebits:[{currencySymbol:'₪',amount:1},{currencySymbol:'₪',amount:2}]},
    {date:'2026-02-31'},
    {transactions:[{...txn,amtBeforeConvAndIndex:null,trnAmt:null}]},
    {transactions:[{...txn,amtBeforeConvAndIndex:'',trnAmt:null}]},
    {transactions:[{...txn,debCrdCurrencySymbol:''}]},
    {transactions:[{...txn,debCrdDate:null}]},
  ])assert.equal(parseVisaCalMonthData(body(patch)).some(row=>row.type==='statement_adjustment'),false,JSON.stringify(patch));
  assert.equal(normalizeVisaCalTransaction({...txn,amtBeforeConvAndIndex:null}).chargedAmount,null,'missing does not turn into a known zero');
});

test('CAL cycle dates follow issuer calendar days including UTC midnight conversion and DST',()=>{
  for(const [date,expected] of [
    ['2026-09-10T00:00:00+03:00','2026-09-10'],['2026-09-09T21:00:00Z','2026-09-10'],
    ['2026-09-10T00:00:00','2026-09-10'],['2026-09-10','2026-09-10'],
    ['2026-01-09T22:00:00Z','2026-01-10'],
  ]){
    assert.equal(normalizeVisaCalTransaction({...txn,debCrdDate:date}).processedDate.slice(0,10),expected);
    assert.equal(parseVisaCalFrame({result:{calIssuedCards:{cardLevelFrames:[{cardUniqueId:'card',nextTotalDebit:1369.78,nextDebitDate:date}]}}},{cardUniqueId:'card'}).balanceDate.slice(0,10),expected);
  }
  const rows=parseVisaCalMonthData(body({transactions:[{...txn,debCrdDate:'2026-09-09T00:00:00Z'}]}));
  assert.ok(rows.every(row=>row.processedDate.startsWith('2026-09-10')),'the explicit debit group date is the cycle shown by CAL');
  assert.equal(parseVisaCalMonthData(body(),{startDate:new Date('2026-09-11')}).length,0,'the correction and its purchases share the same cutoff');
});

test('statement correction is signed, currency-scoped and handles duplicate issuer identities',()=>{
  const duplicate=stateFor(parseVisaCalMonthData(body({transactions:[txn,txn]})));
  assert.equal(kupaAccountCashflowData(duplicate,'ביתי','2026-09-10').credit,1369.78);
  const fx=parseVisaCalMonthData(body({transactions:[txn,{...txn,trnIntId:'fx',trnCurrencySymbol:'USD',debCrdCurrencySymbol:'USD',amtBeforeConvAndIndex:100}]}));
  assert.equal(fx.find(row=>row.type==='statement_adjustment').chargedAmount,2.89,'USD never enters the ILS sum');
  assert.equal(kupaAccountCashflowData(stateFor(fx),'ביתי','2026-09-10').forecastIncomplete,true,'the unconverted foreign obligation remains explicit');
  for(const total of [0,-10,1400])assert.equal(kupaAccountCashflowData(stateFor(parseVisaCalMonthData(body({totalDebits:[{currencySymbol:'₪',amount:total}]}))),'ביתי','2026-09-10').credit,total);
});

test('fresh monthly sync replaces the statement correction; failed coverage retains last known data',()=>{
  const slice=amount=>({month:'2026-09',tier:'core',fetchStatus:'success',fetchedAt:'2026-09-10',transactions:parseVisaCalMonthData(body({totalDebits:[{currencySymbol:'₪',amount}]}))});
  const state=stateFor([]);state.creditSync=mergeCreditSyncResult(state.creditSync,{profiles:[{profileId:'cal',provider:'visaCal',coreComplete:true,accounts:[{accountNumber:'9715',months:[slice(1369.78)]}]}]});
  assert.equal(kupaAccountCashflowData(state,'ביתי','2026-09-10').credit,1369.78);
  state.creditSync=mergeCreditSyncResult(state.creditSync,{profiles:[{profileId:'cal',provider:'visaCal',coreComplete:false,accounts:[{accountNumber:'9715',months:[{month:'2026-09',tier:'core',fetchStatus:'provider_error',transactions:[]}]}]}]});
  assert.equal(kupaAccountCashflowData(state,'ביתי','2026-09-10').credit,1369.78);
  state.creditSync=mergeCreditSyncResult(state.creditSync,{profiles:[{profileId:'cal',provider:'visaCal',coreComplete:true,accounts:[{accountNumber:'9715',months:[slice(1372.67)]}]}]});
  assert.equal(kupaAccountCashflowData(state,'ביתי','2026-09-10').credit,1372.67);
  assert.equal(creditBillingRowsData(state,{asOf:'2026-09-10'}).some(row=>row.creditId.includes('cal-statement')),false,'an obsolete difference is not retained after success');
});

test('blank CAL fees and rewards never fall back to original amounts; actual credits and installments remain signed',()=>{
  const charged=[44.05,33.9,25,23.76,60,9,60,66.12,91,1.57,7,21,16.15,-4.5,4.5,40,6.9,9,52.3,55,97.4,28.8,74,5.96,63.76,54,18.7,39.3,10.16,19.66,16.79,50,70,5.7,137,56.8];
  const purchases=charged.map((amount,i)=>({...txn,trnIntId:`row-${i}`,merchantName:`עסקת בדיקה ${i}`,trnAmt:Math.abs(amount),amtBeforeConvAndIndex:amount,trnTypeCode:amount<0?'6':'5'}));
  purchases[31]={...purchases[31],trnAmt:100,numOfPayments:2,curPaymentNum:1,trnTypeCode:'8'};
  const reward={...txn,trnIntId:'reward',merchantName:'החזר CashCal',trnAmt:-15.01,amtBeforeConvAndIndex:null,trnPurchaseDate:'2026-08-30T21:00:00Z'},fee={...txn,trnIntId:'fee',merchantName:'דמי כרטיס',trnAmt:17.90,amtBeforeConvAndIndex:''};
  const rows=parseVisaCalMonthData(body({transactions:[...purchases,reward,fee]})),state=stateFor(rows),forecast=kupaAccountCashflowData(state,'ביתי','2026-09-10'),detail=kupaReconciledCreditDetailRowsData(state,'ביתי','2026-09-10');
  assert.equal(rows.length,38);assert.equal(rows.some(row=>row.type==='statement_adjustment'),false,'correct source mapping needs no compensating transaction');
  assert.equal(forecast.credit,1369.78);assert.equal(forecast.forecastIncomplete,false);
  for(const id of ['reward','fee']){
    assert.equal(rows.find(row=>row.id===id).chargedAmount,null);
    assert.equal(rows.find(row=>row.id===id).chargeAmountStatus,'not_billed');
    const row=detail.find(item=>item.creditId.includes(`|${id}|`));assert.equal(row.amount,0);assert.equal(row.amountSource,'issuer_not_billed');
    assert.match(creditDetailRowMarkup(row),/לא נכלל בחיוב לפי כאל/);
  }
  assert.equal(detail.find(row=>row.creditId.includes('|reward|')).transactionDate,'2026-08-31');
  assert.equal(detail.find(row=>row.creditId.includes('|row-13|')).amount,-4.50);
  const installment=detail.find(row=>row.creditId.includes('|row-31|'));assert.equal(installment.amount,50);assert.equal(installment.totalAmount,100);assert.equal(installment.part,1);assert.equal(installment.totalParts,2);
  assert.deepEqual(ordersNormalize(state.creditSync),state.creditSync,'charge provenance survives normalization in both apps');
  const unknown=stateFor(parseVisaCalMonthData(body({totalDebits:undefined,transactions:[...purchases,reward,fee]}))),partial=kupaAccountCashflowData(unknown,'ביתי','2026-09-10');
  assert.equal(partial.credit,1369.78);assert.equal(partial.forecastIncomplete,true,'without cycle proof blanks remain missing, never original-amount estimates');
});

test('reported zero is final zero, while pending still uses the original ILS estimate',()=>{
  const zero=stateFor(parseVisaCalMonthData(body({totalDebits:[{currencySymbol:'₪',amount:0}],transactions:[{...txn,amtBeforeConvAndIndex:0}]})));
  assert.equal(kupaAccountCashflowData(zero,'ביתי','2026-09-10').credit,0);assert.equal(kupaAccountCashflowData(zero,'ביתי','2026-09-10').forecastIncomplete,false);
  const informational=stateFor(parseVisaCalMonthData(body({totalDebits:[{currencySymbol:'₪',amount:0}],transactions:[{...txn,amtBeforeConvAndIndex:null}]})));
  assert.equal(kupaAccountCashflowData(informational,'ביתי','2026-09-12').expiredSettlementWarnings.length,0,'non-billed information cannot create a phantom settlement warning');
  const pending=normalizeVisaCalTransaction({...txn,debCrdDate:undefined,amtBeforeConvAndIndex:null});
  assert.equal(pending.status,'pending');assert.equal(pending.chargedAmount,-1372.67);assert.equal(pending.chargeAmountStatus,undefined);
});
