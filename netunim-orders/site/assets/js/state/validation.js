

export function validOrderCloudState(d){return !!(d&&typeof d==='object'&&!Array.isArray(d)&&!Object.prototype.hasOwnProperty.call(d,'checks')&&['suppliers','transactions','customerDebts','customerOrders','serviceCalls','inventoryItems','inventoryCategoryOrder','inventoryEvents','warehouseOrders','notes'].every(k=>Array.isArray(d[k])))}

export function restoreJsonRequiredArrays(){return ['suppliers','transactions','customerDebts','customerOrders','serviceCalls','inventoryItems','inventoryEvents','warehouseOrders','checks']}

export function restoreJsonCounts(x){return {suppliers:x.suppliers?.length||0,transactions:x.transactions?.length||0,customerDebts:x.customerDebts?.length||0,customerOrders:x.customerOrders?.length||0,serviceCalls:x.serviceCalls?.length||0,inventoryItems:x.inventoryItems?.length||0,inventoryEvents:x.inventoryEvents?.length||0,warehouseOrders:x.warehouseOrders?.length||0,checks:x.checks?.length||0,notes:x.notes?.length||0}}
