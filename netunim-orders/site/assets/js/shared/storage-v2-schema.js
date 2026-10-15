// Checks and bank events belong exclusively to the Shared Checks journal.
export const STORAGE_SCHEMAS=Object.freeze({
  orders:Object.freeze({mainProjection:2,collections:Object.freeze(['suppliers','transactions','customerDebts','customerOrders','serviceCalls','inventoryItems','inventoryEvents','warehouseOrders','notes']),fields:Object.freeze(['inventoryCategoryOrder'])}),
  kupa:Object.freeze({mainProjection:2,collections:Object.freeze(['cash','rights','notes','credits','expenses','cards']),fields:Object.freeze(['rightsLastCalculatedDate','cashflowSettings','bank','creditSync'])}),
});
export const SHARED_CHECKS_STORAGE_SCHEMA=Object.freeze({collections:Object.freeze(['checks']),fields:Object.freeze(['bankEvents'])});
