import {clone} from '../core/values.js';
import {eq, mergeArray} from './merge-records.js';

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
  out.businessName=!eq(local?.businessName,base?.businessName)?local.businessName:remote?.businessName;
  out.suppliers=mergeArray(base?.suppliers,protectImplicitDeletes(base?.suppliers,local?.suppliers,deleteIntents.suppliers),remote?.suppliers,'id',conflicts,'supplier',preferLocalConflicts);
  out.transactions=mergeArray(base?.transactions,protectImplicitDeletes(base?.transactions,local?.transactions,deleteIntents.transactions),remote?.transactions,'id',conflicts,'transaction',preferLocalConflicts);
  out.customerDebts=mergeArray(base?.customerDebts,protectImplicitDeletes(base?.customerDebts,local?.customerDebts,deleteIntents.customerDebts),remote?.customerDebts,'id',conflicts,'customerDebt',preferLocalConflicts);
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
  out.importAudit=remote?.importAudit||local?.importAudit||base?.importAudit||{};out.stage2Audit=remote?.stage2Audit||local?.stage2Audit||base?.stage2Audit||{};out._meta=remote?._meta||local?._meta||{};
  return{state:normalizeState(out),conflicts};
}
return { merge3 };
}
