import {createUiDateEditor} from '../netunim-kupa/site/assets/js/ui/date-editor.js';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {kupaAccountCashflowData as calculate} from '../shared/kupa-cashflow.js';
import {kupaAccountCashflowData as orders} from '../netunim-orders/site/assets/js/domains/bank/readout.js';
import {kupaAccountCashflowData as kupa} from '../netunim-kupa/site/assets/js/shared/kupa-cashflow.js';
import {cashflowBreachMarkup,cashflowExplorerMarkup} from '../shared/cashflow-breakdown.js';

const debit=(description,amount,date)=>({id:`${description}:${date}`,description,amount:-amount,date,status:'completed'});
const credit=(id,date,amount,account='עסקי')=>({id,card:id,active:true,account,firstChargeDate:date,totalAmount:amount,installments:1});
function fixture(ref='2026-09-14'){
  return {credits:[],expenses:[],checks:[],cashflowSettings:{businessCheckCutoffDay:9,homeCheckCutoffDay:9},bank:{source:'hapoalim',currentBalance:10000,asOfDate:ref,feed:{syncedAt:ref,balance:10000,transactions:[]},homeFeed:{syncedAt:ref,balance:20000,transactions:[debit('פועלים-משכנתא',1000,'2026-08-16'),debit('בנק מרכנתיל די',4000,'2026-08-16')]}}};
}
test('each account completes its current monthly bills before advancing, with inclusive cheque dates',()=>{
  const state=fixture();state.credits=[credit('business','2026-09-15',100),credit('home','2026-09-10',200,'ביתי'),credit('home-next','2026-10-10',300,'ביתי')];
  state.bank.homeFeed.transactions.push(debit('חיוב אשראי',200,'2026-09-10'));
  state.checks=[{id:'due',status:'בקופה',account:'ביתי',dueDate:'2026-09-15',amount:500},{id:'later',status:'בקופה',account:'ביתי',dueDate:'2026-09-16',amount:900}];
  const before=structuredClone(state);
  for(const engine of [calculate,orders,kupa]){
    const home=engine(state,'ביתי','2026-09-14');
    assert.equal(home.targetDate,'2026-09-15');assert.equal(home.credit,0);assert.equal(home.expenses,5000);assert.equal(home.checks,500);assert.equal(home.projected,15500);
    assert.equal(engine(state,'עסקי','2026-09-14').credit,100);
  }
  assert.deepEqual(state,before);
  state.bank.homeFeed.transactions.push(debit('פועלים-משכנתא',1100,'2026-09-14'));
  assert.equal(calculate(state,'ביתי','2026-09-14').expenses,4000);
  state.bank.homeFeed.transactions.push(debit('בנק מרכנתיל די',4100,'2026-09-14'));
  const next=calculate(state,'ביתי','2026-09-14');
  assert.equal(next.targetDate,'2026-10-15');assert.equal(next.expenses,5200);assert.equal(next.credit,300);
});
test('a paid early card cannot pull the remaining current card into next month',()=>{
  const state=fixture('2026-09-11');state.credits=[credit('early','2026-09-10',100),credit('later','2026-09-15',200),credit('early-next','2026-10-10',300)];
  state.bank.feed.transactions=[debit('חיוב אשראי',100,'2026-09-10')];
  const flow=calculate(state,'עסקי','2026-09-11');assert.equal(flow.targetDate,'2026-09-15');assert.equal(flow.credit,200);
});
test('unmatched credit remains after two days and late bank posting settles it once',()=>{
  const state=fixture('2026-09-20');state.credits=[credit('card','2026-09-15',1000),credit('next','2026-10-15',1500)];
  let flow=calculate(state,'עסקי','2026-09-20');assert.equal(flow.credit,1000);assert.equal(flow.targetDate,'2026-09-20');assert.equal(flow.awaitingSettlement,true);
  state.bank.feed.transactions=[debit('חיוב אשראי',1000,'2026-09-19')];state.bank.currentBalance=9000;
  flow=calculate(state,'עסקי','2026-09-20');assert.equal(flow.targetDate,'2026-10-15');assert.equal(flow.credit,1500);assert.equal(flow.projected,7500);
});
test('missing mortgage posting holds the current cycle even after its estimated date',()=>{
  const state=fixture('2026-09-28'),flow=calculate(state,'ביתי','2026-09-28');
  assert.equal(flow.targetDate,'2026-09-28');assert.equal(flow.expenses,5000);assert.equal(flow.awaitingSettlement,true);
  assert.ok(flow.expenseRows.every(row=>row.dueDate==='2026-09-15'));
});
test('first daily breach is visible even outside notification lead time and before later recovery',()=>{
  const state=fixture('2026-09-16');state.bank.currentBalance=1000;state.cashflowSettings.businessAlertLeadDays=0;
  state.credits=[credit('card','2026-10-15',100)];state.expenses=[{id:'rent',active:true,recurring:false,account:'עסקי',date:'2026-09-28',amount:1200}];
  state.checks=[{id:'recovery',status:'בקופה',account:'עסקי',dueDate:'2026-10-01',amount:2000}];
  let flow=calculate(state,'עסקי','2026-09-16');assert.equal(flow.targetDate,'2026-10-15');assert.equal(flow.projected,1700);assert.equal(flow.breach.projected,-200);assert.equal(flow.breach.breachDate,'2026-09-28');assert.equal(flow.breach.active,false);
  assert.match(cashflowBreachMarkup(flow),/28\/09\/2026/);
  state.cashflowSettings.businessMinimum=500;state.expenses[0].amount=500;
  flow=calculate(state,'עסקי','2026-09-16');assert.equal(flow.breach.breachDate,'2026-09-28');assert.equal(flow.breach.reason,'minimum');
  state.checks[0].dueDate='2026-09-28';assert.equal(calculate(state,'עסקי','2026-09-16').breach.breachDate,'');
});
test('custom December 8 forecast repeats expenses and sums all known credit and cheques only through that day',()=>{
  const state=fixture();state.credits=[{...credit('installments','2026-09-15',400,'ביתי'),installments:4}];
  state.expenses=[{id:'monthly',active:true,recurring:true,account:'ביתי',date:'2026-09-05',amount:10},{id:'boundary',active:true,recurring:false,account:'ביתי',date:'2026-12-08',amount:20},{id:'outside',active:true,recurring:false,account:'ביתי',date:'2026-12-09',amount:999},{id:'business',active:true,recurring:true,account:'עסקי',date:'2026-09-05',amount:999}];
  state.checks=[{id:'in',status:'בקופה',account:'ביתי',dueDate:'2026-12-08',amount:200},{id:'out',status:'בקופה',account:'ביתי',dueDate:'2026-12-09',amount:999},{id:'paid',status:'נפרע',account:'ביתי',dueDate:'2026-10-01',amount:999}];
  const original=structuredClone(state);
  for(const engine of [calculate,kupa,orders]){
    const flow=engine(state,'ביתי','2026-09-14',{targetDate:'2026-12-08'});
    assert.equal(flow.credit,300);assert.equal(flow.expenses,15050);assert.equal(flow.checks,200);assert.equal(flow.projected,4850);assert.equal(flow.nextCreditCycles.length,3);assert.equal(flow.start,'2026-09-14');
    assert.match(cashflowExplorerMarkup(flow,'cashflow-breakdown','home',createUiDateEditor({}).dateEditorMarkup),/value="2026-12-08"/);
    assert.equal(engine(state,'ביתי','2026-09-14',{targetDate:'2026-12-15'}).expenses,21049);
  }
  assert.deepEqual(state,original);
});
test('custom dates do not age pending issuer data or reconcile against future bank evidence',()=>{
  const state=fixture();state.creditSync={profiles:[{profileId:'p',provider:'max',accounts:[{accountNumber:'1234',balanceDate:'2026-09-15',pendingStatus:'success',pendingFetchedAt:'2026-09-14',txns:[{id:'pending',status:'pending',transactionDate:'2026-09-14',chargedAmount:-125,chargedCurrency:'ILS'}]}]}]};
  state.creditSync.cardMappings={'p:1234':{included:true,account:'עסקי'}};
  state.bank.feed.transactions=[debit('MAX',125,'2026-09-15')];
  const flow=calculate(state,'עסקי','2026-09-14',{targetDate:'2026-12-08'});assert.equal(flow.credit,125);assert.equal(flow.forecastIncomplete,false);
});
test('invalid or historical custom dates fail explicitly and same-day forecasts are supported',()=>{
  const state=fixture();
  for(const targetDate of ['2026-09-13','2026-02-30','garbage'])assert.throws(()=>calculate(state,'עסקי','2026-09-14',{targetDate}),RangeError);
  assert.equal(calculate(state,'עסקי','2026-09-14',{targetDate:'2026-09-14'}).targetDate,'2026-09-14');
});
test('month/year rollover and Saturday settlement keep inclusive, real calendar boundaries',()=>{
  assert.equal(calculate(fixture('2026-12-20'),'עסקי','2026-12-20').targetDate,'2027-01-15');
  const state=fixture('2027-05-01');state.bank.homeFeed.transactions=[debit('פועלים-משכנתא',1000,'2027-04-15')];
  const flow=calculate(state,'ביתי','2027-05-01');assert.equal(flow.targetDate,'2027-05-16');assert.equal(flow.expenses,1000);
});
test('fully offset credit cycles and zero expenses do not wait for a nonexistent bank debit',()=>{
  const state=fixture('2026-09-20');state.credits=[credit('same','2026-09-15',100),{...credit('refund','2026-09-15',-100),card:'same'},credit('next','2026-10-15',200)];
  state.expenses=[{id:'zero',active:true,amount:0,recurring:true,date:'2026-09-15',account:'עסקי'}];
  const flow=calculate(state,'עסקי','2026-09-20');assert.equal(flow.targetDate,'2026-10-15');assert.equal(flow.credit,200);assert.equal(flow.awaitingSettlement,false);
});
