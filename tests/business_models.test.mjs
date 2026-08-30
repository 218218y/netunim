import test from 'node:test';
import assert from 'node:assert/strict';
import {rawCreditSchedule, creditProgress, inactiveCreditExpired} from '../netunim-kupa/site/assets/js/domains/credit/model.js';
import {expenseOccurrencesForMonthData} from '../netunim-kupa/site/assets/js/domains/expenses/model.js';
import {bankCurrentBalanceData} from '../netunim-kupa/site/assets/js/domains/bank/model.js';
import {mergeRecordArray, comparePendingFreshness} from '../netunim-kupa/site/assets/js/sync/merge-records.js';
import {ALL_SUPPLIERS_ID, balanceRowsData, orderedSuppliersData, supplierBalanceData, supplierYearContextData, supplierFinancialStatsData, supplierArchiveYearsData, supplierViewRowsData, transactionFinancialStatsData} from '../netunim-orders/site/assets/js/domains/suppliers/model.js';
import {createDomainsSuppliersNavigation} from '../netunim-orders/site/assets/js/domains/suppliers/navigation.js';
import {createDomainsSuppliersView} from '../netunim-orders/site/assets/js/domains/suppliers/view.js';
import {inventoryStatsData} from '../netunim-orders/site/assets/js/domains/inventory/model.js';
import {serviceStatus} from '../netunim-orders/site/assets/js/domains/service/model.js';
import {customerStatsData} from '../netunim-orders/site/assets/js/domains/customers/model.js';
import {createDomainsCustomersEditor} from '../netunim-orders/site/assets/js/domains/customers/editor.js';
import {createDomainsCustomersView} from '../netunim-orders/site/assets/js/domains/customers/view.js';
import {money} from '../netunim-orders/site/assets/js/core/money.js';
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
test('all-suppliers rows preserve requested supplier order and apply year and workflow filters per supplier',()=>{
 const state={suppliers:[{id:'FIRST',name:'ראשון'},{id:'MIDDLE',name:'אמצעי'},{id:'LAST',name:'אחרון'}],transactions:[
  {id:'F1',supplierId:'FIRST',sequence:1,debit:100,credit:0,yearEnd:2025,invoiceReceived:true,signed:true,supplied:true},
  {id:'F2',supplierId:'FIRST',sequence:2,debit:0,credit:25,invoiceReceived:false,signed:false,supplied:false},
  {id:'M1',supplierId:'MIDDLE',sequence:1,debit:40,credit:0,yearEnd:2024,invoiceReceived:false,signed:false,supplied:false},
  {id:'M2',supplierId:'MIDDLE',sequence:2,debit:0,credit:10,invoiceReceived:true,signed:true,supplied:true},
  {id:'L1',supplierId:'LAST',sequence:1,debit:30,credit:0,yearEnd:2025,invoiceReceived:true,signed:true,supplied:true},
  {id:'L2',supplierId:'LAST',sequence:2,debit:0,credit:15,invoiceReceived:false,signed:true,supplied:false}
 ]};
 const reversed=['LAST','MIDDLE','FIRST'];
 assert.deepEqual(supplierViewRowsData(state,reversed,'all','all').map(r=>r.supplier.id),['LAST','LAST','MIDDLE','MIDDLE','FIRST','FIRST']);
 assert.deepEqual(supplierViewRowsData(state,reversed,'2025','all').map(r=>r.t.id),['L1','F1']);
 assert.deepEqual(supplierViewRowsData(state,reversed,'current','all').map(r=>r.t.id),['L2','M1','M2','F2']);
 assert.deepEqual(supplierViewRowsData(state,reversed,'current','pending').map(r=>r.t.id),['L2','M1','F2']);
 assert.deepEqual(supplierViewRowsData(state,reversed,'all','invoice').map(r=>r.t.id),['L2','M1','F2']);
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
test('all-suppliers navigation accepts archive years without pretending they belong to one supplier',()=>{
 const supplierUi={currentSupplierId:ALL_SUPPLIERS_ID,supplierMoveTargetId:'X',supplierBulkMode:true,supplierBulkSelected:new Set(['A']),supplierYearView:'current',filterMode:'pending',searchText:'abc'};
 const ui={currentView:'supplier'};let renders=0;
 const nav=createDomainsSuppliersNavigation({supplierUi,ui,supplierYearContext:()=>{throw new Error('single supplier context must not be requested in all-suppliers mode')},renderSupplier:()=>{renders++},render:()=>{}});
 nav.setSupplierYearView('2025');assert.equal(supplierUi.supplierYearView,'2025');assert.equal(renders,1);
 nav.switchSupplier('S');assert.equal(supplierUi.currentSupplierId,'S');
 nav.switchSupplier(ALL_SUPPLIERS_ID);assert.equal(supplierUi.currentSupplierId,ALL_SUPPLIERS_ID);assert.equal(supplierUi.supplierBulkMode,false);
});
test('supplier header balance follows the active workflow filter while all keeps the full balance',()=>{
 const state={suppliers:[{id:'S',name:'ספק',sortOrder:0}],transactions:[
  {id:'A',supplierId:'S',sequence:1,debit:100,credit:0,invoiceReceived:true,signed:true,supplied:true,hmIssued:false},
  {id:'B',supplierId:'S',sequence:2,debit:0,credit:30,invoiceReceived:false,signed:true,supplied:false,hmIssued:false},
  {id:'C',supplierId:'S',sequence:3,debit:0,credit:20,invoiceReceived:true,signed:true,supplied:true,hmIssued:true},
  {id:'D',supplierId:'S',sequence:4,debit:5,credit:0,invoiceReceived:true,signed:true,supplied:false,hmIssued:true}
 ]};
 const supplierUi={currentSupplierId:'S',filterMode:'all',searchText:'',supplierYearView:'current',supplierBulkMode:false,supplierBulkSelected:new Set(),supplierMoveTargetId:null};
 const main={dataset:{},innerHTML:'',querySelector:()=>null};
 const previousDocument=globalThis.document;
 globalThis.document={querySelector:selector=>selector==='#main'?main:null,querySelectorAll:()=>[]};
 try{
  const view=createDomainsSuppliersView({model:{state},supplierUi,balanceRows:id=>balanceRowsData(state,id),supplierYearContext:id=>supplierYearContextData(state,id),supplierViewRows:(ids,year,filter)=>supplierViewRowsData(state,ids,year,filter),orderedSuppliers:()=>orderedSuppliersData(state),mountViewLayout:()=>{},captureSupplierViewport:()=>null,restoreSupplierViewport:()=>{},syncSupplierBulkUi:()=>{},supplierMoveTargetRow:()=>'',storeSupplierViewport:()=>{},scrollSupplierTransactionsEnd:()=>{},scheduleSave:()=>{}});
  const header=()=>main.innerHTML.match(/data-supplier-header-balance[^>]*>([^<]*)<\/b>/)?.[1]||'';
  const expected={all:-55,pending:25,invoice:30,hm:15};
  for(const mode of Object.keys(expected)){supplierUi.filterMode=mode;view.renderSupplier();assert.equal(header(),money(expected[mode]),mode)}
 }finally{if(previousDocument===undefined)delete globalThis.document;else globalThis.document=previousDocument}
});

test('all-suppliers view renders supplier groups in reverse configured order and exposes shared year filters',()=>{
 const state={suppliers:[{id:'FIRST',name:'ראשון',sortOrder:0},{id:'MIDDLE',name:'אמצעי',sortOrder:1},{id:'LAST',name:'אחרון',sortOrder:2}],transactions:[
  {id:'F1',supplierId:'FIRST',sequence:1,debit:10,credit:0,yearEnd:2025,invoiceReceived:true,signed:true,supplied:true},
  {id:'F2',supplierId:'FIRST',sequence:2,debit:0,credit:1,invoiceReceived:false,signed:false,supplied:false},
  {id:'M1',supplierId:'MIDDLE',sequence:1,debit:20,credit:0,yearEnd:2024,invoiceReceived:true,signed:true,supplied:true},
  {id:'M2',supplierId:'MIDDLE',sequence:2,debit:0,credit:2,invoiceReceived:true,signed:true,supplied:true},
  {id:'L1',supplierId:'LAST',sequence:1,debit:30,credit:0,yearEnd:2025,invoiceReceived:true,signed:true,supplied:true},
  {id:'L2',supplierId:'LAST',sequence:2,debit:0,credit:3,invoiceReceived:false,signed:true,supplied:false}
 ]};
 const supplierUi={currentSupplierId:ALL_SUPPLIERS_ID,filterMode:'all',searchText:'',supplierYearView:'all',supplierBulkMode:true,supplierBulkSelected:new Set(['F1']),supplierMoveTargetId:null};
 const main={dataset:{},innerHTML:'',querySelector:()=>null};
 const previousDocument=globalThis.document;
 globalThis.document={querySelector:selector=>selector==='#main'?main:null,querySelectorAll:()=>[]};
 try{
  const view=createDomainsSuppliersView({model:{state},supplierUi,balanceRows:id=>balanceRowsData(state,id),supplierYearContext:id=>supplierYearContextData(state,id),supplierViewRows:(ids,year,filter)=>supplierViewRowsData(state,ids,year,filter),orderedSuppliers:()=>orderedSuppliersData(state),mountViewLayout:()=>{},captureSupplierViewport:()=>null,restoreSupplierViewport:()=>{},syncSupplierBulkUi:()=>{},supplierMoveTargetRow:()=>'',storeSupplierViewport:()=>{},scrollSupplierTransactionsEnd:()=>{},scheduleSave:()=>{}});
  view.renderSupplier({scrollMode:'end'});
 }finally{if(previousDocument===undefined)delete globalThis.document;else globalThis.document=previousDocument}
 const tbody=main.innerHTML.match(/<tbody>([\s\S]*?)<\/tbody>/)?.[1]||'';
 assert.ok(tbody.indexOf('data-supplier-id="LAST"')<tbody.indexOf('data-supplier-id="MIDDLE"'));
 assert.ok(tbody.indexOf('data-supplier-id="MIDDLE"')<tbody.indexOf('data-supplier-id="FIRST"'));
 assert.match(main.innerHTML,/supplier-menu-all[^>]*active/);assert.match(main.innerHTML,/ארכיון 2025/);assert.match(main.innerHTML,/ארכיון 2024/);
 assert.doesNotMatch(main.innerHTML,/toggle-supplier-bulk-mode/);assert.equal(supplierUi.supplierBulkMode,false);assert.equal(supplierUi.supplierBulkSelected.size,0);
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

test('customer header total uses the exact debt rows shown by filters and partial search refresh',()=>{
 const state={customerDebts:[
  {id:'D1',customerName:'Open',amount:100,paid:false,invoiceIssued:false,note:''},
  {id:'D2',customerName:'Invoice',amount:50,paid:true,invoiceIssued:false,note:''},
  {id:'D3',customerName:'Closed',amount:25,paid:true,invoiceIssued:true,note:''},
  {id:'D4',customerName:'Reverse',amount:-10,paid:false,invoiceIssued:false,note:''}
 ],customerOrders:[]};
 const customerUi={customerTab:'debts',customerFilter:'all',customerOrderFilter:'all',customerSearch:'',customerBulkSelected:new Set(),customerBulkMode:false};
 const headerNode={textContent:'',classList:{toggle:()=>{}}},results={innerHTML:''},main={innerHTML:'',querySelector:selector=>selector==='[data-customer-visible-total]'?headerNode:null};
 const previousDocument=globalThis.document;
 globalThis.document={querySelector:selector=>selector==='#main'?main:selector==='#customerSearchResults'?results:null};
 try{
  const view=createDomainsCustomersView({model:{state},customerUi,bindScrollViewport:()=>{},mountViewLayout:()=>{},customerStats:()=>customerStatsData(state),customerBulkHeader:()=>'',customerBulkControls:()=>'',syncCustomerBulkUi:()=>{},customerBottomSummary:()=>'',customerBulkCell:()=>'',scheduleSave:()=>{}});
  const renderedTotal=()=>main.innerHTML.match(/data-customer-visible-total[^>]*>([^<]*)<\/b>/)?.[1]||'';
  const expected={all:140,open:90,invoice:50,closed:25};
  for(const mode of Object.keys(expected)){customerUi.customerFilter=mode;customerUi.customerSearch='';view.renderCustomers();assert.equal(renderedTotal(),money(expected[mode]),mode)}
  customerUi.customerFilter='all';customerUi.customerSearch='Reverse';view.renderCustomers({resultsOnly:true});
  assert.equal(headerNode.textContent,money(-10));assert.match(results.innerHTML,/Reverse/);assert.doesNotMatch(results.innerHTML,/>Open</);
 }finally{if(previousDocument===undefined)delete globalThis.document;else globalThis.document=previousDocument}
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
