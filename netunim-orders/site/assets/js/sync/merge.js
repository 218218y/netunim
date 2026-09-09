import {clone} from '../core/values.js';
import {eq, mergeArray, mergeCustomerDebtArray} from './merge-records.js';

// Dependencies are supplied by the composition root; this module has no startup side effects.
export function createSyncMerge({normalizeState}){
function protectImplicitDeletes(base,local,deleteIds,key='id'){
  const allowed=new Set((Array.isArray(deleteIds)?deleteIds:[]).map(x=>String(x||'').trim()).filter(Boolean));
  const safe=clone(Array.isArray(local)?local:[]),present=new Set(safe.map(x=>String(x?.[key]??'')));
  for(const item of Array.isArray(base)?base:[]){const id=String(item?.[key]??'');if(id&&!present.has(id)&&!allowed.has(id)){safe.push(clone(item));present.add(id)}}
  return safe;
}
function merge3(base,local,remote,{preferLocalConflicts=false,deleteIntents={}}={}){
  const conflicts=[],out=clone(remote||{});out.version=4;
  const scalar=key=>{const b=base?.[key],l=local?.[key],r=remote?.[key];if(!eq(l,b)&&!eq(r,b)&&!eq(l,r)){conflicts.push(key);return undefined}return clone(eq(l,b)?r:l)};
  out.businessName=scalar('businessName');
  out.suppliers=mergeArray(base?.suppliers,protectImplicitDeletes(base?.suppliers,local?.suppliers,deleteIntents.suppliers),remote?.suppliers,'id',conflicts,'supplier',preferLocalConflicts);
  out.transactions=mergeArray(base?.transactions,protectImplicitDeletes(base?.transactions,local?.transactions,deleteIntents.transactions),remote?.transactions,'id',conflicts,'transaction',preferLocalConflicts);
  out.customerDebts=mergeCustomerDebtArray(base?.customerDebts,protectImplicitDeletes(base?.customerDebts,local?.customerDebts,deleteIntents.customerDebts),remote?.customerDebts,conflicts,preferLocalConflicts);
  out.customerOrders=mergeArray(base?.customerOrders,protectImplicitDeletes(base?.customerOrders,local?.customerOrders,deleteIntents.customerOrders),remote?.customerOrders,'id',conflicts,'customerOrder',preferLocalConflicts);
  out.serviceCalls=mergeArray(base?.serviceCalls,protectImplicitDeletes(base?.serviceCalls,local?.serviceCalls,deleteIntents.serviceCalls),remote?.serviceCalls,'id',conflicts,'serviceCall',preferLocalConflicts);
  out.notes=mergeArray(base?.notes,protectImplicitDeletes(base?.notes,local?.notes,deleteIntents.notes),remote?.notes,'id',conflicts,'note',preferLocalConflicts);
  /* הצ'קים נשמרים כאן כעותק מקומי בלבד. מקור האמת וה־conflict resolution שלהם הוא מסמך הצ'קים המשותף. */
  out.checks=clone(local?.checks||remote?.checks||base?.checks||[]);
  out.inventoryItems=mergeArray(base?.inventoryItems,protectImplicitDeletes(base?.inventoryItems,local?.inventoryItems,deleteIntents.inventoryItems),remote?.inventoryItems,'id',conflicts,'inventoryItem',preferLocalConflicts);
  const categoryOrderLocalChanged=!eq(local?.inventoryCategoryOrder,base?.inventoryCategoryOrder),categoryOrderRemoteChanged=!eq(remote?.inventoryCategoryOrder,base?.inventoryCategoryOrder);
  if(categoryOrderLocalChanged&&categoryOrderRemoteChanged&&!eq(local?.inventoryCategoryOrder,remote?.inventoryCategoryOrder))conflicts.push('inventoryCategoryOrder');
  out.inventoryCategoryOrder=clone(categoryOrderLocalChanged?local?.inventoryCategoryOrder:(remote?.inventoryCategoryOrder??base?.inventoryCategoryOrder??[]));
  out.inventoryEvents=mergeArray(base?.inventoryEvents,protectImplicitDeletes(base?.inventoryEvents,local?.inventoryEvents,deleteIntents.inventoryEvents),remote?.inventoryEvents,'id',conflicts,'inventoryEvent',preferLocalConflicts);
  out.warehouseOrders=mergeArray(base?.warehouseOrders,protectImplicitDeletes(base?.warehouseOrders,local?.warehouseOrders,deleteIntents.warehouseOrders),remote?.warehouseOrders,'id',conflicts,'warehouseOrder',preferLocalConflicts);
  // Import audits are client-authored business data; concurrent changes require resolution.
  out.importAudit=scalar('importAudit');out.stage2Audit=scalar('stage2Audit');
  // _meta is transport/export metadata (schema, savedAt, mirror sequence), not business data.
  out._meta=clone(remote?._meta||{});
  return{state:normalizeState(out),conflicts};
}
return { merge3 };
}
