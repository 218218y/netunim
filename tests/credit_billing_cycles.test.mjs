import test from 'node:test';
import assert from 'node:assert/strict';
import * as kupaEngine from '../netunim-kupa/site/assets/js/shared/credit-billing-cycles.js';
import * as ordersEngine from '../netunim-orders/site/assets/js/shared/credit-billing-cycles.js';
import {kupaAccountCashflowData as kupaCashflow,kupaReconciledCreditRowsData} from '../netunim-kupa/site/assets/js/shared/kupa-cashflow.js';
import {kupaAccountCashflowData as ordersCashflow} from '../netunim-orders/site/assets/js/shared/kupa-cashflow.js';
import {allInstallmentsData,creditForecastInstallmentsData,creditMonthlyDetailData} from '../netunim-kupa/site/assets/js/domains/credit/model.js';
import {creditFrameStatus as kupaFrameStatus} from '../netunim-kupa/site/assets/js/domains/credit/sync-feed.js';
import {creditAccountModels as ordersCreditAccountModels,creditRows as ordersCreditRows,creditDetailMonths as ordersDetailMonths,creditMonthBuckets as ordersCreditMonthBuckets} from '../netunim-orders/site/assets/js/domains/finance/reporting.js';
import {creditFrameStatus as ordersFrameStatus} from '../netunim-orders/site/assets/js/domains/finance/credit-feed.js';
import {computeKupaNetReadoutData} from '../netunim-orders/site/assets/js/domains/bank/readout.js';
import {bankLongTermPositionData} from '../netunim-kupa/site/assets/js/domains/bank/model.js';
import {checkTodayISO} from '../netunim-orders/site/assets/js/core/dates.js';
import {cashflowBreakdownMarkup} from '../shared/cashflow-breakdown.js';

function stateFor(accounts,{provider='max',profileId='cards',accountRole='עסקי'}={}){
  const mappings={};for(const account of accounts)mappings[`${profileId}:${account.accountNumber}`]={included:true,hidden:false,account:accountRole};
  return {version:4,credits:[],checks:[],expenses:[],cash:[],cashflowSettings:{businessMinimum:0,businessCheckCutoffDay:14},bank:{currentBalance:10000,asOfDate:'2026-09-01',source:'hapoalim',adjustments:[],feed:{syncedAt:'2026-09-01T08:00:00Z',balance:10000,transactions:[]}},creditSync:{version:4,profiles:[{profileId,provider,defaultAccount:accountRole,accounts}],cardMappings:mappings}};
}

const twoCards=stateFor([
  {accountNumber:'1010',pendingStatus:'success',txns:[{id:'a-sep',processedDate:'2026-09-10',chargedAmount:-1000,chargedCurrency:'ILS',status:'completed'},{id:'a-oct',processedDate:'2026-10-10',chargedAmount:-1100,chargedCurrency:'ILS',status:'completed'}]},
  {accountNumber:'1515',pendingStatus:'success',txns:[{id:'b-sep',processedDate:'2026-09-15',chargedAmount:-2000,chargedCurrency:'ILS',status:'completed'},{id:'b-oct',processedDate:'2026-10-15',chargedAmount:-2100,chargedCurrency:'ILS',status:'completed'}]},
]);

test('cash-flow horizon includes every card cycle through one exact date',()=>{
  const before=kupaEngine.creditCyclesThroughHorizonData(twoCards,'עסקי','2026-09-01');
  assert.equal(before.targetDate,'2026-09-15');assert.equal(before.targetEnd,'2026-09-15');assert.equal(before.total,3000);
  assert.deepEqual(before.cycles.map(cycle=>cycle.billingDate),['2026-09-10','2026-09-15']);

  const between=kupaEngine.creditCyclesThroughHorizonData(twoCards,'עסקי','2026-09-11');
  assert.equal(between.targetDate,'2026-10-10');assert.equal(between.total,3100);
  assert.deepEqual(between.cycles.map(cycle=>cycle.billingDate),['2026-09-15','2026-10-10']);
  assert.equal(between.cycles.some(cycle=>cycle.billingDate==='2026-10-15'),false,'a cycle after the exact horizon is excluded even when it shares the horizon month');

  const after=kupaEngine.creditCyclesThroughHorizonData(twoCards,'עסקי','2026-09-16');
  assert.equal(after.targetDate,'2026-10-15');assert.equal(after.total,3200);
});

test('pending billing-date hierarchy never falls back to today',()=>{
  const issuer={accountNumber:'1',balanceDate:'2026-09-10',pendingStatus:'success',txns:[{id:'issuer',status:'pending',transactionDate:'2026-09-03',chargedAmount:-50,chargedCurrency:'ILS'}]};
  assert.deepEqual(kupaEngine.creditPendingBillingDateData(issuer,issuer.txns[0],'2026-09-04'),{date:'2026-09-10',source:'issuer_next_charge',confidence:'issuer'});

  const known={accountNumber:'2',balanceDate:'2026-09-10',pendingStatus:'success',txns:[{id:'oct',status:'completed',processedDate:'2026-10-10',chargedAmount:-100,chargedCurrency:'ILS'},{id:'known',status:'pending',transactionDate:'2026-09-11',chargedAmount:-25,chargedCurrency:'ILS'}]};
  assert.deepEqual(kupaEngine.creditPendingBillingDateData(known,known.txns[1],'2026-09-11'),{date:'2026-10-10',source:'known_future_cycle',confidence:'known_cycle'},'a stale balance date yields to a known future monthly slice');

  const inferred={accountNumber:'3',pendingStatus:'success',txns:[{id:'jul',status:'completed',processedDate:'2026-07-10',chargedAmount:-1,chargedCurrency:'ILS'},{id:'aug',status:'completed',processedDate:'2026-08-10',chargedAmount:-1,chargedCurrency:'ILS'},{id:'sep',status:'completed',processedDate:'2026-09-10',chargedAmount:-1,chargedCurrency:'ILS'},{id:'inferred',status:'pending',transactionDate:'2026-09-11',chargedAmount:-30,chargedCurrency:'ILS'}]};
  assert.deepEqual(kupaEngine.creditPendingBillingDateData(inferred,inferred.txns[3],'2026-09-11'),{date:'',source:'unassigned',confidence:'unassigned'});

  const unknown={accountNumber:'4',pendingStatus:'success',txns:[{id:'unknown',status:'pending',transactionDate:'2026-09-11',chargedAmount:-40,chargedCurrency:'ILS'}]};
  assert.deepEqual(kupaEngine.creditPendingBillingDateData(unknown,unknown.txns[0],'2026-09-11'),{date:'',source:'unassigned',confidence:'unassigned'});
  const unknownState=stateFor([unknown]),model=kupaEngine.creditBillingModelData(unknownState,{asOf:'2026-09-11'});
  assert.equal(model.unassignedRows.length,1);assert.equal(model.unassignedRows[0].uncertainBillingDate,true);
  assert.equal(creditMonthlyDetailData(unknownState,'2026-09-11').months.at(-1).key,'unassigned','Kupa exposes uncertain pending cycles instead of assigning them to the current date');
  assert.equal(ordersDetailMonths(unknownState,{asOf:'2026-09-11'}).at(-1).key,'unassigned','Orders exposes the same uncertain-cycle bucket');
});

test('pending ILS estimates, FX exclusions, freshness and transition deduplication are explicit',()=>{
  const state=stateFor([{accountNumber:'4545',pendingFetchedAt:'2026-09-03T08:00:00Z',balanceDate:'2026-09-10',pendingStatus:'success',txns:[
    {id:'zero-ils',status:'pending',transactionDate:'2026-09-03',chargedAmount:0,chargedCurrency:'ILS',originalAmount:-237.4,originalCurrency:'ILS'},
    {id:'converted',status:'completed',processedDate:'2026-09-10',chargedAmount:-250,chargedCurrency:'ILS',originalAmount:-10000,originalCurrency:'JPY'},
    {id:'foreign-only',status:'completed',processedDate:'2026-09-10',chargedAmount:-40,chargedCurrency:'USD',originalAmount:-40,originalCurrency:'USD'},
    {id:'transition',status:'completed',processedDate:'2026-09-10',chargedAmount:-70,chargedCurrency:'ILS'},
    {id:'transition',status:'pending',transactionDate:'2026-09-09',chargedAmount:-70,chargedCurrency:'ILS'},
  ]}]);
  const rows=kupaEngine.creditBillingRowsData(state,{asOf:'2026-09-03'}),pending=rows.find(row=>row.status==='pending'),converted=rows.find(row=>row.creditId.includes('converted')),foreign=rows.find(row=>row.creditId.includes('foreign-only'));
  assert.equal(pending.amount,237.4);assert.equal(pending.amountSource,'original_ils_estimate');assert.equal(pending.amountEstimated,true);
  assert.equal(converted.amount,250);assert.equal(converted.totalAmount,250);assert.equal(converted.foreignCurrency,true);
  assert.equal(foreign.amount,0);assert.equal(foreign.unconverted,true);assert.equal(foreign.includedInIlsTotal,false);
  assert.equal(rows.filter(row=>row.creditId.includes('transition')).length,1,'a completed row wins over the pending version with the same issuer identity');

  const stale=structuredClone(state);stale.creditSync.profiles[0].accounts[0].pendingStatus='provider_error';
  const staleAccount=stale.creditSync.profiles[0].accounts[0],stalePending=kupaEngine.creditBillingRowsData(stale,{asOf:'2026-09-03'}).find(row=>row.status==='pending');
  assert.equal(stalePending.amount,0);assert.equal(stalePending.includedInIlsTotal,false,'stale Last Known Good pending data stays visible without inflating ILS totals');
  assert.equal(kupaFrameStatus(staleAccount,{manualFrame:1000},'2026-09-03').available,680,'finalized commitments remain reserved but stale pending authorizations do not reduce a fallback frame');
  assert.deepEqual(ordersFrameStatus(staleAccount,{manualFrame:1000},'2026-09-03'),kupaFrameStatus(staleAccount,{manualFrame:1000},'2026-09-03'),'Orders and Kupa share pending freshness semantics for fallback credit frames');

  const incompleteState=stateFor([{accountNumber:'stale-only',balanceDate:'2026-09-15',pendingStatus:'provider_error',txns:[{id:'stale',status:'pending',transactionDate:'2026-09-02',chargedAmount:-80,chargedCurrency:'ILS'}]}]),incomplete=kupaCashflow(incompleteState,'עסקי','2026-09-03');
  assert.equal(incomplete.targetDate,'2026-09-15','a known but stale cycle date still defines the honest cash-flow horizon');
  assert.equal(incomplete.credit,0);assert.equal(incomplete.forecastIncomplete,true);assert.equal(incomplete.incompleteCreditRows.length,1,'omitted stale or unconverted amounts remain explicit instead of making a zero forecast look complete');
});

test('pending cycles enter checking cash-flow once and Orders/Kupa remain identical',()=>{
  const state=stateFor([{accountNumber:'7777',pendingFetchedAt:'2026-09-03T08:00:00Z',balanceDate:'2026-09-10',pendingStatus:'success',txns:[{id:'pending',status:'pending',transactionDate:'2026-09-03',chargedAmount:0,chargedCurrency:'ILS',originalAmount:-237.4,originalCurrency:'ILS'}]}]);
  const kupa=kupaCashflow(state,'עסקי','2026-09-03'),orders=ordersCashflow(state,'עסקי','2026-09-03');
  assert.equal(kupa.credit,237.4);assert.equal(kupa.nextCreditTotal,237.4);assert.equal(kupa.projected,9762.6);
  assert.deepEqual(orders,kupa,'both applications consume the same shared cash-flow and billing-cycle implementation');

  const compact=rows=>rows.map(row=>({date:row.date,amount:row.amount,status:row.status,card:row.creditAccountKey}));
  assert.deepEqual(compact(allInstallmentsData(state,'2026-09-03')),compact(ordersCreditRows(state,'2026-09-03').filter(row=>row.date&&row.includedInIlsTotal&&Math.abs(row.amount)>0.004)),'Orders and Kupa expose identical calculated billing rows');
});

test('a credit debit already posted by the bank on its due date is not counted twice',()=>{
  const account={accountNumber:'1010',pendingStatus:'success',txns:[
    {id:'sep',status:'completed',processedDate:'2026-09-10',chargedAmount:-1000,chargedCurrency:'ILS'},
    {id:'oct',status:'completed',processedDate:'2026-10-10',chargedAmount:-1100,chargedCurrency:'ILS'},
  ]},posted=stateFor([account]);
  posted.bank.asOfDate='2026-09-10';posted.bank.feed.syncedAt='2026-09-10T08:00:00Z';posted.bank.feed.transactions=[{date:'2026-09-10',amount:-1000,description:'מקס איט פיננסי'}];
  const settled=kupaCashflow(posted,'עסקי','2026-09-10');
  assert.equal(settled.targetDate,'2026-10-10','after the same-day bank debit, the card advances to its next unposted cycle');
  assert.equal(settled.credit,1100);assert.equal(settled.projected,8900);

  const notPosted=stateFor([account]);notPosted.bank.asOfDate='2026-09-10';notPosted.bank.feed.syncedAt='2026-09-10T08:00:00Z';
  const stillDue=kupaCashflow(notPosted,'עסקי','2026-09-10');
  assert.equal(stillDue.targetDate,'2026-09-10');assert.equal(stillDue.credit,1000,'the due cycle remains forecast when no matching bank debit exists');

  const finalOnly=stateFor([{accountNumber:'2020',pendingStatus:'success',txns:[{id:'final-only',status:'completed',processedDate:'2026-09-10',chargedAmount:-500,chargedCurrency:'ILS'}]}]);
  finalOnly.bank.asOfDate='2026-09-10';finalOnly.bank.feed.syncedAt='2026-09-10T08:00:00Z';finalOnly.bank.feed.transactions=[{date:'2026-09-10',amount:-500,description:'מקס איט פיננסים'}];
  assert.equal(ordersCreditAccountModels(finalOnly,'2026-09-10')[0].upcomingCharge,null,'Orders live card cannot fall back to a raw transaction after the reconciled engine proved that cycle settled');
});

test('a settled card cycle rolls any surviving pending authorization into the next proven cycle',()=>{
  const account={accountNumber:'1010',pendingFetchedAt:'2026-09-10T08:00:00Z',balanceDate:'2026-09-10',pendingStatus:'success',txns:[
    {id:'sep',status:'completed',processedDate:'2026-09-10',chargedAmount:-1000,chargedCurrency:'ILS'},
    {id:'oct',status:'completed',processedDate:'2026-10-10',chargedAmount:-1100,chargedCurrency:'ILS'},
    {id:'late-pending',status:'pending',transactionDate:'2026-09-09',chargedAmount:-100,chargedCurrency:'ILS'},
  ]},posted=stateFor([account]);
  posted.bank.asOfDate='2026-09-10';posted.bank.feed.syncedAt='2026-09-10T08:00:00Z';posted.bank.feed.transactions=[{date:'2026-09-10',amount:-1000,description:'מקס איט פיננסים'}];
  const result=kupaCashflow(posted,'עסקי','2026-09-10'),rolled=result.nextCreditRows.find(row=>row.status==='pending');
  assert.equal(result.targetDate,'2026-10-10');assert.equal(result.credit,1200);
  assert.equal(rolled.date,'2026-10-10');assert.equal(rolled.chargeDateSource,'bank_settlement_next_known_cycle','bank settlement is stronger evidence than a stale pending-cycle assignment');
  const kupaForecast=creditForecastInstallmentsData(posted,'2026-09-10'),ordersForecast=ordersCreditMonthBuckets(posted,{view:'all',asOf:'2026-09-10'}),ordersUpcoming=ordersCreditAccountModels(posted,'2026-09-10')[0].upcomingCharge;
  assert.equal(kupaForecast.some(row=>row.status==='pending'&&row.date==='2026-09-10'),false);assert.equal(kupaForecast.some(row=>row.status==='pending'&&row.date==='2026-10-10'),true);
  assert.equal(ordersForecast.rows.some(row=>row.status==='pending'&&row.date==='2026-09-10'),false);assert.equal(ordersForecast.rows.some(row=>row.status==='pending'&&row.date==='2026-10-10'),true,'the primary Orders forecast reconciles a bank-settled cycle instead of showing stale same-day pending money');
  assert.equal(ordersUpcoming.date,'2026-10-10');assert.equal(ordersUpcoming.amount,1200,'Orders live upcoming charge uses the same bank-reconciled cycle as its dashboard and forecast');
  posted.expenses=[{id:'sep-after-settlement',active:true,recurring:false,account:'עסקי',date:'2026-09-12',amount:50},{id:'oct-after-settlement',active:true,recurring:false,account:'עסקי',date:'2026-10-05',amount:60}];
  const longTerm=bankLongTermPositionData(posted,'2026-09-10');
  assert.equal(longTerm.credit,1200);assert.equal(longTerm.targetMonth,'2026-10');assert.equal(longTerm.expenses,60);assert.equal(longTerm.forecastIncomplete,false,'Kupa long-term balance keeps its all-future meaning and advances its expense month without counting the settled September cycle again');
  const kupaDetail=creditMonthlyDetailData(posted,'2026-09-10').months,ordersDetail=ordersDetailMonths(posted,{asOf:'2026-09-10'});
  assert.equal(kupaDetail.find(month=>month.key==='2026-09').items.some(row=>row.status==='pending'),false);assert.equal(kupaDetail.find(month=>month.key==='2026-10').items.some(row=>row.status==='pending'),true);
  assert.equal(ordersDetail.find(month=>month.key==='2026-09').items.some(row=>row.status==='pending'),false);assert.equal(ordersDetail.find(month=>month.key==='2026-10').items.some(row=>row.status==='pending'),true,'Orders detail uses the same reconciled pending-cycle assignment as its forecast');
});

test('a settled pending authorization without a proven next cycle stays visibly unassigned',()=>{
  const account={accountNumber:'1010',pendingFetchedAt:'2026-09-10T08:00:00Z',balanceDate:'2026-09-10',pendingStatus:'success',txns:[
    {id:'sep',status:'completed',processedDate:'2026-09-10',chargedAmount:-1000,chargedCurrency:'ILS'},
    {id:'late-pending',status:'pending',transactionDate:'2026-09-09',chargedAmount:-100,chargedCurrency:'ILS'},
  ]},posted=stateFor([account]);
  posted.bank.asOfDate='2026-09-10';posted.bank.feed.syncedAt='2026-09-10T08:00:00Z';posted.bank.feed.transactions=[{date:'2026-09-10',amount:-1000,description:'מקס איט פיננסים'}];
  const result=kupaCashflow(posted,'עסקי','2026-09-10'),rows=kupaReconciledCreditRowsData(posted,'עסקי','2026-09-10'),pending=rows.find(row=>row.status==='pending'),ordersUpcoming=ordersCreditAccountModels(posted,'2026-09-10')[0].upcomingCharge;
  assert.equal(result.credit,0);assert.equal(result.forecastIncomplete,true);assert.equal(result.unassignedCreditRows.length,1,'unassigned pending remains explicit in the cash-flow contract');
  assert.equal(pending.date,'');assert.equal(pending.chargeDateSource,'unassigned_after_bank_settlement');assert.equal(pending.includedInIlsTotal,false,'the engine must not invent the same day next month');
  assert.equal(ordersUpcoming.date,'');assert.equal(ordersUpcoming.unassignedCount,1);assert.equal(ordersUpcoming.complete,false,'Orders live card status reports the uncertainty instead of falling back to the raw settled cycle');
  const longTerm=bankLongTermPositionData(posted,'2026-09-10');
  assert.equal(longTerm.credit,0);assert.equal(longTerm.forecastIncomplete,true);assert.equal(longTerm.unassignedCount,1,'Kupa long-term balance fails closed when settlement leaves no proven next billing cycle');
  const kupaDetail=creditMonthlyDetailData(posted,'2026-09-10').months,ordersDetail=ordersDetailMonths(posted,{asOf:'2026-09-10'});
  assert.equal(kupaDetail.find(month=>month.key==='2026-09').items.filter(row=>row.status!=='pending').length,1);assert.equal(kupaDetail.at(-1).key,'unassigned');assert.equal(kupaDetail.at(-1).items[0].status,'pending');
  assert.equal(ordersDetail.find(month=>month.key==='2026-09').items.filter(row=>row.status!=='pending').length,1);assert.equal(ordersDetail.at(-1).key,'unassigned');assert.equal(ordersDetail.at(-1).items[0].status,'pending');
});

test('completed transactions without issuer billing dates infer a real cycle or stay unassigned, never use purchase date',()=>{
  const inferred={accountNumber:'infer-final',pendingStatus:'success',txns:[
    {id:'jul',status:'completed',processedDate:'2026-07-10',chargedAmount:-1,chargedCurrency:'ILS'},
    {id:'aug',status:'completed',processedDate:'2026-08-10',chargedAmount:-1,chargedCurrency:'ILS'},
    {id:'sep',status:'completed',processedDate:'2026-09-10',chargedAmount:-1,chargedCurrency:'ILS'},
    {id:'missing-date',status:'completed',date:'2026-09-11',transactionDate:'2026-09-11',chargedAmount:-200,chargedCurrency:'ILS'},
  ]},inferredState=stateFor([inferred]),row=kupaEngine.creditBillingRowsData(inferredState,{asOf:'2026-09-11'}).find(item=>item.creditId.includes('missing-date'));
  assert.equal(row.date,'2026-10-10');assert.equal(row.chargeDateSource,'inferred_billing_day');assert.notEqual(row.date,row.transactionDate);

  const unknown={accountNumber:'unknown-final',pendingStatus:'success',txns:[{id:'unknown-final-row',status:'completed',date:'2026-09-11',transactionDate:'2026-09-11',chargedAmount:-200,chargedCurrency:'ILS'}]},unknownState=stateFor([unknown]),unknownRow=kupaEngine.creditBillingRowsData(unknownState,{asOf:'2026-09-11'})[0];
  assert.equal(unknownRow.date,'');assert.equal(unknownRow.chargeDateSource,'unassigned');assert.equal(unknownRow.includedInIlsTotal,false);
  assert.equal(creditMonthlyDetailData(unknownState,'2026-09-11').months.at(-1).key,'unassigned');assert.equal(ordersDetailMonths(unknownState,{asOf:'2026-09-11'}).at(-1).key,'unassigned');
  assert.equal(kupaFrameStatus(unknown,{manualFrame:1000},'2026-09-11').available,1000);assert.equal(ordersFrameStatus(unknown,{manualFrame:1000},'2026-09-11').available,1000,'fallback card-frame availability never turns a purchase date into a future billing commitment');

  const hintedAccount={accountNumber:'hinted-final',balanceDate:'2026-10-15',pendingStatus:'success',months:[{month:'2026-09',providerSchemaVersion:'isracard-digitalv3',transactions:[{id:'hinted',status:'completed',transactionDate:'2026-08-28',chargedAmount:-75,chargedCurrency:'ILS'}]}]},hintedState=stateFor([hintedAccount]),hintedRow=kupaEngine.creditBillingRowsData(hintedState,{asOf:'2026-09-01'})[0];
  assert.equal(hintedRow.date,'2026-09-15');assert.equal(hintedRow.chargeDateSource,'issuer_next_charge_day');assert.equal(hintedRow.billingDateConfidence,'inferred','a trusted issuer month slice can use the issuer next-charge day without pretending the exact date was supplied');
  assert.equal(kupaEngine.creditBillingISODate('2026-02-31'),'');assert.equal(kupaEngine.creditBillingISODate('2026-13-10'),'','impossible calendar dates fail closed before they can become billing cycles');
});

test('every known-date missing amount keeps its cycle in the horizon as an explicit partial estimate',()=>{
  const account={accountNumber:'partial',pendingStatus:'success',txns:[
    {id:'partial-sep',status:'completed',processedDate:'2026-09-15',chargedAmount:null,originalAmount:null,chargedCurrency:'ILS'},
    {id:'known-oct',status:'completed',processedDate:'2026-10-15',chargedAmount:-100,chargedCurrency:'ILS'},
  ]},state=stateFor([account]),row=kupaEngine.creditBillingRowsData(state,{asOf:'2026-09-10'})[0],cycle=kupaEngine.creditBillingCyclesData(state,{asOf:'2026-09-10'})[0],horizon=kupaCashflow(state,'עסקי','2026-09-10'),upcoming=kupaEngine.creditAccountUpcomingChargeData(account,'max','2026-09-10');
  assert.equal(row.source,'credit_unknown');assert.equal(row.amountStatus,'unknown_amount');assert.equal(row.unconverted,false);
  assert.equal(cycle.status,'incomplete');assert.equal(cycle.unknownAmountCount,1);assert.equal(horizon.targetDate,'2026-09-15');assert.equal(horizon.forecastIncomplete,true);assert.equal(horizon.incompleteCreditRows.length,1);
  assert.equal(upcoming.date,'2026-09-15');assert.equal(upcoming.amount,0);assert.equal(upcoming.amountKnown,false,'the known partial September cycle must not be skipped in favor of October');
  const longTerm=bankLongTermPositionData(state,'2026-09-10');
  assert.equal(longTerm.credit,100);assert.equal(longTerm.forecastIncomplete,true);assert.equal(longTerm.missingAmountCount,1,'Kupa long-term balance includes known future ILS while declaring the missing amount');
});

test('stale and missing issuer month coverage remains an explicit best-effort partial forecast',()=>{
  const account={accountNumber:'coverage',balanceDate:'2026-10-15',pendingStatus:'success',months:[
    {month:'2026-09',status:'stale',fetchStatus:'provider_error',providerSchemaVersion:'isracard-digitalv3',transactions:[{id:'sep-lkg',status:'completed',processedDate:'2026-09-15',chargedAmount:-400,chargedCurrency:'ILS'}]},
    {month:'2026-10',status:'missing',fetchStatus:'provider_error',providerSchemaVersion:'isracard-digitalv3',transactions:[]},
  ]},state=stateFor([account],{provider:'isracard'});
  const september=kupaCashflow(state,'עסקי','2026-09-10'),staleRow=september.nextCreditRows.find(row=>row.creditId.includes('sep-lkg'));
  assert.equal(september.targetDate,'2026-09-15');assert.equal(september.credit,400,'a stale LKG amount remains the conservative best available cash-flow estimate');
  assert.equal(staleRow.coverageIncomplete,true);assert.equal(september.forecastIncomplete,true,'LKG money is never presented as a complete issuer forecast');
  state.bank.asOfDate='2026-09-16';state.bank.feed.syncedAt='2026-09-16T08:00:00Z';state.bank.feed.transactions=[{date:'2026-09-15',amount:-400,description:'ישראכרט בע״מ'}];
  const october=kupaCashflow(state,'עסקי','2026-09-16'),placeholder=october.incompleteCreditRows.find(row=>row.coverageIncomplete);
  assert.equal(october.targetDate,'2026-10-15');assert.equal(october.credit,0);assert.equal(placeholder.chargeDateSource,'issuer_next_charge_day','a missing issuer slice retains the inferred cycle date but never invents an amount');
  const ordersOctober=ordersCreditMonthBuckets(state,{view:'all',asOf:'2026-09-16'}).months.find(month=>month.key==='2026-10');
  assert.equal(ordersOctober.partial,true);assert.equal(ordersOctober.coverageGapCount,1);assert.equal(ordersOctober.total,0,'Orders keeps a zero-known missing cycle visible instead of silently skipping it');
});

test('Orders dashboard readout is a thin adapter over the exact shared cash-flow horizon',()=>{
  const kupa=structuredClone(twoCards);kupa.bank.asOfDate='2026-09-11';kupa.bank.feed.syncedAt='2026-09-11T08:00:00Z';kupa.expenses=[{id:'sep',active:true,recurring:false,account:'עסקי',date:'2026-09-20',amount:100},{id:'oct-in',active:true,recurring:false,account:'עסקי',date:'2026-10-05',amount:200},{id:'oct-out',active:true,recurring:false,account:'עסקי',date:'2026-10-11',amount:300}];
  const checks=[{id:'in',status:'בקופה',account:'עסקי',dueDate:'2026-10-09',amount:400},{id:'out',status:'בקופה',account:'עסקי',dueDate:'2026-10-11',amount:500}],reference=checkTodayISO(),readout=computeKupaNetReadoutData({checks},kupa),shared=ordersCashflow({...kupa,checks},'עסקי',reference);
  assert.equal(readout.targetDate,shared.targetDate);assert.equal(readout.credit,shared.credit);assert.equal(readout.expenses,shared.expenses);assert.equal(readout.checks,shared.checks);assert.equal(readout.net,shared.projected);
  assert.deepEqual(readout.nextCreditCycles,shared.nextCreditCycles,'Orders dashboard and its main Bank view consume the same cycles, not parallel formulas');
});

test('expenses and checks obey the same exact horizon across intervening months',()=>{
  const state=structuredClone(twoCards);state.bank.asOfDate='2026-09-11';state.bank.feed.syncedAt='2026-09-11T08:00:00Z';state.expenses=[{id:'sep',active:true,recurring:false,account:'עסקי',date:'2026-09-20',amount:100},{id:'oct-in',active:true,recurring:false,account:'עסקי',date:'2026-10-05',amount:200},{id:'oct-out',active:true,recurring:false,account:'עסקי',date:'2026-10-11',amount:300}];state.checks=[{id:'in',status:'בקופה',account:'עסקי',dueDate:'2026-10-09',amount:400},{id:'out',status:'בקופה',account:'עסקי',dueDate:'2026-10-11',amount:500}];
  const result=kupaCashflow(state,'עסקי','2026-09-11');
  assert.equal(result.targetDate,'2026-10-10');assert.deepEqual(result.targetExpenseRows.map(row=>row.id),['sep','oct-in']);assert.deepEqual(result.checkRows.map(row=>row.id),['in']);assert.equal(result.expenses,300);assert.equal(result.checks,400);
});

test('generated shared engines have the same public contract and results',()=>{
  assert.deepEqual(Object.keys(kupaEngine).sort(),Object.keys(ordersEngine).sort());
  const summarize=engine=>engine.creditBillingCyclesData(twoCards,{asOf:'2026-09-01'}).map(cycle=>({date:cycle.date,total:cycle.total,pending:cycle.pendingTotal,status:cycle.status}));
  assert.deepEqual(summarize(kupaEngine),summarize(ordersEngine));
});

test('bank settlement closes an unknown-amount or FX cycle, but absence of bank evidence does not',()=>{
  for(const amounts of [{chargedAmount:null,originalAmount:null},{chargedAmount:-200,chargedCurrency:'USD',originalAmount:-200,originalCurrency:'USD'}]){
    const state=stateFor([{accountNumber:'2222',balanceDate:'2026-09-10',pendingFetchedAt:'2026-09-10T08:00:00Z',pendingStatus:'success',txns:[
      {id:'sep',status:'completed',processedDate:'2026-09-10',...amounts},
      {id:'pending',status:'pending',transactionDate:'2026-09-09',chargedAmount:-100,chargedCurrency:'ILS'},
      {id:'oct',status:'completed',processedDate:'2026-10-10',chargedAmount:-1100,chargedCurrency:'ILS'},
    ]}]);
    state.bank.asOfDate='2026-09-10';state.bank.feed.syncedAt='2026-09-10T08:00:00Z';
    const unposted=kupaCashflow(state,'עסקי','2026-09-10');
    assert.equal(unposted.targetDate,'2026-09-10');assert.equal(unposted.credit,100);assert.equal(unposted.forecastIncomplete,true);
    state.bank.feed.transactions=[{date:'2026-09-10',amount:-1000,description:'MAX'}];
    const posted=kupaCashflow(state,'עסקי','2026-09-10');
    assert.equal(posted.targetDate,'2026-10-10');assert.equal(posted.credit,1200);assert.equal(posted.projected,8800);assert.equal(posted.forecastIncomplete,false);
    assert.equal(posted.creditRows.some(row=>row.date==='2026-09-10'),false);
    assert.deepEqual(posted,ordersCashflow(state,'עסקי','2026-09-10'));
  }
});

test('an inferred final next cycle is not proof for rolling pending forward',()=>{
  const state=stateFor([{accountNumber:'2222',balanceDate:'2026-09-10',pendingStatus:'success',pendingFetchedAt:'2026-09-10',txns:[
    ...['07','08','09'].map(month=>({id:month,status:'completed',processedDate:`2026-${month}-10`,chargedAmount:-1000,chargedCurrency:'ILS'})),
    {id:'inferred-oct',status:'completed',transactionDate:'2026-09-11',chargedAmount:-1100,chargedCurrency:'ILS'},
    {id:'pending',status:'pending',transactionDate:'2026-09-09',chargedAmount:-100,chargedCurrency:'ILS'},
  ]}]);
  state.bank.asOfDate='2026-09-10';state.bank.feed.syncedAt='2026-09-10';state.bank.feed.transactions=[{date:'2026-09-10',amount:-1000,description:'MAX'}];
  const result=kupaCashflow(state,'עסקי','2026-09-10'),pending=result.unassignedCreditRows[0];
  assert.equal(result.credit,1100);assert.equal(result.forecastIncomplete,true);assert.equal(pending.chargeDateSource,'unassigned_after_bank_settlement');
  assert.equal(pending.date,'');assert.equal(pending.amount,0);
  const upcoming=ordersCreditAccountModels(state,'2026-09-10')[0].upcomingCharge;
  assert.equal(upcoming.complete,false);assert.equal(upcoming.unassignedCount,1);assert.equal(upcoming.status,'incomplete');
  assert.equal(kupaCashflow(state,'עסקי','2026-09-11').unassignedCreditRows[0].date,'','reopening tomorrow must not restore an inferred pending cycle');
});

test('pending freshness has an inclusive two-calendar-day limit and rejects unknown timestamps',()=>{
  const account={accountNumber:'2222',balanceDate:'2026-09-15',pendingStatus:'success',pendingFetchedAt:'2026-09-08T23:59:59Z',txns:[{id:'p',status:'pending',transactionDate:'2026-09-08',chargedAmount:-100,chargedCurrency:'ILS'}]};
  const state=stateFor([account]);
  assert.equal(kupaCashflow(state,'עסקי','2026-09-10').credit,100);
  for(const fetched of ['2026-08-20T12:00:00Z','2026-09-07T00:00:00Z','',null,'invalid','2026-09-10invalid','2026-09-11']){
    account.pendingFetchedAt=fetched;
    const result=kupaCashflow(state,'עסקי','2026-09-10');
    assert.equal(result.credit,0);assert.equal(result.forecastIncomplete,true);assert.equal(result.incompleteCreditRows[0].pendingFresh,false);
    assert.equal(kupaEngine.creditPendingAuthorizationTotalData(account,'2026-09-10'),0);
    assert.equal(kupaFrameStatus(account,{manualFrame:1000},'2026-09-10').available,1000);
  }
  account.pendingFetchedAt='2026-09-10';account.pendingStatus='network_error';
  assert.equal(kupaEngine.creditPendingFreshData(account,'2026-09-10'),false);
});

test('cross-identifier pending correlation is scoped, unique, minute-precise and currency-aware',()=>{
  const purchase={transactionDate:'2026-09-09',transactionTime:'12:34',description:'חנות',originalAmount:-100,originalCurrency:'ILS',chargedAmount:-100,chargedCurrency:'ILS'},pending={...purchase,status:'pending',identifier:''},final={...purchase,status:'completed',identifier:'voucher-1',processedDate:'2026-09-15'},account={accountNumber:'2222',balanceDate:'2026-09-15',pendingStatus:'success',pendingFetchedAt:'2026-09-10',txns:[pending,final]};
  const pendingRows=accounts=>kupaEngine.creditBillingRowsData(stateFor(accounts),{asOf:'2026-09-10'}).filter(row=>row.status==='pending');
  assert.equal(pendingRows([account]).length,0);
  pending.identifier='approval-1';assert.equal(pendingRows([account]).length,0);
  assert.equal(kupaEngine.creditPendingAuthorizationTotalData(account,'2026-09-10'),0,'fallback frame uses the same correlation');
  for(const change of [{transactionTime:''},{transactionTime:'12:35'},{transactionDate:'2026-09-08'},{description:'חנות אחרת'},{originalCurrency:'USD'},{originalAmount:100},{installments:{number:1,total:3}}]){
    assert.equal(pendingRows([{...account,txns:[pending,{...final,...change}]}]).length,1);
  }
  assert.equal(pendingRows([{...account,txns:[pending,{...pending,identifier:'approval-2'},final]}]).length,2,'two similar real purchases stay visible');
  assert.equal(pendingRows([{...account,txns:[pending,final,{...final,identifier:'voucher-2'}]}]).length,1,'ambiguous vouchers cannot consume an approval');
  assert.equal(pendingRows([{...account,txns:[pending]},{...account,accountNumber:'3333',txns:[final]}]).length,1,'a different card cannot consume this approval');
});

test('unknown amounts across multiple cards require enough bank evidence',()=>{
  const state=stateFor(['2222','3333'].map(accountNumber=>({accountNumber,txns:[{id:'sep',status:'completed',processedDate:'2026-09-10',chargedAmount:null}]})));
  state.bank.asOfDate='2026-09-10';state.bank.feed.syncedAt='2026-09-10';state.bank.feed.transactions=[{date:'2026-09-10',amount:-1000,description:'MAX'}];
  assert.equal(kupaCashflow(state,'עסקי','2026-09-10').incompleteCreditRows.length,2,'one generic provider debit cannot identify two unknown card cycles');
  state.bank.feed.transactions[0].description='MAX 2222';
  const result=kupaCashflow(state,'עסקי','2026-09-10');
  assert.equal(result.incompleteCreditRows.length,1);assert.equal(result.incompleteCreditRows[0].accountNumber,'3333');
});

test('a matching bank amount from a different issuer cannot settle this card',()=>{
  const state=stateFor([{accountNumber:'2222',txns:[{id:'sep',status:'completed',processedDate:'2026-09-10',chargedAmount:-1000,chargedCurrency:'ILS'}]}]);
  state.bank.asOfDate='2026-09-10';state.bank.feed.syncedAt='2026-09-10';state.bank.feed.transactions=[{date:'2026-09-10',amount:-1000,description:'כרטיסי אשראי לישראל'}];
  assert.equal(kupaCashflow(state,'עסקי','2026-09-10').credit,1000);
  for(const row of [{date:'2026-09-10',amount:-1000,description:'MAX',status:'pending'},{date:'2026-09-10',amount:-1000,description:'MAX',presenceState:'missing'}]){
    state.bank.feed.transactions=[row];assert.equal(kupaCashflow(state,'עסקי','2026-09-10').credit,1000);
  }
});

test('cashflow contributing rows reconcile to signed totals, including refunds and elapsed expenses',()=>{
  const state=stateFor([{accountNumber:'2222',txns:[{id:'purchase',processedDate:'2026-09-15',chargedAmount:-100.11,chargedCurrency:'ILS'},{id:'refund',processedDate:'2026-09-15',chargedAmount:20.01,chargedCurrency:'ILS'}]}]);
  state.expenses=[{id:'old',active:true,recurring:false,date:'2026-09-02',amount:30.03,name:'<script>bad</script>'},{id:'future',active:true,recurring:false,date:'2026-09-14',amount:40.04}];
  state.checks=[{id:'check',status:'בקופה',dueDate:'2026-09-14',amount:50.05}];
  const result=kupaCashflow(state,'עסקי','2026-09-10');
  assert.equal(result.creditRows.length,2);assert.equal(result.expenseRows.length,2);assert.equal(result.checkRows.length,1);
  assert.equal(result.credit,80.10);assert.equal(result.expenses,70.07);assert.equal(result.expectedChange,-100.12);assert.equal(result.projected,9899.88);
  const html=cashflowBreakdownMarkup(result);
  assert.ok(html.includes('2222'));assert.ok(html.includes('15/09/2026'));assert.ok(html.includes('02/09/2026'));assert.ok(html.includes('100.12'));
  assert.ok(!html.includes('<script>'));assert.ok(html.includes('&lt;script&gt;'));
});

test('settlement never arbitrarily chooses equal card cycles, regardless of input order',()=>{
  for(const generic of [false,true])for(const reverse of [false,true]){
    const accounts=['2222','3333'].map(accountNumber=>({accountNumber,balanceDate:'2026-09-10',pendingStatus:'success',pendingFetchedAt:'2026-09-10',txns:[
      {id:'sep',status:'completed',processedDate:'2026-09-10',chargedAmount:-1000,chargedCurrency:'ILS'},
      {id:'oct',status:'completed',processedDate:'2026-10-10',chargedAmount:-1100,chargedCurrency:'ILS'},
      ...(accountNumber==='2222'?[{id:'pending',status:'pending',transactionDate:'2026-09-09',chargedAmount:-100,chargedCurrency:'ILS'}]:[]),
    ]}));
    const state=stateFor(reverse?accounts.reverse():accounts);
    if(generic){const profile=state.creditSync.profiles[0];state.creditSync.profiles=[{...profile,accounts:profile.accounts.filter(a=>a.accountNumber==='2222')},{...profile,provider:'visaCal',accounts:profile.accounts.filter(a=>a.accountNumber==='3333')}]}
    state.bank.asOfDate='2026-09-10';state.bank.feed.syncedAt='2026-09-10';state.bank.feed.transactions=[{date:'2026-09-10',amount:-1000,description:generic?'חיוב כרטיס אשראי':'MAX'}];
    const result=kupaCashflow(state,'עסקי','2026-09-10');
    assert.equal(result.credit,2100);assert.equal(result.nextCreditCycles.length,2);
    assert.equal(result.creditRows.find(row=>row.status==='pending').date,'2026-09-10');
    state.creditSync.cardMappings['cards:3333'].hidden=true;
    const detail=creditMonthlyDetailData(state,'2026-09-10');
    assert.equal(detail.months.flatMap(month=>month.items).find(row=>row.status==='pending').date,'2026-09-10','hiding another card cannot turn an ambiguous settlement into proof');
  }
});

test('past-due unknown and FX amounts stay incomplete until bank proof or explicit expiry',()=>{
  for(const future of [false,true])for(const amount of [{chargedAmount:null},{chargedAmount:-50,chargedCurrency:'USD',originalAmount:-50,originalCurrency:'USD'}]){
    const state=stateFor([{accountNumber:'2222',txns:[{id:'sep',status:'completed',processedDate:'2026-09-10',...amount},...(future?[{id:'oct',status:'completed',processedDate:'2026-10-10',chargedAmount:-1100,chargedCurrency:'ILS'}]:[])]}]);
    state.bank.asOfDate='2026-09-11';state.bank.feed.syncedAt='2026-09-11';
    const waiting=kupaCashflow(state,'עסקי','2026-09-11'),long=bankLongTermPositionData(state,'2026-09-11');
    assert.equal(waiting.forecastIncomplete,true);assert.equal(waiting.elapsedIncompleteCreditRows.length,1);assert.equal(waiting.credit,future?1100:0);
    assert.equal(long.forecastIncomplete,true);assert.equal(long.missingAmountCount,1);
    assert.equal(ordersCreditAccountModels(state,'2026-09-11')[0].upcomingCharge.complete,false);
    assert.ok(cashflowBreakdownMarkup(waiting).includes('התחזית חלקית'));
    assert.deepEqual(waiting,ordersCashflow(state,'עסקי','2026-09-11'));
    state.bank.feed.transactions=[{date:'2026-09-11',amount:-1000,description:'MAX'}];
    assert.equal(kupaCashflow(state,'עסקי','2026-09-11').forecastIncomplete,false);assert.equal(bankLongTermPositionData(state,'2026-09-11').forecastIncomplete,false);
    state.bank.feed.transactions=[];state.bank.asOfDate='2026-09-12';state.bank.feed.syncedAt='2026-09-12';
    const expired=kupaCashflow(state,'עסקי','2026-09-12');
    assert.equal(expired.forecastIncomplete,false);assert.equal(expired.expiredSettlementWarnings.length,1);assert.equal(expired.expiredSettlementWarnings[0].amountKnown,false);
    assert.ok(cashflowBreakdownMarkup(expired).includes('סכום לא ידוע'));
    assert.equal(bankLongTermPositionData(state,'2026-09-12').expiredSettlementWarnings.length,1);
  }
});

test('pending calendar freshness uses the same local day as asOf, including DST boundaries',()=>{
  const prior=process.env.TZ;
  try{
    process.env.TZ='Asia/Jerusalem';
    const account={pendingStatus:'success',pendingFetchedAt:'2026-09-10T22:00:00Z'};
    assert.equal(kupaEngine.creditPendingFreshData(account,'2026-09-13'),true);
    assert.equal(kupaEngine.creditPendingFreshData(account,'2026-09-14'),false);
    account.pendingFetchedAt='2026-03-26T22:30:00Z';
    assert.equal(kupaEngine.creditPendingFreshData(account,'2026-03-29'),true);
    account.pendingFetchedAt='2026-10-24T22:30:00Z';
    assert.equal(kupaEngine.creditPendingFreshData(account,'2026-10-27'),true);
    account.pendingFetchedAt='2026-09-11';assert.equal(kupaEngine.creditPendingFreshData(account,'2026-09-13'),true);
  }finally{if(prior===undefined)delete process.env.TZ;else process.env.TZ=prior}
});

test('global settlement respects suffixes, exact aggregates, splits and competing explanations',()=>{
  const make=(amounts,debits)=>{
    const state=stateFor(amounts.map((amount,index)=>({accountNumber:String(2222+index*1111),txns:[{id:'sep',status:'completed',processedDate:'2026-09-10',chargedAmount:amount===null?null:-amount,chargedCurrency:'ILS'}]})));
    state.bank.asOfDate='2026-09-10';state.bank.feed.syncedAt='2026-09-10';state.bank.feed.transactions=debits.map(([amount,description='MAX'])=>({date:'2026-09-10',amount:-amount,description}));return state;
  };
  const remaining=state=>kupaReconciledCreditRowsData(state,'עסקי','2026-09-10').filter(row=>row.date==='2026-09-10').map(row=>row.accountNumber).sort();
  for(const reverse of [false,true]){
    const cases=[
      [[1000,1000],[[1000,'MAX 3333']],['2222']],
      [[1000,2000],[[1000,'MAX 3333']],['2222']],
      [[1000,1000],[[2000]],[]],
      [[1000,1000],[[1000],[1000]],[]],
      [[1000,1000,2000],[[2000]],['2222','3333','4444']],
      [[1000,2000],[[1000]],['3333']],
      [[1000],[[600,'חיוב כרטיס אשראי'],[400,'חיוב כרטיס אשראי']],[]],
      [[1000,600,400],[[600,'חיוב כרטיס אשראי'],[400,'חיוב כרטיס אשראי']],['2222','3333','4444']],
      [[1000,null],[[1000]],['2222','3333']],
    ];
    for(const [amounts,debits,expected] of cases){const state=make(amounts,debits);if(reverse){state.creditSync.profiles[0].accounts.reverse();state.bank.feed.transactions.reverse()}assert.deepEqual(remaining(state),expected,JSON.stringify({amounts,debits,reverse}))}
  }
});

test('elapsed and same-day cycles compete globally for the same bank evidence',()=>{
  const state=stateFor(['2222','3333'].map((accountNumber,index)=>({accountNumber,txns:[{id:'due',status:'completed',processedDate:index?'2026-09-11':'2026-09-10',chargedAmount:-1000,chargedCurrency:'ILS'}]})));
  state.bank.asOfDate='2026-09-11';state.bank.feed.syncedAt='2026-09-11';state.bank.feed.transactions=[{date:'2026-09-11',amount:-1000,description:'MAX'}];
  const result=kupaCashflow(state,'עסקי','2026-09-11');assert.equal(result.credit,2000);assert.equal(result.settlingCredit,1000);
  state.bank.feed.transactions[0].description='MAX 3333';
  const identified=kupaCashflow(state,'עסקי','2026-09-11');assert.equal(identified.credit,1000);assert.equal(identified.settlingCredit,1000,'one bank debit cannot close both the elapsed and same-day card');
});

test('large independent card sets settle; oversized connected ambiguities fail closed',()=>{
  const accounts=Array.from({length:13},(_,index)=>({accountNumber:String(1000+index),txns:[{id:'sep',status:'completed',processedDate:'2026-09-10',chargedAmount:-1000,chargedCurrency:'ILS'}]})),state=stateFor(accounts);
  state.bank.asOfDate='2026-09-10';state.bank.feed.syncedAt='2026-09-10';state.bank.feed.transactions=accounts.map(account=>({date:'2026-09-10',amount:-1000,description:`MAX ${account.accountNumber}`}));
  assert.equal(kupaCashflow(state,'עסקי','2026-09-10').credit,0);
  state.bank.feed.transactions=[{date:'2026-09-10',amount:-1000,description:'MAX'}];
  assert.equal(kupaCashflow(state,'עסקי','2026-09-10').credit,13000);
});

test('unknown elapsed amounts stay visible with old or missing bank snapshots in both accounts',()=>{
  for(const accountRole of ['עסקי','ביתי'])for(const bankMode of ['old','missing']){
    const state=stateFor([{accountNumber:'2222',txns:[{id:'unknown',status:'completed',processedDate:'2026-09-10',chargedAmount:null}]}],{accountRole});
    state.bank.asOfDate='2026-09-09';state.bank.feed.syncedAt='2026-09-09';state.bank.homeFeed={balance:5000,syncedAt:'2026-09-09',transactions:[]};
    if(bankMode==='missing'){state.bank.feed=null;state.bank.homeFeed=null}
    const waiting=kupaCashflow(state,accountRole,'2026-09-11');
    assert.equal(waiting.forecastIncomplete,true);assert.equal(waiting.incompleteCreditRows.length,1);assert.equal(waiting.elapsedIncompleteCreditRows.length,1);
    assert.deepEqual(waiting,ordersCashflow(state,accountRole,'2026-09-11'));
    const expired=kupaCashflow(state,accountRole,'2026-09-12');
    assert.equal(expired.forecastIncomplete,false);assert.equal(expired.expiredSettlementWarnings.length,1);
    if(accountRole==='עסקי'){assert.equal(bankLongTermPositionData(state,'2026-09-11').missingAmountCount,1);assert.equal(bankLongTermPositionData(state,'2026-09-12').missingAmountCount,0)}
  }
});

test('a newer charge on the same card cannot hide an earlier missing cycle or its warning',()=>{
  const state=stateFor([{accountNumber:'2222',txns:[{id:'unknown',status:'completed',processedDate:'2026-09-10',chargedAmount:null},{id:'newer',status:'completed',processedDate:'2026-09-11',chargedAmount:-500,chargedCurrency:'ILS'}]}]);
  state.bank.asOfDate='2026-09-11';state.bank.feed.syncedAt='2026-09-11';
  assert.equal(kupaCashflow(state,'עסקי','2026-09-11').elapsedIncompleteCreditRows.length,1);
  state.bank.asOfDate='2026-09-12';state.bank.feed.syncedAt='2026-09-12';
  const result=kupaCashflow(state,'עסקי','2026-09-12');
  assert.equal(result.credit,500);assert.equal(result.expiredSettlementWarnings.filter(row=>row.dueDate==='2026-09-10').length,1);
});
