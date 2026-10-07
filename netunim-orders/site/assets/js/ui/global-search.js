import {createSearchFragmentIndex} from '../shared/search-fragments.js';
import {createGlobalDocumentSearch} from '../shared/global-document-search.js';
import {money} from '../core/money.js';
import {buildOrderSearchFragment,ORDER_SEARCH_FRAGMENTS,searchGlobalEntries} from '../domains/search/model.js';
import {checkIsClosedStatus} from '../shared/shared-checks-contract.js';
import {customerDebtProgressData} from '../shared/customer-debt-progress.js';

// Orders owns only its business-data index and navigation. The search shell,
// document providers, preview, content modes and keyboard behavior are shared
// with Kupa in shared/global-document-search.js.
export function createUiGlobalSearch({documentBridge=null,searchRevision,model,ui,notesUi={},supplierUi,customerUi,serviceUi,warehouseUi,prepareView,render,openInventoryItemModal,confirmDialog=null}){
  let highlightTimer=null;
  const indexedEntries=createSearchFragmentIndex({
    fragments:Object.keys(ORDER_SEARCH_FRAGMENTS),
    revision:name=>name==='notes'&&model.state.notesSheet?null:searchRevision?.(ORDER_SEARCH_FRAGMENTS[name],name),
    build:name=>buildOrderSearchFragment(model.state,name),
  });

  function siteResultMeta(item){
    const parts=[...(item?.meta||[])];
    if(item?.amount!==undefined&&item?.amount!==null&&Number.isFinite(Number(item.amount)))parts.unshift(money(item.amount));
    return parts.filter(Boolean);
  }
  function reveal(attribute,id){
    requestAnimationFrame(()=>{
      const target=[...document.querySelectorAll(`[${attribute}]`)].find(el=>el.getAttribute(attribute)===String(id));
      if(!target)return;
      target.scrollIntoView({block:'center',inline:'nearest',behavior:'smooth'});
      target.classList.add('global-search-target');
      if(highlightTimer)clearTimeout(highlightTimer);
      highlightTimer=setTimeout(()=>target.classList.remove('global-search-target'),2600);
    });
  }
  function navigateSupplier(item){prepareView('supplier');supplierUi.currentSupplierId=item.kind==='supplier'?item.id:item.parentId;supplierUi.filterMode='all';supplierUi.searchText='';supplierUi.supplierYearView=item.kind==='supplier-transaction'?'all':'current';render({supplierScrollMode:item.kind==='supplier-transaction'?'start':'end'});if(item.kind==='supplier-transaction')reveal('data-tx-id',item.id)}
  function navigateCustomer(item){customerUi.resultTarget=item.id;const debts=item.kind==='customer-debt';prepareView(debts?'customers':'customer-orders');customerUi.customerTab=debts?'debts':'orders';customerUi.customerSearch='';if(debts){const debt=model.state.customerDebts.find(x=>x.id===item.id),p=customerDebtProgressData(debt||{});customerUi.customerFilter=p.paymentComplete?(p.invoiceComplete?'closed':'invoice'):'all'}else customerUi.customerFilter='all';render();reveal('data-customer-bulk-id',item.id)}
  function navigateService(item){serviceUi.resultTarget=item.id;prepareView('service');serviceUi.serviceSearch='';const call=model.state.serviceCalls.find(x=>x.id===item.id);serviceUi.serviceFilter=call?.closed?'closed':'all';render();reveal('data-service-bulk-id',item.id)}
  function navigateCheck(item){const check=model.state.checks.find(row=>String(row.id)===String(item.id));ui.kupaSubView='checks';prepareView('kupa');ui.checkTab=checkIsClosedStatus(check?.status)?'closed':'open';ui.checkAccount=item.account==='ביתי'?'ביתי':'עסקי';ui.checkYear='all';ui.checkSearchValue='';render();reveal('data-check-id',item.id)}
  function navigateWarehouse(item){warehouseUi.resultTarget=item.id;prepareView('warehouse');warehouseUi.warehouseSearch='';if(item.kind==='inventory-item'){const inventoryItem=model.state.inventoryItems.find(x=>x.id===item.id);if(inventoryItem?.active===false){warehouseUi.warehouseTab='history';render();openInventoryItemModal(item.id);return}warehouseUi.warehouseTab='stock';warehouseUi.inventoryLocation='';warehouseUi.inventoryFilter='';render();reveal('data-stock-bulk-id',item.id);return}if(item.kind==='warehouse-order'){warehouseUi.warehouseTab='orders';warehouseUi.warehouseOrdersPickedOpen=model.state.warehouseOrders.find(row=>row.id===item.id)?.status==='picked';render();reveal('data-warehouse-order-id',item.id);return}warehouseUi.warehouseTab='history';render();reveal('data-inventory-event-id',item.id)}
  function navigateNote(item){notesUi.notesTab=item.kind==='sheet-row'?'sheet':'notes';if(item.kind==='sheet-row'){notesUi.notesSheetId=item.sheetId;notesUi.notesSheetSearchValue=''}prepareView('notes');render();reveal(item.kind==='sheet-row'?'data-sheet-row-id':'data-note-id',item.id)}
  function navigateSiteItem(item){if(!item)return false;if(item.group==='suppliers')navigateSupplier(item);else if(item.group==='customers')navigateCustomer(item);else if(item.group==='service')navigateService(item);else if(item.group==='checks')navigateCheck(item);else if(item.group==='warehouse')navigateWarehouse(item);else if(item.group==='notes')navigateNote(item);else return false;return true}

  return createGlobalDocumentSearch({
    documentBridge,
    siteSearch:(raw,options)=>searchGlobalEntries(indexedEntries(),raw,options),
    siteResultMeta,
    navigateSiteItem,
    confirmDialog,
    previewWidthKey:'netunim_orders_document_preview_width_v1',
  });
}
