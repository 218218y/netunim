
import {assertEntityCollections} from '../shared/data-invariants.js';
import {validateCustomerDebtProgress} from '../shared/customer-debt-progress.js';

export const ORDER_ENTITY_COLLECTIONS=Object.freeze(['suppliers','transactions','customerDebts','customerOrders','serviceCalls','notes','inventoryItems','inventoryEvents','warehouseOrders']);

/** @param {unknown} d @param {{includeChecks?:boolean,required?:boolean}} [options] @returns {Record<string,unknown>} */
export function assertOrderEntityInvariants(d,{includeChecks=false,required=false}={}){
  const state=assertEntityCollections(d,includeChecks?[...ORDER_ENTITY_COLLECTIONS,'checks']:ORDER_ENTITY_COLLECTIONS,{required});
  if(state.notesSheet!==undefined){
    if(!state.notesSheet||typeof state.notesSheet!=='object'||Array.isArray(state.notesSheet))throw new Error('Invalid notes workbook');
    assertEntityCollections(state,['notesSheet.sheets','notesSheet.columns','notesSheet.rows'],{required:true});
    // The three required collections have just passed the shared row guard.
    const book=/** @type {{sheets:Record<string,unknown>[],columns:Record<string,unknown>[],rows:Record<string,unknown>[]}} */ (state.notesSheet);
    const ids=new Set(book.sheets.map(sheet=>sheet.id));
    if(!ids.size||book.sheets.some(sheet=>typeof sheet.name!=='string'||!sheet.name.trim())||[...book.columns,...book.rows].some(row=>!ids.has(row.sheetId)))throw new Error('Invalid notes workbook parent');
  }
  if(Array.isArray(state.customerDebts))/** @type {Record<string,unknown>[]} */ (state.customerDebts).forEach((debt,index)=>validateCustomerDebtProgress(debt,`customerDebts[${index}]`));
  return state;
}

/** @param {unknown} d @returns {d is import('../../../../../shared/orders-document-contracts.js').OrderCloudState} */
export function validOrderCloudState(d){try{
  if(!d||typeof d!=='object'||Array.isArray(d)||Object.prototype.hasOwnProperty.call(d,'checks'))return false;
  const state=/** @type {Record<string,unknown>} */ (d);
  return !!(['suppliers','transactions','customerDebts','customerOrders','serviceCalls','inventoryItems','inventoryCategoryOrder','inventoryEvents','warehouseOrders','notes'].every(k=>Array.isArray(state[k]))&&assertOrderEntityInvariants(state,{required:true}));
}catch{return false}}

/** @param {unknown} d @param {string} [context] @returns {import('../../../../../shared/orders-document-contracts.js').OrderCloudState} */
export function assertValidOrderCloudState(d,context='Orders cloud state'){if(!validOrderCloudState(d))throw new Error(`${context}: invalid entity IDs or document shape`);return d}

export function restoreJsonRequiredArrays(){return ['suppliers','transactions','customerDebts','customerOrders','serviceCalls','inventoryItems','inventoryEvents','warehouseOrders','checks']}

/** @param {import('../../../../../shared/orders-document-contracts.js').RestoreCountInput} x */
export function restoreJsonCounts(x){return {suppliers:x.suppliers?.length||0,transactions:x.transactions?.length||0,customerDebts:x.customerDebts?.length||0,customerOrders:x.customerOrders?.length||0,serviceCalls:x.serviceCalls?.length||0,inventoryItems:x.inventoryItems?.length||0,inventoryEvents:x.inventoryEvents?.length||0,warehouseOrders:x.warehouseOrders?.length||0,checks:x.checks?.length||0,notes:x.notes?.length||0,sheets:x.notesSheet?.sheets?.length||0,sheetRows:x.notesSheet?.rows?.length||0}}
