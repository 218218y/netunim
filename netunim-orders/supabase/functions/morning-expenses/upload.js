import {expenseUuid} from './service.js';
import {expenseWriteAccess} from './write-access.js';
import {expenseMatchesIntent} from './intent.js';
import {normalizeExpenseSource,normalizeExpenseSourceReview,expenseSourceExpected,expenseSourceSummary,inspectExpenseSource} from './source.js';

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
export function createExpenseUpload({request, ledger, environment, enabled = false, writeIds = () => '', productionUserId = '', now = Date.now,verifySource}) {
  const authorized = user => expenseWriteAccess(user, environment, writeIds(), productionUserId);
  const allowed = user => enabled === true && authorized(user);
  return {allowed, async handle(user, body) {
    const result = (status, data) => ({status, body:{ok:status < 400, ...data}});
    if (!(['upload_status','source_waive','source_verify'].includes(body?.action) ? authorized(user) : allowed(user))) return result(403, {code:'morning_expense_upload_unverified', message:'צירוף קבצים לא הופעל למשתמש בסביבת החשבון. בדיקת מצב נשארת זמינה למשתמש המורשה.'});
    let issuing = null;
    try {
      if (!expenseUuid(body.operationId)) throw new Error('invalid_expense_input');
      let row = await ledger.get(user.id, body.operationId);
      if (!row || row.state !== 'created' || !row.verified_at || !expenseUuid(row.expense_id)) throw new Error('invalid_expense_input');
      const expense = await request('/expenses/' + row.expense_id, {method:'GET'});
      if (expense?.id !== row.expense_id || !expenseMatchesIntent(expense, row.payload)) throw new Error('invalid_expense_upload_target');
      if(body.action==='source_waive'){
        const reason=typeof body.reason==='string'?body.reason.trim():'';
        if(!expenseSourceSummary(row).sourceExpected||reason.length<10||reason.length>250)throw Error('invalid_expense_source');
        const saved=await ledger.fileTransition(user.id,row,{source_waived_at:new Date(now()).toISOString(),source_waived_reason:reason});
        if(!saved)throw Error('morning_expense_storage_failed');
        return result(200,{...expenseSourceSummary(saved),operationId:row.operation_id,expenseId:row.expense_id,
          fileState:row.file_state,fileLinked:!!expense.url,message:'החוסר תועד כחריגה ידנית. לא אומתה התאמת קובץ ולא שונה האישור החשבונאי במורנינג.'});
      }
      if (body.action === 'upload_status') {
        const linked = typeof expense.url === 'string' && !!expense.url;
        const source=await inspectExpenseSource(row,expense,environment,{verifySource});
        if(linked&&row.file_state!=='file_linked'||row.source_metadata&&!!row.source_verified_at!==source.sourceVerified){
          const saved=await ledger.fileTransition(user.id,row,{...(linked?{file_state:'file_linked'}:{}),
            ...(row.source_metadata?{source_verified_at:source.sourceVerified?new Date(now()).toISOString():null}:{})});
          if(!saved)throw Error('morning_expense_storage_failed');row=saved;source.sourceVerifiedAt=row.source_verified_at||null;
        }
        return result(200, {...source,operationId:row.operation_id, expenseId:row.expense_id, fileLinked:linked, fileState:linked ? 'file_linked' : row.file_state,
          sourceStatus:expense.status, approvalVerified:false, reportingVerified:false,
          message:source.sourceVerified?'קובץ המקור נקרא מ־Morning וטביעתו תואמת לקובץ שאושר.':linked?
            'Morning מציגה קובץ, אך עדיין לא הוכח שזה קובץ המקור שאושר. יש לבחור את המקור לבדיקה; אין להעלות שוב אם העלאה קודמת עדיין בבירור.':'קישור קובץ המקור טרם אומת ב־Morning.'});
      }
      if (body.action === 'upload_ack') {
        if (!expenseUuid(body.fileGeneration) || body.fileGeneration !== row.file_generation) throw new Error('invalid_expense_input');
        if (row.file_state === 'ticket_issued') {
          const saved = await ledger.fileTransition(user.id, row, {file_state:'file_accepted'});
          if (!saved) throw new Error('morning_expense_storage_failed');
        } else if (!['file_accepted', 'file_linked'].includes(row.file_state)) throw new Error('invalid_expense_input');
        return result(200, {...expenseSourceSummary(row),fileState:row.file_state === 'file_linked' ? 'file_linked' : 'file_accepted', fileLinked:!!expense.url});
      }
      if(['upload_prepare','source_verify'].includes(body.action)){
        const metadata=normalizeExpenseSource(body.sourceFile);
        if(row.source_metadata&&(!metadata||metadata.sha256!==row.source_metadata.sha256||metadata.size!==row.source_metadata.size||metadata.contentType!==row.source_metadata.contentType))
          throw Error('expense_source_mismatch');
        if(metadata&&(metadata.size!==body.size||metadata.contentType!==body.contentType))throw Error('invalid_expense_source');
        if(metadata){
          const review=body.sourceReview?{...normalizeExpenseSourceReview(body.sourceReview,expenseSourceExpected(row.payload)),reviewedAt:new Date(now()).toISOString()}:row.source_review;
          if(!review)throw Error('expense_source_review_required');
          if(expense.url){
            const source=await inspectExpenseSource({...row,source_metadata:metadata},expense,environment,{verifySource});
            if(!source.sourceVerified)return result(source.sourceCheck==='mismatch'?409:503,{
              code:source.sourceCheck==='mismatch'?'expense_source_mismatch':'expense_source_verification_unavailable',sourceCheck:source.sourceCheck,
              message:source.sourceCheck==='mismatch'?'הקובץ שנקרא ממורנינג שונה מהמקור שנבחר. לא הוחלף קובץ ולא נשמר שיוך חדש.':
                'לא ניתן כרגע לקרוא ולאמת את המקור ממורנינג. כשל הורדה אינו מוכיח שהקובץ שגוי; אין להעלות אותו שוב.'});
            const saved=await ledger.fileTransition(user.id,row,{source_metadata:metadata,source_review:review,source_verified_at:new Date(now()).toISOString(),file_state:'file_linked'});
            if(!saved)throw Error('morning_expense_storage_failed');
            return result(200,{...expenseSourceSummary(saved),alreadyLinked:true,fileLinked:true,fileState:'file_linked'});
          }
          if(!['not_started','prepared'].includes(row.file_state))return body.action==='source_verify'?
            result(200,{...expenseSourceSummary(row),fileState:row.file_state,fileLinked:false,message:'העלאה קודמת עדיין בבירור. יש לבדוק שוב בהמשך; לא תישלח העלאה נוספת.'}):
            result(409,{code:'morning_expense_upload_pending'});
          const saved=await ledger.fileTransition(user.id,row,{source_metadata:metadata,source_review:review});
          if(!saved)throw Error('morning_expense_storage_failed');row=saved;
        }
        if(body.action==='source_verify')return result(200,{...expenseSourceSummary(row),fileState:row.file_state,fileLinked:false,
          message:'קובץ המקור עדיין אינו מופיע במורנינג. הציפייה למקור נשמרה; יש להשלים העלאה או לתעד חריגה.'});
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
    } catch (error) {
      // This handler has not returned any signed form. Only its own still-current
      // issuance can be released. A delivered ticket or lost HTTP response stays
      // blocked, even after expiry: processing might complete asynchronously.
      if (issuing) {try {await ledger.fileTransition(user.id, issuing, {file_state:'not_started'});} catch { /* Durable uncertainty remains blocked. */ }}
      const code=['expense_source_mismatch','expense_source_review_required','invalid_expense_source'].includes(error.message)?error.message:'morning_expense_upload_unavailable';
      return result(code==='morning_expense_upload_unavailable'?503:409,{code,message:code==='expense_source_mismatch'?
        'קובץ המקור אינו תואם לקובץ שאושר לפעולה זו. יש לבחור את המקור הנכון; לא נמסרה הרשאת העלאה.':
        code==='expense_source_review_required'?'נדרשת בדיקת התאמה ייעודית של קובץ המקור לפני העלאה.':'לא ניתן להשלים את בקשת ההעלאה. יש לבדוק את מצב הקובץ לפני ניסיון נוסף.'});
    }
  }};
}
