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

test('customer balances distinguish paid debt from missing invoices',()=>{
 const state={customerDebts:[{amount:100},{amount:70,paid:true},{amount:40,paid:true,invoiceIssued:true}],customerOrders:[{}]};
 assert.deepEqual(customerStatsData(state),{openTotal:100,allTotal:210,open:1,missingInvoice:1,closed:1,trackedOrders:1});
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
