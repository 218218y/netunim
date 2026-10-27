import {test} from 'node:test';
import assert from 'node:assert/strict';
import {expenseSearchMatcher, newExpenseSearchScan, readExpenseSearch} from '../netunim-orders/site/assets/js/domains/finance/morning-expense-search.js';
import {createExpenseHistory} from '../netunim-orders/site/assets/js/domains/finance/morning-expense-history.js';

const caps = {version:1, environment:'production'};
const row = {id:'one', kind:'expense', status:10, number:'INV-482', name:'ת.ב.י רהיטים', description:'כיסאות לחדר ישיבות',
  category:'ציוד משרד', type:305, grossCents:123450, vatCents:18831, sourceDocumentDate:'2026-09-15', reportingDate:'2026-10-01'};
const page = (items, index = 0) => ({...caps, page:index, pageSize:50, total:items.length, pages:Math.ceil(items.length / 50), items:items.slice(index * 50, index * 50 + 50)});

test('expense dates match day-first formats, short years and ISO without locale parsing or false token matches', () => {
  for (const query of ['15-9-26','15-09-26','15/09/26','15/9/2026','15.09.2026','2026-09-15','2026/9/15','תבי 15-9-26','15 / 9 / 26','15–9–26']) {
    assert.ok(expenseSearchMatcher(query)(row), query);
  }
  for (const query of ['9/15/26','31/09/26','15/9/25','15/10/26','29/2/2026']) assert.equal(expenseSearchMatcher(query)(row), false, query);
  assert.ok(expenseSearchMatcher('29-2-24')({...row, sourceDocumentDate:'2024-02-29'}));
  assert.equal(expenseSearchMatcher('15/09/26')({...row, sourceDocumentDate:'2026-10-15'}), false);
});

test('search covers visible text, invoice numbers and exact decimals including credits and thousands separators', () => {
  for (const query of ['תבי','INV-48','כיסאות','ציוד משרד','1234.50','1,234.50 ₪','188.31','תבי 1234.50 15/9/26']) assert.ok(expenseSearchMatcher(query)(row), query);
  assert.equal(expenseSearchMatcher('12.34')(row), false);
  assert.equal(expenseSearchMatcher('1234.51')(row), false);
  assert.equal(expenseSearchMatcher('1234.50')({...row, grossCents:null}), false);
  assert.ok(expenseSearchMatcher('-1,234.50')({...row, type:330}));
  assert.equal(expenseSearchMatcher('-1234.50')(row), false);
  assert.equal(expenseSearchMatcher('תבי')({...row, status:100}), false);
});

test('literal decimal-like text stays searchable independently of financial amounts', () => {
  const item = {...row, number:'INV-123.456', description:'כבל 2.5 מטר', category:'ציוד 3.14159'};
  for (const query of ['INV-123.456', 'כבל 2.5 מטר', 'ציוד 3.14159', 'תבי כבל 2.5 מטר', 'תבי INV-123.456']) {
    assert.ok(expenseSearchMatcher(query)(item), query);
  }
  assert.equal(expenseSearchMatcher('2.50')(item), false);
  assert.equal(expenseSearchMatcher('12.34')(item), false);
  assert.ok(expenseSearchMatcher('15-9-26')({...item, number:'15-9-26', sourceDocumentDate:'2026-10-01'}));
});

test('account search includes later pages and older reporting periods, with bounded explicit continuation', async () => {
  const items = Array.from({length:251}, (_, n) => ({...row, id:String(n), name:n === 250 ? 'יעד' : 'אחר', sourceDocumentDate:'2022-12-15', reportingDate:'2023-01-01'}));
  const scan = newExpenseSearchScan(), calls = [];
  const request = async (action, body) => {calls.push(body); assert.equal(action, 'expenses'); assert.equal(body.fromDate, undefined); assert.equal(body.expectedEnvironment, 'production'); return page(items, body.page);};
  await readExpenseSearch(request, caps, 'יעד', () => {}, {scan});
  assert.equal(calls.length, 4); assert.equal(scan.seen.size, 200); assert.equal(scan.items.length, 0); assert.ok(scan.next < scan.pages);
  await readExpenseSearch(request, caps, 'יעד', () => {}, {scan});
  assert.equal(calls.length, 6); assert.deepEqual(scan.items.map(item => item.id), ['250']); assert.ok(scan.next >= scan.pages);
});

test('search rejects changed snapshots, duplicate pages, wrong environments and stale ownership', async () => {
  const items = Array.from({length:51}, (_, n) => ({...row, id:String(n)}));
  for (const fault of ['duplicate','total','environment']) {
    await assert.rejects(readExpenseSearch(async (_, body) => {
      const value = page(items, body.page);
      if (body.page) {
        if (fault === 'duplicate') value.items = [items[0]];
        if (fault === 'total') value.total = 52;
        if (fault === 'environment') value.environment = 'sandbox';
      }
      return value;
    }, caps, 'תבי', () => {}));
  }
  await assert.rejects(readExpenseSearch(async () => page([row]), caps, 'תבי', () => {throw Error('account changed');}), /account changed/);
  await assert.rejects(readExpenseSearch(async () => page([{...row, reportingDate:'1900-01-01'}]), caps, 'תבי', () => {}), /תקופת דיווח/);
});

test('history search replaces only the list, marks partial results and restores browsing on clear', async () => {
  globalThis.document = {querySelector:() => null};
  const items = Array.from({length:201}, (_, n) => ({...row, id:String(n), name:n === 200 ? 'יעד' : 'אחר'}));
  const history = createExpenseHistory({request:async (_, body) => page(items, body.page), capabilities:() => caps,
    capture:() => () => {}, run:work => work(), todayISO:() => '2026-10-27'});
  history.setQuery('יעד'); await history.search();
  assert.ok(history.markup().includes('החיפוש עדיין חלקי'));
  assert.ok(!history.markup().includes('לא נמצאו הוצאות התואמות'));
  assert.ok(!history.markup().includes('data-expense-history-more'));
  await history.searchMore();
  assert.ok(history.markup().includes('החיפוש הושלם בכל החשבון'));
  assert.ok(history.markup().includes('data-expense-history-id="200"'));
  assert.ok(history.markup().includes('רק את תוצאות החיפוש'));
  history.clearSearch(); assert.ok(!history.markup().includes('data-expense-history-id="200"'));
  assert.ok(!history.markup().includes('החיפוש הושלם'));
  history.setQuery('יעד'); await history.search(); history.setQuery('');
  assert.ok(!history.markup().includes('החיפוש עדיין חלקי'));
});

test('replaced searches and account resets cannot publish old results', async () => {
  globalThis.document = {querySelector:() => null};
  let release, block = true;
  const held = new Promise(resolve => release = resolve);
  const history = createExpenseHistory({request:async () => {if (block) await held; return page([row]);}, capabilities:() => caps,
    capture:() => () => {}, run:work => work(), todayISO:() => '2026-10-27'});
  history.setQuery('תבי'); const old = history.search();
  block = false; history.setQuery('אין התאמה'); await history.search(); release(); await old;
  assert.ok(!history.markup().includes('data-expense-history-id="one"'));
  assert.ok(history.markup().includes('לא נמצאו הוצאות התואמות'));
  history.setQuery('תבי'); await history.search(); history.reset();
  assert.ok(!history.markup().includes('ת.ב.י רהיטים'));
});
