import assert from 'node:assert/strict';
import {test} from 'node:test';
import {createExpenseUpload, expenseUploadTicket} from '../netunim-orders/supabase/functions/morning-expenses/upload.js';

const id = n => `aaaaaaaa-aaaa-4aaa-aaaa-${String(n).padStart(12, '0')}`;
const ticket = () => ({url:'https://s3.eu-west-1.amazonaws.com/sandbox-file-upload-service-uploaded', maxFileSize:20971520,
  fields:{bucket:'sandbox-file-upload-service-uploaded', key:'business/${filename}', Policy:'test', 'X-Amz-Algorithm':'AWS4-HMAC-SHA256', 'X-Amz-Credential':'test',
    'X-Amz-Date':'test', 'X-Amz-Security-Token':'test', 'X-Amz-Signature':'test', 'x-amz-meta-file-context':'expense',
    'x-amz-meta-file-data':JSON.stringify({id:id(2), source:5, state:'expense'})}});
test('signed upload tickets are restricted to the documented environment bucket and intact form fields', () => {
  assert.equal(expenseUploadTicket(ticket(), 'sandbox').fields.Policy, 'test');
  for (const raw of [{...ticket(), url:'https://attacker.example'}, {...ticket(), maxFileSize:1e10}, {...ticket(), fields:{...ticket().fields, file:'injected'}}]) assert.throws(() => expenseUploadTicket(raw, 'sandbox'));
  assert.throws(() => expenseUploadTicket(ticket(), 'production'));
});
test('only a verified owned expense can claim one file ticket; S3 acceptance is never treated as linkage', async () => {
  const row = {operation_id:id(1), expense_id:id(2), state:'created', verified_at:'2026-10-26', file_state:'not_started'};
  let claims = 0, linked = false, reported = false, requests = 0;
  const uploader = createExpenseUpload({environment:'sandbox', enabled:true,
    ledger:{get:async owner => owner === id(3) ? {...row} : null, claimFile:async () => {if (claims++) return null; row.file_state = 'ticket_issued'; return {...row};}, transition:async (_, __, ___, patch) => Object.assign(row, patch)},
    request:async (path, init, options) => {
      requests++;
      if (path === '/expenses/' + id(2)) return {id:id(2), status:reported ? 20 : 10, ...(linked ? {url:'https://private.example'} : {})};
      assert.equal(options.upload, true); assert.equal(init.method, 'GET');
      const data = JSON.parse(new URL('https://example.org' + path).searchParams.get('data'));
      assert.deepEqual(data, {id:id(2), source:5, state:'expense'}); return ticket();
    }});
  const user = {id:id(3), app_metadata:{morning_expenses_write:true}}, body = {action:'upload_ticket', operationId:id(1), contentType:'application/pdf', size:100};
  assert.equal((await uploader.handle({id:id(3)}, body)).status, 403); assert.equal(requests, 0);
  assert.equal((await uploader.handle({...user, id:id(4)}, body)).status, 503);
  reported = true; assert.equal((await uploader.handle(user, body)).status, 503); assert.equal(claims, 0); reported = false;
  const ready = await uploader.handle(user, body);
  assert.equal(ready.status, 200); assert.equal(ready.body.fileLinked, false); assert.ok(ready.body.expiresAt > Date.now());
  assert.equal((await uploader.handle(user, body)).status, 409);
  const pending = await uploader.handle(user, {action:'upload_status', operationId:id(1)});
  assert.equal(pending.body.fileLinked, false); assert.equal(pending.body.fileState, 'ticket_issued');
  linked = true;
  const done = await uploader.handle(user, {action:'upload_status', operationId:id(1)});
  assert.equal(done.body.fileLinked, true); assert.equal(done.body.approvalVerified, false); assert.equal(done.body.reportingVerified, false);
  assert.equal(row.file_state, 'file_linked'); assert.ok(!JSON.stringify(done).includes('private.example'));
});
