"""Representative workflows through real controls, with actual offline persistence."""
from browser_harness import BrowserSession, ROOT
import json

helpers=r"""
 const element=s=>{const e=document.querySelector(s);if(!e)throw new Error('Missing control '+s);return e};
 const action=name=>element('[data-action="'+name+'"]');
 const click=name=>action(name).click();
 const fill=values=>{for(const [id,value]of Object.entries(values)){const e=element('#'+id);e.value=value;e.dispatchEvent(new Event('input',{bubbles:true}))}};
 const saved=()=>new Promise(r=>setTimeout(r,60));
 const assert=(v,m)=>{if(!v)throw new Error(m)};
 const saveModal=()=>{const b=document.querySelector('#modal [data-modal-save],#modal .btn.primary');if(!b)throw new Error('Missing save');b.click()};
 window.confirm=()=>true;
 Object.defineProperty(navigator,'onLine',{value:false,configurable:true});
"""
flows={
'kupa':r"""
 state=normalizeState({version:4,businessName:'workflow',checks:[],credits:[],cash:[],expenses:[],cards:[{name:'VISA',active:true,chargeDay:10}],bank:{currentBalance:1000,snapshotSeq:0,adjustments:[]}});
 backendReady=true;connectionMode='supabase';dbRevision=1;lastSavedSnapshot=JSON.stringify(prepareKupaCloudState(state));sharedChecksBase=[];
 setPage('cash');click('open-cash-modal');fill({mDate:'2026-08-27',mDesc:'Cash receipt',mAmount:'120',mNote:'workflow'});saveModal();await saved();
 assert(state.cash.length===1&&state.cash[0].amount===120,'cash create');
 click('open-cash-modal-2');fill({mAmount:'125'});saveModal();await saved();assert(cashBalance()===125,'cash edit');
 setPage('bank');click('open-expense-modal');fill({eDesc:'Rent',eAmount:'50',eDate:'2026-09-10'});saveModal();await saved();assert(state.expenses.length===1,'expense create');
 setPage('credit');click('open-credit-modal');fill({cDesc:'Purchase',cTotal:'300',cParts:'3',cTx:'2026-08-27',cFirst:'2026-09-10'});saveModal();await saved();
 assert(state.credits.length===1&&rawCreditSchedule(state.credits[0]).length===3,'credit schedule');
 setPage('checks');click('open-check-modal');fill({fName:'Customer'});
 const row=element('#checkSeriesRows .check-series-row');
 row.querySelector('[data-series-field="amount"]').value='200';row.querySelector('[data-series-field="number"]').value='0007';
 for(const [part,value]of [['day','10'],['month','09'],['year','26']]){const e=row.querySelector('[data-date-part="'+part+'"]');e.value=value;e.dispatchEvent(new Event('input',{bubbles:true}));e.dispatchEvent(new FocusEvent('blur',{bubbles:false}))}
 saveModal();await saved();assert(state.checks.length===1&&state.checks[0].dueDate==='2026-09-10','check create/date controls');
 click('mark-deposited');await saved();assert(state.checks[0].status==='הופקד - במעקב'&&bankCurrentBalance()===1200,'deposit bank effect');
 checkTab='deposited';renderChecks();click('mark-cleared');await saved();assert(state.checks[0].status==='נפרע'&&bankCurrentBalance()===1200,'cleared is not double-deposited');
 setPage('cash');click('open-cash-modal-2');element('[data-modal-delete]').click();await saved();assert(state.cash.length===0,'cash delete');
 const backup=payloadFromState(state,dbRevision);state.expenses=[];
 setPage('settings');const dt=new DataTransfer();dt.items.add(new File([JSON.stringify(backup)],'workflow.json',{type:'application/json'}));element('#restoreInput').files=dt.files;element('#restoreInput').dispatchEvent(new Event('change',{bubbles:true}));await saved();
 assert(state.expenses.length===1&&state.credits.length===1,'file restore');
 assert(!!loadBrowserStateSync(),'actual offline browser snapshot');
 assert(cloudPendingExistsSync(),'actual pending marker');
 return {cash:true,expense:true,credit:true,checks:true,depositClear:true,delete:true,backupRestore:true,offlinePersistence:true};
""",
'orders':r"""
 state=normalizeState({version:4,suppliers:[],transactions:[],customerDebts:[],customerOrders:[],serviceCalls:[],inventoryItems:[],inventoryEvents:[],warehouseOrders:[],notes:[],checks:[]});
 switchView('settings');click('open-supplier-modal');fill({sName:'Flow supplier',sNote:'test'});saveModal();await saved();assert(state.suppliers.length===1,'supplier create');
 switchView('supplier');click('open-transaction-modal');fill({fAction:'Order',fDebit:'100'});saveModal();await saved();assert(state.transactions.length===1&&supplierBalance(state.suppliers[0].id)===-100,'supplier transaction');
 openTransactionModal(state.transactions[0].id);fill({fDebit:'80'});saveModal();await saved();assert(supplierBalance(state.suppliers[0].id)===-80,'transaction edit');
 switchView('customers');click('open-debt-modal');fill({dName:'Flow customer',dAmount:'0',dSupplied:'true'});saveModal();await saved();assert(state.customerDebts.length===1&&state.customerDebts[0].amount===0&&state.customerDebts[0].supplied===true,'zero debt create and supplied state');
 const debtAmountCell=element('[data-customer-bulk-id="'+state.customerDebts[0].id+'"] .customer-debt-amount');assert(debtAmountCell.classList.contains('is-supplied'),'supplied debt amount marker');
 openDebtModal(state.customerDebts[0].id);fill({dPaid:'true',dInvoice:'true'});saveModal();await saved();assert(!!state.customerDebts[0].closedAt,'debt closed state');
 switchView('service');click('open-service-modal');fill({svcName:'Service customer',svcDesc:'Repair',svcOpened:'2026-08-27'});saveModal();await saved();assert(state.serviceCalls.length===1,'service create');
 const flag=element('[data-action="toggle-service-flag"]');flag.click();await saved();assert(state.serviceCalls[0].followUp,'service flag');
 switchView('warehouse');click('open-inventory-item-modal-2');fill({invName:'Chair',invCategory:'Furniture',invOpening:'10'});saveModal();await saved();const item=state.inventoryItems[0];assert(inventoryStats(item.id).onHand===10,'inventory opening');
 openInventoryEventModal(item.id,'order');fill({evQty:'4'});saveModal();await saved();assert(inventoryStats(item.id).incoming===4,'incoming inventory');
 const incoming=state.inventoryEvents.find(x=>x.type==='order');receiveIncoming(incoming.id);fill({receiveQty:'2'});saveModal();await saved();assert(inventoryStats(item.id).onHand===12&&inventoryStats(item.id).incoming===2,'partial receipt');
 openInventoryEventModal(item.id,'reserve');fill({evQty:'3',evCustomer:'Reserved customer'});saveModal();await saved();assert(inventoryStats(item.id).available===9,'reservation');
 setWarehouseTab('orders');click('open-warehouse-order-modal');fill({whName:'Warehouse customer',whDetails:'Bed'});saveModal();await saved();assert(state.warehouseOrders.length===1,'warehouse order');
 click('set-warehouse-order-status-2');await saved();assert(state.warehouseOrders[0].status==='ordered','warehouse status');
 switchView('checks');click('open-check-modal');fill({fName:'Shared customer'});const row=element('#checkSeriesRows .check-series-row');row.querySelector('[data-series-field="amount"]').value='110';
 for(const [part,value]of [['day','10'],['month','09'],['year','26']]){const e=row.querySelector('[data-date-part="'+part+'"]');e.value=value;e.dispatchEvent(new Event('input',{bubbles:true}));e.dispatchEvent(new FocusEvent('blur'))}saveModal();await saved();assert(state.checks.length===1,'shared check create');
 switchView('notes');click('add-sticky-note');const note=element('textarea');note.value='Workflow note';note.dispatchEvent(new Event('input',{bubbles:true}));await saved();assert(state.notes[0].content==='Workflow note','sticky note input');
 const backup=prepareState();state.notes=[];switchView('settings');click('begin-json-restore');const input=element('input[type="file"]'),dt=new DataTransfer();dt.items.add(new File([JSON.stringify(backup)],'workflow.json',{type:'application/json'}));input.files=dt.files;input.dispatchEvent(new Event('change',{bubbles:true}));await saved();click('apply-json-restore');await saved();assert(state.notes[0].content==='Workflow note'&&state.checks.length===1,'restore preserves shared checks');
 switchView('supplier');openTransactionModal(state.transactions[0].id);click('delete-transaction');await saved();assert(state.transactions.length===0,'delete transaction');
 assert(!!loadLocal(),'actual browser snapshot');
 return {suppliers:true,transactions:true,debts:true,service:true,inventory:true,partialReceipt:true,reservation:true,warehouse:true,checks:true,notes:true,backupRestore:true,delete:true};
"""
}
for label,flow in flows.items():
    with BrowserSession(ROOT/f'netunim-{label}/site',label+'-workflow') as browser:
        result=browser.evaluate('(async()=>{'+helpers+flow+'})()')
        print(label,json.dumps(result))
        assert result and all(result.values())
        assert not browser.drain_serious_errors()
