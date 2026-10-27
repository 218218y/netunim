import assert from 'node:assert/strict';
import {test} from 'node:test';
import {createExpenseWriter} from '../netunim-orders/supabase/functions/morning-expenses/writer.js';
import {normalizeExpenseInput, expenseCents} from '../netunim-orders/supabase/functions/morning-expenses/input.js';

const id = n => `aaaaaaaa-aaaa-4aaa-aaaa-${String(n).padStart(12, '0')}`;
const user = {id:id(1), app_metadata:{morning_expenses_write:true}};
const input = (operation = 2) => ({action:'create', operationId:id(operation), expense:{supplierId:id(3), classificationExpenseId:id(4),
  documentType:305, number:'00123', date:'2026-10-20', reportingDate:'2026-10-01', net:'1000.00', vat:'160.00', gross:'1160.00',
  pcnClassification:'T', description:'Test'}});
const profiles = [{id:id(20), taxId:'123456780'}, {id:id(21), taxId:'123456781'}];
function fixture({environment = 'sandbox', enabled = true, mode = '', pSuppliers = () => profiles, productionUserId = '', pcnP = false} = {}) {
  const rows = new Map(), posts = [];
  const ledger = {
    get:async (owner, operation) => {const row = rows.get(operation); return row?.owner_id === owner ? structuredClone(row) : null;},
    reserve:async row => {
      if (rows.has(row.operation_id) || [...rows.values()].some(other => other.state !== 'cancelled' && other.invoice_identity === row.invoice_identity)) return null;
      rows.set(row.operation_id, structuredClone(row)); return structuredClone(row);
    },
    transition:async (owner, operation, state, patch) => {
      if (mode === 'reserve-only' && state === 'reserved') return null;
      const row = rows.get(operation); if (row?.owner_id !== owner || row.state !== state) return null;
      Object.assign(row, structuredClone(patch)); return structuredClone(row);
    },
    cancelReserved:async (owner, operation) => {
      const row = rows.get(operation);
      if (row?.owner_id !== owner || row.state !== 'reserved' || row.sent_at || row.expense_id) return null;
      Object.assign(row, {state:'cancelled', cancelled_at:'2026-10-26'}); return structuredClone(row);
    },
    pendingSources:async owner => [...rows.values()].filter(row=>row.owner_id===owner&&row.source_metadata&&!row.source_verified_at&&!row.source_waived_at&&row.state!=='cancelled').map(row=>structuredClone(row)),
    fileTransition:async (owner,before,patch) => {
      const row=rows.get(before.operation_id);if(row?.owner_id!==owner)return null;
      Object.assign(row,structuredClone(patch));return structuredClone(row);
    },
  };
  let canonical = null;
  const request = async (path, init) => {
    const guard = pSuppliers().find(profile => path === '/suppliers/' + profile.id && profile.id !== id(3));
    if (guard) return {...guard, name:'P supplier', active:mode !== 'p-inactive', country:'PS'};
    if (path === '/suppliers/' + id(3)) return {id:id(3), name:'Supplier', active:true, country:'IL', taxId:'123456789'};
    if (path === '/expenses/' + id(4)) return {id:id(4), status:10, accountingClassification:{id:id(5), title:'Category', vat:100}};
    if (path === '/expenses/search') {
      if (mode === 'preflight-down') throw new Error('read failed before any write');
      assert.equal(Object.hasOwn(JSON.parse(init.body), 'supplierId'), false, 'supplier ID searches miss real API-created supplier snapshots');
      return {page:1, pageSize:50, total:mode === 'duplicate' ? 1 : 0, pages:mode === 'duplicate' ? 1 : 0, items:mode === 'duplicate' ? [{...canonicalExpense(), id:id(8)}] : []};
    }
    if (path === '/expenses') {
      posts.push(JSON.parse(init.body)); canonical = {...posts.at(-1), id:id(6), status:10, data:{pcnClassification:mode === 'wrong-pcn' ? 'T' : posts.at(-1).pcnClassification, pcnTaxId:mode === 'wrong-pcn-tax' ? '999999999' : posts.at(-1).supplier.taxId}};
      if (mode === 'lost') throw new Error('timeout after write');
      return {id:id(6)};
    }
    if (path === '/expenses/' + id(6)) {
      if (mode === 'readback-down') throw new Error('readback unavailable');
      return {...canonical, ...(mode === 'wrong-vat' ? {vat:180} : {})};
    }
    assert.fail('unexpected upstream call: ' + path);
  };
  const canonicalExpense = () => ({id:id(6), documentType:305, number:'00123', date:'2026-10-20', reportingDate:'2026-10-01',
    currency:'ILS', amount:1160, vat:160, status:10, supplier:{id:id(3), taxId:'123456789'}, accountingClassification:{id:id(5)}, data:{pcnClassification:'T'}});
  const options = {environment, enabled, pcnP, request, ledger, pSuppliers, productionUserId, today:() => '2026-10-26'};
  const writer = createExpenseWriter(options);
  return {writer, rows, posts, options, setMode:value => {mode = value;}};
}
test('decimal inputs are exact and VAT is never replaced by an assumed percentage', () => {
  assert.equal(expenseCents('0.29'), 29); assert.equal(expenseCents('1.001'), null);
  for (const value of [-1, Infinity, {}, '', '1e3']) assert.equal(expenseCents(value), null);
  const body = input(); assert.equal(normalizeExpenseInput(body, '2026-10-26').vatCents, 16000);
  assert.throws(() => normalizeExpenseInput({...body, expense:{...body.expense, gross:'1180'}}, '2026-10-26'), /invalid_expense_amounts/);
  assert.throws(() => normalizeExpenseInput({...body, expense:{...body.expense, date:'2026-10-27'}}, '2026-10-26'));
  assert.throws(() => normalizeExpenseInput({...body, expense:{...body.expense, pcnClassification:'P'}}, '2026-10-26'), /p_unverified/);
  assert.throws(() => normalizeExpenseInput({...body, expense:{...body.expense, number:'X'.repeat(21)}}, '2026-10-26'), /invalid_expense_input/);
});

test('invoice receipt expenses retain type 320 through durable creation, readback and replay', async () => {
  const f=fixture(),body=input();body.expense.documentType=320;
  const result=await f.writer.handle(user,body);
  assert.equal(result.body.verified,true);assert.equal(f.posts[0].documentType,320);
  assert.equal(result.body.intent.documentType,320);
  assert.equal((await f.writer.handle(user,body)).body.verified,true);assert.equal(f.posts.length,1);
});

const pProfiles=()=>[{id:id(3),taxId:'123456789'},profiles[1]];
for(const documentType of [305,330,320])test(`verified P type ${documentType} retains explicit VAT, nine-digit identity and idempotent replay`,async()=>{
  const f=fixture({pcnP:true,pSuppliers:pProfiles}),body=input();body.expense={...body.expense,pcnClassification:'P',documentType};
  const result=await f.writer.handle(user,body);
  assert.equal(result.body.verified,true);assert.equal(f.posts.length,1);
  assert.equal(f.posts[0].pcnClassification,'P');assert.equal(f.posts[0].number,'000000123');assert.equal(f.posts[0].vat,160);
  body.expense.number='000000123';assert.equal((await f.writer.handle(user,body)).body.verified,true);assert.equal(f.posts.length,1);
  const stopped=createExpenseWriter({...f.options,pcnP:false});
  assert.equal((await stopped.handle(user,{action:'operation_status',operationId:body.operationId})).body.verified,true);
  assert.equal((await stopped.handle(user,{...body,operationId:id(8)})).status,400);assert.equal(f.posts.length,1);
});
test('P capability is explicit and neither protected T nor unprotected P can create',async()=>{
  for(const options of [{},{pcnP:true}]){
    const f=fixture(options),body=input();body.expense.pcnClassification='P';
    assert.equal((await f.writer.handle(user,body)).status,400);assert.equal(f.posts.length,0);
  }
  const f=fixture({pcnP:true,pSuppliers:pProfiles});
  assert.equal((await f.writer.handle(user,input())).status,400);assert.equal(f.posts.length,0);
  assert.equal(f.writer.pcnEnabled(user),true);assert.equal(f.writer.pcnEnabled({id:id(90)}),false);
  for(const number of ['P123','1234567890','000000000']){
    const body=input();body.expense={...body.expense,pcnClassification:'P',number};
    assert.equal((await f.writer.handle(user,body)).body.code,'invalid_expense_p_number');
  }
});
for(const mode of ['wrong-pcn','wrong-pcn-tax'])test(`P ${mode} readback remains unverified and cannot replay a write`,async()=>{
  const f=fixture({pcnP:true,pSuppliers:pProfiles,mode}),body=input();body.expense.pcnClassification='P';
  assert.equal((await f.writer.handle(user,body)).body.verified,false);
  assert.equal((await f.writer.handle(user,body)).body.verified,false);assert.equal(f.posts.length,1);
});
test('Production pilot uses the same durable writer and manual VAT while all other writers and automatic P stay blocked', async () => {
  const f = fixture({environment:'production', productionUserId:user.id});
  assert.equal(await f.writer.readiness({id:id(9), app_metadata:user.app_metadata}), false);
  assert.equal((await f.writer.handle({id:user.id, user_metadata:user.app_metadata}, input())).status, 403);
  assert.equal((await f.writer.handle(user, input())).body.verified, true);
  assert.equal((await f.writer.handle(user, input())).body.verified, true); assert.equal(f.posts.length, 1);
  const stopped = createExpenseWriter({...f.options, enabled:false});
  assert.equal((await stopped.handle(user, {action:'operation_status', operationId:id(2)})).body.verified, true);
  assert.equal((await stopped.handle(user, input(7))).status, 403); assert.equal(f.posts.length, 1);
  const p = fixture({environment:'production', productionUserId:user.id, pSuppliers:() => [{id:id(3), taxId:'123456789'}, profiles[1]]});
  assert.equal((await p.writer.handle(user, input())).body.code, 'morning_expense_p_unverified'); assert.equal(p.posts.length, 0);
  const disabled = fixture({environment:'production', productionUserId:user.id, enabled:false});
  assert.equal((await disabled.writer.handle(user, input())).status, 403);
  assert.equal((await disabled.writer.handle(user, {action:'operation_status', operationId:id(2)})).status, 404);
});
test('only an explicitly authorized Sandbox writer may create, including configured P supplier protection', async () => {
  for (const options of [{environment:'production'}, {enabled:false}]) {
    const f = fixture(options); assert.equal((await f.writer.handle(user, input())).status, 403); assert.equal(f.posts.length, 0);
  }
  const f = fixture(); assert.equal((await f.writer.handle({id:user.id}, input())).status, 403);
  const p = fixture({pSuppliers:() => [{id:id(3), taxId:'123456789'}, profiles[1]]});
  assert.equal((await p.writer.handle(user, input())).body.code, 'morning_expense_p_unverified'); assert.equal(p.posts.length, 0);
});
test('two distinct P identities must pass canonical readback before even a normal expense can be sent', async () => {
  for (const options of [{pSuppliers:() => []}, {pSuppliers:() => [profiles[0]]}, {mode:'p-inactive'}]) {
    const f = fixture(options); assert.equal(await f.writer.readiness(user), false);
    assert.notEqual((await f.writer.handle(user, input())).status, 200); assert.equal(f.posts.length, 0);
  }
  const f = fixture({enabled:false});
  assert.equal((await f.writer.handle(user, {action:'operation_status', operationId:id(2)})).status, 404, 'turning off creation must leave recovery readable');
});
test('creation requires canonical readback and exact manual VAT, supplier and category survive payload construction', async () => {
  const f = fixture(), result = await f.writer.handle(user, input());
  assert.equal(result.status, 200); assert.equal(result.body.verified, true); assert.equal(result.body.approvalVerified, false);
  assert.equal(result.body.reportingVerified, false); assert.equal(f.posts[0].vat, 160); assert.equal(f.posts[0].supplier.add, false);
  assert.equal(Object.hasOwn(f.posts[0].supplier, 'id'), false); assert.equal(f.posts[0].accountingClassification.id, id(5));
  assert.equal((await f.writer.handle(user, input())).body.verified, true); assert.equal(f.posts.length, 1);
  const changed = input(); changed.expense.number = 'other';
  assert.equal((await f.writer.handle(user, changed)).status, 409);
});
test('concurrent workers and different users cannot create the same invoice twice', async () => {
  const f = fixture(), results = await Promise.all([f.writer.handle(user, input()), f.writer.handle(user, input())]);
  assert.equal(f.posts.length, 1); assert.ok(results.some(result => result.body.verified));
  const secondUser = {id:id(9), app_metadata:{morning_expenses_write:true}};
  assert.equal((await f.writer.handle(secondUser, input(10))).status, 409); assert.equal(f.posts.length, 1);
});
test('timeout after POST stays unresolved across replay and can only reconcile against an exact canonical expense', async () => {
  const f = fixture({mode:'lost'});
  assert.equal((await f.writer.handle(user, input())).status, 202);
  assert.equal((await f.writer.handle(user, input())).body.state, 'needs_reconciliation'); assert.equal(f.posts.length, 1);
  const result = await f.writer.handle(user, {action:'reconcile', operationId:id(2), expenseId:id(6)});
  assert.equal(result.body.verified, true); assert.equal(f.posts.length, 1);
});
test('wrong VAT, interrupted readback and existing Morning invoice never produce false success or a second POST', async () => {
  for (const mode of ['wrong-vat', 'readback-down']) {
    const f = fixture({mode}); const result = await f.writer.handle(user, input());
    assert.notEqual(result.body.verified, true); assert.equal(f.rows.get(id(2)).state, 'created_unverified');
    f.setMode(''); assert.equal((await f.writer.handle(user, {action:'operation_status', operationId:id(2)})).body.verified, true);
    assert.equal(f.posts.length, 1);
  }
  const duplicate = fixture({mode:'duplicate'});
  assert.equal((await duplicate.writer.handle(user, input())).body.code, 'morning_expense_duplicate');
  assert.equal(duplicate.posts.length, 0); assert.equal(duplicate.rows.has(id(2)), false);
});

test('a later canonical edit revokes historical verification and cannot replay the original financial POST', async () => {
  const f = fixture(); assert.equal((await f.writer.handle(user, input())).body.verified, true);
  f.setMode('wrong-vat'); const changed = await f.writer.handle(user, {action:'operation_status', operationId:id(2)});
  assert.equal(changed.status, 202); assert.equal(changed.body.verified, false);
  assert.equal(f.rows.get(id(2)).state, 'created_unverified'); assert.equal(f.rows.get(id(2)).verified_at, null);
  assert.equal((await f.writer.handle(user, input())).body.verified, false); assert.equal(f.posts.length, 1);
  f.setMode(''); assert.equal((await f.writer.handle(user, {action:'operation_status', operationId:id(2)})).body.verified, true);
  assert.equal(f.posts.length, 1);
});
test('failed read-only preflight can recover without leaving a permanent invoice lock', async () => {
  const f = fixture({mode:'preflight-down'});
  assert.equal((await f.writer.handle(user, input())).status, 503); assert.equal(f.rows.size, 0); assert.equal(f.posts.length, 0);
  assert.equal((await f.writer.handle(user, {action:'operation_status', operationId:id(2)})).status, 404);
  f.setMode(''); assert.equal((await f.writer.handle(user, input())).body.verified, true); assert.equal(f.posts.length, 1);
});

test('only an unsent reservation can be cancelled; replay and a late sender never dispatch it', async () => {
  const f = fixture({mode:'reserve-only'});
  await f.writer.handle(user, input()); assert.equal(f.rows.get(id(2)).state, 'reserved'); assert.equal(f.posts.length, 0);
  const cancelled = await f.writer.handle(user, {action:'cancel_reserved', operationId:id(2)});
  assert.equal(cancelled.body.cancelled, true); assert.equal(cancelled.body.intent.number, '00123');
  f.setMode(''); assert.equal((await f.writer.handle(user, input())).body.cancelled, true); assert.equal(f.posts.length, 0);
  assert.equal((await f.writer.handle(user, input(7))).body.verified, true); assert.equal(f.posts.length, 1);
  assert.equal((await f.writer.handle(user, {action:'cancel_reserved', operationId:id(7)})).status, 409);
  const uncertain = fixture({mode:'lost'}); await uncertain.writer.handle(user, input());
  assert.equal((await uncertain.writer.handle(user, {action:'cancel_reserved', operationId:id(2)})).status, 409);
  assert.equal(uncertain.posts.length, 1);
});

test('source intent survives a lost financial response and owner-scoped recovery with creation disabled',async()=>{
  const f=fixture({mode:'lost'}),body={...input(),sourceFile:{sha256:'a'.repeat(64),size:100,contentType:'application/pdf'},
    sourceReview:{mode:'manual',reason:'Original source manually compared to approved invoice'}};
  const result=await f.writer.handle(user,body);
  assert.equal(result.status,202);assert.equal(result.body.sourcePending,true);
  assert.deepEqual(f.rows.get(id(2)).source_metadata,body.sourceFile);
  assert.equal(f.rows.get(id(2)).source_review.mode,'manual');assert.equal(f.posts.length,1);
  const stopped=createExpenseWriter({...f.options,enabled:false});
  const pending=await stopped.handle(user,{action:'source_pending'});
  assert.equal(pending.body.items.length,1);assert.equal(pending.body.items[0].intent.supplierTaxId,'123456789');
  assert.equal((await stopped.handle({...user,id:id(9)},{action:'source_pending'})).body.items.length,0);
  assert.equal((await f.writer.handle(user,body)).body.sourcePending,true);assert.equal(f.posts.length,1);
  const changed={...body,sourceFile:{...body.sourceFile,sha256:'b'.repeat(64)}};
  assert.equal((await f.writer.handle(user,changed)).status,409);assert.equal(f.posts.length,1);
});

test('source intent is rejected before dispatch without explicit valid source review',async()=>{
  for(const patch of [{sourceReview:null},{sourceFile:{sha256:'bad',size:100,contentType:'application/pdf'}},
    {sourceReview:{mode:'extracted',fields:{number:'wrong'}}}]){
    const f=fixture(),body={...input(),sourceFile:{sha256:'a'.repeat(64),size:100,contentType:'application/pdf'},...patch};
    assert.equal((await f.writer.handle(user,body)).status,400);assert.equal(f.posts.length,0);assert.equal(f.rows.size,0);
  }
});

test('read-only duplicate check covers manual intake before reserving and distinguishes identical invoices',async()=>{
  const f=fixture({mode:'duplicate'}),result=await f.writer.handle(user,{...input(),action:'duplicate_check'});
  assert.equal(result.body.duplicate,true);assert.equal(result.body.match,'identical');assert.equal(f.rows.size,0);assert.equal(f.posts.length,0);
});
