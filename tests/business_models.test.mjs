import test from 'node:test';
import assert from 'node:assert/strict';
import {rawCreditSchedule, creditProgress, inactiveCreditExpired} from '../netunim-kupa/site/assets/js/domains/credit/model.js';
import {futureCheckMonthsData as kupaFutureCheckMonthsData} from '../netunim-kupa/site/assets/js/domains/checks/model.js';
import {futureCheckMonthsData as ordersFutureCheckMonthsData} from '../netunim-orders/site/assets/js/domains/checks/model.js';
import {expenseOccurrencesForMonthData} from '../netunim-kupa/site/assets/js/domains/expenses/model.js';
import {bankCurrentBalanceData} from '../netunim-kupa/site/assets/js/domains/bank/model.js';
import {computeKupaNetReadoutData, kupaAllInstallments, kupaBusinessInstallments} from '../netunim-orders/site/assets/js/domains/bank/readout.js';
import {mergeRecordArray, comparePendingFreshness} from '../netunim-kupa/site/assets/js/sync/merge-records.js';
import {ALL_SUPPLIERS_ID, balanceRowsData, orderedSuppliersData, supplierBalanceData, supplierYearContextData, supplierFinancialStatsData, supplierArchiveYearsData, supplierViewRowsData, transactionFinancialStatsData} from '../netunim-orders/site/assets/js/domains/suppliers/model.js';
import {createDomainsSuppliersNavigation} from '../netunim-orders/site/assets/js/domains/suppliers/navigation.js';
import {createDomainsSuppliersView} from '../netunim-orders/site/assets/js/domains/suppliers/view.js';
import {inventoryStatsData} from '../netunim-orders/site/assets/js/domains/inventory/model.js';
import {serviceStatus} from '../netunim-orders/site/assets/js/domains/service/model.js';
import {customerDebtFilteredTotal,customerDebtIsOutstanding,customerDebtNeedsAttention,customerStatsData} from '../netunim-orders/site/assets/js/domains/customers/model.js';
import {createDomainsCustomersEditor} from '../netunim-orders/site/assets/js/domains/customers/editor.js';
import {createDomainsCustomersView} from '../netunim-orders/site/assets/js/domains/customers/view.js';
import {createDomainsCustomersBulk} from '../netunim-orders/site/assets/js/domains/customers/bulk.js';
import {money} from '../netunim-orders/site/assets/js/core/money.js';
import {createStateNormalization as createKupaNormalization} from '../netunim-kupa/site/assets/js/state/normalization.js';
import {createStateNormalization as createOrderNormalization} from '../netunim-orders/site/assets/js/state/normalization.js';
import {cashflowWarningItems} from '../netunim-orders/site/assets/js/domains/bank/alerts.js';
import {dueCheckWarningItems} from '../netunim-orders/site/assets/js/domains/checks/alerts.js';
import {createUiAlertCenter} from '../netunim-orders/site/assets/js/ui/alert-center.js';

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
test('future check forecast starts at the current month, fills internal gaps, trims trailing empty months and respects year filters',()=>{
 const state={checks:[
  {id:'PAST',amount:10,dueDate:'2026-08-20',status:'בקופה'},
  {id:'SEP',amount:100,dueDate:'2026-09-10',status:'בקופה'},
  {id:'NOV1',amount:200,dueDate:'2026-11-01',status:'בקופה'},
  {id:'NOV2',amount:50,dueDate:'2026-11-20',status:'בקופה'},
  {id:'CLOSED',amount:999,dueDate:'2026-12-01',status:'נפרע'},
  {id:'FEB27',amount:300,dueDate:'2027-02-15',status:'בקופה'}
 ]};
 const forecastModels=[kupaFutureCheckMonthsData,ordersFutureCheckMonthsData];
 for(const futureCheckMonthsData of forecastModels){
  assert.deepEqual(futureCheckMonthsData(state,{fromMonth:'2026-09',year:'2026'}),[
   {key:'2026-09',total:100},{key:'2026-10',total:0},{key:'2026-11',total:250}
  ]);
  assert.deepEqual(futureCheckMonthsData(state,{fromMonth:'2026-09',year:'all'}),[
   {key:'2026-09',total:100},{key:'2026-10',total:0},{key:'2026-11',total:250},{key:'2026-12',total:0},{key:'2027-01',total:0},{key:'2027-02',total:300}
  ]);
  assert.deepEqual(futureCheckMonthsData(state,{fromMonth:'2026-09',year:'2027'}),[
   {key:'2027-01',total:0},{key:'2027-02',total:300}
  ]);
  assert.deepEqual(futureCheckMonthsData(state,{fromMonth:'2026-09',year:'2025'}),[]);
  assert.deepEqual(futureCheckMonthsData({checks:[]},{fromMonth:'2026-09',year:'2026'}),[]);
 }
});
test('warning models expose only active cashflow breaches and checks whose deposit date has arrived',()=>{
 const cashflow=cashflowWarningItems({bank:{currentBalance:400,adjustments:[]},cashflowSettings:{businessMinimum:500},credits:[],expenses:[]});
 assert.equal(cashflow.length,1);assert.equal(cashflow[0].kind,'cashflow');assert.equal(cashflow[0].account,'עסקי');assert.equal(cashflow[0].reason,'minimum');
 const checks=dueCheckWarningItems([
  {id:'OVER',name:'עבר',amount:100,dueDate:'2026-09-02',status:'בקופה'},
  {id:'TODAY',name:'היום',amount:200,dueDate:'2026-09-03',status:'בקופה'},
  {id:'FUTURE',name:'עתיד',amount:300,dueDate:'2026-09-04',status:'בקופה'},
  {id:'DEPOSITED',name:'הופקד',amount:400,dueDate:'2026-09-01',status:'הופקד - במעקב'},
  {id:'BAD',name:'לא תקין',amount:500,dueDate:'03/09/2026',status:'בקופה'},
 ],'2026-09-03');
 assert.deepEqual(checks.map(row=>row.checkId),['OVER','TODAY']);
 assert.equal(checks[0].isToday,false);assert.equal(checks[1].isToday,true);
});

test('alert center presents readable cashflow/check cards and updates the persistent header indicator',()=>{
 const classState=new Set(),button={classList:{toggle:(name,on)=>on?classState.add(name):classState.delete(name)},attrs:{},setAttribute(name,value){this.attrs[name]=value},title:''},count={textContent:'',hidden:true};
 const model={state:{checks:[{id:'DUE',name:'לקוח לבדיקה',amount:780,dueDate:'2000-01-01',status:'בקופה',checkNumber:'12345',note:'להפקיד בסניף'}]}};
 const previousDocument=globalThis.document;let captured=null,closed=0,checkTarget='',cashflowTarget='';
 globalThis.document={getElementById:id=>id==='alertCenterButton'?button:id==='alertCenterCount'?count:null};
 try{
  const center=createUiAlertCenter({model,financeSnapshot:()=>({kupa:{bank:{currentBalance:-250,adjustments:[]},credits:[],expenses:[],cashflowSettings:{}}}),modal:(title,body,foot)=>{captured={title,body,foot}},closeModal:()=>{closed++},navigateToChecks:id=>{checkTarget=id},navigateToCashflow:account=>{cashflowTarget=account}});
  assert.equal(center.refreshIndicator().length,2);assert.equal(count.textContent,'2');assert.equal(count.hidden,false);assert.equal(classState.has('active'),true);
  assert.equal(center.showStartupAlerts(),true);assert.equal(captured.title,'התראות בפתיחת המערכת');assert.match(captured.body,/alert-center-card cashflow-warning alert-center-card-action/);assert.match(captured.body,/data-action="open-alert-target"/);assert.match(captured.body,/יתרה צפויה/);assert.match(captured.body,/alert-center-card check-warning alert-center-card-action/);assert.match(captured.body,/לקוח לבדיקה/);assert.match(captured.body,/מס׳ צ׳ק 12345/);assert.match(captured.body,/להפקיד בסניף/);assert.match(captured.body,/סימן האזהרה בראש המסך/);
  assert.equal(center.openAlertTarget('check:DUE'),true);assert.equal(checkTarget,'DUE');assert.equal(closed,1,'opening a check warning closes the alert modal before navigation');
  assert.equal(center.openAlertTarget('cashflow:עסקי'),true);assert.equal(cashflowTarget,'עסקי');assert.equal(closed,2,'opening a cashflow warning closes the alert modal before navigation');
  model.state.checks[0].status='הופקד - במעקב';center.refreshIndicator();assert.equal(count.textContent,'1','depositing a due check removes only its alert immediately');
  assert.equal(center.showStartupAlerts(),false,'startup warnings are shown once per app boot');
 }finally{if(previousDocument===undefined)delete globalThis.document;else globalThis.document=previousDocument}
});

test('bank balance remains the authoritative snapshot regardless of check workflow status',()=>{
 const state={bank:{currentBalance:1000,snapshotSeq:5,adjustments:[]},checks:[{id:'C',amount:100,status:'בקופה'}]};
 assert.equal(bankCurrentBalanceData(state),1000);
 state.checks[0].status='הופקד - במעקב';assert.equal(bankCurrentBalanceData(state),1000);
 state.checks[0].status='נפרע';assert.equal(bankCurrentBalanceData(state),1000);
 state.checks[0].status='חזר';assert.equal(bankCurrentBalanceData(state),1000);
 state.bank.adjustments=[{type:'manual',amount:25},{type:'check_deposit',amount:500}];
 assert.equal(bankCurrentBalanceData(state),1025,'manual corrections remain supported while legacy check adjustments stay excluded');
});
test('Orders readout includes only business synchronized credit in Kupa net and never adds check events to bank',()=>{
 const businessKey='P:1111',homeKey='P:2222',kupa={bank:{currentBalance:1000,asOfDate:'2020-01-01',adjustments:[]},credits:[],expenses:[],cash:[],creditSync:{version:3,profiles:[{profileId:'P',provider:'max',accounts:[
  {accountNumber:'1111',txns:[{id:'T',processedDate:'2099-01-10',chargedAmount:-75,chargedCurrency:'ILS',status:'completed'}]},
  {accountNumber:'2222',txns:[{id:'H',processedDate:'2099-01-10',chargedAmount:-125,chargedCurrency:'ILS',status:'completed'}]},
 ]}],cardMappings:{[businessKey]:{included:true,account:'עסקי'},[homeKey]:{included:true,account:'ביתי'}}}};
 assert.equal(kupaAllInstallments(kupa).reduce((sum,row)=>sum+row.amount,0),200,'credit reporting still sees both included cards');
 assert.equal(kupaBusinessInstallments(kupa).reduce((sum,row)=>sum+row.amount,0),75,'business readout excludes the included home card');
 const readout=computeKupaNetReadoutData({checks:[{id:'C',amount:40,status:'הופקד - במעקב'}]},kupa);
 assert.equal(readout.bank,1000);assert.equal(readout.credit,75);assert.equal(readout.net,925);
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
test('customer debt attention and outstanding-money semantics stay separate',()=>{
 const open={paid:false,invoiceIssued:false},paidMissingInvoice={paid:true,invoiceIssued:false},closed={paid:true,invoiceIssued:true};
 assert.equal(customerDebtNeedsAttention(open),true);assert.equal(customerDebtNeedsAttention(paidMissingInvoice),true);assert.equal(customerDebtNeedsAttention(closed),false);
 assert.equal(customerDebtIsOutstanding(open),true);assert.equal(customerDebtIsOutstanding(paidMissingInvoice),false);assert.equal(customerDebtIsOutstanding(closed),false);
});
test('customer filtered totals keep all/open as debt totals but sum the selected follow-up filter',()=>{
 const rows=[{amount:100,paid:false,invoiceIssued:false},{amount:-10,paid:false,invoiceIssued:false},{amount:50,paid:true,invoiceIssued:false},{amount:25,paid:true,invoiceIssued:true}];
 assert.equal(customerDebtFilteredTotal(rows,'all'),90);
 assert.equal(customerDebtFilteredTotal(rows,'open'),90);
 assert.equal(customerDebtFilteredTotal(rows.filter(d=>d.paid&&!d.invoiceIssued),'invoice'),50);
 assert.equal(customerDebtFilteredTotal(rows.filter(d=>d.paid&&d.invoiceIssued),'closed'),25);
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

test('customer order tracking uses the clean manual row model for inline add, edit and delete',async()=>{
 const state={customerDebts:[],customerOrders:[{id:'O1',orderNumber:'10',customerName:'קיים',mark1:'V',mark2:'VV',mark3:'VVV',mattresses:'זוגי',note:'הערה'}]};
 const customerUi={customerTab:'orders',customerFilter:'all',customerOrderFilter:'mattress',customerSearch:'קיים',customerBulkSelected:new Set(['O1']),customerBulkMode:false};
 let saved=0,rendered=0;
 const editor=createDomainsCustomersEditor({model:{state},customerUi,modal:()=>{},toast:msg=>{throw new Error(msg)},scheduleSave:()=>{saved++},closeModal:()=>{},renderCustomers:()=>{rendered++},confirmDialog:async()=>true});
 const view=createDomainsCustomersView({model:{state},customerUi,bindScrollViewport:()=>{},mountViewLayout:()=>{},customerStats:()=>customerStatsData(state),customerBulkHeader:()=>'',customerBulkControls:()=>'',syncCustomerBulkUi:()=>{},customerBottomSummary:()=>'',customerBulkCell:()=>'',scheduleSave:()=>{}});
 const existing=view.customerOrderRow(state.customerOrders[0]);
 assert.match(existing,/data-blur-arg1="orderNumber"/);assert.match(existing,/data-blur-arg1="mark3"/);assert.match(existing,/value="זוגי"/);assert.match(existing,/data-action="add-customer-order"/);assert.match(existing,/data-action="delete-customer-order"/);
 const id=editor.addCustomerOrder();assert.ok(state.customerOrders.some(x=>x.id===id));assert.equal(customerUi.customerOrderFilter,'all');assert.equal(customerUi.customerSearch,'');
 const added=state.customerOrders.find(x=>x.id===id);assert.deepEqual({orderNumber:added.orderNumber,customerName:added.customerName,mark1:added.mark1,mark2:added.mark2,mark3:added.mark3,mattresses:added.mattresses,note:added.note},{orderNumber:'',customerName:'',mark1:'',mark2:'',mark3:'',mattresses:'',note:''});
 assert.equal('sourceMarkA' in added,false);assert.equal('mattressMarked' in added,false);assert.equal('sourceAttention' in added,false);
 editor.saveCustomerOrderField(id,'orderNumber',{value:'20'});editor.saveCustomerOrderField(id,'customerName',{value:'חדש'});editor.saveCustomerOrderField(id,'mark1',{value:'א'});editor.saveCustomerOrderField(id,'mark2',{value:'ב'});editor.saveCustomerOrderField(id,'mark3',{value:'ג'});editor.saveCustomerOrderField(id,'mattresses',{value:'זוגי'});editor.saveCustomerOrderField(id,'note',{value:'בדיקה'});
 assert.deepEqual({orderNumber:added.orderNumber,customerName:added.customerName,mark1:added.mark1,mark2:added.mark2,mark3:added.mark3,mattresses:added.mattresses,note:added.note},{orderNumber:'20',customerName:'חדש',mark1:'א',mark2:'ב',mark3:'ג',mattresses:'זוגי',note:'בדיקה'});
 await editor.deleteCustomerOrder('O1');assert.equal(state.customerOrders.some(x=>x.id==='O1'),false);assert.equal(customerUi.customerBulkSelected.has('O1'),false);assert.equal(saved,9);assert.equal(rendered,2);
});

test('customer order table exposes add action and no longer shows the legacy V-marker disclaimer',()=>{
 const state={customerDebts:[],customerOrders:[{id:'O1',orderNumber:'1',customerName:'לקוח',mark3:'VVV'}]};
 const customerUi={customerTab:'orders',customerFilter:'all',customerOrderFilter:'all',customerSearch:'',customerBulkSelected:new Set(),customerBulkMode:false};
 const bulk=createDomainsCustomersBulk({customerUi,model:{state},renderCustomers:()=>{},toast:()=>{},scheduleSave:()=>{},confirmDialog:async()=>true});
 const main={innerHTML:''},previousDocument=globalThis.document;
 globalThis.document={querySelector:selector=>selector==='#main'?main:null,querySelectorAll:()=>[]};
 try{
  const view=createDomainsCustomersView({model:{state},customerUi,bindScrollViewport:()=>{},mountViewLayout:()=>{},customerStats:()=>customerStatsData(state),customerBulkHeader:()=>'',customerBulkControls:()=>'',syncCustomerBulkUi:()=>{},customerBottomSummary:st=>bulk.customerBottomSummary(st),customerBulkCell:()=>'',scheduleSave:()=>{}});
  view.renderCustomers();assert.match(main.innerHTML,/סימון 3/);assert.match(main.innerHTML,/data-action="add-customer-order"/);assert.doesNotMatch(main.innerHTML,/דורש תשומת לב/);assert.doesNotMatch(main.innerHTML,/סימוני V \/ VV \/ VVV/);
 }finally{if(previousDocument===undefined)delete globalThis.document;else globalThis.document=previousDocument}
});

test('customer header total follows each filter while all excludes paid follow-up rows from debt total',()=>{
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
  const expected={all:90,open:90,invoice:50,closed:25};
  for(const mode of Object.keys(expected)){customerUi.customerFilter=mode;customerUi.customerSearch='';view.renderCustomers();assert.equal(renderedTotal(),money(expected[mode]),mode)}
  customerUi.customerFilter='all';customerUi.customerSearch='';view.renderCustomers();assert.match(main.innerHTML,/>Open</);assert.match(main.innerHTML,/>Reverse</);assert.match(main.innerHTML,/>Invoice</);assert.doesNotMatch(main.innerHTML,/>Closed</);assert.match(main.innerHTML,/customer-add-btn[\s\S]*customer-visible-total/);
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
