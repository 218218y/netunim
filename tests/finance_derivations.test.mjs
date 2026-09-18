import test from 'node:test';
import assert from 'node:assert/strict';
import {withFinanceDerivations,financeDerivation} from '../shared/finance-derivations.js';
import {kupaAccountCashflowData,kupaReconciledCreditRowsData,kupaReconciledCreditDetailMonthsData,kupaReconciledCreditUpcomingDetailData} from '../shared/kupa-cashflow.js';
import {configurePerformance,clearPerformance,performanceSummary} from '../shared/runtime-performance.js';
import {createDomainsFinanceController} from '../netunim-orders/site/assets/js/domains/finance/controller.js';

const date='2026-09-18';
function fixture(){return {
  credits:Array.from({length:100},(_,i)=>({id:`C${i}`,active:true,card:`Card ${i%4}`,account:i%2?'ביתי':'עסקי',description:`Transaction ${i}`,firstChargeDate:'2026-08-15',totalAmount:120+i,installments:12})),
  bank:{currentBalance:50000,asOfDate:date,feed:{syncedAt:date,transactions:[{date:'2026-09-15',amount:-250,description:'VISA'}]},homeFeed:{balance:20000,syncedAt:date,transactions:[]},adjustments:[]},
  checks:[{id:'check',status:'בקופה',account:'עסקי',amount:300,dueDate:'2026-09-20'}],
  expenses:[{id:'rent',active:true,recurring:true,account:'עסקי',date:'2026-09-21',amount:400}],creditSync:{profiles:[],cardMappings:{}}
}}
const select=state=>({business:kupaAccountCashflowData(state,'עסקי',date),home:kupaAccountCashflowData(state,'ביתי',date),rows:kupaReconciledCreditRowsData(state,'all',date),detail:kupaReconciledCreditDetailMonthsData(state,date,3),upcoming:kupaReconciledCreditUpcomingDetailData(state,date,3)});

test('render-scoped finance matches uncached results, reuses reconciliations and never retains stale state',()=>{
  const state=fixture(),before=structuredClone(state),expected=select(state);
  configurePerformance(true);clearPerformance();
  try{
    withFinanceDerivations(()=>{
      assert.deepEqual(select(state),expected);
      const counts=performanceSummary();
      assert.equal(counts['finance:compute:reconciliation'].count,6,'two accounts with three distinct settlement/visibility policies');
      assert.equal(counts['finance:compute:credit-detail'].count,1,'upcoming reuses the month detail');
      assert.deepEqual(select(state),expected);
      assert.equal(performanceSummary()['finance:compute:reconciliation'].count,6);
      assert.equal(performanceSummary()['finance:compute:cashflow'].count,2);
    });
    assert.deepEqual(state,before);
    state.checks[0].amount=900;state.bank.currentBalance=45000;
    assert.deepEqual(withFinanceDerivations(()=>select(state)),select(state));
    assert.notEqual(select(state).business.projected,expected.business.projected);
  }finally{configurePerformance(false);clearPerformance()}
});

test('cached finance results are detached even when consumers mutate arrays, maps or nested rows',()=>{
  const state=fixture(),expected=select(state);
  withFinanceDerivations(()=>{
    const first=select(state);first.rows[0].amount=999999;first.detail.months.length=0;first.business.checkRows.push({amount:0});first.upcoming.nextByCard.clear();
    assert.deepEqual(select(state),expected);
    const second=select(state);second.business.creditRows.reverse();second.detail.months[0].items.length=0;
    assert.deepEqual(select(state),expected);
  });
});

test('finance keys separate reference dates, history, account, target date and input documents',()=>{
  const state=fixture(),other=fixture();other.bank.currentBalance=1;
  const queries=[()=>kupaReconciledCreditDetailMonthsData(state,date,1),()=>kupaReconciledCreditDetailMonthsData(state,date,6),()=>kupaAccountCashflowData(state,'עסקי',date,{targetDate:'2026-12-31'}),()=>kupaAccountCashflowData(state,'עסקי','2026-10-01'),()=>kupaAccountCashflowData(other,'עסקי',date)];
  const expected=queries.map(q=>q());
  withFinanceDerivations(()=>{for(let i=0;i<2;i++)assert.deepEqual(queries.map(q=>q()),expected)});
});

test('nested scopes share work, exceptions discard it, and work outside a scope is never cached',()=>{
  const source={};let calls=0;
  const query=()=>financeDerivation(source,'test','key',()=>({value:++calls,items:new Set([1])}));
  assert.throws(()=>withFinanceDerivations(()=>{assert.equal(query().value,1);withFinanceDerivations(()=>assert.equal(query().value,1));throw Error('render failed')}),/render failed/);
  assert.equal(withFinanceDerivations(query).value,2);assert.equal(query().value,3);assert.equal(query().value,4);
});

test('Orders finance snapshot stays isolated from the authoritative source after removing redundant copies',()=>{
  const state=fixture();state.cards=[{id:'card',label:'original'}];state.bank.adjustments=[{id:'adjustment',amount:5}];
  const before=structuredClone(state),checks=[{id:'check',amount:10}];
  const controller=createDomainsFinanceController({checksSession:{kupaCloudReadState:state},getSharedChecks:()=>checks,bridge:{bankAutoEnabled:()=>false,creditAutoEnabled:()=>false,creditAutoMode:()=> 'daily',getBridgeToken:()=>''}});
  const snapshot=controller.snapshot();snapshot.cards[0].label='changed';snapshot.credits[0].totalAmount=0;snapshot.bank.adjustments[0].amount=0;snapshot.kupa.checks[0].amount=0;
  assert.deepEqual(state,before);assert.equal(checks[0].amount,10);
  assert.equal(controller.snapshot().cards[0].label,'original');assert.equal(controller.snapshot().bank.adjustments[0].amount,5);
});
