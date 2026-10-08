import {createInventoryRenderStore} from '../domains/inventory/model.js';
import {createDomainsInventorySelectors} from '../domains/inventory/selectors.js';
import {createDomainsInventoryOrder} from '../domains/inventory/order.js';
import {createDomainsInventoryView} from '../domains/inventory/view.js';
import {createDomainsWarehouseBulk} from '../domains/warehouse/bulk.js';
import {createDomainsWarehouseView} from '../domains/warehouse/view.js';
import {createDomainsInventoryEditor} from '../domains/inventory/editor.js';
import {createDomainsWarehouseEditor} from '../domains/warehouse/editor.js';
import {createWarehouseActionPorts} from '../domains/warehouse/action-ports.js';
import {createWarehouseActions} from '../ui/action-packs/warehouse.js';

// Inventory calculations are available to Settings before the shell is ready.
// UI controllers are constructed together only after their concrete ports exist.
export function createOrdersWarehouseRuntime({model,warehouseUi,ui,inventoryRevision}={}){
  if(!model||!warehouseUi||!ui||typeof inventoryRevision!=='function')throw new TypeError('warehouse_context_required');
  let bound=null;

  function ready(){
    if(!bound)throw new Error('warehouse_ui_not_bound');
    return bound;
  }
  function renderWarehouse(...args){return ready().view.renderWarehouse(...args)}

  const selectors=createDomainsInventorySelectors({model,warehouseUi,renderWarehouse});
  const renderStore=createInventoryRenderStore({state:()=>model.state,revision:inventoryRevision});

  function bindUi({uiLayout,uiModal,uiStatus,storagePersistence,uiDateEditor,uiSettings}={}){
    if(bound)throw new Error('warehouse_ui_already_bound');
    for(const [name,port,methods] of [
      ['layout',uiLayout,['mountViewLayout']],
      ['modal',uiModal,['modal','closeModal','confirmDialog']],
      ['status',uiStatus,['toast']],
      ['persistence',storagePersistence,['scheduleSave']],
      ['date',uiDateEditor,['dateEditorMarkup']],
      ['settings',uiSettings,['renderSettings']],
    ])for(const method of methods)if(typeof port?.[method]!=='function')throw new TypeError(`warehouse_${name}_${method}_required`);

    const saveInventory=(message,options={})=>storagePersistence.scheduleSave(message,{...options,domains:['inventory']});
    const saveWarehouseBulk=(message,options={})=>storagePersistence.scheduleSave(message,{...options,domains:['inventory','warehouseOrders']});
    const saveWarehouseOrder=(message,options={})=>storagePersistence.scheduleSave(message,{...options,domains:['warehouseOrders']});

    const order=createDomainsInventoryOrder({
      model,warehouseUi,ui,
      modal:(...args)=>uiModal.modal(...args),
      orderedInventoryCategoryNames:selectors.orderedInventoryCategoryNames,
      scheduleSave:saveInventory,
      closeModal:(...args)=>uiModal.closeModal(...args),
      inventoryCategoryNames:selectors.inventoryCategoryNames,
      renderWarehouse,
      renderSettings:(...args)=>uiSettings.renderSettings(...args),
    });
    const inventoryView=createDomainsInventoryView({
      warehouseUi,model,
      orderedInventoryCategoryNames:selectors.orderedInventoryCategoryNames,
      inventoryStats:selectors.inventoryStats,
      inventoryCategoryGroups:selectors.inventoryCategoryGroups,
    });
    const bulk=createDomainsWarehouseBulk({
      warehouseUi,model,renderWarehouse,
      toast:(...args)=>uiStatus.toast(...args),
      scheduleSave:saveWarehouseBulk,
      confirmDialog:(...args)=>uiModal.confirmDialog(...args),
    });
    const view=createDomainsWarehouseView({
      runInventory:renderStore.run,warehouseUi,model,
      mountViewLayout:(...args)=>uiLayout.mountViewLayout(...args),
      inventoryTotals:selectors.inventoryTotals,
      inventoryStockViewData:inventoryView.inventoryStockViewData,
      renderStockGrid:inventoryView.renderStockGrid,
      renderWarehouseLocations:inventoryView.renderWarehouseLocations,
      warehouseBulkControls:bulk.warehouseBulkControls,
      syncWarehouseBulkUi:bulk.syncWarehouseBulkUi,
      inventoryEventView:selectors.inventoryEventView,
    });
    const inventoryEditor=createDomainsInventoryEditor({
      dateEditorMarkup:(...args)=>uiDateEditor.dateEditorMarkup(...args),model,
      modal:(...args)=>uiModal.modal(...args),
      inventoryStats:selectors.inventoryStats,
      inventoryLocationOptions:inventoryView.inventoryLocationOptions,
      inventoryCategoryDatalist:inventoryView.inventoryCategoryDatalist,
      toast:(...args)=>uiStatus.toast(...args),
      scheduleSave:saveInventory,
      closeModal:(...args)=>uiModal.closeModal(...args),
      ensureInventoryCategoryOrder:order.ensureInventoryCategoryOrder,
      renderWarehouse,
      confirmDialog:(...args)=>uiModal.confirmDialog(...args),
    });
    const editor=createDomainsWarehouseEditor({
      model,modal:(...args)=>uiModal.modal(...args),
      toast:(...args)=>uiStatus.toast(...args),
      scheduleSave:saveWarehouseOrder,
      closeModal:(...args)=>uiModal.closeModal(...args),
      renderWarehouse,
      confirmDialog:(...args)=>uiModal.confirmDialog(...args),
    });
    const actionPorts=createWarehouseActionPorts({inventoryOrder:order,inventorySelectors:selectors,bulk,view,inventoryEditor,editor});
    const actions=createWarehouseActions({domainsWarehouseView:view,uiModal,warehousePorts:actionPorts,warehouseUi});
    bound={view,inventoryEditor,actions};
  }

  return {
    orderedInventoryCategoryNames:selectors.orderedInventoryCategoryNames,
    renderWarehouse,
    openInventoryItemModal:(...args)=>ready().inventoryEditor.openInventoryItemModal(...args),
    bindUi,
    assertReady:()=>{ready();return true},
    get actions(){return ready().actions},
  };
}
