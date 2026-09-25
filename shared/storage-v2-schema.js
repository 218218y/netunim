// Main Storage V2 schemas. Checks remain transitional checkpoint data until
// the dedicated Main projection migration has removed them durably.
export const STORAGE_SCHEMAS=Object.freeze({
  orders:{collections:['suppliers','transactions','customerDebts','customerOrders','serviceCalls','inventoryItems','inventoryEvents','warehouseOrders','notes'],legacyCollections:['suppliers','transactions','customerDebts','customerOrders','serviceCalls','inventoryItems','inventoryEvents','warehouseOrders','notes','checks'],fields:['inventoryCategoryOrder']},
  kupa:{collections:['cash','rights','notes','credits','expenses','cards'],legacyCollections:['cash','rights','notes','checks','credits','expenses','cards'],fields:['rightsLastCalculatedDate','cashflowSettings','bank','creditSync']},
});
