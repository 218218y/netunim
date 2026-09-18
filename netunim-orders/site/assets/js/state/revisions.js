import {createDomainRevisionLedger} from '../shared/domain-revisions.js';

export const ORDER_VIEW_DOMAINS=Object.freeze({
  supplier:['suppliers','transactions'],
  customers:['customerDebts'],
  'customer-orders':['customerOrders'],
  service:['service'],
  warehouse:['inventory','warehouseOrders'],
  checks:['checks','finance'],
  summary:['suppliers','transactions','customerDebts','checks','finance'],
});

export function createOrderDomainRevisions(session){
  session.domainRevisions??={};
  return createDomainRevisionLedger({target:session.domainRevisions,domains:{
    suppliers:{field:'suppliersRev',select:state=>state?.suppliers||[]},
    transactions:{field:'transactionsRev',select:state=>state?.transactions||[]},
    customerDebts:{field:'customerDebtsRev',select:state=>state?.customerDebts||[]},
    customerOrders:{field:'customerOrdersRev',select:state=>state?.customerOrders||[]},
    service:{field:'serviceRev',select:state=>state?.serviceCalls||[]},
    inventory:{field:'inventoryRev',select:state=>({items:state?.inventoryItems||[],order:state?.inventoryCategoryOrder||[],events:state?.inventoryEvents||[]})},
    warehouseOrders:{field:'warehouseOrdersRev',select:state=>state?.warehouseOrders||[]},
    notes:{field:'notesRev',select:state=>state?.notes||[]},
    checks:{field:'checksRev',select:state=>state?.checks||[]},
    finance:{field:'financeRev'},
  }});
}

export function orderViewRevision(ledger,view){return ledger.stamp(ORDER_VIEW_DOMAINS[view]||[])}
