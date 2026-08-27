"""DOM injection and real CSP integration; business fields are never executable."""
from browser_harness import BrowserSession, ROOT

for label in ('kupa','orders'):
    with BrowserSession(ROOT/f'netunim-{label}/site', label+'-security') as browser:
        common = r"""
 const attack=`'\"><span data-injection-probe=\"yes\">injected</span><input value=\"`;
 const clean=()=>{
   if(document.querySelector('[data-injection-probe]'))throw new Error('Business data became markup');
   for(const el of document.querySelectorAll('*'))for(const attr of el.attributes)if(/^on/i.test(attr.name))throw new Error('Executable event attribute: '+attr.name);
 };
 window.confirm=()=>true;
 """
        flow = r"""
 state=normalizeState({version:4,checks:[],credits:[],cash:[],expenses:[],cards:[]});
 state.cash=[{id:attack,date:'2026-08-27',description:attack,type:'הכנסה',amount:10,note:attack}];
 setPage('cash');clean();openCashModal(attack);clean();closeModal(true);
 state.checks=[{id:attack,name:attack,amount:10,dueDate:'2026-09-01',status:'בקופה',note:attack}];
 setPage('checks');clean();openCheckModal(attack);clean();closeModal(true);
 state.expenses=[{id:attack,description:attack,amount:10,date:'2026-08-27',type:attack,account:attack,active:true}];
 setPage('bank');clean();openExpenseModal(attack);clean();
 modal(attack,'<p>trusted body</p>',attack,()=>{});clean();
 return true;
 """ if label=='kupa' else r"""
 state.suppliers=[{id:attack,name:attack,active:true,sortOrder:0}];
 state.transactions=[{id:attack,supplierId:attack,sequence:1,action:attack,note:attack,supplyInfo:attack,debit:10,credit:0}];
 currentSupplierId=attack;switchView('supplier');clean();openTransactionModal(attack);clean();closeModal();
 state.customerDebts=[{id:attack,customerName:attack,phone:attack,orderNumber:attack,amount:10,note:attack}];
 switchView('customers');clean();openDebtModal(attack);clean();closeModal();
 state.serviceCalls=[{id:attack,customerName:attack,description:attack,address:attack,openedAt:'2026-08-27',note:attack}];
 switchView('service');clean();openServiceModal(attack);clean();closeModal();
 state.inventoryItems=[{id:attack,name:attack,category:attack,active:true,note:attack}];
 state.inventoryEvents=[];state.inventoryCategoryOrder=[attack];switchView('warehouse');clean();openInventoryItemModal(attack);clean();closeModal();
 state.warehouseOrders=[{id:attack,customerName:attack,details:attack,status:'to_order',note:attack}];
 setWarehouseTab('orders');clean();openWarehouseOrderModal(attack);clean();closeModal();
 state.notes=[{id:attack,content:attack,createdAt:'2026-08-27'}];switchView('notes');clean();
 modal(attack,'<p>trusted body</p>','');clean();return true;
 """
        assert browser.evaluate('(async()=>{'+common+flow+'})()')
        assert not browser.drain_serious_errors()
        print('PASS',label,'escaped business fields, selectors, modal titles and executable attributes')
