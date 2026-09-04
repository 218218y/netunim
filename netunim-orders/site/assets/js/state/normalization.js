import {clone} from '../core/values.js';
import {restoreJsonRequiredArrays} from './validation.js';
import {INITIAL_STATE} from './constants.js';

// Dependencies are supplied by the composition root; this module has no startup side effects.
export function createStateNormalization({}){


function normalizeState(s){s=s&&typeof s==='object'?s:{};const seed=name=>Array.isArray(s[name])?s[name]:structuredClone(INITIAL_STATE[name]||[]);s.version=4;s.businessName=s.businessName||'ניהול הזמנות';s.suppliers=Array.isArray(s.suppliers)?s.suppliers:[];s.suppliers.forEach((x,i)=>{if(x.sortOrder===undefined||x.sortOrder===null||!Number.isFinite(Number(x.sortOrder)))x.sortOrder=i;else x.sortOrder=Number(x.sortOrder)});s.transactions=Array.isArray(s.transactions)?s.transactions:[];s.transactions.forEach(t=>{if(t.yearEnd!==undefined&&t.yearEnd!==null&&t.yearEnd!==''){const y=Number(t.yearEnd);if(Number.isInteger(y)&&y>=2000&&y<=2100)t.yearEnd=y;else delete t.yearEnd}});s.customerDebts=seed('customerDebts');s.customerOrders=seed('customerOrders');s.serviceCalls=seed('serviceCalls');s.inventoryItems=seed('inventoryItems');const inventoryCategories=[...new Set(s.inventoryItems.filter(x=>x?.active!==false).map(x=>String(x?.category||'').trim()||'ללא קטגוריה'))];if(Array.isArray(s.inventoryCategoryOrder)){const seen=new Set();s.inventoryCategoryOrder=[...s.inventoryCategoryOrder.map(x=>String(x||'').trim()).filter(Boolean),...inventoryCategories].filter(x=>inventoryCategories.includes(x)&&!seen.has(x)&&seen.add(x))}else{s.inventoryCategoryOrder=inventoryCategories.filter(x=>x!=='אביזרים');if(inventoryCategories.includes('אביזרים'))s.inventoryCategoryOrder.push('אביזרים')}s.inventoryEvents=seed('inventoryEvents');s.warehouseOrders=seed('warehouseOrders');s.checks=seed('checks');s.checks=s.checks.filter(x=>x&&x.id).map(x=>({...x,account:x.account==='ביתי'?'ביתי':'עסקי',amount:Math.round(Number(x.amount||0)),name:String(x.name||''),dueDate:String(x.dueDate||''),status:String(x.status||'בקופה'),depositDate:x.depositDate||null,depositedAt:x.depositedAt||null,clearedDate:x.clearedDate||null,checkNumber:String(x.checkNumber||''),note:String(x.note||''),createdAt:x.createdAt||''}));s.notes=(Array.isArray(s.notes)?s.notes:[]).filter(x=>x&&x.id).map(x=>({...x,id:String(x.id),content:String(x.content||''),createdAt:String(x.createdAt||''),updatedAt:String(x.updatedAt||x.createdAt||'')}));s.importAudit=s.importAudit||{};s.stage2Audit=s.stage2Audit||structuredClone(INITIAL_STATE.stage2Audit||{});const explicitInvoice=s.customerDebts.find(d=>d?.source?.sheet==='חובות_וזכויות'&&Number(d?.source?.row)===32&&!d.updatedAt&&/יצאה\s*ח[״"']?מ/.test(`${d.sourceInvoiceText||''} ${d.note||''}`));if(explicitInvoice)explicitInvoice.invoiceIssued=true;s._meta={...(s._meta||{}),schemaVersion:4};return s}

function validateRestoreJson(raw){
  if(!raw||typeof raw!=='object'||Array.isArray(raw))throw new Error('קובץ ה־JSON אינו מכיל אובייקט נתונים תקין');
  if(raw._meta!==undefined&&(!raw._meta||typeof raw._meta!=='object'||Array.isArray(raw._meta)))throw new Error('פרטי הגיבוי אינם תקינים');
  for(const value of [raw.version,raw._meta?.schemaVersion]){
    if(value===undefined)continue;
    if(!Number.isInteger(Number(value))||Number(value)<1)throw new Error('גרסת הגיבוי אינה נתמכת');
  }
  const format=String(raw?._meta?.format||'');if(format&&format!=='order-management-portable')throw new Error('זה אינו קובץ גיבוי של ניהול ההזמנות');
  const version=Math.max(Number(raw.version||0),Number(raw?._meta?.schemaVersion||0));if(version&&version>4)throw new Error(`קובץ הגיבוי נוצר בגרסת נתונים חדשה יותר (${version})`);
  const missing=restoreJsonRequiredArrays().filter(k=>!Array.isArray(raw[k]));if(missing.length)throw new Error('חסרים בקובץ שדות חובה: '+missing.join(', '));
  const x=clone(raw);if(!Array.isArray(x.notes))x.notes=[];return normalizeState(x)
}

return { normalizeState, validateRestoreJson };
}
