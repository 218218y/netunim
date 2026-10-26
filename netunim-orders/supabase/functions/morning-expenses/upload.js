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
export function createExpenseUpload({request, ledger, environment, enabled = false, writeIds = () => ''}) {
  const allowed = user => environment === 'sandbox' && enabled === true && expensePermission(user, 'write', writeIds());
  return {allowed, async handle(user, body) {
    const result = (status, data) => ({status, body:{ok:status < 400, ...data}});
    if (!allowed(user)) return result(403, {code:'morning_expense_upload_unverified', message:'העלאה זמינה רק בבדיקת Sandbox מורשית.'});
    try {
      if (!expenseUuid(body.operationId)) throw new Error('invalid_expense_input');
      const row = await ledger.get(user.id, body.operationId);
      if (!row || row.state !== 'created' || !row.verified_at || !expenseUuid(row.expense_id)) throw new Error('invalid_expense_input');
      const expense = await request('/expenses/' + row.expense_id, {method:'GET'});
      if (expense?.id !== row.expense_id) throw new Error('invalid_expense_upload_target');
      if (body.action === 'upload_status') {
        const linked = typeof expense.url === 'string' && !!expense.url;
        if (linked && row.file_state === 'ticket_issued') await ledger.transition(user.id, row.operation_id, 'created', {file_state:'file_linked'});
        return result(200, {operationId:row.operation_id, expenseId:row.expense_id, fileLinked:linked, fileState:linked ? 'file_linked' : row.file_state,
          sourceStatus:expense.status, approvalVerified:false, reportingVerified:false, message:linked ? 'Morning מציגה קובץ מצורף להוצאה.' : 'קישור הקובץ טרם אומת ב־Morning.'});
      }
      if (!TYPES.has(body.contentType) || !Number.isSafeInteger(body.size) || body.size <= 0 || body.size > MAX_BYTES) throw new Error('invalid_expense_input');
      // Never replace an existing source file or edit an already reported expense.
      if (expense.status !== 10 || expense.url) throw new Error('invalid_expense_upload_target');
      const claimed = await ledger.claimFile(user.id, row.operation_id);
      if (!claimed) return result(409, {code:'morning_expense_upload_pending', message:'כבר הונפקה בקשת העלאה. יש לבדוק את מצב הקובץ ב־Morning לפני העלאה נוספת.'});
      const started = Date.now(), data = {id:row.expense_id, source:5, state:'expense'};
      const ticket = expenseUploadTicket(await request('/file-upload/v1/url?context=expense&data=' + encodeURIComponent(JSON.stringify(data)), {method:'GET'}, {upload:true}), environment);
      const metadata = JSON.parse(ticket.fields['x-amz-meta-file-data'] || '{}');
      if (metadata.id !== row.expense_id || metadata.source !== 5 || metadata.state !== 'expense' || body.size > ticket.maxFileSize || Date.now() - started >= 55000) throw new Error('invalid_expense_upload_ticket');
      return result(200, {...ticket, expiresAt:started + 55000, operationId:row.operation_id, expenseId:row.expense_id, fileLinked:false});
    } catch {
      // Ticket issuance itself is not evidence that a file was uploaded or linked.
      return result(503, {code:'morning_expense_upload_unavailable', message:'לא ניתן להשלים את בקשת ההעלאה. יש לבדוק את מצב הקובץ לפני ניסיון נוסף.'});
    }
  }};
}
