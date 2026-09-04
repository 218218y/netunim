import {clone} from '../core/values.js';
import {assertOrderEntityInvariants,restoreJsonRequiredArrays} from './validation.js';
import {INITIAL_STATE} from './constants.js';

// Dependencies are supplied by the composition root; this module has no startup side effects.
export function createStateNormalization({}){
  function normalizeState(input){
    const state=input&&typeof input==='object'&&!Array.isArray(input)?input:{};
    // Validate before any filter/map/Set transform so malformed records cannot disappear silently.
    assertOrderEntityInvariants(state,{includeChecks:true,required:false});
    const seed=name=>Array.isArray(state[name])?state[name]:structuredClone(INITIAL_STATE[name]||[]);
    state.version=4;state.businessName=state.businessName||'ניהול הזמנות';
    state.suppliers=seed('suppliers');state.suppliers.forEach((supplier,index)=>{supplier.sortOrder=supplier.sortOrder===undefined||supplier.sortOrder===null||!Number.isFinite(Number(supplier.sortOrder))?index:Number(supplier.sortOrder)});
    state.transactions=seed('transactions');state.transactions.forEach(transaction=>{if(transaction.yearEnd!==undefined&&transaction.yearEnd!==null&&transaction.yearEnd!==''){const year=Number(transaction.yearEnd);if(Number.isInteger(year)&&year>=2000&&year<=2100)transaction.yearEnd=year;else delete transaction.yearEnd}});
    state.customerDebts=seed('customerDebts');state.customerOrders=seed('customerOrders');state.serviceCalls=seed('serviceCalls');state.inventoryItems=seed('inventoryItems');
    const inventoryCategories=[...new Set(state.inventoryItems.filter(item=>item?.active!==false).map(item=>String(item?.category||'').trim()||'ללא קטגוריה'))];
    if(Array.isArray(state.inventoryCategoryOrder)){
      const seen=new Set();state.inventoryCategoryOrder=[...state.inventoryCategoryOrder.map(value=>String(value||'').trim()).filter(Boolean),...inventoryCategories].filter(value=>inventoryCategories.includes(value)&&!seen.has(value)&&seen.add(value));
    }else{state.inventoryCategoryOrder=inventoryCategories.filter(value=>value!=='אביזרים');if(inventoryCategories.includes('אביזרים'))state.inventoryCategoryOrder.push('אביזרים')}
    state.inventoryEvents=seed('inventoryEvents');state.warehouseOrders=seed('warehouseOrders');state.checks=seed('checks').map(check=>({...check,account:check.account==='ביתי'?'ביתי':'עסקי',amount:Math.round(Number(check.amount||0)),name:String(check.name||''),dueDate:String(check.dueDate||''),status:String(check.status||'בקופה'),depositDate:check.depositDate||null,depositedAt:check.depositedAt||null,clearedDate:check.clearedDate||null,checkNumber:String(check.checkNumber||''),note:String(check.note||''),createdAt:check.createdAt||''}));
    state.notes=seed('notes').map(note=>({...note,id:String(note.id),content:String(note.content||''),createdAt:String(note.createdAt||''),updatedAt:String(note.updatedAt||note.createdAt||'')}));
    state.importAudit=state.importAudit||{};state.stage2Audit=state.stage2Audit||structuredClone(INITIAL_STATE.stage2Audit||{});
    const explicitInvoice=state.customerDebts.find(debt=>debt?.source?.sheet==='חובות_וזכויות'&&Number(debt?.source?.row)===32&&!debt.updatedAt&&/יצאה\s*ח[״"']?מ/.test(`${debt.sourceInvoiceText||''} ${debt.note||''}`));if(explicitInvoice)explicitInvoice.invoiceIssued=true;
    state._meta={...(state._meta||{}),schemaVersion:4};assertOrderEntityInvariants(state,{includeChecks:true,required:true});return state;
  }

  function validateRestoreJson(raw){
    if(!raw||typeof raw!=='object'||Array.isArray(raw))throw new Error('קובץ ה־JSON אינו מכיל אובייקט נתונים תקין');
    if(raw._meta!==undefined&&(!raw._meta||typeof raw._meta!=='object'||Array.isArray(raw._meta)))throw new Error('פרטי הגיבוי אינם תקינים');
    for(const value of [raw.version,raw._meta?.schemaVersion]){if(value===undefined)continue;if(!Number.isInteger(Number(value))||Number(value)<1)throw new Error('גרסת הגיבוי אינה נתמכת')}
    const format=String(raw?._meta?.format||'');if(format&&format!=='order-management-portable')throw new Error('זה אינו קובץ גיבוי של ניהול ההזמנות');
    const version=Math.max(Number(raw.version||0),Number(raw?._meta?.schemaVersion||0));if(version&&version>4)throw new Error(`קובץ הגיבוי נוצר בגרסת נתונים חדשה יותר (${version})`);
    const missing=restoreJsonRequiredArrays().filter(key=>!Array.isArray(raw[key]));if(missing.length)throw new Error('חסרים בקובץ שדות חובה: '+missing.join(', '));
    assertOrderEntityInvariants(raw,{includeChecks:true,required:false});const state=clone(raw);if(!Array.isArray(state.notes))state.notes=[];return normalizeState(state);
  }

  return {normalizeState,validateRestoreJson};
}
