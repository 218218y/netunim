import test from 'node:test';
import assert from 'node:assert/strict';
import {bankRecurringExpensesData,bankRecurringDebitHistoryData} from '../shared/bank-recurring-debits.js';
import {kupaAccountCashflowData} from '../shared/kupa-cashflow.js';
import {kupaAccountCashflowData as kupaFlow} from '../netunim-kupa/site/assets/js/shared/kupa-cashflow.js';
import {kupaAccountCashflowData as ordersFlow} from '../netunim-orders/site/assets/js/shared/kupa-cashflow.js';
import {normalizeBankFeed as kupaFeed} from '../netunim-kupa/site/assets/js/domains/bank/feed.js';
import {normalizeBankFeed as ordersFeed} from '../netunim-orders/site/assets/js/domains/finance/bank-feed.js';
import {cashflowBreakdownMarkup} from '../shared/cashflow-breakdown.js';
import {createDomainsExpensesView} from '../netunim-kupa/site/assets/js/domains/expenses/view.js';
import {bankLongTermPositionData} from '../netunim-kupa/site/assets/js/domains/bank/model.js';
import {createDomainsBankController} from '../netunim-kupa/site/assets/js/domains/bank/controller.js';

const tx=(description,amount,date='2026-08-16',id=`${description}:${date}`)=>({id,description,amount:-amount,date,status:'completed',currency:'ILS'});
const homeRows=()=>[tx('פועלים-משכנתא',1113.29),tx('בנק מרכנתיל די',4908.33)];
const pension=()=>tx('מגדל חברה לביט',1183.57);
function state(reference='2026-09-11'){
  return {expenses:[],cash:[],credits:[],checks:[],cashflowSettings:{homeCheckCutoffDay:20,businessCheckCutoffDay:20},bank:{source:'hapoalim',currentBalance:20000,asOfDate:reference,feed:{accountNumber:'business',balance:20000,syncedAt:reference,transactions:[pension()]},homeFeed:{accountNumber:'home',balance:20000,syncedAt:reference,transactions:homeRows()}}};
}
const automatic=(value,account='ביתי',reference='2026-09-11',horizon='2026-09-20')=>bankRecurringExpensesData(value,account,reference,horizon);

test('the three requested obligations use bank cents independently of manual entries and agree across apps',()=>{
  const value=state(),before=structuredClone(value);
  for(const calculate of [kupaAccountCashflowData,kupaFlow,ordersFlow]){
    const home=calculate(value,'ביתי','2026-09-11'),business=calculate(value,'עסקי','2026-09-11');
    assert.equal(home.expenses,6021.62);assert.equal(home.projected,13978.38);
    assert.equal(business.expenses,1183.57);assert.equal(business.projected,18816.43);
    assert.deepEqual(home.expenseRows.map(row=>row.amount),[1113.29,4908.33]);
    assert.ok(home.expenseRows.every(row=>row.source==='bank_recurring'&&row.dueDate==='2026-09-15'));
    assert.equal(home.forecastIncomplete,false);
  }
  assert.deepEqual(value,before,'projection never mutates bank or manual data');
});

test('an unposted debit survives the due date and later bank balance snapshots without a timeout',()=>{
  for(const reference of ['2026-09-14','2026-09-15','2026-09-16','2026-09-20']){
    const value=state(reference),result=kupaAccountCashflowData(value,'ביתי',reference);
    assert.equal(result.expenses,6021.62,reference);
    assert.equal(result.expenseRows.length,2);
    if(reference>'2026-09-15')assert.ok(result.expenseRows.every(row=>row.bankSettlementState==='awaiting'));
  }
  const value=state('2026-10-20'),result=automatic(value,'ביתי','2026-10-20','2026-10-20');
  assert.deepEqual(result.rows.map(row=>row.dueDate),['2026-09-15','2026-10-15','2026-09-15','2026-10-15']);
});

test('early, on-time and late posting closes only its month and updates the next estimate',()=>{
  for(const date of ['2026-09-14','2026-09-15','2026-09-16','2026-09-21']){
    const value=state(date);value.bank.homeFeed.transactions.push(tx('פועלים-משכנתא',1127.43,date),tx('בנק מרכנתיל די',4931.16,date));
    const result=automatic(value,'ביתי',date,'2026-10-20');
    assert.deepEqual(result.rows.map(row=>[row.dueDate,row.amount]),[['2026-10-15',1127.43],['2026-10-15',4931.16]],date);
    assert.ok(result.obligations.every(row=>row.lastDebit.date===date));
  }
});

test('bank balance plus remaining estimate counts each obligation once during staggered posting',()=>{
  const value=state('2026-09-15');
  value.bank.homeFeed.transactions.push(tx('פועלים-משכנתא',1120,'2026-09-15'));
  value.bank.homeFeed.balance-=1120;
  let result=kupaAccountCashflowData(value,'ביתי','2026-09-15');
  assert.equal(result.expenses,4908.33);assert.equal(result.projected,13971.67);
  value.bank.homeFeed.transactions.push(tx('בנק מרכנתיל די',4920,'2026-09-15'));
  value.bank.homeFeed.balance-=4920;
  result=kupaAccountCashflowData(value,'ביתי','2026-09-15');
  assert.equal(result.expenses,0);assert.equal(result.projected,13960);
});

test('a later month never erases a missing earlier monthly debit',()=>{
  const value=state('2026-10-16');value.bank.feed.transactions.push(tx('מגדל חברה לביט',1190.22,'2026-10-16'));
  const result=automatic(value,'עסקי','2026-10-16','2026-11-20');
  assert.deepEqual(result.rows.map(row=>[row.dueDate,row.amount]),[['2026-09-15',1183.57],['2026-11-15',1190.22]]);
});

test('Saturday moves only that monthly estimate to Sunday, without drifting the following month',()=>{
  const value=state('2027-05-01');value.bank.feed.transactions=[tx('מגדל חברה לביט',1200,'2027-04-15')];
  const result=automatic(value,'עסקי','2027-05-01','2027-06-20');
  assert.deepEqual(result.rows.map(row=>row.dueDate),['2027-05-16','2027-06-15']);
});

test('the exact cash-flow horizon still bounds estimates, and source remains visible beyond it',()=>{
  const value=state();value.cashflowSettings.homeCheckCutoffDay=14;
  const result=kupaAccountCashflowData(value,'ביתי','2026-09-11');
  assert.equal(result.expenses,0);assert.equal(result.targetDate,'2026-09-14');
  assert.equal(result.recurringObligations[0].nextDueDate,'2026-09-15');
});

test('pending, missing, foreign currency, refunds, and future rows cannot settle or reseed',()=>{
  for(const patch of [{status:'pending'},{presenceState:'missing'},{currency:'USD'},{amount:3000},{amount:0},{date:'2026-09-21'},{processedDate:'2026-09-21'},{amount:NaN}]){
    const value=state('2026-09-20');value.bank.feed.transactions.push({...tx('מגדל חברה לביט',9000,'2026-09-15'),...patch});
    assert.deepEqual(automatic(value,'עסקי','2026-09-20').rows.map(row=>row.amount),[1183.57],JSON.stringify(patch));
  }
});

test('matching is account-specific and uses the exact normalized bank label, not an equal amount or memo',()=>{
  const value=state('2026-09-16');
  value.bank.homeFeed.transactions.push(tx('מגדל חברה לביט',1183.57,'2026-09-15'));
  value.bank.feed.transactions.push(tx('מגדל חברה לביט אחרת',1183.57,'2026-09-15'),{...tx('העברה',1183.57,'2026-09-15'),memo:'מגדל חברה לביט'});
  assert.equal(automatic(value,'עסקי','2026-09-16').rows[0].amount,1183.57);
  value.bank.homeFeed.transactions.push(tx('\u200fפועלים־משכנתא  ',1122,'2026-09-15'));
  assert.equal(automatic(value,'ביתי','2026-09-16').rows.length,1);
});

test('ambiguous posted debits retain the previous estimate and flag the forecast, independent of order',()=>{
  const value=state('2026-09-16');value.bank.feed.transactions.push(tx('מגדל חברה לביט',1200,'2026-09-15','one'),tx('מגדל חברה לביט',1300,'2026-09-15','two'));
  for(let pass=0;pass<2;pass++){
    const result=kupaAccountCashflowData(value,'עסקי','2026-09-16');
    assert.equal(result.expenses,1183.57);assert.equal(result.forecastIncomplete,true);
    assert.equal(result.recurringExpenseWarnings[0].kind,'ambiguous');
    value.bank.feed.transactions.reverse();
  }
});

test('ordinary expenses remain independent, with no name-based suppression',()=>{
  const value=state();value.expenses.push({id:'manual',description:'פנסיה',account:'עסקי',date:'2026-09-15',recurring:true,active:true,amount:10});
  assert.equal(kupaAccountCashflowData(value,'עסקי','2026-09-11').expenses,1193.57);
  assert.equal(bankLongTermPositionData(value,'2026-09-11').expenses,1193.57);
});

test('an invalidated source is explicit, and a manual bank balance cannot establish settlement',()=>{
  const value=state();value.bank.feed.transactions=[{...pension(),presenceState:'missing'}];
  const result=kupaAccountCashflowData(value,'עסקי','2026-09-11');
  assert.equal(result.expenses,0);assert.equal(result.forecastIncomplete,true);
  assert.equal(result.recurringExpenseWarnings[0].kind,'no_bank_source');
  value.bank.source='manual';value.bank.feed.transactions=[pension()];
  assert.equal(kupaAccountCashflowData(value,'עסקי','2026-09-11').expenses,0);
});

test('snapshot date bounds settlement evidence even when the reference is newer',()=>{
  const value=state('2026-09-11');value.bank.feed.transactions.push(tx('מגדל חברה לביט',1300,'2026-09-15'));
  assert.equal(kupaAccountCashflowData(value,'עסקי','2026-09-20').expenses,1183.57);
});

test('a narrow snapshot retains the source, survives normalization, and preserves old missing months',()=>{
  const previous=state().bank.feed;
  const next={...previous,syncedAt:'2027-10-20',transactions:[tx('מגדל חברה לביט',1400,'2027-10-15')]};
  next.recurringDebitHistory=bankRecurringDebitHistoryData(previous,next,'עסקי',{complete:true,from:'2027-09-20',to:'2027-10-20'});
  for(const normalize of [kupaFeed,ordersFeed]){
    const value=state('2027-10-20');value.bank.feed=normalize(next);
    const result=automatic(value,'עסקי','2027-10-20','2027-11-20');
    assert.equal(result.rows[0].dueDate,'2026-09-15');
    assert.equal(result.rows.at(-1).amount,1400);
    assert.equal(result.rows.at(-1).dueDate,'2027-11-15');
    assert.equal(result.rows.filter(row=>row.dueDate==='2027-10-15').length,0);
  }
});

test('history resets on account change and invalidates absence only under complete coverage',()=>{
  const previous=state().bank.feed,next={...previous,transactions:[],syncedAt:'2026-09-20'};
  assert.equal(bankRecurringDebitHistoryData(previous,{...next,accountNumber:'other'},'עסקי').length,0);
  assert.equal(bankRecurringDebitHistoryData(previous,next,'עסקי',{complete:false,from:'2026-08-01',to:'2026-09-20'})[0].presenceState,undefined);
  const history=bankRecurringDebitHistoryData(previous,next,'עסקי',{complete:true,from:'2026-08-01',to:'2026-09-20'});
  assert.equal(history[0].presenceState,'missing');
  assert.equal(bankRecurringDebitHistoryData({...previous,recurringDebitHistory:history},{...next,transactions:[pension()]},'עסקי')[0].presenceState,undefined,'reappearance restores live evidence');
});

test('fresh corrections and duplicates do not leave phantom historical bank debits',()=>{
  const previous=state().bank.feed,next={...previous,transactions:[{...pension(),amount:-1200}]};
  next.recurringDebitHistory=bankRecurringDebitHistoryData(previous,next,'עסקי');
  assert.equal(next.recurringDebitHistory.length,1);assert.equal(next.recurringDebitHistory[0].amount,-1200);
  const value=state();value.bank.feed=next;
  assert.equal(automatic(value,'עסקי').rows[0].amount,1200);
  next.transactions=[{...pension(),description:'פעולה אחרת'}];
  delete next.recurringDebitHistory;
  assert.equal(bankRecurringDebitHistoryData(previous,next,'עסקי').length,0);
});

test('the breakdown and expense view show provenance and overdue status without editing synthetic entries',()=>{
  const value=state('2026-09-16'),business=kupaAccountCashflowData(value,'עסקי','2026-09-16'),home=kupaAccountCashflowData(value,'ביתי','2026-09-16');
  const markup=cashflowBreakdownMarkup(home);
  assert.ok(markup.includes('16/08/2026'));assert.ok(markup.includes('ממתין לרישום בבנק'));
  const view=createDomainsExpensesView({model:{state:value},ui:{},bankNextCycleCommitments:()=>business,bankHomeNextCycleCommitments:()=>home});
  const html=view.expensesMarkup();
  assert.ok(html.includes('bank-recurring:'));
  assert.ok(!/data-click-arg0="bank-recurring:/.test(html));
});

test('Kupa refresh persists recognized bank sources across a rolling snapshot and reload',async()=>{
  const model={state:state()},saved=[];
  const controller=createDomainsBankController({model,session:{connectionMode:'local'},checksSession:{},sharedChecksHaveLocalWork:()=>false,
    saveState:async()=>{saved.push(structuredClone(model.state));return true},syncSharedChecksFromCloud:async()=>true,sharedChecksObservedSequence:()=>0,toast:()=>{},render:()=>{},
    bridge:{getBridgeToken:()=> 'paired',autoEnabled:()=>false,fetchBalance:async()=>({fetchedAt:'2026-09-20',accounts:{
      business:{accountId:'business',balance:20000,transactions:[],transactionCoverage:{complete:true,from:'2026-08-21',to:'2026-09-20'}},
      home:{accountId:'home',balance:20000,transactions:[],transactionCoverage:{complete:true,from:'2026-08-21',to:'2026-09-20'}},
    }})},
  });
  assert.equal(await controller.refreshBankBalance(),true);
  const restored=JSON.parse(JSON.stringify(saved[0]));
  assert.equal(restored.bank.feed.recurringDebitHistory.length,1);
  assert.equal(restored.bank.homeFeed.recurringDebitHistory.length,2);
  assert.equal(kupaAccountCashflowData(restored,'ביתי','2026-09-20').expenses,6021.62);
  assert.equal(kupaAccountCashflowData(restored,'עסקי','2026-09-20').expenses,1183.57);
});
