import {createLazyDeferredSearchUpdater} from '../../shared/search-scheduler.js';
import {markMutationActions} from '../../shared/action-registry.js';

export function createWarehouseActions({domainsWarehouseView,uiModal,warehousePorts,warehouseUi}){
const closeModal=(...args)=>uiModal.closeModal(...args);
const pageWarehouseResults=(...args)=>domainsWarehouseView.pageWarehouseResults(...args);
const {archiveInventoryItem,archiveSelectedInventoryItems,cancelIncoming,confirmReceive,deleteSelectedInventoryEvents,deleteSelectedWarehouseOrders,deleteWarehouseOrder,editInventoryEvent,inventoryCategoryOrderDragStart,inventoryCategoryOrderDrop,moveInventoryCategoryOrder,openInventoryCategoryOrderModal,openInventoryDetails,openInventoryEventModal,openInventoryItemModal,openStockAdjustmentModal,openStockReceive,openStockTransfer,openWarehouseOrderModal,pickupReservation,previewInventoryLocation,previewStockAdjustment,previewStockTransfer,receiveIncoming,releaseReservation,renderWarehouse,saveInventoryCategoryOrder,saveInventoryEvent,saveInventoryItem,saveStockAdjustment,saveStockTransfer,saveWarehouseOrder,setWarehouseOrderStatus,setWarehouseTab,toggleWarehouseBulkMode,toggleWarehouseBulkRow,toggleWarehouseBulkVisible,toggleWarehousePickedOrders}=warehousePorts;
const warehouseSearch=createLazyDeferredSearchUpdater(value=>{warehouseUi.warehouseSearch=value},()=>renderWarehouse({resultsOnly:true}));
const actions={
  'warehouse-results-page':el=>pageWarehouseResults(el.dataset.clickArg0,el.dataset.clickArg1),
  'save-inventory-category-order':(element,event)=>{saveInventoryCategoryOrder()},
  'inventory-category-order-drag-start':(element,event)=>{inventoryCategoryOrderDragStart(event,element.dataset.dragstartArg0,element)},
  'inventory-category-order-drop':(element,event)=>{inventoryCategoryOrderDrop(event,element.dataset.dropArg0)},
  'move-inventory-category-order':(element,event)=>{moveInventoryCategoryOrder(element.dataset.clickArg0,-1)},
  'move-inventory-category-order-2':(element,event)=>{moveInventoryCategoryOrder(element.dataset.clickArg0,1)},
  'toggle-warehouse-bulk-row':(element,event)=>{toggleWarehouseBulkRow(element.dataset.clickArg0,element.checked,!!event?.shiftKey)},
  'open-inventory-event-modal':(element,event)=>{openInventoryEventModal(element.dataset.clickArg0,'order',null,element.dataset.clickArg1)},
  'open-stock-receive':(element,event)=>{openStockReceive(element.dataset.clickArg0,element.dataset.clickArg1)},
  'open-inventory-event-modal-2':(element,event)=>{openInventoryEventModal(element.dataset.clickArg0,'reserve',null,element.dataset.clickArg1)},
  'open-stock-adjustment-modal':(element,event)=>{openStockAdjustmentModal(element.dataset.clickArg0,element.dataset.clickArg1)},
  'open-inventory-item-modal':(element,event)=>{openInventoryItemModal(element.dataset.clickArg0)},
  'toggle-warehouse-bulk-mode':(element,event)=>{toggleWarehouseBulkMode()},
  'toggle-warehouse-bulk-visible':(element,event)=>{toggleWarehouseBulkVisible()},
  'archive-selected-inventory-items':(element,event)=>{archiveSelectedInventoryItems()},
  'delete-selected-warehouse-orders':(element,event)=>{deleteSelectedWarehouseOrders()},
  'delete-selected-inventory-events':(element,event)=>{deleteSelectedInventoryEvents()},
  'toggle-warehouse-picked-orders':(element,event)=>{toggleWarehousePickedOrders()},
  'open-inventory-item-modal-2':(element,event)=>{openInventoryItemModal()},
  'open-warehouse-order-modal':(element,event)=>{openWarehouseOrderModal()},
  'warehouse-search':(element,event)=>{warehouseSearch(element.value,element)},
  'set-warehouse-tab':()=>{const hadStatusFilter=!!warehouseUi.inventoryFilter;warehouseUi.inventoryFilter='';if(warehouseUi.warehouseTab==='stock'){if(hadStatusFilter)renderWarehouse();return}setWarehouseTab('stock')},
  'set-warehouse-tab-4':(element,event)=>{setWarehouseTab('orders')},
  'set-warehouse-tab-6':(element,event)=>{setWarehouseTab('history')},
  'receive-incoming':(element,event)=>{receiveIncoming(element.dataset.clickArg0,element.dataset.clickArg1)},
  'edit-inventory-event':(element,event)=>{editInventoryEvent(element.dataset.clickArg0)},
  'cancel-incoming':(element,event)=>{cancelIncoming(element.dataset.clickArg0)},
  'pickup-reservation':(element,event)=>{pickupReservation(element.dataset.clickArg0)},
  'release-reservation':(element,event)=>{releaseReservation(element.dataset.clickArg0)},
  'set-warehouse-order-status-2':(element,event)=>{setWarehouseOrderStatus(element.dataset.clickArg0,'ordered')},
  'set-warehouse-order-status-3':(element,event)=>{setWarehouseOrderStatus(element.dataset.clickArg0,'arrived')},
  'set-warehouse-order-status-4':(element,event)=>{setWarehouseOrderStatus(element.dataset.clickArg0,'picked')},
  'open-warehouse-order-modal-2':(element,event)=>{openWarehouseOrderModal(element.dataset.clickArg0)},
  'save-inventory-item':(element,event)=>{saveInventoryItem(element.dataset.clickArg0)},
  'archive-inventory-item':(element,event)=>{archiveInventoryItem(element.dataset.clickArg0)},
  'preview-inventory-location':element=>previewInventoryLocation(element.dataset.clickArg0),
  'preview-stock-adjustment':element=>previewStockAdjustment(element.dataset.clickArg0),
  'open-stock-transfer':element=>openStockTransfer(element.dataset.clickArg0,element.dataset.clickArg1),
  'save-stock-transfer':element=>saveStockTransfer(element.dataset.clickArg0),
  'preview-stock-transfer':element=>previewStockTransfer(element.dataset.clickArg0),
  'open-inventory-details':element=>openInventoryDetails(element.dataset.clickArg0),
  'inventory-item-history':element=>{closeModal();setWarehouseTab('history');warehouseUi.inventoryHistoryItem=element.dataset.clickArg0;warehouseUi.warehouseSearch='';renderWarehouse()},
  'inventory-location-filter':element=>{warehouseUi.inventoryLocation=element.value;warehouseUi.warehouseBulkSelected.clear();renderWarehouse()},
  'inventory-grouping':element=>{warehouseUi.inventoryGrouping=element.value;renderWarehouse()},
  'set-warehouse-attention':()=>setWarehouseTab('attention'),
  'warehouse-quick-filter':element=>{warehouseUi.inventoryFilter=element.dataset.clickArg0||'';warehouseUi.inventoryLocation='';warehouseUi.warehouseSearch='';setWarehouseTab(element.dataset.clickArg1||'stock');renderWarehouse()},
  'save-stock-adjustment':(element,event)=>{saveStockAdjustment(element.dataset.clickArg0)},
  'save-inventory-event':(element,event)=>{saveInventoryEvent(element.dataset.clickArg0,element.dataset.clickArg1,element.dataset.clickArg2)},
  'confirm-receive':(element,event)=>{confirmReceive(element.dataset.clickArg0)},
  'save-warehouse-order':(element,event)=>{saveWarehouseOrder(element.dataset.clickArg0)},
  'delete-warehouse-order':(element,event)=>{deleteWarehouseOrder(element.dataset.clickArg0)},
  'open-inventory-category-order-modal':(element,event)=>{openInventoryCategoryOrderModal()},
};
return markMutationActions(actions,{orders:['open-stock-transfer', 'save-stock-transfer', 'save-inventory-category-order', 'inventory-category-order-drag-start', 'inventory-category-order-drop', 'move-inventory-category-order', 'move-inventory-category-order-2', 'open-inventory-event-modal', 'open-stock-receive', 'open-inventory-event-modal-2', 'open-stock-adjustment-modal', 'open-inventory-item-modal', 'archive-selected-inventory-items', 'delete-selected-warehouse-orders', 'delete-selected-inventory-events', 'open-inventory-item-modal-2', 'open-warehouse-order-modal', 'receive-incoming', 'edit-inventory-event', 'cancel-incoming', 'pickup-reservation', 'release-reservation', 'set-warehouse-order-status-2', 'set-warehouse-order-status-3', 'set-warehouse-order-status-4', 'open-warehouse-order-modal-2', 'save-inventory-item', 'archive-inventory-item', 'save-stock-adjustment', 'save-inventory-event', 'confirm-receive', 'save-warehouse-order', 'delete-warehouse-order', 'open-inventory-category-order-modal']});
}
