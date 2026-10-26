import assert from 'node:assert/strict';
import {test} from 'node:test';
import {createExpenseWriter} from '../netunim-orders/supabase/functions/morning-expenses/writer.js';
import {normalizeExpenseInput, expenseCents} from '../netunim-orders/supabase/functions/morning-expenses/input.js';

const id = n => `aaaaaaaa-aaaa-4aaa-aaaa-${String(n).padStart(12, '0')}`;
const user = {id:id(1), app_metadata:{morning_expenses_write:true}};
const input = (operation = 2) => ({action:'create', operationId:id(operation), expense:{supplierId:id(3), classificationExpenseId:id(4),
  documentType:305, number:'00123', date:'2026-10-20', reportingDate:'2026-10-01', net:'1000.00', vat:'160.00', gross:'1160.00',
  pcnClassification:'T', description:'Test'}});
function fixture({environment = 'sandbox', enabled = true, mode = '', pSuppliers = () => []} = {}) {
  const rows = new Map(), posts = [];
  const ledger = {
    get:async (owner, operation) => {const row = rows.get(operation); return row?.owner_id === owner ? structuredClone(row) : null;},
    reserve:async row => {
      if (rows.has(row.operation_id) || [...rows.values()].some(other => other.invoice_identity === row.invoice_identity)) return null;
      rows.set(row.operation_id, structuredClone(row)); return structuredClone(row);
    },
    transition:async (owner, operation, state, patch) => {
      const row = rows.get(operation); if (row?.owner_id !== owner || row.state !== state) return null;
      Object.assign(row, structuredClone(patch)); return structuredClone(row);
    },
  };
  let canonical = null;
  const request = async (path, init) => {
    if (path === '/suppliers/' + id(3)) return {id:id(3), name:'Supplier', active:true, country:'IL', taxId:'123456789'};
    if (path === '/expenses/' + id(4)) return {id:id(4), status:10, accountingClassification:{id:id(5), title:'Category', vat:100}};
    if (path === '/expenses/search') {
      if (mode === 'preflight-down') throw new Error('read failed before any write');
      return {page:1, pageSize:50, total:mode === 'duplicate' ? 1 : 0, pages:mode === 'duplicate' ? 1 : 0, items:mode === 'duplicate' ? [{...canonicalExpense(), id:id(8)}] : []};
    }
    if (path === '/expenses') {
      posts.push(JSON.parse(init.body)); canonical = {...posts.at(-1), id:id(6), status:10, data:{pcnClassification:'T'}};
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
  const writer = createExpenseWriter({environment, enabled, request, ledger, pSuppliers, today:() => '2026-10-26'});
  return {writer, rows, posts, setMode:value => {mode = value;}};
}
test('decimal inputs are exact and VAT is never replaced by an assumed percentage', () => {
  assert.equal(expenseCents('0.29'), 29); assert.equal(expenseCents('1.001'), null);
  for (const value of [-1, Infinity, {}, '', '1e3']) assert.equal(expenseCents(value), null);
  const body = input(); assert.equal(normalizeExpenseInput(body, '2026-10-26').vatCents, 16000);
  assert.throws(() => normalizeExpenseInput({...body, expense:{...body.expense, gross:'1180'}}, '2026-10-26'), /invalid_expense_amounts/);
  assert.throws(() => normalizeExpenseInput({...body, expense:{...body.expense, date:'2026-10-27'}}, '2026-10-26'));
  assert.throws(() => normalizeExpenseInput({...body, expense:{...body.expense, pcnClassification:'P'}}, '2026-10-26'), /p_unverified/);
});
test('only an explicitly authorized Sandbox writer may create, including configured P supplier protection', async () => {
  for (const options of [{environment:'production'}, {enabled:false}]) {
    const f = fixture(options); assert.equal((await f.writer.handle(user, input())).status, 403); assert.equal(f.posts.length, 0);
  }
  const f = fixture(); assert.equal((await f.writer.handle({id:user.id}, input())).status, 403);
  const p = fixture({pSuppliers:() => [{id:id(3), taxId:'123456789'}]});
  assert.equal((await p.writer.handle(user, input())).body.code, 'morning_expense_p_unverified'); assert.equal(p.posts.length, 0);
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
test('failed read-only preflight can recover without leaving a permanent invoice lock', async () => {
  const f = fixture({mode:'preflight-down'});
  assert.equal((await f.writer.handle(user, input())).status, 503); assert.equal(f.rows.size, 0); assert.equal(f.posts.length, 0);
  assert.equal((await f.writer.handle(user, {action:'operation_status', operationId:id(2)})).status, 404);
  f.setMode(''); assert.equal((await f.writer.handle(user, input())).body.verified, true); assert.equal(f.posts.length, 1);
});
