import {expensePage,expenseRecord,expenseSupplier,expenseUuid} from './service.js';
import {expenseCents} from './input.js';
import {INVOICE_SUPPLIER_PROFILES} from '../../../site/assets/js/core/invoice-supplier-profiles.js';

export async function expenseNumberPolicy(taxId,number,pcn,profiles=INVOICE_SUPPLIER_PROFILES) {
  const hash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode('supplier-tax:'+taxId))),n=>n.toString(16).padStart(2,'0')).join('');
  const profile=profiles.find(row=>row.issuerTaxHash===hash);
  const canonical=value=>{
    const prefix=profile?.verifiedNumberPrefixes?.find(prefix=>value.startsWith(prefix)&&/^\d+$/.test(value.slice(prefix.length)));
    const normalized=prefix?value.slice(prefix.length):value;
    return (pcn==='P'||profile?.id==='roya')&&/^\d+$/.test(normalized)?normalized.replace(/^0+(?=\d)/,''):normalized;
  };
  const prefixes=profile?.verifiedNumberPrefixes||[],normalized=canonical(number);
  const matchedPrefix=prefixes.find(prefix=>number.startsWith(prefix)&&/^\d+$/.test(number.slice(prefix.length)));
  const rawNumeric=matchedPrefix?number.slice(matchedPrefix.length):number;
  const searches=[...new Set([number,rawNumeric,normalized,...(/^\d+$/.test(normalized)?prefixes.flatMap(prefix=>[prefix+rawNumeric,prefix+normalized]):[])])];
  return {canonical,searches:pcn==='P'?[normalized]:searches};
}
export async function findExpenseDuplicate(request,payload,{profiles}={}) {
  const policy=await expenseNumberPolicy(payload.supplier.taxId,payload.number,payload.pcnClassification,profiles);
  const supplierTax=new Map(),checked=new Set();let detailReads=0;
  const relevant=item=>item.status!==100&&policy.canonical(item.number)===policy.canonical(payload.number)&&item.type===payload.documentType&&
    (!item.sourceDocumentDate||item.sourceDocumentDate.slice(0,4)===payload.date.slice(0,4));
  for(const number of policy.searches){
    let pages=1,total=null;const seen=new Set();
    for(let page=0;page<pages;page++){
      const raw=await request('/expenses/search',{method:'POST',body:JSON.stringify({number,page:page+1,pageSize:50})});
      const found=expensePage(raw,page,expenseRecord);pages=found.pages;
      if(pages>20||total!==null&&total!==found.total||found.items.some(row=>seen.has(row.id)))throw Error('morning_expense_duplicate_check_incomplete');
      total=found.total;
      for(let item of found.items){
        seen.add(item.id);if(checked.has(item.id))continue;checked.add(item.id);
        if(!relevant(item))continue;
        // Production search omits both supplier ID and tax ID for API-created
        // snapshots. Resolve the canonical expense before declaring a match or
        // blocking an unrelated issuer with the same document number.
        if(!item.supplierTaxId||!item.sourceDocumentDate||item.grossCents===null||item.vatCents===null){
          if(++detailReads>20)throw Error('morning_expense_duplicate_check_incomplete');
          const full=expenseRecord(await request('/expenses/'+item.id,{method:'GET'}));
          if(full.id!==item.id)throw Error('morning_expense_duplicate_check_incomplete');item=full;
          if(!relevant(item))continue;
        }
        let tax=item.supplierTaxId;
        if(!tax&&expenseUuid(item.supplierId)){
          if(!supplierTax.has(item.supplierId)){
            const supplier=expenseSupplier(await request('/suppliers/'+item.supplierId,{method:'GET'}));
            if(supplier.id!==item.supplierId)throw Error('morning_expense_duplicate_check_incomplete');supplierTax.set(item.supplierId,supplier.taxId);
          }tax=supplierTax.get(item.supplierId);
        }
        if(tax&&tax!==payload.supplier.taxId)continue;
        const exact=tax===payload.supplier.taxId&&item.sourceDocumentDate===payload.date&&
          item.grossCents===expenseCents(payload.amount)&&item.vatCents===expenseCents(payload.vat);
        return {duplicate:true,match:exact?'identical':'identity_conflict',expenseId:item.id,
          message:exact?'חשבונית זהה בספק, מספר, סוג, תאריך וסכומים כבר קיימת ב־Morning. לא תיווצר הוצאה נוספת.':
            'קיימת חשבונית עם אותו מספר, ספק, סוג ושנה, או שזהות הספק עדיין דורשת בירור. יש לבדוק את הרשומה הקיימת; השמירה נחסמה.'};
      }
    }
  }
  return {duplicate:false};
}
