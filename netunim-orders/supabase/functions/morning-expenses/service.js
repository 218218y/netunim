import {reportDate, reportExpense} from '../morning-documents/reports.js';

export const expenseUuid = value => typeof value === 'string' && /^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/i.test(value);
const text = (value, max = 180) => typeof value === 'string' ? value.slice(0, max) : '';
const object = value => value && typeof value === 'object' && !Array.isArray(value);
export function expensePermission(user, kind, ids = '') {
  return !!user?.id && (user.app_metadata?.[`morning_expenses_${kind}`] === true || ids.split(',').map(id => id.trim()).filter(Boolean).includes(user.id));
}
function pageInput(body) {
  const page = body.page ?? 0;
  if (!Number.isSafeInteger(page) || page < 0 || page >= 1000) throw new Error('invalid_expense_input');
  return {page, pageSize:50};
}
export function expensePage(data, page, project) {
  const size = 50, count = Math.max(0, Math.min(size, data?.total - page * size));
  if (!object(data) || !Number.isSafeInteger(data.total) || data.total < 0 || data.page !== page + 1 || data.pageSize !== size ||
      !Number.isSafeInteger(data.pages) || data.pages !== Math.ceil(data.total / size) && !(data.total === 0 && data.pages === 1) ||
      !Array.isArray(data.items) || data.items.length !== count) throw new Error('invalid_expense_page');
  const items = data.items.map(project);
  if (new Set(items.map(item => item.id)).size !== items.length) throw new Error('invalid_expense_page');
  return {page, pageSize:size, total:data.total, pages:data.pages, items};
}
export function expenseSupplier(raw) {
  if (!expenseUuid(raw?.id) || !text(raw.name) || typeof raw.active !== 'boolean') throw new Error('invalid_expense_supplier');
  return {id:raw.id, name:text(raw.name), taxId:text(raw.taxId, 30), active:raw.active, country:text(raw.country, 2)};
}
export function expenseClassification(raw) {
  if (!expenseUuid(raw?.id) || !text(raw.title)) return null;
  const percent = value => typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 100 ? value : null;
  return {id:raw.id, title:text(raw.title), key:text(raw.key, 60), income:percent(raw.income), vat:percent(raw.vat), mixed:percent(raw.mixed)};
}
export function expenseRecord(raw) {
  return {...reportExpense(raw), supplierId:expenseUuid(raw.supplier?.id) ? raw.supplier.id : '',
    supplierTaxId:text(raw.supplier?.taxId, 30), classification:expenseClassification(raw.accountingClassification),
    pcnClassification:text(raw.data?.pcnClassification, 1), pcnTaxId:text(raw.data?.pcnTaxId, 30), hasFile:typeof raw.url === 'string' && !!raw.url};
}
function draftRecord(raw) {
  if (!expenseUuid(raw?.id) || ![10, 50, 200].includes(raw.status)) throw new Error('invalid_expense_draft');
  const item = object(raw.expense) ? raw.expense : {};
  // Draft OCR values remain suggestions. Never coerce partial OCR into a saved expense.
  return {id:raw.id, status:raw.status, number:text(item.number, 60), name:text(item.supplier?.name),
    description:text(item.description, 250), date:text(item.date, 30), reportingDate:text(item.reportingDate, 30),
    amount:typeof item.amount === 'number' && Number.isFinite(item.amount) ? item.amount : null,
    vat:typeof item.vat === 'number' && Number.isFinite(item.vat) ? item.vat : null,
    currency:text(item.currency, 3), hasFile:typeof raw.url === 'string' && !!raw.url, approved:false};
}
export function expenseSearchInput(body, draft = false) {
  const {page, pageSize} = pageInput(body), from = body.fromDate, to = body.toDate;
  if (!reportDate(from) || !reportDate(to) || from > to || Number(to.slice(0, 4)) - Number(from.slice(0, 4)) > 10 ||
      !draft && (!from.endsWith('-01') || !to.endsWith('-01'))) throw new Error('invalid_expense_input');
  if (body.supplierId && !expenseUuid(body.supplierId)) throw new Error('invalid_expense_input');
  if (body.number !== undefined && (typeof body.number !== 'string' || body.number.length > 60)) throw new Error('invalid_expense_input');
  return {page, payload:{page:page + 1, pageSize, fromDate:from, toDate:to,
    ...(body.supplierId ? {supplierId:body.supplierId} : {}), ...(!draft && body.number ? {number:body.number} : {})}};
}
export function createExpenseService({request, environment, readIds = () => '', writer = null, uploader = null}) {
  return async function handle(user, body) {
    if (!expensePermission(user, 'read', readIds())) return {status:403, body:{ok:false, code:'morning_expenses_forbidden', message:'אין הרשאה לצפייה בהוצאות Morning.'}};
    try {
      if (!object(body)) throw new Error('invalid_expense_input');
      const action = body.action;
      const command = ['create', 'operation_status', 'reconcile', 'cancel_reserved', 'upload_prepare', 'upload_ticket', 'upload_ack', 'upload_status'].includes(action);
      if ((command || body.expectedEnvironment !== undefined) && body.expectedEnvironment !== environment) return {status:409,
        body:{ok:false, code:'morning_expense_environment_changed', message:'סביבת Morning השתנתה מאז טעינת המסך. יש לרענן לפני המשך הפעולה.'}};
      if (action === 'capabilities') return {status:200, body:{ok:true, version:1, environment, read:true, create:await writer?.readiness(user) === true, upload:uploader?.allowed(user) === true, pcnP:false,
        draftApproval:false, classificationSource:'existing_expenses', pSuppliers:writer?.profiles() || []}};
      if (command) {
        const handler = action.startsWith('upload_') ? uploader : writer;
        if (!handler) return {status:503, body:{ok:false, code:'morning_expenses_not_configured', message:'יומן פעולות ההוצאות אינו זמין.'}};
        const result = await handler.handle(user, body);
        return {...result, body:{...result.body, version:1, environment}};
      }
      let result;
      if (action === 'suppliers') {
        const {page, pageSize} = pageInput(body);
        if (body.name !== undefined && (typeof body.name !== 'string' || body.name.length > 180)) throw new Error('invalid_expense_input');
        if (body.taxId !== undefined && (typeof body.taxId !== 'string' || !/^\d{9}$/.test(body.taxId))) throw new Error('invalid_expense_input');
        result = expensePage(await request('/suppliers/search', {method:'POST', body:JSON.stringify({page:page + 1, pageSize, active:true,
          ...(body.name ? {name:body.name} : {}), ...(body.taxId ? {taxId:body.taxId} : {})})}), page, expenseSupplier);
      } else if (action === 'expenses' || action === 'drafts') {
        const draft = action === 'drafts', {page, payload} = expenseSearchInput(body, draft);
        result = expensePage(await request(draft ? '/expenses/drafts/search' : '/expenses/search', {method:'POST', body:JSON.stringify(payload)}), page, draft ? draftRecord : expenseRecord);
      } else if (action === 'get_expense') {
        if (!expenseUuid(body.id)) throw new Error('invalid_expense_input');
        const raw = await request('/expenses/' + body.id, {method:'GET'});
        if (raw?.id !== body.id) throw new Error('invalid_expense_record');
        result = {item:expenseRecord(raw)};
      } else if (action === 'get_supplier') {
        if (!expenseUuid(body.id)) throw new Error('invalid_expense_input');
        const raw = await request('/suppliers/' + body.id, {method:'GET'});
        if (raw?.id !== body.id) throw new Error('invalid_expense_supplier');
        result = {item:expenseSupplier(raw)};
      } else return {status:400, body:{ok:false, code:'morning_expenses_unknown_action', message:'פעולת הוצאות אינה מוכרת.'}};
      return {status:200, body:{ok:true, version:1, environment, ...result, readAt:new Date().toISOString()}};
    } catch (error) {
      const input = error.message === 'invalid_expense_input';
      if (!input) console.error('morning_expenses_source_failed', {
        code:['morning_auth_failed', 'morning_source_failed', 'morning_response_invalid', 'invalid_expense_page', 'invalid_expense_supplier', 'invalid_expense_record'].includes(error.message) ? error.message : 'unavailable',
        status:Number.isSafeInteger(error.status) ? error.status : null,
      });
      return {status:input ? 400 : 502, body:{ok:false, code:input ? 'invalid_expense_input' : 'morning_expenses_source_failed',
        message:input ? 'פרטי החיפוש אינם תקינים.' : 'לא ניתן לקרוא את ההוצאות מ־Morning. יש לנסות שוב.'}};
    }
  };
}
