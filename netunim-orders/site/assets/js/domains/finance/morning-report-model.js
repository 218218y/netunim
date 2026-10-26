export const REPORT_METHODS = Object.freeze({credit:'אשראי', cash:'מזומן', cheque:'צ׳קים', bank:'העברה בנקאית', paypal:'PayPal', app:'אפליקציות תשלום', other:'אחר', withholding:'ניכוי במקור', unknown:'ללא פירוט'});
const METHODS = {0:'withholding', 1:'cash', 2:'cheque', 3:'credit', 4:'bank', 5:'paypal', 10:'app', 11:'other'};
export const REPORT_TYPES = {305:'חשבונית מס', 320:'חשבונית מס / קבלה', 330:'חשבונית זיכוי', 400:'קבלה', 405:'קבלה על תרומה', 410:'ביטול תרומה'};
import {validReportDate, reportPeriod} from '../../core/morning-report-period.js';
export {validReportDate, reportPeriod};
const SUM_FIELDS = ['incomeCents', 'expensesCents', 'expenseCostCents', 'unrecoverableVatCents', 'receiptsCents', 'outputVatCents', 'inputVatCents', 'deductibleExpensesCents'];
const DOCUMENT_FIELDS = new Set(['incomeCents', 'receiptsCents', 'outputVatCents', 'methods']);
const COMPLETENESS_FIELDS = [...SUM_FIELDS, 'methods'];
// Sums always contain the known integer amounts. They must be read through
// reportMetric when presented as a verified total, rather than treating a
// partial known sum (including zero) as the complete amount.
const zero = (documents = true, expenses = true, record = false) => ({
  ...Object.fromEntries(SUM_FIELDS.map(key => [key, 0])),
  completeness:Object.fromEntries(COMPLETENESS_FIELDS.map(key => [key, DOCUMENT_FIELDS.has(key) ? documents : expenses])),
  methods:record ? {} : Object.fromEntries(Object.keys(REPORT_METHODS).map(key => [key, 0])), records:[], issues:[], notices:[],
});
const moneyValue = value => Number.isSafeInteger(value);
const addMoney = (left, right) => {
  const value = left + right;
  if (!moneyValue(value)) throw new Error('סכומי הדוח חורגים מטווח החישוב הנתמך');
  return value;
};
const signed = (row, value) => [330, 410].includes(row.type) ? -Math.abs(value) : value;
const fullMonths = (fromDate, toDate) => fromDate.endsWith('-01') && new Date(Date.parse(toDate) + 86400000).getUTCDate() === 1;
function addIssue(scope, item) {
  const existing = scope.issues.find(issue => issue.code === item.code);
  if (existing) existing.count += item.count;
  else scope.issues.push({...item});
}
function finalize(scope, fullVatPeriod) {
  const c = scope.completeness;
  Object.assign(scope, {
    incomeComplete:c.incomeCents, expensesComplete:c.expensesCents, expenseCostComplete:c.expenseCostCents,
    unrecoverableVatComplete:c.unrecoverableVatCents, receiptAmountComplete:c.receiptsCents,
    paymentBreakdownComplete:c.methods, receiptsComplete:c.receiptsCents && c.methods,
    outputVatComplete:c.outputVatCents, inputVatComplete:c.inputVatCents, deductibleExpensesComplete:c.deductibleExpensesCents,
    profitComplete:c.incomeCents && c.expenseCostCents, vatComplete:c.outputVatCents && c.inputVatCents && fullVatPeriod,
  });
  scope.profitCents = scope.profitComplete ? addMoney(scope.incomeCents, -scope.expenseCostCents) : null;
  scope.vatBalanceCents = scope.vatComplete ? addMoney(scope.outputVatCents, -scope.inputVatCents) : null;
  scope.complete = scope.profitComplete && scope.receiptsComplete && scope.vatComplete;
  return scope;
}
export function reportMetric(scope, field, method) {
  if (!scope) return null;
  if (field === 'methods') {
    const value = scope.methods?.[method] ?? 0;
    return Object.hasOwn(REPORT_METHODS, method) && scope.receiptAmountComplete && scope.paymentBreakdownComplete && moneyValue(value) ? value : null;
  }
  if (field === 'profitCents' || field === 'vatBalanceCents') return moneyValue(scope[field]) ? scope[field] : null;
  return scope.completeness?.[field] === true && moneyValue(scope[field]) ? scope[field] : null;
}
export function reportBucketKey(date, group) {
  if (group === 'day') return date;
  if (group === 'year') return date.slice(0, 4);
  const length = group === 'bimonth' ? 2 : group === 'quarter' ? 3 : 1;
  const month = Math.floor((Number(date.slice(5, 7)) - 1) / length) * length + 1;
  return date.slice(0, 4) + '-' + String(month).padStart(2, '0');
}
export function buildMorningReport({documents, expenses, fromDate, toDate, group = 'month', errors = []}) {
  if (!validReportDate(fromDate) || !validReportDate(toDate) || fromDate > toDate) throw new Error('טווח התאריכים אינו תקין');
  const documentsKnown = Array.isArray(documents) && !errors.some(error => error.source === 'documents');
  const expensesKnown = Array.isArray(expenses) && !errors.some(error => error.source === 'expenses');
  const total = zero(documentsKnown, expensesKnown), buckets = new Map(), notices = new Map(), records = [];
  function issue(entry, code, label, fields) {
    for (const field of fields) entry.completeness[field] = false;
    addIssue(entry, {code, label, count:1, fields});
  }
  const fullVatPeriod = fullMonths(fromDate, toDate);
  if (!fullVatPeriod) addIssue(total, {code:'vat-period', label:'סיכום מע״מ דורש חודשים מלאים; יש לבחור חודש או דו־חודש זוגי', count:1});
  function bucket(date) {
    const key = reportBucketKey(date, group);
    if (!buckets.has(key)) buckets.set(key, {key, ...zero(documentsKnown, expensesKnown)});
    return buckets.get(key);
  }
  for (const row of [...(Array.isArray(documents) ? documents : []), ...(Array.isArray(expenses) ? expenses : [])]) {
    if (row.date < fromDate || row.date > toDate) continue;
    if (row.kind === 'expense' && row.status === 100) continue;
    const b = bucket(row.date), entry = {...row, ...zero(true, true, true)};
    const hasMoney = moneyValue(row.grossCents) && moneyValue(row.vatCents);
    if (row.kind === 'expense') {
      if (hasMoney) entry.expensesCents = addMoney(signed(row, row.grossCents), -signed(row, row.vatCents));
      else issue(entry, 'expense-money', 'חסרים סכום, מע״מ או שער המרה לחישוב הוצאות לפני מע״מ', ['expensesCents']);
      const deductibleKnown = moneyValue(row.deductibleVatCents);
      // Deductible VAT is supplied in ILS by Morning. A zero is meaningful;
      // absence never means that the full invoice VAT is recoverable.
      const vat = moneyValue(row.vatCents) ? signed(row, row.vatCents) : null;
      const deductibleVat = deductibleKnown ? signed(row, row.deductibleVatCents) : null;
      const invalidDeduction = vat !== null && deductibleKnown && (Math.abs(deductibleVat) > Math.abs(vat) || vat * deductibleVat < 0);
      if (deductibleKnown && !invalidDeduction) entry.inputVatCents = deductibleVat;
      else if (invalidDeduction) issue(entry, 'input-vat-inconsistent', 'מע״מ התשומות המותר אינו תואם למע״מ ההוצאה במורנינג; יש לאמת את נתוני המקור', ['inputVatCents', 'expenseCostCents', 'unrecoverableVatCents']);
      else issue(entry, 'input-vat', 'חסר סכום מע״מ תשומות מותר ממורנינג; עלות ההוצאה אינה מניחה ניכוי מע״מ', ['inputVatCents', 'expenseCostCents', 'unrecoverableVatCents']);
      if (moneyValue(row.grossCents) && entry.completeness.inputVatCents) entry.expenseCostCents = addMoney(signed(row, row.grossCents), -deductibleVat);
      else if (!moneyValue(row.grossCents)) issue(entry, 'expense-cost', 'חסר סכום ההוצאה בשקלים לחישוב העלות הניהולית', ['expenseCostCents']);
      if (vat !== null && entry.completeness.inputVatCents) entry.unrecoverableVatCents = addMoney(vat, -deductibleVat);
      else entry.completeness.unrecoverableVatCents = false;
      if (moneyValue(row.deductibleCents)) entry.deductibleExpensesCents = signed(row, row.deductibleCents);
      else entry.completeness.deductibleExpensesCents = false;
      // Morning status 30 describes an edited expense, not missing amounts.
      // Sum the current source values; historical filed reports need reconciliation.
      if (row.status === 30) {
        const notice = {code:'expense-edited', label:'הוצאות שנערכו מחדש נכללות לפי הנתונים העדכניים במורנינג', count:1};
        entry.notices.push(notice);
        notices.set(notice.code, {...notice, count:(notices.get(notice.code)?.count || 0) + 1});
      }
    } else {
      const receipt = [320, 400, 405, 410].includes(row.type);
      const exempt = [3, 4, 5].includes(row.businessType);
      const isIncome = !row.selfInvoice && ([305, 320, 330].includes(row.type) || exempt && [400, 405, 410].includes(row.type));
      if ([400, 405, 410].includes(row.type) && row.businessType == null) issue(entry, 'business-type', 'חסר סוג העסק בקבלות לצורך סיווג ההכנסה', ['incomeCents']);
      if (isIncome) {
        if (hasMoney) entry.incomeCents = addMoney(signed(row, row.grossCents), -signed(row, row.vatCents));
        else issue(entry, 'income-money', 'חסרים סכום, מע״מ או שער המרה במסמכי הכנסה', ['incomeCents']);
      }
      if ([305, 320, 330].includes(row.type)) {
        if (row.selfInvoice) issue(entry, 'self-vat', 'חשבוניות עצמיות דורשות התאמת מע״מ בדוח הרשמי', ['outputVatCents']);
        else if (moneyValue(row.vatCents)) entry.outputVatCents = signed(row, row.vatCents);
        else issue(entry, 'output-vat', 'חסר סכום מע״מ שקלי במסמכי ההכנסה', ['outputVatCents']);
      }
      if (receipt) {
        if (moneyValue(row.grossCents)) {
          entry.receiptsCents = signed(row, row.grossCents);
          const payments = row.payments || [];
          const allPositive = payments.length > 0 && payments.every(p => moneyValue(p.amountCents) && p.amountCents >= 0);
          let paymentTotal = 0;
          for (const payment of payments) {
            if (!moneyValue(payment.amountCents)) { issue(entry, 'payment-money', 'חסר סכום או שער המרה בפירוט אמצעי התשלום', ['methods']); continue; }
            let value = signed(row, payment.amountCents);
            if (entry.receiptsCents < 0 && allPositive) value = -Math.abs(value);
            const method = METHODS[payment.type] || 'unknown';
            if (method === 'unknown') issue(entry, 'payment-type', 'אמצעי תשלום לא מוכר מוצג ללא פירוט', ['methods']);
            entry.methods[method] = addMoney(entry.methods[method] || 0, value);
            paymentTotal = addMoney(paymentTotal, value);
          }
          const delta = addMoney(entry.receiptsCents, -paymentTotal);
          if (delta !== 0) {
            entry.methods.unknown = addMoney(entry.methods.unknown || 0, delta);
            issue(entry, 'payment-difference', 'פירוט אמצעי התשלום חסר או אינו תואם לסכום הקבלה', ['methods']);
          }
        } else issue(entry, 'receipt-money', 'חסר סכום שקלי בקבלה; סך הקבלות ואמצעי התשלום אינם מלאים', ['receiptsCents', 'methods']);
      }
    }
    // A source record can be complete even though a VAT reporting period
    // consists of full months. The period restriction belongs to aggregates.
    finalize(entry, true);
    for (const field of SUM_FIELDS) { b[field] = addMoney(b[field], entry[field]); total[field] = addMoney(total[field], entry[field]); }
    for (const field of COMPLETENESS_FIELDS) {
      b.completeness[field] &&= entry.completeness[field];
      total.completeness[field] &&= entry.completeness[field];
    }
    for (const item of entry.issues) { addIssue(b, item); addIssue(total, item); }
    for (const [method, value] of Object.entries(entry.methods)) { b.methods[method] = addMoney(b.methods[method], value); total.methods[method] = addMoney(total.methods[method], value); }
    b.records.push(entry); records.push(entry);
  }
  for (const error of errors) addIssue(total, {code:`source-${error.source}`, label:error.message, count:1});
  // Retain zero-activity months so a yearly report is comparable month to month.
  if (['month', 'bimonth', 'quarter'].includes(group)) {
    for (let month = fromDate.slice(0, 7); month <= toDate.slice(0, 7);) {
      bucket(month + '-01');
      const [year, part] = month.split('-').map(Number);
      month = new Date(Date.UTC(year, part, 1)).toISOString().slice(0, 7);
    }
  }
  const safe = [total, ...buckets.values(), ...records].every(b => SUM_FIELDS.every(key => Number.isSafeInteger(b[key])) && Object.values(b.methods).every(Number.isSafeInteger));
  if (!safe) throw new Error('סכומי הדוח חורגים מטווח החישוב הנתמך');
  finalize(total, fullVatPeriod);
  for (const b of buckets.values()) {
    const start = b.key.length === 4 ? b.key + '-01-01' : b.key.length === 7 ? b.key + '-01' : b.key;
    const length = group === 'year' ? 12 : group === 'quarter' ? 3 : group === 'bimonth' ? 2 : 1;
    const end = group === 'day' ? start : new Date(Date.UTC(Number(start.slice(0, 4)), Number(start.slice(5, 7)) + length - 1, 0)).toISOString().slice(0, 10);
    finalize(b, fullMonths(start < fromDate ? fromDate : start, end > toDate ? toDate : end));
  }
  total.notices = [...notices.values()];
  return {fromDate, toDate, group, sources:{documents:documentsKnown, expenses:expensesKnown}, total, buckets:[...buckets.values()].sort((a, b) => a.key.localeCompare(b.key)), records,
    issues:total.issues, notices:total.notices,
    ...Object.fromEntries(Object.entries(total).filter(([key]) => key.endsWith('Complete') || ['complete', 'profitCents', 'vatBalanceCents'].includes(key))),
    complete:total.complete && errors.length === 0};
}
export function reportCsv(rows) {
  const cell = value => '"' + String(typeof value === 'string' && /^[=+\-@\t\r\n]/.test(value) ? "'" + value : value ?? '').replaceAll('"', '""') + '"';
  return '\ufeff' + rows.map(row => row.map(cell).join(',')).join('\r\n');
}
