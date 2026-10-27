import {test} from 'node:test';
import assert from 'node:assert/strict';
import {expenseBimonth} from '../netunim-orders/site/assets/js/core/morning-report-period.js';
import {expenseHistoryRows, readExpenseHistoryPeriod} from '../netunim-orders/site/assets/js/domains/finance/morning-expense-history.js';
import {searchExpenseSuppliers} from '../netunim-orders/site/assets/js/domains/finance/morning-expense-catalog.js';
import {expenseTableTotals, expenseTableRow} from '../netunim-orders/site/assets/js/domains/finance/morning-expense-table.js';
import {createExpenseRecent} from '../netunim-orders/site/assets/js/domains/finance/morning-expense-recent.js';

const caps = {version:1, environment:'production'}, period = expenseBimonth('2026-10-01');
const paged = (items, page = 0, all = items) => ({...caps, items, page, pageSize:50, total:all.length, pages:Math.ceil(all.length / 50)});
const expense = (id, date, reportingDate = '2026-10-01') => ({id:String(id), kind:'expense', status:10, sourceDocumentDate:date, reportingDate});

test('history completes the reporting period before sorting by invoice date across API pages', async () => {
  const all = Array.from({length:51}, (_, i) => expense(i, i === 50 ? '2026-10-27' : '2026-08-01', i % 2 ? '2026-09-01' : '2026-10-01'));
  const calls = [];
  const rows = await readExpenseHistoryPeriod(async (action, body) => {
    calls.push(body); assert.equal(action, 'expenses');
    return paged(all.slice(body.page * 50, body.page * 50 + 50), body.page, all);
  }, caps, period, () => {});
  assert.equal(calls.length, 2); assert.equal(rows[0].id, '50');
  assert.ok(calls.every(body => body.fromDate === '2026-09-01' && body.toDate === '2026-10-01' && body.expectedEnvironment === 'production'));
  // An August invoice reported in October belongs to September–October.
  assert.equal(rows.length, 51); assert.equal(rows.at(-1).sourceDocumentDate, '2026-08-01');
});

test('history rejects shifted pages, duplicates, other periods and old account responses', async () => {
  const row = expense('one', '2026-09-01');
  assert.throws(() => expenseHistoryRows([row, row], period));
  assert.throws(() => expenseHistoryRows([{...row, reportingDate:'2026-08-01'}], period));
  assert.deepEqual(expenseHistoryRows([{...row, status:100}], period), []);
  const all = Array.from({length:51}, (_, i) => ({...row, id:String(i)}));
  await assert.rejects(readExpenseHistoryPeriod(async (_, body) => body.page ? paged([all[0]], 1, all) : paged(all.slice(0, 50), 0, all), caps, period, () => {}), /השתנתה/);
  await assert.rejects(readExpenseHistoryPeriod(async () => paged([row]), caps, period, () => {throw Error('account changed');}), /account changed/);
});

test('smart supplier search finds punctuation variants outside the initial directory page and reuses canonical pages', async () => {
  const all = Array.from({length:101}, (_, i) => ({id:String(i), name:i === 100 ? 'ת.ב.י רהיטים' : 'ספק אחר', active:true, taxId:'123456789'}));
  const catalog = {capabilities:caps, supplierPage:paged(all.slice(0, 50), 0, all)};
  const calls = [];
  const request = async (_, body) => {calls.push(body); return body.name ? paged([]) : paged(all.slice(body.page * 50, body.page * 50 + 50), body.page, all);};
  const result = await searchExpenseSuppliers(request, catalog, 'תבי', false, () => {});
  assert.deepEqual(result.items.map(row => row.id), ['100']); assert.equal(result.hasMore, false);
  assert.deepEqual(calls.map(body => body.page), [0, 1, 2]);
  const repeated = await searchExpenseSuppliers(request, catalog, 'ת ב י', false, () => {});
  assert.equal(repeated.items[0].name, 'ת.ב.י רהיטים'); assert.equal(calls.length, 4);
});

test('supplier scans stay bounded and can continue when the match is beyond four pages', async () => {
  const all = Array.from({length:301}, (_, i) => ({id:String(i), name:i === 300 ? 'ת.ב.י' : 'אחר', active:true}));
  const catalog = {capabilities:caps, supplierPage:paged(all.slice(0, 50), 0, all)};
  let calls = 0;
  const request = async (_, body) => {calls++; return body.name ? paged([]) : paged(all.slice(body.page * 50, body.page * 50 + 50), body.page, all);};
  const first = await searchExpenseSuppliers(request, catalog, 'תבי', false, () => {});
  assert.equal(calls, 5); assert.equal(first.hasMore, true); assert.equal(first.items.length, 0);
  const rest = await searchExpenseSuppliers(request, catalog, 'תבי', true, () => {});
  assert.equal(rest.hasMore, false); assert.equal(rest.items[0].id, '300'); assert.equal(calls, 7);
});

test('expense table summaries preserve cents, reduce credits and never invent missing amounts', () => {
  const invoice = {...expense('one', '2026-10-10'), type:305, grossCents:11800, vatCents:1800};
  assert.deepEqual(expenseTableTotals([invoice, {...invoice, type:330, grossCents:1180, vatCents:180}]), {grossCents:10620, vatCents:1620});
  assert.deepEqual(expenseTableTotals([invoice, {...invoice, grossCents:null, vatCents:0}]), {grossCents:null, vatCents:1800});
  assert.deepEqual(expenseTableTotals([{...invoice, grossCents:Number.MAX_SAFE_INTEGER}, invoice]).grossCents, null);
  const markup = expenseTableRow({...invoice, number:'<script>', name:'שם ספק', description:'תיאור מלא', category:'סיווג'});
  assert.ok(markup.includes('&lt;script&gt;') && markup.includes('תיאור מלא') && markup.includes('מע״מ'));
  assert.ok(!markup.includes('אושרה לדוח') && !markup.includes('הופק דוח'));
});

test('recent successful intakes retain ten canonical IDs in intake order across reporting periods and reloads', async () => {
  globalThis.document = {querySelector:() => null};
  let saved = [], owner = 'first';
  const id = n => `aaaaaaaa-aaaa-4aaa-aaaa-${String(n).padStart(12, '0')}`;
  const row = n => ({...expense(id(n), '2026-01-01', n % 2 ? '2026-10-01' : '2026-08-01'), name:'ספק פרטי', number:'invoice-' + n});
  const ports = {ids:() => saved, remember:ids => {saved = [...ids];}, run:work => work(),
    capture:() => {const captured = owner; return () => assert.equal(owner, captured);}, read:async id => ({...row(0), id, number:'reloaded-' + id})};
  const recent = createExpenseRecent(ports);
  assert.equal(recent.record({verified:false, expenseId:id(0), item:row(0)}), false);
  for (let n = 1; n <= 12; n++) recent.record({verified:true, expenseId:id(n), item:row(n)});
  assert.deepEqual(saved, Array.from({length:10}, (_, n) => id(12 - n)));
  const before = [...saved]; recent.record({verified:true, expenseId:id(5), item:row(5)});
  assert.deepEqual(saved, before); assert.ok(!JSON.stringify(saved).includes('invoice') && !JSON.stringify(saved).includes('פרטי'));
  const reopened = createExpenseRecent(ports); await reopened.load();
  assert.ok(reopened.markup().includes('reloaded-' + id(12)));
  let release; const held = new Promise(resolve => release = resolve);
  const stale = createExpenseRecent({...ports, read:async id => {await held; return {...row(0), id};}});
  const loading = stale.load(); owner = 'second'; stale.reset(); saved = []; release(); await loading;
  assert.ok(!stale.markup().includes('ספק פרטי'));
});
