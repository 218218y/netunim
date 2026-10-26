import {expensePermission, expenseUuid} from './service.js';

const TYPES = new Set(['application/pdf', 'image/jpeg', 'image/png']);
const MAX_BYTES = 20 * 1024 * 1024;
export function expenseUploadTicket(raw, environment) {
  const bucket = environment === 'sandbox' ? 'sandbox-file-upload-service-uploaded' : 'file-upload-service-uploaded';
  if (raw?.url !== 'https://s3.eu-west-1.amazonaws.com/' + bucket || !Number.isSafeInteger(raw.maxFileSize) || raw.maxFileSize <= 0 || raw.maxFileSize > MAX_BYTES ||
      !raw.fields || typeof raw.fields !== 'object' || Array.isArray(raw.fields)) throw new Error('invalid_expense_upload_ticket');
  const entries = Object.entries(raw.fields);
  if (!entries.length || entries.length > 40 || entries.some(([key, value]) => key.toLowerCase() === 'file' || typeof value !== 'string' || value.length > 20000)) throw new Error('invalid_expense_upload_ticket');
  for (const key of ['key', 'Policy', 'X-Amz-Algorithm', 'X-Amz-Credential', 'X-Amz-Date', 'X-Amz-Security-Token', 'X-Amz-Signature', 'bucket']) {
    if (!raw.fields[key]) throw new Error('invalid_expense_upload_ticket');
  }
  if (raw.fields.bucket !== bucket || raw.fields['x-amz-meta-file-context'] !== 'expense') throw new Error('invalid_expense_upload_ticket');
  return {url:raw.url, fields:raw.fields, maxFileSize:raw.maxFileSize};
}
export function createExpenseUpload({request, ledger, environment, enabled = false, writeIds = () => '', now = Date.now}) {
  const authorized = user => environment === 'sandbox' && expensePermission(user, 'write', writeIds());
  const allowed = user => enabled === true && authorized(user);
  return {allowed, async handle(user, body) {
    const result = (status, data) => ({status, body:{ok:status < 400, ...data}});
    if (!(body?.action === 'upload_status' ? authorized(user) : allowed(user))) return result(403, {code:'morning_expense_upload_unverified', message:'העלאה זמינה רק בבדיקת Sandbox מורשית.'});
    let issuing = null;
    try {
      if (!expenseUuid(body.operationId)) throw new Error('invalid_expense_input');
      const row = await ledger.get(user.id, body.operationId);
      if (!row || row.state !== 'created' || !row.verified_at || !expenseUuid(row.expense_id)) throw new Error('invalid_expense_input');
      const expense = await request('/expenses/' + row.expense_id, {method:'GET'});
      if (expense?.id !== row.expense_id) throw new Error('invalid_expense_upload_target');
      if (body.action === 'upload_status') {
        const linked = typeof expense.url === 'string' && !!expense.url;
        if (linked && row.file_state !== 'file_linked') await ledger.fileTransition(user.id, row, {file_state:'file_linked'});
        return result(200, {operationId:row.operation_id, expenseId:row.expense_id, fileLinked:linked, fileState:linked ? 'file_linked' : row.file_state,
          sourceStatus:expense.status, approvalVerified:false, reportingVerified:false, message:linked ? 'Morning מציגה קובץ מצורף להוצאה.' : 'קישור הקובץ טרם אומת ב־Morning.'});
      }
      if (body.action === 'upload_ack') {
        if (!expenseUuid(body.fileGeneration) || body.fileGeneration !== row.file_generation) throw new Error('invalid_expense_input');
        if (row.file_state === 'ticket_issued') {
          const saved = await ledger.fileTransition(user.id, row, {file_state:'file_accepted'});
          if (!saved) throw new Error('morning_expense_storage_failed');
        } else if (!['file_accepted', 'file_linked'].includes(row.file_state)) throw new Error('invalid_expense_input');
        return result(200, {fileState:row.file_state === 'file_linked' ? 'file_linked' : 'file_accepted', fileLinked:!!expense.url});
      }
      // Never replace an existing source file or edit an already reported expense.
      if (expense.status !== 10 || expense.url) throw new Error('invalid_expense_upload_target');
      if (body.action === 'upload_prepare') {
        if (!TYPES.has(body.contentType) || !Number.isSafeInteger(body.size) || body.size <= 0 || body.size > MAX_BYTES) throw new Error('invalid_expense_input');
        // No signed form is issued or returned during preparation. Replacing this
        // generation invalidates every old client before it can obtain a ticket.
        if (!['not_started', 'prepared'].includes(row.file_state)) return result(409, {code:'morning_expense_upload_pending'});
        const saved = await ledger.fileTransition(user.id, row, {file_state:'prepared', file_generation:crypto.randomUUID(),
          file_expires_at:new Date(now() + 120000).toISOString(), file_content_type:body.contentType, file_size:body.size, file_requested_at:new Date(now()).toISOString()});
        if (!saved) return result(409, {code:'morning_expense_upload_pending'});
        return result(200, {fileGeneration:saved.file_generation, expiresAt:Date.parse(saved.file_expires_at), fileState:'prepared', fileLinked:false});
      }
      if (body.action !== 'upload_ticket' || !expenseUuid(body.fileGeneration) || body.fileGeneration !== row.file_generation ||
          row.file_state !== 'prepared' || Date.parse(row.file_expires_at) <= now()) return result(409, {code:'morning_expense_upload_pending'});
      issuing = await ledger.fileTransition(user.id, row, {file_state:'upload_started'});
      if (!issuing) return result(409, {code:'morning_expense_upload_pending'});
      const started = now(), data = {id:row.expense_id, source:5, state:'expense'};
      const ticket = expenseUploadTicket(await request('/file-upload/v1/url?context=expense&data=' + encodeURIComponent(JSON.stringify(data)), {method:'GET'}, {upload:true}), environment);
      const metadata = JSON.parse(ticket.fields['x-amz-meta-file-data'] || '{}');
      if (metadata.id !== row.expense_id || metadata.source !== 5 || metadata.state !== 'expense' || row.file_size > ticket.maxFileSize || now() - started >= 55000) throw new Error('invalid_expense_upload_ticket');
      const saved = await ledger.fileTransition(user.id, issuing, {file_state:'ticket_issued'});
      if (!saved) throw new Error('morning_expense_storage_failed');
      return result(200, {...ticket, expiresAt:started + 55000, fileGeneration:saved.file_generation, operationId:row.operation_id, expenseId:row.expense_id, fileLinked:false});
    } catch {
      // This handler has not returned any signed form. Only its own still-current
      // issuance can be released. A delivered ticket or lost HTTP response stays
      // blocked, even after expiry: processing might complete asynchronously.
      if (issuing) {try {await ledger.fileTransition(user.id, issuing, {file_state:'not_started'});} catch { /* Durable uncertainty remains blocked. */ }}
      return result(503, {code:'morning_expense_upload_unavailable', message:'לא ניתן להשלים את בקשת ההעלאה. יש לבדוק את מצב הקובץ לפני ניסיון נוסף.'});
    }
  }};
}
