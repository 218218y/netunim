import assert from 'node:assert/strict';
import {test} from 'node:test';
import {createExpenseService, expensePage, expenseRecord, expensePermission} from '../netunim-orders/supabase/functions/morning-expenses/service.js';
import {createExpenseHandler} from '../netunim-orders/supabase/functions/morning-expenses/handler.js';
import {createExpenseTransport} from '../netunim-orders/supabase/functions/morning-expenses/transport.js';

const id = n => `aaaaaaaa-aaaa-4aaa-aaaa-${String(n).padStart(12, '0')}`;
const user = {id:id(1), app_metadata:{morning_expenses_read:true}};
const raw = {id:id(2), documentType:305, number:'000123', date:'2026-10-20', reportingDate:'2026-10-01', status:10,
  amount:1160, vat:160, currency:'ILS', deductibleAmount:1000, deductibleVat:160,
  supplier:{id:id(3), name:'Supplier', taxId:'123456789', active:true}, data:{pcnClassification:'P', pcnTaxId:'123456789'},
  accountingClassification:{id:id(4), title:'Classification', income:100, vat:66.67, mixed:100}, url:'https://private.example/file'};
const page = (items = []) => ({page:1, pageSize:50, total:items.length, pages:items.length ? 1 : 0, items});

test('P capability requires both canonical supplier readiness and explicit writer authorization',async()=>{
 for(const ready of [false,true])for(const enabled of [false,true]){
  const service=createExpenseService({environment:'production',request:()=>assert.fail('unexpected request'),
   writer:{readiness:async()=>ready,pcnEnabled:()=>enabled,profiles:()=>[]}});
  const result=await service(user,{action:'capabilities'});
  assert.equal(result.body.pcnP,ready&&enabled);assert.equal(result.body.draftApproval,false);
 }
});

test('expense read permission is independent of reports, income issuance and editable user metadata', async () => {
  for (const account of [null, {id:id(1)}, {id:id(1), user_metadata:{morning_expenses_read:true}}, {id:id(1), app_metadata:{morning_reports:true, morning_documents:true}}]) {
    assert.equal(expensePermission(account, 'read'), false);
    const result = await createExpenseService({request:() => assert.fail('unauthorized upstream call'), environment:'sandbox'})(account, {action:'suppliers'});
    assert.equal(result.status, 403);
  }
  assert.equal(expensePermission({id:id(1)}, 'read', id(1)), true);
});
test('expense reads preserve manual VAT and PCN evidence without exposing signed URLs or supplier bank details', async () => {
  const item = expenseRecord({...raw, supplier:{...raw.supplier, bankAccount:'secret'}});
  assert.equal(item.vatCents, 16000); assert.equal(item.pcnClassification, 'P');
  assert.equal(item.classification.vat, 66.67); assert.equal(item.number, '000123');
  assert.equal(item.hasFile, true); assert.ok(!JSON.stringify(item).includes('secret'));
  assert.ok(!JSON.stringify(item).includes('private.example'));
  const calls = [], service = createExpenseService({environment:'sandbox', request:async (...args) => {calls.push(args); return page([raw]);}});
  const result = await service(user, {action:'expenses', fromDate:'2026-10-01', toDate:'2026-10-01', supplierId:id(3)});
  assert.equal(result.status, 200); assert.equal(calls[0][0], '/expenses/search');
  assert.deepEqual(JSON.parse(calls[0][1].body), {page:1, pageSize:50, fromDate:'2026-10-01', toDate:'2026-10-01', supplierId:id(3)});
});
test('malformed and incomplete pages never become successful empty expense lists', () => {
  for (const data of [{...page([raw]), total:51}, {...page([raw]), page:2}, {...page([raw]), pages:4}, {...page([raw]), pageSize:25}, page([raw, raw])]) {
    assert.throws(() => expensePage(data, 0, expenseRecord));
  }
});

test('account-wide expense reads omit reporting dates while retaining page, permission and environment validation', async () => {
  const calls = [], service = createExpenseService({environment:'production', request:async (_, init) => {calls.push(JSON.parse(init.body)); return page();}});
  assert.equal((await service(user, {action:'expenses', expectedEnvironment:'production'})).status, 200);
  assert.deepEqual(calls[0], {page:1, pageSize:50});
  for (const body of [{action:'expenses', fromDate:'2026-01-01'}, {action:'expenses', toDate:'2026-10-01'}, {action:'drafts'}]) {
    assert.equal((await service(user, body)).status, 400);
  }
  assert.equal((await service({id:id(9)}, {action:'expenses'})).status, 403);
  assert.equal((await service(user, {action:'expenses', expectedEnvironment:'sandbox'})).status, 409);
  assert.equal(calls.length, 1);
});

test('supplier tax searches pass only a validated canonical identity and bounded page to Morning', async () => {
  const calls = [], service = createExpenseService({environment:'sandbox', request:async (path, init) => {calls.push({path, body:JSON.parse(init.body)}); return page();}});
  for (const taxId of ['123', 123456789, {}, '1234567890']) assert.equal((await service(user, {action:'suppliers', taxId})).status, 400);
  assert.equal(calls.length, 0);
  assert.equal((await service(user, {action:'suppliers', taxId:'123456789'})).status, 200);
  assert.deepEqual(calls[0], {path:'/suppliers/search', body:{page:1, pageSize:50, active:true, taxId:'123456789'}});
});

test('restored supplier preferences resolve canonical IDs without exposing supplier bank data', async () => {
  const service = createExpenseService({environment:'sandbox', request:async path => {
    assert.equal(path, '/suppliers/' + id(3)); return {id:id(3),name:'Supplier',active:true,country:'IL',taxId:'123456789',bankAccount:'private-bank'};
  }});
  const result = await service(user, {action:'get_supplier',id:id(3)});
  assert.equal(result.status,200); assert.equal(result.body.environment,'sandbox'); assert.equal(result.body.item.id,id(3));
  assert.ok(!JSON.stringify(result).includes('private-bank'));
  assert.equal((await service(user,{action:'get_supplier',id:'local'})).status,400);
});
test('expense and OCR ranges have distinct semantics; unsupported actions and local IDs never reach Morning', async () => {
  const calls = [], service = createExpenseService({environment:'sandbox', request:async (...args) => {calls.push(args); return page();}});
  for (const body of [{action:'expenses', fromDate:'2026-10-02', toDate:'2026-10-30'}, {action:'expenses', fromDate:'2026-02-30', toDate:'2026-03-01'}, {action:'suppliers', page:-1}, {action:'get_expense', id:'local-supplier-1'}]) {
    assert.equal((await service(user, body)).status, 400);
  }
  assert.equal((await service(user, {action:'create'})).status, 409);
  assert.equal((await service(user, {action:'create', expectedEnvironment:'sandbox'})).status, 503);
  assert.equal(calls.length, 0);
  assert.equal((await service(user, {action:'drafts', fromDate:'2026-10-02', toDate:'2026-10-30'})).status, 200);
  assert.equal(JSON.parse(calls[0][1].body).fromDate, '2026-10-02');
  const capabilities = (await service(user, {action:'capabilities'})).body;
  assert.equal(capabilities.create, false); assert.equal(capabilities.draftApproval, false);
});
test('HTTP handler authenticates before reading and bounds streamed request bytes', async () => {
  let calls = 0;
  const handler = createExpenseHandler({getUser:async token => token === 'valid' ? user : null, service:async () => {calls++; return {status:200, body:{ok:true}};}});
  const request = (body, token = 'valid') => new Request('https://edge.example', {method:'POST', headers:{Authorization:`Bearer ${token}`}, body});
  assert.equal((await handler(request('{}', 'wrong'))).status, 401);
  assert.equal((await handler(request('x'))).status, 400);
  assert.equal((await handler(request(' '.repeat(16385)))).status, 413);
  assert.equal(calls, 0);
  const response = await handler(request('{}'));
  assert.equal(response.status, 200); assert.equal(response.headers.get('Cache-Control'), 'no-store');
});
test('transport refreshes read authentication but never retries a financial write', async () => {
  let tokens = 0, reads = 0, writes = 0;
  const request = createExpenseTransport({environment:'sandbox', clientId:'test', clientSecret:'test', fetch:async (url, init) => {
    assert.equal(init.redirect, 'error');
    if (url.includes('oauth/token')) {tokens++; return Response.json({access_token:'test', expires_in:3600});}
    if (url.endsWith('/expenses/search')) {reads++; return Response.json(reads === 1 ? {} : page(), {status:reads === 1 ? 401 : 200});}
    writes++; return Response.json({}, {status:401});
  }});
  await request('/expenses/search', {method:'POST', body:'{}'});
  assert.equal(tokens, 2); assert.equal(reads, 2);
  await assert.rejects(request('/expenses', {method:'POST', body:'{}'})); assert.equal(writes, 1);
  assert.throws(() => createExpenseTransport({environment:'typo'}));
});
test('every financial and recovery command is pinned to the displayed environment before invoking a handler', async () => {
  let calls = 0;
  const handler = {handle:async () => {calls++; return {status:200, body:{ok:true}};}};
  const service = createExpenseService({environment:'production', request:() => assert.fail('unexpected upstream'), writer:handler, uploader:handler});
  for (const action of ['create', 'operation_status', 'reconcile', 'cancel_reserved', 'upload_prepare', 'upload_ticket', 'upload_ack', 'upload_status']) {
    for (const expectedEnvironment of [undefined, 'sandbox', 'typo']) {
      const value = await service(user, {action, expectedEnvironment});
      assert.equal(value.status, 409); assert.equal(value.body.code, 'morning_expense_environment_changed');
    }
    const value = await service(user, {action, expectedEnvironment:'production'});
    assert.equal(value.status, 200); assert.equal(value.body.environment, 'production'); assert.equal(value.body.version, 1);
  }
  assert.equal(calls, 8);
  assert.equal((await service(user, {action:'suppliers', expectedEnvironment:'sandbox'})).status, 409);
});
