import {inventoryCategoryNamesData, orderedInventoryCategoryNamesData, itemEventsData, inventoryStatsData, inventoryTotalsData, inventoryCategoryGroupsData, inventoryGroupStatsData, inventoryLocationTextData, inventoryItemLocationsData, inventoryEventViewData} from './model.js';

// Dependencies are supplied by the composition root; this module has no startup side effects.
export function createDomainsInventorySelectors({model, warehouseUi, renderWarehouse}){
function inventoryCategoryNames(...args){return inventoryCategoryNamesData(model.state,...args)}

function orderedInventoryCategoryNames(...args){return orderedInventoryCategoryNamesData(model.state,...args)}

function itemEvents(...args){return itemEventsData(model.state,...args)}

function inventoryStats(...args){return inventoryStatsData(model.state,...args)}

function inventoryTotals(...args){return inventoryTotalsData(model.state,...args)}

function inventoryCategoryGroups(...args){return inventoryCategoryGroupsData(model.state,...args)}

function inventoryGroupStats(...args){return inventoryGroupStatsData(model.state,...args)}

function toggleInventoryGroup(kind,encoded){const key=decodeURIComponent(encoded),set=kind==='location'?warehouseUi.inventoryLocationOpen:warehouseUi.inventoryCategoryOpen;if(set.has(key))set.delete(key);else set.add(key);renderWarehouse()}

function inventoryLocationText(...args){return inventoryLocationTextData(model.state,...args)}

function inventoryItemLocations(...args){return inventoryItemLocationsData(model.state,...args)}

function inventoryEventView(...args){return inventoryEventViewData(model.state,...args)}

return { inventoryCategoryNames, orderedInventoryCategoryNames, itemEvents, inventoryStats, inventoryTotals, inventoryCategoryGroups, inventoryGroupStats, toggleInventoryGroup, inventoryLocationText, inventoryItemLocations, inventoryEventView };
}
