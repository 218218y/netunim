import test from 'node:test';
import assert from 'node:assert/strict';
import {kupaBusinessPositionData,financeMoneySum} from '../shared/business-position.js';
import {kupaAccountCashflowData} from '../shared/kupa-cashflow.js';
import {computeKupaNetReadoutData} from '../netunim-orders/site/assets/js/domains/bank/readout.js';
import {bankLongTermPositionData} from '../netunim-kupa/site/assets/js/domains/bank/model.js';
import {dashboardNetPositionData} from '../netunim-kupa/site/assets/js/domains/dashboard/model.js';
import {createDomainsDashboardView} from '../netunim-orders/site/assets/js/domains/dashboard/view.js';
import {money} from '../netunim-orders/site/assets/js/core/money.js';

function fixture(){return {bank:{currentBalance:1000.01,asOfDate:'2026-09-01',source:'manual',adjustments:[{amount:0.02},{type:'check_deposit',amount:999}]},
  credits:[{id:'business',account:'עסקי',active:true,totalAmount:300.03,installments:3,firstChargeDate:'2026-09-10'},
    {id:'home',account:'ביתי',active:true,totalAmount:800,installments:1,firstChargeDate:'2026-09-10'}],
  checks:[{id:'near',status:'בקופה',amount:50.01,dueDate:'2026-09-05'},
    {id:'far',status:'בקופה',amount:75.02,dueDate:'2027-03-05'},
    {id:'deposited',status:'הופקד - במעקב',amount:500,dueDate:'2026-09-05'},
    {id:'returned',status:'חזר',amount:500,dueDate:'2026-09-05'},
    {id:'home',status:'בקופה',account:'ביתי',amount:500,dueDate:'2026-09-05'}],
  expenses:[{id:'monthly',active:true,account:'עסקי',amount:20.01,recurring:true,date:'2026-09-25'},
    {id:'next',active:true,account:'עסקי',amount:100,recurring:false,date:'2026-10-03'},
    {id:'home',active:true,account:'ביתי',amount:200,recurring:true,date:'2026-09-05'}],cash:[{amount:10.11},{amount:-0.03}]};}

test('all-future position conserves cents, isolates business and differs from Orders only by cash',t=>{
  t.mock.timers.enable({apis:['Date'],now:Date.parse('2026-09-01T10:00:00Z')});
  const state=fixture(),position=kupaBusinessPositionData(state,'2026-09-01'),orders=computeKupaNetReadoutData({checks:state.checks},state);
  assert.equal(position.bank,1000.03);assert.equal(position.credit,300.03);assert.equal(position.expenses,20.01);
  assert.equal(position.checks,125.03);assert.equal(position.cash,10.08);assert.equal(position.netWithoutCash,805.02);assert.equal(position.net,815.10);
  assert.equal(position.expenseStart,'2026-09-01');assert.equal(position.expenseEnd,'2026-09-30');
  assert.deepEqual(bankLongTermPositionData(state,'2026-09-01'),position);
  assert.equal(orders.net,805.02);assert.equal(financeMoneySum([orders.net,position.cash]),position.net);
  const forecast=kupaAccountCashflowData(state,'עסקי','2026-09-01');
  assert.equal(forecast.credit,100.01);assert.equal(forecast.checks,50.01);assert.equal(forecast.expenses,0);
  const summary={customerOpen:0.11,supplierNet:-0.03};
  assert.equal(dashboardNetPositionData(position,summary).net,815.18);
});

test('an unpaid elapsed issuer cycle stays in the position until posted bank proof, including late posting',()=>{
  const state={...fixture(),credits:[],checks:[],expenses:[],cash:[],bank:{currentBalance:1000,source:'hapoalim',asOfDate:'2026-09-14',feed:{syncedAt:'2026-09-14T08:00:00Z',transactions:[]}},
    creditSync:{profiles:[{profileId:'p',provider:'max',accounts:[{accountNumber:'2222',txns:[
      {id:'past',status:'completed',processedDate:'2026-09-10',chargedAmount:-100,chargedCurrency:'ILS'},
      {id:'future',status:'completed',processedDate:'2026-10-10',chargedAmount:-200,chargedCurrency:'ILS'},
    ]}]}],cardMappings:{'p:2222':{included:true,account:'עסקי'}}}};
  assert.equal(kupaBusinessPositionData(state,'2026-09-14').credit,300);
  assert.equal(kupaBusinessPositionData(state,'2026-09-14').net,700);
  state.bank.feed.transactions=[{date:'2026-09-13',amount:-100,description:'מקס איט פיננסים',status:'pending'}];
  assert.equal(kupaBusinessPositionData(state,'2026-09-14').credit,300,'a pending bank debit is not settlement');
  state.bank.feed.transactions[0].status='completed';
  assert.equal(kupaBusinessPositionData(state,'2026-09-14').credit,200,'late posted settlement is removed once');
  assert.equal(kupaBusinessPositionData(state,'2026-09-14').net,800);
});

test('missing bank or Orders balances never turn into a completed zero total',()=>{
  const state=fixture();state.bank.currentBalance=null;
  assert.equal(kupaBusinessPositionData(state,'2026-09-01').net,null);
  assert.equal(dashboardNetPositionData({net:100},null).net,null);
  assert.equal(dashboardNetPositionData({net:100},{customerOpen:null,supplierNet:0}).net,null);
});

test('Orders dashboard sums actual cents and displays the same components it adds',()=>{
  const view=createDomainsDashboardView({model:{state:{suppliers:[]}},ui:{summarySupplierYearView:'all'},checksSession:{kupaNetReadout:{net:0.49,targetMonth:'2026-09'}},totalStats:()=>({net:0.49}),customerStats:()=>({openTotal:0.49,open:1}),supplierArchiveYears:()=>[]});
  const html=view.summaryMarkup();
  assert.ok(html.includes(money(1.47)),'rounding each component to whole shekels would incorrectly show zero');
  assert.ok(html.includes('כל האשראי העסקי שטרם נפרע'));
  assert.ok(html.includes('מזומן בקופה אינו כלול'));
});
