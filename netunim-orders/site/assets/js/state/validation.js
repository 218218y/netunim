
import {assertEntityCollections} from '../shared/data-invariants.js';

export const ORDER_ENTITY_COLLECTIONS=Object.freeze(['suppliers','transactions','customerDebts','customerOrders','serviceCalls','notes','inventoryItems','inventoryEvents','warehouseOrders']);

export function assertOrderEntityInvariants(d,{includeChecks=false,required=false}={}){
  assertEntityCollections(d,includeChecks?[...ORDER_ENTITY_COLLECTIONS,'checks']:ORDER_ENTITY_COLLECTIONS,{required});
  return d;
}

export function validOrderCloudState(d){try{return !!(d&&typeof d==='object'&&!Array.isArray(d)&&!Object.prototype.hasOwnProperty.call(d,'checks')&&['suppliers','transactions','customerDebts','customerOrders','serviceCalls','inventoryItems','inventoryCategoryOrder','inventoryEvents','warehouseOrders','notes'].every(k=>Array.isArray(d[k]))&&assertOrderEntityInvariants(d,{required:true}))}catch{return false}}

export function assertValidOrderCloudState(d,context='Orders cloud state'){if(!validOrderCloudState(d))throw new Error(`${context}: invalid entity IDs or document shape`);return d}

export function restoreJsonRequiredArrays(){return ['suppliers','transactions','customerDebts','customerOrders','serviceCalls','inventoryItems','inventoryEvents','warehouseOrders','checks']}

export function restoreJsonCounts(x){return {suppliers:x.suppliers?.length||0,transactions:x.transactions?.length||0,customerDebts:x.customerDebts?.length||0,customerOrders:x.customerOrders?.length||0,serviceCalls:x.serviceCalls?.length||0,inventoryItems:x.inventoryItems?.length||0,inventoryEvents:x.inventoryEvents?.length||0,warehouseOrders:x.warehouseOrders?.length||0,checks:x.checks?.length||0,notes:x.notes?.length||0}}
