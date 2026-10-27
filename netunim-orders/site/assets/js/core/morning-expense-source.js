import {expenseCents} from './morning-expense-input.js';
import {validReportDate} from './morning-report-period.js';

export function normalizeExpenseSource(value) {
  if(value===undefined||value===null)return null;
  if(typeof value!=='object'||Array.isArray(value)||typeof value.sha256!=='string'||!/^[a-f0-9]{64}$/.test(value.sha256)||
    !Number.isSafeInteger(value.size)||value.size<=0||value.size>20971520||!['application/pdf','image/jpeg','image/png'].includes(value.contentType))throw Error('invalid_expense_source');
  return {sha256:value.sha256,size:value.size,contentType:value.contentType};
}
export function expenseSourceExpected(payload) {
  const grossCents=expenseCents(payload.amount),vatCents=expenseCents(payload.vat);
  return {supplierTaxId:payload.supplier?.taxId,documentType:payload.documentType,number:payload.number,date:payload.date,
    grossCents,vatCents,netCents:grossCents!==null&&vatCents!==null?grossCents-vatCents:null,allocationNumber:payload.allocationNumber||'',pcnClassification:payload.pcnClassification};
}
export function expenseSourceFields(proposal) {
  const f=proposal?.fields;
  return f?{supplierTaxId:f.supplier?.value,documentType:f.documentType?.value,number:f.invoiceNumber?.suggestedNumber||f.invoiceNumber?.value,
    date:f.date?.value,netCents:f.net?.value,vatCents:f.vat?.value,grossCents:f.gross?.value,allocationNumber:f.allocationNumber?.value||''}:{};
}
export function compareExpenseSource(fields,expected) {
  const missing=[],conflicts=[];
  for(const name of ['supplierTaxId','documentType','number','date','netCents','vatCents','grossCents','allocationNumber']){
    const value=fields?.[name];
    const valid=name.endsWith('Cents')?Number.isSafeInteger(value)&&value>=0:name==='supplierTaxId'?/^\d{9}$/.test(value||''):
      name==='documentType'?[305,330,320].includes(value):name==='date'?validReportDate(value):name==='allocationNumber'?
      /^(?:\d{9})?$/.test(value??''):typeof value==='string'&&!!value.trim()&&value.length<=20&&!/[\u0000-\u001f\u007f]/.test(value);
    if(!valid||name==='allocationNumber'&&expected[name]&&!value)missing.push(name);
    else if(name==='number'&&expected.pcnClassification==='P'&&/^\d{1,9}$/.test(value)&&value.padStart(9,'0')===expected.number)continue;
    else if((value??'')!==(expected[name]??''))conflicts.push(name);
  }
  return {missing,conflicts,matched:!missing.length&&!conflicts.length};
}
export function normalizeExpenseSourceReview(review,expected) {
  if(!review||!['extracted','manual'].includes(review.mode))throw Error('expense_source_review_required');
  const result=compareExpenseSource(review.fields,expected),reason=typeof review.reason==='string'?review.reason.trim():'';
  if(review.mode==='extracted'&&!result.matched||review.mode==='manual'&&(reason.length<10||reason.length>250))throw Error('expense_source_review_required');
  return {mode:review.mode,missing:result.missing,conflicts:result.conflicts,...(review.mode==='manual'?{reason}:{})};
}
