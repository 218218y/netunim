import {expenseCents} from './morning-expense-input.js';
import {allocationPolicy} from './invoice-recognition.js';

export const invoiceFormFields = Object.freeze({supplierId:'supplier', documentType:'documentType', number:'invoiceNumber', date:'date',
  net:'net', vat:'vat', gross:'gross', allocationNumber:'allocationNumber'});
const present = value => value !== null && value !== undefined && value !== '';

// The source proposal remains immutable evidence. Manual and calculated values
// describe the current draft separately, including after a file-draft round trip.
export function invoiceFieldReview(proposal, edits, draft, supplierTaxId) {
  const fields = proposal?.fields || {}, changedSupplier = fields.supplier?.value && fields.supplier.value !== supplierTaxId;
  const policy = allocationPolicy({date:draft.date, documentType:Number(draft.documentType), netCents:expenseCents(draft.net),
    vatCents:expenseCents(draft.vat), pcnClassification:draft.pcnClassification});
  const amounts = ['net','vat','gross'].map(name => expenseCents(draft[name]));
  const inconsistent = amounts.every(Number.isSafeInteger) && amounts[0] + amounts[1] !== amounts[2];
  return Object.fromEntries(Object.entries(invoiceFormFields).map(([name, key]) => {
    const source = fields[key], value = draft[name];
    const expected = key === 'invoiceNumber' ? source?.suggestedNumber || source?.value : source?.value;
    const actual = key === 'supplier' ? supplierTaxId : ['net','vat','gross'].includes(key) ? expenseCents(value) : value;
    let status = source?.status || 'missing', detail = '';
    if (!present(value)) status = 'missing';
    else if (edits[name] === 'manual') {status = 'manual'; detail = 'הושלם או נבדק ידנית; יש להשוות למסמך המקור.';}
    else if (edits[name] === 'calculated') {status = 'review'; detail = 'חושב לאחר שינוי בסכומים; יש להשוות למקור.';}
    else if (changedSupplier && key !== 'supplier') {status = 'review'; detail = 'הספק שונה מהזיהוי המקורי; נדרשת בדיקה מחדש.';}
    else if (!source || String(actual) !== String(expected)) {status = 'review'; detail = 'ערך הטופס לא אומת מול הצעת הזיהוי; יש לבדוק לפי המקור.';}
    else if (key === 'supplier' && source?.value === supplierTaxId && source.canonicalVerified) status = 'verified';
    if (source?.reason === 'computed_net' && !edits[name]) detail = 'חושב מהסכום הכולל פחות המע״מ המפורש.';
    if (key === 'invoiceNumber' && source?.rawNumber && source.rawNumber !== source.suggestedNumber) {
      detail += ` מספר במקור: ${source.rawNumber}; הצעה: ${source.suggestedNumber}.`;
    }
    if (key === 'allocationNumber') {
      detail += present(value) ? ' מספר מהמסמך או מהקלדה; לא אומת מול רשות המסים.' :
        policy.status === 'check_business_conditions' ? ' לפי התאריך והסכומים ייתכן שנדרש מספר הקצאה; יש לבדוק את תנאי העסקה.' : ' יש לבדוק אם נדרש לפי פרטי המסמך.';
    }
    if (['net','vat','gross'].includes(key) && inconsistent) {status = 'review'; detail += ' סכומי הנטו והמע״מ אינם תואמים לסה״כ.';}
    return [name, {status, detail, sourceKey:key, sources:source?.sources || [], allocationPolicy:policy.status}];
  }));
}
