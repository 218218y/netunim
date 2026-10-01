// Main Storage V2 schemas. Checks live exclusively in Shared Checks V2.
export const STORAGE_SCHEMAS=Object.freeze({
  orders:{collections:['suppliers','transactions','customerDebts','customerOrders','serviceCalls','inventoryItems','inventoryEvents','warehouseOrders','notes'],fields:['inventoryCategoryOrder']},
  kupa:{collections:['cash','rights','notes','credits','expenses','cards'],fields:['rightsLastCalculatedDate','cashflowSettings','bank','creditSync']},
});
