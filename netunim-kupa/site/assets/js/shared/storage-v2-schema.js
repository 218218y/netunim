// Checks and bank events belong exclusively to the Shared Checks journal.
export const STORAGE_SCHEMAS=Object.freeze({
  orders:{mainProjection:2,collections:['suppliers','transactions','customerDebts','customerOrders','serviceCalls','inventoryItems','inventoryEvents','warehouseOrders','notes'],fields:['inventoryCategoryOrder']},
  kupa:{mainProjection:2,collections:['cash','rights','notes','credits','expenses','cards'],fields:['rightsLastCalculatedDate','cashflowSettings','bank','creditSync']},
});
