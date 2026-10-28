import {test} from 'node:test';
import assert from 'node:assert/strict';
import {expenseBimonth} from '../netunim-orders/site/assets/js/core/morning-report-period.js';
import {expenseHistoryRows, readExpenseHistoryPeriod, createExpenseHistory} from '../netunim-orders/site/assets/js/domains/finance/morning-expense-history.js';
import {searchExpenseSuppliers} from '../netunim-orders/site/assets/js/domains/finance/morning-expense-catalog.js';
import {expenseTableTotals, expenseTableRow} from '../netunim-orders/site/assets/js/domains/finance/morning-expense-table.js';
import {createExpenseRecent, readRecentExpenses, recentExpenseRows} from '../netunim-orders/site/assets/js/domains/finance/morning-expense-recent.js';

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

test('recent expenses span the entire Morning account and sort by creation time across unordered pages', async () => {
  const all = Array.from({length:102}, (_, n) => ({...expense(n, n === 101 ? '2002-01-01' : '2026-10-01', n % 2 ? '2010-01-01' : '2026-10-01'),
    createdAt:new Date(Date.UTC(2026, 9, 27, 0, 0, n)).toISOString()}));
  const calls = [], progress = [];
  const scan = {next:0, pages:1, total:null, items:[], seen:new Set()};
  let rows; do {rows = await readRecentExpenses(async (_, body) => {
    calls.push(body); return paged(all.slice(body.page * 50, body.page * 50 + 50), body.page, all);
  }, caps, () => {}, {scan, progress:(count, total, phase) => {if (phase === 'reading') progress.push([count, total]);}});} while (!rows);
  assert.deepEqual(rows.map(row => row.id), Array.from({length:10}, (_, n) => String(101 - n)));
  assert.equal(rows[0].sourceDocumentDate, '2002-01-01'); assert.equal(calls.length, 6);
  assert.ok(calls.every(body => !Object.hasOwn(body, 'fromDate') && !Object.hasOwn(body, 'toDate') && body.expectedEnvironment === 'production'));
  assert.deepEqual(progress, [[50,102], [100,102], [102,102]]);
  assert.equal(recentExpenseRows([{...all[0], status:100}, all[1]]).length, 1);
  assert.throws(() => recentExpenseRows([{...all[0], createdAt:''}]), /זמן יצירה/);
});

test('recent account reads reject duplicate pages and never publish after an account replacement', async () => {
  const row = {...expense('one', '2026-10-01'), name:'private old account', createdAt:'2026-10-27T10:00:00.000Z'};
  const all = Array.from({length:51}, (_, n) => ({...row, id:String(n)}));
  await assert.rejects(readRecentExpenses(async (_, body) => paged(body.page ? [all[0]] : all.slice(0, 50), body.page, all), caps, () => {}), /השתנתה/);
  globalThis.document = {querySelector:() => null};
  let owner = 'first', release, calls = 0;
  const held = new Promise(resolve => release = resolve);
  const recent = createExpenseRecent({capabilities:() => caps, run:work => work(),
    capture:() => {const captured = owner; return () => assert.equal(owner, captured);},
    request:async () => {calls++; await held; return paged([row]);}});
  const loading = recent.load(); owner = 'second'; recent.reset(); release(); await loading;
  assert.ok(!recent.markup().includes('private old account'));
  assert.equal(recent.record({verified:false}), false); assert.equal(calls, 1);
});

test('one click automatically completes batches including stability verification for 20 through 10000 expenses', async () => {
  globalThis.document = {querySelector:() => null};
  for (const total of [0,20,50,199,200,201,250,278,1000,10000]) {
    const all = Array.from({length:total}, (_, n) => ({...expense(n, '2026-10-01'), number:'invoice-'+n, createdAt:new Date(1700000000000+n*1000).toISOString()}));
    let calls=0, pauses=0;
    const recent = createExpenseRecent({request:async (_, body) => {calls++; return paged(all.slice(body.page*50,body.page*50+50),body.page,all);},
      capabilities:()=>caps, capture:()=>()=>{}, run:work=>work(), pause:async()=>{pauses++;}});
    const work=recent.load(); assert.equal(recent.load(),false); await work;
    assert.equal(calls,2*Math.max(1,Math.ceil(total/50)), String(total));
    if(total>200)assert.ok(pauses>0);
    assert.ok(recent.markup().includes('תמונת מצב מלאה'));
    if(total)assert.ok(recent.markup().includes('invoice-'+(total-1)));
  }
});

test('recent verification detects changed content with unchanged count, excessive accounts and safe-read retry limits', async () => {
  const row={...expense('one','2026-10-01'),createdAt:'2026-10-27T10:00:00Z'};
  let calls=0;
  await assert.rejects(readRecentExpenses(async()=>paged([{...row,number:String(calls++)}]),caps,()=>{}),/השתנתה/);
  const all=Array.from({length:50001},(_,n)=>({...row,id:String(n)}));
  await assert.rejects(readRecentExpenses(async()=>paged(all.slice(0,50),0,all),caps,()=>{}),/50,000/);
  calls=0;const waits=[];
  const result=await readRecentExpenses(async()=>{if(calls++<2)throw Object.assign(Error('limited'),{status:429});return paged([row]);},caps,()=>{},{pause:async ms=>waits.push(ms)});
  assert.equal(result[0].id,'one');assert.deepEqual(waits,[1000,2000]);
  calls=0;await assert.rejects(readRecentExpenses(async()=>{calls++;throw new TypeError('offline');},caps,()=>{},{pause:async()=>{}}),/offline/);assert.equal(calls,3);
});

test('cancelled recent reads keep a resumable scan without publishing partial rows', async () => {
  globalThis.document={querySelector:()=>null};
  const all=Array.from({length:278},(_,n)=>({...expense(n,'2026-10-01'),number:'private-invoice',createdAt:'2026-10-27T10:00:00Z'}));
  let calls=0, recent;
  recent=createExpenseRecent({request:async(_,body)=>{calls++;if(calls===4)recent.cancel();return paged(all.slice(body.page*50,body.page*50+50),body.page,all);},
    capabilities:()=>caps,capture:()=>()=>{},run:work=>work(),pause:async()=>{}});
  await recent.load();assert.ok(!recent.markup().includes('private-invoice'));assert.ok(recent.markup().includes('אפשר להמשיך'));
  await recent.load();assert.ok(recent.markup().includes('תמונת מצב מלאה'));assert.ok(recent.markup().includes('private-invoice'));
});

test('recent snapshots use expiring memory cache; verified writes invalidate without provider reads', async () => {
  globalThis.document = {querySelector:() => null};
  let clock = 1000, calls = 0;
  const row = {...expense('one', '2026-10-01'), number:'snapshot-invoice', createdAt:'2026-10-27T10:00:00Z'};
  const recent = createExpenseRecent({request:async () => {calls++; return paged([row]);}, capabilities:() => caps,
    capture:() => () => {}, run:work => work(), now:() => clock});
  assert.equal(calls, 0); assert.ok(!recent.markup().includes('לא נמצאו'));
  await recent.load(); await recent.load(); assert.equal(calls, 2);
  clock += 120001; await recent.load(); assert.equal(calls, 4);
  recent.record({verified:true}); assert.equal(calls, 4); assert.ok(recent.markup().includes('אינה מעודכנת'));
  await recent.load(); assert.equal(calls, 6);
  recent.reset(); assert.ok(!recent.markup().includes('snapshot-invoice'));
});

test('large reporting periods stop before unbounded reads or partial totals', async () => {
  const all = Array.from({length:1001}, (_, n) => expense(n, '2026-10-01'));
  let calls = 0;
  await assert.rejects(readExpenseHistoryPeriod(async () => {calls++; return paged(all.slice(0, 50), 0, all);}, caps, period, () => {}), /1,000/);
  assert.equal(calls, 1);
});

test('an empty history viewport pauses after one year instead of automatically scanning to 2010', async () => {
  globalThis.document = {querySelector:() => null};
  let calls = 0;
  const history = createExpenseHistory({request:async () => {calls++; return paged([]);}, capabilities:() => caps,
    capture:() => () => {}, run:work => work(), todayISO:() => '2026-10-27'});
  await history.more(); assert.equal(calls, 6);
  assert.ok(!history.markup().includes('data-expense-history-more'));
  assert.ok(history.markup().includes('בדיקת שנה קודמת'));
  await history.more(); assert.equal(calls, 12);
  history.reset(); assert.ok(!history.markup().includes('בדיקת שנה קודמת'));
});

test('provider backoff is not multiplied after the Edge transport has finished its bounded retries',async()=>{
  let calls=0;
  await assert.rejects(readRecentExpenses(async()=>{calls++;throw Object.assign(Error('provider cooldown'),{status:502,code:'morning_expenses_source_failed'});},caps,()=>{},{pause:async()=>assert.fail('must honor provider cooldown')}),/provider cooldown/);
  assert.equal(calls,1);
});

test('an old scan timeout cannot cancel a replacement read while an aborted provider response is delayed',async()=>{
  globalThis.document={querySelector:()=>null};
  const original=globalThis.setTimeout, deadlines=[], releases=[];
  globalThis.setTimeout=(callback,ms,...args)=>{if(ms===300000)deadlines.push(callback);return original(callback,ms,...args);};
  const row={...expense('one','2026-10-01'),number:'replacement-read',createdAt:'2026-10-27T10:00:00Z'};
  let calls=0;
  try {
    const recent=createExpenseRecent({request:async()=>{if(calls++<2)await new Promise(resolve=>releases.push(resolve));return paged([row]);},
      capabilities:()=>caps,capture:()=>()=>{},run:work=>work(),pause:async()=>{}});
    const old=recent.load();recent.reset();const current=recent.load();
    deadlines[0]();releases.forEach(resolve=>resolve());await Promise.all([old,current]);
    assert.match(recent.markup(),/תמונת מצב מלאה/);assert.match(recent.markup(),/replacement-read/);
  } finally {globalThis.setTimeout=original;}
});
