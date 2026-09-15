import test from 'node:test';
import assert from 'node:assert/strict';
import {cashflowNotificationData} from '../shared/cashflow-notification.js';
import {kupaAccountCashflowData} from '../shared/kupa-cashflow.js';
import {createDomainsBankAlerts} from '../netunim-kupa/site/assets/js/domains/bank/alerts.js';
import {cashflowWarningItems} from '../netunim-orders/site/assets/js/domains/bank/alerts.js';

const flow=(date='2026-10-11')=>({account:'עסקי',balance:1000,projected:-100,creditRows:[{date,amount:1100}],expenseRows:[],checkRows:[]});

test('notification activates for the first breach inside the supplied warning window without modifying cash-flow values',()=>{
  const cashflow=flow(),before=structuredClone(cashflow);
  const alert=cashflowNotificationData(cashflow,{},'2026-09-11');
  assert.equal(alert.active,true);assert.equal(alert.daysUntilBreach,30);assert.equal(alert.breachDate,'2026-10-11');
  assert.equal(Object.hasOwn(alert,'leadDays'),false);
  assert.deepEqual(cashflow,before);
});

test('warning date comes from first daily threshold breach, not final horizon',()=>{
  const cashflow=flow();cashflow.expenseRows=[{dueDate:'2026-09-20',amount:1200}];cashflow.checkRows=[{dueDate:'2026-10-01',amount:1500}];cashflow.projected=200;
  const alert=cashflowNotificationData(cashflow,{},'2026-09-11');
  assert.equal(alert.active,true);assert.equal(alert.breachDate,'2026-09-20');assert.equal(alert.projected,-200);assert.equal(alert.projectedAtHorizon,200);
  cashflow.checkRows=[{dueDate:'2026-09-20',amount:1500}];
  assert.equal(cashflowNotificationData(cashflow,{},'2026-09-11').active,false,'same-day inflows/outflows are netted without guessing an intraday sequence');
});

test('minimum, home account, current/elapsed breach and missing balance are explicit',()=>{
  const cashflow=flow('2026-09-20');cashflow.creditRows[0].amount=600;
  assert.equal(cashflowNotificationData(cashflow,{businessMinimum:400},'2026-09-11').reason,'minimum');
  cashflow.account='ביתי';assert.equal(cashflowNotificationData(cashflow,{homeMinimum:400},'2026-09-11').active,true);
  cashflow.balance=-1;assert.equal(cashflowNotificationData(cashflow,{},'2026-09-11').active,true);
  cashflow.balance=null;assert.equal(cashflowNotificationData(cashflow,{},'2026-09-11').active,false);
  const elapsed=flow('2026-09-10');assert.equal(cashflowNotificationData(elapsed,{},'2026-09-11').breachDate,'2026-09-11');
});

test('automatic startup warning searches the full monthly window without changing the displayed projection',t=>{
  t.mock.timers.enable({apis:['Date'],now:new Date('2026-09-01T12:00:00Z')});
  const today='2026-09-01',future='2026-09-28';
  const state={bank:{currentBalance:1000,asOfDate:today,homeFeed:{balance:1000,syncedAt:today}},credits:[],expenses:[{id:'late',account:'עסקי',active:true,recurring:false,date:future,amount:1100}],checks:[]};
  let calls=0;const make=()=>createDomainsBankAlerts({model:{state},bankProjectedThisMonth:()=>1000,bankHomeProjectedThisMonth:()=>1000,modal:()=>calls++,closeModal:()=>{}});
  assert.equal(make().maybeShowStartupCashflowAlert(),true);assert.equal(calls,1);
  assert.equal(cashflowWarningItems(state)[0].breachDate,future);
  const before=kupaAccountCashflowData(state,'עסקי',today).projected;assert.equal(before,1000);
  state.cashflowSettings={businessMinimum:0};assert.equal(make().maybeShowStartupCashflowAlert(),true);assert.equal(calls,2);
  assert.equal(cashflowWarningItems(state).length,1);
  assert.equal(kupaAccountCashflowData(state,'עסקי',today).projected,before);
});
