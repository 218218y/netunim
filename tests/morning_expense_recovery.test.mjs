import assert from 'node:assert/strict';
import {test} from 'node:test';
import {readExpenseRecovery, writeExpenseRecovery, clearExpenseRecovery} from '../netunim-orders/site/assets/js/domains/finance/morning-expense-recovery.js';
const id = n => `aaaaaaaa-aaaa-4aaa-aaaa-${String(n).padStart(12, '0')}`;
const storage = () => {const values = new Map(); return {values, getItem:key => values.get(key) ?? null, setItem:(key, value) => values.set(key, value), removeItem:key => values.delete(key)};};
test('recovery survives environment switches and never crosses accounts or removes another environment', () => {
  const store = storage();
  writeExpenseRecovery(store, id(1), 'sandbox', id(2)); writeExpenseRecovery(store, id(1), 'production', id(3));
  assert.equal(readExpenseRecovery(store, id(1), 'sandbox').operationId, id(2));
  assert.equal(readExpenseRecovery(store, id(1), 'production').operationId, id(3));
  assert.equal(readExpenseRecovery(store, id(9), 'sandbox'), null);
  clearExpenseRecovery(store, id(1), 'production'); assert.equal(readExpenseRecovery(store, id(1), 'sandbox').operationId, id(2));
  assert.deepEqual(Object.keys(JSON.parse([...store.values.values()][0])).sort(), ['environment', 'operationId', 'version']);
});
test('legacy recovery is accepted only in its original environment and removed on explicit completion', () => {
  const store = storage(), key = 'morningExpenseOperation:' + id(1);
  store.setItem(key, JSON.stringify({version:1, environment:'sandbox', operationId:id(2)}));
  assert.equal(readExpenseRecovery(store, id(1), 'sandbox').operationId, id(2)); assert.equal(readExpenseRecovery(store, id(1), 'production'), null);
  clearExpenseRecovery(store, id(1), 'production'); assert.notEqual(store.getItem(key), null);
  clearExpenseRecovery(store, id(1), 'sandbox'); assert.equal(store.getItem(key), null);
  for (const value of ['broken', 'x'.repeat(301), JSON.stringify({version:1, environment:'sandbox', operationId:'local-id'})]) {
    store.setItem(key, value); assert.equal(readExpenseRecovery(store, id(1), 'sandbox'), null);
  }
});
test('a failed durable recovery write prevents financial submission; invalid scope never creates a storage key', () => {
  const store = storage(); assert.throws(() => writeExpenseRecovery(store, 'anonymous', 'sandbox', id(1)));
  assert.throws(() => writeExpenseRecovery(store, id(1), 'invalid', id(2))); assert.equal(store.values.size, 0);
  assert.throws(() => writeExpenseRecovery({setItem:() => {throw Error('quota');}}, id(1), 'production', id(2)), /quota/);
});
