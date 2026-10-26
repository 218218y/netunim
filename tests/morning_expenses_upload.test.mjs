import assert from 'node:assert/strict';
import {test} from 'node:test';
import {createExpenseUpload, expenseUploadTicket} from '../netunim-orders/supabase/functions/morning-expenses/upload.js';
const id = n => `aaaaaaaa-aaaa-4aaa-aaaa-${String(n).padStart(12, '0')}`;
const ticket = () => ({url:'https://s3.eu-west-1.amazonaws.com/sandbox-file-upload-service-uploaded', maxFileSize:20971520,
 fields:{bucket:'sandbox-file-upload-service-uploaded', key:'business/${filename}', Policy:'test', 'X-Amz-Algorithm':'AWS4-HMAC-SHA256', 'X-Amz-Credential':'test',
 'X-Amz-Date':'test', 'X-Amz-Security-Token':'test', 'X-Amz-Signature':'test', 'x-amz-meta-file-context':'expense',
 'x-amz-meta-file-data':JSON.stringify({id:id(2), source:5, state:'expense'})}});
const user = {id:id(3), app_metadata:{morning_expenses_write:true}};
const prepare = {action:'upload_prepare', operationId:id(1), contentType:'application/pdf', size:100};
function fixture() {
 const row = {operation_id:id(1), expense_id:id(2), state:'created', verified_at:'2026-10-26', file_state:'not_started'};
 let linked = false, reported = false, failure = false, count = 0, time = 1000000;
 const ledger = {get:async owner => owner === user.id ? {...row} : null,
 fileTransition:async (_, before, patch) => {
  if (row.file_state !== before.file_state || row.file_generation !== before.file_generation) return null;
  Object.assign(row, patch); return {...row};
 }};
 const options = {environment:'sandbox', enabled:true, now:() => time, ledger,
 request:async path => {
  if (path === '/expenses/' + id(2)) return {id:id(2), status:reported ? 20 : 10, ...(linked ? {url:'https://private.example'} : {})};
  count++; if (failure) throw new Error('ticket refused'); return ticket();
 }};
 const uploader = createExpenseUpload(options);
 const handle = (action, fields = {}) => uploader.handle(user, {action, operationId:id(1), ...fields});
 return {row, options, uploader, handle, count:() => count, link:() => {linked = true;}, report:() => {reported = true;}, fail:value => {failure = value;}, advance:ms => {time += ms;}};
}
test('signed upload tickets require the environment bucket and intact form fields', () => {
 assert.equal(expenseUploadTicket(ticket(), 'sandbox').fields.Policy, 'test');
 for (const raw of [{...ticket(), url:'https://attacker.example'}, {...ticket(), maxFileSize:1e10}, {...ticket(), fields:{...ticket().fields, file:'injected'}}]) assert.throws(() => expenseUploadTicket(raw, 'sandbox'));
 assert.throws(() => expenseUploadTicket(ticket(), 'production'));
});
test('preparation issues no signed form; replaced or expired clients cannot obtain a ticket', async () => {
 const f = fixture();
 assert.equal((await f.uploader.handle({id:user.id}, prepare)).status, 403); assert.equal(f.count(), 0);
 const first = await f.uploader.handle(user, prepare); assert.equal(first.status, 200); assert.equal(first.body.url, undefined); assert.equal(f.count(), 0);
 const second = await f.uploader.handle(user, prepare);
 assert.notEqual(second.body.fileGeneration, first.body.fileGeneration);
 assert.equal((await f.handle('upload_ticket', {fileGeneration:first.body.fileGeneration})).status, 409); assert.equal(f.count(), 0);
 f.advance(120001);
 assert.equal((await f.handle('upload_ticket', {fileGeneration:second.body.fileGeneration})).status, 409); assert.equal(f.count(), 0);
});
test('concurrent tickets have one winner; expiry or lost delivery never permits replay', async () => {
 const f = fixture(), ready = await f.uploader.handle(user, prepare), generation = {fileGeneration:ready.body.fileGeneration};
 const results = await Promise.all([f.handle('upload_ticket', generation), f.handle('upload_ticket', generation)]);
 assert.deepEqual(results.map(x => x.status).sort(), [200,409]); assert.equal(f.count(), 1);
 assert.equal(f.row.file_state, 'ticket_issued'); f.advance(1e6);
 assert.equal((await f.uploader.handle(user, prepare)).status, 409);
 assert.equal((await f.handle('upload_status')).body.fileState, 'ticket_issued');
 assert.equal((await f.handle('upload_ack', generation)).body.fileState, 'file_accepted');
 assert.equal((await f.handle('upload_status')).body.fileLinked, false);
 f.link(); const done = await f.handle('upload_status');
 assert.equal(done.body.fileState, 'file_linked'); assert.equal(done.body.fileLinked, true);
 assert.equal(done.body.approvalVerified, false); assert.equal(done.body.reportingVerified, false);
 assert.ok(!JSON.stringify(done).includes('private.example'));
});
test('undelivered ticket failure can retry; legacy tickets remain blocked and recovery survives kill switch', async () => {
 const f = fixture(), ready = await f.uploader.handle(user, prepare);
 f.fail(true); assert.equal((await f.handle('upload_ticket', {fileGeneration:ready.body.fileGeneration})).status, 503);
 assert.equal(f.row.file_state, 'not_started'); f.fail(false);
 assert.equal((await f.uploader.handle(user, prepare)).status, 200);
 f.row.file_state = 'ticket_issued'; f.row.file_generation = null;
 assert.equal((await f.uploader.handle(user, prepare)).status, 409);
 const disabled = createExpenseUpload({...f.options, enabled:false});
 assert.equal((await disabled.handle(user, {action:'upload_status', operationId:id(1)})).status, 200);
 const reported = fixture(); reported.report(); assert.equal((await reported.uploader.handle(user, prepare)).status, 503); assert.equal(reported.count(), 0);
});

test('Production file activation requires the pilot identity; disabling it keeps canonical status readable', async () => {
 const f = fixture(), options = {...f.options, environment:'production', productionUserId:user.id};
 const closed = createExpenseUpload({...options, enabled:false});
 assert.equal((await closed.handle(user, prepare)).status, 403);
 assert.equal((await closed.handle(user, {action:'upload_status', operationId:id(1)})).status, 200);
 const open = createExpenseUpload(options);
 assert.equal((await open.handle({...user, id:id(9)}, prepare)).status, 403);
 const ready = await open.handle(user, prepare); assert.equal(ready.status, 200);
 // Sandbox tickets must fail even for a correctly authorized Production user.
 assert.equal((await open.handle(user, {action:'upload_ticket', operationId:id(1), fileGeneration:ready.body.fileGeneration})).status, 503);
 assert.equal(f.row.file_state, 'not_started');
 const raw = ticket(); raw.url = raw.url.replace('sandbox-', ''); raw.fields.bucket = 'file-upload-service-uploaded';
 assert.equal(expenseUploadTicket(raw, 'production').fields.bucket, 'file-upload-service-uploaded');
 const accepted = createExpenseUpload({...options, request:async (path, ...args) => path.startsWith('/file-upload/') ? raw : f.options.request(path, ...args)});
 const generation = (await accepted.handle(user, prepare)).body.fileGeneration;
 assert.equal((await accepted.handle(user, {action:'upload_ticket', operationId:id(1), fileGeneration:generation})).status, 200);
 assert.equal((await accepted.handle(user, {action:'upload_ack', operationId:id(1), fileGeneration:generation})).body.fileLinked, false);
 f.link(); assert.equal((await closed.handle(user, {action:'upload_status', operationId:id(1)})).body.fileLinked, true);
});
