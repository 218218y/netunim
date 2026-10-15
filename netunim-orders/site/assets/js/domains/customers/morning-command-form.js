// @ts-check
import { DOCUMENT_TYPES } from './morning-document-view.js';
/** @typedef {{type:number,date:string,price:number,currency:string,bankSourceKey?:string,[key:string]:unknown}} FormPayment */
/** @typedef {{kind:string,bankAmount?:number|undefined,paymentMode?:string|undefined,bankTransactionId?:number|undefined}} FormSource */
/** @typedef {{operationId:string,debtId:string,source:FormSource}} FormContext */
/** @typedef {{operation_id:string,source:{kind:string,debtId:string,bankTransactionId?:number},document:{type:number,amount:number,date:string,dueDate:string,description:string,remarks:string,orderNumber:string,client:{name:string,email:string,taxId:string,phone:string},payment?:FormPayment[],linkedDocumentId?:string}}} FormPayload */
/** @param {unknown} value @param {number} [max] */
function cleanText(value, max = 250) {
  return String(value ?? '')
    .trim()
    .slice(0, max);
}
/** @param {unknown} value */
export function validateTaxId(value) {
  const digits = String(value || '').replace(/\D/g, '');
  if (!digits) return '';
  if (digits.length > 9)
    throw new Error('מספר עוסק / ח.פ. יכול להכיל עד 9 ספרות');
  const padded = digits.padStart(9, '0');
  let sum = 0;
  for (let i = 0; i < 9; i++) {
    let product = Number(padded[i]) * ((i % 2) + 1);
    if (product > 9) product -= 9;
    sum += product;
  }
  if (sum % 10 !== 0) throw new Error('מספר העוסק / ח.פ. אינו תקין');
  return padded;
}
/** Validates one synchronous form command. No provider, reservation, storage or DOM mutation authority.
 * @param {{session:{context:()=>FormContext},fields:{read:(id:string)=>{value:string}|null,type:()=>number},receipts:{read:()=>FormPayment[],totalCents:(rows:FormPayment[])=>number},format:{money:(value:number)=>string}}} ports
 */
export function createMorningCommandForm({
  session,
  fields,
  receipts,
  format
}) {
  const currentField = fields.read,
    selectedType = fields.type,
    readPaymentRows = receipts.read,
    morningPaymentTotalCents = receipts.totalCents,
    money = format.money;
  /** @returns {FormPayload} */
  function readForm() {
    const {
      operationId: activeOperationId,
      debtId: activeDebtId,
      source: activeSource
    } = session.context();
    if (!activeOperationId) throw new Error('יש לפתוח את חלון ההפקה');
    const type = selectedType();
    if (!DOCUMENT_TYPES[type]) throw new Error('יש לבחור סוג מסמך');
    if (activeSource.kind === 'bank' && ![320, 400].includes(type))
      throw new Error('מתנועת בנק ניתן להפיק חשבונית מס / קבלה או קבלה בלבד');
    const clientName = cleanText(currentField('morningClientName')?.value, 160),
      email = cleanText(currentField('morningClientEmail')?.value, 180),
      phone = cleanText(currentField('morningClientPhone')?.value, 50),
      taxId = validateTaxId(currentField('morningClientTaxId')?.value),
      date = String(currentField('morningDocumentDate')?.value || ''),
      dueDate =
        type === 305 ? String(currentField('morningDueDate')?.value || '') : '',
      description = cleanText(currentField('morningDescription')?.value, 250),
      remarks = cleanText(currentField('morningRemarks')?.value, 500),
      orderNumber = cleanText(currentField('morningOrderNumber')?.value, 80),
      payments = type === 320 || type === 400 ? readPaymentRows() : [],
      amount = Number(currentField('morningAmount')?.value || 0);
    if (!clientName) throw new Error('יש להזין שם לקוח');
    if (!Number.isFinite(amount) || amount <= 0)
      throw new Error('יש להזין סכום חיובי תקין');
    if (payments.length) {
      const amountCents = Math.round(amount * 100),
        paymentCents = morningPaymentTotalCents(payments);
      if (paymentCents !== amountCents)
        throw new Error(
          `סכום המסמך (${money(amount)}) אינו תואם לסך התקבולים (${money(paymentCents / 100)}). יש לתקן את הסכומים לפני המשך.`
        );
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date))
      throw new Error('יש לבחור תאריך מסמך');
    if (dueDate && !/^\d{4}-\d{2}-\d{2}$/.test(dueDate))
      throw new Error('תאריך לתשלום אינו תקין');
    if (dueDate && dueDate < date)
      throw new Error('תאריך לתשלום לא יכול להיות לפני תאריך המסמך');
    if (!description) throw new Error('יש להזין תיאור למסמך');
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
      throw new Error('כתובת האימייל אינה תקינה');
    if (activeSource.kind === 'bank') {
      const sourcePayments = payments.filter(row =>
          String(row.bankSourceKey || '')
        ),
        bankAmount = Number(activeSource.bankAmount),
        mode = String(activeSource.paymentMode || 'transfer');
      if (!sourcePayments.length)
        throw new Error('יש להשאיר לפחות תקבול אחד שמקורו בתנועת הבנק');
      if (mode === 'checks') {
        if (
          sourcePayments.some(
            row =>
              row.type !== 2 ||
              !String(row.bankSourceKey || '').startsWith('check:')
          )
        )
          throw new Error('תקבולי הצ׳קים שמקורם בבנק חייבים להישאר מסוג צ׳ק');
        const sourceTotal = sourcePayments.reduce(
          (sum, row) => sum + Math.round(Number(row.price) * 100),
          0
        );
        if (
          !Number.isFinite(bankAmount) ||
          sourceTotal <= 0 ||
          sourceTotal > Math.round(bankAmount * 100)
        )
          throw new Error(
            'סכומי הצ׳קים שנבחרו אינם תואמים להפקדת הבנק המקורית'
          );
      } else {
        const source = sourcePayments.find(
          row => row.bankSourceKey === 'transfer'
        );
        if (
          sourcePayments.length !== 1 ||
          !source ||
          source.type !== 4 ||
          !Number.isFinite(bankAmount) ||
          Math.round(source.price * 100) !== Math.round(bankAmount * 100)
        )
          throw new Error(
            'תקבול ההעברה שמקורו בבנק חייב להישאר זהה לתנועת הבנק המקורית'
          );
      }
    }
    /** @type {FormPayload} */ const payload = {
      operation_id: activeOperationId,
      source: {
        kind: activeSource.kind || 'standalone',
        debtId: activeDebtId || '',
        ...(activeSource.kind === 'bank'
          ? { bankTransactionId: Number(activeSource.bankTransactionId) }
          : {})
      },
      document: {
        type,
        amount,
        date,
        dueDate,
        description,
        remarks,
        orderNumber,
        client: { name: clientName, email, taxId, phone }
      }
    };
    if (payments.length) payload.document.payment = payments;
    if (type === 400) {
      const linked = String(
        currentField('morningLinkedDocument')?.value || ''
      ).trim();
      if (linked) payload.document.linkedDocumentId = linked;
    }
    return payload;
  }
  return { read: readForm };
}
