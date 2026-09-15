import {test,mock} from 'node:test';
import assert from 'node:assert/strict';
import {kupaAccountCashflowData as calculate} from '../shared/kupa-cashflow.js';
import {kupaAccountCashflowData as kupa} from '../netunim-kupa/site/assets/js/shared/kupa-cashflow.js';
import {kupaAccountCashflowData as orders} from '../netunim-orders/site/assets/js/domains/bank/readout.js';
import {cashflowNotificationData} from '../shared/cashflow-notification.js';
import {cashflowWarningItems} from '../netunim-orders/site/assets/js/domains/bank/alerts.js';
import {createDomainsBankAlerts} from '../netunim-kupa/site/assets/js/domains/bank/alerts.js';

function fixture(reference='2026-09-01',account='עסקי'){
  return {bank:{source:'hapoalim',currentBalance:1000,asOfDate:reference,feed:{balance:1000,syncedAt:reference,transactions:[]},homeFeed:{balance:1000,syncedAt:reference,transactions:[]}},
    cashflowSettings:{businessMinimum:100,homeMinimum:100},checks:[],
    credits:[{id:'card',card:'card',active:true,account,firstChargeDate:'2026-09-15',totalAmount:100,installments:1}],
    expenses:[{id:'late',account,active:true,recurring:false,date:'2026-09-28',amount:950}]};
}
for(const [label,engine] of [['shared',calculate],['kupa',kupa],['orders',orders]])for(const account of ['עסקי','ביתי']){
  test(`${label}/${account}: full current-month warning does not alter the mid-month projection`,()=>{
    const state=fixture('2026-09-01',account),before=structuredClone(state),flow=engine(state,account,'2026-09-01');
    assert.equal(flow.targetDate,'2026-09-15');assert.equal(flow.projected,900);assert.equal(flow.expenses,0);
    assert.equal(flow.warningProjection.targetDate,'2026-09-30');assert.equal(flow.breach.breachDate,'2026-09-28');assert.equal(flow.breach.projected,-50);assert.equal(flow.breach.active,true);
    assert.equal(cashflowNotificationData(flow,state.cashflowSettings,'2026-09-01').breachDate,'2026-09-28');assert.deepEqual(state,before);
  });
}
test('earliest crossing wins before or after mid-month even if later cheques restore the balance',()=>{
  const state=fixture();state.expenses.push({id:'early',active:true,recurring:false,date:'2026-09-08',amount:950});state.checks=[{id:'recovery',status:'בקופה',dueDate:'2026-09-09',amount:2000}];
  let flow=calculate(state,'עסקי','2026-09-01');assert.equal(flow.breach.breachDate,'2026-09-08');assert.equal(flow.breach.projected,50);assert.equal(flow.projected,1950);
  state.expenses=state.expenses.filter(row=>row.id!=='early');state.checks[0].dueDate='2026-09-29';
  flow=calculate(state,'עסקי','2026-09-01');assert.equal(flow.breach.breachDate,'2026-09-28');assert.equal(flow.breach.projected,-50);
  state.checks[0].dueDate='2026-09-28';assert.equal(calculate(state,'עסקי','2026-09-01').breach.breachDate,'','same-day receipts and payments are netted');
});
test('after settlement the warning covers next mid-month but not the rest of next month until the 1st',()=>{
  const state=fixture('2026-09-16');state.bank.feed.transactions=[{date:'2026-09-15',amount:-100,description:'חיוב אשראי',status:'completed'}];
  state.expenses=[{id:'next-late',active:true,recurring:false,date:'2026-10-28',amount:1000}];
  state.credits.push({id:'oct',card:'card',active:true,firstChargeDate:'2026-10-15',totalAmount:100,installments:1});
  let flow=calculate(state,'עסקי','2026-09-16');assert.equal(flow.targetDate,'2026-10-15');assert.equal(flow.warningProjection.targetDate,'2026-10-15');assert.equal(flow.breach.breachDate,'');
  state.expenses.push({id:'boundary',active:true,recurring:false,date:'2026-10-15',amount:850});
  flow=calculate(state,'עסקי','2026-09-16');assert.equal(flow.breach.breachDate,'2026-10-15');assert.equal(flow.breach.projected,50);
  state.expenses.pop();state.bank.asOfDate='2026-10-01';state.bank.feed.syncedAt='2026-10-01';
  flow=calculate(state,'עסקי','2026-10-01');assert.equal(flow.targetDate,'2026-10-15');assert.equal(flow.warningProjection.targetDate,'2026-10-31');assert.equal(flow.breach.breachDate,'2026-10-28');assert.equal(flow.breach.active,true);
});
test('custom-date exploration remains limited to the requested date',()=>{
  const state=fixture(),flow=calculate(state,'עסקי','2026-09-01',{targetDate:'2026-09-20'});
  assert.equal(flow.targetDate,'2026-09-20');assert.equal(flow.warningProjection.targetDate,'2026-09-20');assert.equal(flow.breach.breachDate,'');
  assert.equal(calculate(state,'עסקי','2026-09-01',{targetDate:'2026-09-28'}).breach.breachDate,'2026-09-28');
});
test('window follows real month endings, including leap years and year rollover',()=>{
  for(const [reference,end] of [['2028-02-01','2028-02-29'],['2027-02-01','2027-02-28'],['2026-12-01','2026-12-31']]){
    const state=fixture(reference);state.credits=[];state.expenses[0].date=end;
    const flow=calculate(state,'עסקי',reference);assert.equal(flow.warningProjection.targetDate,end);assert.equal(flow.breach.breachDate,end);
  }
});
test('both popup coordinators use the same full warning window',()=>{
  mock.timers.enable({apis:['Date'],now:new Date('2026-09-01T12:00:00Z')});
  try{
    const state=fixture();let popup='';
    const alerts=createDomainsBankAlerts({model:{state},bankProjectedThisMonth:()=>900,bankHomeProjectedThisMonth:()=>1000,modal:(_title,body)=>popup=body,closeModal:()=>{}});
    assert.equal(alerts.maybeShowStartupCashflowAlert(),true);assert.match(popup,/28\/09\/2026/);assert.equal(alerts.maybeShowStartupCashflowAlert(),false);
    assert.equal(cashflowWarningItems(state)[0].breachDate,'2026-09-28');
  }finally{mock.timers.reset()}
});
test('unavailable and incomplete data stay explicit independently in the two windows',()=>{
  const state=fixture();state.bank.currentBalance=null;let flow=calculate(state,'עסקי','2026-09-01');assert.equal(flow.breach.active,false);
  state.bank.currentBalance=1000;state.creditSync={profiles:[{profileId:'p',provider:'max',accounts:[{accountNumber:'1234',txns:[{id:'unknown',status:'completed',processedDate:'2026-09-28',chargedAmount:null}]}]}],cardMappings:{'p:1234':{included:true,account:'עסקי'}}};
  flow=calculate(state,'עסקי','2026-09-01');assert.equal(flow.warningProjection.forecastIncomplete,true);
});
