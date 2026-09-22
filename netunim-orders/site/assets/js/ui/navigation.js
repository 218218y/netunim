import {beginMeasure} from '../shared/runtime-performance.js';
import {createCleanViewCache} from '../shared/clean-view-cache.js';


// Dependencies are supplied by the composition root; this module has no startup side effects.
export function createUiNavigation({ui, model, supplierUi, customerUi, serviceUi, warehouseUi, notesUi, renderKupa, renderChecks, renderSummary, renderSupplier, renderCustomers, renderService, renderWarehouse, renderNotes, renderCalendar, renderSettings, refreshAlertCenter=()=>{},dataRevision=()=>''}){
let alertTargetTimer=null;
const setKey=value=>[...(value||[])].map(String).sort().join(',');
function viewStateKey(view){
  if(view==='supplier')return JSON.stringify([supplierUi.currentSupplierId,supplierUi.filterMode,supplierUi.searchText,supplierUi.supplierYearView,supplierUi.supplierBulkMode,setKey(supplierUi.supplierBulkSelected),supplierUi.supplierBulkAnchorId,supplierUi.supplierMoveTargetId]);
  if(view==='customers'||view==='customer-orders')return JSON.stringify([customerUi.customerTab,customerUi.customerFilter,customerUi.customerSearch,customerUi.customerBulkMode,setKey(customerUi.customerBulkSelected),customerUi.customerBulkAnchorId,customerUi.resultPages]);
  if(view==='service')return JSON.stringify([serviceUi.serviceFilter,serviceUi.serviceSearch,serviceUi.serviceBulkMode,setKey(serviceUi.serviceBulkSelected),serviceUi.serviceBulkAnchorId,serviceUi.resultPages]);
  if(view==='warehouse')return JSON.stringify([warehouseUi.warehouseTab,warehouseUi.inventoryLocation,warehouseUi.inventoryGrouping,warehouseUi.inventoryFilter,warehouseUi.inventoryHistoryItem,warehouseUi.warehouseSearch,warehouseUi.warehouseBulkMode,setKey(warehouseUi.warehouseBulkSelected),warehouseUi.warehouseBulkAnchorId,warehouseUi.warehouseOrdersPickedOpen,setKey(warehouseUi.inventoryCategoryOpen),setKey(warehouseUi.inventoryLocationOpen),warehouseUi.resultPages]);
  if(view==='checks')return JSON.stringify([ui.checkTab,ui.checkAccount,ui.checkYear,ui.checkSearchValue,ui.checksBulkMode,setKey(ui.checksBulkSelected),ui.checksBulkAnchorId]);
  if(view==='summary')return String(ui.summarySupplierYearView||'');
  return '';
}
const cacheableView=view=>['supplier','customers','customer-orders','service','warehouse','checks','summary'].includes(view);
const viewCache=createCleanViewCache({container:()=>document.getElementById('main'),dataRevision,viewStateKey,cacheable:cacheableView,maxEntries:3});
function syncActiveNav(){document.querySelectorAll('[data-view]').forEach(b=>b.classList.toggle('active',b.dataset.view===ui.currentView))}

function render({supplierScrollMode='auto'}={}){const done=beginMeasure(`orders:render:${ui.currentView}`);try{syncActiveNav();if(ui.currentView==='dashboard')renderDashboard();else if(ui.currentView==='supplier')renderSupplier({scrollMode:supplierScrollMode});else if(ui.currentView==='customers'||ui.currentView==='customer-orders')renderCustomers();else if(ui.currentView==='service')renderService();else if(ui.currentView==='kupa')renderKupa();else if(ui.currentView==='checks')renderChecks();else if(ui.currentView==='warehouse')renderWarehouse();else if(ui.currentView==='summary')renderSummary();else if(ui.currentView==='notes')renderNotes();else if(ui.currentView==='calendar')renderCalendar();else renderSettings();viewCache.markRendered(ui.currentView);refreshAlertCenter()}finally{done()}}

function renderDashboard(){ui.currentView='supplier';syncActiveNav();renderSupplier({scrollMode:'end'})}

function prepareView(view){ui.currentView=view;supplierUi.supplierBulkMode=false;supplierUi.supplierMoveTargetId=null;supplierUi.supplierBulkSelected.clear();supplierUi.supplierBulkAnchorId=null;customerUi.customerBulkMode=false;customerUi.customerBulkSelected.clear();customerUi.customerBulkAnchorId=null;serviceUi.serviceBulkMode=false;serviceUi.serviceBulkSelected.clear();serviceUi.serviceBulkAnchorId=null;warehouseUi.warehouseBulkMode=false;warehouseUi.warehouseBulkSelected.clear();warehouseUi.warehouseBulkAnchorId=null;notesUi.notesBulkMode=false;notesUi.notesBulkSelected.clear();notesUi.notesBulkAnchorId=null;if(ui.currentView==='customers')customerUi.customerTab='debts';else if(ui.currentView==='customer-orders')customerUi.customerTab='orders';if(ui.currentView==='supplier'){if(!supplierUi.currentSupplierId)supplierUi.currentSupplierId=model.state.suppliers[0]?.id;supplierUi.supplierYearView='current'}supplierUi.searchText=''}

function setCustomerRoute(tab){ui.currentView=tab==='orders'?'customer-orders':'customers';syncActiveNav()}

function switchView(view){prepareView(view);if(viewCache.activate(view)){syncActiveNav();refreshAlertCenter();return}render()}

function revealAlertTarget(selector){
  requestAnimationFrame(()=>{
    const target=document.querySelector(selector);
    if(!target)return;
    target.scrollIntoView?.({block:'center',inline:'nearest',behavior:'smooth'});
    target.classList.add('global-search-target');
    if(alertTargetTimer)clearTimeout(alertTargetTimer);
    alertTargetTimer=setTimeout(()=>{target.classList.remove('global-search-target');alertTargetTimer=null},2600);
  });
}

function openKupaChecks(checkId='',account='עסקי'){
  prepareView('kupa');
  ui.kupaSubView='checks';
  ui.checkTab='open';
  ui.checkAccount=account==='ביתי'?'ביתי':'עסקי';
  ui.checkYear='all';
  ui.checkSearchValue='';
  render();
  if(checkId)revealAlertTarget(`[data-check-id="${CSS.escape(String(checkId))}"]`);
}

function openKupaBank(account='עסקי'){
  prepareView('kupa');
  ui.kupaSubView='bank';
  ui.bankAccountView=account==='ביתי'||account==='home'?'home':'business';
  render();
  revealAlertTarget('.bank-transactions-region');
}

function openNotesNote(noteId=''){
  notesUi.notesTab='notes';prepareView('notes');
  render();
  if(noteId)revealAlertTarget(`[data-note-id="${CSS.escape(String(noteId))}"]`);
}

return { render, renderDashboard, prepareView, setCustomerRoute, switchView, openKupaChecks, openKupaBank, openNotesNote };
}
