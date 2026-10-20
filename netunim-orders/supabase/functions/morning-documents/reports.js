// Read-only reporting contract. Source: https://developers.morning.co/docs/openapi.bundled.json
// Keep this projection separate from document issuance and its compact browser catalog.
const UUID = /^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/i;
const DOCUMENT_TYPES = [305, 320, 330, 400, 405, 410];
const integer = value => typeof value === 'number' && Number.isSafeInteger(value);
const text = (value, max = 180) => typeof value === 'string' || typeof value === 'number' ? String(value).slice(0, max) : '';
function number(value) {
  return (typeof value === 'number' || typeof value === 'string' && /^-?\d+(\.\d+)?$/.test(value)) && Number.isFinite(Number(value)) ? Number(value) : null;
}
function cents(value, rate = 1) {
  const amount = number(value);
  if (amount === null || rate === null || rate <= 0) return null;
  const result = Math.sign(amount) * Math.round((Math.abs(amount * rate) + Number.EPSILON) * 100);
  return Number.isSafeInteger(result) ? result : null;
}
export function reportDate(value) {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value;
}
export function reportInput(body) {
  const {source, fromDate, toDate, page = 0} = body || {};
  if (!['documents', 'expenses'].includes(source) || !reportDate(fromDate) || !reportDate(toDate) || fromDate > toDate || toDate > String(Number(fromDate.slice(0, 4)) + 10) + fromDate.slice(4) || !integer(page) || page < 0 || page >= 1000) throw new Error('invalid_report_range');
  return {source, fromDate, toDate, page, pageSize:50};
}
export function reportPermission(user, allowedIds = '') {
  return !!user?.id && (user.app_metadata?.morning_reports === true || allowedIds.split(',').map(id => id.trim()).filter(Boolean).includes(user.id));
}
function sourceTimestamp(value) {
  // Morning documents and expenses expose Unix SECONDS, not a document date.
  if (!integer(value) || value < 0 || value > 253402300799) return '';
  return new Date(value * 1000).toISOString();
}
function common(raw, kind) {
  if (!raw || typeof raw !== 'object' || !UUID.test(raw.id)) throw new Error('invalid_report_record');
  const currency = /^[A-Z]{3}$/.test(raw.currency) ? raw.currency : '';
  const rate = currency === 'ILS' ? 1 : number(raw.currencyRate);
  const local = cents(raw.amountLocal), grossCents = local ?? cents(raw.amount, rate);
  const date = kind === 'expense' ? raw.reportingDate : raw.documentDate;
  if (!reportDate(date) || !integer(raw.status)) throw new Error('invalid_report_record');
  const sourceDocumentDate = kind === 'expense' ? (reportDate(raw.date) ? raw.date : '') : raw.documentDate;
  return {id:raw.id, kind, number:text(raw.number, 60), type:kind === 'expense' ? raw.documentType : raw.type,
    // Version 1 aliases remain available. Income raw.date is not an API response
    // field and must never override its documented documentDate reference date.
    date, documentDate:sourceDocumentDate || date, reportingDate:date, sourceDocumentDate,
    createdAt:sourceTimestamp(raw.creationDate), updatedAt:sourceTimestamp(raw.lastUpdateDate), status:raw.status,
    currency, grossCents, vatCents:cents(raw.vat, rate),
    name:text(kind === 'expense' ? raw.supplier?.name : raw.client?.name), description:text(raw.description, 250)};
}
export function reportDocument(raw) {
  const row = common(raw, 'document');
  if (!DOCUMENT_TYPES.includes(row.type) || ![0, 1, 2, 3, 4].includes(row.status)) throw new Error('invalid_report_record');
  const rate = row.currency === 'ILS' ? 1 : number(raw.currencyRate);
  return {...row, selfInvoice:raw.client?.self === true, businessType:[1, 2, 3, 4, 5, 6].includes(raw.business?.type) ? raw.business.type : null,
    payments:Array.isArray(raw.payment) ? raw.payment.map(payment => {
      const currency = payment.currency || row.currency;
      const paymentRate = currency === 'ILS' ? 1 : currency === row.currency ? rate : number(payment.currencyRate);
      return {type:integer(payment.type) ? payment.type : null, amountCents:cents(payment.price, paymentRate),
        date:reportDate(payment.date) ? payment.date : '', chequeNumber:text(payment.chequeNum, 30)};
    }) : null};
}
export function reportExpense(raw) {
  const row = common(raw, 'expense');
  if (![10, 20, 30, 40, 100].includes(row.status) || ![20, 305, 320, 330, 400, 405].includes(row.type) || !row.date.endsWith('-01')) throw new Error('invalid_report_record');
  return {...row, deductibleCents:cents(raw.deductibleAmount), deductibleVatCents:cents(raw.deductibleVat),
    category:text(raw.accountingClassification?.title),
    // Type/key are source evidence, not an inferred official-report inclusion rule.
    categoryKey:text(raw.accountingClassification?.key, 60), categoryCode:text(raw.accountingClassification?.code, 60),
    categoryType:integer(raw.accountingClassification?.type) ? raw.accountingClassification.type : null};
}
export function createMorningReportsHandler({request, environment, allowedIds = () => ''}) {
  return async function reportPage(user, body) {
    if (!reportPermission(user, allowedIds())) return {status:403, body:{ok:false, code:'morning_reports_forbidden', message:'אין הרשאה לצפייה בדוחות העסק במורנינג. יש לפנות למנהל המערכת.'}};
    let input;
    try { input = reportInput(body); }
    catch { return {status:400, body:{ok:false, code:'invalid_report_range', message:'יש לבחור טווח תאריכים תקין של עד עשר שנים.'}}; }
    try {
      const {source, fromDate, toDate, page, pageSize} = input;
      // Expenses search filters REPORTING months, always YYYY-MM-01. Exact dates
      // are applied again by the report engine; never substitute document dates.
      const payload = {page:page + 1, pageSize, fromDate:source === 'expenses' ? fromDate.slice(0, 7) + '-01' : fromDate,
        toDate:source === 'expenses' ? toDate.slice(0, 7) + '-01' : toDate,
        ...(source === 'documents' ? {type:DOCUMENT_TYPES, sort:'documentDate', order:'ASC'} : {})};
      const data = await request(`/${source}/search`, {method:'POST', body:JSON.stringify(payload)});
      if (!Array.isArray(data?.items) || data.items.length > pageSize || !integer(data.total) || data.total < 0 || !integer(data.pages) || data.pages < 0 || data.pages !== Math.ceil(data.total / pageSize) && !(data.total === 0 && data.pages === 1) || data.page !== page + 1 || data.items.length !== Math.max(0, Math.min(pageSize, data.total - page * pageSize))) throw new Error('invalid_report_page');
      const items = data.items.map(source === 'documents' ? reportDocument : reportExpense);
      return {status:200, body:{ok:true, version:1, source, environment, fromDate, toDate, page, pageSize, total:data.total, pages:data.pages, items, readAt:new Date().toISOString()}};
    } catch {
      // Never return upstream payloads or mark an unavailable source as empty.
      return {status:502, body:{ok:false, code:'morning_report_source_failed', message:'לא ניתן לקרוא את נתוני הדוח ממורנינג. יש לנסות לרענן; מקור זה אינו כלול בסיכום.'}};
    }
  };
}
