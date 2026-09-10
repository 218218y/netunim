import test from 'node:test';
import assert from 'node:assert/strict';
import * as kupaEngine from '../netunim-kupa/site/assets/js/shared/credit-billing-cycles.js';
import * as ordersEngine from '../netunim-orders/site/assets/js/shared/credit-billing-cycles.js';
import {kupaAccountCashflowData as kupaCashflow} from '../netunim-kupa/site/assets/js/shared/kupa-cashflow.js';
import {kupaAccountCashflowData as ordersCashflow} from '../netunim-orders/site/assets/js/shared/kupa-cashflow.js';
import {allInstallmentsData,creditMonthlyDetailData} from '../netunim-kupa/site/assets/js/domains/credit/model.js';
import {creditFrameStatus as kupaFrameStatus} from '../netunim-kupa/site/assets/js/domains/credit/sync-feed.js';
import {creditRows as ordersCreditRows,creditDetailMonths as ordersDetailMonths} from '../netunim-orders/site/assets/js/domains/finance/reporting.js';
import {creditFrameStatus as ordersFrameStatus} from '../netunim-orders/site/assets/js/domains/finance/credit-feed.js';

function stateFor(accounts,{provider='max',profileId='cards',accountRole='עסקי'}={}){
  const mappings={};for(const account of accounts)mappings[`${profileId}:${account.accountNumber}`]={included:true,hidden:false,account:accountRole};
  return {version:4,credits:[],checks:[],expenses:[],cashflowSettings:{businessMinimum:0,businessCheckCutoffDay:14},bank:{currentBalance:10000,asOfDate:'2026-09-01',source:'hapoalim',adjustments:[],feed:{syncedAt:'2026-09-01T08:00:00Z',balance:10000,transactions:[]}},creditSync:{version:4,profiles:[{profileId,provider,defaultAccount:accountRole,accounts}],cardMappings:mappings}};
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
  assert.deepEqual(kupaEngine.creditPendingBillingDateData(inferred,inferred.txns[3],'2026-09-11'),{date:'2026-10-10',source:'inferred_billing_day',confidence:'inferred'});

  const unknown={accountNumber:'4',pendingStatus:'success',txns:[{id:'unknown',status:'pending',transactionDate:'2026-09-11',chargedAmount:-40,chargedCurrency:'ILS'}]};
  assert.deepEqual(kupaEngine.creditPendingBillingDateData(unknown,unknown.txns[0],'2026-09-11'),{date:'',source:'unassigned',confidence:'unassigned'});
  const unknownState=stateFor([unknown]),model=kupaEngine.creditBillingModelData(unknownState,{asOf:'2026-09-11'});
  assert.equal(model.unassignedRows.length,1);assert.equal(model.unassignedRows[0].uncertainBillingDate,true);
  assert.equal(creditMonthlyDetailData(unknownState,'2026-09-11').months.at(-1).key,'unassigned','Kupa exposes uncertain pending cycles instead of assigning them to the current date');
  assert.equal(ordersDetailMonths(unknownState,{asOf:'2026-09-11'}).at(-1).key,'unassigned','Orders exposes the same uncertain-cycle bucket');
});

test('pending ILS estimates, FX exclusions, freshness and transition deduplication are explicit',()=>{
  const state=stateFor([{accountNumber:'4545',balanceDate:'2026-09-10',pendingStatus:'success',txns:[
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
  const state=stateFor([{accountNumber:'7777',balanceDate:'2026-09-10',pendingStatus:'success',txns:[{id:'pending',status:'pending',transactionDate:'2026-09-03',chargedAmount:0,chargedCurrency:'ILS',originalAmount:-237.4,originalCurrency:'ILS'}]}]);
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
