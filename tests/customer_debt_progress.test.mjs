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


test('debt editor only exposes amount-entry fields in partial mode and money spinners use whole-shekel steps',()=>{
 const listeners={},paymentSelect={value:'false',addEventListener:(type,fn)=>{listeners.payment=fn}},invoiceSelect={value:'true',addEventListener:(type,fn)=>{listeners.invoice=fn}},paymentField={hidden:false},invoiceField={hidden:false},paymentInput={value:'',disabled:false},invoiceInput={value:'',disabled:false};
 const fields={'#dPaid':paymentSelect,'#dInvoice':invoiceSelect,'#dAddPaymentField':paymentField,'#dAddInvoiceField':invoiceField,'#dAddPayment':paymentInput,'#dAddInvoice':invoiceInput};
 let body='';const previous=globalThis.document;globalThis.document={querySelector:selector=>fields[selector]||null};
 try{
  const editor=createDomainsCustomersEditor({model:{state:{customerDebts:[]}},customerUi:{},modal:(_title,html)=>{body=html},toast:()=>{},scheduleSave:()=>{},closeModal:()=>{},renderCustomers:()=>{},confirmDialog:async()=>true});
  editor.openDebtModal();
  assert.match(body,/id="dAddPayment"[^>]*step="1"/);assert.match(body,/id="dAddInvoice"[^>]*step="1"/);assert.doesNotMatch(body,/step="0\.01"/);
  assert.equal(paymentField.hidden,true);assert.equal(paymentInput.disabled,true);assert.equal(invoiceField.hidden,true);assert.equal(invoiceInput.disabled,true);
  paymentSelect.value='partial';listeners.payment();assert.equal(paymentField.hidden,false);assert.equal(paymentInput.disabled,false);
  paymentInput.value='12.34';paymentSelect.value='false';listeners.payment();assert.equal(paymentField.hidden,true);assert.equal(paymentInput.disabled,true);assert.equal(paymentInput.value,'');
 }finally{if(previous===undefined)delete globalThis.document;else globalThis.document=previous}
});

test('partial additions that reach the full debt stamp completion times and later reset clears them safely',()=>{
 const model={state:{customerDebts:[]}};let saves=0;
 const editor=createDomainsCustomersEditor({model,customerUi:{},modal:()=>{},toast:()=>{},scheduleSave:()=>{saves++},closeModal:()=>{},renderCustomers:()=>{},confirmDialog:async()=>true});
 const fields={'#dName':{value:'לקוח'},'#dAmount':{value:'1000'},'#dOrder':{value:''},'#dPhone':{value:''},'#dEmail':{value:''},'#dTaxId':{value:''},'#dPaid':{value:'partial'},'#dSupplied':{value:'false'},'#dInvoice':{value:'partial'},'#dAddPayment':{value:'1000'},'#dAddInvoice':{value:'1000'},'#dNote':{value:''}};
 const previous=globalThis.document;globalThis.document={querySelector:selector=>fields[selector]||null};
 try{
  editor.saveDebt();const debt=model.state.customerDebts[0],firstUpdated=debt.updatedAt;
  assert.equal(customerDebtProgressData(debt).paymentComplete,true);assert.equal(customerDebtProgressData(debt).invoiceComplete,true);assert.ok(debt.paidAt);assert.ok(debt.invoiceIssuedAt);assert.ok(debt.closedAt);assert.ok(firstUpdated);
  fields['#dPaid'].value='false';fields['#dInvoice'].value='false';fields['#dAddPayment'].value='';fields['#dAddInvoice'].value='';editor.saveDebt(debt.id);
  const p=customerDebtProgressData(debt);assert.equal(p.paymentComplete,false);assert.equal(p.invoiceComplete,false);assert.equal(debt.paidAt,null);assert.equal(debt.invoiceIssuedAt,null);assert.equal(debt.closedAt,null);
  assert.equal(debt.debtProgress.filter(row=>row.action==='reset').length,2);assert.ok(debt.debtProgress.every(row=>row.action==='add'||row.action==='reset'));assert.ok(debt.debtProgress.filter(row=>row.action==='add').every(row=>row.amount>0));assert.equal(saves,2);
 }finally{if(previous===undefined)delete globalThis.document;else globalThis.document=previous}
});

test('direct table reset of a progressed debt writes a reset event, never a negative adjustment',()=>{
 const debt={id:'D1',customerName:'לקוח',amount:1000,paid:false,invoiceIssued:false,supplied:false,note:'',debtProgress:[add('P1','payment',300)]},model={state:{customerDebts:[debt],customerOrders:[]}};let saves=0;
 const main={innerHTML:'',querySelector:()=>null},previous=globalThis.document;globalThis.document={querySelector:selector=>selector==='#main'?main:null};
 try{
  const view=createDomainsCustomersView({model,customerUi:{customerTab:'debts',customerFilter:'all',customerSearch:'',customerBulkMode:false,customerBulkSelected:new Set()},bindScrollViewport:()=>{},mountViewLayout:()=>{},customerStats:()=>({}),customerBulkHeader:()=>'',customerBulkControls:()=>'',syncCustomerBulkUi:()=>{},customerBottomSummary:()=>'',customerBulkCell:()=>'',scheduleSave:()=>{saves++}});
  view.setCustomerFlag('D1','paid',false);
  assert.equal(customerDebtProgressData(debt).paymentApplied,0);assert.equal(debt.debtProgress.length,2);assert.equal(debt.debtProgress[1].action,'reset');assert.deepEqual(debt.debtProgress[1].clears,['P1']);assert.equal('amount' in debt.debtProgress[1],false);assert.equal(saves,1);
 }finally{if(previous===undefined)delete globalThis.document;else globalThis.document=previous}
});

test('partial customer row makes the unpaid balance primary and exposes clearly-labeled details actions',()=>{
 const debt={id:'D1',customerName:'לקוח',amount:1000,supplied:true,paid:false,invoiceIssued:false,note:'',debtProgress:[add('P1','payment',250)]};
 const view=createDomainsCustomersView({model:{state:{customerDebts:[debt],customerOrders:[]}},customerUi:{customerBulkMode:false,customerBulkSelected:new Set()},bindScrollViewport:()=>{},mountViewLayout:()=>{},customerStats:()=>({}),customerBulkHeader:()=>'',customerBulkControls:()=>'',syncCustomerBulkUi:()=>{},customerBottomSummary:()=>'',customerBulkCell:()=>'',scheduleSave:()=>{}});
 const html=view.debtRow(debt);
 assert.match(html,/customer-debt-amount is-payment-partial/);assert.match(html,/750/);assert.doesNotMatch(html,/customer-debt-amount is-supplied/);
 assert.match(html,/מתוך/);assert.match(html,/1,000/);assert.doesNotMatch(html,/שולם 250 מתוך/);assert.match(html,/debt-partial-chip/);assert.match(html,/data-action="open-debt-progress-details"/);assert.match(html,/debt-details-icon/);assert.match(html,/badge orange/);assert.match(html,/הצג פירוט חוב/);
});

test('debt progress details promote the remaining amount and keep the original debt as secondary context',()=>{
 const debt={id:'D1',customerName:'לקוח',amount:1000,supplied:true,paid:false,invoiceIssued:false,note:'',debtProgress:[add('P1','payment',250)]},model={state:{customerDebts:[debt]}};
 let title='',body='';const editor=createDomainsCustomersEditor({model,customerUi:{},modal:(nextTitle,nextBody)=>{title=nextTitle;body=nextBody},toast:()=>{},scheduleSave:()=>{},closeModal:()=>{},renderCustomers:()=>{},confirmDialog:async()=>true});
 editor.openDebtProgressDetails('D1');
 assert.match(title,/פירוט חוב/);assert.match(body,/debt-progress-total-remaining/);assert.match(body,/נותר לתשלום/);assert.match(body,/750/);assert.match(body,/חוב מקורי/);assert.match(body,/1,000/);assert.match(body,/שולם/);assert.match(body,/250/);
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


test('Orders merge treats progress timestamps as metadata and safely combines realistic concurrent editor updates',()=>{
 const normalization=createStateNormalization({}),merge=createSyncMerge({normalizeState:normalization.normalizeState});
 const base=normalization.normalizeState(baseOrderState([{id:'D',customerName:'לקוח',amount:1000,paid:false,invoiceIssued:false,updatedAt:'2026-09-09T08:00:00.000Z'}]));
 const local=structuredClone(base),remote=structuredClone(base);
 local.customerDebts[0].debtProgress=[add('P1','payment',600,'2026-09-09T09:00:00.000Z')];local.customerDebts[0].updatedAt='2026-09-09T09:00:00.000Z';
 remote.customerDebts[0].debtProgress=[add('P2','payment',500,'2026-09-09T10:00:00.000Z')];remote.customerDebts[0].updatedAt='2026-09-09T10:00:00.000Z';
 const result=merge.merge3(base,local,remote),debt=result.state.customerDebts[0],p=customerDebtProgressData(debt);
 assert.deepEqual(result.conflicts,[]);assert.equal(p.paymentRecorded,1100);assert.equal(p.paymentApplied,1000);assert.equal(p.paymentComplete,true);assert.equal(debt.updatedAt,'2026-09-09T10:00:00.000Z');assert.equal(debt.paidAt,'2026-09-09T10:00:00.000Z');
});

test('Orders merge combines a concurrent reset and new addition even when both sides update row metadata',()=>{
 const normalization=createStateNormalization({}),merge=createSyncMerge({normalizeState:normalization.normalizeState});
 const base=normalization.normalizeState(baseOrderState([{id:'D',customerName:'לקוח',amount:1000,paid:false,invoiceIssued:false,updatedAt:'2026-09-09T08:00:00.000Z',debtProgress:[add('P1','payment',300,'2026-09-09T08:00:00.000Z')]}]));
 const local=structuredClone(base),remote=structuredClone(base);
 local.customerDebts[0].debtProgress.push(reset('R1','payment',['P1'],'2026-09-09T09:00:00.000Z'));local.customerDebts[0].updatedAt='2026-09-09T09:00:00.000Z';
 remote.customerDebts[0].debtProgress.push(add('P2','payment',125,'2026-09-09T10:00:00.000Z'));remote.customerDebts[0].updatedAt='2026-09-09T10:00:00.000Z';
 const result=merge.merge3(base,local,remote),debt=result.state.customerDebts[0];
 assert.deepEqual(result.conflicts,[]);assert.equal(customerDebtProgressData(debt).paymentApplied,125);assert.deepEqual(customerDebtActiveProgressEntries(debt,'payment').map(row=>row.id),['P2']);assert.equal(debt.updatedAt,'2026-09-09T10:00:00.000Z');
});

test('Orders validation rejects malformed or mutable debt-progress history',()=>{
 const normalization=createStateNormalization({});
 assert.throws(()=>normalization.normalizeState(baseOrderState([{id:'D',debtProgress:[{id:'P',kind:'payment',action:'add',amount:-10}]}])),/invalid amount/);
 assert.throws(()=>normalization.normalizeState(baseOrderState([{id:'D',debtProgress:[{id:'R',kind:'payment',action:'reset',clears:[]}]}])),/invalid reset targets/);
 const base=normalization.normalizeState(baseOrderState([{id:'D',amount:100,debtProgress:[add('P','payment',20)]}])),local=structuredClone(base),remote=structuredClone(base),merge=createSyncMerge({normalizeState:normalization.normalizeState});
 local.customerDebts[0].debtProgress[0].amount=25;
 const result=merge.merge3(base,local,remote);assert.ok(result.conflicts.includes('customerDebt:D'),'existing ledger entries are immutable; edits must conflict rather than rewrite history');
});

test('same Morning event verified at different times merges without a business conflict',()=>{
 const normalization=createStateNormalization({}),merge=createSyncMerge({normalizeState:normalization.normalizeState});
 const base=normalization.normalizeState(baseOrderState([{id:'D',amount:100}])),local=structuredClone(base),remote=structuredClone(base);
 local.customerDebts[0].debtProgress=[{...add('MORNING:operation:payment','payment',30),source:'morning'}];
 remote.customerDebts[0].debtProgress=[{...local.customerDebts[0].debtProgress[0],createdAt:'2026-09-09T12:00:00.000Z'}];
 const result=merge.merge3(base,local,remote);
 assert.deepEqual(result.conflicts,[]);assert.equal(result.state.customerDebts[0].debtProgress.length,1);
 assert.equal(customerDebtProgressData(result.state.customerDebts[0]).paymentApplied,30);
 assert.deepEqual(merge.merge3(base,remote,local).state.customerDebts,result.state.customerDebts,'metadata choice is deterministic');
 const edited=structuredClone(result.state);edited.customerDebts[0].debtProgress[0].createdAt='2026-09-09T13:00:00.000Z';
 assert.deepEqual(merge.merge3(result.state,edited,result.state).state.customerDebts[0].debtProgress,result.state.customerDebts[0].debtProgress,'known events remain byte-for-byte immutable');
 remote.customerDebts[0].debtProgress[0].amount=31;
 assert.ok(merge.merge3(base,local,remote).conflicts.includes('customerDebt:D'),'same ID with a different amount must conflict');
});
