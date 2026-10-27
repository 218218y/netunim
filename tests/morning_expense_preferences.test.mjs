import assert from 'node:assert/strict';
import {test} from 'node:test';
import {readExpensePreferences, writeExpensePreferences, readExpenseReportingPeriod, writeExpenseReportingPeriod} from '../netunim-orders/site/assets/js/domains/finance/morning-expense-preferences.js';
const id = n => `aaaaaaaa-aaaa-4aaa-aaaa-${String(n).padStart(12,'0')}`;
const fixture = () => {const data = new Map(); return {data, getItem:key => data.get(key) || null, setItem:(key,value) => data.set(key,value)};};
test('expense preferences retain only bounded canonical IDs, scoped to account and environment', () => {
  const storage = fixture(), data = {version:1, favorites:Array.from({length:20},(_,i) => id(i)),
    classifications:Array.from({length:50},(_,i) => ({supplierId:id(i),expenseId:id(i+100),name:'private',vat:160})), recentExpenses:Array.from({length:20},(_,i) => id(i+200)), name:'private',invoiceNumber:'secret'};
  assert.equal(writeExpensePreferences(storage,id(1),'sandbox',data),true);
  const restored = readExpensePreferences(storage,id(1),'sandbox');
  assert.equal(restored.favorites.length,8); assert.equal(restored.classifications.length,32);
  assert.equal(Object.hasOwn(restored, 'recentExpenses'), false);
  assert.ok(!JSON.stringify(restored).includes('private')); assert.ok(!JSON.stringify(restored).includes('secret'));
  assert.equal(readExpensePreferences(storage,id(2),'sandbox').favorites.length,0);
  assert.equal(readExpensePreferences(storage,id(1),'production').favorites.length,0);
});
test('malformed, oversized, duplicate and unavailable local storage never grant authority or block intake', () => {
  const storage = fixture(), key = 'morningExpensePreferences:sandbox:'+id(1);
  for (const raw of ['{',JSON.stringify({version:2,favorites:[id(1)],classifications:[]}), ' '.repeat(12001)]) {
    storage.data.set(key,raw); assert.equal(readExpensePreferences(storage,id(1),'sandbox').favorites.length,0);
  }
  writeExpensePreferences(storage,id(1),'sandbox',{version:1,favorites:[id(3),id(3),'local'],classifications:[{supplierId:id(3),expenseId:id(4)},{supplierId:id(3),expenseId:id(5)},{supplierId:'local',expenseId:id(6)}]});
  const restored = readExpensePreferences(storage,id(1),'sandbox'); assert.deepEqual(restored.favorites,[id(3)]); assert.equal(restored.classifications.length,1);
  assert.equal(writeExpensePreferences({setItem:() => {throw Error('full');}},id(1),'sandbox',restored),false);
  assert.equal(writeExpensePreferences(storage,'foreign','sandbox',restored),false);
});

test('the last reporting choice survives month/year boundaries and unrelated preference writes', () => {
  const storage = fixture(), today = '2026-10-27';
  assert.equal(writeExpenseReportingPeriod(storage, id(1), 'production', '2026-09', today), true);
  assert.equal(readExpenseReportingPeriod(storage, id(1), 'production', '2026-11-01'), '2026-09');
  assert.equal(readExpenseReportingPeriod(storage, id(1), 'production', '2028-03-01'), '2026-09');
  writeExpensePreferences(storage, id(1), 'production', {version:1, favorites:[id(2)], classifications:[]});
  assert.equal(readExpenseReportingPeriod(storage, id(1), 'production', '2028-03-01'), '2026-09');
  assert.equal(readExpenseReportingPeriod(storage, id(2), 'production', today), '');
  assert.equal(readExpenseReportingPeriod(storage, id(1), 'sandbox', today), '');
  for (const period of ['2026-11', '2026-09', '2026-07']) {
    assert.equal(writeExpenseReportingPeriod(storage, id(1), 'production', period, '2026-11-01'), true);
    assert.equal(readExpenseReportingPeriod(storage, id(1), 'production', '2026-11-01'), period);
  }
});

test('reporting preferences reject corrupt/future keys and expose storage failures', () => {
  const storage = fixture(), key = 'morningExpensePreferences:production:'+id(1)+':reportingPeriod', today = '2026-10-27';
  for (const raw of ['{', ' '.repeat(101), JSON.stringify({version:2,period:'2026-09'}),
    ...['2026-10','2026-11','2009-09','2100-01','2026-9','2026-09-01'].map(period => JSON.stringify({version:1,period}))]) {
    storage.data.set(key, raw); assert.equal(readExpenseReportingPeriod(storage, id(1), 'production', today), '');
  }
  for (const period of ['2026-11', '2026-10', 'bad', {}, null]) assert.equal(writeExpenseReportingPeriod(storage,id(1),'production',period,today),false);
  assert.equal(writeExpenseReportingPeriod({setItem:()=>{throw Error('blocked');}},id(1),'production','2026-09',today),false);
  assert.equal(writeExpenseReportingPeriod(storage,'foreign','production','2026-09',today),false);
});
