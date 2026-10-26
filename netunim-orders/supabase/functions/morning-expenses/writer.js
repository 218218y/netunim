import {expensePermission, expenseUuid, expenseClassification, expenseSupplier, expenseRecord, expensePage} from './service.js';
import {expenseCents, normalizeExpenseInput} from './input.js';
import {completePProfiles, verifyPProfiles} from './p-suppliers.js';

const digest = async value => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(value)))), x => x.toString(16).padStart(2, '0')).join('');
const response = (status, body) => ({status, body:{ok:status < 400, ...body}});
const todayInIsrael = () => new Intl.DateTimeFormat('en-CA', {timeZone:'Asia/Jerusalem', year:'numeric', month:'2-digit', day:'2-digit'}).format(new Date());
export function createExpenseWriter({request, ledger, environment, enabled = false, writeIds = () => '', pSuppliers = () => [], today = todayInIsrael}) {
  const authorized = user => environment === 'sandbox' && expensePermission(user, 'write', writeIds());
  const allowed = user => authorized(user) && enabled === true && completePProfiles(pSuppliers());
  async function canonical(input) {
    await verifyPProfiles(request, pSuppliers());
    const supplier = expenseSupplier(await request('/suppliers/' + input.supplierId, {method:'GET'}));
    if (pSuppliers().some(profile => profile.id === supplier.id || profile.taxId === supplier.taxId)) throw new Error('morning_expense_p_unverified');
    if (supplier.id !== input.supplierId || !supplier.active || supplier.country !== 'IL' || !/^\d{9}$/.test(supplier.taxId)) throw new Error('invalid_expense_supplier');
    const evidence = await request('/expenses/' + input.classificationExpenseId, {method:'GET'});
    if (evidence?.id !== input.classificationExpenseId || evidence.status === 100) throw new Error('invalid_expense_classification');
    const classification = expenseClassification(evidence.accountingClassification);
    if (!classification) throw new Error('invalid_expense_classification');
    return {documentType:input.documentType, number:input.number, date:input.date, reportingDate:input.reportingDate,
      currency:'ILS', currencyRate:1, amount:input.grossCents / 100, vat:input.vatCents / 100, pcnClassification:'T', description:input.description,
      ...(input.allocationNumber ? {allocationNumber:input.allocationNumber} : {}),
      supplier:{name:supplier.name, taxId:supplier.taxId, country:'IL', add:false}, accountingClassification:{id:classification.id}};
  }
  function matches(raw, payload) {
    return expenseUuid(raw?.id) && raw.documentType === payload.documentType && raw.number === payload.number && raw.date === payload.date &&
      raw.reportingDate === payload.reportingDate && raw.currency === 'ILS' && expenseCents(raw.amount) === expenseCents(payload.amount) &&
      expenseCents(raw.vat) === expenseCents(payload.vat) && raw.supplier?.taxId === payload.supplier.taxId &&
      raw.accountingClassification?.id === payload.accountingClassification.id && raw.data?.pcnClassification === 'T' &&
      (!payload.allocationNumber || raw.allocationNumber === payload.allocationNumber) && [10, 20, 30, 40].includes(raw.status);
  }
  const summary = row => ({operationId:row.operation_id, state:row.state, expenseId:row.expense_id || '', verified:row.state === 'created' && !!row.verified_at,
    fileLinked:false, approvalVerified:false, reportingVerified:false});
  async function verify(user, row) {
    if (!row.expense_id) return response(202, {...summary(row), code:'morning_expense_reconciliation_required'});
    const raw = await request('/expenses/' + row.expense_id, {method:'GET'});
    if (raw?.id !== row.expense_id || !matches(raw, row.payload)) return response(202, {...summary(row), code:'morning_expense_verification_pending'});
    const saved = row.state === 'created' ? row : await ledger.transition(user.id, row.operation_id, row.state, {state:'created', verified_at:new Date().toISOString()});
    if (!saved) throw new Error('morning_expense_storage_failed');
    return response(200, {...summary(saved), item:expenseRecord(raw), fileLinked:!!raw.url});
  }
  return {
    allowed,
    async readiness(user) { if (!allowed(user)) return false; try {await verifyPProfiles(request, pSuppliers()); return true;} catch {return false;} },
    profiles:() => pSuppliers().map(profile => ({id:expenseUuid(profile?.id) ? profile.id : '', taxId:typeof profile?.taxId === 'string' ? profile.taxId : ''})).filter(profile => profile.id || profile.taxId),
    async handle(user, body) {
      const recovering = ['operation_status', 'reconcile'].includes(body?.action);
      if (!(recovering ? authorized(user) : allowed(user))) return response(403, {code:'morning_expense_writes_unverified', message:'שמירת הוצאות דורשת Sandbox מורשה ושתי זהויות ספקי P מאומתות.'});
      try {
        if (!expenseUuid(body.operationId)) throw new Error('invalid_expense_input');
        const existing = await ledger.get(user.id, body.operationId);
        if (body.action === 'reconcile') {
          if (!existing || !['pending', 'needs_reconciliation'].includes(existing.state) || !expenseUuid(body.expenseId)) throw new Error('invalid_expense_input');
          const raw = await request('/expenses/' + body.expenseId, {method:'GET'});
          if (raw?.id !== body.expenseId || !matches(raw, existing.payload)) throw new Error('invalid_expense_input');
          const saved = await ledger.transition(user.id, existing.operation_id, existing.state, {state:'created_unverified', expense_id:raw.id});
          if (!saved) throw new Error('morning_expense_storage_failed');
          return await verify(user, saved);
        }
        if (body.action === 'operation_status') {
          if (!existing) return response(404, {code:'morning_expense_operation_missing', message:'פעולת הקליטה לא נמצאה.'});
          return await verify(user, existing);
        }
        const input = normalizeExpenseInput(body, today());
        const fingerprint = await digest(input);
        if (existing) {
          if (existing.request_fingerprint !== fingerprint) return response(409, {code:'morning_expense_operation_conflict', message:'מזהה הפעולה כבר משויך לפרטים אחרים.'});
          return await verify(user, existing); // Never POST again, even after a lost response.
        }
        const payload = await canonical(input);
        const identity = await digest([payload.supplier.taxId, payload.documentType, payload.number, payload.date.slice(0, 4)]);
        // Search every matching page before any write. No reporting-month filter:
        // the same invoice may have been entered under another reporting month.
        let pages = 1, total = null;
        const seen = new Set();
        for (let page = 0; page < pages; page++) {
          // API-created supplier snapshots can omit the directory supplier ID.
          // Sandbox proved supplierId filters miss those expenses. Match tax ID
          // after a complete number search, including expenses entered elsewhere.
          const data = await request('/expenses/search', {method:'POST', body:JSON.stringify({number:input.number, page:page + 1, pageSize:50})});
          const found = expensePage(data, page, expenseRecord); pages = found.pages;
          if (total !== null && total !== found.total || found.items.some(item => seen.has(item.id))) throw new Error('morning_expense_duplicate_check_incomplete');
          total = found.total; found.items.forEach(item => seen.add(item.id));
          if (pages > 20) throw new Error('morning_expense_duplicate_check_incomplete');
          if (found.items.some(item => item.status !== 100 && item.number === input.number && item.type === input.documentType &&
              (!item.supplierTaxId || item.supplierTaxId === payload.supplier.taxId) && (!item.sourceDocumentDate || item.sourceDocumentDate.slice(0, 4) === input.date.slice(0, 4)))) {
            return response(409, {code:'morning_expense_duplicate', message:'חשבונית עם אותו ספק, מספר, סוג ושנה כבר קיימת ב־Morning.'});
          }
        }
        // Failed read-only preflight creates no permanent lock. Reserve atomically
        // AFTER the reads and BEFORE POST; concurrent workers still have one winner.
        let row = await ledger.reserve({owner_id:user.id, operation_id:body.operationId, invoice_identity:identity, request_fingerprint:fingerprint, state:'reserved', payload});
        if (!row) return response(409, {code:'morning_expense_duplicate_operation', message:'החשבונית או הפעולה כבר נבדקת. אין לשלוח שוב.'});
        row = await ledger.transition(user.id, row.operation_id, 'reserved', {state:'pending', sent_at:new Date().toISOString()});
        if (!row) throw new Error('morning_expense_storage_failed');
        let raw;
        try { raw = await request('/expenses', {method:'POST', body:JSON.stringify(payload)}); }
        catch {
          await ledger.transition(user.id, row.operation_id, 'pending', {state:'needs_reconciliation'});
          return response(202, {...summary(row), state:'needs_reconciliation', code:'morning_expense_reconciliation_required', message:'תוצאת השליחה אינה ידועה. יש לבדוק ב־Morning; אין ליצור שוב.'});
        }
        if (!expenseUuid(raw?.id)) {
          await ledger.transition(user.id, row.operation_id, 'pending', {state:'needs_reconciliation'});
          return response(202, {...summary(row), state:'needs_reconciliation', code:'morning_expense_reconciliation_required'});
        }
        row = await ledger.transition(user.id, row.operation_id, 'pending', {state:'created_unverified', expense_id:raw.id});
        if (!row) throw new Error('morning_expense_storage_failed');
        return await verify(user, row);
      } catch (error) {
        const code = ['invalid_expense_input', 'invalid_expense_amounts', 'invalid_expense_supplier', 'invalid_expense_classification', 'invalid_expense_reporting_period', 'expense_reporting_confirmation_required', 'morning_expense_p_unverified', 'morning_expense_p_profiles_unverified'].includes(error.message) ? error.message : 'morning_expense_verification_unavailable';
        return response(code.startsWith('invalid_') || code.endsWith('_unverified') || code === 'expense_reporting_confirmation_required' ? 400 : 503, {code,
          message:code === 'morning_expense_p_unverified' ? 'חשבוניות P מחייבות עדיין קליטה ואימות ב־Morning.' : 'הקליטה לא הושלמה או לא אומתה. יש לבדוק את מצב הפעולה לפני ניסיון נוסף.'});
      }
    },
  };
}
