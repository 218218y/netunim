

// Dependencies are supplied by the composition root; this module has no startup side effects.
export function createUiNavigation({ui, model, supplierUi, customerUi, serviceUi, warehouseUi, notesUi, renderChecks, renderSummary, renderSupplier, renderCustomers, renderService, renderWarehouse, renderNotes, renderCalendar, renderSettings}){
function render({supplierScrollMode='auto'}={}){document.querySelectorAll('[data-view]').forEach(b=>b.classList.toggle('active',b.dataset.view===ui.currentView));if(ui.currentView==='dashboard')renderDashboard();else if(ui.currentView==='supplier')renderSupplier({scrollMode:supplierScrollMode});else if(ui.currentView==='customers')renderCustomers();else if(ui.currentView==='service')renderService();else if(ui.currentView==='checks')renderChecks();else if(ui.currentView==='warehouse')renderWarehouse();else if(ui.currentView==='summary')renderSummary();else if(ui.currentView==='notes')renderNotes();else if(ui.currentView==='calendar')renderCalendar();else renderSettings()}

function renderDashboard(){ui.currentView='supplier';renderSupplier({scrollMode:'end'})}

function prepareView(view){ui.currentView=view;supplierUi.supplierBulkMode=false;supplierUi.supplierMoveTargetId=null;supplierUi.supplierBulkSelected.clear();customerUi.customerBulkMode=false;customerUi.customerBulkSelected.clear();serviceUi.serviceBulkMode=false;serviceUi.serviceBulkSelected.clear();warehouseUi.warehouseBulkMode=false;warehouseUi.warehouseBulkSelected.clear();notesUi.notesBulkMode=false;notesUi.notesBulkSelected.clear();if(ui.currentView==='supplier'){if(!supplierUi.currentSupplierId)supplierUi.currentSupplierId=model.state.suppliers[0]?.id;supplierUi.supplierYearView='current'}supplierUi.searchText=''}

function switchView(view){prepareView(view);render()}

return { render, renderDashboard, prepareView, switchView };
}
