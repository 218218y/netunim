export const REPORT_METHODS = Object.freeze({credit:'אשראי', cash:'מזומן', cheque:'צ׳קים', bank:'העברה בנקאית', paypal:'PayPal', app:'אפליקציות תשלום', other:'אחר', withholding:'ניכוי במקור', unknown:'ללא פירוט'});
const METHODS = {0:'withholding', 1:'cash', 2:'cheque', 3:'credit', 4:'bank', 5:'paypal', 10:'app', 11:'other'};
export const REPORT_TYPES = {305:'חשבונית מס', 320:'חשבונית מס / קבלה', 330:'חשבונית זיכוי', 400:'קבלה', 405:'קבלה על תרומה', 410:'ביטול תרומה'};
export function validReportDate(value) {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value;
}
export function reportPeriod(mode, year, part = 1) {
  year = Number(year); part = Number(part);
  const lengths = {month:1, bimonth:2, quarter:3, year:12}, length = lengths[mode];
  if (!Number.isInteger(year) || year < 2000 || year > 2099 || !length || !Number.isInteger(part) || part < 1 || part > 12 / length) throw new Error('יש לבחור תקופה תקינה');
  const month = (part - 1) * length + 1;
  return {fromDate:`${year}-${String(month).padStart(2, '0')}-01`, toDate:new Date(Date.UTC(year, month + length - 1, 0)).toISOString().slice(0, 10)};
}
const SUM_FIELDS = ['incomeCents', 'expensesCents', 'receiptsCents', 'outputVatCents', 'inputVatCents', 'deductibleExpensesCents'];
const zero = () => ({...Object.fromEntries(SUM_FIELDS.map(key => [key, 0])), methods:Object.fromEntries(Object.keys(REPORT_METHODS).map(key => [key, 0])), records:[]});
const moneyValue = value => Number.isSafeInteger(value);
const signed = (row, value) => [330, 410].includes(row.type) ? -Math.abs(value) : value;
export function reportBucketKey(date, group) {
  if (group === 'day') return date;
  if (group === 'year') return date.slice(0, 4);
  const length = group === 'bimonth' ? 2 : group === 'quarter' ? 3 : 1;
  const month = Math.floor((Number(date.slice(5, 7)) - 1) / length) * length + 1;
  return date.slice(0, 4) + '-' + String(month).padStart(2, '0');
}
export function buildMorningReport({documents, expenses, fromDate, toDate, group = 'month', errors = []}) {
  if (!validReportDate(fromDate) || !validReportDate(toDate) || fromDate > toDate) throw new Error('טווח התאריכים אינו תקין');
  const total = zero(), buckets = new Map(), issues = new Map(), notices = new Map(), records = [];
  const issue = (code, label) => issues.set(code, {code, label, count:(issues.get(code)?.count || 0) + 1});
  let incomeComplete = Array.isArray(documents), expensesComplete = Array.isArray(expenses), receiptsComplete = Array.isArray(documents);
  let outputVatComplete = Array.isArray(documents), inputVatComplete = Array.isArray(expenses), deductibleExpensesComplete = Array.isArray(expenses);
  const fullVatPeriod = fromDate.endsWith('-01') && new Date(Date.parse(toDate) + 86400000).getUTCDate() === 1;
  if (!fullVatPeriod) issue('vat-period', 'סיכום מע״מ דורש חודשים מלאים; יש לבחור חודש או דו־חודש זוגי');
  function bucket(date) {
    const key = reportBucketKey(date, group);
    if (!buckets.has(key)) buckets.set(key, {key, ...zero()});
    return buckets.get(key);
  }
  for (const row of [...(documents || []), ...(expenses || [])]) {
    if (row.date < fromDate || row.date > toDate) continue;
    if (row.kind === 'expense' && row.status === 100) continue;
    const b = bucket(row.date), entry = {...row, ...Object.fromEntries(SUM_FIELDS.map(key => [key, 0])), methods:{}};
    const hasMoney = moneyValue(row.grossCents) && moneyValue(row.vatCents);
    if (row.kind === 'expense') {
      if (hasMoney) entry.expensesCents = signed(row, row.grossCents) - signed(row, row.vatCents);
      else { expensesComplete = false; issue('expense-money', 'חסרים סכום, מע״מ או שער המרה בהוצאות'); }
      if (moneyValue(row.deductibleVatCents)) entry.inputVatCents = signed(row, row.deductibleVatCents);
      else { inputVatComplete = false; issue('input-vat', 'חסר סכום מע״מ תשומות מותר ממורנינג; אין השלמה ממע״מ החשבונית'); }
      if (moneyValue(row.deductibleCents)) entry.deductibleExpensesCents = signed(row, row.deductibleCents);
      else deductibleExpensesComplete = false;
      // Morning status 30 describes an edited expense, not missing amounts.
      // Sum the current source values; historical filed reports need reconciliation.
      if (row.status === 30) notices.set('expense-edited', {code:'expense-edited', label:'הוצאות שנערכו מחדש נכללות לפי הנתונים העדכניים במורנינג', count:(notices.get('expense-edited')?.count || 0) + 1});
    } else {
      const receipt = [320, 400, 405, 410].includes(row.type);
      const exempt = [3, 4, 5].includes(row.businessType);
      const isIncome = !row.selfInvoice && ([305, 320, 330].includes(row.type) || exempt && [400, 405, 410].includes(row.type));
      if ([400, 405, 410].includes(row.type) && row.businessType === null) { incomeComplete = false; issue('business-type', 'חסר סוג העסק בקבלות לצורך סיווג ההכנסה'); }
      if (isIncome) {
        if (hasMoney) entry.incomeCents = signed(row, row.grossCents) - signed(row, row.vatCents);
        else { incomeComplete = false; issue('income-money', 'חסרים סכום, מע״מ או שער המרה במסמכי הכנסה'); }
      }
      if ([305, 320, 330].includes(row.type)) {
        if (row.selfInvoice) { outputVatComplete = false; issue('self-vat', 'חשבוניות עצמיות דורשות התאמת מע״מ בדוח הרשמי'); }
        else if (moneyValue(row.vatCents)) entry.outputVatCents = signed(row, row.vatCents);
        else { outputVatComplete = false; issue('output-vat', 'חסר סכום מע״מ שקלי במסמכי ההכנסה'); }
      }
      if (receipt) {
        if (moneyValue(row.grossCents)) {
          entry.receiptsCents = signed(row, row.grossCents);
          const payments = row.payments || [];
          const allPositive = payments.length > 0 && payments.every(p => moneyValue(p.amountCents) && p.amountCents >= 0);
          let paymentTotal = 0;
          for (const payment of payments) {
            if (!moneyValue(payment.amountCents)) { receiptsComplete = false; issue('payment-money', 'חסר סכום או שער המרה בתקבולים'); continue; }
            let value = signed(row, payment.amountCents);
            if (entry.receiptsCents < 0 && allPositive) value = -Math.abs(value);
            const method = METHODS[payment.type] || 'unknown';
            if (method === 'unknown') { receiptsComplete = false; issue('payment-type', 'אמצעי תשלום לא מוכר מוצג ללא פירוט'); }
            entry.methods[method] = (entry.methods[method] || 0) + value;
            paymentTotal += value;
          }
          const delta = entry.receiptsCents - paymentTotal;
          if (delta !== 0) {
            entry.methods.unknown = (entry.methods.unknown || 0) + delta;
            receiptsComplete = false; issue('payment-difference', 'פירוט אמצעי התשלום חסר או אינו תואם לסכום הקבלה');
          }
        } else { receiptsComplete = false; issue('receipt-money', 'חסר סכום שקלי בתקבולים'); }
      }
    }
    for (const field of SUM_FIELDS) { b[field] += entry[field]; total[field] += entry[field]; }
    for (const [method, value] of Object.entries(entry.methods)) { b.methods[method] += value; total.methods[method] += value; }
    b.records.push(entry); records.push(entry);
  }
  for (const error of errors) issue(`source-${error.source}`, error.message);
  // Retain zero-activity months so a yearly report is comparable month to month.
  if (['month', 'bimonth', 'quarter'].includes(group)) {
    for (let month = fromDate.slice(0, 7); month <= toDate.slice(0, 7);) {
      bucket(month + '-01');
      const [year, part] = month.split('-').map(Number);
      month = new Date(Date.UTC(year, part, 1)).toISOString().slice(0, 7);
    }
  }
  const safe = [total, ...buckets.values()].every(b => SUM_FIELDS.every(key => Number.isSafeInteger(b[key])) && Object.values(b.methods).every(Number.isSafeInteger));
  if (!safe) throw new Error('סכומי הדוח חורגים מטווח החישוב הנתמך');
  const profitComplete = incomeComplete && expensesComplete;
  const vatComplete = outputVatComplete && inputVatComplete && fullVatPeriod;
  return {fromDate, toDate, group, total, buckets:[...buckets.values()].sort((a, b) => a.key.localeCompare(b.key)), records,
    issues:[...issues.values()], notices:[...notices.values()], incomeComplete, expensesComplete, receiptsComplete, profitComplete,
    outputVatComplete, inputVatComplete, vatComplete, deductibleExpensesComplete,
    vatBalanceCents:vatComplete ? total.outputVatCents - total.inputVatCents : null,
    complete:profitComplete && receiptsComplete && vatComplete && errors.length === 0,
    profitCents:profitComplete ? total.incomeCents - total.expensesCents : null};
}
export function reportCsv(rows) {
  const cell = value => '"' + String(typeof value === 'string' && /^[=+\-@\t\r\n]/.test(value) ? "'" + value : value ?? '').replaceAll('"', '""') + '"';
  return '\ufeff' + rows.map(row => row.map(cell).join(',')).join('\r\n');
}
