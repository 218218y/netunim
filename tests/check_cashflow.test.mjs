import assert from 'node:assert/strict';
import {test,mock} from 'node:test';
import {kupaAccountCashflowData} from '../shared/kupa-cashflow.js';
import {kupaAccountCashflowData as ordersCashflow} from '../netunim-orders/site/assets/js/domains/bank/readout.js';
import {bankBalanceFactsMarkup} from '../netunim-orders/site/assets/js/domains/finance/bank-cashflow-view.js';

const date='2026-08-02';
const make=()=>({bank:{currentBalance:1700,asOfDate:date,feed:{balance:1700,accountNumber:'B',syncedAt:date,transactions:[{id:'deposit',date,amount:700,description:'הפק.שיק בסלולר',status:'completed'}]},homeFeed:{balance:900,accountNumber:'H',syncedAt:date,transactions:[]}},checks:[{id:'a',name:'Alice',amount:100,dueDate:date,account:'עסקי',status:'בקופה'},{id:'b',name:'Bob',amount:200,dueDate:date,account:'עסקי',status:'בקופה'},{id:'c',name:'Carol',amount:400,dueDate:date,account:'עסקי',status:'בקופה'},{id:'home',amount:50,dueDate:date,account:'ביתי',status:'בקופה'}],credits:[],expenses:[],cards:[],cashflowSettings:{businessCheckCutoffDay:14,homeCheckCutoffDay:9}});

for(const [label,calculate] of [['shared/Kupa',kupaAccountCashflowData],['Orders',ordersCashflow]])test(`${label}: manual and automatic deposits never credit projected balance twice`,()=>{
  const state=make();assert.equal(calculate(state,'עסקי',date).projected,2400);
  for(const mode of ['manual','automatic']){
    for(const c of state.checks.slice(0,3)){c.status='הופקד - במעקב';if(mode==='automatic')c.bankMatch={phase:'deposited',transactionId:1};}
    assert.equal(calculate(state,'עסקי',date).checks,0);
    assert.equal(calculate(state,'עסקי',date).projected,1700);
    assert.equal(calculate(state,'ביתי',date).projected,950,'account roles remain separate');
    for(const c of state.checks.slice(0,3))c.status='נפרע';
    assert.equal(calculate(state,'עסקי',date).projected,1700);
  }
  state.bank.currentBalance=1600;state.bank.feed.balance=1600;
  state.checks[0].status='הופקד - במעקב';state.checks[0].bankMatch={phase:'missing',warning:'batch_missing'};
  assert.equal(calculate(state,'עסקי',date).projected,1600,'lost cheque is not forecast as another automatic deposit');
  state.checks[0].status='חזר';assert.equal(calculate(state,'עסקי',date).projected,1600);
  state.checks[0].status='בקופה';state.checks[0].bankAutomationDisabled=true;
  assert.equal(calculate(state,'עסקי',date).projected,1700,'explicit manual reintroduction adds exactly one expected deposit');
});

test('Orders bank transaction header displays the actual account-specific forecast horizon',()=>{
  mock.timers.enable({apis:['Date'],now:new Date('2026-08-02T12:00:00Z')});
  try{
    const state=make(),format=day=>day.split('-').reverse().join('.');
    for(const [role,account,feed] of [['business','עסקי',state.bank.feed],['home','ביתי',state.bank.homeFeed]]){
      const expected=kupaAccountCashflowData(state,account,date).targetDate;
      const orders=bankBalanceFactsMarkup(feed,role,state);
      assert.match(orders,/עו״ש תזרימי \(/);assert.ok(orders.includes(format(expected)),orders);
    }
  }finally{mock.timers.reset()}
});
