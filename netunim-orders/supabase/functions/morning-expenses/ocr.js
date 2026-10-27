import {expenseUuid, expensePage, draftRecord} from './service.js';
import {expenseWriteAccess} from './write-access.js';
import {expenseUploadTicket} from './upload.js';
import {verifyOcrSource} from './ocr-source.js';

const response = (status, body) => ({status, body:{ok:status < 400, ...body}});
export function createExpenseOcr({request, ledger, environment, enabled = false, writeIds = () => '', productionUserId = '', now = Date.now, verifySource = verifyOcrSource}) {
  const authorized = user => expenseWriteAccess(user, environment, writeIds(), productionUserId);
  // Production remains closed until the complete isolated acceptance matrix and
  // rollout are approved. Normal manual writes and OCR are independent switches.
  const allowed = user => environment === 'sandbox' && enabled === true && authorized(user);
  const summary = row => ({operationId:row.operation_id, state:row.state, draftId:row.draft_id || '',
    sourceVerified:!!row.source_verified_at, deferred:!!row.deferred_at, fileSize:row.file_size, fileSha256:row.file_sha256,
    approvalVerified:false, parsingVerified:false, pollCount:row.poll_count});
  async function candidates(row) {
    const started = Date.parse(row.ticket_issued_at), day = offset => new Date(started + offset * 86400000).toISOString().slice(0, 10);
    const items = []; let total = null, pages = 1;
    for (let page = 0; page < pages; page++) {
      const raw = await request('/expenses/drafts/search', {method:'POST', body:JSON.stringify({fromDate:day(-1), toDate:day(2), page:page + 1, pageSize:50})});
      const result = expensePage(raw, page, value => {draftRecord(value); return value;});
      if (result.pages > 4) throw new Error('morning_ocr_search_limit');
      if (total !== null && total !== result.total || result.items.some(item => items.some(other => other.id === item.id))) throw new Error('morning_ocr_search_changed');
      total = result.total; pages = result.pages; items.push(...result.items);
    }
    return items.filter(item => item.businessId === row.business_id && Number.isSafeInteger(item.creationDate) && item.creationDate * 1000 >= started - 5000);
  }
  return {allowed, recoverable:authorized, async handle(user, body) {
    if (!authorized(user)) return response(403, {code:'morning_ocr_forbidden'});
    const action = body.action;
    if (['ocr_prepare','ocr_ticket','ocr_ack'].includes(action) && !allowed(user)) return response(403, {code:'morning_ocr_disabled', message:'סריקות חדשות כבויות; בדיקת מצב ושחזור נשארים זמינים.'});
    let issuing = null;
    try {
      if (action === 'ocr_list') return response(200, {items:(await ledger.list(user.id)).map(summary)});
      if (action === 'ocr_lookup') {
        if (typeof body.sha256 !== 'string' || !/^[\da-f]{64}$/.test(body.sha256)) return response(400, {code:'invalid_ocr_input'});
        const own = await ledger.byFile(user.id, body.sha256);
        // Cross-owner existence is enough to stop a duplicate. Never disclose
        // another owner's operation, draft, file metadata or recognized data.
        return response(200, {hasOcrOperation:!!own || await ledger.hasFile(body.sha256), ...(own ? {operationId:own.operation_id} : {})});
      }
      if (!expenseUuid(body.operationId)) return response(400, {code:'invalid_ocr_input'});
      let row = await ledger.get(user.id, body.operationId);
      if (action === 'ocr_prepare') {
        if (body.contentType !== 'application/pdf' || !Number.isSafeInteger(body.size) || body.size <= 0 || body.size > 20 * 1024 * 1024 ||
            typeof body.sha256 !== 'string' || !/^[\da-f]{64}$/.test(body.sha256)) return response(400, {code:'invalid_ocr_input'});
        if (row && (row.file_sha256 !== body.sha256 || row.file_size !== body.size || row.content_type !== body.contentType)) return response(409, {code:'morning_ocr_operation_mismatch'});
        if (!row) row = await ledger.reserve({operation_id:body.operationId, owner_id:user.id, file_sha256:body.sha256, file_size:body.size,
          content_type:body.contentType, state:'reserved', revision:0, poll_count:0});
        if (!row) row = await ledger.byFile(user.id, body.sha256);
        if (!row) return response(409, {code:'morning_ocr_duplicate', message:'קובץ זה כבר נשלח לסריקה או שמזהה הפעולה תפוס. יש לבדוק את הפעולות הקודמות.'});
        if (row.file_size !== body.size || row.content_type !== body.contentType) return response(409, {code:'morning_ocr_operation_mismatch'});
        return response(200, {...summary(row), filename:'netunim-ocr-' + row.operation_id + '.pdf'});
      }
      if (!row) return response(404, {code:'morning_ocr_operation_missing'});
      if (action === 'ocr_ticket') {
        if (row.state !== 'reserved') return response(409, {...summary(row), code:'morning_ocr_upload_pending'});
        issuing = await ledger.transition(user.id, row, {state:'issuing'});
        if (!issuing) return response(409, {code:'morning_ocr_busy'});
        const started = now();
        const ticket = expenseUploadTicket(await request('/file-upload/v1/url?context=expense&data=' + encodeURIComponent(JSON.stringify({source:5})), {method:'GET'}, {upload:true}), environment);
        const data = JSON.parse(ticket.fields['x-amz-meta-file-data'] || '{}'), business = ticket.fields['x-amz-meta-business-id'];
        if (data.source !== 5 || data.id !== undefined || data.state !== undefined || !expenseUuid(business) || ticket.maxFileSize < row.file_size || now() - started >= 55000) throw new Error('invalid_expense_upload_ticket');
        const saved = await ledger.transition(user.id, issuing, {state:'ticket_issued', business_id:business, ticket_issued_at:new Date(started).toISOString()});
        if (!saved) throw new Error('morning_ocr_storage_failed');
        // A lost delivery stays ticket_issued forever: no second form or upload.
        return response(200, {...ticket, ...summary(saved), expiresAt:started + 55000, filename:'netunim-ocr-' + row.operation_id + '.pdf'});
      }
      if (action === 'ocr_ack') {
        if (row.state === 'ticket_issued') {
          row = await ledger.transition(user.id, row, {state:'accepted'});
          if (!row) return response(409, {code:'morning_ocr_busy'});
        } else if (!['accepted','processing','review_required'].includes(row.state)) return response(409, {code:'morning_ocr_upload_pending'});
        return response(200, summary(row));
      }
      if (action === 'ocr_defer') {
        const saved = await ledger.transition(user.id, row, {deferred_at:new Date(now()).toISOString()});
        return saved ? response(200, summary(saved)) : response(409, {code:'morning_ocr_busy'});
      }
      if (action !== 'ocr_status') return response(400, {code:'invalid_ocr_input'});
      if (['reserved','issuing'].includes(row.state)) return response(200, summary(row));
      if (row.poll_count >= 20) return response(200, {...summary(row), code:'morning_ocr_poll_limit', message:'מגבלת הבירור הגיעה לסיומה. יש להמשיך את הבדיקה במורנינג; אין להעלות את הקובץ שוב.'});
      if (row.last_poll_at && now() - Date.parse(row.last_poll_at) < 5000) return response(200, {...summary(row), code:'morning_ocr_cooldown', retryAfterMs:5000});
      row = await ledger.transition(user.id, row, {last_poll_at:new Date(now()).toISOString(), poll_count:row.poll_count + 1});
      if (!row) return response(409, {code:'morning_ocr_busy'});
      const found = await candidates(row), pool = row.draft_id ? found.filter(item => item.id === row.draft_id) : found;
      if (pool.length > 3) return response(200, {...summary(row), code:'morning_ocr_ambiguous', message:'נמצאו טיוטות רבות בחלון ההעלאה. נדרשת בדיקה במורנינג; לא בוצע שיוך לפי ניחוש.'});
      const matches = [];
      for (const item of pool) if (await verifySource(item, {sha256:row.file_sha256, size:row.file_size}, environment)) matches.push(item);
      if (matches.length !== 1) return response(200, {...summary(row), code:matches.length > 1 ? 'morning_ocr_ambiguous' : 'morning_ocr_waiting',
        message:matches.length > 1 ? 'יותר מטיוטה אחת מכילה אותו מסמך מקור. נדרשת בדיקה במורנינג.' : 'טרם נמצא מסמך מקור תואם. אין להעלות את הקובץ שוב.'});
      const draft = matches[0];
      const saved = await ledger.transition(user.id, row, {state:'review_required', draft_id:draft.id, source_verified_at:new Date(now()).toISOString()});
      if (!saved) return response(409, {code:'morning_ocr_busy'});
      return response(200, {...summary(saved), item:draftRecord(draft), message:'מסמך המקור אומת לפי תוכנו. נתוני ה־OCR דורשים בדיקה; האישור הסופי מתבצע במורנינג.'});
    } catch (error) {
      // Safe only before a form has left this handler. Delivered/uncertain forms
      // retain their durable state even after expiry or OCR has been disabled.
      if (issuing) {try {await ledger.transition(user.id, issuing, {state:'reserved'});} catch { /* retain uncertainty */ }}
      return response(503, {code:['morning_ocr_search_limit','morning_ocr_search_changed'].includes(error.message) ? error.message : 'morning_ocr_unavailable',
        message:'לא ניתן להשלים את בירור הסריקה. הפעולה נשמרה לשחזור; אין להעלות שוב ללא בירור.'});
    }
  }};
}
