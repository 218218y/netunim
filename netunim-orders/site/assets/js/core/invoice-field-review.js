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
    let status = source?.status || 'missing', detail = source?.reason?.startsWith('ambiguous_') ? 'נמצאו כמה ערכים אפשריים במסמך.' :
      ({supplier_prefix_not_verified:'תחילית מספר החשבונית דורשת בדיקה לפי הספק.',
        alphanumeric_number_review:'מספר החשבונית כולל אותיות; יש לבדוק את המספר המלא.',
        canonical_supplier_pending:'נדרשת התאמה לספריית הספקים של Morning.',
        document_identity_unresolved:'זהות המסמך טרם הושלמה; יש לבדוק את הנתון מול המקור.'})[source?.reason] || '';
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
      if (present(value) && !/^\d{9}$/.test(value)) {
        status = 'review'; detail = 'יש להזין מספר הקצאה בן תשע ספרות או לתקן לפי המקור.';
      } else if (policy.status === 'below_threshold_or_no_vat') {
        status = 'not_required'; detail = '';
      } else if (!present(value) && policy.status === 'check_business_conditions') {
        status = 'missing'; detail = 'לא נמצא מספר הקצאה והסכום לפני מע״מ מעל הסף לתאריך המסמך. יש לבדוק ולהשלים בהתאם לתנאי העסקה.';
      } else if (!present(value)) {
        status = 'not_applicable'; detail = '';
      } else detail += ' מספר מהמסמך או מהקלדה; לא אומת מול רשות המסים.';
    }
    if (['net','vat','gross'].includes(key) && inconsistent) {status = 'review'; detail += ' סכומי הנטו והמע״מ אינם תואמים לסה״כ.';}
    return [name, {status, detail, sourceKey:key, sources:source?.sources || [], allocationPolicy:policy.status}];
  }));
}
