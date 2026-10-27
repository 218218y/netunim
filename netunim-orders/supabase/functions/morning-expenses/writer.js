import {expenseUuid, expenseClassification, expenseSupplier, expenseRecord} from './service.js';
import {normalizeExpenseInput} from './input.js';
import {completePProfiles, verifyPProfiles} from './p-suppliers.js';
import {expenseWriteAccess} from './write-access.js';
import {expenseMatchesIntent} from './intent.js';
import {findExpenseDuplicate} from './duplicates.js';
import {normalizeExpenseSource,normalizeExpenseSourceReview,expenseSourceExpected,expenseSourceSummary,inspectExpenseSource} from './source.js';

const digest = async value => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(value)))), x => x.toString(16).padStart(2, '0')).join('');
const response = (status, body) => ({status, body:{ok:status < 400, ...body}});
const todayInIsrael = () => new Intl.DateTimeFormat('en-CA', {timeZone:'Asia/Jerusalem', year:'numeric', month:'2-digit', day:'2-digit'}).format(new Date());
export function createExpenseWriter({request, ledger, environment, enabled = false, pcnP = false, writeIds = () => '', productionUserId = '', pSuppliers = () => [], today = todayInIsrael, verifySource}) {
  const authorized = user => expenseWriteAccess(user, environment, writeIds(), productionUserId);
  const allowed = user => authorized(user) && enabled === true && completePProfiles(pSuppliers());
  async function canonical(input) {
    await verifyPProfiles(request, pSuppliers());
    const supplier = expenseSupplier(await request('/suppliers/' + input.supplierId, {method:'GET'}));
    const protectedProfile = pSuppliers().find(profile => profile.id === supplier.id || profile.taxId === supplier.taxId), p = input.pcnClassification === 'P';
    if (protectedProfile && !p) throw new Error('morning_expense_p_unverified');
    if (p && (!pcnP || !protectedProfile || protectedProfile.id !== supplier.id || protectedProfile.taxId !== supplier.taxId)) throw new Error('morning_expense_p_unverified');
    if (supplier.id !== input.supplierId || !supplier.active || !(p ? ['IL', 'PS'].includes(supplier.country) : supplier.country === 'IL') || !/^\d{9}$/.test(supplier.taxId)) throw new Error('invalid_expense_supplier');
    const evidence = await request('/expenses/' + input.classificationExpenseId, {method:'GET'});
    if (evidence?.id !== input.classificationExpenseId || evidence.status === 100) throw new Error('invalid_expense_classification');
    const classification = expenseClassification(evidence.accountingClassification);
    if (!classification) throw new Error('invalid_expense_classification');
    return {documentType:input.documentType, number:input.number, date:input.date, reportingDate:input.reportingDate,
      currency:'ILS', currencyRate:1, amount:input.grossCents / 100, vat:input.vatCents / 100, pcnClassification:input.pcnClassification, description:input.description,
      ...(input.allocationNumber ? {allocationNumber:input.allocationNumber} : {}),
      supplier:{name:supplier.name, taxId:supplier.taxId, country:supplier.country, add:false}, accountingClassification:{id:classification.id}};
  }
  const summary = row => ({operationId:row.operation_id, state:row.state, expenseId:row.expense_id || '', verified:row.state === 'created' && !!row.verified_at,
    cancelled:row.state === 'cancelled', intent:{number:row.payload.number, documentType:row.payload.documentType, date:row.payload.date,
      reportingDate:row.payload.reportingDate, supplierName:row.payload.supplier?.name, supplierTaxId:row.payload.supplier?.taxId,
      pcnClassification:row.payload.pcnClassification,allocationNumber:row.payload.allocationNumber||'',amount:row.payload.amount,vat:row.payload.vat},
    ...expenseSourceSummary(row),fileState:row.file_state || 'not_started', fileLinked:false, approvalVerified:false, reportingVerified:false});
  async function verify(user, row) {
    if (row.state === 'cancelled') return response(200, summary(row));
    if (!row.expense_id) return response(202, {...summary(row), code:'morning_expense_reconciliation_required'});
    const raw = await request('/expenses/' + row.expense_id, {method:'GET'});
    if (raw?.id !== row.expense_id || !expenseMatchesIntent(raw, row.payload)) {
      const saved = row.state === 'created' ? await ledger.transition(user.id, row.operation_id, 'created', {state:'created_unverified', verified_at:null}) : row;
      if (!saved) throw new Error('morning_expense_storage_failed');
      return response(202, {...summary(saved), verified:false, code:'morning_expense_verification_pending'});
    }
    const saved = row.state === 'created' ? row : await ledger.transition(user.id, row.operation_id, row.state, {state:'created', verified_at:new Date().toISOString()});
    if (!saved) throw new Error('morning_expense_storage_failed');
    const source=await inspectExpenseSource(saved,raw,environment,{verifySource});
    if(saved.source_metadata&&!!saved.source_verified_at!==source.sourceVerified){
      const marked=await ledger.fileTransition(user.id,saved,{source_verified_at:source.sourceVerified?new Date().toISOString():null});
      if(!marked)throw Error('morning_expense_storage_failed');source.sourceVerifiedAt=marked.source_verified_at;
    }
    return response(200, {...summary(saved),...source,item:expenseRecord(raw),fileLinked:!!raw.url});
  }
  return {
    allowed,
    sourceIntent:true,
    async readiness(user) { if (!allowed(user)) return false; try {await verifyPProfiles(request, pSuppliers()); return true;} catch {return false;} },
    pcnEnabled:user => allowed(user) && pcnP === true,
    profiles:() => pSuppliers().map(profile => ({id:expenseUuid(profile?.id) ? profile.id : '', taxId:typeof profile?.taxId === 'string' ? profile.taxId : ''})).filter(profile => profile.id || profile.taxId),
    async handle(user, body) {
      const recovering = ['operation_status', 'reconcile', 'cancel_reserved','duplicate_check','source_pending'].includes(body?.action);
      if (!(recovering ? authorized(user) : allowed(user))) return response(403, {code:'morning_expense_writes_unverified', message:'שמירת הוצאות דורשת הפעלה והרשאה בסביבת החשבון ושתי זהויות ספקי P מאומתות.'});
      try {
        if(body.action==='source_pending'){
          const page=body.page??0;if(!Number.isSafeInteger(page)||page<0||page>99)throw Error('invalid_expense_input');
          const rows=await ledger.pendingSources(user.id,page);return response(200,{items:rows.map(summary),page,pageSize:20});
        }
        if (!expenseUuid(body.operationId)) throw new Error('invalid_expense_input');
        const existing = await ledger.get(user.id, body.operationId);
        if (body.action === 'cancel_reserved') {
          if (!existing) return response(404, {code:'morning_expense_operation_missing'});
          if (existing.state === 'cancelled') return response(200, summary(existing));
          const saved = await ledger.cancelReserved(user.id, body.operationId);
          if (!saved) return response(409, {code:'morning_expense_cancel_conflict'});
          return response(200, summary(saved));
        }
        if (body.action === 'reconcile') {
          if (!existing || !['pending', 'needs_reconciliation'].includes(existing.state) || !expenseUuid(body.expenseId)) throw new Error('invalid_expense_input');
          const raw = await request('/expenses/' + body.expenseId, {method:'GET'});
          if (raw?.id !== body.expenseId || !expenseMatchesIntent(raw, existing.payload)) throw new Error('invalid_expense_input');
          const saved = await ledger.transition(user.id, existing.operation_id, existing.state, {state:'created_unverified', expense_id:raw.id});
          if (!saved) throw new Error('morning_expense_storage_failed');
          return await verify(user, saved);
        }
        if (body.action === 'operation_status') {
          if (!existing) return response(404, {code:'morning_expense_operation_missing', message:'פעולת הקליטה לא נמצאה.'});
          return await verify(user, existing);
        }
        const input = normalizeExpenseInput(body, today(), {allowP:pcnP === true});
        if(body.action==='duplicate_check')return response(200,await findExpenseDuplicate(request,await canonical(input)));
        const source=normalizeExpenseSource(body.sourceFile);
        const fingerprint = await digest(source?{...input,sourceFile:source}:input);
        if (existing) {
          if (existing.request_fingerprint !== fingerprint) return response(409, {code:'morning_expense_operation_conflict', message:'מזהה הפעולה כבר משויך לפרטים אחרים.'});
          return await verify(user, existing); // Never POST again, even after a lost response.
        }
        const payload = await canonical(input);
        const sourceReview=source?{...normalizeExpenseSourceReview(body.sourceReview,expenseSourceExpected(payload)),reviewedAt:new Date().toISOString()}:null;
        const identity = await digest([payload.supplier.taxId, payload.documentType, payload.number, payload.date.slice(0, 4)]);
        // Search every matching page before any write. No reporting-month filter:
        // the same invoice may have been entered under another reporting month.
        const duplicate=await findExpenseDuplicate(request,payload);
        if(duplicate.duplicate)return response(409,{...duplicate,notDispatched:true,code:'morning_expense_duplicate'});
        // Failed read-only preflight creates no permanent lock. Reserve atomically
        // AFTER the reads and BEFORE POST; concurrent workers still have one winner.
        let row = await ledger.reserve({owner_id:user.id, operation_id:body.operationId, invoice_identity:identity, request_fingerprint:fingerprint, state:'reserved', payload,
          ...(source?{source_metadata:source,source_review:sourceReview}:{})});
        if (!row) return response(409, {notDispatched:true,code:'morning_expense_duplicate_operation', message:'החשבונית, הקובץ או הפעולה כבר משויכים לקליטה קיימת. יש לבדוק את הפעולות הממתינות; לא נשלחה יצירה נוספת.'});
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
        const code = ['invalid_expense_source','expense_source_review_required','invalid_expense_input', 'invalid_expense_amounts', 'invalid_expense_p_number', 'invalid_expense_supplier', 'invalid_expense_classification', 'invalid_expense_reporting_period', 'expense_reporting_confirmation_required', 'morning_expense_p_unverified', 'morning_expense_p_profiles_unverified'].includes(error.message) ? error.message : 'morning_expense_verification_unavailable';
        return response(code.startsWith('invalid_') || code.endsWith('_unverified') || code === 'expense_reporting_confirmation_required' || code==='expense_source_review_required' ? 400 : 503, {code,
          message:code==='expense_source_review_required'?'יש לבדוק את התאמת קובץ המקור לפרטי החשבונית לפני שמירה.':
            code === 'morning_expense_p_unverified' ? 'חשבוניות P מחייבות עדיין קליטה ואימות ב־Morning.' : 'הקליטה לא הושלמה או לא אומתה. יש לבדוק את מצב הפעולה לפני ניסיון נוסף.'});
      }
    },
  };
}
