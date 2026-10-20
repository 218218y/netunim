import {REPORT_METHODS, REPORT_TYPES, reportCsv, reportMetric, validReportDate} from './morning-report-model.js';
import {parseReportAmount} from './morning-report-reconciliation.js';

const METHODS = Object.keys(REPORT_METHODS);
const METRICS = {
  incomeCents:'הכנסות לפני מע״מ', expensesCents:'הוצאות לפני מע״מ', expenseCostCents:'עלות הוצאות ניהולית',
  profitCents:'רווח / הפסד ניהולי', outputVatCents:'מע״מ עסקאות', inputVatCents:'מע״מ תשומות מותר',
  vatBalanceCents:'הפרש לתשלום / להחזר', receiptsCents:'סכום קבלות כולל מע״מ',
};
const TYPES = {
  receipts:{label:'תקבולים לפי אמצעי תשלום', fields:[...METHODS.map(method => ['methods', method]), ['receiptsCents']]},
  profit:{label:'רווח והפסד ניהולי', fields:[['incomeCents'], ['expensesCents'], ['expenseCostCents'], ['profitCents']]},
  vat:{label:'סיכום מע״מ ניהולי', fields:[['outputVatCents'], ['inputVatCents'], ['vatBalanceCents']]},
};
const expenseStatuses = {10:'הוצאה אושרה לדו״ח', 20:'הוצאה נכללת בדו״ח', 30:'הוצאה שנערכה מחדש', 40:'הוצאה אושרה ע״י מייצג', 100:'הוצאה מחוקה'};
const issues = entries => (Array.isArray(entries) ? entries : []).map(item => `${item.code || ''}: ${item.label || ''}${item.count > 1 ? ` (${item.count})` : ''}`).join(' · ');
function decimalText(cents) {
  if (!Number.isSafeInteger(cents)) return '';
  const number = BigInt(cents), absolute = number < 0 ? -number : number;
  return `${number < 0 ? '-' : ''}${absolute / 100n}.${String(absolute % 100n).padStart(2, '0')}`;
}
function money(cents) {
  const text = decimalText(cents);
  if (text === '') return '';
  // Normal spreadsheet cells remain numeric. Unusually large amounts whose
  // decimal cannot round-trip exactly remain exact text rather than lose cents.
  const numeric = Number(text);
  return parseReportAmount(numeric) === cents ? numeric : text;
}
function complete(scope, type) {
  return TYPES[type].fields.every(([field, method]) => reportMetric(scope, field, method) !== null);
}
function known(scope, field, method) {
  const verified = reportMetric(scope, field, method);
  if (verified !== null) return verified;
  if (['profitCents', 'vatBalanceCents'].includes(field)) return null;
  const value = field === 'methods' ? scope.methods?.[method] : scope[field];
  // An unavailable source or a missing amount has no known zero to export.
  return Number.isSafeInteger(value) && value !== 0 ? value : null;
}
function metadataRows(report, metadata, type) {
  return [
    ['דוח ניהולי ממורנינג', TYPES[type].label, 'אינו דוח רשמי ואינו הגשה לרשויות'],
    ['מתאריך', report.fromDate, 'עד תאריך', report.toDate, 'קיבוץ', report.group],
    ['סביבת מורנינג', metadata.environment || '', 'מועד קריאה', metadata.readAt || ''],
    ['מצב התקופה', metadata.openPeriod === true ? 'תקופה פתוחה — נתוני ביניים' : metadata.openPeriod === false ? 'תקופה הסתיימה' : 'לא צוין'],
    ['שלמות הדוח הנבחר', complete(report.total, type) ? 'מלא לפי המקורות שנקראו' : 'נתונים חלקיים — סכום כולל חסר נשאר ריק'],
    ['מטבע סכומים', 'ILS', 'סכומים בטבלאות בשקלים; אין ערבוב עם מטבע המקור'],
    ['בסיס תאריכים', 'הכנסות ותקבולים לפי תאריך מסמך; הוצאות לפי חודש הדיווח במורנינג'],
    ['בסיס רווח ניהולי', 'הכנסות לפני מע״מ פחות הוצאות כולל מע״מ שאינו ניתן לקיזוז; כולל רכישות שנרשמו כהוצאות, ללא התאמות מס ופחת'],
    ...(metadata.selectionLabel ? [['בחירת רשומות מקור', metadata.selectionLabel, 'הסיכום מתייחס לכל הדוח ולא למסנן רשומות המקור']] : []),
    ...(report.issues || []).map(item => ['חוסר בנתונים', item.code, item.label, item.count]),
    ...(report.notices || []).map(item => ['הערה לנתונים העדכניים', item.code, item.label, item.count]),
    [],
  ];
}
function summaryRows(report, type, periodLabel) {
  const fields = TYPES[type].fields, labels = fields.map(([field, method]) => method ? REPORT_METHODS[method] : METRICS[field]);
  const scopes = [...report.buckets.map(bucket => ({label:periodLabel(bucket.key), scope:bucket})), {label:'סה״כ', scope:report.total}];
  return [
    ['סיכום התקופה — סכומים מלאים בלבד'],
    ['תקופה', ...labels, 'שלמות הדוח הנבחר', 'חוסרים'],
    ...scopes.map(({label, scope}) => [label, ...fields.map(([field, method]) => money(reportMetric(scope, field, method))), complete(scope, type) ? 'מלא' : 'חלקי', issues(scope.issues)]),
    [], ['סכומים ידועים בלבד — אינם משלימים סכום כולל חסר'],
    ['תקופה', ...labels],
    ...scopes.filter(({scope}) => fields.some(([field, method]) => reportMetric(scope, field, method) === null))
      .map(({label, scope}) => [label, ...fields.map(([field, method]) => money(known(scope, field, method)))]),
  ];
}
function sourceRows(records) {
  const metric = (row, field) => money(reportMetric(row, field));
  const isReceipt = row => row.kind === 'document' && [320, 400, 405, 410].includes(row.type);
  return [
    ['מסמכי מקור — נתוני המקור וההקצאה המחושבת'],
    ['מזהה מסמך / הוצאה במורנינג', 'מקור', 'תאריך שיוך לדוח', 'תאריך מסמך המקור', 'נוצר במורנינג', 'עודכן במורנינג',
      'סוג מסמך', 'מספר מסמך', 'לקוח / ספק', 'תיאור', 'מטבע מקור', 'סכום מקור כולל מע״מ בש״ח', 'מע״מ מקור בש״ח',
      'הכנסה לפני מע״מ', 'מע״מ עסקאות מחושב', 'הוצאה לפני מע״מ', 'עלות הוצאה ניהולית', 'מע״מ שאינו ניתן לקיזוז', 'מע״מ תשומות מותר', 'סכום הוצאות מוכר ממורנינג', 'סכום קבלה כולל מע״מ',
      ...METHODS.map(method => `תקבולים — ${REPORT_METHODS[method]}`),
      ...METHODS.map(method => `הקצאה ידועה בלבד — ${REPORT_METHODS[method]}`),
      'סיווג הוצאה', 'מפתח סיווג מקור', 'קוד סיווג מקור', 'סוג סיווג מקור', 'סטטוס מקור', 'תיאור סטטוס הוצאה', 'שלמות סכום הקבלה', 'שלמות פירוט אמצעי תשלום', 'חוסרים ברשומה', 'הערות לרשומה'],
    ...records.map(row => [row.id, row.kind === 'expense' ? 'הוצאה' : 'מסמך הכנסה / תקבול', row.reportingDate || row.date, row.sourceDocumentDate ?? row.documentDate ?? '', row.createdAt || '', row.updatedAt || '',
      REPORT_TYPES[row.type] || row.type, row.number, row.name, row.description, row.currency, money(row.grossCents), money(row.vatCents),
      row.kind === 'document' ? metric(row, 'incomeCents') : '', row.kind === 'document' && [305, 320, 330].includes(row.type) ? metric(row, 'outputVatCents') : '',
      row.kind === 'expense' ? metric(row, 'expensesCents') : '', row.kind === 'expense' ? metric(row, 'expenseCostCents') : '',
      row.kind === 'expense' ? metric(row, 'unrecoverableVatCents') : '', row.kind === 'expense' ? metric(row, 'inputVatCents') : '', row.kind === 'expense' ? metric(row, 'deductibleExpensesCents') : '',
      isReceipt(row) ? metric(row, 'receiptsCents') : '',
      ...METHODS.map(method => isReceipt(row) ? money(reportMetric(row, 'methods', method)) : ''),
      ...METHODS.map(method => isReceipt(row) && reportMetric(row, 'methods', method) === null ? money(known(row, 'methods', method)) : ''),
      row.category || '', row.categoryKey || '', row.categoryCode || '', row.categoryType ?? '', row.status, row.kind === 'expense' ? expenseStatuses[row.status] || '' : '',
      isReceipt(row) ? row.receiptAmountComplete ? 'מלא' : 'חלקי' : '', isReceipt(row) ? row.paymentBreakdownComplete ? 'מלא' : 'חלקי' : '', issues(row.issues), issues(row.notices)]),
  ];
}
export function morningReportExportRows({report, kind = 'combined', metadata = {}, periodLabel = key => key, records = report?.records}) {
  const type = metadata.reportType || 'receipts';
  if (!report?.total || !Array.isArray(report.buckets) || !Array.isArray(records) || !validReportDate(report.fromDate) || !validReportDate(report.toDate) || report.fromDate > report.toDate || !Object.hasOwn(TYPES, type) || !['summary', 'sources', 'combined'].includes(kind) || typeof periodLabel !== 'function') throw new Error('invalid_report_export');
  return [...metadataRows(report, metadata, type), ...(kind !== 'sources' ? summaryRows(report, type, periodLabel) : []),
    ...(kind === 'combined' ? [[]] : []), ...(kind !== 'summary' ? sourceRows(records) : [])];
}
export function morningReportCsv(options) {
  return reportCsv(morningReportExportRows(options));
}
