import test from 'node:test';
import assert from 'node:assert/strict';
import {rawCreditSchedule, creditProgress, inactiveCreditExpired} from '../netunim-kupa/site/assets/js/domains/credit/model.js';
import {expenseOccurrencesForMonthData} from '../netunim-kupa/site/assets/js/domains/expenses/model.js';
import {bankCurrentBalanceData} from '../netunim-kupa/site/assets/js/domains/bank/model.js';
import {mergeRecordArray, comparePendingFreshness} from '../netunim-kupa/site/assets/js/sync/merge-records.js';
import {supplierBalanceData, supplierYearContextData, supplierFinancialStatsData, supplierArchiveYearsData, transactionFinancialStatsData} from '../netunim-orders/site/assets/js/domains/suppliers/model.js';
import {createDomainsSuppliersNavigation} from '../netunim-orders/site/assets/js/domains/suppliers/navigation.js';
import {inventoryStatsData} from '../netunim-orders/site/assets/js/domains/inventory/model.js';
import {serviceStatus} from '../netunim-orders/site/assets/js/domains/service/model.js';
import {customerStatsData} from '../netunim-orders/site/assets/js/domains/customers/model.js';
import {createDomainsCustomersEditor} from '../netunim-orders/site/assets/js/domains/customers/editor.js';
import {createDomainsCustomersView} from '../netunim-orders/site/assets/js/domains/customers/view.js';
import {createStateNormalization as createKupaNormalization} from '../netunim-kupa/site/assets/js/state/normalization.js';
import {createStateNormalization as createOrderNormalization} from '../netunim-orders/site/assets/js/state/normalization.js';

test('Orders restore rejects future metadata even with a supported top-level version',()=>{
 const {normalizeState,validateRestoreJson}=createOrderNormalization({});
 const raw=normalizeState({});
 assert.throws(()=>validateRestoreJson({...raw,_meta:{format:'order-management-portable',schemaVersion:99}}));
 assert.throws(()=>validateRestoreJson({...raw,version:'broken'}));
 assert.throws(()=>validateRestoreJson({...raw,_meta:[]}));
});

test('credit allocations conserve cents and clamp end-of-month dates',()=>{
 const credit={id:'C',totalAmount:100,installments:3,firstChargeDate:'2024-01-31',active:true};
 const schedule=rawCreditSchedule(credit);
 assert.deepEqual(schedule.map(x=>x.date),['2024-01-31','2024-02-29','2024-03-31']);
 assert.equal(schedule.reduce((s,x)=>s+Math.round(x.amount*100),0),10000);
 assert.equal(creditProgress(credit,'2024-02-29').remainingCount,2);
 assert.equal(inactiveCreditExpired({...credit,active:false},'2024-05-30'),false);
 assert.equal(inactiveCreditExpired({...credit,active:false},'2024-05-31'),true);
});
test('expense recurrence and one-time dates remain distinct',()=>{
 const state={expenses:[{id:'R',date:'2024-01-31',amount:50,recurring:true,active:true},{id:'O',date:'2024-01-10',amount:80,recurring:false,active:true}]};
 assert.deepEqual(expenseOccurrencesForMonthData(state,'2024-02').map(x=>[x.id,x.dueDate]),[['R','2024-02-29']]);
});
test('bank watermark and pending checks do not double count deposits',()=>{
 const base=[{id:'C',amount:100,status:'בקופה'}],state={bank:{currentBalance:1000,snapshotSeq:5,adjustments:[]},checks:[{...base[0],status:'הופקד - במעקב'}]};
 assert.equal(bankCurrentBalanceData([],base,state),1100);
 const event={seq:6,checkId:'C',delta:100};
 assert.equal(bankCurrentBalanceData([event],state.checks,state),1100);
 state.bank.snapshotSeq=6;state.bank.currentBalance=1100;
 state.checks=[{...base[0],status:'חזר'}];
 assert.equal(bankCurrentBalanceData([event],[{...base[0],status:'הופקד - במעקב'}],state),1000);
});
test('merge preserves independent changes and detects deletion versus edit',()=>{
 const base=[{id:'A',value:1},{id:'B',value:2}],local=[{id:'A',value:3},{id:'B',value:2}],remote=[{id:'A',value:1},{id:'B',value:4}];
 const conflicts=[];
 const rows=mergeRecordArray(base,local,remote,'id','rows',conflicts);
 assert.deepEqual(rows.map(x=>x.value),[3,4]);assert.deepEqual(conflicts,[]);
 const deleted=[];mergeRecordArray(base,[base[1]],[{id:'A',value:8},base[1]],'id','rows',deleted);
 assert.ok(deleted.length);
});
test('Kupa restore rejects future schemas and foreign backup formats',()=>{
 const api=createKupaNormalization({model:{}});
 const valid={version:4,checks:[],credits:[],cash:[],expenses:[],cards:[]};
 assert.equal(api.stateFromPayload(valid).state.version,4);
 assert.throws(()=>api.stateFromPayload({...valid,_meta:{format:'other-app',schemaVersion:6}}));
 assert.throws(()=>api.stateFromPayload({...valid,_meta:{format:'kupa-portable',schemaVersion:99}}));
 assert.throws(()=>api.stateFromPayload({...valid,version:99}));
});
test('inventory derives quantities from orders, partial receipts and reservations',()=>{
 const state={inventoryEvents:[{itemId:'I',type:'opening',quantity:10},{itemId:'I',type:'order',quantity:6,receivedQuantity:2},{itemId:'I',type:'receive',quantity:2},{itemId:'I',type:'reserve',quantity:3},{itemId:'I',type:'reserve',quantity:1,pickedAt:'2026-01-01'},{itemId:'I',type:'reserve',quantity:7,releasedAt:'2026-01-01'}]};
 assert.deepEqual(inventoryStatsData(state,'I'),{onHand:11,reserved:3,incoming:4,available:8,projected:12});
});
test('supplier totals and intermediate balances retain transaction sequence',()=>{
 const state={transactions:[{id:'B',supplierId:'S',sequence:2,debit:0,credit:50},{id:'A',supplierId:'S',sequence:1,debit:100,credit:0}]};
 assert.equal(supplierBalanceData(state,'S'),-50);
 const ctx=supplierYearContextData(state,'S');assert.deepEqual(ctx.rows.map(r=>r.id),['A','B']);
});
test('supplier financial summaries respect year boundaries without recounting archived carry rows',()=>{
 const state={suppliers:[{id:'S'},{id:'T'}],transactions:[
  {id:'A',supplierId:'S',sequence:1,debit:100,credit:0,yearEnd:2025,invoiceReceived:false,signed:false,supplied:false},
  {id:'B',supplierId:'S',sequence:2,debit:0,credit:30},
  {id:'C',supplierId:'T',sequence:1,debit:20,credit:0,yearEnd:2024}
 ]};
 assert.deepEqual(supplierArchiveYearsData(state),[2025,2024]);
 assert.deepEqual(supplierFinancialStatsData(state,'S','current'),{debit:0,credit:30,net:30,txCount:1});
 assert.deepEqual(supplierFinancialStatsData(state,'S','2025'),{debit:100,credit:0,net:-100,txCount:1});
 assert.deepEqual(supplierFinancialStatsData(state,'S','all'),{debit:100,credit:30,net:-70,txCount:2});
 assert.deepEqual(supplierFinancialStatsData(state,'T','2025'),{debit:0,credit:0,net:0,txCount:0});
});
test('transaction financial summary can be derived from the exact displayed subset',()=>{
 const rows=[{debit:120,credit:0},{debit:0,credit:35.5},{debit:10,credit:5.25}];
 assert.deepEqual(transactionFinancialStatsData(rows),{debit:130,credit:40.75,net:-89.25,txCount:3});
 assert.deepEqual(transactionFinancialStatsData([rows[1]]),{debit:0,credit:35.5,net:35.5,txCount:1});
});
test('opening a supplier from another view re-renders through central navigation',()=>{
 const supplierUi={currentSupplierId:null,supplierMoveTargetId:'X',supplierBulkSelected:new Set(['A']),supplierYearView:'all',filterMode:'pending',searchText:'abc'};
 const ui={currentView:'summary'};let renderArgs=null,directSupplierRenders=0;
 const nav=createDomainsSuppliersNavigation({supplierUi,ui,supplierYearContext:()=>({years:[]}),renderSupplier:()=>{directSupplierRenders++},render:args=>{renderArgs=args}});
 nav.openSupplier('S');
 assert.equal(ui.currentView,'supplier');assert.equal(supplierUi.currentSupplierId,'S');assert.equal(supplierUi.supplierYearView,'current');
 assert.equal(supplierUi.filterMode,'all');assert.equal(supplierUi.searchText,'');assert.equal(supplierUi.supplierBulkSelected.size,0);
 assert.deepEqual(renderArgs,{supplierScrollMode:'end'});assert.equal(directSupplierRenders,0);
});
test('pending freshness favors generation before timestamp',()=>{
 assert.ok(comparePendingFreshness({generation:4,savedAt:'2026-01-01'},{generation:3,savedAt:'2027-01-01'})>0);
});

test('customer debt summary excludes paid rows and treats negative open amounts as reverse debt',()=>{
 const state={customerDebts:[{amount:100,supplied:true},{amount:60,supplied:false},{amount:25},{amount:-40,supplied:false},{amount:70,paid:true,supplied:true},{amount:40,paid:true,invoiceIssued:true}],customerOrders:[{}]};
 assert.deepEqual(customerStatsData(state),{openTotal:145,openSuppliedTotal:100,openUnsuppliedTotal:45,allTotal:255,open:4,openSupplied:1,openUnsupplied:3,missingInvoice:1,closed:1,trackedOrders:1});
});
test('customer debt editor treats blank as zero and accepts negative reverse debt',()=>{
 const model={state:{customerDebts:[]}};
 let body='',saved=0,closed=0,rendered=0;
 const editor=createDomainsCustomersEditor({model,modal:(_title,html)=>{body=html},toast:msg=>{throw new Error(msg)},scheduleSave:()=>{saved++},closeModal:()=>{closed++},renderCustomers:()=>{rendered++}});
 editor.openDebtModal();
 assert.match(body,/id="dAmount"/);
 assert.doesNotMatch(body,/id="dAmount"[^>]*\bmin="0"/);
 assert.match(body,/id="dSupplied"/);
 const before=globalThis.document,fields={'#dName':{value:'Reverse'},'#dAmount':{value:''},'#dOrder':{value:''},'#dPhone':{value:''},'#dPaid':{value:'false'},'#dSupplied':{value:'true'},'#dInvoice':{value:'false'},'#dNote':{value:''}};
 globalThis.document={querySelector:selector=>fields[selector]||null};
 try{
   editor.saveDebt();
   assert.equal(model.state.customerDebts.length,1);assert.equal(model.state.customerDebts[0].amount,0);
   fields['#dAmount'].value='-125';editor.saveDebt(model.state.customerDebts[0].id);
 }finally{if(before===undefined)delete globalThis.document;else globalThis.document=before}
 const debt=model.state.customerDebts[0];
 assert.equal(debt.amount,-125);assert.equal(debt.supplied,true);assert.ok(debt.suppliedAt);assert.equal(saved,2);assert.equal(closed,2);assert.equal(rendered,2);
 editor.openDebtModal(debt.id);assert.match(body,/id="dAmount"[^>]*value="-125"/);
});

test('customer debt amount background gives paid precedence over supplied',()=>{
 const customerUi={customerBulkSelected:new Set(),customerBulkMode:false};
 const view=createDomainsCustomersView({model:{state:{customerDebts:[],customerOrders:[]}},customerUi,bindScrollViewport:()=>{},mountViewLayout:()=>{},customerStats:()=>({}),customerBulkHeader:()=>'',customerBulkControls:()=>'',syncCustomerBulkUi:()=>{},customerBottomSummary:()=>'',customerBulkCell:()=>'',scheduleSave:()=>{}});
 const suppliedOpen=view.debtRow({id:'D1',customerName:'Customer',amount:50,paid:false,supplied:true,invoiceIssued:false,note:''});
 const paidSupplied=view.debtRow({id:'D2',customerName:'Customer',amount:50,paid:true,supplied:true,invoiceIssued:false,note:''});
 const paidOnly=view.debtRow({id:'D3',customerName:'Customer',amount:50,paid:true,supplied:false,invoiceIssued:false,note:''});
 const plainOpen=view.debtRow({id:'D4',customerName:'Customer',amount:50,paid:false,supplied:false,invoiceIssued:false,note:''});
 assert.match(suppliedOpen,/customer-debt-amount is-supplied/);assert.doesNotMatch(suppliedOpen,/customer-debt-amount is-paid/);
 assert.match(paidSupplied,/customer-debt-amount is-paid/);assert.doesNotMatch(paidSupplied,/customer-debt-amount is-supplied/);
 assert.match(paidOnly,/customer-debt-amount is-paid/);assert.match(plainOpen,/customer-debt-amount "/);
 assert.match(suppliedOpen,/data-click-arg1="supplied"/);
});

test('service status has explicit precedence when several flags are set',()=>{
 const flags={followUp:true,sent:true,escalated:true,closed:true};
 assert.equal(serviceStatus(flags).key,'closed');delete flags.closed;
 assert.equal(serviceStatus(flags).key,'escalated');delete flags.escalated;
 assert.equal(serviceStatus(flags).key,'sent');delete flags.sent;
 assert.equal(serviceStatus(flags).key,'follow');
 assert.equal(serviceStatus({}).key,'open');
});
test('normalization keeps the Orders legacy invoice marker and category order',()=>{
 const {normalizeState}=createOrderNormalization({});
 const value=normalizeState({customerDebts:[{source:{sheet:'חובות_וזכויות',row:32},note:'יצאה ח״מ'}],inventoryItems:[{category:'אביזרים'},{category:'מיטות'}]});
 assert.equal(value.customerDebts[0].invoiceIssued,true);
 assert.deepEqual(value.inventoryCategoryOrder,['מיטות','אביזרים']);
});
