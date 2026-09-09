import test from 'node:test';
import assert from 'node:assert/strict';
import {customerDebtProgressData,customerDebtActiveProgressEntries} from '../netunim-orders/site/assets/js/shared/customer-debt-progress.js';
import {customerDebtStatus,customerDebtFilteredTotal,customerStatsData} from '../netunim-orders/site/assets/js/domains/customers/model.js';
import {createDomainsCustomersEditor} from '../netunim-orders/site/assets/js/domains/customers/editor.js';
import {createDomainsCustomersView} from '../netunim-orders/site/assets/js/domains/customers/view.js';
import {createStateNormalization} from '../netunim-orders/site/assets/js/state/normalization.js';
import {createSyncMerge} from '../netunim-orders/site/assets/js/sync/merge.js';
import {ordersFinanceSummaryData} from '../shared/orders-finance.js';

const add=(id,kind,amount,createdAt='2026-09-09T08:00:00.000Z')=>({id,kind,action:'add',amount,source:'manual',createdAt});
const reset=(id,kind,clears,createdAt='2026-09-09T09:00:00.000Z')=>({id,kind,action:'reset',clears,source:'manual',createdAt});

function baseOrderState(customerDebts=[]){return {version:4,businessName:'test',suppliers:[],transactions:[],customerDebts,customerOrders:[],serviceCalls:[],inventoryItems:[],inventoryCategoryOrder:[],inventoryEvents:[],warehouseOrders:[],checks:[],notes:[],importAudit:{},stage2Audit:{}}}

test('customer debt progress derives payment and invoice balances independently in cents',()=>{
 const debt={amount:1000,debtProgress:[add('P1','payment',300),add('P2','payment',200),add('I1','invoice',400)]};
 assert.deepEqual(customerDebtProgressData(debt),{
  amount:1000,targetMagnitude:1000,paymentRecorded:500,paymentApplied:500,remainingPaymentMagnitude:500,remainingPayment:500,paymentComplete:false,paymentPartial:true,
  invoiceRecorded:400,invoiceApplied:400,remainingInvoiceMagnitude:600,remainingInvoice:600,invoiceComplete:false,invoicePartial:true,
 });
 assert.deepEqual(customerDebtActiveProgressEntries(debt,'payment').map(row=>row.id),['P1','P2']);
 assert.equal(customerDebtStatus(debt).cls,'orange');
});

test('reset events are idempotent and only cancel the additions they explicitly saw',()=>{
 const debt={amount:1000,debtProgress:[add('P1','payment',300),reset('R1','payment',['P1']),reset('R2','payment',['P1']),add('P2','payment',125,'2026-09-09T10:00:00.000Z')]};
 const p=customerDebtProgressData(debt);
 assert.equal(p.paymentRecorded,125);assert.equal(p.paymentApplied,125);assert.equal(p.remainingPayment,875);
 assert.deepEqual(customerDebtActiveProgressEntries(debt,'payment').map(row=>row.id),['P2']);
});

test('negative reverse debts preserve the sign of only the unpaid remainder',()=>{
 const p=customerDebtProgressData({amount:-250,debtProgress:[add('P1','payment',100)]});
 assert.equal(p.paymentApplied,100);assert.equal(p.remainingPaymentMagnitude,150);assert.equal(p.remainingPayment,-150);assert.equal(p.paymentPartial,true);
});

test('customer summaries and open totals use remaining payment instead of original amount',()=>{
 const rows=[
  {id:'D1',amount:1000,supplied:true,debtProgress:[add('P1','payment',400)]},
  {id:'D2',amount:-200,supplied:false,debtProgress:[add('P2','payment',50)]},
  {id:'D3',amount:300,paid:true,invoiceIssued:false},
  {id:'D4',amount:100,paid:true,invoiceIssued:true},
 ];
 const stats=customerStatsData({customerDebts:rows,customerOrders:[]});
 assert.equal(stats.openTotal,450);assert.equal(stats.openSuppliedTotal,600);assert.equal(stats.openUnsuppliedTotal,-150);assert.equal(stats.open,2);
 assert.equal(stats.missingInvoice,1);assert.equal(stats.closed,1);
 assert.equal(ordersFinanceSummaryData({customerDebts:rows,suppliers:[],transactions:[]}).customerOpen,450,'the canonical cross-app dashboard summary must use the same remaining balance');
 assert.equal(customerDebtFilteredTotal(rows,'all'),450);assert.equal(customerDebtFilteredTotal(rows.filter(d=>!customerDebtProgressData(d).paymentComplete),'open'),450);
});

test('manual editor appends repeated partial additions, rejects overflow and resets without deleting history',()=>{
 const model={state:{customerDebts:[]}},messages=[];let saves=0;
 const editor=createDomainsCustomersEditor({model,customerUi:{},modal:()=>{},toast:msg=>messages.push(msg),scheduleSave:()=>{saves++},closeModal:()=>{},renderCustomers:()=>{},confirmDialog:async()=>true});
 const fields={
  '#dName':{value:'לקוח'},'#dAmount':{value:'1000'},'#dOrder':{value:'1'},'#dPhone':{value:''},'#dEmail':{value:''},'#dTaxId':{value:''},'#dPaid':{value:'partial'},'#dSupplied':{value:'false'},'#dInvoice':{value:'partial'},'#dAddPayment':{value:'300'},'#dAddInvoice':{value:'400'},'#dNote':{value:''},
 };
 const previous=globalThis.document;globalThis.document={querySelector:selector=>fields[selector]||null};
 try{
  editor.saveDebt();const debt=model.state.customerDebts[0];let p=customerDebtProgressData(debt);
  assert.equal(p.paymentApplied,300);assert.equal(p.invoiceApplied,400);assert.equal(debt.debtProgress.length,2);
  fields['#dAddPayment'].value='200';fields['#dAddInvoice'].value='100';editor.saveDebt(debt.id);p=customerDebtProgressData(debt);
  assert.equal(p.paymentApplied,500);assert.equal(p.invoiceApplied,500);assert.equal(debt.debtProgress.length,4);
  const before=structuredClone(debt);fields['#dAddPayment'].value='600';fields['#dAddInvoice'].value='';editor.saveDebt(debt.id);
  assert.deepEqual(debt,before);assert.match(messages.at(-1),/גבוה מהיתרה שנותרה/);
  fields['#dPaid'].value='false';fields['#dAddPayment'].value='';editor.saveDebt(debt.id);p=customerDebtProgressData(debt);
  assert.equal(p.paymentApplied,0);assert.equal(p.invoiceApplied,500);assert.equal(debt.debtProgress.filter(row=>row.action==='reset').length,1);assert.equal(debt.debtProgress.length,5);
  assert.equal(saves,3);
 }finally{if(previous===undefined)delete globalThis.document;else globalThis.document=previous}
});

test('partial customer row stays compact and exposes details instead of adding another permanent status column',()=>{
 const debt={id:'D1',customerName:'לקוח',amount:1000,supplied:true,paid:false,invoiceIssued:false,note:'',debtProgress:[add('P1','payment',250)]};
 const view=createDomainsCustomersView({model:{state:{customerDebts:[debt],customerOrders:[]}},customerUi:{customerBulkMode:false,customerBulkSelected:new Set()},bindScrollViewport:()=>{},mountViewLayout:()=>{},customerStats:()=>({}),customerBulkHeader:()=>'',customerBulkControls:()=>'',syncCustomerBulkUi:()=>{},customerBottomSummary:()=>'',customerBulkCell:()=>'',scheduleSave:()=>{}});
 const html=view.debtRow(debt);
 assert.match(html,/debt-partial-chip/);assert.match(html,/data-action="open-debt-progress-details"/);assert.match(html,/שולם/);assert.match(html,/נותר/);assert.match(html,/badge orange/);
});

test('Orders merge unions concurrent debt progress events and makes concurrent resets safe',()=>{
 const normalization=createStateNormalization({}),merge=createSyncMerge({normalizeState:normalization.normalizeState});
 const base=normalization.normalizeState(baseOrderState([{id:'D',customerName:'לקוח',amount:1000,paid:false,invoiceIssued:false,debtProgress:[add('P1','payment',300)]}]));
 const local=structuredClone(base),remote=structuredClone(base);
 local.customerDebts[0].debtProgress.push(reset('R1','payment',['P1']));
 remote.customerDebts[0].debtProgress.push(add('P2','payment',125));
 let result=merge.merge3(base,local,remote);assert.deepEqual(result.conflicts,[]);
 let p=customerDebtProgressData(result.state.customerDebts[0]);assert.equal(p.paymentApplied,125);assert.equal(result.state.customerDebts[0].debtProgress.length,3);
 const localReset=structuredClone(base),remoteReset=structuredClone(base);localReset.customerDebts[0].debtProgress.push(reset('R2','payment',['P1']));remoteReset.customerDebts[0].debtProgress.push(reset('R3','payment',['P1']));
 result=merge.merge3(base,localReset,remoteReset);assert.deepEqual(result.conflicts,[]);assert.equal(customerDebtProgressData(result.state.customerDebts[0]).paymentApplied,0);
});

test('Orders validation rejects malformed or mutable debt-progress history',()=>{
 const normalization=createStateNormalization({});
 assert.throws(()=>normalization.normalizeState(baseOrderState([{id:'D',debtProgress:[{id:'P',kind:'payment',action:'add',amount:-10}]}])),/invalid amount/);
 assert.throws(()=>normalization.normalizeState(baseOrderState([{id:'D',debtProgress:[{id:'R',kind:'payment',action:'reset',clears:[]}]}])),/invalid reset targets/);
 const base=normalization.normalizeState(baseOrderState([{id:'D',amount:100,debtProgress:[add('P','payment',20)]}])),local=structuredClone(base),remote=structuredClone(base),merge=createSyncMerge({normalizeState:normalization.normalizeState});
 local.customerDebts[0].debtProgress[0].amount=25;
 const result=merge.merge3(base,local,remote);assert.ok(result.conflicts.includes('customerDebt:D'),'existing ledger entries are immutable; edits must conflict rather than rewrite history');
});
