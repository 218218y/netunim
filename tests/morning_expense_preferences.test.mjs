import assert from 'node:assert/strict';
import {test} from 'node:test';
import {readExpensePreferences, writeExpensePreferences} from '../netunim-orders/site/assets/js/domains/finance/morning-expense-preferences.js';
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
